/**
 * Generates the Sprint-0 baseline design fixtures under tests/fixtures/.
 *
 *   node tools/make-fixtures.mjs          (or: npm run fixtures)
 *
 * These .blueprint3d files are the frozen inputs every migration sprint
 * regresses against. They are produced through the real model layer
 * (Floorplan + Model.exportSerialized), so they are exactly what the
 * application itself would write - not hand-authored JSON.
 *
 * Determinism: corner ids come from Utils.guide(), which is seeded here, so
 * re-running this script reproduces byte-identical files. Regenerate only
 * deliberately; a surprise diff means the model layer changed.
 *
 * WHY TWO DESIGNS AND NOT ONE
 * ---------------------------
 * Curved walls and wall-bound items cannot currently share a design:
 * WallItem.placeInRoom -> closestWallEdge -> HalfEdge.distanceTo dereferences
 * an undefined `this._bezier` on its curved branch (model/half_edge.js:298),
 * so loading such a file throws. That crash is scheduled for S4; until then
 * the fixtures stay split, which also keeps each one diagnostic.
 */
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {BoxGeometry, MeshBasicMaterial} from 'three';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {ITEM_TYPE_PARAMETRIC_OPENING, ITEM_TYPE_PARAMETRIC_STAIR, ITEM_TYPE_PARAMETRIC_STRUCTURE} from '../src/scripts/items/factory.js';
import {Utils} from '../src/scripts/core/utils.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'tests', 'fixtures');

/**
 * Deterministic id generation - see module comment.
 *
 * **Call this after the `Floorplan` or `Model` exists, not before it.** RM-003
 * A1 gave every document a `DesignRuntime` and that runtime an id, so
 * constructing a plan now draws eight numbers before a single corner is made.
 * Every builder below used to seed first, which pushed the whole sequence along
 * by one id and meant this script stopped reproducing its own output - measured
 * in RM-010 G3 as: every corner id in all three fixtures shifted by one
 * position, first id gone, a new one at the end. Nothing caught it because
 * nothing re-ran the script for four programmes. Seeding last is the fix, and a
 * clean `git diff tests/fixtures` after running it is the check.
 */
function seed(value)
{
	let state = value >>> 0;
	Utils.setRandomSource(() => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	});
}

/**
 * Build the plans in CENTIMETRES, which is what the model holds.
 *
 * This used to matter for the output as well: saved coordinates were persisted
 * in whatever display unit was active, so a file was only faithful when the
 * unit matched at both ends, and the whole corpus had to pin centimetres to
 * stay readable. Save format 2.0.0 stores canonical centimetres and stamps
 * `units`, so the display unit no longer reaches the file and a consumer no
 * longer has to set anything before loading one.
 *
 * The v1 corpus under tests/fixtures/v1/ is what that used to look like, and
 * this script cannot reproduce it - see the README beside those files.
 */
function useCentimetres()
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
}

function polygon(floorplan, points)
{
	const corners = points.map(([x, y]) => floorplan.newCorner(x, y));
	for (let i = 0; i < corners.length; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
	}
	return corners;
}

function write(name, payload, description)
{
	const file = join(OUT_DIR, name);
	writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
	console.log(`wrote ${name.padEnd(28)} ${description}`);
}

/**
 * FIXTURE 1 - "rich": two rooms sharing a wall, per-surface textures, varied
 * corner elevations, a carbon sheet. The everyday regression subject.
 */
