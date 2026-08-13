/**
 * Characterization tests for the saved-file format.
 *
 * Floorplan.saveFloorplan / Floorplan.loadFloorplan (src/scripts/model/floorplan.js)
 * and Model.exportSerialized / Model.loadSerialized (src/scripts/model/model.js)
 * define the on-disk contract for every design ever saved by this library. The
 * format is frozen for the whole Vue3/Vite/three-0.185 migration, so everything
 * below asserts what the code does TODAY - including the parts that are wrong.
 * Preserved quirks are called out inline with a QUIRK comment.
 */
import {describe, it, expect, beforeEach, afterAll} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {defaultWallTexture} from '../src/scripts/model/wall.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter, dimMeter, dimMilliMeter, dimInch, dimFeetAndInch} from '../src/scripts/core/units.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {Version} from '../src/scripts/core/version.js';
import {EVENT_LOADED} from '../src/scripts/core/events.js';

import {resetAll, resetConfiguration, unseedRandom, buildPolygon, buildSquareRoom,
	round, roundDeep, normalizeIds} from './helpers/harness.js';

/** A saved plan the way it comes back off disk: no shared object identity left. */
function asFile(saved)
{
	return JSON.parse(JSON.stringify(saved));
}

/** saveFloorplan() with the display unit temporarily switched, then restored. */
function saveUnder(unit, floorplan)
{
	Configuration.setValue(configDimUnit, unit);
	var saved = asFile(floorplan.saveFloorplan());
	Configuration.setValue(configDimUnit, dimCentiMeter);
	return saved;
}

/** loadFloorplan() into a fresh Floorplan with the display unit temporarily switched. */
function loadUnder(unit, file)
{
	Configuration.setValue(configDimUnit, unit);
	var floorplan = new Floorplan();
	floorplan.loadFloorplan(file);
	Configuration.setValue(configDimUnit, dimCentiMeter);
	return floorplan;
}

/** Corner coordinates in the floorplan's own insertion order. */
function cornerXY(floorplan)
{
	return floorplan.corners.map((c) => [c.x, c.y]);
}

/** Saved corner records in the order saveFloorplan() wrote them. */
function savedCorners(saved)
{
	return Object.keys(saved.corners).map((id) => saved.corners[id]);
}

/** A single-wall plan whose wall is explicitly curved with hand-set control points. */
function curvedWallPlan()
{
	var floorplan = new Floorplan();
	var start = floorplan.newCorner(0, 0);
	var end = floorplan.newCorner(400, 0);
	var wall = floorplan.newWall(start, end);
	wall.wallType = WallTypes.CURVED;
	wall.a = {x: 100, y: 150};
	wall.b = {x: 300, y: 150};
	floorplan.update();
	return {floorplan, wall};
}

beforeEach(() =>
{
	resetAll();
});

afterAll(() =>
{
	unseedRandom();
	resetConfiguration();
});

describe('saveFloorplan - top level schema', () =>
{
	it('writes exactly eight top-level keys, in a fixed order', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(Object.keys(floorplan.saveFloorplan())).toEqual([
			'version', 'corners', 'walls', 'rooms',
			'wallTextures', 'floorTextures', 'newFloorTextures', 'carbonSheet',
		]);
	});

	it('stamps version with the technical version string 0.0.2a', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(floorplan.saveFloorplan().version).toBe('0.0.2a');
		expect(Version.getTechnicalVersion()).toBe('0.0.2a');
	});

	it('writes corners as an object map and walls as an array', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(Array.isArray(saved.walls)).toBe(true);
		expect(Array.isArray(saved.corners)).toBe(false);
		expect(Object.keys(saved.corners)).toHaveLength(4);
		expect(saved.walls).toHaveLength(4);
	});

	// QUIRK: wallTextures and floorTextures are dead slots. They are initialised
	// empty and never written to, so every file on disk carries [] and {}.
	it('always writes wallTextures as an empty array', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.rooms[0].setTexture('floor.png', true, 5);
		expect(floorplan.saveFloorplan().wallTextures).toEqual([]);
	});

	it('always writes floorTextures as an empty object, even when floor textures exist', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.rooms[0].setTexture('floor.png', true, 5);
		const saved = floorplan.saveFloorplan();
		expect(saved.floorTextures).toEqual({});
		// The live data goes into newFloorTextures instead.
		expect(Object.keys(saved.newFloorTextures)).toHaveLength(1);
	});

	it('writes rooms from metaroomsdata, which is empty until a room is named', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(floorplan.saveFloorplan().rooms).toEqual({});
	});

	it('keys rooms metadata by the comma-joined corner ids of the room', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.rooms[0].name = 'Kitchen';
		const saved = floorplan.saveFloorplan();
		const keys = Object.keys(saved.rooms);
		expect(keys).toHaveLength(1);
		expect(keys[0]).toBe(floorplan.rooms[0].roomByCornersId);
		expect(keys[0].split(',')).toHaveLength(4);
		expect(saved.rooms[keys[0]]).toEqual({name: 'Kitchen'});
	});

	// QUIRK: saveFloorplan hands out live references, not copies. Mutating the
	// "saved" object mutates the floorplan it came from.
	it('aliases rooms to the live metaroomsdata object instead of copying it', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(saved.rooms).toBe(floorplan.metaroomsdata);
	});

	it('aliases newFloorTextures to the live floorTextures object instead of copying it', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(saved.newFloorTextures).toBe(floorplan.floorTextures);
	});
});

