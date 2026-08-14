import {EventDispatcher, Color} from 'three';
// three's own addons since S4, replacing the three-gltf-loader and
// @calvinscofield/three-objloader repacks. Each of those bundled its own copy
// of three (r105 and r94), so `instanceof` silently failed across the seam and
// the bundle carried three full engines.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {Scene as ThreeScene} from 'three';
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
		// init item loader
		this.gltfloader = new GLTFLoader();
		this.objloader = new OBJLoader();
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

	switchWireframe(flag)
	{
		this.items.forEach((item)=>{
			item.switchWireframe(flag);
		});
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

		var loaderCallback = function (geometry, materials)
		{
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

		this.dispatchEvent({type:EVENT_ITEM_LOADING});
		if(this.itemLoader)
		{
			// Test/embedding seam - see this.itemLoader in the constructor.
			this.itemLoader(fileName, metadata, loaderCallback);
		}
		else if(metadata.format == 'gltf')
		{
			this.gltfloader.load(fileName, gltfCallback, null, null);
		}
		else if(metadata.format == 'obj')
		{
			this.objloader.load(fileName, objCallback, null, null);
		}
		else
		{
			// Formatless means the retired three.js JSON format, whose loader S4
			// removed along with r98. resolveModelUrl rewrites every name the
			// shipped library ever used, so reaching this means a design references
			// a model that was never part of it.
			//
			// Counted and reported rather than ignored: the alternative is an item
			// that dispatched EVENT_ITEM_LOADING and then never resolves, which
			// leaves an embedder's spinner up forever with nothing in the console.
			Scene.unloadableItemCount++;
			console.error(`Cannot load "${fileName}": the retired three.js JSON model format has no loader as of three r185. Convert the model with tools/convert-legacy-json.mjs and add it to LEGACY_MODEL_MAP, or give the item metadata a "gltf" or "obj" format.`);
			this.dispatchEvent({type:EVENT_ITEM_LOADED, item: null});
		}
	}
}

/**
 * Items a design asked for that no loader in this build can open.
 *
 * Replaces S3's legacyJsonLoadCount, which existed to prove the retired
 * JSONLoader was never entered before S4 deleted it. The branch is gone; what
 * is worth counting now is the failure that took its place, so an embedder can
 * assert on it and the exit gate stays checkable. Zero for the shipped catalog.
 */
Scene.unloadableItemCount = 0;

