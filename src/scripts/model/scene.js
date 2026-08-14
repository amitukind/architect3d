import {EventDispatcher, Color} from 'three';
// three's own addons since S4, replacing the three-gltf-loader and
// @calvinscofield/three-objloader repacks. Each of those bundled its own copy
// of three (r105 and r94), so `instanceof` silently failed across the seam and
// the bundle carried three full engines.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {Scene as ThreeScene, LoadingManager} from 'three';
import {runtimeOf} from '../core/design_runtime.js';
import {disposeMaterial} from '../core/resource_registry.js';
import {Utils} from '../core/utils.js';
import {mergeMeshes} from '../core/geometry_merge.js';
import {resolveModelUrl} from '../core/legacy_models.js';
import {Factory} from '../items/factory.js';
import {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED} from '../core/events.js';

/**
 * The Scene is a manager of Items and also links to a ThreeJS scene.
 */
export class Scene extends EventDispatcher
{
	/**
	 * Constructs a scene.
	 * @param model The associated model.
	 * @param textureDir The directory from which to load the textures.
	 */
	constructor(model, textureDir)
	{
		super();
		this.model = model;
		this.textureDir = textureDir;


		this.scene = new ThreeScene();
		this.scene.background = new Color(0xffffff);
		this.items = [];
		this.needsUpdate = false;

		/**
		 * This design's services (RM-003 A4). Read off the model's floorplan,
		 * which resolved it - a `Scene` is always constructed by a `Model` that
		 * has already built its `Floorplan`.
		 *
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = runtimeOf(model && model.floorplan);

		/**
		 * Which document the loads in flight belong to (RM-003 A1).
		 *
		 * The runtime's session since A4, rather than one of this scene's own.
		 * Loads still start and finish here and `Model` still drives it, calling
		 * `begin()` as part of applying a validated document; what changed is that
		 * disposing the document can now invalidate the session, which it could
		 * not do while the only reference was on an object it did not hold.
		 *
		 * Still exposed as `scene.loadSession`, which is where `useHistory` and
		 * the suite look for it.
		 *
		 * @type {import('../core/load_session.js').LoadSession}
		 */
		this.loadSession = this.runtime.loadSession;

		/**
		 * This scene's own LoadingManager, so a superseded load can be aborted.
		 *
		 * Both loaders used to be constructed with no manager, which gives them
		 * three's global `DefaultLoadingManager` - one shared abort surface for
		 * every document on the page, which is the same thing as none. With a
		 * manager per scene, `manager.abort()` stops the fetches this design
		 * started and nobody else's.
		 *
		 * The abort is real in r185: `FileLoader` composes the manager's signal
		 * with its own through `AbortSignal.any`, and `GLTFLoader` passes the
		 * manager down to the `FileLoader` and `TextureLoader` it builds. It is
		 * still only half the mechanism - see LoadSession for why identity has to
		 * carry the rest.
		 *
		 * @type {LoadingManager}
		 */
		this.loadingManager = new LoadingManager();

		// init item loader
		this.gltfloader = new GLTFLoader(this.loadingManager);
		this.objloader = new OBJLoader(this.loadingManager);
		this.gltfloader.setCrossOrigin('');

		/**
		 * Optional loader override, used by tests to run the model layer without
		 * network I/O (the loaders above are the data layer's only environment
		 * dependency). When set, addItem() calls this instead of the real loader:
		 *
		 *   setItemLoader((fileName, metadata, onLoad) => onLoad(geometry, materials))
		 *
		 * Null in production, where the format-based dispatch below is used.
		 */
		this.itemLoader = null;

		this.itemLoadingCallbacks = null;
		this.itemLoadedCallbacks = null;
		this.itemRemovedCallbacks = null;

		/**
		 * Items THIS scene asked for that no loader in this build can open.
		 *
		 * The static Scene.unloadableItemCount below is the process-wide total and
		 * still counts everything, because embedders and the S4 exit gate read it.
		 * It is also the first of the four module-level singletons in RM-002 R-02
		 * to become per-instance, and the one where the cost of not being was
		 * already visible: with two designs open the total says nothing about
		 * either, and the test suite has to zero it between cases.
		 *
		 * @type {number}
		 */
		this.unloadableItemCount = 0;

	}

	/** Adds a non-item, basically a mesh, to the scene.
	 * @param mesh The mesh to be added.
	 */
	add(mesh)
	{
		this.scene.add(mesh);
	}

	/** Removes a non-item, basically a mesh, from the scene.
	 * @param mesh The mesh to be removed.
	 */
	remove(mesh)
	{
		this.scene.remove(mesh);
		Utils.removeValue(this.items, mesh);
	}

