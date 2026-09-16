// @ts-check
import {ref} from 'vue';
import {assetResolver} from './useAssets.js';

/**
 * The starter plans, fetched (RM-013 K1, finding Y-5).
 *
 * ## Nothing is in the bundle, and Y-5 is the arithmetic
 *
 * Five distinct furnished plans gzip to **4,050 bytes**, against **9,849** of
 * `first-load` headroom. They fit - and they would take 41 % of the thinnest
 * line in `budget.json` for content most visitors never open, on a set that is
 * open-ended, because the templates are five and the samples are however many
 * get drawn. So they live under `public/templates/` behind a manifest, exactly
 * like the catalog packs J2 split out, and this module carries one URL.
 *
 * The manifest is fetched when somebody opens the starter plans, not at boot.
 * Nothing shows before that click - unlike the catalog drawer, whose first
 * screen J1 had to keep bundled - so there is nothing to pay for in advance.
 * M-47 asserts it in the browser tier, off `performance.getEntriesByType`,
 * which is the same instrument M-43 uses on the packs.
 *
 * ## Failure is not fatal
 *
 * A manifest that does not arrive leaves an empty shelf and a message. The
 * application still opens, still draws and still saves; what is missing is a
 * head start. Refusing to start because a metadata file is absent would turn a
 * degradation into an outage - the rule `useAssets` already states about its
 * own manifest.
 */

/** Where the generated manifest is served from, relative to the page. */
export const TEMPLATE_MANIFEST_URL = 'templates/manifest.json';

/**
 * Fetch JSON through the resolver, and treat every failure as an absence.
 *
 * Through the resolver like the catalog packs, so `?assetBase=` moves the
 * templates with everything else rather than pinning them to the origin.
 *
 * @param {string} url
 * @param {?function(string): Promise<Response>} [fetcher]
 * @returns {Promise<?Object>}
 */
function fetchJson(url, fetcher)
{
	const call = fetcher || (typeof fetch === 'function' ? fetch : null);
	if (!call)
	{
		return Promise.resolve(null);
	}
	const at = assetResolver().resolve(url);
	return Promise.resolve()
		.then(function () {return call(at.url || url);})
		.then(function (response)
		{
			if (!response || !response.ok)
			{
				return null;
			}
			return response.json();
		})
		.catch(function () {return null;});
}

/**
 * @param {string} url
 * @param {?function(string): Promise<Response>} [fetcher]
 * @returns {Promise<?string>}
 */
function fetchText(url, fetcher)
{
	const call = fetcher || (typeof fetch === 'function' ? fetch : null);
	if (!call)
	{
		return Promise.resolve(null);
	}
	const at = assetResolver().resolve(url);
	return Promise.resolve()
		.then(function () {return call(at.url || url);})
		.then(function (response) {return (response && response.ok) ? response.text() : null;})
		.catch(function () {return null;});
}

/**
 * The manifest, once. Module-level so opening the shelf twice costs one fetch.
 * @type {?Promise<?Object>}
 */
var manifestPromise = null;

/**
 * Forget the fetch. The suite's way back to a cold start, and the reason the
 * memo above is safe to keep for the life of the page.
 */
export function resetTemplates()
{
	manifestPromise = null;
}

/**
 * @param {Object} [options]
 * @param {?function(string): Promise<Response>} [options.fetcher]
 * @returns {Promise<Array<Object>>}
 */
export function loadTemplateManifest(options)
{
	var settings = options || {};
	if (!manifestPromise)
	{
		manifestPromise = fetchJson(TEMPLATE_MANIFEST_URL, settings.fetcher);
	}
	return manifestPromise.then(function (json)
	{
		var entries = (json && Array.isArray(json.entries)) ? json.entries : [];
		return entries.filter(function (entry)
		{
			return entry && typeof entry.id === 'string' && typeof entry.file === 'string'
				&& typeof entry.name === 'string';
		});
	});
}

/**
 * The shelf of starter plans, and one design off it.
 *
 * @param {Object} projects The `useProjects` instance. A template is *adopted*
 *        rather than opened, so saving creates a record instead of overwriting
 *        the studio plan for whoever opens it next.
 */
export function useTemplates(projects)
{
	/** @type {import('vue').Ref<Array<Object>>} */
	var entries = ref([]);
	var loading = ref(false);
	/** @type {import('vue').Ref<?string>} */
	var error = ref(null);

	/**
	 * @param {Object} [options]
	 * @returns {Promise<Array<Object>>}
	 */
	async function load(options)
	{
		if (entries.value.length)
		{
			return entries.value;
		}
		loading.value = true;
		error.value = null;
		try
		{
			entries.value = await loadTemplateManifest(options);
			if (!entries.value.length)
			{
				error.value = 'The starter plans could not be loaded.';
			}
			return entries.value;
		}
		finally
		{
			loading.value = false;
		}
	}

	/**
	 * Put a starter plan on screen, unsaved.
	 *
	 * @param {Object} entry A manifest row.
	 * @param {Object} [options]
	 * @returns {Promise<boolean>}
	 */
	async function start(entry, options)
	{
		var settings = options || {};
		loading.value = true;
		try
		{
			var text = await fetchText(entry.file, settings.fetcher);
			if (!text)
			{
				error.value = `${entry.name} could not be loaded.`;
				return false;
			}
			return projects.adopt(text, {name: entry.name, origin: entry.id});
		}
		finally
		{
			loading.value = false;
		}
	}

	return {entries, loading, error, load, start};
}