describe('saveFloorplan - wall entries', () =>
{
	it('writes exactly seven keys per wall, in a fixed order', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(Object.keys(floorplan.saveFloorplan().walls[0])).toEqual([
			'corner1', 'corner2', 'frontTexture', 'backTexture', 'wallType', 'a', 'b',
		]);
	});

	it('writes corner1/corner2 as the start and end corner ids', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(saved.walls[0].corner1).toBe(corners[0].id);
		expect(saved.walls[0].corner2).toBe(corners[1].id);
		expect(saved.walls[3].corner1).toBe(corners[3].id);
		expect(saved.walls[3].corner2).toBe(corners[0].id);
	});

	it('writes defaultWallTexture on both faces of a fresh wall', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.saveFloorplan().walls[0];
		expect(wall.frontTexture).toEqual({url: 'rooms/textures/wallmap.png', stretch: true, scale: 0});
		expect(wall.backTexture).toEqual({url: 'rooms/textures/wallmap.png', stretch: true, scale: 0});
	});

	// QUIRK: every wall face points at the SAME defaultWallTexture module
	// singleton. Retexturing one face by mutation would retexture every wall in
	// the process; the migration must keep the aliasing or fix all call sites.
	it('shares the one defaultWallTexture object across every wall face', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(saved.walls[0].frontTexture).toBe(defaultWallTexture);
		expect(saved.walls[0].backTexture).toBe(defaultWallTexture);
		expect(saved.walls[1].frontTexture).toBe(saved.walls[0].frontTexture);
	});

	it('writes the derived bezier control points a and b for a straight wall', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.saveFloorplan().walls[0];
		expect(round(wall.a.x)).toBe(141.4214);
		expect(round(wall.a.y)).toBe(141.4214);
		expect(round(wall.b.x)).toBe(258.5786);
		expect(round(wall.b.y)).toBe(141.4214);
	});

	it('writes a and b as bare {x, y} objects rather than Vector2 instances', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.saveFloorplan().walls[0];
		expect(Object.keys(wall.a)).toEqual(['x', 'y']);
		expect(Object.keys(wall.b)).toEqual(['x', 'y']);
	});

	// QUIRK: a/b are written raw, with no Dimensioning conversion, while corner
	// x/y ARE converted. In a metre-unit file the corners read 4 and the control
	// points of the same wall read 141.42 - two different units in one record.
	it('does not unit-convert a and b, unlike corner x and y', () =>
	{
		const {floorplan} = buildSquareRoom();
		const inMetres = saveUnder(dimMeter, floorplan);
		expect(savedCorners(inMetres)[1].x).toBe(4);
		expect(round(inMetres.walls[0].a.x)).toBe(141.4214);
	});

	it('skips a wall whose start corner has gone away', () =>
	{
		const {floorplan} = buildSquareRoom();
		// Reproduces the state the workaround comment at floorplan.js:554 describes.
		floorplan.walls[0].start = null;
		const saved = floorplan.saveFloorplan();
		expect(saved.walls).toHaveLength(3);
	});
});

