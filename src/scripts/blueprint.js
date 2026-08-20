// @ts-check
//Classes from core module
export {Version} from './core/version.js';

export {EVENT_SAVED, EVENT_UPDATED, EVENT_LOADING, EVENT_LOADED, EVENT_NEW, EVENT_ACTION, EVENT_GLTF_READY} from './core/events.js';
export {EVENT_DELETED, EVENT_MOVED, EVENT_REDRAW, EVENT_CHANGED, EVENT_MODE_RESET} from './core/events.js';
export {EVENT_CONFIG_CHANGED} from './core/events.js';
// The typed change contract (RM-003 A2). EVENT_CHANGESET carries a ChangeSet
// saying which kinds of thing changed and which entities each kind affects, so
// a consumer can stop reacting to a corner drag as though a document had been
// opened. Every EVENT_CHANGESET is followed by the EVENT_UPDATED it derives.
export {EVENT_CHANGESET} from './core/events.js';
export {ChangeSet, CHANGE_KINDS, CHANGE_REASONS} from './core/change_set.js';
export {CHANGE_TOPOLOGY, CHANGE_GEOMETRY, CHANGE_SURFACE, CHANGE_ITEMS, CHANGE_SELECTION, CHANGE_VIEW} from './core/change_set.js';
export {REASON_LOAD, REASON_EDIT, REASON_UNDO, REASON_DERIVE} from './core/change_set.js';
export {EVENT_ROOM_NAME_CHANGED} from './core/events.js';
export {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED} from './core/events.js';
export {EVENT_ITEMS_PROJECTED, EVENT_ITEM_2D_CLICKED, EVENT_LEVELS_CHANGED} from './core/events.js';
export {EVENT_ANNOTATIONS_CHANGED, EVENT_DIMENSION_2D_CLICKED, EVENT_ANNOTATION_2D_CLICKED} from './core/events.js';
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

export {cornerTolerance, configDimUnit, configWallHeight, configWallThickness, configSystemUI, configLevels, wallInformation, scale, snapToGrid, snapTolerance, gridSpacing, config, Configuration, defaultConfiguration, configurationOf} from './core/configuration.js';
// One document's services, with an identity (RM-003 A4): its configuration, the
// dimensioning bound to that, the render profile, the load session and the
// resource registries. `defaultRuntime.configuration`, `.dimensioning` and
// `.renderProfile` ARE the module defaults above - the same objects, so every
// static keeps reading the state it always did. A document built without a
// runtime gets one of its own carrying those same defaults: shared settings,
// its own lifetime.
export {DesignRuntime, defaultRuntime, runtimeOf, resolveRuntime} from './core/design_runtime.js';
// Logical asset name to physical URL (RM-003 A5). A saved design names a file
// by path and that string is a contract - it is in documents on other people's
// disks - so versioning and CDN relocation have to happen at runtime, between
// the name in the file and the URL on the network. With no manifest the
// resolver returns every name unchanged, which is what the library did before.
export {AssetManifest, MANIFEST_VERSION} from './core/asset_manifest.js';
export {AssetResolver, defaultAssetResolver} from './core/asset_resolver.js';
// A model that came off somebody's disk (RM-012 J3). `LocalModels` is bytes by
// logical name, `normaliseImport` reads the additive `local` key a design writes
// for an imported item, and `orientGeometry` is the one thing `scale_x/y/z` and a
// single Y rotation cannot already express: which axis the author called up.
export {LocalModels, normaliseImport, orientGeometry, UP_Y, UP_Z} from './core/imported_model.js';
export {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY, VIEW_EXTERIOR} from './core/constants.js';
export {NO_TINT, SURFACE_DEFAULTS, normaliseSurface, isPlainSurface, surfaceToJSON, colorValue} from './model/surface.js';
export {SUN_DEFAULTS, normaliseSun, sunToJSON, solarPosition, sunDirection} from './model/sun.js';
export {WallTypes} from './core/constants.js';

