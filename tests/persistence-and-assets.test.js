// @vitest-environment jsdom
/**
 * Where the draft lives, and where the assets come from (RM-003 A5).
 *
 * ## Two findings, one sprint, and they do not overlap
 *
 * **M-9 / K-6.** `useAutosave` wrote the whole design to `localStorage` on a
 * two-second debounce and again on `pagehide`. Web Storage is synchronous and
 * capped at about 5 MiB, so that was a main-thread block during editing *and* a
 * ceiling a furnished design can hit - and the first `QuotaExceededError`
 * disabled autosave for the rest of the session. Moving to IndexedDB removes
 * both and creates one: `pagehide` cannot await a promise.
 *
 * **H-8.** Every asset URL is a bare relative string, and those strings are
 * *inside saved designs*. Vite never hashes `public/`, so the obvious fix is
 * unavailable and the indirection has to be at runtime.
 *
 * ## What is here and what is in the browser tier
 *
 * jsdom has `localStorage` and no `indexedDB`. That split is useful rather than
 * awkward: this file proves the interface, the fallback, the pointer arithmetic,
 * the manifest and the resolver - all of which are logic - and
 * `tests/browser/draft-storage.test.js` proves the IndexedDB implementation
 * against a real one, including the 5 MiB design that is the whole point.
 *
 * The fallback being what jsdom selects is itself the compatibility claim: the
 * pre-A5 autosave assertions in `app-workspace.test.js` were left alone, and
 * they still pass, because a build with no IndexedDB behaves exactly as it did.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
	LocalStorageDraftRepository, IndexedDbDraftRepository, createDraftRepository,
	byteLength, classify, LEGACY_STORAGE_KEY,
	REASON_QUOTA, REASON_UNAVAILABLE, REASON_VERSION, REASON_ERROR,
} from '../src/app/persistence/draft_repository.js';
import {
	writePointer, readPointer, clearPointer, compareRecovery, POINTER_KEY, POINTER_LIMIT_BYTES,
	RECOVERY_COMPLETE, RECOVERY_LOST_TAIL, RECOVERY_MISSING, RECOVERY_NONE,
} from '../src/app/persistence/recovery_pointer.js';
import {AssetManifest, MANIFEST_VERSION} from '../src/scripts/core/asset_manifest.js';
import {AssetResolver, defaultAssetResolver} from '../src/scripts/core/asset_resolver.js';
import {DesignRuntime, defaultRuntime} from '../src/scripts/core/design_runtime.js';
import {Model} from '../src/scripts/model/model.js';
import {resetAll} from './helpers/harness.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

/**
 * A `Storage` that behaves, with a size cap and a switch for refusing outright.
 *
 * Written rather than reached for because the two failure modes that matter -
 * a quota refusal and a store that throws on every call - are exactly what
 * jsdom's real localStorage will not do on request, and they are the two the
 * repository's error handling exists for.
 */
function fakeStorage(options)
{
	const settings = options || {};
	const entries = new Map();
	return {
		fail: settings.fail || null,
		limit: settings.limit || Infinity,
		getItem(key)
		{
			if (this.fail === 'read') { throw new Error('no'); }
			return entries.has(key) ? entries.get(key) : null;
		},
		setItem(key, value)
		{
			if (this.fail === 'write')
			{
				const error = new Error('nope');
				error.name = 'SecurityError';
				throw error;
			}
			// The old value counts against the new one, which is the pessimistic
			// reading and the one that makes pruning necessary. Browsers differ on
			// this; a fake that took the generous view would never exercise the
			// retry path the repository has for it.
			let total = value.length;
			entries.forEach((existing) => {total += existing.length;});
			if (total > this.limit)
			{
				const error = new Error('full');
				error.name = 'QuotaExceededError';
				throw error;
			}
			entries.set(key, value);
		},
		removeItem(key) {entries.delete(key);},
		get size() {return entries.size;},
		raw: entries,
	};
}

beforeEach(() =>
{
	resetAll();
	window.localStorage.clear();
});

afterEach(() =>
{
	window.localStorage.clear();
});

