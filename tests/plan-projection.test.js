/**
 * The plan's view of the furniture (RM-008 E1, T-1).
 *
 * These run with no canvas, no renderer and no browser, which is the whole
 * argument for the projection existing as data rather than as a reference from
 * the 2D view into the scene. RM-008 T-3 measured the five files E1 touches at
 * 36-69% statement coverage - the least covered in the library - so a contract
 * that can only be exercised through a rasterised canvas would have arrived
 * untested.
 *
 * What is pinned here:
 *
 *   - the footprint's shape and units, because the 2D view and any embedder
 *     read them;
 *   - that a half-built item still produces a footprint, because the
 *     alternative is a picture that silently disagrees with the item count;
 *   - that the geometry helpers work on rotated rectangles, since that is what
 *     replaces the pinned polygon predicates for this feature;
 *   - that `Model` keeps the floorplan's copy current, which is the part that
 *     no unit test of the pure functions would catch.
 */
import {describe, expect, it, vi} from 'vitest';
import {Vector3} from 'three';

import {projectItem, projectItems, footprintContains, footprintCorners} from '../src/scripts/model/plan_projection.js';
import {Model} from '../src/scripts/model/model.js';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {EVENT_ITEMS_PROJECTED, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_MOVE_FINISH} from '../src/scripts/core/events.js';

/**
 * An item as the projection sees one.
 *
 * Hand-built rather than constructed through `Item`, deliberately: `Item`
 * extends `Mesh` and wants a geometry, a material and a model, and none of that
 * is what these tests are about. It is also the same style
 * `tests/items-and-scene.test.js` uses to pin `getMetaData` - the projection
 * reads a handful of named properties, so anything carrying them is a valid
 * subject, and saying so in a test is how that stays true.
 */
function fakeItem(overrides)
{
	return Object.assign({
		designId: 'item-1',
		position: new Vector3(100, 40, -250),
		halfSize: new Vector3(30, 20, 45),
		rotation: {x: 0, y: 0, z: 0},
		fixed: false,
		currentWallEdge: null,
		metadata: {itemName: 'Chair', itemType: 1},
	}, overrides || {});
}

describe('projectItem', () =>
{
	it('reads plan space off the item: y is the 3D z, elevation is the 3D y', () =>
	{
		const footprint = projectItem(fakeItem());

		expect(footprint.x).toBe(100);
		expect(footprint.y).toBe(-250);
		expect(footprint.elevation).toBe(40);
	});

	it('carries half extents, rotation, type, label, fixed and the wall edge', () =>
	{
		const footprint = projectItem(fakeItem({
			fixed: true,
			rotation: {x: 0, y: Math.PI / 2, z: 0},
			currentWallEdge: {id: 'wall:a~b:front'},
			metadata: {itemName: 'Window', itemType: 3},
		}));

		expect(footprint.halfWidth).toBe(30);
		expect(footprint.halfDepth).toBe(45);
		expect(footprint.rotation).toBeCloseTo(Math.PI / 2, 10);
		expect(footprint.type).toBe(3);
		expect(footprint.label).toBe('Window');
		expect(footprint.fixed).toBe(true);
		expect(footprint.edgeId).toBe('wall:a~b:front');
	});

	it('is plain data - no three.js types, no methods', () =>
	{
		const footprint = projectItem(fakeItem());

		expect(footprint.position).toBeUndefined();
		Object.keys(footprint).forEach((key) =>
		{
			const value = footprint[key];
			const kind = (value === null) ? 'null' : typeof value;
			expect(['number', 'string', 'boolean', 'null']).toContain(kind);
		});
	});

	/**
	 * An item mid-load has halfSize (0,0,0) and no geometry. Dropping it would
	 * make the footprint count disagree with the item count, which is exactly
	 * what M-23 asserts, so it gets a zero-sized footprint instead.
	 */
	it('still describes an item that is still loading', () =>
	{
		const footprint = projectItem(fakeItem({halfSize: new Vector3(0, 0, 0)}));

		expect(footprint.halfWidth).toBe(0);
		expect(footprint.halfDepth).toBe(0);
		expect(footprint.id).toBe('item-1');
	});

	it('survives an item missing everything, rather than throwing', () =>
	{
		const footprint = projectItem({});

		expect(footprint).toMatchObject({
			id: '', x: 0, y: 0, elevation: 0, halfWidth: 0, halfDepth: 0,
			rotation: 0, type: 0, label: '', fixed: false, edgeId: null,
		});
	});

	it('treats a NaN coordinate as zero rather than passing it on', () =>
	{
		// A NaN reaching the canvas silently draws nothing at all; a zero draws
		// something visibly wrong in a known place. The second is debuggable.
		const footprint = projectItem(fakeItem({position: {x: NaN, y: 0, z: 5}}));

		expect(footprint.x).toBe(0);
		expect(footprint.y).toBe(5);
	});

	it('reports a negative half extent as a magnitude', () =>
	{
		const footprint = projectItem(fakeItem({halfSize: new Vector3(-30, 0, -45)}));

		expect(footprint.halfWidth).toBe(30);
		expect(footprint.halfDepth).toBe(45);
	});
});

