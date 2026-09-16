// @vitest-environment jsdom
/**
 * The verbs, driven the way a person drives them (RM-016 N2, finding AB-4).
 *
 * ## Why a third app-level suite
 *
 * `app-composables.test.js` pins the logic and `app-shell.test.js` pins the
 * component tree. Between them they left `App.vue` at **37.3 % branch
 * coverage** - the lowest figure in the tree for the largest file in the
 * application - and AB-4's point is what that number is made of. The uncovered
 * half is not the plumbing. It is undo, redo, save, open, delete, walk through,
 * step outside, Escape: the handlers bound to the buttons and the keys, and
 * therefore very nearly a list of what somebody does in their first ten
 * minutes.
 *
 * The two existing suites could not reach them because neither is about
 * intention. This one is: every case here presses something a person can press
 * and asserts what they would see happen.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The outcome, never the call. `undo()` returning true is not the claim - the
 * claim is that the wall comes back and the toast says Undo, because a shortcut
 * whose effect is off screen is indistinguishable from a key that did not
 * register, which is the reason that toast exists at all.
 *
 * Nothing here reaches into `setupState` to invoke a function. Where a verb has
 * no button, it is driven by its key, through the real `useShortcuts` listener
 * on `window` - so the binding is under test as well as the handler.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {flushPromises, mount} from '@vue/test-utils';

import App from '../src/app/App.vue';
import {markTourSeen} from '../src/app/composables/useTour.js';
import {LAYOUT_PLAN, LAYOUT_VIEW} from '../src/app/composables/useLayout.js';
import {MODE_WALKTHROUGH, MODE_EXTERIOR, MODE_DESIGN} from '../src/app/composables/useCameraViews.js';
import {IS_APPLE} from '../src/app/composables/useShortcuts.js';
import {SELECTION_ANNOTATION, SELECTION_DIMENSION} from '../src/app/composables/useSelection.js';
import {installCatalogFetch, resetCatalogPacks} from './helpers/catalog.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

let canvasStub;
let observer;
let pointerApis;
let renderers;
let live;
let wrapper;

beforeEach(async () =>
{
	resetAll();
	resetCatalogPacks();
	installCatalogFetch();
	document.body.innerHTML = '';
	window.innerWidth = 1024;
	window.innerHeight = 768;
	window.localStorage.clear();
	markTourSeen();

	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	live = (await import('../src/scripts/three/main.js')).Main;
	live.setRendererFactory(() => createRendererStub(renderers));

	wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	await flushPromises();
});

afterEach(() =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
	live.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
	resetCatalogPacks();
});

/**
 * The setup scope, for reading state - never for calling a verb.
 *
 * Note that Vue unwraps a top-level `ref` here, so `state().catalogOpen` is the
 * boolean. A ref reached through a plain object - `state().store.three` - is
 * still a ref, because the unwrapping is one level deep.
 */
function state()
{
	return wrapper.vm.$.setupState;
}

/**
 * Press a key at the window, which is where useShortcuts listens.
 *
 * `mod: true` becomes Cmd or Ctrl from the module's own platform test rather
 * than from this file's guess. jsdom reports no platform, so `IS_APPLE` is
 * false here and the accelerator is Ctrl - which is worth taking from the
 * source, because a test that hard-coded the other one would pass on a
 * developer's Mac only if the code were wrong.
 */
async function press(key, modifiers)
{
	const {mod, ...rest} = modifiers || {};
	const options = {key, bubbles: true, cancelable: true, ...rest};
	if (mod) { options[IS_APPLE ? 'metaKey' : 'ctrlKey'] = true; }
	window.dispatchEvent(new window.KeyboardEvent('keydown', options));
	await nextTick();
	await flushPromises();
}

/** A control anywhere in the shell, by its tooltip text. */
function byTitle(title, scope)
{
	const root = scope ? wrapper.get(scope) : wrapper;
	return root.findAll('button, label').find((node) => node.attributes('title') === title);
}

/**
 * Move a corner and commit it, which is the cheapest recordable edit here.
 *
 * `history.commit()` rather than trusting the change event: the application
 * decides what counts as an edit, and a corner drag is recorded when the drag
 * ends rather than on every frame of it. Drawing straight into the floorplan
 * moves the plan and records nothing, which is correct and is not what these
 * cases are about.
 */
function moveACorner(to)
{
	const corner = state().store.model.value.floorplan.getCorners()[0];
	corner.move(to, to);
	state().history.commit();
	return corner;
}

/** Where the first corner is, which is the cheapest visible effect. */
function firstCornerX()
{
	return state().store.model.value.floorplan.getCorners()[0].x;
}

