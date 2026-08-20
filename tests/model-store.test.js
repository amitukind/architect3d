/**
 * Where an imported model is kept (RM-012 J3, finding X-7).
 *
 * X-7's sentence was *"J3 needs a store, not a loader"*, and this is the store:
 * a third IndexedDB database, content-addressed, with the records in one object
 * store and the bytes in another. The split is not a tidiness preference - it is
 * what makes `has()` answerable synchronously, which is what lets
 * `Scene.addItem` decide between the import branch and the asset manifest
 * without a promise hop on every catalog item.
 *
 * Run against the fake `IDBFactory` for the same reason RM-013 K1's library is:
 * the branches worth testing - a quota refusal on demand, a store a browser
 * withholds, an index that disagrees with the disk - are the repository's own
 * logic, and a real IndexedDB will not produce any of them to order. What a
 * real one does is in `tests/browser/imported-model.test.js`.
 */
import {beforeEach, describe, expect, it} from 'vitest';

import {IndexedDbModelRepository, UnavailableModelRepository, createModelRepository,
	DB_NAME, RECORD_STORE, BLOB_STORE, STORE_VERSION} from '../src/app/persistence/model_repository.js';
import {DB_NAME as PROJECT_DB} from '../src/app/persistence/project_repository.js';
import {modelStore, modelStoreKind, setModelRepository} from '../src/app/import/model_store.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

/** @param {number} size @param {number} fill */
function bytes(size, fill)
{
	const buffer = new ArrayBuffer(size);
	new Uint8Array(buffer).fill(fill);
	return buffer;
}

/** @param {string} id */
function record(id, extra)
{
	return Object.assign({
		id: id,
		name: `local/${id}.glb`,
		file: `${id}.glb`,
		format: 'gltf',
		up: 'y',
		bytes: 0,
		added: 1000,
	}, extra || {});
}

describe('the third database', () =>
{
	it('is not the draft\'s and not the library\'s', () =>
	{
		// Y-1's rule, applied a second time: a new kind of thing gets a new
		// database at version 1, because a version bump is one-way and it is the
		// older store that pays for it.
		expect(DB_NAME).toBe('architect3d-models');
		expect(DB_NAME).not.toBe(PROJECT_DB);
		expect(STORE_VERSION).toBe(1);
	});

	it('keeps the records apart from the bytes', () =>
	{
		expect(RECORD_STORE).not.toBe(BLOB_STORE);
	});
});

