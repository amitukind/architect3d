/**
 * Size budgets for the built output (RM-002 P1, tier 1).
 *
 *   node tools/check-budget.mjs            check, exit 1 on a breach
 *   node tools/check-budget.mjs --update   re-record the measurements
 *
 * ## Why
 *
 * The demo bundle reached 1.1 MB (305 KB gzipped) as a single chunk, and the
 * deployed tree reached 21 MB, without anybody deciding either number. Neither
 * is catastrophic and neither was noticed, which is the problem a budget fixes:
 * it does not make the bundle smaller, it makes growth a decision somebody has
 * to make on purpose.
 *
 * ## What is measured, and why gzip
 *
 * Gzip, not raw, for anything served as text - it is what the browser actually
 * downloads, and it is the number that moves when a dependency is added rather
 * than when a comment is written. Raw bytes for the asset trees, where the
 * content is already-compressed images and models and gzip would tell you
 * nothing.
 *
 * JS and CSS are summed across every file in the assets directory rather than
 * matched by name. Two reasons: the filenames are content-hashed, so there is
 * no stable name to match; and code splitting (RM-002 P6) will turn one chunk
 * into several, which must not read as a saving.
 *
 * ## The limits
 *
 * Committed in tools/budget.json beside the measurement they were derived
 * from, so a reviewer can see both the ceiling and the headroom. They are
 * deliberately not "measured + 5%" computed at runtime - a limit that moves
 * with the thing it limits is not a limit. Raising one is a commit, with a
 * reason, which is exactly the conversation the budget exists to force.
 */
import {gzipSync} from 'node:zlib';
import {readFileSync, writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join, extname, dirname} from 'node:path';

const BUDGET_FILE = 'tools/budget.json';
const update = process.argv.includes('--update');

/** Total bytes of every file under a directory, recursively. */
function treeBytes(dir)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const entry of readdirSync(dir, {withFileTypes: true}))
	{
		const path = join(dir, entry.name);
		total += entry.isDirectory() ? treeBytes(path) : statSync(path).size;
	}
	return total;
}

/** Gzipped bytes of every file in a directory with one of the given extensions. */
function gzipBytes(dir, extensions)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const name of readdirSync(dir))
	{
		if (extensions.includes(extname(name)))
		{
			total += gzipSync(readFileSync(join(dir, name)), {level: 9}).length;
		}
	}
	return total;
}

function gzipFile(path)
{
	return existsSync(path) ? gzipSync(readFileSync(path), {level: 9}).length : null;
}

/**
 * The biggest single file under a directory, and which one it is.
 *
 * A tree total does not catch this. `public/` was 15.7 MB against a 16.5 MB
 * ceiling - comfortably inside it - while 3.4 MB of that was one PNG of a
 * garden, 22% of everything served, in a lossless container for a photograph.
 * Nothing was over budget; the budget was measuring the wrong thing.
 *
 * A per-file ceiling is the shape of limit that catches "somebody dropped in an
 * unoptimised asset", which is how these trees actually grow. The tree total
 * still matters for the other failure mode - a hundred small files nobody
 * noticed.
 */
function largestFile(dir)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let worst = {bytes: 0, note: '(empty)'};
	const visit = (path) =>
	{
		for (const entry of readdirSync(path, {withFileTypes: true}))
		{
			const child = join(path, entry.name);
			if (entry.isDirectory())
			{
				visit(child);
				continue;
			}
			const bytes = statSync(child).size;
			if (bytes > worst.bytes)
			{
				worst = {bytes, note: child};
			}
		}
	};
	visit(dir);
	return worst;
}

/**
 * Every measurement, in the order they are reported.
 *
 * `needs` names the build that produces the input, so a missing directory
 * reports "run npm run build:demo" rather than a bare failure. A measurement
 * whose input is absent is skipped, not failed: `npm run budget` is useful
 * after one build without demanding all of them.
 */
/**
 * The JSON chunk of a binary glTF, or null.
 *
 * Same reader as `tests/asset-integrity.test.js` and
 * `asset-pipeline/compress-textures.mjs`. A .glb is a 12-byte header followed
 * by length-prefixed chunks; the first is always JSON.
 */
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
 * What placing one catalog item costs to download, worst case (RM-003 A5).
 *
 * ## Why this is a different question from the two ceilings beside it
 *
 * `public-total` asks what the deployment weighs and `public-largest` asks
 * whether one file has got out of hand. Neither can answer **"what happens when
 * somebody clicks a chair"** - and that is the number a user experiences. A
 * model is not one file: it is a .glb plus every image the .glb references,
 * plus the thumbnail the palette already showed. P6 found a 3.4 MB photograph
 * hiding inside a 15 MB tree that was comfortably inside its ceiling; this is
 * the same shape of blind spot one level down.
 *
 * External images are counted once each even when several models share one -
 * because a second model that shares them is cheap, and charging it the full
 * cost would report a number no user ever pays.
 */
