// @vitest-environment jsdom
/**
 * A column and a beam are numbers (RM-008 F2, delivered after F3).
 *
 * F2 shipped without this and said so in its own LANDED block: a new persisted
 * item type needs a class, a type number, catalog rows, an inspector and
 * round-trip tests, and shipping one without them would be worse than not
 * shipping it. This file is the round-trip tests, and **M-41** is the metric
 * the slice is accepted on.
 *
 * The interesting assertions here are the two the previous two sprints paid for
 * by finding them in a live page. F1 measured a 210 cm door hanging 20 cm above
 * the floor; F3 measured a railed flight that would have floated 45 cm. A beam
 * is the same class of problem stated in advance - `FloorItem.resized` stands
 * everything on the floor and a beam's whole point is that it is not on the
 * floor - so it is asserted here and again in the browser rather than assumed
 * to have been thought of.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Vector3} from 'three';

import {
	newStructure, normaliseStructure, structureExtent, isOverhead,
	buildStructureGeometry, structureToJSON,
	STRUCTURE_COLUMN, STRUCTURE_BEAM, STRUCTURE_DEFAULTS,
	SECTION_RECTANGULAR, SECTION_ROUND,
} from '../src/scripts/items/structure.js';
import {item_types, ITEM_TYPE_PARAMETRIC_STRUCTURE} from '../src/scripts/items/factory.js';
import {ParametricStructure} from '../src/scripts/items/parametric_structure.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {projectItem} from '../src/scripts/model/plan_projection.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

let canvasStub;

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
});

afterEach(() =>
{
	canvasStub.restore();
});

/** The mesh's extent, which is what M-41 compares the description against. */
function meshSize(structure)
{
	const geometry = buildStructureGeometry(structure).geometry;
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	return new Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

describe('the description', () =>
{
	it('starts each kind at a member somebody would specify', () =>
	{
		expect(newStructure(STRUCTURE_COLUMN)).toMatchObject({width: 30, depth: 30, length: 250, soffit: 0});
		// 200 x 400 spanning 3000 with its soffit at 2100, so its top lands on a
		// 2500 wall's head - which is the number below, derived rather than stored.
		expect(newStructure(STRUCTURE_BEAM)).toMatchObject({width: 20, depth: 40, length: 300, soffit: 210});
		expect(structureExtent(newStructure(STRUCTURE_BEAM)).top).toBe(250);
	});

	it('completes a partial record and clamps what cannot be built', () =>
	{
		expect(normaliseStructure({kind: STRUCTURE_BEAM, length: 500}))
			.toMatchObject({kind: STRUCTURE_BEAM, length: 500, depth: STRUCTURE_DEFAULTS[STRUCTURE_BEAM].depth});

		expect(normaliseStructure({width: 0}).width).toBeGreaterThan(0);
		expect(normaliseStructure({length: -3}).length).toBeGreaterThan(0);
		expect(normaliseStructure({depth: 'deep'}).depth).toBe(STRUCTURE_DEFAULTS[STRUCTURE_COLUMN].depth);
		expect(normaliseStructure({width: 9000}).width).toBe(500);
		// A soffit of zero is the right and usual answer for a column, so it is
		// the one number here whose floor is zero rather than one.
		expect(normaliseStructure({soffit: 0}).soffit).toBe(0);
		expect(normaliseStructure({soffit: -50}).soffit).toBe(0);
	});

	it('reads an unknown kind as a column rather than refusing the file', () =>
	{
		expect(normaliseStructure({kind: 'buttress'}).kind).toBe(STRUCTURE_COLUMN);
		expect(normaliseStructure(null).kind).toBe(STRUCTURE_COLUMN);
	});

	/**
	 * A round section has one dimension. Storing two would let a file say
	 * something a circle cannot be, which is the same rule that keeps a stair's
	 * height and an opening's centre out of the file.
	 */
	it('forces a round column to one cross-section dimension', () =>
	{
		const round = normaliseStructure({section: SECTION_ROUND, width: 40, depth: 25});

		expect(round.depth).toBe(40);
		expect(round.width).toBe(40);
	});

	it('refuses a round beam, because a round beam is a pipe', () =>
	{
		expect(normaliseStructure({kind: STRUCTURE_BEAM, section: SECTION_ROUND}).section)
			.toBe(SECTION_RECTANGULAR);
	});
});

describe('M-41 - a member is its numbers', () =>
{
	const CASES = [];
	[STRUCTURE_COLUMN, STRUCTURE_BEAM].forEach((kind) =>
	{
		[[30, 30, 250, 0], [20, 45, 320, 0], [45, 30, 180, 40], [12, 60, 600, 215]].forEach(([width, depth, length, soffit]) =>
		{
			CASES.push({kind, width, depth, length, soffit});
		});
	});

	it.each(CASES)('$kind $width x $depth x $length at $soffit', (spec) =>
	{
		const structure = normaliseStructure(spec);
		const extent = structureExtent(structure);
		const size = meshSize(structure);

		// The mesh IS the cross-section and the length, whichever way the member
		// runs - a column's length goes up, a beam's goes along.
		expect(size.x).toBeCloseTo(structure.width, 6);
		if (structure.kind === STRUCTURE_COLUMN)
		{
			expect(size.y).toBeCloseTo(structure.length, 6);
			expect(size.z).toBeCloseTo(structure.depth, 6);
		}
		else
		{
			expect(size.y).toBeCloseTo(structure.depth, 6);
			expect(size.z).toBeCloseTo(structure.length, 6);
		}

		// And the derived heights are the arithmetic, with nothing stored beside
		// them to disagree.
		expect(extent.top).toBeCloseTo(structure.soffit + extent.rise, 9);
		expect(extent.centre).toBeCloseTo(structure.soffit + extent.rise / 2, 9);
		expect(extent.halfY * 2).toBeCloseTo(extent.rise, 9);
	});

	it('makes a round column the diameter it says, not the circumscribed square', () =>
	{
		const round = normaliseStructure({section: SECTION_ROUND, width: 36});
		const size = meshSize(round);

		expect(size.x).toBeCloseTo(36, 6);
		expect(size.z).toBeCloseTo(36, 6);
	});

	it('centres every member on itself, so its soffit is the only thing placing it', () =>
	{
		[{}, {section: SECTION_ROUND}, {kind: STRUCTURE_BEAM}].forEach((spec) =>
		{
			const geometry = buildStructureGeometry(normaliseStructure(spec)).geometry;
			geometry.computeBoundingBox();

			expect(geometry.boundingBox.min.y + geometry.boundingBox.max.y).toBeCloseTo(0, 9);
			expect(geometry.boundingBox.min.x + geometry.boundingBox.max.x).toBeCloseTo(0, 9);
		});
	});
});

describe('cut or overhead', () =>
{
	/**
	 * The distinction the plan symbol is built on: a plan is a horizontal section
	 * about a metre up, so a column is cut by it and a beam is above it.
	 */
	it('knows which side of the plan\'s section each kind is on', () =>
	{
		expect(isOverhead(newStructure(STRUCTURE_COLUMN))).toBe(false);
		expect(isOverhead(newStructure(STRUCTURE_BEAM))).toBe(true);
	});
});

describe('the item', () =>
{
	function fakeModel()
	{
		return {scene: {add() {}, remove() {}, needsUpdate: false}};
	}

	function aMember(overrides)
	{
		const structure = normaliseStructure(overrides || {});
		const built = buildStructureGeometry(structure);
		return new ParametricStructure(
			fakeModel(),
			{itemName: 'Member', itemType: 12, resizable: true, structure: structure},
			built.geometry, built.materials);
	}

	it('is registered as item type 12', () =>
	{
		expect(ITEM_TYPE_PARAMETRIC_STRUCTURE).toBe(12);
		expect(item_types[12]).toBe(ParametricStructure);
	});

	it('takes its extent from its numbers', () =>
	{
		const beam = aMember({kind: STRUCTURE_BEAM});

		expect(beam.halfSize.x).toBeCloseTo(10, 9);
		expect(beam.halfSize.y).toBeCloseTo(20, 9);
		expect(beam.halfSize.z).toBeCloseTo(150, 9);
	});

	/**
	 * The bug this pins, in advance rather than after. `FloorItem.resized` sets
	 * `position.y = halfSize.y`, which stands everything on the floor: a beam
	 * with a 210 cm soffit would sit with its underside at zero and its top at
	 * 40. F1 found this shape of fault by placing a door and F3 by placing a
	 * flight; this is the third and the first one that was expected.
	 */
	it('stands a beam at its soffit and a column on the floor', () =>
	{
		const beam = aMember({kind: STRUCTURE_BEAM});
		const column = aMember({kind: STRUCTURE_COLUMN});

		expect(beam.position.y).toBeCloseTo(230, 9);
		expect(beam.position.y - beam.halfSize.y).toBeCloseTo(210, 9);
		expect(column.position.y).toBeCloseTo(125, 9);
		expect(column.position.y - column.halfSize.y).toBeCloseTo(0, 9);
	});

	it('keeps the soffit through an edit', () =>
	{
		const beam = aMember({kind: STRUCTURE_BEAM});

		beam.setStructure({depth: 60, soffit: 190});

		expect(beam.position.y - beam.halfSize.y).toBeCloseTo(190, 9);
		expect(beam.halfSize.y).toBeCloseTo(30, 9);
	});

	it('regenerates everything downstream from one changed number', () =>
	{
		const member = aMember();
		const before = member.geometry;

		member.setStructure({kind: STRUCTURE_BEAM});

		expect(member.geometry).not.toBe(before);
		expect(member.halfSize.z).toBeCloseTo(structureExtent(member.structure).halfZ, 9);
	});

	it('disposes the mesh it replaces', () =>
	{
		const member = aMember();
		const before = member.geometry;
		let disposed = false;
		before.dispose = () => {disposed = true;};

		member.setStructure({width: 40});

		expect(disposed).toBe(true);
	});

	it('does nothing at all when the numbers do not change', () =>
	{
		const member = aMember();
		const before = member.geometry;

		member.setStructure({width: member.structure.width});

		expect(member.geometry).toBe(before);
	});

	it('clamps what it is handed, and says what it took', () =>
	{
		const member = aMember();

		expect(member.setStructure({width: 9000}).width).toBe(500);
		expect(member.setStructure({section: SECTION_ROUND}).depth).toBe(500);
	});
});

describe('the file', () =>
{
	function fakeModel()
	{
		return {scene: {add() {}, remove() {}, needsUpdate: false}};
	}

	it('writes every number, because there is no default to fall back on', () =>
	{
		expect(structureToJSON(normaliseStructure({kind: STRUCTURE_BEAM, length: 450}))).toEqual({
			kind: STRUCTURE_BEAM, width: 20, depth: 40, length: 450, soffit: 210,
			section: SECTION_RECTANGULAR, style: 'plain',
		});
	});

	it('round-trips through the record it writes', () =>
	{
		const structure = normaliseStructure({kind: STRUCTURE_BEAM, width: 25, depth: 55, length: 520, soffit: 195});
		const built = buildStructureGeometry(structure);
		const item = new ParametricStructure(
			fakeModel(),
			{itemName: 'Beam', itemType: 12, resizable: true, structure: structure},
			built.geometry, built.materials);

		expect(normaliseStructure(item.getMetaData().structure)).toEqual(item.structure);
	});

	it('is absent from an item that has none, which is every older file', () =>
	{
		const parsed = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Chair', model_url: 'models/gltf/chair.glb', item_type: 1}],
		}));

		expect(parsed.errors).toEqual([]);
		expect(parsed.document.items[0].structure).toBeUndefined();
	});

	it('lets a member name no model', () =>
	{
		const parsed = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Column', item_type: 12, structure: {kind: 'column', width: 30}}],
		}));

		expect(parsed.errors).toEqual([]);
	});

	it('refuses numbers a member cannot mean, and accepts a soffit of zero', () =>
	{
		const bad = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Column', item_type: 12, structure: {width: -3, depth: 'deep', soffit: -1}}],
		}));

		expect(bad.errors.map((error) => error.path)).toEqual([
			'items[0].structure.width', 'items[0].structure.depth', 'items[0].structure.soffit',
		]);

		const zero = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Column', item_type: 12, structure: {soffit: 0}}],
		}));
		expect(zero.errors).toEqual([]);
	});
});

describe('the plan projection', () =>
{
	it('carries the member, copied rather than referenced', () =>
	{
		const structure = normaliseStructure({kind: STRUCTURE_BEAM});
		const footprint = projectItem({
			designId: 'b1',
			position: {x: 100, y: 230, z: 200},
			halfSize: {x: 10, y: 20, z: 150},
			rotation: {y: 0},
			metadata: {itemType: 12, itemName: 'Beam'},
			structure: structure,
		});

		expect(footprint.structure).toMatchObject({kind: STRUCTURE_BEAM, width: 20, depth: 40, length: 300});
		expect(footprint.structure).not.toBe(structure);
	});

	it('leaves every other item\'s structure null', () =>
	{
		const footprint = projectItem({
			designId: 'c1',
			position: {x: 0, y: 0, z: 0},
			halfSize: {x: 30, y: 40, z: 30},
			rotation: {y: 0},
			metadata: {itemType: 1, itemName: 'Chair'},
		});

		expect(footprint.structure).toBeNull();
	});
});