	/** Gets the scene.
	 * @returns The scene.
	 */
	getScene()
	{
		return this.scene;
	}

	/** Gets the items.
	 * @returns The items.
	 */
	getItems()
	{
		return this.items;
	}

	/** Gets the count of items.
	 * @returns The count.
	 */
	itemCount()
	{
		return this.items.length;
	}

	/** Removes all items. */
	clearItems()
	{
		var scope = this;
		this.items.forEach((item) => {
			scope.removeItem(item, true);
		});
		this.items = [];
	}

	/**
	 * Removes an item.
	 * @param item The item to be removed.
	 * @param dontRemove If not set, also remove the item from the items list.
	 */
	removeItem(item, keepInList)
	{
		keepInList = keepInList || false;
		// use this for item meshes
		this.dispatchEvent({type: EVENT_ITEM_REMOVED, item:item});
		item.removed();
		this.scene.remove(item);
		if (!keepInList)
		{
			Utils.removeValue(this.items, item);
		}
	}

	/**
	 * Move an item that is already here to where a document says it should be
	 * (RM-003 A3).
	 *
	 * The other half of `Model.newRoom`'s reconciliation, and the reason undo
	 * stops re-downloading the furniture: an item the incoming document still has
	 * keeps its geometry, its materials and its GPU upload, and is repositioned.
	 * Nothing is loaded, so nothing is dispatched - a caller counting
	 * `EVENT_ITEM_LOADING` against `EVENT_ITEM_LOADED` stays balanced because
	 * neither happens.
	 *
	 * The scale goes through `Item.applyScale`, the absolute form. `setScale` is
	 * relative and expressing an absolute target through it does not round-trip:
	 * `1.5 * (1 / 1.5)` is not 1.
	 *
	 * @param {Object} item An item from {@link Scene#getItems}.
	 * @param {import('three').Vector3} position
	 * @param {number} rotation Radians about Y.
	 * @param {import('three').Vector3} scale The absolute scale wanted.
	 * @param {boolean} fixed
	 */
	updateItem(item, position, rotation, scale, fixed)
	{
		item.fixed = fixed || false;
		if (rotation !== undefined && rotation !== null)
		{
			item.rotation.y = rotation;
		}
		if (scale && !item.scale.equals(scale))
		{
			item.applyScale(scale.x, scale.y, scale.z);
		}
		// Directly, not through `moveToPosition`. That is the interactive drag path
		// and it carries placement rules: `FloorItem.moveToPosition` clamps y to
		// the floor and, if the target is outside a room, shows an error and
		// **returns without moving at all**. Restoring a snapshot is not a drag -
		// the position in it was valid when it was written - so applying those
		// rules here made undo lossy. The round-trip suite in
		// tests/history-and-selection.test.js found it on its first run.
		item.position.copy(position);
		if (item.bhelper)
		{
			item.bhelper.update();
		}
	}

	switchWireframe(flag)
	{
		this.items.forEach((item)=>{
			item.switchWireframe(flag);
		});
	}

	/**
	 * Stop the fetches this scene started (RM-003 A1).
	 *
	 * Best-effort, and deliberately not the mechanism the correctness rests on.
	 * `LoadingManager.abort()` reaches a `FileLoader` that has already issued its
	 * request, because r185 composes the manager's signal into the fetch through
	 * `AbortSignal.any` - but it cannot reach an embedder's own `setItemLoader`,
	 * which is arbitrary code, and it cannot un-decode a model that has already
	 * arrived. What guarantees the result is the generation check in
	 * `addItem`'s callbacks; this only saves the bandwidth.
	 *
	 * Guarded because the manager is a three object and a caller may have swapped
	 * in something simpler, and because `abort` arrived in r185 - a peer on an
	 * older three would not have it.
	 */
	abortPendingLoads()
	{
		if (this.loadingManager && typeof this.loadingManager.abort === 'function')
		{
			this.loadingManager.abort();
		}
	}

	/**
	 * Override how item models are fetched. The data layer's only network
	 * dependency lives in addItem(); supplying a loader here makes the whole
	 * model layer runnable headlessly (vitest, Node) and lets an embedder
	 * supply its own asset pipeline.
	 * @param {?function(string, Object, function(Object, Array))} fn
	 *        Receives (fileName, metadata, onLoad) and must call
	 *        onLoad(geometry, materials). Pass null to restore the built-in
	 *        format-based loaders.
	 */
	setItemLoader(fn)
	{
		this.itemLoader = (typeof fn === 'function') ? fn : null;
	}