function buildRich()
{
	useCentimetres();

	const floorplan = new Floorplan();
	seed(1);
	const a = floorplan.newCorner(0, 0);
	const b = floorplan.newCorner(500, 0);
	const c = floorplan.newCorner(500, 400);
	const d = floorplan.newCorner(0, 400);
	const e = floorplan.newCorner(900, 0);
	const f = floorplan.newCorner(900, 400);

	floorplan.newWall(a, b);
	floorplan.newWall(b, c);
	floorplan.newWall(c, d);
	floorplan.newWall(d, a);
	floorplan.newWall(b, e);
	floorplan.newWall(e, f);
	floorplan.newWall(f, c);

	// Varied elevations exercise the varying-height roof/filler paths.
	a.elevation = 260;
	c.elevation = 240;
	f.elevation = 280;

	floorplan.update();

	// Non-default textures on every wall so a texture regression is visible.
	const textures = [
		{url: 'rooms/textures/marbletiles.jpg', stretch: false, scale: 300},
		{url: 'rooms/textures/light_brick.jpg', stretch: false, scale: 300},
		{url: 'rooms/textures/wallmap_yellow.png', stretch: true, scale: 0},
	];
	floorplan.getWalls().forEach((wall, i) => {
		wall.frontTexture = textures[i % textures.length];
		wall.backTexture = textures[(i + 1) % textures.length];
	});

	// Name the rooms through metaroomsdata, the same channel the UI uses.
	floorplan.getRooms().forEach((room, i) => {
		room.name = i === 0 ? 'Living Room' : 'Study';
	});

	const saved = floorplan.saveFloorplan();

	// A carbon sheet is attached by the 2D view at runtime; headless there is
	// none, so write the block directly to exercise the load-side guard.
	saved.carbonSheet = {
		url: 'rooms/textures/hardwood.png',
		transparency: 0.5,
		x: 10,
		y: 20,
		anchorX: 5,
		anchorY: 6,
		width: 800,
		height: 600,
	};

	// Floor textures keyed by Room.getUuid(), as newFloorTextures expects.
	const rooms = floorplan.getRooms();
	if (rooms.length > 0)
	{
		saved.newFloorTextures[rooms[0].getUuid()] = {url: 'rooms/textures/light_fine_wood.jpg', scale: 400};
	}
	if (rooms.length > 1)
	{
		saved.newFloorTextures[rooms[1].getUuid()] = {url: 'rooms/textures/hardwood.png', scale: 300};
	}

	return {floorplan: saved, items: []};
}

/**
 * FIXTURE 2 - "curved": kept separate from wall-bound items (see module note).
 * Exercises the bezier paths: control points, arc length, curve-line
 * intersection, and the curved branch of room area sampling.
 */
function buildCurved()
{
	useCentimetres();

	const floorplan = new Floorplan();
	seed(7);
	const corners = polygon(floorplan, [[0, 0], [600, 0], [600, 450], [0, 450]]);
	floorplan.update();

	// Curve two opposite walls so both the room-area sampling and the
	// half-edge bezier accessors are exercised.
	const walls = floorplan.getWalls();
	walls[0].wallType = WallTypes.CURVED;
	walls[2].wallType = WallTypes.CURVED;
	floorplan.update();

	floorplan.getRooms().forEach((room) => { room.name = 'Curved Hall'; });

	return {floorplan: floorplan.saveFloorplan(), items: corners.length ? [] : []};
}

/**
 * FIXTURE 3 - "simple": the smallest closed room. Fast smoke subject and the
 * one used by the round-trip tests where a large plan would obscure a diff.
 */
function buildSimple()
{
	useCentimetres();

	const floorplan = new Floorplan();
	seed(3);
	polygon(floorplan, [[0, 0], [400, 0], [400, 300], [0, 300]]);
	floorplan.update();
	floorplan.getRooms().forEach((room) => { room.name = 'A New Room'; });

	return {floorplan: floorplan.saveFloorplan(), items: []};
}

/**
 * FIXTURE 4 - "three-storey": a whole house, for the tiers to be driven through
 * (RM-010 G3).
 *
 * The other three fixtures are plans. This one is a *building*: three storeys
 * that are three whole `Floorplan`s, a flight of stairs on each of the lower
 * two, the stairwells those imply on the two upper floors, a column, a beam,
 * a door, a window and a gable roof over the lot. G3's job is to drive it
 * through save, load, undo, autosave, the plan, the 3D view and an exported
 * sheet, and none of those tiers can be driven by a design that has one floor
 * and nothing on it.
 *
 * Built through `Model` rather than through `Floorplan`, which the three above
 * do, because `levels`, `roof` and the item records only exist at that layer -
 * `Model.exportSerialized()` is what writes them, and this file is exactly what
 * it writes. The items need geometry to exist at all, so the loader is stubbed
 * with a box the same way every headless suite stubs it; nothing of that box
 * reaches the file, which records the seven numbers a parametric item is.
 */
