/**
 * How far every coverage floor is from red, in units rather than in per cent
 * (RM-018 Q1, finding AD-4).
 *
 *   node tools/coverage-slack.mjs           print the table
 *   node tools/coverage-slack.mjs --json    the same as JSON
 *
 * ## Why a percentage is not enough to know where you stand
 *
 * A floor is a percentage and a report is a percentage, so the distance between
 * them looks like a percentage too - and on a small denominator that is a lie
 * of granularity. `src/app/tour` has ten branches. Eighty-five per cent of ten
 * is 8.5, and there is no such thing as 8.5 branches, so a floor WRITTEN as 85
 * is ENFORCED at 90 and the directory is one uncovered branch from failing a
 * threshold that says it has five points of room.
 *
 * What matters is `covered - ceil(floor x total)`: how many units can be lost
 * before the build goes red. That number is the same kind of thing for a
 * ten-branch directory and a thirteen-thousand-statement tree, and it is the
 * one this prints.
 *
 * ## What made it worth building
 *
 * The global statements floor had a slack of ZERO and nobody knew. N2 measured
 * 89.00 and rounded down to 89, which is the rule this repository has followed
 * for eleven programmes - and the rule is where the headroom normally comes
 * from, so against a measurement that is already a whole number it produced
 * none. The gate then failed seven times in twenty-one runs on an unchanged
 * tree. Q1 fixed the flake; this is what stops the next zero-slack floor from
 * being discovered the same way.
 *
 * ## Where the numbers come from
 *
 * The thresholds are IMPORTED from `vitest.config.mjs` rather than parsed out
 * of it, so this cannot disagree with what vitest enforces - the same reason
 * `cache_policy.js` reads the built `index.html` instead of a manifest. The
 * measurements come from `coverage/coverage-summary.json`, which is what CI
 * already produces and already prints from.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json');

/** The four a global threshold can name. */
const METRICS = ['statements', 'branches', 'functions', 'lines'];

/**
 * Whether a coverage-report path is inside a threshold glob.
 *
 * Deliberately understands exactly the three shapes `vitest.config.mjs` uses
 * and throws on anything else. A matcher that quietly returned false for a
 * shape it did not know would report a floor as unmatched, or worse as met, and
 * the whole point of this tool is that a floor's real position is not a thing
 * to guess at.
 *
 * @param {string} pattern
 * @param {string} path Repository-relative, forward slashes.
 * @returns {boolean}
 */
export function matchesGlob(pattern, path)
{
	if (pattern.endsWith('/**'))
	{
		return path.startsWith(pattern.slice(0, -2));
	}

	const flat = /^(.*)\/\*\.(?:\{([^}]+)\}|([A-Za-z0-9]+))$/.exec(pattern);
	if (flat)
	{
		const dir = flat[1] + '/';
		const extensions = (flat[2] ? flat[2].split(',') : [flat[3]]).map((e) => '.' + e.trim());
		if (!path.startsWith(dir)) { return false; }
		const rest = path.slice(dir.length);
		return !rest.includes('/') && extensions.some((e) => rest.endsWith(e));
	}

	throw new Error(`coverage-slack: unrecognised threshold glob "${pattern}". `
		+ 'Teach matchesGlob the shape rather than letting it answer false.');
}

/**
 * Units that can be lost before this floor fails.
 *
 * v8 reports a percentage rounded to two places and vitest compares that, but
 * the underlying question is integral: a floor of f % over n units needs
 * `ceil(f/100 * n)` of them covered.
 *
 * @param {number} covered
 * @param {number} total
 * @param {number} floor A percentage.
 * @returns {number}
 */
export function slackFor(covered, total, floor)
{
	if (!total) { return Infinity; }
	return covered - Math.ceil((floor / 100) * total);
}

/**
 * Every floor, with what it measures and how close it is.
 *
 * @param {Object} thresholds The `coverage.thresholds` object vitest enforces.
 * @param {Object} summary A `coverage-summary.json`.
 * @returns {Array<{scope: string, metric: string, covered: number, total: number, pct: number, floor: number, slack: number}>}
 */
