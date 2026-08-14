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

	exportSerialized()
	{
		var items_arr = [];
		var objects = this.scene.getItems();
		for (var i = 0; i < objects.length; i++)
		{
			var obj = objects[i];
			items_arr[i] = obj.getMetaData();
		}

		var room = {floorplan: (this.floorplan.saveFloorplan()),items: items_arr};
		return JSON.stringify(room);
	}

	newRoom(floorplan, items, reason)
	{
		this.scene.clearItems();
		this.floorplan.loadFloorplan(floorplan, reason);
		items.forEach((item) => {
			var matColors = (item.material_colors) ? item.material_colors : [];
			var position = new Vector3(item.xpos, item.ypos, item.zpos);
			var metadata = {itemName: item.item_name,resizable: item.resizable,format: item.format, itemType: item.item_type, modelUrl: item.model_url, materialColors: matColors};
			var scale = new Vector3(item.scale_x,item.scale_y,item.scale_z);
			this.scene.addItem(item.item_type,item.model_url,metadata,position,item.rotation,scale,item.fixed);
		});
	}
}