describe('the repository', () =>
{
	/** @type {*} */
	let factory;
	/** @type {IndexedDbModelRepository} */
	let repository;

	beforeEach(() =>
	{
		factory = createFakeIndexedDb();
		repository = new IndexedDbModelRepository({factory: factory});
	});

	it('stores a model and hands the same bytes back', async () =>
	{
		const payload = bytes(2048, 7);
		const result = await repository.put(record('abc'), payload);
		expect(result.ok).toBe(true);
		expect(result.record.bytes).toBe(2048);

		const read = await repository.read('abc');
		expect(read.byteLength).toBe(2048);
		// Not the same object - IndexedDB structured-clones - but the same bytes,
		// which is the only promise a store can make.
		expect(new Uint8Array(read)[0]).toBe(7);
		expect(read).not.toBe(payload);
	});

	it('lists records without reading one model', async () =>
	{
		await repository.put(record('a', {added: 10}), bytes(1024, 1));
		await repository.put(record('b', {added: 20}), bytes(4096, 2));
		const listed = await repository.list();
		// Newest first, and the bytes are a number rather than a buffer - which is
		// the whole point of the two-store split.
		expect(listed.map((row) => row.id)).toEqual(['b', 'a']);
		expect(listed.map((row) => row.bytes)).toEqual([4096, 1024]);
		expect(listed.every((row) => !(row.blob instanceof ArrayBuffer))).toBe(true);
	});

	it('replaces by id, because the id IS the bytes', async () =>
	{
		await repository.put(record('abc'), bytes(16, 1));
		await repository.put(record('abc'), bytes(16, 1));
		expect((await repository.list()).length).toBe(1);
	});

	it('forgets one and forgets all', async () =>
	{
		await repository.put(record('a'), bytes(16, 1));
		await repository.put(record('b'), bytes(16, 2));
		expect((await repository.remove('a')).ok).toBe(true);
		expect((await repository.list()).map((row) => row.id)).toEqual(['b']);
		expect(await repository.read('a')).toBeNull();
		expect((await repository.clear()).ok).toBe(true);
		expect(await repository.list()).toEqual([]);
	});

	it('reports a quota refusal rather than throwing one', async () =>
	{
		// A model is the one thing in this application big enough to reach a real
		// quota, which is why the fake weighs an ArrayBuffer by its bytes since J3
		// - JSON rendered one as `{}` and no refusal was reachable at all.
		const small = new IndexedDbModelRepository({factory: createFakeIndexedDb({quotaBytes: 4096})});
		expect((await small.put(record('a'), bytes(1024, 1))).ok).toBe(true);
		const refused = await small.put(record('b'), bytes(8192, 2));
		expect(refused.ok).toBe(false);
		expect(refused.reason).toBe('quota');
		expect(refused.record).toBeNull();
	});

	it('reports a store written by a newer build, and leaves it alone', async () =>
	{
		const newer = new IndexedDbModelRepository({factory: createFakeIndexedDb({version: STORE_VERSION + 1})});
		const result = await newer.put(record('a'), bytes(16, 1));
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('version');
		expect(await newer.read('a')).toBeNull();
	});

	it('reports a browser that will not open the store at all', async () =>
	{
		const shut = new IndexedDbModelRepository({factory: createFakeIndexedDb({failOpen: true})});
		expect((await shut.put(record('a'), bytes(16, 1))).ok).toBe(false);
		expect(await shut.list()).toEqual([]);
		expect(await shut.read('a')).toBeNull();
		expect((await shut.remove('a')).ok).toBe(false);
		expect((await shut.clear()).ok).toBe(false);
	});

	it('has no factory when the environment has none', async () =>
	{
		const none = new IndexedDbModelRepository({factory: null});
		expect((await none.put(record('a'), bytes(16, 1))).reason).toBe('unavailable');
	});

	it('counts what it stored and what it refused', async () =>
	{
		const small = new IndexedDbModelRepository({factory: createFakeIndexedDb({quotaBytes: 2048})});
		await small.put(record('a'), bytes(512, 1));
		await small.put(record('b'), bytes(8192, 2));
		const stats = await small.stats();
		expect(stats.kind).toBe('indexeddb');
		expect(stats.models).toBe(1);
		expect(stats.bytes).toBe(512);
		expect(stats.writes).toBe(1);
		expect(stats.failures).toBe(1);
		// `navigator.storage.estimate` is optional everywhere, which is the one
		// piece of vocabulary all three stores share.
		expect(stats.usage).toBeNull();
		expect(stats.quota).toBeNull();
	});
});

describe('the browser that has no store', () =>
{
	it('refuses by name rather than pretending', async () =>
	{
		const none = new UnavailableModelRepository();
		expect(none.kind).toBe('unavailable');
		expect((await none.put()).reason).toBe('unavailable');
		expect(await none.list()).toEqual([]);
		expect(await none.read()).toBeNull();
		expect((await none.remove()).reason).toBe('unavailable');
		expect((await none.clear()).reason).toBe('unavailable');
		expect((await none.stats()).models).toBe(0);
	});

	it('is what createModelRepository builds with nothing to build on', () =>
	{
		expect(createModelRepository({factory: null}).kind).toBe('unavailable');
		// No `window` in this environment, so the default is the same answer.
		expect(createModelRepository().kind).toBe('unavailable');
		expect(createModelRepository({factory: createFakeIndexedDb()}).kind).toBe('indexeddb');
	});
});

