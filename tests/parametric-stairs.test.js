// @vitest-environment jsdom
/**
 * A flight is its numbers (RM-008 F3).
 *
 * **M-37** is the metric this file exists for, and it is asserted on the
 * *geometry* rather than on the arithmetic. Tread count times going equals the
 * plan length and tread count times rise equals the height is trivially true of
 * `stairMetrics`, because that function is the multiplication; what it is worth
 * asserting is that the mesh anybody would actually build agrees with it, to
 * the millimetre, for every shape and every set of numbers. So the flight is
 * generated and its bounding box read - and where a handrail makes the mesh
 * taller than the flight, the box is taken over the two material groups that
 * are the flight rather than over everything.
 *
 * The second half of the acceptance - a stair round-trips through the file and
 * appears on an exported sheet at the right size - is split: the record is
 * asserted here and the sheet in `tests/plan-stairs-2d.test.js`, which has the
 * canvas.
 *
 * RM-009 U-3 is the finding behind all of it: the four stair meshes this build
 * ships arrive 5.5 m wide and 4 m tall because every model under two units
 * across is multiplied by 300 on load. Nothing here goes near that branch,
 * which is the point - a generated flight has no mesh to scale.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Vector3} from 'three';

import {
	newStair, normaliseStair, stairMetrics, stairParts, stairPlan, stairwellHint,
	buildStairGeometry, stairToJSON,
	STAIR_STRAIGHT, STAIR_L, STAIR_U, STAIR_DEFAULTS, HEADROOM,
	TURN_LEFT, TURN_RIGHT,
	HANDRAIL_NONE, HANDRAIL_LEFT, HANDRAIL_RIGHT, HANDRAIL_BOTH,
} from '../src/scripts/items/stair.js';
import {item_types, ITEM_TYPE_PARAMETRIC_STAIR} from '../src/scripts/items/factory.js';
import {ParametricStair} from '../src/scripts/items/parametric_stair.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {projectItem} from '../src/scripts/model/plan_projection.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

let canvasStub;

beforeEach(() =>
{
	resetAll();
	// `Item`'s constructor builds two canvas-backed size labels, so a jsdom
	// canvas with no 2D context floods the run with "not implemented" notices.
	canvasStub = installCanvas2D(window);
});

afterEach(() =>
{
	canvasStub.restore();
});

/** A millimetre, which is what M-37 says "to the millimetre" in. */
const MM = 0.1;

/**
 * The bounding box of a subset of a geometry's material groups.
 *
 * A railed flight's mesh is taller than the flight, legitimately - a handrail
 * stands 90 cm above the top nosing - so measuring the flight means measuring
 * groups 0 and 1 (structure and tread) and leaving out group 2. Reading the
 * groups rather than filtering by height is what makes this a measurement of
 * the thing rather than of a guess about it.
 */
function boundsOfGroups(geometry, wanted)
{
	const position = geometry.getAttribute('position');
	const index = geometry.getIndex();
	const min = new Vector3(Infinity, Infinity, Infinity);
	const max = new Vector3(-Infinity, -Infinity, -Infinity);
	geometry.groups
		.filter((group) => wanted.indexOf(group.materialIndex) !== -1)
		.forEach((group) =>
		{
			for (let i = group.start; i < group.start + group.count; i++)
			{
				const vertex = index.getX(i);
				const point = new Vector3(
					position.getX(vertex), position.getY(vertex), position.getZ(vertex));
				min.min(point);
				max.max(point);
			}
		});
	return {min, max, size: max.clone().sub(min)};
}

const FLIGHT_GROUPS = [0, 1];

