// @vitest-environment jsdom
/**
 * A model that came off somebody's disk (RM-012 J3, finding X-7).
 *
 * X-7 measured that this sprint writes no loader: `Scene` already constructs
 * `GLTFLoader`, `OBJLoader`, `DRACOLoader` and `KTX2Loader`, so every format
 * RM-007 names already has a reader in the bundle. What it had nowhere to put
 * was the bytes. This file is the library half of what J3 added - a byte store
 * `Scene` asks before the asset manifest, one additive key on an item, and the
 * change of basis that key exists for.
 *
 * ## What is checked with real bytes, and why it has to be
 *
 * `measureModel` and the import branch of `addItem` run against
 * `public/models/gltf/bear.glb`, a real file this repository ships, parsed by
 * the real `GLTFLoader`. A stub would be asserting that a fake returned what it
 * was told to return - the failure mode RM-012 J4 found when
 * `duplicateSelected`'s test agreed with the caller's wish instead of with the
 * data, and RM-013 K1 found again when a bounds walk written beside three.js
 * disagreed with it on 4 of 15 rows.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {BufferAttribute, BufferGeometry, BoxGeometry, MeshBasicMaterial, Vector3} from 'three';

import {LocalModels, normaliseImport, orientGeometry, UP_Y, UP_Z}
	from '../src/scripts/core/imported_model.js';
import {AssetManifest} from '../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../src/scripts/core/asset_resolver.js';
import {DesignRuntime} from '../src/scripts/core/design_runtime.js';
import {Model, metadataFromRecord} from '../src/scripts/model/model.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {FloorItem} from '../src/scripts/items/floor_item.js';
import {EVENT_ITEM_LOADED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

/** A real GLB with no Draco and no textures, so a headless parse is honest. */
const BEAR = 'public/models/gltf/bear.glb';

/**
 * A file as an `ArrayBuffer` from *this* realm.
 *
 * Copied rather than sliced out of the Buffer, and the reason is a jsdom
 * artefact worth writing down rather than working around silently: vitest's
 * jsdom environment installs jsdom's globals, so `globalThis.ArrayBuffer` - the
 * one `GLTFLoader` tests against with `data instanceof ArrayBuffer` - is not the
 * one `readFileSync().buffer` produces. The check fails, the loader treats the
 * buffer as an already-parsed glTF object, and the error it eventually raises
 * says the asset version is unsupported.
 *
 * It cannot arise anywhere real. A browser has one realm, so a `FileReader`
 * result and an IndexedDB read are both the same `ArrayBuffer` the loader knows.
 * The copy is here, in the fixture reader, and not in `_parseModel`, because
 * defending production code against a test environment's realm split would cost
 * a copy of every model on every load to fix nothing.
 *
 * @returns {ArrayBuffer}
 */
function bytesOf(path)
{
	const buffer = readFileSync(join(process.cwd(), path));
	const bytes = new ArrayBuffer(buffer.byteLength);
	new Uint8Array(bytes).set(buffer);
	return bytes;
}

let restoreCanvas;

beforeEach(() =>
{
	resetAll();
	restoreCanvas = installCanvas2D(window).restore;
});

afterEach(() =>
{
	if (restoreCanvas) { restoreCanvas(); }
});

describe('the reference a design writes', () =>
{
	it('needs an id and nothing else, and defaults the rest', () =>
	{
		expect(normaliseImport({id: 'abc'})).toEqual({id: 'abc', file: 'abc', up: UP_Y});
		expect(normaliseImport({id: 'abc', file: 'chair.glb', up: UP_Z}))
			.toEqual({id: 'abc', file: 'chair.glb', up: UP_Z});
	});

	it('is null for everything that is not one', () =>
	{
		[null, undefined, {}, {id: ''}, {id: 7}, 'abc', []].forEach((value) =>
		{
			expect(normaliseImport(value)).toBeNull();
		});
	});

	it('falls back to the id for the filename, because the sentence still has to work', () =>
	{
		// The only field here that exists purely to be read out loud. A design
		// opened where the store is empty has to be able to name what is missing,
		// and the store is the thing that is missing.
		expect(normaliseImport({id: '6f3a91c2'}).file).toBe('6f3a91c2');
	});

	it('treats an axis it does not know as Y, which is what three assumes', () =>
	{
		expect(normaliseImport({id: 'a', up: 'x'}).up).toBe(UP_Y);
		expect(normaliseImport({id: 'a', up: 'Z'}).up).toBe(UP_Y);
	});
});

