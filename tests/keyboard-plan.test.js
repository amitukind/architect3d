// @vitest-environment jsdom
/**
 * The plan, driven from the keyboard, through the shell (RM-014 L4).
 *
 * `plan-cursor.test.js` pins the library half - a cursor, and a press that goes
 * through the same three methods a pointer does. This is the other half: the
 * keys that reach it, the focus that scopes them, and the two things a keyboard
 * user needs before any of that is reachable at all - a tab stop on the plan and
 * a way past the chrome to get to it.
 *
 * ## The scoping is the interesting part
 *
 * Four other things on this page want the arrow keys: OrbitControls pans the 3D
 * camera with them, the pane splitter resizes with them, an inspector field
 * moves its caret, and a scrollable panel scrolls. So the plan's bindings are
 * live only while the plan canvas has focus, and when they are not live they
 * must *yield* the key rather than swallow it - which is the opposite of what
 * every other disabled binding in the map does, and is therefore worth its own
 * assertions.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../src/app/App.vue';
import {markTourSeen} from '../src/app/composables/useTour.js';
import {Main} from '../src/scripts/three/main.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

let canvasStub;
let observer;
let pointerApis;
let listeners;
let renderers;

async function mountApp()
{
	window.localStorage.clear();
	markTourSeen();
	const wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	return wrapper;
}

/** The live Floorplanner2D behind the shell. */
function planner(wrapper)
{
	return wrapper.vm.$.setupState.store.floorplanner.value;
}

function planCanvas()
{
	return document.getElementById('floorplanner-canvas');
}

/**
 * A keydown on window, which is where the one keyboard map listens.
 *
 * Returns the event so a test can ask whether it was claimed - `defaultPrevented`
 * is how "this binding took the key" is visible from outside.
 */
