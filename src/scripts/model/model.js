// @ts-check
import {EVENT_LOADED, EVENT_LOADING, EVENT_GLTF_READY} from '../core/events.js';
import {EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_MOVE_FINISH, EVENT_LEVELS_CHANGED} from '../core/events.js';
import {projectItems} from './plan_projection.js';
import {projectPlanOutline} from './level_projection.js';
import {EventDispatcher, Vector3, Mesh} from 'three';
import {Level, DEFAULT_LEVEL_HEIGHT} from './level.js';
import {Scene} from './scene.js';
import {DesignDocument} from './document.js';

// three's own addons since S4. The vendored OBJExporter was a copy of this file
// old enough to branch on `instanceof THREE.Geometry`, and three-gltf-exporter
// shipped a second copy of three; both are gone.
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

/**
 * One storey's furniture, as the file records it.
 *
 * Sorted by id for the reason `exportSerialized` documents at length: item order
 * carries no meaning, the order they arrive in depends on which model file
 * finished downloading first, and `useHistory` decides whether anything changed
 * by comparing two of these strings.
 *
 * @param {import('./level.js').Level} level
 * @returns {Array<Object>}
 */
function savedItems(level)
{
	return level.items
		.map(function (item) {return item.getMetaData();})
		.sort(function (a, b) {return String(a.id).localeCompare(String(b.id));});
}

/**
 * One storey, as the file records it (RM-010 G1).
 *
 * **The ground floor's plan and furniture are not repeated here.** They stay
 * where they have always been, at `floorplan` and `items` on the design, and
 * `levels[0]` carries only this storey's name and height. That is not a special
 * case being tolerated - it is what makes the promise in RM-009 §44 hold: *the
 * save format stays readable by any build that reads 2.0.0.* A build that has
 * never heard of `levels` opens a three-storey house and gets the ground floor,
 * correctly drawn, rather than an error or an empty plan.
 *
 * @param {import('./level.js').Level} level
 * @param {number} index
 * @returns {Record<string, any>}
 */
function savedLevel(level, index)
{
	/** @type {Record<string, any>} */
	var record = {name: level.displayName(index), height: level.height};
	if (index > 0)
	{
		record.floorplan = level.floorplan.saveFloorplan();
		record.items = savedItems(level);
	}
	return record;
}

/**
 * The colours somebody picked, in a form two records can be compared by.
 *
 * `getMetaData()` omits `material_colors` entirely when no slot was picked, and
 * a document may say the same thing with an empty array, so the two have to
 * normalise to one value before being compared.
 *
 * @param {?Array<?string>} colors
 * @returns {string}
 */
function colorSignature(colors)
{
	return (colors && colors.length) ? JSON.stringify(colors) : '';
}

/**
 * Whether a document's item record describes the item already in the scene
 * (RM-003 A3).
 *
 * The id alone is not enough, and each of these has a way of going silently
 * wrong if it is left out:
 *
 * - **the model url**, because two records with one id and different models are
 *   a replacement, and reusing the mesh would draw the old model at the new
 *   item's position. It cannot arise from this repository's own save files; it
 *   can from a hand-edited one.
 * - **the item type**, because it selects the class - a `WallItem` and a
 *   free-standing item behave differently and are not interchangeable.
 * - **the picked colours**, because an item's original material colour is
 *   overwritten when a colour is chosen and is not kept anywhere. So a colour
 *   *can* be applied to a kept item but not un-applied, and undo has to be able
 *   to do both. Treating a colour change as a different item means undoing one
 *   reloads that item - which is what happened to every item before A3, and now
 *   happens only to the one that changed.
 *
 * @param {Object} record
 * @param {Object} item
 * @returns {boolean}
 */
function isSameItem(record, item)
{
	return record.model_url === item.metadata.modelUrl
		&& record.item_type === item.metadata.itemType
		&& colorSignature(record.material_colors) === colorSignature(item.getMetaData().material_colors);
}

/**
 * A Model is an abstract concept the has the data structuring a floorplan. It connects a {@link Floorplan} and a {@link Scene}
 */
