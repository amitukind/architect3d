// @ts-check
import {computed, ref} from 'vue';

/**
 * What this person has starred, and what they last put in a room (RM-012 J1).
 *
 * ## Why this is not in the design file
 *
 * The same argument `useWalkthrough` makes about eye height, and RM-012 J1 makes
 * it again in the drawing: favourites and recents describe *whoever is
 * furnishing*, not the building. Two people opening the same plan should each
 * find their own shortlist, and a file that carried one of theirs would quietly
 * hand it to the other. So this lives where the theme and the eye height live -
 * in this browser, for this person, across designs - and nothing is written to a
 * document at all.
 *
 * ## Module-level, like the display unit and the eye height
 *
 * There is one person at the keyboard. Two components holding different
 * favourite lists would be a bug rather than a feature.
 *
 * ## Keyed by model URL
 *
 * Not by name, and not by index. A name is what J1 has just spent a commit
 * making unique and may yet change - two rows were both called *Chair* until
 * this sprint - and an index moves the moment a row is inserted. The model URL is
 * the one field that is already the identity of a row everywhere else: it is what
 * the detail file keys on, what `addItem` passes to the loader and what a saved
 * design records. A starred item whose model is retired simply stops matching,
 * which is the right failure.
 */

const STORAGE_KEY = 'architect3d.catalog';

/** How many recents to keep. Two rows of the drawer's grid, and no more. */
const RECENT_LIMIT = 12;

/** @returns {{favourites: Array<string>, recent: Array<string>}} */
function restore()
{
	try
	{
		var raw = window.localStorage.getItem(STORAGE_KEY);
		var stored = (raw === null) ? {} : JSON.parse(raw);
		return {
			favourites: Array.isArray(stored.favourites) ? stored.favourites.filter(isUrl) : [],
			recent: Array.isArray(stored.recent) ? stored.recent.filter(isUrl).slice(0, RECENT_LIMIT) : [],
		};
	}
	catch
	{
		// A malformed entry is the same as no entry - the call `useLayout` and
		// `useWalkthrough` both make, and for the same reason: a forgotten
		// preference is fine, and a thrown exception on boot is not.
		return {favourites: [], recent: []};
	}
}

/** @param {*} value */
function isUrl(value)
{
	return typeof value === 'string' && value.length > 0;
}

function persist()
{
	try
	{
		window.localStorage.setItem(STORAGE_KEY,
			JSON.stringify({favourites: favourites.value, recent: recent.value}));
	}
	catch
	{
		// Private-mode storage refuses writes. Losing a shortlist is not a reason
		// to fail an add.
	}
}

var initial = restore();
/** @type {import('vue').Ref<Array<string>>} */
const favourites = ref(initial.favourites);
/** @type {import('vue').Ref<Array<string>>} */
const recent = ref(initial.recent);

/**
 * Star or unstar one row.
 *
 * @param {string} model The row's model URL.
 */
export function toggleFavourite(model)
{
	if (!isUrl(model))
	{
		return;
	}
	var at = favourites.value.indexOf(model);
	// Replaced rather than mutated, so a computed reading the array re-runs. A
	// `ref` holding an array is not deep-reactive to `splice` in every path this
	// project uses it from.
	favourites.value = (at === -1)
		? favourites.value.concat([model])
		: favourites.value.filter((entry) => entry !== model);
	persist();
}

/**
 * Record that this row was just added to the design.
 *
 * Most recent first, deduplicated, capped. Adding the same chair six times -
 * which is the behaviour the drawer was built around - leaves one entry at the
 * front rather than six.
 *
 * @param {string} model
 */
export function noteUsed(model)
{
	if (!isUrl(model))
	{
		// A parametric row has no model file. It is still a thing somebody added,
		// but there is nothing here that identifies it, so it is not recorded
		// rather than recorded as the empty string - which would make every
		// parametric row the same entry.
		return;
	}
	recent.value = [model].concat(recent.value.filter((entry) => entry !== model)).slice(0, RECENT_LIMIT);
	persist();
}

/** The two lists, and the verbs over them. */
export function useCatalogBrowse()
{
	var favouriteSet = computed(() => new Set(favourites.value));

	/** @param {string} model */
	function isFavourite(model)
	{
		return favouriteSet.value.has(model);
	}

	return {favourites, recent, isFavourite, toggleFavourite, noteUsed, limit: RECENT_LIMIT};
}
