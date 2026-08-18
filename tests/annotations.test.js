/**
 * What a plan says about itself: dimensions, labels, room type, ceiling height
 * and north (RM-008 E3).
 *
 * M-33 is the metric this file exists for, and it has two halves that fail in
 * opposite directions:
 *
 *   - every annotation type survives save, load and undo. Undo IS a save/load
 *     round trip here (`app/composables/useHistory.js` keeps snapshots, not
 *     commands), so the round-trip assertions below are the undo assertions.
 *
 *   - a file carrying none of it is byte-identical to one written before the
 *     sprint. That is the half an additive collection usually gets wrong: `[]`
 *     looks harmless and turns every file already on somebody's disk into a
 *     different file the first time they open and save it.
 *
 * The rest is the behaviour the drawing depends on - a dimension pinned to a
 * corner follows it, a dimension whose corner is deleted degrades rather than
 * disappearing, and a ceiling height is the corners rather than a second number
 * that can disagree with them.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {Dimension, TextAnnotation, dimensionLine, DEFAULT_DIMENSION_OFFSET, DEFAULT_ANNOTATION_SIZE} from '../src/scripts/model/annotation.js';
import {Configuration, configWallHeight} from '../src/scripts/core/configuration.js';
import {EVENT_ANNOTATIONS_CHANGED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';

/** A square room, four corners and four walls, returned in draw order. */
function squareRoom(floorplan, size)
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

/** Save, load into a fresh plan, and hand back both the plan and the string. */
function roundTrip(floorplan)
{
	const saved = JSON.stringify(floorplan.saveFloorplan());
	const reloaded = new Floorplan();
	reloaded.loadFloorplan(JSON.parse(saved));
	return {reloaded, saved};
}

beforeEach(() =>
{
	resetAll();
});

describe('a dimension measures two points', () =>
{
	it('refuses one with no length, because there is nothing to offset along', () =>
	{
		const floorplan = new Floorplan();

		expect(floorplan.newDimension(100, 100, 100, 100)).toBeNull();
		expect(floorplan.newDimension(0, 0, NaN, 0)).toBeNull();
		expect(floorplan.dimensions).toHaveLength(0);
	});

	it('measures the distance between its ends', () =>
	{
		const floorplan = new Floorplan();

		const dimension = floorplan.newDimension(0, 0, 300, 400);

		expect(dimension.length).toBe(500);
	});

	it('announces itself once, so one gesture is one undo entry', () =>
	{
		const floorplan = new Floorplan();
		const changed = vi.fn();
		floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, changed);

		const dimension = floorplan.newDimension(0, 0, 300, 0);
		dimension.setOffset(80);

		expect(changed).toHaveBeenCalledTimes(2);
	});

	it('says nothing when a setter is handed what it already holds', () =>
	{
		const floorplan = new Floorplan();
		const dimension = floorplan.newDimension(0, 0, 300, 0);
		const changed = vi.fn();
		floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, changed);

		dimension.setOffset(dimension.offset);
		dimension.setOffset(NaN);

		expect(changed).not.toHaveBeenCalled();
	});

	/**
	 * The reason a dimension carries corner ids at all: without this, a drawing
	 * is correct until the first edit and then quietly wrong.
	 */
	it('follows the corner it was pinned to when that corner moves', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const dimension = floorplan.newDimension(0, 0, 400, 0, {
			aCorner: corners[0].id, bCorner: corners[1].id,
		});
		expect(dimension.length).toBe(400);

		corners[1].move(600, 0);

		expect(dimension.length).toBe(600);
	});

	it('falls back to the point it stored when its corner is deleted', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const dimension = floorplan.newDimension(0, 0, 400, 0, {
			aCorner: corners[0].id, bCorner: corners[1].id,
		});

		corners[1].removeAll();

		// The last place that corner was, not zero and not a throw.
		expect(dimension.length).toBe(400);
		expect(dimension.points().bx).toBe(400);
	});

	it('detaches an end that is dragged somewhere else', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const dimension = floorplan.newDimension(0, 0, 400, 0, {
			aCorner: corners[0].id, bCorner: corners[1].id,
		});

		dimension.moveEnd('b', 500, 0);

		expect(dimension.bCorner).toBeNull();
		corners[1].move(900, 0);
		expect(dimension.length).toBe(500);
	});

	/**
	 * One formula, shared by the drawing, the hit test and the label. Two copies
	 * of it is how a dimension becomes clickable somewhere it is not drawn.
	 */
	it('offsets its line along the perpendicular, and flips with the sign', () =>
	{
		const floorplan = new Floorplan();
		const dimension = floorplan.newDimension(0, 0, 400, 0, {offset: 50});

		const line = dimensionLine(dimension);
		expect(line.ay).toBe(50);
		expect(line.by).toBe(50);
		expect(line.length).toBe(400);

		// The side is not asserted as "above" or "below": the canvas' y runs
		// downwards, so a sign is a side only once you have fixed which. What
		// matters, and what is asserted, is that flipping the sign flips the side.
		dimension.setOffset(-50);
		expect(dimensionLine(dimension).ay).toBe(-50);
	});

	it('has no line at all when it has no length', () =>
	{
		const floorplan = new Floorplan();
		// Through the class rather than the factory, which refuses to make one -
		// this is the shape a third-party file could carry.
		const degenerate = new Dimension(floorplan, 10, 10, 10, 10, {});

		expect(dimensionLine(degenerate)).toBeNull();
	});

	it('starts on the default offset, and remembers one that was asked for', () =>
	{
		const floorplan = new Floorplan();

		expect(floorplan.newDimension(0, 0, 100, 0).offset).toBe(DEFAULT_DIMENSION_OFFSET);
		expect(floorplan.newDimension(0, 50, 100, 50, {offset: 12}).offset).toBe(12);
	});
});

