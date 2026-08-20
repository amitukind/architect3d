// @ts-check
import {inject, provide, markRaw, ref, shallowRef} from 'vue';
import {BlueprintCore} from '../../scripts/blueprint.js';
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
 * @property {import('vue').ShallowRef<?Object>} three Null until ensureViewer() lands.
 * @property {import('vue').ShallowRef<?Object>} floorplanner Null in widget mode.
 * @property {import('vue').Ref<boolean>} viewerLoading Whether the 3D engine is on its way.
 * @property {function(Object): Object} mount
 * @property {function(): Promise<?Object>} ensureViewer
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
	/** Whether the viewer's chunk is in flight, for anything that wants to say so. */
	var viewerLoading = ref(false);
	/** @type {?Promise<?any>} The one in-flight import, so two asks share it. */
	var viewerLoad = null;

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
		var blueprint = markRaw(new BlueprintCore({
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
		// Null by construction as of RM-015 M3, and it stays null until something
		// asks to see the room. `three` is not "the viewer, before dispose()"
		// any more; it is "the viewer, if one has been attached".
		three.value = null;
		floorplanner.value = blueprint.floorplanner ? markRaw(blueprint.floorplanner) : null;

		return blueprint;
	}

	/**
	 * Bring the 3D engine in, and attach a viewer to the document (RM-015 M3).
	 *
	 * ## What this buys
	 *
	 * three is 47 % of what this application used to make a visitor download
	 * before it drew anything, and the default layout is the plan alone. So the
	 * engine is behind this call: `import()` is a chunk boundary the bundler
	 * honours, and the measurement is in blueprint_core.js.
	 *
	 * ## Why a promise and not a flag
	 *
	 * Because the answer is genuinely not available yet, and the callers that
	 * cannot proceed without a viewer - exporting a glTF, capturing a
	 * thumbnail - need something to wait on. The ones that only want the viewer
	 * *eventually*, which is most of them, watch `three` instead and are
	 * written for it: `useWalkthrough` has said "one constructed later starts at
	 * the stored height" since long before this sprint.
	 *
	 * Idempotent in both directions: the import is cached in `viewerLoad`, and
	 * `attachViewer` returns the existing viewer rather than building a second
	 * one - which matters because a layout watcher can fire twice before a
	 * chunk arrives.
	 *
	 * @returns {Promise<?Object>} The viewer, or null if there is no document to
	 *          attach it to - before mount, or unmounted while the chunk was in
	 *          flight.
	 */
	function ensureViewer()
	{
		if (three.value)
		{
			return Promise.resolve(three.value);
		}
		if (!instance.value)
		{
			return Promise.resolve(null);
		}
		if (!viewerLoad)
		{
			viewerLoading.value = true;
			viewerLoad = import('../../scripts/three/main.js').then(function (module)
			{
				viewerLoading.value = false;
				// The document can have gone away while the engine was downloading -
				// a route change, a closed tab's last render. Attaching to a disposed
				// core would build a renderer nobody will ever dispose.
				var blueprint = instance.value;
				if (!blueprint)
				{
					return null;
				}
				three.value = markRaw(blueprint.attachViewer(module.Main));
				return three.value;
			}).catch(function (error)
			{
				viewerLoading.value = false;
				// `catch` rather than the second argument to `then`, so this covers
				// both ways the engine can fail to arrive: the chunk not landing, and
				// the renderer refusing to be constructed once it has. A machine with
				// no working WebGL fails the second way, and it is the more likely of
				// the two.
				//
				// Cleared so a later attempt re-imports rather than replaying the
				// failure forever. An offline first switch to 3D should succeed on the
				// second try once the network is back.
				viewerLoad = null;
				throw error;
			});
		}
		return viewerLoad;
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
		// Not the module: an import is cached by the browser and by the bundler's
		// runtime, so a remount re-imports for free. What must be dropped is the
		// *attachment* promise, which resolves to a viewer belonging to a document
		// that is about to be disposed.
		viewerLoad = null;
		viewerLoading.value = false;

		blueprint.dispose();
	}

	return {instance, model, three, floorplanner, viewerLoading, mount, ensureViewer, unmount};
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
