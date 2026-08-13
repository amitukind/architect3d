/**
 * Characterization tests for the item pipeline: the Factory registry, the
 * Scene container, the Item -> save-file metadata contract, and Model
 * load/export of items.
 *
 * These describe what the code DOES today. Several behaviours below are wrong
 * in the abstract but load-bearing for existing save files - each one is marked
 * QUIRK with a source reference. Do not "fix" an expectation during the
 * migration; change the code and the expectation together, deliberately.
 *
 * DOM STATUS (see the report for follow-ups): vitest runs this file in the node
 * environment because the installed jsdom is 7.2.2 (a transitive dependency),
 * which vitest 4 cannot drive - opting this file into the jsdom environment via
 * the usual docblock dies with "JSDOM is not a constructor" - and happy-dom is
 * not installed. Real Item
 * construction calls document.createElement('canvas') at item.js:111 and
 * canvas.getContext('2d') at item.js:115, so it cannot complete here. That
 * boundary is pinned as a test of its own; everything past it is exercised with
 * a local FakeItem that stands in for Item's constructor only, and re-uses the
 * real Item.prototype.initObject and Item.prototype.getMetaData.
 */
import {describe, it, expect, beforeEach} from 'vitest';
import * as three from 'three';

import {Model} from '../src/scripts/model/model.js';
import {Factory, item_types} from '../src/scripts/items/factory.js';
import {Item} from '../src/scripts/items/item.js';
import {FloorItem} from '../src/scripts/items/floor_item.js';
import {WallItem} from '../src/scripts/items/wall_item.js';
import {InWallItem} from '../src/scripts/items/in_wall_item.js';
import {InWallFloorItem} from '../src/scripts/items/in_wall_floor_item.js';
import {OnFloorItem} from '../src/scripts/items/on_floor_item.js';
import {WallFloorItem} from '../src/scripts/items/wall_floor_item.js';
import {RoofItem} from '../src/scripts/items/roof_item.js';
import {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED,
	EVENT_LOADING, EVENT_LOADED} from '../src/scripts/core/events.js';

import {resetAll, stubItemLoader} from './helpers/harness.js';

// ---------------------------------------------------------------------------
// Local test doubles. These live here rather than in the shared harness because
// they only make sense against the DOM limitation described above.
// ---------------------------------------------------------------------------

/**
 * Stands in for a real Item so the rest of addItem() can be exercised headlessly.
 * It copies exactly the fields the real constructor copies before it reaches the
 * canvas code: model/metadata (item.js:35-36), scene (item.js:64),
 * geometry/material (item.js:69-70), position (item.js:104-108),
 * halfSize (item.js:110), rotation/scale (item.js:139-147) and the
 * metadata.materialColors application (item.js:149-165).
 *
 * Difference from the real class, noted so nobody mistakes it for a clone: the
 * real Item routes scale through setScale(), which also multiplies halfSize and
 * repaints the two dimension canvases. Here the scale is set directly, because
 * setScale() needs a 2D canvas context.
 *
 * initObject() and getMetaData() are the REAL implementations, called through.
 */
class FakeItem extends three.Mesh
{
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super();
		this.model = model;
		this.metadata = metadata;
		this.geometry = geometry;
		this.material = material;
		this.scene = model.scene;
		this.halfSize = new three.Vector3(25, 25, 25);
		this.calls = [];
		this.ctorArgs = {metadata, position, rotation, scale};

		if (position)
		{
			this.position.copy(position);
		}
		if (rotation)
		{
			this.rotation.y = rotation;
		}
		if (scale != null)
		{
			this.scale.set(scale.x, scale.y, scale.z);
		}
		if (metadata.materialColors && metadata.materialColors.length)
		{
			if (this.material.length)
			{
				for (let i = 0; i < metadata.materialColors.length; i++)
				{
					this.material[i].color = new three.Color(metadata.materialColors[i]);
				}
			}
			else
			{
				this.material.color = new three.Color(metadata.materialColors[0]);
			}
		}
	}

	placeInRoom() { this.calls.push('placeInRoom'); }
	moveToPosition(position, edge) { this.calls.push(['moveToPosition', position, edge]); }
	removed() { this.calls.push('removed'); }
	initObject() { this.calls.push('initObject'); Item.prototype.initObject.call(this); }
	getMetaData() { return Item.prototype.getMetaData.call(this); }
}

/** Run fn with Factory.getClass swapped for FakeItem; always restored. */
function withFakeFactory(fn)
{
	const original = Factory.getClass;
	const requestedTypes = [];
	Factory.getClass = (itemType) => { requestedTypes.push(itemType); return FakeItem; };
	try
	{
		return fn(requestedTypes);
	}
	finally
	{
		Factory.getClass = original;
	}
}

