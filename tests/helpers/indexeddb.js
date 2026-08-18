/**
 * An in-memory `IDBFactory`, good enough for the draft repository (RM-003 A5).
 *
 * ## Why a fake here and not in the browser tier
 *
 * Both, and they answer different questions. `tests/browser/draft-storage.test.js`
 * runs the repository against chromium's real IndexedDB, including a six-megabyte
 * design, and that is what proves the **semantics**. What it cannot reach are the
 * branches: a quota refusal on demand, a transaction that aborts without an
 * error, a store written by a newer build. Those are the repository's own logic,
 * and jsdom - which ships no IndexedDB at all - has no way to exercise them.
 *
 * This is the same split the project already uses twice. `createRendererStub`
 * fakes WebGL so `Main`'s lifecycle can be tested headlessly, and the browser
 * tier proves the pixels; `Scene.setItemLoader` fakes the network so the model
 * layer runs in Node. **The dependency is faked, never the subject.** A2's note
 * is the rule being followed rather than broken: a stand-in for the thing under
 * test is not a test, and IndexedDB is not the thing under test here.
 *
 * ## What it implements, and what it does not
 *
 * Exactly the surface `draft_repository.js` touches: versioned open with an
 * upgrade callback, one object store with a `keyPath`, and `put` / `get` /
 * `delete` / `count` in a transaction that reports completion. Callbacks fire on
 * a microtask, because a synchronous IDB is a different shape to write against
 * and would let a bug through that ordering would catch.
 *
 * No cursors, no indexes, no key ranges, no `onversionchange`. If the repository
 * ever needs one, it belongs here rather than in a test.
 */

/** Fire a callback on a microtask, the way a real IDBRequest does. */
function later(fn)
{
	Promise.resolve().then(fn);
}

class FakeRequest
{
	constructor()
	{
		this.result = undefined;
		this.error = null;
		this.onsuccess = null;
		this.onerror = null;
		this.onupgradeneeded = null;
		this.onblocked = null;
	}

	_succeed(result)
	{
		this.result = result;
		later(() => {if (this.onsuccess) { this.onsuccess({target: this}); }});
	}

	_fail(error)
	{
		this.error = error;
		later(() => {if (this.onerror) { this.onerror({target: this}); }});
	}
}

class FakeObjectStore
{
	/**
	 * @param {Map<*, *>} records
	 * @param {string} keyPath
	 * @param {FakeTransaction} transaction
	 */
	constructor(records, keyPath, transaction)
	{
		this._records = records;
		this._keyPath = keyPath;
		this._transaction = transaction;
	}

	put(record)
	{
		const request = new FakeRequest();
		const store = this._transaction._db._factory;
		const key = record[this._keyPath];

		if (store.quotaBytes !== null)
		{
			// The record being replaced counts against its replacement, which is the
			// pessimistic reading and the one that makes pruning necessary. A fake
			// that took the generous view would never exercise the retry path the
			// repository has for it - the same trap the localStorage fake has a note
			// about in tests/persistence-and-assets.test.js.
			let total = JSON.stringify(record).length;
			this._records.forEach((existing) => {total += JSON.stringify(existing).length;});
			if (total > store.quotaBytes)
			{
				const error = new Error('quota');
				error.name = 'QuotaExceededError';
				// A real IndexedDB reports a quota failure on the request AND aborts
				// the transaction. Both, because the repository listens for both and a
				// fake that fired only one would leave the other path unproven.
				request._fail(error);
				this._transaction._abort(error);
				return request;
			}
		}

		this._records.set(key, JSON.parse(JSON.stringify(record)));
		request._succeed(key);
		return request;
	}

	get(key)
	{
		const request = new FakeRequest();
		request._succeed(this._records.has(key) ? this._records.get(key) : undefined);
		return request;
	}

	delete(key)
	{
		const request = new FakeRequest();
		this._records.delete(key);
		request._succeed(undefined);
		return request;
	}

	count()
	{
		const request = new FakeRequest();
		request._succeed(this._records.size);
		return request;
	}
}

