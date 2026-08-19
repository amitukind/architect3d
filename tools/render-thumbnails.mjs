/**
 * Render one thumbnail per catalog row, from the model the row actually ships.
 *
 *   npm run thumbnails            re-render every thumbnail and rewrite the report
 *   npm run thumbnails -- --check re-render and compare, touch nothing
 *   npm run thumbnails -- --only=chair,desk   render a few, for looking at
 *
 * ## Why a tool, and what it can and cannot make consistent
 *
 * RM-007 asks for thumbnails "rendered by a tool rather than collected", and
 * RM-012 X-8 measured what that is worth today: **all 168 are already exactly
 * 300 x 225**, so it is not about size. It is about framing, and about a catalog
 * that J2 means to grow several times over - a collected thumbnail is whatever
 * the person who collected it happened to crop, and 600 of those do not line up.
 *
 * The honest limit, measured before this was written: **139 of the 168 models
 * declare `KHR_materials_unlit`**, so no light reaches them and lighting is not
 * something this tool can make consistent. What it can make consistent, and
 * does, is the camera, the framing margin, the background, the resolution and
 * the format. The 29 that are lit get the rig below; the other 139 ignore it,
 * which is the correct outcome for a thumbnail of a thing that will also ignore
 * it in the scene.
 *
 * ## Supersampled, because SwiftShader is the renderer, and twice because that
 * is what it costs
 *
 * Rendered at 600 x 450 and box-filtered down to 300 x 225 in Node. MSAA under
 * `--use-angle=swiftshader` is not something to rely on, and a thumbnail of a
 * low-poly chair is mostly silhouette - which is exactly what aliases. A box
 * filter is cheap, is exact, and needs nothing from the driver.
 *
 * Two rather than three, and the difference is measured rather than judged: 3x
 * produced 1,509,383 bytes over the 168 and 2x produces 1,330,113, because every
 * extra sample level invents more part-covered edge pixels and each of those is
 * a colour PNG has not seen before. 179 KB is a third of what `public-total` had
 * left. At a tile the drawer renders 150 px tall, the third sample buys nothing
 * a person can point at.
 *
 * ## Transparent, like the 147 it replaces
 *
 * Every existing PNG in the catalog is colour-type 6 - RGBA - and the drawer
 * draws tiles on a surface that changes with the theme. A baked-in background
 * would be a light-theme background sitting in a dark-theme panel. The 21 JPEGs
 * could not have alpha at all, which is the real reason to normalise them and
 * not tidiness. Two of those 21 are `.JPG`, uppercase, which is a 404 waiting
 * for a case-sensitive host.
 *
 * ## The report is the gate
 *
 * Re-rendering 168 models in a browser takes minutes, so `--check` is a command
 * somebody runs and not something the test suite does. What the suite asserts is
 * the cheap half, against `asset-pipeline/thumbnails.json`: every row has a
 * thumbnail, every thumbnail is 300 x 225 RGBA PNG, and the bytes on disk are
 * the bytes this tool recorded. Same division as the transcode oracle.
 *
 * The report also records what each render **replaced**, which is not
 * bookkeeping: P6's compression report names five of the files this pass deletes
 * as things it produced, and `tests/asset-integrity.test.js` follows the chain
 * rather than having the older report edited to match a newer tree. B5
 * established that arrangement when it moved twelve textures to KTX2; this is
 * the third pass to join it.
 *
 * ## It rewrites the catalog's `image` fields, which is what makes it the source
 *
 * A full run repoints every row at the file it just wrote. `--only` does not -
 * it renders a handful for looking at, and must not leave 160 rows pointing at
 * files it did not write.
 */
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve, extname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {PNG} from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'src/catalog/catalog.json');
const OUT_DIR = join(ROOT, 'public/models/thumbnails');
const REPORT = join(ROOT, 'asset-pipeline/thumbnails.json');

const CHECK = process.argv.includes('--check');
const ONLY = (process.argv.find((argument) => argument.startsWith('--only=')) || '').slice('--only='.length);

/** The size a thumbnail is, unchanged from the 168 that were collected. */
export const WIDTH = 300;
export const HEIGHT = 225;

/**
 * How much bigger the render is than the thumbnail, in each axis.
 *
 * Two, measured: see the supersampling note at the top. Three costs 179 KB
 * across the catalog and buys nothing visible at the size a tile is drawn.
 */