function largestCatalogItem()
{
	const catalogPath = 'src/catalog/catalog.json';
	if (!existsSync(catalogPath) || !existsSync('public'))
	{
		return null;
	}

	const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
	const items = catalog.items || [];
	const sizeOf = (relative) =>
	{
		const path = join('public', relative);
		return existsSync(path) ? statSync(path).size : 0;
	};

	let worst = 0;
	let name = null;

	for (const item of items)
	{
		if (!item.model)
		{
			continue;
		}
		let total = sizeOf(item.model) + (item.image ? sizeOf(item.image) : 0);

		const modelPath = join('public', item.model);
		if (existsSync(modelPath) && modelPath.endsWith('.glb'))
		{
			const json = glbJson(modelPath);
			const seen = new Set();
			for (const image of (json && json.images) || [])
			{
				if (!image.uri || seen.has(image.uri))
				{
					continue;
				}
				seen.add(image.uri);
				const beside = join(dirname(modelPath), image.uri);
				total += existsSync(beside) ? statSync(beside).size : 0;
			}
		}

		if (total > worst)
		{
			worst = total;
			name = item.name;
		}
	}

	return worst ? {bytes: worst, note: name} : null;
}

const MEASUREMENTS = [
	{key: 'demo-js-gzip', label: 'Demo JS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.js'])},
	{key: 'demo-css-gzip', label: 'Demo CSS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.css'])},
	{key: 'demo-total', label: 'Deployed tree', needs: 'build:demo',
		measure: () => treeBytes('dist-demo')},
	{key: 'lib-iife-gzip', label: 'Library IIFE (gzip)', needs: 'build',
		measure: () => gzipFile('dist/bp3djs.js')},
	// The one budget here that guards a property rather than a size. The ESM
	// entry excludes three and bezier-js because they are peerDependencies; if
	// that externals config is ever lost, this jumps from ~81 KB to ~423 KB and
	// the build fails rather than quietly shipping a second copy of three to
	// every consumer.
	{key: 'lib-esm-gzip', label: 'Library ESM (gzip)', needs: 'build',
		measure: () => gzipFile('dist/architect3d.js')},
	{key: 'public-total', label: 'Runtime assets', needs: null,
		measure: () => treeBytes('public')},
	{key: 'public-largest', label: 'Largest single asset', needs: null,
		measure: () => largestFile('public')},
	// The per-asset ceiling A5 added beside the per-file and per-tree ones. See
	// largestCatalogItem for why "what does placing this chair cost" is a
	// question neither of the others can answer.
	{key: 'catalog-item-largest', label: 'Costliest catalog item', needs: null,
		measure: () => largestCatalogItem()},
];

function human(bytes)
{
	if (bytes >= 1048576)
	{
		return (bytes / 1048576).toFixed(2) + ' MB';
	}
	return (bytes / 1024).toFixed(1) + ' KB';
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
const rows = [];
let failures = 0;
let skipped = 0;

for (const item of MEASUREMENTS)
{
	// A measurement may return a bare byte count, or {bytes, note} when naming
	// what it measured is what makes the failure actionable.
	const raw = item.measure();
	const measured = (raw && typeof raw === 'object') ? raw.bytes : raw;
	const note = (raw && typeof raw === 'object') ? raw.note : null;
	const entry = budget.budgets[item.key];

	if (!entry)
	{
		console.error(`No budget recorded for "${item.key}". Add it to ${BUDGET_FILE}.`);
		failures++;
		continue;
	}

	if (measured === null)
	{
		rows.push({label: item.label, status: 'skip', detail: `no output — run \`npm run ${item.needs}\``});
		skipped++;
		continue;
	}

	if (update)
	{
		entry.measured = measured;
	}

	const over = measured > entry.limit;
	const headroom = ((entry.limit - measured) / entry.limit) * 100;
	rows.push({
		label: item.label,
		status: over ? 'OVER' : 'ok',
		detail: `${human(measured).padStart(9)}  /  ${human(entry.limit).padStart(9)} limit` +
			(over
				? `  — over by ${human(measured - entry.limit)}`
				: `  (${headroom.toFixed(1)}% headroom)`) +
			(note ? `  ${note}` : ''),
	});
	if (over)
	{
		failures++;
	}
}

const width = Math.max(...rows.map((row) => row.label.length));
console.log('');
for (const row of rows)
{
	const mark = row.status === 'OVER' ? '✗' : (row.status === 'skip' ? '–' : '✓');
	console.log(`  ${mark} ${row.label.padEnd(width)}   ${row.detail}`);
}
console.log('');

if (update)
{
	writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, 2) + '\n');
	console.log(`Recorded current measurements in ${BUDGET_FILE}.`);
	console.log('Limits were NOT changed — edit them by hand, with a reason in the commit message.');
	process.exit(0);
}

if (skipped)
{
	console.log(`${skipped} measurement(s) skipped: their build output is not present.`);
}

if (failures)
{
	console.error(`Size budget exceeded by ${failures} measurement(s).`);
	console.error('Either make it smaller, or raise the limit in tools/budget.json deliberately.');
	process.exit(1);
}

console.log('Within budget.');
