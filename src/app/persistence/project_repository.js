// @ts-check

import {REASON_QUOTA, REASON_UNAVAILABLE, REASON_VERSION, REASON_ERROR,
	byteLength, classify, estimate, promisify} from './storage.js';

/**
 * The project library (RM-013 K1, gap Q-6).
 *
 * ## What it is, and what the draft store next door is not
 *
 * `draft_repository.js` holds one slot, overwritten on a two-second debounce
 * and expiring after a week. Its own note calls that "deliberately not a
 * recent-files list", and that is still right: a crash recovery is not a
 * document model. This is the document model - many designs, each with a name a
 * person chose, a picture of itself and two dates - and the two coexist. A
 * named project is something somebody decided to keep; a draft is what protects
 * them between those decisions.
 *
 * ## A separate database, and finding Y-1 is why
 *
 * The obvious way to add a store is a second object store inside `architect3d`,
 * and object stores are created only in `onupgradeneeded`, so that means
 * version 2. RM-013 Y-1 ran that in both directions before this file existed:
 *
 * - a build at version 1 against a store at version 2 gets `{ok: false, reason:
 *   "version"}` from `put`, `null` from `read`, and `indexeddb-unsupported-version`
 *   from `stats` - and `useAutosave` treats that as permanent for the session,
 *   which is A5's deliberate rule working correctly;
 * - a build at version 2 against a store at version 1 upgrades cleanly.
 *
 * So the bump is one-way and it is the *draft* that pays for it: anybody who
 * tried this library and went back to a build without it would lose autosave
 * until they cleared their storage. A second database at version 1 costs
 * nothing, and the two schemas have no reason to move together anyway.
 *
 * ## Two object stores, because a grid and an open want different bytes
 *
 * `cards` carries what a tile needs - id, name, dates, thumbnail, sizes.
 * `bodies` carries the `.blueprint3d` document, keyed by the same id. Listing
 * the library reads every card and no document, which is the difference between
 * a grid costing a few kilobytes each and costing a design each. Both are
 * created in the same upgrade, so there is one version and one refusal rule.
 *
 * ## No pruning, and Y-6 is why
 *
 * Chromium offered this origin **3,221,225,472 bytes** against the roughly
 * 14,500 a project costs, so nothing here evicts anything: no LRU, no cap, no
 * quota manager. A refusal is still a refusal - private browsing and embedded
 * webviews produce one, and the Web Storage fallback that saves the draft
 * cannot hold a library at all - and it arrives as a result rather than an
 * exception, which is the one rule this file takes wholesale from next door.
 *
 * @typedef {Object} ProjectCard
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt Milliseconds since epoch.
 * @property {number} modifiedAt
 * @property {?string} thumbnail A data URL, or null if none could be made.
 * @property {number} bytes How large the document is, in UTF-8 bytes.
 * @property {?string} origin Where it came from: a template id, or null for a
 *           design somebody started themselves. Kept because "which template
 *           did I start from" is the question a library gets asked.
 */

/**
 * @typedef {Object} Project
 * @property {ProjectCard} card
 * @property {string} design A `.blueprint3d` document.
 */

/**
 * @typedef {Object} ProjectResult
 * @property {boolean} ok
 * @property {?string} reason One of REASON_*, or null on success.
 * @property {?ProjectCard} card The card as stored, on success.
 */

/**
 * @typedef {Object} LibraryStats
 * @property {string} kind
 * @property {number} projects
 * @property {number} bytes Documents and thumbnails together, as stored.
 * @property {number} writes
 * @property {number} failures
 * @property {?number} usage
 * @property {?number} quota
 */

/** The library's own database, deliberately not the draft's. */
export const DB_NAME = 'architect3d-projects';
export const CARD_STORE = 'cards';
export const BODY_STORE = 'bodies';

/**
 * The schema version this build understands.
 *
 * Same refusal rule as the draft store: a database at a HIGHER version was
 * written by a newer build and is left untouched rather than migrated on the
 * guess that it is close enough.
 */
export const STORE_VERSION = 1;

/** How long a name may be. Longer than any tile can show, shorter than a file. */
export const MAX_NAME_LENGTH = 120;

