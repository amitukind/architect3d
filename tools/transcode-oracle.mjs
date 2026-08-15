/**
 * Render a texture and its KTX2/ETC1S transcode, and difference the frames.
 *
 *   npm run oracle                    measure every .ktx2 in the tree
 *   npm run oracle -- --calibrate     reproduce RM-005 C1's published numbers
 *   npm run oracle -- --check         exit non-zero if a shipped texture fails
 *
 * ## Why this is a tool and not a scratch script
 *
 * This measurement has now been built three times. B4 wrote it to compare a
 * resize against its source, RM-005 C1 pointed the same idea at a codec for the
 * two `Skybox` textures, and C1 t5 pointed it at the five room textures and
 * refused all five. Each time it was a throwaway script outside the repository,
 * and each time it was deleted afterwards.
 *
 * The cost of that shows up in what B5 shipped. B5 encoded 18 model textures
 * with a gate that weighs disk against video memory and never looks at the
 * picture, because the thing that looks at the picture did not exist anywhere a
 * sprint could reach. Two programmes later the same encoder refused four of five
 * room textures on looks alone, and nobody could say whether the 18 already in
 * the tree were fine, because the instrument was gone and so were the sources.
 *
 * So the instrument is committed, and it recovers its own sources.
 *
 * ## Why it renders instead of decoding
 *
 * A KTX2/ETC1S file is not an image. It is a container that the GPU driver
 * transcodes on upload into whatever compressed format the device reports - BC1
 * on a desktop, ETC2 under SwiftShader, ASTC on most phones - and each of those
 * is a different lossy step on top of the encoder's own. Decoding the container
 * in Node measures the encoder. Rendering it measures what a user sees, which is
 * the question the gate is actually asking.
 *
 * Both textures go through identical geometry, camera, sampler and colour-space
 * state at 1:1, so everything except the codec cancels. `NearestFilter` and no
 * mipmaps, because a filtered sample at 1:1 would blur the difference being
 * measured.
 *
 * ## The orientation trap
 *
 * `TextureLoader` hands back `flipY = true` and `KTX2Loader` hands back
 * `flipY = false`, and a compressed texture cannot be flipped on upload - the
 * renderer ignores the flag rather than honouring it. Comparing the two as
 * loaded therefore differences an image against its own mirror, which for a
 * symmetric texture reads as a small plausible error and for a real one reads as
 * catastrophe. Neither is the codec.
 *
 * Both orientations are measured and the aligned one is reported, with which one
 * won recorded per row. A row whose two orientations are close together is a
 * warning that the measurement has nothing to say, and `mirrorTells` carries the
 * ratio so that case cannot hide.
 *
 * ## The render path has to be transparent, and this is checked every run
 *
 * A difference between two rendered frames is only a measurement of the codec
 * if everything else about the two paths cancels. That is an assumption, and it
 * is checkable: render the SOURCE and compare the frame against the source's own
 * decoded pixels. A transparent path returns that residual at zero. Anything
 * else means the harness is measuring itself, and whatever it then says about
 * the codec is that number plus an unknown.
 *
 * This is not a hypothetical. `--calibrate` was written to reproduce the figures
 * C1 t5 published for the five room textures, and it could not - every one of
 * the five came out low, `hardwood.jpg` at 6.147 against a published 7.441. A
 * sweep over the plausible differences found the cause exactly: with
 * `outputColorSpace` set to Linear-sRGB instead of sRGB, this harness returns
 * 7.441, max 66 and 19.88% over 8 - the published row to three decimals.
 *
 * So the earlier oracle differenced LINEAR-LIGHT values quantised to eight bits.
 * The application renders in sRGB - `three/main.js:262`, asserted by
 * `tests/color-pipeline.test.js` and `tests/viewer-lifecycle.test.js` - so that
 * frame is not the one anybody looks at, and the error it reports is not the
 * error a user sees. It is biased high, which is why the numbers moved down when
 * it was fixed. The residual check above is what makes that impossible to repeat:
 * under Linear-sRGB output the rendered source does not match its own pixels,
 * and the run fails before it reports anything.
 *
 * ## Calibration
 *
 * `--calibrate` re-measures the five room textures C1 t5 refused and prints the
 * corrected figures beside the published ones. It is a correction rather than a
 * pass, and it does not gate: what gates is the residual. Those five sources are
 * still in the tree - they were refused, so nothing was deleted - and they are
 * encoded on the fly rather than committed.
 */
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {encodeToKTX2} from 'ktx2-encoder';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve} from 'node:path';
import {ENCODE} from './encode-textures.mjs';
import {GATES} from './resize-textures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const TRANSCODE_REPORT = join(ROOT, 'asset-pipeline', 'texture-transcode.json');
const ROOM_ORACLE = join(ROOT, 'asset-pipeline', 'room-transcode-oracle.json');
const OUT_PATH = join(ROOT, 'asset-pipeline', 'model-transcode-oracle.json');

