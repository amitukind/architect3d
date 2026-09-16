/**
 * M-50: the whole gesture, with no pointer event dispatched at all
 * (RM-014 L4, finding Z-5, tier 2).
 *
 * ## Why this one is in the browser tier
 *
 * Because the easy way to make keyboard drawing "work" is to synthesise a
 * `PointerEvent` and dispatch it at the canvas, and a test that only checked
 * the outcome would pass on that. So the assertion is not about the walls - the
 * headless suite already pins those - it is about **what did not happen**: a
 * tripwire on window counts every pointer and mouse event of any kind, and the
 * count must be zero at the end of a session that drew a room, moved something
 * and deleted a wall.
 *
 * jsdom could host the same tripwire, but not the thing that makes it worth
 * having: real focus. `document.activeElement`, `:focus-visible`, the tab order
 * and whether a canvas can hold focus at all are the browser's business, and
 * the plan's keys are scoped to exactly that.
 *
 * ## What this deliberately does not do
 *
 * It does not add the item from the catalog. M-50 asks for one to be *selected
 * and moved*, and it is put on the plan directly so the assertion stays on the
 * gesture rather than on a pack fetch. Adding furniture without a pointer is
 * real and is covered by the catalog being ordinary focusable buttons.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';
import {Vector3} from 'three';

import App from '../../src/app/App.vue';
import {markTourSeen} from '../../src/app/composables/useTour.js';

/** Every way a pointer can announce itself, including the mouse compatibility set. */
const POINTER_EVENTS = [
	'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout',
	'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu',
	'touchstart', 'touchmove', 'touchend',
];

let wrapper;
let tripwire;

/**
 * Count anything pointer-shaped, in the capture phase on window, so nothing can
 * stop it before it is seen.
 */
function armTripwire()
{
	const seen = [];
	const handler = (event) => seen.push(event.type);
	POINTER_EVENTS.forEach((type) => window.addEventListener(type, handler, true));
	return {
		seen,
		disarm() {POINTER_EVENTS.forEach((type) => window.removeEventListener(type, handler, true));},
	};
}

function press(key, options = {})
{
	window.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign(
		{key, bubbles: true, cancelable: true}, options)));
}

function planCanvas()
{
	return document.getElementById('floorplanner-canvas');
}

function state()
{
	return wrapper.vm.$.setupState;
}

function planner()
{
	return state().store.floorplanner.value;
}

/** A footprint on the plan, without a catalog round trip. */
function fakeItem(id, x, y)
{
	return {
		id,
		metadata: {itemName: id, itemType: 1},
		position: new Vector3(x, 0, y),
		halfSize: new Vector3(30, 30, 30),
		rotation: {y: 0},
		fixed: false,
		visible: true,
		getHeight: () => 60,
		getWidth: () => 60,
		getDepth: () => 60,
	};
}

beforeEach(async () =>
{
	window.localStorage.clear();
	markTourSeen();
	const root = document.createElement('div');
	root.id = 'app-root';
	document.body.appendChild(root);
	wrapper = mount(App, {attachTo: root});
	await nextTick();
	await nextTick();
	tripwire = armTripwire();
});

afterEach(() =>
{
	if (tripwire) {tripwire.disarm(); tripwire = null;}
	wrapper.unmount();
	document.querySelectorAll('#app-root').forEach((node) => node.remove());
	document.body.innerHTML = '';
});

describe('M-50: a plan edited with no pointer at all', () =>
{
	it('reaches the plan from the skip link, by focus alone', async () =>
	{
		const link = document.querySelector('#app-shell a[href="#floorplanner-canvas"]');
		expect(link).not.toBeNull();

		// A real browser, so this is real focus rather than an attribute.
		link.focus();
		expect(document.activeElement).toBe(link);

		planCanvas().focus();
		await nextTick();
		expect(document.activeElement).toBe(planCanvas());
		expect(tripwire.seen).toEqual([]);
	});

	it('draws a room, moves an item and deletes a wall, and dispatches nothing', async () =>
	{
		planCanvas().focus();
		await nextTick();

		const plan = planner();
		const floorplan = plan.floorplan;
		floorplan.getWalls().slice().forEach((wall) => wall.remove());
		expect(floorplan.getWalls().length).toBe(0);

		// --- a room, four presses and the arrows between them ---
		press('w');
		press('ArrowRight');
		press('Enter');
		press('ArrowRight');
		press('ArrowRight');
		press('ArrowRight');
		press('ArrowRight');
		press('Enter');
		press('ArrowDown');
		press('ArrowDown');
		press('ArrowDown');
		press('ArrowDown');
		press('Enter');
		press('ArrowLeft');
		press('ArrowLeft');
		press('ArrowLeft');
		press('ArrowLeft');
		press('Enter');
		press('ArrowUp');
		press('ArrowUp');
		press('ArrowUp');
		press('ArrowUp');
		press('Enter');

		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(4);
		floorplan.update();
		expect(floorplan.getRooms().length).toBe(1);

		// --- an item, selected and moved ---
		press('v');
		const item = fakeItem('sofa', 250, 250);
		state().store.model.value.level.items = [item];
		floorplan.updateItemProjection?.();
		await nextTick();

		plan.placeCursor(item.position.x, item.position.z);
		// `' '`, not `'space'`: that is the `key` a browser actually sends, and
		// `describe()` in useShortcuts is what turns it into the binding's spelling.
		// Pressing the already-normalised name would test the map against itself.
		press(' ');
		expect(plan.cursorCarrying).toBe(true);
		press('ArrowDown');
		press('ArrowDown');
		press(' ');
		expect(plan.cursorCarrying).toBe(false);

		// --- a wall, deleted ---
		const doomed = floorplan.getWalls()[0];
		press('x');
		plan.placeCursor((doomed.getStartX() + doomed.getEndX()) / 2,
			(doomed.getStartY() + doomed.getEndY()) / 2);
		press('Enter');
		expect(floorplan.getWalls().length).toBe(3);

		// --- and the whole point ---
		expect(tripwire.seen, `pointer events were dispatched: ${tripwire.seen.join(', ')}`).toEqual([]);
	});

	/**
	 * The canvas is `:focus-visible` to the browser, which is the half of the
	 * focus ring that is a behaviour rather than a stylesheet.
	 *
	 * The other half is NOT asserted here, and the reason is a finding RM-014 L2
	 * already recorded: `vitest.browser.config.mjs` registers the Vue plugin and
	 * not the Tailwind one, so `@import 'tailwindcss'` resolves to nothing and
	 * **the whole browser tier runs unstyled**. The first version of this checked
	 * `getComputedStyle(canvas).outlineOffset` for the inset `-2px` and read
	 * `0px`, because there is no `app.css` in this tier to have a rule in.
	 *
	 * Left as an assertion about focus rather than about paint, and recorded as
	 * the second sprint to hit the same missing plugin. Asserting the rule text
	 * instead would be asserting that a constant equals itself.
	 */
	it('is focus-visible to the browser when reached by keyboard', async () =>
	{
		const canvas = planCanvas();
		canvas.focus();
		await nextTick();

		expect(document.activeElement).toBe(canvas);
		expect(canvas.matches(':focus-visible')).toBe(true);
		expect(tripwire.seen).toEqual([]);
	});

	it('keeps the arrow keys off the plan when the 3D pane has focus', async () =>
	{
		const viewer = document.getElementById('viewer');
		viewer.focus();
		await nextTick();
		expect(document.activeElement).toBe(viewer);

		press('ArrowRight');
		expect(planner().cursorVisible).toBe(false);
		expect(tripwire.seen).toEqual([]);
	});
});