/**
 * Tidy a name a person typed, or supply one.
 *
 * Trimmed, collapsed and clipped, because a name goes in a tile, a tooltip and
 * seven download filenames - and a name made of spaces would produce a project
 * nobody can find and a file called `.blueprint3d`.
 *
 * @param {?string} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function cleanName(value, fallback)
{
	var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
	if (!text)
	{
		return fallback || 'Untitled design';
	}
	return text.slice(0, MAX_NAME_LENGTH);
}

/**
 * A name for a copy that does not collide with what is already there.
 *
 * `Kitchen` becomes `Kitchen copy`, then `Kitchen copy 2`. Not a uuid suffix
 * and not a silent duplicate: two tiles with the same name in a grid is exactly
 * the problem a library is supposed to solve.
 *
 * @param {string} name
 * @param {Array<string>} taken
 * @returns {string}
 */
export function copyName(name, taken)
{
	var used = new Set(taken);
	var base = cleanName(name);
	var candidate = `${base} copy`;
	var n = 2;
	while (used.has(candidate))
	{
		candidate = `${base} copy ${n}`;
		n += 1;
	}
	return candidate.slice(0, MAX_NAME_LENGTH);
}

/**
 * A stable, sortable, collision-free id.
 *
 * The timestamp prefix is not for uniqueness - the random tail is - it is so
 * that the ids sort in creation order, which makes a store dump readable and a
 * bug report answerable without a second field.
 *
 * @param {number} now
 * @param {function(): number} [random]
 * @returns {string}
 */
export function projectId(now, random)
{
	var rand = random || Math.random;
	var tail = Math.floor(rand() * 0x100000000).toString(36).padStart(7, '0');
	return `${now.toString(36)}-${tail}`;
}

/**
 * How large a card is once stored, near enough to report.
 *
 * The thumbnail dominates and it is a base64 data URL, so its characters are
 * its bytes. Everything else is short text and two numbers.
 *
 * @param {ProjectCard} card
 * @param {number} designBytes
 * @returns {number}
 */
function cardBytes(card, designBytes)
{
	return designBytes + (card.thumbnail ? card.thumbnail.length : 0) + byteLength(card.name) + 64;
}

/**
 * Open the library, creating both stores if they are not there.
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
			if (!db.objectStoreNames.contains(CARD_STORE))
			{
				db.createObjectStore(CARD_STORE, {keyPath: 'id'});
			}
			if (!db.objectStoreNames.contains(BODY_STORE))
			{
				db.createObjectStore(BODY_STORE, {keyPath: 'id'});
			}
		};
		request.onsuccess = function () {resolve(request.result);};
		request.onerror = function () {reject(request.error);};
		request.onblocked = function () {reject(new Error('another tab is holding the project library open'));};
	});
}

/**
 * The library, in IndexedDB.
 *
 * Every method opens, works and closes. That is more opens than a long-lived
 * handle would need, and it is what makes a second tab's upgrade possible
 * instead of blocked - the same trade `draft_repository` makes, for the same
 * reason, and at a library's rate of use the cost is not measurable.
 */