describe('saveFloorplan - wallType is serialized as the enum symbol description', () =>
{
	it('serializes a straight wall as the string STRAIGHT', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wallType = floorplan.saveFloorplan().walls[0].wallType;
		expect(wallType).toBe('STRAIGHT');
		expect(typeof wallType).toBe('string');
	});

	it('serializes a curved wall as the string CURVED', () =>
	{
		const {floorplan} = curvedWallPlan();
		expect(floorplan.saveFloorplan().walls[0].wallType).toBe('CURVED');
	});

	// This is the whole contract with es6-enum: the file format depends on
	// Symbol.prototype.description of the enum member. Any replacement for
	// es6-enum must keep producing these exact two strings.
	it('takes the string straight off the es6-enum symbol description', () =>
	{
		expect(typeof WallTypes.STRAIGHT).toBe('symbol');
		expect(WallTypes.STRAIGHT.description).toBe('STRAIGHT');
		expect(WallTypes.CURVED.description).toBe('CURVED');
	});

	it('marks a wall CURVED when it is constructed with explicit a/b control points', () =>
	{
		const floorplan = new Floorplan();
		const start = floorplan.newCorner(0, 0);
		const end = floorplan.newCorner(400, 0);
		floorplan.newWall(start, end, {x: 100, y: 100}, {x: 300, y: 100});
		floorplan.update();
		const wall = floorplan.saveFloorplan().walls[0];
		expect(wall.wallType).toBe('CURVED');
		expect(wall.a).toEqual({x: 100, y: 100});
		expect(wall.b).toEqual({x: 300, y: 100});
	});
});

describe('saveFloorplan - corner selection comes from the walls, not from floorplan.corners', () =>
{
	it('omits a corner that no wall references', () =>
	{
		const {floorplan} = buildSquareRoom();
		const orphan = floorplan.newCorner(900, 900);
		floorplan.update();
		const saved = floorplan.saveFloorplan();
		expect(floorplan.corners).toHaveLength(5);
		expect(floorplan.corners).toContain(orphan);
		expect(Object.keys(saved.corners)).toHaveLength(4);
		expect(orphan.id in saved.corners).toBe(false);
	});

	// QUIRK / intentional workaround (floorplan.js:554-557): corners are
	// collected from wall endpoints, so a corner that fell out of the corners
	// array but is still wired to a wall IS saved.
	it('still saves a corner that has been dropped from floorplan.corners but is used by a wall', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const dropped = corners[2];
		floorplan.corners.splice(floorplan.corners.indexOf(dropped), 1);
		const saved = floorplan.saveFloorplan();
		expect(floorplan.corners).toHaveLength(3);
		expect(dropped.id in saved.corners).toBe(true);
		expect(Object.keys(saved.corners)).toHaveLength(4);
	});

	it('writes each shared corner once even though both wall endpoints are pushed', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		// 4 walls x 2 endpoints = 8 pushes, deduped by object key.
		expect(saved.walls).toHaveLength(4);
		expect(Object.keys(saved.corners)).toHaveLength(4);
	});

	it('writes exactly x, y and elevation per corner', () =>
	{
		const {floorplan} = buildSquareRoom();
		const saved = floorplan.saveFloorplan();
		expect(Object.keys(savedCorners(saved)[0])).toEqual(['x', 'y', 'elevation']);
	});
});

