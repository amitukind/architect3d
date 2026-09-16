/**
 * Where walls meet, and how big a room is (RM-008 F2).
 *
 * M-36 is the metric this file exists for: a room's reported area equals its
 * interior polygon's area, at every wall thickness. `Room.area` used to be the
 * area between the wall *centrelines*, which is neither the inside of the room
 * nor the outside — RM-009 U-7 measured a 400 × 400 room at the default 10 cm
 * walls reporting 16.00 m² where the floor is 15.21.
 *
 * The other half of the same measurement is the join: at a corner where the
 * thickness changes, the two interior faces did not meet. That was unreachable
 * until RM-008 E2 gave walls their own thickness, which is why it had never
 * shown, and it is what `mitreDifferingOffsets` closes.
 *
 * And the half wall, which is here because building it the way RM-009 F2 drew
 * it did not work and the reason is a fact about the room detector.
 */
import {beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {Configuration, configWallThickness} from '../src/scripts/core/configuration.js';
import {resetAll} from './helpers/harness.js';

/** A square room. Every wall gets `thickness` when one is given. */
function squareRoom(size, thickness)
{
	const floorplan = new Floorplan();
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
	floorplan.update();
	if (thickness)
	{
		floorplan.getWalls().forEach((wall) => {wall.thickness = thickness;});
		floorplan.update();
	}
	return {floorplan, corners};
}

/** The shoelace area of a list of points. */
function polygonArea(points)
{
	let total = 0;
	for (let i = 0; i < points.length; i++)
	{
		const here = points[i];
		const next = points[(i + 1) % points.length];
		total += (here.x * next.y) - (next.x * here.y);
	}
	return Math.abs(total / 2);
}

beforeEach(() =>
{
	resetAll();
	Configuration.setValue(configWallThickness, 10);
});

describe('M-36 · the room is the floor', () =>
{
	it('reports the interior polygon, at the default thickness', () =>
	{
		const {floorplan} = squareRoom(400);
		const room = floorplan.getRooms()[0];

		// 390 x 390, because 10 cm of wall takes 5 cm off each side.
		expect(room.area).toBeCloseTo(152100, 6);
		expect(room.area / 10000).toBeCloseTo(15.21, 6);
	});

	it('follows the wall thickness, which the centreline figure never did', () =>
	{
		[10, 20, 40].forEach((thickness) =>
		{
			const {floorplan} = squareRoom(400, thickness);
			const room = floorplan.getRooms()[0];
			const side = 400 - thickness;

			expect(room.area, `at ${thickness} cm`).toBeCloseTo(side * side, 4);
			// And the centreline figure is the same 160000 whatever the walls are,
			// which is exactly why it is the wrong number to put on a plan.
			expect(room.centrelineArea, `at ${thickness} cm`).toBeCloseTo(160000, 4);
		});
	});

	it('equals the polygon its own interior corners describe', () =>
	{
		const {floorplan} = squareRoom(400, 30);
		const room = floorplan.getRooms()[0];

		expect(room.area).toBeCloseTo(polygonArea(room.interiorCorners), 6);
	});

	/**
	 * The centreline figure is still computed and still exposed, because it is a
	 * real number - it is what a builder measures - and only the wrong one to put
	 * on a plan.
	 */
	it('keeps the centreline area available', () =>
	{
		const {floorplan} = squareRoom(400, 40);
		const room = floorplan.getRooms()[0];

		expect(room.centrelineArea).toBeCloseTo(160000, 4);
		expect(room.centrelineArea / room.area - 1).toBeGreaterThan(0.2);
	});

	it('is zero for a room whose interior has not been derived', () =>
	{
		const floorplan = new Floorplan();
		floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(400, 0));

		expect(floorplan.getRooms()).toHaveLength(0);
	});
});

