// @vitest-environment jsdom
/**
 * Stairwells and the first roof (RM-010 G2).
 *
 * Two metrics live here. **M-39** is the stairwell: a flight on the lower storey
 * puts a hole in the floor above that contains its stairwell rectangle, and the
 * room's stated area is its polygon minus that hole. **M-40** is the roof: every
 * generated roof covers the whole exterior footprint, for each of the three
 * kinds, at every pitch the inspector offers.
 *
 * The third acceptance line - *a floor opening never makes a floor larger, at
 * any size or position* - is the one RM-010 V-3 would have failed. `ShapeGeometry`
 * does not cut a hole that pokes outside its outline, it merges the hole INTO
 * the outline: a 400 cm floor with a straddling hole came out with a bounding
 * box of -100..500. The floor gets bigger, silently.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Shape, ShapeGeometry, Vector2} from 'three';

import {Model} from '../src/scripts/model/model.js';
import {
	pointInside, polygonInside, polygonArea, clampOpeningToRoom, placeRectangle,
} from '../src/scripts/model/floor_opening.js';
import {
	normaliseRoof, newRoof, roofFootprint, roofMetrics, buildRoofGeometry, roofToJSON,
	ROOF_FLAT, ROOF_GABLE, ROOF_HIP, RIDGE_X, RIDGE_Z, ROOF_DEFAULTS, MAX_PITCH,
} from '../src/scripts/items/roof.js';
import {stairPlan, normaliseStair} from '../src/scripts/items/stair.js';
import {DesignDocument} from '../src/scripts/model/document.js';
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

const SQUARE = [{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 400}, {x: 0, y: 400}];
/** An L, for the case a bounding-box clamp gets wrong. */
const ELL = [
	{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 160},
	{x: 160, y: 160}, {x: 160, y: 400}, {x: 0, y: 400},
];

function rect(x0, y0, x1, y1)
{
	return [{x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1}];
}

function room(size)
{
	return {
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: size, y: 0, elevation: 250},
			c3: {x: size, y: size, elevation: 250}, c4: {x: 0, y: size, elevation: 250},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {}, units: 'cm', version: '2.0.0',
	};
}

describe('the predicates, which are new because the old ones are pinned', () =>
{
	/**
	 * `core/utils.js` holds four PRESERVED BUGS - `pointInPolygon` returns false
	 * and `polygonPolygonIntersect` returns false - pinned by characterization
	 * tests and left alone on purpose. Turning them on is RM-007 J4's deliberate
	 * re-baseline. These are a fresh pair, used by this module and nothing else.
	 */
	it('answers point-in-polygon correctly, unlike the pinned one', () =>
	{
		expect(pointInside({x: 200, y: 200}, SQUARE)).toBe(true);
		expect(pointInside({x: 500, y: 200}, SQUARE)).toBe(false);
		expect(pointInside({x: 300, y: 300}, ELL)).toBe(false);
		expect(pointInside({x: 80, y: 300}, ELL)).toBe(true);
	});

	it('knows a polygon is wholly inside another, notch and all', () =>
	{
		expect(polygonInside(rect(50, 50, 150, 150), SQUARE)).toBe(true);
		expect(polygonInside(rect(-50, 50, 150, 150), SQUARE)).toBe(false);
		// The case a corners-only test gets wrong: every corner of this rectangle
		// is inside the L, and the rectangle spans the notch.
		expect(polygonInside(rect(40, 40, 300, 300), ELL)).toBe(false);
	});

	it('measures a polygon the way the shoelace does', () =>
	{
		expect(polygonArea(SQUARE)).toBe(160000);
		expect(polygonArea(rect(0, 0, 90, 300))).toBe(27000);
	});
});

