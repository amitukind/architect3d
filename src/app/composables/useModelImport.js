// @ts-check
import {computed, ref} from 'vue';
import {UP_Y, UP_Z} from '../../scripts/blueprint.js';
import {modelStore, modelStoreKind} from '../import/model_store.js';
import {ACCEPT, DEFAULT_UNIT, MAX_MODEL_BYTES, externalRefsIn, fingerprint, fitScaleFor,
	formatOf, extensionOf, importsAvailable, localNameFor, orientedSize, refuseFile,
	unitScaleFor, UNITS} from '../import/model_file.js';
import {useToasts} from './useToasts.js';
import {createInjection} from './injection.js';

/**
 * Bring your own model (RM-012 J3).
 *
 * ## Three steps, and only the middle one is new
 *
 * **Read.** A `File` becomes an `ArrayBuffer`, a digest and a format. Refusals
 * happen here and by name - the wrong extension, an empty file, one over the
 * limit - because a refusal that arrives after a dialog has opened is a worse
 * refusal.
 *
 * **Decide.** The step X-7 did not price and the sprint brief did: a model
 * arrives in whatever unit and whatever axis its author used, and the model
 * layer stores centimetres and Y-up. `Scene.measureModel` parses the bytes with
 * the loader that will do the real load, so the dialog can show what each
 * answer would make the model rather than asking a person to imagine it.
 *
 * **Place.** The bytes go to the store, and `Scene.addItem` is called exactly as
 * the catalog calls it - the same seven arguments, the same metadata shape, the
 * same event. An imported chair and a catalog chair differ in one key.
 *
 * ## Why the unit is baked into the scale and the axis is not
 *
 * A design records `scale_x/y/z` absolutely, so the unit choice needs no new
 * field: `unitScale` reaches `Item.applyUnitScale`, which is the mechanism
 * RM-012 J1 built for catalog rows and this reuses unchanged. It records
 * `rotation` as one Y angle, which cannot say that a model is lying on its
 * face. So `local.up` is the only geometric thing added to the save format, and
 * `imported_model.js` is where that argument is written down.
 */

/** Re-exported so a component does not have to know both modules. */
export {ACCEPT, MAX_MODEL_BYTES, UNITS, UP_Y, UP_Z};

/**
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readAsBytes(file)
{
	return new Promise(function (resolve, reject)
	{
		var reader = new FileReader();
		reader.onload = function () {resolve(/** @type {ArrayBuffer} */(reader.result));};
		reader.onerror = function () {reject(reader.error || new Error('that file could not be read'));};
		reader.readAsArrayBuffer(file);
	});
}

/**
 * @param {Object} store The blueprint store.
 * @returns {Object}
 */