const CALIBRATE = process.argv.includes('--calibrate');
const CHECK = process.argv.includes('--check');
const SWEEP = process.argv.includes('--sweep');

/**
 * Encoder settings to try for a texture that failed at the shipped one.
 *
 * A gate failure at one setting is not a codec verdict - C1 t5 made that point
 * about the room textures and it holds here. `qualityLevel` is 128 of a possible
 * 255 in the shipped encode, and UASTC is the high-quality Basis mode that B5
 * ruled out on a catalog-wide disk figure rather than a per-file one. Both are
 * measured before anything is reverted, because VRAM handed back that a setting
 * change would have kept is VRAM wasted.
 */
const SWEEP_SETTINGS = [
	{label: 'ETC1S q128', options: {isUASTC: false, qualityLevel: 128}},
	{label: 'ETC1S q192', options: {isUASTC: false, qualityLevel: 192}},
	{label: 'ETC1S q255', options: {isUASTC: false, qualityLevel: 255}},
	{label: 'UASTC', options: {isUASTC: true}},
];

/**
 * How far the rendered source may sit from its own decoded pixels, in 0-255.
 *
 * Set from what a transparent path actually produces rather than from taste -
 * see the run recorded in `asset-pipeline/model-transcode-oracle.json`. It is
 * not zero because the sampler round-trips each channel through sRGB decode and
 * re-encode in eight bits, which is worth a fraction of a level; it has to stay
 * far below `GATES.codecRms` or the instrument is inside its own gate.
 */
const RESIDUAL_CEILING = 0.5;

/** The five C1 t5 measured, with the numbers it published. Calibration targets. */
const CALIBRATION = [
	'rooms/textures/hardwood.jpg',
	'rooms/textures/marbletiles.jpg',
	'rooms/textures/light_brick.jpg',
	'rooms/textures/light_fine_wood.jpg',
	'rooms/textures/walllightmap.png',
];

/* -------------------------------------------------------------------------
 * Sources
 * ------------------------------------------------------------------------- */

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

/**
 * Recover a source the encoder deleted, from the commit that deleted it.
 *
 * `--diff-filter=D` finds that commit by path, and its parent holds the bytes
 * that went into the encoder. This is what makes the tool usable at all against
 * a tree where the encode already happened - which is every tree, since the
 * encoder unlinks the source in the same run that writes the container.
 */
function recoverSource(name)
{
	const git = (args) => execFileSync('git', args, {cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024});
	const path = 'public/' + name;
	const deleted = git(['log', '--diff-filter=D', '--format=%H', '-1', '--', path]).toString('utf8').trim();
	if (!deleted) { return null; }
	return git(['show', `${deleted}~1:${path}`]);
}

/**
 * The pairs to measure, each with its source bytes in hand.
 *
 * In the default mode that is every entry of the transcode report whose
 * container is on disk; under `--calibrate` it is the five room textures, whose
 * sources are in the tree and whose containers are produced here because the
 * tree deliberately has none.
 */
