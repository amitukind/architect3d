/**
 * A performance score somebody else chose the definition of (RM-015 M3, M-53).
 *
 *   node tools/check-lighthouse.mjs            check, exit 1 below the floor
 *   node tools/check-lighthouse.mjs --update   record the measurement
 *   node tools/check-lighthouse.mjs --url=...  measure a deployed page instead
 *
 * ## Why a Lighthouse score, when there are already fourteen budget lines
 *
 * Because every one of those numbers was chosen by the people being measured.
 * `first-load` counts what this repository decided counts; `texture-vram` sums
 * what this repository decided is a texture. Each is a good number and each is
 * marking its own homework.
 *
 * Lighthouse is not. It weights five metrics the way Google weights them, on a
 * device profile and a network profile it chose, and it will happily say that a
 * change which improved every number in tools/budget.json made the page worse.
 * That is the whole value: it is the one figure here that cannot be gamed by
 * moving bytes from one moment to another - which is precisely the risk M3's
 * own change carries, since deferring three moves the wait rather than removing
 * it.
 *
 * ## The floor works like a coverage floor, not like a budget limit
 *
 * First measurement, rounded down, and never lowered. A budget limit is a
 * ceiling with headroom above the measurement; this is a floor with headroom
 * below it, because the failure direction is the other way round. Raising it
 * after an improvement is a commit with a reason, exactly as lowering a budget
 * limit is.
 *
 * The rounding is deliberate and it is not headroom-shaving: a Lighthouse score
 * is a sampled measurement of a real browser on a real machine, and the same
 * build scores within a point or two of itself run to run. A floor at the exact
 * first measurement would fail on noise, which is how a gate stops being read.
 *
 * ## What is measured, and the honest limit of it
 *
 * The assembled tree - `dist-demo`, after the docs are moved into it, which is
 * byte-for-byte what the deploy uploads - served over HTTP from localhost, with
 * Lighthouse's own simulated throttling on top. That is a lab measurement of
 * the artifact, not a field measurement of the deployment: it holds the network
 * constant on purpose, which is what makes it a gate rather than a weather
 * report. What it therefore cannot see is anything the host does - a missing
 * `Content-Encoding`, a slow TTFB, a redirect.
 *
 * `--url` is the other half, and the deploy workflow passes it: the same
 * analysis pointed at the published page. That number is recorded beside the
 * lab one rather than gating on it, because a CDN's cold cache is not a
 * regression in this repository.
 */
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, existsSync, statSync} from 'node:fs';
import {join, extname, dirname, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(ROOT, 'dist-demo');
const RECORD = join(ROOT, 'tools/lighthouse.json');

const update = process.argv.includes('--update');
const urlArgument = process.argv.find((argument) => argument.startsWith('--url='));

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.glb': 'model/gltf-binary',
	'.ktx2': 'image/ktx2',
	'.wasm': 'application/wasm',
};

/**
 * A static server for the assembled tree.
 *
 * Deliberately plain: no compression, no caching headers, no HTTP/2. Lighthouse
 * simulates the network on top of what it observes, so what matters here is
 * that the bytes and the request graph are the deployment's - and adding a
 * server's own opinions would make the number depend on this file.
 *
 * @returns {Promise<{origin: string, close: function(): Promise<void>}>}
 */