/** An item loader that hands back a box + one material, synchronously. */
function boxLoader()
{
	return (fileName, metadata, onLoad) => {
		onLoad(new three.BoxGeometry(50, 50, 50), [new three.MeshBasicMaterial({color: 0xcccccc})]);
	};
}

/** An item loader that records its arguments and never calls back. */
function recordingLoader(calls)
{
	return function (fileName, metadata, onLoad) {
		calls.push({fileName, metadata, onLoadType: typeof onLoad, argCount: arguments.length});
	};
}

const SOFA = {
	item_name: 'Sofa', item_type: 1, format: 'obj', model_url: 'models/sofa.obj',
	xpos: 10, ypos: 0, zpos: 20, rotation: 1.5,
	scale_x: 1, scale_y: 2, scale_z: 3, fixed: true,
	material_colors: ['#ff0000'], resizable: true,
};

/** A 400x300 saved design in the 0.0.2a format, with the given items array. */
function makeDesign(items)
{
	const wall = (c1, c2) => ({corner1: c1, corner2: c2, wallType: 'STRAIGHT', a: {x: 0, y: 0}, b: {x: 0, y: 0}});
	return {
		floorplan: {
			version: '0.0.2a',
			corners: {
				c1: {x: 0, y: 0, elevation: 250},
				c2: {x: 400, y: 0, elevation: 250},
				c3: {x: 400, y: 300, elevation: 250},
				c4: {x: 0, y: 300, elevation: 250},
			},
			walls: [wall('c1', 'c2'), wall('c2', 'c3'), wall('c3', 'c4'), wall('c4', 'c1')],
			rooms: {},
		},
		items: items,
	};
}

/** A bare object carrying only the fields Item.prototype.getMetaData reads. */
function metaDataSource(overrides)
{
	return Object.assign({
		metadata: {itemName: 'Sofa', itemType: 1, format: 'obj', modelUrl: 'models/sofa.obj', resizable: true},
		material: new three.MeshBasicMaterial({color: 0x123456}),
		position: new three.Vector3(1, 2, 3),
		rotation: {y: 0.5},
		scale: new three.Vector3(2, 3, 4),
		fixed: true,
	}, overrides);
}

beforeEach(() => {
	resetAll();
});

// ---------------------------------------------------------------------------

