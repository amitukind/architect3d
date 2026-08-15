/**
 * The type-check opt-in is a ratchet, and this is what makes it one (RM-004 B3).
 *
 * ## Why a test and not a note
 *
 * `checkJs` is off, so a file is only checked if it says `// @ts-check`. That
 * makes the pragma the whole of the protection — and a pragma is one line
 * anybody can delete, at which point `npm run typecheck` goes quiet about that
 * file and nothing anywhere says so.
 *
 * Found by a deliberate break that was *supposed* to fail and did not. Removing
 * `AppTip.vue`'s pragma and reintroducing the error it had before gave a clean
 * typecheck: 0 errors, in a file with a type error in it. That is the failure
 * mode this file exists to make impossible.
 *
 * ## What it does not do
 *
 * It does not assert a count of remaining errors anywhere else. The library's
 * 356 are laid out per area in `tsconfig.json` with the command that produces
 * them, and pinning that number here would mean editing a test every time
 * somebody improved something — a ratchet that punishes progress is worse than
 * none. The claim here is narrower and permanent: **an area that has reached
 * zero stays opted in.**
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative, sep} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} directory @param {RegExp} match @returns {string[]} */
function walk(directory, match)
{
	/** @type {string[]} */
	const out = [];
	for (const entry of readdirSync(directory).sort())
	{
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) { out.push(...walk(full, match)); }
		else if (match.test(entry)) { out.push(relative(ROOT, full).split(sep).join('/')); }
	}
	return out;
}

const has = (file) => readFileSync(join(ROOT, file), 'utf8').includes('@ts-check');

