/**
 * Whether a pack may be admitted, decided on its measured cost (RM-012 J2).
 *
 *   npm run admit                     report every shipped pack and the reach
 *   npm run admit -- --candidate <f>  measure a candidate and admit or refuse
 *   npm run admit:check               verify the report, and that 400 is reachable
 *
 * ## Why this is a tool and not a judgement
 *
 * J2's ceiling was chosen to make curation compulsory. Task one raised
 * `public-total` by exactly 1.5x and recorded why: 5,843,561 bytes of headroom
 * buys **209 items at the catalog's measured mean of 27,997** and **521 at its
 * median of 11,218**, and RM-007 wants a catalog of 400 to 600. So the top of
 * that range is reachable only if packs come in near the median - a heavy pack
 * has to be trimmed or refused - and 2.0x was declined precisely because it
 * would have bought 432 at the mean and noticed nothing.
 *
 * A constraint like that survives exactly as long as somebody re-does the
 * arithmetic each time, which is to say not very long. The sprint's own wording
 * is what this implements: **a pack is admitted on its measured mean rather than
 * on its name**. Kenney is not admitted because it is Kenney.
 *
 * ## What the gate actually asks
 *
 * Not "is this pack cheap", which is a question about a pack in isolation and
 * has no right answer. It asks whether admitting it leaves RM-007's own target
 * reachable:
 *
 *     after admitting N items costing B bytes, does the remaining headroom
 *     still buy the items still needed, at the mean the catalog would then have?
 *
 * That is a question a pack can fail two ways round. A large pack of cheap items
 * passes and improves the mean for everything after it. A small pack of
 * expensive ones fails, because it spends headroom the remaining 232 items need
 * and raises the divisor they will be counted against. Which is the shape of the
 * decision X-2 described and task one deliberately made unavoidable.
 *
 * ## And what it refuses for reasons that are not arithmetic
 *
 * A row whose licence nobody established, because RM-007's constraint is a
 * catalog of CC0 assets with the licence recorded per item and admitting an
 * unknown is how that stops being true. An item over the per-item ceiling
 * `catalog-item-largest`, because one 3 MB sofa is a cost paid by whoever clicks
 * it rather than by the tree. And it *reports* - without refusing - how much of a
 * pack is already through Draco and KTX2, because X-2 measured that this
 * catalog's mean is a post-pipeline number and a candidate whose models are raw
 * should go through `npm run encode` before it is priced, not after.
 */
