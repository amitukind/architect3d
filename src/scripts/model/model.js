import {EVENT_LOADED, EVENT_LOADING, EVENT_GLTF_READY} from '../core/events.js';
import {EventDispatcher, Vector3, Mesh} from 'three';
import {Floorplan} from './floorplan.js';
import {Scene} from './scene.js';

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
	 * @param textureDir The directory containing the textures.
	 */
	constructor(textureDir)
	{
		super();
		this.floorplan = new Floorplan();
		this.scene = new Scene(this, textureDir);
	}

	switchWireframe(flag)
	{
		this.scene.switchWireframe(flag);
	}

	/**
	 * Replace the current design with a serialized one.
	 *
	 * The format is documented field by field in docs/save-format.md, including
	 * how a file written before version 2.0.0 is read. Two TODOs sat here for
	 * the life of this file asking for exactly those two things - the
	 * documentation and a better format - and both are now done.
	 *
	 * @param {string} json A `.blueprint3d` document.
	 * @emits {EVENT_LOADING} before parsing.
	 * @emits {EVENT_LOADED} once the floorplan is built and item loads have been
	 * started - not when the models have arrived. Listen on the scene for that.
	 */
	loadSerialized(json)
	{
		this.dispatchEvent({type: EVENT_LOADING, item: this});

		var data = JSON.parse(json);
		this.newRoom(data.floorplan, data.items);

		this.dispatchEvent({type: EVENT_LOADED, item: this});
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

	newRoom(floorplan, items)
	{
		this.scene.clearItems();
		this.floorplan.loadFloorplan(floorplan);
		items.forEach((item) => {
			var matColors = (item.material_colors) ? item.material_colors : [];
			var position = new Vector3(item.xpos, item.ypos, item.zpos);
			var metadata = {itemName: item.item_name,resizable: item.resizable,format: item.format, itemType: item.item_type, modelUrl: item.model_url, materialColors: matColors};
			var scale = new Vector3(item.scale_x,item.scale_y,item.scale_z);
			this.scene.addItem(item.item_type,item.model_url,metadata,position,item.rotation,scale,item.fixed);
		});
	}
}