describe('a text label sits somewhere and says something', () =>
{
	it('takes a position, a default text and a default size', () =>
	{
		const floorplan = new Floorplan();

		const annotation = floorplan.newAnnotation(120, 240);

		expect(annotation.x).toBe(120);
		expect(annotation.y).toBe(240);
		expect(annotation.text).toBeTruthy();
		expect(annotation.size).toBe(DEFAULT_ANNOTATION_SIZE);
	});

	it('refuses a position it could not draw', () =>
	{
		const floorplan = new Floorplan();

		expect(floorplan.newAnnotation(NaN, 0)).toBeNull();
		expect(floorplan.annotations).toHaveLength(0);
	});

	it('takes an empty text, which is a label somebody is still typing', () =>
	{
		const floorplan = new Floorplan();
		const annotation = floorplan.newAnnotation(0, 0, 'Note');

		annotation.setText('');

		expect(annotation.text).toBe('');
	});

	it('refuses a size that could not be rendered', () =>
	{
		const floorplan = new Floorplan();
		const annotation = floorplan.newAnnotation(0, 0);

		annotation.setSize(0);
		annotation.setSize(-4);
		annotation.setSize(NaN);

		expect(annotation.size).toBe(DEFAULT_ANNOTATION_SIZE);
	});

	it('moves, and announces it', () =>
	{
		const floorplan = new Floorplan();
		const annotation = floorplan.newAnnotation(0, 0);
		const changed = vi.fn();
		floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, changed);

		annotation.moveTo(300, 400);

		expect(annotation.x).toBe(300);
		expect(annotation.y).toBe(400);
		expect(changed).toHaveBeenCalledTimes(1);
	});
});

