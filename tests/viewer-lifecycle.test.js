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
import {acquireTexture, releaseTexture, clearTextureCache, textureCacheStats} from '../src/scripts/three/texture_cache.js';
import {Floorplan3D} from '../src/scripts/three/floorPlan.js';
import {Lights} from '../src/scripts/three/lights.js';
import {PointerLockControls} from '../src/scripts/three/pointerlockcontrols.js';
import {Model} from '../src/scripts/model/model.js';
import {BlueprintJS, BlueprintCore} from '../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {EVENT_CAMERA_MOVED, EVENT_CAMERA_ACTIVE_STATUS} from '../src/scripts/core/events.js';
import {VIEW_TOP} from '../src/scripts/core/constants.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installMatchMedia, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
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

		// Deferred to the next frame since P6 - the observer raises a flag and the
		// animation loop that is already running does the work. See the next test.
		three.renderer.animationLoop();

		expect(three.elementWidth).toBe(900);
		expect(three.renderer.size).toEqual({width: 900, height: 500});
		three.dispose();
	});

	it('does not resize the renderer inside the observer callback', () =>
	{
		// `renderer.setSize()` writes style.width and style.height on the canvas.
		// Doing that from a ResizeObserver callback watching that canvas' own
		// container is a layout change made during observation, and chromium
		// answers it by deferring delivery and reporting `ResizeObserver loop
		// completed with undelivered notifications` as a window error - which
		// P5's browser tier had to swallow by exact message to keep the layout
		// tests green. Deferring the write to the frame is what let that swallow
		// be deleted.
		const {viewer} = buildViewerDom({width: 640, height: 400});
		const three = new Main(new Model(), viewer, 'three-canvas', {});

		setLayout(viewer, {left: 0, top: 0, width: 900, height: 500});
		observer.trigger();

		expect(three.elementWidth).toBe(640);
		expect(three.renderer.size).toEqual({width: 640, height: 400});

		three.renderer.animationLoop();
		expect(three.renderer.size).toEqual({width: 900, height: 500});
		three.dispose();
	});

	it('applies a resize that arrived while the viewer was paused', () =>
	{
		// The hidden-pane case. `render()` returns early while paused, so applying
		// the resize inside it would leave a pane that was resized while hidden
		// coming back at its old size. It is applied from the loop instead.
		const {viewer} = buildViewerDom({width: 640, height: 400});
		const three = new Main(new Model(), viewer, 'three-canvas', {});
		three.pauseTheRendering(true);

		setLayout(viewer, {left: 0, top: 0, width: 900, height: 500});
		observer.trigger();
		three.renderer.animationLoop();

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
	/**
	 * The half of BlueprintJS that has no viewer in it (RM-015 M3).
	 *
	 * `BlueprintJS` is `BlueprintCore` plus a static `import {Main}`, and that
	 * import is the whole of what an application avoids by constructing the core
	 * and calling `attachViewer` off a dynamic one. These cases pin the two
	 * properties the application depends on and the class it extends cannot
	 * show: that a document is complete without a viewer, and that attaching is
	 * idempotent - the caller is now a layout watcher, which can fire twice
	 * before an import lands.
	 */
	it('builds a document and a plan with no viewer at all', () =>
	{
		buildViewerDom();

		const core = new BlueprintCore({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});

		expect(core.model).toBeTruthy();
		expect(core.floorplanner).toBeTruthy();
		expect(core.three).toBe(null);
		expect(renderers).toHaveLength(0);

		core.dispose();
		expect(ourLeaks()).toEqual([]);
	});

	it('attaches a viewer once, and returns the same one to a second caller', () =>
	{
		buildViewerDom();

		const core = new BlueprintCore({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});

		const first = core.attachViewer(Main);
		const second = core.attachViewer(Main);

		expect(second).toBe(first);
		expect(core.three).toBe(first);
		expect(renderers).toHaveLength(1);

		core.dispose();
		expect(renderers.every((r) => r.disposed)).toBe(true);
	});

	it('detaches the viewer and leaves the document standing', () =>
	{
		buildViewerDom();

		const core = new BlueprintCore({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});

		core.attachViewer(Main);
		core.detachViewer();

		// The inverse of attachViewer, not a teardown: the renderer is released
		// and the design is still open, so another viewer can take its place.
		expect(core.three).toBe(null);
		expect(core.model).toBeTruthy();
		expect(core.floorplanner).toBeTruthy();
		expect(renderers).toHaveLength(1);
		expect(renderers[0].disposed).toBe(true);

		core.attachViewer(Main);
		expect(core.three).toBeTruthy();
		expect(renderers).toHaveLength(2);

		core.dispose();
	});

	it('detaches idempotently, and with nothing attached', () =>
	{
		buildViewerDom();
		const core = new BlueprintCore({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});

		expect(() => core.detachViewer()).not.toThrow();
		core.attachViewer(Main);
		core.detachViewer();
		expect(() => core.detachViewer()).not.toThrow();
		core.dispose();
	});

	it('still disables the widget controller, wherever the viewer comes from', () =>
	{
		buildViewerDom();
		const core = new BlueprintCore({
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: true,
		});

		// Widget mode's two halves were in one constructor and are now in two
		// places - no floorplanner here, the disabled controller in attachViewer -
		// so this is the case that says they did not come apart.
		expect(core.floorplanner).toBe(null);
		expect(core.attachViewer(Main).getController().enabled).toBe(false);
		core.dispose();
	});

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
describe('the texture cache (RM-002 R-04)', () =>
{
	/** A viewer with a real design in it, so there are walls and floors to texture. */
	function furnishedViewer()
	{
		buildViewerDom();
		const blueprint = new BlueprintJS({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});
		// Fixtures are written in centimetres; BlueprintJS boots in metres.
		Configuration.setValue(configDimUnit, dimCentiMeter);
		blueprint.model.scene.setItemLoader(stubItemLoader(THREE));
		blueprint.model.loadSerialized(readFixture('rich-design'));
		return blueprint;
	}

	beforeEach(() => {clearTextureCache();});
	afterEach(() => {clearTextureCache();});

	it('decodes one image however many handles are taken', () =>
	{
		const a = acquireTexture('rooms/textures/wallmap.png');
		const b = acquireTexture('rooms/textures/wallmap.png');
		const c = acquireTexture('rooms/textures/light.png');

		expect(textureCacheStats()).toEqual({urls: 2, handles: 3});
		// One decoded image behind the two handles for the same URL...
		expect(a.source).toBe(b.source);
		expect(a.source).not.toBe(c.source);
		// ...but separate Textures, which is what lets each wall keep its own
		// repeat. Sharing one Texture would make every wall tile like the last
		// one drawn.
		expect(a).not.toBe(b);
		a.repeat.set(4, 2);
		b.repeat.set(1, 1);
		expect(a.repeat.x).toBe(4);
		expect(b.repeat.x).toBe(1);
	});

	it('drops the image only when the last handle goes back', () =>
	{
		const a = acquireTexture('rooms/textures/wallmap.png');
		const b = acquireTexture('rooms/textures/wallmap.png');

		releaseTexture(a);
		expect(textureCacheStats()).toEqual({urls: 1, handles: 1});

		releaseTexture(b);
		expect(textureCacheStats()).toEqual({urls: 0, handles: 0});
	});

	it('tolerates a double release and a texture it never issued', () =>
	{
		const a = acquireTexture('rooms/textures/wallmap.png');
		releaseTexture(a);
		expect(() => releaseTexture(a)).not.toThrow();
		expect(() => releaseTexture(null)).not.toThrow();
		expect(() => releaseTexture(new THREE.Texture())).not.toThrow();
		expect(textureCacheStats()).toEqual({urls: 0, handles: 0});
	});

	it('an Edge redraw does not accumulate handles - the leak itself', () =>
	{
		// This is the regression. updateTexture() used to run
		// `new TextureLoader().load(url)` on every call and drop the previous
		// Texture on the floor, and redraw() is wired to EVENT_REDRAW - so the
		// leak grew with editing rather than with the size of the design.
		const blueprint = furnishedViewer();

		const edges = blueprint.three.floorplan.edges;
		expect(edges.length).toBeGreaterThan(0);

		const settled = textureCacheStats().handles;
		for (let i = 0; i < 5; i++)
		{
			edges.forEach((edge) => edge.redraw());
		}
		expect(textureCacheStats().handles).toBe(settled);

		blueprint.dispose();
	});

	it('a disposed viewer gives every handle back', () =>
	{
		const blueprint = furnishedViewer();

		expect(textureCacheStats().handles).toBeGreaterThan(0);
		blueprint.dispose();
		expect(textureCacheStats()).toEqual({urls: 0, handles: 0});
	});

	it('Floorplan3D.dispose unsubscribes, so a dead viewer stops redrawing', () =>
	{
		const blueprint = furnishedViewer();

		const plan3d = blueprint.three.floorplan;
		expect(plan3d).toBeInstanceOf(Floorplan3D);

		let redraws = 0;
		const original = plan3d.redraw.bind(plan3d);
		plan3d.redraw = () => {redraws += 1; original();};

		plan3d.dispose();
		blueprint.model.floorplan.update();
		expect(redraws).toBe(0);

		blueprint.dispose();
	});
});

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

	it('draws nothing at all while the scene sits idle', () =>
	{
		// The other half of "starts dirty": the S9 exit gate asks for
		// render-on-demand to be *verified*, and the claim it makes is a
		// negative one - an untouched design costs no GPU work. Only asserting
		// that the first frame happens would pass just as happily against a
		// renderer drawing sixty frames a second into a still scene.
		//
		// setAnimationLoop keeps running either way; what render-on-demand means
		// is that the callback returns without reaching renderer.render().
		//
		// pauseTheRendering(false) first, and that matters: Main constructs with
		// pauseRender = true, so an unforced render() returns before it ever
		// consults the dirty flags. Testing the default state would prove only
		// that a paused view draws nothing, which is a different and much weaker
		// claim. The application unpauses whenever the 3D pane is visible - see
		// useCameraViews - so this is the state the gate is asking about.
		const {three} = mount();
		expect(typeof three.renderer.animationLoop).toBe('function');
		three.pauseTheRendering(false);
		// As `useCameraViews.applyBootState` does (RM-020 S-3). Before S-3 this
		// line would have changed nothing, because `autoRotate` was set and never
		// advanced; now the loop advances it, so a viewer left spinning draws
		// every frame *by design* and this case would be asserting the opposite of
		// what it means. The library default is `spin: true` - rotate until
		// touched - and the application stops it at boot, which is the state the
		// render-on-demand claim is about.
		three.stopSpin();

		// Let the boot frame and anything it dirtied settle.
		for (let i = 0; i < 5; i += 1) { three.renderer.animationLoop(); }
		const settled = three.renderer.renderCount;
		expect(settled).toBeGreaterThan(0);

		for (let i = 0; i < 120; i += 1) { three.renderer.animationLoop(); }
		expect(three.renderer.renderCount).toBe(settled);

		// And it is genuinely idle-gated, not switched off: one dirty flag and
		// exactly one frame comes back.
		three.needsUpdate = true;
		three.renderer.animationLoop();
		expect(three.renderer.renderCount).toBe(settled + 1);
		three.renderer.animationLoop();
		expect(three.renderer.renderCount).toBe(settled + 1);

		three.dispose();
	});

	it('draws exactly one frame when a corner is dragged in the plan', () =>
	{
		// The gap between the two cases above (RM-019 R1). One says an idle scene
		// costs nothing; the other says a dirty flag costs one frame. Neither
		// says that *editing the plan* raises the flag - and for a corner drag it
		// did not.
		//
		// Until RM-003 A2 it did, by accident: `Main` recentred the camera on
		// every EVENT_UPDATED, `centerCamera()` ends in `controls.update()`, and
		// that fires `change`, which is the case below. A2 stopped recentring on a
		// drag - correctly, it was yanking the camera on every pointermove - and
		// took the repaint with it. The 2D pane redrew, the model moved, the
		// projection rebuilt its meshes, and the 3D canvas held its last frame
		// until something unrelated asked for one.
		//
		// It survived because the 2D and 3D panes were a card flip: switching to
		// 3D calls `showDesign()`, which unpauses and rebuilds, so the view was
		// always correct by the time anybody saw it. In the split layout both
		// panes are on screen at once and the stale one is in plain sight.
		const {three} = mount();
		const floorplan = three.model.floorplan;
		const corners = [[0, 0], [400, 0], [400, 300], [0, 300]]
			.map(([x, y]) => floorplan.newCorner(x, y));
		corners.forEach((corner, i) => floorplan.newWall(corner, corners[(i + 1) % corners.length]));

		three.pauseTheRendering(false);
		three.stopSpin();
		// Loop until quiescent rather than for a fixed count (RM-020 S-3). Since
		// the loop advances the orbit controls, the damping tail after the boot
		// recentre is real and takes a few frames to fall under three's epsilon -
		// which is the point of S-3, and is not what this case is measuring.
		let quiet = 0;
		let settled = three.renderer.renderCount;
		for (let i = 0; i < 400 && quiet < 3; i += 1)
		{
			three.renderer.animationLoop();
			quiet = three.renderer.renderCount === settled ? quiet + 1 : 0;
			settled = three.renderer.renderCount;
		}
		// Three consecutive quiet frames, not one: the damping tail decays through
		// three's epsilon rather than stopping at it, so a single quiet frame can
		// be followed by one more sub-pixel move.
		expect(quiet, 'the viewer went quiet').toBe(3);
		// Idle, so the count below is attributable to the drag and nothing else.
		three.renderer.animationLoop();
		expect(three.renderer.renderCount, 'quiescent before the drag').toBe(settled);

		corners[1].move(450, 40);

		three.renderer.animationLoop();
		expect(three.renderer.renderCount, 'the drag drew a frame').toBe(settled + 1);
		// And exactly one: a repaint per edit, not a repaint per frame.
		three.renderer.animationLoop();
		expect(three.renderer.renderCount).toBe(settled + 1);
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

	/**
	 * RM-014 L4 moved this listener from `window` to the viewer element, and the
	 * numbers that justified it were measured on a live instance rather than read
	 * off three's source. Dispatching ArrowLeft and counting `_handleKeyDown`:
	 *
	 *   binding    key on window   key on the viewer   key in a focused <input>
	 *   window                 1                   1                          1
	 *   element                0                   1                          0
	 *
	 * The last column is why. three's handler checks `enabled` and nothing else -
	 * not focus, not whether a caret is in a field - so with the old binding an
	 * arrow key typed while renaming a room panned the 3D camera behind the
	 * dialog. L4 also gives the plan canvas the same four keys, so "everywhere"
	 * stopped being untidy and became ambiguous.
	 */
	it('binds its key listener to the viewer, not the window (RM-014 L4)', () =>
	{
		const {three, controls} = mount();
		let hits = 0;
		const real = controls._handleKeyDown.bind(controls);
		controls._handleKeyDown = (event) => {hits += 1; return real(event);};
		const arrow = (target) => target.dispatchEvent(
			new window.KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true, cancelable: true}));

		arrow(window);
		expect(hits, 'an arrow key anywhere on the page must not reach the camera').toBe(0);

		arrow(three.domElement);
		expect(hits, 'an arrow key on the focused viewer must reach the camera').toBe(1);

		three.dispose();
	});

	it('unbinds its key listener on dispose', () =>
	{
		// Counted on the viewer element since L4, which is where the listener now
		// lives. The assertion is the same one it always was - nothing this
		// instance attached outlives it - re-pointed at the new target rather than
		// relaxed. The `window` half is asserted too, so a future change that
		// widens the scope back fails here instead of silently working.
		const listeners = installListenerCounter(window);
		const {three} = mount();
		const element = three.domElement;
		expect(listeners.netFor(element, 'keydown')).toBeGreaterThan(0);
		expect(listeners.netFor(window, 'keydown')).toBe(0);
		three.dispose();
		expect(listeners.netFor(element, 'keydown')).toBe(0);
		listeners.restore();
	});
});

