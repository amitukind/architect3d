import {EVENT_LOADED, EVENT_LOADING, EVENT_GLTF_READY} from '../core/events.js';
import {EventDispatcher, Vector3, Mesh} from 'three';
import {Floorplan} from './floorplan.js';
import {Scene} from './scene.js';
import {DesignDocument} from './document.js';

// three's own addons since S4. The vendored OBJExporter was a copy of this file
// old enough to branch on `instanceof THREE.Geometry`, and three-gltf-exporter
// shipped a second copy of three; both are gone.
import {OBJExporter} from 'three/addons/exporters/OBJExporter.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';

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
	 * @param {import('../core/configuration.js').Configuration} [configuration] Settings for this design alone.
	 * Omit to share the page-wide default. See Floorplan's constructor.
	 */
	constructor(textureDir, configuration)
	{
		super();
		this.floorplan = new Floorplan(configuration);
		this.scene = new Scene(this, textureDir);
	}

	/** Where this design reads its settings from. @returns {import('../core/configuration.js').Configuration} */
	get configuration()
	{
		return this.floorplan.configuration;
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

		this.newRoom(result.document.floorplan, result.document.items, options && options.reason);

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
		var items_arr = this.scene.getItems()
			.map(function (item) {return item.getMetaData();})
			.sort(function (a, b) {return String(a.id).localeCompare(String(b.id));});

		var room = {floorplan: (this.floorplan.saveFloorplan()),items: items_arr};
		return JSON.stringify(room);
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
	 * @param {Object} floorplan
	 * @param {Array<Object>} items
	 * @param {string} [reason]
	 */
	newRoom(floorplan, items, reason)
	{
		var scope = this;
		var incoming = items || [];

		/** @type {Map<string, Object>} */
		var live = new Map();
		this.scene.getItems().forEach(function (item)
		{
			if (item.designId && !item.boundToFloorplan)
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

		this.scene.getItems().slice().forEach(function (item)
		{
			if (!kept.has(item.designId))
			{
				scope.scene.removeItem(item);
			}
		});

		this.floorplan.loadFloorplan(floorplan, reason);

		incoming.forEach((item) => {
			var existing = item.id ? kept.get(item.id) : null;
			var position = new Vector3(item.xpos, item.ypos, item.zpos);
			var scale = new Vector3(item.scale_x,item.scale_y,item.scale_z);
			if (existing)
			{
				existing.metadata.itemName = item.item_name;
				existing.metadata.resizable = item.resizable;
				scope.scene.updateItem(existing, position, item.rotation, scale, item.fixed);
				return;
			}
			var matColors = (item.material_colors) ? item.material_colors : [];
			var metadata = {itemName: item.item_name,resizable: item.resizable,format: item.format, itemType: item.item_type, modelUrl: item.model_url, materialColors: matColors, designId: item.id};
			this.scene.addItem(item.item_type,item.model_url,metadata,position,item.rotation,scale,item.fixed);
		});
	}
}
