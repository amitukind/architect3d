/**
 * The project library's store (RM-013 K1, gap Q-6, metric M-48).
 *
 * Two tiers, the same split RM-003 A5 already uses for the draft:
 * `tests/browser/project-library.test.js` runs this against Chromium's real
 * IndexedDB and proves the semantics, and this file runs it against the fake
 * `IDBFactory` in `tests/helpers/indexeddb.js` to reach the branches a real
 * store will not produce on request - a quota refusal, a database written by a
 * newer build, an open that fails.
 *
 * The dependency is faked, never the subject. IndexedDB is not what is under
 * test here; what a project record is, and what happens to it, is.
 */
import {beforeEach, describe, expect, it} from 'vitest';

import {
	IndexedDbProjectRepository, UnavailableProjectRepository, createProjectRepository,
	cleanName, copyName, projectId, DB_NAME, CARD_STORE, BODY_STORE, STORE_VERSION,
	MAX_NAME_LENGTH,
} from '../src/app/persistence/project_repository.js';
import {
	DB_NAME as DRAFT_DB, STORE_VERSION as DRAFT_VERSION, IndexedDbDraftRepository,
} from '../src/app/persistence/draft_repository.js';
import {REASON_QUOTA, REASON_UNAVAILABLE, REASON_VERSION, byteLength} from '../src/app/persistence/storage.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

const DESIGN = '{"floorplan":{"corners":{},"walls":[],"rooms":{}},"items":[]}';

let clock = 1_700_000_000_000;
/** A monotonic stand-in for Date.now(), so `modifiedAt` orderings are facts. */
function tick(step = 1000)
{
	clock += step;
	return clock;
}

function card(id, name, at, extra)
{
	return Object.assign({
		id, name, createdAt: at, modifiedAt: at, thumbnail: null, bytes: 0, origin: null,
	}, extra || {});
}

let factory;
let library;

beforeEach(() =>
{
	clock = 1_700_000_000_000;
	factory = createFakeIndexedDb();
	library = new IndexedDbProjectRepository({factory});
});

describe('M-48 · a project round-trips', () =>
{
	it('writes, lists, reads and deletes', async () =>
	{
		const at = tick();
		const written = await library.put(card('a', 'Kitchen', at), DESIGN);

		expect(written.ok).toBe(true);
		expect(written.card.name).toBe('Kitchen');
		// The size is measured on the way in rather than taken from the caller.
		expect(written.card.bytes).toBe(byteLength(DESIGN));

		const listed = await library.list();
		expect(listed).toHaveLength(1);
		expect(listed[0].id).toBe('a');

		const opened = await library.read('a');
		expect(opened.design).toBe(DESIGN);
		expect(opened.card.name).toBe('Kitchen');

		expect((await library.remove('a')).ok).toBe(true);
		expect(await library.list()).toEqual([]);
		expect(await library.read('a')).toBeNull();
	});

	it('lists newest first', async () =>
	{
		await library.put(card('a', 'First', tick()), DESIGN);
		await library.put(card('c', 'Third', tick()), DESIGN);
		await library.put(card('b', 'Second', tick()), DESIGN);

		expect((await library.list()).map((row) => row.name)).toEqual(['Second', 'Third', 'First']);
	});

	it('renames without touching the document', async () =>
	{
		const at = tick();
		await library.put(card('a', 'Untitled design', at, {thumbnail: 'data:image/webp;base64,AAAA'}), DESIGN);

		const renamed = await library.rename('a', '  Loft   conversion ', tick());

		expect(renamed.ok).toBe(true);
		expect(renamed.card.name).toBe('Loft conversion');
		expect(renamed.card.createdAt).toBe(at);
		expect(renamed.card.modifiedAt).toBeGreaterThan(at);
		// The thumbnail is the card's, not the caller's - a rename that restored a
		// stale picture would be a worse bug than no rename.
		expect(renamed.card.thumbnail).toBe('data:image/webp;base64,AAAA');
		expect((await library.read('a')).design).toBe(DESIGN);
	});

	it('refuses to rename something that is not there', async () =>
	{
		expect((await library.rename('nobody', 'x', tick())).ok).toBe(false);
	});

	it('replaces by id rather than accumulating', async () =>
	{
		await library.put(card('a', 'Kitchen', tick()), DESIGN);
		await library.put(card('a', 'Kitchen', tick()), '{"floorplan":{},"items":[1]}');

		expect(await library.list()).toHaveLength(1);
		expect((await library.read('a')).design).toContain('[1]');
	});

	it('empties both stores together', async () =>
	{
		await library.put(card('a', 'One', tick()), DESIGN);
		await library.put(card('b', 'Two', tick()), DESIGN);

		await library.clear();

		expect(await library.list()).toEqual([]);
		expect(await library.read('a')).toBeNull();
	});
});

