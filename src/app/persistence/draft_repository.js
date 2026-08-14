// @ts-check

/**
 * Where the working draft is kept (RM-003 A5).
 *
 * ## The finding
 *
 * H-8's persistence half, and metric M-9. `useAutosave` wrote the whole design
 * to `localStorage` on a two-second debounce and again on `pagehide`. Web
 * Storage is **synchronous** and capped at about 5 MiB per origin, which makes
 * that two problems in one line:
 *
 * - The write blocks the main thread for as long as it takes to serialise and
 *   store the document. On a furnished design that is a frame or several,
 *   during a drag.
 * - The cap is small enough for a real design to exceed, and
 *   `useAutosave`'s own error path anticipated it: the first
 *   `QuotaExceededError` sets `paused` and **disables autosave for the rest of
 *   the session**. The larger the design, the sooner it stops being protected.
 *
 * IndexedDB is asynchronous and its quota is a share of disk rather than a
 * fixed few megabytes. What it is not is available on `pagehide` - see
 * `recovery_pointer.js` for the half of the problem that creates, which is
 * risk K-6.
 *
 * ## An interface, and two implementations that both stay
 *
 * `LocalStorageDraftRepository` is exactly what shipped before this sprint,
 * behind the interface. It is not a stepping stone to be deleted: it is the
 * fallback when IndexedDB is missing or refuses to open, which happens in
 * private-browsing modes and in some embedded webviews, and it is the rollback
 * if the IndexedDB path turns out to be wrong. `createDraftRepository()` picks
 * one and says which it picked.
 *
 * ## What every implementation must answer
 *
 * @typedef {Object} DraftRepository
 * @property {string} kind Which implementation this is, for the UI and the tests.
 * @property {function(string, number): Promise<WriteResult>} put Store the
 *           serialized design under `savedAt`. Never throws - a refusal is a
 *           result, because a caller that has to try/catch a write on every
 *           edit ends up doing what `useAutosave` did and turning itself off.
 * @property {function(): Promise<?Draft>} read The stored draft, or null. An
 *           unreadable record IS null: a draft nobody can parse is a draft
 *           nobody can restore, and the user did not ask for it.
 * @property {function(): Promise<void>} clear
 * @property {function(): Promise<RepositoryStats>} stats
 */

/**
 * @typedef {Object} Draft
 * @property {string} design A `.blueprint3d` document.
 * @property {number} savedAt Milliseconds since epoch.
 */

/**
 * @typedef {Object} WriteResult
 * @property {boolean} ok
 * @property {?string} reason One of REASON_*, or null on success.
 * @property {boolean} pruned Whether an older record was dropped to make room.
 * @property {number} bytes How large the body was.
 */

/**
 * @typedef {Object} RepositoryStats
 * @property {string} kind
 * @property {number} writes Successful writes, ever.
 * @property {number} failures Refused writes, ever.
 * @property {number} pruned How many times a write had to make room first.
 * @property {number} bytes The size of the last body written.
 * @property {number} syncBytes **M-9.** The largest single synchronous
 *           main-thread write this repository has made. Zero for IndexedDB,
 *           and the whole document for Web Storage - which is the number the
 *           metric exists to move.
 * @property {?number} usage `navigator.storage.estimate()`, when the browser
 *           offers it. Null rather than zero when it does not, so "no estimate"
 *           and "nothing stored" stay distinguishable.
 * @property {?number} quota
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
 * Where the pre-A5 draft lives, and where the localStorage implementation still
 * puts it.
 *
 * Unchanged from the original `useAutosave` constant, which is what lets an
 * existing draft survive this sprint: the IndexedDB repository reads this key
 * once, adopts what it finds, and removes it.
 */
export const LEGACY_STORAGE_KEY = 'architect3d.autosave';

/** The IndexedDB database and store this project owns. */
export const DB_NAME = 'architect3d';
export const STORE_NAME = 'drafts';

/**
 * The schema version this build understands.
 *
 * A store at a HIGHER version was written by a newer build and is left
 * untouched - see `openDatabase`. Migrating a shape this code has never seen,
 * on the guess that it is close enough, is how a draft becomes unreadable by
 * both builds at once.
 */
