// @vitest-environment jsdom
/**
 * Sprint S6: the Vue shell, mounted for real.
 *
 * app-composables.test.js pins the logic; this pins the component tree around
 * it - that the app boots, that the two panes flip, that the toolbar highlight
 * renders, that the catalog is populated from the catalog file, and that
 * mounting and unmounting the whole thing is symmetric.
 *
 * The last one is the reason the sprint could happen at all. S2 gave the
 * library a `dispose()`; this is where a Vue route's unmount is shown to use
 * it, leaving no listener and no renderer behind.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../src/app/App.vue';
import {Main} from '../src/scripts/three/main.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';

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
 * App.vue has several root nodes - the flip card, the bottom bar, the catalog,
 * the inspector - so a mount has to settle before the inspector's watcher has
 * built its panel, and selectors are scoped below rather than named from the
 * root (test-utils cannot match a descendant selector whose ancestor is itself
 * one of the roots).
 */
async function mountApp()
{
	const wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	return wrapper;
}

function bottomBarButton(wrapper, title)
{
	return wrapper.get('#interface-controls').findAll('button')
		.find((button) => button.attributes('title') === title);
}

function toolbarButton(wrapper, title)
{
	return wrapper.findAll('#floorplanner-controls button').find((button) => button.attributes('title') === title);
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

	it('boots showing the 2D pane, with the 3D controls hidden', async () =>
	{
		const wrapper = await mountApp();

		expect(wrapper.find('#interfaces').classes()).toContain('card');
		expect(wrapper.find('#interfaces').classes()).not.toContain('flipped');
		// v-show, so the element exists and is display:none.
		expect(wrapper.find('#viewcontrols').element.style.display).toBe('none');

		wrapper.unmount();
	});

	it('renders the whole camera preset cross and the walk-through button', async () =>
	{
		const wrapper = await mountApp();
		const titles = wrapper.get('#interface-controls').findAll('button').map((b) => b.attributes('title'));

		expect(titles).toContain('Show top view');
		expect(titles).toContain('Show 3d view');
		expect(titles).toContain('Show front view');
		expect(titles).toContain('Show side view (left)');
		expect(titles).toContain('Show side view (right)');
		// Present in the demo's markup but commented out; restored in S6 so that
		// parity scenario P10 is reachable without the console.
		expect(titles).toContain('Walk through');

		wrapper.unmount();
	});
});

describe('the 2D toolbar highlight', () =>
{
	it('marks the active mode, and moves with it', async () =>
	{
		// The demo's version of this never rendered - the handler compared an
		// event object to a mode number. See useFloorplannerMode.
		const wrapper = await mountApp();

		const move = toolbarButton(wrapper, 'Move Walls');
		const draw = toolbarButton(wrapper, 'Draw New Walls');
		const remove = toolbarButton(wrapper, 'Delete Walls');

		expect(move.classes()).toContain('is-active');
		expect(draw.classes()).not.toContain('is-active');

		await draw.trigger('click');

		expect(draw.classes()).toContain('is-active');
		expect(move.classes()).not.toContain('is-active');
		expect(remove.classes()).not.toContain('is-active');
		expect(draw.attributes('aria-pressed')).toBe('true');

		wrapper.unmount();
	});

	it('shows the escape hint only while drawing', async () =>
	{
		const wrapper = await mountApp();

		expect(wrapper.find('.btn-hint').element.style.display).toBe('none');
		await toolbarButton(wrapper, 'Draw New Walls').trigger('click');
		expect(wrapper.find('.btn-hint').element.style.display).not.toBe('none');
		expect(wrapper.find('.btn-hint').text()).toContain('Esc');

		wrapper.unmount();
	});

	it('follows a mode the library sets by itself', async () =>
	{
		const wrapper = await mountApp();
		await toolbarButton(wrapper, 'Draw New Walls').trigger('click');

		// Esc, straight at the library - no click involved.
		wrapper.vm.$.setupState.editor.setMode(floorplannerModes.MOVE);
		await wrapper.vm.$nextTick();

		expect(toolbarButton(wrapper, 'Move Walls').classes()).toContain('is-active');

		wrapper.unmount();
	});
});

describe('switching panes', () =>
{
	it('flips the card and reveals the 3D controls', async () =>
	{
		const wrapper = await mountApp();

		await bottomBarButton(wrapper, 'Edit 3D floorplan').trigger('click');

		expect(wrapper.find('#interfaces').classes()).toContain('flipped');
		expect(wrapper.find('#viewcontrols').element.style.display).not.toBe('none');

		await bottomBarButton(wrapper, 'Edit 2D floorplan').trigger('click');

		expect(wrapper.find('#interfaces').classes()).not.toContain('flipped');
		expect(wrapper.find('#viewcontrols').element.style.display).toBe('none');

		wrapper.unmount();
	});
});

describe('the catalog', () =>
{
	it('opens with every section from the catalog file, and closes again', async () =>
	{
		const wrapper = await mountApp();
		await bottomBarButton(wrapper, 'Edit 3D floorplan').trigger('click');

		expect(wrapper.find('.catalog-backdrop').exists()).toBe(false);
		await bottomBarButton(wrapper, 'Add/Remove items in 3D').trigger('click');

		const headings = wrapper.findAll('.catalog-section-heading').map((h) => h.text());
		expect(headings).toHaveLength(8);
		expect(headings[0]).toContain('Floor Items');
		expect(headings[7]).toContain('Anywhere Items');

		await wrapper.find('.catalog-footer .btn').trigger('click');
		expect(wrapper.find('.catalog-backdrop').exists()).toBe(false);

		wrapper.unmount();
	});

	it('shows one section at a time', async () =>
	{
		const wrapper = await mountApp();
		await bottomBarButton(wrapper, 'Edit 3D floorplan').trigger('click');
		await bottomBarButton(wrapper, 'Add/Remove items in 3D').trigger('click');

		const open = () => wrapper.findAll('.catalog-grid').filter((g) => g.element.style.display !== 'none');
		expect(open()).toHaveLength(1);

		await wrapper.findAll('.catalog-section-heading')[2].trigger('click');
		expect(open()).toHaveLength(1);

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
