// @vitest-environment jsdom
/**
 * Not drawing what is not on the canvas (RM-015 M2, finding AA-4).
 *
 * AA-4 made M2's cached static layer conditional on the 2D frame budget failing
 * at 400 walls, and it fired at 2.165 ms against 2. Timing every phase then said
 * the cache could not have been the fix: `drawGrid` is 0.005 ms of that frame -
 * three tenths of one per cent - and a cached static layer under the draw is a
 * cache of the grid. What the pass spends its time on is the building, and 245
 * of that fixture's 400 walls are outside the viewport.
 *
 * So these are about the boundary. A cull that is too tight crops the drawing at
 * the edge of the screen, which is a visual bug nobody sees in a screenshot of
 * the middle; a cull that is too loose does nothing. The margin is deliberately
 * two-part - see `CULL_MARGIN_CM` and `CULL_MARGIN_PIXELS` - and the tests that
 * matter most here are the ones about things that straddle the edge.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {CULL_MARGIN_CM, CULL_MARGIN_PIXELS} from '../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, scale} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

const WIDTH = 1000;
const HEIGHT = 800;

let canvasStub;
let observer;
let clock;

function build()
{
	const {canvas} = buildFloorplannerDom(window, {left: 0, top: 0, width: WIDTH, height: HEIGHT});
	const floorplan = new Floorplan();
	const planner = new Floorplanner2D(canvas, floorplan);
	// jsdom has no layout, so the view's measured size comes from the stub above.
	planner.view.canvasWidth = WIDTH;
	planner.view.canvasHeight = HEIGHT;
	return {planner, floorplan};
}

/** A square room whose corners are at the given offset. */
function room(floorplan, x, y, size)
{
	floorplan.beginBatch('load');
	const c = [
		floorplan.newCorner(x, y), floorplan.newCorner(x + size, y),
		floorplan.newCorner(x + size, y + size), floorplan.newCorner(x, y + size),
	];
	for (let k = 0; k < 4; k++) { floorplan.newWall(c[k], c[(k + 1) % 4]); }
	floorplan.endBatch();
}

/** How many times the view drew a wall during one pass. */
function wallsDrawn(planner)
{
	const view = planner.view;
	const real = view.drawWall.bind(view);
	let count = 0;
	view.drawWall = function (...args) {count += 1; return real(...args);};
	view.draw();
	view.drawWall = real;
	return count;
}

beforeEach(() =>
{
	resetAll();
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(scale, 1);
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

describe('the viewport cull', () =>
{
	it('is switched off entirely while exporting', () =>
	{
		const {planner} = build();
		expect(planner.view.cullBounds()).not.toBeNull();

		// An export draws the whole plan to a sheet through another projection and
		// has no frame budget. Culling there could only ever crop a drawing.
		planner.view.exporting = true;
		expect(planner.view.cullBounds()).toBeNull();
		planner.dispose();
	});

	it('treats a null bounds as "draw it", so every caller degrades to the old pass', () =>
	{
		const {planner} = build();
		expect(planner.view.onScreen(null, [1e9], [1e9])).toBe(true);
		planner.dispose();
	});

	it('keeps what is on the canvas and drops what is far away', () =>
	{
		const {planner} = build();
		const bounds = planner.view.cullBounds();

		expect(planner.view.onScreen(bounds, [100], [100])).toBe(true);
		expect(planner.view.onScreen(bounds, [-500000], [-500000])).toBe(false);
		expect(planner.view.onScreen(bounds, [500000], [500000])).toBe(false);
		planner.dispose();
	});

	/**
	 * The case a bounding-box test gets wrong if it asks the wrong question. A
	 * wall crossing the whole screen has BOTH endpoints outside it, so
	 * containment would cull the one wall the person is looking at.
	 */
	it('keeps a wall that crosses the screen with both ends outside it', () =>
	{
		const {planner} = build();
		const bounds = planner.view.cullBounds();
		const far = 100000;

		expect(planner.view.onScreen(bounds, [-far, far], [200, 200])).toBe(true);
		expect(planner.view.onScreen(bounds, [200, 200], [-far, far])).toBe(true);
		planner.dispose();
	});

	it('keeps something just past the edge, because its label and thickness are not', () =>
	{
		const {planner} = build();
		const bounds = planner.view.cullBounds();
		const view = planner.view;

		// One pixel beyond the right edge is still drawn: a wall there has
		// thickness, corners and a label that reach back onto the canvas.
		const justOut = view.dimensioning.pixelToCm(WIDTH + 1) + view.dimensioning.pixelToCm(view.viewmodel.originX);
		expect(view.onScreen(bounds, [justOut], [100])).toBe(true);

		// And the margin is what decides where that stops being true.
		const margin = view.dimensioning.cmToPixel(CULL_MARGIN_CM) + CULL_MARGIN_PIXELS;
		expect(bounds.right).toBeCloseTo(WIDTH + margin, 6);
		expect(bounds.left).toBeCloseTo(-margin, 6);
		planner.dispose();
	});

	it('widens the margin as the zoom does, because 40 cm is more pixels when close', () =>
	{
		const {planner} = build();
		const wide = planner.view.cullBounds();

		Configuration.setValue(scale, 4);
		const close = planner.view.cullBounds();

		// The plan-space half of the margin grows with the zoom; the screen-space
		// half does not. So the margin grows, but by less than four times.
		const wideMargin = -wide.left;
		const closeMargin = -close.left;
		expect(closeMargin).toBeGreaterThan(wideMargin);
		expect(closeMargin).toBeLessThan(wideMargin * 4);
		planner.dispose();
	});

	it('draws every wall of a plan that fits, and none of one that does not', () =>
	{
		const {planner, floorplan} = build();
		room(floorplan, 100, 100, 400);
		expect(wallsDrawn(planner)).toBe(4);

		// The same room, a hundred metres away. Nothing about it is on the canvas.
		floorplan.getCorners().slice().forEach((corner) => {corner.move(corner.x + 100000, corner.y + 100000);});
		expect(wallsDrawn(planner)).toBe(0);
		planner.dispose();
	});
});