export class Model extends EventDispatcher
{
	/** Constructs a new model.
	 * @param {string} textureDir The directory containing the textures.
	 * @param {?(import('../core/configuration.js').Configuration|import('../core/design_runtime.js').DesignRuntime)} [runtime]
	 * This design's services, or just its settings. Omit to share the page-wide
	 * defaults. See Floorplan's constructor.
	 */
	constructor(textureDir, runtime)
	{
		super();
		/**
		 * The storeys, ground floor first (RM-010 G1).
		 *
		 * Always at least one, so a design that never hears the word "level" is a
		 * design with one of them - which is why `this.floorplan` below is a getter
		 * onto this list rather than a second field beside it. Nothing outside this
		 * class asks which level it is on: it reads `model.floorplan` and gets the
		 * active one, exactly as it did before there were any.
		 *
		 * @type {Array<Level>}
		 */
		this.levels = [new Level(runtime)];
		/**
		 * Which storey is being edited. An index rather than a reference, because
		 * a level's position in the list is what "the floor above" means.
		 * @type {number}
		 */
		this.activeLevelIndex = 0;
		// Constructed after the levels, because a `Scene` reads its runtime off the
		// model's floorplan - which is now the ground level's.
		this.scene = new Scene(this, textureDir);

		/**
		 * Keep the plan's view of the furniture current (RM-008 E1, T-1).
		 *
		 * This class is the only object that holds both halves - `Scene` knows its
		 * `Model` and `Floorplan` knows neither - so it is the only place that can
		 * derive one from the other without giving somebody a reference they should
		 * not have. See `model/plan_projection.js` for why that matters.
		 *
		 * Three events, which are the three ways the picture can change: an item
		 * arrives, an item leaves, an item finishes being moved. There is
		 * deliberately no fourth for "an item is being dragged" - `Controller`
		 * marks the projection stale directly during a drag (T-7), because adding
		 * a dispatch inside a pointermove handler is the shape RM-002 R-05 spent a
		 * sprint removing.
		 *
		 * Held as a field so `dispose()` can take them off again. A `Model` that
		 * outlives its listeners is how a document keeps a dead scene alive.
		 */
		this._reproject = () => {this.projectItemsToPlan();};
		this.scene.addEventListener(EVENT_ITEM_LOADED, this._reproject);
		this.scene.addEventListener(EVENT_ITEM_REMOVED, this._reproject);
		this.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, this._reproject);

