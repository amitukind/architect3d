// @vitest-environment jsdom
/**
 * Furniture on the 2D plan: drawn, picked, dragged, and kept in step with the
 * other view (RM-008 E1).
 *
 * The projection itself is pinned in `tests/plan-projection.test.js` with no
 * DOM at all. This file is the layer above it - the drawing pass and the
 * pointer handling - and it exists because RM-008 T-3 measured the two
 * floorplanner files at 63% and 69% statements, the least covered in the
 * library, and E1 adds to both. A sprint that leaves them lower than it found
 * them fails its own acceptance criterion.
 *
 * Everything here runs against the canvas stub, which records the calls made to
 * it. That is enough to assert what matters at this level - that a footprint
 * produces marks, that a wall-bound item produces an arc and a free one does
 * not, that the label is suppressed when it would not fit - without pinning
 * pixel coordinates, which would break on any change to the plan's look.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Vector3} from 'three';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {projectItems} from '../src/scripts/model/plan_projection.js';
import {EVENT_ITEM_2D_CLICKED, EVENT_ITEM_MOVE_FINISH} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

/** A footprint's worth of item, in the shape `projectItem` reads. */
function fakeItem(overrides)
{
	return Object.assign({
		designId: 'bed',
		position: new Vector3(0, 20, 0),
		halfSize: new Vector3(70, 20, 100),
		rotation: {x: 0, y: 0, z: 0},
		fixed: false,
		currentWallEdge: null,
		metadata: {itemName: 'Full Bed', itemType: 1},
	}, overrides || {});
}

/** Put a projection on the plan and draw it, returning the recorded calls. */
function drawWith(items)
{
	floorplan.setItemProjection(projectItems(items));
	canvasStub.context.calls.length = 0;
	planner.view.draw();
	// A copy. The stub hands back the live array it keeps pushing into, so two
	// snapshots taken from it are the same object - which quietly turns every
	// before/after comparison in this file into a comparison of one value with
	// itself. Cost an hour the first time.
	return canvasStub.context.calls.slice();
}

function callNames(calls)
{
	return calls.map((call) => call.name);
}

/**
 * Every string this draw put on the canvas.
 *
 * The two caption assertions below used to read `not.toContain('fillText')` -
 * "nothing drew any text at all" as a proxy for "no caption was drawn". That was
 * true when the only text in this fixture was the caption, and RM-008 E3 made it
 * false: the plan now draws a north arrow, labelled N, on every frame. Re-checked
 * rather than relaxed, and the assertion moved to what it always meant - the
 * item's name is or is not among the strings drawn - which is both narrower and
 * immune to the next thing that legitimately draws text.
 */
function drawnText(calls)
{
	return calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
}

/**
 * A pointer event at a point in plan space.
 *
 * The plan converts client pixels to centimetres through `Dimensioning`, and
 * the canvas is laid out at the origin by the harness, so this goes the other
 * way to place the pointer exactly on a footprint.
 */
