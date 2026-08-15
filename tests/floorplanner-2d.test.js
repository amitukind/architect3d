// @vitest-environment jsdom
/**
 * Sprint S2: the 2D floorplanner without jQuery.
 *
 * Unlike the rest of this suite these are not characterization tests - S2
 * deliberately changed how the 2D view attaches to the DOM, and this file pins
 * the new contract:
 *
 *   - pointer events, registered non-passive, replacing the touch/mouse pairs
 *   - coordinates from getBoundingClientRect, so a scrolled page stays accurate
 *   - sizing driven by the container, with the old viewport grab as a fallback
 *   - a DPR-scaled backing bitmap with all drawing still in CSS pixels
 *   - dispose() that detaches everything, so mount/unmount cycles do not leak
 *
 * jsdom has no layout engine, no 2D context and no ResizeObserver; helpers/dom.js
 * stubs exactly those three things and records what the library asked for.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {resolveElement, elementBox, measureViewport, pixelRatio} from '../src/scripts/core/dom.js';
import {Dimensioning} from '../src/scripts/core/dimensioning.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {EVENT_LOADED, EVENT_CORNER_ATTRIBUTES_CHANGED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installListenerCounter, installResizeObserver, setLayout} from './helpers/dom.js';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

let canvasStub;
let observer;
let listeners;

function setDevicePixelRatio(value)
{
	Object.defineProperty(window, 'devicePixelRatio', {value, configurable: true});
}

function firePointer(target, type, {clientX = 0, clientY = 0, pointerType = 'mouse'} = {})
{
	const event = new window.PointerEvent(type, {clientX, clientY, pointerType, bubbles: true, cancelable: true});
	target.dispatchEvent(event);
	return event;
}

beforeEach(() =>
{
	resetAll();
	Configuration.setValue(configDimUnit, dimCentiMeter);
	document.body.innerHTML = '';
	setDevicePixelRatio(1);
	window.innerWidth = VIEWPORT_WIDTH;
	window.innerHeight = VIEWPORT_HEIGHT;

	// Order matters: the counter has to wrap addEventListener before anything
	// under test attaches to the document or the window.
	listeners = installListenerCounter(window);
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
});

afterEach(() =>
{
	observer.restore();
	canvasStub.restore();
	listeners.restore();
	document.body.innerHTML = '';
});

describe('core/dom resolveElement', () =>
{
	it('accepts an element, a bare id, a #id and a CSS selector', () =>
	{
		const {container, canvas} = buildFloorplannerDom(window);

		expect(resolveElement(canvas, 'canvas')).toBe(canvas);
		expect(resolveElement('floorplanner-canvas', 'canvas')).toBe(canvas);
		expect(resolveElement('#floorplanner-canvas', 'canvas')).toBe(canvas);
		expect(resolveElement('#floorplanner > canvas', 'canvas')).toBe(canvas);
		expect(resolveElement('#floorplanner', 'container')).toBe(container);
	});

	it('throws a named error rather than returning a null element', () =>
	{
		buildFloorplannerDom(window);
		expect(() => resolveElement('does-not-exist', 'floorplanner canvas'))
			.toThrow(/Cannot resolve floorplanner canvas/);
		expect(() => resolveElement(null, 'floorplanner canvas')).toThrow(/Cannot resolve/);
	});
});

describe('core/dom measurement', () =>
{
	it('reports viewport-relative position and untransformed size', () =>
	{
		const {container} = buildFloorplannerDom(window, {left: 120, top: 60, width: 800, height: 500});
		expect(elementBox(container)).toEqual({left: 120, top: 60, width: 800, height: 500});
	});

	it('prefers the container size and falls back only when it has none', () =>
	{
		const {container} = buildFloorplannerDom(window, {width: 800, height: 500});
		expect(measureViewport(container, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({width: 800, height: 500});

		// The legacy demo's case: jquery.flip stamps height:100% on a wrapper that
		// has collapsed to zero, so only the height falls back.
		setLayout(container, {width: 800, height: 0});
		expect(measureViewport(container, VIEWPORT_WIDTH, VIEWPORT_HEIGHT)).toEqual({width: 800, height: VIEWPORT_HEIGHT});
	});

	it('clamps the device pixel ratio to a sane range', () =>
	{
		setDevicePixelRatio(3);
		expect(pixelRatio()).toBe(3);
		setDevicePixelRatio(0);
		expect(pixelRatio()).toBe(1);
		setDevicePixelRatio(16);
		expect(pixelRatio()).toBe(4);
	});
});

describe('Floorplanner2D mounting', () =>
{
	it('accepts an element and still accepts the deprecated id string', () =>
	{
		const {canvas} = buildFloorplannerDom(window);

		const byElement = new Floorplanner2D(canvas, new Floorplan());
		expect(byElement.canvasElement).toBe(canvas);
		expect(byElement.canvas).toBe('floorplanner-canvas');
		byElement.dispose();

		const byId = new Floorplanner2D('floorplanner-canvas', new Floorplan());
		expect(byId.canvasElement).toBe(canvas);
		byId.dispose();
	});

	it('sizes the canvas from its container, not the window', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		expect(planner.view.canvasWidth).toBe(640);
		expect(planner.view.canvasHeight).toBe(400);
		expect(canvas.style.width).toBe('640px');
		expect(canvas.style.height).toBe('400px');
		planner.dispose();
	});

	it('falls back to the viewport when the container has no size of its own', () =>
	{
		const {container, canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		setLayout(container, {width: 0, height: 0});

		const planner = new Floorplanner2D(canvas, new Floorplan());
		expect(planner.view.canvasWidth).toBe(VIEWPORT_WIDTH);
		expect(planner.view.canvasHeight).toBe(VIEWPORT_HEIGHT);
		planner.dispose();
	});

	it('does not resize its container - the host owns the layout', () =>
	{
		const {container, canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		expect(container.style.width).toBe('');
		expect(container.style.height).toBe('');
		planner.dispose();
	});

	it('scales the backing bitmap by the device pixel ratio and the context with it', () =>
	{
		setDevicePixelRatio(2);
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		// CSS pixels for layout, device pixels for the bitmap.
		expect(canvas.style.width).toBe('640px');
		expect(canvas.width).toBe(1280);
		expect(canvas.height).toBe(800);

		const transforms = canvasStub.context.calls.filter((c) => c.name === 'setTransform');
		expect(transforms.length).toBeGreaterThan(0);
		expect(transforms[transforms.length - 1].args).toEqual([2, 0, 0, 2, 0, 0]);

		// Drawing still happens in CSS pixels - the context carries the scale.
		const clears = canvasStub.context.calls.filter((c) => c.name === 'clearRect');
		expect(clears[clears.length - 1].args).toEqual([0, 0, 640, 400]);
		planner.dispose();
	});

	it('observes the container and redraws when it changes size', () =>
	{
		const {container, canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		expect(observer.liveCount()).toBe(1);
		expect(observer.instances[0].targets).toContain(container);

		setLayout(container, {width: 900, height: 500});
		observer.trigger();

		expect(planner.view.canvasWidth).toBe(900);
		expect(planner.view.canvasHeight).toBe(500);
		planner.dispose();
	});

	it('ignores a container resize that did not change the size', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		const before = canvasStub.context.calls.length;
		observer.trigger();
		expect(canvasStub.context.calls.length).toBe(before);
		planner.dispose();
	});
});

describe('Floorplanner2D pointer input', () =>
{
	it('registers its pointer listeners non-passive', () =>
	{
		const {canvas} = buildFloorplannerDom(window);
		const seen = [];
		const originalAdd = canvas.addEventListener.bind(canvas);
		canvas.addEventListener = (type, listener, options) =>
		{
			seen.push({type, options});
			return originalAdd(type, listener, options);
		};

		const planner = new Floorplanner2D(canvas, new Floorplan());
		const types = seen.map((s) => s.type);
		expect(types).toEqual(expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'pointerleave', 'pointercancel', 'dblclick']));
		seen.forEach((s) => {expect(s.options).toEqual({passive: false});});

		// preventDefault() in the touch path is only allowed because of the above.
		expect(canvas.style.touchAction).toBe('none');
		planner.dispose();
	});

	it('converts pointer coordinates against the canvas rect, not the document', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {left: 120, top: 60, width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		firePointer(canvas, 'pointermove', {clientX: 500, clientY: 260});

		expect(planner.mouseX).toBeCloseTo(Dimensioning.pixelToCm(380), 9);
		expect(planner.mouseY).toBeCloseTo(Dimensioning.pixelToCm(200), 9);
		expect(planner.rawMouseX).toBe(500);
		expect(planner.rawMouseY).toBe(260);
		planner.dispose();
	});

	it('stays accurate on a scrolled page, which the jQuery .offset() form did not', () =>
	{
		// getBoundingClientRect is viewport-relative like clientX; jQuery's
		// .offset() added the scroll position, so every hit test was off by it.
		const {canvas} = buildFloorplannerDom(window, {left: 0, top: 0, width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		// Page scrolled 300px: the canvas' top moves up in viewport coordinates
		// and clientY moves with it, so the canvas-local position is unchanged.
		setLayout(canvas, {left: 0, top: -300, width: 640, height: 400});
		firePointer(canvas, 'pointermove', {clientX: 100, clientY: -100});

		expect(planner.mouseY).toBeCloseTo(Dimensioning.pixelToCm(200), 9);
		planner.dispose();
	});

	it('seeds the pan origin from a touch press, but not from a mouse press', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		// Touch: no preceding move exists, so the press itself is the origin.
		firePointer(canvas, 'pointerdown', {clientX: 250, clientY: 150, pointerType: 'touch'});
		expect(planner.lastX).toBe(250);
		expect(planner.lastY).toBe(150);
		firePointer(canvas, 'pointerup', {clientX: 250, clientY: 150, pointerType: 'touch'});

		// Mouse: the last pointermove is the origin, exactly as before S2.
		firePointer(canvas, 'pointermove', {clientX: 400, clientY: 300});
		firePointer(canvas, 'pointerdown', {clientX: 410, clientY: 310});
		expect(planner.lastX).toBe(400);
		expect(planner.lastY).toBe(300);
		planner.dispose();
	});

	it('suppresses the browser gesture on a touch drag only', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		const touchMove = firePointer(canvas, 'pointermove', {clientX: 10, clientY: 10, pointerType: 'touch'});
		expect(touchMove.defaultPrevented).toBe(true);

		const mouseMove = firePointer(canvas, 'pointermove', {clientX: 20, clientY: 20});
		expect(mouseMove.defaultPrevented).toBe(false);
		planner.dispose();
	});

	it('releases the drag on pointercancel instead of panning forever', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		firePointer(canvas, 'pointerdown', {clientX: 100, clientY: 100, pointerType: 'touch'});
		expect(planner.mouseDown).toBe(true);

		firePointer(canvas, 'pointercancel', {clientX: 100, clientY: 100, pointerType: 'touch'});
		expect(planner.mouseDown).toBe(false);
		planner.dispose();
	});
});

describe('Floorplanner2D drawing', () =>
{
	it('no longer draws the red debug dot at the canvas centre', () =>
	{
		// floorplanner_view.js drew a 3px #FF0000 circle at the canvas centre on
		// every single wall draw. Removed in S2; the 2D goldens re-baseline here.
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		floorplan.update();

		const planner = new Floorplanner2D(canvas, floorplan);
		canvasStub.context.calls.length = 0;
		planner.view.draw();

		const centreDot = canvasStub.context.calls.filter((c) =>
			c.name === 'arc' && c.args[0] === 320 && c.args[1] === 200 && c.args[2] === 3);
		expect(centreDot).toEqual([]);
		planner.dispose();
	});

	it('still draws the origin cross-hair, which is a feature and not debug output', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());
		canvasStub.context.calls.length = 0;
		planner.view.draw();

		// Four bars: a blue cross, then a narrower one over it. Both are filled
		// blue - the '#FF0000' in drawOriginCrossHair sets strokeStyle, which
		// fillRect never reads.
		const crossHair = canvasStub.context.calls.filter((c) => c.name === 'fillRect' && c.fillStyle === '#0000FF');
		expect(crossHair.length).toBe(4);
		planner.dispose();
	});
});

describe('Floorplanner2D lifecycle', () =>
{
	it('detaches every listener it attached', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const floorplan = new Floorplan();

		listeners.reset();
		const planner = new Floorplanner2D(canvas, floorplan);

		expect(listeners.net(canvas)).toBeGreaterThan(0);
		expect(listeners.net(document)).toBe(2); // keyup + keydown
		expect(listeners.net(window)).toBe(2);   // resize + orientationchange
		expect(observer.liveCount()).toBe(1);

		planner.dispose();

		expect(listeners.net(canvas)).toBe(0);
		expect(listeners.net(document)).toBe(0);
		expect(listeners.net(window)).toBe(0);
		expect(listeners.leaks()).toEqual([]);
		expect(observer.liveCount()).toBe(0);
	});

	it('detaches from the floorplan and hands back the carbon sheet', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const floorplan = new Floorplan();
		const planner = new Floorplanner2D(canvas, floorplan);

		expect(floorplan.carbonSheet).toBe(planner.view.carbonSheet);
		expect(floorplan._listeners[EVENT_LOADED].length).toBe(1);

		planner.dispose();

		expect(floorplan.carbonSheet).toBeNull();
		expect(floorplan._listeners[EVENT_LOADED].length).toBe(0);
		expect(floorplan._listeners[EVENT_CORNER_ATTRIBUTES_CHANGED].length).toBe(0);
	});

	it('stops responding to input after dispose', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {left: 0, top: 0, width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());
		planner.dispose();

		firePointer(canvas, 'pointermove', {clientX: 500, clientY: 300});
		expect(planner.mouseX).toBe(0);
		expect(planner.mouseY).toBe(0);
	});

	it('restores the container to the state it was mounted in', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		canvas.style.touchAction = 'pan-y';

		const planner = new Floorplanner2D(canvas, new Floorplan());
		expect(canvas.style.touchAction).toBe('none');

		planner.dispose();
		expect(canvas.style.touchAction).toBe('pan-y');
	});

	it('is idempotent', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		const planner = new Floorplanner2D(canvas, new Floorplan());

		planner.dispose();
		expect(() => planner.dispose()).not.toThrow();
		expect(listeners.leaks()).toEqual([]);
	});

	it('survives repeated mount -> destroy -> remount with no listener growth', () =>
	{
		const {canvas} = buildFloorplannerDom(window, {width: 640, height: 400});
		listeners.reset();

		for (let i = 0; i < 5; i++)
		{
			const floorplan = new Floorplan();
			const planner = new Floorplanner2D(canvas, floorplan);
			planner.setMode(floorplannerModes.DRAW);
			firePointer(canvas, 'pointermove', {clientX: 100 + i, clientY: 100});
			planner.dispose();
		}

		expect(listeners.leaks()).toEqual([]);
		expect(observer.liveCount()).toBe(0);
	});
});
