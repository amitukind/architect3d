// @vitest-environment jsdom
/**
 * A door is five numbers (RM-008 F1).
 *
 * M-25 is the metric this file exists for: every door and window round-trips
 * width, height, sill, hinge and swing through the file, and its wall hole
 * matches them to the centimetre. That second half is the one the application
 * could not have had before, and RM-009 U-4 is why — the save record was a mesh
 * URL and three scale factors, so a size was "0.927 times whatever that file
 * happens to be" and a hinge side had nowhere to live at all.
 *
 * M-35 is the other: no opening exceeds its wall. RM-009 U-2 measured that an
 * oversized one does not fail — `ShapeGeometry` merges the hole into the
 * outline, so a 300 x 387 opening in a 400 x 250 wall produces a mesh 387 tall.
 * The wall grows to swallow it, silently. The assertions below are the ones that
 * measurement would have failed.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Shape, Path, Vector2, ShapeGeometry} from 'three';

import {
	newOpening, normaliseOpening, openingRectangle, clampOpening, buildOpeningGeometry,
	openingToJSON, OPENING_DOOR, OPENING_WINDOW, OPENING_ARCH, OPENING_DEFAULTS,
	HINGE_LEFT, HINGE_RIGHT,
} from '../src/scripts/items/opening.js';
import {item_types, ITEM_TYPE_PARAMETRIC_OPENING} from '../src/scripts/items/factory.js';
import {ParametricOpening} from '../src/scripts/items/parametric_opening.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {projectItem} from '../src/scripts/model/plan_projection.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

let canvasStub;

beforeEach(() =>
{
	resetAll();
	// `Item`'s constructor builds two canvas-backed size labels, so a jsdom
	// canvas with no 2D context floods the run with "not implemented" notices.
	// The same stub the floorplanner suites use.
	canvasStub = installCanvas2D(window);
});

afterEach(() =>
{
	canvasStub.restore();
});

describe('the description', () =>
{
	it('gives each kind the size a drawing would state', () =>
	{
		expect(newOpening(OPENING_DOOR)).toMatchObject({width: 90, height: 210, sill: 0, swing: 90});
		expect(newOpening(OPENING_WINDOW)).toMatchObject({width: 120, height: 120, sill: 90});
		expect(newOpening(OPENING_ARCH)).toMatchObject({sill: 0, swing: 0});
	});

	it('completes a partial record from its kind, and never returns a hole with no area', () =>
	{
		const partial = normaliseOpening({kind: OPENING_WINDOW, width: 180});

		expect(partial.width).toBe(180);
		expect(partial.height).toBe(OPENING_DEFAULTS[OPENING_WINDOW].height);
		expect(partial.sill).toBe(OPENING_DEFAULTS[OPENING_WINDOW].sill);

		// A person who typed 0 has made a mistake rather than a request.
		expect(normaliseOpening({width: 0}).width).toBeGreaterThan(0);
		expect(normaliseOpening({height: -50}).height).toBeGreaterThan(0);
		expect(normaliseOpening({width: 'wide'}).width).toBe(OPENING_DEFAULTS[OPENING_DOOR].width);
	});

	it('reads an unknown kind as a door rather than refusing the file', () =>
	{
		expect(normaliseOpening({kind: 'porthole'}).kind).toBe(OPENING_DOOR);
		expect(normaliseOpening(null).kind).toBe(OPENING_DOOR);
		expect(normaliseOpening(undefined).kind).toBe(OPENING_DOOR);
	});

	it('holds a swing inside half a turn', () =>
	{
		expect(normaliseOpening({swing: 400}).swing).toBe(180);
		expect(normaliseOpening({swing: -20}).swing).toBe(0);
	});

	/**
	 * The centre is what an item's y position needs, and it is derived rather
	 * than stored beside the sill - so the two cannot drift apart.
	 */
	it('derives the centre from the sill and the height', () =>
	{
		const window_ = normaliseOpening({kind: OPENING_WINDOW, sill: 90, height: 120});

		expect(openingRectangle(window_)).toEqual({width: 120, height: 120, bottom: 90, top: 210, centre: 150});
	});
});

