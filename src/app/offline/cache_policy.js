// @ts-check

/**
 * What the service worker keeps, and how long it keeps it (RM-013 K3).
 *
 * ## Everything here is a pure decision, and that is deliberate
 *
 * A service worker is three event listeners over a set of judgements. The
 * listeners cannot be tested outside a real worker; the judgements are the part
 * worth being sure about, so they live here, take their world as arguments, and
 * are exercised exhaustively by `tests/offline-policy.test.js`. `src/app/sw.js`
 * is what remains: twenty lines of wiring, and it is excluded from coverage
 * with that reason written down - the same split RM-011 H2 made for `post.js`.
 *
 * ## Three strategies, because there are three kinds of URL
 *
 * The application's own measurement of a boot is what shapes this. It fetches
 * **7 runtime resources, 814,585 bytes**, of which the Basis transcoder is
 * 585 KB - and the built shell on top of that is 10 files and 1.52 MB. So a
 * complete offline copy is **2,337,516 bytes, 11.4 % of the 20.5 MB deploy**,
 * and every byte of it is something the first visit already downloaded.
 *
 * That is why almost nothing is precached. RM-013 K3 says *"cached as they are
 * used"* and the arithmetic agrees: precaching would move 2.3 MB from the second
 * visit to the first, and precaching the whole tree would move 20.5 MB there - a
 * worse first visit in exchange for a better second one, which is the trade the
 * sprint refused before it was written.
 *
 * **Almost**, and the exception was found by running the acceptance check
 * rather than by thinking about it. The first version precached nothing at all
 * and `npm run offline:check` failed at the reload with `net::ERR_FAILED`:
 * a worker does not control the navigation that installed it, so the document
 * that first visit fetched never passed through the worker and was never
 * stored. Every model and every texture was cached and none of it could be
 * reached, because the one file that names them was missing. So `install`
 * fetches exactly one URL - the scope, 1,951 bytes - and {@link SHELL_FALLBACK}
 * is how a navigation to any path under it is answered offline.
 *
 * What differs between the three kinds is not *whether* to cache but what
 * staleness means:
 *
 * - **The document** is the only file that names the others. It is
 *   {@link NETWORK_FIRST}: online, a deploy is picked up the moment somebody
 *   reloads, because the new `index.html` points at new hashed assets that are
 *   simply not in the cache. Offline, the cached copy is served and the whole
 *   thing still runs.
 * - **The built assets** are content-addressed - `index-BUHeTH6a.js` - so a
 *   changed file is a changed URL. They are {@link CACHE_FIRST} and can never
 *   be stale by construction. This is the one place "cache forever" is a fact
 *   rather than a hope.
 * - **Everything else the app serves** - models, textures, catalog packs,
 *   templates, the asset manifest - keeps its name across deploys, so it CAN go
 *   stale. {@link STALE_WHILE_REVALIDATE}: the cached copy is served
 *   immediately and a fresh one is fetched behind it, so a changed model
 *   appears on the next load and nothing ever blocks on the network.
 *
 * ## Why there is no per-deploy cache wipe
 *
 * The obvious design stamps a version at build time and deletes every other
 * cache on activate. It needs a build step, it re-downloads everything after a
 * deploy that changed one file, and it is *less* correct than the above: it
 * makes staleness a property of the deploy rather than of the resource. What
 * {@link CACHE_VERSION} is for is different and much rarer - a change to these
 * rules themselves, which is the one thing that can make an existing cache mean
 * something other than what it says.
 */

/**
 * The cache these rules write.
 *
 * Bumped **by hand, with a reason**, exactly like `STORE_VERSION` next door in
 * the persistence layer - and for the same reason: a version that moves on
 * every build is a version that says nothing. It moves when the rules above
 * change in a way that makes an existing entry mean something different.
 *
 * 1 - RM-013 K3, the first.
 */
export const CACHE_VERSION = 1;

/** The one cache. `architect3d-offline-v1`. */
export const CACHE_NAME = 'architect3d-offline-v' + CACHE_VERSION;

/** Serve from the network, fall back to the cache. The document. */
export const NETWORK_FIRST = 'network-first';
/** Serve from the cache, and never look again. Content-addressed files. */
export const CACHE_FIRST = 'cache-first';
/** Serve from the cache, refresh behind it. Everything else we serve. */
export const STALE_WHILE_REVALIDATE = 'stale-while-revalidate';
/** Do not touch it. */
export const PASS_THROUGH = 'pass-through';

/**
 * The one thing precached, and the one thing a failed navigation falls back to.
 *
 * A single-page application answers every path with the same document, so a
 * cached copy of the scope URL is a cached copy of every route - which is why
 * this is a fallback and not merely an entry: offline, a reload of
 * `/architect3d/?x=1` finds nothing under its own key and is served the shell,
 * exactly as the server would have served it.
 */
export const SHELL_FALLBACK = 'shell';

