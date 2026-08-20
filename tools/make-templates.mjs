/**
 * Build the starter plans, and the sample designs (RM-013 K1, gap Q-6).
 *
 *   npm run templates              rebuild public/templates/ and the manifest
 *   npm run templates -- --check   rebuild in memory and compare, touch nothing
 *
 * ## Why a tool rather than five committed JSON files
 *
 * Because a template has to *open*, and the only thing that can promise that is
 * the code that opens designs. Each plan below is built by calling the library's
 * own `Floorplan` - `newCorner`, `newWall`, `update`, then `saveFloorplan` - so
 * the file that ships is what the model produces, stamped `units: cm` and at
 * whatever `version` the build declares. A hand-written plan would be a fixture
 * that drifts the first time the format gains a key.
 *
 * It also makes the rooms real. A room in this library is a closed cycle of
 * walls found by `findRooms`, not a rectangle somebody typed, so the partitions
 * below are written as segments and the rooms are whatever closing them
 * produces. Naming is done by asking which room contains a point, through
 * `Utils.pointInPolygon2` - the predicate room detection itself uses, and the
 * one the ledger says is correct.
 *
 * ## Why they are fetched and not bundled
 *
 * RM-013 Y-5. Five distinct furnished plans gzip to 4,050 bytes, against 9,849
 * of `first-load` headroom - they fit, and they would take 41 % of the thinnest
 * line in `budget.json` for content most visitors never open. So they live under
 * `public/`, behind a manifest, exactly like the catalog packs J2 split out, and
 * M-47 asserts in the browser tier that a boot fetches none of them.
 *
 * ## The sample designs, and how their furniture is placed
 *
 * A floor item's `ypos` is the centre of the model, so an item written at zero
 * is buried to its waist. The half-height is read from the model's own
 * `POSITION` accessor bounds - which glTF requires on that accessor, Draco
 * compression included - and multiplied by the row's `unitScale`. That is a
 * measurement rather than a guess, and `tests/browser/templates.test.js` is
 * where it is checked against what three.js actually loads.
 */
import {readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Utils} from '../src/scripts/core/utils.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'templates');
const PUBLIC = join(ROOT, 'public');

/** `FloorItem`, the one placement type a sample may use. See SAMPLES. */
const FLOOR_ITEM = 1;

/** Every file this tool owns, so a withdrawn template does not linger. */
const GENERATED = /^[a-z0-9-]+\.blueprint3d$/;

/**
 * Corner and wall ids come from `Utils.guid()`, which reads `Math.random`, so
 * an unseeded run writes seven different files every time and `--check` would
 * be a gate that always fails.
 *
 * The same 32-bit LCG the test harness installs, and the same reason: the
 * distribution is irrelevant here and repeatability is the entire point. One
 * source seeded once, so the ids also stay stable across a template being added
 * *after* the ones before it - a plan's ids depend on how many corners were
 * drawn before it, which is a property of the list order and is what a review
 * diff should show.
 *
 * @param {number} seed
 */
function seedIds(seed)
{
	let state = seed >>> 0;
	Utils.setRandomSource(() =>
	{
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	});
}

/**
 * The five starter plans RM-007 names, and two furnished samples.
 *
 * Dimensions in centimetres. `walls` is a list of segments; a corner is created
 * once per distinct coordinate and reused, which is what makes a partition
 * meeting an outer wall a junction rather than a crossing. `rooms` names a room
 * by a point inside it.
 */
