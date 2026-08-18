// @vitest-environment jsdom
/**
 * Annotation on the 2D plan: drawn, placed, picked and dragged (RM-008 E3).
 *
 * The model half is pinned in `tests/annotations.test.js` with no DOM at all.
 * This is the layer above it, and it exists for the reason T-3 gave: the two
 * floorplanner files were the least covered in the library at 63 % and 69 %
 * statements, and every sprint in programme E adds to both.
 *
 * Where a gesture is being asserted it is driven through `mousedown`,
 * `mousemove` and `mouseup` with real pointer events rather than by calling the
 * method underneath. E2 found four bugs that way and none of them by reading
 * code: a test that calls `placeDimensionPoint` directly sets the target itself
 * and passes whatever the pointer plumbing does.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configWallHeight} from '../src/scripts/core/configuration.js';
import {EVENT_DIMENSION_2D_CLICKED, EVENT_ANNOTATION_2D_CLICKED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

/** A pointer event at a point in CANVAS pixels. */
function at(x, y, type)
{
	return new window.PointerEvent(type || 'pointerdown', {
		clientX: x, clientY: y, pointerType: 'mouse', bubbles: true,
	});
}

/**
 * A pointer event at a point in PLAN space.
 *
 * The plan converts client pixels to centimetres through `Dimensioning` and the
 * harness lays the canvas out at the origin, so this goes the other way to put
 * the pointer exactly on something.
 */
function atPlan(planX, planY, type)
{
	return at(
		planner.dimensioning.cmToPixel(planX) - planner.originX,
		planner.dimensioning.cmToPixel(planY) - planner.originY,
		type);
}

/** One full click: move there, press, release. */
function clickPlan(planX, planY)
{
	planner.mousemove(atPlan(planX, planY, 'pointermove'));
	planner.mousedown(atPlan(planX, planY, 'pointerdown'));
	planner.mouseup();
}

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

