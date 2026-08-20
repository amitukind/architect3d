/**
 * A performance score somebody else chose the definition of (RM-015 M3, M-53).
 *
 *   node tools/check-lighthouse.mjs            check, exit 1 below either floor
 *   node tools/check-lighthouse.mjs --update   record the measurements
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
 * ## Two presets, and why neither one is enough (RM-016 N1, finding AB-1)
 *
 * M3 added this gate and did not look at its configuration. Lighthouse's
 * default emulates a mid-range phone: a 4x CPU slowdown, a 1.6 Mbps link with
 * 150 ms of latency, and a 412x823 viewport. This application's audience was
 * fixed as **web desktop only** by RM-007 rev B, which withdrew a 2.5-week
 * phone-and-tablet sprint in order to make the decision explicit - so for one
 * sprint the only gate in this repository that measures the product from
 * outside was measuring a device the product declines to support.
 *
 * AB-1 measured both, one build, one machine, one server:
 *
 *     desktop   91   FCP 1,094 ms   LCP 1,215 ms   TBT   0 ms
 *     mobile    62   FCP 5,988 ms   LCP 6,439 ms   TBT  87 ms
 *
 * The obvious fix is to swap one for the other, and it is wrong. **Desktop is
 * the audience** and belongs in the gate. But its total blocking time is
 * **0 ms**, which means it carries no signal at all on the metric most
 * sensitive to a javascript regression - a build that doubled its main-thread
 * work would still read 0. The mobile run has 87 ms of it, and a phone is
 * simply a slow computer: what it exaggerates is real, it is just not what a
 * user of this product experiences.
 *
 * So both run and both hold a floor. Desktop is the product's promise; mobile
 * is the sensitive instrument. Neither is deleted to make the other look
 * better.
 *
 * ## The floors work like coverage floors, not like budget limits
 *
 * First measurement, rounded down, and never lowered. A budget limit is a
 * ceiling with headroom above the measurement; this is a floor with headroom
 * below it, because the failure direction is the other way round. Raising one
 * after an improvement is a commit with a reason, exactly as lowering a budget
 * limit is.
 *
 * The rounding is deliberate and it is not headroom-shaving: a Lighthouse score
 * is a sampled measurement of a real browser on a real machine, and the same
 * build scores within a point or two of itself run to run - measured, three
 * runs of one build at M3: 62, 62, 61. A floor at the exact first measurement
 * would fail on noise, which is how a gate stops being read.
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

/**
 * Written into tools/lighthouse.json so the file explains itself where it is
 * read, the way tools/budget.json's `note` does.
 */
const NOTE = [
	'Lighthouse performance floors. Checked by `npm run lighthouse:check`, enforced in CI.',
	'',
	'TWO PRESETS, TWO FLOORS, AND BOTH GATE (RM-016 N1, finding AB-1).',
	'',
	'`desktop` is the audience. RM-007 rev B fixed it as web desktop only and withdrew',
	'a 2.5-week phone-and-tablet sprint to make the decision explicit, so this is the',
	'number that describes what a user of this product actually waits for.',
	'',
	'`mobile` is Lighthouse\'s default and is kept because it is the sensitive one. The',
	'desktop run measures 0 ms of total blocking time and would keep measuring 0 ms',
	'after a regression that doubled the main-thread work; the mobile run measures 87.',
	'A phone is a slow computer, and what it exaggerates is real even where nobody',
	'runs it.',
	'',
	'A floor is the largest multiple of 5 leaving at least two points of margin below',
	'the first measurement, and it is never lowered - a coverage floor\'s contract, not',
	'a budget limit\'s, because the failure direction is the other way round. Raising',
	'one after a real improvement is a commit with a reason.',
	'',
	'The margin is not headroom-shaving, it is the sampling spread. Measured across',
	'runs of one build: desktop 96, 96, 96, 95; mobile 62, 62, 63, 62, 61. M3 wrote the',
	'rule as "rounded down to the nearest 5", which gives 60 for mobile - right - and',
	'95 for desktop, which one run in four would have touched. A floor a green build',
	'reaches is a red mark somebody learns to re-run rather than read.',
	'',
	'`measured` is refreshed by `npm run lighthouse:update`; that command deliberately',
	'does NOT touch a floor that already exists.',
];

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
 * The two device profiles, in the order they are reported.
 *
 * `desktop` is Lighthouse's own preset, imported rather than copied: it is a
 * throttling table and a viewport that upstream changes from time to time, and
 * a hand-transcribed copy of it would drift silently into measuring a machine
 * that no longer matches what anybody else calls desktop.
 *
 * `mobile` is the default, which is why its entry is empty.
 */
const PRESETS = [
	{key: 'desktop', label: 'desktop  (the audience)', gate: true},
	{key: 'mobile', label: 'mobile   (the sensitive one)', gate: true},
];