describe('the repository interface', () =>
{
	it('measures bytes in UTF-8, not code units', () =>
	{
		// The number is compared against a storage quota, and a quota is bytes.
		expect(byteLength('abc')).toBe(3);
		expect(byteLength('é')).toBe(2);
		expect(byteLength('😀')).toBe(4);
	});

	it('tells a full store from a broken one', () =>
	{
		const full = new Error('x');
		full.name = 'QuotaExceededError';
		expect(classify(full)).toBe(REASON_QUOTA);

		const firefox = new Error('x');
		firefox.name = 'NS_ERROR_DOM_QUOTA_REACHED';
		expect(classify(firefox)).toBe(REASON_QUOTA);

		const old = {code: 22};
		expect(classify(old)).toBe(REASON_QUOTA);

		const newer = new Error('x');
		newer.name = 'VersionError';
		expect(classify(newer)).toBe(REASON_VERSION);

		expect(classify(new Error('something else'))).toBe(REASON_ERROR);
		expect(classify(null)).toBe(REASON_ERROR);
	});

	it('jsdom has no IndexedDB, so detection picks the fallback', () =>
	{
		// Which is the compatibility claim, not a limitation of the test: the
		// pre-A5 autosave assertions still pass because this is what they run on.
		expect(window.indexedDB).toBeUndefined();
		expect(createDraftRepository().kind).toBe('localStorage');
	});

	it('and the rollback switch forces it even where IndexedDB exists', () =>
	{
		const factory = {open() {throw new Error('should not be called');}};
		expect(createDraftRepository({factory}).kind).toBe('indexeddb');
		expect(createDraftRepository({factory, preferLocalStorage: true}).kind).toBe('localStorage');
	});
});

describe('the localStorage repository', () =>
{
	it('round-trips a draft under the key the pre-A5 build used', async () =>
	{
		const repository = new LocalStorageDraftRepository({storage: window.localStorage});
		const result = await repository.put('{"floorplan":{}}', 1700000000000);

		expect(result.ok).toBe(true);
		expect(result.bytes).toBeGreaterThan(0);
		// The exact key matters: a draft written by the old build has to be
		// readable by this one, and that is the only thing that makes it so.
		expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeTruthy();

		const draft = await repository.read();
		expect(draft.design).toBe('{"floorplan":{}}');
		expect(draft.savedAt).toBe(1700000000000);
	});

	it('reports an unparseable record as no draft', async () =>
	{
		const repository = new LocalStorageDraftRepository({storage: window.localStorage});
		window.localStorage.setItem(LEGACY_STORAGE_KEY, 'not json');
		expect(await repository.read()).toBeNull();

		window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({design: 7, savedAt: 1}));
		expect(await repository.read()).toBeNull();
	});

	it('prunes once and retries before giving up on a full store', async () =>
	{
		// Task 4's rule. The slot being overwritten is the largest thing this app
		// stores, so a store that counts the old value against the new one accepts
		// the write after it goes - and that is worth one retry.
		const storage = fakeStorage({limit: 200});
		const repository = new LocalStorageDraftRepository({storage});

		expect((await repository.put('a'.repeat(120), 1)).ok).toBe(true);
		const second = await repository.put('b'.repeat(150), 2);

		expect(second.ok).toBe(true);
		expect(second.pruned).toBe(true);
		expect((await repository.stats()).pruned).toBe(1);
		expect((await repository.read()).design).toBe('b'.repeat(150));
	});

	it('and reports a refusal rather than throwing when pruning is not enough', async () =>
	{
		const storage = fakeStorage({limit: 50});
		const repository = new LocalStorageDraftRepository({storage});

		const result = await repository.put('c'.repeat(500), 1);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_QUOTA);
		expect(result.pruned).toBe(true);
		expect((await repository.stats()).failures).toBe(1);
	});

	it('reports a store that refuses everything as unavailable, not as an error', async () =>
	{
		const repository = new LocalStorageDraftRepository({storage: null});
		const result = await repository.put('{}', 1);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_UNAVAILABLE);
		expect(await repository.read()).toBeNull();
	});

	it('is honest about M-9: it reports the whole document as a synchronous write', async () =>
	{
		// The number the metric exists to move, measured on the implementation it
		// is being moved away from. A repository that under-reported this would
		// make the improvement unprovable.
		const repository = new LocalStorageDraftRepository({storage: window.localStorage});
		await repository.put('x'.repeat(4096), 1);

		const stats = await repository.stats();
		expect(stats.kind).toBe('localStorage');
		expect(stats.syncBytes).toBeGreaterThan(4096);
		expect(stats.writes).toBe(1);
	});
});