export const STORE_VERSION = 1;

/** The single slot. `useAutosave`'s "deliberately not a recent-files list". */
export const DRAFT_ID = 'current';

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
 * Not part of the interface's correctness - nothing branches on it - but it is
 * what turns "autosave is off" into "autosave is off because the draft is 8 MB
 * and you have 6 MB left".
 *
 * @returns {Promise<{usage: ?number, quota: ?number}>}
 */
async function estimate()
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
 * The pre-A5 behaviour, behind the interface.
 *
 * Synchronous underneath and honest about it: `stats().syncBytes` reports the
 * whole document, because that is what this implementation writes on the main
 * thread. Kept as the fallback and the rollback, not as a stepping stone.
 */
export class LocalStorageDraftRepository
{
	/**
	 * @param {Object} [options]
	 * @param {Storage} [options.storage] Defaults to `window.localStorage`.
	 * @param {string} [options.key]
	 */
	constructor(options)
	{
		var settings = options || {};
		this.kind = 'localStorage';
		// `!== undefined` rather than `||`, so `{storage: null}` means "there is no
		// store" rather than "use the default one". A repository that silently
		// reached for `window.localStorage` when told there was none would make the
		// unavailable path untestable, which is the path private browsing takes.
		this._storage = settings.storage !== undefined
			? settings.storage
			: (typeof window !== 'undefined' ? window.localStorage : null);
		this._key = settings.key || LEGACY_STORAGE_KEY;
		this._writes = 0;
		this._failures = 0;
		this._pruned = 0;
		this._bytes = 0;
		this._syncBytes = 0;
	}

	/**
	 * @param {string} design
	 * @param {number} savedAt
	 * @returns {Promise<WriteResult>}
	 */
	async put(design, savedAt)
	{
		var body = JSON.stringify({design: design, savedAt: savedAt});
		var bytes = byteLength(body);
		var pruned = false;

		if (!this._storage)
		{
			this._failures += 1;
			return {ok: false, reason: REASON_UNAVAILABLE, pruned: false, bytes: bytes};
		}

		for (var attempt = 0; attempt < 2; attempt++)
		{
			try
			{
				this._storage.setItem(this._key, body);
				this._writes += 1;
				this._bytes = bytes;
				this._syncBytes = Math.max(this._syncBytes, bytes);
				return {ok: true, reason: null, pruned: pruned, bytes: bytes};
			}
			catch (error)
			{
				var reason = classify(error);
				if (reason === REASON_QUOTA && attempt === 0)
				{
					// Make room and try once more. The slot we are about to overwrite
					// is itself the largest thing this app stores, and a browser that
					// counts the existing value against the quota of its replacement
					// will accept the write after it goes. One retry, not a loop: if
					// removing everything we own is not enough, the design is simply
					// too big for this store.
					try {this._storage.removeItem(this._key);} catch { /* nothing to undo */ }
					this._pruned += 1;
					pruned = true;
					continue;
				}
				this._failures += 1;
				return {ok: false, reason: reason, pruned: pruned, bytes: bytes};
			}
		}

		this._failures += 1;
		return {ok: false, reason: REASON_QUOTA, pruned: true, bytes: bytes};
	}

	/** @returns {Promise<?Draft>} */
	async read()
	{
		if (!this._storage)
		{
			return null;
		}
		try
		{
			var raw = this._storage.getItem(this._key);
			return raw ? parseDraft(raw) : null;
		}
		catch
		{
			return null;
		}
	}

	/** @returns {Promise<void>} */
	async clear()
	{
		if (!this._storage)
		{
			return;
		}
		try {this._storage.removeItem(this._key);} catch { /* already gone */ }
	}

	/** @returns {Promise<RepositoryStats>} */
	async stats()
	{
		var room = await estimate();
		return {
			kind: this.kind,
			writes: this._writes,
			failures: this._failures,
			pruned: this._pruned,
			bytes: this._bytes,
			syncBytes: this._syncBytes,
			usage: room.usage,
			quota: room.quota,
		};
	}
}

