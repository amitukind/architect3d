/**
 * The draft store, against a real one (RM-003 A5, tier 2).
 *
 * ## Why this needs a browser
 *
 * `tests/persistence-and-assets.test.js` proves the interface, the fallback,
 * the pointer arithmetic and every branch of the error handling. What it cannot
 * prove is the thing the sprint is for, because **jsdom has no IndexedDB** and
 * its `localStorage` has no size cap. Under jsdom the repository detects the
 * fallback and the 5 MiB cliff does not exist to fall off.
 *
 * So the claims that need a real browser are here, and there are three:
 *
 * 1. **IndexedDB is what gets picked**, and a draft round-trips through it.
 * 2. **A design far larger than 5 MiB autosaves and recovers.** This is the
 *    acceptance criterion, and it is the case that permanently disabled
 *    autosave before this sprint - measured here by doing it both ways: the
 *    same document into `localStorage` is refused, and into IndexedDB is not.
 * 3. **M-9 = 0 bytes.** No document-sized synchronous main-thread write, and a
 *    recovery pointer under a kilobyte.
 *
 * ## The size is chosen, not guessed
 *
 * 6 MiB. Above the ~5 MiB Web Storage cap that every current browser applies
 * per origin, and small enough that writing it several times does not make this
 * file the slowest in the tier.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
	IndexedDbDraftRepository, LocalStorageDraftRepository, createDraftRepository,
	DB_NAME, STORE_NAME, STORE_VERSION, LEGACY_STORAGE_KEY, REASON_VERSION,
} from '../../src/app/persistence/draft_repository.js';
import {
	writePointer, readPointer, clearPointer, compareRecovery,
	POINTER_LIMIT_BYTES, RECOVERY_LOST_TAIL, RECOVERY_COMPLETE,
} from '../../src/app/persistence/recovery_pointer.js';

/** Above the Web Storage cap, below "this test is why the tier is slow". */
const OVERSIZE_BYTES = 6 * 1024 * 1024;

/**
 * A design document of a given size.
 *
 * Padded with a repeated string rather than random data: the point is the byte
 * count, and incompressible noise would make this measure the browser's
 * storage compression rather than its quota.
 */
function designOfSize(bytes)
{
	const filler = 'x'.repeat(Math.max(0, bytes - 200));
	return JSON.stringify({
		floorplan: {corners: {}, walls: [], rooms: {}, units: 'cm', version: '2.0.0'},
		items: [],
		_padding: filler,
	});
}

/** Delete the database outright, so each test starts from nothing. */
function deleteDatabase()
{
	return new Promise((resolve) =>
	{
		const request = window.indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve(undefined);
		request.onerror = () => resolve(undefined);
		request.onblocked = () => resolve(undefined);
	});
}

beforeEach(async () =>
{
	window.localStorage.clear();
	await deleteDatabase();
});

afterEach(async () =>
{
	window.localStorage.clear();
	await deleteDatabase();
});

