/**
 * Split the catalog into an index that ships and a detail that does not
 * (RM-012 J1, X-3).
 *
 * ## What this exists to prevent
 *
 * `src/catalog/catalog.json` is imported by `useCatalog.js`, so vite inlines
 * every row into the application bundle. RM-012 X-3 measured what that costs
 * once J1's metadata is on it: 3,347 gzipped bytes today, 20,611 at the 600 rows
 * J2 is written for - **17,264 bytes of growth against 13,292 bytes of
 * `first-load` headroom**. The index alone would break M-43 before one model was
 * fetched, on a payload every visitor downloads whether or not they ever open
 * the drawer.
 *
 * ## Where the line goes, and why it is a measurement rather than a taste
 *
 * The obvious split - "small keys in, big keys out" - is not the one that pays.
 * Each candidate key was added to all 168 rows and the result gzipped at level
 * 9, which is the only way to price a key in a file this repetitive:
 *
 *   format   +40 B     168 identical strings; gzip charges almost nothing
 *   room     +369 B    a vocabulary of eight
 *   tags     +116 B    a small vocabulary, so cheaper than the one key above it
 *   size     +907 B    every value different, and nothing to share
 *
 * So the line is drawn where the *use* is, and the measurement says that line is
 * affordable: **the index carries what the grid draws and filters on**, and every
 * one of those keys turns out to be cheap because its vocabulary repeats.
 * **The detail carries what a person reads about one item** - dimensions, source,
 * licence, author - and those are the expensive ones precisely because they are
 * unique per row. Keeping `format` in the index costs 0.24 B a row and keeps
 * `addItem` synchronous, which is worth far more than 40 bytes.
 *
 * ## The dimensions are measured, not authored
 *
 * A real-world size is the one J1 field nobody should type. Each model's native
 * bounding box is computed here by walking its glTF scene graph, transforming
 * each primitive's own `POSITION` accessor bounds by that node's world matrix
 * and taking the union - which is what the accessor `min`/`max` are for, and
 * which survives Draco compression because the extension replaces the buffer
 * view and leaves the accessor's metadata alone.
 *
 * That matters beyond the drawer. `Item.initObject` multiplies every model whose
 * half-extent is under 1.0 by **300**, under a comment calling itself an ugly
 * hack, and RM-009 U-3 measured it wrong and assigned the fix here. A per-item
 * measured size is the thing that replaces it.
 *
 * ## Usage
 *
 *   node tools/split-catalog.mjs            rewrite both generated files
 *   node tools/split-catalog.mjs --check    verify them, touch nothing
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src/catalog/catalog.json');
const SOURCES = join(ROOT, 'src/catalog/sources.json');
const INDEX = join(ROOT, 'src/catalog/catalog-index.json');
const DETAIL = join(ROOT, 'src/catalog/catalog-detail.json');
const CHECK = process.argv.includes('--check');

/**
 * What the grid needs before anybody clicks, plus what `addItem` needs to place
 * the thing. Everything else goes to the detail.
 */
const INDEX_KEYS = ['name', 'image', 'model', 'type', 'format', 'room', 'tags', 'lamp'];

/**
 * A model's glTF JSON, whether it is packed in a `.glb` or is one.
 *
 * Three of this catalog's 168 rows are plain `.gltf` - the duck, the ceiling fan
 * and the chandelier - and reading only the binary container left them
 * unmeasured. The accessor bounds are in the JSON either way, and where the
 * buffers live does not matter to a bounding box.
 */
function modelJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546C67)
	{
		return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
	}
	try
	{
		return JSON.parse(buffer.toString('utf8'));
	}
	catch
	{
		// A model this tool cannot read is reported as unmeasured rather than
		// throwing: the split still has to produce an index.
		return null;
	}
}