describe('the grid reads cards, not documents', () =>
{
	it('keeps the document out of what a listing returns', async () =>
	{
		const big = `{"floorplan":{},"items":[${'0,'.repeat(4000)}0]}`;
		await library.put(card('a', 'Furnished', tick()), big);

		const listed = await library.list();

		// The whole point of the two stores: a grid of N tiles costs N cards, not
		// N designs. The card knows the size without carrying the bytes.
		expect(JSON.stringify(listed[0])).not.toContain('0,0,0');
		expect(listed[0].bytes).toBe(byteLength(big));
		expect(JSON.stringify(listed).length).toBeLessThan(big.length / 10);
	});

	it('skips a card whose document has gone', async () =>
	{
		await library.put(card('a', 'Orphan', tick()), DESIGN);
		// Reach past the repository, the way dev tools would.
		await new Promise((resolve) =>
		{
			const request = factory.open(DB_NAME, STORE_VERSION);
			request.onsuccess = () =>
			{
				const transaction = request.result.transaction(BODY_STORE, 'readwrite');
				transaction.oncomplete = () => {request.result.close(); resolve();};
				transaction.objectStore(BODY_STORE).delete('a');
			};
		});

		// The tile is still listed - it exists - but it will not open, and saying
		// so is better than handing back a project with no design in it.
		expect(await library.list()).toHaveLength(1);
		expect(await library.read('a')).toBeNull();
	});

	it('skips a row that is not a card at all', async () =>
	{
		await new Promise((resolve) =>
		{
			const request = factory.open(DB_NAME, STORE_VERSION);
			request.onupgradeneeded = () =>
			{
				request.result.createObjectStore(CARD_STORE, {keyPath: 'id'});
				request.result.createObjectStore(BODY_STORE, {keyPath: 'id'});
			};
			request.onsuccess = () =>
			{
				const transaction = request.result.transaction(CARD_STORE, 'readwrite');
				transaction.oncomplete = () => {request.result.close(); resolve();};
				transaction.objectStore(CARD_STORE).put({id: 'junk', shape: 'wrong'});
			};
		});

		expect(await library.list()).toEqual([]);
	});
});

describe('the refusals, which is what the fake is for', () =>
{
	it('reports a store written by a newer build, and does not touch it', async () =>
	{
		const future = new IndexedDbProjectRepository({factory: createFakeIndexedDb({version: 2})});

		const written = await future.put(card('a', 'Kitchen', tick()), DESIGN);

		expect(written).toEqual({ok: false, reason: REASON_VERSION, card: null});
		expect(await future.list()).toEqual([]);
		expect((await future.stats()).kind).toBe('indexeddb-unsupported-version');
	});

	it('reports a full store as a result rather than throwing', async () =>
	{
		const tight = new IndexedDbProjectRepository({factory: createFakeIndexedDb({quotaBytes: 200})});

		const written = await tight.put(card('a', 'Kitchen', tick()), DESIGN.repeat(20));

		expect(written.ok).toBe(false);
		expect(written.reason).toBe(REASON_QUOTA);
		expect((await tight.stats()).failures).toBe(1);
	});

	it('reports a browser that will not open a database', async () =>
	{
		const shut = new IndexedDbProjectRepository({factory: createFakeIndexedDb({failOpen: true})});

		expect((await shut.put(card('a', 'x', tick()), DESIGN)).ok).toBe(false);
		expect(await shut.list()).toEqual([]);
		expect(await shut.read('a')).toBeNull();
	});

	it('has no factory at all, and says unavailable', async () =>
	{
		const none = new IndexedDbProjectRepository({factory: null});

		expect((await none.put(card('a', 'x', tick()), DESIGN)).reason).toBe(REASON_UNAVAILABLE);
		expect((await none.remove('a')).reason).toBe(REASON_UNAVAILABLE);
		expect((await none.rename('a', 'y', tick())).reason).toBe(REASON_UNAVAILABLE);
		await none.clear();
	});

	/**
	 * Y-6: there is deliberately no Web Storage fallback here.
	 *
	 * The draft has one because a draft is one document and fits in five
	 * megabytes. A library is many and does not, and one that silently held three
	 * designs and then began losing them would be worse than one that says so.
	 */
	it('is a stated absence rather than a degraded library', async () =>
	{
		const none = new UnavailableProjectRepository();

		expect(none.kind).toBe('unavailable');
		expect(await none.list()).toEqual([]);
		expect(await none.read('a')).toBeNull();
		expect((await none.put()).reason).toBe(REASON_UNAVAILABLE);
		expect((await none.rename()).reason).toBe(REASON_UNAVAILABLE);
		expect((await none.remove()).reason).toBe(REASON_UNAVAILABLE);
		await none.clear();
		expect(await none.stats()).toMatchObject({kind: 'unavailable', projects: 0, bytes: 0});
	});

	it('detects, and can be forced to the absence', () =>
	{
		expect(createProjectRepository({factory}).kind).toBe('indexeddb');
		expect(createProjectRepository({factory, unavailable: true}).kind).toBe('unavailable');
		expect(createProjectRepository({factory: null}).kind).toBe('unavailable');
	});
});

