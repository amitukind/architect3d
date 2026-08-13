// @vitest-environment jsdom
/**
 * Sprint S2: the 3D viewer as a mountable, unmountable component.
 *
 * The point of the sprint is that BlueprintJS can be created and destroyed
 * repeatedly without leaking DOM listeners or WebGL contexts - the prerequisite
 * for hosting it inside a Vue component in S6. These tests prove that headlessly
 * by injecting a fake renderer through Main.setRendererFactory, the same kind of
 * enabling seam S0 added for Math.random and the item loader.
 *
 * What is *not* covered here, and is checked in a browser instead (see
 * tools/lifecycle-smoke.html): that the real WebGLRenderer releases its context.
 * A fake renderer can only prove dispose() and forceContextLoss() were called.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {Main} from '../src/scripts/three/main.js';
import {Lights} from '../src/scripts/three/lights.js';
import {PointerLockControls} from '../src/scripts/three/pointerlockcontrols.js';
import {Model} from '../src/scripts/model/model.js';
import {BlueprintJS} from '../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {EVENT_CAMERA_MOVED, EVENT_CAMERA_ACTIVE_STATUS} from '../src/scripts/core/events.js';
import {VIEW_TOP} from '../src/scripts/core/constants.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
// Shared with the S6 application suites - see tests/helpers/renderer.js.
import {createRendererStub} from './helpers/renderer.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

let canvasStub;
let observer;
let pointerApis;
let listeners;
/** Every fake renderer handed out, so a test can check they were all disposed. */
let renderers;

function readFixture(name)
{
	return readFileSync(join(FIXTURE_DIR, `${name}.blueprint3d`), 'utf8');
}

/**
 * Listener leaks that belong to this library, not to three.
 *
 * three's ImageLoader attaches load/error handlers to an Image and removes them
 * when the decode settles. jsdom never loads a texture, so those handlers sit
 * there for the lifetime of the test - an artefact of the environment, on
 * objects the library never sees. Everything else is ours.
 */
function ourLeaks()
{
	return listeners.leaks().filter(({target}) => !(target instanceof window.HTMLImageElement));
}

/** The demo's DOM: a viewer container and, optionally, a floorplanner canvas. */
function buildViewerDom({left = 0, top = 0, width = VIEWPORT_WIDTH, height = VIEWPORT_HEIGHT} = {})
{
	const viewer = document.createElement('div');
	viewer.id = 'viewer';
	document.body.appendChild(viewer);
	setLayout(viewer, {left, top, width, height});

	const wrapper = document.createElement('div');
	wrapper.id = 'floorplanner';
	const canvas = document.createElement('canvas');
	canvas.id = 'floorplanner-canvas';
	wrapper.appendChild(canvas);
	document.body.appendChild(wrapper);
	setLayout(wrapper, {left: 0, top: 0, width, height});
	setLayout(canvas, {left: 0, top: 0, width, height});

	return {viewer, canvas};
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = VIEWPORT_WIDTH;
	window.innerHeight = VIEWPORT_HEIGHT;

	renderers = [];
	listeners = installListenerCounter(window);
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);

	Main.setRendererFactory(() => createRendererStub(renderers));
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	listeners.restore();
	document.body.innerHTML = '';
});

