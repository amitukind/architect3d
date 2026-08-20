/**
 * What the service worker keeps (RM-013 K3).
 *
 * The worker itself is twenty lines of `addEventListener` and cannot be run
 * here; every decision it makes is in these two modules and is exercised
 * exhaustively, which is what makes excluding `src/app/sw.js` from coverage an
 * honest exclusion rather than a hole.
 *
 * The fakes are a cache and a `fetch`. Neither is the subject: what is under
 * test is which of them gets asked, in which order, and what happens when one
 * of them says no.
 */
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
	strategyFor, worthKeeping, staleCaches, shellAssets, CACHE_NAME, CACHE_VERSION,
	NETWORK_FIRST, CACHE_FIRST, STALE_WHILE_REVALIDATE, PASS_THROUGH,
} from '../src/app/offline/cache_policy.js';
import {respondTo, precacheShell} from '../src/app/offline/respond.js';

const ORIGIN = 'https://amitukind.github.io';
const BASE = `${ORIGIN}/architect3d/`;

/** A request, in the shape `respondTo` reads. */
function request(url, options)
{
	const settings = options || {};
	return {
		url, method: settings.method || 'GET', mode: settings.mode || 'no-cors',
		headers: {get: (name) => (name === 'range' ? (settings.range || null) : null)},
	};
}

/**
 * A response that can be cloned, like a real one.
 *
 * `text()` is on the clone as well as the original, because that is where a
 * real one has it - `precacheShell` reads the document off `clone()` precisely
 * so the body it caches is still unread, and a fake without it would have made
 * that correct code look broken.
 */
function response(body, options)
{
	const settings = options || {};
	return {
		body, status: settings.status === undefined ? 200 : settings.status,
		type: settings.type || 'basic',
		async text() {return String(body);},
		clone() {return response(body, settings);},
	};
}

/**
 * A cache that records what it was asked to do.
 *
 * Keys off a `Request` or a plain URL, like the real one: `respondTo` matches
 * on a request and `precacheShell` puts under a string, and a fake that
 * accepted only one of those would fail correct code.
 */
function fakeCache(seed)
{
	const store = new Map(Object.entries(seed || {}));
	const key = (req) => (typeof req === 'string' ? req : req.url);
	return {
		store,
		puts: [],
		async match(req) {return store.get(key(req)) || null;},
		async put(req, value) {this.puts.push(key(req)); store.set(key(req), value);},
	};
}

function fakeCaches(cache)
{
	return {
		opened: 0,
		async open() {this.opened += 1; return cache;},
	};
}

describe('which strategy a URL gets', () =>
{
	it('serves the document from the network first, so a deploy is picked up', () =>
	{
		expect(strategyFor({url: BASE, mode: 'navigate'}, ORIGIN)).toBe(NETWORK_FIRST);
	});

	it('serves a content-addressed asset from the cache, forever', () =>
	{
		// The hash is what makes this safe: a changed file cannot reuse a URL.
		expect(strategyFor({url: `${BASE}assets/index-BUHeTH6a.js`}, ORIGIN)).toBe(CACHE_FIRST);
		expect(strategyFor({url: `${BASE}assets/index-DfMuPn0A.css`}, ORIGIN)).toBe(CACHE_FIRST);
		expect(strategyFor({url: `${BASE}assets/design_bundle-CUSr4cTl.js`}, ORIGIN)).toBe(CACHE_FIRST);
	});

	it('does not mistake an unhashed file in assets/ for a hashed one', () =>
	{
		expect(strategyFor({url: `${BASE}assets/index.js`}, ORIGIN)).toBe(STALE_WHILE_REVALIDATE);
		expect(strategyFor({url: `${BASE}assets/thing-short.js`}, ORIGIN)).toBe(STALE_WHILE_REVALIDATE);
	});

	it('refreshes everything else behind the copy it serves', () =>
	{
		// These keep their names across deploys, so they CAN go stale - which is
		// the whole difference from the hashed ones above.
		for (const path of ['models/gltf/chair.glb', 'catalog/kenney-food-kit.json',
			'templates/studio.blueprint3d', 'asset-manifest.json', 'rooms/textures/wallmap.png',
			'basis/basis_transcoder.wasm'])
		{
			expect(strategyFor({url: BASE + path}, ORIGIN), path).toBe(STALE_WHILE_REVALIDATE);
		}
	});

	it('leaves alone what is not ours to cache', () =>
	{
		// A POST is not a thing to remember; a range wants a range; a CDN has its
		// own rules and `?assetBase=` is how somebody points at one.
		expect(strategyFor({url: BASE, method: 'POST', mode: 'navigate'}, ORIGIN)).toBe(PASS_THROUGH);
		expect(strategyFor({url: `${BASE}models/x.glb`, range: 'bytes=0-99'}, ORIGIN)).toBe(PASS_THROUGH);
		expect(strategyFor({url: 'https://cdn.example.test/models/x.glb'}, ORIGIN)).toBe(PASS_THROUGH);
		expect(strategyFor({url: 'not a url at all'}, ORIGIN)).toBe(PASS_THROUGH);
	});

	/**
	 * 36 % of this deploy is source maps - 7.4 MB across eight files - and the
	 * only thing that asks for one is a devtools panel somebody opened. Caching
	 * them would roughly triple what an offline copy costs to hold.
	 */
	it('never stores a source map', () =>
	{
		expect(strategyFor({url: `${BASE}assets/index-BUHeTH6a.js.map`}, ORIGIN)).toBe(PASS_THROUGH);
	});
});

