// @ts-check
import {ref, shallowRef} from 'vue';
import {AssetManifest, AssetResolver} from '../../scripts/blueprint.js';

/**
 * Where this deployment's assets actually live (RM-003 A5).
 *
 * ## What the application adds to the library's resolver
 *
 * The library ships an identity resolver: every logical name resolves to
 * itself, which is what it did before A5 and what an embedder who configures
 * nothing keeps. This is the part that gives it a manifest - fetched at boot
 * from `asset-manifest.json`, which `tools/make-asset-manifest.mjs` generates
 * from `public/` and which is committed.
 *
 * It is fetched rather than bundled. 370 entries is 58 kB of JSON, and putting
 * that in the library bundle would charge it to every consumer whether or not
 * they serve this project's assets at all - and would blow a size budget A4
 * had just tightened by minifying to get under.
 *
 * ## Failure is not fatal, deliberately
 *
 * A manifest that does not arrive, or arrives malformed, leaves the resolver
 * exactly as it started: identity. Every asset still loads, because the logical
 * names ARE the physical URLs in this deployment. What is lost is the
 * availability check and the prefetching, both of which are improvements over
 * a baseline that still works. Refusing to start because a metadata file is
 * missing would turn a degradation into an outage.
 *
 * ## The base
 *
 * `?assetBase=` on the query string, and nothing else. A CDN is a deployment
 * decision and this application has no settings store to keep one in, so the
 * hook is the one that needs no storage: it makes the CDN path *testable* and
 * demonstrable without pretending the demo has a deployment configuration it
 * does not. An embedder sets it with `resolver.setBase(...)`.
 */

/** Where the generated manifest is served from, relative to the page. */
export const MANIFEST_URL = 'asset-manifest.json';

/**
 * The resolver every viewer in this application shares.
 *
 * Module-level because it has to exist before the manifest arrives and before
 * anything mounts: the viewer is constructed with it, and the manifest is
 * installed into it later. A resolver created per-component would mean the
 * manifest landing in one that nothing is using.
 *
 * @type {AssetResolver}
 */
const resolver = new AssetResolver();

/** @returns {AssetResolver} */
export function assetResolver()
{
	return resolver;
}

/**
 * How much to spend warming the cache for a hovered catalog item.
 *
 * The largest single asset in the tree is 1.30 MB, so this is a ceiling rather
 * than a throttle - it exists so that a future model nobody measured cannot
 * turn a mouse moving across the palette into a multi-megabyte download.
 */
export const HOVER_PREFETCH_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Fetch and install the manifest.
 *
 * Separate from the composable and exported, so it can run once at boot rather
 * than once per component that wants to read the state.
 *
 * @param {Object} [options]
 * @param {string} [options.url]
 * @param {function(string): Promise<*>} [options.fetch] Injected by the suite.
 * @returns {Promise<{ok: boolean, count: number, errors: Array<string>}>}
 */
export async function loadManifest(options)
{
	var settings = options || {};
	var url = settings.url || MANIFEST_URL;
	var fetcher = settings.fetch || (typeof fetch === 'function' ? fetch : null);

	if (!fetcher)
	{
		return {ok: false, count: 0, errors: ['no fetch in this environment']};
	}

	try
	{
		var response = await fetcher(url);
		if (!response || !response.ok)
		{
			return {
				ok: false,
				count: 0,
				errors: [`${url} returned ${response ? response.status : 'nothing'}`],
			};
		}
		var result = AssetManifest.parse(await response.json());
		if (!result.ok)
		{
			// Reported, not thrown, and the resolver is left as identity. See the
			// note at the top: a broken manifest must not be worse than no manifest.
			console.warn(`architect3d: ignoring ${url} - ${result.errors.join('; ')}`);
			return {ok: false, count: 0, errors: result.errors};
		}
		resolver.setManifest(result.manifest);
		return {ok: true, count: result.manifest.count, errors: []};
	}
	catch (error)
	{
		return {ok: false, count: 0, errors: [error instanceof Error ? error.message : String(error)]};
	}
}

/**
 * Apply an asset base from the query string, if one is there.
 *
 * `?assetBase=https://cdn.example.com/architect3d` and every model, texture and
 * thumbnail comes from there instead - with no file renamed, no document
 * rewritten, and no rebuild. That is the whole claim of A5's asset half, in a
 * form somebody can check in a browser.
 *
 * @param {string} [search] Defaults to `window.location.search`.
 * @returns {?string} the base that was applied, or null.
 */
export function applyAssetBaseFromQuery(search)
{
	var query = search !== undefined
		? search
		: (typeof window !== 'undefined' ? window.location.search : '');
	if (!query)
	{
		return null;
	}

	var base = new URLSearchParams(query).get('assetBase');
	if (!base)
	{
		return null;
	}
	resolver.setBase(base);
	return resolver.base;
}

/**
 * Reactive state over the shared resolver, and the prefetch hooks.
 *
 * @returns {Object}
 */
export function useAssets()
{
	/** Whether a manifest is installed. */
	var ready = ref(resolver.manifested);
	/** How many assets this build declares. */
	var count = ref(resolver.manifest.count);
	/** @type {import('vue').ShallowRef<Array<string>>} */
	var errors = shallowRef([]);

	/**
	 * Fetch the manifest and publish the result.
	 * @returns {Promise<void>}
	 */
	async function load()
	{
		var result = await loadManifest();
		ready.value = result.ok;
		count.value = result.count;
		errors.value = result.errors;
	}

	/**
	 * Warm the cache for one catalog item's model.
	 *
	 * Called on hover, which is the only prefetch signal a palette actually has:
	 * a pointer resting on a thumbnail is the strongest available evidence that
	 * a model is about to be wanted, and it arrives a few hundred milliseconds
	 * before the click - which is most of the fetch.
	 *
	 * Idempotent and cheap to call repeatedly; the resolver remembers what it has
	 * already warmed.
	 *
	 * @param {?{model?: string}} entry A catalog item.
	 * @returns {Promise<void>}
	 */
	async function prefetchItem(entry)
	{
		if (!entry || !entry.model)
		{
			return;
		}
		await resolver.preload([entry.model], {maxBytes: HOVER_PREFETCH_MAX_BYTES});
	}

	/** What the resolver has been asked for and what it warmed. */
	function stats()
	{
		return resolver.stats();
	}

	return {ready, count, errors, load, prefetchItem, stats, resolver};
}
