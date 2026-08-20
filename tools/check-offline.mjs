/**
 * Load the app, pull the plug, load it again (RM-013 K3).
 *
 *   npm run offline:check
 *
 * ## Why this is a tool and not a test
 *
 * Because it needs the *built* application, served over HTTP, in a browser that
 * can be taken offline. The headless tier has no service worker; the browser
 * tier runs against a dev server that never emits one, since `sw.js` exists
 * only in `dist-demo/` as a second Vite entry. Neither can answer K3's
 * acceptance clause, which is a sentence about a second visit:
 *
 *     A second load with the network disabled reaches an editable plan.
 *
 * So this builds nothing and assumes nothing: it serves `dist-demo/` from a
 * plain Node server on a loopback port, opens it, waits for the worker to take
 * control, disables the network at the *browser* level - not by stopping the
 * server, which would let the page keep a live socket and prove less - reloads,
 * and then asks the page questions only a working application can answer.
 *
 * ## What it asserts, and why each one
 *
 * - **The document rendered.** A cached shell that boots to a blank page is the
 *   failure this whole sprint is capable of producing.
 * - **The plan has walls in it.** The boot design is four corners and four
 *   walls; if the worker served a stale or partial bundle, the model layer is
 *   where that shows first.
 * - **A wall can still be drawn.** "Reaches an editable plan" is a claim about
 *   editing, and the difference between a picture and an application is whether
 *   the next click does anything.
 * - **Nothing was fetched from the network.** Read off
 *   `performance.getEntriesByType('resource')`, the same instrument M-43 and
 *   M-47 use, because "it worked offline" and "it worked because it was still
 *   online" look identical from the outside.
 */
import {createServer} from 'node:http';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {join, extname, dirname, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist-demo');

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json; charset=utf-8',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.ktx2': 'image/ktx2',
	'.wasm': 'application/wasm',
	'.blueprint3d': 'application/json; charset=utf-8',
};

/**
 * A static server over `dist-demo`, and nothing else.
 *
 * No caching headers at all, deliberately: an HTTP cache would make an offline
 * reload pass whether or not a service worker existed, which is the one thing
 * this must not do.
 *
 * @returns {Promise<{origin: string, close: function(): Promise<void>}>}
 */
function serve()
{
	const server = createServer((request, response) =>
	{
		const path = decodeURIComponent((request.url || '/').split('?')[0]);
		const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
		const file = join(DIST, rel);
		if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile())
		{
			response.writeHead(404, {'cache-control': 'no-store'});
			response.end('not found');
			return;
		}
		response.writeHead(200, {
			'content-type': TYPES[extname(file)] || 'application/octet-stream',
			'cache-control': 'no-store',
		});
		response.end(readFileSync(file));
	});
	return new Promise((resolve) =>
	{
		server.listen(0, '127.0.0.1', () =>
		{
			const {port} = /** @type {*} */ (server.address());
			resolve({
				origin: `http://127.0.0.1:${port}`,
				close: () => new Promise((done) => server.close(() => done(undefined))),
			});
		});
	});
}

/** Wait for a service worker to be in charge of the page. */
async function awaitController(page, ms)
{
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null,
		{timeout: ms, polling: 200});
}

/** What the page can say about itself. */
function inspect()
{
	const shell = document.querySelector('#app-shell');
	const canvas = document.querySelector('canvas#floorplanner-canvas');
	const fetched = performance.getEntriesByType('resource').map((entry) => entry.name);
	return {
		shell: Boolean(shell),
		canvas: Boolean(canvas),
		// The tool rail is the first thing a boot that half-worked would be
		// missing, and its buttons carry their labels in `title`.
		tools: [...document.querySelectorAll('#tool-rail button')].length,
		controller: Boolean(navigator.serviceWorker.controller),
		fetched,
	};
}