/**
 * A stored record, or null if it is not one.
 *
 * The same shape check `readDraft` has always made, in one place so both
 * implementations agree on what a usable record is. Corruption is null rather
 * than an error, which is task 4's rule and was already the behaviour: a draft
 * nobody can parse is a draft nobody can restore.
 *
 * @param {string} raw
 * @returns {?Draft}
 */
function parseDraft(raw)
{
	try
	{
		var parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.design !== 'string' || typeof parsed.savedAt !== 'number')
		{
			return null;
		}
		return {design: parsed.design, savedAt: parsed.savedAt};
	}
	catch
	{
		return null;
	}
}

/**
 * Wrap an IDBRequest as a promise.
 *
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function promisify(request)
{
	return new Promise(function (resolve, reject)
	{
		request.onsuccess = function () {resolve(request.result);};
		request.onerror = function () {reject(request.error);};
	});
}

/**
 * Open the database at this build's version, creating the store if it is not
 * there.
 *
 * @param {IDBFactory} factory
 * @returns {Promise<IDBDatabase>}
 */
function openAtOurVersion(factory)
{
	return new Promise(function (resolve, reject)
	{
		var request = factory.open(DB_NAME, STORE_VERSION);
		request.onupgradeneeded = function ()
		{
			var db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME))
			{
				db.createObjectStore(STORE_NAME, {keyPath: 'id'});
			}
		};
		request.onsuccess = function () {resolve(request.result);};
		request.onerror = function () {reject(request.error);};
		request.onblocked = function () {reject(new Error('another tab is holding the draft store open'));};
	});
}

/**
 * What version the stored database is at, or 0 if there is none.
 *
 * Only called to *report* a refusal, never on the happy path. Opening with no
 * version creates an empty database at version 1 as a side effect if none
 * exists, which is exactly what must not happen while probing - so this is
 * reached only after an open at our version has already failed, which means one
 * is certainly there.
 *
 * @param {IDBFactory} factory
 * @returns {Promise<number>}
 */
function probeVersion(factory)
{
	return new Promise(function (resolve)
	{
		var request = factory.open(DB_NAME);
		request.onsuccess = function ()
		{
			var version = request.result.version;
			request.result.close();
			resolve(version);
		};
		request.onerror = function () {resolve(0);};
	});
}

/**
 * Open the database, refusing a store this build does not understand.
 *
 * One open in the common case. `indexedDB.open(name, version)` with a version
 * BELOW the stored one rejects with `VersionError`, which is the right outcome
 * and a poor diagnosis - so on that one path the actual version is probed, and
 * the refusal says what it found.
 *
 * The refusal is task 4's rule: "a store at an unknown version is left
 * untouched and reported rather than migrated speculatively". A newer build's
 * database may mean something different by the same field names, and migrating
 * on the guess that it is close enough is how a draft becomes unreadable by
 * both builds at once.
 *
 * A first version of this probed *first* and opened second, which read as more
 * careful and was wrong: `open(name)` with no version creates the database at
 * version 1 with **no object store**, and the follow-up open at version 1 then
 * fires no upgrade event, so the store was never created and every read came
 * back null. The browser tier caught it immediately; jsdom, having no
 * IndexedDB, could not have.
 *
 * @param {IDBFactory} factory
 * @returns {Promise<IDBDatabase>}
 */
async function openDatabase(factory)
{
	try
	{
		return await openAtOurVersion(factory);
	}
	catch (error)
	{
		// `classify` rather than reading `.name` directly: a caught value is
		// `unknown` to the checker, and the predicate already knows how to look at
		// one safely. It also keeps the two places that decide what a
		// version refusal is from drifting apart.
		if (classify(error) !== REASON_VERSION)
		{
			throw error;
		}
		var actual = await probeVersion(factory);
		var refusal = new Error(
			`architect3d: the draft store is at version ${actual} and this build understands ${STORE_VERSION}. ` +
			'Leaving it untouched.');
		refusal.name = 'VersionError';
		throw refusal;
	}
}