describe('Main mounting', () =>
{
	it('accepts an element, and still accepts the deprecated selector string', () =>
	{
		const {viewer} = buildViewerDom();

		const byElement = new Main(new Model(), viewer, 'three-canvas', {});
		expect(byElement.element).toBe(viewer);
		expect(byElement.domElement).toBe(viewer);
		byElement.dispose();

		// app.js has passed '#viewer' since the jQuery days.
		const bySelector = new Main(new Model(), '#viewer', 'three-canvas', {});
		expect(bySelector.element).toBe(viewer);
		bySelector.dispose();
	});

	it('puts the renderer canvas inside the container and takes it out again', () =>
	{
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(three.renderer.domElement.parentNode).toBe(viewer);
		three.dispose();
		expect(three.renderer.domElement.parentNode).toBe(null);
	});

	it('measures the container rather than the window', () =>
	{
		const {viewer} = buildViewerDom({left: 200, top: 120, width: 640, height: 400});
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(three.widthMargin).toBe(200);
		expect(three.heightMargin).toBe(120);
		expect(three.elementWidth).toBe(640);
		expect(three.elementHeight).toBe(400);
		expect(three.renderer.size).toEqual({width: 640, height: 400});
		three.dispose();
	});

	it('falls back to the viewport remainder when the container has no size', () =>
	{
		// The legacy demo: jquery.flip stamps height:100% on #viewer, whose wrapper
		// has collapsed, so only the width survives measurement.
		const {viewer} = buildViewerDom({left: 0, top: 0, width: VIEWPORT_WIDTH, height: 0});
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(three.elementWidth).toBe(VIEWPORT_WIDTH);
		expect(three.elementHeight).toBe(VIEWPORT_HEIGHT);
		three.dispose();
	});

	it('renders at the display density, clamped', () =>
	{
		// Commented out for the life of the project until S8, so the 3D view was
		// always drawn at one device pixel per CSS pixel and upscaled - soft on
		// any retina display, next to a 2D canvas that has been sharp since S2.
		// Shares that sprint's pixelRatio() helper, which clamps at 4 so a very
		// dense display cannot ask for an absurd number of fragments.
		const {viewer} = buildViewerDom();
		window.devicePixelRatio = 2;
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(three.renderer.pixelRatio).toBe(2);
		// setSize still takes CSS pixels; the ratio is what scales the buffer.
		expect(three.renderer.size).toEqual({width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT});

		window.devicePixelRatio = 8;
		three.updateWindowSize();
		expect(three.renderer.pixelRatio).toBe(4);

		window.devicePixelRatio = 1;
		three.dispose();
	});

	it('resizes when the container resizes, not only when the window does', () =>
	{
		const {viewer} = buildViewerDom({width: 640, height: 400});
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(observer.liveCount()).toBe(1);
		setLayout(viewer, {left: 0, top: 0, width: 900, height: 500});
		observer.trigger();

		expect(three.elementWidth).toBe(900);
		expect(three.renderer.size).toEqual({width: 900, height: 500});
		three.dispose();
	});

	it('drives the orthographic frustum from the container too', () =>
	{
		const {viewer} = buildViewerDom({width: 640, height: 400});
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		expect(three.orthocamera.right).toBe(640);
		expect(three.orthocamera.left).toBe(-640);
		expect(three.orthocamera.top).toBe(400);
		expect(three.orthocamera.bottom).toBe(-400);
		three.dispose();
	});
});