describe('the IndexedDB repository, where there is no IndexedDB', () =>
{
	it('reports unavailable rather than throwing', async () =>
	{
		const repository = new IndexedDbDraftRepository({factory: null, legacyStorage: null});
		expect((await repository.put('{}', 1)).reason).toBe(REASON_UNAVAILABLE);
		expect(await repository.read()).toBeNull();
		await expect(repository.clear()).resolves.toBeUndefined();
	});

	it('adopts a pre-A5 draft out of localStorage, once', async () =>
	{
		// The compatibility path: a user who reloads into this build should not
		// lose the draft the old one left. The original is removed, so the two
		// stores never both hold one and "which is newer" never has to be asked.
		window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
			design: '{"legacy":true}',
			savedAt: 1700000000000,
		}));

		const repository = new IndexedDbDraftRepository({factory: null, legacyStorage: window.localStorage});
		const adopted = await repository.read();

		expect(adopted.design).toBe('{"legacy":true}');
		expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
		// And it is gone from the legacy slot, so a second read finds nothing
		// there to adopt again.
		expect(await repository.read()).toBeNull();
	});

	it('and treats an unparseable legacy record as no draft', async () =>
	{
		window.localStorage.setItem(LEGACY_STORAGE_KEY, 'not a draft');
		const repository = new IndexedDbDraftRepository({factory: null, legacyStorage: window.localStorage});
		expect(await repository.read()).toBeNull();
	});

	it('reports zero synchronous bytes - but that claim is made properly in the browser tier', async () =>
	{
		// Honest about what this can and cannot show. With no IndexedDB the write
		// never succeeds, so a zero here is also what a dishonest implementation
		// would report: nothing was written, rather than nothing was written
		// synchronously.
		//
		// Found by deliberately breaking it. Changing this repository's `syncBytes`
		// to report the body size failed NOTHING in this file and failed the
		// browser tier immediately - `tests/browser/draft-storage.test.js` writes
		// six megabytes through a real IndexedDB and asserts zero against it. M-9
		// is gated there; what is asserted here is the unavailable path.
		const repository = new IndexedDbDraftRepository({factory: null, legacyStorage: null});
		const result = await repository.put('x'.repeat(100000), 1);

		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_UNAVAILABLE);
		expect((await repository.stats()).syncBytes).toBe(0);
		expect((await repository.stats()).bytes).toBe(0);
	});
});

