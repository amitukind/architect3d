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
import {floorplannerModes, floorplannerPalette, setFloorplannerPalette} from '../src/scripts/floorplanner/floorplanner_view.js';
import {exportPlanSVG} from '../src/scripts/floorplanner/plan_export.js';
import {STAIR_DEFAULTS, stairPlan} from '../src/scripts/items/stair.js';
import {placeRectangle} from '../src/scripts/model/floor_opening.js';
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
		// The second sheet is of the GROUND floor, so the canvas has to be showing
		// the ground floor to draw it (RM-013 Y-3). Before that finding was
		// repaired this line asked for the ground floor and got the first floor's
		// drawing inside the ground floor's frame, and the assertion below passed
		// on it - the ghost is absent from the wrong drawing too.
		planner.showFloorplan(model.levels[0].floorplan);
		const alone = exportPlanSVG(planner.view, model.levels[0].floorplan, {scale: 100, title: 'Ground floor'});

		// A sheet of the first floor carries the first floor. Somebody reading a
		// drawing cannot be expected to know which of two overlaid plans is theirs,
		// which is why the ghost is drawn with the grid rather than the building.
		expect(svg).not.toContain('rgba(93,111,131,0.22)');
		expect(alone).not.toContain('rgba(93,111,131,0.22)');
	});
});

/**
 * The stairwell, on the plan of the storey it is cut into (RM-010 G3).
 *
 * G2 cut the opening out of the 3D floor and out of the room's stated area and
 * left the 2D plan drawing a solid room, so the two views disagreed about the
 * same building - and the plan is the one that gets printed. The hint on the
 * flight's own storey has been drawn since F3; this is the other half of it.
 */
describe('the void a stairwell leaves', () =>
{
	/** The stairwell a default flight at the origin implies, in plan space. */
	function well(at)
	{
		return placeRectangle(stairPlan(STAIR_DEFAULTS).well, {x: at.x, y: at.y, rotation: 0});
	}

	it('draws the opening dashed, over the room it is cut in', () =>
	{
		room(model.floorplan, 0, 0, 600, 600);
		const solid = draw();

		model.floorplan.setFloorOpenings([well({x: 300, y: 300})]);
		const holed = draw();

		expect(model.floorplan.getRooms()[0].floorOpenings).toHaveLength(1);
		expect(holed.length).toBeGreaterThan(solid.length);
		// Dashed, like the hint on the storey below, so the two read as the same
		// rectangle seen from either side.
		expect(holed.some((call) => call.name === 'setLineDash'
			&& JSON.stringify(call.args[0]) === '[4,4]')).toBe(true);
	});

	/**
	 * Both halves of the one branch this drawing has. A themed plan has a ground
	 * to paint the void with; the library's own default palette has a transparent
	 * canvas and no ground, and painting nothing over nothing is right there.
	 */
	it('paints the void with the plan\'s ground when there is one, and not when there is not', () =>
	{
		const pristine = {...floorplannerPalette};
		room(model.floorplan, 0, 0, 600, 600);
		model.floorplan.setFloorOpenings([well({x: 300, y: 300})]);

		try
		{
			setFloorplannerPalette({background: null});
			const transparent = draw().filter((call) => call.name === 'fill').length;

			setFloorplannerPalette({background: '#101418'});
			const painted = draw().filter((call) => call.name === 'fill').length;

			expect(painted).toBe(transparent + 1);
		}
		finally
		{
			setFloorplannerPalette(pristine);
		}
	});

	it('draws nothing extra for a room with no opening in it', () =>
	{
		room(model.floorplan, 0, 0, 600, 600);
		const before = draw().length;

		model.floorplan.setFloorOpenings([]);

		expect(draw().length).toBe(before);
	});

	it('puts the same rectangle on an exported sheet', () =>
	{
		room(model.floorplan, 0, 0, 600, 600);
		const solid = exportPlanSVG(planner.view, model.floorplan, {scale: 100, title: 'Plan'});

		model.floorplan.setFloorOpenings([well({x: 300, y: 300})]);
		const holed = exportPlanSVG(planner.view, model.floorplan, {scale: 100, title: 'Plan'});

		expect(holed).not.toBe(solid);
		expect(holed).toContain('stroke-dasharray');
	});

	it('states the floor you can stand on, hole subtracted', () =>
	{
		room(model.floorplan, 0, 0, 600, 600);
		const whole = model.floorplan.getRooms()[0].area;

		model.floorplan.setFloorOpenings([well({x: 300, y: 300})]);

		// F2's rule, which G2 extended to openings: the number on the plan is the
		// floor you can stand on, and `Room.area` is what the plan draws.
		expect(model.floorplan.getRooms()[0].area).toBeLessThan(whole);
		expect(model.floorplan.getRooms()[0].area)
			.toBe(model.floorplan.getRooms()[0].interiorArea());
	});
});
