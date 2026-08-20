// @ts-check
import {computed, ref} from 'vue';
import {Dimensioning} from '../../scripts/blueprint.js';
import {DEFAULT_LOCALE, LOCALES, decimalSeparator, locale, localeById, localeError,
	setLocale, storedLocale, t} from '../i18n/i18n.js';
import {useToasts} from './useToasts.js';

/**
 * Choosing a language, and what follows from choosing one (RM-014 L3).
 *
 * The module underneath holds the catalogue and the fetch; this is the part
 * that belongs to the application - the two things that have to happen *around*
 * a catalogue arriving, and the reporting when one does not.
 *
 * **The decimal separator** (finding Z-4). `Dimensioning` concatenates its own
 * suffixes and lets JavaScript write the point, so a length reads `1.5m` in
 * every locale until somebody tells it otherwise. That is not a string and no
 * catalogue can fix it, which is why it is set here rather than translated.
 *
 * **The document's own language.** `<html lang>` is what a screen reader picks a
 * voice from, and `index.html` writes `en`. `i18n.js` moves it, because it also
 * moves the title, and one place should own what the document says about itself.
 */

/** @returns {Object} */
export function useI18n()
{
	var toasts = useToasts();
	var busy = ref(false);

	var current = computed(function () {return locale.value;});
	var label = computed(function () {return localeById(locale.value).label;});

	/**
	 * Apply a language, and everything that is not a string.
	 *
	 * @param {string} id
	 * @param {Object} [options]
	 * @returns {Promise<boolean>}
	 */
	async function choose(id, options)
	{
		busy.value = true;
		try
		{
			var ok = await setLocale(id, options);
			if (!ok)
			{
				toasts.error(t('That language could not be loaded.'), {detail: localeError.value});
				return false;
			}
			// Not a string, and no catalogue can carry it (Z-4).
			Dimensioning.setDecimalSeparator(decimalSeparator.value);
			return true;
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Apply what this browser last chose.
	 *
	 * Called at boot, and it fetches nothing at all for the source language -
	 * which is M-49, asserted on the instrument M-43 was built for.
	 *
	 * @returns {Promise<boolean>}
	 */
	function restore()
	{
		var stored = storedLocale();
		if (stored === DEFAULT_LOCALE)
		{
			Dimensioning.setDecimalSeparator(decimalSeparator.value);
			return Promise.resolve(true);
		}
		return choose(stored, {persist: false});
	}

	return {locale: current, label, locales: LOCALES, busy, choose, restore, t};
}