describe('the change of basis', () =>
{
	/** @returns {BufferGeometry} */
	function pointAt(x, y, z)
	{
		const geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(new Float32Array([x, y, z]), 3));
		return geometry;
	}

	it('maps (x, y, z) to (x, z, -y), which is Z-up to Y-up', () =>
	{
		const geometry = pointAt(1, 2, 3);
		expect(orientGeometry(geometry, UP_Z)).toBe(true);
		const position = geometry.getAttribute('position');
		expect(position.getX(0)).toBeCloseTo(1, 6);
		expect(position.getY(0)).toBeCloseTo(3, 6);
		expect(position.getZ(0)).toBeCloseTo(-2, 6);
	});

	it('does nothing at all for Y-up, so a catalog model is untouched', () =>
	{
		const geometry = pointAt(1, 2, 3);
		expect(orientGeometry(geometry, UP_Y)).toBe(false);
		expect(orientGeometry(geometry, null)).toBe(false);
		const position = geometry.getAttribute('position');
		expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([1, 2, 3]);
	});

	it('refuses anything that is not a geometry rather than throwing', () =>
	{
		expect(orientGeometry(null, UP_Z)).toBe(false);
		expect(orientGeometry({}, UP_Z)).toBe(false);
	});
});

describe('the byte store the library ships', () =>
{
	it('answers has() without waiting, which is what Scene needs', () =>
	{
		const store = new LocalModels();
		const bytes = new ArrayBuffer(8);
		expect(store.has('local/a.glb')).toBe(false);
		store.set('local/a.glb', bytes);
		// Synchronous on purpose: `addItem` decides between the import branch and
		// the asset manifest before it starts anything.
		expect(store.has('local/a.glb')).toBe(true);
		expect(store.read('local/a.glb')).toBe(bytes);
		expect(store.names()).toEqual(['local/a.glb']);
		expect(store.count).toBe(1);
	});

	it('returns null rather than undefined for a name it does not have', () =>
	{
		expect(new LocalModels().read('nope')).toBeNull();
	});

	it('forgets on demand', () =>
	{
		const store = new LocalModels();
		store.set('a', new ArrayBuffer(1));
		store.set('b', new ArrayBuffer(1));
		expect(store.delete('a')).toBe(true);
		expect(store.count).toBe(1);
		store.clear();
		expect(store.count).toBe(0);
	});

	it('is on every runtime, empty, so Scene can ask unconditionally', () =>
	{
		expect(new DesignRuntime().localModels.has('anything')).toBe(false);
	});

	it('is the one that was handed in, when one was', () =>
	{
		const mine = new LocalModels();
		expect(new DesignRuntime({localModels: mine}).localModels).toBe(mine);
	});
});

describe('the item, and the one key it adds to the save format', () =>
{
	/**
	 * A `FloorItem` built directly, the way `tests/lamps.test.js` builds one.
	 *
	 * @param {Object} metadata
	 * @param {BufferGeometry} [geometry]
	 */
	function buildItem(metadata, geometry)
	{
		const model = new Model('models/textures/');
		return new FloorItem(model, metadata, geometry || new BoxGeometry(10, 20, 40),
			new MeshBasicMaterial(), new Vector3(0, 0, 0), 0, null);
	}

	it('writes no local key for an item nobody imported', () =>
	{
		const item = buildItem({itemName: 'chair', itemType: 1, modelUrl: 'models/chair.glb', format: 'gltf'});
		// Byte-identical to the record this build wrote before J3, which is what
		// "additive and conditional" has to mean for the sixth key running.
		expect(Object.prototype.hasOwnProperty.call(item.getMetaData(), 'local')).toBe(false);
		expect(item.local).toBeNull();
	});

	it('writes the reference back out for one that was imported', () =>
	{
		const item = buildItem({
			itemName: 'chair.glb', itemType: 1, modelUrl: 'local/abc123.glb', format: 'gltf',
			local: {id: 'abc123', file: 'chair.glb', up: UP_Z},
		});
		expect(item.getMetaData().local).toEqual({id: 'abc123', file: 'chair.glb', up: UP_Z});
	});

	it('stands a Z-up model up before anything measures it', () =>
	{
		// 10 wide, 20 along Y, 40 along Z in the file. Read as Z-up, the 40 is the
		// height and the 20 is the depth - and the item has to be that size NOW,
		// because the label planes and the resize handles are built from these
		// three numbers in the constructor.
		const upright = buildItem({itemName: 'a', itemType: 1, modelUrl: 'local/a.glb'});
		expect([upright.getWidth(), upright.getHeight(), upright.getDepth()]).toEqual([10, 20, 40]);

		const laid = buildItem({
			itemName: 'a', itemType: 1, modelUrl: 'local/a.glb',
			local: {id: 'a', file: 'a.glb', up: UP_Z},
		});
		expect([laid.getWidth(), laid.getHeight(), laid.getDepth()]).toEqual([10, 40, 20]);
	});

	it('leaves the object untilted, because rotation.y is all a save file carries', () =>
	{
		const laid = buildItem({
			itemName: 'a', itemType: 1, modelUrl: 'local/a.glb',
			local: {id: 'a', file: 'a.glb', up: UP_Z},
		});
		// The whole argument for rotating the buffer rather than the object: this
		// is the only rotation `getMetaData` writes, so a tilt here would be gone
		// on the next save and the item would be the wrong size until then.
		expect(laid.rotation.x).toBe(0);
		expect(laid.rotation.z).toBe(0);
		expect(laid.getMetaData().rotation).toBe(0);
	});

	it('reaches an item from a saved record, through the one translation', () =>
	{
		const record = {item_type: 1, model_url: 'local/abc.glb', item_name: 'chair.glb',
			local: {id: 'abc', file: 'chair.glb', up: UP_Z}};
		// `metadataFromRecord` is the single hop between the save shape and the
		// constructor shape (RM-012 J4). A key that stops here never reaches an
		// item, which is how `duplicateSelected` came to be broken for two
		// programmes.
		expect(metadataFromRecord(record).local).toEqual({id: 'abc', file: 'chair.glb', up: UP_Z});
	});
});

