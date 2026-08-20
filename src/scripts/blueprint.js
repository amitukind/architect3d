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
// Was re-exported from three/pointerlockcontrols.js until RM-015 M3, which
// moved the declaration rather than the export: importing three numbers must
// not import three's addon. Same name, same object, same path out of here.
export {EYE_HEIGHT} from './core/constants.js';
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
export {CUBE_FACES, directionAt, pixelFor, faceSample, projectEquirectangular} from './core/equirect.js';
export {PANORAMA_FACE_SIZE, PANORAMA_WIDTH, panoramaCameras, capturePanoramaFaces, capturePanorama, panoramaDataUrl, flipRows} from './three/panorama.js';


export {Floorplanner2D} from './floorplanner/floorplanner.js';
// The same document without a viewer (RM-015 M3). `BlueprintJS` below is
// `BlueprintCore` plus a statically imported `Main`; this is the half that a
// caller can construct without pulling three's renderer into their first load.
// See blueprint_core.js for the measurement that produced it.
export {BlueprintCore} from './blueprint_core.js';
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



import {Main} from './three/main.js';
import {BlueprintCore} from './blueprint_core.js';
/**
 * VestaDesigner core application: a document, its 2D plan and its 3D viewer.
 *
 * The entry point, and unchanged in behaviour. `new BlueprintJS(opts)` builds
 * everything it always built, in one call, in the order it always built it -
 * which is the contract embedders have, and the reason the split introduced by
 * RM-015 M3 put the *absence* of a viewer in the subclass-able half rather than
 * behind an option here.
 *
 * The one thing this class adds to `BlueprintCore` is the static
 * `import {Main}` just above. That import is what an application avoids by
 * constructing a `BlueprintCore` and calling `attachViewer()` off a dynamic
 * import instead; everything else about the two is identical.
 *
 * @example
 * let blueprint3d = new BP3DJS.BlueprintJS(opts);
 */
export class BlueprintJS extends BlueprintCore
{
	/**
	 * @param {Object} options The initialization options. See `BlueprintCore`,
	 *        whose constructor takes them and documents them.
	 */
	constructor(options)
	{
		super(options);
		this.attachViewer(Main);
	}
}
