/**
 * Transcode GPU textures to KTX2/ETC1S, and repoint what references them (B5).
 *
 *   npm run encode:textures                 encode anything that should be
 *   npm run encode:textures -- --check      exit non-zero if the tree is stale
 *   npm run encode:textures -- --dry        report what would change, write nothing
 *
 * ## Why this is worth doing, and why it was not done in B4
 *
 * A JPEG is decoded to RGBA8 before it reaches the GPU, so a 145 KB file
 * becomes 1.33 MB of video memory whatever it cost on disk. A KTX2/ETC1S file
 * is transcoded to a format the GPU reads directly - BC1, ETC1, ASTC - and
 * stays compressed in memory at roughly 1 bit per pixel against RGBA8's 32.
 * Measured over the 18 textures this covers: **30.46 MB of VRAM to 7.61 MB**,
 * and disk from 1.63 MB to 0.62 MB as a side effect. See `SCOPE` for the seven
 * room textures deliberately left alone and the 8.75 MB that leaves on the
 * table.
 *
 * B4 measured all of this and chose against it, for three reasons. Two of them
 * were about cost and are simply paid here. The third was an architectural
 * objection that turned out to be wrong, and it is worth writing down because
 * the correction is the interesting part:
 *
 *   > `KTX2Loader.load()` throws without `detectSupport(renderer)`, and
 *   > `texture_cache` is deliberately page-wide and renderer-free - A0 found
 *   > that coupling and A4 removed it. Wiring KTX2 puts it back.
 *
 * Reading `KTX2Loader.detectSupport` instead of its documentation shows it does
 * not retain the renderer at all. It reads seven `renderer.extensions.has(...)`
 * calls and assigns a plain object of booleans to `this.workerConfig`, which is
 * a public field. The dependency is on **what compressed formats this device
 * supports**, which is a property of the GPU rather than of any renderer, and
 * is exactly as page-wide as the texture cache itself. `core/texture_formats.js`
 * produces that record - from a real renderer when there is one, and otherwise
 * from a one-pixel throwaway context - and the cache stays renderer-free.
 *
 * ## One encode per file, not one per document
 *
 * `@gltf-transform/functions` ships a `ktx2()` transform that would do the
 * model textures inside the container pipeline, and it is deliberately not used
 * here. 21 `.glb` files reference these 19 textures and two of them are shared,
 * so a per-document transform encodes the shared ones twice, cannot guarantee
 * the two encodes agree, and writes two copies of pixels that used to be one
 * file. Encoding each texture exactly once and then repointing every container
 * at the result keeps the sharing that `assembleExternal` was written to
 * preserve in B1.
 *
 * ## What refuses, and why the gate weighs two things
 *
 * A fixed-rate format makes small files BIGGER: three textures here grow on
 * disk, all of them 1-3 KB. An earlier draft of this gate refused anything that
 * grew, which is the wrong rule - B4 found the same trap from the other side,
 * where a texture growing 31 KB on disk was saving 13 MB of VRAM. Disk and
 * memory are different budgets and a texture is worth encoding if it clearly
 * wins either one. So: encode if the file shrinks, OR if it saves at least
 * `VRAM_FLOOR` of video memory. A 1 KB swatch does neither.
 */
import {encodeToKTX2} from 'ktx2-encoder';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC, 'asset-manifest.json');
const REPORT_PATH = join(ROOT, 'asset-pipeline', 'texture-transcode.json');

/**
 * ETC1S, not UASTC, and the ratio is why.
 *
 * UASTC is the high-quality Basis mode and measured at **568% of source** over
 * this catalog - 5.7x larger on disk - for textures that are wood grain and
 * brick viewed at a few hundred pixels. It exists for normal maps and material
 * data where banding is structural; nothing here is that. ETC1S at quality 128
 * is the mode that makes the trade this project wants.
 */
const ENCODE = {isUASTC: false, qualityLevel: 128, needSupercompression: true, generateMipmap: true};

/** A texture must win disk, or win at least this much VRAM, or it is left alone. */
const VRAM_FLOOR = 1024 * 1024;

/** Kinds that are uploaded to the GPU. Thumbnails are `<img>` and out of scope. */
const GPU_KINDS = new Set(['model-texture', 'texture', 'environment']);