export const SUPERSAMPLE = 2;

/**
 * The camera, written down here rather than in the page, because it is the
 * whole point of the tool and belongs where a reader looks first.
 *
 * A three-quarter view from slightly above: the angle a product photograph uses,
 * and the one that tells a sofa from a bench. `margin` is how much of the frame
 * the model's bounding sphere is allowed to fill - 0.82 leaves a rim so a wide
 * item does not touch the edges of a tile that is 4:3 and mostly not.
 */
export const CAMERA = Object.freeze({azimuth: 35, elevation: 22, fov: 30, margin: 0.82});

const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2',
};

function serve(page)
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
		const path = join(ROOT, url.replace(/^\/+/, ''));
		// Nothing outside the repository, whatever the path says.
		if (!resolve(path).startsWith(resolve(ROOT)) || !existsSync(path) || !path.includes('.'))
		{
			response.writeHead(404).end('no such file: ' + url);
			return;
		}
		response.writeHead(200, {'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream'});
		response.end(readFileSync(path));
	});
	return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

const PAGE = (jobs) => `<!doctype html><meta charset="utf-8"><title>thumbnails</title>
<style>html,body{margin:0;background:#000}</style>
<script type="importmap">{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}</script>
<script id="jobs" type="application/json">${JSON.stringify(jobs)}</script>
<script id="camera" type="application/json">${JSON.stringify(CAMERA)}</script>
<script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';

const JOBS = JSON.parse(document.getElementById('jobs').textContent);
const CAMERA = JSON.parse(document.getElementById('camera').textContent);
const W = ${WIDTH * SUPERSAMPLE};
const H = ${HEIGHT * SUPERSAMPLE};

const renderer = new THREE.WebGLRenderer({antialias: false, alpha: true, preserveDrawingBuffer: true});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// NoToneMapping rather than the app's studio ACES. A thumbnail is a swatch: it
// answers "which one is this", and a filmic roll-off on a 300 px tile of a
// low-poly chair costs contrast without buying anything back. The scene keeps
// ACES; this is a different picture with a different job.
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearAlpha(0);
document.body.appendChild(renderer.domElement);

// The lighting the 29 lit models get, and the 139 unlit ones ignore. Soft and
// frontal on purpose - a thumbnail wants the shape read, not dramatised.
const scene = new THREE.Scene();
const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb0b0b8, 2.2);
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(-1, 2, 2);
const fill = new THREE.DirectionalLight(0xffffff, 0.7);
fill.position.set(2, 0.5, -1);
scene.add(hemisphere, key, fill);

const camera = new THREE.PerspectiveCamera(CAMERA.fov, W / H, 0.01, 1e6);

const draco = new DRACOLoader().setDecoderPath('/public/draco/');
const ktx2 = new KTX2Loader().setTranscoderPath('/public/basis/').detectSupport(renderer);
const gltf = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

/**
 * Point the camera at this box so its widest projection fills CAMERA.margin.
 *
 * The box, not its bounding sphere. A sphere fit is one line and is what the
 * first draft used, and it wastes the frame in exactly the cases a furniture
 * catalog is full of: a sphere around a 200 x 30 x 90 bed has the half-diagonal
 * for a radius, so the bed is drawn at the size of a cube that would contain it
 * and lands at a fifth of the tile. Measured over all 168, that draft filled a
 * mean of **15.8 %** of the frame; fitting the box fills **20.9 %**.
 *
 * So the eight corners are projected and the distance solved for the one that
 * reaches furthest. There is no closed form - moving the camera changes the
 * projection that decides where to move it - but the relation is close to
 * inverse-linear, so scaling the distance by how far off it is converges in
 * three or four passes. Ten is a ceiling nothing reaches.
 */
function frame(box)
{
	const centre = box.getCenter(new THREE.Vector3());
	const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
	const vertical = THREE.MathUtils.degToRad(CAMERA.fov) / 2;
	const horizontal = Math.atan(Math.tan(vertical) * (W / H));
	const azimuth = THREE.MathUtils.degToRad(CAMERA.azimuth);
	const elevation = THREE.MathUtils.degToRad(CAMERA.elevation);

	const corners = [];
	for (let corner = 0; corner < 8; corner++)
	{
		corners.push(new THREE.Vector3(
			(corner & 1) ? box.max.x : box.min.x,
			(corner & 2) ? box.max.y : box.min.y,
			(corner & 4) ? box.max.z : box.min.z));
	}

	const place = (distance) =>
	{
		camera.position.set(
			centre.x + (distance * Math.cos(elevation) * Math.sin(azimuth)),
			centre.y + (distance * Math.sin(elevation)),
			centre.z + (distance * Math.cos(elevation) * Math.cos(azimuth)));
		camera.lookAt(centre);
		camera.updateMatrixWorld(true);
	};

	/** The furthest any corner reaches, as a fraction of the frame's half-extent. */
	const reach = () =>
	{
		const inverse = camera.matrixWorldInverse;
		let worst = 0;
		for (const corner of corners)
		{
			const view = corner.clone().applyMatrix4(inverse);
			// Behind or level with the camera cannot be framed; the loop below only
			// ever moves outward, so this simply forces another pass.
			const depth = Math.max(-view.z, 1e-6);
			worst = Math.max(worst,
				Math.abs(view.x) / (depth * Math.tan(horizontal)),
				Math.abs(view.y) / (depth * Math.tan(vertical)));
		}
		return worst;
	};

	let distance = radius / Math.sin(vertical);
	for (let pass = 0; pass < 10; pass++)
	{
		place(distance);
		const worst = reach();
		if (Math.abs(worst - CAMERA.margin) < 0.002) { break; }
		distance *= worst / CAMERA.margin;
	}

	camera.near = Math.max(distance - (radius * 2), distance / 1000);
	camera.far = distance + (radius * 2);
	camera.updateProjectionMatrix();
}

function dispose(object)
{
	object.traverse((node) =>
	{
		if (node.geometry) { node.geometry.dispose(); }
		const materials = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
		materials.forEach((material) =>
		{
			Object.values(material).forEach((value) =>
			{
				if (value && value.isTexture) { value.dispose(); }
			});
			material.dispose();
		});
	});
}

/**
 * Render one job and hand back its pixels.
 *
 * One at a time, and this is not a style choice. The first draft accumulated all
 * 168 buffers in a global and pulled them over in a single page.evaluate. At the
 * 3x it was rendering then, 900 x 675 x 4 bytes is 2.43 MB each, so the payload
 * was 408 MB raw and about 544 MB once base64'd, and V8 threw
 * ERR_STRING_TOO_LONG serialising it. Pulling them one at a time is 1.1 MB a
 * call at today's 2x, and it also lets a model be disposed the moment its
 * picture is taken rather than after 167 more.
 */
window.__renderOne = async function (index)
{
	const job = JOBS[index];
	try
	{
		const loaded = await gltf.loadAsync(job.model);
		const object = loaded.scene;
		scene.add(object);

		const box = new THREE.Box3().setFromObject(object);
		if (box.isEmpty()) { throw new Error('nothing to frame'); }
		frame(box);

		renderer.render(scene, camera);
		const pixels = new Uint8Array(W * H * 4);
		renderer.getContext().readPixels(0, 0, W, H, renderer.getContext().RGBA,
			renderer.getContext().UNSIGNED_BYTE, pixels);

		scene.remove(object);
		dispose(object);

		let binary = '';
		for (let at = 0; at < pixels.length; at += 8192)
		{
			binary += String.fromCharCode.apply(null, pixels.subarray(at, at + 8192));
		}
		return {pixels: btoa(binary)};
	}
	catch (error)
	{
		return {error: String(error && error.message ? error.message : error)};
	}
};

window.__READY__ = true;
</script>`;

