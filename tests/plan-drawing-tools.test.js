// @vitest-environment jsdom
/**
 * Drawing to a number (RM-008 E2).
 *
 * Angle snapping, typed length and bearing, and the rectangle tool. The
 * acceptance E2 committed to is here: a wall drawn by typing 3.4 m at 30
 * degrees measures 3.4 m at 30 degrees in the model, in every display unit —
 * because the field the user types into is in their unit and the model is
 * always centimetres, and that conversion is exactly where this kind of feature
 * goes wrong.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D, snapToAngle, ANGLE_SNAP_DEGREES} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {Dimensioning} from '../src/scripts/core/dimensioning.js';
import {dimensioningOptions} from '../src/scripts/core/units.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	clock = installFrameClock(window);
	const dom = buildFloorplannerDom(window, {width: 1000, height: 800});
	floorplan = new Floorplan();
	planner = new Floorplanner2D(dom.canvas, floorplan);
});

afterEach(() =>
{
	planner.dispose();
	clock.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('snapToAngle', () =>
{
	it('rounds to the nearest increment and keeps the distance', () =>
	{
		const snapped = snapToAngle(0, 0, 100, 10);

		expect(snapped.angle).toBe(0);
		expect(snapped.length).toBeCloseTo(Math.sqrt(10100), 6);
		expect(snapped.x).toBeCloseTo(Math.sqrt(10100), 6);
		expect(snapped.y).toBeCloseTo(0, 10);
	});

	/**
	 * Distance is kept rather than projected onto the snapped ray. Projecting
	 * shortens the wall as the pointer swings off the increment, so the readout
	 * counts down while the hand moves further out.
	 */
	it('keeps the distance even when the pointer is far off an increment', () =>
	{
		const pointerLength = Math.sqrt((100 * 100) + (100 * 100));

		const snapped = snapToAngle(0, 0, 100, 100);

		expect(snapped.angle).toBe(45);
		expect(snapped.length).toBeCloseTo(pointerLength, 6);
	});

	it('offers the angles a building is made of', () =>
	{
		expect(ANGLE_SNAP_DEGREES).toBe(15);
		[0, 90, 45, 30, 60].forEach((angle) =>
		{
			expect(angle % ANGLE_SNAP_DEGREES).toBe(0);
		});
	});

	it('snaps about the origin it was given, not about zero', () =>
	{
		const snapped = snapToAngle(500, 500, 600, 510);

		expect(snapped.angle).toBe(0);
		expect(snapped.y).toBeCloseTo(500, 10);
	});

	it('is total for a zero-length vector', () =>
	{
		expect(snapToAngle(7, 9, 7, 9)).toEqual({x: 7, y: 9, angle: 0, length: 0});
	});
});

describe('the drawing target', () =>
{
	it('is null unless a wall is actually being drawn', () =>
	{
		expect(planner.drawTarget()).toBeNull();

		planner.setMode(floorplannerModes.DRAW);
		expect(planner.drawTarget()).toBeNull();

		planner.lastNode = floorplan.newCorner(0, 0);
		planner.targetX = 100;
		planner.targetY = 0;
		expect(planner.drawTarget()).not.toBeNull();
	});

	it('reports the length and the bearing from the last corner', () =>
	{
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);
		planner.targetX = 0;
		planner.targetY = 300;

		const target = planner.drawTarget();

		expect(target.length).toBeCloseTo(300, 6);
		expect(target.angle).toBeCloseTo(90, 6);
	});

	it('moves to an exact length and bearing when told', () =>
	{
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);

		expect(planner.setDrawTarget(340, 30)).toBe(true);

		expect(planner.targetX).toBeCloseTo(340 * Math.cos(Math.PI / 6), 6);
		expect(planner.targetY).toBeCloseTo(340 * Math.sin(Math.PI / 6), 6);
	});

	it('keeps the bearing when only a length is given, and the length when only a bearing is', () =>
	{
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);
		planner.targetX = 100;
		planner.targetY = 0;

		planner.setDrawTarget(250, null);
		expect(planner.drawTarget().length).toBeCloseTo(250, 6);
		expect(planner.drawTarget().angle).toBeCloseTo(0, 6);

		planner.setDrawTarget(null, 90);
		expect(planner.drawTarget().length).toBeCloseTo(250, 6);
		expect(planner.drawTarget().angle).toBeCloseTo(90, 6);
	});

	it('refuses what it cannot draw, and says so', () =>
	{
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);
		planner.targetX = 100;
		planner.targetY = 0;

		expect(planner.setDrawTarget(0, 30)).toBe(false);
		expect(planner.setDrawTarget(-5, 30)).toBe(false);
		expect(planner.setDrawTarget(NaN, 30)).toBe(false);
		expect(planner.setDrawTarget(100, NaN)).toBe(false);
		expect(planner.targetX).toBe(100);
	});

	it('refuses outside drawing mode', () =>
	{
		planner.setMode(floorplannerModes.MOVE);

		expect(planner.setDrawTarget(340, 30)).toBe(false);
	});
});