/**
 * The draft in IndexedDB: asynchronous, and not capped at five megabytes.
 *
 * `stats().syncBytes` is zero and stays zero, which is metric M-9. The document
 * never touches the main thread's storage path; what does is the kilobyte
 * pointer in `recovery_pointer.js`, and that is a separate, measured thing.
 */
export class IndexedDbDraftRepository
{
	/**
	 * @param {Object} [options]
	 * @param {IDBFactory} [options.factory] Defaults to `window.indexedDB`.
	 * @param {Storage} [options.legacyStorage] Where to look for a pre-A5 draft
	 *        to adopt. Defaults to `window.localStorage`; pass null to skip.
	 */
	constructor(options)
	{
		var settings = options || {};
		this.kind = 'indexeddb';
		this._factory = settings.factory
			|| (typeof window !== 'undefined' ? window.indexedDB : null);
		this._legacy = settings.legacyStorage !== undefined
			? settings.legacyStorage
			: (typeof window !== 'undefined' ? window.localStorage : null);
		this._writes = 0;
		this._failures = 0;
		this._pruned = 0;
		this._bytes = 0;
		/** Set once a version refusal has been reported, so it is said once. */
		this._unsupported = false;
	}

	/**
	 * @param {string} design
	 * @param {number} savedAt
	 * @returns {Promise<WriteResult>}
	 */
	async put(design, savedAt)
	{
		var bytes = byteLength(design);
		var pruned = false;

		if (!this._factory)
		{
			this._failures += 1;
			return {ok: false, reason: REASON_UNAVAILABLE, pruned: false, bytes: bytes};
		}

		for (var attempt = 0; attempt < 2; attempt++)
		{
			var db = null;
			try
			{
				db = await openDatabase(this._factory);
				await this._write(db, {id: DRAFT_ID, design: design, savedAt: savedAt});
				db.close();
				this._writes += 1;
				this._bytes = bytes;
				return {ok: true, reason: null, pruned: pruned, bytes: bytes};
			}
			catch (error)
			{
				if (db)
				{
					try {db.close();} catch { /* already closing */ }
				}
				var reason = classify(error);
				if (reason === REASON_VERSION)
				{
					this._unsupported = true;
					this._failures += 1;
					return {ok: false, reason: REASON_VERSION, pruned: pruned, bytes: bytes};
				}
				if (reason === REASON_QUOTA && attempt === 0)
				{
					// Prune, then retry once. There is one slot, so what is dropped is
					// the previous draft - which is worth trading for the current one,
					// and is the only thing here we are entitled to drop. Everything
					// else in the origin's quota belongs to somebody else.
					await this.clear();
					this._pruned += 1;
					pruned = true;
					continue;
				}
				this._failures += 1;
				return {ok: false, reason: reason, pruned: pruned, bytes: bytes};
			}
		}

		this._failures += 1;
		return {ok: false, reason: REASON_QUOTA, pruned: true, bytes: bytes};
	}

	/**
	 * @param {IDBDatabase} db
	 * @param {Object} record
	 * @returns {Promise<void>}
	 */
	_write(db, record)
	{
		return new Promise(function (resolve, reject)
		{
			var transaction = db.transaction(STORE_NAME, 'readwrite');
			// Both, and they are not the same event. `onerror` fires for the failed
			// request - a quota refusal arrives here, carrying the DOMException that
			// says so - while `onabort` fires when the transaction is rolled back
			// without one, which is what a browser does when the whole origin is
			// over quota. Listening for only the first loses that case to a promise
			// that never settles.
			transaction.oncomplete = function () {resolve();};
			transaction.onerror = function () {reject(transaction.error);};
			transaction.onabort = function () {reject(transaction.error || new Error('the draft write was aborted'));};
			transaction.objectStore(STORE_NAME).put(record);
		});
	}