describe('the clamp - a floor opening never makes a floor larger', () =>
{
	it('leaves an opening that already fits exactly as it was', () =>
	{
		const opening = rect(100, 100, 200, 300);

		expect(clampOpeningToRoom(opening, SQUARE)).toEqual({polygon: opening, scale: 1});
	});

	/**
	 * The assertion RM-010 V-3 would have failed, run through the primitive that
	 * fails it rather than argued about.
	 */
	it('keeps the floor its own size, which an unclamped hole does not', () =>
	{
		const straddling = rect(-100, 100, 500, 300);

		const unclamped = new ShapeGeometry(withHole(SQUARE, straddling));
		unclamped.computeBoundingBox();
		// This is the bug: the hole is merged into the outline and the floor grows.
		expect(unclamped.boundingBox.min.x).toBeLessThan(0);
		expect(unclamped.boundingBox.max.x).toBeGreaterThan(400);

		const clamped = clampOpeningToRoom(straddling, SQUARE);
		const cut = new ShapeGeometry(withHole(SQUARE, clamped.polygon));
		cut.computeBoundingBox();

		expect(cut.boundingBox.min.x).toBeCloseTo(0, 6);
		expect(cut.boundingBox.max.x).toBeCloseTo(400, 6);
		expect(clamped.scale).toBeLessThan(1);
	});

	it('never makes a floor larger, at any size or position', () =>
	{
		const bare = new ShapeGeometry(new Shape(SQUARE.map((p) => new Vector2(p.x, p.y))));
		bare.computeBoundingBox();

		[
			rect(-500, -500, 900, 900), rect(-100, 190, 100, 210),
			rect(380, 100, 460, 300), rect(150, -50, 250, 450),
			rect(199, 199, 201, 201),
		].forEach((opening) =>
		{
			const clamped = clampOpeningToRoom(opening, SQUARE);
			if (!clamped)
			{
				return;
			}
			const cut = new ShapeGeometry(withHole(SQUARE, clamped.polygon));
			cut.computeBoundingBox();

			expect(cut.boundingBox.min.x).toBeGreaterThanOrEqual(bare.boundingBox.min.x - 1e-6);
			expect(cut.boundingBox.max.x).toBeLessThanOrEqual(bare.boundingBox.max.x + 1e-6);
			expect(cut.boundingBox.min.y).toBeGreaterThanOrEqual(bare.boundingBox.min.y - 1e-6);
			expect(cut.boundingBox.max.y).toBeLessThanOrEqual(bare.boundingBox.max.y + 1e-6);
		});
	});

	it('declines an opening over another room entirely', () =>
	{
		// Which is how "which room is this stair over" is answered: no amount of
		// shrinking moves a hole into a room it is not above.
		expect(clampOpeningToRoom(rect(600, 600, 700, 700), SQUARE)).toBeNull();
	});

	it('turns the rectangle with the flight it came from', () =>
	{
		const upright = placeRectangle({x0: -45, y0: -100, x1: 45, y1: 200}, {x: 200, y: 200, rotation: 0});
		const turned = placeRectangle({x0: -45, y0: -100, x1: 45, y1: 200}, {x: 200, y: 200, rotation: Math.PI / 2});

		expect(polygonArea(upright)).toBeCloseTo(polygonArea(turned), 6);
		// A stairwell under a flight turned ninety degrees is a rectangle turned
		// ninety degrees, not an axis-aligned one that nearly covers it.
		expect(upright.map((p) => Math.round(p.x))).not.toEqual(turned.map((p) => Math.round(p.x)));
	});
});

function withHole(outline, opening)
{
	const shape = new Shape(outline.map((p) => new Vector2(p.x, p.y)));
	shape.holes.push(new Shape(opening.map((p) => new Vector2(p.x, p.y))));
	return shape;
}

