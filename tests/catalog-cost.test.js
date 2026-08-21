// @vitest-environment node
/**
 * M-45: what every item costs, and what the ceiling was divided into (J2).
 *
 * ## Why a raise needs a test and not just a note
 *
 * J2's first task was a decision - `public-total` and `demo-total` to 1.5x -
 * and its acceptance gate says the raise must state *the item count it buys*.
 * A count is a division, and a division is only true while its divisor is. The
 * divisor here is the catalog's measured mean, and it has already moved once
 * without anybody deciding to: RM-012 X-2 took the decision's arithmetic against
 * 26,105 bytes an item, and J1's rendered thumbnails made it 27,997.
 *
 * So two things are asserted. That the recorded costs are the tree's, which is
 * the ordinary generated-report gate. And that **the headroom still buys what
 * the decision said it buys** - if a later sprint makes items dearer, this fails
 * and the arithmetic gets re-taken rather than quietly becoming wrong.
 *
 * ## Deduped two ways, because they answer two questions
 *
 * Within an item, a texture used twice is one download. Across the catalog, a
 * texture used by two items is one file on a disk. The first is what a person
 * pays for a chair and the second is what the tree grows by, and only the second
 * belongs in the division above.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {catalogCost, filesFor} from '../tools/catalog-cost.mjs';

const ROOT = process.cwd();
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/catalog-cost.json'), 'utf8'));
const BUDGET = JSON.parse(readFileSync(join(ROOT, 'tools/budget.json'), 'utf8'));

describe('the catalog cost report is the tree (M-45)', () =>
{
	it('has a row per catalog entry, and every file it names exists', () =>
	{
		expect(REPORT.items).toHaveLength(CATALOG.items.length);
		const byModel = new Map(REPORT.items.map((row) => [row.model, row]));

		CATALOG.items.forEach((item) =>
		{
			const row = byModel.get(item.model);
			expect(row, item.name).toBeTruthy();
			expect(row.name).toBe(item.name);

			const files = filesFor(item, ROOT);
			expect(row.files, item.name).toBe(files.length);
			expect(row.bytes, item.name).toBe(files.reduce(
				(sum, file) => sum + statSync(join(ROOT, 'public', file)).size, 0));
			// At minimum a model and a thumbnail. A row naming neither would be
			// counted at zero and would quietly pull the mean down.
			expect(files.length, item.name).toBeGreaterThanOrEqual(2);
			files.forEach((file) => expect(existsSync(join(ROOT, 'public', file)), file).toBe(true));
		});
	});

	it('recomputes to the totals it recorded', () =>
	{
		expect(catalogCost(CATALOG, ROOT).totals).toEqual(REPORT.totals);
	});

	it('counts a shared file once across the catalog and once within an item', () =>
	{
		// The two figures differ by exactly the sharing there is. Today that is
		// small - 147 of the 168 models carry no external image at all - and the
		// gap is worth watching rather than fixing: a pack of variants on one
		// texture set would open it wide, and then the naive figure would overstate
		// what admitting that pack costs the tree.
		expect(REPORT.totals.naive).toBeGreaterThan(REPORT.totals.deduped);
		expect(REPORT.totals.naive / REPORT.totals.deduped).toBeLessThan(1.5);
		expect(REPORT.totals.mean).toBe(Math.round(REPORT.totals.deduped / REPORT.totals.count));
	});

	it('says out loud that the mean is carried by a tail', () =>
	{
		// The reason X-2 called curation the lever. If these two ever converge, a
		// pack can be admitted on its name; while they do not, it has to be
		// admitted on its measured mean.
		expect(REPORT.totals.median).toBeLessThan(REPORT.totals.mean);
		expect(REPORT.totals.largest).toBeGreaterThan(REPORT.totals.p90);
	});
});

describe('the deploy-size decision still buys what it said (J2 task one)', () =>
{
	it('was taken at 1.5x, on both lines', () =>
	{
		// Recorded rather than inferred: the note in tools/budget.json states the
		// decision and this states the shape of it, so a later raise that does not
		// mean to be 1.5x has to change both.
		expect(BUDGET.budgets['public-total'].limit).toBe(16770000);
		expect(BUDGET.budgets['demo-total'].limit).toBe(29985000);
		expect(BUDGET.note.join('\n')).toContain('THE DEPLOY-SIZE DECISION');
	});

	it('still buys 400-600 items if a pack is curated, and fewer if it is not', () =>
	{
		const headroom = BUDGET.budgets['public-total'].limit - BUDGET.budgets['public-total'].measured;
		const atMean = Math.floor(headroom / REPORT.totals.mean);
		const atMedian = Math.floor(headroom / REPORT.totals.median);

		// The whole content of the decision, as arithmetic. RM-007 wants 400-600 in
		// the catalog, so what has to fit is what is not here yet - taken from the
		// live count rather than from 232 and 432, which were the figures when the
		// catalog had 168 rows and needed an edit the first time it did not.
		const forLow = 400 - REPORT.totals.count;
		const forHigh = 600 - REPORT.totals.count;

		// Curated to the median, the lower figure fits. Bought at the mean it does
		// not, which is the pressure the ceiling was chosen to apply rather than a
		// shortfall in it.
		expect(atMedian, `${atMedian} items at the median`).toBeGreaterThanOrEqual(forLow);
		expect(atMean, `${atMean} items at the mean`).toBeLessThan(forHigh);

		// And it is not so loose that it stops being an instrument: 2.0x would have
		// bought the whole range at the mean, which is X-2's warning about a
		// ceiling with the growth pre-authorised inside it.
		expect(atMean, 'the ceiling should still refuse an uncurated 600').toBeLessThan(forHigh);
	});

	/**
	 * What the first acquisition did to the divisor, which is M-45's whole job.
	 *
	 * The mean fell and the median rose, and both are the same fact seen twice.
	 * The Food Kit's 51 models share one 10,715-byte colour atlas: counted once
	 * across the pack it is nearly free, so the deduped mean fell 27,995 ->
	 * 24,096; charged to each row that names it, it is most of a small model, so
	 * the median rose 11,218 -> 14,013.
	 *
	 * The consequence is worth an assertion rather than a note, because it is the
	 * first time the ceiling has got measurably harder to reach: **600 at the
	 * median is now just out of reach** - 371 affordable against 383 needed -
	 * where before the acquisition it was comfortable. Nothing is over budget and
	 * nothing has to change today. What must not happen is that it stops being
	 * true quietly.
	 */
	it('records that the first acquisition put 600 just out of reach at the median', () =>
	{
		const headroom = BUDGET.budgets['public-total'].limit - BUDGET.budgets['public-total'].measured;
		const atMedian = Math.floor(headroom / REPORT.totals.median);
		const forHigh = 600 - REPORT.totals.count;

		expect(REPORT.totals.median).toBeGreaterThan(11218);
		expect(REPORT.totals.mean).toBeLessThan(27995);
		// Within 10 % of reaching it, which is the difference between "curate the
		// next pack a little harder" and "the ceiling was wrong".
		expect(atMedian).toBeLessThan(forHigh);
		expect(atMedian / forHigh).toBeGreaterThan(0.9);
	});

	it('and the report performs the same division, so a reader does not have to (RM-020 AC-5)', () =>
	{
		// The two cases above have computed this arithmetic inline since J2, and
		// been right about it since J2. The roadmap's section 06 published a
		// different answer for the same question - 608 more models - because it
		// divided the headroom by 8,439, the mean of the `.glb` files alone. A
		// catalog row is a `.glb` plus its textures plus a thumbnail, which is the
		// `deduped` figure these tests use and the one catalog-cost.mjs exists to
		// maintain. So the tree said 212 and the document said 608, and nothing
		// connected them, because the correct number lived only inside a test.
		//
		// It is in the generated report now, and this is what stops the report and
		// the tests from drifting apart the way the tests and the document did.
		const capacity = REPORT.totals.capacity;
		const headroom = BUDGET.budgets['public-total'].limit - BUDGET.budgets['public-total'].measured;

		expect(capacity.limit).toBe(BUDGET.budgets['public-total'].limit);
		expect(capacity.tree).toBe(BUDGET.budgets['public-total'].measured);
		expect(capacity.headroom).toBe(headroom);
		expect(capacity.rowsAtMean).toBe(Math.floor(headroom / REPORT.totals.mean));
		expect(capacity.rowsAtMedian).toBe(Math.floor(headroom / REPORT.totals.median));

		// The figure the roadmap now quotes, and the one it used to. Pinned as a
		// range rather than a value so an ordinary pack acquisition moves it
		// without failing, and a threefold error cannot come back.
		expect(capacity.rowsAtMean).toBeGreaterThan(150);
		expect(capacity.rowsAtMean).toBeLessThan(300);
	});
});