import {readFileSync, writeFileSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

import {filesFor} from './catalog-cost.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'src/catalog/catalog.json');
const SOURCES = join(ROOT, 'src/catalog/sources.json');
const BUDGET = join(ROOT, 'tools/budget.json');
const REPORT = join(ROOT, 'asset-pipeline/pack-admission.json');
const CHECK = process.argv.includes('--check');

/**
 * RM-007's own figures, and the reason the low one is the gate.
 *
 * 400 is what the programme has to reach for its objective to be met - "enough
 * furniture to furnish a home". 600 is what it would like. A gate written
 * against 600 would refuse packs that are perfectly admissible; one written
 * against neither is not a gate.
 */
export const TARGET_LOW = 400;
export const TARGET_HIGH = 600;

/**
 * What one set of rows costs, with each file counted once across the set.
 *
 * The same measurement `catalog-cost.mjs` takes of the whole catalog, over a
 * subset - so a pack's mean and the catalog's mean are the same kind of number
 * and can be compared without a conversion. Uses that module's `filesFor`
 * rather than a second reader of the same containers, because two readers of a
 * `.glb` are two things to keep in agreement.
 *
 * @param {Array<Object>} rows Catalog rows.
 * @param {string} [root]
 * @returns {{count: number, files: number, deduped: number, mean: number,
 *   median: number, p90: number, largest: number, largestName: string}}
 */
export function packCost(rows, root)
{
	const base = join(root || ROOT, 'public');
	const bytes = (relative) => statSync(join(base, relative)).size;
	const everything = new Set();
	const priced = rows.map((item) =>
	{
		const files = filesFor(item, root);
		files.forEach((file) => everything.add(file));
		return {name: item.name, bytes: files.reduce((sum, file) => sum + bytes(file), 0)};
	});

	const sorted = priced.map((row) => row.bytes).sort((a, b) => a - b);
	const deduped = [...everything].reduce((sum, file) => sum + bytes(file), 0);
	const worst = priced.reduce((a, b) => (b.bytes > a.bytes ? b : a), {name: '(none)', bytes: 0});
	return {
		count: priced.length,
		files: everything.size,
		deduped: deduped,
		mean: priced.length ? Math.round(deduped / priced.length) : 0,
		median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
		p90: sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0,
		largest: worst.bytes,
		largestName: worst.name,
	};
}

/**
 * How many models in a set are already through each codec.
 *
 * Reported rather than gated. X-2's census found 152 of 168 already Draco and 11
 * already KTX2, which is what makes this catalog's mean a post-pipeline figure
 * and why "there is no compression left to find" is a measurement rather than a
 * shrug. A candidate that is mostly raw has not been priced yet - it should go
 * through `npm run encode` and `npm run encode:textures` and be measured again.
 *
 * @param {Array<Object>} rows
 * @param {string} [root]
 * @returns {{models: number, draco: number, basis: number}}
 */
export function codecCensus(rows, root)
{
	const base = join(root || ROOT, 'public');
	let models = 0;
	let draco = 0;
	let basis = 0;
	for (const item of rows)
	{
		const path = join(base, item.model || '');
		if (!item.model || !existsSync(path))
		{
			continue;
		}
		models++;
		const buffer = readFileSync(path);
		// A `.glb`'s JSON chunk, or the whole file for the three plain `.gltf`
		// rows. Either way the census is over `extensionsUsed`, which is where a
		// container declares what a reader needs - the same question X-2 asked to
		// find 152 already Draco, asked of a candidate before it is priced.
		const text = (buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67)
			? buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8')
			: buffer.toString('utf8');
		let used;
		try { used = JSON.parse(text).extensionsUsed || []; }
		catch { used = []; }
		if (used.indexOf('KHR_draco_mesh_compression') !== -1) { draco++; }
		if (used.indexOf('KHR_texture_basisu') !== -1) { basis++; }
	}
	return {models, draco, basis};
}

/**
 * The arithmetic task one took, re-run against whatever the tree is now.
 *
 * @param {{limit: number, tree: number, count: number, deduped: number}} state
 * @returns {Object} What the headroom buys, and what a new item must cost.
 */
export function reach(state)
{
	const headroom = state.limit - state.tree;
	const mean = state.count ? Math.round(state.deduped / state.count) : 0;
	const needLow = Math.max(0, TARGET_LOW - state.count);
	const needHigh = Math.max(0, TARGET_HIGH - state.count);
	return {
		headroom: headroom,
		mean: mean,
		count: state.count,
		// What the room left buys if everything from here costs what the catalog
		// costs today. This is the number task one raised the ceiling against.
		buysAtMean: mean > 0 ? Math.floor(headroom / mean) : 0,
		needLow: needLow,
		needHigh: needHigh,
		// And the number that actually governs an acquisition: the most a new item
		// may average and still leave the target reachable.
		maxMeanForLow: needLow > 0 ? Math.floor(headroom / needLow) : Infinity,
		maxMeanForHigh: needHigh > 0 ? Math.floor(headroom / needHigh) : Infinity,
		// Reachable *if nothing changes* - if every item from here costs what an
		// item costs today. Both of these are false at 1.5x, and that is the
		// finding rather than a fault: task one chose a ceiling that makes
		// curation compulsory, and a ceiling that reached 400 by doing nothing
		// would not have been that ceiling.
		reachesLow: needLow === 0 || (mean > 0 && Math.floor(headroom / mean) >= needLow),
		reachesHigh: needHigh === 0 || (mean > 0 && Math.floor(headroom / mean) >= needHigh),
	};
}

/**
 * What a curated pack costs, taken from a pack that exists rather than chosen.
 *
 * The gate below has to answer "is the target still reachable", and reachable
 * *at what price* is the whole question. Today's catalog mean is the wrong
 * benchmark - task one deliberately picked a ceiling that mean does not reach.
 * A number somebody invented would be worse.
 *
 * So it is the cheapest shipped pack's own measured mean: the Kenney furniture
 * kit at 12,285 bytes an item, 140 CC0 rows already through Draco, sitting in
 * this tree. It is proof by existence that a kit can be had at that price, which
 * is exactly what the claim "curation is the lever" needs and is the only kind of
 * evidence that cannot be optimistic.
 *
 * @param {Array<{mean: number, count: number}>} packs
 * @returns {number} Bytes an item, or 0 with nothing to go on.
 */
export function curatedPrice(packs)
{
	// Packs of one or two rows are not evidence of a price - the duck is a
	// Khronos test asset and the two unattributed rows are a provenance problem,
	// and neither says anything about what a kit costs.
	const real = packs.filter((pack) => pack.count >= 10);
	return real.length ? Math.min(...real.map((pack) => pack.mean)) : 0;
}

/**
 * Admit a candidate, or say why not.
 *
 * @param {{rows: Array<Object>, cost: Object}} candidate
 * @param {{limit: number, tree: number, count: number, deduped: number,
 *   itemLimit: number, sources: Object}} state
 * @returns {{admitted: boolean, refusals: Array<string>, notes: Array<string>,
 *   before: Object, after: Object}}
 */
export function admit(candidate, state)
{
	const refusals = [];
	const notes = [];
	const before = reach(state);
	const after = reach({
		limit: state.limit,
		tree: state.tree + candidate.cost.deduped,
		count: state.count + candidate.cost.count,
		deduped: state.deduped + candidate.cost.deduped,
	});

	if (state.tree + candidate.cost.deduped > state.limit)
	{
		refusals.push(`the tree would be ${(state.tree + candidate.cost.deduped).toLocaleString()} B `
			+ `against a ${state.limit.toLocaleString()} B ceiling`);
	}
	else if (candidate.cost.mean > 0
		&& Math.floor(after.headroom / candidate.cost.mean) < after.needLow)
	{
		// The gate proper, and the sharpest form of "admitted on its measured
		// mean": would more packs *like this one* reach RM-007's lower figure? Not
		// "is this pack expensive", which is a question about a pack in isolation
		// and has no answer. A large pack of cheap items passes and leaves the
		// target closer; a small pack of dear ones fails, because it spends
		// headroom the remaining items need at a price that will not get there.
		refusals.push(`${TARGET_LOW} items would stop being reachable: `
			+ `${after.needLow} still needed and this price buys `
			+ `${Math.floor(after.headroom / candidate.cost.mean)}. This pack averages `
			+ `${candidate.cost.mean.toLocaleString()} B against a ceiling of `
			+ `${before.maxMeanForLow.toLocaleString()} B an item`);
	}

	if (candidate.cost.largest > state.itemLimit)
	{
		refusals.push(`${candidate.cost.largestName} is ${candidate.cost.largest.toLocaleString()} B, `
			+ `over the ${state.itemLimit.toLocaleString()} B per-item ceiling`);
	}

	const unlicensed = candidate.rows.filter((row) =>
	{
		const source = (state.sources || {})[row.source];
		return !source || !source.licence || !source.licence.name || source.licence.name === 'unknown';
	});
	if (unlicensed.length)
	{
		refusals.push(`${unlicensed.length} row(s) have no established licence: `
			+ unlicensed.slice(0, 3).map((row) => row.name).join(', ')
			+ (unlicensed.length > 3 ? ', ...' : ''));
	}

	const codecs = candidate.codecs;
	if (codecs && codecs.models && codecs.draco < codecs.models)
	{
		notes.push(`${codecs.models - codecs.draco} of ${codecs.models} models are not Draco - `
			+ 'run `npm run encode` and measure again, because this price is a pre-pipeline one');
	}
	if (candidate.cost.mean > candidate.cost.median * 2)
	{
		notes.push(`the mean is ${(candidate.cost.mean / candidate.cost.median).toFixed(1)}x the median, `
			+ 'so a tail is carrying it - trimming the worst rows is cheaper than refusing the pack');
	}

	return {admitted: refusals.length === 0, refusals, notes, before, after};
}

function serialise(payload)
{
	return JSON.stringify(Object.assign({
		_comment: 'GENERATED by tools/admit-pack.mjs (RM-012 J2). What each shipped pack costs, and '
			+ 'whether the headroom still reaches RM-007\'s 400 items. A pack is admitted on its measured '
			+ 'mean rather than on its name; run `npm run admit -- --candidate <rows.json>` before '
			+ 'acquiring one.',
	}, payload), null, '\t') + '\n';
}

function human(bytes)
{
	return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function main()
{
	const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
	const sources = JSON.parse(readFileSync(SOURCES, 'utf8')).sources;
	const budgets = JSON.parse(readFileSync(BUDGET, 'utf8')).budgets;
	const state = {
		limit: budgets['public-total'].limit,
		tree: budgets['public-total'].measured,
		itemLimit: budgets['catalog-item-largest'].limit,
		count: catalog.items.length,
		deduped: packCost(catalog.items).deduped,
		sources: sources,
	};

	const at = process.argv.indexOf('--candidate');
	if (at !== -1 && process.argv[at + 1])
	{
		const rows = JSON.parse(readFileSync(resolve(process.argv[at + 1]), 'utf8'));
		const list = Array.isArray(rows) ? rows : rows.items;
		const candidate = {rows: list, cost: packCost(list), codecs: codecCensus(list)};
		const verdict = admit(candidate, state);

		console.log(`\n  candidate: ${candidate.cost.count} items, ${human(candidate.cost.deduped)}`);
		console.log(`  mean ${candidate.cost.mean.toLocaleString()}   `
			+ `median ${candidate.cost.median.toLocaleString()}   `
			+ `largest ${candidate.cost.largest.toLocaleString()} (${candidate.cost.largestName})`);
		console.log(`  the catalog may spend ${state.limit - state.tree > 0
			? Math.floor((state.limit - state.tree) / Math.max(1, TARGET_LOW - state.count)).toLocaleString()
			: 0} B an item and still reach ${TARGET_LOW}`);
		verdict.notes.forEach((note) => console.log(`  note: ${note}`));
		if (verdict.admitted)
		{
			console.log(`\n  ADMITTED. ${verdict.after.count} items, mean `
				+ `${verdict.before.mean.toLocaleString()} -> ${verdict.after.mean.toLocaleString()}, `
				+ `${verdict.after.buysAtMean} more affordable.\n`);
			return;
		}
		console.error('\n  REFUSED:');
		verdict.refusals.forEach((line) => console.error(`    ${line}`));
		console.error('');
		process.exit(1);
	}

	const packs = [];
	for (const id of [...new Set(catalog.items.map((item) => item.source))])
	{
		const rows = catalog.items.filter((item) => item.source === id);
		const cost = packCost(rows);
		const source = sources[id] || {};
		packs.push(Object.assign({id: id, licence: (source.licence && source.licence.name) || 'unknown'},
			cost, codecCensus(rows)));
	}
	packs.sort((a, b) => b.count - a.count);
	const now = reach(state);
	const curated = curatedPrice(packs);
	now.curatedPrice = curated;
	now.buysAtCurated = curated > 0 ? Math.floor(now.headroom / curated) : 0;
	now.reachesLowCurated = now.needLow === 0 || now.buysAtCurated >= now.needLow;
	now.reachesHighCurated = now.needHigh === 0 || now.buysAtCurated >= now.needHigh;
	const payload = {target: {low: TARGET_LOW, high: TARGET_HIGH}, reach: now, packs: packs};
	const text = serialise(payload);

	console.log(`\n  ${state.count} items, ${human(state.deduped)} of catalog in a `
		+ `${human(state.tree)} tree against ${human(state.limit)}`);
	console.log(`  headroom ${human(now.headroom)} buys ${now.buysAtMean} more at a mean of `
		+ `${now.mean.toLocaleString()} B`);
	console.log(`  to reach ${TARGET_LOW}: ${now.needLow} more, at up to `
		+ `${now.maxMeanForLow.toLocaleString()} B each`);
	console.log(`  to reach ${TARGET_HIGH}: ${now.needHigh} more, at up to `
		+ `${now.maxMeanForHigh.toLocaleString()} B each`);
	console.log(`  at the cheapest shipped kit's ${curated.toLocaleString()} B it buys `
		+ `${now.buysAtCurated} - so ${TARGET_LOW} is ${now.reachesLowCurated ? '' : 'NOT '}reachable `
		+ `and ${TARGET_HIGH} is ${now.reachesHighCurated ? '' : 'NOT '}reachable, by curation\n`);
	for (const pack of packs)
	{
		console.log(`  ${pack.id.padEnd(24)} ${String(pack.count).padStart(4)} items  `
			+ `mean ${String(pack.mean).padStart(7)}  median ${String(pack.median).padStart(7)}  `
			+ `${pack.draco}/${pack.models} draco  ${pack.licence}`);
	}
	console.log('');

	if (CHECK)
	{
		const current = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : null;
		if (current !== text)
		{
			console.error('asset-pipeline/pack-admission.json is out of date. Run `npm run admit`.');
			process.exit(1);
		}
		// Gated on the curated price rather than on today's mean, because today's
		// mean is a number task one chose a ceiling *not* to reach. What must stay
		// true is that the target is reachable at a price a kit can actually be
		// had at - and the evidence for that price is a kit in this tree.
		if (!now.reachesLowCurated)
		{
			console.error(`${TARGET_LOW} items is no longer reachable even at the cheapest shipped kit's `
				+ `${curated.toLocaleString()} B an item: ${now.needLow} needed, ${now.buysAtCurated} `
				+ 'affordable. Raise the ceiling with the arithmetic beside it, or trim what is here.');
			process.exit(1);
		}
		console.log(`  pack admission is up to date (${packs.length} packs; ${TARGET_LOW} reachable at `
			+ `${curated.toLocaleString()} B an item, ${TARGET_HIGH} `
			+ `${now.reachesHighCurated ? 'reachable' : 'not'}).`);
	}
	else
	{
		writeFileSync(REPORT, text);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
