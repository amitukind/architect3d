// @ts-check
import {EventDispatcher, Vector2, Vector3, WebGLRenderer, PerspectiveCamera, OrthographicCamera} from 'three';
import {ColorManagement, SRGBColorSpace} from 'three';
import {Plane, Mesh} from 'three';
import {buildRoofGeometry} from '../items/roof.js';
import {disposeObject} from '../core/resource_registry.js';
import {PCFShadowMap, ACESFilmicToneMapping, NoToneMapping, PMREMGenerator} from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {PointerLockControls} from './pointerlockcontrols.js';
import {describeFrom} from '../core/texture_formats.js';

import {EVENT_LEVELS_CHANGED, EVENT_CHANGESET, EVENT_WALL_CLICKED, EVENT_NOTHING_CLICKED, EVENT_FLOOR_CLICKED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_GLTF_READY} from '../core/events.js';
import {EVENT_ITEMS_PROJECTED} from '../core/events.js';
import {CHANGE_TOPOLOGY} from '../core/change_set.js';
import {EVENT_FPS_EXIT, EVENT_CAMERA_VIEW_CHANGE} from '../core/events.js';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY, VIEW_EXTERIOR} from '../core/constants.js';
import {resolveElement, elementBox, measureViewport, pixelRatio} from '../core/dom.js';

import {OrbitControls} from './orbitcontrols.js';

import {Controller} from './controller.js';
import {HUD} from './hud.js';
import {Floorplan3D} from './floorPlan.js';
import {Lights} from './lights.js';
import {Skybox} from './skybox.js';
import {isStudio, setRenderProfile} from '../core/render_profile.js';
import {runtimeOf} from '../core/design_runtime.js';


/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('../model/model.js').Model} Model
 */
// --- S8: colour management, on ---------------------------------------------
//
// r152 turned this on by default and S4 turned it back off, so that the engine
// bump could be reviewed as a geometry change rather than a colour one. This is
// the sprint that reverses that decision, deliberately and with its own review.
//
// With it on, `new Color(0xRRGGBB)` reads the literal as sRGB and stores the
// linear value, every colour texture is decoded by the GPU on the way in, and
// the frame is encoded back to sRGB on the way out. That is one coherent
// pipeline instead of three-quarters of one, and it is what every other three
// application and every glTF asset already assumes.
//
// `true` is three's own default, so this line changes nothing on its own. It
// is written out because S4 wrote `false` here: a reader needs to see that the
// freeze was lifted on purpose, and a deleted line says nothing. It also has to
// stay at module scope rather than move into the renderer setup - a Color
// converts when it is constructed, and materials are built long before any
// renderer exists.
ColorManagement.enabled = true;

/**
 * Half a millimetre, in the centimetres the model is measured in.
 *
 * The tolerance the camera gate compares plan extents with (RM-003 A2). Exact
 * equality would very nearly do - the same corners run through the same
 * arithmetic give the same float - but "very nearly" is how a camera ends up
 * twitching once in a thousand edits, and half a millimetre is far below
 * anything a person can see moving in a framed 3D view.
 */
const EXTENT_EPSILON = 0.05;

/**
 * @param {{center: Vector3, size: Vector3}} a
 * @param {{center: Vector3, size: Vector3}} b
 * @returns {boolean} Whether the two bounding boxes are the same one.
 */
function sameExtent(a, b)
{
	return a.center.distanceToSquared(b.center) < EXTENT_EPSILON * EXTENT_EPSILON
		&& a.size.distanceToSquared(b.size) < EXTENT_EPSILON * EXTENT_EPSILON;
}

export class Main extends EventDispatcher
{
	/**
	 * @param {Model} model
	 * @param {(HTMLElement|string)} element The container to render into, or its
	 * element id / CSS selector. The string form is the deprecated back-compat
	 * path.
	 * @param {?string} canvasElement Unused; kept for signature compatibility.
	 * @param {Object} opts
	 */
	constructor(model, element, canvasElement, opts)
	{
		super();
		var options = {resize: true,pushHref: false,spin: true,spinSpeed: .00002,clickPan: true,canMoveFixedItems: false,renderProfile: null};
		for (var opt in options)
		{
			// Object.prototype.hasOwnProperty.call, not obj.hasOwnProperty. Identical for a plain object and correct for one that is not - a key literally named "hasOwnProperty" shadows the method and turns the guard into a TypeError. `opts` is supplied by the embedder, which
			// is exactly the object whose keys this code does not control.
			if (Object.prototype.hasOwnProperty.call(options, opt)
				&& Object.prototype.hasOwnProperty.call(opts, opt))
			{
				options[opt] = opts[opt];
			}
		}

		this.pauseRender = true;
		/**
		 * Which document this viewer is showing (RM-003 A4).
		 *
		 * Reached through the model's floorplan, which is a hop that already
		 * existed - `Main` has held a `Model` since the beginning. Nothing about
		 * the constructor had to change to get it.
		 *
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = runtimeOf(model && model.floorplan);
		/**
		 * The look this viewer draws with (RM-002 R-02, P7).
		 *
		 * `null` in the options - the default - means this document's profile,
		 * which for a document that asked for no profile of its own is the shared
		 * module one: what every Main did before and what `npm run parity`
		 * measures. Pass `createRenderProfile(RENDER_STUDIO)` here or on the
		 * runtime for a viewer whose look is its own, which is what makes a
		 * classic-beside-studio comparison expressible.
		 */
		this.renderProfile = options.renderProfile || this.runtime.renderProfile;
		this.model = model;
		this.scene = model.scene;
		this.element = resolveElement(element, '3D viewer container');
		this.canvasElement = canvasElement;
		/** @type {Record<string, any>} The merged options, defaults included. */
		this.options = options;
		this._disposed = false;

		/** @type {?HTMLElement} The element the camera controls listen on. */
		this.domElement = null;
		/** @type {?OrthographicCamera} */
		this.orthocamera = null;
		/** @type {?PerspectiveCamera} */
		this.perspectivecamera = null;
		/** @type {?(PerspectiveCamera|OrthographicCamera)} Whichever of the two is live. */
		this.camera = null;
		this.savedcameraposition = null;
		/** @type {?PerspectiveCamera} */
		this.fpscamera = null;

		this.cameraNear = 10;
		this.cameraFar = 10000;

		/** @type {?OrbitControls} */
		this.controls = null;
		/** @type {?PointerLockControls} */
		this.fpscontrols = null;
		this.firstpersonmode = false;

		/** @type {?WebGLRenderer} */
		this.renderer = null;
		// Annotated because init() assigns it through a `scope` alias rather than
		// through `this`, so inference sees only this line and concludes the
		// property is permanently null - which made getController() useless to
		// every caller the type checker looked at.
		/** @type {?Controller} */
		/** @type {?Controller} */
		this.controller = null;

		this.needsUpdate = false;
		this.lastRender = Date.now();

		this.mouseOver = false;
		this.hasClicked = false;

		/** @type {?HUD} */
		this.hud = null;
		/** @type {?Lights} */
		this.lights = null;
		/** @type {?Skybox} */
		this.skybox = null;
		this.environmentTexture = null;

		/** @type {?number} Null until the first resize measures the element. */
		this.heightMargin = null;
		/** @type {?number} */
		this.widthMargin = null;
		/** @type {?number} */
		this.elementHeight = null;
		/** @type {?number} */
		this.elementWidth = null;

		// Removed in S2: five $.Callbacks lists (itemSelected / itemUnselected /
		// wallClicked / floorClicked / nothingClicked). Every .fire() and .add()
		// against them was already commented out - the EventDispatcher events
		// dispatched by itemIsSelected() and friends replaced them - so they were
		// jQuery's last foothold in this file and nothing but dead weight.

		/**
		 * One 3D projection per storey, keyed by level id (RM-010 G1).
		 *
		 * Was a single `Floorplan3D`. It is a map now because a building has more
		 * than one plan in it, and each projection draws into its own level's
		 * `Group` - which is where the base elevation is applied, so none of
		 * `Floorplan3D`, `Floor` or `Edge` changed at all. Those three ask a scene
		 * for `add`, `remove` and `needsUpdate` and nothing else, measured before
		 * this was written, and `Scene.levelScene` is exactly that much of a scene.
		 *
		 * @type {Map<string, Floorplan3D>}
		 */
		this.levelViews = new Map();
		/**
		 * Which floorplans this view is subscribed to, so it can unsubscribe.
		 * @type {Set<Object>}
		 */
		this._watchedPlans = new Set();
		/** @type {?Mesh} The building's roof, or null when it has none (RM-010 G2). */
		this._roofMesh = null;
		/**
		 * Whether every storey is shown, or only the one being edited (RM-010 G3).
		 *
		 * `Scene.syncLevels` has taken an `activeOnly` option since G1 and nothing
		 * passed it, which is the shape RM-010 V-8 warned about: per-level
		 * visibility is a branch in what a click may hit, and an untaken branch is
		 * an untested one. It defaults to every storey, so a build that never
		 * touches it behaves exactly as G1 left it.
		 *
		 * @type {boolean}
		 */
		this._allStoreys = true;

		/**
		 * The plan extent the camera was last framed against, or null before the
		 * first framing (RM-003 A2). Compared on every topology change; see
		 * onModelChanged.
		 *
		 * @type {?{center: Vector3, size: Vector3}}
		 */
		this._lastFramedExtent = null;
		this._cameraStats = {recentred: 0, declined: 0};

		var scope = this;
		this.updatedevent = (evt)=>{scope.onModelChanged(evt.changes);};
		/** An item's placement changed; this viewer renders on demand (RM-008 E1). */
		this.itemsprojectedevent = ()=>{scope.ensureNeedsUpdate();};
		this.gltfreadyevent = (o)=>{scope.gltfReady(o);};

		this.clippingPlaneActive = new Plane(new Vector3(0, 0, 1), 0.0);
		this.clippingPlaneActive2 = new Plane(new Vector3(0, 0, -1), 0.0);
		this.globalClippingPlane = [this.clippingPlaneActive, this.clippingPlaneActive2];
		this.clippingEmpty = Object.freeze([]);
		this.clippingEnabled = false;


		this.init();
	}