describe('projectItems', () =>
{
	it('is empty for no items', () =>
	{
		expect(projectItems([])).toEqual([]);
		expect(projectItems(null)).toEqual([]);
	});

	/**
	 * Scene order is the order model downloads finished in, so two projections
	 * of a design nobody touched could otherwise differ - and a test comparing
	 * them would be testing the network. The save file sorts by id for the same
	 * reason.
	 */
	it('sorts by id, so the projection does not depend on which model loaded first', () =>
	{
		const projection = projectItems([
			fakeItem({designId: 'c'}),
			fakeItem({designId: 'a'}),
			fakeItem({designId: 'b'}),
		]);

		expect(projection.map((footprint) => footprint.id)).toEqual(['a', 'b', 'c']);
	});

	it('projects one footprint per item, including duplicates at one position', () =>
	{
		const projection = projectItems([
			fakeItem({designId: 'a'}),
			fakeItem({designId: 'b'}),
		]);

		expect(projection).toHaveLength(2);
	});
});

describe('footprintContains', () =>
{
	const footprint = projectItem(fakeItem({position: new Vector3(0, 0, 0), halfSize: new Vector3(50, 10, 20)}));

	it('accepts the centre and the corners, and rejects just outside', () =>
	{
		expect(footprintContains(footprint, 0, 0)).toBe(true);
		expect(footprintContains(footprint, 50, 20)).toBe(true);
		expect(footprintContains(footprint, 50.1, 0)).toBe(false);
		expect(footprintContains(footprint, 0, 20.1)).toBe(false);
	});

	/**
	 * The reason this is arithmetic rather than a polygon test: `Utils`'s
	 * polygon predicates are pinned constants (four PRESERVED BUGS in
	 * core/utils.js), and a new feature must not be built on a bug that is
	 * preserved on purpose. A rotated rectangle is axis-aligned in its own
	 * frame, so un-rotating the point is the whole test.
	 */
	it('follows the rotation', () =>
	{
		const turned = projectItem(fakeItem({
			position: new Vector3(0, 0, 0),
			halfSize: new Vector3(50, 10, 20),
			rotation: {x: 0, y: Math.PI / 2, z: 0},
		}));

		// The long axis is now north-south, so a point 40 along x is outside and
		// the same point along y is inside - the exact opposite of unrotated.
		expect(footprintContains(turned, 40, 0)).toBe(false);
		expect(footprintContains(turned, 0, 40)).toBe(true);
		expect(footprintContains(footprint, 40, 0)).toBe(true);
		expect(footprintContains(footprint, 0, 40)).toBe(false);
	});

	it('honours a tolerance, so a thin item is still pickable when zoomed out', () =>
	{
		const thin = projectItem(fakeItem({position: new Vector3(0, 0, 0), halfSize: new Vector3(60, 10, 1)}));

		expect(footprintContains(thin, 0, 4)).toBe(false);
		expect(footprintContains(thin, 0, 4, 5)).toBe(true);
	});

	it('contains nothing when the item has no size yet', () =>
	{
		const loading = projectItem(fakeItem({halfSize: new Vector3(0, 0, 0), position: new Vector3(0, 0, 0)}));

		expect(footprintContains(loading, 0.5, 0)).toBe(false);
		// Its own centre is the one point that is in it, which is the honest
		// answer for a zero-sized rectangle and keeps the predicate total.
		expect(footprintContains(loading, 0, 0)).toBe(true);
	});
});

