/**
 * Per-wall thickness, and the height that is not one (RM-008 E2).
 *
 * M-24 is the metric this file exists for: a thickness written by this build
 * reads back exactly, and every design that never set one re-saves
 * byte-identical. The second half is the one that matters and the one an
 * additive field usually gets wrong — a new key written unconditionally turns
 * every existing file into a different file the first time it is opened.
 *
 * The height half is a characterization, not a feature. E2 measured what
 * `Wall.height` does and it is not what its name says; the assertions below pin
 * that, so the next person to reach for it starts from a fact.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {Configuration, configWallThickness, configWallHeight} from '../src/scripts/core/configuration.js';
import {EVENT_WALL_ATTRIBUTES_CHANGED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';

/** A square room, four corners and four walls. */
function squareRoom(floorplan, size)
{
	const corners = [
		floorplan.newCorner(0, 0),
		floorplan.newCorner(size, 0),
		floorplan.newCorner(size, size),
		floorplan.newCorner(0, size),
	];
	for (let i = 0; i < 4; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	return corners;
}

beforeEach(() =>
{
	resetAll();
});

describe('a wall carries its own thickness, or the document\'s', () =>
{
	it('starts on the document\'s, and says it does not own it', () =>
	{
		Configuration.setValue(configWallThickness, 10);
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		expect(wall.thickness).toBe(10);
		expect(wall.hasOwnThickness).toBe(false);
	});

	it('takes a thickness of its own, and says so', () =>
	{
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		wall.thickness = 42;

		expect(wall.thickness).toBe(42);
		expect(wall.hasOwnThickness).toBe(true);
	});

	it('announces the change, with the values on either side', () =>
	{
		Configuration.setValue(configWallThickness, 10);
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));
		const changed = vi.fn();
		wall.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, changed);

		wall.thickness = 25;

		expect(changed).toHaveBeenCalledTimes(1);
		expect(changed.mock.calls[0][0].info).toEqual({from: 10, to: 25});
	});

	it('says nothing when the value did not move', () =>
	{
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));
		wall.thickness = 25;
		const changed = vi.fn();
		wall.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, changed);

		wall.thickness = 25;

		expect(changed).not.toHaveBeenCalled();
	});

	/**
	 * Both would collapse the two half edges onto the wall centreline and take
	 * every room derived from them with it. Refused rather than clamped: a caller
	 * that asked for zero has a bug, and quietly substituting one hides it.
	 */
	it('refuses a thickness that would collapse the wall', () =>
	{
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));
		wall.thickness = 20;

		wall.thickness = 0;
		expect(wall.thickness).toBe(20);

		wall.thickness = -5;
		expect(wall.thickness).toBe(20);

		wall.thickness = NaN;
		expect(wall.thickness).toBe(20);
	});

	it('goes back to the document\'s thickness when set to null', () =>
	{
		Configuration.setValue(configWallThickness, 10);
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));
		wall.thickness = 42;

		wall.thickness = null;

		expect(wall.thickness).toBe(10);
		expect(wall.hasOwnThickness).toBe(false);
	});

	/** Half the thickness, each way, is what pushes the two faces apart. */
	it('reaches the geometry: the half edges move with it', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const wall = floorplan.getWalls()[0];

		wall.thickness = 60;
		floorplan.update();

		// One room, so each wall has the one half edge that room walks. A wall
		// between two rooms carries both; `updateAttachedRooms` is what assigns
		// them, and either one answers this question.
		const edge = wall.frontEdge || wall.backEdge;
		expect(edge).not.toBeNull();
		expect(edge.offset).toBe(30);
	});
});