const PLANS = [
	{
		id: 'studio',
		name: 'Studio',
		summary: 'One room and a shower room, 33 m².',
		walls: [
			// The shell, broken at every junction so a partition lands on a corner.
			[[0, 0], [340, 0]], [[340, 0], [540, 0]], [[540, 0], [540, 180]],
			[[540, 180], [540, 620]], [[540, 620], [0, 620]], [[0, 620], [0, 0]],
			// The shower room, in the corner nearest the door.
			[[340, 0], [340, 180]], [[340, 180], [540, 180]],
		],
		rooms: [[170, 400, 'Studio'], [440, 90, 'Shower room']],
	},
	{
		id: 'one-bedroom',
		name: 'One bedroom',
		summary: 'Living and kitchen, one bedroom, one bathroom, 49 m².',
		walls: [
			[[0, 0], [430, 0]], [[430, 0], [760, 0]], [[760, 0], [760, 340]],
			[[760, 340], [760, 640]], [[760, 640], [430, 640]], [[430, 640], [0, 640]],
			[[0, 640], [0, 0]],
			[[430, 0], [430, 340]], [[430, 340], [430, 640]],
			[[430, 340], [760, 340]],
		],
		rooms: [[215, 320, 'Living and kitchen'], [595, 170, 'Bedroom'], [595, 490, 'Bathroom']],
	},
	{
		id: 'two-bedroom',
		name: 'Two bedroom',
		summary: 'Living and kitchen, two bedrooms, one bathroom, 71 m².',
		walls: [
			[[0, 0], [430, 0]], [[430, 0], [980, 0]], [[980, 0], [980, 300]],
			[[980, 300], [980, 720]], [[980, 720], [700, 720]], [[700, 720], [430, 720]],
			[[430, 720], [0, 720]], [[0, 720], [0, 0]],
			[[430, 0], [430, 300]], [[430, 300], [430, 720]],
			[[430, 300], [700, 300]], [[700, 300], [980, 300]],
			[[700, 300], [700, 720]],
		],
		rooms: [
			[215, 360, 'Living and kitchen'], [705, 150, 'Bedroom one'],
			[565, 510, 'Bedroom two'], [840, 510, 'Bathroom'],
		],
	},
	{
		id: 'three-bedroom',
		name: 'Three bedroom',
		summary: 'Living and kitchen, three bedrooms, one bathroom, 101 m².',
		walls: [
			[[0, 0], [440, 0]], [[440, 0], [800, 0]], [[800, 0], [1180, 0]],
			[[1180, 0], [1180, 430]], [[1180, 430], [1180, 860]], [[1180, 860], [800, 860]],
			[[800, 860], [440, 860]], [[440, 860], [0, 860]], [[0, 860], [0, 0]],
			[[440, 0], [440, 430]], [[440, 430], [440, 860]],
			[[440, 430], [800, 430]], [[800, 430], [1180, 430]],
			[[800, 0], [800, 430]], [[800, 430], [800, 860]],
		],
		rooms: [
			[220, 430, 'Living and kitchen'], [620, 215, 'Bedroom one'],
			[990, 215, 'Bedroom two'], [620, 645, 'Bedroom three'], [990, 645, 'Bathroom'],
		],
	},
	{
		id: 'duplex',
		name: 'Duplex',
		summary: 'An L-shaped ground floor: four rooms and a hall, 93 m².',
		walls: [
			[[0, 0], [380, 0]], [[380, 0], [900, 0]], [[900, 0], [900, 350]],
			[[900, 350], [900, 700]], [[900, 700], [560, 700]], [[560, 700], [560, 1020]],
			[[560, 1020], [260, 1020]], [[260, 1020], [0, 1020]], [[0, 1020], [0, 700]],
			[[0, 700], [0, 0]],
			[[380, 0], [380, 350]], [[380, 350], [380, 700]],
			[[380, 350], [900, 350]],
			[[0, 700], [260, 700]], [[260, 700], [380, 700]], [[380, 700], [560, 700]],
			[[260, 700], [260, 1020]],
		],
		rooms: [
			[190, 350, 'Living'], [640, 175, 'Kitchen and dining'], [640, 525, 'Study'],
			[130, 860, 'Hall'], [410, 860, 'Utility'],
		],
	},
];

/**
 * The furnished samples, over the plans above.
 *
 * `at` is the centre in centimetres and `turn` is degrees clockwise. The
 * vertical position is not given: it is measured off the model.
 *
 * ## Floor items only, and that is a rule rather than an accident
 *
 * Every row here is placement type 1, `FloorItem`, and `buildAll` refuses
 * anything else. A wall item and a wall-floor item are positioned against an
 * `Edge` - a document that names one without having chosen a wall is asking the
 * library to guess, and a sample design whose kitchen units drift a centimetre
 * into a wall is worse advertising than a sample with no wall units. Placing
 * them properly means solving "which wall, how far along" offline, which is
 * work RM-007 does not ask K1 for.
 *
 * The first check in `tests/browser/templates.test.js` is what would notice if
 * this rule were quietly broken: it loads a sample in Chromium and asserts every
 * item's measured bottom is on the floor.
 */