//Classes from model module
export {HalfEdge} from './model/half_edge.js';
export {Corner} from './model/corner.js';
export {defaultFloorPlanTolerance, Floorplan, SAVE_UNITS} from './model/floorplan.js';
// Storeys (RM-010 G1). A level is its own `Floorplan` rather than a field on
// one; see `model/level.js` for the measurement that decided it.
export {Level, DEFAULT_LEVEL_HEIGHT, MIN_LEVEL_HEIGHT, MAX_LEVEL_HEIGHT, defaultLevelName} from './model/level.js';
export {projectPlanOutline} from './model/level_projection.js';
// Holes in a floor where the stairs from below arrive (RM-010 G2), and the
// building's first roof. The polygon predicates here are new and correct; the
// four in core/utils.js stay pinned and nothing is built on them.
export {pointInside, polygonInside, polygonArea, centroid, clampOpeningToRoom, placeRectangle} from './model/floor_opening.js';
export {ROOF_FLAT, ROOF_GABLE, ROOF_HIP, ROOF_KINDS, RIDGE_X, RIDGE_Z, RIDGE_AXES, ROOF_DEFAULTS, MAX_PITCH, newRoof, normaliseRoof, roofFootprint, roofMetrics, buildRoofGeometry, roofToJSON} from './items/roof.js';
// What the 2D plan is allowed to know about the furniture (RM-008 E1). A
// footprint is plain data - the plan draws a description of an item, never the
// item - which is what lets the 2D view show furniture without a Floorplan
// gaining a reference to a Scene.
export {projectItem, projectItems, footprintContains, footprintCorners} from './model/plan_projection.js';
export {ITEM_TYPE_PARAMETRIC_OPENING, ITEM_TYPE_PARAMETRIC_STAIR, ITEM_TYPE_PARAMETRIC_STRUCTURE} from './items/factory.js';
export {ParametricOpening} from './items/parametric_opening.js';
export {OPENING_DOOR, OPENING_WINDOW, OPENING_ARCH, OPENING_KINDS, OPENING_DEFAULTS, HINGE_LEFT, HINGE_RIGHT, newOpening, normaliseOpening, openingRectangle, clampOpening, buildOpeningGeometry, openingToJSON} from './items/opening.js';
export {ParametricStair} from './items/parametric_stair.js';
export {ParametricStructure} from './items/parametric_structure.js';
export {STRUCTURE_COLUMN, STRUCTURE_BEAM, STRUCTURE_KINDS, STRUCTURE_DEFAULTS, SECTION_RECTANGULAR, SECTION_ROUND, STRUCTURE_SECTIONS, newStructure, normaliseStructure, structureExtent, isOverhead, buildStructureGeometry, structureToJSON} from './items/structure.js';
export {LAMP_COLOR, LAMP_DEFAULTS, normaliseLamp, lampToJSON} from './items/lamp.js';
export {STAIR_STRAIGHT, STAIR_L, STAIR_U, STAIR_SHAPES, STAIR_DEFAULTS, STAIR_MATERIALS, TURN_LEFT, TURN_RIGHT, HANDRAIL_NONE, HANDRAIL_LEFT, HANDRAIL_RIGHT, HANDRAIL_BOTH, HANDRAIL_SIDES, HEADROOM, newStair, normaliseStair, stairMetrics, stairParts, stairPlan, stairwellHint, buildStairGeometry, stairToJSON} from './items/stair.js';
export {Dimension, TextAnnotation, dimensionLine, DEFAULT_DIMENSION_OFFSET, DEFAULT_ANNOTATION_TEXT, DEFAULT_ANNOTATION_SIZE, ANNOTATION_SIZES} from './model/annotation.js';
export {Model, metadataFromRecord} from './model/model.js';
// Document validation and load ownership (RM-003 A1). `DesignDocument.parse`
// checks a `.blueprint3d` document without touching anything, which is what
// makes `Model.loadDocument` atomic; `LoadSession` is how a load knows which
// document asked for it.
export {DesignDocument} from './model/document.js';
export {LoadSession} from './core/load_session.js';
export {defaultRoomTexture, Room} from './model/room.js';
export {Scene} from './model/scene.js';
export {defaultWallTexture, Wall} from './model/wall.js';

//Classes from floorplanner module
export {floorplannerModes, gridWidth, gridColor, deleteColor} from './floorplanner/floorplanner_view.js';
export {CanvasBackend, SvgBackend} from './floorplanner/backends.js';
export {planBounds, scaleProjection, fitProjection, thumbnailProjection, drawTitleBlock, exportPlanSVG,
	renderPlanToCanvas, renderPlanThumbnail, PLAN_SCALES, PIXELS_PER_PAPER_CM, THUMBNAIL_WIDTH,
	THUMBNAIL_HEIGHT} from './floorplanner/plan_export.js';