describe('the unit landmine - coordinates are persisted in the active display unit', () =>
{
	it('persists a centimetre plan verbatim under dimCentiMeter', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(savedCorners(saveUnder(dimCentiMeter, floorplan))).toEqual([
			{x: 0, y: 0, elevation: 250},
			{x: 400, y: 0, elevation: 250},
			{x: 400, y: 300, elevation: 250},
			{x: 0, y: 300, elevation: 250},
		]);
	});

	it('persists the very same plan 100x smaller under dimMeter', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(savedCorners(saveUnder(dimMeter, floorplan))).toEqual([
			{x: 0, y: 0, elevation: 2.5},
			{x: 4, y: 0, elevation: 2.5},
			{x: 4, y: 3, elevation: 2.5},
			{x: 0, y: 3, elevation: 2.5},
		]);
	});

	it('converts corner elevation through the display unit too', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(savedCorners(saveUnder(dimCentiMeter, floorplan))[0].elevation).toBe(250);
		expect(savedCorners(saveUnder(dimMeter, floorplan))[0].elevation).toBe(2.5);
	});

	it('round-trips faithfully when the unit matches at save and at load (cm)', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimCentiMeter, floorplan);
		expect(cornerXY(loadUnder(dimCentiMeter, file))).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
	});

	it('round-trips faithfully when the unit matches at save and at load (m)', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimMeter, floorplan);
		const reloaded = loadUnder(dimMeter, file);
		expect(cornerXY(reloaded)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
		expect(reloaded.corners[0].elevation).toBe(250);
	});

	// THE myhome1 SITUATION: a design saved while the UI was in cm, reopened
	// under the metre default, comes back 100x too big. Nothing in the file
	// records which unit was active when it was written.
	it('reads a centimetre-era file 100x too large when loaded under dimMeter', () =>
	{
		const {floorplan} = buildSquareRoom();
		const cmFile = saveUnder(dimCentiMeter, floorplan);
		expect(cornerXY(loadUnder(dimMeter, cmFile))).toEqual([[0, 0], [40000, 0], [40000, 30000], [0, 30000]]);
	});

	it('blows corner elevation up 100x as well when a cm file is loaded under dimMeter', () =>
	{
		const {floorplan} = buildSquareRoom();
		const cmFile = saveUnder(dimCentiMeter, floorplan);
		expect(loadUnder(dimMeter, cmFile).corners[0].elevation).toBe(25000);
	});

	// The mirror image is worse than a scale error. 100x too small puts the whole
	// 4x3 cm plan inside cornerTolerance (20 cm), so newCorner() merges every
	// corner into the first one and the design collapses to a single point.
	it('collapses a metre-era file to one corner when loaded under dimCentiMeter', () =>
	{
		const {floorplan} = buildSquareRoom();
		const metreFile = saveUnder(dimMeter, floorplan);
		expect(savedCorners(metreFile).map((c) => [c.x, c.y])).toEqual([[0, 0], [4, 0], [4, 3], [0, 3]]);

		const wrong = loadUnder(dimCentiMeter, metreFile);
		expect(cornerXY(wrong)).toEqual([[0, 0]]);
		expect(wrong.walls).toHaveLength(4);
		expect(wrong.rooms).toHaveLength(0);
	});

	it('re-saves that collapsed plan as four degenerate walls sharing one corner id', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const metreFile = saveUnder(dimMeter, floorplan);
		const resaved = saveUnder(dimCentiMeter, loadUnder(dimCentiMeter, metreFile));

		expect(Object.keys(resaved.corners)).toEqual([corners[0].id]);
		resaved.walls.forEach((wall) =>
		{
			expect(wall.corner1).toBe(corners[0].id);
			expect(wall.corner2).toBe(corners[0].id);
		});
	});

	it('leaves the wall control points untouched by the unit mismatch, desyncing them from the corners', () =>
	{
		const {floorplan} = curvedWallPlan();
		const cmFile = saveUnder(dimCentiMeter, floorplan);
		const wrong = loadUnder(dimMeter, cmFile);
		// Corners moved to 0..40000, the control points stayed at 100/150.
		expect(cornerXY(wrong)).toEqual([[0, 0], [40000, 0]]);
		expect([wrong.walls[0].a.x, wrong.walls[0].a.y]).toEqual([100, 150]);
	});
});

describe('the unit landmine - three decimal rounding from decimals=1000', () =>
{
	it('rounds a saved centimetre coordinate to three decimals', () =>
	{
		const {floorplan} = buildPolygon([[0, 0], [123.4567, 0], [123.4567, 200], [0, 200]]);
		expect(savedCorners(saveUnder(dimCentiMeter, floorplan))[1].x).toBe(123.457);
	});

	// QUIRK: the roadmap calls this "truncation" but Dimensioning uses
	// Math.round(decimals * value) / decimals, so the third decimal rounds UP
	// when the fourth is >= 5. Truncation would have produced 98.765.
	it('rounds rather than truncates the third decimal', () =>
	{
		const {floorplan} = buildPolygon([[0, 0], [300, 0], [300, 98.7659], [0, 98.7659]]);
		expect(savedCorners(saveUnder(dimCentiMeter, floorplan))[2].y).toBe(98.766);
	});

	it('does not recover the lost fourth decimal on load, so the cm round trip is lossy', () =>
	{
		const {floorplan} = buildPolygon([[0, 0], [123.4567, 0], [123.4567, 200], [0, 200]]);
		const file = saveUnder(dimCentiMeter, floorplan);
		expect(loadUnder(dimCentiMeter, file).corners[1].x).toBe(123.457);
	});

	// In metres the same 1/1000 budget buys only millimetres, so saving in
	// metres quantises the plan to the nearest millimetre.
	it('quantises to whole millimetres when the display unit is dimMeter', () =>
	{
		const {floorplan} = buildPolygon([[0, 0], [123.4567, 0], [123.4567, 200], [0, 200]]);
		const file = saveUnder(dimMeter, floorplan);
		expect(savedCorners(file)[1].x).toBe(1.235);
		expect(loadUnder(dimMeter, file).corners[1].x).toBe(123.5);
	});
});