/**
 * Y-1, as an assertion rather than a note.
 *
 * The whole reason this is a second database: a `projects` store inside
 * `architect3d` would need version 2, and a build without it would then refuse
 * the draft permanently for the session. The library must be usable without
 * costing anybody their autosave.
 */
describe('Y-1 · the draft store is left where it was', () =>
{
	it('names a different database from the draft, at its own version', () =>
	{
		expect(DB_NAME).not.toBe(DRAFT_DB);
		expect(DRAFT_VERSION).toBe(1);
		expect(STORE_VERSION).toBe(1);
	});

	it('leaves a draft readable after the library has been used', async () =>
	{
		// One factory, both databases, as a browser has it.
		const draft = new IndexedDbDraftRepository({factory, legacyStorage: null});
		expect((await draft.put('{"floorplan":{},"items":[]}', tick())).ok).toBe(true);

		await library.put(card('a', 'Kitchen', tick()), DESIGN);
		await library.put(card('b', 'Loft', tick()), DESIGN);

		const back = await draft.read();
		expect(back).not.toBeNull();
		expect((await draft.stats()).kind).toBe('indexeddb');
	});
});

describe('stats say what the library holds', () =>
{
	it('counts projects and their bytes', async () =>
	{
		await library.put(card('a', 'One', tick(), {thumbnail: 'data:image/webp;base64,' + 'A'.repeat(500)}), DESIGN);
		await library.put(card('b', 'Two', tick()), DESIGN);

		const stats = await library.stats();

		expect(stats).toMatchObject({kind: 'indexeddb', projects: 2, writes: 2, failures: 0});
		// Documents and thumbnails together, so the number means what a person
		// would guess it means.
		expect(stats.bytes).toBeGreaterThan(500 + DESIGN.length * 2);
	});
});

describe('names', () =>
{
	it('collapses, trims and clips what a person typed', () =>
	{
		expect(cleanName('  Loft   conversion  ')).toBe('Loft conversion');
		expect(cleanName('')).toBe('Untitled design');
		expect(cleanName('   ')).toBe('Untitled design');
		expect(cleanName(null, 'Kitchen')).toBe('Kitchen');
		expect(cleanName('x'.repeat(400))).toHaveLength(MAX_NAME_LENGTH);
	});

	it('numbers a copy rather than repeating a name', () =>
	{
		expect(copyName('Kitchen', [])).toBe('Kitchen copy');
		expect(copyName('Kitchen', ['Kitchen copy'])).toBe('Kitchen copy 2');
		expect(copyName('Kitchen', ['Kitchen copy', 'Kitchen copy 2'])).toBe('Kitchen copy 3');
	});

	it('makes ids that sort in creation order', () =>
	{
		const early = projectId(1_700_000_000_000, () => 0.1);
		const late = projectId(1_700_000_001_000, () => 0.9);

		expect(early < late).toBe(true);
		expect(projectId(1, () => 0.5)).not.toBe(projectId(1, () => 0.6));
	});
});
