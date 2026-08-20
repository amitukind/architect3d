// @ts-check

/**
 * What every browser store in this application agrees about (RM-013 K1).
 *
 * There are two of them now - `draft_repository.js`, which holds the one
 * working draft, and `project_repository.js`, which holds the library - and
 * they share a vocabulary rather than a schema. That distinction is finding
 * Y-1 and it is the reason this file exists rather than one repository
 * importing from the other:
 *
 * - **The vocabulary is shared.** A refusal is a result and not an exception, a
 *   `QuotaExceededError` is worth telling apart from everything else, a byte is
 *   a UTF-8 byte, and `navigator.storage.estimate()` is optional everywhere.
 *   Two stores that disagreed about any of those would make the UI say two
 *   different things about the same browser.
 * - **The schemas are not, and must not be.** They are separate IndexedDB
 *   databases at independent versions. A draft is one slot, constantly
 *   overwritten, expiring after seven days; a project is a named record that
 *   expires never. Y-1 measured what coupling them would cost: a build at
 *   version 1 opening a store at version 2 gets a refusal it treats as
 *   permanent for the session, so bumping `architect3d` to add a projects store
 *   would take autosave away from anybody who rolled back.
 *
 * Everything here was in `draft_repository.js` from RM-003 A5 and is re-exported
 * from it, so no caller of that module had to change.
 */

/** The write was refused because the store is full. */
export const REASON_QUOTA = 'quota';
/** No store at all: private browsing, a disabled setting, a webview. */
export const REASON_UNAVAILABLE = 'unavailable';
/** A store written by a build newer than this one. Left alone deliberately. */
export const REASON_VERSION = 'version';
/** Anything else the platform threw. */
export const REASON_ERROR = 'error';

/**
 * How many bytes a string occupies once stored.
 *
 * Both stores hold UTF-16 in practice, but what this is used for is a size
 * report and a quota estimate, and for those the honest unit is what a byte
 * count means everywhere else in this project: UTF-8. `TextEncoder` is in every
 * environment this runs in, including jsdom.
 *
 * @param {string} text
 * @returns {number}
 */
export function byteLength(text)
{
	return new TextEncoder().encode(text).length;
}

/**
 * Classify a storage exception.
 *
 * `QuotaExceededError` is the one worth distinguishing, because it is the one a
 * caller can do something about - prune, then retry. It arrives as a `DOMException`
 * with that name in every current browser, and as code 22 in older ones.
 *
 * @param {*} error
 * @returns {string}
 */
export function classify(error)
{
	if (!error)
	{
		return REASON_ERROR;
	}
	if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22)
	{
		return REASON_QUOTA;
	}
	if (error.name === 'VersionError')
	{
		return REASON_VERSION;
	}
	return REASON_ERROR;
}

/**
 * What the browser thinks it has room for, or nulls.
 *
 * Not part of any repository's correctness - nothing branches on it - but it is
 * what turns "autosave is off" into "autosave is off because the draft is 8 MB
 * and you have 6 MB left". Measured in Chromium for RM-013 Y-6: 3,221,225,472
 * bytes of quota against the roughly 14,500 a project costs.
 *
 * @returns {Promise<{usage: ?number, quota: ?number}>}
 */
export async function estimate()
{
	try
	{
		if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate)
		{
			var result = await navigator.storage.estimate();
			return {
				usage: typeof result.usage === 'number' ? result.usage : null,
				quota: typeof result.quota === 'number' ? result.quota : null,
			};
		}
	}
	catch
	{
		// An estimate nobody can get is not a failure of anything.
	}
	return {usage: null, quota: null};
}

/**
 * Wrap an IDBRequest as a promise.
 *
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function promisify(request)
{
	return new Promise(function (resolve, reject)
	{
		request.onsuccess = function () {resolve(request.result);};
		request.onerror = function () {reject(request.error);};
	});
}