describe('the plan owns both collections', () =>
{
	it('finds either kind by the id in its record', () =>
	{
		const floorplan = new Floorplan();
		const dimension = floorplan.newDimension(0, 0, 100, 0);
		const annotation = floorplan.newAnnotation(50, 50);

		expect(floorplan.annotationById(dimension.id)).toBe(dimension);
		expect(floorplan.annotationById(annotation.id)).toBe(annotation);
		expect(floorplan.annotationById('nothing')).toBeNull();
		expect(floorplan.annotationById('')).toBeNull();
	});

	it('removes one, and says whether there was one to remove', () =>
	{
		const floorplan = new Floorplan();
		const dimension = floorplan.newDimension(0, 0, 100, 0);

		expect(floorplan.removeDimension(dimension)).toBe(true);
		expect(floorplan.removeDimension(dimension)).toBe(false);
		expect(floorplan.dimensions).toHaveLength(0);
	});

	/**
	 * Nothing in the wall graph holds an annotation, so nothing else would clear
	 * them: before this, opening a second design left the first one's notes
	 * floating over it.
	 */
	it('drops everything authored when a new design is opened over it', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.newDimension(0, 0, 400, 0);
		floorplan.newAnnotation(200, 200, 'Hall');
		floorplan.north = 45;

		const empty = new Floorplan();
		floorplan.loadFloorplan(empty.saveFloorplan());

		expect(floorplan.dimensions).toHaveLength(0);
		expect(floorplan.annotations).toHaveLength(0);
		expect(floorplan.north).toBe(0);
	});

	it('picks the dimension line under a point, and not the points it measures', () =>
	{
		const floorplan = new Floorplan();
		const dimension = floorplan.newDimension(0, 0, 400, 0, {offset: 60});

		// On the offset line, which is what is drawn and what a person clicks.
		expect(floorplan.overlappedDimension(200, 60, 10)).toBe(dimension);
		// On the measured line, which is where the wall is.
		expect(floorplan.overlappedDimension(200, 0, 10)).toBeNull();
	});

	it('picks the label nearest a point, latest first', () =>
	{
		const floorplan = new Floorplan();
		floorplan.newAnnotation(100, 100, 'under');
		const over = floorplan.newAnnotation(100, 100, 'over');

		expect(floorplan.overlappedAnnotation(100, 100, 10)).toBe(over);
		expect(floorplan.overlappedAnnotation(400, 400, 10)).toBeNull();
	});
});

describe('north is a property of the building', () =>
{
	it('normalises into a single turn, so one bearing has one number', () =>
	{
		const floorplan = new Floorplan();

		floorplan.north = -90;
		expect(floorplan.north).toBe(270);

		floorplan.north = 450;
		expect(floorplan.north).toBe(90);
	});

	it('refuses what is not a bearing', () =>
	{
		const floorplan = new Floorplan();
		floorplan.north = 30;

		floorplan.north = NaN;
		floorplan.north = /** @type {*} */ ('east');

		expect(floorplan.north).toBe(30);
	});
});

describe('M-33 · everything authored survives a round trip', () =>
{
	it('writes no new key for a design nobody annotated', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);

		const saved = floorplan.saveFloorplan();

		expect(Object.prototype.hasOwnProperty.call(saved, 'dimensions')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(saved, 'annotations')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(saved, 'north')).toBe(false);
	});

	it('re-saves an un-annotated design byte-identically', () =>
	{
		const first = new Floorplan();
		squareRoom(first, 400);
		const original = JSON.stringify(first.saveFloorplan());

		const {reloaded} = roundTrip(first);

		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(original);
	});

	it('carries a dimension across, ids and pins included', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const dimension = floorplan.newDimension(0, 0, 400, 0, {
			offset: 75, aCorner: corners[0].id, bCorner: corners[1].id,
		});

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.dimensions).toHaveLength(1);
		expect(reloaded.dimensions[0].id).toBe(dimension.id);
		expect(reloaded.dimensions[0].offset).toBe(75);
		expect(reloaded.dimensions[0].aCorner).toBe(corners[0].id);
		expect(reloaded.dimensions[0].length).toBe(400);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	it('carries a label across, text and size included', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const annotation = floorplan.newAnnotation(120, 220, 'Service duct');
		annotation.setSize(18);

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.annotations).toHaveLength(1);
		expect(reloaded.annotations[0].id).toBe(annotation.id);
		expect(reloaded.annotations[0].text).toBe('Service duct');
		expect(reloaded.annotations[0].size).toBe(18);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	it('leaves a default size out of the file, and reads it back anyway', () =>
	{
		const floorplan = new Floorplan();
		floorplan.newAnnotation(0, 0, 'Note');

		const saved = floorplan.saveFloorplan();

		expect(Object.prototype.hasOwnProperty.call(saved.annotations[0], 'size')).toBe(false);
		const {reloaded} = roundTrip(floorplan);
		expect(reloaded.annotations[0].size).toBe(DEFAULT_ANNOTATION_SIZE);
	});

	it('carries north across', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.north = 137.5;

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.north).toBe(137.5);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	it('carries a room type across', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.getRooms()[0].name = 'Master';
		floorplan.getRooms()[0].type = 'Bedroom';

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.getRooms()[0].name).toBe('Master');
		expect(reloaded.getRooms()[0].type).toBe('Bedroom');
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	it('writes no type for a room that has none, and drops one that is cleared', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const room = floorplan.getRooms()[0];
		room.name = 'Master';

		let record = floorplan.saveFloorplan().rooms[room.roomByCornersId];
		expect(Object.prototype.hasOwnProperty.call(record, 'type')).toBe(false);

		room.type = 'Bedroom';
		room.type = '';

		record = floorplan.saveFloorplan().rooms[room.roomByCornersId];
		expect(Object.prototype.hasOwnProperty.call(record, 'type')).toBe(false);
	});

	it('carries all four at once, and re-saves identically', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		floorplan.newDimension(0, 0, 400, 0, {aCorner: corners[0].id});
		floorplan.newAnnotation(200, 200, 'Hall');
		floorplan.north = 22.5;
		floorplan.getRooms()[0].type = 'Living';

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.dimensions).toHaveLength(1);
		expect(reloaded.annotations).toHaveLength(1);
		expect(reloaded.north).toBe(22.5);
		expect(reloaded.getRooms()[0].type).toBe('Living');
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
	});

	/**
	 * The undo path, stated as such. `useHistory` restores by loading a saved
	 * string, so a restore is exactly the round trip above - including that a
	 * selection held by id finds the rebuilt object rather than a stale one.
	 */
	it('restores a selection by id, because the id is what is persisted', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const annotation = floorplan.newAnnotation(200, 200, 'Hall');

		const {reloaded} = roundTrip(floorplan);
		const restored = reloaded.annotationById(annotation.id);

		expect(restored).not.toBeNull();
		expect(restored).not.toBe(annotation);
		expect(restored.text).toBe('Hall');
	});
});

