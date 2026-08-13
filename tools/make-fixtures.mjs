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

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {Utils} from '../src/scripts/core/utils.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'tests', 'fixtures');

/** Deterministic id generation - see module comment. */
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
	seed(1);
	useCentimetres();

	const floorplan = new Floorplan();
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
	seed(7);
	useCentimetres();

	const floorplan = new Floorplan();
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
	seed(3);
	useCentimetres();

	const floorplan = new Floorplan();
	polygon(floorplan, [[0, 0], [400, 0], [400, 300], [0, 300]]);
	floorplan.update();
	floorplan.getRooms().forEach((room) => { room.name = 'A New Room'; });

	return {floorplan: floorplan.saveFloorplan(), items: []};
}

mkdirSync(OUT_DIR, {recursive: true});

write('simple-room.blueprint3d', buildSimple(),
	'400x300 single room - smoke subject');
write('rich-design.blueprint3d', buildRich(),
	'2 rooms, shared wall, textures, elevations, carbon sheet');
write('curved-walls.blueprint3d', buildCurved(),
	'2 curved walls - kept apart from wall-bound items (half_edge.js:298)');

console.log('\nFixtures are save format 2.0.0: canonical centimetres, stamped "units": "cm".');