describe('the index in front of it', () =>
{
	/** @type {*} */
	let factory;
	/** @type {*} */
	let store;

	beforeEach(async () =>
	{
		factory = createFakeIndexedDb();
		setModelRepository(new IndexedDbModelRepository({factory: factory}));
		store = modelStore();
		await store.refresh();
	});

	it('is the same object every time, because the viewer is not', () =>
	{
		// `useBlueprint.unmount()` disposes the whole BlueprintJS when the layout
		// changes. A store on the runtime would take somebody's imports with it.
		expect(modelStore()).toBe(store);
	});

	it('answers has() synchronously the moment a model is put', async () =>
	{
		expect(store.has('local/a.glb')).toBe(false);
		await store.put(record('a'), bytes(64, 1));
		expect(store.has('local/a.glb')).toBe(true);
		expect(store.count).toBe(1);
		expect(store.record('local/a.glb').file).toBe('a.glb');
	});

	it('reads the bytes back by name, not by id', async () =>
	{
		await store.put(record('a'), bytes(64, 3));
		const read = await store.read('local/a.glb');
		expect(new Uint8Array(read)[0]).toBe(3);
		expect(await store.read('local/nothing.glb')).toBeNull();
	});

	it('is rebuilt from the repository, and one getAll is the whole cost', async () =>
	{
		await store.put(record('a'), bytes(64, 1));
		await store.put(record('b'), bytes(64, 2));
		store.reset();
		expect(store.ready).toBe(false);
		expect(store.has('local/a.glb')).toBe(false);
		expect(await store.refresh()).toBe(2);
		expect(store.ready).toBe(true);
		expect(store.records().map((row) => row.id).sort()).toEqual(['a', 'b']);
	});

	it('forgets a model from the index and the disk together', async () =>
	{
		await store.put(record('a'), bytes(64, 1));
		expect((await store.forget('a')).ok).toBe(true);
		expect(store.has('local/a.glb')).toBe(false);
		expect(await store.refresh()).toBe(0);
	});

	it('forgets everything', async () =>
	{
		await store.put(record('a'), bytes(64, 1));
		await store.put(record('b'), bytes(64, 2));
		expect((await store.forgetAll()).ok).toBe(true);
		expect(store.count).toBe(0);
	});

	it('leaves the index alone when the write was refused', async () =>
	{
		setModelRepository(new IndexedDbModelRepository({factory: createFakeIndexedDb({failOpen: true})}));
		const shut = modelStore();
		expect((await shut.put(record('a'), bytes(64, 1))).ok).toBe(false);
		// The index is what `Scene` trusts. An entry added on a write that did not
		// happen would make `has()` promise bytes nothing can produce.
		expect(shut.has('local/a.glb')).toBe(false);
	});

	it('says which of a design\'s models are here and which are not', async () =>
	{
		await store.put(record('here'), bytes(64, 1));
		const design = JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [
				{item_type: 1, model_url: 'local/here.glb', local: {id: 'here', file: 'here.glb', up: 'y'}},
				{item_type: 1, model_url: 'local/gone.glb', local: {id: 'gone', file: 'grandmother.glb', up: 'z'}},
				{item_type: 1, model_url: 'models/chair.glb'},
			],
		});
		const audit = store.audit(design);
		expect(audit.wanted.map((ref) => ref.id)).toEqual(['here', 'gone']);
		// By the name in the document, because with the store empty the document is
		// the only thing that knows what the file was called.
		expect(audit.missing.map((ref) => ref.file)).toEqual(['grandmother.glb']);
	});

	it('reports what the store costs', async () =>
	{
		await store.put(record('a'), bytes(4096, 1));
		const stats = await store.stats();
		expect(stats.models).toBe(1);
		expect(stats.bytes).toBe(4096);
		expect(modelStoreKind()).toBe('indexeddb');
	});

	it('falls back to a real repository when the seam is cleared', () =>
	{
		setModelRepository(null);
		expect(modelStoreKind()).toBe('unavailable');
	});
});