describe('M-35 · no opening exceeds its wall', () =>
{
	it('trims the top and keeps the sill where it was asked for', () =>
	{
		const tall = normaliseOpening({kind: OPENING_WINDOW, sill: 100, height: 200});

		const fitted = clampOpening(tall, 250);

		expect(fitted.sill).toBe(100);
		expect(fitted.height).toBe(150);
		expect(openingRectangle(fitted).top).toBe(250);
	});

	it('brings the sill down when even that is above the wall', () =>
	{
		const impossible = normaliseOpening({kind: OPENING_WINDOW, sill: 400, height: 100});

		const fitted = clampOpening(impossible, 250);

		expect(fitted.sill).toBeLessThan(250);
		expect(openingRectangle(fitted).top).toBeLessThanOrEqual(250);
	});

	it('leaves an opening that already fits exactly as it was', () =>
	{
		const door = newOpening(OPENING_DOOR);

		expect(clampOpening(door, 250)).toBe(door);
	});

	/**
	 * The measurement RM-009 U-2 made, run again as an assertion. Without the
	 * clamp this is the observed behaviour, not a hypothetical: a hole taller
	 * than its wall is merged into the outline and the wall grows to swallow it.
	 */
	it('would otherwise make the wall taller, which is what U-2 measured', () =>
	{
		function wallTop(holeWidth, holeHeight)
		{
			const shape = new Shape([
				new Vector2(0, 0), new Vector2(400, 0), new Vector2(400, 250), new Vector2(0, 250),
			]);
			shape.holes.push(new Path([
				new Vector2(200 - holeWidth / 2, 0), new Vector2(200 + holeWidth / 2, 0),
				new Vector2(200 + holeWidth / 2, holeHeight), new Vector2(200 - holeWidth / 2, holeHeight),
			]));
			const geometry = new ShapeGeometry(shape);
			geometry.computeBoundingBox();
			return geometry.boundingBox.max.y;
		}

		// The finding, reproduced.
		expect(wallTop(300, 387)).toBe(387);
		// And the clamp that closes it.
		const fitted = clampOpening(normaliseOpening({width: 300, height: 387}), 250);
		expect(wallTop(fitted.width, openingRectangle(fitted).top)).toBe(250);
	});
});

describe('the generator', () =>
{
	it('builds a mesh the width and height it was asked for', () =>
	{
		const built = buildOpeningGeometry(normaliseOpening({width: 90, height: 210, swing: 0}), 10);
		built.geometry.computeBoundingBox();
		const box = built.geometry.boundingBox;

		expect(box.max.x - box.min.x).toBeCloseTo(90, 6);
		expect(box.max.y - box.min.y).toBeCloseTo(210, 6);
	});

	it('sets the frame into the wall it is going into', () =>
	{
		const thin = buildOpeningGeometry(normaliseOpening({swing: 0}), 10);
		const thick = buildOpeningGeometry(normaliseOpening({swing: 0}), 40);
		thin.geometry.computeBoundingBox();
		thick.geometry.computeBoundingBox();

		expect(thick.geometry.boundingBox.max.z - thick.geometry.boundingBox.min.z)
			.toBeGreaterThan(thin.geometry.boundingBox.max.z - thin.geometry.boundingBox.min.z);
	});

	it('names a material slot per part, and gives glass its own', () =>
	{
		const door = buildOpeningGeometry(newOpening(OPENING_DOOR), 10);
		const window_ = buildOpeningGeometry(newOpening(OPENING_WINDOW), 10);

		expect(door.materials).toHaveLength(3);
		expect(door.geometry.groups.some((group) => group.materialIndex === 1)).toBe(true);
		expect(door.geometry.groups.some((group) => group.materialIndex === 2)).toBe(false);
		expect(window_.geometry.groups.some((group) => group.materialIndex === 2)).toBe(true);
	});

	it('gives an archway nothing but its frame', () =>
	{
		const arch = buildOpeningGeometry(newOpening(OPENING_ARCH), 10);

		expect(arch.geometry.groups.every((group) => group.materialIndex === 0)).toBe(true);
	});

	/**
	 * The leaf is drawn open, which is exactly why the item's extent cannot be
	 * read off the geometry - a 90 cm door standing open is 86 cm deep, and a
	 * size taken from that would cut an 86 cm hole through the wall.
	 */
	it('swings the leaf, so the mesh is deeper than the wall it sits in', () =>
	{
		const shut = buildOpeningGeometry(normaliseOpening({swing: 0}), 10);
		const open = buildOpeningGeometry(normaliseOpening({swing: 90}), 10);
		shut.geometry.computeBoundingBox();
		open.geometry.computeBoundingBox();

		const shutDepth = shut.geometry.boundingBox.max.z - shut.geometry.boundingBox.min.z;
		const openDepth = open.geometry.boundingBox.max.z - open.geometry.boundingBox.min.z;

		expect(shutDepth).toBeLessThan(20);
		expect(openDepth).toBeGreaterThan(70);
	});

	it('swings it the other way for a right-hand hinge', () =>
	{
		const left = buildOpeningGeometry(normaliseOpening({hinge: HINGE_LEFT, swing: 90}), 10);
		const right = buildOpeningGeometry(normaliseOpening({hinge: HINGE_RIGHT, swing: 90}), 10);
		left.geometry.computeBoundingBox();
		right.geometry.computeBoundingBox();

		// Mirror images about x, so the two boxes are reflections of each other.
		expect(left.geometry.boundingBox.max.x).toBeCloseTo(-right.geometry.boundingBox.min.x, 4);
	});
});