describe('Factory registry (written into every save file)', () => {
	it('maps exactly the eight numeric item types 0,1,2,3,4,7,8,9', () => {
		expect(Object.keys(item_types)).toEqual(['0', '1', '2', '3', '4', '7', '8', '9']);
	});

	it('maps 0 to Item', () => {
		expect(item_types[0]).toBe(Item);
		expect(item_types[0].name).toBe('Item');
	});

	it('maps 1 to FloorItem', () => {
		expect(item_types[1]).toBe(FloorItem);
		expect(item_types[1].name).toBe('FloorItem');
	});

	it('maps 2 to WallItem', () => {
		expect(item_types[2]).toBe(WallItem);
		expect(item_types[2].name).toBe('WallItem');
	});

	it('maps 3 to InWallItem', () => {
		expect(item_types[3]).toBe(InWallItem);
		expect(item_types[3].name).toBe('InWallItem');
	});

	it('maps 4 to RoofItem', () => {
		expect(item_types[4]).toBe(RoofItem);
		expect(item_types[4].name).toBe('RoofItem');
	});

	it('maps 7 to InWallFloorItem', () => {
		expect(item_types[7]).toBe(InWallFloorItem);
		expect(item_types[7].name).toBe('InWallFloorItem');
	});

	it('maps 8 to OnFloorItem', () => {
		expect(item_types[8]).toBe(OnFloorItem);
		expect(item_types[8].name).toBe('OnFloorItem');
	});

	it('maps 9 to WallFloorItem', () => {
		expect(item_types[9]).toBe(WallFloorItem);
		expect(item_types[9].name).toBe('WallFloorItem');
	});

	it('has no entry for type 5 or type 6 - the numbering has two holes', () => {
		expect(5 in item_types).toBe(false);
		expect(6 in item_types).toBe(false);
		expect(item_types[5]).toBeUndefined();
		expect(item_types[6]).toBeUndefined();
	});

	it('preserves the class hierarchy the registry indexes', () => {
		expect(Object.getPrototypeOf(FloorItem)).toBe(Item);
		expect(Object.getPrototypeOf(WallItem)).toBe(Item);
		expect(Object.getPrototypeOf(RoofItem)).toBe(Item);
		expect(Object.getPrototypeOf(InWallItem)).toBe(WallItem);
		expect(Object.getPrototypeOf(WallFloorItem)).toBe(WallItem);
		expect(Object.getPrototypeOf(InWallFloorItem)).toBe(InWallItem);
		expect(Object.getPrototypeOf(OnFloorItem)).toBe(FloorItem);
		expect(Object.getPrototypeOf(Item)).toBe(three.Mesh);
	});

	// QUIRK (factory.js:10): the registry is a plain exported object literal. It
	// is neither frozen nor sealed, so any importer can rewrite the type->class
	// mapping for the whole process at runtime.
	it('is a plain mutable object - "frozen" is a convention, not enforced', () => {
		expect(Object.isFrozen(item_types)).toBe(false);
		expect(Object.isSealed(item_types)).toBe(false);
		expect(Object.getPrototypeOf(item_types)).toBe(Object.prototype);
	});

	it('Factory.getClass returns the registry entry for a known type', () => {
		expect(Factory.getClass(0)).toBe(Item);
		expect(Factory.getClass(1)).toBe(FloorItem);
		expect(Factory.getClass(2)).toBe(WallItem);
		expect(Factory.getClass(3)).toBe(InWallItem);
		expect(Factory.getClass(4)).toBe(RoofItem);
		expect(Factory.getClass(7)).toBe(InWallFloorItem);
		expect(Factory.getClass(8)).toBe(OnFloorItem);
		expect(Factory.getClass(9)).toBe(WallFloorItem);
	});

	// QUIRK (factory.js:18): a plain property lookup with no validation. An
	// unknown type yields undefined, which only blows up later at
	// `new (Factory.getClass(itemType))(...)` in Scene.addItem.
	it('Factory.getClass returns undefined for an unknown type instead of throwing', () => {
		expect(Factory.getClass(5)).toBeUndefined();
		expect(Factory.getClass(6)).toBeUndefined();
		expect(Factory.getClass(99)).toBeUndefined();
		expect(Factory.getClass('nope')).toBeUndefined();
		expect(Factory.getClass(undefined)).toBeUndefined();
		expect(Factory.getClass(null)).toBeUndefined();
	});

	// QUIRK: object keys are strings, so a save file carrying item_type as a
	// string still resolves. Any replacement (Map, switch) must keep this.
	it('Factory.getClass resolves a numeric type given as a string', () => {
		expect(Factory.getClass('1')).toBe(FloorItem);
		expect(Factory.getClass('7')).toBe(InWallFloorItem);
	});
});

describe('Scene construction', () => {
	it('builds a three.Scene with a white background and no children', () => {
		const model = new Model('/textures/');
		const threeScene = model.scene.getScene();
		expect(threeScene).toBeInstanceOf(three.Scene);
		expect(threeScene.children).toHaveLength(0);
		expect(threeScene.background.getHexString()).toBe('ffffff');
	});

	it('starts with an empty item list and needsUpdate false', () => {
		const model = new Model('/textures/');
		expect(model.scene.getItems()).toEqual([]);
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.needsUpdate).toBe(false);
	});

	it('keeps back-references to the model and the texture directory', () => {
		const model = new Model('/textures/');
		expect(model.scene.model).toBe(model);
		expect(model.scene.textureDir).toBe('/textures/');
	});

	it('installs no item loader by default, so production uses the built-in dispatch', () => {
		const model = new Model('/textures/');
		expect(model.scene.itemLoader).toBeNull();
	});
});

