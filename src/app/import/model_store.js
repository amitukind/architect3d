// @ts-check
import {createModelRepository} from '../persistence/model_repository.js';
import {localRefsIn} from './model_file.js';

/**
 * The application's answer to the library's byte store (RM-012 J3).
 *
 * `src/scripts/core/imported_model.js` asks two questions - *do you have this
 * name*, synchronously, and *give me its bytes*, which may take a moment. This
 * is what answers them, and the split is the reason the whole feature needs no
 * loading step anywhere:
 *
 * - **The index is in memory.** One `list()` at boot reads every record and not
 *   one model, because the repository keeps them in separate object stores.
 *   Tens of models is a few kilobytes, so `has()` is a `Map` lookup and
 *   `Scene.addItem` can decide between the import branch and the asset manifest
 *   without waiting for anything.
 * - **The bytes are not.** `read()` goes to IndexedDB every time. There is no
 *   cache in front of it on purpose: a design may name several thirty-megabyte
 *   models, and holding all of them resident for the life of the tab to save a
 *   few milliseconds per placement is the wrong trade. They exist in the process
 *   while a parse is running and then they do not.
 *
 * ## Module-level, like the resolver and the favourites list
 *
 * There is one person at one keyboard with one set of imported models, and the
 * store has to outlive the viewer: `useBlueprint.unmount()` disposes the whole
 * `BlueprintJS` when the workspace layout changes, and a store that lived on the
 * runtime would take everybody's imports with it. This object is handed to
 * `BlueprintJS({localModels})` at every mount and is the same object each time.
 */

/** @type {*} */
let repository = createModelRepository();

/**
 * Point the store at another repository. The suite's seam, and the only one.
 *
 * @param {*} next
 */
export function setModelRepository(next)
{
	repository = next || createModelRepository();
	store.reset();
}

/** @returns {string} `indexeddb` or `unavailable`. */
export function modelStoreKind()
{
	return repository.kind;
}

/**
 * Bytes by logical name, backed by IndexedDB.
 *
 * Implements exactly the two methods `Scene` calls, plus what the application
 * needs to keep the index true.
 */
class ModelStore
{
	constructor()
	{
		/** @type {Map<string, import('../persistence/model_repository.js').ModelRecord>} */
		this._index = new Map();
		/** Whether `refresh()` has completed at least once. */
		this.ready = false;
	}

	/** Forget everything known, without touching the store. */
	reset()
	{
		this._index.clear();
		this.ready = false;
	}

	/**
	 * Read the index from the repository.
	 *
	 * Called once at boot and again after anything is written, and cheap enough
	 * to call whenever the answer might have moved - it is the records store
	 * only, which is a few hundred bytes a model.
	 *
	 * @returns {Promise<number>} how many models are stored.
	 */
	async refresh()
	{
		var records = await repository.list();
		this._index.clear();
		records.forEach((record) => {this._index.set(record.name, record);});
		this.ready = true;
		return this._index.size;
	}

	/**
	 * Whether this store can produce bytes for a name, answered now.
	 *
	 * @param {string} name
	 * @returns {boolean}
	 */
	has(name)
	{
		return this._index.has(name);
	}

	/**
	 * @param {string} name
	 * @returns {Promise<?ArrayBuffer>}
	 */
	async read(name)
	{
		var record = this._index.get(name);
		return record ? repository.read(record.id) : null;
	}

	/**
	 * Store a model and index it.
	 *
	 * @param {import('../persistence/model_repository.js').ModelRecord} record
	 * @param {ArrayBuffer} bytes
	 * @returns {Promise<import('../persistence/model_repository.js').ModelResult>}
	 */
	async put(record, bytes)
	{
		var result = await repository.put(record, bytes);
		if (result.ok && result.record)
		{
			this._index.set(result.record.name, result.record);
		}
		return result;
	}

	/**
	 * @param {string} id
	 * @returns {Promise<{ok: boolean, reason: ?string}>}
	 */
	async forget(id)
	{
		var result = await repository.remove(id);
		if (result.ok)
		{
			this._index.forEach((record, name) =>
			{
				if (record.id === id) {this._index.delete(name);}
			});
		}
		return result;
	}

	/** @returns {Promise<{ok: boolean, reason: ?string}>} */
	async forgetAll()
	{
		var result = await repository.clear();
		if (result.ok)
		{
			this._index.clear();
		}
		return result;
	}

	/** @returns {Array<import('../persistence/model_repository.js').ModelRecord>} */
	records()
	{
		return [...this._index.values()].sort(function (a, b) {return (b.added || 0) - (a.added || 0);});
	}

	/** @param {string} name */
	record(name)
	{
		return this._index.get(name) || null;
	}

	get count()
	{
		return this._index.size;
	}

	/**
	 * Which of a design's imported models this computer does not have.
	 *
	 * The whole of J3's second acceptance clause, and the reason the reference
	 * in a save file carries the original filename: with the store empty, the
	 * document is the only thing that knows a model was ever called `chair.glb`.
	 *
	 * @param {string} design A `.blueprint3d` document.
	 * @returns {{wanted: Array<*>, missing: Array<*>}}
	 */
	audit(design)
	{
		var wanted = localRefsIn(design);
		return {wanted: wanted, missing: wanted.filter((ref) => !this.has(ref.url))};
	}

	/** @returns {Promise<*>} */
	stats()
	{
		return repository.stats();
	}
}

const store = new ModelStore();

/** The one store. Handed to `BlueprintJS({localModels})` at every mount. */
export function modelStore()
{
	return store;
}