describe('the description', () =>
{
	it('starts a new flight at a stair somebody could climb', () =>
	{
		expect(newStair(STAIR_STRAIGHT)).toMatchObject({treads: 16, rise: 17.5, going: 25, width: 90});
		// 16 x 175 mm floor to floor and 16 x 250 mm on plan: round in millimetres.
		expect(stairMetrics(newStair(STAIR_STRAIGHT))).toMatchObject({height: 280, run: 400});
	});

	it('completes a partial record and clamps what cannot be built', () =>
	{
		expect(normaliseStair({shape: STAIR_U, treads: 20}))
			.toMatchObject({shape: STAIR_U, treads: 20, going: STAIR_DEFAULTS.going});

		expect(normaliseStair({treads: 0}).treads).toBe(2);
		expect(normaliseStair({treads: 500}).treads).toBe(40);
		expect(normaliseStair({rise: -3}).rise).toBeGreaterThan(0);
		expect(normaliseStair({going: 'deep'}).going).toBe(STAIR_DEFAULTS.going);
		// Half a step is not a thing that can be built.
		expect(normaliseStair({treads: 15.5}).treads).toBe(16);
	});

	it('reads an unknown shape as straight rather than refusing the file', () =>
	{
		expect(normaliseStair({shape: 'spiral'}).shape).toBe(STAIR_STRAIGHT);
		expect(normaliseStair({handrail: 'chrome'}).handrail).toBe(STAIR_DEFAULTS.handrail);
		expect(normaliseStair(null).shape).toBe(STAIR_STRAIGHT);
	});

	it('splits an odd tread count with the extra step below the landing', () =>
	{
		expect(stairMetrics(normaliseStair({shape: STAIR_L, treads: 15})).flights).toEqual([8, 7]);
		expect(stairMetrics(normaliseStair({shape: STAIR_U, treads: 16})).flights).toEqual([8, 8]);
		expect(stairMetrics(newStair(STAIR_STRAIGHT)).flights).toEqual([16]);
	});
});

describe('M-37 - a flight is its numbers', () =>
{
	/** The spread the metric is claimed over, not one convenient stair. */
	const CASES = [];
	[STAIR_STRAIGHT, STAIR_L, STAIR_U].forEach((shape) =>
	{
		[[16, 17.5, 25], [13, 20, 22], [24, 12.5, 30], [2, 30, 45], [40, 5, 15]].forEach(([treads, rise, going]) =>
		{
			[HANDRAIL_NONE, HANDRAIL_BOTH].forEach((handrail) =>
			{
				CASES.push({shape, treads, rise, going, handrail, width: 90});
			});
		});
	});

	it.each(CASES)('$shape, $treads x $rise/$going, rail $handrail', (spec) =>
	{
		const stair = normaliseStair(spec);
		const built = buildStairGeometry(stair);
		const flight = boundsOfGroups(built.geometry, FLIGHT_GROUPS);

		// Tread count times rise IS the height, read off the mesh.
		expect(flight.size.y).toBeCloseTo(stair.treads * stair.rise, 3);
		expect(stairMetrics(stair).height).toBe(stair.treads * stair.rise);

		// Tread count times going IS the plan length, summed over the runs -
		// which for a straight flight is the one run, and for an L or a U is the
		// two that share the total.
		const parts = stairParts(stair);
		const travelled = parts.runs.reduce((sum, run) => sum + (run.treads * stair.going), 0);
		expect(travelled).toBeCloseTo(stair.treads * stair.going, 10);
		expect(parts.runs.reduce((sum, run) => sum + run.treads, 0)).toBe(stair.treads);

		parts.runs.forEach((run) =>
		{
			const along = (run.heading === 0 || Math.abs(run.heading) === Math.PI)
				? (run.rect.z1 - run.rect.z0) : (run.rect.x1 - run.rect.x0);
			expect(along).toBeCloseTo(run.treads * stair.going, 10);
		});
	});

	it('measures the flight to the millimetre, not to a tolerance that hides it', () =>
	{
		const stair = normaliseStair({treads: 17, rise: 16.4, going: 27.3, handrail: HANDRAIL_NONE});
		const flight = boundsOfGroups(buildStairGeometry(stair).geometry, FLIGHT_GROUPS);

		expect(Math.abs(flight.size.y - (17 * 16.4))).toBeLessThan(MM);
		expect(Math.abs(flight.size.z - (17 * 27.3))).toBeLessThan(MM);
	});
});