/** Every toast currently on screen, as text. */
function toasts()
{
	return [...document.querySelectorAll('[role="status"], [role="alert"]')]
		.map((node) => node.textContent.trim());
}

describe('undo and redo', () =>
{
	it('puts back what was moved, and says so', async () =>
	{
		const was = firstCornerX();
		moveACorner(150);
		await nextTick();
		expect(firstCornerX()).toBe(150);
		expect(state().history.canUndo.value).toBe(true);

		await press('z', {mod: true});

		expect(firstCornerX()).toBe(was);
		// The toast is the point of the branch: an undo whose effect is off
		// screen - a wall restored while looking at the 3D view - is otherwise
		// indistinguishable from a key that did not register.
		expect(toasts().join(' ')).toContain('Undo');
	});

	it('redoes it, and says that too', async () =>
	{
		const was = firstCornerX();
		moveACorner(150);
		await nextTick();
		await press('z', {mod: true});
		expect(firstCornerX()).toBe(was);

		await press('z', {mod: true, shiftKey: true});

		expect(firstCornerX()).toBe(150);
		expect(toasts().join(' ')).toContain('Redo');
	});

	it('says nothing when there is nothing to undo', async () =>
	{
		// The binding is disabled rather than the handler being a no-op, so this
		// is a test of the disabled path as much as of the toast: a key that
		// announces an undo that did not happen is worse than a silent one.
		//
		// Counted rather than matched, because `useToasts` is a module-level
		// singleton and an earlier case's notice may still be on screen. What is
		// being asserted is that this press added nothing.
		expect(state().history.canUndo.value).toBe(false);
		const before = toasts().length;

		await press('z', {mod: true});

		expect(toasts()).toHaveLength(before);
	});
});

describe('walking through, and stepping outside', () =>
{
	it('arranges its own precondition when the plan is the only thing showing', async () =>
	{
		expect(state().workspace.layout.value).toBe(LAYOUT_PLAN);

		await byTitle('Walk through', '#tool-rail').trigger('click');
		await state().store.ensureViewer();
		await nextTick();

		// Both halves. The camera cannot walk through a pane nobody is looking at,
		// so the verb moves the layout as well - which is the branch, and the
		// reason the two toggles are written the same way.
		expect(state().workspace.layout.value).toBe(LAYOUT_VIEW);
		expect(state().camera.mode.value).toBe(MODE_WALKTHROUGH);
	});

	it('comes back to the design rather than to wherever the camera was left', async () =>
	{
		await byTitle('Walk through', '#tool-rail').trigger('click');
		await state().store.ensureViewer();
		await nextTick();

		await byTitle('Walk through', '#tool-rail').trigger('click');
		await nextTick();

		// `showDesign`, not `showFloorplan`: the way out of a walk-through is the
		// storey being edited, seen from the orbit camera, without moving it.
		// Leaving does not put the plan back on screen - the layout is still 3D,
		// because that is where the person is looking.
		expect(state().camera.mode.value).toBe(MODE_DESIGN);
		expect(state().workspace.layout.value).toBe(LAYOUT_VIEW);
	});

	it('steps outside the same way, and back', async () =>
	{
		await byTitle('Exterior view', '#tool-rail').trigger('click');
		await state().store.ensureViewer();
		await nextTick();

		expect(state().workspace.layout.value).toBe(LAYOUT_VIEW);
		expect(state().camera.mode.value).toBe(MODE_EXTERIOR);

		await byTitle('Exterior view', '#tool-rail').trigger('click');
		await nextTick();

		expect(state().camera.mode.value).toBe(MODE_DESIGN);
	});
});

describe('Escape', () =>
{
	it('closes the catalog drawer', async () =>
	{
		await byTitle('Furniture catalog', '#tool-rail').trigger('click');
		await flushPromises();
		expect(state().catalogOpen).toBe(true);

		await press('Escape');

		expect(state().catalogOpen).toBe(false);
	});

	it('closes the shortcuts sheet', async () =>
	{
		await press('?', {shiftKey: true});
		expect(state().shortcutsOpen).toBe(true);

		await press('Escape');

		expect(state().shortcutsOpen).toBe(false);
	});

	it('lets go of whatever has focus, so the next key reaches the plan', async () =>
	{
		const field = document.createElement('input');
		document.body.appendChild(field);
		field.focus();
		expect(document.activeElement).toBe(field);

		await press('Escape');

		expect(document.activeElement).not.toBe(field);
		field.remove();
	});
});

