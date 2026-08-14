/**
 * Install the git hooks declared in package.json (RM-002 P1, tier 0).
 *
 * Run from `prepare`, so a fresh clone gets the pre-commit hook the first time
 * anybody runs `npm install` and nobody has to remember a setup step. That is
 * the whole point of tier 0: the check has to be there by default, because the
 * failure it catches is the one you make when you are not thinking about it.
 *
 * ## Why this file exists rather than `"prepare": "simple-git-hooks"`
 *
 * Two cases where installing hooks is wrong, and both are silent if unguarded:
 *
 *   CI            `npm ci` runs `prepare` too. Writing .git/hooks on a runner
 *                 that will make exactly zero commits is pointless, and a
 *                 failure there would fail the install step for no reason.
 *
 *   No git dir    Installing from a tarball, or a vendored copy inside another
 *                 repo, has no .git to write to. simple-git-hooks exits
 *                 non-zero, which would break `npm install` for a consumer who
 *                 never asked for our hooks.
 *
 * Both are skips, not errors. A developer who wants hooks anyway can always run
 * `npx simple-git-hooks` by hand.
 */
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// GitHub Actions sets CI=true, as does every other runner worth naming.
if (process.env.CI)
{
	console.log('install-hooks: CI detected, skipping git hooks.');
	process.exit(0);
}

if (!existsSync('.git'))
{
	console.log('install-hooks: no .git directory, skipping git hooks.');
	process.exit(0);
}

const result = spawnSync('npx', ['simple-git-hooks'], {stdio: 'inherit', shell: process.platform === 'win32'});

if (result.status !== 0)
{
	// Still not fatal. A missing hook is a degraded local setup, not a broken
	// install - and failing here would block `npm install` itself.
	console.warn('install-hooks: could not install git hooks; run `npx simple-git-hooks` by hand.');
}