describe('the document validator is lenient where the format is', () =>
{
	function design(mutate)
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const doc = {floorplan: floorplan.saveFloorplan(), items: []};
		if (mutate)
		{
			mutate(doc.floorplan);
		}
		return JSON.stringify(doc);
	}

	it('accepts a file with none of it, which is every file written before E3', () =>
	{
		expect(DesignDocument.parse(design()).ok).toBe(true);
	});

	it('accepts a well-formed set', () =>
	{
		const json = design((plan) =>
		{
			plan.dimensions = [{id: 'd', a: {x: 0, y: 0}, b: {x: 400, y: 0}, offset: 40}];
			plan.annotations = [{id: 't', x: 10, y: 20, text: 'Hall', size: 18}];
			plan.north = 45;
		});

		expect(DesignDocument.parse(json).ok).toBe(true);
	});

	it('refuses a dimension with an end it could not draw', () =>
	{
		const json = design((plan) =>
		{
			plan.dimensions = [{id: 'd', a: {x: 0}, b: {x: 400, y: 0}}];
		});

		const result = DesignDocument.parse(json);

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('floorplan.dimensions[0].a.y');
	});

	it('refuses a collection that is not one', () =>
	{
		const result = DesignDocument.parse(design((plan) => {plan.annotations = {};}));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('floorplan.annotations');
	});

	it('refuses a label with no position, and a size that is not one', () =>
	{
		const noPosition = DesignDocument.parse(design((plan) =>
		{
			plan.annotations = [{id: 't', x: 'left', y: 0}];
		}));
		const badSize = DesignDocument.parse(design((plan) =>
		{
			plan.annotations = [{id: 't', x: 0, y: 0, size: 0}];
		}));

		expect(noPosition.ok).toBe(false);
		expect(noPosition.errors[0].path).toBe('floorplan.annotations[0].x');
		expect(badSize.ok).toBe(false);
		expect(badSize.errors[0].path).toBe('floorplan.annotations[0].size');
	});

	it('refuses a north that is not a number of degrees', () =>
	{
		const result = DesignDocument.parse(design((plan) => {plan.north = 'up';}));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('floorplan.north');
	});

	/**
	 * A bearing outside one turn is the same bearing written differently, so it
	 * loads and is normalised rather than refusing to open the design.
	 */
	it('opens a design whose north went round more than once', () =>
	{
		const json = design((plan) => {plan.north = 725;});
		expect(DesignDocument.parse(json).ok).toBe(true);

		const floorplan = new Floorplan();
		floorplan.loadFloorplan(JSON.parse(json).floorplan);
		expect(floorplan.north).toBe(5);
	});

	it('skips a record that is not an object rather than refusing the file', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const saved = floorplan.saveFloorplan();
		saved.dimensions = [null, {id: 'd', a: {x: 0, y: 0}, b: {x: 10, y: 0}}];

		const reloaded = new Floorplan();
		reloaded.loadFloorplan(saved);

		expect(reloaded.dimensions).toHaveLength(1);
	});
});