describe('Controller picking', () =>
{
	it('normalizes pointer coordinates against the viewer, not the window', () =>
	{
		// Pre-S2 this divided by (window.innerWidth - widthMargin), so picking
		// drifted for any embedder that did not own the bottom-right of the page.
		const {viewer} = buildViewerDom({left: 200, top: 100, width: 400, height: 200});
		const three = new Main(new Model(), viewer, 'three-canvas', {});
		const controller = three.getController();

		// Centre of the viewer in viewport coordinates.
		const centre = controller.normalizeVector2(new THREE.Vector2(400, 200));
		expect(centre.x).toBeCloseTo(0, 9);
		expect(centre.y).toBeCloseTo(0, 9);

		// Bottom-right corner maps to (1, -1) regardless of how big the page is.
		const corner = controller.normalizeVector2(new THREE.Vector2(600, 300));
		expect(corner.x).toBeCloseTo(1, 9);
		expect(corner.y).toBeCloseTo(-1, 9);
		three.dispose();
	});

	it('leaves the compatibility mouse events alone, so orbitcontrols still gets them', () =>
	{
		// orbitcontrols.js is still mouse/touch-event driven. Canceling a pointer
		// event while the pointer is down suppresses the compatibility mouse
		// events, so preventDefault() here is restricted to touch and pen - which
		// is exactly what the old touchstart handler did anyway.
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		const withMouse = new window.PointerEvent('pointerdown', {clientX: 10, clientY: 10, pointerType: 'mouse', bubbles: true, cancelable: true});
		viewer.dispatchEvent(withMouse);
		expect(withMouse.defaultPrevented).toBe(false);

		const withTouch = new window.PointerEvent('pointerdown', {clientX: 10, clientY: 10, pointerType: 'touch', bubbles: true, cancelable: true});
		viewer.dispatchEvent(withTouch);
		expect(withTouch.defaultPrevented).toBe(true);

		three.dispose();
	});

	it('suppresses text selection declaratively, and puts the style back', () =>
	{
		const {viewer} = buildViewerDom();
		viewer.style.userSelect = 'text';

		const three = new Main(new Model(), viewer, 'three-canvas', {});
		expect(viewer.style.userSelect).toBe('none');

		three.dispose();
		expect(viewer.style.userSelect).toBe('text');
	});

	it('registers its pointer listeners non-passive, including pointercancel', () =>
	{
		const {viewer} = buildViewerDom();
		const seen = [];
		const originalAdd = viewer.addEventListener.bind(viewer);
		viewer.addEventListener = (type, listener, options) =>
		{
			seen.push({type, options});
			return originalAdd(type, listener, options);
		};

		const three = new Main(new Model(), viewer, 'three-canvas', {});

		// Since S5 the viewer carries two independent pointer consumers: the
		// Controller for picking and dragging, and three's own OrbitControls for
		// orbit/pan/zoom - the vendored fork used mouse and touch events, the
		// addon uses pointer events. Both are legitimate, so this checks the
		// Controller's four registrations specifically rather than counting
		// everything on the element.
		const controllerOptions = {passive: false};
		const controllerPointers = seen.filter((s) =>
			s.type.startsWith('pointer') && s.options && s.options.passive === false);

		expect(controllerPointers.map((s) => s.type).sort())
			.toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
		controllerPointers.forEach((s) => {expect(s.options).toEqual(controllerOptions);});
		three.dispose();
	});

	it('lets OrbitControls take pointer input on the same element', () =>
	{
		// The other half of that split, asserted so the swap cannot silently
		// regress to no orbit input at all. The addon registers pointerdown on
		// the container itself; move and up arrive on capture once a drag starts.
		const {viewer} = buildViewerDom();
		const seen = [];
		const originalAdd = viewer.addEventListener.bind(viewer);
		viewer.addEventListener = (type, listener, options) =>
		{
			seen.push({type, options});
			return originalAdd(type, listener, options);
		};

		const three = new Main(new Model(), viewer, 'three-canvas', {});
		const fromControls = seen.filter((s) => !s.options || s.options.passive !== false);
		expect(fromControls.map((s) => s.type)).toContain('pointerdown');
		three.dispose();
	});
});

describe('Main lifecycle', () =>
{
	it('detaches every listener, stops the render loop and releases the context', () =>
	{
		const {viewer} = buildViewerDom();
		listeners.reset();

		const three = new Main(new Model(), viewer, 'three-canvas', {});
		const renderer = three.renderer;
		expect(typeof renderer.animationLoop).toBe('function');
		expect(listeners.net(viewer)).toBeGreaterThan(0);

		three.dispose();

		expect(renderer.animationLoop).toBe(null);
		expect(renderer.disposed).toBe(true);
		expect(renderer.contextLost).toBe(true);
		expect(listeners.net(viewer)).toBe(0);
		expect(ourLeaks()).toEqual([]);
		expect(observer.liveCount()).toBe(0);
	});

	it('stops auto-spin gating and picking after dispose', () =>
	{
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});
		three.dispose();

		viewer.dispatchEvent(new window.MouseEvent('mouseenter', {bubbles: false}));
		expect(three.mouseOver).toBe(false);
		expect(three.getController().enabled).toBe(false);
	});

	it('is idempotent', () =>
	{
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		three.dispose();
		expect(() => three.dispose()).not.toThrow();
		expect(three.renderer.disposed).toBe(true);
	});
});

