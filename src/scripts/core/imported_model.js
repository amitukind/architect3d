// @ts-check

/**
 * A model that came off somebody's disk (RM-012 J3).
 *
 * ## What X-7 measured, and what is left over
 *
 * `model/scene.js` already constructs `GLTFLoader`, `OBJLoader`, `DRACOLoader`
 * and `KTX2Loader`. So every format RM-007 names for this sprint - GLB, glTF
 * and OBJ - already has a reader in the bundle, and J3 writes none. What it has
 * nowhere to put is **the bytes**: an item's model is `model_url`, a relative
 * URL resolved through `AssetResolver`, and a file picked off a disk has no URL
 * to resolve.
 *
 * This file is the library half of the answer, and it is deliberately three
 * small things rather than one big one.
 *
 * ## 1. A byte store the library does not own
 *
 * {@link LocalModels} is a name-to-bytes map with a `has` that answers
 * synchronously and a `read` that may not. That split is the whole interface,
 * and it is what lets the application back it with IndexedDB without this file
 * knowing IndexedDB exists: an index of *which* models are stored is small
 * enough to hold in memory at boot, and the bytes are fetched when a load
 * actually needs them.
 *
 * **There is no naming convention here.** A resolver maps a logical name to a
 * URL; this maps a logical name to bytes; `Scene` asks this one first. A name
 * the store has bytes for is not missing, whatever the asset manifest says, and
 * nothing in the library has to recognise a prefix to know that. The `local/`
 * convention is the application's, and it is in `src/app/import/`.
 *
 * ## 2. The one thing a save file cannot already express
 *
 * A design records `scale_x/y/z` absolutely and `rotation` as a single Y angle.
 * So an imported model's **size** needs no new key - the unit chosen at import
 * is baked into the scale, exactly as a catalog row's `unitScale` is - and its
 * **yaw** needs no new key either.
 *
 * What neither can express is which axis the author called up. A model exported
 * from a Z-up tool is lying on its face and no yaw will stand it up. That is why
 * `local.up` exists, and why it is the only geometric field here.
 *
 * ## 3. The orientation is applied to the geometry, not to the object
 *
 * {@link orientGeometry} rotates the buffer, before `Item`'s constructor centres
 * it. Setting `rotation.x` on the object instead would be one line shorter and
 * wrong in four places: `objectHalfSize`, the two label planes, `placeInRoom`
 * and the resize handles all measure the geometry, and `getMetaData` writes
 * `rotation.y` alone - so the object-level tilt would be lost on the next save
 * and the item would be the wrong size in the meantime.
 */

/** The convention three.js, glTF and this library use. Nothing is rotated. */
export const UP_Y = 'y';
/** Blender, 3ds Max, most CAD, and most OBJ files in the wild. */
export const UP_Z = 'z';

/**
 * A stored model's description, as a design writes it.
 *
 * @typedef {Object} ImportedModel
 * @property {string} id What the store keys on.
 * @property {string} file What the file was called when it was picked. The only
 *           field that exists purely to be read out loud - see the note on
 *           `normaliseImport`.
 * @property {string} up `UP_Y` or `UP_Z`.
 */

/**
 * Read an item's `local` key defensively.
 *
 * Additive and conditional, like `opening`, `stair`, `structure` and `lamp`
 * before it: an item that was not imported writes no `local` key, so a design
 * of catalog furniture is byte-identical to the file it was before J3.
 *
 * ## Why `file` travels in the document
 *
 * It is redundant with the store - right up to the moment the store is the
 * thing that is missing, which is the case J3's second acceptance clause is
 * about. A design opened on a computer that never saw the import has to be able
 * to say *"chair.glb is not on this computer"*, and the only place that name can
 * come from then is the document.
 *
 * @param {*} local
 * @returns {?ImportedModel}
 */
export function normaliseImport(local)
{
	if (!local || typeof local !== 'object' || typeof local.id !== 'string' || !local.id)
	{
		return null;
	}
	return {
		id: local.id,
		file: (typeof local.file === 'string' && local.file) ? local.file : local.id,
		up: (local.up === UP_Z) ? UP_Z : UP_Y,
	};
}

/**
 * Stand a Z-up model up, in place.
 *
 * `rotateX(-90 degrees)` maps `(x, y, z)` to `(x, z, -y)`, which is exactly the
 * Z-up to Y-up change of basis. Applied to the buffer, so everything that
 * measures the geometry afterwards measures the oriented model.
 *
 * @param {*} geometry A `BufferGeometry`.
 * @param {?string} up
 * @returns {boolean} whether anything was rotated.
 */
export function orientGeometry(geometry, up)
{
	if (up !== UP_Z || !geometry || typeof geometry.rotateX !== 'function')
	{
		return false;
	}
	geometry.rotateX(-Math.PI * 0.5);
	return true;
}

/**
 * What `Scene` needs from a byte store, and nothing more.
 *
 * Two methods, named as a type rather than as a class, because the store the
 * application supplies is backed by IndexedDB and shares no implementation with
 * the one below - only this contract. `has` answers now; `read` may not.
 *
 * @typedef {Object} LocalModelSource
 * @property {function(string): boolean} has
 * @property {function(string): (ArrayBuffer|Promise<?ArrayBuffer>|null)} read
 */

/**
 * Bytes for models that are not in any deployment.
 *
 * The library ships an empty one on every runtime, which is why `Scene` can ask
 * it unconditionally and why a build that imports nothing behaves exactly as it
 * did. The application replaces it with one backed by IndexedDB.
 *
 * @implements {LocalModelSource}
 */
export class LocalModels
{
	constructor()
	{
		/** @type {Map<string, ArrayBuffer>} */
		this._bytes = new Map();
	}

	/**
	 * Whether this store can produce bytes for a name, answered without waiting.
	 *
	 * Synchronous on purpose. `Scene.addItem` has to decide between the local
	 * branch and the asset manifest *before* it starts anything, and a store that
	 * could only answer asynchronously would turn every catalog item's load into
	 * a promise hop to be told no.
	 *
	 * @param {string} name
	 * @returns {boolean}
	 */
	has(name)
	{
		return this._bytes.has(name);
	}

	/**
	 * @param {string} name
	 * @returns {(ArrayBuffer|Promise<?ArrayBuffer>|null)}
	 */
	read(name)
	{
		return this._bytes.get(name) || null;
	}

	/**
	 * @param {string} name
	 * @param {ArrayBuffer} bytes
	 */
	set(name, bytes)
	{
		this._bytes.set(name, bytes);
	}

	/** @param {string} name */
	delete(name)
	{
		return this._bytes.delete(name);
	}

	clear()
	{
		this._bytes.clear();
	}

	/** @returns {Array<string>} */
	names()
	{
		return [...this._bytes.keys()];
	}

	get count()
	{
		return this._bytes.size;
	}
}
