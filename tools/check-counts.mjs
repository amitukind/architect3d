/**
 * The numbers this repository publishes about its own test suite (RM-020 AC-6).
 *
 *   npm run counts            re-measure and rewrite the claims
 *   npm run counts:check      verify the claims against the tree
 *
 * ## Why this exists
 *
 * `docs/public/roadmap.html` and `README.md` quote how many tests there are, in
 * five places, and every one of them was maintained by somebody remembering to
 * retype it. That worked exactly as well as it sounds: the count drifted in
 * four consecutive commits, and the coverage figure beside it in section 04 was
 * a whole sprint stale - 89.17 % of 13,683 statements against a tree measuring
 * 89.24 % of 13,745.
 *
 * This is the same failure the type ledger had five times before RM-005 C2 gave
 * it a parser, and the rule that came out of that one applies here without
 * modification: **a number is either produced by a command or checked by one.**
 * Prose is not a mechanism.
 *
 * ## Why it collects rather than runs
 *
 * `vitest list` walks every suite and reports what it WOULD run without
 * executing a single assertion - 2,749 headless in about eight seconds and 267
 * in the browser config in five, with no browser launched. That is cheap enough
 * to gate on, which a full run of both tiers is not.
 *
 * Coverage cannot be collected without running, so it is read from
 * `coverage/coverage-summary.json` instead - the same artefact
 * `tools/coverage-slack.mjs` reads, written by `npm run test:coverage`. When it
 * is absent the coverage claims are skipped and said to be skipped, because a
 * checker that silently passes on missing input is worse than one that is not
 * run at all.
 *
 * ## What it does NOT touch
 *
 * The `3,000` headline in section 04 is rewritten, rounded to the nearest
 * hundred, because it is a rounding OF these numbers. The `Measured on ...
 * against <hash>` line is left alone: that is a provenance stamp naming when and
 * where a measurement was taken, and a tool that advanced it on every run would
 * be forging exactly the thing it records.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROADMAP = join(ROOT, 'docs/public/roadmap.html');
const SUMMARY = join(ROOT, 'coverage/coverage-summary.json');
const CHECK = process.argv.includes('--check');

/** Thousands separators, the way every one of these documents writes them. */
const n = (value) => value.toLocaleString('en-US');

/**
 * Collect one tier without running it.
 *
 * `vitest list --json` prints the collected tests. The `prepare` lifecycle
 * script writes two `[INFO]` lines to stdout on the way past, so the payload is
 * found by its opening bracket on a line of its own rather than by the first
 * `[` in the stream - which is inside `[INFO]`.
 *
 * @param {string[]} extra Arguments selecting the config, if not the default.
 * @returns {{tests: number, files: number}}
 */
function collect(extra)
{
	const out = execFileSync('npx', ['vitest', 'list', '--json', ...extra],
		{cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024});
	const lines = out.split('\n');
	const start = lines.findIndex((line) => line.trim() === '[');
	if (start === -1) { throw new Error('vitest list produced no JSON array'); }
	const rows = JSON.parse(lines.slice(start).join('\n'));
	return {tests: rows.length, files: new Set(rows.map((row) => row.file)).size};
}

/** The statement line of section 04, from the artefact a coverage run leaves. */
function coverage()
{
	if (!existsSync(SUMMARY)) { return null; }
	const total = JSON.parse(readFileSync(SUMMARY, 'utf8')).total.statements;
	return {pct: total.pct, covered: total.covered, total: total.total};
}

/**
 * Every claim, as a rule that finds it and a replacement built from the
 * measurement. Named rather than pattern-hunted: a regex loose enough to find
 * an unknown number in prose is loose enough to rewrite one that means
 * something else.
 *
 * @param {{tests: number, files: number}} head
 * @param {{tests: number, files: number}} browser
 * @param {?{pct: number, covered: number, total: number}} cover
 */
function claims(head, browser, cover)
{
	const rounded = Math.round((head.tests + browser.tests) / 100) * 100;
	const list = [
		{
			what: 'section 01 summary',
			find: /(<dt class="mono">TESTS<\/dt><dd>)[\d,]+ \+ [\d,]+(<\/dd>)/,
			to: `$1${n(head.tests)} + ${n(browser.tests)}$2`,
		},
		{
			what: 'section 03 gate table',
			find: /(<td><code>npm run test:coverage<\/code><\/td><td>)[\d,]+( tests, and nineteen coverage floors)/,
			to: `$1${n(head.tests)}$2`,
		},
		{
			what: 'section 03 browser job',
			find: /(<strong>)[\d,]+ tests in [\d,]+ files(<\/strong>)/,
			to: `$1${n(browser.tests)} tests in ${n(browser.files)} files$2`,
		},
		{
			what: 'section 04 headline',
			find: /(<div class="v">)[\d,]+(<\/div><div class="l">tests &mdash; )[\d,]+( headless, )[\d,]+( in a browser<\/div>)/,
			to: `$1${n(rounded)}$2${n(head.tests)}$3${n(browser.tests)}$4`,
		},
	];
	if (cover)
	{
		list.push({
			what: 'section 04 coverage',
			find: /(<div class="v">)[\d.]+(&thinsp;%<\/div><div class="l">statements covered, )[\d,]+ of [\d,]+(<\/div>)/,
			to: `$1${cover.pct.toFixed(2)}$2${n(cover.covered)} of ${n(cover.total)}$3`,
		});
	}
	return list;
}

function main()
{
	const head = collect([]);
	const browser = collect(['--config', 'vitest.browser.config.mjs']);
	const cover = coverage();

	console.log(`\n  headless  ${n(head.tests)} tests in ${n(head.files)} files`);
	console.log(`  browser   ${n(browser.tests)} tests in ${n(browser.files)} files`);
	console.log(cover
		? `  coverage  ${cover.pct.toFixed(2)} % statements, ${n(cover.covered)} of ${n(cover.total)}`
		: '  coverage  SKIPPED - no coverage/coverage-summary.json, run `npm run test:coverage`');

	const before = readFileSync(ROADMAP, 'utf8');
	let after = before;
	const missing = [];
	for (const claim of claims(head, browser, cover))
	{
		if (!claim.find.test(after)) { missing.push(claim.what); continue; }
		after = after.replace(claim.find, claim.to);
	}

	if (missing.length)
	{
		// A claim that cannot be found is not a claim that is correct. The document
		// was edited into a shape this tool no longer recognises, and saying so is
		// the whole point of it existing.
		console.error(`\n  ✗ these claims are no longer where this tool looks:\n    ${missing.join('\n    ')}\n`);
		process.exit(1);
	}

	if (CHECK)
	{
		if (after !== before)
		{
			console.error('\n  ✗ docs/public/roadmap.html quotes counts the tree does not have.'
				+ ' Run `npm run counts`.\n');
			process.exit(1);
		}
		console.log('\n  ✓ every published count is the tree\'s.\n');
		return;
	}
	if (after === before)
	{
		console.log('\n  every published count was already right; nothing rewritten.\n');
		return;
	}
	writeFileSync(ROADMAP, after);
	console.log('\n  rewrote docs/public/roadmap.html\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
