// @vitest-environment jsdom
/**
 * RM-014 L4: drawing the plan with no pointer (finding Z-5).
 *
 * Z-5 measured that the floorplanner attaches five pointer listeners and a
 * `dblclick` to its canvas and two key listeners to `document` that between
 * them handle Escape and Shift - so a plan could be drawn only with a hand on a
 * mouse. These pin the other half.
 *
 * ## What is actually being tested
 *
 * Almost none of this is drawing code, and that is the claim. The keyboard path
 * moves a point and presses it through the same `mousedown`/`mousemove`/
 * `mouseup` a pointer goes through, so snapping, alignment guides, the undo
 * entry a drag commits on release and RM-013 K2's read-only guards are
 * *inherited*. The tests below are therefore mostly about the seam: that the
 * cursor projects to the same place it draws, that a press is a press, and that
 * the guards which were never told about the keyboard still hold.
 */
import {beforeEach, afterEach, describe, expect, it} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D, CURSOR_COARSE_STEPS} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, snapTolerance} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;

/** The grid step, which is also the fine cursor step. */
function step()
{
	return Configuration.getNumericValue(snapTolerance);
}

/**
 * The canvas is deliberately NOT at the origin.
 *
 * `_cursorEvent` adds the element's `getBoundingClientRect()` offset and
 * `mousemove` subtracts it again; with the pane at (0, 0) a version that
 * dropped both would round-trip perfectly and every assertion here would still
 * pass. 137 and 89 are arbitrary, and the point is only that they are not zero.
 */
const PANE = {left: 137, top: 89, width: 1000, height: 800};

function build()
{
	const {canvas} = buildFloorplannerDom(window, PANE);
	const floorplan = new Floorplan();
	const planner = new Floorplanner2D(canvas, floorplan);
	return {planner, floorplan, canvas};
}

function firePointer(target, type, {clientX = 0, clientY = 0} = {})
{
	target.dispatchEvent(new window.PointerEvent(type, {
		clientX, clientY, pointerType: 'mouse', bubbles: true, cancelable: true,
	}));
}

beforeEach(() =>
{
	resetAll();
	Configuration.setValue(configDimUnit, dimCentiMeter);
	document.body.innerHTML = '';
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	clock = installFrameClock(window);
});

