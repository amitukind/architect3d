//Classes from core module
export {Version} from './core/version.js';

export {EVENT_SAVED, EVENT_UPDATED, EVENT_LOADING, EVENT_LOADED, EVENT_NEW, EVENT_ACTION, EVENT_GLTF_READY} from './core/events.js';
export {EVENT_DELETED, EVENT_MOVED, EVENT_REDRAW, EVENT_CHANGED, EVENT_MODE_RESET} from './core/events.js';
export {EVENT_ROOM_NAME_CHANGED} from './core/events.js';
export {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED} from './core/events.js';
export {EVENT_CAMERA_MOVED, EVENT_CAMERA_ACTIVE_STATUS, EVENT_FPS_EXIT, EVENT_CAMERA_VIEW_CHANGE} from './core/events.js';

export {EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_WALL_ATTRIBUTES_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED} from './core/events.js';
export {EVENT_WALL_CLICKED, EVENT_ROOM_CLICKED, EVENT_NOTHING_CLICKED, EVENT_FLOOR_CLICKED} from './core/events.js';
export {EVENT_CORNER_2D_CLICKED, EVENT_CORNER_2D_DOUBLE_CLICKED, EVENT_CORNER_2D_HOVER} from './core/events.js';
export {EVENT_WALL_2D_CLICKED, EVENT_WALL_2D_DOUBLE_CLICKED, EVENT_WALL_2D_HOVER} from './core/events.js';
export {EVENT_ROOM_2D_CLICKED, EVENT_ROOM_2D_DOUBLE_CLICKED, EVENT_ROOM_2D_HOVER} from './core/events.js';


export {Utils, Region} from './core/utils.js';
// The glTF migration shim (S3). Applied automatically by Scene.addItem, and
// exported so an embedder can rewrite stored designs offline rather than
// waiting for each one to be opened.
export {LEGACY_MODEL_MAP, resolveModelUrl} from './core/legacy_models.js';
export {ELogContext, ELogLevel, logContext, isLogging, log} from './core/log.js';
export {dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter, dimensioningOptions, decimals, Dimensioning} from './core/dimensioning.js';
export {cmPerFoot, pixelsPerFoot, cmPerPixel, pixelsPerCm} from './core/dimensioning.js';