describe('the IndexedDB repository, against a fake factory', () =>
{
	// The branches a real IndexedDB will not produce on request: a quota refusal
	// at a chosen size, a store already at a newer version, an open that fails
	// outright. `tests/browser/draft-storage.test.js` runs the same class against
	// chromium's real one, including a six-megabyte design. See
	// tests/helpers/indexeddb.js for why both exist.

	it('round-trips a draft, and reports zero synchronous bytes doing it', async () =>
	{
		const factory = createFakeIndexedDb();
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		const result = await repository.put('{"floorplan":{}}', 1700000000000);
		expect(result.ok).toBe(true);
		expect(result.reason).toBeNull();
		expect(result.bytes).toBe(16);

		const draft = await repository.read();
		expect(draft.design).toBe('{"floorplan":{}}');
		expect(draft.savedAt).toBe(1700000000000);

		const stats = await repository.stats();
		expect(stats.kind).toBe('indexeddb');
		expect(stats.writes).toBe(1);
		expect(stats.syncBytes).toBe(0);
		expect(stats.bytes).toBe(16);
	});

	it('overwrites the one slot', async () =>
	{
		const factory = createFakeIndexedDb();
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		await repository.put('{"first":true}', 1);
		await repository.put('{"second":true}', 2);
		expect((await repository.read()).design).toBe('{"second":true}');

		await repository.clear();
		expect(await repository.read()).toBeNull();
	});

	it('prunes once and retries when the store is full', async () =>
	{
		const factory = createFakeIndexedDb({quotaBytes: 400});
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		expect((await repository.put('a'.repeat(200), 1)).ok).toBe(true);
		const second = await repository.put('b'.repeat(300), 2);

		expect(second.ok).toBe(true);
		expect(second.pruned).toBe(true);
		expect((await repository.stats()).pruned).toBe(1);
		expect((await repository.read()).design).toBe('b'.repeat(300));
	});

	it('and reports a refusal when pruning is not enough', async () =>
	{
		const factory = createFakeIndexedDb({quotaBytes: 100});
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		const result = await repository.put('c'.repeat(5000), 1);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_QUOTA);
		expect(result.pruned).toBe(true);
	});

	it('leaves a store from a newer build alone, and names the version it found', async () =>
	{
		const factory = createFakeIndexedDb({version: 7});
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		const result = await repository.put('{"mine":true}', 1);
		expect(result.ok).toBe(false);
		expect(result.reason).toBe(REASON_VERSION);
		expect((await repository.stats()).kind).toBe('indexeddb-unsupported-version');

		// And nothing was written into it.
		expect(await repository.read()).toBeNull();
	});

	it('treats an open that fails as no draft rather than an exception', async () =>
	{
		const factory = createFakeIndexedDb({failOpen: true});
		const repository = new IndexedDbDraftRepository({factory, legacyStorage: null});

		expect((await repository.put('{}', 1)).ok).toBe(false);
		expect(await repository.read()).toBeNull();
		await expect(repository.clear()).resolves.toBeUndefined();
	});

	it('copies an adopted legacy draft into the store, not just past it', async () =>
	{
		window.localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
			design: '{"legacy":true}',
			savedAt: 1700000000000,
		}));
		const factory = createFakeIndexedDb();

		const first = new IndexedDbDraftRepository({factory, legacyStorage: window.localStorage});
		expect((await first.read()).design).toBe('{"legacy":true}');

		// A second repository with no legacy store to look at still finds it,
		// which is what makes this a migration rather than a passthrough.
		const second = new IndexedDbDraftRepository({factory, legacyStorage: null});
		expect((await second.read()).design).toBe('{"legacy":true}');
	});
});

describe('the recovery pointer', () =>
{
	it('is written, read back, and stays under a kilobyte', () =>
	{
		const size = writePointer({savedAt: 1700000000000, bytes: 9_000_000, store: 'indexeddb'});

		expect(size).toBeGreaterThan(0);
		// The acceptance criterion, checked rather than asserted in prose. The
		// body it points at may be nine megabytes; the pointer is not.
		expect(size).toBeLessThan(POINTER_LIMIT_BYTES);

		const pointer = readPointer();
		expect(pointer.savedAt).toBe(1700000000000);
		expect(pointer.bytes).toBe(9_000_000);
		expect(pointer.store).toBe('indexeddb');
	});

	it('survives a storage that refuses, without taking the write with it', () =>
	{
		const storage = fakeStorage({fail: 'write'});
		expect(writePointer({savedAt: 1, bytes: 2, store: 'x'}, storage)).toBe(0);
	});

	it('reads an unparseable pointer as no pointer', () =>
	{
		window.localStorage.setItem(POINTER_KEY, 'not json');
		expect(readPointer()).toBeNull();

		window.localStorage.setItem(POINTER_KEY, JSON.stringify({bytes: 1}));
		expect(readPointer()).toBeNull();
	});

	it('detects the tail that did not land, which is the whole of K-6', () =>
	{
		// The case the pointer exists for: `pagehide` started a write, the pointer
		// recorded the timestamp it was going to carry, and the body never
		// arrived. The draft is still restorable - it is just older than the user
		// thinks, and this is what lets the offer say so.
		const pointer = {savedAt: 1700000060000, bytes: 100, store: 'indexeddb'};
		const draft = {design: '{}', savedAt: 1700000000000};

		const result = compareRecovery(pointer, draft);
		expect(result.state).toBe(RECOVERY_LOST_TAIL);
		expect(result.lostMs).toBe(60000);
	});

	it('and reports a landed write, an orphan pointer, and nothing at all', () =>
	{
		const draft = {design: '{}', savedAt: 1700000000000};

		expect(compareRecovery({savedAt: 1700000000000, bytes: 1, store: 'x'}, draft).state)
			.toBe(RECOVERY_COMPLETE);
		// No pointer is not a discrepancy: a background write clears it precisely
		// so that it cannot become one.
		expect(compareRecovery(null, draft).state).toBe(RECOVERY_COMPLETE);
		expect(compareRecovery({savedAt: 1, bytes: 1, store: 'x'}, null).state).toBe(RECOVERY_MISSING);
		expect(compareRecovery(null, null).state).toBe(RECOVERY_NONE);
	});

	it('clears', () =>
	{
		writePointer({savedAt: 1, bytes: 1, store: 'x'});
		expect(readPointer()).toBeTruthy();
		clearPointer();
		expect(readPointer()).toBeNull();
	});
});