		// And the way back: what the 2D plan may do to an item (RM-008 E1).
		//
		// Same shape as `Scene.setItemLoader` - the layer takes functions rather
		// than importing the thing that does the work - so the plan can move a
		// chair without holding the chair. The plan knows an id and a position in
		// centimetres; everything about what an item IS stays on this side.
		this.levels.forEach((level) => {this._wireLevel(level);});
	}

	/**
	 * Give a level's floorplan the way back to the furniture (RM-008 E1).
	 *
	 * Every level needs it, not just the first, and it is the one thing a fresh
	 * `Floorplan` does not arrive with - so a level added at runtime goes through
	 * here too, and a plan drawn on the third storey can move a chair.
	 *
	 * @param {Level} level
	 */
	_wireLevel(level)
	{
		level.floorplan.setItemCommands({
			move: (id, x, y) => {this.moveItemInPlan(id, x, y);},
			rotate: (id, radians) => {this.rotateItemInPlan(id, radians);},
			commit: (id) => {this.commitItemGesture(id);},
		});
	}

	/**
	 * Give the active storey's plan the one below it, to trace over.
	 *
	 * Called wherever the answer can change - a switch, an add, a remove, a
	 * height edit, a load - which is every place `EVENT_LEVELS_CHANGED` goes, so
	 * it is called from the same one place.
	 *
	 * @returns {void}
	 */
	_updateGhostPlan()
	{
		var below = this.levels[this.activeLevelIndex - 1];
		this.floorplan.setGhostPlan(below ? projectPlanOutline(below.floorplan) : null);
	}

	/**
	 * The storey being edited (RM-010 G1).
	 * @returns {Level}
	 */
	get level()
	{
		return this.levels[this.activeLevelIndex];
	}

	/**
	 * The active level's plan.
	 *
	 * **This getter is the whole of G1's third acceptance line.** Everything
	 * outside this class - the 2D view, the 3D view, the inspectors, the file,
	 * the composables - read `model.floorplan` before there were levels and read
	 * it unchanged now. There is no `model.floorplan(level)` and no argument
	 * threaded through 200 call sites, because the question "which level" is
	 * answered in exactly one place.
	 *
	 * @returns {import('./floorplan.js').Floorplan}
	 */
	get floorplan()
	{
		return this.levels[this.activeLevelIndex].floorplan;
	}

	/**
	 * How high a level's floor sits above the ground floor's (RM-010 G1, V-4).
	 *
	 * The running sum of the floor-to-floor heights below it, derived and never
	 * stored - so a storey's height can be edited and everything above it moves,
	 * with nothing left holding the old number.
	 *
	 * @param {number} index
	 * @returns {number} Centimetres.
	 */
	levelBase(index)
	{
		var base = 0;
		for (var i = 0; i < index && i < this.levels.length; i++)
		{
			base += this.levels[i].height;
		}
		return base;
	}

	/**
	 * Switch which storey is being edited.
	 *
	 * Clamped rather than refused: an index out of range is a caller that has
	 * lost track of a removal, and the nearest real level is a better answer than
	 * a throw in a click handler.
	 *
	 * @param {number} index
	 * @returns {number} The index it settled on.
	 */
	setActiveLevel(index)
	{
		var next = Math.max(0, Math.min(this.levels.length - 1, Math.round(Number(index) || 0)));
		if (next !== this.activeLevelIndex)
		{
			this.activeLevelIndex = next;
			this._updateGhostPlan();
			this.dispatchEvent({type: EVENT_LEVELS_CHANGED, model: this, active: next});
		}
		return this.activeLevelIndex;
	}

	/**
	 * Add a storey, and make it the active one.
	 *
	 * Inserted rather than appended, because "add a floor" from the third storey
	 * of a building means a fourth storey and not a roof over the whole thing -
	 * the new level goes directly above the active one, which is where a person
	 * standing on a plan expects it.
	 *
	 * @param {Object} [options] `name` and `height`.
	 * @returns {Level}
	 */
	addLevel(options)
	{
		var level = new Level(this.runtime, options);
		this._wireLevel(level);
		this.levels.splice(this.activeLevelIndex + 1, 0, level);
		this.activeLevelIndex += 1;
		this._updateGhostPlan();
		this.dispatchEvent({type: EVENT_LEVELS_CHANGED, model: this, active: this.activeLevelIndex});
		return level;
	}

	/**
	 * Remove a storey and everything on it.
	 *
	 * The last one cannot go: a design with no levels has nowhere to draw, and
	 * every path in this class assumes `levels[0]` exists. Returns false rather
	 * than throwing, so a UI can grey the control out from the same answer.
	 *
	 * @param {number} index
	 * @returns {boolean} Whether it went.
	 */
	removeLevel(index)
	{
		if (this.levels.length < 2 || index < 0 || index >= this.levels.length)
		{
			return false;
		}
		var level = this.levels[index];
		// The items go first and through the scene, so their meshes are disposed
		// and their groups emptied - dropping the level would leak every one of
		// them, which is the class of fault RM-003 A0 spent a sprint on.
		level.items.slice().forEach((item) => {this.scene.removeItem(item);});
		this.scene.forgetLevel(level);
		this.levels.splice(index, 1);
		this.activeLevelIndex = Math.max(0, Math.min(this.levels.length - 1, this.activeLevelIndex));
		this._updateGhostPlan();
		this.dispatchEvent({type: EVENT_LEVELS_CHANGED, model: this, active: this.activeLevelIndex});
		return true;
	}

	/**
	 * Set a storey's floor-to-floor height. Everything above it moves.
	 *
	 * @param {number} index
	 * @param {number} value Centimetres.
	 * @returns {number} What it took.
	 */
	setLevelHeight(index, value)
	{
		var level = this.levels[index];
		if (!level)
		{
			return 0;
		}
		var taken = level.setHeight(value);
		this._updateGhostPlan();
		this.dispatchEvent({type: EVENT_LEVELS_CHANGED, model: this, active: this.activeLevelIndex});
		return taken;
	}

	/**
	 * The item carrying an id, or null (RM-008 E1).
	 *
	 * `designId` rather than `uuid`: it is the identity the save file carries and
	 * the one `useSelection` already resolves against, so an id that came off a
	 * footprint names the same item everywhere.
	 *
	 * @param {?string} id
	 * @returns {?Object}
	 */
	itemById(id)
	{
		if (!id)
		{
			return null;
		}
		// Every storey, not the active one: `designId` is the identity the save
		// file carries and the one `useSelection` resolves against, so it names an
		// item in the building rather than one on this floor (RM-010 G1).
		var items = this.scene.allItems();
		for (var i = 0; i < items.length; i++)
		{
			if (items[i].designId === id)
			{
				return items[i];
			}
		}
		return null;
	}

	/**
	 * Move an item, because the plan was dragged (RM-008 E1).
	 *
	 * Writes `position` directly and keeps the height, for the reason
	 * `Scene.updateItem` documents: `moveToPosition` is the interactive 3D path
	 * and carries placement rules that can silently refuse the move. A drag on
	 * the plan is a deliberate instruction with the destination visible, and an
	 * item that stops following the pointer without saying why is the worst of
	 * the available behaviours.
	 *
	 * The projection is refreshed but nothing is dispatched as finished - that is
	 * `commitItemGesture`, once, when the pointer is released, so the undo stack
	 * gets one entry for the drag rather than one per pointermove (T-7).
	 *
	 * @param {string} id
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y Plan space, centimetres (the 3D z).
	 */
	moveItemInPlan(id, x, y)
	{
		var item = this.itemById(id);
		if (!item)
		{
			return;
		}
		item.position.x = x;
		item.position.z = y;
		if (item.bhelper)
		{
			item.bhelper.update();
		}
		this.projectItemsToPlan();
	}

	/**
	 * Turn an item, because the plan asked.
	 *
	 * @param {string} id
	 * @param {number} radians About the vertical axis.
	 */
	rotateItemInPlan(id, radians)
	{
		var item = this.itemById(id);
		if (!item)
		{
			return;
		}
		item.rotation.y = radians;
		if (item.bhelper)
		{
			item.bhelper.update();
		}
		this.projectItemsToPlan();
	}

	/**
	 * The gesture is over: tell everybody once.
	 *
	 * EVENT_ITEM_MOVE_FINISH is what the 3D controller dispatches when a drag
	 * ends and what `useHistory` records an undo entry from, so a plan drag and a
	 * 3D drag produce the same single entry. Dispatched on the scene, which is
	 * where the existing listeners are - a second channel for the same fact would
	 * be a second thing to keep in step.
	 *
	 * @param {string} id
	 */
	commitItemGesture(id)
	{
		var item = this.itemById(id);
		if (!item)
		{
			return;
		}
		this.scene.dispatchEvent({type: EVENT_ITEM_MOVE_FINISH, item: item});
	}


	/**
	 * Recompute the plan's view of the furniture and hand it over (RM-008 E1).
	 *
	 * Public because more than one thing legitimately needs to ask for it: the
	 * three item events above, `loadDocument` once a design has settled, and
	 * `Controller` while an item is being dragged. Cheap enough to call freely -
	 * it maps and sorts an array whose length is the item count - and idempotent,
	 * which is what lets every one of those callers just call it rather than
	 * reason about whether somebody else already did.
	 */
	projectItemsToPlan()
	{
		// The active storey's furniture, onto the active storey's plan. A plan is a
		// section through one floor and drawing the sofa from upstairs on it would
		// be a picture of no building (RM-010 G1).
		this.floorplan.setItemProjection(projectItems(this.scene.getItems()));
	}

	/**
	 * Stop keeping the plan's projection current.
	 *
	 * `BlueprintJS.dispose()` disposes the viewers and the runtime; the model
	 * outlives both in an embedder that keeps the document. These three listeners
	 * are the only ones this class holds, and they hold `this`, so leaving them
	 * attached would keep a whole document reachable from a scene nobody is
	 * looking at.
	 */
	dispose()
	{
		this.scene.removeEventListener(EVENT_ITEM_LOADED, this._reproject);
		this.scene.removeEventListener(EVENT_ITEM_REMOVED, this._reproject);
		this.scene.removeEventListener(EVENT_ITEM_MOVE_FINISH, this._reproject);
	}

	/** This design's services (RM-003 A4). @returns {import('../core/design_runtime.js').DesignRuntime} */
	get runtime()
	{
		return this.floorplan.runtime;
	}

	/** Where this design reads its settings from. @returns {import('../core/configuration.js').Configuration} */
	get configuration()
	{
		return this.runtime.configuration;
	}

	switchWireframe(flag)
	{
		this.scene.switchWireframe(flag);
	}

	/**
	 * Replace the current design with a serialized one.
	 *
	 * The format is documented field by field in docs/save-format.md, including
	 * how a file written before version 2.0.0 is read.
	 *
	 * ## All or nothing, since RM-003 A1
	 *
	 * The document is validated in full before any live state is touched, so a
	 * file that is not a design leaves the open design exactly as it was. It used
	 * to do the opposite: `newRoom()` cleared the items and reset the floorplan
	 * before looking at anything, so ten well-formed-JSON documents that were not
	 * designs each emptied the current plan - and `{"items":[]}` did it without
	 * throwing, so the application reported success and autosave wrote the empty
	 * plan over the draft.
	 *
	 * ## Why this still throws
	 *
	 * Because callers already catch it, and a function that quietly stops
	 * reporting failure is a worse change than one that keeps reporting it. The
	 * message now says which field is wrong instead of being whichever TypeError
	 * the mutation happened to hit. {@link Model#loadDocument} is the same
	 * operation as a value for callers that would rather branch than catch.
	 *
	 * @param {string} json A `.blueprint3d` document.
	 * @param {{reason?: string}} [options] `reason` labels the ChangeSets this
	 * load produces - one of `CHANGE_REASONS`, defaulting to `REASON_LOAD`.
	 * History passes `REASON_UNDO` so a restoration is distinguishable from an
	 * open; see core/change_set.js.
	 * @throws {Error} if the document is not a valid design. The design is
	 * untouched when it does.
	 * @emits {EVENT_LOADING} before parsing.
	 * @emits {EVENT_LOADED} once the floorplan is built and item loads have been
	 * started - not when the models have arrived. Listen on the scene for that.
	 */
	loadSerialized(json, options)
	{
		var result = this.loadDocument(json, options);
		if (!result.ok)
		{
			var detail = result.errors.map(function (problem)
			{
				return problem.path ? `${problem.path}: ${problem.message}` : problem.message;
			}).join('; ');
			throw new Error(`Not a valid design - ${detail}`);
		}
		return result;
	}

	/**
	 * Replace the current design, reporting the outcome rather than throwing.
	 *
	 * The structured form of {@link Model#loadSerialized}, and the one that does
	 * the work. A caller that wants to tell a person *which part* of their file is
	 * broken wants this: `errors` is every problem found, each with the path to
	 * the field, rather than one arbitrary symptom.
	 *
	 * `EVENT_LOADING` is dispatched only once the document is known to be good.
	 * Dispatching it before validation would tell listeners a load had started
	 * when nothing is going to happen - and a listener that shows a spinner on
	 * LOADING and hides it on LOADED would be left spinning.
	 *
	 * @param {string} json A `.blueprint3d` document.
	 * @param {{reason?: string}} [options] See {@link Model#loadSerialized}.
	 * @returns {import('./document.js').ParseResult} `ok`, the parsed document,
	 * and every error and warning found.
	 */
	loadDocument(json, options)
	{
		var result = DesignDocument.parse(json);
		if (!result.ok)
		{
			return result;
		}

		// Past this line the document is known good, so what follows can only fail
		// on a bug. That is the whole of the atomicity guarantee - it is structural
		// rather than careful.
		this.dispatchEvent({type: EVENT_LOADING, item: this});

		result.warnings.forEach(function (warning)
		{
			console.warn(`architect3d: ${warning.path} ${warning.message}`);
		});

		// Everything in flight for the previous document is now stale. This is what
		// stops the old design's furniture arriving in the new one.
		this.scene.loadSession.begin();
		this.scene.abortPendingLoads();

		this.newRoom(result.document.floorplan, result.document.items,
			options && options.reason, result.document.levels || undefined);

		// The furniture of the document just closed is gone and none of the new
		// document's has arrived yet - every item load is asynchronous. Project
		// once here so the plan shows an empty room rather than the last design's
		// chairs; each arrival then re-projects through EVENT_ITEM_LOADED
		// (RM-008 E1).
		this.projectItemsToPlan();

		this.dispatchEvent({type: EVENT_LOADED, item: this});
		return result;
	}

	exportMeshAsObj()
	{
		var exporter = new OBJExporter();
		return exporter.parse(this.scene.getScene());
	}

	exportForBlender()
	{
		var scope = this;
		var gltfexporter = new GLTFExporter();
		var meshes = [];
		this.scene.getScene().traverse( function(child)
		{
			if (child instanceof Mesh)
			{
				if(child.material)
				{
					if(child.material.length || child.material.visible)
					{
						var op = (child.material.transparent)? child.material.opacity: undefined;
						meshes.push(child);
						if(op)
						{
							child.material.opacity = op;
						}
					}
				}
			}
		  });

		// parseAsync replaces the old two-argument parse(input, onCompleted).
		// The result is still a plain glTF 2.0 JSON document, so EVENT_GLTF_READY
		// carries exactly what it always did. Failures used to disappear - the
		// old exporter had no error channel at all - and now reach the console
		// instead of leaving a caller waiting on an event that never fires.
		gltfexporter.parseAsync(meshes).then(function(result)
		{
			var output = JSON.stringify( result, null, 2 );
			scope.dispatchEvent({type:EVENT_GLTF_READY, item: scope, gltf: output});
		}).catch(function(error)
		{
			console.error('glTF export failed', error);
		});
	}

	/**
	 * The design as a `.blueprint3d` document.
	 *
	 * ## Why the items are sorted, since A3
	 *
	 * They are written in id order rather than in `scene.items` order, because
	 * `scene.items` order is not a property of the design - it is the order the
	 * model files finished downloading in. Two saves of a design nobody touched
	 * could differ, and after A3's reconciliation they reliably did: an item that
	 * has to be reloaded rejoins the array at the end, so undoing a colour change
	 * reordered the file.
	 *
	 * That is not cosmetic. `useHistory` decides whether anything changed by
	 * comparing this string to the last one, so a reordering it cannot see the
	 * meaning of becomes a history entry for an edit nobody made.
	 *
	 * The id is meaningless and that is the point: item order carries nothing, so
	 * the right order is any order that is the same every time.
	 *
	 * @returns {string}
	 */
	exportSerialized()
	{
		/** @type {Record<string, any>} */
		var room = {
			floorplan: this.levels[0].floorplan.saveFloorplan(),
			items: savedItems(this.levels[0]),
		};
		// Additive and conditional, per T-6 and RM-010 V-6: a design with one
		// storey at its default height writes no `levels` key at all and is
		// therefore byte-identical to the file it was before this sprint. That is
		// M-26's second half, and it is the same rule E2's thickness, E3's
		// dimensions and F3's stair already follow.
		if (this._needsLevelsRecord())
		{
			room.levels = this.levels.map((level, index) => savedLevel(level, index));
		}
		return JSON.stringify(room);
	}

	/**
	 * Whether this design has anything to say about storeys.
	 *
	 * A single default-height storey with no name of its own says nothing, which
	 * is every design anybody has ever saved. One that has been named or re-sized
	 * says something, even alone - otherwise renaming the ground floor would be
	 * an edit that does not survive a save.
	 *
	 * @returns {boolean}
	 */
	_needsLevelsRecord()
	{
		if (this.levels.length > 1)
		{
			return true;
		}
		var only = this.levels[0];
		return Boolean(only.name) || only.height !== DEFAULT_LEVEL_HEIGHT;
	}

	/**
	 * Replace the design's floorplan and reconcile its furniture.
	 *
	 * ## What changed in A3, and why it is the whole of finding H-6
	 *
	 * This used to open with `scene.clearItems()`: every item destroyed, then
	 * every item in the incoming document re-created from scratch, which means
	 * re-fetching, re-parsing, re-merging and re-uploading every model file.
	 * Correct, and fine for opening a document. The trouble is that **undo is a
	 * document load** - `useHistory` restores by calling `loadSerialized` with a
	 * previous snapshot - so nudging a corner and pressing undo re-downloaded the
	 * sofa. On a furnished plan that is every model in the design, for an edit
	 * that touched none of them.
	 *
	 * Items now carry an id (`Item.designId`, written into the file since A3), so
	 * an item in the incoming document can be recognised as one that is already
	 * here. An item that is still present with the same model keeps its geometry
	 * and its materials and is simply moved; only genuine additions load anything.
	 *
	 * ## Why the model url is part of the match
	 *
	 * Two items with the same id and different `model_url` are not the same item -
	 * that is a replacement, and reusing the mesh would show the old model at the
	 * new item's position. It cannot arise from this repository's own save files,
	 * where an id belongs to one item forever, but it can from a hand-edited
	 * document, and getting it wrong is silent.
	 *
	 * ## The order matters
	 *
	 * Items are reconciled BEFORE the floorplan is replaced. A `WallItem` holds
	 * the wall it is bound to, and `Item.removed()` detaches from it; running the
	 * removals after `loadFloorplan()` had already reset the plan would detach
	 * from walls that no longer exist.
	 *
	 * ## Storeys (RM-010 G1)
	 *
	 * `levels` is the whole building; the `floorplan` and `items` arguments are
	 * its ground floor, which is where they have always been in the file. The
	 * reconciliation above runs across **every** storey rather than the active
	 * one, and for the reason A3 gave in the first place: undo is a document
	 * load, so an item that stayed put on the second floor must keep its mesh
	 * when somebody undoes an edit on the ground floor.
	 *
	 * Level objects are **reused** where the incoming design has as many, rather
	 * than rebuilt. The 2D view holds `model.floorplan`, which is a level's
	 * `Floorplan` - replacing the object would leave the plan drawing a design
	 * nobody is editing, which is finding T-1 in a new place.
	 *
	 * @param {Object} floorplan
	 * @param {Array<Object>} items
	 * @param {string} [reason]
	 * @param {Array<Object>} [levels] Every storey, ground floor first. Entry 0
	 *        carries a name and a height only; its plan and furniture are the
	 *        two arguments above.
	 */
	newRoom(floorplan, items, reason, levels)
	{
		var scope = this;
		// One list per storey, ground floor first. A design with no `levels` key -
		// which is every design written before G1 - is one storey holding exactly
		// what it always held.
		var storeys = (levels && levels.length)
			? levels.map(function (record, index)
			{
				return {
					name: (typeof record.name === 'string') ? record.name : '',
					height: record.height,
					floorplan: (index === 0) ? floorplan : record.floorplan,
					items: (index === 0) ? (items || []) : (record.items || []),
				};
			})
			: [{name: '', height: undefined, floorplan: floorplan, items: items || []}];

		this._reshapeLevels(storeys);

		/** @type {Array<Object>} */
		var incoming = [];
		/** @type {Map<Object, import('./level.js').Level>} */
		var destination = new Map();
		storeys.forEach(function (storey, index)
		{
			storey.items.forEach(function (record)
			{
				incoming.push(record);
				destination.set(record, scope.levels[index]);
			});
		});

		/** @type {Map<string, Object>} */
		var live = new Map();
		this.scene.allItems().forEach(function (item)
		{
			if (item.designId)
			{
				live.set(item.designId, item);
			}
		});

		/** @type {Map<string, Object>} */
		var wanted = new Map();
		incoming.forEach(function (record)
		{
			if (record.id)
			{
				wanted.set(record.id, record);
			}
		});

		// Kept: still wanted, and still the same item.
		/** @type {Map<string, Object>} */
		var kept = new Map();
		live.forEach(function (item, id)
		{
			var record = wanted.get(id);
			if (record && isSameItem(record, item))
			{
				kept.set(id, item);
			}
		});

		this.scene.allItems().slice().forEach(function (item)
		{
			if (!kept.has(item.designId))
			{
				scope.scene.removeItem(item);
			}
		});

		// A wall-bound item survives a load now (RM-004 B2), and this is the whole
		// of what that took: note which face it is on BEFORE the floorplan is
		// destroyed, so it can be pointed at the same face afterwards.
		//
		// `HalfEdge.id` is `${wall.id}:front|back` and A3's note beside it said it
		// was stable "because Wall.id is now stable" - true within a session and
		// not across a load, which is exactly the sentence B2 makes true. The edge
		// objects themselves do not survive; their names do.
		/** @type {Map<Object, string>} */
		var boundTo = new Map();
		kept.forEach(function (item)
		{
			if (item.boundToFloorplan && item.currentWallEdge)
			{
				boundTo.set(item, item.currentWallEdge.id);
				// Let go BEFORE the reset, or the item does not survive to be
				// re-bound: `reset()` fires EVENT_DELETED on every wall and a still-
				// subscribed item removes itself. That was the mechanism A3's
				// carve-out note described, and detaching first is the whole of what
				// it took to lift it.
				item.releaseWall();
			}
		});

		storeys.forEach(function (storey, index)
		{
			scope.levels[index].floorplan.loadFloorplan(storey.floorplan, reason);
		});
		this.scene.syncLevels();

		if (boundTo.size)
		{
			// Across every storey: a wall item is re-bound to a face on its OWN
			// floor, and two storeys can hold walls with the same id because each
			// floorplan numbers its own.
			var edgesById = new Map();
			this.levels.forEach(function (level)
			{
				level.floorplan.wallEdges().forEach(function (edge)
				{
					edgesById.set(`${level.id}|${edge.id}`, edge);
				});
			});

			boundTo.forEach(function (edgeId, item)
			{
				// Fall back to geometry when the wall is simply gone - the document
				// being loaded may not have it. `closestWallEdge()` is what places a
				// freshly created wall item and is the right answer here too; what it
				// is not is a substitute for the id, because "nearest" and "the one it
				// was on" differ wherever two walls meet.
				var key = item.level ? `${item.level.id}|${edgeId}` : edgeId;
				var edge = edgesById.get(key) || item.closestWallEdge();
				if (edge)
				{
					item.changeWallEdge(edge);
				}
				else
				{
					// No walls at all. Nothing to bind to, so it cannot be kept.
					scope.scene.removeItem(item);
					kept.delete(item.designId);
				}
			});
		}

		// Restored to the storey it was on, whichever storey is active. The active
		// index is set back afterwards; `Scene.addItem` reads it, and threading a
		// level through five signatures to avoid two assignments would be worse.
		var wasActive = this.activeLevelIndex;
		incoming.forEach((item) => {
			var storey = destination.get(item) || this.levels[0];
			this.activeLevelIndex = Math.max(0, this.levels.indexOf(storey));
			var existing = item.id ? kept.get(item.id) : null;
			var position = new Vector3(item.xpos, item.ypos, item.zpos);
			var scale = new Vector3(item.scale_x,item.scale_y,item.scale_z);
			if (existing)
			{
				existing.metadata.itemName = item.item_name;
				existing.metadata.resizable = item.resizable;
				scope.scene.updateItem(existing, position, item.rotation, scale, item.fixed);
				scope.scene.moveItemToLevel(existing, storey);
				return;
			}
			var matColors = (item.material_colors) ? item.material_colors : [];
			// `opening` is RM-008 F1's description - five numbers and two choices -
			// and is present only on a parametric door, window or archway. Passed
			// through as it was read: `normaliseOpening` is what completes it, once,
			// where the item is built.
			var metadata = {itemName: item.item_name,resizable: item.resizable,format: item.format, itemType: item.item_type, modelUrl: item.model_url, materialColors: matColors, designId: item.id, opening: item.opening, stair: item.stair, structure: item.structure};
			this.scene.addItem(item.item_type,item.model_url,metadata,position,item.rotation,scale,item.fixed);
		});
		this.activeLevelIndex = Math.max(0, Math.min(this.levels.length - 1, wasActive));
		// Last, and once. The views build a projection per storey off this, and a
		// storey's projection has to be built after its plan is loaded rather than
		// before - so this cannot move up beside `_reshapeLevels`.
		this._updateGhostPlan();
		this.dispatchEvent({type: EVENT_LEVELS_CHANGED, model: this, active: this.activeLevelIndex});
	}

	/**
	 * Make the level list as long as the incoming design's, reusing what is here.
	 *
	 * Reused rather than rebuilt, because the 2D view holds `model.floorplan` -
	 * which is a level's `Floorplan` object - and replacing it would leave the
	 * plan drawing a design nobody is editing. Only the surplus is destroyed and
	 * only the shortfall is created.
	 *
	 * The active index is clamped rather than reset: undo is a document load, and
	 * an undo that threw you back to the ground floor on every keystroke would be
	 * unusable. It is deliberately not persisted - which storey you are looking
	 * at is not a property of the building.
	 *
	 * @param {Array<Object>} storeys
	 * @returns {void}
	 */
	_reshapeLevels(storeys)
	{
		while (this.levels.length > storeys.length)
		{
			var surplus = this.levels[this.levels.length - 1];
			surplus.items.slice().forEach((item) => {this.scene.removeItem(item);});
			this.scene.forgetLevel(surplus);
			this.levels.pop();
		}
		while (this.levels.length < storeys.length)
		{
			var added = new Level(this.runtime);
			this._wireLevel(added);
			this.levels.push(added);
		}
		this.levels.forEach((level, index) =>
		{
			level.name = storeys[index].name || '';
			if (storeys[index].height !== undefined)
			{
				level.setHeight(storeys[index].height);
			}
		});
		this.activeLevelIndex = Math.max(0, Math.min(this.levels.length - 1, this.activeLevelIndex));
	}
}