describe('BlueprintJS mount and unmount', () =>
{
	it('creates the 2D floorplanner in normal mode and disposes both halves', () =>
	{
		buildViewerDom();
		listeners.reset();

		const blueprint = new BlueprintJS({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});

		expect(blueprint.floorplanner).toBeTruthy();
		expect(blueprint.three.getController().enabled).toBe(true);

		blueprint.dispose();

		expect(blueprint.floorplanner).toBe(null);
		expect(blueprint.three).toBe(null);
		expect(ourLeaks()).toEqual([]);
		expect(renderers.every((r) => r.disposed)).toBe(true);
	});

	it('widget mode boots with no floorplanner and a disabled controller', () =>
	{
		buildViewerDom();

		const blueprint = new BlueprintJS({
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: true,
		});

		expect(blueprint.floorplanner).toBe(null);
		expect(blueprint.three.getController().enabled).toBe(false);
		// No 2D view means nothing ever assigns a carbon sheet.
		expect(blueprint.model.floorplan.carbonSheet).toBeNull();

		blueprint.dispose();
		expect(ourLeaks()).toEqual([]);
	});

	it('widget mode loads a design containing a carbon sheet without throwing', () =>
	{
		// The crash this guards: Floorplan.loadFloorplan used to dereference
		// this.carbonSheet unconditionally, so any saved design with a carbon sheet
		// took widget mode down on load. Guarded in S0, pinned here for widget mode.
		buildViewerDom();

		const blueprint = new BlueprintJS({
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: true,
		});
		// Fixtures are written in centimetres; BlueprintJS boots in metres.
		Configuration.setValue(configDimUnit, dimCentiMeter);
		// rich-design carries furniture; keep the item pipeline off the network.
		blueprint.model.scene.setItemLoader(stubItemLoader(THREE));

		expect(() => blueprint.model.loadSerialized(readFixture('rich-design'))).not.toThrow();
		expect(blueprint.model.floorplan.getCorners().length).toBeGreaterThan(0);
		expect(blueprint.model.floorplan.carbonSheet).toBeNull();

		blueprint.dispose();
	});

	it('survives mount -> destroy -> remount with no listener or context growth', () =>
	{
		buildViewerDom();
		listeners.reset();

		for (let i = 0; i < 5; i++)
		{
			const blueprint = new BlueprintJS({
				floorplannerElement: 'floorplanner-canvas',
				threeElement: '#viewer',
				threeCanvasElement: 'three-canvas',
				textureDir: 'models/textures/',
				widget: false,
			});
			blueprint.dispose();
		}

		expect(renderers.length).toBe(5);
		expect(renderers.every((r) => r.disposed && r.contextLost)).toBe(true);
		expect(ourLeaks()).toEqual([]);
		expect(observer.liveCount()).toBe(0);
		// Every renderer canvas is back out of the document.
		expect(document.querySelectorAll('#viewer canvas').length).toBe(0);
	});
});

/**
 * Sprint S4's parity freeze.
 *
 * Three settings hold r185's rendering to what r98 produced, so that a shading
 * difference during the bump means the geometry rewrite broke something rather
 * than that the colour pipeline moved underneath it. None of them is exercised
 * by anything else here - the tests above inject a fake renderer - and all
 * three are one-liners that a later refactor could silently drop. S8 removes
 * them deliberately, and these tests with them.
 */