describe('Scene.setItemLoader seam', () => {
	it('stores a function loader', () => {
		const model = new Model('/textures/');
		const fn = () => {};
		model.scene.setItemLoader(fn);
		expect(model.scene.itemLoader).toBe(fn);
	});

	it('setItemLoader(null) restores the built-in dispatch by nulling the seam', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(() => {});
		expect(typeof model.scene.itemLoader).toBe('function');
		model.scene.setItemLoader(null);
		expect(model.scene.itemLoader).toBeNull();
	});

	it('setItemLoader with a non-function clears the seam rather than throwing', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(() => {});
		model.scene.setItemLoader('not a function');
		expect(model.scene.itemLoader).toBeNull();
		model.scene.setItemLoader(() => {});
		model.scene.setItemLoader(undefined);
		expect(model.scene.itemLoader).toBeNull();
	});

	it('addItem calls the installed loader with (fileName, metadata, onLoad) and touches no network', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.setItemLoader(recordingLoader(calls));
		const metadata = {itemName: 'Wall Unit', itemType: 2, modelUrl: 'models/wall.js'};
		model.scene.addItem(2, 'models/wall.js', metadata, null, 0, null, false);

		expect(calls).toHaveLength(1);
		expect(calls[0].fileName).toBe('models/wall.js');
		expect(calls[0].metadata).toBe(metadata);
		expect(calls[0].onLoadType).toBe('function');
		expect(calls[0].argCount).toBe(3);
	});

	// scene.js:284 dispatches before the format dispatch, so the seam does not
	// change the event ordering the UI relies on.
	it('dispatches EVENT_ITEM_LOADING before invoking the loader', () => {
		const model = new Model('/textures/');
		const order = [];
		model.scene.addEventListener(EVENT_ITEM_LOADING, () => order.push('EVENT_ITEM_LOADING'));
		model.scene.setItemLoader(() => order.push('loader'));
		model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
		expect(order).toEqual(['EVENT_ITEM_LOADING', 'loader']);
	});

	// QUIRK (scene.js:284): unlike EVENT_ITEM_LOADED, the loading event carries
	// no item payload - listeners get only three.js's own {type, target}.
	it('EVENT_ITEM_LOADING carries no item payload', () => {
		const model = new Model('/textures/');
		let event = null;
		model.scene.addEventListener(EVENT_ITEM_LOADING, (e) => { event = e; });
		model.scene.setItemLoader(() => {});
		model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
		expect(Object.keys(event).sort()).toEqual(['target', 'type']);
		expect(event.type).toBe('ITEM_LOADING_EVENT');
		expect(event.item).toBeUndefined();
	});

	it('a loader that never calls back leaves the scene untouched and fires no EVENT_ITEM_LOADED', () => {
		const model = new Model('/textures/');
		let loaded = 0;
		model.scene.addEventListener(EVENT_ITEM_LOADED, () => { loaded++; });
		model.scene.setItemLoader(() => {});
		model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
		expect(loaded).toBe(0);
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getScene().children).toHaveLength(0);
	});
});

describe('Scene.addItem with the loader seam (Item stubbed - see DOM STATUS)', () => {
	it('pushes the constructed item, adds it to the three scene and fires both events', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			const events = [];
			model.scene.addEventListener(EVENT_ITEM_LOADING, () => events.push('EVENT_ITEM_LOADING'));
			model.scene.addEventListener(EVENT_ITEM_LOADED, (e) => events.push(['EVENT_ITEM_LOADED', e.item]));

			model.scene.addItem(2, 'models/wall.js', {itemName: 'w'}, new three.Vector3(1, 2, 3), 0.5, null, false);

			expect(model.scene.itemCount()).toBe(1);
			expect(model.scene.getItems()).toHaveLength(1);
			const item = model.scene.getItems()[0];
			expect(events[0]).toBe('EVENT_ITEM_LOADING');
			expect(events[1][0]).toBe('EVENT_ITEM_LOADED');
			expect(events[1][1]).toBe(item);
			// The item mesh plus the BoxHelper that initObject() adds.
			expect(model.scene.getScene().children).toContain(item);
		});
	});

	it('registers the item and calls initObject() before EVENT_ITEM_LOADED is dispatched', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			let stateAtLoaded = null;
			model.scene.addEventListener(EVENT_ITEM_LOADED, (e) => {
				stateAtLoaded = {
					calls: e.item.calls.slice(),
					inItems: model.scene.getItems().indexOf(e.item),
					parented: e.item.parent === model.scene.getScene(),
				};
			});
			model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
			// initObject() delegates straight to placeInRoom() (item.js:366).
			expect(stateAtLoaded).toEqual({calls: ['initObject', 'placeInRoom'], inItems: 0, parented: true});
		});
	});

	it('sets needsUpdate through the real initObject', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			expect(model.scene.needsUpdate).toBe(false);
			model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
			expect(model.scene.needsUpdate).toBe(true);
		});
	});

	it('passes position, rotation and scale straight through to the item constructor', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			const position = new three.Vector3(11, 22, 33);
			const scale = new three.Vector3(2, 3, 4);
			model.scene.addItem(1, 'a.js', {itemName: 'x'}, position, 1.25, scale, false);
			const item = model.scene.getItems()[0];
			expect(item.ctorArgs.position).toBe(position);
			expect(item.ctorArgs.rotation).toBe(1.25);
			expect(item.ctorArgs.scale).toBe(scale);
			expect(item.position.toArray()).toEqual([11, 22, 33]);
			expect(item.rotation.y).toBe(1.25);
			expect(item.scale.toArray()).toEqual([2, 3, 4]);
		});
	});

	// QUIRK (scene.js:165-168): the guard is `itemType == undefined` (loose), so
	// null falls into the default too. Type 0 (plain Item) survives because the
	// check is not a truthiness check.
	it('defaults an undefined itemType to 1 (FloorItem)', () => {
		const model = new Model('/textures/');
		withFakeFactory((requested) => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(undefined, 'a.js', {}, null, 0, null, false);
			expect(requested).toEqual([1]);
		});
	});

	it('defaults a null itemType to 1 as well, because the guard uses loose equality', () => {
		const model = new Model('/textures/');
		withFakeFactory((requested) => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(null, 'a.js', {}, null, 0, null, false);
			expect(requested).toEqual([1]);
		});
	});

	it('keeps itemType 0 and passes a string itemType through unchanged', () => {
		const model = new Model('/textures/');
		withFakeFactory((requested) => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(0, 'a.js', {}, null, 0, null, false);
			model.scene.addItem('2', 'a.js', {}, null, 0, null, false);
			expect(requested).toEqual([0, '2']);
		});
	});

	// QUIRK (scene.js:190): `item.fixed = fixed || false` normalises falsy values
	// to false but lets any truthy non-boolean through verbatim, so a save file
	// with fixed: 'yes' round-trips as the string 'yes'.
	it('normalises a falsy fixed flag to false but stores truthy non-booleans verbatim', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(1, 'a.js', {}, null, 0, null, undefined);
			model.scene.addItem(1, 'a.js', {}, null, 0, null, 0);
			model.scene.addItem(1, 'a.js', {}, null, 0, null, 'yes');
			expect(model.scene.getItems().map((i) => i.fixed)).toEqual([false, false, 'yes']);
		});
	});

	it('with newItemDefinitions, moves the item to the position/edge then places it in the room', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			const position = new three.Vector3(9, 9, 9);
			model.scene.addItem(1, 'a.js', {}, null, 0, null, false, {position: position, edge: 'EDGE'});
			const item = model.scene.getItems()[0];
			expect(item.calls[0]).toBe('initObject');
			expect(item.calls[1]).toBe('placeInRoom'); // from initObject
			expect(item.calls[2]).toEqual(['moveToPosition', position, 'EDGE']);
			expect(item.calls[3]).toBe('placeInRoom'); // again, explicitly
		});
	});

	it('applies metadata.materialColors onto the loaded materials', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(1, 'a.js', {materialColors: ['#ff0000']}, null, 0, null, false);
			const item = model.scene.getItems()[0];
			expect(item.material[0].color.getHexString()).toBe('ff0000');
		});
	});
});

