// @ts-check
import {EventDispatcher, Vector2, Vector3, WebGLRenderer, PerspectiveCamera, OrthographicCamera} from 'three';
import {ColorManagement, SRGBColorSpace} from 'three';
import {Plane} from 'three';
import {PCFSoftShadowMap, ACESFilmicToneMapping, NoToneMapping, PMREMGenerator} from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {PointerLockControls} from './pointerlockcontrols.js';
import {describeFrom} from '../core/texture_formats.js';

import {EVENT_CHANGESET, EVENT_WALL_CLICKED, EVENT_NOTHING_CLICKED, EVENT_FLOOR_CLICKED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_GLTF_READY} from '../core/events.js';
import {CHANGE_TOPOLOGY} from '../core/change_set.js';
import {EVENT_FPS_EXIT, EVENT_CAMERA_VIEW_CHANGE} from '../core/events.js';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from '../core/constants.js';
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

		/** @type {?Floorplan3D} The 3D projection of the plan, built by init(). */
		this.floorplan = null;

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
		renderer.shadowMapSoft = true;
		renderer.shadowMap.type = PCFSoftShadowMap;
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
		}

		if (this.floorplan)
		{
			this.floorplan.redraw();
		}

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

		scope.model.floorplan.addEventListener(EVENT_CHANGESET, this.updatedevent);
		scope.model.addEventListener(EVENT_GLTF_READY, this.gltfreadyevent);

		scope.lights = new Lights(scope.scene, scope.model.floorplan, scope.renderProfile);
		scope.floorplan = new Floorplan3D(scope.scene, scope.model.floorplan, scope.controls, scope.renderProfile);

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

		this.model.floorplan.removeEventListener(EVENT_CHANGESET, this.updatedevent);
		this.model.removeEventListener(EVENT_GLTF_READY, this.gltfreadyevent);

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
		if (this.floorplan)
		{
			this.floorplan.dispose();
			this.floorplan = null;
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
			this.controller.setSelectedObject(null);
		}
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

	switchWireframe(flag)
	{
		this.model.switchWireframe(flag);
		if (!this.floorplan)
		{
			return;
		}
		this.floorplan.switchWireframe(flag);
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
		if (!this.fpscontrols || !this.controls || !this.controller || !this.skybox || !this.floorplan)
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
		this.floorplan.switchWireframe(false);
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