export class IndexedDbProjectRepository
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
		/** Set once a version refusal has been reported, so it is said once. */
		this._unsupported = false;
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
			var reason = classify(error);
			if (reason === REASON_VERSION)
			{
				this._unsupported = true;
			}
			return {ok: false, reason: reason, value: null};
		}
	}

	/**
	 * @param {IDBDatabase} db
	 * @param {Array<string>} stores
	 * @param {function(Object): void} body Receives a store lookup by name.
	 * @returns {Promise<void>}
	 */
	_transact(db, stores, body)
	{
		return new Promise(function (resolve, reject)
		{
			var transaction = db.transaction(stores, 'readwrite');
			// Both events, and they are not the same one: `onerror` carries the
			// failed request's exception - a quota refusal arrives here - while
			// `onabort` fires when the transaction is rolled back without one,
			// which is what a browser does when the whole origin is over quota.
			transaction.oncomplete = function () {resolve();};
			transaction.onerror = function () {reject(transaction.error);};
			transaction.onabort = function ()
			{
				reject(transaction.error || new Error('the project write was aborted'));
			};
			/** @type {Record<string, Object>} */
			var handles = {};
			stores.forEach(function (name) {handles[name] = transaction.objectStore(name);});
			body(handles);
		});
	}

	/**
	 * Store a design under a card. Creates or replaces, by id.
	 *
	 * @param {ProjectCard} card
	 * @param {string} design
	 * @returns {Promise<ProjectResult>}
	 */
	async put(card, design)
	{
		var stored = Object.assign({}, card, {
			name: cleanName(card.name),
			bytes: byteLength(design),
		});
		var self = this;
		var outcome = await this._withDatabase(function (db)
		{
			return self._transact(db, [CARD_STORE, BODY_STORE], function (handles)
			{
				handles[CARD_STORE].put(stored);
				handles[BODY_STORE].put({id: stored.id, design: design});
			});
		});
		if (!outcome.ok)
		{
			this._failures += 1;
			return {ok: false, reason: outcome.reason, card: null};
		}
		this._writes += 1;
		return {ok: true, reason: null, card: stored};
	}

	/**
	 * Every card, newest first, and not one document.
	 *
	 * Sorted here rather than by an index on `modifiedAt`. An index would need
	 * one in the fake `IDBFactory` the headless tier runs against, and at the
	 * tens-to-hundreds of projects Y-6's arithmetic describes it would save
	 * nothing a person could measure. If a library ever gets large enough for
	 * that to be false, the index is the change and this comment is the reason
	 * it was not made sooner.
	 *
	 * @returns {Promise<Array<ProjectCard>>}
	 */
	async list()
	{
		var outcome = await this._withDatabase(function (db)
		{
			return promisify(db.transaction(CARD_STORE, 'readonly').objectStore(CARD_STORE).getAll());
		});
		var rows = Array.isArray(outcome.value) ? outcome.value : [];
		return rows.filter(isCard).sort(function (a, b) {return b.modifiedAt - a.modifiedAt;});
	}

	/**
	 * One project, card and document together, or null.
	 *
	 * Null for a card whose body has gone, which cannot happen through this
	 * class - both stores are written in one transaction - but can happen to a
	 * database somebody has been in with dev tools. A card with no design is not
	 * a project, and reporting it as one would put an unopenable tile in a grid.
	 *
	 * @param {string} id
	 * @returns {Promise<?Project>}
	 */
	async read(id)
	{
		var outcome = await this._withDatabase(async function (db)
		{
			var card = await promisify(
				db.transaction(CARD_STORE, 'readonly').objectStore(CARD_STORE).get(id));
			var body = await promisify(
				db.transaction(BODY_STORE, 'readonly').objectStore(BODY_STORE).get(id));
			return {card: card, body: body};
		});
		var found = outcome.value;
		if (!found || !isCard(found.card) || !found.body || typeof found.body.design !== 'string')
		{
			return null;
		}
		return {card: found.card, design: found.body.design};
	}

	/**
	 * @param {string} id
	 * @returns {Promise<ProjectResult>}
	 */
	async remove(id)
	{
		var self = this;
		var outcome = await this._withDatabase(function (db)
		{
			return self._transact(db, [CARD_STORE, BODY_STORE], function (handles)
			{
				handles[CARD_STORE].delete(id);
				handles[BODY_STORE].delete(id);
			});
		});
		if (!outcome.ok)
		{
			this._failures += 1;
		}
		return {ok: outcome.ok, reason: outcome.reason, card: null};
	}

	/**
	 * Rename without rewriting the document.
	 *
	 * The card is read, edited and written back rather than being reconstructed
	 * from what the caller believes it holds: a rename that also silently
	 * restored a stale thumbnail or a stale date would be a worse bug than no
	 * rename at all, and the caller has no reason to be carrying either.
	 *
	 * @param {string} id
	 * @param {string} name
	 * @param {number} now
	 * @returns {Promise<ProjectResult>}
	 */
	async rename(id, name, now)
	{
		var self = this;
		/** @type {?ProjectCard} */
		var updated = null;
		var outcome = await this._withDatabase(async function (db)
		{
			var card = await promisify(
				db.transaction(CARD_STORE, 'readonly').objectStore(CARD_STORE).get(id));
			if (!isCard(card))
			{
				return;
			}
			updated = Object.assign({}, card, {name: cleanName(name, card.name), modifiedAt: now});
			await self._transact(db, [CARD_STORE], function (handles)
			{
				handles[CARD_STORE].put(updated);
			});
		});
		if (!outcome.ok)
		{
			this._failures += 1;
			return {ok: false, reason: outcome.reason, card: null};
		}
		if (!updated)
		{
			return {ok: false, reason: REASON_ERROR, card: null};
		}
		this._writes += 1;
		return {ok: true, reason: null, card: updated};
	}

	/** @returns {Promise<void>} */
	async clear()
	{
		var self = this;
		await this._withDatabase(function (db)
		{
			return self._transact(db, [CARD_STORE, BODY_STORE], function (handles)
			{
				handles[CARD_STORE].clear();
				handles[BODY_STORE].clear();
			});
		});
	}

	/** @returns {Promise<LibraryStats>} */
	async stats()
	{
		var room = await estimate();
		var cards = await this.list();
		return {
			kind: this._unsupported ? 'indexeddb-unsupported-version' : this.kind,
			projects: cards.length,
			bytes: cards.reduce(function (total, card) {return total + cardBytes(card, card.bytes || 0);}, 0),
			writes: this._writes,
			failures: this._failures,
			usage: room.usage,
			quota: room.quota,
		};
	}
}