describe('the unit landmine - the other display units', () =>
{
	it('writes millimetres exactly and round-trips them without drift', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimMilliMeter, floorplan);
		expect(savedCorners(file).map((c) => [c.x, c.y])).toEqual([[0, 0], [4000, 0], [4000, 3000], [0, 3000]]);
		expect(savedCorners(file)[0].elevation).toBe(2500);
		expect(cornerXY(loadUnder(dimMilliMeter, file))).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
	});

	// QUIRK: the inch pair is not a pair of inverses. cmToMeasureRaw multiplies
	// by 0.393700 while cmFromMeasureRaw multiplies by 2.5400013716002578512,
	// and both round to 3 decimals, so 400 cm comes back as 399.999 cm. Every
	// save/load cycle in inches walks the geometry.
	it('drifts by 0.001 cm through an inch round trip', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimInch, floorplan);
		expect(savedCorners(file).map((c) => [c.x, c.y])).toEqual([[0, 0], [157.48, 0], [157.48, 118.11], [0, 118.11]]);
		expect(cornerXY(loadUnder(dimInch, file))).toEqual([[0, 0], [399.999, 0], [399.999, 300], [0, 300]]);
	});

	// QUIRK: the dimFeetAndInch branch of cmToMeasureRaw is the only one that
	// skips `Math.round(decimals * ...)`, so feet files carry full float noise
	// instead of the 3-decimal values every other unit writes.
	it('writes unrounded full-precision floats under dimFeetAndInch', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimFeetAndInch, floorplan);
		expect(savedCorners(file).map((c) => [c.x, c.y])).toEqual([
			[0, 0],
			[13.123366666667998, 0],
			[13.123366666667998, 9.842525000000999],
			[0, 9.842525000000999],
		]);
		expect(savedCorners(file)[0].elevation).toBe(8.2021041666675);
	});

	it('round-trips feet exactly anyway, because the two odd constants cancel', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = saveUnder(dimFeetAndInch, floorplan);
		const reloaded = loadUnder(dimFeetAndInch, file);
		expect(cornerXY(reloaded)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
		expect(reloaded.corners[0].elevation).toBe(250);
	});
});

describe('round-trip fidelity under a fixed unit', () =>
{
	it('produces an identical save after save -> load -> save (square room)', () =>
	{
		const {floorplan} = buildSquareRoom();
		const first = asFile(floorplan.saveFloorplan());

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(first));
		const second = asFile(reloaded.saveFloorplan());

		expect(roundDeep(normalizeIds(second))).toEqual(roundDeep(normalizeIds(first)));
	});

	it('produces an identical save after save -> load -> save (L-shaped room)', () =>
	{
		const {floorplan} = buildPolygon([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]]);
		const first = asFile(floorplan.saveFloorplan());

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(first));
		const second = asFile(reloaded.saveFloorplan());

		expect(roundDeep(normalizeIds(second))).toEqual(roundDeep(normalizeIds(first)));
	});

	it('produces an identical save after save -> load -> save for a curved wall', () =>
	{
		const {floorplan} = curvedWallPlan();
		const first = asFile(floorplan.saveFloorplan());

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(first));
		const second = asFile(reloaded.saveFloorplan());

		expect(roundDeep(normalizeIds(second))).toEqual(roundDeep(normalizeIds(first)));
		expect(second.walls[0].wallType).toBe('CURVED');
	});

	it('preserves the generated corner ids verbatim across a round trip', () =>
	{
		const {floorplan} = buildSquareRoom();
		const first = asFile(floorplan.saveFloorplan());
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(first));
		expect(Object.keys(reloaded.saveFloorplan().corners)).toEqual(Object.keys(first.corners));
	});

	it('rebuilds the same rooms after a round trip', () =>
	{
		const {floorplan} = buildSquareRoom();
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(floorplan.saveFloorplan()));
		expect(reloaded.rooms).toHaveLength(1);
		expect(reloaded.walls).toHaveLength(4);
		expect(reloaded.corners).toHaveLength(4);
	});

	it('restores room names through the rooms metadata block', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.rooms[0].name = 'Kitchen';
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(asFile(floorplan.saveFloorplan()));
		expect(reloaded.rooms[0].name).toBe('Kitchen');
	});

	it('restores per-face wall textures from the file', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		file.walls[0].frontTexture = {url: 'a.png', stretch: false, scale: 3};
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		expect(reloaded.walls[0].frontTexture).toEqual({url: 'a.png', stretch: false, scale: 3});
		expect(reloaded.walls[0].backTexture).toEqual({url: 'rooms/textures/wallmap.png', stretch: true, scale: 0});
	});

	it('restores newFloorTextures into floorTextures when the key matches a live room uuid', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.rooms[0].setTexture('floor.png', true, 5);
		const file = asFile(floorplan.saveFloorplan());
		const uuid = Object.keys(file.newFloorTextures)[0];

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		expect(reloaded.floorTextures[uuid]).toEqual({url: 'floor.png', scale: 5});
	});

	// QUIRK: loadFloorplan assigns newFloorTextures by reference and then
	// update() -> updateFloorTextures() deletes every key that is not a current
	// room uuid, mutating the caller's file object in place.
	it('scrubs a floor texture whose key is not a live room uuid, mutating the loaded file object', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		file.newFloorTextures = {'not-a-room-uuid': {url: 'a.png', scale: 2}};

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		expect(reloaded.floorTextures).toEqual({});
		expect(file.newFloorTextures).toEqual({});
	});
});