describe('what is worth keeping', () =>
{
	it('keeps a 200 from this origin and nothing else', () =>
	{
		expect(worthKeeping({status: 200, type: 'basic'})).toBe(true);
		expect(worthKeeping({status: 404, type: 'basic'})).toBe(false);
		expect(worthKeeping({status: 500, type: 'basic'})).toBe(false);
		// An opaque response has a status of 0 and a body nothing can inspect, so
		// storing one caches a failure that looks like a success.
		expect(worthKeeping({status: 0, type: 'opaque'})).toBe(false);
		expect(worthKeeping({status: 200, type: 'opaqueredirect'})).toBe(false);
		expect(worthKeeping(null)).toBe(false);
	});
});

describe('which caches are ours to delete', () =>
{
	it('drops our old versions and touches nothing else', () =>
	{
		const stale = staleCaches([
			'architect3d-offline-v0', CACHE_NAME, 'architect3d-offline-v99',
			'somebody-elses-cache', 'workbox-precache-v2',
		]);

		expect(stale).toEqual(['architect3d-offline-v0', 'architect3d-offline-v99']);
		expect(CACHE_NAME).toBe(`architect3d-offline-v${CACHE_VERSION}`);
	});
});

let cache;
let caches;
let network;

beforeEach(() =>
{
	cache = fakeCache();
	caches = fakeCaches(cache);
	network = vi.fn(async (req) => response(`live:${req.url}`));
});

const deps = () => ({caches, fetch: network, origin: ORIGIN});

describe('cache-first', () =>
{
	it('fetches once and never again', async () =>
	{
		const req = request(`${BASE}assets/index-BUHeTH6a.js`);

		const first = await respondTo(req, deps());
		const second = await respondTo(req, deps());

		expect(first.body).toBe(`live:${req.url}`);
		expect(second.body).toBe(`live:${req.url}`);
		expect(network).toHaveBeenCalledTimes(1);
		expect(cache.puts).toEqual([req.url]);
	});

	it('does not store a failure', async () =>
	{
		network = vi.fn(async () => response('gone', {status: 404}));
		const req = request(`${BASE}assets/index-BUHeTH6a.js`);

		await respondTo(req, deps());
		await respondTo(req, deps());

		// A 404 cached is a 404 that outlives the fix.
		expect(network).toHaveBeenCalledTimes(2);
		expect(cache.puts).toEqual([]);
	});
});

describe('network-first, which is how a deploy is picked up', () =>
{
	it('prefers the network and refreshes the copy behind it', async () =>
	{
		const req = request(BASE, {mode: 'navigate'});
		cache.store.set(BASE, response('old document'));

		const answer = await respondTo(req, deps());

		expect(answer.body).toBe(`live:${BASE}`);
		expect(cache.store.get(BASE).body).toBe(`live:${BASE}`);
	});

	it('falls back to the copy when the network is gone', async () =>
	{
		const req = request(BASE, {mode: 'navigate'});
		cache.store.set(BASE, response('the last document we saw'));
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		const answer = await respondTo(req, deps());

		// This single assertion is the acceptance clause: a second load with the
		// network off reaches the application.
		expect(answer.body).toBe('the last document we saw');
	});

	it('reports the network failure when there is no copy either', async () =>
	{
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		await expect(respondTo(request(BASE, {mode: 'navigate'}), deps()))
			.rejects.toThrow('Failed to fetch');
	});
});