describe('Scene.addItem with a real Item (DOM boundary)', () => {
	// The harness stub loader runs, EVENT_ITEM_LOADING fires, and construction
	// then dies at item.js:111 `document.createElement('canvas')`. This pins
	// exactly how far the headless pipeline reaches today; when a usable DOM
	// (or a canvas-free Item) lands, this test is the one to rewrite.
	it('runs the stub loader, then throws a ReferenceError for document at item.js:111', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(stubItemLoader(three));
		const events = [];
		model.scene.addEventListener(EVENT_ITEM_LOADING, () => events.push('EVENT_ITEM_LOADING'));
		model.scene.addEventListener(EVENT_ITEM_LOADED, () => events.push('EVENT_ITEM_LOADED'));

		let error = null;
		try
		{
			model.scene.addItem(1, 'a.js', {itemName: 'a', itemType: 1}, null, 0, null, false);
		}
		catch (e)
		{
			error = e;
		}

		expect(error).toBeInstanceOf(ReferenceError);
		expect(error.message).toMatch(/document/);
		expect(error.stack).toMatch(/items\/item\.js/);
		expect(events).toEqual(['EVENT_ITEM_LOADING']);
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getScene().children).toHaveLength(0);
	});
});

describe('Scene container bookkeeping', () => {
	const plainMesh = () => new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial());

	it('add() puts a mesh in the three scene without registering it as an item', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.scene.add(mesh);
		expect(model.scene.getScene().children).toEqual([mesh]);
		expect(mesh.parent).toBe(model.scene.getScene());
		expect(model.scene.itemCount()).toBe(0);
	});

	it('remove() detaches the mesh from the three scene', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.scene.add(mesh);
		model.scene.remove(mesh);
		expect(model.scene.getScene().children).toHaveLength(0);
		expect(mesh.parent).toBeNull();
	});

	// QUIRK (scene.js:70-74): remove() is documented "removes a non-item", yet it
	// also strips the mesh from the items array. Anything registered as an item
	// can therefore be de-registered through the non-item path.
	it('remove() also strips the mesh from the items list, despite being the non-item path', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.scene.items.push(mesh);
		model.scene.add(mesh);
		model.scene.remove(mesh);
		expect(model.scene.itemCount()).toBe(0);
	});

	it('removeItem() fires EVENT_ITEM_REMOVED with the item, calls item.removed(), and de-registers it', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		let removedCalled = false;
		mesh.removed = () => { removedCalled = true; };
		const events = [];
		model.scene.addEventListener(EVENT_ITEM_REMOVED, (e) => events.push(e.item));

		model.scene.items.push(mesh);
		model.scene.add(mesh);
		model.scene.removeItem(mesh);

		expect(events).toEqual([mesh]);
		expect(removedCalled).toBe(true);
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getScene().children).toHaveLength(0);
	});

	it('removeItem(item, true) detaches the mesh but keeps it in getItems()', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		mesh.removed = () => {};
		model.scene.items.push(mesh);
		model.scene.add(mesh);
		model.scene.removeItem(mesh, true);
		expect(model.scene.getScene().children).toHaveLength(0);
		expect(model.scene.getItems()).toEqual([mesh]);
	});

	it('clearItems() detaches every item and empties the list', () => {
		const model = new Model('/textures/');
		const meshes = [plainMesh(), plainMesh(), plainMesh()];
		meshes.forEach((m) => { m.removed = () => {}; model.scene.items.push(m); model.scene.add(m); });
		model.scene.clearItems();
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getItems()).toEqual([]);
		expect(model.scene.getScene().children).toHaveLength(0);
	});

	it('clearItems() fires one EVENT_ITEM_REMOVED per item, in insertion order', () => {
		const model = new Model('/textures/');
		const events = [];
		model.scene.addEventListener(EVENT_ITEM_REMOVED, (e) => events.push(e.item.name));
		['a', 'b', 'c'].forEach((name) => {
			const m = plainMesh();
			m.name = name;
			m.removed = () => {};
			model.scene.items.push(m);
			model.scene.add(m);
		});
		model.scene.clearItems();
		expect(events).toEqual(['a', 'b', 'c']);
	});

	it('clearItems() on an empty scene is a no-op', () => {
		const model = new Model('/textures/');
		let fired = 0;
		model.scene.addEventListener(EVENT_ITEM_REMOVED, () => { fired++; });
		model.scene.clearItems();
		expect(fired).toBe(0);
		expect(model.scene.getItems()).toEqual([]);
	});

	// QUIRK (item.js:372-373 + scene.js:123): initObject() parents a BoxHelper to
	// the three scene, but removeItem() only removes the item mesh. The helper
	// (a LineSegments) is orphaned in the scene graph for the rest of the session.
	it('removeItem() leaks the item BoxHelper into the three scene', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
			const item = model.scene.getItems()[0];
			expect(item.bhelper).toBeInstanceOf(three.BoxHelper);
			expect(item.bhelper.visible).toBe(false);
			expect(model.scene.getScene().children.map((c) => c.type)).toEqual(['Mesh', 'LineSegments']);

			model.scene.removeItem(item);
			expect(model.scene.itemCount()).toBe(0);
			expect(model.scene.getScene().children.map((c) => c.type)).toEqual(['LineSegments']);
			expect(model.scene.getScene().children[0]).toBe(item.bhelper);
		});
	});

	it('Model.switchWireframe forwards the flag to every item', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.items.push({switchWireframe: (flag) => calls.push(['a', flag])});
		model.scene.items.push({switchWireframe: (flag) => calls.push(['b', flag])});
		model.switchWireframe(true);
		expect(calls).toEqual([['a', true], ['b', true]]);
	});
});