describe('the item type', () =>
{
	it('is registered at 10, leaving the eight originals where they are', () =>
	{
		expect(ITEM_TYPE_PARAMETRIC_OPENING).toBe(10);
		expect(item_types[10]).toBe(ParametricOpening);
		expect(item_types[3].name).toBe('InWallItem');
		expect(item_types[7].name).toBe('InWallFloorItem');
	});
});

describe('M-25 · the file carries the door', () =>
{
	it('writes all seven fields', () =>
	{
		const record = openingToJSON(normaliseOpening({
			kind: OPENING_WINDOW, width: 180, height: 140, sill: 85, hinge: HINGE_RIGHT, swing: 0,
		}));

		expect(record).toEqual({
			kind: 'window', width: 180, height: 140, sill: 85, hinge: 'right', swing: 0, style: 'plain',
		});
	});

	it('reads back exactly what it wrote', () =>
	{
		const original = normaliseOpening({kind: OPENING_DOOR, width: 95.5, height: 205, sill: 0, hinge: HINGE_RIGHT, swing: 45});

		expect(normaliseOpening(JSON.parse(JSON.stringify(openingToJSON(original))))).toEqual(original);
	});

	/**
	 * The hole and the record are the same numbers, which is the whole claim.
	 * Before F1 the hole was the mesh's bounding box and the record was a scale
	 * factor, so "matches to the centimetre" was not even expressible.
	 */
	it('cuts a hole that is the numbers in the file', () =>
	{
		const opening = normaliseOpening({kind: OPENING_WINDOW, width: 180, height: 140, sill: 85});
		const record = openingToJSON(opening);

		const rectangle = openingRectangle(normaliseOpening(record));

		expect(rectangle.width).toBe(record.width);
		expect(rectangle.height).toBe(record.height);
		expect(rectangle.bottom).toBe(record.sill);
	});
});

describe('the document validator', () =>
{
	function design(item)
	{
		const floorplan = new Floorplan();
		floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(400, 0));
		return JSON.stringify({floorplan: floorplan.saveFloorplan(), items: [item]});
	}

	it('accepts an item with no opening, which is every item in every older file', () =>
	{
		expect(DesignDocument.parse(design({model_url: 'models/gltf/chair.glb'})).ok).toBe(true);
	});

	it('accepts a parametric opening, which names no model', () =>
	{
		const json = design({item_type: 10, opening: {kind: 'door', width: 90, height: 210}});

		expect(DesignDocument.parse(json).ok).toBe(true);
	});

	it('still requires a model URL from an item that is not one', () =>
	{
		const result = DesignDocument.parse(design({item_type: 1}));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('items[0].model_url');
	});

	it('refuses a width the file cannot mean', () =>
	{
		const result = DesignDocument.parse(design({item_type: 10, opening: {kind: 'door', width: -90}}));

		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('items[0].opening.width');
	});

	it('refuses an opening that is not an object', () =>
	{
		const result = DesignDocument.parse(design({item_type: 10, opening: 'door'}));

		expect(result.ok).toBe(false);
		// Collected rather than thrown at the first: this record has two problems -
		// the opening is a string, and with no usable opening it is an ordinary
		// item that has not named a model - and the validator reports both, which
		// is what it documents and what lets a person fix a file in one pass.
		expect(result.errors.map((problem) => problem.path)).toContain('items[0].opening');
	});
});

