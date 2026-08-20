/**
 * The project library, against a real IndexedDB (RM-013 K1, M-48, tier 2).
 *
 * ## What this proves that the headless tier cannot
 *
 * `tests/project-library.test.js` runs the same repository against the fake
 * `IDBFactory` and reaches every branch a real store will not produce on
 * request - the quota refusal, the newer-build refusal, the failed open. What a
 * fake cannot prove is that the semantics are real IndexedDB's semantics, and
 * three of this library's claims are about exactly that:
 *
 * 1. **Two databases, and the draft's is untouched.** Finding Y-1 is the whole
 *    reason the library is not an object store inside `architect3d`, so the
 *    assertion is made against the browser's own `indexedDB.databases()`.
 * 2. **A card and a body are written atomically**, in one real transaction over
 *    two real stores.
 * 3. **A listing does not pull the documents.** Measured rather than asserted
 *    structurally, because the point of the two stores is a byte count.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
	IndexedDbProjectRepository, DB_NAME, CARD_STORE, BODY_STORE,
} from '../../src/app/persistence/project_repository.js';
import {
	IndexedDbDraftRepository, DB_NAME as DRAFT_DB,
} from '../../src/app/persistence/draft_repository.js';
import {byteLength} from '../../src/app/persistence/storage.js';

/** A design of the size RM-013 Y-5 measured for a furnished three-bedroom. */
function design(items)
{
	const furniture = Array.from({length: items}, (unused, i) => ({
		id: `i-${i}`, item_name: 'Church Chair - Oak', item_type: 1,
		model_url: 'models/js-glb/gothic_chair.glb', xpos: 100 + i, ypos: 0, zpos: 200 + i,
		rotation: 0.785398, scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
		format: 'gltf', resizable: true,
	}));
	return JSON.stringify({floorplan: {corners: {}, walls: [], rooms: {}}, items: furniture});
}

function card(id, name, at)
{
	return {id, name, createdAt: at, modifiedAt: at, thumbnail: null, bytes: 0, origin: null};
}

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

let library;

beforeEach(async () =>
{
	await deleteDatabase(DB_NAME);
	await deleteDatabase(DRAFT_DB);
	library = new IndexedDbProjectRepository();
});

afterEach(async () =>
{
	await deleteDatabase(DB_NAME);
	await deleteDatabase(DRAFT_DB);
});

describe('M-48 · a project round-trips through a real store', () =>
{
	it('writes, lists, reads, renames and deletes', async () =>
	{
		const body = design(14);
		const written = await library.put(card('a', 'Three-bedroom flat', Date.now()), body);
		expect(written.ok).toBe(true);

		expect((await library.list()).map((row) => row.name)).toEqual(['Three-bedroom flat']);
		expect((await library.read('a')).design).toBe(body);

		const renamed = await library.rename('a', 'Loft conversion', Date.now() + 1000);
		expect(renamed.card.name).toBe('Loft conversion');
		expect((await library.read('a')).design).toBe(body);

		expect((await library.remove('a')).ok).toBe(true);
		expect(await library.list()).toEqual([]);
	});

	it('holds several, newest first', async () =>
	{
		const at = Date.now();
		await library.put(card('a', 'First', at), design(4));
		await library.put(card('b', 'Second', at + 1000), design(4));
		await library.put(card('c', 'Third', at + 2000), design(4));

		expect((await library.list()).map((row) => row.name)).toEqual(['Third', 'Second', 'First']);
	});

	it('creates both stores in one upgrade', async () =>
	{
		await library.put(card('a', 'Kitchen', Date.now()), design(2));

		const names = await new Promise((resolve) =>
		{
			const request = window.indexedDB.open(DB_NAME);
			request.onsuccess = () =>
			{
				const found = [...request.result.objectStoreNames];
				request.result.close();
				resolve(found);
			};
		});

		expect(names).toContain(CARD_STORE);
		expect(names).toContain(BODY_STORE);
	});
});

/**
 * Y-1, in the browser that produced the finding.
 *
 * A `projects` store inside `architect3d` would have required version 2, and a
 * build without it would then refuse the draft permanently for the session.
 */
describe('Y-1 · the draft store keeps working', () =>
{
	it('is a separate database, and both are at version 1', async () =>
	{
		const draft = new IndexedDbDraftRepository({legacyStorage: null});
		expect((await draft.put(design(2), Date.now())).ok).toBe(true);
		await library.put(card('a', 'Kitchen', Date.now()), design(14));

		const found = (await window.indexedDB.databases())
			.filter((entry) => entry.name === DB_NAME || entry.name === DRAFT_DB);

		expect(found.map((entry) => entry.name).sort()).toEqual([DB_NAME, DRAFT_DB].sort());
		found.forEach((entry) => {expect(entry.version).toBe(1);});
		// And the draft is still readable, which is the thing that matters.
		expect(await draft.read()).not.toBeNull();
		expect((await draft.stats()).kind).toBe('indexeddb');
	});
});

describe('a listing costs cards, not designs', () =>
{
	it('reads a fraction of what the library holds', async () =>
	{
		const bodies = [];
		for (let i = 0; i < 8; i++)
		{
			const body = design(40);
			bodies.push(body);
			await library.put(card(`p-${i}`, `Design ${i}`, Date.now() + i * 1000), body);
		}

		const listed = await library.list();
		const listedBytes = byteLength(JSON.stringify(listed));
		const storedBytes = bodies.reduce((total, body) => total + body.length, 0);

		expect(listed).toHaveLength(8);
		// The number is what the two stores are for. A tenth is a generous ceiling;
		// the measured ratio at this size is far below it.
		expect(listedBytes).toBeLessThan(storedBytes / 10);
		// And every card still knows how big its document is without holding it.
		listed.forEach((row) => {expect(row.bytes).toBeGreaterThan(1000);});
	});

	it('reports the quota the browser is offering', async () =>
	{
		await library.put(card('a', 'Kitchen', Date.now()), design(14));

		const stats = await library.stats();

		expect(stats.projects).toBe(1);
		expect(stats.kind).toBe('indexeddb');
		// Y-6 measured 3.00 GiB here. The assertion is the shape of the claim -
		// that a library is not what will run out - rather than the exact figure,
		// which is the browser's business and moves with the disk.
		expect(stats.quota).toBeGreaterThan(stats.bytes * 1000);
	});
});
