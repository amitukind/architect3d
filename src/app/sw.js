// @ts-check
import {CACHE_NAME, staleCaches} from './offline/cache_policy.js';
import {respondTo, precacheShell} from './offline/respond.js';

/**
 * The service worker (RM-013 K3).
 *
 * Twenty lines of wiring, and deliberately no more. Every decision it makes is
 * in `offline/cache_policy.js` and every behaviour is in `offline/respond.js`,
 * both of which are pure and both of which are tested exhaustively - because
 * this file cannot be. A worker has no DOM, cannot be imported by a test, and
 * runs in a scope jsdom does not provide; the vitest browser tier serves this
 * from a dev server that never emits it. So it is excluded from coverage in
 * `vitest.config.mjs`, with that reason written there, exactly as RM-011 H2
 * excluded `post.js`.
 *
 * Whether that exclusion is honest is a question about how thin this file is,
 * which is why it is this thin.
 *
 * Built as a second Vite entry so it lands at the deploy root unhashed - a
 * worker's URL is its identity and its scope, and a hashed one would register a
 * new worker on every deploy while the old one kept its own scope.
 */

/** @type {*} */
var worker = self;

/** The scope, which for a single-page application is every route it has. */
function shellUrl()
{
	return worker.registration.scope;
}

/** What `respondTo` needs to reach the world. */
function world()
{
	return {
		caches: worker.caches,
		fetch: function (request) {return worker.fetch(request);},
		origin: worker.location.origin,
		shell: shellUrl(),
	};
}

worker.addEventListener('install', function (event)
{
	// One request, and it is the document. Everything else is cached as it is
	// used, which is RM-013 K3's own instruction and the arithmetic behind it: a
	// complete offline copy is 2.3 MB and the first visit downloads all of it
	// anyway. The document is the exception because a worker does not control the
	// navigation that installed it, so it is the one file a first visit fetches
	// that the worker never sees - and without it the other 2.3 MB is unreachable.
	// Found by running `npm run offline:check`, not by thinking about it.
	event.waitUntil(precacheShell(shellUrl(), world()));
	// Activating at once rather than waiting for every tab to close, because
	// there is no old worker whose data this could corrupt - the cache is read
	// the same way by every version that has existed.
	worker.skipWaiting();
});

worker.addEventListener('activate', function (event)
{
	event.waitUntil((async function ()
	{
		var names = await worker.caches.keys();
		await Promise.all(staleCaches(names).map(function (name) {return worker.caches.delete(name);}));
		// Take over open tabs, so the first load after an update is the last one
		// serving from the previous worker.
		await worker.clients.claim();
	})());
});

worker.addEventListener('fetch', function (event)
{
	event.respondWith(respondTo(event.request, Object.assign(world(), {
		waitUntil: function (promise) {event.waitUntil(promise);},
	})));
});

export {CACHE_NAME};