function serve()
{
	const server = createServer((request, response) =>
	{
		const path = decodeURIComponent((request.url || '/').split('?')[0]);
		// Normalised and re-anchored, so `..` cannot walk out of the tree.
		let file = join(TREE, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		if (existsSync(file) && statSync(file).isDirectory()) { file = join(file, 'index.html'); }
		if (!file.startsWith(TREE) || !existsSync(file))
		{
			response.writeHead(404).end('not found');
			return;
		}
		response.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream'});
		response.end(readFileSync(file));
	});

	return new Promise((resolve) =>
	{
		server.listen(0, '127.0.0.1', () =>
		{
			const {port} = /** @type {{port: number}} */ (server.address());
			resolve({
				origin: `http://127.0.0.1:${port}`,
				close: () => new Promise((done) => server.close(() => done(undefined))),
			});
		});
	});
}

/**
 * Run Lighthouse against one URL and return its performance category.
 *
 * Chromium comes from Playwright, which this repository already installs for
 * the browser test tier - so CI needs no second browser and no assumption that
 * the runner image ships Chrome. chrome-launcher still does the launching,
 * because Lighthouse talks to a debugging port rather than to a Playwright
 * session.
 */
async function measure(url)
{
	const [{default: lighthouse}, chromeLauncher, {chromium}] = await Promise.all([
		import('lighthouse'),
		import('chrome-launcher'),
		import('playwright'),
	]);

	const chrome = await chromeLauncher.launch({
		chromePath: chromium.executablePath(),
		chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
	});

	try
	{
		const result = await lighthouse(url, {
			port: chrome.port,
			output: 'json',
			logLevel: 'error',
			onlyCategories: ['performance'],
		});
		if (!result || !result.lhr) { throw new Error('Lighthouse returned no report'); }

		const {lhr} = result;
		if (lhr.runtimeError && lhr.runtimeError.code !== 'NO_ERROR')
		{
			throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
		}

		const audit = (id) => (lhr.audits[id] ? lhr.audits[id].numericValue : null);
		return {
			score: Math.round(lhr.categories.performance.score * 100),
			metrics: {
				'first-contentful-paint': audit('first-contentful-paint'),
				'largest-contentful-paint': audit('largest-contentful-paint'),
				'total-blocking-time': audit('total-blocking-time'),
				'cumulative-layout-shift': audit('cumulative-layout-shift'),
				'speed-index': audit('speed-index'),
			},
		};
	}
	finally
	{
		await chrome.kill();
	}
}

function readRecord()
{
	return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
}

function report(label, result)
{
	const ms = (value) => (value === null ? '     -' : `${Math.round(value)} ms`.padStart(8));
	console.log(`    ${label}: ${result.score}`);
	console.log(`      FCP ${ms(result.metrics['first-contentful-paint'])}`
		+ `   LCP ${ms(result.metrics['largest-contentful-paint'])}`
		+ `   TBT ${ms(result.metrics['total-blocking-time'])}`
		+ `   SI ${ms(result.metrics['speed-index'])}`
		+ `   CLS ${(result.metrics['cumulative-layout-shift'] ?? 0).toFixed(3)}`);
}

async function main()
{
	// A deployed page needs no tree and no server: it is somebody else's.
	if (urlArgument)
	{
		const url = urlArgument.slice('--url='.length);
		const result = await measure(url);
		console.log(`  Lighthouse   ${url}`);
		report('performance', result);
		// Reported, never gated. See the note at the top: a CDN's cold cache is
		// not a regression in this repository.
		return;
	}

	if (!existsSync(join(TREE, 'index.html')))
	{
		console.error('lighthouse:check needs an assembled tree.\n'
			+ '  npm run build:demo && npm run docs:build && mv docs/.vitepress/dist dist-demo/docs');
		process.exit(1);
	}

	const site = await serve();
	let result;
	try
	{
		result = await measure(`${site.origin}/index.html`);
	}
	finally
	{
		await site.close();
	}

	const record = readRecord();

	if (update)
	{
		const floor = record ? record.floor : Math.floor(result.score / 5) * 5;
		writeFileSync(RECORD, `${JSON.stringify({...record, floor, measured: result.score,
			metrics: result.metrics}, null, '\t')}\n`);
		console.log(`  Lighthouse   recorded ${result.score}, floor ${floor}`);
		report('performance', result);
		return;
	}

	if (!record)
	{
		console.error('there is no floor in tools/lighthouse.json.\n'
			+ '  npm run lighthouse:update  records the first measurement');
		process.exit(1);
	}

	console.log(`  Lighthouse   floor ${record.floor}`);
	report('performance', result);

	if (result.score < record.floor)
	{
		console.error(`\n  ✗ performance ${result.score} is below the floor of ${record.floor}.`
			+ '\n    The floor does not come down. See tools/lighthouse.json for what it is'
			+ '\n    and tools/check-lighthouse.mjs for why it works that way.');
		process.exit(1);
	}
	console.log(`  ✓ Lighthouse     performance ${result.score}  /  floor ${record.floor}`);
}

main().catch((error) =>
{
	console.error(`lighthouse:check could not run: ${error && error.message ? error.message : error}`);
	process.exit(1);
});