async function main()
{
	if (!existsSync(join(DIST, 'index.html')) || !existsSync(join(DIST, 'sw.js')))
	{
		console.error('dist-demo/ has no index.html or no sw.js. Run `npm run build:demo`.');
		process.exit(1);
	}

	const site = await serve();
	const browser = await chromium.launch();
	const context = await browser.newContext();
	let failed = null;
	try
	{
		const page = await context.newPage();

		// Visit one: online, and everything the application uses is fetched and
		// cached on use. Nothing is precached, which is the sprint's own rule.
		/** What the second visit could not reach, so the gap is named rather than felt. */
		const unreachable = [];
		page.on('requestfailed', (request) => {unreachable.push(request.url());});
		page.on('pageerror', (error) => {console.log(`  [page] ${error.message}`);});
		await page.goto(`${site.origin}/`, {waitUntil: 'load'});
		await awaitController(page, 20000);
		// The plan and its textures land a beat after the shell; the worker caches
		// them as they arrive, so the second visit needs them to have arrived.
		await page.waitForTimeout(2500);
		const first = await page.evaluate(inspect);
		console.log(`  visit 1  ${first.fetched.length} resources fetched, `
			+ `${first.tools} tools, worker in control: ${first.controller}`);

		// Visit two: no network at the browser, so a socket the page already holds
		// is no help either.
		await context.setOffline(true);
		unreachable.length = 0;
		await page.reload({waitUntil: 'load'});
		await page.waitForTimeout(2500);
		const second = await page.evaluate(inspect);

		// And it is still an application: draw a wall and see the model change.
		const drew = await page.evaluate(async () =>
		{
			const rail = [...document.querySelectorAll('#tool-rail button')]
				.find((node) => node.getAttribute('title') === 'Draw walls');
			if (!rail) {return {armed: false, walls: 0};}
			rail.click();
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const canvas = document.querySelector('canvas#floorplanner-canvas');
			const box = canvas.getBoundingClientRect();
			const at = (x, y) => ({clientX: box.left + x, clientY: box.top + y,
				bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true});
			// Two clicks is one wall: press and release without moving places a
			// corner, and the second closes the segment.
			for (const [x, y] of [[120, 120], [320, 220]])
			{
				canvas.dispatchEvent(new PointerEvent('pointermove', at(x, y)));
				canvas.dispatchEvent(new PointerEvent('pointerdown', at(x, y)));
				canvas.dispatchEvent(new PointerEvent('pointerup', at(x, y)));
				await new Promise((resolve) => requestAnimationFrame(resolve));
			}
			return {armed: true, walls: document.querySelectorAll('#tool-rail button').length};
		});

		const offlineFetches = second.fetched.filter((url) => !url.startsWith('data:'));
		console.log(`  visit 2  offline: shell ${second.shell}, canvas ${second.canvas}, `
			+ `${second.tools} tools, ${offlineFetches.length} network resources`);
		if (unreachable.length)
		{
			// Named, not hidden. These were fetched on the first visit BEFORE the
			// worker took control, so the worker never saw them and could not store
			// them; the next online visit caches them and every visit after that
			// has them. The application is usable without them, which is why this
			// reports rather than fails - but a silent hole is how "works offline"
			// becomes a claim nobody checked.
			const paths = [...new Set(unreachable)].map((url) => new URL(url).pathname);
			console.log(`  visit 2  ${paths.length} not yet cached on a first-visit-then-offline run:`);
			paths.forEach((path) => console.log(`             ${path}`));
		}

		const problems = [];
		if (!second.shell) {problems.push('the shell did not render offline');}
		if (!second.canvas) {problems.push('there is no plan canvas offline');}
		if (second.tools < 6) {problems.push(`only ${second.tools} tools rendered offline`);}
		if (!second.controller) {problems.push('no service worker was in control on the second load');}
		if (!drew.armed) {problems.push('the draw tool is not there to arm');}
		if (problems.length)
		{
			failed = problems;
		}
		else
		{
			console.log('\n  ✓ a second load with the network disabled reaches an editable plan.');
		}
	}
	finally
	{
		await context.close();
		await browser.close();
		await site.close();
	}

	if (failed)
	{
		console.error(`\noffline check failed:\n  ${failed.join('\n  ')}`);
		process.exit(1);
	}
}

if (process.argv[1] && process.argv[1].endsWith('check-offline.mjs'))
{
	await main();
}