describe('the store this browser actually gets', () =>
{
	it('is IndexedDB, and a draft round-trips through it', async () =>
	{
		expect(typeof window.indexedDB).toBe('object');

		const repository = createDraftRepository();
		expect(repository.kind).toBe('indexeddb');

		const result = await repository.put('{"floorplan":{},"items":[]}', 1700000000000);
		expect(result.ok).toBe(true);
		expect(result.reason).toBeNull();

		const draft = await repository.read();
		expect(draft.design).toBe('{"floorplan":{},"items":[]}');
		expect(draft.savedAt).toBe(1700000000000);

		await repository.clear();
		expect(await repository.read()).toBeNull();
	});

	it('overwrites the one slot rather than accumulating drafts', async () =>
	{
		// "Deliberately not a recent-files list", which is a claim about the store
		// and not only about the UI over it.
		const repository = new IndexedDbDraftRepository({legacyStorage: null});
		await repository.put('{"first":true}', 1);
		await repository.put('{"second":true}', 2);

		expect((await repository.read()).design).toBe('{"second":true}');

		const db = await new Promise((resolve, reject) =>
		{
			const request = window.indexedDB.open(DB_NAME, STORE_VERSION);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const count = await new Promise((resolve, reject) =>
		{
			const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		db.close();
		expect(count).toBe(1);
	});

	it('adopts a pre-A5 localStorage draft and takes it out of the old slot', async () =>
	{
		window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
			design: '{"legacy":true}',
			savedAt: 1700000000000,
		}));

		const repository = new IndexedDbDraftRepository();
		expect((await repository.read()).design).toBe('{"legacy":true}');
		expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();

		// And it really was copied across, not just returned: a fresh repository
		// with no legacy store to look at still finds it.
		const fresh = new IndexedDbDraftRepository({legacyStorage: null});
		expect((await fresh.read()).design).toBe('{"legacy":true}');
	});

	it('leaves a store from a newer build alone, and says so', async () =>
	{
		// Task 4's rule: an unknown version is reported rather than migrated
		// speculatively. Migrating a shape this code has never seen, on the guess
		// that it is close enough, is how a draft becomes unreadable by both
		// builds at once.
		const future = await new Promise((resolve, reject) =>
		{
			const request = window.indexedDB.open(DB_NAME, STORE_VERSION + 5);
			request.onupgradeneeded = () =>
			{
				request.result.createObjectStore('something-else', {keyPath: 'id'});
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		future.close();

		const repository = new IndexedDbDraftRepository({legacyStorage: null});
		const result = await repository.put('{"mine":true}', 1);

		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_VERSION);
		expect((await repository.stats()).kind).toBe('indexeddb-unsupported-version');

		// The newer build's database is untouched: still at its version, still
		// carrying its own store.
		const check = await new Promise((resolve, reject) =>
		{
			const request = window.indexedDB.open(DB_NAME);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		expect(check.version).toBe(STORE_VERSION + 5);
		expect(check.objectStoreNames.contains('something-else')).toBe(true);
		check.close();
	});
});

describe('a design far larger than Web Storage allows', () =>
{
	it('is refused by localStorage - which is the finding', async () =>
	{
		// The measurement that makes the rest of this sprint worth doing, taken
		// against the implementation that shipped before it. If this ever stops
		// failing, the cap has moved and the argument needs re-checking.
		const repository = new LocalStorageDraftRepository({storage: window.localStorage});
		const result = await repository.put(designOfSize(OVERSIZE_BYTES), Date.now());

		expect(result.ok).toBe(false);
		expect(result.reason).toBe('quota');
		// And it tried: the prune-and-retry path ran before giving up.
		expect(result.pruned).toBe(true);
	});

	it('and autosaves and recovers through IndexedDB', async () =>
	{
		const design = designOfSize(OVERSIZE_BYTES);
		const repository = new IndexedDbDraftRepository({legacyStorage: null});
		const stamp = Date.now();

		const result = await repository.put(design, stamp);
		expect(result.ok).toBe(true);
		expect(result.bytes).toBeGreaterThan(OVERSIZE_BYTES - 1024);

		const draft = await repository.read();
		expect(draft.savedAt).toBe(stamp);
		expect(draft.design.length).toBe(design.length);
		expect(draft.design).toBe(design);
	});

	it('and M-9 is zero bytes, with a pointer under a kilobyte', async () =>
	{
		// The metric, measured on the path a user's editing actually takes. The
		// body is six megabytes; what touches the main thread's storage is the
		// pointer, and it is three numbers and a string.
		const repository = new IndexedDbDraftRepository({legacyStorage: null});
		const design = designOfSize(OVERSIZE_BYTES);
		const stamp = Date.now();

		const pointerBytes = writePointer({savedAt: stamp, bytes: design.length, store: repository.kind});
		await repository.put(design, stamp);

		const stats = await repository.stats();
		expect(stats.syncBytes).toBe(0);
		expect(pointerBytes).toBeGreaterThan(0);
		expect(pointerBytes).toBeLessThan(POINTER_LIMIT_BYTES);

		// And the two agree, so the next session reports a clean recovery.
		expect(compareRecovery(readPointer(), await repository.read()).state).toBe(RECOVERY_COMPLETE);

		// The before-and-after, on a document small enough that the old path can
		// actually hold one. It cannot hold the six-megabyte design at all - the
		// test above measures that - so asking `syncBytes` about it would report
		// zero for the wrong reason: nothing was written, rather than nothing was
		// written synchronously. A megabyte fits, and every byte of it goes
		// through the main thread.
		const modest = designOfSize(1024 * 1024);
		const legacy = new LocalStorageDraftRepository({storage: window.localStorage});
		expect((await legacy.put(modest, stamp)).ok).toBe(true);
		// Against the document's own length rather than a round number: the record
		// wraps it in a timestamp, so this says "the whole body and then some"
		// exactly, which is the claim.
		expect((await legacy.stats()).syncBytes).toBeGreaterThan(modest.length);

		// The same document through the new path: nothing.
		const modern = new IndexedDbDraftRepository({legacyStorage: null});
		expect((await modern.put(modest, stamp)).ok).toBe(true);
		expect((await modern.stats()).syncBytes).toBe(0);
	});
});

describe('the write that did not land', () =>
{
	it('is detectable, which is all a pointer can promise', async () =>
	{
		// K-6 in the environment it happens in. `pagehide` starts a write and the
		// document may go away before it completes; the pointer is written first
		// and carries the timestamp the body was going to have, so a body that
		// never arrived leaves a pointer newer than the one that did.
		const repository = new IndexedDbDraftRepository({legacyStorage: null});
		await repository.put('{"landed":true}', 1700000000000);

		// The write that never happened.
		writePointer({savedAt: 1700000090000, bytes: 4096, store: repository.kind});

		const comparison = compareRecovery(readPointer(), await repository.read());
		expect(comparison.state).toBe(RECOVERY_LOST_TAIL);
		expect(comparison.lostMs).toBe(90000);

		clearPointer();
		expect(compareRecovery(readPointer(), await repository.read()).state).toBe(RECOVERY_COMPLETE);
	});
});