// --- the asset half --------------------------------------------------------

/** A manifest document in the shape the generator writes. */
function manifestJson(assets)
{
	return {version: MANIFEST_VERSION, assets: assets};
}

describe('the asset manifest', () =>
{
	it('reads the generated shape, defaulting url to the logical name', () =>
	{
		const result = AssetManifest.parse(manifestJson({
			'models/js-glb/chair.glb': {bytes: 1234, hash: 'sha256-abc', kind: 'model'},
		}));

		expect(result.ok).toBe(true);
		const entry = result.manifest.entry('models/js-glb/chair.glb');
		// Omitted in the file because they are equal today. That they CAN differ
		// is the entire mechanism.
		expect(entry.url).toBe('models/js-glb/chair.glb');
		expect(entry.bytes).toBe(1234);
		expect(entry.hash).toBe('sha256-abc');
		expect(entry.kind).toBe('model');
	});

	it('and honours a url that differs, which is the point', () =>
	{
		const result = AssetManifest.parse(manifestJson({
			'models/js-glb/chair.glb': {url: 'models/js-glb/chair.9f2c1a.glb', bytes: 1, kind: 'model'},
		}));
		expect(result.manifest.entry('models/js-glb/chair.glb').url).toBe('models/js-glb/chair.9f2c1a.glb');
	});

	it('refuses a version it does not know, rather than reading it hopefully', () =>
	{
		// A manifest at an unknown version may mean something different by the
		// same field names, and resolving a model URL from a guess is how a design
		// opens with the wrong furniture in it.
		const result = AssetManifest.parse({version: 99, assets: {'a': {bytes: 1}}});
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('99');
		expect(result.manifest.count).toBe(0);
	});

	it('degrades to empty on anything malformed, and never throws', () =>
	{
		[null, 'not json {', '[]', JSON.stringify({version: 1}), 7].forEach((bad) =>
		{
			const result = AssetManifest.parse(bad);
			expect(result.ok).toBe(false);
			expect(result.manifest.count).toBe(0);
		});
	});

	it('sums and sorts, which is what a prefetch budget needs', () =>
	{
		const {manifest} = AssetManifest.parse(manifestJson({
			'a.glb': {bytes: 100, kind: 'model'},
			'b.glb': {bytes: 300, kind: 'model'},
			'c.png': {bytes: 50, kind: 'texture'},
		}));

		expect(manifest.count).toBe(3);
		expect(manifest.totalBytes).toBe(450);
		expect(manifest.ofKind('model').map((entry) => entry.name)).toEqual(['b.glb', 'a.glb']);
		expect(manifest.names()).toContain('c.png');
	});
});

