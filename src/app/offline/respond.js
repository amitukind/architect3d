// @ts-check
import {CACHE_NAME, NETWORK_FIRST, CACHE_FIRST, STALE_WHILE_REVALIDATE,
	strategyFor, worthKeeping, shellAssets} from './cache_policy.js';

/**
 * Answering a fetch, without a service worker to run in (RM-013 K3).
 *
 * The three strategies `cache_policy.js` names, carried out. Every dependency
 * arrives as an argument - the cache storage, `fetch`, the origin - so the
 * behaviour is exercised headlessly with fakes rather than only in a worker
 * nothing can step through. What is left in `src/app/sw.js` after this is the
 * event wiring, and that is the only part excluded from coverage.
 *
 * ## The rule every branch here obeys
 *
 * **Never let a caching decision turn a working page into a broken one.** A
 * cache that cannot be opened, a write that is refused, a background refresh
 * that fails - none of them may reach the caller. Offline support is an
 * improvement over a baseline that already works, and RM-003 A5 wrote the same
 * sentence about the asset manifest: *"refusing to start because a metadata
 * file is missing would turn a degradation into an outage."*
 */

/**
 * @typedef {Object} Deps
 * @property {Object} caches The `CacheStorage`.
 * @property {function(*): Promise<*>} fetch
 * @property {string} origin The worker's own origin.
 * @property {function(Promise<*>): void} [waitUntil] Keep the worker alive for
 *           a background refresh. Omitted in tests, where the promise is
 *           awaited directly instead.
 * @property {string} [shell] The scope URL, precached at install. A navigation
 *           that is offline and has no copy of its own is answered with this -
 *           see the note in `cache_policy.js` for the run that found it
 *           necessary.
 */

/**
 * Open the cache, or say there is none.
 *
 * @param {Deps} deps
 * @returns {Promise<?Object>}
 */
async function open(deps)
{
	try
	{
		return await deps.caches.open(CACHE_NAME);
	}
	catch
	{
		// Storage refused - private browsing, a disabled setting, a full disk.
		// Everything below falls through to the network, which is what the
		// application did before any of this existed.
		return null;
	}
}

/**
 * Store a response, best effort.
 *
 * The clone matters and it is easy to get wrong: a `Response` body is a stream
 * and can be read once, so putting the original in the cache would hand the
 * caller a body somebody else had already drained.
 *
 * @param {?Object} cache
 * @param {*} request
 * @param {*} response
 * @returns {Promise<void>}
 */
async function keep(cache, request, response)
{
	if (!cache || !worthKeeping(response))
	{
		return;
	}
	try {await cache.put(request, response.clone());}
	catch { /* out of room, or a request a cache will not key on */ }
}

/**
 * Put the document and what it blocks on into the cache.
 *
 * ## Why anything is precached at all
 *
 * **A worker does not control the navigation that installed it.** So on a first
 * visit the document, the module entry and the stylesheet are all fetched
 * before the worker exists, and none of them passes through it - while every
 * model and texture fetched a second later does. Without this, a cache holding
 * 2.3 MB of assets is unreachable because the three files that name them are
 * missing, and K3's acceptance clause - *a second load with the network
 * disabled reaches an editable plan* - is false by one visit.
 *
 * That is not an argument for precaching the tree. It is an argument for
 * precaching exactly the files the first navigation could not give us, which is
 * the document plus what `shellAssets` finds in it, and nothing else. The lazy
 * chunks stay lazy.
 *
 * ## Failure is survivable, every time
 *
 * The worker installs whether or not any of this lands: a document that could
 * not be precached is cached by the next online navigation through the
 * network-first path, and an asset that could not be is fetched on use. A
 * refused install would leave the application with no worker at all, which is
 * strictly worse than one with an empty cache.
 *
 * @param {string} shell The scope URL - for a single-page application, every
 *        route it has.
 * @param {Deps} deps
 * @returns {Promise<{document: boolean, assets: number}>} What landed.
 */