describe('the colour pipeline', () =>
{
	// S4 froze colour management off so the engine bump could be reviewed as a
	// geometry change; these two were the tripwires for the sprint that undid
	// that, and they fired on it. Rewritten in S8 to pin the new contract rather
	// than deleted - the property they guard is the same one, and it is exactly
	// as easy to break in the other direction.

	it('enables colour management at import time, not at renderer construction', () =>
	{
		// A Color converts when it is built, and materials are built long before
		// any renderer exists - so setting this inside getARenderer() would be too
		// late for every colour the app has already picked.
		expect(THREE.ColorManagement.enabled).toBe(true);
	});

	it('reads hex literals as sRGB and stores them linear', () =>
	{
		// The observable consequence, and the reason a hex round-trip test proves
		// nothing: `new Color('#' + c.getHexString())` is byte-exact whether
		// management is on or off, because both halves move together. What
		// actually changed is the value the shader receives.
		const colour = new THREE.Color(0x808080);
		expect(colour.r).toBeCloseTo(0.21586050010324417, 9);
		expect(colour.g).toBeCloseTo(0.21586050010324417, 9);
		expect(colour.b).toBeCloseTo(0.21586050010324417, 9);
		// Under the freeze this was 128/255 = 0.5019607843137255.
		expect(colour.r).not.toBeCloseTo(128 / 255, 4);
	});

	it('renders into sRGB, so the decode on the way in has a matching encode', () =>
	{
		// The two halves must agree. A decoded texture written into an unencoded
		// frame lands a full gamma too dark; an undecoded one into an encoded
		// frame lands far too bright.
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});
		expect(three.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
		three.dispose();
	});

	it('scales light intensities by pi to replace the legacy lighting mode', () =>
	{
		// A unit conversion, not a colour workaround, which is why S8 kept it
		// while lifting everything around it. r165 stopped applying the 1/pi
		// scaling on the way into the shader; BRDF_Lambert still divides the
		// diffuse response by pi. So N * PI reaches an up-facing surface as
		// exactly N, which is what N alone used to mean.
		const scene = {add() {}};
		const floorplan = new THREE.EventDispatcher();
		floorplan.getSize = () => new THREE.Vector3(1, 1, 1);
		floorplan.getCenter = () => new THREE.Vector3();

		const lights = new Lights(scene, floorplan);
		expect(lights.getDirLight().intensity).toBeCloseTo(0.5 * Math.PI, 6);
	});
});

/**
 * Sprint S5: OrbitControls became a shim over three's addon.
 *
 * The vendored fork was 1,045 lines of stale three with two app-specific edits
 * woven through it. Those two are all that survives, so they are the two things
 * worth pinning: without them the viewer stops redrawing after a camera move,
 * and wall faces stop re-evaluating which way they point.
 */