export function floorsIn(thresholds, summary)
{
	const rows = [];
	const files = Object.keys(summary).filter((key) => key !== 'total');

	for (const metric of METRICS)
	{
		if (typeof thresholds[metric] !== 'number') { continue; }
		const t = summary.total[metric];
		rows.push({
			scope: 'GLOBAL', metric, covered: t.covered, total: t.total,
			pct: t.pct, floor: thresholds[metric],
			slack: slackFor(t.covered, t.total, thresholds[metric]),
		});
	}

	for (const [pattern, perGlob] of Object.entries(thresholds))
	{
		if (typeof perGlob !== 'object' || perGlob === null) { continue; }
		const matched = files.filter((key) => matchesGlob(pattern, relativeKey(key)));
		if (!matched.length)
		{
			throw new Error(`coverage-slack: threshold "${pattern}" matched no file in the report.`);
		}
		for (const metric of METRICS)
		{
			if (typeof perGlob[metric] !== 'number') { continue; }
			let covered = 0;
			let total = 0;
			for (const key of matched)
			{
				covered += summary[key][metric].covered;
				total += summary[key][metric].total;
			}
			rows.push({
				scope: pattern, metric, covered, total,
				pct: total ? (covered / total) * 100 : 100,
				floor: perGlob[metric], slack: slackFor(covered, total, perGlob[metric]),
			});
		}
	}

	return rows.sort((a, b) => a.slack - b.slack);
}

/**
 * The report's absolute paths, as this repository writes them.
 *
 * @param {string} key
 * @returns {string}
 */
function relativeKey(key)
{
	return relative(ROOT, key).split('\\').join('/');
}

/**
 * What a floor is really enforced at, given its denominator.
 *
 * @param {number} total
 * @param {number} floor
 * @returns {number}
 */
export function effectiveFloor(total, floor)
{
	if (!total) { return floor; }
	return (Math.ceil((floor / 100) * total) / total) * 100;
}

async function main()
{
	if (!existsSync(SUMMARY))
	{
		console.error('coverage-slack: no coverage/coverage-summary.json - run `npm run test:coverage` first.');
		process.exit(1);
	}

	const config = await import(pathToFileURL(join(ROOT, 'vitest.config.mjs')).href);
	const thresholds = config.default.test.coverage.thresholds;
	const summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
	const rows = floorsIn(thresholds, summary);

	if (process.argv.includes('--json'))
	{
		console.log(JSON.stringify(rows, null, 2));
		return;
	}

	const width = Math.max(...rows.map((r) => r.scope.length));
	console.log('');
	console.log(`  ${'floor'.padEnd(width)}  ${'metric'.padEnd(10)} ${'covered'.padStart(13)} ${'now'.padStart(7)} ${'written'.padStart(7)} ${'enforced'.padStart(8)} ${'slack'.padStart(6)}`);
	for (const r of rows)
	{
		const mark = r.slack <= 2 ? '!' : ' ';
		console.log(`${mark} ${r.scope.padEnd(width)}  ${r.metric.padEnd(10)} `
			+ `${(r.covered + '/' + r.total).padStart(13)} ${r.pct.toFixed(2).padStart(7)} `
			+ `${String(r.floor).padStart(7)} ${effectiveFloor(r.total, r.floor).toFixed(2).padStart(8)} `
			+ `${String(r.slack).padStart(6)}`);
	}

	const tight = rows.filter((r) => r.slack <= 2);
	console.log('');
	console.log(`  ${rows.length} floors. ${tight.length} within two units of red`
		+ (tight.length ? ': ' + tight.map((r) => `${r.scope} ${r.metric} (${r.slack})`).join(', ') : '')
		+ '.');
	console.log('  Slack is covered - ceil(floor x total): units that can be lost before the build goes red.');
	console.log('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
	await main();
}