describe('the mesh and the symbol occupy one rectangle', () =>
{
	it.each([STAIR_STRAIGHT, STAIR_L, STAIR_U])('%s', (shape) =>
	{
		[HANDRAIL_NONE, HANDRAIL_BOTH].forEach((handrail) =>
		{
			const stair = normaliseStair({shape, handrail});
			const mesh = buildStairGeometry(stair).geometry.boundingBox;
			const plan = stairPlan(stair);

			// This is what the handrail sizing in `railFor` is for: before it, a
			// straight flight's mesh measured 404 cm over a 400 cm footprint,
			// because a rotated rail overhangs by half its section and a post
			// centred on the run's foot is half a post outside it.
			expect(mesh.max.x - mesh.min.x).toBeCloseTo(plan.halfWidth * 2, 6);
			expect(mesh.max.z - mesh.min.z).toBeCloseTo(plan.halfDepth * 2, 6);
		});
	});

	it('centres the mesh on itself so the flight stands on the floor', () =>
	{
		// The bug this pins is F1's door hanging 20 cm in the air, in a new file:
		// `FloorItem.resized` puts the origin at half the MESH height, so a mesh
		// centred on the FLIGHT would leave a railed stair 45 cm up.
		[HANDRAIL_NONE, HANDRAIL_BOTH].forEach((handrail) =>
		{
			const box = buildStairGeometry(normaliseStair({handrail})).geometry.boundingBox;

			expect(box.min.y + box.max.y).toBeCloseTo(0, 9);
		});
	});
});

describe('the handrail', () =>
{
	/** Where the rail sits across the flight, read out of the geometry. */
	function railCentre(stair)
	{
		const rail = boundsOfGroups(buildStairGeometry(stair).geometry, [2]);
		return (rail.min.x + rail.max.x) / 2;
	}

	it('adds nothing to the mesh when there is none', () =>
	{
		const bare = buildStairGeometry(normaliseStair({handrail: HANDRAIL_NONE}));

		expect(bare.geometry.groups.every((group) => group.materialIndex !== 2)).toBe(true);
	});

	/**
	 * Facing the way you climb with the vertical up, `forward x up` is `z x y`,
	 * which is -x - so the right rail is at -x and the left at +x. Asserted out
	 * of the geometry rather than left as a claim in a docblock, because the two
	 * signs look identical in prose and are opposite on screen.
	 */
	it('puts the left rail and the right rail on opposite sides', () =>
	{
		expect(railCentre(normaliseStair({handrail: HANDRAIL_LEFT}))).toBeGreaterThan(0);
		expect(railCentre(normaliseStair({handrail: HANDRAIL_RIGHT}))).toBeLessThan(0);
		expect(railCentre(normaliseStair({handrail: HANDRAIL_BOTH}))).toBeCloseTo(0, 6);
	});

	it('follows the pitch rather than stepping with the treads', () =>
	{
		const rail = boundsOfGroups(
			buildStairGeometry(normaliseStair({handrail: HANDRAIL_RIGHT})).geometry, [2]);
		const flight = boundsOfGroups(
			buildStairGeometry(normaliseStair({handrail: HANDRAIL_RIGHT})).geometry, FLIGHT_GROUPS);

		// It climbs with the flight and stands above it at both ends.
		expect(rail.size.y).toBeGreaterThan(flight.size.y * 0.9);
		expect(rail.max.y).toBeGreaterThan(flight.max.y);
	});
});

describe('the turn', () =>
{
	it('sends a quarter turn the way it is told, and a half turn back on itself', () =>
	{
		const right = stairParts(normaliseStair({shape: STAIR_L, turn: TURN_RIGHT})).bounds;
		const left = stairParts(normaliseStair({shape: STAIR_L, turn: TURN_LEFT})).bounds;

		expect(right.x1).toBeGreaterThan(90);
		expect(left.x0).toBeLessThan(-90);
		// Mirror images: the same flight, the other way round.
		expect(right.x1).toBeCloseTo(-left.x0, 9);
		expect(right.z1).toBeCloseTo(left.z1, 9);
	});

	it('makes a half turn twice as wide and about half as long as a straight one', () =>
	{
		const straight = stairParts(newStair(STAIR_STRAIGHT)).bounds;
		const half = stairParts(newStair(STAIR_U)).bounds;

		expect(half.x1 - half.x0).toBeCloseTo(180, 9);
		expect(straight.x1 - straight.x0).toBeCloseTo(90, 9);
		expect(half.z1 - half.z0).toBeLessThan(straight.z1 - straight.z0);
	});

	it('keeps the footprint free of floating-point dust', () =>
	{
		// The first version computed each run's direction with `Math.sin`, and
		// `Math.sin(Math.PI)` is 1.2e-16: a half turn's footprint came out at
		// -5.5e-15 to 90.00000000000003 instead of -90 to 90.
		const bounds = stairParts(newStair(STAIR_U)).bounds;

		expect(bounds.x0).toBe(-90);
		expect(bounds.x1).toBe(90);
		expect(bounds.z0).toBe(0);
	});
});

