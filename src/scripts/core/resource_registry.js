// @ts-check
import {Object3D} from 'three';

/**
 * Who owns a geometry, and who gives it back (RM-003 A0).
 *
 * ## The problem this exists for
 *
 * Before A0 the whole of `src/` contained three `geometry.dispose()` or
 * `material.dispose()` calls, and `Floorplan.update()` abandoned six meshes,
 * six geometries and six materials on every call. three's own guidance is
 * unambiguous about whose job that is - *"three.js can not automatically clean
 * these resources up... it's up to you to manage them"* - and removing an object
 * from a scene frees nothing at all.
 *
 * The obvious fix is to pair every construction site with a matching dispose.
 * That is what the existing three calls are, and it is why there are three of
 * them: the `redraw()` paths construct in one method and discard in another, so
 * the pairing is invisible at both ends and easy to forget at both ends.
 *
 * ## What this changes
 *
 * Disposal becomes a **boundary** rather than a habit. An owner registers what
 * it builds and calls `releaseAll()` at the one place its resources stop being
 * needed. Adding a seventh mesh to `Edge.updatePlanes()` needs no new dispose
 * call, because the boundary already covers it.
 *
 * ## Refcounting, and why it is not optional
 *
 * `Edge` builds one wall material and hands it to more than one mesh; a shared
 * material disposed by the first mesh to be released leaves the second drawing
 * with a dead handle. So a resource registered twice must be released twice.
 * This is the same design {@link module:three/texture_cache} already uses for
 * images, and it is the mitigation for the risk that over-disposal is worse than
 * the leak it replaces.
 *
 * ## What it deliberately does not own
 *
 * **Textures from the shared cache.** `acquireTexture`/`releaseTexture` refcount
 * those across viewers, and disposing one here would pull an image out from
 * under another design. Callers keep releasing those the way they already do.
 * Textures a caller made itself - an `Item`'s label canvases, for instance - are
 * registered explicitly, because nothing else will.
 *
 * `Material.dispose()` in three does not touch the material's maps, so the two
 * schemes cannot collide: releasing a material never disposes a cached image.
 */

/** Anything with a `dispose()`: BufferGeometry, Material, Texture, RenderTarget. */
/**
 * @typedef {Object} Disposable
 * @property {function(): void} dispose
 */

/**
 * @param {*} value
 * @returns {boolean}
 */
function isDisposable(value)
{
	return !!value && typeof value.dispose === 'function';
}

/**
 * Every geometry and material an `Object3D` subtree draws with.
 *
 * Textures are not included - see the note above about the two ownership
 * schemes. A multi-material mesh contributes each of its materials.
 *
 * @param {?Object} object An Object3D, or null.
 * @param {function(Disposable): void} visit
 */
export function forEachResource(object, visit)
{
	if (!object)
	{
		return;
	}

	if (isDisposable(object.geometry))
	{
		visit(object.geometry);
	}

	if (object.material)
	{
		var materials = Array.isArray(object.material) ? object.material : [object.material];
		materials.forEach(function (material)
		{
			if (isDisposable(material))
			{
				visit(material);
			}
		});
	}

	if (object.children)
	{
		object.children.forEach(function (child) {forEachResource(child, visit);});
	}
}

/**
 * Unlink an object from its parent.
 *
 * ## Why this is not `object.parent.remove(object)`
 *
 * Because `Item` extends `Mesh` and declares its own `remove()` - a no-argument
 * method meaning *"take me out of the design"*, which calls
 * `Scene.removeItem(this)`. That shadows `Object3D.remove(child)`, which means
 * something entirely different. Detaching a child of an `Item` - one of its two
 * dimension-label planes, say - through the ordinary call therefore re-enters
 * item removal and recurses until the stack gives out.
 *
 * Going through the prototype does what the scene graph needs and cannot be
 * intercepted by a subclass that happens to have taken the name. The shadowing
 * itself is a genuine hazard - any three internal calling `parent.remove(child)`
 * on an `Item` hits it - but `Item.remove()` is public API, so renaming it is a
 * breaking change and belongs in its own change rather than in A0.
 *
 * @param {?Object} object
 */
function detach(object)
{
	if (object && object.parent)
	{
		Object3D.prototype.remove.call(object.parent, object);
	}
}

