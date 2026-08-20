// @vitest-environment jsdom
/**
 * A design nobody may edit (RM-013 K2).
 *
 * The finding this file exists for: **the plan had no non-editing state.** Six
 * modes, and all six mutate - MOVE included, because MOVE is what drags
 * corners, walls, footprints, dimensions and notes. So the assertions below are
 * not "the flag is set"; they drive the pointer through each mutation and check
 * that the plan did not move, and then drive it again to check that panning
 * still does.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installPointerApis, installResizeObserver}
	from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let pointerApis;
let planner;
let floorplan;
let dom;

/** A press, a drag and a release at plan coordinates, in canvas pixels. */
function drag(fromX, fromY, toX, toY)
{
	planner.mousemove({clientX: fromX, clientY: fromY, pointerType: 'mouse'});
	planner.mousedown({clientX: fromX, clientY: fromY, pointerType: 'mouse'});
	planner.mousemove({clientX: toX, clientY: toY, pointerType: 'mouse'});
	planner.mouseup();
}

/** A snapshot of everything a drag could have changed. */
function state()
{
	return JSON.stringify({
		corners: floorplan.getCorners().map((corner) => [corner.x, corner.y]),
		walls: floorplan.getWalls().length,
		rooms: floorplan.getRooms().length,
		dimensions: (floorplan.dimensions || []).length,
		annotations: (floorplan.annotations || []).length,
	});
}

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	clock = installFrameClock(window);
	dom = buildFloorplannerDom(window, {width: 800, height: 600});
	floorplan = new Floorplan();
	const corners = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => floorplan.newCorner(x, y));
	for (let i = 0; i < corners.length; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
	}
	floorplan.update();
	planner = new Floorplanner2D(dom.canvas, floorplan);
	planner.setMode(floorplannerModes.MOVE);
});

afterEach(() =>
{
	planner.dispose();
	dom.container.remove();
	clock.restore();
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
});

describe('the plan had six modes and all six mutated', () =>
{
	it('starts editable, which is what makes the rest of this file mean something', () =>
	{
		const before = state();

		drag(0, 0, 60, 40);

		// A drag from the corner at plan (0,0) moves it. If this ever stops being
		// true the read-only assertions below become vacuous.
		expect(state()).not.toBe(before);
	});

	it('refuses every tool once read-only', () =>
	{
		planner.setReadOnly(true);

		for (const mode of Object.values(floorplannerModes))
		{
			planner.setMode(mode);
			expect(planner.mode, `mode ${mode}`).toBe(floorplannerModes.MOVE);
		}
	});

	it('drags nothing, in any mode, however the mode was set', () =>
	{
		planner.setReadOnly(true);
		const before = state();

		for (const mode of Object.values(floorplannerModes))
		{
			// Straight to the field, which is what an embedder that has never heard
			// of this flag would effectively be doing.
			planner.mode = mode;
			drag(0, 0, 90, 70);
			drag(200, 150, 40, 30);
		}

		expect(state()).toBe(before);
	});

	it('deletes nothing, which is the one mutation that happens on the press', () =>
	{
		planner.setReadOnly(true);
		planner.mode = floorplannerModes.DELETE;
		const before = state();

		// Hover first, so `activeCorner` is set - deleting reads it off hover, not
		// off the press, which is why hovering is part of the gesture.
		planner.mousemove({clientX: 0, clientY: 0, pointerType: 'mouse'});
		planner.mousedown({clientX: 0, clientY: 0, pointerType: 'mouse'});
		planner.mouseup();

		expect(state()).toBe(before);
	});

	/**
	 * The half that makes it a viewer rather than a picture.
	 *
	 * It is also the reason the gate is one guard rather than a list: `mousemove`
	 * pans when nothing is grabbed, and `mousedown` returning early is exactly
	 * "nothing is grabbed".
	 */
	it('still pans', () =>
	{
		planner.setReadOnly(true);
		const origin = {x: planner.originX, y: planner.originY};

		drag(300, 300, 200, 240);

		expect(planner.originX).not.toBe(origin.x);
		expect(planner.originY).not.toBe(origin.y);
	});

	it('goes back to editable when it is told to', () =>
	{
		planner.setReadOnly(true);
		planner.setReadOnly(false);
		const before = state();

		planner.setMode(floorplannerModes.MOVE);
		drag(0, 0, 60, 40);

		expect(planner.readOnly).toBe(false);
		expect(state()).not.toBe(before);
	});
});
