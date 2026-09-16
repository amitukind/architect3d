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
 * ever needs one, it belongs here rather than in a test - which is what happened
 * for RM-013 K1: the project library reads whole stores and writes two of them
 * in one transaction, so `getAll`, `clear` and a multi-store `transaction()`
 * were added here.
 *
 * RM-012 J3 changed one thing that was wrong rather than missing. Records were
 * stored with `JSON.parse(JSON.stringify(record))`, and the model store holds
 * `ArrayBuffer`s - which JSON renders as `{}`. A real IndexedDB uses the
 * structured clone algorithm, so the fake now uses `structuredClone`, which is
 * both the fix and the more faithful thing to have been doing all along.
 */

/**
 * Whether a value is an `ArrayBuffer`, from any realm.
 *
 * `instanceof` is not the test. Under vitest's jsdom environment there are two
 * `ArrayBuffer` constructors - jsdom's, which is the global, and Node's, which
 * is what `structuredClone` and `Buffer.buffer` produce - and they are not the
 * same function. `Object.prototype.toString` reads the internal slot and does
 * not care.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isArrayBuffer(value)
{
	return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

/**
 * Store a record the way IndexedDB does, and hand back buffers the page can use.
 *
 * Two things, and both are fidelity rather than convenience (RM-012 J3).
 *
 * A real store structured-clones, so a caller mutating what it wrote does not
 * mutate what is stored - `JSON.parse(JSON.stringify(...))` was standing in for
 * that and rendered an `ArrayBuffer` as `{}`.
 *
 * And a real store hands back an `ArrayBuffer` **the page can use**. Node's
 * `structuredClone` produces one from Node's realm, and under jsdom that fails
 * `data instanceof ArrayBuffer` inside `GLTFLoader` - which then treats the
 * bytes as an already-parsed glTF object and reports an unsupported asset
 * version. Re-homing the buffer is what a browser's IndexedDB does for free.
 *
 * @param {Object} record
 * @returns {Object}
 */
function clone(record)
{
	const copy = structuredClone(record);
	Object.keys(copy).forEach(function (key)
	{
		if (!isArrayBuffer(copy[key]))
		{
			return;
		}
		const rehomed = new ArrayBuffer(copy[key].byteLength);
		new Uint8Array(rehomed).set(new Uint8Array(copy[key]));
		copy[key] = rehomed;
	});
	return copy;
}

/**
 * How large a record is, for the quota fake.
 *
 * `JSON.stringify(...).length` up to RM-012 J3, which is what a store of text
 * costs and what an `ArrayBuffer` does not: `JSON.stringify` renders one as
 * `{}`, so the model store's blobs would have weighed two bytes each and no
 * quota refusal could ever have been reached for the one store where a quota
 * refusal is likely.
 *
 * @param {Object} record
 * @returns {number}
 */
function weigh(record)
{
	return Object.values(record).reduce(function (sum, value)
	{
		if (isArrayBuffer(value)) {return sum + value.byteLength;}
		if (ArrayBuffer.isView(value)) {return sum + value.byteLength;}
		return sum + JSON.stringify(value === undefined ? null : value).length;
	}, 0);
}

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
			let total = weigh(record);
			this._records.forEach((existing) => {total += weigh(existing);});
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

		this._remember(key);
		this._records.set(key, clone(record));
		request._succeed(key);
		return request;
	}

	get(key)
	{
		const request = new FakeRequest();
		// Cloned on the way out as well as in. A real store hands the caller its
		// own copy, and the model repository's `read` returns the buffer straight
		// to a loader that will hold it.
		request._succeed(this._records.has(key) ? clone(this._records.get(key)) : undefined);
		return request;
	}

	delete(key)
	{
		const request = new FakeRequest();
		this._remember(key);
		this._records.delete(key);
		request._succeed(undefined);
		return request;
	}

	/**
	 * Record how to put one key back, so an abort can (RM-012 J3).
	 *
	 * @param {*} key
	 */
	_remember(key)
	{
		const records = this._records;
		const had = records.has(key);
		const before = records.get(key);
		this._transaction._undo.push(function ()
		{
			if (had) {records.set(key, before);}
			else {records.delete(key);}
		});
	}

	count()
	{
		const request = new FakeRequest();
		request._succeed(this._records.size);
		return request;
	}

	/**
	 * Every record in the store (RM-013 K1).
	 *
	 * Added for the project library, whose `list()` reads every card and no
	 * document. Deep-copied on the way out for the same reason `put` copies on
	 * the way in: a real IndexedDB hands back structured clones, and a fake that
	 * handed back live references would let a test mutate the store by editing
	 * what it read.
	 */
	getAll()
	{
		const request = new FakeRequest();
		request._succeed([...this._records.values()].map((row) => clone(row)));
		return request;
	}

	/** Empty the store. Added with `getAll` for the project library. */
	clear()
	{
		const request = new FakeRequest();
		const records = this._records;
		const before = new Map(records);
		this._transaction._undo.push(function ()
		{
			before.forEach(function (value, key) {records.set(key, value);});
		});
		records.clear();
		request._succeed(undefined);
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
		/**
		 * How to undo every write this transaction has made, newest first.
		 *
		 * Added by RM-012 J3, and it is a fidelity fix rather than a new feature.
		 * A real IndexedDB transaction is atomic: the model repository writes the
		 * record and the bytes in ONE transaction so that a quota refusal on the
		 * bytes leaves no record behind, and until this existed the fake left one -
		 * so `stats()` counted a model whose blob had never been written.
		 *
		 * @type {Array<Function>}
		 */
		this._undo = [];
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
		this._undo.reverse().forEach(function (rollback) {rollback();});
		this._undo = [];
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

	/**
	 * @param {string|Array<string>} names One store, or several in one
	 *        transaction - which is how the project library writes a card and a
	 *        body atomically (RM-013 K1). A real `transaction()` takes either.
	 */
	transaction(names)
	{
		const wanted = Array.isArray(names) ? names : [names];
		for (const name of wanted)
		{
			if (!this._stores.has(name))
			{
				throw new Error(`no object store named ${name}`);
			}
		}
		return new FakeTransaction(this, wanted[0]);
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