describe('Item.getMetaData - the save-file item contract', () => {
	it('emits exactly the thirteen save-file keys, in this order', () => {
		const md = Item.prototype.getMetaData.call(metaDataSource());
		expect(Object.keys(md)).toEqual([
			'item_name', 'item_type', 'format', 'model_url',
			'xpos', 'ypos', 'zpos',
			'rotation',
			'scale_x', 'scale_y', 'scale_z',
			'fixed',
			'material_colors',
		]);
	});

	it('maps metadata, position, rotation.y, scale and fixed onto those keys', () => {
		const md = Item.prototype.getMetaData.call(metaDataSource());
		expect(md).toEqual({
			item_name: 'Sofa',
			item_type: 1,
			format: 'obj',
			model_url: 'models/sofa.obj',
			xpos: 1, ypos: 2, zpos: 3,
			rotation: 0.5,
			scale_x: 2, scale_y: 3, scale_z: 4,
			fixed: true,
			material_colors: ['#123456'],
		});
	});

	// QUIRK (item.js:598-618): metadata.resizable is read by Model.newRoom on
	// load but getMetaData never writes it back, so it is dropped on every save.
	it('drops metadata.resizable - it survives a load but never a save', () => {
		const source = metaDataSource();
		expect(source.metadata.resizable).toBe(true);
		const md = Item.prototype.getMetaData.call(source);
		expect('resizable' in md).toBe(false);
	});

	it('reads the colour off the live material, not off metadata.materialColors', () => {
		const source = metaDataSource({material: new three.MeshBasicMaterial({color: 0x00ff00})});
		source.metadata.materialColors = ['#ff0000'];
		const md = Item.prototype.getMetaData.call(source);
		expect(md.material_colors).toEqual(['#00ff00']);
	});

	it('emits one lowercase #rrggbb entry per material when material is an array', () => {
		const source = metaDataSource({material: [
			new three.MeshBasicMaterial({color: 0xff0000}),
			new three.MeshBasicMaterial({color: 0x00ff00}),
			new three.MeshBasicMaterial({color: 0xabcdef}),
		]});
		const md = Item.prototype.getMetaData.call(source);
		expect(md.material_colors).toEqual(['#ff0000', '#00ff00', '#abcdef']);
	});

	// QUIRK (item.js:601): the array/single branch is chosen by `this.material.length`,
	// which is 0 - falsy - for an empty material array. The code then takes the
	// single-material branch and dereferences `[].color`.
	it('throws on an empty material array, because length 0 is treated as "not an array"', () => {
		const source = metaDataSource({material: []});
		expect(() => Item.prototype.getMetaData.call(source)).toThrow(TypeError);
		expect(() => Item.prototype.getMetaData.call(source)).toThrow(/getHexString/);
	});

	// QUIRK: absent metadata fields become undefined properties, which
	// JSON.stringify silently omits - so a saved item may be missing format and
	// model_url entirely rather than carrying nulls.
	it('emits undefined for absent metadata fields, and JSON.stringify then drops those keys', () => {
		const source = metaDataSource({metadata: {itemName: 'X', itemType: 1}});
		const md = Item.prototype.getMetaData.call(source);
		expect(md.format).toBeUndefined();
		expect(md.model_url).toBeUndefined();
		expect(Object.keys(md)).toHaveLength(13);
		expect(Object.keys(JSON.parse(JSON.stringify(md)))).toEqual([
			'item_name', 'item_type', 'xpos', 'ypos', 'zpos',
			'rotation', 'scale_x', 'scale_y', 'scale_z', 'fixed', 'material_colors',
		]);
	});
});