/** Every string this draw put on the canvas. */
function drawnText(calls)
{
	return calls.filter((call) => call.name === 'fillText').map((call) => call.args[0]);
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

describe('drawing what the plan says about itself', () =>
{
	it('draws more for a dimension than for nothing', () =>
	{
		const bare = draw();

		floorplan.newDimension(0, 0, 400, 0);

		expect(draw().length).toBeGreaterThan(bare.length);
	});

	it('puts the measurement on the canvas, in the active unit', () =>
	{
		floorplan.newDimension(0, 0, 400, 0);

		expect(drawnText(draw())).toContain(planner.dimensioning.cmToMeasure(400));
	});

	it('draws a label\'s text and its anchor', () =>
	{
		floorplan.newAnnotation(200, 200, 'Service duct');

		const calls = draw();

		expect(drawnText(calls)).toContain('Service duct');
		expect(callNames(calls)).toContain('arc');
	});

	it('draws the anchor but no text for a label somebody emptied', () =>
	{
		const annotation = floorplan.newAnnotation(200, 200, 'Note');
		annotation.setText('');

		expect(drawnText(draw())).not.toContain('Note');
	});

	/**
	 * A dimension with no length has no perpendicular to offset along, so
	 * `dimensionLine` returns null and this must draw nothing rather than
	 * dividing by zero. Only a file can carry one - `newDimension` refuses.
	 */
	it('draws nothing for a degenerate dimension carried in by a file', () =>
	{
		const saved = floorplan.saveFloorplan();
		saved.dimensions = [{id: 'd', a: {x: 10, y: 10}, b: {x: 10, y: 10}}];
		floorplan.loadFloorplan(saved);
		expect(floorplan.dimensions).toHaveLength(1);

		expect(() => {draw();}).not.toThrow();
		expect(drawnText(draw())).not.toContain(planner.dimensioning.cmToMeasure(0));
	});

	it('always draws the north arrow, whichever way north is', () =>
	{
		expect(drawnText(draw())).toContain('N');

		floorplan.north = 90;

		expect(drawnText(draw())).toContain('N');
	});

	it('leaves the arrow off a canvas too small to hold it', () =>
	{
		planner.view.canvasWidth = 40;
		planner.view.canvasHeight = 40;

		expect(drawnText(draw())).not.toContain('N');
	});
});

describe('what a room says under its name', () =>
{
	it('draws the type when there is one, and nothing when there is not', () =>
	{
		squareRoom(400);
		expect(drawnText(draw())).not.toContain('Bedroom');

		floorplan.getRooms()[0].type = 'Bedroom';

		expect(drawnText(draw())).toContain('Bedroom');
	});

	/**
	 * A plan where every room is the standard height and every room says so is a
	 * plan carrying the same number a dozen times. The number is worth drawing
	 * exactly where it is a surprise - which also means a plan drawn before this
	 * sprint looks exactly as it did.
	 */
	it('draws a ceiling height only where it is not the document default', () =>
	{
		Configuration.setValue(configWallHeight, 250);
		squareRoom(400);
		const standard = drawnText(draw()).join('|');
		expect(standard).not.toContain('H ');

		floorplan.getRooms()[0].setCeilingHeight(320);

		expect(drawnText(draw()).join('|')).toContain('H ');
	});

	it('says "at most" when the room\'s corners disagree', () =>
	{
		Configuration.setValue(configWallHeight, 250);
		const corners = squareRoom(400);
		corners[0].elevation = 320;

		const text = drawnText(draw()).join('|');

		expect(text).toContain('≤');
	});
});

describe('two labels do not sit on each other (RM-008 E3)', () =>
{
	/**
	 * E1 shipped item captions with one rule - suppress below 34 pixels of
	 * on-screen size - and flagged that it does nothing for two items side by
	 * side that are both big enough. E3 both made the problem worse, by letting a
	 * room carry four stacked lines and a person put text anywhere, and is where
	 * it is answered.
	 */
	it('hides a room\'s derived labels under a label somebody typed', () =>
	{
		squareRoom(400);
		const room = floorplan.getRooms()[0];
		room.name = 'Sitting Room';
		const before = drawnText(draw());
		expect(before).toContain('Sitting Room');

		// On the centroid, which is where the room's own stack starts. Asserted as
		// a count rather than against a coordinate, so this says "something gave
		// way" without pinning which line at which zoom.
		floorplan.newAnnotation(room.areaCenter.x, room.areaCenter.y, 'Note');

		const after = drawnText(draw());
		expect(after).toContain('Note');
		expect(after.length).toBeLessThan(before.length + 1);
	});

	it('keeps both when they are far enough apart', () =>
	{
		squareRoom(400);
		const room = floorplan.getRooms()[0];
		room.name = 'Sitting Room';
		const before = drawnText(draw());

		// Well outside the room, where nothing else is drawn.
		floorplan.newAnnotation(room.areaCenter.x + 900, room.areaCenter.y + 900, 'Note');

		const after = drawnText(draw());

		expect(after).toContain('Note');
		expect(after).toContain('Sitting Room');
		expect(after.length).toBe(before.length + 1);
	});

	/**
	 * Priority is a property of the text, not of the pass it is drawn in. Rooms
	 * are drawn before annotations, so reserving in draw order would let "A New
	 * Room" beat a label a person typed - which is why the authored text is
	 * reserved in a pre-pass before anything is drawn at all.
	 */
	it('gives the space to the authored label, not to the one drawn first', () =>
	{
		squareRoom(400);
		const room = floorplan.getRooms()[0];
		room.name = 'Derived';
		// A label whose own box - drawn one line above its anchor - lands on the
		// room's name.
		floorplan.newAnnotation(room.areaCenter.x, room.areaCenter.y, 'Authored');
		const annotation = floorplan.annotations[0];
		annotation.moveTo(room.areaCenter.x, planner.dimensioning.pixelToCm(
			planner.dimensioning.cmToPixel(room.areaCenter.y) + 17 + annotation.size));

		const text = drawnText(draw());

		expect(text).toContain('Authored');
		expect(text).not.toContain('Derived');
	});

	it('does not let a dimension\'s measurement be pushed out by a room label', () =>
	{
		squareRoom(400);
		const room = floorplan.getRooms()[0];
		const dimension = floorplan.newDimension(
			room.areaCenter.x - 200, room.areaCenter.y,
			room.areaCenter.x + 200, room.areaCenter.y, {offset: 0});

		const text = drawnText(draw());

		expect(text).toContain(planner.dimensioning.cmToMeasure(dimension.length));
	});

	it('clears its ledger between frames, so nothing accumulates', () =>
	{
		squareRoom(400);
		floorplan.getRooms()[0].name = 'Sitting Room';

		const first = drawnText(draw());
		const second = drawnText(draw());

		expect(second).toEqual(first);
	});
});

describe('placing a dimension, through the pointer', () =>
{
	it('takes two clicks, and creates nothing on the first', () =>
	{
		planner.setMode(floorplannerModes.DIMENSION);

		clickPlan(100, 100);

		expect(planner.dimensionAnchor).not.toBeNull();
		expect(planner.dimensionAnchor.x).toBeCloseTo(100, 6);
		expect(floorplan.dimensions).toHaveLength(0);

		clickPlan(500, 100);

		expect(floorplan.dimensions).toHaveLength(1);
		expect(floorplan.dimensions[0].length).toBeCloseTo(400, 6);
		expect(planner.dimensionAnchor).toBeNull();
	});

	it('stays armed for the next one', () =>
	{
		planner.setMode(floorplannerModes.DIMENSION);

		clickPlan(100, 100);
		clickPlan(500, 100);
		clickPlan(100, 300);
		clickPlan(500, 300);

		expect(floorplan.dimensions).toHaveLength(2);
		expect(planner.mode).toBe(floorplannerModes.DIMENSION);
	});

	it('pins an end that landed on a corner, and leaves a free one free', () =>
	{
		const corners = squareRoom(400);
		planner.setMode(floorplannerModes.DIMENSION);

		clickPlan(0, 0);
		clickPlan(700, 700);

		const dimension = floorplan.dimensions[0];
		expect(dimension.aCorner).toBe(corners[0].id);
		expect(dimension.bCorner).toBeNull();
	});

	it('selects what it just placed, and says so once', () =>
	{
		const picked = vi.fn();
		floorplan.addEventListener(EVENT_DIMENSION_2D_CLICKED, picked);
		planner.setMode(floorplannerModes.DIMENSION);

		clickPlan(100, 100);
		clickPlan(500, 100);

		expect(planner.selectedDimension).toBe(floorplan.dimensions[0]);
		expect(picked).toHaveBeenCalledTimes(1);
	});

	it('drops a half-placed dimension when the tool changes', () =>
	{
		planner.setMode(floorplannerModes.DIMENSION);
		clickPlan(100, 100);

		planner.setMode(floorplannerModes.MOVE);

		expect(planner.dimensionAnchor).toBeNull();
	});

	it('previews the dimension being placed without creating one', () =>
	{
		planner.setMode(floorplannerModes.DIMENSION);
		clickPlan(100, 100);
		planner.mousemove(atPlan(500, 100, 'pointermove'));

		const calls = draw();

		expect(callNames(calls)).toContain('stroke');
		expect(drawnText(calls)).toContain(planner.dimensioning.cmToMeasure(400));
		expect(floorplan.dimensions).toHaveLength(0);
	});
});

describe('placing a label, through the pointer', () =>
{
	it('takes one click, and hands the gesture to the panel', () =>
	{
		planner.setMode(floorplannerModes.TEXT);

		clickPlan(250, 350);

		expect(floorplan.annotations).toHaveLength(1);
		expect(floorplan.annotations[0].x).toBeCloseTo(250, 6);
		// Back to the pointer, because a label is placed in order to be typed into.
		expect(planner.mode).toBe(floorplannerModes.MOVE);
		expect(planner.selectedAnnotation).toBe(floorplan.annotations[0]);
	});

	it('announces the placement so the inspector opens on it', () =>
	{
		const picked = vi.fn();
		floorplan.addEventListener(EVENT_ANNOTATION_2D_CLICKED, picked);
		planner.setMode(floorplannerModes.TEXT);

		clickPlan(250, 350);

		expect(picked).toHaveBeenCalledTimes(1);
		expect(picked.mock.calls[0][0].item).toBe(floorplan.annotations[0]);
	});

	it('places where the click lands, with no pointer movement before it', () =>
	{
		planner.setMode(floorplannerModes.TEXT);

		// No mousemove at all - the case that broke the rectangle tool in E2.
		planner.mousedown(atPlan(640, 480, 'pointerdown'));
		planner.mouseup();

		expect(floorplan.annotations[0].x).toBeCloseTo(640, 6);
		expect(floorplan.annotations[0].y).toBeCloseTo(480, 6);
	});
});

describe('picking and dragging', () =>
{
	it('picks a dimension by its line, not by what it measures', () =>
	{
		const dimension = floorplan.newDimension(0, 0, 400, 0, {offset: 60});

		planner.mousedown(atPlan(200, 60, 'pointerdown'));

		expect(planner.selectedDimension).toBe(dimension);
	});

	it('picks a label by its anchor', () =>
	{
		const annotation = floorplan.newAnnotation(300, 300, 'Hall');

		planner.mousedown(atPlan(300, 300, 'pointerdown'));

		expect(planner.selectedAnnotation).toBe(annotation);
	});

	it('clears the annotation selection when something else is clicked', () =>
	{
		squareRoom(400);
		floorplan.newAnnotation(300, 300, 'Hall');
		planner.mousedown(atPlan(300, 300, 'pointerdown'));
		expect(planner.selectedAnnotation).not.toBeNull();

		planner.mousedown(atPlan(200, 0, 'pointerdown'));

		expect(planner.selectedAnnotation).toBeNull();
	});

	it('drags a label to where the pointer goes', () =>
	{
		const annotation = floorplan.newAnnotation(300, 300, 'Hall');

		planner.mousedown(atPlan(300, 300, 'pointerdown'));
		planner.mousemove(atPlan(500, 400, 'pointermove'));
		planner.mouseup();

		expect(annotation.x).toBeCloseTo(500, 6);
		expect(annotation.y).toBeCloseTo(400, 6);
	});

	/**
	 * The pan branch runs before the drag branches and its condition is a list of
	 * everything that could be grabbed. E1 found that the hard way when the first
	 * drag of a chair panned the whole plan instead.
	 */
	it('does not pan the plan while a label is being dragged', () =>
	{
		floorplan.newAnnotation(300, 300, 'Hall');
		const originX = planner.originX;

		planner.mousedown(atPlan(300, 300, 'pointerdown'));
		planner.mousemove(atPlan(500, 400, 'pointermove'));

		expect(planner.originX).toBe(originX);
	});

	it('drags a dimension\'s line to the pointer, and flips it past the middle', () =>
	{
		const dimension = floorplan.newDimension(0, 0, 400, 0, {offset: 60});

		planner.mousedown(atPlan(200, 60, 'pointerdown'));
		planner.mousemove(atPlan(200, 120, 'pointermove'));
		expect(dimension.offset).toBeCloseTo(120, 6);

		planner.mousemove(atPlan(200, -90, 'pointermove'));
		expect(dimension.offset).toBeCloseTo(-90, 6);

		planner.mouseup();
		expect(planner._draggingDimension).toBeNull();
	});

	it('erases either kind with the delete tool', () =>
	{
		floorplan.newDimension(0, 0, 400, 0, {offset: 60});
		floorplan.newAnnotation(300, 300, 'Hall');
		planner.setMode(floorplannerModes.DELETE);

		planner.mousedown(atPlan(300, 300, 'pointerdown'));
		expect(floorplan.annotations).toHaveLength(0);

		planner.mousedown(atPlan(200, 60, 'pointerdown'));
		expect(floorplan.dimensions).toHaveLength(0);
	});

	it('deletes whatever is selected when asked', () =>
	{
		const dimension = floorplan.newDimension(0, 0, 400, 0, {offset: 60});
		expect(planner.deleteSelectedAnnotation()).toBe(false);

		planner.selectAnnotationTarget(dimension);

		expect(planner.deleteSelectedAnnotation()).toBe(true);
		expect(floorplan.dimensions).toHaveLength(0);
		expect(planner.selectedDimension).toBeNull();
	});

	it('highlights a label on hover, and stops when the pointer leaves it', () =>
	{
		const annotation = floorplan.newAnnotation(300, 300, 'Hall');

		planner.mousemove(atPlan(300, 300, 'pointermove'));
		expect(planner.activeAnnotation).toBe(annotation);

		planner.mousemove(atPlan(700, 700, 'pointermove'));
		expect(planner.activeAnnotation).toBeNull();
	});
});

describe('showing what something else selected', () =>
{
	it('takes an object, and dispatches nothing', () =>
	{
		const dimension = floorplan.newDimension(0, 0, 400, 0);
		const picked = vi.fn();
		floorplan.addEventListener(EVENT_DIMENSION_2D_CLICKED, picked);

		planner.showSelection('dimension', dimension);

		expect(planner.selectedDimension).toBe(dimension);
		expect(picked).not.toHaveBeenCalled();
	});

	/**
	 * Undo restores by loading a file, so the object a selection named is gone
	 * and an equal one has taken its place. The id is what survives - which is
	 * why an annotation's id is persisted where a room's deliberately is not.
	 */
	it('takes an id, which is what survives an undo', () =>
	{
		const annotation = floorplan.newAnnotation(300, 300, 'Hall');
		const saved = floorplan.saveFloorplan();
		floorplan.loadFloorplan(saved);

		planner.showSelection('annotation', annotation.id);

		expect(planner.selectedAnnotation).not.toBeNull();
		expect(planner.selectedAnnotation).not.toBe(annotation);
		expect(planner.selectedAnnotation.text).toBe('Hall');
	});

	it('highlights nothing when an id is looked up in the wrong collection', () =>
	{
		const dimension = floorplan.newDimension(0, 0, 400, 0);

		planner.showSelection('annotation', dimension.id);

		expect(planner.selectedAnnotation).toBeNull();
		expect(planner.selectedDimension).toBe(dimension);
	});

	it('clears both when the selection goes', () =>
	{
		const annotation = floorplan.newAnnotation(300, 300, 'Hall');
		planner.showSelection('annotation', annotation);

		planner.showSelection(null, null);

		expect(planner.selectedAnnotation).toBeNull();
		expect(planner.selectedDimension).toBeNull();
	});
});