const SAMPLES = [
	{
		id: 'sample-studio',
		name: 'Studio, furnished',
		summary: 'The studio plan with a bed, a sofa, a kitchen run and a desk.',
		plan: 'studio',
		items: [
			['Beddouble', [130, 150], 0], ['Sidetabledrawers', [40, 60], 0],
			['Lampsquarefloor', [40, 250], 0],
			['Loungesofa', [340, 430], 180], ['Tablecoffee', [200, 430], 0],
			['Rugrounded', [250, 430], 0], ['Cabinettelevision', [60, 430], 90],
			['Kitchenfridge', [70, 560], 0], ['Kitchensink', [200, 560], 0],
			['Kitchenstove', [330, 560], 0],
			['Desk', [470, 300], 270], ['Chairdesk', [400, 300], 90],
			['Pottedplant', [500, 60], 0], ['Toilet', [380, 60], 90],
			['Rugdoormat', [480, 590], 0],
		],
	},
	{
		id: 'sample-two-bedroom',
		name: 'Two bedroom, furnished',
		summary: 'The two-bedroom plan, laid out room by room.',
		plan: 'two-bedroom',
		items: [
			['Loungesofa', [220, 120], 180], ['Loungesofalong', [60, 320], 90],
			['Tablecoffee', [220, 320], 0], ['Rugrectangle', [220, 320], 0],
			['Cabinettelevision', [220, 500], 0], ['Bookcaseopen', [60, 640], 90],
			['Kitchenfridgelarge', [370, 140], 270], ['Kitchensink', [370, 300], 270],
			['Kitchenstoveelectric', [370, 460], 270], ['Plantsmall1', [370, 620], 270],
			['Beddouble', [560, 120], 0], ['Sidetabledrawers', [460, 60], 0],
			['Cabinetbeddrawer', [900, 120], 0],
			['Bedsingle', [520, 620], 0], ['Desk', [640, 660], 180],
			['Chairdesk', [640, 580], 0],
			['Bathtub', [900, 400], 0], ['Toiletsquare', [830, 660], 180],
			['Ruground', [840, 480], 0],
		],
	},
];

/** A model's glTF JSON, whether it is packed in a `.glb` or is one. */
function modelJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67)
	{
		return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
	}
	return JSON.parse(buffer.toString('utf8'));
}

/** Multiply two column-major 4x4 matrices, `a` then `b`. */
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
				sum += a[k * 4 + row] * b[column * 4 + k];
			}
			out[column * 4 + row] = sum;
		}
	}
	return out;
}

/** A glTF node's local transform, as a column-major 4x4. */
function localMatrix(node)
{
	if (Array.isArray(node.matrix) && node.matrix.length === 16)
	{
		return node.matrix.slice();
	}
	const [tx, ty, tz] = node.translation || [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale || [1, 1, 1];
	// The standard quaternion-to-matrix, then the scale folded into its columns.
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

/** Apply a column-major 4x4 to a point. */
function apply(matrix, [x, y, z])
{
	return [
		matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
		matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
		matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
	];
}

/**
 * How big a model is, in its own authored units.
 *
 * ## Why this walks the scene graph, and what happened when it did not
 *
 * The first version unioned every `POSITION` accessor's declared `min` and `max`
 * over every mesh in the file. glTF requires both on that accessor - it is how a
 * loader sizes a scene before decoding anything, so it holds for the Draco
 * models too, which is 152 of the catalog's 168 - and for eleven of the fifteen
 * rows in the studio sample it produced exactly the number three.js settles on.
 *
 * For four it did not, and the browser tier said so item by item. `Beddouble`
 * came out 50.5 against a settled 37.5, and `Chairdesk` came out 41.76 against
 * 60.76 - too big in one direction and too small in the other, which is the
 * signature of node transforms rather than of arithmetic. A file may also carry
 * meshes no node instances, and a union over the file counts those too.
 *
 * So this walks `scenes[scene].nodes`, accumulates each node's TRS or matrix,
 * transforms all eight corners of every instanced primitive's declared box, and
 * unions what comes out. `tests/browser/templates.test.js` is where the answer
 * is checked against what three.js actually loads, which is the only authority
 * on it.
 *
 * @param {string} path
 * @returns {?{min: Array<number>, max: Array<number>}} The box, or null.
 */
export function modelBounds(path)
{
	const gltf = modelJson(path);
	const accessors = gltf.accessors || [];
	const nodes = gltf.nodes || [];
	const meshes = gltf.meshes || [];
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];

	const include = (point) =>
	{
		for (let axis = 0; axis < 3; axis++)
		{
			min[axis] = Math.min(min[axis], point[axis]);
			max[axis] = Math.max(max[axis], point[axis]);
		}
	};

	const visit = (index, parent, seen) =>
	{
		// A cycle is not legal glTF, and a file that has one should not hang a
		// build. The set is per-branch, so a node instanced twice is still counted
		// twice, which is correct.
		if (seen.has(index))
		{
			return;
		}
		const node = nodes[index];
		if (!node)
		{
			return;
		}
		const world = multiply(parent, localMatrix(node));
		const mesh = (node.mesh === undefined) ? null : meshes[node.mesh];
		for (const primitive of (mesh && mesh.primitives) || [])
		{
			const at = primitive.attributes && primitive.attributes.POSITION;
			const accessor = (at === undefined) ? null : accessors[at];
			if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max))
			{
				continue;
			}
			// All eight corners, because a rotated box's extent is not the transform
			// of its own two extremes.
			for (let corner = 0; corner < 8; corner++)
			{
				include(apply(world, [
					(corner & 1) ? accessor.max[0] : accessor.min[0],
					(corner & 2) ? accessor.max[1] : accessor.min[1],
					(corner & 4) ? accessor.max[2] : accessor.min[2],
				]));
			}
		}
		const branch = new Set(seen);
		branch.add(index);
		for (const child of node.children || [])
		{
			visit(child, world, branch);
		}
	};

	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	const scene = (gltf.scenes || [])[gltf.scene === undefined ? 0 : gltf.scene];
	for (const root of (scene && scene.nodes) || [])
	{
		visit(root, identity, new Set());
	}
	return (min[1] === Infinity) ? null : {min, max};
}

