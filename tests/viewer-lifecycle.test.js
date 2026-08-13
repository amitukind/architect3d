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
import {Model} from '../src/scripts/model/model.js';
import {BlueprintJS} from '../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installResizeObserver, setLayout} from './helpers/dom.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

let canvasStub;
let observer;
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

/**
 * A renderer that records the calls Main makes against it. Everything Main
 * touches is here and nothing else - if Main grows a new renderer call, this
 * throws rather than silently passing.
 */
function createRendererStub()
{
	const renderer = {
		domElement: document.createElement('canvas'),
		shadowMap: {enabled: false, type: null},
		shadowMapSoft: false,
		clippingPlanes: [],
		localClippingEnabled: false,
		disposed: false,
		contextLost: false,
		animationLoop: undefined,
		size: null,
		renderCount: 0,
		setClearColor() {},
		setSize(width, height) {this.size = {width, height};},
		setAnimationLoop(fn) {this.animationLoop = fn;},
		render() {this.renderCount++;},
		dispose() {this.disposed = true;},
		forceContextLoss() {this.contextLost = true;},
	};
	renderers.push(renderer);
	return renderer;
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

	Main.setRendererFactory(createRendererStub);
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	observer.restore();
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
		const pointerTypes = seen.filter((s) => s.type.startsWith('pointer'));
		expect(pointerTypes.map((s) => s.type).sort())
			.toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
		pointerTypes.forEach((s) => {expect(s.options).toEqual({passive: false});});
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
describe('the r98 parity freeze', () =>
{
	it('disables colour management at import time, not at renderer construction', () =>
	{
		// A Color converts when it is built, and materials are built long before
		// any renderer exists - so setting this inside getARenderer() would be too
		// late for every colour the app has already picked.
		expect(THREE.ColorManagement.enabled).toBe(false);
	});

	it('leaves hex colours exactly as authored, with no sRGB-to-linear conversion', () =>
	{
		// The observable consequence. With management on, 0x808080 arrives in the
		// shader as roughly 0.216; r98 passed 0.5019 straight through.
		const colour = new THREE.Color(0x808080);
		expect(colour.r).toBeCloseTo(128 / 255, 6);
		expect(colour.g).toBeCloseTo(128 / 255, 6);
		expect(colour.b).toBeCloseTo(128 / 255, 6);
	});

	it('scales light intensities by pi to replace the legacy lighting mode', () =>
	{
		// r165 removed the 1/pi scaling three used to apply, so the r98 constants
		// would arrive pi times dimmer and darken every lit surface - the Phong
		// floors and the loaded items - while leaving the unlit walls, sky and
		// ground untouched. That uneven result is worse than either look.
		const scene = {add() {}};
		const floorplan = new THREE.EventDispatcher();
		floorplan.getSize = () => new THREE.Vector3(1, 1, 1);
		floorplan.getCenter = () => new THREE.Vector3();

		const lights = new Lights(scene, floorplan);
		expect(lights.getDirLight().intensity).toBeCloseTo(0.5 * Math.PI, 6);
	});
});
