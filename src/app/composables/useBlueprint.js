// @ts-check
import {inject, provide, markRaw, shallowRef} from 'vue';
import {BlueprintJS} from '../../scripts/blueprint.js';
import {assetResolver} from './useAssets.js';
import {modelStore} from '../import/model_store.js';

/**
 * Owns the one BlueprintJS instance and its lifetime.
 *
 * Sprint S6. This replaces the legacy demo's module-level `blueprint3d` global
 * (build/js/app.js:1) - and, more importantly, replaces the assumption behind
 * it: that the app is constructed once against a document that already exists
 * and is never taken down. A Vue route can mount and unmount this component
 * tree many times in one page load, so construction and disposal have to be
 * symmetric. `dispose()` (S2) is what makes that possible; this is what calls
 * it.
 *
 * ## markRaw, and why it is not optional
 *
 * Model objects - Wall, Corner, Room, Item - are compared with `===` inside
 * room detection and corner merging, and three's EventDispatcher dedupes
 * listeners by identity. A Vue `reactive()` proxy breaks both, silently and
 * late: the proxy is not `===` the target, so a wall would stop equalling
 * itself the moment it crossed the store boundary.
 *
 * So: `shallowRef` for the slots (we want the *reference* to be reactive, not
 * its contents) and `markRaw` on the instance (so it stays raw even if some
 * future caller drops it into a `reactive()`). Nothing in this app puts a
 * library object into a deep ref. See docs/roadmap.html section 04.
 *
 * UI updates come from the library's own events, exactly as the dat.GUI
 * `updateDisplay()` dance did - minus the dance.
 */

const BLUEPRINT_KEY = Symbol('architect3d.blueprint');

/**
 * @typedef {Object} BlueprintStore
 * @property {import('vue').ShallowRef<?Object>} instance The BlueprintJS, or null before mount / after unmount.
 * @property {import('vue').ShallowRef<?Object>} model
 * @property {import('vue').ShallowRef<?Object>} three
 * @property {import('vue').ShallowRef<?Object>} floorplanner Null in widget mode.
 * @property {function(Object): Object} mount
 * @property {function(): void} unmount
 */

/**
 * @returns {BlueprintStore}
 */
export function createBlueprintStore()
{
	/** @type {import('vue').ShallowRef<?any>} */
	var instance = shallowRef(null);
	/** @type {import('vue').ShallowRef<?any>} */
	var model = shallowRef(null);
	/** @type {import('vue').ShallowRef<?any>} */
	var three = shallowRef(null);
	/** @type {import('vue').ShallowRef<?any>} */
	var floorplanner = shallowRef(null);

	/**
	 * @param {Object} options
	 * @param {HTMLCanvasElement} options.floorplannerElement The 2D canvas.
	 * @param {HTMLElement} options.threeElement The 3D container.
	 * @param {string} [options.textureDir]
	 * @param {boolean} [options.widget]
	 */
	function mount(options)
	{
		if (instance.value)
		{
			return instance.value;
		}

		// Real elements, not ids. The library still accepts id strings for
		// back-compat, but a component cannot promise its ids are unique on the
		// page - and it has the nodes in hand already.
		var blueprint = markRaw(new BlueprintJS({
			floorplannerElement: options.floorplannerElement,
			threeElement: options.threeElement,
			threeCanvasElement: null,
			textureDir: options.textureDir || 'models/textures/',
			widget: Boolean(options.widget),
			// Where this deployment's assets live (RM-003 A5). The shared resolver,
			// which is identity until `loadManifest()` installs a manifest into it -
			// so a viewer mounted before the fetch lands still loads everything, and
			// picks up the indirection when it arrives.
			assets: assetResolver(),
			// Bytes for models nobody's deployment ships (RM-012 J3). Module-level
			// like the resolver, and for a sharper version of the same reason: this
			// object is handed in at every mount, and a layout change unmounts the
			// viewer - a store that lived on the runtime would take somebody's
			// imported models with it every time they moved a panel.
			localModels: modelStore(),
		}));

		instance.value = blueprint;
		model.value = markRaw(blueprint.model);
		// Non-null immediately after construction; BlueprintJS only clears it in
		// dispose(), and the property is declared nullable for that reason alone.
		three.value = blueprint.three ? markRaw(blueprint.three) : null;
		floorplanner.value = blueprint.floorplanner ? markRaw(blueprint.floorplanner) : null;

		return blueprint;
	}

	/**
	 * Release the WebGL context and every DOM listener. Idempotent, and safe to
	 * call before mount().
	 *
	 * The refs are cleared *before* dispose() so that anything watching them
	 * detaches its own listeners while the objects it registered them on are
	 * still intact. Disposing first would leave watchers unhooking from a
	 * half-destroyed view.
	 */
	function unmount()
	{
		var blueprint = instance.value;
		if (!blueprint)
		{
			return;
		}

		instance.value = null;
		model.value = null;
		three.value = null;
		floorplanner.value = null;

		blueprint.dispose();
	}

	return {instance, model, three, floorplanner, mount, unmount};
}

/**
 * Create the store and make it available to every descendant.
 * @returns {BlueprintStore}
 */
export function provideBlueprint()
{
	var store = createBlueprintStore();
	provide(BLUEPRINT_KEY, store);
	return store;
}

/**
 * @returns {BlueprintStore}
 */
export function useBlueprint()
{
	var store = inject(BLUEPRINT_KEY, null);
	if (!store)
	{
		throw new Error('useBlueprint() called outside a component tree that ran provideBlueprint().');
	}
	return store;
}