/**
 * Run Lighthouse against one URL on both device profiles.
 *
 * Chromium comes from Playwright, which this repository already installs for
 * the browser test tier - so CI needs no second browser and no assumption that
 * the runner image ships Chrome. chrome-launcher still does the launching,
 * because Lighthouse talks to a debugging port rather than to a Playwright
 * session.
 *
 * One browser for both runs, and Lighthouse clears its own state between them:
 * two launches would double the slowest part of this gate for no benefit, and
 * the point of running them together is that the only difference between the
 * two numbers is the emulation.
 *
 * @param {string} url
 * @returns {Promise<Object<string, {score: number, metrics: Object}>>}
 */
async function measure(url)
{
	const [{default: lighthouse}, {default: desktopConfig}, chromeLauncher, {chromium}] = await Promise.all([
		import('lighthouse'),
		import('lighthouse/core/config/desktop-config.js'),
		import('chrome-launcher'),
		import('playwright'),
	]);

	const chrome = await chromeLauncher.launch({
		chromePath: chromium.executablePath(),
		chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
	});

	try
	{
		const results = {};
		for (const preset of PRESETS)
		{
			const result = await lighthouse(url, {
				port: chrome.port,
				output: 'json',
				logLevel: 'error',
				onlyCategories: ['performance'],
			}, preset.key === 'desktop' ? desktopConfig : undefined);
			if (!result || !result.lhr) { throw new Error(`Lighthouse returned no ${preset.key} report`); }

			const {lhr} = result;
			if (lhr.runtimeError && lhr.runtimeError.code !== 'NO_ERROR')
			{
				throw new Error(`${preset.key}: ${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
			}

			const audit = (id) => (lhr.audits[id] ? lhr.audits[id].numericValue : null);
			results[preset.key] = {
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
		return results;
	}
	finally
	{
		await chrome.kill();
	}
}

/**
 * The floor for a first measurement: the largest multiple of five that leaves
 * at least two points of margin.
 *
 * M3 wrote "rounded down to the nearest 5" and that was the rule being applied
 * rather than the rule that was needed. It works for a score of 62 - the floor
 * lands on 60, two points clear, and three runs of that build measured 62, 62
 * and 61. It fails for a score of 96: the nearest 5 below is 95, and four runs
 * of this build measured 96, 96, 96, 95. A floor a build touches on one run in
 * four is a red mark somebody learns to re-run rather than read.
 *
 * So the margin is stated instead of hoped for. Note what this rule does NOT
 * do: it reproduces the existing mobile floor of 60 exactly, which is how it is
 * known to be a description of the practice rather than a number invented to
 * make today's measurement comfortable.
 *
 * @param {number} measured
 * @returns {number}
 */
function floorFor(measured)
{
	return Math.floor((measured - 2) / 5) * 5;
}

function readRecord()
{
	return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
}

function report(label, result)
{
	const ms = (value) => (value === null ? '     -' : `${Math.round(value)} ms`.padStart(8));
	console.log(`    ${label}`);
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
		const results = await measure(url);
		console.log(`  Lighthouse   ${url}`);
		for (const preset of PRESETS) { report(preset.label, results[preset.key]); }
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
	let results;
	try
	{
		results = await measure(`${site.origin}/index.html`);
	}
	finally
	{
		await site.close();
	}

	const record = readRecord();

	if (update)
	{
		const next = {};
		for (const preset of PRESETS)
		{
			const measured = results[preset.key].score;
			const existing = record && record[preset.key];
			// An existing floor is never recomputed. `--update` refreshes what was
			// measured; moving a floor is a hand edit with a reason, which is the
			// same contract `budget:update` has with its limits.
			next[preset.key] = {
				floor: existing ? existing.floor : floorFor(measured),
				measured,
				metrics: results[preset.key].metrics,
			};
		}
		writeFileSync(RECORD, `${JSON.stringify({note: NOTE, ...next}, null, '\t')}\n`);
		console.log('  Lighthouse   recorded');
		for (const preset of PRESETS)
		{
			console.log(`    ${preset.label}  ${next[preset.key].measured}, floor ${next[preset.key].floor}`);
			report(preset.label, results[preset.key]);
		}
		return;
	}

	if (!record || PRESETS.some((preset) => !record[preset.key]))
	{
		console.error('tools/lighthouse.json has no floor for every preset.\n'
			+ '  npm run lighthouse:update  records the first measurement');
		process.exit(1);
	}

	const failures = [];
	for (const preset of PRESETS)
	{
		const {score} = results[preset.key];
		const {floor} = record[preset.key];
		report(`${preset.label}  ${String(score).padStart(3)}  / floor ${floor}`, results[preset.key]);
		if (preset.gate && score < floor)
		{
			failures.push(`${preset.key} scored ${score} against a floor of ${floor}`);
		}
	}

	if (failures.length)
	{
		console.error(`\n  ✗ ${failures.join('\n  ✗ ')}.`
			+ '\n    Neither floor comes down. See tools/lighthouse.json for what they are'
			+ '\n    and tools/check-lighthouse.mjs for why there are two of them.');
		process.exit(1);
	}
	console.log(`  ✓ Lighthouse     desktop ${results.desktop.score} / ${record.desktop.floor}`
		+ `   mobile ${results.mobile.score} / ${record.mobile.floor}`);
}

main().catch((error) =>
{
	console.error(`lighthouse:check could not run: ${error && error.message ? error.message : error}`);
	process.exit(1);
});