	/**
	 * The stored draft, adopting a pre-A5 one if that is all there is.
	 *
	 * @returns {Promise<?Draft>}
	 */
	async read()
	{
		var found = null;
		if (this._factory)
		{
			var db = null;
			try
			{
				db = await openDatabase(this._factory);
				var record = await promisify(
					db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(DRAFT_ID));
				db.close();
				if (record && typeof record.design === 'string' && typeof record.savedAt === 'number')
				{
					found = {design: record.design, savedAt: record.savedAt};
				}
			}
			catch (error)
			{
				if (db)
				{
					try {db.close();} catch { /* already closing */ }
				}
				if (classify(error) === REASON_VERSION)
				{
					this._unsupported = true;
				}
				// Otherwise: an unreadable store is no draft, which is the same rule
				// the localStorage path has always applied to an unparseable one.
			}
		}

		if (found)
		{
			return found;
		}
		return await this._adoptLegacy();
	}

	/**
	 * Take over a draft written before A5, once.
	 *
	 * A user who reloads into the new build should not lose the draft the old
	 * one left, and the old one wrote it to `localStorage` under
	 * LEGACY_STORAGE_KEY. It is copied across and the original removed, so this
	 * happens exactly once and the two stores never both hold a draft - which
	 * would make "which is newer" a question somebody has to answer on every
	 * read.
	 *
	 * @returns {Promise<?Draft>}
	 */
	async _adoptLegacy()
	{
		if (!this._legacy)
		{
			return null;
		}
		var raw = null;
		try {raw = this._legacy.getItem(LEGACY_STORAGE_KEY);} catch {return null;}
		if (!raw)
		{
			return null;
		}

		var draft = parseDraft(raw);
		try {this._legacy.removeItem(LEGACY_STORAGE_KEY);} catch { /* it will be overwritten */ }
		if (!draft)
		{
			return null;
		}

		// Best effort: if the copy fails the draft is still returned, because
		// having it now matters more than having it next time.
		await this.put(draft.design, draft.savedAt);
		return draft;
	}

	/** @returns {Promise<void>} */
	async clear()
	{
		if (!this._factory)
		{
			return;
		}
		var db = null;
		try
		{
			db = await openDatabase(this._factory);
			await new Promise(function (resolve, reject)
			{
				var transaction = db.transaction(STORE_NAME, 'readwrite');
				transaction.oncomplete = function () {resolve(undefined);};
				transaction.onerror = function () {reject(transaction.error);};
				transaction.onabort = function () {reject(transaction.error);};
				transaction.objectStore(STORE_NAME).delete(DRAFT_ID);
			});
			db.close();
		}
		catch
		{
			if (db)
			{
				try {db.close();} catch { /* already closing */ }
			}
		}
	}

	/** @returns {Promise<RepositoryStats>} */
	async stats()
	{
		var room = await estimate();
		return {
			kind: this._unsupported ? 'indexeddb-unsupported-version' : this.kind,
			writes: this._writes,
			failures: this._failures,
			pruned: this._pruned,
			bytes: this._bytes,
			// M-9. Not a running maximum like the localStorage implementation's,
			// because there is nothing to take a maximum of: this repository makes
			// no synchronous main-thread write at any size.
			syncBytes: 0,
			usage: room.usage,
			quota: room.quota,
		};
	}
}

/**
 * The best store this environment offers.
 *
 * Detection rather than configuration: an embedded webview or a private window
 * can have `indexedDB` defined and refuse to open it, so the caller gets
 * whichever one is actually going to work. `kind` on the result says which,
 * and that is what the tests and the UI read rather than guessing from the
 * environment.
 *
 * @param {Object} [options]
 * @param {boolean} [options.preferLocalStorage] Force the fallback. This is
 *        the rollback switch for A5's persistence half.
 * @param {IDBFactory} [options.factory]
 * @param {Storage} [options.storage]
 * @returns {DraftRepository}
 */
export function createDraftRepository(options)
{
	var settings = options || {};
	var factory = settings.factory
		|| (typeof window !== 'undefined' ? window.indexedDB : null);

	if (settings.preferLocalStorage || !factory)
	{
		return new LocalStorageDraftRepository({storage: settings.storage});
	}
	return new IndexedDbDraftRepository({factory: factory, legacyStorage: settings.storage});
}