describe('M-24 · the file round-trips a thickness, and grows for nobody else', () =>
{
	/**
	 * The half that an additive field usually gets wrong. A key written
	 * unconditionally turns every file already on somebody's disk into a
	 * different file the first time they open and save it.
	 */
	it('writes nothing for a design where no thickness was set', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);

		const saved = floorplan.saveFloorplan();

		saved.walls.forEach((wall) =>
		{
			expect(wall).not.toHaveProperty('thickness');
			expect(Object.prototype.hasOwnProperty.call(wall, 'thickness')).toBe(false);
		});
	});

	it('re-saves an untouched design byte-identically', () =>
	{
		const first = new Floorplan();
		squareRoom(first, 400);
		const original = JSON.stringify(first.saveFloorplan());

		const second = new Floorplan();
		second.loadFloorplan(JSON.parse(original));

		expect(JSON.stringify(second.saveFloorplan())).toBe(original);
	});

	it('writes the thickness of the wall that has one, and only that wall', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.getWalls()[1].thickness = 33;

		const saved = floorplan.saveFloorplan();
		const written = saved.walls.filter((wall) => Object.prototype.hasOwnProperty.call(wall, 'thickness'));

		expect(written).toHaveLength(1);
		expect(written[0].thickness).toBe(33);
	});

	it('reads it back exactly, and keeps it across a second save', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.getWalls()[1].thickness = 33.5;
		const saved = JSON.stringify(floorplan.saveFloorplan());

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(JSON.parse(saved));

		const thick = reloaded.getWalls().filter((wall) => wall.hasOwnThickness);
		expect(thick).toHaveLength(1);
		expect(thick[0].thickness).toBe(33.5);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	/**
	 * A file written before E2 has no thickness on any wall. It must load, and
	 * every wall must sit on whatever the document says now - not on a number
	 * frozen into the file by a build that did not have the field.
	 */
	it('loads a pre-E2 file onto the document\'s thickness', () =>
	{
		Configuration.setValue(configWallThickness, 10);
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const old = JSON.parse(JSON.stringify(floorplan.saveFloorplan()));
		old.walls.forEach((wall) => {delete wall.thickness;});

		Configuration.setValue(configWallThickness, 20);
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(old);

		reloaded.getWalls().forEach((wall) =>
		{
			expect(wall.thickness).toBe(20);
			expect(wall.hasOwnThickness).toBe(false);
		});
	});

	it('refuses a document whose thickness could not be drawn', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const design = {floorplan: floorplan.saveFloorplan(), items: []};
		design.floorplan.walls[0].thickness = 0;

		const result = DesignDocument.parse(JSON.stringify(design));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('floorplan.walls[0].thickness');
	});

	it('accepts a document with no thickness anywhere, which is every older file', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const design = {floorplan: floorplan.saveFloorplan(), items: []};

		expect(DesignDocument.parse(JSON.stringify(design)).ok).toBe(true);
	});
});

describe('Wall.height is not the height of the wall', () =>
{
	/**
	 * Measured under E2 by building the geometry and reading its bounding box:
	 * a wall with `height` 400 and corners at 250 drew a mesh 250 tall, and
	 * raising the corners to 400 drew one 400 tall while `height` still said 250.
	 *
	 * Pinned rather than fixed. Deriving `height` from the corners is right and
	 * was written, and it fails the frozen r98 golden in
	 * `tests/geometry-rewrites.test.js`, which records a texture tiling past the
	 * top of a raised wall. That makes it a parity change with a fresh capture
	 * attached, and three r98 is gone.
	 */
	it('does not follow the corner elevations that actually draw the wall', () =>
	{
		Configuration.setValue(configWallHeight, 250);
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const wall = floorplan.getWalls()[0];

		expect(wall.height).toBe(250);

		corners[0].elevation = 400;
		corners[1].elevation = 400;

		// The corners are what `three/edge.js` reads for the wall's top.
		expect(corners[0].elevation).toBe(400);
		expect(wall.height).toBe(250);
	});

	it('is snapshotted at construction, as it always was', () =>
	{
		Configuration.setValue(configWallHeight, 250);
		const floorplan = new Floorplan();
		const before = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		Configuration.setValue(configWallHeight, 300);
		const after = floorplan.newWall(floorplan.newCorner(0, 200), floorplan.newCorner(100, 200));

		expect(before.height).toBe(250);
		expect(after.height).toBe(300);
	});
});
