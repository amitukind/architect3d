// @ts-check
import {TextureLoader} from 'three';

/**
 * One decode per image, however many surfaces draw with it (RM-002 R-04).
 *
 * ## The leak this replaces
 *
 * `Edge.updateTexture()` ran `new TextureLoader().load(url)` on every call - a
 * fresh loader and a fresh Texture - and `updateTexture` is wired to `redraw()`,
 * which is wired to EVENT_REDRAW. Nothing disposed the one it replaced, so every
 * redraw of a room leaked one GPU texture per wall surface. `Floor` did the same
 * on every rebuild, and `Edge` loaded the shared wall lightmap once per wall
 * rather than once per scene.
 *
 * The rest of the 3D view disposes carefully - Skybox, Lights, Controller and
 * Main all release properly. Textures were the gap.
 *
 * ## Why clones rather than one shared Texture
 *
 * The obvious cache - one Texture per URL, handed to everybody - is wrong here.
 * A wall sets `repeat` from its own width and height, so two walls sharing one
 * Texture object would both take whichever set it last, and the plaster on a
 * four-metre wall would tile like the plaster on a one-metre wall.
 *
 * `Texture.clone()` is exactly the split needed: `repeat`, `wrapS`, `wrapT` and
 * `colorSpace` are per-clone, while `.source` - the decoded image, and the GPU
 * upload keyed to it - is shared. So each surface gets its own knobs over one
 * copy of the pixels.
 *
 * A clone taken before the image arrives still receives it, because `image` is a
 * property of the shared `Source`. Live clones are tracked anyway and marked
 * `needsUpdate` when the load lands, so the upload is never missed.
 *
 * ## Lifetime
 *
 * Refcounted per URL. `release` disposes the clone immediately and the master
 * once the last clone is gone, so a design that stops using a texture stops
 * paying for it. `clearTextureCache()` drops everything and is called from
 * `Main.dispose()`.
 */

/** Shared across every viewer on the page, which is the point: so is the GPU. */
const loader = new TextureLoader();

/**
 * @typedef {Object} CacheEntry
 * @property {import('three').Texture} master The loaded original. Never handed out.
 * @property {Set<import('three').Texture>} clones Live handles, for needsUpdate on load.
 * @property {boolean} loaded
 * @property {Array<function(): void>} waiting Callbacks queued before the load landed.
 */

/** @type {Map<string, CacheEntry>} */
const entries = new Map();

/** Which URL a handed-out clone came from, so release() needs no bookkeeping from callers. */
const originOf = new WeakMap();

/**
 * Borrow a texture for `url`.
 *
 * @param {string} url
 * @param {function(): void} [onLoad] Called once the image is available - or
 *        immediately, if it already was. Note the difference from
 *        TextureLoader's callback, which fires per load; this fires per caller.
 * @returns {import('three').Texture} A clone the caller owns and must pass to
 *          {@link releaseTexture}. Safe to set wrap, repeat and colorSpace on.
 */
export function acquireTexture(url, onLoad)
{
	var entry = entries.get(url);

	if (!entry)
	{
		/** @type {CacheEntry} */
		var created = {master: null, clones: new Set(), loaded: false, waiting: []};
		created.master = loader.load(url, function ()
		{
			created.loaded = true;
			// The clones already share the decoded image through `source`; this is
			// what tells the renderer to upload it for each of them.
			created.clones.forEach(function (clone) {clone.needsUpdate = true;});
			var pending = created.waiting;
			created.waiting = [];
			pending.forEach(function (callback) {callback();});
		});
		entry = created;
		entries.set(url, entry);
	}

	var clone = entry.master.clone();
	entry.clones.add(clone);
	originOf.set(clone, url);

	if (onLoad)
	{
		if (entry.loaded)
		{
			onLoad();
		}
		else
		{
			entry.waiting.push(onLoad);
		}
	}

	return clone;
}

/**
 * Give a texture back. Safe to call with null, or twice.
 *
 * @param {?import('three').Texture} texture A clone from {@link acquireTexture}.
 *        Anything else is disposed directly rather than ignored - a caller that
 *        mixes cached and uncached textures should not have to remember which
 *        is which.
 */
export function releaseTexture(texture)
{
	if (!texture)
	{
		return;
	}

	var url = originOf.get(texture);
	if (url === undefined)
	{
		texture.dispose();
		return;
	}

	originOf.delete(texture);
	var entry = entries.get(url);
	texture.dispose();

	if (!entry)
	{
		return;
	}

	entry.clones.delete(texture);
	if (entry.clones.size === 0)
	{
		entry.master.dispose();
		entries.delete(url);
	}
}

/**
 * Drop every cached image.
 *
 * Called from Main.dispose(). Any clone still held by a caller keeps working -
 * it owns its own Texture - but the shared upload behind it is released, so
 * this is teardown, not a cache eviction to call speculatively.
 */
export function clearTextureCache()
{
	entries.forEach(function (entry)
	{
		entry.master.dispose();
	});
	entries.clear();
}

/**
 * How many distinct images are cached, and how many handles are out against
 * them. Exists for the tests that pin the leak - if the second number climbs
 * across redraws, R-04 has come back.
 *
 * @returns {{urls: number, handles: number}}
 */
export function textureCacheStats()
{
	var handles = 0;
	entries.forEach(function (entry) {handles += entry.clones.size;});
	return {urls: entries.size, handles: handles};
}
