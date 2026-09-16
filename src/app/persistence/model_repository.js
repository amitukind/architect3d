// @ts-check

import {REASON_UNAVAILABLE, REASON_VERSION, classify, estimate, promisify} from './storage.js';

/**
 * Models that came off somebody's disk (RM-012 J3, finding X-7).
 *
 * ## The third database, and Y-1 is still why
 *
 * There are now three: `architect3d` holds the one working draft,
 * `architect3d-projects` holds the library, and this holds imported models.
 * RM-013 Y-1 measured what merging them would cost - a version bump is one-way,
 * and a build at version 1 opening a store at version 2 gets a refusal it
 * treats as permanent for the session - so the rule it set stands: a new kind
 * of thing gets a new database at version 1, and the schemas never have to move
 * together.
 *
 * It is a stronger argument here than it was for the library. A project is
 * fourteen kilobytes and a model can be thirty megabytes, so these two stores
 * do not even want the same eviction story, let alone the same version.
 *
 * ## Two object stores again, and the ratio is a thousand to one
 *
 * K1 split cards from bodies so that drawing a grid of projects cost a few
 * kilobytes rather than a design each. The same split is here for a sharper
 * reason: `records` is a few hundred bytes per model and `blobs` is the model.
 * Everything the application does routinely - deciding whether a design's
 * imports are present, listing what is stored, reporting what it costs - reads
 * only the first. The bytes are read once, when a model is actually placed.
 *
 * ## Content-addressed, so a name cannot come to mean different bytes
 *
 * The key is the first 64 bits of the SHA-256 of the file, computed in
 * `src/app/import/model_file.js`. Importing the same chair twice is one record
 * rather than two, and - the property that matters more - a design naming
 * `local/6f3a91c2....glb` can only ever resolve to the bytes that hashed to it.
 * That is the same argument RM-013 K3 made for serving hashed assets cache-first:
 * with content addressing, "this is the right file" is a fact rather than a hope.
 *
 * @typedef {Object} ModelRecord
 * @property {string} id The digest, and the store's key.
 * @property {string} name The logical name a design writes, `local/<id>.<ext>`.
 * @property {string} file What the file was called when it was picked.
 * @property {string} format `gltf` or `obj`.
 * @property {string} up Which axis its author called up.
 * @property {number} bytes How large the file is.
 * @property {number} added Milliseconds since epoch.
 */

/**
 * @typedef {Object} ModelResult
 * @property {boolean} ok
 * @property {?string} reason One of REASON_*, or null on success.
 * @property {?ModelRecord} record
 */

/**
 * @typedef {Object} ModelStoreStats
 * @property {string} kind
 * @property {number} models
 * @property {number} bytes
 * @property {number} writes
 * @property {number} failures
 * @property {?number} usage
 * @property {?number} quota
 */

/** Deliberately neither the draft's database nor the library's. */
export const DB_NAME = 'architect3d-models';
export const RECORD_STORE = 'records';
export const BLOB_STORE = 'blobs';

/**
 * The schema version this build understands.
 *
 * Same refusal rule as the two stores beside it: a database at a HIGHER version
 * was written by a newer build and is left untouched rather than migrated on
 * the guess that it is close enough.
 */
export const STORE_VERSION = 1;

/**
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
			if (!db.objectStoreNames.contains(RECORD_STORE))
			{
				db.createObjectStore(RECORD_STORE, {keyPath: 'id'});
			}
			if (!db.objectStoreNames.contains(BLOB_STORE))
			{
				db.createObjectStore(BLOB_STORE, {keyPath: 'id'});
			}
		};
		request.onsuccess = function () {resolve(request.result);};
		request.onerror = function () {reject(request.error);};
		request.onblocked = function () {reject(new Error('another tab is holding the model store open'));};
	});
}

/**
 * The imported models, in IndexedDB.
 *
 * Every method opens, works and closes, for the reason `project_repository`
 * gives: a short-lived handle is what makes a second tab's upgrade possible
 * rather than blocked.
 */
export class IndexedDbModelRepository
{
	/**
	 * @param {Object} [options]
	 * @param {IDBFactory} [options.factory] Defaults to `window.indexedDB`.
	 */
	constructor(options)
	{
		var settings = options || {};
		this.kind = 'indexeddb';
		this._factory = settings.factory
			|| (typeof window !== 'undefined' ? window.indexedDB : null);
		this._writes = 0;
		this._failures = 0;
	}

	/**
	 * @template T
	 * @param {function(IDBDatabase): Promise<T>} work
	 * @returns {Promise<{ok: boolean, reason: ?string, value: ?T}>}
	 */
	async _withDatabase(work)
	{
		if (!this._factory)
		{
			return {ok: false, reason: REASON_UNAVAILABLE, value: null};
		}
		var db = null;
		try
		{
			db = await openAtOurVersion(this._factory);
			var value = await work(db);
			db.close();
			return {ok: true, reason: null, value: value};
		}
		catch (error)
		{
			if (db)
			{
				try {db.close();} catch { /* already closing */ }
			}
			return {ok: false, reason: classify(error), value: null};
		}
	}

	/**
	 * @param {IDBDatabase} db
	 * @param {Array<string>} stores
	 * @param {IDBTransactionMode} mode
	 * @param {function(Object): void} body Receives a store lookup by name.
	 * @returns {Promise<void>}
	 */
	_transact(db, stores, mode, body)
	{
		return new Promise(function (resolve, reject)
		{
			var transaction = db.transaction(stores, mode);
			transaction.oncomplete = function () {resolve();};
			transaction.onerror = function () {reject(transaction.error);};
			transaction.onabort = function ()
			{
				reject(transaction.error || new Error('the model write was aborted'));
			};
			/** @type {Record<string, Object>} */
			var handles = {};
			stores.forEach(function (name) {handles[name] = transaction.objectStore(name);});
			body(handles);
		});
	}

