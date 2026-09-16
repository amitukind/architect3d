/**
 * Bringing your own model, in a real browser (RM-012 J3, tier 2).
 *
 * ## What this proves that the headless tier cannot
 *
 * `tests/model-store.test.js` runs the repository against a fake `IDBFactory`,
 * because a real one will not produce a quota refusal or a newer-build refusal
 * on request. What a fake cannot prove is that an `ArrayBuffer` survives a real
 * structured clone and comes back as bytes a real `GLTFLoader` will accept -
 * and that pair is the whole feature.
 *
 * Three more things exist only here:
 *
 * 1. **A real `crypto.subtle`.** `model_file.js` has no fallback digest on the
 *    argument that a browser without one has no secure context either. This is
 *    where that is a fact rather than an argument.
 * 2. **A real `DRACOLoader`.** 202 of the 215 models this repository ships are
 *    Draco-compressed and the decoder is 73 kB of WASM fetched at first use, so
 *    "the loaders were already in the bundle" is only true if a compressed
 *    import actually decodes.
 * 3. **The round trip, end to end**: import, save, load into a second model,
 *    and the item is there at the same size and the same orientation. That is
 *    J3's first acceptance clause, and nothing short of a real store and a real
 *    loader can answer it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Model} from '../../src/scripts/model/model.js';
import {DesignRuntime} from '../../src/scripts/core/design_runtime.js';
import {EVENT_ITEM_LOADED} from '../../src/scripts/core/events.js';
import {AssetManifest} from '../../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../../src/scripts/core/asset_resolver.js';
import {IndexedDbModelRepository, DB_NAME} from '../../src/app/persistence/model_repository.js';
import {modelStore, setModelRepository} from '../../src/app/import/model_store.js';
import {fingerprint, formatOf, importsAvailable, localNameFor} from '../../src/app/import/model_file.js';

/** Plain glTF, so this case is not also a test of Draco. */
const PLAIN = 'models/gltf/bear.glb';
/** Draco-compressed, which 202 of the 215 models in this tree are. */
const COMPRESSED = 'models/js-glb/ik_nordli_full.glb';

function deleteDatabase(name)
{
	return new Promise((resolve) =>
	{
		const request = window.indexedDB.deleteDatabase(name);
		request.onsuccess = resolve;
		request.onerror = resolve;
		request.onblocked = resolve;
	});
}

/** @returns {Promise<ArrayBuffer>} */
async function download(path)
{
	const response = await fetch(`/${path}`);
	expect(response.ok, `${path} is served by the dev server`).toBe(true);
	return response.arrayBuffer();
}

/** Put a downloaded file into the store the way an import does. */
async function store(path, up)
{
	const bytes = await download(path);
	const id = await fingerprint(bytes);
	const extension = path.slice(path.lastIndexOf('.') + 1);
	const record = {
		id: id,
		name: localNameFor(id, extension),
		file: path.slice(path.lastIndexOf('/') + 1),
		format: formatOf(path),
		up: up || 'y',
		bytes: bytes.byteLength,
		added: Date.now(),
	};
	const result = await modelStore().put(record, bytes);
	expect(result.ok, 'the model was stored').toBe(true);
	return record;
}

/** Place one item and wait for it to settle, however it settles. */
function place(scene, record, metadata)
{
	return new Promise((resolve) =>
	{
		const done = (event) =>
		{
			scene.removeEventListener(EVENT_ITEM_LOADED, done);
			resolve(event.item);
		};
		scene.addEventListener(EVENT_ITEM_LOADED, done);
		scene.addItem(1, record.name, Object.assign({
			itemName: record.file, resizable: true, modelUrl: record.name,
			itemType: 1, format: record.format,
			local: {id: record.id, file: record.file, up: record.up},
		}, metadata || {}), null, null, null, false);
	});
}

/**
 * A model on the app's own store, the way `useBlueprint` builds one.
 *
 * @param {boolean} [manifested] Whether the resolver carries a manifest, which
 *        every deployment of the application's does. It decides what happens to
 *        a name nothing can produce bytes for: with one, a typed refusal before
 *        the network; without one, a fetch of a URL that is not there.
 */