describe('the OrbitControls shim', () =>
{
	function mount()
	{
		const {viewer} = buildViewerDom();
		const three = new Main(new Model(), viewer, 'three-canvas', {});
		return {three, controls: three.controls};
	}

	it('is three\'s addon, not a fork of it', () =>
	{
		const {three, controls} = mount();
		// Properties the addon owns and the app configures. If the swap ever
		// regressed to a hand-rolled object these would be undefined.
		expect(typeof controls.listenToKeyEvents).toBe('function');
		expect(typeof controls.connect).toBe('function');
		expect(controls.screenSpacePanning).toBe(true);
		expect(controls.maxDistance).toBe(3000);
		three.dispose();
	});

	it('unbinds its capture-phase keydown even if the host detaches first', () =>
	{
		// three's disconnect() resolves the document as `domElement.getRootNode()`,
		// the same way connect() did. Take the element out of the page in between
		// and the removal lands on the detached subtree, leaving a keydown
		// listener on the real document for the life of the page.
		//
		// The order is not hypothetical: @vue/test-utils detaches before it
		// unmounts, and so does any embedder that empties its container before
		// calling dispose(). Added in S6, when the Vue shell's leak test found it.
		const {viewer} = buildViewerDom();
		const before = listeners.netFor(document, 'keydown');

		const three = new Main(new Model(), viewer, 'three-canvas', {});
		// The addon's capture-phase interceptor, plus the walk controls' own pair.
		expect(listeners.netFor(document, 'keydown')).toBeGreaterThan(before);

		viewer.parentNode.removeChild(viewer);
		three.dispose();

		expect(listeners.netFor(document, 'keydown')).toBe(before);
	});

	it('starts dirty, so the first frame is always drawn', () =>
	{
		// The flag is initialised true and consumed by the very first render, so
		// by the time a test can look it is already false. What is observable is
		// that the frame happened.
		const {three} = mount();
		expect(three.renderer.renderCount).toBeGreaterThan(0);
		expect(three.controls.needsUpdate).toBe(false);
		three.dispose();
	});

	it('marks the view dirty whenever the camera changes', () =>
	{
		const {three, controls} = mount();
		// shouldRender consumes the flag; that is the contract Main relies on.
		three.shouldRender();
		expect(controls.needsUpdate).toBe(false);

		controls.dispatchEvent({type: 'change'});
		expect(controls.needsUpdate).toBe(true);
		expect(three.shouldRender()).toBe(true);
		expect(controls.needsUpdate).toBe(false);
		three.dispose();
	});

	it('re-dispatches EVENT_CAMERA_MOVED, which wall culling depends on', () =>
	{
		const {three, controls} = mount();
		let moved = 0;
		const listener = () => {moved += 1;};
		controls.addEventListener(EVENT_CAMERA_MOVED, listener);

		controls.dispatchEvent({type: 'change'});
		expect(moved).toBe(1);

		controls.removeEventListener(EVENT_CAMERA_MOVED, listener);
		controls.dispatchEvent({type: 'change'});
		expect(moved).toBe(1);
		three.dispose();
	});

	it('is still an EventDispatcher target for EVENT_CAMERA_ACTIVE_STATUS', () =>
	{
		// Main dispatches this ON the controls and Edge listens for it, to force
		// every wall visible when a view preset is applied.
		const {three, controls} = mount();
		let shown = 0;
		controls.addEventListener(EVENT_CAMERA_ACTIVE_STATUS, () => {shown += 1;});
		three.switchView(VIEW_TOP);
		expect(shown).toBe(1);
		three.dispose();
	});

	it('hot-swaps the camera when the orthographic view is toggled', () =>
	{
		const {three, controls} = mount();
		expect(controls.object).toBe(three.perspectivecamera);
		three.switchOrthographicMode(true);
		expect(controls.object).toBe(three.orthocamera);
		three.switchOrthographicMode(false);
		expect(controls.object).toBe(three.perspectivecamera);
		three.dispose();
	});

	it('unbinds its key listener on dispose', () =>
	{
		const listeners = installListenerCounter(window);
		const {three} = mount();
		expect(listeners.netFor(window, 'keydown')).toBeGreaterThan(0);
		three.dispose();
		expect(listeners.netFor(window, 'keydown')).toBe(0);
		listeners.restore();
	});
});

/**
 * Sprint S5: the walk-through physics, ported onto three's addon.
 *
 * The addon rotates the camera directly; the fork parented it into a yaw/pitch
 * rig and translated that. Everything below is a consequence of that change,
 * and none of it is exercised by the app's own tests because the FPS button is
 * commented out of the legacy demo's markup.
 */
