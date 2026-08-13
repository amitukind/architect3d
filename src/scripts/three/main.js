import {EventDispatcher, Vector2, Vector3, WebGLRenderer, PerspectiveCamera, OrthographicCamera} from 'three';
import {ColorManagement, SRGBColorSpace} from 'three';
import {Plane} from 'three';
import {PCFSoftShadowMap} from 'three';
// import {FirstPersonControls} from './first-person-controls.js';
import {PointerLockControls} from './pointerlockcontrols.js';

import {EVENT_UPDATED, EVENT_WALL_CLICKED, EVENT_NOTHING_CLICKED, EVENT_FLOOR_CLICKED, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_GLTF_READY} from '../core/events.js';
import {EVENT_CAMERA_ACTIVE_STATUS, EVENT_FPS_EXIT, EVENT_CAMERA_VIEW_CHANGE} from '../core/events.js';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from '../core/constants.js';
import {resolveElement, elementBox, measureViewport} from '../core/dom.js';

import {OrbitControls} from './orbitcontrols.js';

// import {Controls} from './controls.js';
import {Controller} from './controller.js';
import {HUD} from './hud.js';
import {Floorplan3D} from './floorPlan.js';
import {Lights} from './lights.js';
import {Skybox} from './skybox.js';

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

export class Main extends EventDispatcher
{
	/**
	 * @param {Model} model
	 * @param {(HTMLElement|string)} element The container to render into, or its
	 * element id / CSS selector. The string form is the deprecated back-compat
	 * path.
	 * @param {string} canvasElement Unused; kept for signature compatibility.
	 * @param {Object} opts
	 */
	constructor(model, element, canvasElement, opts)
	{
		super();
		var options = {resize: true,pushHref: false,spin: true,spinSpeed: .00002,clickPan: true,canMoveFixedItems: false};
		for (var opt in options)
		{
			if (options.hasOwnProperty(opt) && opts.hasOwnProperty(opt))
			{
				options[opt] = opts[opt];
			}
		}

		this.pauseRender = true;
		this.model = model;
		this.scene = model.scene;
		this.element = resolveElement(element, '3D viewer container');
		this.canvasElement = canvasElement;
		this.options = options;
		this._disposed = false;

		this.domElement = null;
		this.orthocamera = null;
		this.perspectivecamera = null;
		this.camera = null;
		this.savedcameraposition = null;
		this.fpscamera = null;

		this.cameraNear = 10;
		this.cameraFar = 10000;

		this.controls = null;
		this.fpscontrols = null;
		this.firstpersonmode = false;

		this.renderer = null;
		this.controller = null;

		this.needsUpdate = false;
		this.lastRender = Date.now();

		this.mouseOver = false;
		this.hasClicked = false;

		this.hud = null;

		this.heightMargin = null;
		this.widthMargin = null;
		this.elementHeight = null;
		this.elementWidth = null;

		// Removed in S2: five $.Callbacks lists (itemSelected / itemUnselected /
		// wallClicked / floorClicked / nothingClicked). Every .fire() and .add()
		// against them was already commented out - the EventDispatcher events
		// dispatched by itemIsSelected() and friends replaced them - so they were
		// jQuery's last foothold in this file and nothing but dead weight.

		this.floorplan = null;

		var scope = this;
		this.updatedevent = ()=>{scope.centerCamera();};
		this.gltfreadyevent = (o)=>{scope.gltfReady(o);};

		this.clippingPlaneActive = new Plane(new Vector3(0, 0, 1), 0.0);
		this.clippingPlaneActive2 = new Plane(new Vector3(0, 0, -1), 0.0);
		this.globalClippingPlane = [this.clippingPlaneActive, this.clippingPlaneActive2];
		this.clippingEmpty = Object.freeze([]);
		this.clippingEnabled = false;

//		console.log('THIS ON MOBILE DEVICE ::: ', isMobile, isTablet);

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
// scope.renderer = new WebGLRenderer({antialias: true, preserveDrawingBuffer:
// true, alpha:true}); // preserveDrawingBuffer:true - required to support
// .toDataURL()
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

// scope.renderer.autoClear = false;
		renderer.shadowMap.enabled = true;
		renderer.shadowMapSoft = true;
		renderer.shadowMap.type = PCFSoftShadowMap;
		renderer.setClearColor( 0xFFFFFF, 1 );
		renderer.clippingPlanes = this.clippingEmpty;
		renderer.localClippingEnabled = false;
//		renderer.setPixelRatio(window.devicePixelRatio);
// renderer.sortObjects = false;

		return renderer;
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

		scope.domElement = scope.element;

		scope.fpscamera = new PerspectiveCamera(60, 1, 1, 10000 );
		scope.perspectivecamera = new PerspectiveCamera(45, 10, scope.cameraNear, scope.cameraFar);
		scope.orthocamera = new OrthographicCamera(orthoWidth / -orthoScale, orthoWidth /orthoScale, orthoHeight /orthoScale, orthoHeight / -orthoScale, scope.cameraNear, scope.cameraFar);

		scope.camera = scope.perspectivecamera;
// scope.camera = scope.orthocamera;

		scope.renderer = scope.getARenderer();
		scope.domElement.appendChild(scope.renderer.domElement);

		scope.skybox = new Skybox(scope.scene, scope.renderer);

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
		this.fpscontrols.getObject().position.set(0, 200, 0);

		this._fpsUnlockEvent = function(){
			scope.switchFPSMode(false);
			scope.dispatchEvent({type:EVENT_FPS_EXIT});
		};
		this.fpscontrols.addEventListener('unlock', this._fpsUnlockEvent);


		scope.hud = new HUD(scope, scope.scene);
		scope.controller = new Controller(scope, scope.model, scope.camera, scope.element, scope.controls, scope.hud);

		// handle window resizing
		scope.updateWindowSize();

		// Container-driven, with the window listener kept as the fallback for a
		// container that has no layout size of its own (see core/dom.js).
		this._resizeEvent = () => {scope.updateWindowSize();};
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

		scope.model.floorplan.addEventListener(EVENT_UPDATED, this.updatedevent);
		scope.model.addEventListener(EVENT_GLTF_READY, this.gltfreadyevent);

		scope.lights = new Lights(scope.scene, scope.model.floorplan);
		scope.floorplan = new Floorplan3D(scope.scene, scope.model.floorplan, scope.controls);

		function animate()
		{
			scope.renderer.setAnimationLoop(function(){scope.render();});
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
		window.removeEventListener('resize', this._resizeEvent);

		this.element.removeEventListener('mouseenter', this._mouseEnterEvent);
		this.element.removeEventListener('mouseleave', this._mouseLeaveEvent);
		this.element.removeEventListener('click', this._clickEvent);

		this.model.floorplan.removeEventListener(EVENT_UPDATED, this.updatedevent);
		this.model.removeEventListener(EVENT_GLTF_READY, this.gltfreadyevent);

		if (this.controller)
		{
			this.controller.dispose();
		}
		if (this.fpscontrols)
		{
			this.fpscontrols.removeEventListener('unlock', this._fpsUnlockEvent);
			this.scene.remove(this.fpscontrols.getObject());
			this.fpscontrols.dispose();
		}
		if (this.controls)
		{
			this.controls.dispose();
		}
		if (this.skybox)
		{
			this.skybox.dispose();
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
	}
	exportForBlender()
	{
		this.skybox.setEnabled(false);
		this.controller.showGroundPlane(false);
		this.model.exportForBlender();
	}

	gltfReady(o)
	{
		this.dispatchEvent({type:EVENT_GLTF_READY, item: this, gltf: o.gltf});
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
		return this.renderer.domElement.toDataURL('image/png');
	}

	stopSpin()
	{
		this.hasClicked = true;
		this.controls.autoRotate = false;
	}

	options()
	{
		return this.options;
	}

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

	rotatePressed()
	{
		this.controller.rotatePressed();
	}

	rotateReleased()
	{
		this.controller.rotateReleased();
	}

	setCursorStyle(cursorStyle)
	{
		this.domElement.style.cursor = cursorStyle;
	}

	updateWindowSize()
	{
		var scope = this;

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

		scope.renderer.setSize(scope.elementWidth, scope.elementHeight);
		scope.needsUpdate = true;
	}

	centerCamera()
	{
		var scope = this;
		var yOffset = 150.0;
		var pan = scope.model.floorplan.getCenter();
		pan.y = yOffset;
		scope.controls.target = pan;
		var distance = scope.model.floorplan.getSize().z * 1.5;
		var offset = pan.clone().add(new Vector3(0, distance, distance));
		// scope.controls.setOffset(offset);
		scope.camera.position.copy(offset);
		scope.controls.update();
	}

	// projects the object's center point into x,y screen coords
	// x,y are relative to top left corner of viewer
	projectVector(vec3, ignoreMargin)
	{
		var scope = this;
		ignoreMargin = ignoreMargin || false;
		var widthHalf = scope.elementWidth / 2;
		var heightHalf = scope.elementHeight / 2;
		var vector = new Vector3();
		vector.copy(vec3);
		vector.project(scope.camera);

		var vec2 = new Vector2();
		vec2.x = (vector.x * widthHalf) + widthHalf;
		vec2.y = - (vector.y * heightHalf) + heightHalf;
		if (!ignoreMargin)
		{
			vec2.x += scope.widthMargin;
			vec2.y += scope.heightMargin;
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
		this.floorplan.switchWireframe(flag);
		this.render(true);
	}

	pauseTheRendering(flag)
	{
		this.pauseRender = flag;
	}

	switchView(viewpoint)
	{
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
		this.controls.dispatchEvent({type:EVENT_CAMERA_ACTIVE_STATUS});
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	lockView(locked)
	{
		this.controls.enableRotate = locked;
		this.render(true);
	}

	// Send in a value between -1 to 1
	changeClippingPlanes(clipRatio, clipRatio2)
	{
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
		this.controls.dispatchEvent({type:EVENT_CAMERA_ACTIVE_STATUS});
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	resetClipping()
	{
		this.clippingEnabled = false;
		this.renderer.clippingPlanes = this.clippingEmpty;
		this.controls.needsUpdate = true;
		this.controls.update();
		this.render(true);
	}

	switchOrthographicMode(flag)
	{
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
		this.firstpersonmode = flag;
		this.fpscontrols.enabled = flag;
		this.controls.enabled = !flag;
		this.controller.enabled = !flag;
		this.controls.dispatchEvent({type:EVENT_CAMERA_ACTIVE_STATUS});

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
		if(this.pauseRender && !forced)
		{
			return;
		}

		scope.spin();
		if(scope.firstpersonmode)
		{
			// No argument: the controls keep their own clock now. THREE.Clock was
			// deprecated in r183 in favour of a Timer that 0.185.1 does not ship.
			scope.fpscontrols.update();
			scope.renderer.render(scope.scene.getScene(), scope.fpscamera);

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