describe('M-39 - the stairs arrive somewhere', () =>
{
	function twoStoreys()
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({
			floorplan: room(600),
			items: [],
			levels: [
				{name: 'Ground floor', height: 280},
				{name: 'First floor', height: 280, floorplan: room(600), items: []},
			],
		}));
		return model;
	}

	/** A stair-shaped stand-in, which is all `_updateFloorOpenings` reads. */
	function aStair(x, z, rotation)
	{
		return {
			stair: normaliseStair({shape: 'straight'}),
			position: {x: x, y: 140, z: z},
			rotation: {y: rotation || 0},
		};
	}

	it('cuts the floor above where a flight below arrives', () =>
	{
		const model = twoStoreys();
		const upstairs = model.levels[1].floorplan.getRooms()[0];
		expect(upstairs.floorOpenings).toHaveLength(0);

		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();

		expect(upstairs.floorOpenings).toHaveLength(1);
		// And it contains the flight's own stairwell rectangle - F3 computes it,
		// G2 only moves it into the room's frame.
		const well = stairPlan(normaliseStair({shape: 'straight'})).well;
		expect(polygonArea(upstairs.floorOpenings[0]))
			.toBeCloseTo((well.x1 - well.x0) * (well.y1 - well.y0), 6);
	});

	it('takes the opening out of the room\'s stated area', () =>
	{
		const model = twoStoreys();
		const upstairs = model.levels[1].floorplan.getRooms()[0];
		const whole = upstairs.area;

		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();

		// F2's rule applied to the thing that now punches holes in it: the number
		// on the plan is the floor somebody can stand on. 90 x 300 out of 590 x 590.
		expect(upstairs.area).toBeCloseTo(whole - 27000, 6);
		expect(upstairs.area).toBeLessThan(whole);
	});

	it('never cuts the ground floor, which has nothing below it', () =>
	{
		const model = twoStoreys();
		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();

		expect(model.levels[0].floorplan.getRooms()[0].floorOpenings).toHaveLength(0);
	});

	it('cuts the visible floor and the picking plane to the same shape', () =>
	{
		const model = twoStoreys();
		const upstairs = model.levels[1].floorplan.getRooms()[0];
		const before = upstairs.floorPlane.geometry.index.count;

		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();

		// A floor you can see through and still click is worse than either, so both
		// come from `Room.floorShape()`.
		expect(upstairs.floorPlane.geometry.index.count).toBeGreaterThan(before);
		expect(upstairs.floorShape().holes).toHaveLength(1);
	});

	/**
	 * The bug found by placing a flight in a real page and then calling
	 * `update()`, which is what a load does. `update(true)` constructs a NEW
	 * `Room` for every room - room identity is derived from its corners rather
	 * than assigned, which is finding H-5 - so the openings a room was carrying
	 * were on an object that no longer existed. Drawing one wall anywhere on the
	 * plan silently filled in every stairwell.
	 */
	it('keeps the hole through a room rebuild', () =>
	{
		const model = twoStoreys();
		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();
		expect(model.levels[1].floorplan.getRooms()[0].floorOpenings).toHaveLength(1);

		model.levels[1].floorplan.update(true);

		const rebuilt = model.levels[1].floorplan.getRooms()[0];
		expect(rebuilt.floorOpenings).toHaveLength(1);
		expect(rebuilt.floorShape().holes).toHaveLength(1);
	});

	it('takes the hole away again when the flight goes', () =>
	{
		const model = twoStoreys();
		const upstairs = model.levels[1].floorplan.getRooms()[0];
		const whole = upstairs.area;
		model.levels[0].items.push(aStair(300, 300));
		model._updateFloorOpenings();

		model.levels[0].items.length = 0;
		model._updateFloorOpenings();

		expect(upstairs.floorOpenings).toHaveLength(0);
		expect(upstairs.area).toBeCloseTo(whole, 6);
	});
});

