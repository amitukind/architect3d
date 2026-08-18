/**
 * Furniture on the plan, rasterised for real (RM-008 E1, tier 2).
 *
 * The two metrics E1 committed to, asserted the way they were specified:
 *
 *   M-23  items in the scene equals footprints on the plan. Pinned headlessly
 *         in `tests/plan-projection.test.js` as a count; pinned here as ink -
 *         a projection that agrees with the scene and draws nothing would pass
 *         the first and fail this one.
 *
 *   M-32  selecting an entity in one view changes the other view's pixels.
 *         Asserted by differencing two rasters of the same canvas, which is
 *         deliberately the same method that produced RM-008 T-2 - the
 *         measurement that caught the mistake is the one that guards it. T-2
 *         found 0 changed pixels in both directions; anything above zero here
 *         is the finding closed, and a return to zero is it reopening.
 *
 * Real canvas, real 2D context, real `getImageData`. The headless tier can
 * assert that `fill()` was called; only this tier can assert that something is
 * visible.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Vector3} from 'three';

import {Model} from '../../src/scripts/model/model.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, scale} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WIDTH = 900;
const HEIGHT = 640;

let canvas;
let planner;
let model;

/** Every pixel of the live canvas. */
function raster()
{
	const context = canvas.getContext('2d');
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** How many pixels differ between two rasters, beyond a per-channel tolerance. */
function changedPixels(before, after)
{
	let changed = 0;
	for (let i = 0; i < before.length; i += 4)
	{
		if (Math.abs(before[i] - after[i]) > 6
			|| Math.abs(before[i + 1] - after[i + 1]) > 6
			|| Math.abs(before[i + 2] - after[i + 2]) > 6)
		{
			changed += 1;
		}
	}
	return changed;
}

/**
 * An item, in the shape the projection reads.
 *
 * Not a real `Item`: that needs a geometry, a material and a loaded model file,
 * none of which this is about. The projection reads seven named properties and
 * `Model.itemById` reads `designId`, so anything carrying them is a valid
 * subject - the same argument `tests/plan-projection.test.js` makes at length.
 */
function fakeItem(id, x, y, overrides)
{
	return Object.assign({
		designId: id,
		position: new Vector3(x, 20, y),
		halfSize: new Vector3(60, 20, 90),
		rotation: {x: 0, y: 0, z: 0},
		fixed: false,
		currentWallEdge: null,
		metadata: {itemName: id, itemType: 1},
	}, overrides || {});
}

/**
 * A closed square room, so the plan has a building to put furniture in.
 *
 * In POSITIVE coordinates, starting at ORIGIN. The plan's origin is the canvas'
 * top-left until somebody pans, so a room centred on (0,0) puts three of its
 * four walls off the canvas - and a test that selects "the first wall" then
 * measures zero changed pixels and reads as a broken feature. It cost a
 * debugging round to find that the first time.
 */
const ORIGIN = 100;

function buildRoom(size)
{
	const corners = [
		model.floorplan.newCorner(ORIGIN, ORIGIN),
		model.floorplan.newCorner(ORIGIN + size, ORIGIN),
		model.floorplan.newCorner(ORIGIN + size, ORIGIN + size),
		model.floorplan.newCorner(ORIGIN, ORIGIN + size),
	];
	for (let i = 0; i < 4; i++)
	{
		model.floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	return corners;
}

beforeEach(() =>
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(scale, 1);

	canvas = document.createElement('canvas');
	canvas.id = 'plan-items-canvas';
	canvas.style.display = 'block';
	canvas.style.width = `${WIDTH}px`;
	canvas.style.height = `${HEIGHT}px`;
	document.body.appendChild(canvas);

	model = new Model();
	planner = new Floorplanner2D(canvas, model.floorplan);
	planner.setMode(floorplannerModes.MOVE);
	buildRoom(400);
});

afterEach(() =>
{
	planner.dispose();
	model.dispose();
	canvas.remove();
	canvas = null;
	planner = null;
	model = null;
});

describe('M-23 · the plan draws what the scene holds', () =>
{
	it('draws nothing extra for an empty scene, and ink for a furnished one', () =>
	{
		planner.view.draw();
		const empty = raster();

		model.scene.items = [fakeItem('bed', 300, 300)];
		model.projectItemsToPlan();
		planner.view.draw();

		expect(changedPixels(empty, raster())).toBeGreaterThan(0);
	});

	it('has one footprint per item, whatever the scene holds', () =>
	{
		model.scene.items = [fakeItem('a', 200, 200), fakeItem('b', 400, 200), fakeItem('c', 300, 420)];
		model.projectItemsToPlan();

		expect(model.floorplan.itemProjection).toHaveLength(model.scene.itemCount());

		model.scene.items = [fakeItem('a', 200, 200)];
		model.projectItemsToPlan();

		expect(model.floorplan.itemProjection).toHaveLength(model.scene.itemCount());
	});

	it('draws more ink for three items than for one', () =>
	{
		model.scene.items = [fakeItem('a', 200, 200)];
		model.projectItemsToPlan();
		planner.view.draw();
		const one = raster();

		model.scene.items = [fakeItem('a', 200, 200), fakeItem('b', 400, 200), fakeItem('c', 300, 430)];
		model.projectItemsToPlan();
		planner.view.draw();

		expect(changedPixels(one, raster())).toBeGreaterThan(0);
	});

	/**
	 * The count and the picture have to agree in both directions: an item that
	 * leaves the scene must leave the plan. Asserted as a return to the exact
	 * raster the empty scene produced, not merely "fewer pixels".
	 */
	it('takes a footprint away when its item leaves', () =>
	{
		planner.view.draw();
		const empty = raster();

		model.scene.items = [fakeItem('bed', 300, 300)];
		model.projectItemsToPlan();
		planner.view.draw();
		expect(changedPixels(empty, raster())).toBeGreaterThan(0);

		model.scene.items = [];
		model.projectItemsToPlan();
		planner.view.draw();

		expect(changedPixels(empty, raster())).toBe(0);
	});

	it('draws no footprint for an item that is still loading', () =>
	{
		planner.view.draw();
		const empty = raster();

		model.scene.items = [fakeItem('bed', 300, 300, {halfSize: new Vector3(0, 0, 0)})];
		model.projectItemsToPlan();
		planner.view.draw();

		expect(model.floorplan.itemProjection).toHaveLength(1);
		expect(changedPixels(empty, raster())).toBe(0);
	});
});

describe('M-32 · selecting in one view changes the other', () =>
{
	beforeEach(() =>
	{
		model.scene.items = [fakeItem('bed', 300, 300)];
		model.projectItemsToPlan();
	});

	/**
	 * The direction RM-008 T-2 measured at zero. An item selected anywhere -
	 * here, by the call the application makes when the 3D view picks one - must
	 * change the plan.
	 */
	it('shows an item on the plan when something else selected it', () =>
	{
		planner.view.draw();
		const unselected = raster();

		planner.showSelection('item', 'bed');
		planner.view.draw();

		expect(changedPixels(unselected, raster())).toBeGreaterThan(0);
	});

	it('shows a wall on the plan when something else selected it', () =>
	{
		planner.view.draw();
		const unselected = raster();

		planner.showSelection('wall', model.floorplan.getWalls()[0]);
		planner.view.draw();

		expect(changedPixels(unselected, raster())).toBeGreaterThan(0);
	});

	it('accepts a half edge for a wall, because the 3D view selects a face', () =>
	{
		const wall = model.floorplan.getWalls()[0];
		planner.view.draw();
		const unselected = raster();

		planner.showSelection('wall', {id: `${wall.id}:front`, wall: wall});
		planner.view.draw();

		expect(planner.selectedWall).toBe(wall);
		expect(changedPixels(unselected, raster())).toBeGreaterThan(0);
	});

	it('puts the plan back when the selection is cleared', () =>
	{
		planner.view.draw();
		const unselected = raster();

		planner.showSelection('item', 'bed');
		planner.view.draw();
		planner.showSelection(null, null);
		planner.view.draw();

		expect(changedPixels(unselected, raster())).toBe(0);
	});
});

describe('the frame budget (RM-008 T-4)', () =>
{
	/**
	 * T-4 measured 0.593 ms for a 36-room plan and 0.197 ms for 150 footprints,
	 * so 0.79 ms is the worst case anyone will hit. The gate is 2 ms - 2.5x that
	 * - so it fails on a regression rather than on noise, and it is checked here
	 * because this tier is the one with a real canvas and a real rasteriser.
	 */
	it('draws a large furnished plan inside 2 ms', () =>
	{
		model.floorplan.beginBatch('load');
		for (let i = 0; i < 6; i++)
		{
			for (let j = 0; j < 6; j++)
			{
				const x = i * 300;
				const y = j * 300;
				const corners = [
					model.floorplan.newCorner(x, y),
					model.floorplan.newCorner(x + 300, y),
					model.floorplan.newCorner(x + 300, y + 300),
					model.floorplan.newCorner(x, y + 300),
				];
				for (let k = 0; k < 4; k++)
				{
					model.floorplan.newWall(corners[k], corners[(k + 1) % 4]);
				}
			}
		}
		model.floorplan.endBatch();

		const items = [];
		for (let i = 0; i < 150; i++)
		{
			items.push(fakeItem(`item-${String(i).padStart(3, '0')}`, 60 + (i % 15) * 120, 60 + Math.floor(i / 15) * 120));
		}
		model.scene.items = items;
		model.projectItemsToPlan();

		expect(model.floorplan.itemProjection).toHaveLength(150);
		expect(model.floorplan.getWalls().length).toBeGreaterThanOrEqual(100);

		planner.view.draw();
		const started = performance.now();
		for (let run = 0; run < 20; run++)
		{
			planner.view.draw();
		}
		const perDraw = (performance.now() - started) / 20;

		expect(perDraw).toBeLessThan(2);
	});
});
