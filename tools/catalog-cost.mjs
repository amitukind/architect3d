/**
 * What every catalog item costs, and what a pack does to the mean (M-45).
 *
 *   npm run catalog:cost            re-measure and rewrite the report
 *   npm run catalog:cost -- --check verify the report against the tree
 *
 * ## Why this exists, and why it is not another budget line
 *
 * J2's ceiling was raised on an arithmetic - so many bytes of headroom divided
 * by what an item costs - and that division is only honest while the divisor is
 * true. RM-012 X-2 measured 26,105 bytes a mean item; J1's rendered thumbnails
 * moved it to 27,997 without anybody deciding to. A number that drifts under a
 * decision that was taken against it is the thing this instrument exists to
 * prevent.
 *
 * So it is a **record with a delta**, not a ceiling. `public-total` already
 * refuses a tree that is too big; what it cannot say is *why* the tree grew, or
 * whether the pack that grew it came in at the price it was admitted on. This
 * prints both, against the last committed run:
 *
 *     168 -> 216 items, mean 27,997 -> 24,110, tree +1,204,880 B
 *
 * ## Two costs, because they answer two questions
 *
 * **Per item**, images are counted once within the item: that is what a person
 * downloads when they click a chair, and `check-budget.mjs`'s
 * `catalog-item-largest` asks the same question of the worst one.
 *
 * **Per catalog**, every file is counted once across all 168: that is what the
 * tree actually grows by, and it is the figure a raise of `public-total` has to
 * be divided into. The two differ by 7.7 % today, because sharing is almost
 * absent - 147 of the 168 models carry no external image at all and exactly two
 * textures are reused - and that gap is itself worth watching: a pack of
 * variants on one texture set would open it wide, and the naive figure would
 * then overstate the cost of admitting it.
 *
 * The mean is the number a decision is taken against; the **median** is the one
 * that says whether the mean is being carried by a tail. Today they are 27,997
 * and 11,218, so it is.
 */
import {readFileSync, writeFileSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'src/catalog/catalog.json');
const REPORT = join(ROOT, 'asset-pipeline/catalog-cost.json');
const CHECK = process.argv.includes('--check');

/** A `.glb`'s JSON chunk, or null for anything that is not one. */
function glbJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67)
	{
		return null;
	}
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			try {return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));}
			catch {return null;}
		}
		offset += 8 + length;
	}
	return null;
}

/**
 * Every file one row names, as paths under `public/`.
 *
 * The model, the thumbnail, and every distinct image the container's own JSON
 * chunk points at - which is the only way to find a texture, since nothing in
 * the catalog row mentions one. A `data:` URI is already inside the container
 * and is not a second file.
 *
 * @param {Object} item A catalog row.
 * @param {string} [root] Where `public/` is, so a test can point elsewhere.
 * @returns {Array<string>} Relative to `public/`, deduplicated, existing only.
 */
export function filesFor(item, root)
{
	const base = join(root || ROOT, 'public');
	const out = new Set();
	if (item.model) { out.add(item.model); }
	if (item.image) { out.add(item.image); }

	const modelPath = join(base, item.model || '');
	if (item.model && existsSync(modelPath) && modelPath.endsWith('.glb'))
	{
		const json = glbJson(modelPath);
		for (const image of (json && json.images) || [])
		{
			if (!image.uri || image.uri.startsWith('data:'))
			{
				continue;
			}
			// Resolved against the model's own directory, which is what a glTF URI
			// is relative to - not against `public/`.
			out.add(join(dirname(item.model), image.uri).split('\\').join('/'));
		}
	}
	return [...out].filter((relative) => existsSync(join(base, relative)));
}

/**
 * Per-item and whole-catalog costs.
 *
 * @param {Object} catalog The parsed catalog.json.
 * @param {string} [root]
 */
