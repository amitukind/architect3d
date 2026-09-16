/**
 * How the plan's frame budget (RM-008 T-4) is measured, in one place for the two
 * suites that gate on it.
 *
 * ## The budget is 2 ms on the machine the work is done on
 *
 * Every figure in the two suites' docblocks - 0.79, 1.10 to 1.29, 2.165 - was
 * taken on a developer machine, and 2 ms is a budget for that machine. The
 * first CI run to carry the 100-room fixtures measured 2.54 and 2.03 ms on a
 * shared ubuntu-latest runner, where the same tree measured 1.50 and 1.33
 * locally: the same code, about 1.7x slower hardware. A wall-clock gate that
 * does not say whose clock it is fails on the runner and not on a regression.
 *
 * So the runner gets a stated allowance: `vitest.browser.config.mjs` provides
 * `frameBudgetMs` as 2, or 4 when `CI` is set. It is 2x rather than the
 * 1.7x that was measured, because one run is not a distribution; a regression
 * that doubles the pass still fails in CI, and anything smaller fails at the
 * desk, which is where the budget was set and where it is meant to be read.
 *
 * ## The fastest block, not one block
 *
 * Noise on a shared machine only ever adds time - a draw cannot be made faster
 * by a neighbour - so the least of several blocks is the estimate closest to
 * what the code costs. One block was what these gates used to read, and it
 * leaves the verdict to whatever else the runner was doing in those 40 ms.
 */
import {inject} from 'vitest';

/** The per-draw budget in ms for wherever this is running. */
export const frameBudgetMs = () => inject('frameBudgetMs');

/**
 * Milliseconds per draw: warm up, then the fastest of `blocks` blocks of
 * `draws` draws.
 *
 * The warm-up is five blocks rather than one draw because the 400-wall fixture
 * measured 1.995, 1.73, 1.615, 1.51, 1.51 cold-to-warm - one warm draw left the
 * gate deciding on JIT rather than on anything in the repository.
 *
 * @param {() => void} draw
 * @param {{blocks?: number, draws?: number}} [options]
 * @returns {number}
 */
export function perDrawMs(draw, {blocks = 5, draws = 20} = {})
{
	for (let run = 0; run < 5 * draws; run++) { draw(); }

	let fastest = Infinity;
	for (let block = 0; block < blocks; block++)
	{
		const started = performance.now();
		for (let run = 0; run < draws; run++) { draw(); }
		fastest = Math.min(fastest, (performance.now() - started) / draws);
	}
	return fastest;
}
