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
 * stays compressed in memory.
 *
 * At **one byte per pixel** against RGBA8's four, which is what `vramBytes`
 * below computes and what `tools/check-budget.mjs` charges. The prose here used
 * to say "roughly 1 bit per pixel", which is wrong by a factor of eight and
 * never matched the arithmetic beside it (RM-006). One byte per pixel is the
 * cost of ASTC 4x4 and BC7; BC1 and ETC2 RGB8, which is what this catalog
 * actually transcodes to, are half that again. So the figure is exact for the
 * worst target and twice the true cost for the common one - conservative in the
 * direction a budget should be.
 *
 * B5 measured this over 18 model textures and claimed 30.46 MB of VRAM down to
 * 7.61, disk 1.63 MB down to 0.62. **Both figures assumed all 18 could be
 * encoded, and nine of them cannot** - see `REFUSED`. What the tree actually
 * carries is 11 transcoded textures, and `asset-pipeline/texture-transcode.json`
 * holds the current totals rather than this paragraph.
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
export const ENCODE = {isUASTC: false, qualityLevel: 128, needSupercompression: true, generateMipmap: true};

/** A texture must win disk, or win at least this much VRAM, or it is left alone. */
const VRAM_FLOOR = 1024 * 1024;

/**
 * Textures that pass the gate on size and fail it on looks (RM-005 C1).
 *
 * The gate above weighs disk against VRAM and says nothing about the picture,
 * which was defensible while the scope was 18 furniture textures seen at a few
 * hundred pixels. C1 widened it to two textures that fill the frame, and one of
 * them refuses.
 *
 * Both were rendered through the same geometry, camera and sampler state at 1:1
 * and differenced in the framebuffer - B4's oracle, pointed at a codec instead
 * of a resampler.
 *
 * RM-006 RE-MEASURED BOTH with `npm run oracle`, and the figures C1 published
 * here were wrong in both directions:
 *
 *                  C1 said   actually   p95   p99   max   channels off by >8
 *     Ground_4K      1.098      0.761     1     4    25   0.07%
 *     Garden         4.483      6.552    13    23   101   13.33%
 *
 * C1's harness differenced a Linear-sRGB frame rather than the sRGB one the
 * application renders, which over-states error in mid-tones and under-states it
 * in highlights - so a ground texture came out too harsh and a photograph of
 * SKY, which is nearly all highlight, came out too kind. See the docblock of
 * `tools/transcode-oracle.mjs` for how that was found and what now prevents it.
 *
 * The verdicts are unchanged. `Ground_4K` is comfortably inside the 3.0 RMS that
 * B4's `codecRms` gate uses and its worst pixels are isolated speckle. `Garden`
 * is not: a 95th percentile well past the visibility threshold and 13% of the
 * image beyond it is not outliers, it is banding, and it is banding in the
 * surface a user looks at longest.
 *
 * So it ships as a JPEG. This is B1's per-asset rule rather than a new one: a
 * model that could not match the pixel tier shipped unquantised, and the
 * decision was recorded per file rather than taken for the catalog. Refusing on
 * a measurement is the point; refusing on a hunch would not be.
 *
 * UASTC was the obvious alternative and is ruled out by a different budget. It
 * does fix the banding - 6.552 down to 2.040 - and costs **629 KB against
 * Garden's 250 KB**, with `public-total` at 1.3% headroom. C1 estimated that at
 * "roughly 1.4 MB" from a catalog-wide ratio; RM-006 encoded the file and
 * measured it, and the estimate was more than twice the truth. The four settings
 * tried are in `settingsSwept` in asset-pipeline/model-transcode-oracle.json.
 */
const REFUSED = {
	// Measured at 6.552 by `npm run oracle`, not the 4.483 recorded here before.
	// The old figure came out of a harness that differenced a Linear-sRGB frame;
	// this one is worse, not better, because that harness under-reported bright
	// content. Refused either way, and now refused on the right number.
	'rooms/textures/envs/Garden.jpg':
		'ETC1S bands the sky - RMS 6.55 against a 3.0 gate, 13.33% of channels off by more than 8',

	/**
	 * The eight of B5's eighteen that ETC1S cannot carry (RM-006).
	 *
	 * B5 encoded all eighteen against a gate that weighs disk against video
	 * memory, and wrote in this file that doing so was defensible because the
	 * scope was "18 furniture textures seen at a few hundred pixels". That was a
	 * claim about the picture made without looking at one, and `npm run oracle`
	 * now looks: NINE of the eighteen are past the 3.0 codec gate, four of them
	 * past 4.5, and `nyc2.jpg` at more than twice it.
	 *
	 * Every setting the encoder has was tried before any of this was reverted -
	 * `npm run oracle -- --sweep`, recorded in the oracle JSON. ETC1S at maximum
	 * quality rescues exactly one, which is why `cb-archnight-white_baked.png` is
	 * in `QUALITY` below rather than here. UASTC clears the gate for all eight of
	 * these at 163% to 456% of the source on disk, so for every one of them
	 * shipping the source is both better looking and smaller. The four settings
	 * tried per texture are in `settingsSwept` in the oracle JSON.
	 *
	 * The numbers are RMS over RGB in 0-255, from a rendered frame at 1:1.
	 */
	'models/js-glb/textures/nyc2.jpg': 'ETC1S wrecks it - RMS 7.00, worst pixel 174 of 255',
	'models/js-glb/textures/walnut-marin.jpg': 'wood grain - RMS 4.88 against a 3.0 gate',
	'models/js-glb/textures/oak_wood.jpg': 'wood grain - RMS 4.88 against a 3.0 gate',
	'models/js-glb/textures/grey-brown_wood.jpg': 'wood grain - RMS 4.52 against a 3.0 gate',
	'models/js-glb/textures/ik-ekero-orange_baked.jpg': 'RMS 3.65 against a 3.0 gate, and 3.46 at maximum quality',
	'models/js-glb/textures/we-narrow6white_baked.jpg': 'RMS 3.49 against a 3.0 gate, and 3.23 at maximum quality',
	'models/js-glb/textures/bd-shalebedside-smoke_baked.jpg': 'RMS 3.46 against a 3.0 gate, and 3.02 at maximum quality',
	'models/js-glb/textures/cb-clapboard_baked.jpg': 'RMS 3.21 against a 3.0 gate, and 3.09 at maximum quality',
};