/**
 * The smallest DOM an `Item` needs to exist in node.
 *
 * `Item`'s constructor builds two canvases for its size label - the one the 3D
 * view draws "90 x 210" onto while you drag - and node has no `document`. None
 * of it reaches the file: a saved item is its metadata and its placement. The
 * stub is a no-op 2D context and a canvas that remembers its size, which is all
 * three's `CanvasTexture` reads before something asks it to upload.
 */
function installMinimalDOM()
{
	if (globalThis.document)
	{
		return () => {};
	}
	const context = new Proxy({}, {get: (target, name) =>
	{
		if (name === 'canvas') { return target; }
		if (name === 'measureText') { return () => ({width: 0}); }
		return () => undefined;
	}});
	globalThis.document = {
		createElement: () => ({width: 0, height: 0, style: {}, getContext: () => context}),
	};
	return () => {delete globalThis.document;};
}

function buildThreeStorey()
{
	useCentimetres();
	const uninstallDOM = installMinimalDOM();

	const model = new Model('models/textures/');
	seed(11);
	// The same stub `tests/helpers/harness.js` installs. An item's *record* is
	// its metadata and its placement, neither of which comes from the mesh - but
	// `Scene.addItem` will not build an item without one.
	model.scene.setItemLoader((fileName, metadata, onLoad) =>
	{
		onLoad(new BoxGeometry(50, 50, 50), [new MeshBasicMaterial({color: 0xcccccc})]);
	});

	/** The shell every storey shares: 7 m by 9 m. */
	const shell = (floorplan) => polygon(floorplan, [[0, 0], [700, 0], [700, 900], [0, 900]]);

	/**
	 * A free-standing item, dropped at a point on the plan.
	 *
	 * Added with no position, then slid sideways. An explicit position sets
	 * `position_set`, which is what tells `initObject` -> `placeInRoom` to leave
	 * the item alone - and `placeInRoom` is what puts a floor item *on* the
	 * floor, at half its own height. The first draft passed `y: 0` and wrote a
	 * flight of stairs sunk 1.855 m into the ground; the load path then corrected
	 * it, so the file did not survive its own round trip. Only x and z are ours
	 * to choose; the height is the item's.
	 *
	 * @param {number} type @param {Object} metadata @param {{x: number, z: number}} at
	 */
	const place = (type, metadata, at) =>
	{
		model.scene.addItem(type, null, metadata);
		const item = model.level.items[model.level.items.length - 1];
		item.position.x = at.x;
		item.position.z = at.z;
	};

	/**
	 * A wall-bound item, hung on the wall nearest a point.
	 *
	 * The path `useCatalog.addItem` takes for an opening - a position and the
	 * edge it is bound to - rather than an explicit position, because a door's
	 * *height* is what that path derives (RM-009 F1) and hard-coding a y here
	 * would write a number the application does not agree with.
	 *
	 * @param {number} type @param {Object} metadata @param {{x: number, z: number}} near
	 */
	const hang = (type, metadata, floorplan, near) =>
	{
		const edge = floorplan.wallEdges().reduce((best, candidate) =>
		{
			const distance = Math.hypot(candidate.center.x - near.x, candidate.center.z - near.z);
			return (!best || distance < best.distance) ? {edge: candidate, distance} : best;
		}, null).edge;
		model.scene.addItem(type, null, metadata, null, null, null, false,
			{position: edge.center.clone(), edge: edge});
	};

	// --- Ground floor: one hall, a straight flight up the east side ----------
	shell(model.floorplan);
	model.floorplan.update();
	model.floorplan.getRooms().forEach((room) => {room.name = 'Hall';});

	// 16 treads at 250 mm going is 4 m of plan length, which is why the flight
	// runs north-south against the east wall rather than across the house.
	place(ITEM_TYPE_PARAMETRIC_STAIR,
		{itemName: 'Straight flight', itemType: ITEM_TYPE_PARAMETRIC_STAIR, resizable: true,
			stair: {shape: 'straight'}},
		{x: 600, z: 450});
	place(ITEM_TYPE_PARAMETRIC_STRUCTURE,
		{itemName: 'Column', itemType: ITEM_TYPE_PARAMETRIC_STRUCTURE, resizable: true,
			structure: {kind: 'column', section: 'round', width: 35}},
		{x: 250, z: 450});
	hang(ITEM_TYPE_PARAMETRIC_OPENING,
		{itemName: 'Door', itemType: ITEM_TYPE_PARAMETRIC_OPENING, resizable: true,
			opening: {kind: 'door'}},
		model.floorplan, {x: 350, z: 0});

	// --- First floor: a landing and a bedroom, and a quarter turn up ---------
	const first = model.addLevel({name: 'First floor', height: 280});
	// The outline carries the two corners the partition meets, because a corner
	// dropped onto an existing wall does not split it - the first draft did that
	// and the storey came back with one room instead of two.
	const outline = polygon(first.floorplan, [[0, 0], [400, 0], [700, 0], [700, 900], [0, 900], [0, 560]]);
	// A partition that closes a room, so the storey above is asked to clamp a
	// stairwell against a plan that is not one rectangle (RM-010 V-3).
	const corner = first.floorplan.newCorner(400, 560);
	first.floorplan.newWall(outline[1], corner);
	first.floorplan.newWall(corner, outline[5]);
	first.floorplan.update();
	first.floorplan.getRooms().forEach((room) =>
	{
		room.name = (room.interiorArea() < 300000) ? 'Bedroom' : 'Landing';
	});
	place(ITEM_TYPE_PARAMETRIC_STAIR,
		{itemName: 'Quarter turn, right', itemType: ITEM_TYPE_PARAMETRIC_STAIR, resizable: true,
			stair: {shape: 'l', turn: 'right'}},
		{x: 550, z: 300});
	hang(ITEM_TYPE_PARAMETRIC_OPENING,
		{itemName: 'Window', itemType: ITEM_TYPE_PARAMETRIC_OPENING, resizable: true,
			opening: {kind: 'window'}},
		first.floorplan, {x: 700, z: 300});

	// --- Second floor: a loft, one storey taller, with a beam across it ------
	const second = model.addLevel({name: 'Loft', height: 300});
	shell(second.floorplan);
	second.floorplan.update();
	second.floorplan.getRooms().forEach((room) => {room.name = 'Loft';});
	place(ITEM_TYPE_PARAMETRIC_STRUCTURE,
		{itemName: 'Downstand', itemType: ITEM_TYPE_PARAMETRIC_STRUCTURE, resizable: true,
			structure: {kind: 'beam', width: 30, depth: 30, length: 600, soffit: 240}},
		{x: 350, z: 450});

	model.setRoof({kind: 'gable', ridge: 'x', pitch: 35, overhang: 40, thickness: 20});
	model.setActiveLevel(0);

	const record = JSON.parse(model.exportSerialized());
	uninstallDOM();
	return record;
}

mkdirSync(OUT_DIR, {recursive: true});

write('simple-room.blueprint3d', buildSimple(),
	'400x300 single room - smoke subject');
write('rich-design.blueprint3d', buildRich(),
	'2 rooms, shared wall, textures, elevations, carbon sheet');
write('curved-walls.blueprint3d', buildCurved(),
	'2 curved walls - kept apart from wall-bound items (half_edge.js:298)');
write('three-storey.blueprint3d', buildThreeStorey(),
	'3 storeys, 2 flights, stairwells, a column, a beam, openings, a gable roof');

console.log('\nFixtures are save format 2.0.0: canonical centimetres, stamped "units": "cm".');