describe('two walls of different thickness meet', () =>
{
	/**
	 * RM-009 U-7, measured: `halfAngleVector` mitres with the offset of whichever
	 * half edge it was called on, so a 40 cm wall's face ended at (380, 20) and
	 * the 10 cm wall's began at (395, 5). The room's floor ran 15 cm inside the
	 * first wall's inner face.
	 */
	it('shares a point where they join', () =>
	{
		const {floorplan} = squareRoom(400);
		const walls = floorplan.getWalls();
		walls[0].thickness = 40;
		walls[1].thickness = 10;
		floorplan.update();

		const first = walls[0].frontEdge || walls[0].backEdge;
		const second = walls[1].frontEdge || walls[1].backEdge;

		expect(first.interiorEnd().x).toBeCloseTo(second.interiorStart().x, 6);
		expect(first.interiorEnd().y).toBeCloseTo(second.interiorStart().y, 6);
	});

	it('meets on both offset lines, which is what a mitre is', () =>
	{
		const {floorplan} = squareRoom(400);
		const walls = floorplan.getWalls();
		walls[0].thickness = 40;
		walls[1].thickness = 10;
		floorplan.update();

		const first = walls[0].frontEdge || walls[0].backEdge;
		const join = first.interiorEnd();

		// Wall 0 runs along y = 0 and is 40 thick, so its interior face is y = 20.
		expect(join.y).toBeCloseTo(20, 6);
		// Wall 1 runs along x = 400 and is 10 thick, so its interior face is x = 395.
		expect(join.x).toBeCloseTo(395, 6);
	});

	/**
	 * The property that keeps every frozen r98 golden and every existing design
	 * untouched: when the two offsets are equal the correction does not run, and
	 * the mitre is the one this class always computed.
	 */
	it('changes nothing when the two thicknesses are the same', () =>
	{
		const {floorplan} = squareRoom(400, 25);
		const room = floorplan.getRooms()[0];

		// Half of 25 off each side, to floating-point precision - the mitre is
		// trigonometric, so 12.500000000000004 is the honest answer and rounding it
		// in the assertion would hide a real change rather than tolerate noise.
		room.interiorCorners.forEach((point, index) =>
		{
			expect(point.x, `corner ${index} x`).toBeCloseTo(index === 1 || index === 2 ? 387.5 : 12.5, 9);
			expect(point.y, `corner ${index} y`).toBeCloseTo(index >= 2 ? 387.5 : 12.5, 9);
		});
	});
});

describe('a half wall stops below its corners', () =>
{
	it('caps the drawn height without touching the corners', () =>
	{
		const {floorplan, corners} = squareRoom(400);
		const wall = floorplan.getWalls()[0];

		wall.partialHeight = 110;

		expect(wall.drawnHeightAt(wall.getStart())).toBe(110);
		expect(wall.drawnHeightAt(wall.getEnd())).toBe(110);
		// The corners are what every other wall reads.
		expect(corners[0].elevation).toBe(250);
		expect(floorplan.getWalls()[1].drawnHeightAt(corners[1])).toBe(250);
	});

	/**
	 * The reason this is not the corner split RM-009 F2 drew. That was built and
	 * measured: two coincident corners break the cycle the room detector walks,
	 * so a half wall inside a room deleted the room.
	 */
	it('leaves the room it is part of exactly where it was', () =>
	{
		const {floorplan} = squareRoom(400);
		const before = floorplan.getRooms()[0].area;

		floorplan.getWalls()[0].partialHeight = 110;
		floorplan.update();

		expect(floorplan.getRooms()).toHaveLength(1);
		expect(floorplan.getRooms()[0].area).toBeCloseTo(before, 6);
	});

	it('never raises a wall above its corners', () =>
	{
		const {floorplan} = squareRoom(400);
		const wall = floorplan.getWalls()[0];

		wall.partialHeight = 900;

		expect(wall.drawnHeightAt(wall.getStart())).toBe(250);
	});

	it('refuses a height that would draw nothing', () =>
	{
		const {floorplan} = squareRoom(400);
		const wall = floorplan.getWalls()[0];
		wall.partialHeight = 110;

		wall.partialHeight = 0;
		wall.partialHeight = -50;
		wall.partialHeight = NaN;

		expect(wall.partialHeight).toBe(110);
	});

	it('goes back to the corners when cleared', () =>
	{
		const {floorplan} = squareRoom(400);
		const wall = floorplan.getWalls()[0];
		wall.partialHeight = 110;

		wall.partialHeight = null;

		expect(wall.partialHeight).toBeNull();
		expect(wall.drawnHeightAt(wall.getStart())).toBe(250);
	});

	it('round-trips, and writes nothing for a wall that is full height', () =>
	{
		const {floorplan} = squareRoom(400);
		const untouched = JSON.stringify(floorplan.saveFloorplan());
		expect(untouched).not.toContain('partialHeight');

		floorplan.getWalls()[0].partialHeight = 110;
		const saved = JSON.stringify(floorplan.saveFloorplan());
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(JSON.parse(saved));

		const capped = reloaded.getWalls().filter((wall) => wall.partialHeight !== null);
		expect(capped).toHaveLength(1);
		expect(capped[0].partialHeight).toBe(110);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	it('refuses a document whose half wall could not be drawn', () =>
	{
		const {floorplan} = squareRoom(400);
		const design = {floorplan: floorplan.saveFloorplan(), items: []};
		design.floorplan.walls[0].partialHeight = 0;

		const result = DesignDocument.parse(JSON.stringify(design));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('floorplan.walls[0].partialHeight');
	});
});