describe('the document, and what it refuses', () =>
{
	/** @param {Array<Object>} items */
	function design(items)
	{
		return JSON.stringify({floorplan: {corners: {}, walls: [], rooms: {}}, items: items});
	}

	it('opens a design naming a model this computer has never seen', () =>
	{
		// The second acceptance clause, stated as a validation rule. Refusing here
		// would make somebody else's design unopenable, which is the failure the
		// clause is written against.
		const result = DesignDocument.parse(design([
			{item_type: 1, model_url: 'local/abc.glb', xpos: 0, ypos: 0, zpos: 0,
				local: {id: 'abc', file: 'chair.glb', up: 'z'}},
		]));
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it('refuses a reference with nothing to look up', () =>
	{
		const result = DesignDocument.parse(design([
			{item_type: 1, model_url: 'local/abc.glb', local: {file: 'chair.glb'}},
		]));
		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('items[0].local.id');
	});

	it('refuses a reference that is not an object', () =>
	{
		const result = DesignDocument.parse(design([
			{item_type: 1, model_url: 'local/abc.glb', local: 'abc'},
		]));
		expect(result.ok).toBe(false);
		expect(result.errors[0].path).toBe('items[0].local');
	});

	it('says nothing about an item that has no reference', () =>
	{
		expect(DesignDocument.parse(design([{item_type: 1, model_url: 'models/chair.glb'}])).ok).toBe(true);
	});
});

describe('the scene, with real bytes', () =>
{
	/** @returns {{model: Model, store: LocalModels, resolver: AssetResolver}} */
	function build(manifested)
	{
		const store = new LocalModels();
		const resolver = new AssetResolver();
		if (manifested)
		{
			const parsed = AssetManifest.parse({
				version: 1,
				assets: {'models/chair.glb': {url: 'models/chair.glb', bytes: 10, kind: 'model'}},
			});
			expect(parsed.ok).toBe(true);
			resolver.setManifest(parsed.manifest);
		}
		const runtime = new DesignRuntime({assets: resolver, localModels: store});
		return {model: new Model('models/textures/', runtime), store: store, resolver: resolver};
	}

	/** @returns {Promise<?Object>} the item, or null if the load failed. */
	function place(scene, name, metadata)
	{
		return new Promise((resolve) =>
		{
			const done = (event) =>
			{
				scene.removeEventListener(EVENT_ITEM_LOADED, done);
				resolve(event.item);
			};
			scene.addEventListener(EVENT_ITEM_LOADED, done);
			scene.addItem(1, name, metadata, null, null, null, false);
		});
	}

	it('measures a real model with the loader that will load it', async () =>
	{
		const {model} = build(false);
		const measured = await model.scene.measureModel(bytesOf(BEAR), 'gltf');
		// Not a number anybody chose - it is what three reports for the file in
		// this repository, and the point of measuring with the real loader is that
		// this cannot drift from what a placement produces.
		expect(measured.empty).toBe(false);
		expect(measured.size[0]).toBeCloseTo(0.38971144, 5);
		expect(measured.size[1]).toBeCloseTo(0.45, 5);
		expect(measured.size[2]).toBeCloseTo(0.2475, 5);
	});

	it('reports an OBJ with no geometry as empty rather than as minus infinity', async () =>
	{
		const {model} = build(false);
		const bytes = new TextEncoder().encode('# nothing in here\n').buffer;
		const measured = await model.scene.measureModel(bytes, 'obj');
		expect(measured.empty).toBe(true);
		expect(measured.size).toEqual([0, 0, 0]);
	});

	it('reads an OBJ, because that reader was already in the bundle too', async () =>
	{
		const {model} = build(false);
		const bytes = new TextEncoder().encode('v 0 0 0\nv 2 4 6\nv 0 4 0\nf 1 2 3\n').buffer;
		const measured = await model.scene.measureModel(bytes, 'obj');
		expect(measured.size).toEqual([2, 4, 6]);
	});

	it('refuses a format no loader in this build reads, by name', async () =>
	{
		const {model} = build(false);
		await expect(model.scene.measureModel(new ArrayBuffer(4), 'fbx'))
			.rejects.toThrow(/no loader in this build reads the "fbx" format/);
	});

	it('places an item from bytes, past a manifest that has never heard of it', async () =>
	{
		const {model, store} = build(true);
		store.set('local/bear.glb', bytesOf(BEAR));
		// The ordering that makes the whole feature work: with a manifest loaded,
		// `missing()` is true for this name and would refuse it before a single
		// byte was read. Every deployment of this application fetches a manifest.
		expect(model.scene.runtime.assets.missing('local/bear.glb')).toBe(true);

		const item = await place(model.scene, 'local/bear.glb', {
			itemName: 'bear.glb', itemType: 1, modelUrl: 'local/bear.glb', format: 'gltf',
			local: {id: 'bear', file: 'bear.glb', up: UP_Y},
		});
		expect(item).not.toBeNull();
		expect(item.getMetaData().model_url).toBe('local/bear.glb');
		expect(item.getMetaData().local).toEqual({id: 'bear', file: 'bear.glb', up: UP_Y});
	});

	it('applies the axis through the whole path, not only in the constructor', async () =>
	{
		const {model, store} = build(false);
		store.set('local/bear.glb', bytesOf(BEAR));
		const upright = await place(model.scene, 'local/bear.glb',
			{itemName: 'a', itemType: 1, modelUrl: 'local/bear.glb', format: 'gltf'});
		const laid = await place(model.scene, 'local/bear.glb', {
			itemName: 'a', itemType: 1, modelUrl: 'local/bear.glb', format: 'gltf',
			local: {id: 'bear', file: 'bear.glb', up: UP_Z},
		});
		// The measured file is 0.38971 × 0.45 × 0.2475. Read as Z-up, the last two
		// swap.
		expect(laid.getHeight()).toBeCloseTo(upright.getDepth(), 5);
		expect(laid.getDepth()).toBeCloseTo(upright.getHeight(), 5);
	});

	it('names the file when the store is empty, and adds nothing', async () =>
	{
		const {model} = build(true);
		const item = await place(model.scene, 'local/gone.glb', {
			itemName: 'gone', itemType: 1, modelUrl: 'local/gone.glb', format: 'gltf',
			local: {id: 'gone', file: 'grandmother-chair.glb', up: UP_Y},
		});
		expect(item).toBeNull();
		expect(model.scene.unloadableItemCount).toBe(1);
	});

	it('yields to an embedder\'s own loader, which is what its documentation promises', async () =>
	{
		const {model, store} = build(false);
		store.set('local/bear.glb', bytesOf(BEAR));
		let asked = null;
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			asked = fileName;
			onLoad(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
		});
		const item = await place(model.scene, 'local/bear.glb',
			{itemName: 'a', itemType: 1, modelUrl: 'local/bear.glb', format: 'gltf'});
		expect(asked).toBe('local/bear.glb');
		expect(item.getWidth()).toBe(1);
	});

	it('fails by name when the index and the store disagree', async () =>
	{
		// `has()` is an in-memory index and `read()` goes to disk, so the two can
		// come apart - a record whose bytes were evicted, a store cleared in
		// another tab. It has to arrive as a failed load rather than as a hang:
		// the application counts loads in flight to decide when undo is safe.
		const {model} = build(false);
		model.scene.runtime.localModels = {has: () => true, read: async () => null};
		const item = await place(model.scene, 'local/ghost.glb',
			{itemName: 'a', itemType: 1, modelUrl: 'local/ghost.glb', format: 'gltf'});
		expect(item).toBeNull();
	});

	it('fails by name when the bytes are not the format they claim', async () =>
	{
		const {model, store} = build(false);
		store.set('local/lying.glb', new TextEncoder().encode('this is not a glb').buffer);
		const item = await place(model.scene, 'local/lying.glb',
			{itemName: 'a', itemType: 1, modelUrl: 'local/lying.glb', format: 'gltf'});
		expect(item).toBeNull();
	});
});