/**
 * The library in a browser that will not store one.
 *
 * Not a degraded implementation - a stated absence. Y-6 is the reason there is
 * no Web Storage fallback here the way there is for the draft: the draft is one
 * document and fits in five megabytes, a library is many and does not, and a
 * library that silently held three designs and then started losing them would
 * be worse than a library that says it is unavailable. Every call refuses with
 * REASON_UNAVAILABLE, `list()` is empty rather than an error, and the UI has one
 * flag to read.
 */
export class UnavailableProjectRepository
{
	constructor()
	{
		this.kind = 'unavailable';
	}

	/** @returns {Promise<ProjectResult>} */
	async put() {return {ok: false, reason: REASON_UNAVAILABLE, card: null};}
	/** @returns {Promise<Array<ProjectCard>>} */
	async list() {return [];}
	/** @returns {Promise<?Project>} */
	async read() {return null;}
	/** @returns {Promise<ProjectResult>} */
	async remove() {return {ok: false, reason: REASON_UNAVAILABLE, card: null};}
	/** @returns {Promise<ProjectResult>} */
	async rename() {return {ok: false, reason: REASON_UNAVAILABLE, card: null};}
	/** @returns {Promise<void>} */
	async clear() {}

	/** @returns {Promise<LibraryStats>} */
	async stats()
	{
		var room = await estimate();
		return {
			kind: this.kind, projects: 0, bytes: 0, writes: 0, failures: 0,
			usage: room.usage, quota: room.quota,
		};
	}
}

/**
 * Whether a stored row is a card this build can put in a grid.
 *
 * The same rule the draft store applies to a record it did not write: a row
 * nobody can render is not a project, and it is skipped rather than shown as a
 * broken tile.
 *
 * @param {*} row
 * @returns {boolean}
 */
function isCard(row)
{
	return Boolean(row) && typeof row.id === 'string' && typeof row.name === 'string'
		&& typeof row.createdAt === 'number' && typeof row.modifiedAt === 'number';
}

/**
 * The best library this environment offers.
 *
 * Detection rather than configuration, like `createDraftRepository`: an
 * embedded webview or a private window can have `indexedDB` defined and refuse
 * to open it, and `kind` on the result is what the UI reads rather than
 * guessing from the environment.
 *
 * @param {Object} [options]
 * @param {IDBFactory} [options.factory]
 * @param {boolean} [options.unavailable] Force the refusal. How the suite and a
 *        rollback both reach the no-library path.
 * @returns {IndexedDbProjectRepository|UnavailableProjectRepository}
 */
export function createProjectRepository(options)
{
	var settings = options || {};
	var factory = settings.factory
		|| (typeof window !== 'undefined' ? window.indexedDB : null);
	if (settings.unavailable || !factory)
	{
		return new UnavailableProjectRepository();
	}
	return new IndexedDbProjectRepository({factory: factory});
}

export {REASON_QUOTA, REASON_UNAVAILABLE, REASON_VERSION, REASON_ERROR};