async function collectPairs(scratch)
{
	/** @type {{name: string, source: string, ktx2: string, sourceBytes: Buffer, from: string}[]} */
	const pairs = [];

	if (CALIBRATE)
	{
		for (const name of CALIBRATION)
		{
			const sourceBytes = readFileSync(join(PUBLIC, name));
			const encoded = Buffer.from(await quietly(() =>
				encodeToKTX2(new Uint8Array(sourceBytes), {...ENCODE, imageDecoder: decodeImage})));
			const stem = name.replace(/[^\w]/g, '_');
			writeFileSync(join(scratch, stem + extname(name)), sourceBytes);
			writeFileSync(join(scratch, stem + '.ktx2'), encoded);
			pairs.push({
				name,
				from: 'the tree',
				source: '/__scratch__/' + stem + extname(name),
				ktx2: '/__scratch__/' + stem + '.ktx2',
				sourceBytes,
			});
		}
		return pairs;
	}

	if (SWEEP)
	{
		const measured = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
		const failing = measured.rows.filter((row) => row.rms > GATES.codecRms);
		if (!failing.length) { throw new Error('nothing in ' + OUT_PATH + ' is past the gate'); }
		for (const row of failing)
		{
			const sourceBytes = existsSync(join(PUBLIC, row.name))
				? readFileSync(join(PUBLIC, row.name)) : recoverSource(row.name);
			if (!sourceBytes) { throw new Error('no source for ' + row.name); }
			const stem = row.name.replace(/[^\w]/g, '_');
			writeFileSync(join(scratch, stem + extname(row.name)), sourceBytes);
			for (const setting of SWEEP_SETTINGS)
			{
				const encoded = Buffer.from(await quietly(() => encodeToKTX2(
					new Uint8Array(sourceBytes), {...ENCODE, ...setting.options, imageDecoder: decodeImage})));
				const file = stem + '.' + setting.label.replace(/\W/g, '') + '.ktx2';
				writeFileSync(join(scratch, file), encoded);
				pairs.push({
					name: row.name,
					from: setting.label,
					bytes: encoded.length,
					sourceBytesLength: sourceBytes.length,
					source: '/__scratch__/' + stem + extname(row.name),
					ktx2: '/__scratch__/' + file,
					sourceBytes,
				});
			}
		}
		return pairs;
	}

	const report = JSON.parse(readFileSync(TRANSCODE_REPORT, 'utf8'));
	for (const entry of report.textures)
	{
		if (!existsSync(join(PUBLIC, entry.to))) { continue; }
		const inTree = existsSync(join(PUBLIC, entry.from));
		const sourceBytes = inTree ? readFileSync(join(PUBLIC, entry.from)) : recoverSource(entry.from);
		if (!sourceBytes)
		{
			console.error(`  ! no source for ${entry.from} - not in the tree and no deleting commit found`);
			continue;
		}
		const stem = entry.from.replace(/[^\w]/g, '_');
		writeFileSync(join(scratch, stem + extname(entry.from)), sourceBytes);
		pairs.push({
			name: entry.from,
			from: inTree ? 'the tree' : 'git history',
			shipped: 'compressed',
			bytes: readFileSync(join(PUBLIC, entry.to)).length,
			sourceBytesLength: entry.bytesBefore,
			source: '/__scratch__/' + stem + extname(entry.from),
			ktx2: '/public/' + entry.to,
			sourceBytes,
		});
	}

	// What the encoder LOOKED AT and left alone, encoded here to measure it.
	//
	// A texture that ships uncompressed for a reason recorded in `REFUSED` was
	// refused on a number, and a number that came out of the old harness is a
	// number this one disagrees with. Leaving them out would mean the correction
	// only ever runs in the direction of finding new failures.
	for (const entry of report.skipped)
	{
		if (!existsSync(join(PUBLIC, entry.name))) { continue; }
		const sourceBytes = readFileSync(join(PUBLIC, entry.name));
		const encoded = Buffer.from(await quietly(() =>
			encodeToKTX2(new Uint8Array(sourceBytes), {...ENCODE, imageDecoder: decodeImage})));
		const stem = entry.name.replace(/[^\w]/g, '_');
		writeFileSync(join(scratch, stem + extname(entry.name)), sourceBytes);
		writeFileSync(join(scratch, stem + '.ktx2'), encoded);
		pairs.push({
			name: entry.name,
			from: 'the tree',
			shipped: 'uncompressed',
			bytes: encoded.length,
			sourceBytesLength: sourceBytes.length,
			source: '/__scratch__/' + stem + extname(entry.name),
			ktx2: '/__scratch__/' + stem + '.ktx2',
			sourceBytes,
		});
	}
	return pairs;
}