describe('Model.loadSerialized', () => {
	it('dispatches EVENT_LOADING then EVENT_LOADED, both carrying the model as item', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(() => {});
		const events = [];
		model.addEventListener(EVENT_LOADING, (e) => events.push([e.type, e.item]));
		model.addEventListener(EVENT_LOADED, (e) => events.push([e.type, e.item]));

		model.loadSerialized(JSON.stringify(makeDesign([])));

		expect(events).toEqual([
			['LOADING_EVENT', model],
			['LOADED_EVENT', model],
		]);
	});

	it('loads the floorplan alongside the items', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(() => {});
		model.loadSerialized(JSON.stringify(makeDesign([SOFA])));
		expect(model.floorplan.getWalls()).toHaveLength(4);
		expect(model.floorplan.getCorners()).toHaveLength(4);
		expect(model.floorplan.getRooms()).toHaveLength(1);
	});

	it('hands each save-file item to the loader with its snake_case fields remapped to camelCase metadata', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.setItemLoader(recordingLoader(calls));

		model.loadSerialized(JSON.stringify(makeDesign([SOFA])));

		expect(calls).toHaveLength(1);
		expect(calls[0].fileName).toBe('models/sofa.obj');
		expect(calls[0].metadata).toEqual({
			itemName: 'Sofa',
			resizable: true,
			format: 'obj',
			itemType: 1,
			modelUrl: 'models/sofa.obj',
			materialColors: ['#ff0000'],
		});
	});

	// model.js:108 - the metadata object is built from six fields only. Anything
	// else in the save file (xpos/rotation/scale/fixed) reaches the item as
	// constructor arguments instead, and unknown keys are dropped outright.
	it('passes (item_type, model_url, metadata, position, rotation, scale, fixed) to Scene.addItem', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.addItem = (...args) => calls.push(args);

		model.loadSerialized(JSON.stringify(makeDesign([SOFA])));

		expect(calls).toHaveLength(1);
		const [itemType, fileName, metadata, position, rotation, scale, fixed] = calls[0];
		expect(itemType).toBe(1);
		expect(fileName).toBe('models/sofa.obj');
		expect(metadata.itemName).toBe('Sofa');
		expect(position).toBeInstanceOf(three.Vector3);
		expect(position.toArray()).toEqual([10, 0, 20]);
		expect(rotation).toBe(1.5);
		expect(scale.toArray()).toEqual([1, 2, 3]);
		expect(fixed).toBe(true);
		expect(calls[0]).toHaveLength(7); // no newItemDefinitions on the load path
	});

	it('defaults a missing material_colors to an empty array', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.setItemLoader(recordingLoader(calls));
		const bare = {item_name: 'Door', item_type: 7, model_url: 'models/door.js',
			xpos: 1, ypos: 2, zpos: 3, rotation: 0, scale_x: 1, scale_y: 1, scale_z: 1, fixed: true};

		model.loadSerialized(JSON.stringify(makeDesign([bare])));

		expect(calls[0].metadata).toEqual({
			itemName: 'Door',
			resizable: undefined,
			format: undefined,
			itemType: 7,
			modelUrl: 'models/door.js',
			materialColors: [],
		});
	});

	it('loads several items in save-file order', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.scene.setItemLoader(recordingLoader(calls));
		model.loadSerialized(JSON.stringify(makeDesign([
			SOFA,
			{item_name: 'Door', item_type: 7, model_url: 'models/door.js', xpos: 0, ypos: 0, zpos: 0, rotation: 0, scale_x: 1, scale_y: 1, scale_z: 1, fixed: true},
		])));
		expect(calls.map((c) => c.metadata.itemName)).toEqual(['Sofa', 'Door']);
	});

	it('clears items already in the scene before loading', () => {
		const model = new Model('/textures/');
		model.scene.setItemLoader(() => {});
		const stale = new three.Mesh();
		stale.removed = () => {};
		model.scene.items.push(stale);
		model.scene.add(stale);

		model.loadSerialized(JSON.stringify(makeDesign([])));

		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getScene().children).toHaveLength(0);
	});

	// QUIRK (model.js:43 + model.js:105): items is not defaulted, so a design
	// without an items key throws - and it throws AFTER EVENT_LOADING has already
	// been dispatched and after the floorplan has been replaced, leaving the model
	// half-loaded with no EVENT_LOADED.
	it('throws on a design with no items array, after EVENT_LOADING and after replacing the floorplan', () => {
		const model = new Model('/textures/');
		const events = [];
		model.addEventListener(EVENT_LOADING, (e) => events.push(e.type));
		model.addEventListener(EVENT_LOADED, (e) => events.push(e.type));

		const design = makeDesign([]);
		delete design.items;

		expect(() => model.loadSerialized(JSON.stringify(design))).toThrow(TypeError);
		expect(events).toEqual(['LOADING_EVENT']);
		expect(model.floorplan.getWalls()).toHaveLength(4);
	});
});