describe('footprintCorners', () =>
{
	it('returns four corners around the centre, in order', () =>
	{
		const corners = footprintCorners(projectItem(fakeItem({
			position: new Vector3(10, 0, 20),
			halfSize: new Vector3(5, 0, 3),
		})));

		expect(corners).toEqual([
			{x: 5, y: 17}, {x: 15, y: 17}, {x: 15, y: 23}, {x: 5, y: 23},
		]);
	});

	it('rotates about the centre, keeping the area', () =>
	{
		const corners = footprintCorners(projectItem(fakeItem({
			position: new Vector3(0, 0, 0),
			halfSize: new Vector3(10, 0, 4),
			rotation: {x: 0, y: Math.PI / 2, z: 0},
		})));

		// A quarter turn swaps the extents.
		corners.forEach((corner) =>
		{
			expect(Math.abs(corner.x)).toBeCloseTo(4, 10);
			expect(Math.abs(corner.y)).toBeCloseTo(10, 10);
		});
	});
});

describe('the floorplan carries the projection', () =>
{
	it('starts empty, so a bare Floorplan is still a whole Floorplan', () =>
	{
		expect(new Floorplan().itemProjection).toEqual([]);
	});

	it('dispatches its own event, not EVENT_UPDATED', () =>
	{
		const floorplan = new Floorplan();
		const projected = vi.fn();
		floorplan.addEventListener(EVENT_ITEMS_PROJECTED, projected);

		floorplan.setItemProjection(projectItems([fakeItem()]));

		expect(projected).toHaveBeenCalledTimes(1);
		expect(projected.mock.calls[0][0].projection).toHaveLength(1);
		expect(floorplan.itemProjection).toHaveLength(1);
	});

	it('treats a null projection as none', () =>
	{
		const floorplan = new Floorplan();
		floorplan.setItemProjection(projectItems([fakeItem()]));
		floorplan.setItemProjection(null);

		expect(floorplan.itemProjection).toEqual([]);
	});

	it('finds a footprint by id, and answers null for anything else', () =>
	{
		const floorplan = new Floorplan();
		floorplan.setItemProjection(projectItems([fakeItem({designId: 'a'}), fakeItem({designId: 'b'})]));

		expect(floorplan.footprintById('b').id).toBe('b');
		expect(floorplan.footprintById('missing')).toBeNull();
		expect(floorplan.footprintById('')).toBeNull();
		expect(floorplan.footprintById(null)).toBeNull();
	});

	/**
	 * The finding this whole file exists for (T-1): a Floorplan cannot reach a
	 * Scene, and must not gain the ability. If this fails, somebody has added a
	 * back-reference and the 2D view can now edit the scene directly.
	 */
	it('has no path to the scene', () =>
	{
		const floorplan = new Floorplan();

		expect(floorplan.model).toBeUndefined();
		expect(floorplan.scene).toBeUndefined();
		expect(Object.keys(floorplan)).not.toContain('model');
		expect(Object.keys(floorplan)).not.toContain('scene');
	});
});

describe('the model keeps the projection current', () =>
{
	it('projects what the scene holds when asked', () =>
	{
		const model = new Model();
		model.level.items = [fakeItem({designId: 'a'}), fakeItem({designId: 'b'})];

		model.projectItemsToPlan();

		expect(model.floorplan.itemProjection.map((f) => f.id)).toEqual(['a', 'b']);
	});

	/**
	 * M-23, in its headless half: the count of footprints equals the count of
	 * items, whatever the scene holds. The browser tier asserts the same claim
	 * against a rasterised plan.
	 */
	it('keeps one footprint per item across add, move and remove', () =>
	{
		const model = new Model();
		const item = fakeItem({designId: 'a'});

		model.level.items = [item];
		model.scene.dispatchEvent({type: EVENT_ITEM_LOADED, item: item});
		expect(model.floorplan.itemProjection).toHaveLength(1);
		expect(model.floorplan.itemProjection.length).toBe(model.scene.itemCount());

		item.position = new Vector3(400, 0, 400);
		model.scene.dispatchEvent({type: EVENT_ITEM_MOVE_FINISH, item: item});
		expect(model.floorplan.itemProjection[0].x).toBe(400);
		expect(model.floorplan.itemProjection[0].y).toBe(400);

		model.level.items = [];
		model.scene.dispatchEvent({type: EVENT_ITEM_REMOVED, item: item});
		expect(model.floorplan.itemProjection).toHaveLength(0);
		expect(model.floorplan.itemProjection.length).toBe(model.scene.itemCount());
	});

	it('stops projecting once disposed, so a dropped document releases its scene', () =>
	{
		const model = new Model();
		model.level.items = [fakeItem()];

		model.dispose();
		model.scene.dispatchEvent({type: EVENT_ITEM_LOADED, item: null});

		expect(model.floorplan.itemProjection).toEqual([]);
	});
});