export async function precacheShell(shell, deps)
{
	var cache = await open(deps);
	if (!cache)
	{
		return {document: false, assets: 0};
	}

	var html = null;
	try
	{
		// `cache: 'reload'` so the HTTP cache is bypassed for the document: the
		// point is to store what the server has now, not what a proxy remembered.
		var response = await deps.fetch(new Request(shell, {cache: 'reload'}));
		if (worthKeeping(response))
		{
			html = await response.clone().text();
			await cache.put(shell, response.clone());
		}
	}
	catch
	{
		return {document: false, assets: 0};
	}
	if (html === null)
	{
		return {document: false, assets: 0};
	}

	// Deliberately NOT `reload` for these: they are content-addressed, so
	// whatever the HTTP cache has under that URL is the same bytes, and the
	// first visit put them there moments ago. Forcing the network would
	// re-download 1.5 MB the browser already holds.
	var wanted = shellAssets(html).map(function (url) {return new URL(url, shell).href;});
	var landed = 0;
	await Promise.all(wanted.map(async function (url)
	{
		try
		{
			var asset = await deps.fetch(new Request(url));
			if (worthKeeping(asset))
			{
				await cache.put(url, asset.clone());
				landed += 1;
			}
		}
		catch { /* fetched on use instead */ }
	}));
	return {document: true, assets: landed};
}

/**
 * Answer one request.
 *
 * @param {*} request A `Request`, or anything with `url`, `method` and `mode`.
 * @param {Deps} deps
 * @returns {Promise<*>} A `Response`. Never rejects for a caching reason - only
 *          for the same reasons a bare `fetch` would.
 */
export async function respondTo(request, deps)
{
	var strategy = strategyFor({
		url: request.url,
		method: request.method,
		mode: request.mode,
		range: request.headers && typeof request.headers.get === 'function'
			? request.headers.get('range')
			: null,
	}, deps.origin);

	if (strategy === CACHE_FIRST)
	{
		var cache = await open(deps);
		var hit = cache ? await cache.match(request) : null;
		if (hit)
		{
			return hit;
		}
		var fresh = await deps.fetch(request);
		await keep(cache, request, fresh);
		return fresh;
	}

	if (strategy === NETWORK_FIRST)
	{
		var store = await open(deps);
		try
		{
			var live = await deps.fetch(request);
			await keep(store, request, live);
			return live;
		}
		catch (error)
		{
			var saved = store ? await store.match(request) : null;
			if (saved)
			{
				return saved;
			}
			// The shell answers any route, because a single-page application does.
			// Without this a reload of `?assetBase=x` - or of any path under the
			// scope - is a network error while a perfectly good copy of the document
			// sits in the cache under a different key.
			var shell = (store && deps.shell) ? await store.match(deps.shell) : null;
			if (shell)
			{
				return shell;
			}
			// Nothing cached and nothing reachable. The failure belongs to the
			// caller, in the shape it would have had without a worker at all.
			throw error;
		}
	}

	if (strategy === STALE_WHILE_REVALIDATE)
	{
		var held = await open(deps);
		var stored = held ? await held.match(request) : null;
		var refresh = deps.fetch(request)
			.then(function (response)
			{
				return keep(held, request, response).then(function () {return response;});
			})
			// Swallowed, and only here: a background refresh that fails is a
			// resource that stays as it was, which is the whole point of serving
			// the stored copy first.
			.catch(function () {return null;});

		if (stored)
		{
			// The refresh outlives this response, so the worker is asked to stay
			// awake for it. Without that the browser is entitled to stop the worker
			// the moment the response is returned, and the copy is never updated.
			if (deps.waitUntil)
			{
				deps.waitUntil(refresh);
			}
			return stored;
		}
		var first = await refresh;
		if (first)
		{
			return first;
		}
		// Nothing stored, nothing fetched. Ask again without the cache in the way,
		// so the caller gets the network's own error rather than a null.
		return deps.fetch(request);
	}

	return deps.fetch(request);
}