describe('stale-while-revalidate', () =>
{
	it('serves the stored copy at once and refreshes behind it', async () =>
	{
		const req = request(`${BASE}models/gltf/chair.glb`);
		cache.store.set(req.url, response('the chair we had'));
		const kept = [];

		const answer = await respondTo(req, Object.assign(deps(), {
			waitUntil: (promise) => kept.push(promise),
		}));

		expect(answer.body).toBe('the chair we had');
		expect(kept).toHaveLength(1);
		// And the refresh really does land, which is what makes a changed model
		// appear on the next load rather than never.
		await kept[0];
		expect(cache.store.get(req.url).body).toBe(`live:${req.url}`);
	});

	it('fetches when there is nothing stored', async () =>
	{
		const req = request(`${BASE}models/gltf/chair.glb`);

		const answer = await respondTo(req, deps());

		expect(answer.body).toBe(`live:${req.url}`);
		expect(cache.puts).toEqual([req.url]);
	});

	it('gives the network its own error when nothing is stored and nothing answers', async () =>
	{
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		await expect(respondTo(request(`${BASE}models/gltf/chair.glb`), deps()))
			.rejects.toThrow('Failed to fetch');
	});

	it('does not fail the response when the background refresh does', async () =>
	{
		const req = request(`${BASE}models/gltf/chair.glb`);
		cache.store.set(req.url, response('the chair we had'));
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});
		const kept = [];

		const answer = await respondTo(req, Object.assign(deps(), {
			waitUntil: (promise) => kept.push(promise),
		}));

		expect(answer.body).toBe('the chair we had');
		await expect(kept[0]).resolves.toBeNull();
	});
});

/**
 * The rule every branch obeys: a caching decision must never turn a working
 * page into a broken one.
 */
describe('a browser that will not give us a cache', () =>
{
	beforeEach(() =>
	{
		caches = {async open() {throw new Error('storage is disabled');}};
	});

	it('still answers, on every strategy', async () =>
	{
		for (const req of [
			request(BASE, {mode: 'navigate'}),
			request(`${BASE}assets/index-BUHeTH6a.js`),
			request(`${BASE}models/gltf/chair.glb`),
		])
		{
			expect((await respondTo(req, deps())).body, req.url).toBe(`live:${req.url}`);
		}
	});
});

describe('pass-through', () =>
{
	it('asks the network and stores nothing', async () =>
	{
		const answer = await respondTo(request(`${BASE}x`, {method: 'POST'}), deps());

		expect(answer.body).toBe(`live:${BASE}x`);
		expect(caches.opened).toBe(0);
	});
});

/**
 * Precaching, and the one thing that is precached (RM-013 K3).
 *
 * The first version of this worker precached nothing, on the reasoning that a
 * first visit downloads everything anyway. `npm run offline:check` failed at
 * the reload with `net::ERR_FAILED`, and the reason is structural rather than
 * incidental: **a worker does not control the navigation that installed it.**
 * The document, the module entry and the stylesheet are all fetched before the
 * worker exists, so a cache holding 2.3 MB of models is unreachable because the
 * three files that name them are missing.
 */
describe('what the document says the shell is', () =>
{
	const DOCUMENT = `<!DOCTYPE html><html><head>
		<link rel="manifest" href="manifest.webmanifest">
		<link rel="icon" href="icons/architect3d.svg" type="image/svg+xml">
		<script type="module" crossorigin src="/assets/index-BUHeTH6a.js"></script>
		<link rel="stylesheet" crossorigin href="/assets/index-DfMuPn0A.css">
		</head><body><div id="app"></div></body></html>`;

	it('finds the entry and the stylesheet, and nothing else in the head', () =>
	{
		// Read out of the document rather than a build manifest, which is what
		// makes a second list impossible to let drift.
		expect(shellAssets(DOCUMENT)).toEqual([
			'/assets/index-BUHeTH6a.js',
			'/assets/index-DfMuPn0A.css',
		]);
	});

	it('leaves the manifest and the icon alone', () =>
	{
		// Both are `<link>` and neither is a stylesheet. They are cached on use
		// like everything else the app serves.
		expect(shellAssets(DOCUMENT)).not.toContain('manifest.webmanifest');
		expect(shellAssets(DOCUMENT)).not.toContain('icons/architect3d.svg');
	});

	it('deduplicates and keeps document order', () =>
	{
		const twice = '<script src="a.js"></script><script src="b.js"></script><script src="a.js"></script>';

		expect(shellAssets(twice)).toEqual(['a.js', 'b.js']);
	});

	it('is empty for anything that is not a document', () =>
	{
		expect(shellAssets('')).toEqual([]);
		expect(shellAssets(null)).toEqual([]);
		expect(shellAssets('<html><body>nothing here</body></html>')).toEqual([]);
	});
});

