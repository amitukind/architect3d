import {EventDispatcher, JSONLoader, Color, LinearEncoding} from 'three';
import GLTFLoader from 'three-gltf-loader';
import OBJLoader from '@calvinscofield/three-objloader';
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

//		var grid = new GridHelper(4000, 200);

		this.scene = new ThreeScene();
		this.scene.background = new Color(0xffffff);
//		this.scene.fog = new Fog(0xFAFAFA, 0.001, 6000);
		this.items = [];
		this.needsUpdate = false;
		// init item loader
		this.loader = new JSONLoader();
		this.loader.setCrossOrigin('');

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
//		this.add(grid);

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
		// var items_copy = this.items ;
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
		//this.itemRemovedCallbacks.fire(item);
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

		var loaderCallback = function (geometry, materials, isgltf=false)
		{
//			var item = new (Factory.getClass(itemType))(scope.model, metadata, geometry, new MeshFaceMaterial(materials), position, rotation, scale);
			var item = new (Factory.getClass(itemType))(scope.model, metadata, geometry, materials, position, rotation, scale, isgltf);
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
			var merged = mergeMeshes(gltfModel.scene);
			if(metadata.legacyConverted)
			{
				restoreLegacyTextureEncoding(merged.materials);
			}
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
		else if(!metadata.format)
		{
			// Nothing in the shipped catalog reaches this branch as of S3, and the
			// shim above rewrites every legacy URL a saved design can carry. The
			// counter is the exit-gate evidence: it stays at zero for a session.
			Scene.legacyJsonLoadCount++;
			console.warn(`Loading "${fileName}" through the retired three.js JSONLoader. That loader disappears with the r185 bump in S4 - convert the model with tools/convert-legacy-json.mjs.`);
			this.loader.load(fileName, loaderCallback, undefined); // third parameter is undefined - TODO_Ekki
		}
		else if(metadata.format == 'gltf')
		{
			this.gltfloader.load(fileName, gltfCallback, null, null);
		}
		else if(metadata.format == 'obj')
		{
			this.objloader.load(fileName, objCallback, null, null);
		}
	}
}

/**
 * How many items have been loaded through the retired JSONLoader this session.
 *
 * The S3 exit gate is that this stays zero: every catalog entry is glTF, and
 * every legacy URL a saved design can carry is rewritten before dispatch. S4
 * deletes the branch and this counter with it.
 */
Scene.legacyJsonLoadCount = 0;

/**
 * Undo GLTFLoader's sRGB tagging on the models converted in S3.
 *
 * GLTFLoader marks every baseColorTexture sRGBEncoding, which is right for a
 * colour-managed pipeline. This renderer is not one yet: outputEncoding is
 * Linear and gammaOutput is off, so a decoded texture is written out without
 * being re-encoded and lands about a gamma darker than the same bytes did under
 * the legacy JSONLoader, which tagged nothing.
 *
 * Restoring LinearEncoding on exactly these 25 models keeps them looking as
 * they always have, which is what makes their per-model A/B review passable.
 * Deliberately scoped to converted legacy models - the 142 Kenney glTF models
 * have rendered as sRGB all along and are left alone. S8 replaces all of this
 * with a real colour pipeline and deletes this function.
 */
function restoreLegacyTextureEncoding(materials)
{
	materials.forEach(function (material)
	{
		if(material && material.map)
		{
			material.map.encoding = LinearEncoding;
			material.map.needsUpdate = true;
			material.needsUpdate = true;
		}
	});
}
