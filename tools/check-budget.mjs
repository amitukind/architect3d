/**
 * Size budgets for the built output (RM-002 P1, tier 1).
 *
 *   node tools/check-budget.mjs            check, exit 1 on a breach
 *   node tools/check-budget.mjs --update   re-record the measurements
 *
 * ## Why
 *
 * The demo bundle reached 1.1 MB (305 KB gzipped) as a single chunk, and the
 * deployed tree reached 21 MB, without anybody deciding either number. Neither
 * is catastrophic and neither was noticed, which is the problem a budget fixes:
 * it does not make the bundle smaller, it makes growth a decision somebody has
 * to make on purpose.
 *
 * ## What is measured, and why gzip
 *
 * Gzip, not raw, for anything served as text - it is what the browser actually
 * downloads, and it is the number that moves when a dependency is added rather
 * than when a comment is written. Raw bytes for the asset trees, where the
 * content is already-compressed images and models and gzip would tell you
 * nothing.
 *
 * JS and CSS are summed across every file in the assets directory rather than
 * matched by name. Two reasons: the filenames are content-hashed, so there is
 * no stable name to match; and code splitting (RM-002 P6) will turn one chunk
 * into several, which must not read as a saving.
 *
 * ## The limits
 *
 * Committed in tools/budget.json beside the measurement they were derived
 * from, so a reviewer can see both the ceiling and the headroom. They are
 * deliberately not "measured + 5%" computed at runtime - a limit that moves
 * with the thing it limits is not a limit. Raising one is a commit, with a
 * reason, which is exactly the conversation the budget exists to force.
 */
import {gzipSync} from 'node:zlib';
import {readFileSync, writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join, extname} from 'node:path';

const BUDGET_FILE = 'tools/budget.json';
const update = process.argv.includes('--update');

/** Total bytes of every file under a directory, recursively. */
function treeBytes(dir)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const entry of readdirSync(dir, {withFileTypes: true}))
	{
		const path = join(dir, entry.name);
		total += entry.isDirectory() ? treeBytes(path) : statSync(path).size;
	}
	return total;
}

/** Gzipped bytes of every file in a directory with one of the given extensions. */
function gzipBytes(dir, extensions)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const name of readdirSync(dir))
	{
		if (extensions.includes(extname(name)))
		{
			total += gzipSync(readFileSync(join(dir, name)), {level: 9}).length;
		}
	}
	return total;
}

function gzipFile(path)
{
	return existsSync(path) ? gzipSync(readFileSync(path), {level: 9}).length : null;
}

/**
 * Every measurement, in the order they are reported.
 *
 * `needs` names the build that produces the input, so a missing directory
 * reports "run npm run build:demo" rather than a bare failure. A measurement
 * whose input is absent is skipped, not failed: `npm run budget` is useful
 * after one build without demanding all of them.
 */
const MEASUREMENTS = [
	{key: 'demo-js-gzip', label: 'Demo JS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.js'])},
	{key: 'demo-css-gzip', label: 'Demo CSS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.css'])},
	{key: 'demo-total', label: 'Deployed tree', needs: 'build:demo',
		measure: () => treeBytes('dist-demo')},
	{key: 'lib-iife-gzip', label: 'Library IIFE (gzip)', needs: 'build',
		measure: () => gzipFile('dist/bp3djs.js')},
	{key: 'public-total', label: 'Runtime assets', needs: null,
		measure: () => treeBytes('public')},
];

function human(bytes)
{
	if (bytes >= 1048576)
	{
		return (bytes / 1048576).toFixed(2) + ' MB';
	}
	return (bytes / 1024).toFixed(1) + ' KB';
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const rows = [];
let failures = 0;
let skipped = 0;

for (const item of MEASUREMENTS)
{
	const measured = item.measure();
	const entry = budget.budgets[item.key];

	if (!entry)
	{
		console.error(`No budget recorded for "${item.key}". Add it to ${BUDGET_FILE}.`);
		failures++;
		continue;
	}

	if (measured === null)
	{
		rows.push({label: item.label, status: 'skip', detail: `no output — run \`npm run ${item.needs}\``});
		skipped++;
		continue;
	}

	if (update)
	{
		entry.measured = measured;
	}

	const over = measured > entry.limit;
	const headroom = ((entry.limit - measured) / entry.limit) * 100;
	rows.push({
		label: item.label,
		status: over ? 'OVER' : 'ok',
		detail: `${human(measured).padStart(9)}  /  ${human(entry.limit).padStart(9)} limit` +
			(over
				? `  — over by ${human(measured - entry.limit)}`
				: `  (${headroom.toFixed(1)}% headroom)`),
	});
	if (over)
	{
		failures++;
	}
}

const width = Math.max(...rows.map((row) => row.label.length));
console.log('');
for (const row of rows)
{
	const mark = row.status === 'OVER' ? '✗' : (row.status === 'skip' ? '–' : '✓');
	console.log(`  ${mark} ${row.label.padEnd(width)}   ${row.detail}`);
}
console.log('');

if (update)
{
	writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + '\n');
	console.log(`Recorded current measurements in ${BUDGET_FILE}.`);
	console.log('Limits were NOT changed — edit them by hand, with a reason in the commit message.');
	process.exit(0);
}

if (skipped)
{
	console.log(`${skipped} measurement(s) skipped: their build output is not present.`);
}

if (failures)
{
	console.error(`Size budget exceeded by ${failures} measurement(s).`);
	console.error('Either make it smaller, or raise the limit in tools/budget.json deliberately.');
	process.exit(1);
}

console.log('Within budget.');