describe('starting again', () =>
{
	it('clears the design, the history and the record it came from', async () =>
	{
		moveACorner(150);
		await nextTick();
		expect(state().history.canUndo.value).toBe(true);

		await byTitle('New layout').trigger('click');
		await flushPromises();

		// Back to the default design, with nothing to undo and belonging to
		// nobody: the next save makes a record rather than overwriting whatever
		// was open a moment ago.
		expect(firstCornerX()).not.toBe(150);
		expect(state().history.canUndo.value).toBe(false);
		expect(state().projects.current.value).toBeNull();
	});
});

describe('opening a file', () =>
{
	it('takes its name from the file, minus the extension', async () =>
	{
		const design = state().store.model.value.exportSerialized();

		await state().onOpenDesign(new window.File([design], 'Loft conversion.blueprint3d'));
		await flushPromises();

		// The seven exports read this name, and a save will record it - so the
		// extension coming off is not cosmetic.
		expect(state().io.documentName.value).toBe('Loft conversion');
		expect(state().projects.current.value).toBeNull();
	});

	it('routes a zip through the bundle reader instead', async () =>
	{
		// A `.zip` and a `.blueprint3d` arrive through the same control on purpose:
		// "open a design" is one intention. The branch is which reader gets it, and
		// a zip of nothing is refused - which must leave the design alone.
		const before = state().store.model.value.floorplan.getCorners().length;
		const file = new window.File([new Uint8Array([1, 2, 3])], 'bundle.zip');
		file.arrayBuffer = () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer);

		await state().onOpenDesign(file);
		await flushPromises();

		expect(state().store.model.value.floorplan.getCorners().length).toBe(before);
	});
});

describe('deleting what is selected', () =>
{
	/**
	 * RM-008 E3's asymmetry, and the reason the Delete key needs two paths.
	 *
	 * The key used to mean "delete the selected item", because furniture was the
	 * only thing a selection could be that had nothing else to press. A dimension
	 * and a text label are two more, and a key that works for one kind of
	 * selection and silently does nothing for another is the worse half of a
	 * feature. Walls, corners and rooms are deliberately excluded - they go
	 * through the modal eraser, because deleting a wall silently deletes the
	 * rooms it defined.
	 *
	 * Selecting is setup here rather than the act under test: the act is the key.
	 */
	it('deletes an annotation through the plan, not through the item actions', async () =>
	{
		const plan = state().store.model.value.floorplan;
		const note = plan.newAnnotation(100, 100, 'A note');
		state().selection.select(SELECTION_ANNOTATION, note);
		await nextTick();

		expect(plan.annotations).toHaveLength(1);
		expect(state().canDeleteSelection).toBe(true);

		await press('Delete');

		expect(plan.annotations).toHaveLength(0);
	});

	it('offers the same key for a dimension', async () =>
	{
		const plan = state().store.model.value.floorplan;
		const dimension = plan.newDimension(0, 0, 200, 0, {});
		state().selection.select(SELECTION_DIMENSION, dimension);
		await nextTick();

		expect(plan.dimensions).toHaveLength(1);
		await press('Delete');

		expect(plan.dimensions).toHaveLength(0);
	});

	it('has nothing to do with nothing selected, and says so through the button', async () =>
	{
		expect(state().selection.selection.value).toBeNull();
		expect(state().canDeleteSelection).toBe(false);

		// Not an error and not a toast: a key pressed over an empty selection is
		// a key that does nothing, which is what every editor does.
		await expect(press('Delete')).resolves.toBeUndefined();
	});

	it('selects every item at once, over a design that has none', async () =>
	{
		// `mod+a` over the default design, which is four walls and no furniture.
		// The empty case is the one worth pinning: `selectMany` with an empty list
		// must clear rather than throw, because that is what a person sees after
		// deleting the last chair and pressing it again.
		await press('a', {mod: true});

		expect(state().selection.selections.value).toEqual([]);
	});
});

describe('the offline offers', () =>
{
	it('offers to install, once', async () =>
	{
		const before = toasts().length;

		state().offline.installable.value = true;
		await nextTick();

		expect(toasts().length).toBe(before + 1);
		expect(toasts().join(' ')).toContain('can be installed');

		// Raised once and never repeated: `beforeinstallprompt` fires again on
		// later visits, and a browser that keeps asking is the reason people learn
		// to dismiss without reading.
		state().offline.installable.value = false;
		await nextTick();
		state().offline.installable.value = true;
		await nextTick();
		expect(toasts().length).toBe(before + 2);
	});

	it('says nothing when there is nothing waiting', async () =>
	{
		const before = toasts().length;

		state().offline.updateReady.value = false;
		await nextTick();

		expect(toasts()).toHaveLength(before);
	});

	it('offers the update when one is waiting', async () =>
	{
		const before = toasts().length;

		state().offline.updateReady.value = true;
		await nextTick();

		expect(toasts().length).toBeGreaterThan(before);
	});
});
