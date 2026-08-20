// @ts-check
import {computed, ref, shallowRef} from 'vue';
import {pluralFormOf, translate} from '../../scripts/blueprint.js';
import {assetResolver} from '../composables/useAssets.js';

/**
 * The application in a language that is not English (RM-014 L3).
 *
 * ## The source English is the key
 *
 * `t('Save layout')`, not `t('topbar.save')`. RM-014 Z-1 counted 327 distinct
 * strings and the decision follows from what that number is made of: mostly
 * short labels, some long explanatory prose, and all of it already written. An
 * identifier scheme would mean inventing 327 names, maintaining a second file
 * that says what each one means in English, and putting `topbar.save` on
 * somebody's screen the first time a translation is missing.
 *
 * With the text as the key: **English costs nothing at all** - there is no
 * `en.json`, because the fallback is the argument - a missing translation shows
 * the English sentence, and extraction is mechanical, which is what makes
 * `npm run strings:check` possible. The cost is that editing an English
 * sentence orphans its translations, and the gate reports orphans for exactly
 * that reason. A wording change *is* a translation change; the only question is
 * whether anybody finds out.
 *
 * ## Fetched, never bundled - and the margin is why
 *
 * Z-1 priced a language at **5,466 gzipped bytes** against 14,359 of
 * `first-load` headroom. L2 then spent 2,996 of that, leaving 11,363, so two
 * bundled languages would be **96 %** of everything the payload has left. A
 * language is therefore a file fetched when it is chosen, exactly as J2 does
 * for catalog packs and K1 for starter plans - the third time this project has
 * reached that answer, and M-49 is the gate that holds it.
 *
 * ## Reactive by construction
 *
 * `t` reads a `shallowRef`. Any component that renders a translated string
 * therefore subscribes to it, and a locale change re-renders exactly those
 * components with no plugin, no `provide`, and nothing to install.
 */

/** Where a chosen language is remembered, beside the five keys already there. */
export const STORAGE_KEY = 'architect3d.locale';

/** The language the source is written in, and the one that needs no file. */
export const DEFAULT_LOCALE = 'en';

/**
 * @typedef {Object} Locale
 * @property {string} id A BCP 47 primary tag.
 * @property {string} label In the language itself, because that is what somebody
 *           looking for it can read.
 * @property {?string} file Relative to the deployment, or null for the source
 *           language.
 * @property {string} decimal What separates a whole number from its fraction.
 */

/** @type {Array<Locale>} */
export const LOCALES = [
	{id: 'en', label: 'English', file: null, decimal: '.'},
	{id: 'de', label: 'Deutsch', file: 'locales/de.json', decimal: ','},
	{id: 'fr', label: 'Français', file: 'locales/fr.json', decimal: ','},
];

/** The catalogue in force, or null for the source language. */
const catalogue = shallowRef(/** @type {?Object} */(null));
/** Which language is chosen. */
const chosen = ref(DEFAULT_LOCALE);
/** Files already fetched, so switching back and forth costs one request each. */
const fetched = new Map();
/** @type {import('vue').Ref<?string>} */
const failure = ref(null);

/** @param {string} id */
export function localeById(id)
{
	return LOCALES.filter(function (entry) {return entry.id === id;})[0] || LOCALES[0];
}

/**
 * Look one message up. The shape `translate` wants.
 *
 * Exported so the same catalogue reaches the library: `useBlueprint` hands this
 * to `BlueprintJS({messages})`, which is how the 50 sentences `src/scripts`
 * writes for a person get translated without `src/scripts` importing anything.
 *
 * @param {string} key The source English.
 * @param {Object} params
 * @returns {?string}
 */
export function lookup(key, params)
{
	var table = catalogue.value;
	if (!table)
	{
		return null;
	}
	var found = table[key];
	if (typeof found === 'string')
	{
		return found;
	}
	if (!found || typeof found !== 'object')
	{
		return null;
	}
	var form = pluralFormOf(typeof params.count === 'number' ? params.count : 0);
	return found[form] || found.other || null;
}

/**
 * Say something to a person.
 *
 * @param {string|Array<string>} source The English. A pair is `[one, other]`,
 *        selected by `params.count`.
 * @param {Object} [params] Named values for `{placeholders}`.
 * @returns {string}
 */
export function t(source, params)
{
	return translate(lookup, source, params);
}

/** Which language is in force. */
export const locale = computed(function () {return chosen.value;});

/** What a number's decimal point looks like here (finding Z-4). */
export const decimalSeparator = computed(function () {return localeById(chosen.value).decimal;});

/** Whether a catalogue is loaded, and what went wrong if one did not. */
export const localeError = computed(function () {return failure.value;});

/**
 * Read what this browser last chose, without applying it.
 *
 * @returns {string}
 */
export function storedLocale()
{
	try
	{
		var raw = window.localStorage.getItem(STORAGE_KEY);
		return raw && LOCALES.some(function (entry) {return entry.id === raw;}) ? raw : DEFAULT_LOCALE;
	}
	catch
	{
		return DEFAULT_LOCALE;
	}
}

/**
 * Fetch a language file, through the resolver so `?assetBase=` moves it.
 *
 * A failure is an absence rather than an error: the application keeps working
 * in English, which is the same rule `useAssets` applies to a manifest that
 * does not arrive. Refusing to start because a translation is missing would
 * turn a degradation into an outage.
 *
 * @param {Locale} entry
 * @returns {Promise<?Object>}
 */
async function fetchCatalogue(entry)
{
	if (!entry.file)
	{
		return null;
	}
	if (fetched.has(entry.id))
	{
		return fetched.get(entry.id);
	}
	var at = assetResolver().resolve(entry.file);
	try
	{
		var response = await fetch(at.url || entry.file);
		if (!response || !response.ok)
		{
			throw new Error(`${entry.file} returned ${response ? response.status : 'nothing'}`);
		}
		var table = await response.json();
		fetched.set(entry.id, table);
		return table;
	}
	catch (error)
	{
		failure.value = error instanceof Error ? error.message : String(error);
		return null;
	}
}

/**
 * Choose a language.
 *
 * @param {string} id
 * @param {Object} [options]
 * @param {boolean} [options.persist] Defaults to true.
 * @returns {Promise<boolean>} whether the chosen language is now in force.
 */
export async function setLocale(id, options)
{
	var settings = options || {};
	var entry = localeById(id);
	failure.value = null;

	var table = await fetchCatalogue(entry);
	if (entry.file && !table)
	{
		// The file did not arrive. Stay where we are rather than switching into a
		// language with no words in it.
		return false;
	}
	catalogue.value = table;
	chosen.value = entry.id;
	apply(entry);
	if (settings.persist !== false)
	{
		try {window.localStorage.setItem(STORAGE_KEY, entry.id);}
		catch { /* see storedLocale: a browser that will not remember is not an error */ }
	}
	return true;
}

/**
 * What the document itself has to say about the language.
 *
 * `<html lang>` is not decoration: it is what a screen reader picks a voice
 * from and what a browser offers to translate against. It is written into
 * `index.html` as `en` and has to follow the choice.
 *
 * @param {Locale} entry
 */
function apply(entry)
{
	if (typeof document === 'undefined')
	{
		return;
	}
	document.documentElement.lang = entry.id;
	document.title = t('Architect3D - Floorplan');
}

/** Forget everything. The suite's seam, and the only one. */
export function resetLocale()
{
	catalogue.value = null;
	chosen.value = DEFAULT_LOCALE;
	failure.value = null;
	fetched.clear();
}

/** What has been fetched, for a test that wants to assert on the count. */
export function fetchedLocales()
{
	return [...fetched.keys()];
}
