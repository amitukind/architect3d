/**
 * The supply chain a consumer inherits, asserted rather than described
 * (RM-018 Q3, finding AD-9, metric M-62).
 *
 * RM-002 section 13 listed *no dependency policy* as one of thirteen gaps and
 * it stayed open through eleven programmes, which is fair enough - it is the
 * lowest-severity row in that table and this project has no server to attack.
 * What Q3 measured is that the position it describes is unusually good and
 * entirely unrecorded: **zero runtime dependencies**, two peer dependencies the
 * consumer chooses the versions of, and 35 development dependencies none of
 * which are published.
 *
 * A policy in prose is a policy that drifts. `SECURITY.md` says these things in
 * words; this file is what stops them from quietly stopping being true, and it
 * costs nothing because the headless suite already runs on every commit. It is
 * config rather than a new gate for the same reason M-57 was - see the note in
 * `vitest.config.mjs`.
 *
 * The point is not that a dependency may never be added. It is that adding one
 * fails a test whose name says what is being given up, so the decision happens
 * where somebody can see it rather than inside a merge.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

describe('M-62 - what a consumer installs', () =>
{
	it('has no runtime dependencies at all', () =>
	{
		// `npm install architect3d` adds this package and nothing else. Adding a
		// runtime dependency is a real decision - it lands in every consumer's
		// tree, it is audited by their tooling, and it is theirs to update - so
		// it fails here first and gets a line in SECURITY.md.
		expect(manifest.dependencies || {}).toEqual({});
		expect(manifest.optionalDependencies || {}).toEqual({});
	});

	it('takes three and bezier-js as peers, not as dependencies', () =>
	{
		// Peers because two copies of three in one page is a failure this project
		// has already had: before S4 the bundle carried three full engines from
		// repackaged loaders, and `instanceof` silently failed across the seam.
		expect(Object.keys(manifest.peerDependencies).sort()).toEqual(['bezier-js', 'three']);
		expect(manifest.peerDependencies.three).toMatch(/^>=/);
	});

	it('publishes an allowlist, and nothing from the toolchain is on it', () =>
	{
		// `files` is an allowlist rather than an ignore list, which is the safer
		// direction: a new directory is excluded until somebody adds it. What
		// this checks is that nothing on the list is toolchain.
		expect(Array.isArray(manifest.files)).toBe(true);
		for (const entry of manifest.files)
		{
			expect(entry, `${entry} would publish part of the toolchain`)
				.not.toMatch(/^(tools|tests|node_modules|docs|asset-pipeline|public)\b/);
		}
		// And that everything on it exists, so a rename cannot silently publish
		// less than the manifest claims.
		for (const entry of manifest.files.filter((name) => !name.startsWith('dist/')))
		{
			expect(existsSync(entry), `${entry} is in "files" and is not in the tree`).toBe(true);
		}
	});
});

describe('M-62 - the advisory position', () =>
{
	it('keeps the one override that takes VitePress off a vulnerable vite', () =>
	{
		// RM-006 drove this tree to zero advisories, and the three that were open
		// were all reachable only through VitePress asking for vite ^5.4.14. The
		// override is what closes them; deleting it during a dependency bump is
		// exactly the drift that took the type ledger and the transcode oracle,
		// and `npm audit --audit-level=low` in CI is what would catch it - a day
		// later, on another branch. This catches it here.
		expect(manifest.overrides).toEqual({vitepress: {vite: expect.stringMatching(/^\^6\./)}});
	});

	it('says all of this somewhere a person can read it', () =>
	{
		// GitHub surfaces SECURITY.md in the repository's security tab and in the
		// "report a vulnerability" flow. A policy nobody can find is not one.
		expect(existsSync('SECURITY.md'), 'no SECURITY.md').toBe(true);
		const policy = readFileSync('SECURITY.md', 'utf8');
		expect(policy).toMatch(/Zero runtime dependencies/);
		expect(policy).toMatch(/security\/advisories\/new/);
	});
});