describe('the plan sees the numbers', () =>
{
	/** Enough of an item for `projectItem` to read, which is all it reads. */
	function fakeOpening(opening)
	{
		return {
			designId: 'door-1',
			position: {x: 200, y: 105, z: 0},
			halfSize: {x: opening.width / 2, y: opening.height / 2, z: 5},
			rotation: {x: 0, y: 0, z: 0},
			fixed: false,
			currentWallEdge: null,
			metadata: {itemName: 'Door', itemType: 10},
			opening: opening,
		};
	}

	it('carries the five numbers onto the footprint', () =>
	{
		const opening = normaliseOpening({kind: OPENING_DOOR, hinge: HINGE_RIGHT, swing: 45});

		const footprint = projectItem(fakeOpening(opening));

		expect(footprint.opening).toEqual({
			kind: 'door', width: 90, height: 210, sill: 0, hinge: 'right', swing: 45,
		});
	});

	/**
	 * Copied rather than referenced. A footprint is plain data the 2D view may
	 * hold until the next projection, and handing it a live object would let the
	 * view read a state the drawing was not made from.
	 */
	it('copies it, so the view cannot read a state it did not draw', () =>
	{
		const opening = newOpening(OPENING_DOOR);

		const footprint = projectItem(fakeOpening(opening));
		opening.width = 300;

		expect(footprint.opening.width).toBe(90);
	});

	it('is null for an item that is not an opening, which is every mesh door', () =>
	{
		const footprint = projectItem({
			designId: 'x', position: {x: 0, y: 0, z: 0}, halfSize: {x: 1, y: 1, z: 1},
			rotation: {x: 0, y: 0, z: 0}, metadata: {itemName: 'Closed Door', itemType: 7},
		});

		expect(footprint.opening).toBeNull();
	});
});

describe('the item, built and edited', () =>
{
	/**
	 * A `Model` stand-in. `Item` reads `model.scene` for the object to add its box
	 * helper to and for `needsUpdate`, and nothing else in this file's path.
	 */
	function fakeModel()
	{
		return {scene: {add() {}, remove() {}, needsUpdate: false}};
	}

	function anOpening(overrides)
	{
		const opening = normaliseOpening(Object.assign({kind: OPENING_DOOR}, overrides || {}));
		const built = buildOpeningGeometry(opening, 10);
		return new ParametricOpening(
			fakeModel(),
			{itemName: 'Door', itemType: 10, resizable: true, opening: opening, wallThickness: 10},
			built.geometry, built.materials);
	}

	/**
	 * The reason `objectHalfSize` is overridden, stated as a test. A 90 cm door
	 * standing 90 degrees open has a bounding box 86 cm deep; a size read off it
	 * would cut an 86 cm hole through the wall, hand the plan an 86 cm-deep
	 * footprint and give it an 86 cm-deep target to pick.
	 */
	it('takes its extent from its numbers, not from its open leaf', () =>
	{
		const door = anOpening({swing: 90});

		expect(door.halfSize.x).toBe(45);
		expect(door.halfSize.y).toBe(105);
		expect(door.halfSize.z).toBe(5);

		door.geometry.computeBoundingBox();
		const meshDepth = door.geometry.boundingBox.max.z - door.geometry.boundingBox.min.z;
		expect(meshDepth).toBeGreaterThan(70);
	});

	it('states the rectangle it cuts', () =>
	{
		const window_ = anOpening({kind: OPENING_WINDOW, sill: 90, height: 120});

		expect(window_.wallOpening()).toEqual({width: 120, height: 120, bottom: 90, top: 210, centre: 150});
	});

	it('rebuilds when a number changes, and moves to the new centre', () =>
	{
		const window_ = anOpening({kind: OPENING_WINDOW});
		const before = window_.geometry;

		window_.setOpening({sill: 120, height: 100});

		expect(window_.opening.sill).toBe(120);
		expect(window_.halfSize.y).toBe(50);
		expect(window_.position.y).toBe(170);
		expect(window_.geometry).not.toBe(before);
	});

	it('does nothing at all when handed what it already holds', () =>
	{
		const door = anOpening();
		const geometry = door.geometry;

		door.setOpening({width: door.opening.width});

		expect(door.geometry).toBe(geometry);
	});

	it('refuses a number it could not build, and says what it took', () =>
	{
		const door = anOpening();

		const taken = door.setOpening({width: 0, swing: 400});

		expect(taken.width).toBeGreaterThan(0);
		expect(taken.swing).toBe(180);
	});

	it('writes its description into the saved record, and nothing else does', () =>
	{
		const door = anOpening({hinge: HINGE_RIGHT, swing: 45});

		const record = door.getMetaData();

		expect(record.opening).toEqual({
			kind: 'door', width: 90, height: 210, sill: 0, hinge: 'right', swing: 45, style: 'plain',
		});
		expect(record.item_type).toBe(10);
	});

	/**
	 * The leak RM-003 A0 spent a sprint on, applied to the one item in the tree
	 * that regenerates its own mesh - and it regenerates on every step of a
	 * slider.
	 */
	it('disposes the geometry it replaces', () =>
	{
		const door = anOpening();
		const first = door.geometry;
		let disposed = false;
		first.dispose = () => {disposed = true;};

		door.setOpening({width: 120});

		expect(disposed).toBe(true);
	});
});