/**
 * The two textures `Skybox` owns, added in RM-005 C1.
 *
 * B5's docblock below said the room textures were out of scope because they load
 * through `three/texture_cache.js`, which cannot hold a `CompressedTexture`.
 * That is true of five of the seven. It is not true of these two: `Skybox` has
 * never used the texture cache. It holds its own `TextureLoader`, and its
 * environment path already builds the material inside the load callback, which
 * is the shape a compressed texture needs and always was.
 *
 * They are also the two biggest, at 8.00 MB of the 11.67 MB available - so the
 * blocker B5 identified correctly was standing in front of 31% of the prize.
 *
 * Named individually rather than by a `rooms/` prefix on purpose. The other five
 * room textures really are behind the cache, and a pattern that swept them in
 * would delete five source files the runtime cannot yet load.
 */
const SKYBOX_TEXTURES = new Set([
	'rooms/textures/Ground_4K.jpg',
	'rooms/textures/envs/Garden.jpg',
]);

/**
 * Only the textures inside `.glb` containers, and this is the sprint's real
 * boundary rather than a convenience.
 *
 * ## Why the room textures are not here
 *
 * They load through `three/texture_cache.js`, and that module cannot hold a
 * KTX2 texture as it is written. The cache hands a caller a `Texture` clone
 * SYNCHRONOUSLY and fills in the pixels when the load lands - which works
 * because `TextureLoader.load()` returns a Texture immediately and every clone
 * shares one `.source`.
 *
 * `KTX2Loader.load()` returns `undefined`. The texture arrives only through the
 * onLoad callback, and it is a `CompressedTexture`, whose data lives in
 * `.mipmaps` rather than in the shared `.source` that makes the clone trick
 * work. So there is nothing to hand back at call time and nothing to fill in
 * afterwards: a clone taken before the load cannot become compressed later.
 *
 * Making that work means changing what `acquireTexture` promises - from "a
 * texture now, pixels later" to something asynchronous - and with it `Floor`,
 * `Edge` and `Skybox`, which all call it synchronously while building geometry.
 * That is a redesign of a module A0 and A4 hardened, and it is not something to
 * do as a side effect of a texture format change.
 *
 * ## What that costs, measured rather than waved away
 *
 *     model textures   18 files   30.46 MB -> 7.61 MB   saves 22.84 MB
 *     room textures     7 files   11.67 MB -> 2.92 MB   saves  8.75 MB   NOT DONE
 *
 * 72% of the available saving, for none of the risk. The remaining 8.75 MB is
 * recorded in the roadmap with this explanation, so the cache redesign can be
 * costed on its own merits rather than smuggled in behind a codec change.
 *
 * `GLTFLoader` needs no such change: it has always resolved images
 * asynchronously and hands `KTX2Loader` the buffer itself.
 *
 * ## RM-005 C1 corrected the split, and the correction is worth reading
 *
 * The table above says "room textures 7 files 11.67 MB". Two of those seven are
 * `Skybox`'s, and `Skybox` does not call `acquireTexture` - it never has. The
 * accurate split is:
 *
 *     skybox textures   2 files    8.00 MB -> 2.00 MB   no cache involved
 *     cache textures    5 files    3.67 MB -> 0.92 MB   needs the redesign
 *
 * So 69% of what B5 deferred was deferred behind a blocker that did not apply
 * to it. The mistake was reading the module list off "what draws with a
 * texture" instead of off `grep -n acquireTexture`, and it is recorded here
 * rather than quietly fixed because the same shape - a costing named after its
 * blocker - is what RM-005 exists to correct in two places.
 */
const SCOPE = (name) => /^models\//.test(name) || SKYBOX_TEXTURES.has(name);

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry');

const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

/** @param {Buffer} bytes @returns {{width: number, height: number} | null} */
export function ktx2Dimensions(bytes)
{
	if (bytes.length < 32 || !bytes.subarray(0, 12).equals(KTX2_MAGIC)) { return null; }
	return {width: bytes.readUInt32LE(20), height: bytes.readUInt32LE(24)};
}

