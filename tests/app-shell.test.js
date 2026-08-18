// @vitest-environment jsdom
/**
 * The Vue shell, mounted for real.
 *
 * app-composables.test.js pins the logic; this pins the component tree around
 * it - that the app boots, that the workspace layouts show what they should,
 * that the tool rail highlight renders, that the catalog is populated from the
 * catalog file, and that mounting and unmounting the whole thing is symmetric.
 *
 * The last one is the reason the S6 sprint could happen at all. S2 gave the
 * library a `dispose()`; this is where a Vue route's unmount is shown to use
 * it, leaving no listener and no renderer behind.
 *
 * ## What changed when the shell was rebuilt
 *
 * The card flip is gone, so the assertions that read `#interfaces.flipped` now
 * read the workspace layout instead. The two per-viewport toolbars are gone,
 * so the file actions are looked up in the top bar and the editor modes in the
 * tool rail. The catalog is a drawer rather than a modal accordion, so "one
 * section open at a time" is replaced by what the drawer actually promises:
 * search and a category filter over one flat list.
 *
 * Buttons are still found by `title`. Reka's tooltip supplies the accessible
 * name now, but Tip passes the label through to `title` as well - partly as a
 * fallback where the portal cannot render, and partly so this suite keeps
 * identifying controls the way it always has.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../src/app/App.vue';
import {Main} from '../src/scripts/three/main.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import catalog from '../src/catalog/catalog.json';
import openings from '../src/catalog/openings.json';
import {LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from '../src/app/composables/useLayout.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

let canvasStub;
let observer;
let pointerApis;
let listeners;
let renderers;

/**
 * Listeners that would actually outlive the app.
 *
 * A handler left on a detached element is collected with the element, so Vue's
 * own `@click` bindings on unmounted nodes are not leaks. What matters is
 * anything still attached to window, to document, or to an element that is
 * still in the page - and, as in the S2 suite, three's ImageLoader handlers on
 * an Image that jsdom will never finish loading are an artefact of the
 * environment rather than ours.
 */
function realLeaks()
{
	return listeners.leaks().filter(({target}) =>
	{
		if (target instanceof window.HTMLImageElement)
		{
			return false;
		}
		if (target === window || target === document)
		{
			return true;
		}
		return Boolean(target && target.isConnected);
	});
}

/**
 * App.vue has several root nodes - the shell, the catalog drawer, the shortcuts
 * dialog, the toast stack - so selectors are scoped below rather than named
 * from the root (test-utils cannot match a descendant selector whose ancestor
 * is itself one of the roots).
 *
 * `localStorage` is cleared first: useLayout and useTheme both persist, and a
 * test that left the workspace in split mode would otherwise decide the boot
 * state of the next one.
 */
async function mountApp()
{
	window.localStorage.clear();
	const wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	return wrapper;
}

/** A button anywhere in the shell, by its tooltip text. */
function byTitle(wrapper, title, scope)
{
	const root = scope ? wrapper.get(scope) : wrapper;
	return root.findAll('button, label').find((node) => node.attributes('title') === title);
}

function railButton(wrapper, title)
{
	return byTitle(wrapper, title, '#tool-rail');
}

/** The 2D / Split / 3D segmented control, by its visible label. */
function layoutButton(wrapper, label)
{
	return wrapper.findAll('[aria-label="Workspace layout"] button')
		.find((button) => button.text() === label);
}