describe('a room\'s ceiling is its corners (RM-008 E3, following E2)', () =>
{
	it('reads the height off the corners rather than a field of its own', () =>
	{
		Configuration.setValue(configWallHeight, 250);
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);
		const room = floorplan.getRooms()[0];

		expect(room.ceilingHeight).toBe(250);
		expect(room.hasUniformCeiling).toBe(true);

		corners[0].elevation = 320;

		expect(room.ceilingHeight).toBe(320);
		expect(room.hasUniformCeiling).toBe(false);
	});

	it('writes every corner of the room when it is set', () =>
	{
		const floorplan = new Floorplan();
		const corners = squareRoom(floorplan, 400);

		expect(floorplan.getRooms()[0].setCeilingHeight(300)).toBe(true);

		corners.forEach((corner) => {expect(corner.elevation).toBe(300);});
	});

	it('does nothing when the room is already at that height', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const room = floorplan.getRooms()[0];
		room.setCeilingHeight(300);

		expect(room.setCeilingHeight(300)).toBe(false);
	});

	it('refuses a height that could not be built', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		const room = floorplan.getRooms()[0];
		room.setCeilingHeight(300);

		expect(room.setCeilingHeight(0)).toBe(false);
		expect(room.setCeilingHeight(-10)).toBe(false);
		expect(room.setCeilingHeight(NaN)).toBe(false);
		expect(room.ceilingHeight).toBe(300);
	});

	/**
	 * Nothing new is written, because the corner elevations already were. That
	 * is the whole argument for deriving it rather than storing a second number
	 * that could disagree with the geometry.
	 */
	it('survives a round trip without adding a field to the file', () =>
	{
		const floorplan = new Floorplan();
		squareRoom(floorplan, 400);
		floorplan.getRooms()[0].setCeilingHeight(310);

		const {reloaded, saved} = roundTrip(floorplan);

		expect(reloaded.getRooms()[0].ceilingHeight).toBe(310);
		expect(JSON.stringify(reloaded.saveFloorplan())).toBe(saved);
		Object.keys(JSON.parse(saved).rooms).forEach((key) =>
		{
			expect(Object.prototype.hasOwnProperty.call(JSON.parse(saved).rooms[key], 'ceilingHeight')).toBe(false);
		});
	});
});

describe('the annotation classes stand alone', () =>
{
	it('turn a NaN into a zero, so a bad number draws somewhere findable', () =>
	{
		const dimension = new Dimension(null, NaN, undefined, 'x', 10, {});
		const annotation = new TextAnnotation(null, NaN, 10, undefined, {});

		expect(dimension.ax).toBe(0);
		expect(dimension.ay).toBe(0);
		expect(dimension.bx).toBe(0);
		expect(dimension.by).toBe(10);
		expect(annotation.x).toBe(0);
		expect(annotation.text).toBeTruthy();
	});

	it('do not throw when they have no plan to tell', () =>
	{
		const dimension = new Dimension(null, 0, 0, 100, 0, {});
		const annotation = new TextAnnotation(null, 0, 0, 'x', {});

		expect(() => {dimension.setOffset(10);}).not.toThrow();
		expect(() => {annotation.moveTo(5, 5);}).not.toThrow();
	});

	it('fill in what a partial record left out', () =>
	{
		const dimension = Dimension.fromJSON(null, {});
		const annotation = TextAnnotation.fromJSON(null, {});

		expect(dimension.offset).toBe(DEFAULT_DIMENSION_OFFSET);
		expect(dimension.id).toBeTruthy();
		expect(annotation.size).toBe(DEFAULT_ANNOTATION_SIZE);
		expect(annotation.id).toBeTruthy();
	});
});