afterEach(() =>
{
	clock.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('the plan cursor', () =>
{
	it('is not on screen until a key asks for it', () =>
	{
		const {planner} = build();
		expect(planner.cursorVisible).toBe(false);
		expect(planner.cursorPoint()).toBeNull();
		planner.dispose();
	});

	it('the first arrow key reveals it without also moving it', () =>
	{
		const {planner} = build();

		expect(planner.moveCursor(1, 0, false)).toBe(false);
		expect(planner.cursorVisible).toBe(true);
		const first = planner.cursorPoint();

		expect(planner.moveCursor(1, 0, false)).toBe(true);
		expect(planner.cursorPoint().x).toBe(first.x + step());
		expect(planner.cursorPoint().y).toBe(first.y);
		planner.dispose();
	});

	it('moves by the grid step, and by four of them with shift', () =>
	{
		const {planner} = build();
		planner.startCursor();
		const from = planner.cursorPoint();

		planner.moveCursor(0, 1, false);
		expect(planner.cursorPoint().y).toBe(from.y + step());

		planner.moveCursor(0, 1, true);
		expect(planner.cursorPoint().y).toBe(from.y + step() + (step() * CURSOR_COARSE_STEPS));
		planner.dispose();
	});

	/**
	 * The property that makes the whole approach safe: the ring the view draws
	 * and the point the press lands on are one number through a function and its
	 * inverse, not two computations kept in agreement by hand.
	 */
	it('projects to the same place it draws, to within a float', () =>
	{
		const {planner} = build();
		planner.startCursor();

		for (const [dx, dy] of [[1, 0], [0, 1], [-1, -1], [3, -2]])
		{
			planner.moveCursor(dx, dy, false);
			expect(planner.mouseX).toBeCloseTo(planner.cursorX, 9);
			expect(planner.mouseY).toBeCloseTo(planner.cursorY, 9);
		}
		planner.dispose();
	});

	it('a press in drawing mode places a corner, and two of them make a wall', () =>
	{
		const {planner, floorplan} = build();
		planner.setMode(floorplannerModes.DRAW);

		planner.startCursor();
		planner.pressCursor();
		expect(floorplan.getCorners().length).toBe(1);
		expect(floorplan.getWalls().length).toBe(0);

		planner.moveCursor(4, 0, false);
		planner.pressCursor();
		expect(floorplan.getCorners().length).toBe(2);
		expect(floorplan.getWalls().length).toBe(1);
		planner.dispose();
	});

	it('draws a closed room with nothing but keys', () =>
	{
		const {planner, floorplan} = build();
		planner.setMode(floorplannerModes.DRAW);

		// Four presses around a square, then back onto the first corner - which is
		// how the pointer closes a room too, by landing inside the snap tolerance
		// of a corner that already exists.
		planner.startCursor();
		planner.pressCursor();
		planner.moveCursor(4, 0, false);
		planner.pressCursor();
		planner.moveCursor(0, 4, false);
		planner.pressCursor();
		planner.moveCursor(-4, 0, false);
		planner.pressCursor();
		planner.moveCursor(0, -4, false);
		planner.pressCursor();

		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(4);
		floorplan.update();
		expect(floorplan.getRooms().length).toBe(1);
		planner.dispose();
	});

	it('space picks a corner up, arrows carry it, and space puts it down', () =>
	{
		const {planner, floorplan} = build();
		planner.setMode(floorplannerModes.DRAW);
		planner.startCursor();
		planner.pressCursor();
		planner.moveCursor(4, 0, false);
		planner.pressCursor();

		const moved = floorplan.getCorners()[1];
		const startX = moved.x;

		planner.setMode(floorplannerModes.MOVE);
		// Onto the corner, so hover finds it - exactly as a pointer approach does.
		planner.placeCursor(moved.x, moved.y);

		expect(planner.toggleCursorGrab()).toBe(true);
		expect(planner.mouseDown).toBe(true);
		planner.moveCursor(0, 2, false);
		expect(planner.toggleCursorGrab()).toBe(false);
		expect(planner.mouseDown).toBe(false);

		expect(moved.y).toBeGreaterThan(0);
		expect(moved.x).toBeCloseTo(startX, 6);
		planner.dispose();
	});

	/**
	 * `placeCursor` is the one route in that does not begin with an arrow key, and
	 * the `mousemove` it ends with is load-bearing rather than tidy.
	 *
	 * Placing a corner would NOT have proved that: `mousedown` recomputes
	 * `mouseX`/`mouseY` off the event it is handed, so a corner lands in the right
	 * place with or without a preceding move. What only a move sets is the HOVER
	 * state - `activeWall` and `activeCorner` - and deleting is the mode that
	 * reads it. The first version of this test placed a corner, passed with the
	 * move deleted, and was measuring nothing.
	 */
	it('deletes the wall under a placed cursor, which only hover can find', () =>
	{
		const {planner, floorplan} = build();
		planner.setMode(floorplannerModes.DRAW);
		planner.placeCursor(0, 0);
		planner.pressCursor();
		planner.moveCursor(8, 0, false);
		planner.pressCursor();
		expect(floorplan.getWalls().length).toBe(1);

		const wall = floorplan.getWalls()[0];
		planner.setMode(floorplannerModes.DELETE);
		planner.placeCursor((wall.getStartX() + wall.getEndX()) / 2, (wall.getStartY() + wall.getEndY()) / 2);
		planner.pressCursor();

		expect(floorplan.getWalls().length).toBe(0);
		planner.dispose();
	});

	it('lets go of what it is carrying when it is put away', () =>
	{
		const {planner} = build();
		planner.setMode(floorplannerModes.MOVE);
		planner.startCursor();
		planner.toggleCursorGrab();
		expect(planner.mouseDown).toBe(true);

		// A mousedown with no matching mouseup would leave the plan dragging for
		// the life of the page.
		planner.hideCursor();
		expect(planner.mouseDown).toBe(false);
		expect(planner.cursorVisible).toBe(false);
		expect(planner.cursorCarrying).toBe(false);
		planner.dispose();
	});

	it('gets out of the way the moment a real pointer moves', () =>
	{
		const {planner, canvas} = build();
		planner.startCursor();
		expect(planner.cursorVisible).toBe(true);

		firePointer(canvas, 'pointermove', {clientX: 40, clientY: 40});
		expect(planner.cursorVisible).toBe(false);
		planner.dispose();
	});

	/**
	 * RM-013 K2's guards were written for a pointer and never told about this.
	 * They hold anyway, because there is only one path through the class - which
	 * is the entire argument for synthesising rather than reimplementing.
	 */
	it('obeys the read-only gate without the gate being told it exists', () =>
	{
		const {planner, floorplan} = build();
		planner.readOnly = true;
		planner.setMode(floorplannerModes.DRAW);

		planner.startCursor();
		planner.pressCursor();
		planner.moveCursor(4, 0, false);
		planner.pressCursor();

		expect(floorplan.getCorners().length).toBe(0);
		expect(floorplan.getWalls().length).toBe(0);
		planner.dispose();
	});

	it('is drawn over the plan, and never onto an export', () =>
	{
		const {planner} = build();
		const view = planner.view;
		let drawn = 0;
		const real = view.drawKeyboardCursor.bind(view);
		view.drawKeyboardCursor = function () {drawn += 1; return real();};

		view.draw();
		expect(drawn).toBe(0);

		planner.startCursor();
		view.draw();
		expect(drawn).toBe(1);

		view.exporting = true;
		view.draw();
		expect(drawn).toBe(1);
		planner.dispose();
	});
});