	/**
	 * Enabling seam, in the same shape as Utils.setRandomSource and
	 * Scene.setItemLoader from S0: swap in a renderer so the viewer can be mounted
	 * and unmounted under test without a WebGL context. Pass null to restore the
	 * real WebGLRenderer. Nothing in the library calls this - it exists so the
	 * mount/destroy/remount contract can be a CI test rather than a manual page.
	 *
	 * @param {?function(Main): Object} fn
	 */
	/**
	 * @type {?function(Main): Object} The test seam, declared so it is a
	 * member rather than a property invented at first assignment (RM-005 C2).
	 */
	static _rendererFactory = null;

	static setRendererFactory(fn)
	{
		Main._rendererFactory = (typeof fn === 'function') ? fn : null;
	}

	getARenderer()
	{
		// The seam swaps the *renderer*, not the configuration of it. Until S8
		// this returned the fake immediately, so everything below - the colour
		// space, the shadow map, the clear colour - ran only against a real
		// WebGL context and no test could see any of it. Configuring whatever
		// renderer we were handed costs nothing, keeps the fake honest, and is
		// what lets tests/viewer-lifecycle.test.js assert on the output colour
		// space at all.
		var renderer = Main._rendererFactory
			? Main._rendererFactory(this)
			: new WebGLRenderer({antialias: true, alpha:true});

		// sRGB out. This is three's default too, and is written explicitly for
		// the same reason as the line at the top of the file: S4 set it to
		// Linear, and an S8 reader needs to see that it was changed rather than
		// left alone. The two halves must move together - a decoded texture
		// written into an unencoded frame lands a full gamma too dark, and an
		// undecoded one into an encoded frame lands far too bright.
		renderer.outputColorSpace = SRGBColorSpace;

		renderer.shadowMap.enabled = true;
		// The filter that actually runs, said out loud (RM-011 W-8, repaired by
		// H2).
		//
		// This line asked for `PCFSoftShadowMap` from the fork until now. three
		// deprecated that constant, and `WebGLShadowMap.render` does not merely
		// ignore it - it warns on the first frame and **assigns PCFShadowMap over
		// the top of it**, so `renderer.shadowMap.type` has read back as 1 for as
		// long as this project has been on a modern three. A source line that
		// names a filter the renderer refuses is worse than a wrong filter,
		// because every reading of it is wrong in the same direction.
		//
		// Changing it to what already runs is therefore a zero-pixel commit by
		// construction, which `tests/browser/shadow-filter.test.js` asserts rather
		// than assumes. What it buys is a baseline H2's lighting can be compared
		// against and one fewer deprecation warning on every boot.
		//
		// It also is not a downgrade in what it can do, which is the part W-8 got
		// wrong: three rewrote PCF into a five-tap Vogel disk scaled by
		// `shadow.radius`, and that rewrite is exactly *why* the soft variant was
		// deprecated. The profile's `shadowRadius` reaches the shader and moves
		// pixels - measured, not assumed, in the same file.
		renderer.shadowMap.type = PCFShadowMap;
		renderer.setClearColor( 0xFFFFFF, 1 );
		renderer.clippingPlanes = this.clippingEmpty;
		renderer.localClippingEnabled = false;

		this.applyToneMapping(renderer);

		return renderer;
	}

	/**
	 * Filmic tone mapping, under the studio profile.
	 *
	 * The scene has a hemisphere light at 1.1*pi and a key at 0.5*pi over
	 * mostly-white surfaces, which means large areas of it land above 1.0 in
	 * linear space. With NoToneMapping - three's default, and what this app has
	 * always used - everything above 1.0 is clamped, so those areas become
	 * exactly #ffffff and all the shading inside them is thrown away. It is why
	 * a brightly lit white wall loses its corner.
	 *
	 * ACES rolls the highlights off instead of cutting them, so the same wall
	 * keeps its gradient, and it slightly desaturates the extremes, which is what
	 * stops a saturated fabric reading as a flat sticker.
	 *
	 * Tone mapping is applied *after* lighting and *before* the sRGB encode, so
	 * it composes with the S8 colour pipeline rather than competing with it.
	 * Explicitly setting NoToneMapping on the classic path matters: this method
	 * also runs from applyRenderProfile on a live renderer, and leaving the
	 * previous value in place would make classic-after-studio a third look.
	 *
	 * @param {Object} renderer
	 */
	applyToneMapping(renderer)
	{
		renderer.toneMapping = isStudio(this.renderProfile) ? ACESFilmicToneMapping : NoToneMapping;
		renderer.toneMappingExposure = this.renderProfile.toneMappingExposure;
	}