/**
 * Build one plan, and name its rooms.
 *
 * @param {Object} plan One of PLANS.
 * @returns {{floorplan: Floorplan, named: number, found: number}}
 */
export function buildPlan(plan)
{
	const floorplan = new Floorplan();
	/** @type {Map<string, Object>} */
	const corners = new Map();
	const cornerAt = ([x, y]) =>
	{
		const key = `${x},${y}`;
		if (!corners.has(key))
		{
			corners.set(key, floorplan.newCorner(x, y));
		}
		return corners.get(key);
	};
	for (const [a, b] of plan.walls)
	{
		floorplan.newWall(cornerAt(a), cornerAt(b));
	}
	floorplan.update();

	const rooms = floorplan.getRooms();
	let named = 0;
	for (const [x, y, name] of plan.rooms || [])
	{
		// `pointInPolygon2` rather than the sibling beside it: the ledger in
		// core/utils.js records that `pointInPolygon` is constant-false, and this
		// is the one room detection itself uses (room.js).
		const room = rooms.find((candidate) => Utils.pointInPolygon2({x, y},
			candidate.corners.map((corner) => ({x: corner.x, y: corner.y}))));
		if (room)
		{
			room.name = name;
			named += 1;
		}
	}
	return {floorplan, named, found: rooms.length};
}

/**
 * One item record, resting on the floor.
 *
 * @param {Object} row The catalog row.
 * @param {Array<number>} at Centre, in centimetres.
 * @param {number} turn Degrees clockwise.
 * @param {number} index
 * @returns {Object}
 */
function itemRecord(row, at, turn, index)
{
	const scale = row.unitScale || 1;
	const box = modelBounds(join(PUBLIC, row.model));
	// The record's `ypos` is the item's CENTRE, and a sample that wrote zero here
	// would ship furniture buried to its waist.
	//
	// HALF THE HEIGHT, not the midpoint of the box, and the difference is
	// measured rather than reasoned about. `Item`'s constructor calls `setScale`
	// for any document-supplied scale, `setScale` calls `resized()`, and
	// `FloorItem.resized()` assigns `position.y = halfSize.y` - so whatever a
	// document says, a floor item ends up at half its own height. Writing that
	// number is what makes the file state what the application will do with it,
	// and what makes the round-trip in the browser tier exact rather than
	// approximately right.
	const centre = box ? ((box.max[1] - box.min[1]) / 2) * scale : 0;
	return {
		id: `${row.name.toLowerCase()}-${index}`,
		item_name: row.name,
		item_type: row.type,
		format: row.format,
		model_url: row.model,
		xpos: at[0], ypos: Math.round(centre * 1000) / 1000, zpos: at[1],
		rotation: Math.round(((turn * Math.PI) / 180) * 1e6) / 1e6,
		scale_x: scale, scale_y: scale, scale_z: scale,
		fixed: false,
	};
}

/** Every catalog row this build ships, by name. */
function catalogRows()
{
	/** @type {Map<string, Object>} */
	const byName = new Map();
	const dir = join(PUBLIC, 'catalog');
	for (const file of readdirSync(dir).filter((name) => name.endsWith('.json') && !name.includes('.detail.')))
	{
		const pack = JSON.parse(readFileSync(join(dir, file), 'utf8'));
		for (const row of pack.items || [])
		{
			byName.set(row.name, row);
		}
	}
	return byName;
}