	/**
	 * Creates an item and adds it to the scene.
	 * @param itemType The type of the item given by an enumerator.
	 * @param fileName The name of the file to load.
	 * @param metadata TODO
	 * @param position The initial position.
	 * @param rotation The initial rotation around the y axis.
	 * @param scale The initial scaling.
	 * @param fixed True if fixed.
	 * @param newItemDefinitions - Object with position and 'edge' attribute if it is a wall item
	 */
	addItem(itemType, fileName, metadata, position, rotation, scale, fixed, newItemDefinitions)
	{
		if(itemType == undefined)
		{
			itemType = 1;
		}
		
		var scope = this;

		// Designs saved before S3 name models in the retired three.js JSON
		// format. Rewriting here rather than in Model.newRoom covers every way an
		// item can be created, and mutating metadata means the item carries the
		// new URL into its next save - so a file needs the shim exactly once.
		var resolved = resolveModelUrl(fileName, metadata.format);
		fileName = resolved.url;
		metadata.format = resolved.format;
		if (resolved.converted)
		{
			// modelUrl is what Item.getMetaData() writes back out, so updating it
			// here is what makes the next save glb-native. A design therefore needs
			// the shim exactly once, however many times it is opened.
			metadata.modelUrl = fileName;
			metadata.legacyConverted = true;
		}

		// Which document asked (RM-003 A1). Stamped before the load starts, checked
		// when it comes back. Every exit below - success, failure, and the stale
		// path - goes through the session exactly once.
		var generation = this.loadSession.started();

		var loaderCallback = function (geometry, materials)
		{
			if (!scope.loadSession.finished(generation))
			{
				// A later document superseded this one while the model was in
				// flight. Nothing here belongs to the design that is now open.
				//
				// The geometry and materials still have to be released: the loader
				// built them whether or not anybody still wants them, and this is the
				// only place that knows they are unwanted. Without these two lines
				// A1 would quietly undo A0 on every superseded load.
				if (geometry && typeof geometry.dispose === 'function')
				{
					geometry.dispose();
				}
				disposeMaterial(materials);
				scope.dispatchEvent({type:EVENT_ITEM_LOADED, item: null, stale: true});
				return;
			}

			var item = new (Factory.getClass(itemType))(scope.model, metadata, geometry, materials, position, rotation, scale);
			item.fixed = fixed || false;
			scope.items.push(item);
			scope.add(item);
			item.initObject();
			scope.dispatchEvent({type:EVENT_ITEM_LOADED, item: item});
			if(newItemDefinitions)
			{
				item.moveToPosition(newItemDefinitions.position, newItemDefinitions.edge);
				item.placeInRoom();
			}
		};
		var gltfCallback = function(gltfModel)
		{
			// S3 built a restoreLegacyTextureEncoding() here, undoing GLTFLoader's
			// sRGB tagging on the 25 converted models so they matched a renderer
			// that was deliberately not colour-managed. S8 made the renderer
			// colour-managed, so the shim is gone and GLTFLoader's tagging stands.
			//
			// It also removes an inconsistency the freeze created: the catalog
			// lists all 25 as .glb, so a chair placed from the palette already
			// rendered differently from the same chair restored out of an old save
			// - only the restored one carried the legacyConverted flag. They agree
			// again now. metadata.legacyConverted is still written, since the URL
			// shim reports through it.
			var merged = mergeMeshes(gltfModel.scene);
			loaderCallback(merged.geometry, merged.materials);
		};

		var objCallback = function(object)
		{
			var merged = mergeMeshes(object);
			loaderCallback(merged.geometry, merged.materials);
		};

		/**
		 * The one exit every failed load takes.
		 *
		 * Until this existed the loaders were called with a null onError and
		 * nothing around them, so a 404, a malformed .glb, or a URL the
		 * environment cannot even parse dispatched EVENT_ITEM_LOADING and then
		 * dispatched nothing at all. Three things depended on a balance that could
		 * not be relied on: an embedder's loading indicator, the count below, and
		 * the application's undo gate, which counts loads in flight and needed an
		 * eight-second timer purely to survive a count that never came back down.
		 *
		 * It resolves as EVENT_ITEM_LOADED with a null item rather than as an
		 * event of its own. That is the convention the formatless branch has used
		 * since S4, and it is the one that matters: every listener counting loads
		 * is balanced by it whether or not it knows this failure mode exists.
		 * Listeners that use the payload must null-check - Controller.itemLoaded
		 * is the only one in this repository, and it did not until now.
		 *
		 * @param {string} why Appended to the message, so the console says what
		 *        went wrong rather than only that something did.
		 */
		var failed = function (why)
		{
			// Settled either way (RM-003 A1). A superseded failure is still a
			// failure that has come back, and the session has to stop waiting on it
			// - but it is not counted against the current document, because it was
			// never the current document's load.
			var wanted = scope.loadSession.finished(generation, false);
			if (!wanted)
			{
				scope.dispatchEvent({type:EVENT_ITEM_LOADED, item: null, stale: true});
				return;
			}
			scope.unloadableItemCount++;
			Scene.unloadableItemCount++;
			console.error(`Cannot load "${fileName}": ${why}`);
			scope.dispatchEvent({type:EVENT_ITEM_LOADED, item: null});
		};

		/** three's loaders hand onError an ErrorEvent, an Error, or nothing. */
		var describeError = function (error)
		{
			if (error && error.message)
			{
				return error.message;
			}
			return 'the model could not be loaded.';
		};

		this.dispatchEvent({type:EVENT_ITEM_LOADING});

		/**
		 * Availability as a policy rather than a console line (RM-003 A5).
		 *
		 * A resolver carrying a manifest knows what this build ships, so a name
		 * that is not in it is answerable **before** the network is touched - and
		 * the message can name the item rather than being whichever 404 the loader
		 * happened to surface. `missing()` is false whenever there is no manifest,
		 * which is what keeps a build that ships none behaving exactly as before.
		 */
		if (this.runtime.assets.missing(fileName))
		{
			failed(`this build does not ship that asset. "${metadata.itemName || 'The item'}" names a file the asset manifest does not declare.`);
			return;
		}

		// Logical name in, physical URL out (A5). `fileName` stays logical: it is
		// what `metadata.modelUrl` records and therefore what the next save writes,
		// and rewriting it here would bake one deployment's URLs into the document
		// - which is the whole failure H-8 describes.
		var physicalUrl = this.runtime.assets.resolve(fileName).url;

		if(this.itemLoader)
		{
			// Test/embedding seam - see this.itemLoader in the constructor.
			//
			// Deliberately outside the try below. The seam's job is to supply
			// geometry, and it calls loaderCallback synchronously; wrapping it would
			// catch failures thrown by item construction rather than by loading,
			// which is a different thing and is pinned as such by the DOM-boundary
			// test in tests/items-and-scene.test.js.
			//
			// Handed the LOGICAL name, not the resolved URL. An embedder's loader is
			// their own asset pipeline and is entitled to its own naming; a resolver
			// they did not configure must not rewrite what reaches it.
			this.itemLoader(fileName, metadata, loaderCallback);
		}
		else if(metadata.format == 'gltf' || metadata.format == 'obj')
		{
			var loader = (metadata.format == 'gltf') ? this.gltfloader : this.objloader;
			var onLoad = (metadata.format == 'gltf') ? gltfCallback : objCallback;
			try
			{
				// The try covers starting the load and nothing else. three's
				// FileLoader builds a Request up front, and a URL the environment
				// cannot parse throws there - synchronously, past the onError
				// callback that exists for exactly this and never sees it.
				loader.load(physicalUrl, onLoad, undefined, function (error) {failed(describeError(error));});
			}
			catch (error)
			{
				failed(describeError(error));
			}
		}
		else
		{
			// Formatless means the retired three.js JSON format, whose loader S4
			// removed along with r98. resolveModelUrl rewrites every name the
			// shipped library ever used, so reaching this means a design references
			// a model that was never part of it.
			failed('the retired three.js JSON model format has no loader as of three r185. Convert the model with tools/convert-legacy-json.mjs and add it to LEGACY_MODEL_MAP, or give the item metadata a "gltf" or "obj" format.');
		}
	}
}

/**
 * Items ANY scene in this process asked for that no loader in this build can
 * open. See `scene.unloadableItemCount` for the per-instance figure.
 *
 * Replaces S3's legacyJsonLoadCount, which existed to prove the retired
 * JSONLoader was never entered before S4 deleted it. The branch is gone; what
 * is worth counting now is the failure that took its place, so an embedder can
 * assert on it and the exit gate stays checkable. Zero for the shipped catalog.
 *
 * Kept as a process total rather than replaced by the instance field: it is
 * documented behaviour that an embedder may already read, and the S4 exit gate
 * is written against it. A second design opening in the same page makes it
 * ambiguous, which is what the instance field is for.
 */
Scene.unloadableItemCount = 0;