export {cornerTolerance, configDimUnit, configWallHeight, configWallThickness, configSystemUI, wallInformation, scale, snapToGrid, snapTolerance, gridSpacing, config, Configuration} from './core/configuration.js';
export {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from './core/constants.js';
export {WallTypes} from './core/constants.js';

//Classes from model module
export {HalfEdge} from './model/half_edge.js';
export {Corner} from './model/corner.js';
export {defaultFloorPlanTolerance, Floorplan} from './model/floorplan.js';
export {Model} from './model/model.js';
export {defaultRoomTexture, Room} from './model/room.js';
export {Scene} from './model/scene.js';
export {defaultWallTexture, Wall} from './model/wall.js';

//Classes from floorplanner module
export {floorplannerModes, gridWidth, gridColor, deleteColor} from './floorplanner/floorplanner_view.js';
export {roomColor, roomColorHover, roomColorSelected} from './floorplanner/floorplanner_view.js';
export {wallWidth, wallWidthHover, wallWidthSelected, wallColor, wallColorHover, wallColorSelected}  from './floorplanner/floorplanner_view.js';
export {edgeColor, edgeColorHover, edgeWidth} from './floorplanner/floorplanner_view.js';
export {cornerRadius, cornerRadiusHover, cornerRadiusSelected, cornerColor, cornerColorHover, cornerColorSelected} from './floorplanner/floorplanner_view.js';
export {FloorplannerView2D} from './floorplanner/floorplanner_view.js';


export {Floorplanner2D} from './floorplanner/floorplanner.js';
export {CarbonSheet} from './floorplanner/carbonsheet.js';

//Classes from items module
export {item_types, Factory} from './items/factory.js';
export {Metadata} from './items/metadata.js';
export {Item} from './items/item.js';
export {FloorItem} from './items/floor_item.js';
export {WallItem} from './items/wall_item.js';
export {WallFloorItem} from './items/wall_floor_item.js';
export {OnFloorItem} from './items/on_floor_item.js';
export {InWallItem} from './items/in_wall_item.js';
export {InWallFloorItem} from './items/in_wall_floor_item.js';
export {RoofItem} from './items/roof_item.js';

//Classes from three module
export {states, Controller} from './three/controller.js';
export {OrbitControls} from './three/orbitcontrols.js';
export {PointerLockControls} from './three/pointerlockcontrols.js';
// Removed in S1 as dead code: FirstPersonControls (three/first-person-controls.js)
// and STATE/Controls (three/controls.js, a pre-r70 OrbitControls fork superseded
// by orbitcontrols.js). Both were exported here but imported nowhere - their only
// references in main.js were already commented out - and controls.js carried a
// TypeError on its three-finger-pan path. Neither is reachable from the demo.
export {Edge} from './three/edge.js';
export {Floor} from './three/floor.js';
export {Floorplan3D} from './three/floorPlan.js';
export {HUD} from './three/hud.js';
export {Lights} from './three/lights.js';
export {Main} from './three/main.js';
export {Skybox} from './three/skybox.js';

// Re-exported so embedders that reached for BP3DJS.OBJExporter keep working.
// S4 replaced the vendored copy - a fork old enough to branch on the removed
// THREE.Geometry - with three's own addon; the parse(object) -> string contract
// is unchanged.
export {OBJExporter} from 'three/addons/exporters/OBJExporter.js';



import {Model} from './model/model.js';
import {Main} from './three/main.js';
import {Floorplanner2D} from './floorplanner/floorplanner.js';
import {Configuration, configDimUnit} from './core/configuration.js';
import {dimMeter} from './core/dimensioning.js';
//
///** VestaDesigner core application. */
export class BlueprintJS
{
	/**
	 * Creates an instance of BlueprintJS. This is the entry point for the application
	 *
	 * @param {Object} - options The initialization options.
	 * @param {(HTMLCanvasElement|string)} options.floorplannerElement - The 2D canvas, or its element id. Ignored in widget mode.
	 * @param {(HTMLElement|string)} options.threeElement - The container for the 3D view, or its element id / CSS selector.
	 * @param {string} options.threeCanvasElement - Unused; kept for signature compatibility.
	 * @param {string} options.textureDir - path to texture directory. No effect
	 * @param {boolean} options.widget - If widget mode then no 2D floorplanner is created and the 3D controller is disabled
	 * @example
	 * let blueprint3d = new BP3DJS.BlueprintJS(opts);
	 *
	 * Passing element ids is the deprecated path, kept so existing embedders keep
	 * working. Prefer real elements - they need no document lookup and work in a
	 * component that mounts before its ids are unique.
	 */
	constructor(options)
	{
		Configuration.setValue(configDimUnit, dimMeter);

		/**
			* @property {Object} options
			* @type {Object}
		**/
		this.options = options;
		/**
			* @property {Model} model
			* @type {Model}
		**/
		this.model = new Model(options.textureDir);
		/**
		* @property {Main} three
		* @type {Main}
		**/
		this.three = new Main(this.model, options.threeElement, options.threeCanvasElement, {});

		if (!options.widget)
		{
			/**
			* @property {Floorplanner2D} floorplanner
			* @type {Floorplanner2D}
			**/
			this.floorplanner = new Floorplanner2D(options.floorplannerElement, this.model.floorplan);
		}
		else
		{
			// Widget mode has no 2D view, so nothing ever assigns
			// floorplan.carbonSheet. Loading a design that carries one used to
			// dereference null in Floorplan.loadFloorplan; that call is guarded as
			// of S0 and this property makes the absence explicit.
			this.floorplanner = null;
			this.three.getController().enabled = false;
		}
	}

	/**
	 * Unmount: dispose the 2D floorplanner (if any) and the 3D view, releasing
	 * every DOM listener and the WebGL context. Safe to call more than once.
	 *
	 * The model is left alone on purpose - it is plain data, it holds no DOM or
	 * GPU resources, and callers often want to serialize it after teardown.
	 */
	dispose()
	{
		if (this.floorplanner)
		{
			this.floorplanner.dispose();
			this.floorplanner = null;
		}
		if (this.three)
		{
			this.three.dispose();
			this.three = null;
		}
	}
}