function press(key, {shiftKey = false, repeat = false} = {})
{
	const event = new window.KeyboardEvent('keydown', {
		key, shiftKey, repeat, bubbles: true, cancelable: true,
	});
	window.dispatchEvent(event);
	return event;
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = 1024;
	window.innerHeight = 768;
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

describe('reaching the plan without a pointer', () =>
{
	it('puts the plan in the tab order and names its keys', async () =>
	{
		const wrapper = await mountApp();
		const canvas = planCanvas();

		expect(canvas.getAttribute('tabindex')).toBe('0');
		// `application` is what tells a screen reader to pass the arrow keys
		// through rather than using them to browse the document.
		expect(canvas.getAttribute('role')).toBe('application');
		expect(canvas.getAttribute('aria-label')).toMatch(/arrow keys/i);

		wrapper.unmount();
	});

	it('offers a skip link that lands somewhere a person can work', async () =>
	{
		const wrapper = await mountApp();
		const shell = document.getElementById('app-shell');
		const link = shell.querySelector('a[href="#floorplanner-canvas"]');

		expect(link).not.toBeNull();
		expect(link.textContent.trim()).toBe('Skip to the plan');
		// First in the tab order, or it is not a skip link.
		const focusables = shell.querySelectorAll('a[href], button, [tabindex="0"]');
		expect(focusables[0]).toBe(link);
		// It points at something focusable: a bare landmark would move the caret
		// and leave focus where it was.
		expect(document.querySelector(link.getAttribute('href')).getAttribute('tabindex')).toBe('0');

		wrapper.unmount();
	});

	it('gives the 3D pane a tab stop too, since its arrow keys are scoped to it', async () =>
	{
		const wrapper = await mountApp();
		const viewer = document.getElementById('viewer');
		expect(viewer.getAttribute('tabindex')).toBe('0');
		wrapper.unmount();
	});
});

describe('the plan cursor keys', () =>
{
	it('do nothing at all until the plan has focus', async () =>
	{
		const wrapper = await mountApp();
		press('ArrowRight');
		expect(planner(wrapper).cursorVisible).toBe(false);
		wrapper.unmount();
	});

	it('yield the key when the plan does not have focus, rather than eating it', async () =>
	{
		const wrapper = await mountApp();

		// Not claimed: the 3D camera, the pane splitter and a scrolling panel all
		// want these, and a binding that is inactive must not answer for them.
		expect(press('ArrowRight').defaultPrevented).toBe(false);
		expect(press('ArrowUp').defaultPrevented).toBe(false);

		// Contrast: a key this map does claim unconditionally.
		expect(press('w').defaultPrevented).toBe(true);

		wrapper.unmount();
	});

	it('reveal and then move the cursor once the plan has focus', async () =>
	{
		const wrapper = await mountApp();
		planCanvas().focus();
		await nextTick();

		expect(press('ArrowRight').defaultPrevented).toBe(true);
		expect(planner(wrapper).cursorVisible).toBe(true);
		const first = planner(wrapper).cursorPoint();

		press('ArrowRight');
		expect(planner(wrapper).cursorPoint().x).toBeGreaterThan(first.x);

		wrapper.unmount();
	});

	it('take a coarse step with shift held', async () =>
	{
		const wrapper = await mountApp();
		planCanvas().focus();
		await nextTick();

		press('ArrowRight');
		const from = planner(wrapper).cursorPoint().x;
		press('ArrowRight');
		const fine = planner(wrapper).cursorPoint().x - from;

		const before = planner(wrapper).cursorPoint().x;
		press('ArrowRight', {shiftKey: true});
		const coarse = planner(wrapper).cursorPoint().x - before;

		expect(coarse).toBe(fine * 4);
		wrapper.unmount();
	});

	/**
	 * The one case `useShortcuts` was written expecting. Its repeat guard used to
	 * sit above the lookup with a comment saying arrow-key nudging would opt out
	 * here if it existed; this is that nudging.
	 */
	it('repeat while an arrow is held, and nothing else does', async () =>
	{
		const wrapper = await mountApp();
		planCanvas().focus();
		await nextTick();

		press('ArrowRight');
		const start = planner(wrapper).cursorPoint().x;
		press('ArrowRight', {repeat: true});
		press('ArrowRight', {repeat: true});
		expect(planner(wrapper).cursorPoint().x).toBeGreaterThan(start);

		// A held tool key still fires once per press.
		const mode = wrapper.vm.$.setupState.editor.mode.value;
		wrapper.vm.$.setupState.editor.setMode(floorplannerModes.MOVE);
		press('w', {repeat: true});
		expect(wrapper.vm.$.setupState.editor.mode.value).toBe(floorplannerModes.MOVE);
		expect(mode).not.toBe(undefined);

		wrapper.unmount();
	});

	it('draw a wall with Enter, and put the cursor away on blur', async () =>
	{
		const wrapper = await mountApp();
		const plan = planner(wrapper);
		const before = plan.floorplan.getWalls().length;

		planCanvas().focus();
		await nextTick();
		press('w');

		press('ArrowRight');
		press('Enter');
		press('ArrowRight');
		press('ArrowRight');
		press('Enter');
		expect(plan.floorplan.getWalls().length).toBe(before + 1);

		planCanvas().blur();
		await nextTick();
		expect(plan.cursorVisible).toBe(false);

		wrapper.unmount();
	});

	/**
	 * Space is spelled `' '` by the browser and `'space'` by the binding table,
	 * and `describe()` in `useShortcuts` is the thing that joins them. Pressing
	 * the already-normalised name would test the map against itself.
	 */
	it('pick up and put down with the space key a browser actually sends', async () =>
	{
		const wrapper = await mountApp();
		const plan = planner(wrapper);
		planCanvas().focus();
		await nextTick();

		press('ArrowRight');
		expect(press(' ').defaultPrevented).toBe(true);
		expect(plan.cursorCarrying).toBe(true);
		press(' ');
		expect(plan.cursorCarrying).toBe(false);

		wrapper.unmount();
	});

	it('are listed in the shortcuts sheet, so they can be found', async () =>
	{
		const wrapper = await mountApp();
		// Refs are unwrapped on the setupState proxy, so this is the array itself.
		const map = wrapper.vm.$.setupState.bindings;
		const cursor = map.filter((binding) => binding.group === 'Plan cursor');

		// Four directions, four shifted aliases, Enter and Space.
		expect(cursor).toHaveLength(10);
		expect(cursor.filter((binding) => !binding.alias)).toHaveLength(6);
		expect(cursor.every((binding) => binding.yieldWhenDisabled)).toBe(true);

		wrapper.unmount();
	});

	/**
	 * And listed even when they are not live. The sheet renders from the same
	 * array the map dispatches from, and opening the sheet moves focus off the
	 * plan - so bindings that appeared only while the plan had focus would be
	 * documented nowhere a person could ever read them.
	 */
	it('appear in the rendered sheet even though opening it takes focus away', async () =>
	{
		const wrapper = await mountApp();
		planCanvas().focus();
		await nextTick();

		wrapper.vm.$.setupState.shortcutsOpen = true;
		await nextTick();
		await nextTick();

		const headings = [...document.querySelectorAll('h3')].map((node) => node.textContent.trim());
		expect(headings).toContain('Plan cursor');

		wrapper.unmount();
	});
});
