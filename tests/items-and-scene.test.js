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
import {Scene} from '../src/scripts/model/scene.js';
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
 * initObject() and getMetaData() are the REAL implementations, called through,
 * and so is applyUnitScale() - the method that replaced the x300 hack (RM-012
 * J1). setScale is the one stub in the chain, for the canvas reason above.
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
		// The real Item records this before applying the scale, and initObject
		// reads it to decide whether the model still needs its unit conversion.
		this._scaleFromDocument = (scale != null);
		if (scale != null)
		{
			this.scale.set(scale.x, scale.y, scale.z);
		}
		// Mirrors the real Item: applying a colour from the file marks the slot
		// as chosen, which is what getMetaData writes back. A null entry is the
		// sparse form of format 2.0.0 and means "leave the model's own colour".
		this._pickedColorSlots = new Set();
		if (metadata.materialColors && metadata.materialColors.length)
		{
			if (this.material.length)
			{
				for (let i = 0; i < metadata.materialColors.length; i++)
				{
					if (metadata.materialColors[i] == null) { continue; }
					this.material[i].color = new three.Color(metadata.materialColors[i]);
					this._pickedColorSlots.add(i);
				}
			}
			else if (metadata.materialColors[0] != null)
			{
				this.material.color = new three.Color(metadata.materialColors[0]);
				this._pickedColorSlots.add(0);
			}
		}
	}

	// The real setScale multiplies halfSize and repaints two dimension canvases,
	// and a canvas is what this environment does not have. Multiplying the two
	// numbers `applyUnitScale` and its callers actually read is enough, and being
	// a stub is why the assertions about it are about the scale and not the label.
	setScale(x, y, z)
	{
		this.halfSize.multiply(new three.Vector3(x, y, z));
		this.scale.set(this.scale.x * x, this.scale.y * y, this.scale.z * z);
	}

	placeInRoom() { this.calls.push('placeInRoom'); }
	moveToPosition(position, edge) { this.calls.push(['moveToPosition', position, edge]); }
	removed() { this.calls.push('removed'); }
	initObject() { this.calls.push('initObject'); Item.prototype.initObject.call(this); }
	applyUnitScale() { return Item.prototype.applyUnitScale.call(this); }
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
		// Nothing recoloured, which is what an item straight out of the catalog
		// looks like. Pass a populated Set to model a user pick.
		_pickedColorSlots: new Set(),
	}, overrides);
}

beforeEach(() => {
	resetAll();
});

// ---------------------------------------------------------------------------

/**
 * Everything under the three scene, at any depth (RM-010 G1).
 *
 * These assertions used to read `getScene().children` and mean "what is in the
 * scene". A level's geometry now goes into that level's `Group` - which is
 * where its base elevation is applied - so `children` is one group per storey
 * and the meshes are a level down. Re-pointed rather than relaxed: the question
 * each of them asks is still "is this mesh in the scene", and this answers it
 * without caring how deep the graph is.
 *
 * The groups themselves are excluded, because a container is not a thing in the
 * scene in the sense these tests mean.
 */
function sceneContents(model)
{
	const found = [];
	model.scene.getScene().traverse((object) =>
	{
		if (object !== model.scene.getScene() && !String(object.name).startsWith('level:'))
		{
			found.push(object);
		}
	});
	return found;
}