	/**
	 * Store a model. Creates or replaces, by id.
	 *
	 * Replacing is not a merge and is not a conflict: the id is the digest of the
	 * bytes, so a `put` over an existing id is writing the same file again.
	 *
	 * @param {ModelRecord} record
	 * @param {ArrayBuffer} bytes
	 * @returns {Promise<ModelResult>}
	 */
	async put(record, bytes)
	{
		var stored = Object.assign({}, record, {bytes: bytes.byteLength});
		var self = this;
		var outcome = await this._withDatabase(function (db)
		{
			return self._transact(db, [RECORD_STORE, BLOB_STORE], 'readwrite', function (handles)
			{
				handles[RECORD_STORE].put(stored);
				handles[BLOB_STORE].put({id: stored.id, bytes: bytes});
			});
		});
		if (!outcome.ok)
		{
			this._failures += 1;
			return {ok: false, reason: outcome.reason, record: null};
		}
		this._writes += 1;
		return {ok: true, reason: null, record: stored};
	}

	/**
	 * Every record, newest first, and not one model.
	 *
	 * This is what boots the in-memory index, so it has to stay cheap whatever
	 * the store holds - which is the whole reason the bytes are next door.
	 *
	 * @returns {Promise<Array<ModelRecord>>}
	 */
	async list()
	{
		var outcome = await this._withDatabase(function (db)
		{
			return promisify(db.transaction([RECORD_STORE], 'readonly').objectStore(RECORD_STORE).getAll());
		});
		if (!outcome.ok || !outcome.value)
		{
			return [];
		}
		return /** @type {Array<ModelRecord>} */(outcome.value)
			.slice()
			.sort(function (a, b) {return (b.added || 0) - (a.added || 0);});
	}

	/**
	 * The bytes of one model, or null.
	 *
	 * @param {string} id
	 * @returns {Promise<?ArrayBuffer>}
	 */
	async read(id)
	{
		var outcome = await this._withDatabase(function (db)
		{
			return promisify(db.transaction([BLOB_STORE], 'readonly').objectStore(BLOB_STORE).get(id));
		});
		var row = /** @type {*} */(outcome.value);
		return (outcome.ok && row && row.bytes) ? row.bytes : null;
	}

	/**
	 * @param {string} id
	 * @returns {Promise<{ok: boolean, reason: ?string}>}
	 */
	async remove(id)
	{
		var self = this;
		var outcome = await this._withDatabase(function (db)
		{
			return self._transact(db, [RECORD_STORE, BLOB_STORE], 'readwrite', function (handles)
			{
				handles[RECORD_STORE].delete(id);
				handles[BLOB_STORE].delete(id);
			});
		});
		return {ok: outcome.ok, reason: outcome.reason};
	}

	/** @returns {Promise<{ok: boolean, reason: ?string}>} */
	async clear()
	{
		var self = this;
		var outcome = await this._withDatabase(function (db)
		{
			return self._transact(db, [RECORD_STORE, BLOB_STORE], 'readwrite', function (handles)
			{
				handles[RECORD_STORE].clear();
				handles[BLOB_STORE].clear();
			});
		});
		return {ok: outcome.ok, reason: outcome.reason};
	}

	/** @returns {Promise<ModelStoreStats>} */
	async stats()
	{
		var records = await this.list();
		var room = await estimate();
		return {
			kind: this.kind,
			models: records.length,
			bytes: records.reduce(function (sum, record) {return sum + (record.bytes || 0);}, 0),
			writes: this._writes,
			failures: this._failures,
			usage: room.usage,
			quota: room.quota,
		};
	}
}

/**
 * What a browser with no IndexedDB gets.
 *
 * Not a fallback to Web Storage, unlike the draft: a 5 MB string quota cannot
 * hold one model, and pretending otherwise would fail at the second import
 * rather than at the first. It refuses, by name, and everything else in the
 * application works.
 */
export class UnavailableModelRepository
{
	constructor()
	{
		this.kind = 'unavailable';
	}

	/** @returns {Promise<ModelResult>} */
	async put()
	{
		return {ok: false, reason: REASON_UNAVAILABLE, record: null};
	}

	/** @returns {Promise<Array<ModelRecord>>} */
	async list()
	{
		return [];
	}

	/** @returns {Promise<?ArrayBuffer>} */
	async read()
	{
		return null;
	}

	/** @returns {Promise<{ok: boolean, reason: ?string}>} */
	async remove()
	{
		return {ok: false, reason: REASON_UNAVAILABLE};
	}

	/** @returns {Promise<{ok: boolean, reason: ?string}>} */
	async clear()
	{
		return {ok: false, reason: REASON_UNAVAILABLE};
	}

	/** @returns {Promise<ModelStoreStats>} */
	async stats()
	{
		return {kind: this.kind, models: 0, bytes: 0, writes: 0, failures: 0, usage: null, quota: null};
	}
}

/**
 * The store this browser can actually give us.
 *
 * @param {Object} [options]
 * @param {?IDBFactory} [options.factory]
 * @returns {IndexedDbModelRepository|UnavailableModelRepository}
 */
export function createModelRepository(options)
{
	var settings = options || {};
	var factory = settings.factory !== undefined
		? settings.factory
		: (typeof window !== 'undefined' ? window.indexedDB : null);
	if (!factory)
	{
		return new UnavailableModelRepository();
	}
	return new IndexedDbModelRepository({factory: factory});
}

export {REASON_UNAVAILABLE, REASON_VERSION};