/** What App.vue's own state says the workspace is showing. */
function layoutOf(wrapper)
{
	return wrapper.vm.$.setupState.workspace.layout.value;
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

describe('App boot', () =>
{
	it('mounts both viewports and loads the default design', async () =>
	{
		const wrapper = await mountApp();

		expect(wrapper.find('canvas#floorplanner-canvas').exists()).toBe(true);
		expect(wrapper.find('#viewer').exists()).toBe(true);
		expect(renderers).toHaveLength(1);

		wrapper.unmount();
	});

	it('boots into the plan-only layout', async () =>
	{
		const wrapper = await mountApp();

		expect(layoutOf(wrapper)).toBe(LAYOUT_PLAN);
		expect(layoutButton(wrapper, '2D').classes()).toContain('is-active');
		expect(layoutButton(wrapper, '3D').classes()).not.toContain('is-active');

		wrapper.unmount();
	});

	it('keeps both viewports laid out in every layout, never collapsed', async () =>
	{
		// The constraint the whole Workspace component exists to satisfy: the
		// library measures its containers with clientWidth/clientHeight, so a
		// hidden pane must be transparent rather than absent or zero-wide. A
		// regression here is a divide-by-zero in the projection matrix, which is
		// exactly the kind of thing that only shows up in a browser.
		const wrapper = await mountApp();
		const panes = () => wrapper.get('#workspace').element.children;

		for (const layout of [LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW])
		{
			wrapper.vm.$.setupState.workspace.setLayout(layout);
			await nextTick();

			expect(wrapper.find('canvas#floorplanner-canvas').exists()).toBe(true);
			expect(wrapper.find('#viewer').exists()).toBe(true);

			// Neither pane is display:none, and neither has been given a zero width.
			for (const pane of [panes()[0], panes()[1]])
			{
				expect(pane.style.display).not.toBe('none');
				expect(pane.style.width).not.toBe('0%');
				expect(pane.style.width).not.toBe('0px');
			}
		}

		wrapper.unmount();
	});

	it('renders the whole camera preset cross', async () =>
	{
		const wrapper = await mountApp();
		const titles = wrapper.get('#viewcube').findAll('button').map((b) => b.attributes('title'));

		expect(titles).toEqual(expect.arrayContaining([
			'Top view', 'Isometric view', 'Front elevation', 'Left elevation', 'Right elevation',
		]));

		// Present in the demo's markup but commented out; restored in S6 so that
		// parity scenario P10 is reachable without the console. It lives on the
		// tool rail now rather than the bottom bar.
		expect(railButton(wrapper, 'Walk through')).toBeTruthy();

		wrapper.unmount();
	});
});

describe('the tool rail highlight', () =>
{
	it('marks the active mode, and moves with it', async () =>
	{
		// The demo's version of this never rendered - the handler compared an
		// event object to a mode number. See useFloorplannerMode.
		const wrapper = await mountApp();

		const move = railButton(wrapper, 'Select and move');
		const draw = railButton(wrapper, 'Draw walls');
		const remove = railButton(wrapper, 'Delete walls');

		expect(move.classes()).toContain('is-active');
		expect(draw.classes()).not.toContain('is-active');

		await draw.trigger('click');

		expect(railButton(wrapper, 'Draw walls').classes()).toContain('is-active');
		expect(railButton(wrapper, 'Select and move').classes()).not.toContain('is-active');
		expect(remove.classes()).not.toContain('is-active');
		expect(railButton(wrapper, 'Draw walls').attributes('aria-pressed')).toBe('true');

		wrapper.unmount();
	});

	it('shows the escape hint only while drawing', async () =>
	{
		const wrapper = await mountApp();

		expect(wrapper.find('.btn-hint').element.style.display).toBe('none');
		await railButton(wrapper, 'Draw walls').trigger('click');
		expect(wrapper.find('.btn-hint').element.style.display).not.toBe('none');
		expect(wrapper.find('.btn-hint').text()).toContain('Esc');

		wrapper.unmount();
	});

	it('follows a mode the library sets by itself', async () =>
	{
		const wrapper = await mountApp();
		await railButton(wrapper, 'Draw walls').trigger('click');

		// Esc, straight at the library - no click involved.
		wrapper.vm.$.setupState.editor.setMode(floorplannerModes.MOVE);
		await wrapper.vm.$nextTick();

		expect(railButton(wrapper, 'Select and move').classes()).toContain('is-active');

		wrapper.unmount();
	});

	it('hides the plan tools when the plan is not on screen', async () =>
	{
		const wrapper = await mountApp();
		expect(railButton(wrapper, 'Draw walls')).toBeTruthy();

		wrapper.vm.$.setupState.workspace.setLayout(LAYOUT_VIEW);
		await nextTick();

		// They act on a canvas that is not visible; the demo hid its camera
		// controls in the 2D pane for the same reason.
		expect(railButton(wrapper, 'Draw walls')).toBeUndefined();
		expect(railButton(wrapper, 'Furniture catalog')).toBeTruthy();

		wrapper.unmount();
	});
});

describe('switching layouts', () =>
{
	it('moves between plan, split and 3D, and resumes the viewer when 3D is shown', async () =>
	{
		const wrapper = await mountApp();
		const three = wrapper.vm.$.setupState.store.three.value;

		// Boots into the plan, so the 3D render loop is paused - nobody is looking
		// at it.
		expect(three.pauseRender).toBe(true);

		await layoutButton(wrapper, '3D').trigger('click');
		expect(layoutOf(wrapper)).toBe(LAYOUT_VIEW);
		expect(three.pauseRender).toBe(false);

		// Split counts as showing the design: both panes are live.
		await layoutButton(wrapper, 'Split').trigger('click');
		expect(layoutOf(wrapper)).toBe(LAYOUT_SPLIT);
		expect(three.pauseRender).toBe(false);

		await layoutButton(wrapper, '2D').trigger('click');
		expect(layoutOf(wrapper)).toBe(LAYOUT_PLAN);
		expect(three.pauseRender).toBe(true);

		wrapper.unmount();
	});

	it('offers a divider only in split', async () =>
	{
		const wrapper = await mountApp();
		expect(wrapper.find('[role="separator"]').exists()).toBe(false);

		await layoutButton(wrapper, 'Split').trigger('click');
		expect(wrapper.find('[role="separator"]').exists()).toBe(true);

		wrapper.unmount();
	});
});

describe('the catalog drawer', () =>
{
	/** The drawer is portalled out of the app root, so it is found in the body. */
	function drawer()
	{
		return document.querySelector('[role="dialog"]');
	}

	async function openCatalog(wrapper)
	{
		await layoutButton(wrapper, '3D').trigger('click');
		await railButton(wrapper, 'Furniture catalog').trigger('click');
		await nextTick();
		await nextTick();
	}

	it('opens with every model from the catalog file, and a chip per section', async () =>
	{
		const wrapper = await mountApp();
		expect(drawer()).toBeNull();

		await openCatalog(wrapper);
		const panel = drawer();
		expect(panel).not.toBeNull();

		// One flat list rather than eight accordions, so the count is the catalog.
		// Now the 168 shipped models plus the nine generated openings RM-008 F1
		// added, which come from `openings.json` rather than `catalog.json` because
		// they name no file. Asserted as the sum rather than as 177, so it keeps
		// saying what it means when either list grows.
		expect(panel.querySelectorAll('li').length).toBe(catalog.items.length + openings.items.length);

		const chips = [...panel.querySelectorAll('button')]
			.map((button) => button.textContent.trim());
		expect(chips).toContain('Floor Items');
		expect(chips).toContain('Anywhere Items');

		wrapper.unmount();
	});

	it('filters by search and by section, and stays open when an item is picked', async () =>
	{
		const wrapper = await mountApp();

		// Picking an item is the one action in the shell that reaches the network.
		// Stubbed through the seam the library provides for it, so this test stays
		// about the drawer: no fetch attempt, no console noise, no timing.
		//
		// It used to be load-bearing rather than tidy. Before addItem had a failure
		// path, the real GLTFLoader threw synchronously out of `new Request` on a
		// relative URL under Node - past the Vue handler, out of the test - and
		// Vitest failed the whole run on the unhandled exception while every
		// assertion passed. RM-002 R-01 fixed that at the source; the suite now
		// passes with this line removed. Scene.addItem's own failure path is
		// covered directly in tests/items-and-scene.test.js.
		wrapper.vm.$.setupState.store.model.value.scene.setItemLoader(() => {});

		await openCatalog(wrapper);

		const field = drawer().querySelector('input[type="search"]');
		field.value = 'sofa';
		field.dispatchEvent(new window.Event('input'));
		await nextTick();

		const names = [...drawer().querySelectorAll('li')].map((li) => li.textContent.toLowerCase());
		expect(names.length).toBeGreaterThan(0);
		expect(names.every((name) => name.includes('sofa'))).toBe(true);

		// Picking adds and does NOT close - the whole reason this is a drawer.
		drawer().querySelector('li button').click();
		await nextTick();
		expect(drawer()).not.toBeNull();

		wrapper.unmount();
	});
});

describe('lifecycle', () =>
{
	it('unmounts without leaving a renderer or a listener behind', async () =>
	{
		const wrapper = await mountApp();
		wrapper.unmount();

		expect(renderers[0].disposed).toBe(true);
		expect(renderers[0].contextLost).toBe(true);
		expect(realLeaks()).toEqual([]);
	});

	it('survives mount, unmount and remount five times over', async () =>
	{
		for (let i = 0; i < 5; i++)
		{
			const wrapper = await mountApp();
			expect(wrapper.find('canvas#floorplanner-canvas').exists()).toBe(true);
			wrapper.unmount();
		}

		expect(renderers).toHaveLength(5);
		expect(renderers.every((renderer) => renderer.disposed)).toBe(true);
		expect(realLeaks()).toEqual([]);
	});

	it('leaves no inspector behind', async () =>
	{
		const wrapper = await mountApp();
		expect(document.querySelectorAll('#inspector').length).toBe(1);

		wrapper.unmount();
		expect(document.querySelectorAll('#inspector')).toHaveLength(0);
	});
});