function pointerAt(planX, planY, type)
{
	const x = planner.dimensioning.cmToPixel(planX) - planner.originX;
	const y = planner.dimensioning.cmToPixel(planY) - planner.originY;
	return new window.PointerEvent(type || 'pointerdown', {
		clientX: x, clientY: y, bubbles: true, pointerType: 'mouse',
	});
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

describe('drawing footprints', () =>
{
	it('draws nothing extra when there is no furniture', () =>
	{
		const bare = drawWith([]);
		const withOne = drawWith([fakeItem()]);

		expect(withOne.length).toBeGreaterThan(bare.length);
	});

	it('strokes and fills a footprint, and marks its facing', () =>
	{
		const calls = drawWith([fakeItem()]);
		const names = callNames(calls);

		expect(names).toContain('fill');
		expect(names).toContain('stroke');
		// The facing chevron is two lines drawn after the outline.
		expect(names.filter((name) => name === 'moveTo').length).toBeGreaterThan(2);
	});

	/**
	 * An item mid-download has halfSize (0,0,0). It keeps its place in the
	 * projection - the count is what M-23 asserts - but a dot where a wardrobe
	 * is about to appear is worse than nothing.
	 */
	it('draws nothing for an item that has not finished loading', () =>
	{
		const bare = drawWith([]);
		const loading = drawWith([fakeItem({halfSize: new Vector3(0, 0, 0)})]);

		expect(loading.length).toBe(bare.length);
		expect(floorplan.itemProjection).toHaveLength(1);
	});

	it('draws a rug before the furniture standing on it', () =>
	{
		floorplan.setItemProjection(projectItems([
			fakeItem({designId: 'a-chair', metadata: {itemName: 'Chair', itemType: 1}}),
			fakeItem({designId: 'z-rug', metadata: {itemName: 'Rug', itemType: 8}}),
		]));
		const order = [];
		const original = planner.view.drawItem.bind(planner.view);
		planner.view.drawItem = (footprint) => {order.push(footprint.label); return original(footprint);};

		planner.view.draw();

		// Sorted by id the chair comes first; the rug is drawn first anyway.
		expect(order).toEqual(['Rug', 'Chair']);
	});

	it('gives a door a swing arc and a free item none', () =>
	{
		const door = callNames(drawWith([fakeItem({metadata: {itemName: 'Door', itemType: 7}})]));
		const chair = callNames(drawWith([fakeItem({metadata: {itemName: 'Chair', itemType: 1}})]));

		expect(door).toContain('arc');
		expect(chair).not.toContain('arc');
	});

	it('draws a window as an opening - no swing, but a reveal', () =>
	{
		const names = callNames(drawWith([fakeItem({metadata: {itemName: 'Window', itemType: 3}})]));

		expect(names).not.toContain('arc');
		expect(names).toContain('fill');
	});

	it('captions an item that is big enough on screen, and not one that is not', () =>
	{
		const big = drawWith([fakeItem()]);
		const tiny = drawWith([fakeItem({halfSize: new Vector3(2, 2, 2)})]);

		expect(drawnText(big)).toContain('Full Bed');
		expect(drawnText(tiny)).not.toContain('Full Bed');
	});

	it('draws no caption for an item with no name', () =>
	{
		const calls = drawWith([fakeItem({metadata: {itemName: '', itemType: 1}})]);

		expect(drawnText(calls)).not.toContain('Full Bed');
		expect(drawnText(calls)).not.toContain('');
	});
});

describe('picking a footprint', () =>
{
	it('finds the item under a point, and nothing outside it', () =>
	{
		floorplan.setItemProjection(projectItems([fakeItem()]));

		expect(planner.overlappedItem(0, 0).id).toBe('bed');
		expect(planner.overlappedItem(60, 90).id).toBe('bed');
		expect(planner.overlappedItem(400, 0)).toBeNull();
	});

	it('answers null when there is no furniture at all', () =>
	{
		expect(planner.overlappedItem(0, 0)).toBeNull();
	});

	/**
	 * The draw pass puts rugs underneath, so the pick has to return what is on
	 * top - which is the last one drawn, hence the last match rather than the
	 * first.
	 */
	it('returns the item drawn on top when two overlap', () =>
	{
		floorplan.setItemProjection(projectItems([
			fakeItem({designId: 'a-under'}),
			fakeItem({designId: 'b-over'}),
		]));

		expect(planner.overlappedItem(0, 0).id).toBe('b-over');
	});

	it('will not drag a wall-bound item, and will drag a free one', () =>
	{
		expect(planner.itemIsDraggable({type: 1})).toBe(true);
		expect(planner.itemIsDraggable({type: 8})).toBe(true);
		[2, 3, 7, 9].forEach((type) =>
		{
			expect(planner.itemIsDraggable({type})).toBe(false);
		});
	});

	it('announces a pick on the plan, once, with the id and the footprint', () =>
	{
		const clicked = vi.fn();
		floorplan.addEventListener(EVENT_ITEM_2D_CLICKED, clicked);
		floorplan.setItemProjection(projectItems([fakeItem()]));

		planner.selectItem('bed');
		planner.selectItem('bed');

		expect(clicked).toHaveBeenCalledTimes(1);
		expect(clicked.mock.calls[0][0].id).toBe('bed');
		expect(clicked.mock.calls[0][0].item.label).toBe('Full Bed');
	});

	it('says nothing when the selection is cleared - the other events mean that', () =>
	{
		const clicked = vi.fn();
		floorplan.setItemProjection(projectItems([fakeItem()]));
		planner.selectItem('bed');
		floorplan.addEventListener(EVENT_ITEM_2D_CLICKED, clicked);

		planner.selectItem(null);

		expect(clicked).not.toHaveBeenCalled();
		expect(planner.selectedItemId).toBeNull();
	});
});

describe('showing what the other view selected (T-2)', () =>
{
	it('takes a wall, a corner, a room and an item, one at a time', () =>
	{
		const wall = {id: 'w'};
		const corner = {id: 'c'};
		const room = {id: 'r'};

		planner.showSelection('wall', wall);
		expect(planner.selectedWall).toBe(wall);

		planner.showSelection('corner', corner);
		expect(planner.selectedCorner).toBe(corner);
		expect(planner.selectedWall).toBeNull();

		planner.showSelection('room', room);
		expect(planner.selectedRoom).toBe(room);

		planner.showSelection('item', 'bed');
		expect(planner.selectedItemId).toBe('bed');
		expect(planner.selectedRoom).toBeNull();

		planner.showSelection(null, null);
		expect(planner.selectedItemId).toBeNull();
		expect(planner.selectedWall).toBeNull();
	});

	/**
	 * The 3D view selects a *face* and the plan selects a *wall*; they have
	 * always been different things behind one name, and this is the one place
	 * that has to know it.
	 */
	it('unwraps a half edge into the wall it belongs to', () =>
	{
		const wall = {id: 'w'};

		planner.showSelection('wall', {id: 'w:front', wall: wall});

		expect(planner.selectedWall).toBe(wall);
	});

	it('accepts an item object as well as an id', () =>
	{
		planner.showSelection('item', {designId: 'bed'});

		expect(planner.selectedItemId).toBe('bed');
	});

	/**
	 * The inbound path must not dispatch, or a selection would echo between the
	 * two views forever. This is the assertion that keeps that true.
	 */
	it('dispatches nothing, so the two views cannot loop', () =>
	{
		const clicked = vi.fn();
		floorplan.addEventListener(EVENT_ITEM_2D_CLICKED, clicked);
		floorplan.setItemProjection(projectItems([fakeItem()]));

		planner.showSelection('item', 'bed');

		expect(clicked).not.toHaveBeenCalled();
		expect(planner.selectedItemId).toBe('bed');
	});

	it('schedules no redraw when nothing changed', () =>
	{
		planner.showSelection('item', 'bed');
		clock.tick();

		planner.showSelection('item', 'bed');

		expect(clock.pending()).toBe(0);
	});
});

describe('dragging a footprint on the plan', () =>
{
	let model;

	beforeEach(() =>
	{
		planner.dispose();
		model = new Model();
		floorplan = model.floorplan;
		const dom = buildFloorplannerDom(window, {width: 1000, height: 800});
		planner = new Floorplanner2D(dom.canvas, floorplan);
		planner.setMode(floorplannerModes.MOVE);
		model.scene.items = [fakeItem()];
		model.projectItemsToPlan();
	});

	it('moves the item and re-projects, without announcing a finished move', () =>
	{
		const finished = vi.fn();
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, finished);

		model.moveItemInPlan('bed', 250, -125);

		expect(model.scene.items[0].position.x).toBe(250);
		expect(model.scene.items[0].position.z).toBe(-125);
		// Height is not a plan concept and must survive the move.
		expect(model.scene.items[0].position.y).toBe(20);
		expect(floorplan.itemProjection[0].x).toBe(250);
		expect(finished).not.toHaveBeenCalled();
	});

	it('announces the finished gesture once, when asked', () =>
	{
		const finished = vi.fn();
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, finished);

		model.commitItemGesture('bed');

		expect(finished).toHaveBeenCalledTimes(1);
		expect(finished.mock.calls[0][0].item.designId).toBe('bed');
	});

	it('turns an item and re-projects', () =>
	{
		model.rotateItemInPlan('bed', Math.PI / 2);

		expect(floorplan.itemProjection[0].rotation).toBeCloseTo(Math.PI / 2, 10);
	});

	it('ignores an id that names nothing, rather than throwing', () =>
	{
		expect(() => model.moveItemInPlan('nobody', 1, 1)).not.toThrow();
		expect(() => model.rotateItemInPlan('nobody', 1)).not.toThrow();
		expect(() => model.commitItemGesture('nobody')).not.toThrow();
		expect(model.itemById('nobody')).toBeNull();
		expect(model.itemById(null)).toBeNull();
	});

	it('grabs on press, follows the pointer, and commits on release', () =>
	{
		planner.mousedown(pointerAt(0, 0));
		expect(planner.selectedItemId).toBe('bed');

		planner.mousemove(pointerAt(120, 60, 'pointermove'));
		expect(model.scene.items[0].position.x).toBeCloseTo(120, 5);
		expect(model.scene.items[0].position.z).toBeCloseTo(60, 5);

		const finished = vi.fn();
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, finished);
		planner.mouseup();

		expect(finished).toHaveBeenCalledTimes(1);
	});

	/**
	 * The pan branch runs before the drag branches and its condition is "nothing
	 * else is grabbed", written out as a list. A grabbed item joined that list in
	 * E1; before it did, the first drag of a chair panned the whole plan.
	 */
	it('does not pan the plan while an item is being dragged', () =>
	{
		planner.mousedown(pointerAt(0, 0));
		const originX = planner.originX;
		const originY = planner.originY;

		planner.mousemove(pointerAt(200, 200, 'pointermove'));

		expect(planner.originX).toBe(originX);
		expect(planner.originY).toBe(originY);
	});

	it('commits nothing when the pointer never moved - a click is not a drag', () =>
	{
		const finished = vi.fn();
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, finished);

		planner.mousedown(pointerAt(0, 0));
		planner.mouseup();

		expect(finished).not.toHaveBeenCalled();
	});

	it('will not grab a locked item, but will still select it', () =>
	{
		model.scene.items = [fakeItem({fixed: true})];
		model.projectItemsToPlan();

		planner.mousedown(pointerAt(0, 0));

		expect(planner.selectedItemId).toBe('bed');
		expect(planner._draggingItemId).toBeNull();
	});

	it('reads the plan as read-only when no commands are installed', () =>
	{
		floorplan.setItemCommands(null);

		planner.mousedown(pointerAt(0, 0));
		expect(() => planner.mousemove(pointerAt(120, 60, 'pointermove'))).not.toThrow();
		expect(() => planner.mouseup()).not.toThrow();
	});
});