describe('the stairwell hint', () =>
{
	it('covers the part of the flight with less than two metres over it', () =>
	{
		const stair = newStair(STAIR_STRAIGHT);
		const well = stairwellHint(stair);
		const parts = stairParts(stair);

		// 280 cm to the floor above, 200 of headroom: everything above 80 cm.
		expect(well.fromTread).toBe(5);
		expect(parts.steps[well.fromTread - 1].top).toBeGreaterThan(parts.height - HEADROOM);
		expect(parts.steps[well.fromTread - 2].top).toBeLessThanOrEqual(parts.height - HEADROOM);
		// It starts where that tread starts, and runs to the top of the flight.
		expect(well.z0).toBeCloseTo((well.fromTread - 1) * stair.going, 9);
		expect(well.z1).toBeCloseTo(parts.bounds.z1, 9);
	});

	it('is smaller than the footprint for a flight that clears its own head', () =>
	{
		const stair = newStair(STAIR_STRAIGHT);
		const well = stairwellHint(stair);
		const bounds = stairParts(stair).bounds;

		// A stairwell is not the same rectangle as a stair, which is the whole
		// reason the hint is worth recording rather than assuming.
		expect(well.z1 - well.z0).toBeLessThan(bounds.z1 - bounds.z0);
	});

	it('covers a short flight entirely, because nothing on it has headroom', () =>
	{
		const stair = normaliseStair({treads: 8, rise: 17.5});
		const well = stairwellHint(stair);

		expect(stairMetrics(stair).height).toBeLessThan(HEADROOM);
		expect(well.fromTread).toBe(1);
		expect(well.z0).toBeCloseTo(stairParts(stair).bounds.z0, 9);
	});
});

describe('the item', () =>
{
	function fakeModel()
	{
		return {scene: {add() {}, remove() {}, needsUpdate: false}};
	}

	function aStair(overrides)
	{
		const stair = normaliseStair(overrides || {});
		const built = buildStairGeometry(stair);
		return new ParametricStair(
			fakeModel(),
			{itemName: 'Straight flight', itemType: 11, resizable: true, stair: stair},
			built.geometry, built.materials);
	}

	it('is registered as item type 11', () =>
	{
		expect(ITEM_TYPE_PARAMETRIC_STAIR).toBe(11);
		expect(item_types[11]).toBe(ParametricStair);
	});

	/**
	 * The interesting negative. F1's `ParametricOpening` had to override
	 * `objectHalfSize` because a door's leaf is drawn open and its bounding box
	 * lies by 86 cm. A flight's does not lie, because the rail is sized to stay
	 * inside the run - so the inherited implementation is already right, and an
	 * override would be a second copy of the same number.
	 */
	it('takes its extent from the mesh, because the mesh tells the truth', () =>
	{
		const stair = aStair({handrail: HANDRAIL_BOTH});
		const plan = stairPlan(stair.stair);

		expect(stair.halfSize.x).toBeCloseTo(plan.halfWidth, 6);
		expect(stair.halfSize.z).toBeCloseTo(plan.halfDepth, 6);
		expect(Object.prototype.hasOwnProperty.call(ParametricStair.prototype, 'objectHalfSize')).toBe(false);
	});

	it('regenerates everything downstream from one changed number', () =>
	{
		const stair = aStair();
		const before = stair.geometry;

		stair.setStair({treads: 20});

		expect(stair.stair.treads).toBe(20);
		expect(stair.metrics().height).toBe(20 * STAIR_DEFAULTS.rise);
		expect(stair.geometry).not.toBe(before);
		expect(stair.halfSize.z).toBeCloseTo(stairPlan(stair.stair).halfDepth, 6);
	});

	it('disposes the mesh it replaces', () =>
	{
		const stair = aStair();
		const before = stair.geometry;
		let disposed = false;
		before.dispose = () => {disposed = true;};

		stair.setStair({going: 30});

		expect(disposed).toBe(true);
	});

	it('does nothing at all when the numbers do not change', () =>
	{
		const stair = aStair();
		const before = stair.geometry;

		stair.setStair({treads: stair.stair.treads});

		expect(stair.geometry).toBe(before);
	});

	it('clamps what it is handed, and says what it took', () =>
	{
		const stair = aStair();

		expect(stair.setStair({treads: 900}).treads).toBe(40);
		expect(stair.setStair({going: 2}).going).toBe(15);
	});

	it('stands on the floor after a rebuild', () =>
	{
		const stair = aStair({handrail: HANDRAIL_BOTH});

		stair.setStair({treads: 22});

		// `resized()` puts the origin at half the mesh; the mesh is centred on
		// itself; so the underside is at zero.
		expect(stair.position.y).toBeCloseTo(stair.halfSize.y, 9);
		expect(stair.halfSize.y - stair.geometry.boundingBox.max.y).toBeCloseTo(0, 6);
	});

	it('offers the stairwell rectangle for G2 without acting on it', () =>
	{
		const stair = aStair();

		expect(stair.stairwell()).toEqual(stairwellHint(stair.stair));
	});
});