describe('loadFloorplan - guards on a malformed file', () =>
{
	// CONTRADICTS the "no-op" reading of this branch: reset() runs BEFORE the
	// validity check, so a malformed file destroys whatever was loaded.
	it('wipes the existing plan before bailing out when corners is missing', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.loadFloorplan({version: '0.0.2a', walls: []});
		expect(floorplan.corners).toHaveLength(0);
		expect(floorplan.walls).toHaveLength(0);
		expect(floorplan.rooms).toHaveLength(0);
	});

	it('wipes the existing plan before bailing out when walls is missing', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.loadFloorplan({version: '0.0.2a', corners: {}});
		expect(floorplan.corners).toHaveLength(0);
		expect(floorplan.walls).toHaveLength(0);
	});

	it('wipes the existing plan before bailing out on a null file', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.loadFloorplan(null);
		expect(floorplan.corners).toHaveLength(0);
		expect(floorplan.walls).toHaveLength(0);
	});

	it('does not throw on any of those malformed inputs', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(() => floorplan.loadFloorplan(null)).not.toThrow();
		expect(() => floorplan.loadFloorplan({})).not.toThrow();
		expect(() => floorplan.loadFloorplan({corners: {}})).not.toThrow();
		expect(() => floorplan.loadFloorplan({walls: []})).not.toThrow();
	});

	it('does not dispatch EVENT_LOADED when it bails out', () =>
	{
		const floorplan = new Floorplan();
		let loaded = 0;
		floorplan.addEventListener(EVENT_LOADED, () => { loaded++; });
		floorplan.loadFloorplan(null);
		floorplan.loadFloorplan({version: '0.0.2a', walls: []});
		expect(loaded).toBe(0);
	});

	it('dispatches EVENT_LOADED exactly once on a successful load', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		const reloaded = new Floorplan();
		let loaded = 0;
		reloaded.addEventListener(EVENT_LOADED, () => { loaded++; });
		reloaded.loadFloorplan(file);
		expect(loaded).toBe(1);
	});

	it('leaves metaroomsdata undefined when the file has no rooms block', () =>
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		delete file.rooms;
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		expect(reloaded.metaroomsdata).toBeUndefined();
	});
});