/**
 * The files a document loads to be an application.
 *
 * Read out of the document itself rather than from a build manifest, and that
 * is the whole reason there is no build step here: `index.html` is generated by
 * Vite and is the authority on what the shell is, so parsing it cannot drift
 * from what shipped. A manifest would be a second list of the same thing, kept
 * in step by hope.
 *
 * The files the document blocks on: the module entry, the stylesheets, and the
 * chunks it modulepreloads. The lazily-imported chunks are deliberately absent:
 * `GTAOPass`, `design_bundle` and - since RM-015 M3 - the whole 3D engine are
 * deferred precisely so a boot does not pay for them, and precaching them would
 * undo that on the install instead.
 *
 * ## modulepreload, and the visit that went offline without it
 *
 * `rel="modulepreload"` was not read here until M3, and until M3 it did not
 * matter: the application was one entry chunk and Vite emitted no such link. M3
 * split the engine out, which left the entry statically importing two shared
 * chunks - three's maths and the library core - and Vite preloads exactly those.
 * They are as much the shell as the entry is; the boot cannot run without them.
 *
 * `tools/check-offline.mjs` is what said so, on the first run after the split: a
 * first-visit-then-offline reload rendered nothing, with `three.core-*.js` and
 * `dom-*.js` named as the two resources the cache did not have. The rule that
 * fixes it is the one this function was always trying to state - *what the
 * document blocks on* - and a modulepreload is a fetch the document blocks on.
 * Vite emits them only for STATIC imports of the entry, so the lazy chunks stay
 * lazy by construction rather than by a list kept in step by hope.
 *
 * @param {string} html
 * @returns {Array<string>} URLs as written, relative to the document.
 */
export function shellAssets(html)
{
	var found = [];
	var text = String(html || '');
	var script = /<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
	var link = /<link[^>]*\srel=["'](?:stylesheet|modulepreload)["'][^>]*>/gi;
	var href = /\shref=["']([^"']+)["']/i;
	var match;
	while ((match = script.exec(text)) !== null)
	{
		found.push(match[1]);
	}
	while ((match = link.exec(text)) !== null)
	{
		var url = href.exec(match[0]);
		if (url)
		{
			found.push(url[1]);
		}
	}
	// Deduplicated and in document order, so two runs precache the same list in
	// the same sequence and a failure is reproducible.
	return found.filter(function (url, at) {return found.indexOf(url) === at;});
}

/**
 * A file the build emitted under a content hash.
 *
 * `assets/index-BUHeTH6a.js`, `assets/index-DfMuPn0A.css`. The hash is Vite's
 * eight-character base64url, and it is what makes {@link CACHE_FIRST} safe: a
 * changed file cannot reuse a URL.
 */
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

/**
 * Which strategy a request gets.
 *
 * Takes a plain URL and the request's own facts rather than a `Request`, so the
 * decision can be exercised without a fetch event to build one from.
 *
 * @param {Object} request
 * @param {string} request.url The absolute URL.
 * @param {string} [request.method] Defaults to GET.
 * @param {string} [request.mode] The fetch mode; `navigate` marks the document.
 * @param {string} [request.range] The `Range` header, if there is one.
 * @param {string} origin The worker's own origin.
 * @returns {string} One of the four strategies above.
 */
export function strategyFor(request, origin)
{
	var method = request.method || 'GET';
	if (method !== 'GET')
	{
		// A POST is not a thing to remember. Nothing here makes one today, and a
		// cache that answered one would be a bug waiting for the feature that does.
		return PASS_THROUGH;
	}
	// A partial response cannot be stored and replayed as a whole one, and a
	// browser that asked for a range wants a range. This is how a <video> or a
	// resumed download arrives; neither is served here, and the guard is what
	// stops the first one that is from being quietly corrupted.
	if (request.range)
	{
		return PASS_THROUGH;
	}

	/** @type {URL} */
	var at;
	try {at = new URL(request.url);}
	catch {return PASS_THROUGH;}

	if (at.origin !== origin)
	{
		// Somebody else's server, somebody else's caching rules. `?assetBase=` can
		// point the asset tree at a CDN, and a CDN is exactly the case where
		// second-guessing the origin's own headers is presumptuous.
		return PASS_THROUGH;
	}
	if (at.pathname.endsWith('.map'))
	{
		// 36 % of this deploy is source maps - 7.4 MB across eight files - and the
		// only thing that ever asks for one is a devtools panel somebody opened on
		// purpose. Storing them would triple what an offline copy costs to hold
		// nothing a user will ever see.
		return PASS_THROUGH;
	}
	if (request.mode === 'navigate')
	{
		return NETWORK_FIRST;
	}
	if (HASHED.test(at.pathname))
	{
		return CACHE_FIRST;
	}
	return STALE_WHILE_REVALIDATE;
}

/**
 * Whether a response is worth keeping.
 *
 * A 200 from this origin, and nothing else. An opaque response - what a
 * cross-origin `no-cors` fetch produces - has a status of 0 and a body nothing
 * can inspect, so storing one means caching a failure that looks like a success
 * and serving it forever. A 404 cached is a 404 that outlives the fix.
 *
 * @param {Object} response
 * @param {number} [response.status]
 * @param {string} [response.type]
 * @returns {boolean}
 */
export function worthKeeping(response)
{
	return Boolean(response) && response.status === 200
		&& response.type !== 'opaque' && response.type !== 'opaqueredirect';
}

/**
 * Which of the caches this origin holds are not ours any more.
 *
 * Only ones this application wrote: an origin's cache storage is shared with
 * everything else served from it, and deleting a name we do not recognise would
 * be deleting somebody else's work.
 *
 * @param {Array<string>} names
 * @returns {Array<string>}
 */
export function staleCaches(names)
{
	return (names || []).filter(function (name)
	{
		return /^architect3d-offline-v\d+$/.test(name) && name !== CACHE_NAME;
	});
}