describe('Factory registry (written into every save file)', () => {
	/**
	 * The eight original numbers, still meaning the same eight classes.
	 *
	 * This assertion used to read `toEqual([...eight])`. RM-008 F1 added a ninth
	 * (type 10, the parametric opening), F3 a tenth (11, the parametric stair)
	 * and F2's late slice an eleventh (12, the column and beam). Re-checked each
	 * time rather than relaxed. What the pin is FOR is that a type number, once
	 * written into a save file, cannot change its meaning - so the eight are
	 * asserted individually and the three additions are asserted as the additions
	 * they are. Appending rather than filling the gaps at 5 and 6 is the same
	 * argument: a number that once meant something else is a trap, and a gap is
	 * only untidy.
	 */
	it('keeps the eight original numeric item types, and adds 10, 11 and 12', () => {
		expect(Object.keys(item_types).sort((a, b) => Number(a) - Number(b)))
			.toEqual(['0', '1', '2', '3', '4', '7', '8', '9', '10', '11', '12']);
		expect(item_types[10].name).toBe('ParametricOpening');
		expect(item_types[11].name).toBe('ParametricStair');
		expect(item_types[12].name).toBe('ParametricStructure');
		// The gaps stay gaps.
		expect(item_types[5]).toBeUndefined();
		expect(item_types[6]).toBeUndefined();
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

describe('Scene.addItem failure path (RM-002 R-01)', () => {
	/**
	 * Before this existed, both loaders were called with a null onError and
	 * nothing around them. A load that could not start dispatched
	 * EVENT_ITEM_LOADING and then dispatched nothing at all, forever - which is
	 * why the application's undo gate needed an eight-second timer to survive a
	 * count that never came back down.
	 *
	 * The contract these pin: every addItem dispatches exactly one LOADING and
	 * exactly one LOADED, whatever happens. On failure the LOADED carries a null
	 * item and Scene.unloadableItemCount goes up by one.
	 */
	function countEvents(scene) {
		const seen = {loading: 0, loaded: 0, items: []};
		scene.addEventListener(EVENT_ITEM_LOADING, () => {seen.loading += 1;});
		scene.addEventListener(EVENT_ITEM_LOADED, (event) => {
			seen.loaded += 1;
			seen.items.push(event.item);
		});
		return seen;
	}

	it('balances LOADING with LOADED when the URL cannot even be parsed', () => {
		// Under Node a relative URL throws synchronously out of three's FileLoader,
		// from `new Request` - past the onError callback that exists for this and
		// never sees it. That synchronous throw used to escape addItem entirely.
		const model = new Model('/textures/');
		const seen = countEvents(model.scene);
		const before = Scene.unloadableItemCount;

		expect(() => model.scene.addItem(
			1, 'models/js-glb/nope.glb',
			{itemName: 'Nope', itemType: 1, format: 'gltf', modelUrl: 'models/js-glb/nope.glb'},
			null, 0, null, false,
		)).not.toThrow();

		expect(seen.loading).toBe(1);
		expect(seen.loaded).toBe(1);
		expect(seen.items).toEqual([null]);
		expect(Scene.unloadableItemCount).toBe(before + 1);
		expect(model.scene.itemCount()).toBe(0);
	});

	it('counts per scene as well as per process (RM-002 R-02)', () => {
		// The static total is what an embedder and the S4 exit gate read, and it
		// keeps counting everything. The instance figure is the one that means
		// something when two designs are open - and the one that stops a test
		// having to zero a process-global between cases.
		const first = new Model('/textures/');
		const second = new Model('/textures/');
		const processBefore = Scene.unloadableItemCount;

		first.scene.addItem(1, 'a.js', {itemName: 'A', itemType: 1}, null, 0, null, false);
		first.scene.addItem(1, 'b.js', {itemName: 'B', itemType: 1}, null, 0, null, false);
		second.scene.addItem(1, 'c.js', {itemName: 'C', itemType: 1}, null, 0, null, false);

		expect(first.scene.unloadableItemCount).toBe(2);
		expect(second.scene.unloadableItemCount).toBe(1);
		expect(Scene.unloadableItemCount).toBe(processBefore + 3);
	});

	it('does the same for a formatless item, the branch that set the convention', () => {
		const model = new Model('/textures/');
		const seen = countEvents(model.scene);
		const before = Scene.unloadableItemCount;

		model.scene.addItem(1, 'models/js/retired.js', {itemName: 'Retired', itemType: 1}, null, 0, null, false);

		expect(seen.loading).toBe(1);
		expect(seen.loaded).toBe(1);
		expect(seen.items).toEqual([null]);
		expect(Scene.unloadableItemCount).toBe(before + 1);
	});

	it('leaves the installed loader outside the catch, so item construction still throws', () => {
		// The try covers starting a load, not running the callback. A loader that
		// supplies geometry successfully and then fails to build an Item is a
		// different failure, and the DOM-boundary test above pins it as one - if
		// the catch were any wider it would swallow that and report a null item.
		const model = new Model('/textures/');
		model.scene.setItemLoader((fileName, metadata, onLoad) => {
			onLoad(new three.BufferGeometry(), [new three.MeshBasicMaterial()]);
		});

		expect(() => model.scene.addItem(
			1, 'models/anything.glb',
			{itemName: 'Boom', itemType: 1, format: 'gltf'},
			null, 0, null, false,
		)).toThrow(ReferenceError);
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
		expect(sceneContents(model)).toHaveLength(0);
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
			expect(sceneContents(model)).toContain(item);
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
					// Parented to the storey's group rather than to the scene since
					// RM-010 G1: that group is where the level's base elevation is
					// applied. What the assertion means - "it is in the graph before
					// the event fires" - is unchanged.
					parented: e.item.parent === model.scene.levelGroup(model.level),
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
		expect(sceneContents(model)).toHaveLength(0);
	});
});

describe('Scene container bookkeeping', () => {
	const plainMesh = () => new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial());

	it('add() puts a mesh in the three scene without registering it as an item', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.scene.add(mesh);
		expect(sceneContents(model)).toEqual([mesh]);
		expect(mesh.parent).toBe(model.scene.getScene());
		expect(model.scene.itemCount()).toBe(0);
	});

	it('remove() detaches the mesh from the three scene', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.scene.add(mesh);
		model.scene.remove(mesh);
		expect(sceneContents(model)).toHaveLength(0);
		expect(mesh.parent).toBeNull();
	});

	// QUIRK (scene.js:70-74): remove() is documented "removes a non-item", yet it
	// also strips the mesh from the items array. Anything registered as an item
	// can therefore be de-registered through the non-item path.
	it('remove() also strips the mesh from the items list, despite being the non-item path', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		model.level.items.push(mesh);
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

		model.level.items.push(mesh);
		model.scene.add(mesh);
		model.scene.removeItem(mesh);

		expect(events).toEqual([mesh]);
		expect(removedCalled).toBe(true);
		expect(model.scene.itemCount()).toBe(0);
		expect(sceneContents(model)).toHaveLength(0);
	});

	it('removeItem(item, true) detaches the mesh but keeps it in getItems()', () => {
		const model = new Model('/textures/');
		const mesh = plainMesh();
		mesh.removed = () => {};
		model.level.items.push(mesh);
		model.scene.add(mesh);
		model.scene.removeItem(mesh, true);
		expect(sceneContents(model)).toHaveLength(0);
		expect(model.scene.getItems()).toEqual([mesh]);
	});

	it('clearItems() detaches every item and empties the list', () => {
		const model = new Model('/textures/');
		const meshes = [plainMesh(), plainMesh(), plainMesh()];
		meshes.forEach((m) => { m.removed = () => {}; model.level.items.push(m); model.scene.add(m); });
		model.scene.clearItems();
		expect(model.scene.itemCount()).toBe(0);
		expect(model.scene.getItems()).toEqual([]);
		expect(sceneContents(model)).toHaveLength(0);
	});

	it('clearItems() fires one EVENT_ITEM_REMOVED per item, in insertion order', () => {
		const model = new Model('/textures/');
		const events = [];
		model.scene.addEventListener(EVENT_ITEM_REMOVED, (e) => events.push(e.item.name));
		['a', 'b', 'c'].forEach((name) => {
			const m = plainMesh();
			m.name = name;
			m.removed = () => {};
			model.level.items.push(m);
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
	// the three scene, but removeItem() only removes the item mesh. The helper is
	// orphaned in the scene graph for the rest of the session.
	//
	// S4: the reported type changed from 'LineSegments' to 'BoxHelper' - r98's
	// BoxHelper inherited its type from LineSegments, and r185 sets its own. The
	// leak this test characterizes is unchanged; only the label is.
	it('removeItem() leaks the item BoxHelper into the three scene', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(1, 'a.js', {}, null, 0, null, false);
			const item = model.scene.getItems()[0];
			expect(item.bhelper).toBeInstanceOf(three.BoxHelper);
			expect(item.bhelper.visible).toBe(false);
			expect(sceneContents(model).map((c) => c.type)).toEqual(['Mesh', 'BoxHelper']);

			model.scene.removeItem(item);
			expect(model.scene.itemCount()).toBe(0);
			expect(sceneContents(model).map((c) => c.type)).toEqual(['BoxHelper']);
			expect(sceneContents(model)[0]).toBe(item.bhelper);
		});
	});

	it('Model.switchWireframe forwards the flag to every item', () => {
		const model = new Model('/textures/');
		const calls = [];
		model.level.items.push({switchWireframe: (flag) => calls.push(['a', flag])});
		model.level.items.push({switchWireframe: (flag) => calls.push(['b', flag])});
		model.switchWireframe(true);
		expect(calls).toEqual([['a', true], ['b', true]]);
	});
});

describe('Item.getMetaData - the save-file item contract', () => {
	/*
	 * material_colors became sparse in save format 2.0.0. It used to hold every
	 * material's colour on every save, which is what turned "what this model
	 * looks like" into persisted user data and why pre-S8 furniture reloads too
	 * dark - the value came from baseColorFactor, a raw linear float, and the
	 * managed pipeline reads it as sRGB. It now holds a hex string only where
	 * somebody actually picked one, null elsewhere, and is omitted entirely when
	 * nothing was picked.
	 */
	// `id` is new in RM-003 A3 and is additive: an item carries a stable identity
	// so undo can recognise the furniture it already has instead of re-fetching
	// every model. A file written before A3 has none and is assigned one on load.
	it('emits thirteen keys and no material_colors when nothing was recoloured', () => {
		const md = Item.prototype.getMetaData.call(metaDataSource());
		expect(Object.keys(md)).toEqual([
			'id',
			'item_name', 'item_type', 'format', 'model_url',
			'xpos', 'ypos', 'zpos',
			'rotation',
			'scale_x', 'scale_y', 'scale_z',
			'fixed',
		]);
		expect('material_colors' in md).toBe(false);
	});

	it('adds material_colors as the fourteenth key once a colour is picked', () => {
		const md = Item.prototype.getMetaData.call(metaDataSource({_pickedColorSlots: new Set([0])}));
		expect(Object.keys(md)).toEqual([
			'id',
			'item_name', 'item_type', 'format', 'model_url',
			'xpos', 'ypos', 'zpos',
			'rotation',
			'scale_x', 'scale_y', 'scale_z',
			'fixed',
			'material_colors',
		]);
	});

	it('maps metadata, position, rotation.y, scale and fixed onto those keys', () => {
		const md = Item.prototype.getMetaData.call(metaDataSource({_pickedColorSlots: new Set([0])}));
		expect(md).toEqual({
			id: md.id,
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

	// QUIRK (item.js): metadata.resizable is read by Model.newRoom on load but
	// getMetaData never writes it back, so it is dropped on every save. Harmless
	// today - nothing reads it after construction.
	it('drops metadata.resizable - it survives a load but never a save', () => {
		const source = metaDataSource();
		expect(source.metadata.resizable).toBe(true);
		const md = Item.prototype.getMetaData.call(source);
		expect('resizable' in md).toBe(false);
	});

	it('reads the colour off the live material, not off metadata.materialColors', () => {
		const source = metaDataSource({
			material: new three.MeshBasicMaterial({color: 0x00ff00}),
			_pickedColorSlots: new Set([0]),
		});
		source.metadata.materialColors = ['#ff0000'];
		const md = Item.prototype.getMetaData.call(source);
		expect(md.material_colors).toEqual(['#00ff00']);
	});

	it('writes null for the slots nobody touched', () => {
		// The sparse form. Only slot 1 was picked, so slots 0 and 2 keep whatever
		// the model shipped with and the file says so rather than freezing them.
		const source = metaDataSource({
			material: [
				new three.MeshBasicMaterial({color: 0xff0000}),
				new three.MeshBasicMaterial({color: 0x00ff00}),
				new three.MeshBasicMaterial({color: 0xabcdef}),
			],
			_pickedColorSlots: new Set([1]),
		});
		const md = Item.prototype.getMetaData.call(source);
		expect(md.material_colors).toEqual([null, '#00ff00', null]);
	});

	it('emits one lowercase #rrggbb entry per material when every slot was picked', () => {
		const source = metaDataSource({
			material: [
				new three.MeshBasicMaterial({color: 0xff0000}),
				new three.MeshBasicMaterial({color: 0x00ff00}),
				new three.MeshBasicMaterial({color: 0xabcdef}),
			],
			_pickedColorSlots: new Set([0, 1, 2]),
		});
		const md = Item.prototype.getMetaData.call(source);
		expect(md.material_colors).toEqual(['#ff0000', '#00ff00', '#abcdef']);
	});

	// This used to throw a TypeError. `this.material.length` is 0 - falsy - for an
	// empty material array, so the old code took the single-material branch and
	// dereferenced `[].color`. Saving no longer reaches the materials at all
	// unless something was picked, so the common case is simply safe now.
	it('does not throw on an empty material array when nothing was picked', () => {
		const source = metaDataSource({material: []});
		expect(() => Item.prototype.getMetaData.call(source)).not.toThrow();
		expect('material_colors' in Item.prototype.getMetaData.call(source)).toBe(false);
	});

	it('still throws on an empty material array if a slot claims to be picked', () => {
		// Unreachable in practice - setMaterialColor is what fills the set, and it
		// would have thrown first. Pinned so the branch is not mistaken for dead.
		const source = metaDataSource({material: [], _pickedColorSlots: new Set([0])});
		expect(() => Item.prototype.getMetaData.call(source)).toThrow(TypeError);
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
		// `id` goes the same way as the other absent fields: this source has no
		// designId, so the key is emitted as undefined and JSON drops it. A real
		// Item always has one.
		expect(Object.keys(JSON.parse(JSON.stringify(md)))).toEqual([
			'item_name', 'item_type', 'xpos', 'ypos', 'zpos',
			'rotation', 'scale_x', 'scale_y', 'scale_z', 'fixed',
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
		model.level.items.push(stale);
		model.scene.add(stale);

		model.loadSerialized(JSON.stringify(makeDesign([])));

		expect(model.scene.itemCount()).toBe(0);
		expect(sceneContents(model)).toHaveLength(0);
	});

	// RETIRED QUIRK (RM-003 A1). This used to read "throws on a design with no
	// items array, after EVENT_LOADING and after replacing the floorplan", and it
	// asserted exactly that: a TypeError, EVENT_LOADING already dispatched, and
	// the floorplan already replaced - the model left half-loaded with no
	// EVENT_LOADED and the previous design gone.
	//
	// That is the defect A1 exists to remove, so the expectation is retired rather
	// than the change re-checked. What replaces it is the opposite claim.
	it('rejects a design with no items array without touching the one that is open', () => {
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify(makeDesign([])));
		const before = model.exportSerialized();

		const events = [];
		model.addEventListener(EVENT_LOADING, (e) => events.push(e.type));
		model.addEventListener(EVENT_LOADED, (e) => events.push(e.type));

		const design = makeDesign([]);
		delete design.items;

		// Still throws, because callers already catch and a function that quietly
		// stops reporting failure is a worse change than one that keeps reporting
		// it. The message now names the field instead of being whichever TypeError
		// the mutation happened to hit first.
		expect(() => model.loadSerialized(JSON.stringify(design))).toThrow(/items/);
		// And no EVENT_LOADING: nothing started, so saying it did would leave a
		// listener that shows a spinner on LOADING and hides it on LOADED spinning.
		expect(events).toEqual([]);
		expect(model.exportSerialized()).toBe(before);
		expect(model.floorplan.getWalls()).toHaveLength(4);
	});
});

describe('Model.exportSerialized', () => {
	it('emits {floorplan, items} with one getMetaData object per scene item', () => {
		const model = new Model('/textures/');
		model.level.items.push({getMetaData: () => ({item_name: 'A', item_type: 1})});
		model.level.items.push({getMetaData: () => ({item_name: 'B', item_type: 7})});

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
	/** A loader that supplies three materials, for the multi-material paths. */
	function threeMaterialLoader()
	{
		return (fileName, metadata, onLoad) => {
			onLoad(new three.BoxGeometry(50, 50, 50), [
				new three.MeshBasicMaterial({color: 0x111111}),
				new three.MeshBasicMaterial({color: 0x222222}),
				new three.MeshBasicMaterial({color: 0x333333}),
			]);
		};
	}

	it('loses nothing from a v1 item that carried a colour in every slot', () => {
		// The compatibility guarantee for material_colors. A 0.0.2a file wrote
		// every material's colour whether or not anyone chose it; those values are
		// applied and written straight back, so opening and saving an old design
		// cannot quietly discard a colour somebody did choose. There is no way to
		// tell the two apart inside such a file, so nothing is thrown away.
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(threeMaterialLoader());
			model.loadSerialized(JSON.stringify(makeDesign([
				Object.assign({}, SOFA, {material_colors: ['#ff0000', '#00ff00', '#0000ff']}),
			])));

			const out = JSON.parse(model.exportSerialized());
			expect(out.items[0].material_colors).toEqual(['#ff0000', '#00ff00', '#0000ff']);
		});
	});

	it('writes no material_colors for an item nobody recoloured', () => {
		// The common case, and the one that used to freeze the model's own
		// appearance into the file. The key is absent, so the item renders with
		// whatever the model ships with next time - including after the model
		// itself is updated.
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(threeMaterialLoader());
			const item = Object.assign({}, SOFA);
			delete item.material_colors;
			model.loadSerialized(JSON.stringify(makeDesign([item])));

			const out = JSON.parse(model.exportSerialized());
			expect('material_colors' in out.items[0]).toBe(false);
		});
	});

	it('writes only the slot that was recoloured, and reloads it', () => {
		const model = new Model('/textures/');
		withFakeFactory(() => {
			model.scene.setItemLoader(threeMaterialLoader());
			const item = Object.assign({}, SOFA);
			delete item.material_colors;
			model.loadSerialized(JSON.stringify(makeDesign([item])));

			Item.prototype.setMaterialColor.call(model.scene.getItems()[0], '#abcdef', 1);

			const out = JSON.parse(model.exportSerialized());
			expect(out.items[0].material_colors).toEqual([null, '#abcdef', null]);

			// And the null slots do not overwrite the model's own colours on the
			// way back in.
			const reloaded = new Model('/textures/');
			reloaded.scene.setItemLoader(threeMaterialLoader());
			reloaded.loadSerialized(JSON.stringify(out));
			const materials = reloaded.scene.getItems()[0].material;
			expect('#' + materials[0].color.getHexString()).toBe('#111111');
			expect('#' + materials[1].color.getHexString()).toBe('#abcdef');
			expect('#' + materials[2].color.getHexString()).toBe('#333333');
		});
	});

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

/**
 * RoofItem threw on a design with no rooms, and the checker had already said so.
 *
 * Two of the library's 355 type errors sat on one line of
 * `items/roof_item.js` - TS18047 for `result` and again for
 * `result.closestPoint`. `result` is only ever assigned inside a loop over
 * `floorplan.roofPlanes()`, which pushes one plane per room, so an empty
 * floorplan left it null and the line dereferenced it.
 *
 * Not a corner of the API: `RoofItem`'s constructor calls
 * `closestCeilingPoint()` (`roof_item.js:24`), so adding a ceiling item before
 * drawing a room was a TypeError, and that is the state every design starts in.
 *
 * Constructed rather than found. No fixture has a design with no rooms and a
 * ceiling item, which is exactly why nothing caught it - the crash needs the
 * emptiest possible document, and every fixture is a real one.
 */
describe('RoofItem on a design with no ceiling (RM-005 C2, J-5)', () =>
{
	/**
	 * The two things `closestCeilingPoint` reads off `this`.
	 *
	 * `floorplan` rather than `model.floorplan` since RM-010 G1: an item asks its
	 * own storey's plan, through an `Item.prototype` getter, because reading
	 * `model.floorplan` would ask whichever storey the user is looking at. A
	 * duck-typed stand-in has no prototype, so it states the resolved value - and
	 * the getter's own fallback is pinned separately below.
	 */
	const withRoofs = (planes) => ({
		floorplan: {roofPlanes: () => planes},
		position: new three.Vector3(10, 20, 30),
	});

	/**
	 * The getter itself: an item's own storey, falling back to the active one.
	 *
	 * The fallback is not a nicety - `Item`'s constructor runs before
	 * `Scene.addItem` can assign a level, and every item a test builds by hand
	 * has none. Before there were storeys the two were always the same object, so
	 * the fallback is exactly the old behaviour.
	 */
	it('asks its own storey for a floorplan, and the active one when it has none', () =>
	{
		const active = {name: 'active'};
		const mine = {name: 'mine'};
		const unplaced = {model: {floorplan: active}, level: null};
		const placed = {model: {floorplan: active}, level: {floorplan: mine}};

		const read = Object.getOwnPropertyDescriptor(Item.prototype, 'floorplan').get;
		expect(read.call(unplaced)).toBe(active);
		expect(read.call(placed)).toBe(mine);
	});

	it('does not throw when the floorplan has no rooms', () =>
	{
		const item = withRoofs([]);
		expect(() => RoofItem.prototype.closestCeilingPoint.call(item)).not.toThrow();
	});

	it('stays where it is, which is the honest answer when there is no ceiling', () =>
	{
		// `moveToPosition` with the current position is a no-op, so the item lands
		// where it was placed and the user moves it - the same answer
		// `FloorItem.isValidPosition` gives when it cannot find a room to be in.
		const item = withRoofs([]);
		const where = RoofItem.prototype.closestCeilingPoint.call(item);

		expect(where).toBeInstanceOf(three.Vector3);
		expect([where.x, where.y, where.z]).toEqual([10, 20, 30]);
		// A copy, not the live position: the caller passes it to moveToPosition,
		// which would otherwise be handed the vector it is about to overwrite.
		expect(where).not.toBe(item.position);
	});

	it('has a sibling in WallItem, found the same way', () =>
	{
		// `WallItem.closestWallEdge()` returns null when `wallEdges()` is empty -
		// the loop never runs and there is nothing to be nearest to - and
		// `placeInRoom` handed it straight to `changeWallEdge`, which dereferences
		// it on its first line. Adding a wall item before drawing a wall.
		//
		// Same shape as J-5, named by the same checker, and neither had a test
		// because no fixture is empty enough to hit either.
		const item = {
			// `floorplan` rather than `model.floorplan`, for the reason above.
			floorplan: {wallEdges: () => []},
			position: new three.Vector3(1, 2, 3),
			position_set: false,
			closestWallEdge: WallItem.prototype.closestWallEdge,
			// Present so a regression fails LOUDLY rather than by another missing
			// method: if placeInRoom stops guarding, it reaches this and throws on
			// `wallEdge.wall`, which is the original defect.
			changeWallEdge: WallItem.prototype.changeWallEdge,
		};
		expect(WallItem.prototype.closestWallEdge.call(item)).toBe(null);
		expect(() => WallItem.prototype.placeInRoom.call(item)).not.toThrow();
	});

	it('still prefers a real ceiling when there is one', () =>
	{
		// The fix must not have turned the normal path into the fallback. One roof
		// that contains the point, so the loop assigns and the guard is not reached.
		const item = withRoofs([{}]);
		item.floorplan.roofPlanes = () => [{}];
		const contained = {distance: 5, contains: true, point: new three.Vector3(1, 2, 3), closestPoint: new three.Vector3(9, 9, 9)};
		const stub = {...item, roofContainsPoint: () => contained};

		const where = RoofItem.prototype.closestCeilingPoint.call(stub);
		expect([where.x, where.y, where.z]).toEqual([1, 2, 3]);
	});
});

/**
 * Mirror, and the two things a negative scale must not break (RM-012 J4).
 *
 * RM-007 calls mirror one of the three cheap verbs and names its risk: *"a
 * mirrored mesh renders inside out unless the material's side is handled"*.
 * Measured against the three in this tree, that is already handled and not by
 * us - `WebGLRenderer` computes `frontFaceCW` from
 * `matrixWorld.determinantAffine() < 0` and flips the winding for exactly this
 * case. So the material's `side` is deliberately not touched, and these assert
 * that it is not: 139 of the 168 catalog models are `KHR_materials_unlit`, and
 * forcing `DoubleSide` on all of them to fix a problem that does not exist
 * would change how every one of them renders.
 *
 * What a negative scale *would* have broken is the item's size, which is the
 * part worth a suite. `halfSize` feeds `getWidth`, the two dimension canvases,
 * the plan's footprint projection and `Edge.createShape` - which pushes a
 * rectangle of it into the wall's holes. A mirrored door with a negative half
 * width cuts a hole of negative width and nothing says so.
 */
describe('a group and an elevation are additive keys (RM-012 J4)', () =>
{
	/** The real `getMetaData`, over the minimum state it reads. */
	function record(extra)
	{
		var item = Object.assign(Object.create(Item.prototype), {
			_pickedColorSlots: new Set(),
			designId: 'x',
			metadata: {itemName: 'N', itemType: 1, format: 'glb', modelUrl: 'm.glb'},
			position: {x: 0, y: 0, z: 0},
			rotation: {y: 0},
			scale: {x: 1, y: 1, z: 1},
			fixed: false,
			lamp: null,
			groupId: null,
		}, extra || {});
		return item.getMetaData();
	}

	it('writes no group key for an item nobody grouped', () =>
	{
		// The rule every key added since E2 follows: a design of ungrouped chairs
		// re-saves byte-identical to the file it was before this sprint.
		expect(Object.keys(record())).not.toContain('group');
	});

	it('writes one when there is one', () =>
	{
		expect(record({groupId: 'g:1'}).group).toBe('g:1');
	});

	it('needs no key at all for elevation, which is why RM-007 called it cheap', () =>
	{
		// `ypos` has been in the save format since the format existed. What was
		// missing was any way to set it, not anywhere to put it.
		expect(record({position: {x: 0, y: 45, z: 0}}).ypos).toBe(45);
	});

	it('clamps an elevation at the floor', () =>
	{
		var item = Object.assign(Object.create(Item.prototype), {
			position: {x: 0, y: 10, z: 0},
			bhelper: null,
			scene: {needsUpdate: false},
			resized() {},
		});
		Item.prototype.setElevation.call(item, 60);
		expect(item.position.y).toBe(60);
		// A floor plan has no basement, and a negative would put furniture under
		// the floor where it cannot be clicked.
		Item.prototype.setElevation.call(item, -5);
		expect(item.position.y).toBe(0);
	});
});

describe('Item.mirror, and the sign that must not reach the size', () =>
{
	/** The minimum of an Item that `mirror` and `applyScale` actually touch. */
	function mirrorable(scale)
	{
		return {
			scale: new three.Vector3(scale ? scale.x : 1, scale ? scale.y : 1, scale ? scale.z : 1),
			halfSize: new three.Vector3(25, 50, 10),
			bhelper: null,
			scene: {needsUpdate: false},
			objectHalfSize() { return new three.Vector3(25, 50, 10); },
			resized() {},
			updateCanvasTexture() {},
			getWidth() { return this.halfSize.x * 2; },
			getHeight() { return this.halfSize.y * 2; },
			getDepth() { return this.halfSize.z * 2; },
			applyScale: Item.prototype.applyScale,
			mirror: Item.prototype.mirror,
			mirrored: Item.prototype.mirrored,
		};
	}

	it('negates one axis of the scale and nothing else', () =>
	{
		const item = mirrorable();
		expect(item.mirror('x')).toBe(true);
		expect([item.scale.x, item.scale.y, item.scale.z]).toEqual([-1, 1, 1]);

		expect(item.mirror('z')).toBe(false);
		// Two negated axes are a 180-degree rotation, not a reflection - which is
		// what the sign of the product says and what the renderer tests.
		expect([item.scale.x, item.scale.y, item.scale.z]).toEqual([-1, 1, -1]);
		expect(item.mirrored()).toBe(false);
	});

	it('defaults to the left-to-right flip, which is the one people mean', () =>
	{
		const item = mirrorable();
		item.mirror();
		expect(item.scale.x).toBe(-1);
		expect(item.scale.z).toBe(1);
	});

	it('leaves the size positive, which is what Edge.createShape reads', () =>
	{
		// The assertion this whole describe exists for. A negative half width
		// would cut a wall hole of negative width and nothing would report it.
		const item = mirrorable();
		item.mirror('x');
		expect(item.halfSize.x).toBe(25);
		expect(item.getWidth()).toBe(50);
		expect(item.getDepth()).toBe(20);
	});

	it('keeps it positive through a resize on top of a mirror', () =>
	{
		// The composition that would drift if the half size were accumulated
		// rather than restated from the geometry each time.
		const item = mirrorable();
		item.mirror('x');
		item.applyScale(-2, 1, 1);
		expect(item.scale.x).toBe(-2);
		expect(item.halfSize.x).toBe(50);
		expect(item.getWidth()).toBe(100);
	});

	it('comes back unmirrored, exactly, rather than to a near miss', () =>
	{
		// `applyScale` is the absolute form for the reason its own note gives:
		// expressing "back to 1" as a relative factor produces 0.9999999999999999,
		// which serialises differently and makes an undo differ from what it
		// restored. Mirroring twice must not do that either.
		const item = mirrorable();
		item.mirror('x');
		item.mirror('x');
		expect(item.scale.x).toBe(1);
		expect(item.mirrored()).toBe(false);
		expect(item.halfSize.x).toBe(25);
	});

	it('is what the renderer already keys off, so no material is touched', () =>
	{
		// The measurement behind not setting `side`. three flips the winding when
		// the world matrix determinant is negative; a mirrored item's is.
		const mesh = new three.Mesh(new three.BoxGeometry(1, 1, 1), new three.MeshBasicMaterial());
		const before = mesh.material.side;
		mesh.scale.set(-1, 1, 1);
		mesh.updateMatrixWorld(true);
		expect(mesh.matrixWorld.determinant()).toBeLessThan(0);
		expect(mesh.material.side, 'mirroring must not change how 139 unlit models render')
			.toBe(before);
	});
});

describe('Item.resize, the inspector\'s path', () =>
{
	/**
	 * Tested directly because it lost its incidental cover.
	 *
	 * `initObject` used to call this - it was how the x300 hack applied itself -
	 * and every test that built an item exercised it on the way past. RM-012 J1
	 * replaced that call with `applyUnitScale`, which does not go through here,
	 * so the only caller left is `ItemInspector`'s width/height/depth fields and
	 * the inspector's own tests stub the method out. A public method somebody
	 * types into three times a minute is not a method to leave uncovered because
	 * a different change happened to stop calling it.
	 */
	function resizable(proportional)
	{
		return {
			resizeProportionally: proportional,
			halfSize: new three.Vector3(25, 50, 10),
			applied: null,
			getWidth() { return this.halfSize.x * 2; },
			getHeight() { return this.halfSize.y * 2; },
			getDepth() { return this.halfSize.z * 2; },
			setScale(x, y, z) { this.applied = [x, y, z]; },
		};
	}

	it('scales each axis independently when proportion is off', () =>
	{
		const item = resizable(false);
		Item.prototype.resize.call(item, 200, 100, 40);
		expect(item.applied).toEqual([2, 2, 2]);

		Item.prototype.resize.call(item, 50, 100, 10);
		expect(item.applied).toEqual([2, 0.5, 0.5]);
	});

	it('follows whichever dimension the person actually changed when it is on', () =>
	{
		// Width first, then height, then depth - the order the real method checks,
		// and the reason it checks in an order at all: the inspector sends all
		// three fields on every edit and only one of them differs.
		const item = resizable(true);
		Item.prototype.resize.call(item, 100, 100, 20);
		expect(item.applied, 'width changed, so width wins').toEqual([2, 2, 2]);

		Item.prototype.resize.call(item, 200, 50, 20);
		expect(item.applied, 'width unchanged, so height wins').toEqual([2, 2, 2]);

		Item.prototype.resize.call(item, 100, 50, 40);
		expect(item.applied, 'neither, so depth wins').toEqual([2, 2, 2]);
	});

	it('treats a change under a tenth of a centimetre as no change', () =>
	{
		// The tolerance is the demo's and is kept: a field that round-trips
		// 49.99999 must not be read as a resize.
		const item = resizable(true);
		Item.prototype.resize.call(item, 100.05, 50.05, 20.05);
		expect(item.applied, 'the depth branch, because neither of the first two moved')
			.toEqual([1.0025, 1.0025, 1.0025]);
	});
});

describe('the unit scale replaces the x300 hack (RM-012 J1, RM-009 U-3)', () =>
{
	/** A minimal stand-in with just what `applyUnitScale` reads and writes. */
	function placed(metadata, fromDocument)
	{
		return {
			metadata: metadata,
			_scaleFromDocument: Boolean(fromDocument),
			scale: new three.Vector3(1, 1, 1),
			applied: null,
			setScale(x, y, z) { this.applied = [x, y, z]; },
		};
	}

	it('scales a kit model by the number its kit declares', () =>
	{
		// 200, because the Kenney kit is on a 2 m grid. Under the hack this was
		// 300, which makes that kit's dining chair 141 cm tall.
		const item = placed({unitScale: 200});
		Item.prototype.applyUnitScale.call(item);
		expect(item.applied).toEqual([200, 200, 200]);
	});

	it('leaves a model already in centimetres alone', () =>
	{
		// The 25 demo models and two Blender exports. The old test - one axis of
		// the half-extent under 1.0 - answered a question about units by measuring
		// a shape, so a wide flat rug in centimetres passed and a tall thin lamp in
		// kit units failed. A declared 1 cannot be ambiguous.
		const item = placed({unitScale: 1});
		Item.prototype.applyUnitScale.call(item);
		expect(item.applied).toBeNull();
	});

	it('leaves a restored item alone, whatever its kit says', () =>
	{
		// A document records an absolute scale, so an item built from one is
		// already the size it was saved at. Applying the kit's factor again would
		// multiply it by 200 on every open - which is the one way this change could
		// have damaged a file somebody has.
		const item = placed({unitScale: 200}, true);
		Item.prototype.applyUnitScale.call(item);
		expect(item.applied).toBeNull();
	});

	it('does nothing at all for metadata that has no scale', () =>
	{
		// A parametric opening, stair or column builds its mesh from its own
		// numbers and is already in centimetres; so is anything an embedder adds
		// through the library without a catalog behind it.
		// `null` metadata included: `Item` always has some, but this method is also
		// reachable through `initObject` on a subclass a test or an embedder built
		// by hand, and a missing scale is not a reason to throw.
		[{}, null, {unitScale: null}, {unitScale: 0}, {unitScale: -5}].forEach((metadata) =>
		{
			const item = placed(metadata);
			Item.prototype.applyUnitScale.call(item);
			expect(item.applied, JSON.stringify(metadata)).toBeNull();
		});
	});

	it('runs inside initObject, on a fresh item and not on a restored one', () =>
	{
		// Through the real initObject and the real Scene.addItem, so the wiring is
		// asserted and not only the arithmetic. `useCatalog.addItem` is what puts
		// `unitScale` on the metadata; a restored item gets a scale instead.
		const model = new Model('/textures/');
		withFakeFactory(() =>
		{
			model.scene.setItemLoader(boxLoader());
			model.scene.addItem(1, 'a.glb', {unitScale: 200}, null, 0, null, false);
			model.scene.addItem(1, 'b.glb', {unitScale: 200}, null, 0,
				new three.Vector3(300, 300, 300), false);

			const [fresh, restored] = model.scene.getItems();
			expect([fresh.scale.x, fresh.scale.y, fresh.scale.z]).toEqual([200, 200, 200]);
			expect(fresh.halfSize.x).toBe(25 * 200);
			expect([restored.scale.x, restored.scale.y, restored.scale.z]).toEqual([300, 300, 300]);
		});
	});
});