/**
 * Box-filter a supersampled RGBA buffer down, and flip it the right way up.
 *
 * `readPixels` hands back rows bottom-first, which is GL's origin and not a
 * PNG's - the same flip `three/panorama.js` documents. Doing it here rather than
 * in the page keeps the page to one job.
 *
 * Alpha is averaged with the colour rather than premultiplied, because the
 * renderer already wrote premultiplied-looking edges: a pixel that is half
 * covered has both a lower alpha and a colour blended toward zero, and dividing
 * it back out turns silhouette edges into bright fringes.
 *
 * @param {Uint8Array|Buffer} pixels RGBA, `width * SUPERSAMPLE` wide.
 * @returns {Buffer} RGBA at WIDTH x HEIGHT, top row first.
 */
export function downsample(pixels)
{
	const wide = WIDTH * SUPERSAMPLE;
	const tall = HEIGHT * SUPERSAMPLE;
	const out = Buffer.alloc(WIDTH * HEIGHT * 4);
	const samples = SUPERSAMPLE * SUPERSAMPLE;

	for (let y = 0; y < HEIGHT; y++)
	{
		for (let x = 0; x < WIDTH; x++)
		{
			let r = 0, g = 0, b = 0, a = 0;
			for (let dy = 0; dy < SUPERSAMPLE; dy++)
			{
				// Flipped: source row 0 is the bottom of the image.
				const sourceY = tall - 1 - ((y * SUPERSAMPLE) + dy);
				for (let dx = 0; dx < SUPERSAMPLE; dx++)
				{
					const at = ((sourceY * wide) + (x * SUPERSAMPLE) + dx) * 4;
					r += pixels[at]; g += pixels[at + 1]; b += pixels[at + 2]; a += pixels[at + 3];
				}
			}
			const to = ((y * WIDTH) + x) * 4;
			out[to] = Math.round(r / samples);
			out[to + 1] = Math.round(g / samples);
			out[to + 2] = Math.round(b / samples);
			out[to + 3] = Math.round(a / samples);
		}
	}
	return out;
}

