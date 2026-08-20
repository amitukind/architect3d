// @ts-check
import {EventDispatcher, Color} from 'three';
import {Scene as ThreeScene, LoadingManager, Group, Box3, Vector3} from 'three';
import {runtimeOf} from '../core/design_runtime.js';
import {disposeMaterial, disposeObject} from '../core/resource_registry.js';
import {Utils} from '../core/utils.js';
import {mergeMeshes} from '../core/geometry_merge.js';
import {resolveModelUrl} from '../core/legacy_models.js';
import {ITEM_TYPE_PARAMETRIC_OPENING, ITEM_TYPE_PARAMETRIC_STAIR, ITEM_TYPE_PARAMETRIC_STRUCTURE} from '../items/factory.js';
import {buildOpeningGeometry, normaliseOpening} from '../items/opening.js';
import {buildStairGeometry, normaliseStair} from '../items/stair.js';
import {buildStructureGeometry, normaliseStructure} from '../items/structure.js';
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
		/**
		 * One three.js `Group` per storey, keyed by level id (RM-010 G1).
		 *
		 * This is where a level's base elevation is applied and the only place it
		 * is: `Floor`, `Edge` and `Item` each build their geometry relative to a
		 * plan they are handed and know nothing about storeys, which is what makes
		 * a level a translation rather than a change to how anything is computed
		 * (V-4). The GPU stops here too - a `Level` is plain data and does not hold
		 * one of these.
		 *
		 * @type {Map<string, import('three').Group>}
		 */
		this.levelGroups = new Map();
		this.needsUpdate = false;

		/**
		 * Whether a dragged item snaps to the furniture around it (RM-012 J4).
		 *
		 * Off by default, so nothing about a drag changes for an embedder who has
		 * not asked for it and no parity capture moves. `Item.applySnap` reads it;
		 * the application turns it on beside the grid snap it already offers.
		 *
		 * @type {boolean}
		 */
		this.snapItems = false;

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

		/**
		 * This scene's glTF, OBJ, Draco and KTX2 loaders - once something has
		 * asked for them (RM-015 M3).
		 *
		 * A promise rather than the loaders, because getting them now involves a
		 * network fetch: they live behind a dynamic import, and `model/loaders.js`
		 * carries the measurement that put them there. Held so the second model
		 * load reuses the first one's import rather than racing it.
		 *
		 * @type {?Promise<import('./loaders.js').ModelLoaders>}
		 * @private
		 */
		this._loaders = null;

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
		this.model.levels.forEach((level) => {Utils.removeValue(level.items, mesh);});
	}

	/**
	 * The container a level's geometry goes into, made on demand (RM-010 G1).
	 *
	 * Positioned at the level's base elevation, which `Model` derives from the
	 * heights below it. Every caller goes through here rather than holding a
	 * group, so a level whose height changed is re-placed by `syncLevels()` and
	 * nothing else has to know.
	 *
	 * @param {import('./level.js').Level} level
	 * @returns {import('three').Group}
	 */
	levelGroup(level)
	{
		var existing = this.levelGroups.get(level.id);
		if (existing)
		{
			return existing;
		}
		var group = new Group();
		group.name = `level:${level.id}`;
		group.position.y = this.model.levelBase(this.model.levels.indexOf(level));
		this.levelGroups.set(level.id, group);
		this.scene.add(group);
		return group;
	}

	/**
	 * A scene-shaped façade onto one level's group (RM-010 G1).
	 *
	 * `Floorplan3D`, `Floor` and `Edge` ask a scene for exactly three things -
	 * `add`, `remove` and `needsUpdate` - measured before this was written. So a
	 * level's 3D projection is built by handing it one of these instead of the
	 * scene, and not one line of those three files changes. That is the whole of
	 * why the base elevation lands here.
	 *
	 * @param {import('./level.js').Level} level
	 * @returns {{add: Function, remove: Function, needsUpdate: boolean}}
	 */
	levelScene(level)
	{
		var scope = this;
		var group = this.levelGroup(level);
		return {
			add: function (mesh) {group.add(mesh);},
			remove: function (mesh) {group.remove(mesh);},
			get needsUpdate() {return scope.needsUpdate;},
			set needsUpdate(value) {scope.needsUpdate = value;},
		};
	}

	/**
	 * Put every level's group where its level now is, and show or hide it.
	 *
	 * Called when a level is added, removed, re-sized or switched to - editing
	 * the ground floor's height moves every storey above it, and nothing stores
	 * the old base to go stale.
	 *
	 * @param {Object} [options] `activeOnly` hides every level but the active one.
	 * @returns {void}
	 */
	syncLevels(options)
	{
		var settings = options || {};
		var scope = this;
		this.model.levels.forEach(function (level, index)
		{
			var group = scope.levelGroup(level);
			group.position.y = scope.model.levelBase(index);
			group.visible = settings.activeOnly
				? (index === scope.model.activeLevelIndex) : true;
		});
		this.needsUpdate = true;
	}

	/**
	 * Move an item that is already here onto another storey (RM-010 G1).
	 *
	 * Only the reconciliation in `Model.newRoom` needs it, and only in one case:
	 * an item that survived a document load because its id and model matched, but
	 * whose record is now on a different floor. Rare, and silent if it were left
	 * out - the item would keep its mesh at the old storey's elevation while the
	 * file said otherwise.
	 *
	 * @param {Object} item
	 * @param {import('./level.js').Level} level
	 * @returns {void}
	 */
	moveItemToLevel(item, level)
	{
		if (item.level === level)
		{
			return;
		}
		this.model.levels.forEach((other) => {Utils.removeValue(other.items, item);});
		item.level = level;
		level.items.push(item);
		this.levelGroup(level).add(item);
	}

	/**
	 * Drop a level's container, with whatever is still in it.
	 *
	 * `Model.removeLevel` takes the items out first, so what is left here is the
	 * walls and floors the 3D projection built - and those belong to a
	 * `Floorplan3D` that is about to be disposed. Removing the group rather than
	 * emptying it means the projection's own dispose still finds its meshes.
	 *
	 * @param {import('./level.js').Level} level
	 * @returns {void}
	 */
	forgetLevel(level)
	{
		var group = this.levelGroups.get(level.id);
		if (group)
		{
			this.scene.remove(group);
			this.levelGroups.delete(level.id);
		}
	}

	/** Gets the scene.
	 * @returns The scene.
	 */
	getScene()
	{
		return this.scene;
	}

	/**
	 * The furniture on the storey being edited (RM-010 G1).
	 *
	 * Scoped to the active level, which is what every one of this method's
	 * callers wants and each of them was checked: the plan's item count, the
	 * projection the 2D view draws, and the raycast that decides what a click in
	 * the 3D view hits. All three are about the storey somebody is working on.
	 *
	 * The two that are not - the save file and resolving an id - call
	 * {@link Scene#allItems} instead, because a file holds the whole building and
	 * an id names one item in it.
	 *
	 * @returns {Array<Object>}
	 */
	getItems()
	{
		return this.model.level.items;
	}

	/**
	 * The furniture on every storey.
	 * @returns {Array<Object>}
	 */
	allItems()
	{
		return this.model.levels.reduce(
			(all, level) => all.concat(level.items), /** @type {Array<Object>} */ ([]));
	}

	/** Gets the count of items on the active storey.
	 * @returns The count.
	 */
	itemCount()
	{
		return this.getItems().length;
	}

	/** Removes all items, on every storey. */
	clearItems()
	{
		var scope = this;
		this.allItems().forEach((item) => {
			scope.removeItem(item, true);
		});
		this.model.levels.forEach((level) => {level.items = [];});
	}

	/**
	 * Removes an item.
	 * @param item The item to be removed.
	 * @param {boolean} [keepInList] If not set, also remove the item from the
	 *        items list. Optional, and now declared as such: `Model` calls this
	 *        with one argument in two places and TypeScript read a two-parameter
	 *        signature as requiring both (RM-005 C2). The docblock said
	 *        `dontRemove`, which is neither the parameter's name nor its sense.
	 */
	removeItem(item, keepInList)
	{
		keepInList = keepInList || false;
		// use this for item meshes
		this.dispatchEvent({type: EVENT_ITEM_REMOVED, item:item});
		item.removed();
		// From whichever level's group it is in. `Object3D.remove` on the wrong
		// parent is a no-op, so this is a search rather than a guess, and an item
		// added before levels existed may still be a child of the scene itself.
		if (item.parent)
		{
			item.parent.remove(item);
		}
		this.scene.remove(item);
		if (!keepInList)
		{
			this.model.levels.forEach((level) => {Utils.removeValue(level.items, item);});
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
		this.allItems().forEach((item)=>{
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
	 * @param {?function(string, Object, function(Object, Array): void): void} fn
	 *        Receives (fileName, metadata, onLoad) and must call
	 *        onLoad(geometry, materials). Pass null to restore the built-in
	 *        format-based loaders.
	 */
	setItemLoader(fn)
	{
		this.itemLoader = (typeof fn === 'function') ? fn : null;
	}

	/**
	 * This scene's loaders, importing them if this is the first ask (M3).
	 *
	 * Every caller of this is already asynchronous - a model load is a network
	 * fetch - so the import adds a hop to a path that had several, and adds
	 * nothing at all to a session that never loads a model. The promise is
	 * cached, not the loaders: two items placed in the same tick share one
	 * import rather than starting two.
	 *
	 * @returns {Promise<import('./loaders.js').ModelLoaders>}
	 * @private
	 */
	_ensureLoaders()
	{
		if (!this._loaders)
		{
			var scope = this;
			this._loaders = import('./loaders.js').then(function (module)
			{
				return module.createModelLoaders(scope.loadingManager, scope.runtime.assets);
			});
		}
		return this._loaders;
	}

	/**
	 * Bytes in, an Object3D out, through the loader the format names (J3).
	 *
	 * The one place model bytes are parsed rather than fetched, shared by the
	 * import branch of `addItem` and by `measureModel`. It is a method rather
	 * than a function because the loaders it uses are this scene's: the
	 * `GLTFLoader` here has a `DRACOLoader` and a `KTX2Loader` attached to it,
	 * pointed at this deployment's decoder paths, and a compressed model parsed
	 * by a bare loader throws rather than decompressing.
	 *
	 * @param {ArrayBuffer} bytes
	 * @param {?string} format `gltf` or `obj`.
	 * @returns {Promise<Object>} The parsed root, which the caller owns and must
	 *          dispose or merge.
	 * @private
	 */
	_parseModel(bytes, format)
	{
		return this._ensureLoaders().then((loaders) => new Promise(function (resolve, reject)
		{
			if (format == 'obj')
			{
				// `OBJLoader.parse` is synchronous and throws on bytes that are not
				// an OBJ; inside the executor, that rejects.
				resolve(loaders.objloader.parse(new TextDecoder().decode(new Uint8Array(bytes))));
				return;
			}
			if (format != 'gltf')
			{
				reject(new Error(`no loader in this build reads the "${format}" format.`));
				return;
			}
			// The empty path is deliberate, and the limit it imposes is real: a
			// model whose textures sit beside it as separate files cannot resolve
			// them from bytes alone, because there is no directory to be relative
			// to. That is NOT only a `.gltf` problem - `ik_nordli_full.glb` in this
			// repository names `textures/white_wood.ktx2` as an external image, and
			// it is a `.glb`. Such a model loads with its geometry and without its
			// texture, which is the right failure and a silent one; the application
			// reads the file's own reference list at import and says so
			// (`externalRefsIn` in `src/app/import/model_file.js`).
			loaders.gltfloader.parse(bytes, '', function (gltf) {resolve(gltf.scene);}, reject);
		}));
	}

	/**
	 * How big a model is, in the units its author used (J3).
	 *
	 * The import step needs this before anything is placed: a file states no unit
	 * anywhere, so the only way to ask *"is 1 unit a metre or a centimetre?"* in
	 * terms a person can answer is to show them what each choice would make the
	 * model, and that needs the bounds.
	 *
	 * Measured with the loader that will do the real load, which is the point:
	 * a second reader agreeing with this one is an assumption, and RM-013 K1
	 * found that assumption wrong on 4 of 15 rows when a bounds walk was written
	 * beside three.js rather than through it.
	 *
	 * The parsed graph is disposed here. Nothing is added to the scene, and a
	 * measurement that leaked a `BufferGeometry` per import would undo RM-003 A0
	 * one file at a time.
	 *
	 * @param {ArrayBuffer} bytes
	 * @param {?string} format
	 * @returns {Promise<{min: Array<number>, max: Array<number>, size: Array<number>, empty: boolean}>}
	 */
	async measureModel(bytes, format)
	{
		var object = await this._parseModel(bytes, format);
		try
		{
			var box = new Box3().setFromObject(object);
			var size = box.getSize(new Vector3());
			// `Box3` reports an inverted box for an object with no geometry at all,
			// which would arrive as a size of -Infinity and make every derived
			// number nonsense. Saying it is empty is the honest answer.
			var empty = box.isEmpty();
			return {
				min: empty ? [0, 0, 0] : box.min.toArray(),
				max: empty ? [0, 0, 0] : box.max.toArray(),
				size: empty ? [0, 0, 0] : size.toArray(),
				empty: empty,
			};
		}
		finally
		{
			disposeObject(object);
		}
	}

	/**
	 * Creates an item and adds it to the scene.
	 * @param itemType The type of the item given by an enumerator.
	 * @param fileName The name of the file to load.
	 * @param metadata Item descriptor: `itemName`, `resizable`, `format`, and
	 *        the catalog fields carried through to the placed item.
	 * @param position The initial position.
	 * @param rotation The initial rotation around the y axis.
	 * @param scale The initial scaling.
	 * @param fixed True if fixed.
	 * @param {Object} [newItemDefinitions] Object with position and 'edge'
	 *        attribute if it is a wall item. Optional: `Model.loadSerialized`
	 *        calls this with seven arguments, which is the ordinary case - a
	 *        document restores an item's own position rather than a placement
	 *        hint (RM-005 C2).
	 */
	addItem(itemType, fileName, metadata, position, rotation, scale, fixed, newItemDefinitions)
	{
		if(itemType == undefined)
		{
			itemType = 1;
		}
		
		var scope = this;

		// A parametric item has no file to name - an opening (RM-008 F1), a flight
		// of stairs (F3) or a column or beam (F2) - so the legacy URL shim below is
		// skipped for it; `resolveModelUrl` on an absent filename would invent one.
		var parametric = (itemType === ITEM_TYPE_PARAMETRIC_OPENING
			|| itemType === ITEM_TYPE_PARAMETRIC_STAIR
			|| itemType === ITEM_TYPE_PARAMETRIC_STRUCTURE);

		// Designs saved before S3 name models in the retired three.js JSON
		// format. Rewriting here rather than in Model.newRoom covers every way an
		// item can be created, and mutating metadata means the item carries the
		// new URL into its next save - so a file needs the shim exactly once.
		if (!parametric)
		{
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
		}

		// Which storey asked, captured before the load starts and used when it
		// comes back (RM-010 G1). The same argument as the generation below: an
		// item placed on the ground floor whose model was still downloading when
		// somebody switched to the first floor belongs to the ground floor.
		var level = this.model.level;

		// Which document asked (RM-003 A1). Stamped before the load starts, checked
		// when it comes back. Every exit below - success, failure, and the stale
		// path - goes through the session exactly once.
		var generation = this.loadSession.started();

		var buildItem = function (geometry, materials)
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
			// Onto the storey being edited, and into that storey's group - which is
			// what puts it at the right height without `Item` knowing there are
			// storeys (RM-010 G1). `level` is captured before the load starts, so an
			// item whose model was still downloading when somebody switched floors
			// lands where it was placed rather than where they are now.
			item.level = level;
			level.items.push(item);
			scope.levelGroup(level).add(item);
			item.initObject();
			scope.dispatchEvent({type:EVENT_ITEM_LOADED, item: item});
			if(newItemDefinitions)
			{
				item.moveToPosition(newItemDefinitions.position, newItemDefinitions.edge);
				item.placeInRoom();
			}
		};
		// Its mesh is built from its own numbers rather than downloaded, and then
		// it takes exactly the path every other item takes (RM-008 F1, F3). One
		// construction site, one placement, one event, one session check - which
		// is why this is a short-circuit into the callback and not a second
		// version of it. F3 added a second generator and did not add a second
		// short-circuit: what differs between a door and a staircase is one
		// expression, and everything after it is shared.
		if (parametric)
		{
			var built;
			if (itemType === ITEM_TYPE_PARAMETRIC_STAIR)
			{
				built = buildStairGeometry(normaliseStair(metadata.stair));
			}
			else if (itemType === ITEM_TYPE_PARAMETRIC_STRUCTURE)
			{
				built = buildStructureGeometry(normaliseStructure(metadata.structure));
			}
			else
			{
				var wall = newItemDefinitions && newItemDefinitions.edge && newItemDefinitions.edge.wall;
				metadata.wallThickness = wall ? wall.thickness : undefined;
				built = buildOpeningGeometry(normaliseOpening(metadata.opening), metadata.wallThickness);
			}
			this.dispatchEvent({type: EVENT_ITEM_LOADING});
			buildItem(built.geometry, built.materials);
			return;
		}

		var loaderCallback = buildItem;
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
		 * A model that is in no deployment, because somebody imported it
		 * (RM-012 J3).
		 *
		 * Asked **before** the availability check below, and the ordering is the
		 * whole of the change: a manifest is a statement about what this build
		 * ships, and an imported model is by definition not that. Without this the
		 * next line would refuse every imported item in any build that fetched a
		 * manifest - which is every deployment of the application.
		 *
		 * Asked **after** `itemLoader`, so an embedder's own pipeline keeps the
		 * precedence its documentation promises.
		 *
		 * It parses rather than fetching. The store hands over bytes; wrapping
		 * them in a blob URL so the network layer can hand the same bytes back is
		 * a detour with an object lifetime to manage, and a revoked URL is a class
		 * of bug that simply does not exist here. What it costs is
		 * `LoadingManager.abort()`, which cannot reach a `parse` - the generation
		 * check in `buildItem` still can, and that is the one that decides whether
		 * a superseded item joins the scene.
		 */
		var local = this.runtime.localModels;
		if (!this.itemLoader && local && local.has(fileName))
		{
			Promise.resolve(local.read(fileName)).then(function (bytes)
			{
				if (!bytes)
				{
					failed('this design names an imported model that is no longer in the store.');
					return;
				}
				return scope._parseModel(bytes, metadata.format).then(function (object)
				{
					var merged = mergeMeshes(object);
					loaderCallback(merged.geometry, merged.materials);
				});
			}).catch(function (error) {failed(describeError(error));});
			return;
		}

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
			if (metadata.local)
			{
				// Reached when a design carrying an import is opened where the store
				// is not - another computer, another browser, a cleared profile. The
				// document carries the original filename for exactly this sentence,
				// which is why `normaliseImport` keeps a field that is otherwise
				// redundant with the store.
				failed(`"${metadata.local.file || metadata.local.id}" was imported from a file, and that file is not on this computer.`);
				return;
			}
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
			// One `await` in front of the load, and nothing else about this branch
			// moves (M3). The loaders arrive over the network the first time
			// anything is placed; on every load after that the promise is already
			// settled and this is a microtask.
			//
			// The `try` still covers starting the load and nothing else, which is
			// the property the DOM-boundary test in tests/items-and-scene.test.js
			// pins - so it stays wrapped around exactly the same call rather than
			// around the import.
			this._ensureLoaders().then(function (loaders)
			{
				var loader = (metadata.format == 'gltf') ? loaders.gltfloader : loaders.objloader;
				var onLoad = (metadata.format == 'gltf') ? gltfCallback : objCallback;
				try
				{
					// three's FileLoader builds a Request up front, and a URL the
					// environment cannot parse throws there - synchronously, past the
					// onError callback that exists for exactly this and never sees it.
					loader.load(physicalUrl, onLoad, undefined, function (error) {failed(describeError(error));});
				}
				catch (error)
				{
					failed(describeError(error));
				}
			// A failed import is a failed load: no loader arrived, so nothing can
			// be parsed, and the item has to be reported as unloadable rather than
			// left pending forever.
			}, function (error) {failed(describeError(error));});
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