describe('PointerLockControls walk physics', () =>
{
	function walker()
	{
		const camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
		const element = document.createElement('div');
		document.body.appendChild(element);
		const controls = new PointerLockControls(camera, element);
		controls.characterHeight = 160;
		controls.enabled = true;
		return {controls, camera};
	}

	const press = (code) => document.dispatchEvent(new window.KeyboardEvent('keydown', {code}));
	const release = (code) => document.dispatchEvent(new window.KeyboardEvent('keyup', {code}));

	it('exposes the camera through getObject(), where the yaw rig used to be', () =>
	{
		const {controls, camera} = walker();
		expect(controls.getObject()).toBe(camera);
		controls.dispose();
	});

	it('falls to eye height and stops there', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 400, 0);
		for (let i = 0; i < 60; i++) {controls.update(1 / 60);}
		expect(camera.position.y).toBe(160);
		controls.dispose();
	});

	it('walks forward along the way the camera faces', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(0, 0, 0, 'YXZ'); // looking down -Z

		press('KeyW');
		for (let i = 0; i < 30; i++) {controls.update(1 / 60);}
		release('KeyW');

		expect(camera.position.z).toBeLessThan(-1);
		expect(Math.abs(camera.position.x)).toBeLessThan(1e-6);
		controls.dispose();
	});

	it('stays on the floor when walking while looking up', () =>
	{
		// The reason walking goes through moveForward rather than translateZ. The
		// fork translated a yaw-only object, so pitch could not leak into motion;
		// the camera carries pitch, and translating along its local -Z would fly.
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(Math.PI / 4, 0, 0, 'YXZ'); // looking 45 degrees up

		press('KeyW');
		for (let i = 0; i < 30; i++) {controls.update(1 / 60);}
		release('KeyW');

		expect(camera.position.y).toBe(160);
		expect(camera.position.z).toBeLessThan(-1);
		controls.dispose();
	});

	it('turns with the camera - walking east after a quarter turn', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(0, -Math.PI / 2, 0, 'YXZ'); // now facing +X

		press('KeyW');
		for (let i = 0; i < 30; i++) {controls.update(1 / 60);}
		release('KeyW');

		expect(camera.position.x).toBeGreaterThan(1);
		expect(Math.abs(camera.position.z)).toBeLessThan(1e-6);
		controls.dispose();
	});

	it('jumps, and lands', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		controls.update(1 / 60);            // one frame on the ground arms the jump

		press('Space');
		controls.update(1 / 60);
		expect(camera.position.y).toBeGreaterThan(160);

		for (let i = 0; i < 120; i++) {controls.update(1 / 60);}
		expect(camera.position.y).toBe(160);
		controls.dispose();
	});

	it('cannot double-jump in mid-air', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		controls.update(1 / 60);

		press('Space');
		controls.update(1 / 60);
		const first = camera.position.y;

		press('Space');                     // still airborne
		controls.update(1 / 60);
		// Rising, but only under the original impulse - not boosted again.
		expect(camera.position.y - first).toBeLessThan(first - 160);
		controls.dispose();
	});

	it('ignores the keyboard while disabled', () =>
	{
		const {controls, camera} = walker();
		controls.enabled = false;
		camera.position.set(0, 160, 0);

		press('KeyW');
		for (let i = 0; i < 30; i++) {controls.update(1 / 60);}
		release('KeyW');

		expect(camera.position.z).toBe(0);
		controls.dispose();
	});

	it('clamps a huge delta instead of falling through the floor', () =>
	{
		// THREE.Clock handed over the whole gap since its last read, so entering
		// walk mode from a backgrounded tab applied seconds of gravity in one
		// frame. The internal clock caps it.
		const {controls, camera} = walker();
		camera.position.set(0, 5000, 0);
		controls.update();                  // first call establishes the baseline
		const before = camera.position.y;
		controls.update();
		expect(before - camera.position.y).toBeLessThan(200);
		controls.dispose();
	});

	it('detaches its key listeners on dispose', () =>
	{
		const listeners = installListenerCounter(window);
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);

		expect(listeners.netFor(document, 'keydown')).toBeGreaterThan(0);
		controls.dispose();
		expect(listeners.netFor(document, 'keydown')).toBe(0);
		expect(listeners.netFor(document, 'keyup')).toBe(0);
		listeners.restore();
	});
});
