// @vitest-environment node
/**
 * A pack is admitted on its measured mean, not on its name (RM-012 J2).
 *
 * Task one raised `public-total` by exactly 1.5x and recorded the argument for
 * the number: 5,843,561 bytes of headroom buys 209 items at the catalog's
 * measured mean and 521 at its median, RM-007 wants 400 to 600, so the top of
 * that range is reachable **only if packs are curated**. 2.0x was declined
 * because it would have bought 432 at the mean and noticed nothing.
 *
 * A constraint of that shape lasts exactly as long as somebody re-does the
 * arithmetic by hand each time. `tools/admit-pack.mjs` is the arithmetic; this
 * is the assertion that it says what task one decided.
 *
 * The gate's question is deliberately not "is this pack cheap", which is a
 * question about a pack in isolation and has no answer. It is whether admitting
 * the pack leaves RM-007's own lower figure reachable - which a large pack of
 * cheap items passes and a small pack of expensive ones fails.
 */
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {
	TARGET_LOW, TARGET_HIGH, admit, codecCensus, curatedPrice, packCost, reach,
} from '../tools/admit-pack.mjs';

const ROOT = process.cwd();
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const SOURCES = JSON.parse(readFileSync(join(ROOT, 'src/catalog/sources.json'), 'utf8')).sources;
const BUDGETS = JSON.parse(readFileSync(join(ROOT, 'tools/budget.json'), 'utf8')).budgets;
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/pack-admission.json'), 'utf8'));

/** The tree as it stands, which is what a candidate is measured against. */
function today()
{
	return {
		limit: BUDGETS['public-total'].limit,
		tree: BUDGETS['public-total'].measured,
		itemLimit: BUDGETS['catalog-item-largest'].limit,
		count: CATALOG.items.length,
		deduped: packCost(CATALOG.items).deduped,
		sources: SOURCES,
	};
}

/** A candidate of `count` items each costing `each`, on a licence that resolves. */
function candidate(count, each, options)
{
	const settings = options || {};
	return {
		rows: Array.from({length: count}, (_, at) => ({
			name: `candidate ${at}`, model: '', source: settings.source || 'kenney-furniture-kit',
		})),
		cost: {
			count: count,
			files: count,
			deduped: count * each,
			mean: each,
			median: settings.median === undefined ? each : settings.median,
			p90: each,
			largest: settings.largest === undefined ? each : settings.largest,
			largestName: 'candidate 0',
		},
		codecs: settings.codecs || {models: count, draco: count, basis: 0},
	};
}

describe('the report is the tree, and it is current', () =>
{
	it('regenerates identically from what is on disk', () =>
	{
		execFileSync(process.execPath, ['tools/admit-pack.mjs', '--check'], {cwd: ROOT});
	});

	it('prices every pack the catalog actually has', () =>
	{
		const ids = [...new Set(CATALOG.items.map((item) => item.source))].sort();
		expect(REPORT.packs.map((pack) => pack.id).sort()).toEqual(ids);
		expect(REPORT.packs.reduce((sum, pack) => sum + pack.count, 0)).toBe(CATALOG.items.length);
	});

	it('carries RM-007\'s own two figures rather than a number of its own', () =>
	{
		expect(REPORT.target).toEqual({low: 400, high: 600});
		expect(TARGET_LOW).toBe(400);
		expect(TARGET_HIGH).toBe(600);
	});
});

