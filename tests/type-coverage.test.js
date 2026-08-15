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