describe('the file', () =>
{
	function fakeModel()
	{
		return {scene: {add() {}, remove() {}, needsUpdate: false}};
	}

	function aStair(overrides)
	{
		const stair = normaliseStair(overrides || {});
		const built = buildStairGeometry(stair);
		return new ParametricStair(
			fakeModel(),
			{itemName: 'Half turn', itemType: 11, resizable: true, stair: stair},
			built.geometry, built.materials);
	}

	it('writes every number, because there is no default to fall back on', () =>
	{
		const stair = normaliseStair({shape: STAIR_U, treads: 19, handrail: HANDRAIL_LEFT});

		expect(stairToJSON(stair)).toEqual({
			shape: STAIR_U, treads: 19, rise: 17.5, going: 25, width: 90,
			handrail: HANDRAIL_LEFT, turn: TURN_RIGHT, style: 'plain',
		});
	});

	it('round-trips through the record it writes', () =>
	{
		const stair = aStair({shape: STAIR_L, treads: 21, rise: 16.2, going: 27, width: 105, turn: TURN_LEFT});
		const record = stair.getMetaData();

		expect(normaliseStair(record.stair)).toEqual(stair.stair);
	});

	it('is absent from an item that has none, which is every older file', () =>
	{
		// The additive rule, T-6: what makes this safe is the whole key missing.
		const document = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Chair', model_url: 'models/gltf/chair.glb', item_type: 1}],
		}));

		expect(document.errors).toEqual([]);
		expect(document.document.items[0].stair).toBeUndefined();
	});

	it('lets a flight name no model, and still refuses an item that names neither', () =>
	{
		const withStair = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Flight', item_type: 11, stair: {shape: 'straight', treads: 16}}],
		}));
		expect(withStair.errors).toEqual([]);

		const withNeither = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Mystery', item_type: 1}],
		}));
		expect(withNeither.errors.map((error) => error.path)).toContain('items[0].model_url');
	});

	it('refuses numbers a flight cannot mean', () =>
	{
		const bad = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_name: 'Flight', item_type: 11, stair: {treads: -3, rise: 'steep'}}],
		}));

		expect(bad.errors.map((error) => error.path)).toEqual([
			'items[0].stair.treads', 'items[0].stair.rise',
		]);
	});
});

describe('the plan projection', () =>
{
	it('carries the flight, copied rather than referenced', () =>
	{
		const stair = normaliseStair({shape: STAIR_L, treads: 18});
		const footprint = projectItem({
			designId: 's1',
			position: {x: 100, y: 140, z: 200},
			halfSize: {x: 45, y: 140, z: 200},
			rotation: {y: 0},
			metadata: {itemType: 11, itemName: 'Quarter turn'},
			stair: stair,
		});

		expect(footprint.stair).toMatchObject({shape: STAIR_L, treads: 18, going: 25});
		expect(footprint.stair).not.toBe(stair);
	});

	it('leaves every other item\'s stair null, which is every older design', () =>
	{
		const footprint = projectItem({
			designId: 'c1',
			position: {x: 0, y: 0, z: 0},
			halfSize: {x: 30, y: 40, z: 30},
			rotation: {y: 0},
			metadata: {itemType: 1, itemName: 'Chair'},
		});

		expect(footprint.stair).toBeNull();
	});
});