describe('the asset resolver', () =>
{
	it('resolves every name to itself when it knows nothing', () =>
	{
		// The pre-A5 behaviour, which is what the library ships with and what an
		// embedder who configures nothing keeps.
		const resolver = new AssetResolver();
		expect(resolver.manifested).toBe(false);
		expect(resolver.resolve('models/js-glb/chair.glb').url).toBe('models/js-glb/chair.glb');
		expect(resolver.resolve('rooms/textures/hardwood.png').url).toBe('rooms/textures/hardwood.png');
	});

	it('follows a manifest to a different physical URL', () =>
	{
		const {manifest} = AssetManifest.parse(manifestJson({
			'models/js-glb/chair.glb': {url: 'models/js-glb/chair.9f2c1a.glb', bytes: 42, hash: 'sha256-z', kind: 'model'},
		}));
		const resolver = new AssetResolver({manifest});

		const resolution = resolver.resolve('models/js-glb/chair.glb');
		expect(resolution.url).toBe('models/js-glb/chair.9f2c1a.glb');
		expect(resolution.known).toBe(true);
		expect(resolution.bytes).toBe(42);
		// The logical name is unchanged, which is what makes the saved design
		// portable across deployments.
		expect(resolution.name).toBe('models/js-glb/chair.glb');
	});

	it('prepends a base, adding the slash nobody remembers', () =>
	{
		const resolver = new AssetResolver({base: 'https://cdn.example.com/a3d'});
		expect(resolver.base).toBe('https://cdn.example.com/a3d/');
		expect(resolver.resolve('models/x.glb').url).toBe('https://cdn.example.com/a3d/models/x.glb');

		resolver.setBase('https://other.example/');
		expect(resolver.resolve('models/x.glb').url).toBe('https://other.example/models/x.glb');
	});

	it('reports a miss only when there was a manifest to miss', () =>
	{
		// The asymmetry that keeps the availability policy from rejecting every
		// load in a build that ships no manifest.
		const bare = new AssetResolver();
		expect(bare.missing('anything')).toBe(false);
		bare.resolve('anything');
		expect(bare.stats().misses).toBe(0);

		const {manifest} = AssetManifest.parse(manifestJson({'known.glb': {bytes: 1, kind: 'model'}}));
		const informed = new AssetResolver({manifest});
		expect(informed.missing('known.glb')).toBe(false);
		expect(informed.missing('gone.glb')).toBe(true);
		informed.resolve('gone.glb');
		expect(informed.stats().misses).toBe(1);
	});

	it('hands over an integrity string and applies it to nothing', () =>
	{
		// Recorded and available, not switched on. For same-origin public/ the
		// hash guards nothing the origin does not already guarantee, and a
		// mismatch after a legitimate redeploy of an unhashed file is an outage.
		const {manifest} = AssetManifest.parse(manifestJson({
			'a.glb': {bytes: 1, hash: 'sha256-Zm9v', kind: 'model'},
			'b.glb': {bytes: 1, kind: 'model'},
		}));
		const resolver = new AssetResolver({manifest});

		expect(resolver.integrityFor('a.glb')).toBe('sha256-Zm9v');
		expect(resolver.integrityFor('b.glb')).toBeNull();
		expect(resolver.integrityFor('missing.glb')).toBeNull();
	});

	it('preloads within a byte budget, and counts the hit when the load comes', async () =>
	{
		const fetched = [];
		const {manifest} = AssetManifest.parse(manifestJson({
			'small.glb': {bytes: 100, kind: 'model'},
			'big.glb': {bytes: 10_000, kind: 'model'},
		}));
		const resolver = new AssetResolver({
			manifest,
			fetch: (url) => {fetched.push(url); return Promise.resolve({ok: true});},
		});

		const result = await resolver.preload(['small.glb', 'big.glb'], {maxBytes: 1000});
		expect(fetched).toEqual(['small.glb']);
		expect(result.requested).toBe(1);
		expect(result.bytes).toBe(100);
		expect(result.skipped).toBe(1);

		// And the point of having warmed it: the resolution that follows is a hit.
		expect(resolver.stats().preloadHits).toBe(0);
		resolver.resolve('small.glb');
		expect(resolver.stats().preloadHits).toBe(1);
		resolver.resolve('big.glb');
		expect(resolver.stats().preloadHits).toBe(1);
	});

	it('never warms the same thing twice, and swallows a failed prefetch', async () =>
	{
		let calls = 0;
		const {manifest} = AssetManifest.parse(manifestJson({'a.glb': {bytes: 1, kind: 'model'}}));
		const resolver = new AssetResolver({
			manifest,
			fetch: () => {calls += 1; return Promise.reject(new Error('404'));},
		});

		// A prefetch that 404s costs nothing - the real load will report it where
		// the user is waiting and a message is worth showing.
		await expect(resolver.preload(['a.glb'])).resolves.toBeTruthy();
		expect(calls).toBe(1);

		await resolver.preload(['a.glb']);
		expect(calls).toBe(1);
	});

	it('does nothing at all without a fetch, rather than throwing', async () =>
	{
		const resolver = new AssetResolver({fetch: null});
		// Not the environment's fetch either: pass one that would fail loudly.
		const result = await resolver.preload([]);
		expect(result.requested).toBe(0);
	});
});