export {roomColor, roomColorHover, roomColorSelected} from './floorplanner/floorplanner_view.js';
export {wallWidth, wallWidthHover, wallWidthSelected, wallColor, wallColorHover, wallColorSelected}  from './floorplanner/floorplanner_view.js';
export {edgeColor, edgeColorHover, edgeWidth} from './floorplanner/floorplanner_view.js';
export {cornerRadius, cornerRadiusHover, cornerRadiusSelected, cornerColor, cornerColorHover, cornerColorSelected} from './floorplanner/floorplanner_view.js';
export {FloorplannerView2D} from './floorplanner/floorplanner_view.js';
export {floorplannerPalette, setFloorplannerPalette} from './floorplanner/floorplanner_view.js';
export {RENDER_CLASSIC, RENDER_STUDIO, renderProfile, setRenderProfile, isStudio, createRenderProfile} from './core/render_profile.js';
export {EYE_HEIGHT} from './three/pointerlockcontrols.js';
export {CUBE_FACES, directionAt, pixelFor, faceSample, projectEquirectangular} from './core/equirect.js';
export {PANORAMA_FACE_SIZE, PANORAMA_WIDTH, panoramaCameras, capturePanoramaFaces, capturePanorama, panoramaDataUrl, flipRows} from './three/panorama.js';


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
import {configDimUnit} from './core/configuration.js';
import {DesignRuntime} from './core/design_runtime.js';
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
	 * @param {import('./core/asset_resolver.js').AssetResolver} [options.assets] - Where this document's asset URLs come from (A5), from `new AssetResolver({manifest, base})`. Omit for the identity resolver, which returns every logical name unchanged - what the library did before A5.
	 * @param {import('./core/imported_model.js').LocalModelSource} [options.localModels] - Bytes for models no deployment ships (RM-012 J3), from a store the embedder owns. A file picked off a disk has no URL for `assets` to rewrite, so `Scene` asks this first and loads from memory when it answers. Omit and nothing changes.
	 * @param {import('./core/design_runtime.js').DesignRuntime} [options.runtime] - This document's services as one object (A4): its configuration, dimensioning, render profile, load session and resource registries. Omit and one is built here from `configuration`/`renderProfile`. A runtime passed in belongs to the caller and is never disposed by `dispose()`.
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
		 * This document's services (RM-003 A4).
		 *
		 * Two ways in:
		 *
		 * - `options.runtime` - an embedder that wants to hold the document's
		 *   lifetime itself, put two viewers on one document, or read
		 *   `runtime.stats()`. It is theirs; `dispose()` will not touch it.
		 * - otherwise one is built here, around `options.configuration`,
		 *   `options.renderProfile` and `options.assets` if they were given. Omit
		 *   them and it carries the page-wide defaults, which is what every caller
		 *   had before P7.
		 *
		 * Note what the second case does NOT do: reuse `defaultRuntime`. Settings
		 * are shared by default and lifetimes never are - see the note on that
		 * constant for what went wrong when they were.
		 *
		 * @property {DesignRuntime} runtime
		 * @type {import('./core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = options.runtime
			|| new DesignRuntime({
				configuration: options.configuration,
				renderProfile: options.renderProfile,
				assets: options.assets,
				localModels: options.localModels,
			});

		/**
		 * Whether `dispose()` should dispose the runtime as well. Only when this
		 * instance built it: a runtime handed in belongs to whoever handed it in,
		 * and disposing it would be one viewer reaching into another document's
		 * lifetime, which is the whole finding A4 closes.
		 */
		this._ownsRuntime = !options.runtime;

		// Has always been here, and against the shared configuration it means
		// *constructing* a second BlueprintJS silently re-unitises the first one -
		// the purest form of the singleton problem R-02 is about. It writes to
		// whichever configuration this document reads, which is the shared one
		// only when the caller asked for nothing else.
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
		this.model = new Model(options.textureDir, this.runtime);
		// Held in a local as well as on `this`, because the property is nullable
		// (dispose() clears it) and the checker will not narrow a nullable
		// property across the branch below. The local is definitely a Main.
		//
		// `renderProfile` is NOT forwarded here as of A4, and that is the point of
		// the sprint: it is on the runtime, and Main reads it from the model's
		// floorplan. Forwarding it as well would be a second route to the same
		// answer, and two routes are how they come to disagree.
		var three = new Main(this.model, options.threeElement, options.threeCanvasElement, {});
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
	 * This design's settings (RM-002 R-02, P7).
	 *
	 * A getter over the runtime since A4, for the same reason `Floorplan`'s is:
	 * one place the answer is kept, so `blueprint.configuration` and
	 * `blueprint.runtime.configuration` cannot come apart.
	 *
	 * @returns {import('./core/configuration.js').Configuration}
	 */
	get configuration()
	{
		return this.runtime.configuration;
	}

	/**
	 * Unmount: dispose the 2D floorplanner (if any) and the 3D view, releasing
	 * every DOM listener and the WebGL context. Safe to call more than once.
	 *
	 * The model is left alone on purpose - it is plain data, it holds no DOM or
	 * GPU resources, and callers often want to serialize it after teardown.
	 *
	 * The runtime is disposed only if this instance built it - see
	 * `_ownsRuntime`. A viewer handed one leaves it exactly as it found it.
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

		// The bandwidth half of abandoning a load (see DesignRuntime.dispose).
		// Unconditional, because these are the fetches THIS document started
		// through its own LoadingManager, whoever owns the runtime.
		if (this.model && this.model.scene)
		{
			this.model.scene.abortPendingLoads();
		}

		if (this._ownsRuntime)
		{
			this.runtime.dispose();
		}
	}
}