describe('E2 acceptance · 3.4 m at 30 degrees, in every display unit', () =>
{
	/**
	 * The conversion is the whole risk. The field is in the user's unit and the
	 * model is always centimetres, so the same typed number has to produce the
	 * same wall whether the panel says metres, feet or millimetres.
	 */
	it.each(dimensioningOptions)('measures 340 cm at 30 degrees under %s', (unit) =>
	{
		Configuration.setValue(configDimUnit, unit);
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);

		// What the overlay does: take the number in the field, in the display
		// unit, and hand the library centimetres.
		const typed = Dimensioning.cmToMeasureRaw(340);
		planner.setDrawTarget(Dimensioning.cmFromMeasureRaw(typed), 30);
		const corner = planner.placeDrawTarget();

		const wall = floorplan.getWalls()[0];
		expect(wall.wallLength()).toBeCloseTo(340, 3);
		expect(Math.atan2(corner.y - 0, corner.x - 0) * 180 / Math.PI).toBeCloseTo(30, 6);
	});
});

describe('angle snapping', () =>
{
	beforeEach(() =>
	{
		planner.setMode(floorplannerModes.DRAW);
		planner.lastNode = floorplan.newCorner(0, 0);
	});

	/**
	 * Every point in this block sits more than `snapTolerance` (25 cm) off the
	 * axis through the last corner. Inside it, `updateTarget`'s own axis snapping
	 * has already pulled the target onto the axis before angle snapping is
	 * reached - which makes a test at, say, (100, 10) pass whether or not angle
	 * snapping does anything at all.
	 */
	it('is off unless asked for', () =>
	{
		expect(planner.anglesnapmode).toBe(false);

		planner.mouseX = 400;
		planner.mouseY = 30;
		planner.updateTarget();

		expect(planner.targetY).toBe(30);
	});

	it('rounds the direction when on', () =>
	{
		planner.anglesnapmode = true;
		planner.mouseX = 400;
		planner.mouseY = 30;

		planner.updateTarget();

		// 4.29 degrees rounds to 0.
		expect(planner.targetY).toBeCloseTo(0, 6);
		expect(planner.drawTarget().length).toBeCloseTo(Math.sqrt((400 * 400) + (30 * 30)), 6);
	});

	/**
	 * The two constrain different things - grid snapping the position, angle
	 * snapping the direction - and a position rounded to the grid after the
	 * direction was rounded is at neither. Angle snapping wins outright.
	 */
	it('wins over grid snapping rather than fighting it', () =>
	{
		planner.anglesnapmode = true;
		planner.gridsnapmode = true;
		planner.mouseX = 137;
		planner.mouseY = 40;

		planner.updateTarget();

		// 16.3 degrees rounds to 15, and the distance is kept. Neither coordinate
		// is a multiple of the 25 cm grid, which is the point: had grid snapping
		// run afterwards, both would be.
		expect(planner.drawTarget().angle).toBeCloseTo(15, 6);
		expect(planner.drawTarget().length).toBeCloseTo(Math.sqrt((137 * 137) + (40 * 40)), 6);
		expect(planner.targetX % 25).not.toBe(0);
	});

	it('does nothing outside drawing mode', () =>
	{
		planner.anglesnapmode = true;
		planner.setMode(floorplannerModes.MOVE);
		planner.mouseX = 400;
		planner.mouseY = 30;

		planner.updateTarget();

		expect(planner.targetY).toBe(30);
	});
});