/** What fraction of the frame the model covers, which is how framing is checked. */
export function coverage(rgba)
{
	let covered = 0;
	for (let at = 3; at < rgba.length; at += 4)
	{
		if (rgba[at] > 8) { covered++; }
	}
	return covered / (WIDTH * HEIGHT);
}

/** Does the silhouette touch the frame? A model that does is framed too tightly. */
export function clipped(rgba)
{
	const alpha = (x, y) => rgba[(((y * WIDTH) + x) * 4) + 3];
	for (let x = 0; x < WIDTH; x++)
	{
		if (alpha(x, 0) > 8 || alpha(x, HEIGHT - 1) > 8) { return true; }
	}
	for (let y = 0; y < HEIGHT; y++)
	{
		if (alpha(0, y) > 8 || alpha(WIDTH - 1, y) > 8) { return true; }
	}
	return false;
}

/** The file a row's thumbnail is written to, derived from its model. */
export function thumbnailFor(model)
{
	return 'models/thumbnails/' + model.split('/').pop().replace(/\.(glb|gltf)$/i, '') + '.png';
}

function encode(rgba)
{
	const png = new PNG({width: WIDTH, height: HEIGHT});
	rgba.copy(png.data);
	return PNG.sync.write(png, {colorType: 6, deflateLevel: 9});
}