describe('Model.exportSerialized', () => {
	it('emits {floorplan, items} with one getMetaData object per scene item', () => {
		const model = new Model('/textures/');
		model.scene.items.push({getMetaData: () => ({item_name: 'A', item_type: 1})});
		model.scene.items.push({getMetaData: () => ({item_name: 'B', item_type: 7})});

		const out = JSON.parse(model.exportSerialized());

		expect(Object.keys(out)).toEqual(['floorplan', 'items']);
		expect(out.items).toEqual([
			{item_name: 'A', item_type: 1},
			{item_name: 'B', item_type: 7},
		]);
	});

	it('emits an empty items array for a scene with no items', () => {
		const model = new Model('/textures/');
		const out = JSON.parse(model.exportSerialized());
		expect(out.items).toEqual([]);
	});

	// End-to-end over the pieces that run headlessly: Model.newRoom's field
	// mapping, Scene.addItem's fixed coercion, the item's own field copying and
	// Item.prototype.getMetaData. Only the Item constructor is stubbed.
	it('round-trips every item field except resizable, which is silently dropped', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			model.loadSerialized(JSON.stringify(makeDesign([SOFA])));
			expect(model.scene.itemCount()).toBe(1);

			const out = JSON.parse(model.exportSerialized());

			expect(out.items).toEqual([{
				item_name: 'Sofa',
				item_type: 1,
				format: 'obj',
				model_url: 'models/sofa.obj',
				xpos: 10, ypos: 0, zpos: 20,
				rotation: 1.5,
				scale_x: 1, scale_y: 2, scale_z: 3,
				fixed: true,
				material_colors: ['#ff0000'],
			}]);
			expect('resizable' in out.items[0]).toBe(false);
			expect(SOFA.resizable).toBe(true);
		});
	});
});
