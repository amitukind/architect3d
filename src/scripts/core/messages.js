// @ts-check

/**
 * What this library says, and how somebody else can say it differently
 * (RM-014 L3, finding Z-2).
 *
 * ## The finding this exists for
 *
 * Z-2 counted **54 distinct messages written for a person to read** inside
 * `src/scripts` - `Scene`'s load refusals, every path in `DesignDocument`'s
 * validator, the retired-format message - and pointed out the thing that makes
 * them a problem rather than a detail: **this is a published package**. The
 * messages reach a person as finished English prose inside a toast, so an
 * application cannot translate them at the boundary without pattern-matching
 * that prose, and `src/scripts` cannot import a dictionary from `src/app`
 * because the one-way arrow between them has held for nine programmes.
 *
 * So the seam is here, and it is the smallest one that works: **a function**.
 *
 * ## The source text IS the key
 *
 * `runtime.text('this build does not ship that asset.')` rather than
 * `runtime.text('scene.missing-asset')`. Three reasons, and the third is the
 * one that decided it:
 *
 * - **A build that supplies no catalogue produces byte-identical English**, by
 *   construction rather than by a table being kept in step. That is L3's
 *   acceptance clause and with an identifier scheme it would be a promise; here
 *   it is arithmetic.
 * - **A missing translation degrades to English** rather than to `scene.missing-asset`
 *   on somebody's screen.
 * - **Extraction is mechanical.** `tools/check-strings.mjs` reads the calls and
 *   knows every key without a human maintaining a second list.
 *
 * The cost is real and worth stating: editing an English sentence changes its
 * key, so its translations orphan. The gate reports orphans for exactly that
 * reason, and a wording change is a translation change - which is true anyway.
 *
 * ## Two shapes, and nothing else
 *
 * A message is a string, or a pair `[one, other]` for something counted. Named
 * placeholders are `{like}` `{this}`. There is no gender, no ordinal, no nested
 * selector and no date skeleton, because nothing in this library needs one and
 * a format nobody uses is a format nobody maintains.
 *
 * The plural rule is `count === 1`, which is correct for English, German and
 * French - the languages RM-014 L3 ships - and is **not** correct for Polish,
 * Russian or Arabic. That is a real limit and it is written down here rather
 * than discovered: a language with more than two plural categories needs
 * `pluralFormOf` extended, and the catalogue format already allows extra keys
 * beside `one` and `other`.
 */

/**
 * A translator: source text in, translated text out, or null for "I do not
 * have this one".
 *
 * @typedef {function(string, Object): ?string} Translator
 */

/**
 * Substitute `{named}` placeholders.
 *
 * A placeholder with no matching parameter is left exactly as written rather
 * than blanked. A sentence reading `Opened {name}` is a bug somebody can see
 * and search for; one reading `Opened ` is a bug that looks like a bad filename.
 *
 * @param {string} text
 * @param {?Object} params
 * @returns {string}
 */
export function interpolate(text, params)
{
	if (!params || text.indexOf('{') === -1)
	{
		return text;
	}
	return text.replace(/\{([a-zA-Z0-9_]+)\}/g, function (whole, name)
	{
		return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
	});
}

/**
 * Which plural form a count wants.
 *
 * @param {number} count
 * @returns {string} `one` or `other`.
 */
export function pluralFormOf(count)
{
	return count === 1 ? 'one' : 'other';
}

/**
 * The source form to look a message up by.
 *
 * For a counted message that is the **other** form, because it is the general
 * case and the one a translator reads first.
 *
 * @param {string|Array<string>} source
 * @returns {string}
 */
export function keyOf(source)
{
	return Array.isArray(source) ? source[source.length - 1] : source;
}

/**
 * The English a build with no catalogue produces.
 *
 * @param {string|Array<string>} source
 * @param {?Object} params
 * @returns {string}
 */
export function englishOf(source, params)
{
	if (!Array.isArray(source))
	{
		return source;
	}
	var count = params && typeof params.count === 'number' ? params.count : 0;
	return pluralFormOf(count) === 'one' ? source[0] : source[source.length - 1];
}

/**
 * Translate, or produce the English unchanged.
 *
 * The one function every message in this library goes through, and the only
 * thing `DesignRuntime.text` does.
 *
 * @param {?Translator} translator
 * @param {string|Array<string>} source
 * @param {Object} [params]
 * @returns {string}
 */
export function translate(translator, source, params)
{
	var settings = params || {};
	var english = englishOf(source, settings);
	if (!translator)
	{
		return interpolate(english, settings);
	}
	var found = translator(keyOf(source), settings);
	return interpolate(typeof found === 'string' && found ? found : english, settings);
}