function modelOnTheStore(manifested)
{
	const assets = new AssetResolver();
	if (manifested)
	{
		const parsed = AssetManifest.parse({
			version: 1,
			assets: {'models/gltf/bear.glb': {url: 'models/gltf/bear.glb', bytes: 1, kind: 'model'}},
		});
		expect(parsed.ok).toBe(true);
		assets.setManifest(parsed.manifest);
	}
	return new Model('models/textures/',
		new DesignRuntime({assets: assets, localModels: modelStore()}));
}

beforeEach(async () =>
{
	await deleteDatabase(DB_NAME);
	setModelRepository(new IndexedDbModelRepository({factory: window.indexedDB}));
	await modelStore().refresh();
});

afterEach(async () =>
{
	setModelRepository(null);
	await deleteDatabase(DB_NAME);
});

describe('the store, for real', () =>
{
	it('digests a file in this browser, because there is no fallback that would', async () =>
	{
		// `model_file.js` states the argument: a browser with no `crypto.subtle`
		// has no secure context, which is also a browser where K3's worker never
		// registers. This is where the argument becomes a measurement.
		expect(importsAvailable()).toBe(true);
		const bytes = await download(PLAIN);
		const id = await fingerprint(bytes);
		expect(id).toMatch(/^[0-9a-f]{16}$/);
		expect(await fingerprint(bytes)).toBe(id);
	});

	it('is its own database, and does not disturb the other two', async () =>
	{
		await store(PLAIN);
		const names = (await window.indexedDB.databases()).map((entry) => entry.name);
		// Y-1's rule, third application: a new kind of thing gets a new database
		// at version 1, so a version bump can never cost the other two.
		expect(names).toContain(DB_NAME);
		expect(names).not.toContain('architect3d-projects');
	});

	it('hands back bytes a real loader will take', async () =>
	{
		const record = await store(PLAIN);
		const read = await modelStore().read(record.name);
		expect(read.byteLength).toBe(record.bytes);
		// The structured clone a real IndexedDB performs, which is the thing the
		// fake stands in for headlessly.
		expect(new Uint8Array(read)[0]).toBe(0x67);
	});

	it('reads back into an index after a reload, which is what boot does', async () =>
	{
		const record = await store(PLAIN, 'z');
		modelStore().reset();
		expect(modelStore().has(record.name)).toBe(false);
		expect(await modelStore().refresh()).toBe(1);
		expect(modelStore().record(record.name).up).toBe('z');
	});
});

describe('the loaders X-7 found already in the bundle', () =>
{
	it('places a plain glTF from bytes', async () =>
	{
		const record = await store(PLAIN);
		const model = modelOnTheStore();
		const item = await place(model.scene, record);
		expect(item).not.toBeNull();
		expect(item.getWidth()).toBeGreaterThan(0);
	});

	it('places a Draco-compressed one, decoder and all', async () =>
	{
		// 202 of the 215 models here are Draco. "No loader is written" is only
		// true if the DRACOLoader the scene already attaches actually decodes an
		// imported file - it fetches 73 kB of WASM the first time it is asked.
		const record = await store(COMPRESSED);
		const model = modelOnTheStore();
		const item = await place(model.scene, record);
		expect(item).not.toBeNull();
		expect(item.getWidth()).toBeGreaterThan(0);
	});

	it('measures with the loader that will load it, and the two agree', async () =>
	{
		const bytes = await download(PLAIN);
		const model = modelOnTheStore();
		const measured = await model.scene.measureModel(bytes, 'gltf');
		const record = await store(PLAIN);
		const item = await place(model.scene, record);
		// The claim the import dialog rests on. A separate bounds implementation
		// would be an assumption; RM-013 K1 found one wrong on 4 of 15 rows.
		expect(item.getWidth()).toBeCloseTo(measured.size[0], 5);
		expect(item.getHeight()).toBeCloseTo(measured.size[1], 5);
		expect(item.getDepth()).toBeCloseTo(measured.size[2], 5);
	});
});