describe('M-40 - a roof covers the building', () =>
{
	const FOOTPRINT = {width: 680, depth: 480};

	it('starts at a pitch and an overhang somebody would build', () =>
	{
		expect(newRoof(ROOF_GABLE)).toMatchObject({pitch: 30, overhang: 40, ridge: RIDGE_X});
		expect(normaliseRoof({kind: 'dome'}).kind).toBe(ROOF_DEFAULTS.kind);
		expect(normaliseRoof({pitch: 200}).pitch).toBe(MAX_PITCH);
		expect(normaliseRoof({pitch: -5}).pitch).toBe(0);
	});

	/** The metric, over the three kinds and every pitch the inspector offers. */
	const PITCHES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
	const CASES = [];
	[ROOF_FLAT, ROOF_GABLE, ROOF_HIP].forEach((kind) =>
	{
		[RIDGE_X, RIDGE_Z].forEach((ridge) =>
		{
			PITCHES.forEach((pitch) => {CASES.push({kind, ridge, pitch});});
		});
	});

	it.each(CASES)('$kind, ridge $ridge, pitch $pitch covers the footprint', (spec) =>
	{
		const roof = normaliseRoof(spec);
		const geometry = buildRoofGeometry(roof, FOOTPRINT).geometry;
		geometry.computeBoundingBox();
		const box = geometry.boundingBox;

		// The plan projection of the roof contains the whole rectangle it was
		// given - which already includes the eaves overhang.
		expect(box.min.x).toBeLessThanOrEqual(-FOOTPRINT.width / 2 + 1e-6);
		expect(box.max.x).toBeGreaterThanOrEqual(FOOTPRINT.width / 2 - 1e-6);
		expect(box.min.z).toBeLessThanOrEqual(-FOOTPRINT.depth / 2 + 1e-6);
		expect(box.max.z).toBeGreaterThanOrEqual(FOOTPRINT.depth / 2 - 1e-6);
	});

	it('rises by the half-span times the tangent of its pitch, and stores nothing', () =>
	{
		[15, 30, 45, 60].forEach((pitch) =>
		{
			const roof = normaliseRoof({kind: ROOF_GABLE, pitch, ridge: RIDGE_X});
			const metrics = roofMetrics(roof, FOOTPRINT);
			const geometry = buildRoofGeometry(roof, FOOTPRINT).geometry;
			geometry.computeBoundingBox();

			expect(metrics.rise).toBeCloseTo((FOOTPRINT.depth / 2) * Math.tan(pitch * Math.PI / 180), 9);
			// Four decimals rather than nine: the bounding box is read back through
			// Float32 position data, which carries about seven significant digits.
			// A tenth of a micron is still four orders tighter than a millimetre.
			expect(geometry.boundingBox.max.y - geometry.boundingBox.min.y).toBeCloseTo(metrics.rise, 4);
		});
	});

	/**
	 * A gable and a hip are the same solid with one number different, which is
	 * what keeps them from drifting: a hip's ridge is inset from both ends by the
	 * hip run, and a gable's is not inset at all.
	 */
	it('makes a hip a gable with its ridge pulled in', () =>
	{
		const gable = roofMetrics(normaliseRoof({kind: ROOF_GABLE}), FOOTPRINT);
		const hip = roofMetrics(normaliseRoof({kind: ROOF_HIP}), FOOTPRINT);

		expect(gable.inset).toBe(0);
		expect(hip.inset).toBe(FOOTPRINT.depth / 2);
		expect(hip.rise).toBe(gable.rise);
	});

	it('points every face outward, which the first draft did not', () =>
	{
		[ROOF_GABLE, ROOF_HIP].forEach((kind) =>
		{
			const geometry = buildRoofGeometry(normaliseRoof({kind}), FOOTPRINT).geometry;
			const normals = geometry.getAttribute('normal');
			const slopes = new Set();
			for (let i = 0; i < normals.count; i++)
			{
				slopes.add(Number(normals.getY(i).toFixed(3)));
			}
			// Slopes up and out, the underside down, and nothing pointing into the
			// solid. The first draft wound all four slopes backwards.
			expect([...slopes].filter((y) => y > 0 && y < 1).length).toBeGreaterThan(0);
			expect([...slopes].every((y) => y >= 0 || y === -1)).toBe(true);
		});
	});

	it('measures the footprint from every storey, grown by the overhang', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({floorplan: room(600), items: []}));

		expect(roofFootprint(model.levels, 0)).toMatchObject({width: 600, depth: 600, cx: 300, cy: 300});
		expect(roofFootprint(model.levels, 40)).toMatchObject({width: 680, depth: 680});
		expect(roofFootprint([], 40)).toBeNull();
	});

	it('stands on the top storey\'s walls, derived', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({
			floorplan: room(600),
			items: [],
			levels: [{name: 'Ground floor', height: 280}, {name: 'First', height: 300, floorplan: room(600), items: []}],
		}));

		// The top storey's base plus the highest thing on it, which is a corner's
		// elevation - the number that has always been the top of a wall.
		expect(model.roofBase()).toBe(280 + 250);
	});
});

describe('the roof in the file', () =>
{
	it('writes nothing at all when there is no roof', () =>
	{
		const model = new Model('/textures/');

		expect(JSON.parse(model.exportSerialized()).roof).toBeUndefined();
	});

	it('round-trips once there is one', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({floorplan: room(600), items: []}));
		model.setRoof({kind: ROOF_HIP, pitch: 35, overhang: 55, ridge: RIDGE_Z});

		const saved = model.exportSerialized();
		expect(JSON.parse(saved).roof).toEqual(roofToJSON(model.roof));

		model.loadSerialized(saved);
		expect(model.roof).toMatchObject({kind: ROOF_HIP, pitch: 35, overhang: 55, ridge: RIDGE_Z});
		expect(model.exportSerialized()).toBe(saved);
	});

	it('takes it off again', () =>
	{
		const model = new Model('/textures/');
		model.setRoof({kind: ROOF_FLAT});
		expect(model.roof).toBeTruthy();

		model.setRoof(null);

		expect(model.roof).toBeNull();
		expect(JSON.parse(model.exportSerialized()).roof).toBeUndefined();
	});

	it('refuses numbers a roof cannot mean, and accepts a pitch of zero', () =>
	{
		const bad = DesignDocument.parse(JSON.stringify({
			floorplan: room(600), items: [], roof: {pitch: 'steep', overhang: -10},
		}));
		expect(bad.errors.map((error) => error.path)).toEqual(['roof.pitch', 'roof.overhang']);

		const flat = DesignDocument.parse(JSON.stringify({
			floorplan: room(600), items: [], roof: {kind: 'flat', pitch: 0, overhang: 0},
		}));
		expect(flat.errors).toEqual([]);
	});
});