/** Build every template and sample, as `{filename: contents}`. */
export function buildAll()
{
	/** @type {Record<string, string>} */
	const files = {};
	/** @type {Array<Object>} */
	const entries = [];
	/** @type {Map<string, Object>} */
	const plans = new Map();
	const rows = catalogRows();
	const missing = [];
	seedIds(1);

	for (const plan of PLANS)
	{
		const built = buildPlan(plan);
		if (built.named !== (plan.rooms || []).length)
		{
			throw new Error(`${plan.id}: ${built.named} of ${plan.rooms.length} rooms named, `
				+ `${built.found} found. A named point is outside every closed room.`);
		}
		plans.set(plan.id, built.floorplan);
		const document = {floorplan: built.floorplan.saveFloorplan(), items: []};
		files[`${plan.id}.blueprint3d`] = JSON.stringify(document);
		entries.push({
			id: plan.id, name: plan.name, summary: plan.summary, kind: 'template',
			rooms: built.found, file: `templates/${plan.id}.blueprint3d`,
			bytes: Buffer.byteLength(files[`${plan.id}.blueprint3d`]),
		});
	}

	for (const sample of SAMPLES)
	{
		const floorplan = plans.get(sample.plan);
		if (!floorplan)
		{
			throw new Error(`${sample.id}: no plan named ${sample.plan}`);
		}
		const items = [];
		sample.items.forEach(([name, at, turn], index) =>
		{
			const row = rows.get(name);
			if (!row)
			{
				missing.push(`${sample.id}: ${name}`);
				return;
			}
			if (row.type !== FLOOR_ITEM)
			{
				missing.push(`${sample.id}: ${name} is placement type ${row.type}, not a floor item`);
				return;
			}
			items.push(itemRecord(row, at, turn, index));
		});
		const document = {floorplan: floorplan.saveFloorplan(), items};
		files[`${sample.id}.blueprint3d`] = JSON.stringify(document);
		entries.push({
			id: sample.id, name: sample.name, summary: sample.summary, kind: 'sample',
			rooms: floorplan.getRooms().length, items: items.length,
			file: `templates/${sample.id}.blueprint3d`,
			bytes: Buffer.byteLength(files[`${sample.id}.blueprint3d`]),
		});
	}

	if (missing.length)
	{
		throw new Error(`these sample rows cannot be placed: ${missing.join(', ')}`);
	}

	files['manifest.json'] = JSON.stringify({
		_comment: 'GENERATED by tools/make-templates.mjs. Do not edit.',
		version: 1,
		entries,
	}, null, '\t') + '\n';
	return files;
}

function main()
{
	const check = process.argv.includes('--check');
	const files = buildAll();

	if (!existsSync(OUT_DIR))
	{
		if (check)
		{
			console.error('public/templates/ is missing. Run `npm run templates`.');
			process.exit(1);
		}
		mkdirSync(OUT_DIR, {recursive: true});
	}

	const onDisk = existsSync(OUT_DIR)
		? readdirSync(OUT_DIR).filter((name) => GENERATED.test(name) || name === 'manifest.json')
		: [];
	const stale = onDisk.filter((name) => !(name in files));
	const differences = [];

	for (const [name, contents] of Object.entries(files))
	{
		const path = join(OUT_DIR, name);
		const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
		if (before === contents)
		{
			continue;
		}
		differences.push(before === null ? `${name} is missing` : `${name} has changed`);
		if (!check)
		{
			writeFileSync(path, contents);
		}
	}
	for (const name of stale)
	{
		differences.push(`${name} is no longer generated`);
		if (!check)
		{
			unlinkSync(join(OUT_DIR, name));
		}
	}

	const manifest = JSON.parse(files['manifest.json']);
	const total = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
	if (check)
	{
		if (differences.length)
		{
			console.error(`templates are out of date:\n  ${differences.join('\n  ')}`);
			console.error('Run `npm run templates`.');
			process.exit(1);
		}
		console.log(`templates are up to date (${manifest.entries.length} entries, ${total} bytes).`);
		return;
	}
	console.log(`wrote ${manifest.entries.length} entries, ${total} bytes:`);
	for (const entry of manifest.entries)
	{
		const extra = entry.kind === 'sample' ? `, ${entry.items} items` : '';
		console.log(`  ${entry.id.padEnd(18)} ${String(entry.bytes).padStart(6)} B  `
			+ `${entry.rooms} rooms${extra}`);
	}
}

if (process.argv[1] && process.argv[1].endsWith('make-templates.mjs'))
{
	main();
}