class FakeTransaction
{
	constructor(db, storeName)
	{
		this._db = db;
		this._storeName = storeName;
		this._settled = false;
		this.error = null;
		this.oncomplete = null;
		this.onerror = null;
		this.onabort = null;

		// Completion is queued now and fires after any request callback, which is
		// the ordering a real transaction gives: requests resolve, then the
		// transaction commits.
		later(() => later(() =>
		{
			if (this._settled) { return; }
			this._settled = true;
			if (this.oncomplete) { this.oncomplete({target: this}); }
		}));
	}

	objectStore(name)
	{
		const records = this._db._stores.get(name);
		if (!records)
		{
			throw new Error(`no object store named ${name}`);
		}
		return new FakeObjectStore(records, this._db._keyPaths.get(name), this);
	}

	_abort(error)
	{
		if (this._settled) { return; }
		this._settled = true;
		this.error = error || null;
		later(() =>
		{
			if (this.onerror) { this.onerror({target: this}); }
			if (this.onabort) { this.onabort({target: this}); }
		});
	}
}

class FakeDatabase
{
	constructor(factory, version)
	{
		this._factory = factory;
		this.version = version;
		this._stores = factory._stores;
		this._keyPaths = factory._keyPaths;
		this.closed = false;
	}

	get objectStoreNames()
	{
		const names = [...this._stores.keys()];
		return {contains: (name) => names.indexOf(name) !== -1, length: names.length};
	}

	createObjectStore(name, options)
	{
		this._stores.set(name, new Map());
		this._keyPaths.set(name, (options && options.keyPath) || 'id');
		return new FakeObjectStore(this._stores.get(name), this._keyPaths.get(name), new FakeTransaction(this, name));
	}

	transaction(name)
	{
		if (!this._stores.has(name))
		{
			throw new Error(`no object store named ${name}`);
		}
		return new FakeTransaction(this, name);
	}

	close()
	{
		this.closed = true;
	}
}

/**
 * @param {Object} [options]
 * @param {number} [options.version] The version the store is already at.
 *        Higher than the repository's is how the "written by a newer build"
 *        refusal is reached.
 * @param {?number} [options.quotaBytes] Refuse a write past this many bytes.
 * @param {boolean} [options.failOpen] Refuse to open at all.
 * @returns {Object} an IDBFactory-shaped object.
 */
export function createFakeIndexedDb(options)
{
	const settings = options || {};
	const factory = {
		_stores: new Map(),
		_keyPaths: new Map(),
		_version: settings.version || 0,
		quotaBytes: settings.quotaBytes === undefined ? null : settings.quotaBytes,
		failOpen: Boolean(settings.failOpen),
		/** How many times a database has been opened, so churn is assertable. */
		opens: 0,

		open(name, version)
		{
			const request = new FakeRequest();
			factory.opens += 1;

			if (factory.failOpen)
			{
				request._fail(new Error('refused'));
				return request;
			}

			if (version !== undefined && version < factory._version)
			{
				const error = new Error('version');
				error.name = 'VersionError';
				request._fail(error);
				return request;
			}

			const target = version === undefined ? Math.max(1, factory._version) : version;
			const upgrading = target > factory._version;
			factory._version = target;
			const db = new FakeDatabase(factory, target);
			request.result = db;

			// Everything below is deferred, and the handler is read INSIDE the
			// deferral rather than here. `open()` returns before the caller has
			// attached `onupgradeneeded` - that is the whole shape of the IDB API -
			// so a fake that checks for the handler at call time never fires it, and
			// the object store is never created. Which is exactly what this one did
			// on its first run: every read came back null and every write reported
			// "no object store named drafts".
			later(() =>
			{
				if (upgrading && request.onupgradeneeded)
				{
					// Before success, which is the order a real open uses: the upgrade
					// transaction has to have run before anybody is handed the db.
					request.onupgradeneeded({target: request});
				}
				if (request.onsuccess) { request.onsuccess({target: request}); }
			});
			return request;
		},

		deleteDatabase()
		{
			const request = new FakeRequest();
			factory._stores.clear();
			factory._keyPaths.clear();
			factory._version = 0;
			request._succeed(undefined);
			return request;
		},
	};

	return factory;
}