describe('every area that reached zero stays opted in (RM-004 B3)', () =>
{
	it('every single-file component is checked', () =>
	{
		// B3 took src/app from 60 errors to none. Every SFC carries the pragma,
		// and every SFC has to keep carrying it or the zero means nothing.
		const components = walk(join(ROOT, 'src/app'), /\.vue$/);
		expect(components.length).toBeGreaterThan(20);
		expect(components.filter((file) => !has(file))).toEqual([]);
	});

	it('every composable is checked', () =>
	{
		const composables = walk(join(ROOT, 'src/app/composables'), /\.js$/);
		expect(composables.length).toBeGreaterThan(15);
		expect(composables.filter((file) => !has(file))).toEqual([]);
	});

	it('the whole of src/scripts/core is checked', () =>
	{
		// `core` is the one library directory the ledger claims outright, and the
		// claim has to survive a file being added to it — which is how it broke
		// before: A4 moved render_profile.js in and it had never carried a pragma.
		const core = walk(join(ROOT, 'src/scripts/core'), /\.js$/);
		expect(core.length).toBeGreaterThan(15);
		expect(core.filter((file) => !has(file))).toEqual([]);
	});

	it('the whole of src/app/persistence is checked', () =>
	{
		const persistence = walk(join(ROOT, 'src/app/persistence'), /\.js$/);
		expect(persistence.length).toBeGreaterThan(1);
		expect(persistence.filter((file) => !has(file))).toEqual([]);
	});

	it('the public entry point is checked', () =>
	{
		expect(has('src/scripts/blueprint.js')).toBe(true);
	});

	it('no file was opted OUT to make the check pass', () =>
	{
		// `@ts-nocheck` in a file that also says `@ts-check` is a way to look
		// protected while not being. Neither exists today and neither should
		// arrive quietly.
		const sources = [
			...walk(join(ROOT, 'src/app'), /\.(js|vue)$/),
			...walk(join(ROOT, 'src/scripts'), /\.js$/),
		];
		const optedOut = sources.filter((file) => readFileSync(join(ROOT, file), 'utf8').includes('@ts-nocheck'));
		expect(optedOut).toEqual([]);
	});

	it('the ledger in tsconfig.json describes this tree', () =>
	{
		// ## Why a test and not a rule
		//
		// The rule existed. B3 rewrote the ledger with the shell command beside
		// every number under a heading reading RECOUNT, DO NOT INCREMENT, and it
		// drifted again in the very next sprint - B5 added
		// `src/scripts/core/texture_formats.js` and neither the directory count
		// nor the total moved. That is the fourth drift, and the third different
		// person-shaped reason: nobody adding a file is thinking about a comment
		// in tsconfig.
		//
		// The counts are parsed out of the note rather than duplicated here, so
		// there is still exactly one place the numbers live.
		// tsconfig is JSONC. Only whole-line comments are stripped, so a `//`
		// inside a string - a URL in the note, say - survives untouched.
		const jsonc = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
			.split('\n')
			.filter((line) => !/^\s*\/\//.test(line))
			.join('\n');
		// The ledger lives under the "//" key, which is the convention tsc
		// accepts for a comment that has to survive a JSON parse.
		const note = JSON.parse(jsonc)['//'].join('\n');

		const checkedTotal = Number(/CHECKED - (\d+) files/.exec(note)[1]);
		const actualChecked = walk(join(ROOT, 'src'), /\.(js|vue)$/).filter(has).length;
		expect(actualChecked, 'the CHECKED total in tsconfig.json is stale').toBe(checkedTotal);

		// Each area the ledger itemises, checked against the directory it names.
		const AREAS = {
			'src/app': {directory: 'src/app', match: /\.vue$/},
			'src/scripts/core': {directory: 'src/scripts/core', match: /\.js$/},
			'src/app/composables': {directory: 'src/app/composables', match: /\.js$/},
			'src/app/persistence': {directory: 'src/app/persistence', match: /\.js$/},
		};
		for (const [area, {directory, match}] of Object.entries(AREAS))
		{
			// `      21  src/scripts/core the whole directory`
			const claimed = new RegExp('^\\s*(\\d+)\\s+' + area.replace(/\//g, '\\/') + '\\s', 'm').exec(note);
			expect(claimed, `tsconfig.json no longer itemises ${area}`).toBeTruthy();
			expect(walk(join(ROOT, directory), match).length, `${area} count is stale`).toBe(Number(claimed[1]));
		}

		// ## Both blocks, and by heading rather than by position
		//
		// This used to sum `itemised.slice(0, 7)` - the first seven numbered rows,
		// which happen to be the CHECKED ones. It was right by arithmetic accident:
		// add one CHECKED area and the slice silently drops it and picks up the
		// first NOT YET row instead, and the test goes on passing about as often as
		// not. A constant that has to be edited whenever the data grows is the same
		// species of bug as the ledger drift this file exists to catch.
		//
		// And it never looked at NOT YET at all, which is how the FIFTH drift got
		// in - in `b596fd8`, the very commit that added this test. That commit
		// wrote `NOT YET - 355`, explained in its own prose that `src/app/main.js`
		// had gone to zero, and left the `1  src/app/main.js` row in place. Its
		// rows summed to 356 under a heading saying 355, and nothing failed.
		//
		// The NOT YET total is still asserted as a CEILING elsewhere rather than
		// pinned - improving the tree must not fail the build - but a ledger whose
		// parts do not add up to its own stated total is a comment, and that is
		// checkable without running the compiler.
		// A block is its heading, then the indented rows, then a blank line. Read
		// that way rather than by scanning for the next heading, because the thing
		// after the rows is prose - the shell command that regenerates them - and
		// prose is not a shape worth pattern-matching against.
		const rowsUnder = (heading) =>
		{
			const start = note.indexOf(heading);
			expect(start, `the ledger no longer has a ${heading} block`).toBeGreaterThan(-1);
			/** @type {number[]} */
			const rows = [];
			for (const line of note.slice(start).split('\n').slice(1))
			{
				const row = /^\s*(\d+)\s+src\/[\w./-]+/.exec(line);
				if (row) { rows.push(Number(row[1])); continue; }
				if (rows.length && !line.trim()) { break; }
			}
			return rows;
		};

		const checkedRows = rowsUnder('CHECKED - ');
		expect(checkedRows.length, 'the CHECKED block itemises nothing').toBeGreaterThan(0);
		expect(checkedRows.reduce((total, n) => total + n, 0),
			'the CHECKED itemisation does not sum to its own total').toBe(checkedTotal);

		const notYetTotal = Number(/NOT YET - (\d+) errors/.exec(note)[1]);
		const notYetRows = rowsUnder('NOT YET - ');
		expect(notYetRows.reduce((total, n) => total + n, 0),
			'the NOT YET itemisation does not sum to its own total').toBe(notYetTotal);
	});

	it('counts the suppressions, so they can only go down', () =>
	{
		// Seven, all of them RM-002 P2's, each pinning a preserved-bug arity in
		// core/utils.js that the library depends on. B3 added none. A number that
		// is asserted is a number somebody has to argue for before raising.
		const sources = walk(join(ROOT, 'src/scripts'), /\.js$/).concat(walk(join(ROOT, 'src/app'), /\.(js|vue)$/));
		let suppressions = 0;
		const files = new Set();
		for (const file of sources)
		{
			const matches = readFileSync(join(ROOT, file), 'utf8').match(/^\s*\/\/ @ts-(ignore|expect-error)/gm);
			if (matches) { suppressions += matches.length; files.add(file); }
		}
		expect(suppressions).toBeLessThanOrEqual(4);
		expect([...files]).toEqual(['src/scripts/core/utils.js']);
	});
});