/** The encoder narrates every slice on stdout; the numbers that matter are counted. */
async function quietly(work)
{
	const real = process.stdout.write.bind(process.stdout);
	process.stdout.write = () => true;
	try { return await work(); }
	finally { process.stdout.write = real; }
}

/* -------------------------------------------------------------------------
 * Serving
 * ------------------------------------------------------------------------- */

const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.json': 'application/json', '.wasm': 'application/wasm',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ktx2': 'image/ktx2',
};

/**
 * A static server rooted at the repository, and a 404 that is really a 404.
 *
 * B4's oracle ran against `vite preview`, whose SPA fallback serves index.html
 * with a 200 for a path that does not exist - so a mistyped texture name was
 * measured as a page of HTML rather than reported as missing. That is recorded
 * in `tests/browser/environment-map.test.js`, which checks the container magic
 * for the same reason. Here the fix is upstream: nothing is served that is not
 * a file, and the page refuses to start if a fetch does not come back 200.
 */
function serve(scratch, page)
{
	const server = createServer((request, response) =>
	{
		const url = decodeURIComponent((request.url || '/').split('?')[0]);
		if (url === '/' || url === '/index.html')
		{
			response.writeHead(200, {'content-type': 'text/html'});
			response.end(page);
			return;
		}
		const path = url.startsWith('/__scratch__/')
			? join(scratch, url.slice('/__scratch__/'.length))
			: join(ROOT, url.replace(/^\/+/, ''));
		// Nothing outside the two roots, whatever the path says.
		if (!resolve(path).startsWith(resolve(ROOT)) && !resolve(path).startsWith(resolve(scratch)))
		{
			response.writeHead(403).end('outside the served roots');
			return;
		}
		if (!existsSync(path) || !path.includes('.'))
		{
			response.writeHead(404).end('no such file: ' + url);
			return;
		}
		response.writeHead(200, {'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream'});
		response.end(readFileSync(path));
	});
	return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/* -------------------------------------------------------------------------
 * The page
 * ------------------------------------------------------------------------- */

const PAGE = (pairs) => `<!doctype html><meta charset="utf-8"><title>transcode oracle</title>
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}</script>
<script id="pairs" type="application/json">${JSON.stringify(pairs)}</script>
<script type="module">
import * as THREE from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';

const PAIRS = JSON.parse(document.getElementById('pairs').textContent);

const renderer = new THREE.WebGLRenderer({antialias: false, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
const gl = renderer.getContext();

const ktx2 = new KTX2Loader()
	.setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/')
	.detectSupport(renderer);

/** Sampler state is identical for both sides; only the pixels differ. */
function prepare(texture)
{
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

/** One texture, one frame, read back as RGBA bytes. */
function frame(texture, w, h)
{
	renderer.setSize(w, h, false);
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0, 1);
	const geometry = new THREE.PlaneGeometry(w, h);
	const material = new THREE.MeshBasicMaterial({map: prepare(texture)});
	const mesh = new THREE.Mesh(geometry, material);
	scene.add(mesh);
	renderer.render(scene, camera);
	const pixels = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	geometry.dispose();
	material.dispose();
	return pixels;
}

const mirror = (pixels, w, h) =>
{
	const out = new Uint8Array(pixels.length);
	for (let y = 0; y < h; y++) { out.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); }
	return out;
};

/** Absolute per-channel difference over RGB, which is what the room oracle reported. */
function difference(a, b)
{
	const deltas = [];
	let sum = 0;
	for (let i = 0; i < a.length; i += 4)
	{
		for (let c = 0; c < 3; c++)
		{
			const d = Math.abs(a[i + c] - b[i + c]);
			deltas.push(d);
			sum += d * d;
		}
	}
	deltas.sort((x, y) => x - y);
	const at = (q) => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
	return {
		rms: Math.sqrt(sum / deltas.length),
		p95: at(0.95),
		p99: at(0.99),
		max: deltas[deltas.length - 1],
		pctOver8: 100 * deltas.filter((d) => d > 8).length / deltas.length,
	};
}

/**
 * The source's own decoded pixels, straight from the browser's image decoder.
 *
 * The comparand for the residual check. Same decoder \`TextureLoader\` uses, so
 * the only thing between these bytes and the rendered frame is the render path -
 * which is exactly what the check is trying to hold at zero.
 */
async function decodedPixels(url, w, h)
{
	const bitmap = await createImageBitmap(await (await fetch(url)).blob());
	const canvas = new OffscreenCanvas(w, h);
	const context = canvas.getContext('2d', {colorSpace: 'srgb', willReadFrequently: true});
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return new Uint8Array(context.getImageData(0, 0, w, h, {colorSpace: 'srgb'}).data.buffer);
}

/** The span the content actually uses, so a low-contrast texture can be judged on its own terms. */
function ownRange(pixels)
{
	let low = 255;
	let high = 0;
	for (let i = 0; i < pixels.length; i += 4)
	{
		for (let c = 0; c < 3; c++) { low = Math.min(low, pixels[i + c]); high = Math.max(high, pixels[i + c]); }
	}
	return {low, high, span: high - low};
}

const rows = [];
try
{
	for (const pair of PAIRS)
	{
		const head = await fetch(pair.ktx2, {method: 'HEAD'});
		if (!head.ok) { throw new Error(pair.ktx2 + ' came back ' + head.status); }

		const source = await new THREE.TextureLoader().loadAsync(pair.source);
		const compressed = await ktx2.loadAsync(pair.ktx2);
		const w = compressed.image.width;
		const h = compressed.image.height;
		if (source.image.width !== w || source.image.height !== h)
		{
			throw new Error(pair.name + ': source is ' + source.image.width + 'x' + source.image.height
				+ ' and the container is ' + w + 'x' + h);
		}

		const a = frame(source, w, h);
		const b = frame(compressed, w, h);
		// Both orientations, because the two loaders disagree about flipY and a
		// compressed texture cannot be flipped on upload.
		const asIs = difference(a, b);
		const flipped = difference(a, mirror(b, w, h));
		const aligned = asIs.rms <= flipped.rms ? asIs : flipped;
		const other = asIs.rms <= flipped.rms ? flipped : asIs;
		const range = ownRange(a);

		// Does the render path add anything of its own? It must not.
		const own = await decodedPixels(pair.source, w, h);
		const residual = Math.min(difference(a, own).rms, difference(a, mirror(own, w, h)).rms);

		rows.push({
			name: pair.name,
			from: pair.from,
			shipped: pair.shipped,
			bytes: pair.bytes,
			sourceBytesLength: pair.sourceBytesLength,
			pixels: w + 'x' + h,
			residual,
			rms: aligned.rms,
			p95: aligned.p95,
			p99: aligned.p99,
			max: aligned.max,
			pctOver8: aligned.pctOver8,
			ownRange: range.span,
			rmsAsShareOfOwnRange: range.span ? aligned.rms / range.span : null,
			maxAsShareOfOwnRange: range.span ? aligned.max / range.span : null,
			orientation: asIs.rms <= flipped.rms ? 'as loaded' : 'mirrored',
			mirrorTells: aligned.rms ? other.rms / aligned.rms : Infinity,
		});
		source.dispose();
		compressed.dispose();
	}
	window.__ORACLE__ = {rows, transcodedTo: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl'};
}
catch (error)
{
	window.__ORACLE__ = {error: error.message + '\\n' + error.stack};
}
</script>`;

/* -------------------------------------------------------------------------
 * Driver
 * ------------------------------------------------------------------------- */

async function main()
{
	const scratch = mkdtempSync(join(tmpdir(), 'transcode-oracle-'));
	let server;
	let browser;
	try
	{
		console.log(CALIBRATE
			? '\nCalibrating against the five room textures RM-005 C1 t5 published.\n'
			: '\nMeasuring every KTX2 in the tree against the source it was encoded from.\n');

		const pairs = await collectPairs(scratch);
		if (!pairs.length) { throw new Error('nothing to measure'); }
		const recovered = pairs.filter((pair) => pair.from === 'git history').length;
		console.log(`  ${pairs.length} pairs` + (recovered ? `, ${recovered} of them recovered from git history` : ''));

		server = await serve(scratch, PAGE(pairs.map(({name, from, shipped, source, ktx2, bytes, sourceBytesLength}) =>
			({name, from, shipped, source, ktx2, bytes, sourceBytesLength}))));
		const port = server.address().port;

		browser = await chromium.launch({
			args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
		});
		const page = await browser.newPage();
		page.on('pageerror', (error) => console.error('  [page] ' + error.message));
		await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load'});
		await page.waitForFunction(() => window.__ORACLE__ !== undefined, null, {timeout: 900000});
		const result = await page.evaluate(() => window.__ORACLE__);
		if (result.error) { throw new Error('the page failed:\n' + result.error); }

		report(result.rows);
		// Before any verdict. A harness that is measuring itself has nothing to
		// say about a codec, and this is the check the previous oracle did not have.
		const opaque = result.rows.filter((row) => row.residual > RESIDUAL_CEILING);
		if (opaque.length)
		{
			console.error(`\n  ✗ the render path is not transparent for ${opaque.length} of ${result.rows.length} textures:\n`);
			opaque.forEach((row) => console.error(`      ${row.name}  rendered source differs from its own pixels by ${row.residual.toFixed(3)}`));
			console.error('\n  Every number above is that residual plus the codec. Fix the render path.\n');
			process.exit(1);
		}
		console.log('\n  ✓ render path transparent - worst source residual '
			+ Math.max(...result.rows.map((row) => row.residual)).toFixed(3) + ` / ${RESIDUAL_CEILING} allowed`);

		if (CALIBRATE) { correction(result.rows); return; }
		if (SWEEP) { sweepReport(result.rows); return; }

		// Only what ships compressed. A texture measured here and shipped as a JPEG
		// is already obeying the rule this gate exists to enforce.
		const failures = result.rows.filter((row) => row.shipped === 'compressed' && row.rms > GATES.codecRms);
		writeFileSync(OUT_PATH, JSON.stringify({
			gate: {codecRms: GATES.codecRms, source: 'tools/resize-textures.mjs GATES'},
			encoder: ENCODE,
			rows: result.rows.map(round),
		}, null, '\t') + '\n');
		console.log(`\n  wrote ${OUT_PATH.replace(ROOT + '/', '')}\n`);

		if (CHECK && failures.length)
		{
			console.error(`  ✗ Transcode oracle    ${failures.length} shipped textures are past the ${GATES.codecRms} RMS gate\n`);
			failures.forEach((row) => console.error(`      ${row.name}  RMS ${row.rms.toFixed(3)}`));
			console.error('\n  A texture that cannot match the pixel tier ships uncompressed (B1). Do not');
			console.error('  raise the gate to make this pass.\n');
			process.exit(1);
		}
		if (CHECK)
		{
			// The worst SHIPPED COMPRESSED row, which is the only set this gate
			// governs. Printing the worst of all of them put "worst RMS 7.004 / 3
			// gate" next to a tick, because nyc2.jpg is measured here and ships as
			// a JPEG - a success line that reads like a contradiction is worse than
			// no success line.
			const gated = result.rows.filter((row) => row.shipped === 'compressed');
			console.log(`  ✓ Transcode oracle    ${gated.length} compressed of ${result.rows.length} measured, worst RMS `
				+ Math.max(...gated.map((row) => row.rms)).toFixed(3) + ` / ${GATES.codecRms} gate\n`);
		}
	}
	finally
	{
		if (browser) { await browser.close(); }
		if (server) { server.close(); }
		rmSync(scratch, {recursive: true, force: true});
	}
}

const round = (row) => ({
	...row,
	rms: Number(row.rms.toFixed(3)),
	residual: Number(row.residual.toFixed(4)),
	pctOver8: Number(row.pctOver8.toFixed(3)),
	rmsAsShareOfOwnRange: row.rmsAsShareOfOwnRange === null ? null : Number(row.rmsAsShareOfOwnRange.toFixed(4)),
	maxAsShareOfOwnRange: row.maxAsShareOfOwnRange === null ? null : Number(row.maxAsShareOfOwnRange.toFixed(4)),
	mirrorTells: Number.isFinite(row.mirrorTells) ? Number(row.mirrorTells.toFixed(2)) : null,
});

function report(rows)
{
	console.log('\n  texture'.padEnd(48) + 'pixels'.padStart(10) + 'RMS'.padStart(9)
		+ 'p95'.padStart(6) + 'p99'.padStart(6) + 'max'.padStart(6) + '>8'.padStart(9) + '  own range');
	for (const row of [...rows].sort((a, b) => b.rms - a.rms))
	{
		const verdict = row.rms > GATES.codecRms ? '  REFUSED' : '';
		console.log('  ' + row.name.replace('models/js-glb/textures/', '').replace('rooms/textures/', '').padEnd(46)
			+ row.pixels.padStart(10)
			+ row.rms.toFixed(3).padStart(9)
			+ String(row.p95).padStart(6) + String(row.p99).padStart(6) + String(row.max).padStart(6)
			+ (row.pctOver8.toFixed(2) + '%').padStart(9)
			+ (row.ownRange ? (100 * row.rmsAsShareOfOwnRange).toFixed(1) + '% of ' + row.ownRange : '').padStart(16)
			+ verdict);
	}
	const mirrorSuspect = rows.filter((row) => row.mirrorTells < 1.5);
	if (mirrorSuspect.length)
	{
		console.log('\n  ! both orientations scored within 50% for '
			+ mirrorSuspect.map((row) => row.name).join(', ')
			+ '\n    - the alignment check cannot tell them apart, so these rows are not trustworthy.');
	}
}

/**
 * Every setting tried for every texture that failed, with what it costs on disk.
 *
 * The column that decides anything is the last one: a setting that clears the
 * gate is only usable if the file it produces is one the disk budgets can hold,
 * and reverting to the source is always available at the source's own size.
 */
function sweepReport(rows)
{
	const byTexture = new Map();
	for (const row of rows) { (byTexture.get(row.name) || byTexture.set(row.name, []).get(row.name)).push(row); }
	console.log('\n  settings tried for each texture past the ' + GATES.codecRms + ' gate\n');
	console.log('  texture'.padEnd(38) + 'setting'.padEnd(13) + 'RMS'.padStart(8) + 'disk'.padStart(11)
		+ 'vs source'.padStart(12) + '   verdict');
	for (const [name, settings] of byTexture)
	{
		console.log('  ' + name.replace('models/js-glb/textures/', '').replace('rooms/textures/', ''));
		for (const row of settings)
		{
			const clears = row.rms <= GATES.codecRms;
			console.log('    '.padEnd(38) + row.from.padEnd(13)
				+ row.rms.toFixed(3).padStart(8)
				+ ((row.bytes / 1024).toFixed(0) + ' KB').padStart(11)
				+ ((100 * row.bytes / row.sourceBytesLength).toFixed(0) + '%').padStart(12)
				+ (clears ? '   clears the gate' : ''));
		}
	}
	const rescued = [...byTexture].filter(([, settings]) => settings.some((row) => row.rms <= GATES.codecRms));
	console.log(`\n  ${rescued.length} of ${byTexture.size} can be brought under the gate by a setting change:`);
	for (const [name, settings] of rescued)
	{
		const best = settings.filter((row) => row.rms <= GATES.codecRms)
			.sort((a, b) => a.bytes - b.bytes)[0];
		console.log('      ' + name.replace('models/js-glb/textures/', '') + '  ' + best.from
			+ `  ${(best.bytes / 1024).toFixed(0)} KB against a ${(best.sourceBytesLength / 1024).toFixed(0)} KB source`);
	}
	console.log('');
}

/**
 * The five room textures, corrected against what C1 t5 published.
 *
 * Not a pass or a fail. The published figures were measured through a
 * Linear-sRGB output frame and are biased high by it; these are the same five
 * textures through the frame the application actually renders. The verdict
 * changes for two of them, and that is the point of printing both.
 */
function correction(rows)
{
	const published = JSON.parse(readFileSync(ROOM_ORACLE, 'utf8')).measurements;
	console.log('\n  against the figures RM-005 C1 t5 published, at a gate of ' + GATES.codecRms + '\n');
	console.log('  texture'.padEnd(28) + 'published'.padStart(12) + 'corrected'.padStart(12) + '   was       now');
	for (const row of rows)
	{
		const was = published.find((entry) => entry.name === row.name);
		if (!was) { continue; }
		const verdict = (rms) => (rms > GATES.codecRms ? 'refused' : 'PASSES');
		console.log('  ' + row.name.replace('rooms/textures/', '').padEnd(26)
			+ was.rms.toFixed(3).padStart(12) + row.rms.toFixed(3).padStart(12)
			+ '   ' + verdict(was.rms).padEnd(10) + verdict(row.rms)
			+ (verdict(was.rms) !== verdict(row.rms) ? '   <- changed' : ''));
	}

	// Written back beside the figures it corrects, rather than left in a terminal.
	// The published block stays exactly as it was - it is the record of what C1
	// decided and why - and this sits next to it so that a reader who quotes the
	// old numbers has to walk past the reason not to.
	const file = JSON.parse(readFileSync(ROOM_ORACLE, 'utf8'));
	file.correctedByRM006 = {
		note: [
			'The measurements above were differenced in a LINEAR-sRGB frame. The',
			'application renders in sRGB (three/main.js:262), so they describe an',
			'image nobody sees, and the bias is not one-directional: it overstates',
			'error in mid-tones and understates it in highlights.',
			'',
			'Reproduced exactly before being corrected - setting outputColorSpace back',
			'to Linear-sRGB returns hardwood at 7.441, max 66, 19.88% over 8, which is',
			'the published row to three decimals. `npm run oracle -- --calibrate`',
			'regenerates the corrected column, and every run now fails unless a',
			'rendered source matches its own decoded pixels.',
			'',
			'FOUR OF THE FIVE VERDICTS ARE UNCHANGED. light_fine_wood.jpg now passes',
			'the absolute gate at 2.639, so the pixel reason to refuse it has gone -',
			'it stays uncompressed because texture_cache still cannot hold a',
			'CompressedTexture, which is the architectural reason C1 recorded',
			'separately. walllightmap.png passed on absolute error before and passes',
			'more comfortably now, and its share of its own 21-byte range falls from',
			'6.0% to 2.8% - which is the same 2-4% every one of the five lands at,',
			'and is the argument against own-range as a discriminator here.',
		],
		gate: GATES.codecRms,
		measurements: rows.map(round),
	};
	writeFileSync(ROOM_ORACLE, JSON.stringify(file, null, '\t') + '\n');
	console.log('\n  wrote the corrected column into ' + ROOM_ORACLE.replace(ROOT + '/', '') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