async function main()
{
	const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
	// Carried forward so a second run does not forget what the first replaced:
	// by then the catalog already points at the render, and the collected file is
	// only recorded here. The compression report's chain works the same way, and
	// `tests/asset-integrity.test.js` follows both.
	const previous = new Map(existsSync(REPORT)
		? JSON.parse(readFileSync(REPORT, 'utf8')).thumbnails.map((row) => [row.model, row.replaced])
		: []);
	const rows = catalog.items.filter((item) => !ONLY
		|| ONLY.split(',').some((needle) => item.model.toLowerCase().includes(needle.toLowerCase())));
	if (!rows.length) { throw new Error('nothing matched --only'); }

	console.log(`\nRendering ${rows.length} thumbnails at ${WIDTH * SUPERSAMPLE}x${HEIGHT * SUPERSAMPLE}, `
		+ `boxed down to ${WIDTH}x${HEIGHT}.\n`);

	mkdirSync(OUT_DIR, {recursive: true});
	const report = {
		_comment: 'GENERATED by tools/render-thumbnails.mjs. One row per catalog entry: the model it '
			+ 'was rendered from, the file written, and what the frame contains. `coverage` is the '
			+ 'fraction of the 300x225 that is not transparent, which is how framing is checked '
			+ 'without looking at 168 pictures; `clipped` is whether the silhouette touches an edge.',
		camera: CAMERA,
		size: {width: WIDTH, height: HEIGHT, supersample: SUPERSAMPLE},
		thumbnails: [],
	};
	const failed = [];
	let stale = 0;

	let server;
	let browser;
	try
	{
		server = await serve(PAGE(rows.map((item) => ({model: '/public/' + item.model}))));
		browser = await chromium.launch({
			args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
		});
		const page = await browser.newPage();
		page.on('pageerror', (error) => console.error('  [page] ' + error.message));
		await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'load'});
		await page.waitForFunction(() => window.__READY__ === true, null, {timeout: 120000});

		for (let at = 0; at < rows.length; at++)
		{
			const item = rows[at];
			const entry = await page.evaluate((index) => window.__renderOne(index), at);
			if (entry.error)
			{
				failed.push({model: item.model, error: entry.error});
				continue;
			}

			const rgba = downsample(Buffer.from(entry.pixels, 'base64'));
			const bytes = encode(rgba);
			const relative = thumbnailFor(item.model);

			report.thumbnails.push({
				name: item.name,
				model: item.model,
				image: relative,
				// What this render superseded, or null for a row that never had a
				// collected thumbnail. P6's compression report names some of these
				// files as things it produced, and a record that says a file exists
				// when it does not is worse than no record - so the chain is written
				// down rather than the older report edited.
				replaced: (item.image && item.image !== relative) ? item.image : (previous.get(item.model) || null),
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
				coverage: Math.round(coverage(rgba) * 1000) / 1000,
				clipped: clipped(rgba),
			});

			const path = join(ROOT, 'public', relative);
			if (CHECK)
			{
				if (!existsSync(path) || !readFileSync(path).equals(bytes)) { stale++; }
			}
			else
			{
				writeFileSync(path, bytes);
			}
			if ((at + 1) % 25 === 0 || at + 1 === rows.length) { console.log(`  ${at + 1}/${rows.length}`); }
		}
	}
	finally
	{
		if (browser) { await browser.close(); }
		if (server) { server.close(); }
	}

	if (failed.length)
	{
		console.error(`\n  ${failed.length} model(s) could not be rendered:`);
		failed.forEach((entry) => console.error(`    ${entry.model}: ${entry.error}`));
		process.exit(1);
	}

	report.thumbnails.sort((a, b) => a.image.localeCompare(b.image));
	const text = JSON.stringify(report, null, '\t') + '\n';

	// A partial run writes pictures and nothing else. `--only` renders a handful
	// for looking at, and it must leave neither the catalog pointing at files it
	// did not write nor a report claiming the catalog has five rows in it - which
	// is exactly what `tests/thumbnails.test.js` would then believe.
	const whole = rows.length === catalog.items.length;

	const empty = report.thumbnails.filter((row) => row.coverage < 0.02);
	const tight = report.thumbnails.filter((row) => row.clipped);
	const mean = report.thumbnails.reduce((sum, row) => sum + row.coverage, 0) / report.thumbnails.length;
	console.log(`  ${report.thumbnails.length} rendered, mean coverage ${(mean * 100).toFixed(1)} %`
		+ `, total ${report.thumbnails.reduce((sum, row) => sum + row.bytes, 0).toLocaleString()} B`);
	if (empty.length) { console.log(`  ${empty.length} nearly empty: ${empty.map((row) => row.name).join(', ')}`); }
	if (tight.length) { console.log(`  ${tight.length} touch the frame: ${tight.map((row) => row.name).join(', ')}`); }

	if (!whole)
	{
		console.log(`\n  wrote ${report.thumbnails.length} files. Partial run: neither the catalog `
			+ 'nor the report was touched.\n');
		return;
	}

	if (CHECK)
	{
		const reportStale = !existsSync(REPORT) || readFileSync(REPORT, 'utf8') !== text;
		if (stale || reportStale)
		{
			console.error(`\n  ✗ ${stale} thumbnail(s)${reportStale ? ' and the report' : ''} are out of date.`
				+ ' Run `npm run thumbnails`.\n');
			process.exit(1);
		}
		console.log('\n  ✓ every thumbnail matches what this tool renders today.\n');
		return;
	}
	// The rows point at what this tool produced, which is what makes the tool the
	// source of the thumbnails rather than something somebody ran once.
	catalog.items.forEach((item) => {item.image = thumbnailFor(item.model);});
	writeFileSync(CATALOG, JSON.stringify(catalog, null, '\t') + '\n');
	writeFileSync(REPORT, text);
	console.log(`\n  wrote ${report.thumbnails.length} files, the report and the catalog's image fields.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { await main(); }