describe('the runtime holds the resolver', () =>
{
	it('and defaults to the shared identity one, as A4 said it would', () =>
	{
		expect(defaultRuntime.assets).toBe(defaultAssetResolver);
		expect(new DesignRuntime().assets).toBe(defaultAssetResolver);
		expect(defaultAssetResolver.resolve('models/x.glb').url).toBe('models/x.glb');
	});

	it('a document can have one of its own without moving the page-wide one', () =>
	{
		const {manifest} = AssetManifest.parse(manifestJson({'models/x.glb': {url: 'cdn/x.glb', bytes: 1, kind: 'model'}}));
		const own = new DesignRuntime({assets: new AssetResolver({manifest, base: 'https://cdn.test'})});

		expect(own.assets.resolve('models/x.glb').url).toBe('https://cdn.test/cdn/x.glb');
		expect(defaultAssetResolver.resolve('models/x.glb').url).toBe('models/x.glb');
	});

	it('and reports it in stats(), which is where a leak or a miss shows up', () =>
	{
		const runtime = new DesignRuntime({assets: new AssetResolver({base: 'https://cdn.test'})});
		runtime.assets.resolve('models/x.glb');

		const stats = runtime.stats().assets;
		expect(stats.base).toBe('https://cdn.test/');
		expect(stats.resolutions).toBe(1);
		expect(stats.manifested).toBe(false);
	});
});

describe('the application collects the manifest', () =>
{
	it('installs it, and reports what it installed', async () =>
	{
		const {loadManifest, assetResolver} = await import('../src/app/composables/useAssets.js');
		const body = manifestJson({'models/a.glb': {url: 'cdn/a.glb', bytes: 5, kind: 'model'}});

		const result = await loadManifest({
			url: 'asset-manifest.json',
			fetch: () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(body)}),
		});

		expect(result.ok).toBe(true);
		expect(result.count).toBe(1);
		expect(assetResolver().resolve('models/a.glb').url).toBe('cdn/a.glb');
		assetResolver().setManifest(null);
	});

	it('and leaves the resolver as identity when it does not arrive', async () =>
	{
		// The rule that keeps a metadata file from becoming an outage: everything
		// still loads, because in this deployment the logical names ARE the URLs.
		// What is lost is the availability check and the prefetching, both of
		// which are improvements over a baseline that works.
		const {loadManifest, assetResolver} = await import('../src/app/composables/useAssets.js');

		const notFound = await loadManifest({fetch: () => Promise.resolve({ok: false, status: 404})});
		expect(notFound.ok).toBe(false);
		expect(notFound.errors[0]).toContain('404');

		const threw = await loadManifest({fetch: () => Promise.reject(new Error('offline'))});
		expect(threw.ok).toBe(false);
		expect(threw.errors[0]).toBe('offline');

		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const malformed = await loadManifest({
			fetch: () => Promise.resolve({ok: true, status: 200, json: () => Promise.resolve({version: 99})}),
		});
		expect(malformed.ok).toBe(false);
		warned.mockRestore();

		expect(assetResolver().manifested).toBe(false);
		expect(assetResolver().resolve('models/a.glb').url).toBe('models/a.glb');
	});

	it('honours ?assetBase= on the URL, which is how a CDN is checkable', async () =>
	{
		const {applyAssetBaseFromQuery, assetResolver} = await import('../src/app/composables/useAssets.js');

		expect(applyAssetBaseFromQuery('')).toBeNull();
		expect(applyAssetBaseFromQuery('?other=1')).toBeNull();

		expect(applyAssetBaseFromQuery('?assetBase=https://cdn.test/a3d')).toBe('https://cdn.test/a3d/');
		expect(assetResolver().resolve('models/a.glb').url).toBe('https://cdn.test/a3d/models/a.glb');

		assetResolver().setBase('');
	});

	it('prefetches a hovered item once, within a ceiling', async () =>
	{
		const {useAssets, assetResolver, HOVER_PREFETCH_MAX_BYTES} = await import('../src/app/composables/useAssets.js');
		const assets = useAssets();

		// No fetch is injected here, so the resolver falls back to the
		// environment's - which jsdom does provide and which would reach the
		// network. The guard is that a nameless entry never gets that far.
		await assets.prefetchItem(null);
		await assets.prefetchItem({});
		expect(assetResolver().stats().preloaded).toBe(0);
		expect(HOVER_PREFETCH_MAX_BYTES).toBeGreaterThan(1024 * 1024);
	});
});