	/**
	 * Build the image-based environment and hang it on the scene.
	 *
	 * `RoomEnvironment` is a three addon: a handful of emissive boxes arranged as
	 * a photographer's softbox room. Rendered once into a cube target and
	 * prefiltered by PMREMGenerator, it becomes the irradiance every physically
	 * based material samples for its ambient and specular response.
	 *
	 * This is the change that does the most for the least, because the catalog is
	 * 168 glTF models and glTF materials are physically based by definition. In
	 * the classic scene their only light is one hemisphere and one very dim red
	 * directional, so a chrome tap and a matte cushion shade almost identically -
	 * they have nothing to reflect. Here they reflect a room.
	 *
	 * Cost is one offscreen render at startup and one cube texture held for the
	 * life of the viewer. The generator itself is disposed immediately; the
	 * texture it produced is not, and is released in dispose().
	 */
	buildEnvironment()
	{
		this.environmentTexture = null;
		if (!isStudio(this.renderProfile) || !this.renderProfile.environment)
		{
			this.scene.getScene().environment = null;
			return;
		}

		// A stubbed renderer has no WebGL context to render the cube into. The
		// viewer is fully functional without an environment - it is ambient light,
		// not geometry - so this degrades rather than throws, which is what lets
		// the mount/unmount suite run headless.
		if (!this.renderer || typeof this.renderer.compile !== 'function')
		{
			return;
		}

		var pmrem = new PMREMGenerator(this.renderer);
		var room = new RoomEnvironment();
		this.environmentTexture = pmrem.fromScene(room, 0.04).texture;
		this.scene.getScene().environment = this.environmentTexture;
		room.dispose();
		pmrem.dispose();
	}

	/**
	 * Switch render profile on a live viewer.
	 *
	 * Three things have to happen together and in this order: the profile is
	 * swapped, the renderer and environment are reconfigured against it, and then
	 * every Edge and Floor is thrown away and rebuilt - because a material's
	 * class is fixed at construction and no amount of assignment turns a
	 * MeshBasicMaterial into a MeshStandardMaterial.
	 *
	 * The Skybox is rebuilt too, for the fog and the sky gradient. Loaded items
	 * are not: they are glTF, they were always physically based, and they pick up
	 * the new environment and tone mapping without being touched.
	 *
	 * @param {string} mode RENDER_CLASSIC or RENDER_STUDIO.
	 */
	applyRenderProfile(mode)
	{
		setRenderProfile(mode, undefined, this.renderProfile);

		this.applyToneMapping(this.renderer);

		if (this.environmentTexture)
		{
			this.environmentTexture.dispose();
			this.environmentTexture = null;
		}
		this.buildEnvironment();

		if (this.skybox)
		{
			var wasEnvironment = this.skybox.useEnvironment;
			this.skybox.dispose();
			this.skybox = new Skybox(this.scene, this.renderer, this.renderProfile);
			this.skybox.toggleEnvironment(wasEnvironment);
		}

		if (this.lights)
		{
			this.lights.dispose();
			this.lights = new Lights(this.scene, this.model.floorplan, this.renderProfile);
			this.lights.updateShadowCamera();
			this.syncSun();
		}

		this.levelViews.forEach((view) => {view.redraw();});
		// The roof is sized from the plan's extent and stands on the top storey's
		// walls, so a change to either is a change to it.
		this.syncRoof();

		this.needsUpdate = true;
		this.render(true);
	}

	init()
	{
		var scope = this;
		// ImageUtils.crossOrigin was removed in r103. It set a default for the
		// deprecated ImageUtils loaders, which nothing here used - the app loads
		// textures through TextureLoader, whose crossOrigin defaults to
		// 'anonymous' and is set per-loader where it matters.

		var orthoScale = 100;
		// Provisional frustum only - updateWindowSize() below recomputes it from
		// the container before the first frame is drawn.
		var initialSize = measureViewport(scope.element, window.innerWidth, window.innerHeight);
		var orthoWidth = initialSize.width;
		var orthoHeight = initialSize.height;

		// `element` is the container the renderer canvas goes into, and `domElement`
		// is what OrbitControls and PointerLockControls listen on - they take an
		// HTMLElement, which is what this is (RM-005 C2).
		scope.domElement = /** @type {HTMLElement} */ (scope.element);

		scope.fpscamera = new PerspectiveCamera(60, 1, 1, 10000 );
		scope.perspectivecamera = new PerspectiveCamera(45, 10, scope.cameraNear, scope.cameraFar);
		scope.orthocamera = new OrthographicCamera(orthoWidth / -orthoScale, orthoWidth /orthoScale, orthoHeight /orthoScale, orthoHeight / -orthoScale, scope.cameraNear, scope.cameraFar);

		scope.camera = scope.perspectivecamera;

		var renderer = scope.getARenderer();
		scope.renderer = renderer;
		// Through the local from here on. `getARenderer()` cannot return null - it
		// either builds a WebGLRenderer or calls the test factory - but the FIELD
		// is nullable because dispose() clears it, and narrowing once beats
		// narrowing at each of the four uses below (RM-005 C2).
		if (scope.domElement) { scope.domElement.appendChild(renderer.domElement); }

		// The first real renderer on the page describes the device, so a `Scene`
		// building its KTX2 loader does not have to open a second WebGL context
		// just to ask what formats this GPU supports (RM-004 B5). Idempotent and
		// first-caller-wins: a second viewport must not change the answer, since
		// a texture already transcoded for one format cannot be re-transcoded.
		describeFrom(renderer);

		// Before the Skybox, which reads scene.fog, and before Lights - both are
		// cheap to build and neither depends on the environment, but keeping the
		// order "renderer, environment, world" means there is never a frame where
		// a physically based material exists with nothing to reflect.
		scope.buildEnvironment();

		scope.skybox = new Skybox(scope.scene, scope.renderer, scope.renderProfile);

		scope.controls = new OrbitControls(scope.camera, scope.domElement);
		scope.controls.autoRotate = this.options['spin'];
		scope.controls.enableDamping = true;
		scope.controls.dampingFactor = 0.5;
		scope.controls.maxPolarAngle = Math.PI * 0.5;
		scope.controls.maxDistance = 3000;
		scope.controls.minZoom = 0.9;
		scope.controls.screenSpacePanning = true;

		// domElement is what gets pointer-locked and taken fullscreen. The fork
		// defaulted it to document.body and the addon requires it explicitly;
		// the viewer is the better target and is what the user is looking at.
		scope.fpscontrols = new PointerLockControls(scope.fpscamera, scope.domElement);
		scope.fpscontrols.characterHeight = 160;

		this.scene.add(scope.fpscontrols.getObject());
		scope.fpscontrols.getObject().position.set(0, 200, 0);

		this._fpsUnlockEvent = function(){
			scope.switchFPSMode(false);
			scope.dispatchEvent({type:EVENT_FPS_EXIT});
		};
		scope.fpscontrols.addEventListener('unlock', this._fpsUnlockEvent);


		scope.hud = new HUD(scope, scope.scene);
		scope.controller = new Controller(scope, scope.model, scope.camera, /** @type {HTMLElement} */ (scope.element), scope.controls, scope.hud);

		// handle window resizing
		scope.updateWindowSize();

		// Container-driven, with the window listener kept as the fallback for a
		// container that has no layout size of its own (see core/dom.js).
		//
		// Deferred to a frame since P6, for the reason FloorplannerView2D's
		// containerResized() spells out: `renderer.setSize()` writes style.width
		// and style.height on the canvas, and doing that from inside a
		// ResizeObserver callback watching that canvas' own container is what makes
		// the browser report `ResizeObserver loop completed with undelivered
		// notifications`. The animation loop is already running, so this needs no
		// scheduler of its own - it raises a flag the loop clears.
		this._resizePending = false;
		this._resizeEvent = () => {scope._deferResize();};
		this._resizeObserver = null;
		if (scope.options.resize)
		{
			if (typeof ResizeObserver === 'function')
			{
				this._resizeObserver = new ResizeObserver(this._resizeEvent);
				this._resizeObserver.observe(scope.element);
			}
			window.addEventListener('resize', this._resizeEvent);
		}
		// setup camera nicely
		scope.centerCamera();

		// Subscribed per storey by `syncLevelViews()` below, not to the active plan
		// here: a wall drawn on the first floor has to redraw the first floor even
		// while the ground floor is the one being edited (RM-010 G1).
		// An item moved on the plan (RM-008 E1). This viewer renders on demand -
		// there is no continuous loop - so a position written by the 2D drag would
		// otherwise sit in the scene graph until something unrelated asked for a
		// frame, and the 3D view would show the furniture where it used to be.
		//
		// EVENT_ITEMS_PROJECTED rather than a new event: the projection is
		// recomputed exactly when an item's placement changes, which is exactly
		// when this view is stale. It asks for a frame and nothing more; the
		// scene graph is already correct by the time it arrives.
		scope.model.addEventListener(EVENT_GLTF_READY, this.gltfreadyevent);
		this.levelsevent = () => {scope.syncLevelViews(); scope.render(true);};
		scope.model.addEventListener(EVENT_LEVELS_CHANGED, this.levelsevent);

		scope.lights = new Lights(scope.scene, scope.model.floorplan, scope.renderProfile);
		scope.syncSun();
		scope.syncLevelViews();

		function animate()
		{
			renderer.setAnimationLoop(function()
			{
				scope.applyPendingResize();
				scope.render();
			});
			scope.render();
		}
		scope.switchFPSMode(false);
		animate();

		// Auto-spin gating: the model stops rotating while the pointer is over the
		// viewer, and stops for good once the user has clicked in it.
		this._mouseEnterEvent = function () {scope.mouseOver = true;};
		this._mouseLeaveEvent = function () {scope.mouseOver = false;};
		this._clickEvent = function () {scope.hasClicked = true;};
		scope.element.addEventListener('mouseenter', this._mouseEnterEvent);
		scope.element.addEventListener('mouseleave', this._mouseLeaveEvent);
		scope.element.addEventListener('click', this._clickEvent);
	}