describe('precaching the shell', () =>
{
	const SHELL = `${BASE}`;
	const DOCUMENT = '<script type="module" src="/architect3d/assets/index-BUHeTH6a.js"></script>'
		+ '<link rel="stylesheet" href="/architect3d/assets/index-DfMuPn0A.css">';

	function documentNetwork()
	{
		return vi.fn(async (req) =>
		{
			const url = typeof req === 'string' ? req : req.url;
			return response(url === SHELL ? DOCUMENT : `live:${url}`);
		});
	}

	it('stores the document and what it blocks on, and nothing more', async () =>
	{
		network = documentNetwork();

		const landed = await precacheShell(SHELL, deps());

		expect(landed).toEqual({document: true, assets: 2});
		expect([...cache.store.keys()].sort()).toEqual([
			SHELL,
			`${BASE}assets/index-BUHeTH6a.js`,
			`${BASE}assets/index-DfMuPn0A.css`,
		].sort());
	});

	it('bypasses the HTTP cache for the document and not for the assets', async () =>
	{
		network = documentNetwork();

		await precacheShell(SHELL, deps());

		const [document, ...assets] = network.mock.calls.map(([req]) => req);
		// The document must be what the server has now; the assets are
		// content-addressed, so whatever the browser holds under that URL is the
		// same bytes and re-downloading 1.5 MB would be waste.
		expect(document.cache).toBe('reload');
		assets.forEach((request) => {expect(request.cache).not.toBe('reload');});
	});

	/**
	 * A refused install leaves the application with no worker at all, which is
	 * strictly worse than one with an empty cache.
	 */
	it('survives a document that will not load', async () =>
	{
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		expect(await precacheShell(SHELL, deps())).toEqual({document: false, assets: 0});
	});

	it('survives a document that is a 404', async () =>
	{
		network = vi.fn(async () => response('nope', {status: 404}));

		expect(await precacheShell(SHELL, deps())).toEqual({document: false, assets: 0});
	});

	it('survives an asset that will not load, and keeps the document', async () =>
	{
		network = vi.fn(async (req) =>
		{
			const url = typeof req === 'string' ? req : req.url;
			if (url === SHELL) {return response(DOCUMENT);}
			throw new TypeError('Failed to fetch');
		});

		expect(await precacheShell(SHELL, deps())).toEqual({document: true, assets: 0});
		expect(cache.store.has(SHELL)).toBe(true);
	});

	it('survives a browser with no cache at all', async () =>
	{
		caches = {async open() {throw new Error('storage is disabled');}};

		expect(await precacheShell(SHELL, deps())).toEqual({document: false, assets: 0});
	});
});

describe('the shell answers any route offline', () =>
{
	it('serves the cached document for a path it has never seen', async () =>
	{
		cache.store.set(BASE, response('the document'));
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		// A single-page application answers every path with the same document, so
		// a reload of `?assetBase=x` must not be a network error while a perfectly
		// good copy sits in the cache under a different key.
		const answer = await respondTo(
			request(`${BASE}?assetBase=https://cdn.example.test/`, {mode: 'navigate'}),
			Object.assign(deps(), {shell: BASE}));

		expect(answer.body).toBe('the document');
	});

	it('prefers the copy a route has of its own', async () =>
	{
		cache.store.set(BASE, response('the shell'));
		cache.store.set(`${BASE}?x=1`, response('this exact page'));
		network = vi.fn(async () => {throw new TypeError('Failed to fetch');});

		const answer = await respondTo(request(`${BASE}?x=1`, {mode: 'navigate'}),
			Object.assign(deps(), {shell: BASE}));

		expect(answer.body).toBe('this exact page');
	});
});