describe('the load path goes through the resolver', () =>
{
	/** A model, as a saved design with one item in it. */
	const DESIGN = JSON.stringify({
		floorplan: {corners: {}, walls: [], rooms: {}, units: 'cm', version: '2.0.0'},
		items: [{
			item_name: 'Chair', item_type: 1, model_url: 'models/js-glb/chair.glb',
			format: 'gltf', xpos: 0, ypos: 0, zpos: 0,
		}],
	});

	it('loads from the physical URL and saves the logical one', async () =>
	{
		// The whole of H-8 in one assertion. What the browser fetches moves; what
		// the document records does not, because that string is on other people's
		// disks.
		const {manifest} = AssetManifest.parse(manifestJson({
			'models/js-glb/chair.glb': {url: 'models/js-glb/chair.9f2c1a.glb', bytes: 1, kind: 'model'},
		}));
		const runtime = new DesignRuntime({assets: new AssetResolver({manifest, base: 'https://cdn.test'})});
		const model = new Model('/textures/', runtime);

		const asked = [];
		model.scene.setItemLoader((fileName) => {asked.push(fileName);});
		model.loadSerialized(DESIGN);

		// The seam is handed the LOGICAL name - an embedder's own loader is their
		// asset pipeline and a resolver they did not configure must not rewrite
		// what reaches it. The resolution is asserted directly instead.
		expect(asked).toEqual(['models/js-glb/chair.glb']);
		expect(runtime.assets.resolve('models/js-glb/chair.glb').url)
			.toBe('https://cdn.test/models/js-glb/chair.9f2c1a.glb');
	});

	it('refuses a name the manifest does not declare, before touching the network', async () =>
	{
		// Availability as a policy rather than a console line. The failure comes
		// back through the ordinary EVENT_ITEM_LOADED path, so every listener
		// counting loads in flight stays balanced.
		const {manifest} = AssetManifest.parse(manifestJson({'models/js-glb/other.glb': {bytes: 1, kind: 'model'}}));
		const runtime = new DesignRuntime({assets: new AssetResolver({manifest})});
		const model = new Model('/textures/', runtime);

		const warned = vi.spyOn(console, 'error').mockImplementation(() => {});
		let asked = 0;
		model.scene.setItemLoader(() => {asked += 1;});
		model.loadSerialized(DESIGN);

		expect(asked).toBe(0);
		expect(model.scene.unloadableItemCount).toBe(1);
		expect(warned.mock.calls[0][0]).toContain('does not ship that asset');
		// And the session is settled, so a caller counting loads is not left
		// waiting on one that will never come back.
		expect(model.scene.loadSession.settled).toBe(true);
		warned.mockRestore();
	});

	it('and loads everything when there is no manifest, which is the default', () =>
	{
		const model = new Model('/textures/');
		let asked = 0;
		model.scene.setItemLoader(() => {asked += 1;});
		model.loadSerialized(DESIGN);

		expect(asked).toBe(1);
		expect(model.scene.unloadableItemCount).toBe(0);
	});
});