/**
 * RM-014 L4, finding Z-6: the one piece of motion CSS cannot reach.
 *
 * Z-6 read the `prefers-reduced-motion` block in `app.css` against a count of
 * every animation and transition in the tree - 6 animations, 4 keyframe sets, 7
 * transitions - and found the query reaches all of them. It cannot reach
 * OrbitControls damping, because that is not a style: it is the camera gliding
 * on after the hand stops, produced by arithmetic in an animation frame.
 *
 * Read back off the controls rather than off the CSS, which is the acceptance
 * clause: asserting that a media query exists in a stylesheet would be
 * asserting that a constant equals itself.
 */
describe('reduced motion and the 3D camera', () =>
{
	const QUERY = '(prefers-reduced-motion: reduce)';
	let media;

	function mount()
	{
		const viewer = document.createElement('div');
		viewer.id = 'viewer';
		document.body.appendChild(viewer);
		setLayout(viewer, {left: 0, top: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT});
		return new Main(new Model(), viewer, 'three-canvas', {});
	}

	afterEach(() => {if (media) { media.restore(); media = null; }});

	it('damps by default, because nobody has asked it not to', () =>
	{
		media = installMatchMedia(window, {[QUERY]: false});
		const three = mount();
		expect(three.controls.enableDamping).toBe(true);
		three.dispose();
	});

	it('does not damp for somebody who asked the system to stop moving things', () =>
	{
		media = installMatchMedia(window, {[QUERY]: true});
		const three = mount();
		expect(three.controls.enableDamping).toBe(false);
		three.dispose();
	});

	it('damps where the preference cannot be asked at all', () =>
	{
		// jsdom has no matchMedia, which is also every older embedding host. An
		// environment that cannot be asked has not asked for anything, and
		// defaulting to "reduce" would silently still every viewer on one.
		const three = mount();
		expect(three.controls.enableDamping).toBe(true);
		three.dispose();
	});

	it('follows the preference changing while the tab is open, and stops when disposed', () =>
	{
		media = installMatchMedia(window, {[QUERY]: false});
		const three = mount();
		expect(three.controls.enableDamping).toBe(true);

		media.set(QUERY, true);
		expect(three.controls.enableDamping).toBe(false);
		media.set(QUERY, false);
		expect(three.controls.enableDamping).toBe(true);

		expect(media.listenerCount(QUERY)).toBe(1);
		three.dispose();
		expect(media.listenerCount(QUERY)).toBe(0);
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

describe('the photo capture (RM-011 H2, W-11)', () =>
{
	/** A mounted viewer, torn down by the caller. */
	function viewer()
	{
		buildViewerDom();
		const blueprint = new BlueprintJS({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});
		return blueprint;
	}

	it('renders once and hands back a PNG data URL', () =>
	{
		const blueprint = viewer();
		const before = blueprint.three.renderer.renderCount;

		const url = blueprint.three.dataUrl();

		expect(url.startsWith('data:image/png;base64,')).toBe(true);
		expect(blueprint.three.renderer.renderCount).toBeGreaterThan(before);
		blueprint.dispose();
	});

	it('leaves the pixel ratio exactly where it found it', () =>
	{
		// The property the `finally` exists for. A capture that raised the ratio
		// and did not put it back would leave the viewer rendering at four times
		// its size for the rest of the session - a bug that looks like a
		// performance problem and is a screenshot.
		const blueprint = viewer();
		const before = blueprint.three.renderer.getPixelRatio();

		blueprint.three.dataUrl(3);

		expect(blueprint.three.renderer.getPixelRatio()).toBe(before);
		blueprint.dispose();
	});

	it('puts it back when the read throws', () =>
	{
		const blueprint = viewer();
		const before = blueprint.three.renderer.getPixelRatio();
		const canvas = blueprint.three.renderer.domElement;
		const original = canvas.toDataURL;
		canvas.toDataURL = () => {throw new Error('tainted');};

		expect(() => blueprint.three.dataUrl(2)).toThrow('tainted');
		expect(blueprint.three.renderer.getPixelRatio()).toBe(before);

		canvas.toDataURL = original;
		blueprint.dispose();
	});

	it('clamps the multiplier against the GPU\'s own ceiling', () =>
	{
		// Exceeding MAX_TEXTURE_SIZE does not throw; it produces a buffer the
		// driver silently declines to allocate, which is a black image. The stub
		// reports 4096, and a 4x capture of this viewport would ask for more.
		const blueprint = viewer();
		const limit = blueprint.three.renderer.capabilities.maxTextureSize;
		let asked = 0;
		const setSize = blueprint.three.renderer.setSize.bind(blueprint.three.renderer);
		blueprint.three.renderer.setSize = function (width, height)
		{
			asked = Math.max(asked, Math.max(width, height) * this.getPixelRatio());
			setSize(width, height);
		};

		blueprint.three.dataUrl(4);

		expect(asked).toBeGreaterThan(0);
		expect(asked).toBeLessThanOrEqual(limit);
		blueprint.dispose();
	});

	it('takes the old path exactly when nobody asked for more', () =>
	{
		// 1 is the behaviour the method had since the fork, which is what makes
		// the parameter safe to add to a published method.
		const blueprint = viewer();
		const before = blueprint.three.renderer.getPixelRatio();
		let resized = 0;
		const setSize = blueprint.three.renderer.setSize.bind(blueprint.three.renderer);
		blueprint.three.renderer.setSize = function (width, height) {resized++; setSize(width, height);};

		blueprint.three.dataUrl(1);

		expect(resized).toBe(0);
		expect(blueprint.three.renderer.getPixelRatio()).toBe(before);
		blueprint.dispose();
	});

	it('takes the plain path before the viewer has been sized', () =>
	{
		// `elementWidth` and `elementHeight` are null until `updateWindowSize` has
		// run, and `setSize(null, null)` is a canvas of nothing rather than an
		// error - so the supersampled path has to notice. Put in the state the
		// guard describes, for the same reason as the test below.
		const blueprint = viewer();
		blueprint.three.elementWidth = null;
		blueprint.three.elementHeight = null;
		let resized = 0;
		const setSize = blueprint.three.renderer.setSize.bind(blueprint.three.renderer);
		blueprint.three.renderer.setSize = function (width, height) {resized++; setSize(width, height);};

		expect(blueprint.three.dataUrl(4).startsWith('data:image/png')).toBe(true);
		expect(resized).toBe(0);
		blueprint.dispose();
	});

	it('returns an empty string with no renderer at all', () =>
	{
		// `renderer` is null between construction and `init()`, which is the
		// window this guard is for. Set directly rather than reached through
		// `dispose()`, because dispose releases the context without nulling the
		// field - so the honest way to test the guard is to put the field in the
		// state the guard describes.
		const blueprint = viewer();
		const three = blueprint.three;
		three.renderer = null;
		expect(three.dataUrl(2)).toBe('');
		blueprint.dispose();
	});
});

describe('the AO chain, from Main\'s side (RM-011 H2)', () =>
{
	function viewer()
	{
		buildViewerDom();
		return new BlueprintJS({
			floorplannerElement: 'floorplanner-canvas',
			threeElement: '#viewer',
			threeCanvasElement: 'three-canvas',
			textureDir: 'models/textures/',
			widget: false,
		});
	}

	it('renders straight through the renderer when there is no chain', () =>
	{
		// The default, and the reason a build that never enables AO pays nothing:
		// not an if per frame, not a full-screen copy, not the render targets.
		const blueprint = viewer();
		expect(blueprint.three.post).toBeNull();

		const before = blueprint.three.renderer.renderCount;
		blueprint.three.render(true);
		expect(blueprint.three.renderer.renderCount).toBeGreaterThan(before);
		blueprint.dispose();
	});

	it('renders through the chain when there is one, and not through the renderer', () =>
	{
		// `drawWith` is the single place the choice is made, so this is the whole
		// of it. A stub rather than a real composer: what a GTAOPass does to a
		// picture needs a GPU and is in tests/browser/ambient-occlusion.test.js.
		const blueprint = viewer();
		const cameras = [];
		let composed = 0;
		blueprint.three.post = {
			composer: {render() {composed++;}},
			ao: {},
			setCamera(camera) {cameras.push(camera);},
			setSize() {},
			dispose() {},
		};

		const before = blueprint.three.renderer.renderCount;
		blueprint.three.render(true);

		expect(composed).toBe(1);
		expect(blueprint.three.renderer.renderCount).toBe(before);
		// Told which camera every frame, because three of them exist and the
		// walkthrough swaps to its own.
		expect(cameras[0]).toBe(blueprint.three.camera);
		blueprint.dispose();
	});

	it('resizes the chain with the canvas', () =>
	{
		// The composer's render targets are sized in pixels of their own and know
		// nothing about the canvas, so a viewer resized with AO on would keep
		// rendering the old rectangle and stretching it.
		const blueprint = viewer();
		const sizes = [];
		blueprint.three.post = {
			composer: {render() {}}, ao: {},
			setCamera() {}, setSize(width, height) {sizes.push([width, height]);}, dispose() {},
		};

		blueprint.three.updateWindowSize();

		expect(sizes.length).toBeGreaterThan(0);
		expect(sizes[sizes.length - 1][0]).toBeGreaterThan(0);
		blueprint.dispose();
	});

	it('disposes the chain, and only once', () =>
	{
		const blueprint = viewer();
		let disposed = 0;
		blueprint.three.post = {
			composer: {render() {}}, ao: {},
			setCamera() {}, setSize() {}, dispose() {disposed++;},
		};
		const three = blueprint.three;

		blueprint.dispose();

		expect(disposed).toBe(1);
		expect(three.post).toBeNull();
	});
});
