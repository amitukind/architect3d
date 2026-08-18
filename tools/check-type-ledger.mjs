/**
 * The NOT YET ceiling, which was prose until RM-005 C2 (tier 1).
 *
 *   npm run ledger:check
 *
 * ## Why this exists
 *
 * `tsconfig.json`'s ledger has said, since B3, that its NOT YET total "is
 * asserted as a CEILING instead: the tree may have fewer errors than recorded
 * and never more". `tests/type-coverage.test.js` asserts the CHECKED block
 * against the tree and the arithmetic of both blocks - and it does not run the
 * compiler, so the ceiling was never enforced by anything.
 *
 * Found the way the other four ledger drifts were found: by breaking something
 * and watching nothing fail. Removing `@types/three` takes the tree from 267
 * errors to 342, and every test in the suite stayed green.
 *
 * That is the fifth time in this file's history that a rule has been written
 * down without a mechanism behind it, so it gets one. A separate command rather
 * than a test, because it costs a full `vue-tsc --checkJs` pass - fifteen
 * seconds against a headless tier that runs in four - and because that is the
 * shape every other ratchet in `tools/` already has: `manifest:check`,
 * `encode:check`, `resize:check`, `repoint:check`.
 *
 * ## What it enforces, and what it deliberately does not
 *
 * A CEILING, not a pin. Fewer errors than the ledger records is a pass, and
 * that is the whole point: a ratchet that fails somebody for improving the tree
 * is worse than no ratchet, which is the reason B3 gave for leaving this number
 * out of the test file. What it catches is the opposite - a change that makes
 * the untyped half of the codebase worse, or one that quietly removes the
 * checker's ability to see it at all.
 *
 * It does not check the per-area rows. Those sum to the total, and the total is
 * checked here, so a row that drifts alone fails the arithmetic in
 * `tests/type-coverage.test.js` instead.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The ledger lives under the "//" key. tsconfig is JSONC; strip whole-line comments. */
function ledgerCeiling()
{
	const jsonc = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')
		.split('\n')
		.filter((line) => !/^\s*\/\//.test(line))
		.join('\n');
	const note = JSON.parse(jsonc)['//'].join('\n');
	const found = /NOT YET - (\d+) errors/.exec(note);
	if (!found)
	{
		console.error('tsconfig.json no longer records a NOT YET total.');
		process.exit(1);
	}
	return Number(found[1]);
}

function treeErrors()
{
	let output;
	try
	{
		output = execFileSync('npx', ['vue-tsc', '--noEmit', '--checkJs'], {cwd: ROOT, encoding: 'utf8'});
	}
	catch (error)
	{
		// vue-tsc exits non-zero when it finds anything, which is the normal case
		// here - the whole point is that the tree still has errors.
		output = (error.stdout || '') + (error.stderr || '');
	}
	return output.split('\n').filter((line) => / error TS\d+/.test(line)).length;
}

const ceiling = ledgerCeiling();
const actual = treeErrors();

console.log('');
if (actual > ceiling)
{
	console.error(`  ✗ Type ledger    ${actual} errors  /  ${ceiling} recorded  — ${actual - ceiling} more than the ledger allows`);
	console.error('');
	console.error('  Either fix them, or recount the ledger in tsconfig.json with a reason in the');
	console.error('  commit message. Do not increment it to make this pass.');
	console.error('');
	process.exit(1);
}

const headroom = ceiling - actual;
console.log(`  ✓ Type ledger    ${actual} errors  /  ${ceiling} recorded`
	+ (headroom ? `  (${headroom} fewer than recorded — recount the ledger)` : ''));
console.log('');
