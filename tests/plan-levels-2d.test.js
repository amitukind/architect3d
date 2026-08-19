// @vitest-environment jsdom
/**
 * The storey below on the 2D plan, and the switch between storeys (RM-010 G1).
 *
 * Two things are asserted here that the model tier cannot see: the ghost is
 * *drawn*, and the canvas follows a level switch. The second is the gap the
 * live drive found - `Floorplanner2D` holds the `Floorplan` it was constructed
 * with, so before `showFloorplan` the switcher moved the model and the 3D view
 * and left the canvas drawing the ground floor, which looks exactly like a
 * switch that did nothing.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Model} from '../src/scripts/model/model.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {exportPlanSVG} from '../src/scripts/floorplanner/plan_export.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let model;

function draw()
{
	canvasStub.context.calls.length = 0;
	planner.view.draw();
	return canvasStub.context.calls.slice();
}

function room(floorplan, x, y, w, h)
{
	const corners = [
		floorplan.newCorner(x, y), floorplan.newCorner(x + w, y),
		floorplan.newCorner(x + w, y + h), floorplan.newCorner(x, y + h),
	];
	for (let i = 0; i < 4; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	floorplan.update();
	return corners;
}

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	clock = installFrameClock(window);
	const dom = buildFloorplannerDom(window, {width: 1000, height: 800});
	model = new Model('/textures/');
	planner = new Floorplanner2D(dom.canvas, model.floorplan);
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

describe('following a level switch', () =>
{
	it('draws the storey it is pointed at, not the one it was built with', () =>
	{
		room(model.floorplan, 100, 100, 500, 400);
		const ground = draw().length;

		model.addLevel();
		planner.showFloorplan(model.floorplan);

		// An empty storey with a ghost under it draws less than a storey with walls.
		const upstairs = draw();
		expect(upstairs.length).toBeLessThan(ground);
		expect(planner.floorplan).toBe(model.levels[1].floorplan);
		expect(planner.view.floorplan).toBe(model.levels[1].floorplan);
	});

	it('is idempotent, because most level events are not a switch', () =>
	{
		room(model.floorplan, 100, 100, 500, 400);
		const before = planner.floorplan;

		planner.showFloorplan(model.floorplan);

		expect(planner.floorplan).toBe(before);
	});

	it('stops listening to the storey it left', () =>
	{
		room(model.floorplan, 100, 100, 500, 400);
		const ground = model.floorplan;
		model.addLevel();
		planner.showFloorplan(model.floorplan);

		// A redraw asked for by a plan this view is no longer showing would be a
		// picture of the wrong floor - and a listener on a plan this view has left
		// is the leak RM-003 A0 and A1 both spent sprints on.
		draw();
		const idle = canvasStub.context.calls.length;
		ground.update(true);
		expect(canvasStub.context.calls.length).toBe(idle);
	});

	it('gives each storey its own tracing sheet', () =>
	{
		model.addLevel();
		planner.showFloorplan(model.floorplan);

		expect(model.levels[1].floorplan.carbonSheet).toBe(planner.view._carbonsheet);
	});
});

describe('the storey below, drawn', () =>
{
	it('draws more on an empty upper storey than on an empty ground floor', () =>
	{
		const bare = draw().length;

		room(model.floorplan, 100, 100, 500, 400);
		model.addLevel();
		planner.showFloorplan(model.floorplan);

		// Nothing on this floor yet, but the floor below is under it.
		expect(model.floorplan.getWalls()).toHaveLength(0);
		expect(draw().length).toBeGreaterThan(bare);
	});

	it('draws nothing extra on the ground floor, which has nothing below it', () =>
	{
		room(model.floorplan, 100, 100, 500, 400);
		const alone = draw().length;

		model.addLevel();
		model.setActiveLevel(0);
		planner.showFloorplan(model.floorplan);

		expect(model.floorplan.ghostPlan).toBeNull();
		expect(draw().length).toBe(alone);
	});

	it('keeps the ghost off an exported sheet', () =>
	{
		room(model.floorplan, 100, 100, 500, 400);
		model.addLevel();
		planner.showFloorplan(model.floorplan);
		room(model.floorplan, 200, 200, 200, 200);

		const svg = exportPlanSVG(planner.view, model.floorplan, {scale: 100, title: 'First floor'});
		const alone = exportPlanSVG(planner.view, model.levels[0].floorplan, {scale: 100, title: 'First floor'});

		// A sheet of the first floor carries the first floor. Somebody reading a
		// drawing cannot be expected to know which of two overlaid plans is theirs,
		// which is why the ghost is drawn with the grid rather than the building.
		expect(svg).not.toContain('rgba(93,111,131,0.22)');
		expect(alone).not.toContain('rgba(93,111,131,0.22)');
	});
});