/** Column-major 4x4 multiply, in glTF's own storage order. */
function multiply(a, b)
{
	const out = new Array(16).fill(0);
	for (let column = 0; column < 4; column++)
	{
		for (let row = 0; row < 4; row++)
		{
			let sum = 0;
			for (let k = 0; k < 4; k++)
			{
				sum += a[(k * 4) + row] * b[(column * 4) + k];
			}
			out[(column * 4) + row] = sum;
		}
	}
	return out;
}

/** A node's local matrix, from `matrix` or from TRS, exactly as glTF defines it. */
function localMatrix(node)
{
	if (node.matrix)
	{
		return node.matrix.slice();
	}
	const [tx, ty, tz] = node.translation || [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale || [1, 1, 1];
	// Quaternion to a rotation basis, then scaled per column - the same
	// composition three's `Matrix4.compose` performs.
	const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
	const xx = qx * x2, xy = qx * y2, xz = qx * z2;
	const yy = qy * y2, yz = qy * z2, zz = qz * z2;
	const wx = qw * x2, wy = qw * y2, wz = qw * z2;
	return [
		(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
		(xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
		(xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
		tx, ty, tz, 1,
	];
}

function apply(matrix, point)
{
	return [
		(matrix[0] * point[0]) + (matrix[4] * point[1]) + (matrix[8] * point[2]) + matrix[12],
		(matrix[1] * point[0]) + (matrix[5] * point[1]) + (matrix[9] * point[2]) + matrix[13],
		(matrix[2] * point[0]) + (matrix[6] * point[1]) + (matrix[10] * point[2]) + matrix[14],
	];
}

/**
 * The model's bounding box in its own units, with the scene graph applied.
 *
 * All eight corners of every primitive's box are transformed rather than the two
 * extremes: a rotated node's box is not the rotation of its min and max, and
 * three of this catalog's kits rotate their meshes.
 *
 * @param {Object} json A glTF JSON chunk.
 * @returns {?{min: Array<number>, max: Array<number>}}
 */
export function modelBounds(json)
{
	if (!json || !Array.isArray(json.nodes))
	{
		return null;
	}
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	let found = false;

	const walk = (index, parent) =>
	{
		const node = json.nodes[index];
		if (!node)
		{
			return;
		}
		const world = multiply(parent, localMatrix(node));
		const mesh = (node.mesh === undefined) ? null : json.meshes[node.mesh];
		for (const primitive of (mesh && mesh.primitives) || [])
		{
			const accessor = json.accessors[primitive.attributes && primitive.attributes.POSITION];
			if (!accessor || !accessor.min || !accessor.max)
			{
				continue;
			}
			for (let corner = 0; corner < 8; corner++)
			{
				const point = apply(world, [
					(corner & 1) ? accessor.max[0] : accessor.min[0],
					(corner & 2) ? accessor.max[1] : accessor.min[1],
					(corner & 4) ? accessor.max[2] : accessor.min[2],
				]);
				for (let axis = 0; axis < 3; axis++)
				{
					min[axis] = Math.min(min[axis], point[axis]);
					max[axis] = Math.max(max[axis], point[axis]);
				}
				found = true;
			}
		}
		for (const child of node.children || [])
		{
			walk(child, world);
		}
	};

	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const roots = (json.scenes && json.scenes[json.scene || 0] && json.scenes[json.scene || 0].nodes)
		|| json.nodes.map((_, index) => index);
	for (const root of roots)
	{
		walk(root, identity);
	}
	return found ? {min, max} : null;
}

/**
 * A model's real-world size is its authored size times a number, and that number
 * is a property of the **kit**, not of the model.
 *
 * ## What this replaced, and why
 *
 * J1's first slice guessed it from the model's own extent: under 2 units meant
 * metres and x100, over 40 meant centimetres and x1. The two populations it
 * found are real - the gap between them is 28-fold - but **the factor for the
 * small one was wrong**, and the sanity check that was supposed to catch that
 * was run on the two items least able to discriminate. A bathroom basin at 34 cm
 * and a stack of books at 15 are both plausible; so are the same two at 68 and
 * 30. Neither reading can be told from the other by looking at a basin.
 *
 * What tells them apart is architecture, because architecture has standard
 * sizes. `floorFull` is exactly 1.000 x 1.000 units and `wall` is 1.000 x 1.290:
 * at x100 that is a room tile one metre square under a **1.29 m ceiling**, which
 * nobody has ever built. Six standard heights then agree on the factor to
 * within 5 %:
 *
 *   kitchen base unit  0.450 u   x200.0 for 90 cm
 *   bar stool          0.435 u   x200.0 for 87 cm
 *   door frame         1.010 u   x201.1 for 203 cm
 *   round table        0.367 u   x204.5 for 75 cm
 *   fridge             0.920 u   x195.7 for 180 cm
 *   desk               0.384 u   x195.1 for 75 cm
 *
 * **x200**, which makes the kit's floor tile 2 m square and its wall 2.58 m tall,
 * and which is the round number a modular kit is built on. And the cross-check
 * that costs nothing: at x200 this kit's door frame is **97.2 cm** wide, while
 * the blueprint3d door - a different kit, authored in centimetres, measured
 * independently - is **97.1**. Two catalogs agreeing on the width of a door to
 * one millimetre is not a coincidence a heuristic produced.
 *
 * ## So it is declared, not detected
 *
 * `sources.json` states `unitScale` - centimetres per authored unit - for each
 * kit, and a row may override it. That is only possible because X-1 put `source`
 * on every row in this same sprint: the provenance metadata is what makes the
 * unit knowable, and the two halves of J1 turn out to be one thing.
 *
 * Four rows override their kit, and each is a model that is not really of it:
 * the ceiling fan and the chandelier are Blender exports in centimetres, the
 * cabinet of unknown origin is on the kit's own grid, and the duck is a Khronos
 * sample asset with no real-world size at all.
 *
 * The extent rule survives only as a **sanity band**: whatever the declaration
 * says, a catalog item between 5 cm and 6 m is furniture and anything outside is
 * a declaration that is wrong. That is the check J1's first slice needed and did
 * not have - it verified the guess against the thing being guessed at.
 */
const MIN_EXTENT = 5;
const MAX_EXTENT = 600;

/** Three decimals, which for a centimetre is ten microns - far past meaningful. */
const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Centimetres per authored unit for one row: its own, or its kit's.
 *
 * @param {Object} item A catalog row.
 * @param {Object} sources The parsed sources.json.
 * @returns {?number} Null when neither states one, which is a failure.
 */
export function unitScale(item, sources)
{
	if (typeof item.unitScale === 'number')
	{
		return item.unitScale;
	}
	const source = ((sources && sources.sources) || {})[item.source];
	return (source && typeof source.unitScale === 'number') ? source.unitScale : null;
}

/**
 * The model's size in centimetres, or a reason it could not be had.
 *
 * @param {{min: Array<number>, max: Array<number>}} bounds
 * @param {?number} scale
 * @returns {{size: ?Object, refused: ?string}}
 */
export function sizeOf(bounds, scale)
{
	if (scale === null || !(scale > 0))
	{
		return {size: null, refused: 'no unitScale on the row or its source'};
	}
	const size = {
		w: round((bounds.max[0] - bounds.min[0]) * scale),
		h: round((bounds.max[1] - bounds.min[1]) * scale),
		d: round((bounds.max[2] - bounds.min[2]) * scale),
		scale: scale,
	};
	const extent = Math.max(size.w, size.h, size.d);
	if (extent < MIN_EXTENT || extent > MAX_EXTENT)
	{
		return {size: null, refused: `largest extent ${round(extent)} cm is outside `
			+ `${MIN_EXTENT}-${MAX_EXTENT} cm at the declared scale of ${scale}`};
	}
	return {size: size, refused: null};
}

/**
 * The eight rooms, and why a closed list rather than free text.
 *
 * X-3 priced `room` at **+369 gzipped bytes across all 168 rows**, and that
 * price is only available because the vocabulary repeats: gzip charges for
 * novelty, so eight words used twenty times each cost a fraction of what 168
 * distinct phrases would. A closed list is therefore not tidiness - it is the
 * reason the key can live in the index at all.
 *
 * `structure` is the eighth and it is not a room. It is what the twelve wall
 * segments RM-012 measured are for, and the six openings and the panel and the
 * four flights that came out with them: things that are part of the building
 * rather than things you furnish it with. Naming them is what takes them out of
 * furniture, and it is a catalog edit rather than a feature - the drawer's
 * sections are still placement types, because that is what they are.
 */
export const ROOMS = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'office', 'utility', 'structure'];

/**
 * The fourteen tags, likewise closed, and likewise for the price.
 *
 * These are what the search box matches besides the name, so somebody looking
 * for a chair by typing "seating" finds twenty-five of them. A row carries at
 * least one and usually exactly one; the pairs are the honest cases, where a
 * bedside table is storage *and* a table.
 */
export const TAGS = ['seating', 'table', 'storage', 'bed', 'lighting', 'appliance', 'plumbing',
	'decor', 'electronics', 'textile', 'plant', 'stairs', 'opening', 'panel'];

/**
 * What every row has to carry before either file is written.
 *
 * M-29 is the acceptance gate - category, dimensions, source and licence on
 * 100 % of rows, from a measured baseline of zero - and this is the half of it
 * that runs before the data exists rather than after. A row with no room, a tag
 * nobody defined, or a source that resolves to nothing fails the run, which
 * means the generated files cannot be written in that state and the gate in
 * tests/asset-integrity.test.js cannot be reached with them.
 *
 * @param {Object} catalog
 * @param {Object} sources
 * @returns {Array<string>} One line per problem; empty when the catalog passes.
 */
export function validate(catalog, sources)
{
	const problems = [];
	const known = Object.keys((sources && sources.sources) || {});
	const names = new Map();

	for (const item of catalog.items)
	{
		const where = item.name || item.model;
		if (ROOMS.indexOf(item.room) === -1)
		{
			problems.push(`${where}: room ${JSON.stringify(item.room)} is not one of ${ROOMS.join(', ')}`);
		}
		if (!Array.isArray(item.tags) || !item.tags.length)
		{
			problems.push(`${where}: no tags`);
		}
		for (const tag of item.tags || [])
		{
			if (TAGS.indexOf(tag) === -1)
			{
				problems.push(`${where}: tag ${JSON.stringify(tag)} is not one of ${TAGS.join(', ')}`);
			}
		}
		if (known.indexOf(item.source) === -1)
		{
			problems.push(`${where}: source ${JSON.stringify(item.source)} is not in sources.json`);
		}
		// Two rows both called Chair is what RM-012 found by counting; this is what
		// stops it coming back. A name is what the drawer shows and what a saved
		// design records, so two of them are two things a person cannot tell apart.
		if (names.has(item.name))
		{
			problems.push(`${where}: name is also used by ${names.get(item.name)}`);
		}
		names.set(item.name, item.model);
	}
	return problems;
}

/**
 * Split one catalog into the two files.
 *
 * @param {Object} catalog
 * @param {Object} [sources] The provenance table, copied into the detail.
 * @returns {{index: Object, detail: Object, measured: number, unmeasured: Array<string>}}
 */
export function split(catalog, sources)
{
	const index = {
		_comment: 'GENERATED by tools/split-catalog.mjs from catalog.json. Do not edit.',
		version: catalog.version,
		itemTypes: catalog.itemTypes,
		items: [],
	};
	const detail = {
		_comment: 'GENERATED by tools/split-catalog.mjs from catalog.json. Do not edit.',
		version: catalog.version,
		// One entry per source rather than one licence string per row, and in the
		// detail rather than the index because nobody filters by licence - they
		// read it, about one item, after clicking it. Four entries against 168
		// rows, so the whole provenance table costs less than the key that would
		// have named it on every row.
		sources: (sources && sources.sources) || {},
		items: {},
	};
	const unmeasured = [];
	const ambiguous = [];
	const units = {};
	let measured = 0;

	for (const item of catalog.items)
	{
		const row = {};
		const rest = {};
		for (const key of Object.keys(item))
		{
			if (INDEX_KEYS.indexOf(key) !== -1)
			{
				row[key] = item[key];
			}
			else
			{
				rest[key] = item[key];
			}
		}
		index.items.push(row);

		const path = join(ROOT, 'public', item.model);
		const bounds = existsSync(path) ? modelBounds(modelJson(path)) : null;
		if (!bounds)
		{
			unmeasured.push(item.name);
		}
		else
		{
			// Width, height and depth in **centimetres**, which is the unit
			// everything downstream of the model layer works in. `scale` records
			// how many centimetres one authored unit is, so the conversion is
			// visible in the file and can be undone by a reader rather than
			// inferred again - and so `Item.initObject` can apply it instead of
			// guessing, which is what RM-009 U-3 assigned to this sprint.
			const scale = unitScale(item, sources);
			const measurement = sizeOf(bounds, scale);
			if (measurement.size)
			{
				rest.size = measurement.size;
				units[scale] = (units[scale] || 0) + 1;
				measured++;
			}
			else
			{
				ambiguous.push(`${item.name}: ${measurement.refused}`);
			}
		}

		if (Object.keys(rest).length)
		{
			detail.items[item.model] = rest;
		}
	}

	return {index, detail, measured, unmeasured, ambiguous, units};
}

function serialise(value)
{
	return JSON.stringify(value, null, '\t') + '\n';
}

/**
 * Run only when invoked as a command, so a test can import `split()` without
 * the module rewriting two files as a side effect - the same guard
 * `check-budget.mjs` carries, and for the same reason.
 */
function main()
{
	const catalog = JSON.parse(readFileSync(SOURCE, 'utf8'));
	const sources = JSON.parse(readFileSync(SOURCES, 'utf8'));

	const problems = validate(catalog, sources);
	if (problems.length)
	{
		console.error(`${problems.length} row(s) in catalog.json are not ready to be split:`);
		problems.forEach((entry) => console.error(`  ${entry}`));
		process.exit(1);
	}

	const result = split(catalog, sources);

	if (result.ambiguous.length)
	{
		// Loud rather than guessed. A row with no declared scale, or one whose
		// declared scale produces something that is not furniture, is a row whose
		// size nobody has established - and writing a number for it anyway is how
		// a ceiling ends up 1.29 m high for eight months.
		console.error(`${result.ambiguous.length} model(s) have no size this tool will stand behind:`);
		result.ambiguous.forEach((entry) => console.error(`  ${entry}`));
		process.exit(1);
	}
	const files = [[INDEX, serialise(result.index)], [DETAIL, serialise(result.detail)]];

	if (CHECK)
	{
		let failed = false;
		for (const [path, text] of files)
		{
			const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
			if (current !== text)
			{
				console.error(`${path.slice(ROOT.length + 1)} is out of date. Run \`npm run catalog\`.`);
				failed = true;
			}
		}
		if (failed)
		{
			process.exit(1);
		}
		console.log(`catalog split is up to date (${result.index.items.length} rows, ${result.measured} measured, `
			+ `${Object.keys(result.detail.sources).length} sources).`);
	}
	else
	{
		for (const [path, text] of files)
		{
			writeFileSync(path, text);
		}
		console.log(`catalog split: ${result.index.items.length} rows, ${result.measured} measured`
			+ ` (${Object.entries(result.units).map(([unit, n]) => `${n} at x${unit}`).join(', ')})`
			+ (result.unmeasured.length ? `, ${result.unmeasured.length} unmeasured (${result.unmeasured.join(', ')})` : '')
			+ `; ${Object.keys(result.detail.sources).length} sources`);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