/**
 * Per-file encoder quality, for a texture a setting change rescues (RM-006).
 *
 * One entry, and it is here rather than in `REFUSED` because the sweep found a
 * setting that works: `cb-archnight-white_baked.png` measures 3.392 at the
 * shipped quality of 128 and 2.728 at 192, which is inside the gate. The file
 * grows from 40 KB to 55 KB and the source it replaces is a 187 KB PNG, so this
 * is the rare case where the better-looking option is also the smaller one.
 *
 * A global quality of 192 was the obvious alternative and is not taken: it costs
 * every other texture 30-50% more disk to fix one, and the seventeen others are
 * either already inside the gate or beyond rescuing at any setting.
 */
const QUALITY = {
	'models/js-glb/textures/cb-archnight-white_baked.png': 192,
};

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
 * The five behind the texture cache, MEASURED AND REFUSED (RM-005 C1 t5).
 *
 * Listed here rather than in `REFUSED` because they are not in `SCOPE`, and the
 * distinction is deliberate: the runtime cannot load a KTX2 for these, so a tool
 * that could be talked into encoding them would produce files nothing can read.
 * The numbers are what belongs in the tree, not the capability.
 *
 * C1 built the cache change B5 said was needed - an empty `CompressedTexture`
 * handed out and cloned as before, with the decoded payload adopted into the
 * master and every live clone when the transcode lands - and it worked. Then the
 * oracle was pointed at the five textures it was built for:
 *
 *                          RMS    p95   p99   max   channels off by >8
 *     hardwood.jpg        7.441    16    24    66   19.881%
 *     marbletiles.jpg     5.532    11    15    35   11.776%
 *     light_brick.jpg    10.171    23    35    90   25.754%
 *     light_fine_wood.jpg 4.145     8    12    31    4.831%
 *     walllightmap.png    1.269     2     3     5    0.000%
 *
 * Four fail B4's 3.0 codec gate outright, two of them by more than double. The
 * fifth passes on absolute error and fails on the measure that fits it: it is a
 * hand-painted vignette spanning bytes 232-253, so its whole dynamic range is 21
 * levels, and an RMS of 1.269 is **6.0% of that range** with a worst pixel at
 * 23.8%. Judged against its own content it is the most damaged of the five -
 * hardwood's 7.441 is 2.9% of a full-range image.
 *
 * `qualityLevel` was swept before concluding, since B5 chose 128 out of 255:
 *
 *                   q128    q192    q255     disk at q255
 *     hardwood      7.441   6.169   5.388    49 -> 89 KB
 *     light_brick  10.171   8.695   8.484    14 -> 26 KB
 *
 * Still 1.8x and 2.8x the gate at maximum quality, for nearly double the file.
 * ETC1S cannot carry this content at any setting, and UASTC - which could - runs
 * about 5.7x source on this catalog against 320 KB of `public-total` headroom.
 *
 * So the finding is not that the cache blocked these textures. It is that the
 * blocker was never the binding constraint: these are detailed, tiled room
 * surfaces, and they would have refused ETC1S with any cache at all. The cache
 * change was reverted rather than shipped, because machinery with no consumer is
 * a liability - see `asset-pipeline/room-transcode-oracle.json` for the full
 * measurement and the roadmap for what it means for the 18 textures B5 encoded
 * without ever rendering one.
 */
// eslint-disable-next-line no-unused-vars -- a record, not a code path; see the docblock
const REFUSED_ROOM_TEXTURES = [
	'rooms/textures/hardwood.jpg',
	'rooms/textures/marbletiles.jpg',
	'rooms/textures/light_brick.jpg',
	'rooms/textures/light_fine_wood.jpg',
	'rooms/textures/walllightmap.png',
];

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

		// Measured and rejected, which is a different answer from "below the gate"
		// and is recorded as one. Checked before the encode rather than after, so a
		// refusal costs no encoder time on every run.
		if (REFUSED[name])
		{
			keep(REFUSED[name]);
			continue;
		}

		let encoded;
		try
		{
			encoded = Buffer.from(await quietly(() => encodeToKTX2(new Uint8Array(source),
				{...ENCODE, qualityLevel: QUALITY[name] || ENCODE.qualityLevel, imageDecoder: decodeImage})));
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
			qualityLevel: QUALITY[name] || ENCODE.qualityLevel,
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