describe('the rectangle tool', () =>
{
	it('draws four corners and four walls in one batch', () =>
	{
		const corners = floorplan.newRoomFromRectangle(0, 0, 400, 300);

		expect(corners).toHaveLength(4);
		expect(floorplan.getCorners()).toHaveLength(4);
		expect(floorplan.getWalls()).toHaveLength(4);
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	it('makes the room the size it was asked for', () =>
	{
		floorplan.newRoomFromRectangle(100, 100, 500, 400);

		const xs = floorplan.getCorners().map((corner) => corner.x);
		const ys = floorplan.getCorners().map((corner) => corner.y);
		expect(Math.max(...xs) - Math.min(...xs)).toBe(400);
		expect(Math.max(...ys) - Math.min(...ys)).toBe(300);
	});

	it('works from any pair of opposite corners', () =>
	{
		expect(floorplan.newRoomFromRectangle(500, 400, 100, 100)).toHaveLength(4);
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	/**
	 * Two coincident corners are merged by `newCorner` inside `cornerTolerance`,
	 * which would leave two walls on top of each other and no room - a tool that
	 * appears to have done nothing.
	 */
	it('refuses a rectangle too thin to be a room', () =>
	{
		expect(floorplan.newRoomFromRectangle(0, 0, 400, 5)).toBeNull();
		expect(floorplan.newRoomFromRectangle(0, 0, 5, 400)).toBeNull();
		expect(floorplan.newRoomFromRectangle(0, 0, 0, 0)).toBeNull();
		expect(floorplan.newRoomFromRectangle(NaN, 0, 400, 300)).toBeNull();
		expect(floorplan.getWalls()).toHaveLength(0);
	});

	it('takes two clicks: the first anchors, the second draws', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.targetX = 0;
		planner.targetY = 0;

		expect(planner.placeRectangleCorner()).toBeNull();
		expect(planner.rectangleAnchor).toEqual({x: 0, y: 0});
		expect(floorplan.getWalls()).toHaveLength(0);

		planner.targetX = 400;
		planner.targetY = 300;
		expect(planner.placeRectangleCorner()).toHaveLength(4);
		expect(planner.rectangleAnchor).toBeNull();
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	it('stays in the tool, ready for the next room', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.targetX = 0; planner.targetY = 0;
		planner.placeRectangleCorner();
		planner.targetX = 400; planner.targetY = 300;
		planner.placeRectangleCorner();

		expect(planner.mode).toBe(floorplannerModes.RECTANGLE);
	});

	it('clears a half-drawn rectangle when the tool changes', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.targetX = 0; planner.targetY = 0;
		planner.placeRectangleCorner();

		planner.setMode(floorplannerModes.MOVE);

		expect(planner.rectangleAnchor).toBeNull();
	});

	it('clears the anchor when a rectangle is refused, rather than trapping the next click', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.targetX = 0; planner.targetY = 0;
		planner.placeRectangleCorner();
		planner.targetX = 3; planner.targetY = 3;

		expect(planner.placeRectangleCorner()).toBeNull();
		expect(planner.rectangleAnchor).toBeNull();
	});

	it('does nothing outside the tool', () =>
	{
		planner.setMode(floorplannerModes.DRAW);

		expect(planner.placeRectangleCorner()).toBeNull();
	});

	/**
	 * Through the pointer, not by calling the method.
	 *
	 * The distinction caught a real bug: `updateTarget` is the only thing that
	 * writes `targetX`/`targetY`, and it was called for DRAW and for a MOVE drag
	 * and for nothing else - so in RECTANGLE mode the target never left the
	 * origin, every rectangle was measured from (0, 0), and every one was refused
	 * as degenerate. A test that calls `placeRectangleCorner` directly sets the
	 * target itself and passes happily.
	 */
	it('draws a room from two real clicks', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		const at = (x, y, type) => new window.PointerEvent(type, {
			clientX: x, clientY: y, pointerType: 'mouse', bubbles: true,
		});

		planner.mousedown(at(100, 100, 'pointerdown'));
		planner.mouseup();
		expect(planner.rectangleAnchor).not.toBeNull();
		expect(planner.rectangleAnchor.x).toBeGreaterThan(0);

		planner.mousemove(at(500, 400, 'pointermove'));
		planner.mousedown(at(500, 400, 'pointerdown'));
		planner.mouseup();

		expect(floorplan.getWalls()).toHaveLength(4);
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(planner.rectangleAnchor).toBeNull();
	});

	it('places the first corner where a click lands, with no move before it', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.mousedown(new window.PointerEvent('pointerdown', {
			clientX: 240, clientY: 160, pointerType: 'mouse', bubbles: true,
		}));
		planner.mouseup();

		// The click was at 240 px, which is not the origin - the whole failure was
		// an anchor of (0, 0) whatever the pointer said.
		expect(planner.rectangleAnchor.x).toBeCloseTo(planner.dimensioning.pixelToCm(240), 6);
	});

	it('draws its preview without touching the design', () =>
	{
		planner.setMode(floorplannerModes.RECTANGLE);
		planner.targetX = 0; planner.targetY = 0;
		planner.placeRectangleCorner();
		planner.targetX = 400; planner.targetY = 300;

		canvasStub.context.calls.length = 0;
		planner.view.draw();

		expect(canvasStub.context.calls.map((call) => call.name)).toContain('stroke');
		expect(floorplan.getWalls()).toHaveLength(0);
	});
});