export function catalogCost(catalog, root)
{
	const base = join(root || ROOT, 'public');
	const bytes = (relative) => statSync(join(base, relative)).size;

	const items = [];
	const everything = new Set();
	for (const item of catalog.items)
	{
		const files = filesFor(item, root);
		files.forEach((file) => everything.add(file));
		items.push({
			name: item.name,
			model: item.model,
			source: item.source,
			files: files.length,
			bytes: files.reduce((sum, file) => sum + bytes(file), 0),
		});
	}

	const sorted = items.map((row) => row.bytes).sort((a, b) => a - b);
	const deduped = [...everything].reduce((sum, file) => sum + bytes(file), 0);
	const naive = sorted.reduce((sum, value) => sum + value, 0);

	return {
		items: items.sort((a, b) => b.bytes - a.bytes),
		totals: {
			count: items.length,
			files: everything.size,
			// What the tree grows by: every file once, however many rows name it.
			deduped: deduped,
			// What the rows add up to if you charge each for everything it uses.
			naive: naive,
			// The divisor a `public-total` raise is spent against.
			mean: Math.round(deduped / items.length),
			median: sorted[Math.floor(sorted.length / 2)],
			p90: sorted[Math.floor(sorted.length * 0.9)],
			largest: sorted[sorted.length - 1],
		},
	};
}

function serialise(result)
{
	return JSON.stringify({
		_comment: 'GENERATED by tools/catalog-cost.mjs (M-45). One row per catalog entry: how many '
			+ 'files it names and what they weigh, with images counted once within the item. `totals.deduped` '
			+ 'counts every file once across the whole catalog, which is what the deployed tree actually '
			+ 'grows by and what a raise of public-total is divided into. Re-run after every pack; the tool '
			+ 'prints the movement against the previous run before overwriting it.',
		totals: result.totals,
		items: result.items,
	}, null, '\t') + '\n';
}

function main()
{
	const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
	const result = catalogCost(catalog);
	const text = serialise(result);
	const previous = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')).totals : null;
	const t = result.totals;

	console.log(`\n  ${t.count} items over ${t.files} files`);
	console.log(`  deduped ${t.deduped.toLocaleString()} B, naive ${t.naive.toLocaleString()} B`
		+ ` (${((t.naive / t.deduped - 1) * 100).toFixed(1)} % of sharing to recover)`);
	console.log(`  mean ${t.mean.toLocaleString()}   median ${t.median.toLocaleString()}`
		+ `   p90 ${t.p90.toLocaleString()}   largest ${t.largest.toLocaleString()}`);

	if (previous && previous.count !== undefined)
	{
		// The half of M-45 that is about a pack rather than about the catalog: what
		// the last acquisition did to the number the ceiling was divided into.
		const arrow = (from, to) => `${from.toLocaleString()} -> ${to.toLocaleString()}`;
		console.log(`\n  since the last run: ${arrow(previous.count, t.count)} items, `
			+ `mean ${arrow(previous.mean, t.mean)}, tree `
			+ `${t.deduped - previous.deduped >= 0 ? '+' : ''}${(t.deduped - previous.deduped).toLocaleString()} B`);
		if (t.count > previous.count)
		{
			console.log(`  the ${t.count - previous.count} added cost `
				+ `${Math.round((t.deduped - previous.deduped) / (t.count - previous.count)).toLocaleString()} B each`
				+ ` against a catalog mean of ${previous.mean.toLocaleString()}`);
		}
	}

	if (CHECK)
	{
		if (!existsSync(REPORT) || readFileSync(REPORT, 'utf8') !== text)
		{
			console.error('\n  ✗ asset-pipeline/catalog-cost.json is out of date. Run `npm run catalog:cost`.\n');
			process.exit(1);
		}
		console.log('\n  ✓ the recorded costs are the tree\'s.\n');
		return;
	}
	writeFileSync(REPORT, text);
	console.log('\n  wrote asset-pipeline/catalog-cost.json\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