describe('the round trip, which is the first acceptance clause', () =>
{
	it('saves and reopens an imported model at the same size and orientation', async () =>
	{
		const record = await store(COMPRESSED, 'z');
		const first = modelOnTheStore();
		// 100 centimetres per authored unit, the answer for a model authored in
		// metres, carried into the file as an absolute scale.
		const placed = await place(first.scene, record, {unitScale: 100});
		expect(placed).not.toBeNull();
		const before = placed.getMetaData();
		const size = [placed.getWidth(), placed.getHeight(), placed.getDepth()];

		const saved = first.exportSerialized();
		expect(saved).toContain('"local"');

		// A second document, on the same store - which is what reopening is.
		const second = modelOnTheStore();
		const arriving = new Promise((resolve) =>
		{
			const done = (event) =>
			{
				second.scene.removeEventListener(EVENT_ITEM_LOADED, done);
				resolve(event.item);
			};
			second.scene.addEventListener(EVENT_ITEM_LOADED, done);
		});
		expect(second.loadDocument(saved).ok).toBe(true);
		const reopened = await arriving;

		expect(reopened).not.toBeNull();
		expect(reopened.getMetaData().local).toEqual(before.local);
		expect(reopened.getMetaData().model_url).toBe(record.name);
		// Same size: the unit choice is in `scale_x/y/z`, and `_scaleFromDocument`
		// is what stops it being applied a second time.
		expect(reopened.getMetaData().scale_y).toBeCloseTo(before.scale_y, 6);
		expect([reopened.getWidth(), reopened.getHeight(), reopened.getDepth()])
			.toEqual(size.map((value) => expect.closeTo(value, 5)));
	});

	it('opens where the store is empty, names the file, and loses nothing else',
		async () =>
		{
			const record = await store(PLAIN);
			const first = modelOnTheStore();
			await place(first.scene, record);
			const saved = first.exportSerialized();

			// The recipient: same build, empty store.
			await modelStore().forgetAll();
			const audit = modelStore().audit(saved);
			expect(audit.missing.map((ref) => ref.file)).toEqual(['bear.glb']);

			// Manifested, because every deployment of this application is - which is
			// what turns "the model is missing" from a 404 into a refusal that can
			// name the file, and why `normaliseImport` keeps `file` at all.
			const second = modelOnTheStore(true);
			const settled = new Promise((resolve) =>
			{
				const done = (event) =>
				{
					second.scene.removeEventListener(EVENT_ITEM_LOADED, done);
					resolve(event.item);
				};
				second.scene.addEventListener(EVENT_ITEM_LOADED, done);
			});
			// The document opens. That is the clause: it is somebody else's design,
			// and refusing it would be the failure rather than the safeguard.
			expect(second.loadDocument(saved).ok).toBe(true);
			expect(await settled).toBeNull();
			expect(second.floorplan.getCorners().length).toBe(first.floorplan.getCorners().length);
		});
});

describe('the whole application, mounted', () =>
{
	let host;
	let blueprint;

	afterEach(() =>
	{
		if (blueprint) { blueprint.dispose(); }
		blueprint = null;
		if (host) { host.remove(); }
		host = null;
	});

	it('hands the viewer the store the application writes to', async () =>
	{
		host = document.createElement('div');
		host.style.width = '640px';
		host.style.height = '480px';
		const canvas = document.createElement('canvas');
		host.appendChild(canvas);
		document.body.appendChild(host);

		blueprint = new BlueprintJS({
			floorplannerElement: canvas,
			threeElement: host,
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			localModels: modelStore(),
		});

		// One store, reached the way `Scene.addItem` reaches it. Getting this wrong
		// is silent - the model stores fine and the placement asks an empty store,
		// falls through to the asset manifest and fetches a URL that is not there.
		expect(blueprint.model.scene.runtime.localModels).toBe(modelStore());

		const record = await store(PLAIN);
		const item = await place(blueprint.model.scene, record);
		expect(item).not.toBeNull();
	});
});