	/**
	 * Tear the viewer down: stop the render loop, detach every listener this
	 * instance attached, release the WebGL context, and take the canvas back out
	 * of the container. Safe to call more than once.
	 *
	 * After this the instance is spent - construct a new Main to mount again.
	 */
	dispose()
	{
		if (this._disposed)
		{
			return;
		}
		this._disposed = true;
		this.pauseRender = true;

		if (this.renderer)
		{
			this.renderer.setAnimationLoop(null);
		}

		if (this._resizeObserver)
		{
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		// All four are assigned by init(), so a dispose() before one is a dispose
		// with nothing to unbind - `removeEventListener` will not take undefined
		// and there is nothing to take (RM-005 C2).
		if (this._resizeEvent) { window.removeEventListener('resize', this._resizeEvent); }
		if (this._mouseEnterEvent) { this.element.removeEventListener('mouseenter', this._mouseEnterEvent); }
		if (this._mouseLeaveEvent) { this.element.removeEventListener('mouseleave', this._mouseLeaveEvent); }
		if (this._clickEvent) { this.element.removeEventListener('click', this._clickEvent); }

		this._watchedPlans.forEach((plan) =>
		{
			plan.removeEventListener(EVENT_CHANGESET, this.updatedevent);
			plan.removeEventListener(EVENT_ITEMS_PROJECTED, this.itemsprojectedevent);
		});
		this._watchedPlans.clear();
		this.model.removeEventListener(EVENT_GLTF_READY, this.gltfreadyevent);
		if (this.levelsevent)
		{
			this.model.removeEventListener(EVENT_LEVELS_CHANGED, this.levelsevent);
		}

		if (this.controller)
		{
			this.controller.dispose();
		}
		if (this.hud)
		{
			this.hud.dispose();
		}
		if (this.fpscontrols)
		{
			if (this._fpsUnlockEvent) { this.fpscontrols.removeEventListener('unlock', this._fpsUnlockEvent); }
			this.scene.remove(this.fpscontrols.getObject());
			this.fpscontrols.dispose();
		}
		if (this.controls)
		{
			this.controls.dispose();
		}
		this.levelViews.forEach((view) => {view.dispose();});
		this.levelViews.clear();
		if (this._roofMesh)
		{
			this.scene.remove(this._roofMesh);
			disposeObject(this._roofMesh);
			this._roofMesh = null;
		}
		if (this.skybox)
		{
			this.skybox.dispose();
		}
		if (this.lights)
		{
			this.lights.dispose();
		}
		if (this.environmentTexture)
		{
			this.environmentTexture.dispose();
			this.environmentTexture = null;
			this.scene.getScene().environment = null;
		}

		if (this.renderer)
		{
			var canvas = this.renderer.domElement;
			this.renderer.dispose();
			// Without this the browser keeps the context alive until GC, and a
			// mount/unmount loop walks straight into the ~16 live context limit.
			if (this.renderer.forceContextLoss)
			{
				this.renderer.forceContextLoss();
			}
			if (canvas && canvas.parentNode)
			{
				canvas.parentNode.removeChild(canvas);
			}
		}

		// No clearTextureCache() here, as of RM-003 A0.
		//
		// It used to be the last line of this method, and the comment it carried
		// said it "becomes R-02's problem" once two simultaneous viewers were a
		// supported configuration. P7 made them supported and shipped
		// tests/browser/two-designs.test.js to prove it, so the condition arrived.
		//
		// The call was always redundant for this viewer's own images and always
		// destructive to anybody else's. Every holder - each Edge, each Floor -
		// releases its handles above, and the cache is refcounted, so a master
		// whose last handle just went is already disposed by the time we get here.
		// What clearTextureCache() added was disposing the masters still held by
		// OTHER viewers, forcing each of them to re-fetch and re-decode every image
		// it was using on its next redraw.
		//
		// The export stays, for an embedder tearing down a whole page. It is
		// teardown, not eviction, and it is nobody's business to call it from the
		// disposal of one viewer among several.
	}
	exportForBlender()
	{
		if (!this.skybox || !this.controller)
		{
			return;
		}
		this.skybox.setEnabled(false);
		this.controller.showGroundPlane(false);
		this.model.exportForBlender();
	}

	gltfReady(o)
	{
		this.dispatchEvent({type:EVENT_GLTF_READY, item: this, gltf: o.gltf});
		if (!this.skybox || !this.controller)
		{
			return;
		}
		this.skybox.setEnabled(true);
		this.controller.showGroundPlane(true);
	}

	itemIsSelected(item)
	{
		this.dispatchEvent({type:EVENT_ITEM_SELECTED, item:item});
	}

	itemIsUnselected()
	{
		this.dispatchEvent({type:EVENT_ITEM_UNSELECTED});
	}

	wallIsClicked(wall)
	{
		this.dispatchEvent({type:EVENT_WALL_CLICKED, item:wall, wall:wall});
	}

	floorIsClicked(item)
	{
		this.dispatchEvent({type:EVENT_FLOOR_CLICKED, item:item});
	}

	nothingIsClicked()
	{
		this.dispatchEvent({type:EVENT_NOTHING_CLICKED});
	}

	spin()
	{
		var scope = this;
		if (!scope.controls)
		{
			return;
		}
		scope.controls.autoRotate = scope.options.spin && !scope.mouseOver && !scope.hasClicked;
	}

	/**
	 * A PNG data URL of the current view.
	 *
	 * Restored in S5 rather than deprecated. It was silently unreliable: the
	 * renderer is built without `preserveDrawingBuffer`, so the drawing buffer is
	 * cleared as soon as a frame is presented, and any read that is not in the
	 * same task as a render comes back blank or stale. Whether it worked depended
	 * on when the caller happened to ask.
	 *
	 * Drawing a frame first, synchronously, makes it deterministic. The other
	 * option - `preserveDrawingBuffer: true` - taxes every frame of a viewer that
	 * runs continuously, to serve an API most embedders never call.
	 *
	 * @returns {string} `data:image/png;base64,...`
	 */
	dataUrl()
	{
		this.render(true);
		return this.renderer ? this.renderer.domElement.toDataURL('image/png') : '';
	}

	stopSpin()
	{
		this.hasClicked = true;
		if (this.controls) { this.controls.autoRotate = false; }
	}

	// Removed in RM-005 C2: `options()`, a method with the same name as the
	// field the constructor sets - the second of these found in this sprint,
	// after `Controller.selectedObject()`. An own property shadows a prototype
	// method, so it was unreachable, and its body returned that same field
	// rather than recursing. Nothing called it.
	//
	// It also typed `this.options` as a function for the whole file, which is
	// why `this.options.resize` and `options['spin']` read as errors in code
	// that works.

	getModel()
	{
		return this.model;
	}

	getScene()
	{
		return this.scene;
	}

	getController()
	{
		return this.controller;
	}

	getCamera()
	{
		return this.camera;
	}

	/**
	 * Drop the current 3D selection, dispatching EVENT_ITEM_UNSELECTED.
	 *
	 * Added in S6, for the same reason as Floorplanner2D.redraw(): the legacy
	 * demo cleared the selection with
	 * `three.getController().setSelectedObject(null)` (app.js:914) on every
	 * switch back to the 2D view, and the Vue app should not have to know that
	 * a Controller exists to do it.
	 *
	 * A no-op after dispose(), so a component's unmount path can call it without
	 * ordering itself against the teardown.
	 */
	clearSelection()
	{
		if (this.controller)
		{
			// `deselect`, not `setSelectedObject(null)`, for the reason
			// `showItemSelected` gives below: the second leaves the state machine
			// claiming a selection. E1 pointed that method at `deselect` and left
			// this one, which is the method the application actually calls - every
			// time it shows the plan pane (RM-010 G3).
			this.controller.deselect();
		}
	}

	/**
	 * Show an item as selected here because something else selected it
	 * (RM-008 E1, T-2).
	 *
	 * The 3D view's selection has only ever been set by picking in the 3D view:
	 * `Controller.mouseUpEvent` is the sole caller of `setSelectedObject` with
	 * anything but null. So selecting a chair on the plan lit it up on the plan,
	 * opened the inspector, and left the 3D view showing an unhighlighted chair -
	 * measured at zero changed pixels, which is the second half of what T-2
	 * found.
	 *
	 * `setSelectedObject` already does the right things in the right order - it
	 * unselects the previous item, moves the state machine out of UNSELECTED and
	 * dispatches EVENT_ITEM_SELECTED - so this is a named way in rather than new
	 * behaviour. The name says what it is for: `clearSelection` is its opposite
	 * and has been public since before the migration.
	 *
	 * @param {?Object} item An item from `Scene.getItems()`, or null to clear.
	 */
	showItemSelected(item)
	{
		if (!this.controller)
		{
			return;
		}
		if (this.controller.selectedObject === item)
		{
			return;
		}
		// Anything that is not an item this view can highlight clears the
		// selection instead of being handed to the controller.
		//
		// Not defensive padding: `useSelection` documents that an embedder may
		// dispatch EVENT_ITEM_SELECTED "with anything it likes", and it keeps
		// whatever it was given when the object carries no id. Two suites do
		// exactly that with a stub, and `setSelectedObject` calls `setSelected()`
		// on what it is passed - so without this the first selection in an
		// embedder's own test is a TypeError inside the library. Found by running
		// it, not by reading it.
		var selectable = item && typeof item.setSelected === 'function';
		if (selectable)
		{
			this.controller.setSelectedObject(item);
			return;
		}
		// `deselect`, not `setSelectedObject(null)`: the second clears the object
		// and leaves the state machine claiming a selection, which stops
		// `checkWallsAndFloors` running and makes every wall in this view
		// unclickable. See Controller.deselect.
		this.controller.deselect();
	}


	/*
	 * This method name conflicts with a variable so changing it to a different
	 * name needsUpdate() { this.needsUpdate = true; }
	 */

	ensureNeedsUpdate()
	{
		this.needsUpdate = true;
	}

	// Removed in RM-005 C2: `rotatePressed()` and `rotateReleased()`, which
	// called `this.controller.rotatePressed()` and `.rotateReleased()`.
	// `Controller` has neither method and never has - so both of these were a
	// TypeError waiting for a caller, and there is no caller anywhere in src or
	// tests. The checker named it the moment `controller` stopped being `any`:
	// "Property 'rotatePressed' does not exist on type 'Controller'".
	//
	// Deleted rather than implemented, because what they would DO is a design
	// question - the HUD already owns the rotate handle and drives rotation
	// through Controller's own state machine.

	setCursorStyle(cursorStyle)
	{
		if (this.domElement) { this.domElement.style.cursor = cursorStyle; }
	}

	/**
	 * Note that the viewer needs resizing, without resizing it here (P6).
	 *
	 * Called from the ResizeObserver, where writing to the canvas' style would
	 * provoke the loop notification. The measurement is deliberately not taken
	 * yet either: by the time the frame runs, layout has settled, so measuring
	 * then is if anything more accurate than measuring mid-observation.
	 */
	_deferResize()
	{
		this._resizePending = true;
	}

	/**
	 * Resize if the observer asked for one. Called once per animation frame.
	 *
	 * Outside `render()` on purpose: `render()` returns early while paused, and a
	 * pane that is resized while hidden and shown at the new size would otherwise
	 * come back at the old one.
	 */
	applyPendingResize()
	{
		if (!this._resizePending)
		{
			return;
		}
		this._resizePending = false;
		this.updateWindowSize();
	}

	updateWindowSize()
	{
		var scope = this;
		if (!scope.orthocamera || !scope.perspectivecamera || !scope.fpscamera || !scope.renderer)
		{
			return;
		}

		// Viewport-relative, so these line up with the clientX/clientY the
		// Controller normalizes against. jQuery's .offset() was document-relative
		// and silently wrong on a scrolled page.
		var box = elementBox(scope.element);
		scope.heightMargin = box.top;
		scope.widthMargin = box.left;

		// Container first; the viewport remainder only when the container has no
		// size of its own, which is what the jQuery code did unconditionally.
		var size = measureViewport(scope.element, window.innerWidth - box.left, window.innerHeight - box.top);
		scope.elementWidth = size.width;
		scope.elementHeight = size.height;

		scope.orthocamera.left = -scope.elementWidth / 1.0;
		scope.orthocamera.right = scope.elementWidth / 1.0;
		scope.orthocamera.top = scope.elementHeight / 1.0;
		scope.orthocamera.bottom = -scope.elementHeight / 1.0;
		scope.orthocamera.updateProjectionMatrix();

		scope.perspectivecamera.aspect = scope.elementWidth / scope.elementHeight;
		scope.perspectivecamera.updateProjectionMatrix();

		scope.fpscamera.aspect = scope.elementWidth / scope.elementHeight;
		scope.fpscamera.updateProjectionMatrix();

		// Render at the display's real resolution.
		//
		// This line was commented out for the life of the project, so the 3D view
		// has always been drawn at one device pixel per CSS pixel and upscaled -
		// visibly soft on any retina display, while the 2D floorplanner beside it
		// has been sharp since S2, which is where `pixelRatio()` comes from.
		// Sharing that helper matters for more than tidiness: it clamps at 4, so a
		// 3x or 5x display cannot quietly ask for 25 times the fragments, and it
		// answers 1 where there is no window at all.
		//
		// Set here rather than once at construction so it follows a window dragged
		// between displays of different density, which is the case a
		// construction-time call gets wrong.
		//
		// Costs fragments and nothing else: the shadow map is a fixed 1024 and
		// unaffected, and picking is normalised against CSS pixels, so nothing
		// downstream has to know. `setSize` must come after, because it is what
		// applies the ratio to the drawing buffer.
		scope.renderer.setPixelRatio(pixelRatio());
		scope.renderer.setSize(scope.elementWidth, scope.elementHeight);
		scope.needsUpdate = true;
	}

	/**
	 * Recentre the camera, but only when the plan it is framing actually moved
	 * (RM-003 A2, M-5).
	 *
	 * ## The finding
	 *
	 * This class subscribed to `EVENT_UPDATED` and called `centerCamera()` for
	 * every one, and `EVENT_UPDATED` is what a corner drag dispatches. So dragging
	 * a corner in the 2D view yanked the 3D camera back to the plan's centre on
	 * every pointermove - the most visible symptom of finding H-4, and the one a
	 * person notices without being told to look.
	 *
	 * ## The gate
	 *
	 * Topology only, and only on a real extent change. A drag is a `geometry`
	 * change and does not reach `centerCamera()` at all. A topology change that
	 * leaves the bounding box where it was - adding a corner inside the existing
	 * plan, splitting a wall - does reach here and is declined, which is the one
	 * intended behaviour change in this sprint. Opening a document moves the
	 * extent (usually from nothing to something) and still frames it.
	 *
	 * @param {?import('../core/change_set.js').ChangeSet} changes
	 */
	onModelChanged(changes)
	{
		if (changes && !changes.has(CHANGE_TOPOLOGY))
		{
			this._cameraStats.declined += 1;
			return;
		}
		var extent = this.planExtent();
		if (this._lastFramedExtent && sameExtent(this._lastFramedExtent, extent))
		{
			this._cameraStats.declined += 1;
			return;
		}
		this.centerCamera();
	}

	/**
	 * The bounding box the camera frames: where the plan is and how big it is.
	 * @returns {{center: Vector3, size: Vector3}}
	 */
	planExtent()
	{
		return {center: this.model.floorplan.getCenter(), size: this.model.floorplan.getSize()};
	}

	/**
	 * How often the camera has reframed and how often it has declined to
	 * (RM-003 A2). `recentred` is M-5's camera half: it must not move during a
	 * drag.
	 *
	 * @returns {{recentred: number, declined: number}}
	 */
	cameraStats()
	{
		return Object.assign({}, this._cameraStats);
	}

	centerCamera()
	{
		var scope = this;
		if (!scope.controls || !scope.camera)
		{
			return;
		}
		var yOffset = 150.0;
		var pan = scope.model.floorplan.getCenter();
		// Recorded before pan is mutated below - pan IS the centre, until the line
		// after next writes the camera's height into it.
		scope._lastFramedExtent = scope.planExtent();
		scope._cameraStats.recentred += 1;
		pan.y = yOffset;
		scope.controls.target = pan;
		var distance = scope.model.floorplan.getSize().z * 1.5;
		var offset = pan.clone().add(new Vector3(0, distance, distance));
		scope.camera.position.copy(offset);
		scope.controls.update();
	}

	// projects the object's center point into x,y screen coords
	// x,y are relative to top left corner of viewer
	projectVector(vec3, ignoreMargin)
	{
		var scope = this;
		ignoreMargin = ignoreMargin || false;
		if (!scope.camera)
		{
			return new Vector2();
		}
		// Null until the first resize measures the element; a projection asked for
		// before that gets the same answer the arithmetic already gave with null.
		var widthHalf = (scope.elementWidth || 0) / 2;
		var heightHalf = (scope.elementHeight || 0) / 2;
		var vector = new Vector3();
		vector.copy(vec3);
		vector.project(scope.camera);

		var vec2 = new Vector2();
		vec2.x = (vector.x * widthHalf) + widthHalf;
		vec2.y = - (vector.y * heightHalf) + heightHalf;
		if (!ignoreMargin)
		{
			vec2.x += (scope.widthMargin || 0);
			vec2.y += (scope.heightMargin || 0);
		}
		return vec2;
	}

	sceneGraph(obj)
	{
		console.group( ' <%o> ' + obj.name, obj );
		obj.children.forEach( this.sceneGraph );
		console.groupEnd();
	}

	/**
	 * Build, drop and re-place the storeys' 3D projections (RM-010 G1).
	 *
	 * Reconciliation rather than a rebuild, for the same reason `Floorplan3D`
	 * reconciles rather than redrawing: switching to the first floor must not
	 * tear down and re-upload the ground floor's walls. A level that is already
	 * projected keeps its projection; only additions are built and only removals
	 * are disposed.
	 *
	 * Each subscription is per storey too. A wall drawn on the first floor has to
	 * redraw the first floor even while the ground floor is the one being edited,
	 * and a `Floorplan` can only tell you that *it* changed.
	 *
	 * @returns {void}
	 */
	/**
	 * The 3D projection of the storey being edited (RM-010 G1).
	 *
	 * The same move `Model.floorplan` makes one layer down, and for the same
	 * reason: this used to be a field, every caller reads it, and none of them
	 * has an opinion about storeys. Null before `init()` builds anything, which
	 * is what the field was.
	 *
	 * @returns {?Floorplan3D}
	 */
	get floorplan()
	{
		var level = this.model && this.model.level;
		return (level && this.levelViews.get(level.id)) || null;
	}

	syncLevelViews()
	{
		var scope = this;
		var wanted = new Set();
		this.model.levels.forEach(function (level)
		{
			wanted.add(level.id);
			if (!scope.levelViews.has(level.id))
			{
				var view = new Floorplan3D(
					scope.scene.levelScene(level), level.floorplan, scope.controls, scope.renderProfile);
				// Caught up once, on construction. `Floorplan3D` only subscribes -
				// it builds when a change arrives - which was right when there was
				// one of them built before anything was loaded. A storey's view is
				// created when its storey appears, which is after its plan already
				// has walls in it, and without this the upper floors were empty.
				// Measured: three storeys loaded, levels 1 and 2 had no meshes at all.
				view.redraw();
				scope.levelViews.set(level.id, view);
			}
			if (!scope._watchedPlans.has(level.floorplan))
			{
				level.floorplan.addEventListener(EVENT_CHANGESET, scope.updatedevent);
				level.floorplan.addEventListener(EVENT_ITEMS_PROJECTED, scope.itemsprojectedevent);
				scope._watchedPlans.add(level.floorplan);
			}
		});
		this.levelViews.forEach(function (view, id)
		{
			if (!wanted.has(id))
			{
				view.dispose();
				scope.levelViews.delete(id);
			}
		});
		// A plan whose level is gone must stop being listened to, or a disposed
		// document keeps this view alive - the class of leak RM-003 A0 and A1 both
		// spent sprints on.
		var livePlans = new Set(this.model.levels.map(function (level) {return level.floorplan;}));
		this._watchedPlans.forEach(function (plan)
		{
			if (!livePlans.has(plan))
			{
				plan.removeEventListener(EVENT_CHANGESET, scope.updatedevent);
				plan.removeEventListener(EVENT_ITEMS_PROJECTED, scope.itemsprojectedevent);
				scope._watchedPlans.delete(plan);
			}
		});
		// With the mode the view is in, not unconditionally: switching storey while
		// showing one at a time has to move which one is shown (G3).
		this.scene.syncLevels({activeOnly: !this._allStoreys});
		this.syncRoof();
		this.syncSun();
	}

	/**
	 * Point the key light at wherever the building's sun is (RM-011 H2).
	 *
	 * Here rather than in `Lights` because a sun belongs to the building and
	 * `Lights` is handed a `Floorplan` - one storey's plan. `Main` is the object
	 * that has both, which makes it the seam, and it keeps the model free of any
	 * knowledge that a renderer exists.
	 *
	 * @returns {void}
	 */
	syncSun()
	{
		if (this.lights)
		{
			this.lights.setSun(this.model.sun, this.model.north);
		}
	}

	/**
	 * Build, replace or remove the building's roof (RM-010 G2).
	 *
	 * Not a `Floorplan3D` and not in a level's group: a roof is over the whole
	 * building rather than on one storey, so it goes into the scene at the height
	 * `Model.roofBase()` derives. Rebuilt rather than reconciled, because it is
	 * one mesh from five numbers and reconciling it would cost more code than
	 * regenerating it.
	 *
	 * @returns {void}
	 */
	syncRoof()
	{
		if (this._roofMesh)
		{
			this.scene.remove(this._roofMesh);
			disposeObject(this._roofMesh);
			this._roofMesh = null;
		}
		var roof = this.model.roof;
		var footprint = this.model.roofFootprint();
		if (!roof || !footprint)
		{
			return;
		}
		var built = buildRoofGeometry(roof, footprint);
		this._roofMesh = new Mesh(built.geometry, built.materials[0]);
		this._roofMesh.name = 'roof';
		// Rebuilt from scratch every time, so the visibility the storey mode
		// decided has to be re-applied rather than assumed (G3).
		this._roofMesh.visible = this._allStoreys;
		this._roofMesh.position.set(footprint.cx, this.model.roofBase(), footprint.cy);
		this._roofMesh.castShadow = true;
		this.scene.add(this._roofMesh);
	}

	switchWireframe(flag)
	{
		this.model.switchWireframe(flag);
		if (!this.levelViews.size)
		{
			return;
		}
		// Every storey, not just the one being edited: wireframe is a way of
		// looking at the whole model.
		this.levelViews.forEach((view) => {view.switchWireframe(flag);});
		this.render(true);
	}

	pauseTheRendering(flag)
	{
		this.pauseRender = flag;
	}

	switchView(viewpoint)
	{
		// Null before init() and after dispose(), which is the whole of every guard
		// in this file: a viewer that has not been built has nothing to do here, and
		// one that has been torn down must not resurrect anything (RM-005 C2).
		if (!this.camera || !this.controls)
		{
			return;
		}
		// The one viewpoint that is about the building rather than about the
		// storey being edited, so it frames its own subject and returns (G3).
		if (viewpoint === VIEW_EXTERIOR)
		{
			this.showExterior();
			return;
		}
		var center = this.model.floorplan.getCenter();
		var size = this.model.floorplan.getSize();
		var distance = this.controls.object.position.distanceTo(this.controls.target);
		this.controls.target.copy(center);

		switch(viewpoint)
		{
		case VIEW_TOP:
			center.y = 1000;
			this.dispatchEvent({type:EVENT_CAMERA_VIEW_CHANGE, view: VIEW_TOP});
			break;
		case VIEW_FRONT:
			center.z = center.z - (size.z*0.5) - distance;
			this.dispatchEvent({type:EVENT_CAMERA_VIEW_CHANGE, view: VIEW_FRONT});
			break;
		case VIEW_RIGHT:
			center.x = center.x + (size.x*0.5) + distance;
			this.dispatchEvent({type:EVENT_CAMERA_VIEW_CHANGE, view: VIEW_RIGHT});
			break;
		case VIEW_LEFT:
			center.x = center.x - (size.x*0.5) - distance;
			this.dispatchEvent({type:EVENT_CAMERA_VIEW_CHANGE, view: VIEW_LEFT});
			break;
		case VIEW_ISOMETRY:
		default:
			center.x += distance;
			center.y += distance;
			center.z += distance;
			this.dispatchEvent({type:EVENT_CAMERA_VIEW_CHANGE, view: VIEW_ISOMETRY});
		}
		this.camera.position.copy(center);
		this.controls.signalCameraActive();
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	/**
	 * Show every storey, or only the one being edited (RM-010 G3).
	 *
	 * The affordance G1 built and did not connect. What it is *for* is picking:
	 * `Controller.updateIntersections` raycasts `Scene.getItems()`, which is the
	 * active storey's furniture, and `checkWallsAndFloors` asks the active
	 * storey's plan for its walls and floors - so with every storey drawn, the
	 * first floor's walls are visible and inert, and a click aimed at one lands
	 * on whatever the ground floor has behind it. Showing one storey at a time
	 * makes what you see and what you can click the same set.
	 *
	 * The roof follows, and that is the one derived consequence rather than a
	 * second switch: a roof over a single visible storey is a lid on a box you
	 * are looking into. A design with no roof has nothing to follow.
	 *
	 * @param {boolean} flag True for the whole building, false for one storey.
	 * @returns {void}
	 */
	showStoreys(flag)
	{
		this._allStoreys = flag !== false;
		this.scene.syncLevels({activeOnly: !this._allStoreys});
		if (this._roofMesh)
		{
			this._roofMesh.visible = this._allStoreys;
		}
		this.render(true);
	}

	/**
	 * Frame the whole building from outside (RM-010 G3).
	 *
	 * RM-007 costed "an exterior view" inside G2 and named nothing else about it;
	 * what it turns out to be, once there are storeys and a roof to look at, is
	 * three things that have to happen together. Every storey is shown, because
	 * the outside of a house is not the outside of its ground floor. The roof
	 * comes with them. And the camera is placed against `Model.buildingBounds()`
	 * rather than against the plan being edited, which is the difference between
	 * framing a building and framing a footprint.
	 *
	 * The distance is derived from the camera's own field of view and aspect, so
	 * the whole box fits whatever shape the viewport is - a wide viewer is
	 * limited by height and a tall one by width, and taking the larger of the two
	 * is what covers both. Isometric rather than square-on, because a single
	 * elevation of a building tells you less than a corner of it does.
	 *
	 * @returns {void}
	 */
	showExterior()
	{
		if (!this.camera || !this.controls)
		{
			return;
		}
		this.showStoreys(true);
		var bounds = this.model.buildingBounds();
		if (!bounds)
		{
			return;
		}
		var target = new Vector3(bounds.cx, bounds.height / 2, bounds.cy);
		// Half the diagonal of the box, which is the radius of the sphere that
		// contains it however the camera is turned.
		var radius = 0.5 * Math.sqrt(
			(bounds.width * bounds.width) + (bounds.depth * bounds.depth)
			+ (bounds.height * bounds.height));
		// Read off the perspective camera rather than off `this.camera`, which may
		// be the orthographic one: a field of view is what turns a radius into a
		// distance, and an orthographic camera has none. It frames by zoom
		// instead, which `switchOrthographicMode` owns; the position below is
		// still the right position for it.
		var lens = this.perspectivecamera;
		var fov = ((lens && lens.fov) || 45) * Math.PI / 180;
		var aspect = (lens && lens.aspect) || 1;
		var vertical = radius / Math.sin(fov / 2);
		var horizontal = radius / Math.sin((2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2);
		// A tenth of clear air, so the building is framed rather than touching
		// the edges of the viewport.
		var distance = Math.max(vertical, horizontal) * 1.1;
		var direction = new Vector3(1, 0.6, 1).normalize();
		this.controls.target.copy(target);
		this.camera.position.copy(target.clone().add(direction.multiplyScalar(distance)));
		this.controls.signalCameraActive();
		this.controls.needsUpdate = true;
		this.controls.update();
		this.dispatchEvent({type: EVENT_CAMERA_VIEW_CHANGE, view: VIEW_EXTERIOR});
		this.render(true);
	}

	lockView(locked)
	{
		if (this.controls) { this.controls.enableRotate = locked; }
		this.render(true);
	}

	// Send in a value between -1 to 1
	changeClippingPlanes(clipRatio, clipRatio2)
	{
		if (!this.renderer || !this.controls)
		{
			return;
		}
		var size = this.model.floorplan.getSize();
		size.z = size.z + (size.z * 0.25);
		size.z = size.z * 0.5;
		this.clippingPlaneActive.constant = (this.model.floorplan.getSize().z * clipRatio);
		this.clippingPlaneActive2.constant = (this.model.floorplan.getSize().z * clipRatio2);

		if(!this.clippingEnabled)
		{
			this.clippingEnabled = true;
			this.renderer.clippingPlanes = this.globalClippingPlane;
		}
		this.controls.signalCameraActive();
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	resetClipping()
	{
		this.clippingEnabled = false;
		if (!this.renderer || !this.controls)
		{
			return;
		}
		// `clippingEmpty` is a frozen shared constant and `clippingPlanes` is
		// mutable, so it is copied rather than aliased - which is what the reader
		// would want anyway: nothing should be able to push a plane into the
		// empty sentinel (RM-005 C2).
		this.renderer.clippingPlanes = this.clippingEmpty.slice();
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	switchOrthographicMode(flag)
	{
		if (!this.camera || !this.controls || !this.controller || !this.orthocamera || !this.perspectivecamera)
		{
			return;
		}
		if(flag)
		{
			this.camera = this.orthocamera;
			this.camera.position.copy(this.perspectivecamera.position.clone());
			this.controls.object = this.camera;
			this.controller.changeCamera(this.camera);
			this.controls.needsUpdate = true;
			this.controls.update();
			this.render(true);
			return;
		}

		this.camera = this.perspectivecamera;
		this.camera.position.copy(this.orthocamera.position.clone());
		this.controls.object = this.camera;
		this.controller.changeCamera(this.camera);
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	switchFPSMode(flag)
	{
		if (!this.fpscontrols || !this.controls || !this.controller || !this.skybox || !this.levelViews.size)
		{
			return;
		}
		this.firstpersonmode = flag;
		this.fpscontrols.enabled = flag;
		this.controls.enabled = !flag;
		this.controller.enabled = !flag;
		this.controls.signalCameraActive();

		if(flag)
		{
			this.skybox.toggleEnvironment(true);
			this.fpscontrols.lock();
		}
		else
		{
			this.skybox.toggleEnvironment(false);
			this.fpscontrols.unlock();
		}

		this.model.switchWireframe(false);
		this.levelViews.forEach((view) => {view.switchWireframe(false);});
		this.render(true);
	}

	shouldRender()
	{
		var scope = this;
		if (!scope.controls || !scope.controller)
		{
			return false;
		}
		// Do we need to draw a new frame
		if (scope.controls.needsUpdate || scope.controller.needsUpdate || scope.needsUpdate || scope.model.scene.needsUpdate)
		{
			scope.controls.needsUpdate = false;
			scope.controller.needsUpdate = false;
			scope.needsUpdate = false;
			scope.model.scene.needsUpdate = false;
			return true;
		}
		else
		{
			return false;
		}
	}

	rendervr()
	{

	}

	render(forced)
	{
		var scope = this;
		forced = (forced)? forced : false;
		if (!scope.renderer || !scope.camera)
		{
			return;
		}
		if(this.pauseRender && !forced)
		{
			return;
		}

		scope.spin();
		if(scope.firstpersonmode)
		{
			// No argument: the controls keep their own clock now. THREE.Clock was
			// deprecated in r183 in favour of a Timer that 0.185.1 does not ship.
			if (scope.fpscontrols && scope.fpscamera)
			{
				scope.fpscontrols.update();
				scope.renderer.render(scope.scene.getScene(), scope.fpscamera);
			}

		}
		else
		{
			if(this.shouldRender() || forced)
			{
				scope.renderer.render(scope.scene.getScene(), scope.camera);
			}
		}
		scope.lastRender = Date.now();
	}
}