describe('the arithmetic task one took', () =>
{
	/**
	 * What the first acquisition did to the arithmetic, which is the whole reason
	 * this tool exists.
	 *
	 * On its first run it corrected task one: that landing said 1.5x reaches
	 * *the top* of RM-007's range only with curation, and the arithmetic said
	 * neither end was reachable standing still - 232 needed for the lower figure
	 * and 206 affordable.
	 *
	 * The Food Kit changed that, and this is what "curation is the lever" looks
	 * like when it works. 51 rows at 3,561 bytes each pulled the catalog's mean
	 * from 27,995 to 24,096 while adding to the count, so **400 is now reachable
	 * without further curation and 600 still is not**. One acquisition moved the
	 * lower figure from out of reach to comfortable, which no amount of
	 * compression could have done - X-2's point, demonstrated rather than argued.
	 */
	it('reaches 400 unaided now, and still refuses an uncurated 600', () =>
	{
		const now = reach(today());
		expect(now.needLow).toBe(TARGET_LOW - CATALOG.items.length);
		expect(now.reachesLow, 'the Food Kit is what put this in reach').toBe(true);
		expect(now.reachesHigh, 'reaching 600 must still require curation').toBe(false);
		// A band rather than a number: it moves with every commit that touches the
		// tree, and pinning it exactly would make this a test about the last
		// acquisition rather than about the decision.
		expect(now.buysAtMean).toBeGreaterThanOrEqual(now.needLow);
		expect(now.buysAtMean).toBeLessThan(now.needHigh);
	});

	it('says what a new item may cost, which is the number an acquisition needs', () =>
	{
		const now = reach(today());
		// The ceiling for 400 is above today's mean and the one for 600 is below
		// it, which is the constraint stated as a price rather than as a verdict:
		// more of what is already here reaches the lower figure and nothing but a
		// cheaper kit reaches the upper.
		expect(now.maxMeanForLow).toBeGreaterThan(now.mean);
		expect(now.maxMeanForHigh).toBeLessThan(now.mean);
	});

	it('and reaches both at a price a kit in this tree is actually had at', () =>
	{
		// The gate is not "reachable while standing still" - it is "reachable at a
		// price somebody can pay". The evidence for that price is not an estimate:
		// it is the Kenney kit, 140 CC0 rows in this tree at 12,285 bytes each.
		const now = reach(today());
		const price = curatedPrice(REPORT.packs);
		expect(price).toBe(REPORT.packs.find((pack) => pack.id === 'kenney-furniture-kit').mean);
		expect(Math.floor(now.headroom / price)).toBeGreaterThan(now.needHigh);
		expect(REPORT.reach.reachesLowCurated).toBe(true);
		expect(REPORT.reach.reachesHighCurated).toBe(true);
	});

	it('ignores a pack too small to be evidence of a price', () =>
	{
		// The duck is one Khronos test asset and the two unattributed rows are a
		// provenance problem. Neither says anything about what a kit costs, and a
		// minimum taken over them would make the gate a test of the duck.
		expect(curatedPrice([{count: 1, mean: 5, median: 5}, {count: 140, mean: 12285, median: 10683}]))
			.toBe(12285);
		expect(curatedPrice([{count: 2, mean: 9, median: 9}])).toBe(0);
	});

	it('needs nothing more once the target is met', () =>
	{
		const met = reach({limit: 20e6, tree: 19e6, count: 450, deduped: 9e6});
		expect(met.needLow).toBe(0);
		expect(met.reachesLow).toBe(true);
		expect(met.maxMeanForLow).toBe(Infinity);
	});
});

describe('what the gate admits', () =>
{
	it('admits a large pack of cheap items, and the mean improves', () =>
	{
		const state = today();
		const before = reach(state);
		// 200 items at the Kenney kit's own measured mean - the shape of pack J2
		// is written for.
		const verdict = admit(candidate(200, 12285), state);

		expect(verdict.refusals).toEqual([]);
		expect(verdict.admitted).toBe(true);
		expect(verdict.after.count).toBe(state.count + 200);
		expect(verdict.after.mean, 'a cheap pack should pull the divisor down').toBeLessThan(before.mean);
		expect(verdict.after.reachesLow).toBe(true);
	});

	it('refuses a small pack of expensive ones, and says what it would have cost', () =>
	{
		// The failure mode the ceiling exists to catch: 40 items is nothing, and at
		// 130 KB each it spends most of the headroom the remaining 232 need while
		// raising the divisor they will be counted against.
		const verdict = admit(candidate(40, 130000), today());

		expect(verdict.admitted).toBe(false);
		expect(verdict.refusals.join(' ')).toContain('400 items would stop being reachable');
		expect(verdict.refusals.join(' ')).toContain('130,000');
		// And it says the price it would have had to beat, because "refused" on
		// its own is not something anybody can act on. The figure itself is not
		// pinned: it moves with every commit that touches the tree, and an exact
		// digit here would make this a test about the last one.
		expect(verdict.refusals.join(' ')).toMatch(/against a ceiling of [\d,]+ B an item/);
		expect(verdict.before.maxMeanForLow).toBeGreaterThan(20000);
		expect(verdict.before.maxMeanForLow).toBeLessThan(30000);
	});

	it('refuses a pack that would not fit at all, and says so instead', () =>
	{
		// A different refusal from the one above, and it has to come first: a pack
		// over the ceiling has no meaningful "would 400 still be reachable".
		const verdict = admit(candidate(50, 500000), today());
		expect(verdict.admitted).toBe(false);
		expect(verdict.refusals[0]).toContain('against a');
		expect(verdict.refusals[0]).toContain('ceiling');
	});

	it('refuses a row whose licence nobody established', () =>
	{
		// RM-007's constraint is a catalog of CC0 assets with the licence recorded
		// per item. J1 recorded two rows as `unknown` rather than assuming CC0 by
		// resemblance; this is what stops the next such row being admitted.
		const verdict = admit(candidate(10, 10000, {source: 'unattributed'}), today());
		expect(verdict.admitted).toBe(false);
		expect(verdict.refusals.join(' ')).toContain('no established licence');
	});

	it('refuses a source that resolves to nothing at all', () =>
	{
		const verdict = admit(candidate(10, 10000, {source: 'nowhere'}), today());
		expect(verdict.admitted).toBe(false);
		expect(verdict.refusals.join(' ')).toContain('no established licence');
	});

	it('refuses one item over the per-item ceiling even in a cheap pack', () =>
	{
		// `catalog-item-largest` is a cost paid by whoever clicks that one chair,
		// and a pack mean cannot absorb it - which is why this is a separate
		// refusal rather than part of the arithmetic above.
		const verdict = admit(candidate(100, 8000, {largest: 900000}), today());
		expect(verdict.admitted).toBe(false);
		expect(verdict.refusals.join(' ')).toContain('per-item ceiling');
	});

	it('notes a pre-pipeline price rather than refusing it', () =>
	{
		// X-2 measured that this catalog's mean is a post-pipeline number: 152 of
		// 168 models are already Draco. A candidate that is raw has not been priced
		// yet, and the answer is to encode it and measure again - not to refuse it.
		const raw = candidate(100, 9000, {codecs: {models: 100, draco: 10, basis: 0}});
		const verdict = admit(raw, today());
		expect(verdict.admitted).toBe(true);
		expect(verdict.notes.join(' ')).toContain('90 of 100 models are not Draco');
	});

	it('names the tail when the mean is carried by one, because trimming beats refusing', () =>
	{
		const tailed = candidate(100, 40000, {median: 9000});
		const verdict = admit(tailed, today());
		expect(verdict.notes.join(' ')).toContain('the mean is 4.4x the median');
	});
});

