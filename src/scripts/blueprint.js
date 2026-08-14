// @ts-check
//Classes from core module
export {Version} from './core/version.js';

export {EVENT_SAVED, EVENT_UPDATED, EVENT_LOADING, EVENT_LOADED, EVENT_NEW, EVENT_ACTION, EVENT_GLTF_READY} from './core/events.js';
export {EVENT_DELETED, EVENT_MOVED, EVENT_REDRAW, EVENT_CHANGED, EVENT_MODE_RESET} from './core/events.js';
export {EVENT_CONFIG_CHANGED} from './core/events.js';
export {EVENT_ROOM_NAME_CHANGED} from './core/events.js';
export {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED} from './core/events.js';
export {EVENT_ITEM_MOVE_FINISH} from './core/events.js';
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
export {dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter, dimensioningOptions, decimals, Dimensioning, defaultDimensioning} from './core/dimensioning.js';
export {cmPerFoot, pixelsPerFoot, cmPerPixel, pixelsPerCm} from './core/dimensioning.js';

export {cornerTolerance, configDimUnit, configWallHeight, configWallThickness, configSystemUI, wallInformation, scale, snapToGrid, snapTolerance, gridSpacing, config, Configuration, defaultConfiguration, configurationOf} from './core/configuration.js';
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
export {floorplannerPalette, setFloorplannerPalette} from './floorplanner/floorplanner_view.js';
export {RENDER_CLASSIC, RENDER_STUDIO, renderProfile, setRenderProfile, isStudio, createRenderProfile} from './three/render_profile.js';


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
// Shared image cache behind every wall and floor texture (RM-002 R-04).
// Exported so an embedder can release it, and so the leak stays assertable.
export {acquireTexture, releaseTexture, clearTextureCache, textureCacheStats} from './three/texture_cache.js';

// Re-exported so embedders that reached for BP3DJS.OBJExporter keep working.
// S4 replaced the vendored copy - a fork old enough to branch on the removed
// THREE.Geometry - with three's own addon; the parse(object) -> string contract
// is unchanged.
export {OBJExporter} from 'three/addons/exporters/OBJExporter.js';



import {Model} from './model/model.js';
import {Main} from './three/main.js';
import {Floorplanner2D} from './floorplanner/floorplanner.js';
import {configDimUnit, defaultConfiguration} from './core/configuration.js';
import {dimMeter} from './core/dimensioning.js';
//
///** VestaDesigner core application. */
export class BlueprintJS
{
	/**
	 * Creates an instance of BlueprintJS. This is the entry point for the application
	 *
	 * @param {Object} options The initialization options.
	 * @param {(HTMLCanvasElement|string)} options.floorplannerElement - The 2D canvas, or its element id. Ignored in widget mode.
	 * @param {(HTMLElement|string)} options.threeElement - The container for the 3D view, or its element id / CSS selector.
	 * @param {?string} options.threeCanvasElement - Unused; kept for signature compatibility.
	 * @param {string} options.textureDir - path to texture directory. No effect
	 * @param {boolean} options.widget - If widget mode then no 2D floorplanner is created and the 3D controller is disabled
	 * @param {import('./core/configuration.js').Configuration} [options.configuration] - Settings for this design alone (P7). Omit to share the page-wide default.
	 * @param {Object} [options.renderProfile] - A look for this viewer alone (P7), from `createRenderProfile`. Omit to share the page-wide default.
	 * @example
	 * let blueprint3d = new BP3DJS.BlueprintJS(opts);
	 *
	 * Passing element ids is the deprecated path, kept so existing embedders keep
	 * working. Prefer real elements - they need no document lookup and work in a
	 * component that mounts before its ids are unique.
	 */
	constructor(options)
	{
		/**
		 * This design's settings (RM-002 R-02, P7).
		 *
		 * `options.configuration` is how an embedder asks for a viewer that does
		 * not share units, scale, wall defaults and snapping with every other
		 * viewer on the page. Omitting it keeps the shared default, which is what
		 * every caller had before and what a page with one design wants.
		 *
		 * The line below is why this matters more than it sounds. It has always
		 * been here, and against the shared default it means *constructing* a
		 * second BlueprintJS silently re-unitises the first one - the purest form
		 * of the singleton problem this finding is about. It now writes to
		 * whichever configuration this instance owns.
		 *
		 * @property {Configuration} configuration
		 * @type {import('./core/configuration.js').Configuration}
		 */
		this.configuration = options.configuration || defaultConfiguration;
		this.configuration.setValue(configDimUnit, dimMeter);

		/**
			* @property {Object} options
			* @type {Object}
		**/
		this.options = options;
		/**
			* @property {Model} model
			* @type {Model}
		**/
		this.model = new Model(options.textureDir, this.configuration);
		// Held in a local as well as on `this`, because the property is nullable
		// (dispose() clears it) and the checker will not narrow a nullable
		// property across the branch below. The local is definitely a Main.
		// `renderProfile` forwarded so a viewer can have a look of its own (P7);
		// omitted, Main falls back to the shared profile exactly as before.
		var three = new Main(this.model, options.threeElement, options.threeCanvasElement, {renderProfile: options.renderProfile || null});
		/**
		* @property {Main} three
		* @type {?Main}
		**/
		this.three = three;

		/**
		 * The 2D view, or null in widget mode - and null again after dispose().
		 * Declared before the branch so both arms agree on the type; assigning
		 * null to a property first seen as a Floorplanner2D is what the checker
		 * objected to, and it was right that the annotation said otherwise.
		 * @type {?Floorplanner2D}
		 */
		this.floorplanner = null;

		if (!options.widget)
		{
			this.floorplanner = new Floorplanner2D(options.floorplannerElement, this.model.floorplan);
		}
		else
		{
			// Widget mode has no 2D view, so nothing ever assigns
			// floorplan.carbonSheet. Loading a design that carries one used to
			// dereference null in Floorplan.loadFloorplan; that call is guarded as
			// of S0 and the null above makes the absence explicit.
			// Main.init() runs from its constructor, so the controller exists by
			// now. The guard is not defensive padding: getController() is genuinely
			// nullable before init, and "disable the controller" is vacuously
			// satisfied when there is not one.
			var controller = three.getController();
			if (controller)
			{
				controller.enabled = false;
			}
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