/** @param {Buffer} bytes @returns {{width: number, height: number} | null} */
export function sourceDimensions(bytes)
{
	if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47)
	{
		return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
	}
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) { return null; }
	let i = 2;
	while (i + 9 < bytes.length)
	{
		if (bytes[i] !== 0xff) { i++; continue; }
		const marker = bytes[i + 1];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
		{
			return {height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7)};
		}
		i += 2 + bytes.readUInt16BE(i + 2);
	}
	return null;
}

/** The encoder wants pixels, and only the caller knows the container. */
async function decodeImage(buffer)
{
	const bytes = Buffer.from(buffer);
	if (bytes[0] === 0x89 && bytes[1] === 0x50)
	{
		const png = PNG.sync.read(bytes);
		return {width: png.width, height: png.height, data: new Uint8Array(png.data)};
	}
	const image = jpeg.decode(bytes, {useTArray: true, formatAsRGBA: true});
	return {width: image.width, height: image.height, data: new Uint8Array(image.data)};
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const vramBytes = (w, h, bpp) => Math.round(w * h * bpp * 4 / 3);
const human = (n) => (n / 1048576).toFixed(2) + ' MB';
const ktx2Name = (name) => name.replace(/\.(png|jpe?g)$/i, '.ktx2');

/**
 * Silence the encoder, which narrates every slice on stdout.
 *
 * 28 textures produce several thousand lines of progress and the numbers that
 * matter are counted instead. Restored in a finally, because swallowing stdout
 * permanently would make any later failure invisible.
 */
async function quietly(work)
{
	const real = process.stdout.write.bind(process.stdout);
	process.stdout.write = () => true;
	try { return await work(); }
	finally { process.stdout.write = real; }
}

async function main()
{
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
	// Live names only. A retired key points at a file under another name, and
	// following one would encode the same pixels twice - once per name.
	const targets = Object.entries(manifest.assets)
		.filter(([name, entry]) => GPU_KINDS.has(entry.kind) && (!entry.url || entry.url === name))
		.map(([name]) => name)
		.filter((name) => SCOPE(name) && !name.endsWith('.ktx2'))
		.sort();

	// Already-transcoded work, carried forward.
	//
	// The transform deletes the source, so a second run finds nothing to do and
	// would write an EMPTY report describing a tree full of .ktx2 files - which
	// `--check` would then read as "everything is stale". B1 hit the same shape
	// and solved it with an `isEncoded()` short-circuit; here the equivalent
	// question is simply whether the .ktx2 is on disk. An entry is carried only
	// if its output exists AND its source is gone, so a half-finished run is
	// still reported as unfinished.
	const committed = existsSync(REPORT_PATH) ? JSON.parse(readFileSync(REPORT_PATH, 'utf8')) : {textures: []};
	const carried = committed.textures.filter((entry) =>
		existsSync(join(PUBLIC, entry.to)) && !existsSync(join(PUBLIC, entry.from)));

	const report = {encoder: ENCODE, vramFloor: VRAM_FLOOR, textures: [...carried], skipped: []};
	let diskBefore = 0;
	let diskAfter = 0;
	let vramBefore = 0;
	let vramAfter = 0;

	for (const name of targets)
	{
		const path = join(PUBLIC, name);
		const source = readFileSync(path);
		const size = sourceDimensions(source);
		if (!size)
		{
			report.skipped.push({name, reason: 'header not recognised as PNG or JPEG'});
			continue;
		}

		diskBefore += source.length;
		vramBefore += vramBytes(size.width, size.height, 4);

		const keep = (reason) =>
		{
			report.skipped.push({name, reason});
			diskAfter += source.length;
			vramAfter += vramBytes(size.width, size.height, 4);
		};

		let encoded;
		try
		{
			encoded = Buffer.from(await quietly(() => encodeToKTX2(new Uint8Array(source), {...ENCODE, imageDecoder: decodeImage})));
		}
		catch (error)
		{
			keep(`encoder refused it: ${error.message}`);
			continue;
		}

		// Read the container back rather than trusting the encoder's return.
		// A KTX2 whose header does not parse is one the browser will not load
		// either, and it is the only check available without a transcoder.
		const written = ktx2Dimensions(encoded);
		if (!written)
		{
			keep('output is not a readable KTX2 container');
			continue;
		}
		if (written.width !== size.width || written.height !== size.height)
		{
			keep(`transcode changed dimensions to ${written.width}x${written.height}`);
			continue;
		}

		const savedVram = vramBytes(size.width, size.height, 4) - vramBytes(size.width, size.height, 1);
		const shrank = encoded.length < source.length;
		if (!shrank && savedVram < VRAM_FLOOR)
		{
			keep(`grows disk by ${encoded.length - source.length} bytes and saves only ${human(savedVram)} of VRAM`);
			continue;
		}

		report.textures.push({
			from: name,
			to: ktx2Name(name),
			pixels: `${size.width}x${size.height}`,
			bytesBefore: source.length,
			bytesAfter: encoded.length,
			vramBefore: vramBytes(size.width, size.height, 4),
			vramAfter: vramBytes(size.width, size.height, 1),
			sha256: sha(encoded),
		});
		diskAfter += encoded.length;
		vramAfter += vramBytes(size.width, size.height, 1);

		if (!DRY && !CHECK)
		{
			writeFileSync(join(PUBLIC, ktx2Name(name)), encoded);
			unlinkSync(path);
		}
	}

	for (const entry of carried)
	{
		diskBefore += entry.bytesBefore;
		diskAfter += entry.bytesAfter;
		vramBefore += entry.vramBefore;
		vramAfter += entry.vramAfter;
	}

	report.totals = {
		considered: targets.length + carried.length,
		encoded: report.textures.length,
		disk: {before: diskBefore, after: diskAfter},
		vram: {before: vramBefore, after: vramAfter},
	};

	if (CHECK)
	{
		const problems = [];
		for (const entry of committed.textures)
		{
			const path = join(PUBLIC, entry.to);
			if (!existsSync(path)) { problems.push(`${entry.to} is in the report but not on disk`); continue; }
			if (sha(readFileSync(path)) !== entry.sha256) { problems.push(`${entry.to} does not match the bytes in the report`); }
			if (existsSync(join(PUBLIC, entry.from))) { problems.push(`${entry.from} was transcoded but the source is still there`); }
		}
		// Anything this run would newly encode is a texture the committed tree
		// is missing. Compared by name, because the encoder is not bit-exact
		// across versions and re-encoding to compare would make --check the
		// slowest thing in CI.
		const known = new Set(committed.textures.map((entry) => entry.to));
		for (const entry of report.textures)
		{
			if (!known.has(entry.to)) { problems.push(`${entry.from} should be transcoded and is not`); }
		}

		if (problems.length)
		{
			console.error('\nTranscoded textures are stale:\n');
			problems.forEach((line) => console.error('  ' + line));
			console.error('\nRun `npm run encode:textures` and commit the result.\n');
			process.exit(1);
		}
		console.log(`\n${committed.textures.length} textures transcoded to KTX2, all matching the report.\n`);
		return;
	}

	console.log(`\n${report.textures.length} of ${targets.length} GPU textures transcoded to KTX2/ETC1S.\n`);
	for (const entry of report.textures)
	{
		console.log('  ' + entry.to.padEnd(48)
			+ entry.pixels.padStart(11)
			+ `${(entry.bytesBefore / 1024).toFixed(0)} -> ${(entry.bytesAfter / 1024).toFixed(0)} KB`.padStart(18)
			+ `   VRAM ${human(entry.vramBefore)} -> ${human(entry.vramAfter)}`);
	}
	if (report.skipped.length)
	{
		console.log('\n  left as they are:');
		report.skipped.forEach((entry) => console.log(`      ${entry.name}: ${entry.reason}`));
	}
	console.log('\n  disk  ' + human(diskBefore) + ' -> ' + human(diskAfter));
	console.log('  VRAM  ' + human(vramBefore) + ' -> ' + human(vramAfter)
		+ '   (-' + human(vramBefore - vramAfter) + ', ' + (100 * (vramBefore - vramAfter) / vramBefore).toFixed(1) + '%)');

	if (DRY) { console.log('\n  --dry: nothing written.\n'); return; }

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, '\t') + '\n');
	console.log('\n  wrote asset-pipeline/texture-transcode.json');
	console.log('  now run `npm run repoint`, then `npm run manifest`.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