/**
 * Dispose everything an `Object3D` subtree owns, without a registry.
 *
 * For the callers that build a mesh, use it, and drop it within one method -
 * where a registry would be ceremony around a single pairing. Detaches the
 * object from its parent first, because a disposed geometry left in a scene is
 * drawn until something notices.
 *
 * Safe on null, and safe twice: three's `dispose()` is idempotent.
 *
 * @param {?Object} object
 */
export function disposeObject(object)
{
	if (!object)
	{
		return;
	}
	detach(object);
	forEachResource(object, function (resource) {resource.dispose();});
}

/**
 * Dispose a material, or every material in an array.
 *
 * `Item.material` is one or the other depending on how many groups the merged
 * glTF produced, and both forms are load-bearing - `getMaterialColor` branches
 * on `material.length`. This is the same branch, once, where a caller would
 * otherwise write it again.
 *
 * Does NOT touch the material's maps: in three a material's textures outlive it,
 * which is what keeps this compatible with the shared texture cache.
 *
 * @param {?(Disposable|Array<Disposable>)} material
 */
export function disposeMaterial(material)
{
	if (!material)
	{
		return;
	}
	if (Array.isArray(material))
	{
		material.forEach(function (entry)
		{
			if (isDisposable(entry))
			{
				entry.dispose();
			}
		});
		return;
	}
	if (isDisposable(material))
	{
		material.dispose();
	}
}

/**
 * A set of GPU resources with one owner and one release point.
 */
export class ResourceRegistry
{
	constructor()
	{
		/**
		 * How many outstanding handles each resource has. A resource leaves the
		 * map, and is disposed, when its last handle is released.
		 * @type {Map<Disposable, number>}
		 */
		this._handles = new Map();
	}

	/**
	 * Take ownership of one resource. Registering the same one twice means it
	 * takes two releases to dispose, which is what makes sharing safe.
	 *
	 * @template T
	 * @param {T} resource A geometry, material or texture. Anything without a
	 *        `dispose()` is returned untouched, so a caller need not check.
	 * @returns {T} the same resource, for chaining onto a constructor call.
	 */
	register(resource)
	{
		if (isDisposable(resource))
		{
			var current = this._handles.get(/** @type {Disposable} */(resource)) || 0;
			this._handles.set(/** @type {Disposable} */(resource), current + 1);
		}
		return resource;
	}

	/**
	 * Take ownership of every geometry and material in an `Object3D` subtree.
	 *
	 * @template T
	 * @param {T} object
	 * @returns {T} the same object.
	 */
	registerObject(object)
	{
		var scope = this;
		forEachResource(object, function (resource) {scope.register(resource);});
		return object;
	}

	/**
	 * Give one handle back. The resource is disposed when the last one goes.
	 *
	 * A resource this registry does not own is ignored rather than disposed:
	 * releasing something borrowed is a bug in the caller, and disposing it would
	 * turn that bug into a corrupted frame somewhere else.
	 *
	 * @param {?Disposable} resource
	 */
	release(resource)
	{
		if (!isDisposable(resource))
		{
			return;
		}
		// Bound to a local rather than re-asserting on `resource` at each use.
		// `isDisposable` is a plain predicate, so the checker cannot narrow through
		// it, and casting four times reads as though something subtle is going on
		// when nothing is.
		var owned = /** @type {Disposable} */(resource);
		var count = this._handles.get(owned);
		if (count === undefined)
		{
			return;
		}
		if (count > 1)
		{
			this._handles.set(owned, count - 1);
			return;
		}
		this._handles.delete(owned);
		owned.dispose();
	}

	/**
	 * Give back every geometry and material in an `Object3D` subtree, and detach
	 * it from its parent.
	 *
	 * @param {?Object} object
	 */
	releaseObject(object)
	{
		if (!object)
		{
			return;
		}
		detach(object);
		var scope = this;
		forEachResource(object, function (resource) {scope.release(resource);});
	}

	/**
	 * Release everything at once, whatever its handle count.
	 *
	 * This is the teardown boundary, not a bulk `release()`: an owner being
	 * disposed is giving up every handle it holds, so counting down one at a time
	 * would leave anything it registered twice alive forever.
	 */
	releaseAll()
	{
		this._handles.forEach(function (count, resource) {resource.dispose();});
		this._handles.clear();
	}

	/**
	 * What this registry is holding. Exists so a leak stays assertable - if
	 * `resources` climbs across redraws, A0 has come back.
	 *
	 * @returns {{resources: number, handles: number}}
	 */
	stats()
	{
		var handles = 0;
		this._handles.forEach(function (count) {handles += count;});
		return {resources: this._handles.size, handles: handles};
	}
}