describe('loadFloorplan - the a/b/wallType version gate', () =>
{
	function savedCurvedFile()
	{
		const {floorplan} = curvedWallPlan();
		return asFile(floorplan.saveFloorplan());
	}

	function loadWithVersion(version)
	{
		const file = savedCurvedFile();
		if (version === undefined)
		{
			delete file.version;
		}
		else
		{
			file.version = version;
		}
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		return reloaded.walls[0];
	}

	it('applies a, b and wallType when the file version is exactly 0.0.2a', () =>
	{
		const wall = loadWithVersion('0.0.2a');
		expect(wall.wallType).toBe(WallTypes.CURVED);
		expect([wall.a.x, wall.a.y]).toEqual([100, 150]);
		expect([wall.b.x, wall.b.y]).toEqual([300, 150]);
	});

	it('applies them for an OLDER file version too', () =>
	{
		const wall = loadWithVersion('0.0.1');
		expect(wall.wallType).toBe(WallTypes.CURVED);
		expect([wall.a.x, wall.a.y]).toEqual([100, 150]);
	});

	// The three tests below used to assert the opposite, under "QUIRK: the
	// comparison inside isVersionHigherThan is inverted". They are the reason
	// the save format could not be versioned: a file stamped anything newer
	// than 0.0.2a had every curved wall turned straight and its control points
	// thrown away, silently. Since the format now needs a version bump for the
	// unit stamp, that had to go, and the gate reads the wall record instead of
	// the version. See the comment in floorplan.js.
	it('applies them for a NEWER file version - the version no longer decides', () =>
	{
		const wall = loadWithVersion('0.0.3');
		expect(wall.wallType).toBe(WallTypes.CURVED);
		expect([wall.a.x, wall.a.y]).toEqual([100, 150]);
	});

	it('applies them whatever the version looks like, including malformed ones', () =>
	{
		for (const version of ['0.0', '0.0.2.1', '1.0.0', '2.0.0', 'not-a-version'])
		{
			expect(loadWithVersion(version).wallType, version).toBe(WallTypes.CURVED);
		}
	});

	it('applies them when the file carries no version at all', () =>
	{
		// A file can only reach this state by hand - saveFloorplan has always
		// written a version - but if the control points are in the file they are
		// what the author meant, whatever the stamp says.
		const wall = loadWithVersion(undefined);
		expect(wall.wallType).toBe(WallTypes.CURVED);
		expect([wall.a.x, wall.a.y]).toEqual([100, 150]);
	});

	it('leaves a genuine pre-0.0.2a file straight, because it carries no control points', () =>
	{
		// This is what "no version" actually looked like: the fields did not
		// exist yet. The wall keeps the straight defaults the constructor
		// computes from the two corners, which is the behaviour every such file
		// has always had and the one that must not change.
		const file = savedCurvedFile();
		delete file.version;
		file.walls.forEach((wall) =>
		{
			delete wall.a;
			delete wall.b;
			delete wall.wallType;
		});
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);

		expect(reloaded.walls[0].wallType).toBe(WallTypes.STRAIGHT);
		expect(round(reloaded.walls[0].a.x)).toBe(141.4214);
		expect(round(reloaded.walls[0].a.y)).toBe(141.4214);
	});

	it('does not throw on a file that has a wallType but no control points', () =>
	{
		// The old gate assigned wall.a unconditionally once the version matched,
		// so this threw inside the setter on `location.x`. Third-party and
		// hand-edited files do exist.
		const file = savedCurvedFile();
		file.walls.forEach((wall) => {delete wall.a; delete wall.b;});
		const reloaded = new Floorplan();

		expect(() => reloaded.loadFloorplan(file)).not.toThrow();
		expect(reloaded.walls[0].wallType).toBe(WallTypes.CURVED);
	});

	it('coerces any wallType string that is not exactly CURVED to STRAIGHT', () =>
	{
		const file = savedCurvedFile();
		file.wallType = 'CURVED';
		file.walls[0].wallType = 'curved';
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		expect(reloaded.walls[0].wallType).toBe(WallTypes.STRAIGHT);
	});

	it('no longer consults Version at all on this path', () =>
	{
		// The point of the rewrite: whatever the comparator says about a file's
		// stamp, the curve survives. Asserted against the corrected comparator so
		// the two cannot silently drift back into agreement.
		expect(Version.isVersionHigherThan('0.0.3', '0.0.2a')).toBe(true);
		expect(Version.isVersionHigherThan('0.0.1', '0.0.2a')).toBe(false);
		expect(loadWithVersion('0.0.3').wallType).toBe(WallTypes.CURVED);
		expect(loadWithVersion('0.0.1').wallType).toBe(WallTypes.CURVED);
	});
});

describe('loadFloorplan - corner elevation', () =>
{
	function fileWithElevation(elevation)
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		Object.keys(file.corners).forEach((id) =>
		{
			if (elevation === undefined)
			{
				delete file.corners[id].elevation;
			}
			else
			{
				file.corners[id].elevation = elevation;
			}
		});
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);
		return reloaded;
	}

	it('applies a non-zero saved elevation', () =>
	{
		expect(fileWithElevation(123).corners.map((c) => c.elevation)).toEqual([123, 123, 123, 123]);
	});

	// QUIRK: the load guard is `if(corner.elevation)`, a truthiness test, so a
	// legitimately flat elevation of 0 is dropped and the default wall height
	// (250) is kept instead.
	it('ignores a saved elevation of 0 and keeps the default wall height', () =>
	{
		expect(fileWithElevation(0).corners.map((c) => c.elevation)).toEqual([250, 250, 250, 250]);
	});

	it('keeps the default wall height when the corner record has no elevation key', () =>
	{
		expect(fileWithElevation(undefined).corners.map((c) => c.elevation)).toEqual([250, 250, 250, 250]);
	});
});