export function useModelImport(store)
{
	var toasts = useToasts();
	var models = modelStore();

	/** What is stored, for anything that lists it. @type {import('vue').Ref<Array<*>>} */
	var stored = ref([]);
	/** The file waiting on a scale-and-orient decision. @type {import('vue').Ref<?Object>} */
	var pending = ref(null);
	var busy = ref(false);
	/** @type {import('vue').Ref<?string>} */
	var refusal = ref(null);

	/** Whether this browser can import at all. */
	var available = computed(function ()
	{
		return importsAvailable() && modelStoreKind() !== 'unavailable';
	});

	/**
	 * Re-read the index and publish it.
	 * @returns {Promise<number>}
	 */
	async function refresh()
	{
		var count = await models.refresh();
		stored.value = models.records();
		return count;
	}

	/**
	 * Read a picked file and work out what to ask about it.
	 *
	 * @param {File} file
	 * @returns {Promise<boolean>} whether a decision is now pending.
	 */
	async function choose(file)
	{
		refusal.value = null;
		var why = refuseFile(file);
		if (why)
		{
			refusal.value = why;
			toasts.error('That file cannot be imported.', {detail: why});
			return false;
		}
		if (!available.value)
		{
			refusal.value = 'This browser cannot store imported models.';
			toasts.error('Imported models cannot be stored here.',
				{detail: 'Private browsing and some embedded browsers withhold the storage this needs.'});
			return false;
		}

		busy.value = true;
		try
		{
			var bytes = await readAsBytes(file);
			var format = formatOf(file.name);
			var id = await fingerprint(bytes);
			var scene = store.model.value ? store.model.value.scene : null;
			if (!scene)
			{
				refusal.value = 'The viewer is not ready yet.';
				return false;
			}
			// Measured before anything is stored. A file that cannot be parsed is
			// not a model, and finding that out after it is in the store would leave
			// a record nothing can ever place.
			var measured = await scene.measureModel(bytes, format);
			if (measured.empty)
			{
				refusal.value = `"${file.name}" has no geometry in it.`;
				toasts.error('That file has no geometry in it.',
					{detail: 'A model with no meshes loads to nothing, so there is nothing to place.'});
				return false;
			}

			pending.value = {
				id: id,
				file: file.name,
				format: format,
				extension: extensionOf(file.name),
				bytes: bytes,
				size: bytes.byteLength,
				measured: measured,
				name: localNameFor(id, extensionOf(file.name)),
				// What the file points at that is not inside it. Read from the
				// file's own reference list rather than inferred from the extension,
				// because a `.glb` can name an external texture too - one in this
				// repository does.
				external: externalRefsIn(bytes, format),
				// What the store already knows, if this file has been imported
				// before. The dialog says so rather than silently re-writing it.
				known: models.record(localNameFor(id, extensionOf(file.name))),
			};
			return true;
		}
		catch (error)
		{
			refusal.value = error instanceof Error ? error.message : String(error);
			toasts.error(`Could not read ${file.name}.`, {detail: refusal.value});
			return false;
		}
		finally
		{
			busy.value = false;
		}
	}

	/** Drop the pending decision without storing anything. */
	function cancel()
	{
		pending.value = null;
		refusal.value = null;
	}

	/**
	 * What a choice would make the model, in centimetres.
	 *
	 * Exported because the dialog draws it on every keystroke and the arithmetic
	 * should have one home.
	 *
	 * @param {Object} decision `{up, unit, longest}`
	 * @returns {{scale: number, size: Array<number>}}
	 */
	function preview(decision)
	{
		var extent = orientedSize(pending.value ? pending.value.measured.size : [0, 0, 0], decision.up);
		var scale = decision.longest > 0
			? fitScaleFor(extent, decision.longest)
			: unitScaleFor(decision.unit);
		return {scale: scale, size: extent.map(function (value) {return value * scale;})};
	}

	/**
	 * Store the pending model and put it in the design.
	 *
	 * @param {Object} decision `{up, unit, longest}`
	 * @returns {Promise<boolean>}
	 */
	async function place(decision)
	{
		var file = pending.value;
		if (!file)
		{
			return false;
		}
		busy.value = true;
		try
		{
			var up = decision.up === UP_Z ? UP_Z : UP_Y;
			var scale = preview(decision).scale;
			var record = {
				id: file.id,
				name: file.name,
				file: file.file,
				format: file.format,
				up: up,
				bytes: file.size,
				added: Date.now(),
			};
			var result = await models.put(record, file.bytes);
			if (!result.ok)
			{
				refusal.value = describeRefusal(result.reason);
				toasts.error(`${file.file} could not be stored.`, {detail: refusal.value});
				return false;
			}
			stored.value = models.records();

			// Exactly what `useCatalog.addItem` builds, plus one key. `unitScale`
			// carries the unit decision into `Item.applyUnitScale`, which is the
			// mechanism J1 already built; `local` carries the reference and the
			// axis, which is the only thing the save format could not already say.
			var scene = store.model.value.scene;
			scene.addItem(1, record.name, {
				itemName: file.file,
				resizable: true,
				modelUrl: record.name,
				itemType: 1,
				format: file.format,
				unitScale: scale,
				local: {id: record.id, file: record.file, up: up},
			}, null, null, null, false);
			pending.value = null;
			toasts.success(`Imported ${file.file}.`);
			return true;
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Place a model that is already stored, again.
	 *
	 * @param {Object} record
	 * @returns {boolean}
	 */
	function placeStored(record)
	{
		var scene = store.model.value ? store.model.value.scene : null;
		if (!scene || !record)
		{
			return false;
		}
		scene.addItem(1, record.name, {
			itemName: record.file,
			resizable: true,
			modelUrl: record.name,
			itemType: 1,
			format: record.format,
			// No `unitScale`. The stored record is the file, not a placement, and
			// the scale a person chose belongs to the item they chose it for -
			// re-deriving it here would make two copies of one model disagree the
			// moment one of them was resized.
			local: {id: record.id, file: record.file, up: record.up},
		}, null, null, null, false);
		return true;
	}

	/**
	 * Take bytes somebody sent, from a K2 bundle.
	 *
	 * The other half of RM-012 X-7's *"one answer, used twice"*. A bundle carries
	 * what the recipient will not have, which is exactly what an imported model
	 * is; the description comes from the design's own `local` key, because the
	 * zip carries bytes under a name and nothing else.
	 *
	 * @param {Object} ref One entry of `localRefsIn`.
	 * @param {ArrayBuffer} bytes
	 * @returns {Promise<boolean>}
	 */
	async function adopt(ref, bytes)
	{
		// Checked, not trusted. The id in the document is the digest of the bytes
		// the design was made with, so a recipient can verify that what arrived is
		// what was meant - which is the property content addressing exists for, and
		// the reason this is a rejection rather than a store-and-hope.
		if (await fingerprint(bytes) !== ref.id)
		{
			return false;
		}
		var result = await models.put({
			id: ref.id,
			name: ref.url,
			file: ref.file,
			format: formatOf(ref.url) || 'gltf',
			up: ref.up,
			bytes: bytes.byteLength,
			added: Date.now(),
		}, bytes);
		if (result.ok)
		{
			stored.value = models.records();
		}
		return result.ok;
	}

	/**
	 * Which of a design's imported models are not here.
	 *
	 * @param {string} design
	 * @returns {{wanted: Array<*>, missing: Array<*>}}
	 */
	function audit(design)
	{
		return models.audit(design);
	}

	/**
	 * Say what a design is missing, once, by name.
	 *
	 * J3's second acceptance clause. It is a toast rather than a refusal because
	 * the design has already loaded and everything else in it is fine - which is
	 * the other half of the same clause.
	 *
	 * @param {string} design
	 * @returns {number} how many were missing.
	 */
	function reportMissing(design)
	{
		var missing = models.audit(design).missing;
		if (!missing.length)
		{
			return 0;
		}
		var names = missing.map(function (ref) {return ref.file;}).join(', ');
		toasts.error(
			missing.length === 1
				? '1 imported model is not on this computer.'
				: `${missing.length} imported models are not on this computer.`,
			{detail: `${names} - the rest of the design opened normally. Open the .zip bundle it came in to restore them.`});
		return missing.length;
	}

	/**
	 * @param {string} id
	 * @returns {Promise<boolean>}
	 */
	async function forget(id)
	{
		var result = await models.forget(id);
		stored.value = models.records();
		return result.ok;
	}

	/** @returns {Promise<*>} */
	function stats()
	{
		return models.stats();
	}

	/** The bytes of one stored model, for the bundle builder. */
	function read(name)
	{
		return models.read(name);
	}

	return {
		stored, pending, busy, refusal, available,
		refresh, choose, cancel, preview, place, placeStored, adopt,
		audit, reportMissing, forget, stats, read,
		/** For a component that wants to say what the limit is. */
		ACCEPT, MAX_MODEL_BYTES, UNITS, DEFAULT_UNIT,
	};
}

/**
 * @param {?string} reason
 * @returns {string}
 */
function describeRefusal(reason)
{
	if (reason === 'quota')
	{
		return 'There is no room left in this browser’s storage for it.';
	}
	if (reason === 'version')
	{
		return 'The model store was written by a newer version of this app.';
	}
	if (reason === 'unavailable')
	{
		return 'This browser withholds the storage imported models need.';
	}
	return 'The browser refused the write.';
}

/**
 * `useModelImport` as an injection (RM-020 S-5). See `injection.js` for the pattern and
 * why twelve of the twenty-two composables use it.
 */
const injection = createInjection('ModelImport');

/** The key, for a component mounted outside the shell - a test, or another host. */
export const MODEL_IMPORT_KEY = injection.key;

/**
 * Build it and make it available to every descendant.
 * @returns {ReturnType<typeof useModelImport>}
 */
export function provideModelImport(store)
{
	return injection.put(useModelImport(store));
}

/**
 * Take it from an ancestor that called `provideModelImport`.
 * @returns {ReturnType<typeof useModelImport>}
 */
export function injectModelImport()
{
	return injection.take();
}
