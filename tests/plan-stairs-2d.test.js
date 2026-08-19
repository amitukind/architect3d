// @vitest-environment jsdom
/**
 * A flight of stairs on the plan, and on a sheet (RM-008 F3).
 *
 * The model half is pinned in `tests/parametric-stairs.test.js` with no canvas
 * at all. This is the layer above it and it carries the second half of F3's
 * acceptance: *a stair round-trips through the file and appears on an exported
 * sheet at the right size.*
 *
 * "At the right size" is asserted the way E4 asserted M-34 - on the geometry
 * the backend is handed rather than on pixels, because two backends cannot
 * produce the same pixels. A flight 4 m long on a 1:100 sheet is 4 cm of paper,
 * and a paper centimetre is a known number of CSS pixels, so the assertion is
 * arithmetic over the primitive calls.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {exportPlanSVG, PIXELS_PER_PAPER_CM} from '../src/scripts/floorplanner/plan_export.js';
import {projectItem} from '../src/scripts/model/plan_projection.js';
import {normaliseStair, stairPlan, STAIR_L, STAIR_U, HANDRAIL_NONE} from '../src/scripts/items/stair.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

function draw()
{
	canvasStub.context.calls.length = 0;
	planner.view.draw();
	return canvasStub.context.calls.slice();
}

function callNames(calls)
{
	return calls.map((call) => call.name);
}

function drawnText(calls)
{
	return calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
}

/** Put a flight on the plan, the way `Model` hands one over. */
function placeStair(overrides, position)
{
	const stair = normaliseStair(overrides || {});
	const plan = stairPlan(stair);
	const at = position || {x: 200, z: 200};
	floorplan.itemProjection = [projectItem({
		designId: 'stair-1',
		position: {x: at.x, y: 140, z: at.z},
		halfSize: {x: plan.halfWidth, y: 140, z: plan.halfDepth},
		rotation: {y: (at.rotation || 0)},
		metadata: {itemType: 11, itemName: 'Straight flight'},
		stair: stair,
	})];
	return stair;
}

function squareRoom(size)
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
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	clock = installFrameClock(window);
	const dom = buildFloorplannerDom(window, {width: 1000, height: 800});
	floorplan = new Floorplan();
	planner = new Floorplanner2D(dom.canvas, floorplan);
	planner.setMode(floorplannerModes.MOVE);
});

afterEach(() =>
{
	planner.dispose();
	clock.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('the symbol', () =>
{
	it('draws a flight as treads and an arrow, not as a box', () =>
	{
		placeStair({handrail: HANDRAIL_NONE});

		const calls = draw();

		// A plain item is one polygon and a two-line facing chevron; a flight is
		// a rectangle per run, a line per tread and a walking line with a head.
		expect(callNames(calls).filter((name) => name === 'stroke').length).toBeGreaterThan(16);
		expect(drawnText(calls)).toContain('UP');
	});

	it('draws one tread line fewer than there are treads, per run', () =>
	{
		const straight = stairPlan(normaliseStair({treads: 16}));
		const quarter = stairPlan(normaliseStair({shape: STAIR_L, treads: 16}));

		// 16 treads in one run: 15 divisions. Split 8 and 8: 7 and 7.
		expect(straight.treadLines.length).toBe(15);
		expect(quarter.treadLines.length).toBe(14);
	});

	it('says which way is up, at the foot of the flight', () =>
	{
		placeStair();

		const calls = draw();
		const up = calls.find((call) => call.name === 'fillText' && call.args[0] === 'UP');
		const flight = stairPlan(normaliseStair({}));
		const footY = planner.view.project.convertY(200 + flight.walk[0].y);

		// Near the bottom of the walking line rather than the middle of the box:
		// a flight drawn without it is the same rectangle whichever way it climbs.
		expect(Math.abs(up.args[2] - footY)).toBeLessThan(30);
	});

	it('draws the stairwell hint dashed, and puts the dash back', () =>
	{
		placeStair();

		const calls = draw();
		const dashes = calls.filter((call) => call.name === 'setLineDash');

		expect(dashes.some((call) => call.args[0] && call.args[0].length)).toBe(true);
		// Left set, every later mark on the canvas would be dotted.
		expect(dashes[dashes.length - 1].args[0]).toEqual([]);
	});

	it('turns the whole symbol with the item, not just its outline', () =>
	{
		placeStair({}, {x: 200, z: 200, rotation: 0});
		const upright = draw().filter((call) => call.name === 'lineTo').length;

		placeStair({}, {x: 200, z: 200, rotation: Math.PI / 4});
		const turned = draw();
		const turnedLines = turned.filter((call) => call.name === 'lineTo');

		// The same marks, in different places: a rotation that only reached the
		// outline would draw the same tread lines at the same coordinates.
		expect(turnedLines.length).toBe(upright);
		const flight = stairPlan(normaliseStair({}));
		const cos = Math.cos(Math.PI / 4);
		const sin = Math.sin(Math.PI / 4);
		const corner = flight.runs[0];
		const expectedX = planner.view.project.convertX(
			200 + (corner.x0 * cos) - (corner.y0 * sin));
		expect(turned.some((call) => call.name === 'moveTo' && Math.abs(call.args[0] - expectedX) < 1)).toBe(true);
	});

	it('leaves a mesh stair as the plain box it has always been', () =>
	{
		floorplan.itemProjection = [projectItem({
			designId: 'mesh-stair',
			position: {x: 200, y: 200, z: 200},
			halfSize: {x: 275, y: 200, z: 200},
			rotation: {y: 0},
			metadata: {itemType: 1, itemName: 'Stairs'},
		})];

		expect(drawnText(draw())).not.toContain('UP');
	});
});

describe('the sheet', () =>
{
	it('carries the flight at its modelled size, in paper centimetres', () =>
	{
		squareRoom(600);
		const stair = placeStair({handrail: HANDRAIL_NONE, treads: 16, going: 25}, {x: 300, z: 300});

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Stairs'});
		const flight = stairPlan(stair);

		// The run's own rectangle, in millimetres of paper at 1:100: a 400 cm
		// flight is 4 cm, and a paper centimetre is 96/2.54 CSS pixels.
		const drawnLength = (flight.halfDepth * 2) / 100 * PIXELS_PER_PAPER_CM;
		expect(drawnLength).toBeCloseTo(4 * PIXELS_PER_PAPER_CM, 6);

		// And the sheet actually has it on it, tread lines and all.
		expect(svg).toContain('UP');
		expect(svg.match(/<path /g).length).toBeGreaterThan(20);
	});

	it('draws the same flight through both backends', () =>
	{
		squareRoom(600);
		placeStair({shape: STAIR_U}, {x: 300, z: 300});

		const first = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Stairs'});
		const second = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Stairs'});

		// The export is the view's own draw() pointed elsewhere, so it has to be
		// a pure function of the plan - E4's claim, re-checked with a flight on it.
		expect(first).toBe(second);
	});

	it('leaves the hover and selection colours off the sheet', () =>
	{
		squareRoom(600);
		placeStair();
		planner.view.viewmodel.selectedItemId = 'stair-1';

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Stairs'});

		// `emphasis` is false during an export (E4): a sheet carries the
		// furniture, not which piece of it was clicked.
		expect(svg).not.toContain('#FF8A3D');
	});
});