describe('carbonSheet - the headless guard', () =>
{
	function fileWithCarbonSheet()
	{
		const {floorplan} = buildSquareRoom();
		const file = asFile(floorplan.saveFloorplan());
		file.carbonSheet = {
			url: 'plan.png', transparency: 0.5, x: 10, y: 20,
			anchorX: 1, anchorY: 2, width: 300, height: 400,
		};
		return file;
	}

	it('emits carbonSheet as an empty object when no sheet is attached', () =>
	{
		const {floorplan} = buildSquareRoom();
		expect(floorplan.carbonSheet).toBeNull();
		expect(floorplan.saveFloorplan().carbonSheet).toEqual({});
	});

	it('does not throw when a file carrying a carbonSheet is loaded with no 2D view attached', () =>
	{
		const reloaded = new Floorplan();
		expect(() => reloaded.loadFloorplan(fileWithCarbonSheet())).not.toThrow();
	});

	it('loads the rest of the plan normally from a file that carries a carbonSheet', () =>
	{
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(fileWithCarbonSheet());
		expect(reloaded.corners).toHaveLength(4);
		expect(reloaded.walls).toHaveLength(4);
		expect(reloaded.rooms).toHaveLength(1);
	});

	it('leaves carbonSheet null after such a load', () =>
	{
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(fileWithCarbonSheet());
		expect(reloaded.carbonSheet).toBeNull();
	});

	// QUIRK: headless load is lossy for the carbon sheet - the block is skipped
	// on load and, with no sheet attached, the next save writes {} again.
	it('drops the carbonSheet block on the next save', () =>
	{
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(fileWithCarbonSheet());
		expect(reloaded.saveFloorplan().carbonSheet).toEqual({});
	});

	it('writes the eight carbonSheet fields when a sheet-like object is attached', () =>
	{
		const {floorplan} = buildSquareRoom();
		floorplan.carbonSheet = {
			url: 'plan.png', transparency: 0.5, x: 10, y: 20,
			anchorX: 1, anchorY: 2, width: 300, height: 400,
		};
		expect(floorplan.saveFloorplan().carbonSheet).toEqual({
			url: 'plan.png', transparency: 0.5, x: 10, y: 20,
			anchorX: 1, anchorY: 2, width: 300, height: 400,
		});
	});
});

describe('Model.exportSerialized / loadSerialized', () =>
{
	it('returns a JSON string, not an object', () =>
	{
		const model = new Model('rooms/textures');
		expect(typeof model.exportSerialized()).toBe('string');
	});

	it('wraps the design as exactly {floorplan, items}', () =>
	{
		const model = new Model('rooms/textures');
		expect(Object.keys(JSON.parse(model.exportSerialized()))).toEqual(['floorplan', 'items']);
	});

	it('writes an empty items array when no items have been added', () =>
	{
		const model = new Model('rooms/textures');
		expect(JSON.parse(model.exportSerialized()).items).toEqual([]);
		expect(model.scene.getItems()).toEqual([]);
	});

	it('embeds the saveFloorplan output verbatim under floorplan', () =>
	{
		const model = new Model('rooms/textures');
		const corners = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => model.floorplan.newCorner(x, y));
		for (let i = 0; i < corners.length; i++)
		{
			model.floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
		}
		model.floorplan.update();

		const exported = JSON.parse(model.exportSerialized()).floorplan;
		expect(Object.keys(exported)).toEqual([
			'version', 'corners', 'walls', 'rooms',
			'wallTextures', 'floorTextures', 'newFloorTextures', 'carbonSheet',
		]);
		expect(roundDeep(normalizeIds(exported)))
			.toEqual(roundDeep(normalizeIds(asFile(model.floorplan.saveFloorplan()))));
	});

	it('exports an empty floorplan for a fresh model', () =>
	{
		const model = new Model('rooms/textures');
		const exported = JSON.parse(model.exportSerialized()).floorplan;
		expect(exported.corners).toEqual({});
		expect(exported.walls).toEqual([]);
	});

	it('round-trips a design through exportSerialized -> loadSerialized -> exportSerialized', () =>
	{
		const model = new Model('rooms/textures');
		const corners = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => model.floorplan.newCorner(x, y));
		for (let i = 0; i < corners.length; i++)
		{
			model.floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
		}
		model.floorplan.update();
		const json = model.exportSerialized();

		const other = new Model('rooms/textures');
		other.loadSerialized(json);
		expect(other.floorplan.corners).toHaveLength(4);
		expect(other.floorplan.walls).toHaveLength(4);
		expect(other.floorplan.rooms).toHaveLength(1);
		expect(JSON.parse(other.exportSerialized())).toEqual(JSON.parse(json));
	});

	it('throws on a serialized payload with no items array, because newRoom always iterates it', () =>
	{
		const model = new Model('rooms/textures');
		expect(() => model.loadSerialized(JSON.stringify({floorplan: null}))).toThrow();
	});
});