describe('what the shipped packs measure', () =>
{
	it('finds the catalog\'s mean living in one pack of twenty-five rows', () =>
	{
		// The finding this tool produced on its first run, and it re-frames what
		// curation means for this catalog: blueprint3d is 15 % of the rows and more
		// than half the bytes. X-2 said the tail is where the budget goes; this
		// says the tail has an address.
		const packs = Object.fromEntries(REPORT.packs.map((pack) => [pack.id, pack]));
		const total = REPORT.packs.reduce((sum, pack) => sum + pack.deduped, 0);

		expect(packs.blueprint3d.count / CATALOG.items.length).toBeLessThan(0.20);
		expect(packs.blueprint3d.deduped / total).toBeGreaterThan(0.50);
		expect(packs.blueprint3d.mean).toBeGreaterThan(packs['kenney-furniture-kit'].mean * 5);
	});

	it('and both Kenney kits are far cheaper than the catalog they are in', () =>
	{
		const kits = REPORT.packs.filter((pack) => pack.id.startsWith('kenney-'));
		expect(kits).toHaveLength(2);
		kits.forEach((kit) => {expect(kit.mean, kit.id).toBeLessThan(REPORT.reach.mean * 0.6);});

		// Which is the whole answer to "can 1.5x reach 600": at a Kenney price the
		// headroom buys more than is still needed, so a Kenney-shaped acquisition
		// clears RM-007's upper figure and a blueprint3d-shaped one does not clear
		// its lower.
		const cheapest = Math.min(...kits.map((kit) => Math.max(kit.mean, kit.median)));
		expect(Math.floor(REPORT.reach.headroom / cheapest)).toBeGreaterThan(REPORT.reach.needHigh);
	});

	it('measures the Food Kit\'s sharing, which is why its two prices disagree', () =>
	{
		// 51 models sharing one 10,715-byte colour atlas. Counted once across the
		// pack it is nearly free, which is the deduped mean; charged to each row
		// that names it, it is most of a small model, which is the median. Before
		// this acquisition the whole catalog had exactly two shared textures and
		// the two figures differed by 7.7 %; this pack's differ by 41 %.
		//
		// Measured twice on the way in, and the two readings are worth keeping
		// apart. Before its thumbnails existed the pack's deduped mean was 3,561
		// bytes an item; with a 300 x 225 render per row - which is per-row and
		// shares nothing - it is 13,939. The sharing is in the models and the
		// thumbnails dilute it, which is a fact about how this catalog costs
		// things rather than about this kit.
		const food = REPORT.packs.find((pack) => pack.id === 'kenney-food-kit');
		expect(food.count).toBe(51);
		expect(food.mean).toBeLessThan(food.median * 0.7);
		// And it is why `curatedPrice` takes the dearer of a pack's two prices. On
		// the mean alone, at the moment before the thumbnails landed, this kit
		// would have said the headroom buys 1,600 more items.
		expect(REPORT.reach.curatedPrice).toBe(Math.min(
			...REPORT.packs.filter((pack) => pack.count >= 10)
				.map((pack) => Math.max(pack.mean, pack.median))));
	});

	it('reports the codec census rather than assuming the pipeline ran', () =>
	{
		const census = codecCensus(CATALOG.items.filter((item) => item.source === 'kenney-furniture-kit'));
		expect(census.models).toBe(140);
		expect(census.draco).toBeGreaterThan(120);
	});
});
