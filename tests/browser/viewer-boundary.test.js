/**
 * The 3D engine arrives when it is looked at (RM-015 M3, tier 2).
 *
 * **M-54** is the metric this file carries: *opening the application creates no
 * WebGL context, and switching to a layout that shows the 3D view creates
 * exactly one.*
 *
 * ## What was measured, and what it cost
 *
 * AA-5: three is 204,379 gzipped bytes, 47 % of a first load, in a tool whose
 * default layout is the plan alone. AA-6: the obvious remedy does not work - a
 * path-based `manualChunks` offers three's modules to the hook and they land in
 * the entry chunk anyway, because a bundler splits on a boundary in the graph
 * rather than on a predicate over paths. So M3 put a boundary in the graph:
 * `BlueprintCore` builds a document with no viewer, and
 * `useBlueprint.ensureViewer()` is an `import()`.
 *
 * ## Why a WebGL context and not a resource timing
 *
 * M-43 counts what a boot fetched, and that is the natural instrument for
 * "nothing unpicked is downloaded". It cannot see this boundary. The runner
 * serves modules unbundled, and `src/scripts/blueprint.js` is a barrel that
 * re-exports `Main`, `Edge`, `Skybox` and the rest - so importing anything from
 * it fetches all 88 library modules and three's dep bundle, whatever the built
 * chunks look like. Measured, not assumed: finding AA-8.
 *
 * What tier 2 can see is the other half of the claim, and it is the half the
 * risk register worries about - *"something imports the viewer eagerly and the
 * split silently does nothing"*. A `WebGLRenderer` is constructed exactly when
 * `Main` is, so counting `getContext('webgl2')` calls counts viewers. A build
 * that kept the chunk boundary and constructed a viewer at boot anyway would
 * keep `first-load` green and fail here.
 *
 * The chunk half - the engine is in exactly one chunk, and the document
 * references none of it - is asserted by `tools/check-deploy.mjs` against the
 * assembled tree, where chunks exist.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../../src/app/App.vue';

let wrapper;
let contexts;
let originalGetContext;

/** The store the shell built. */
function store()
{
	return wrapper.vm.$.setupState.store;
}

/** A button in the 2D / Split / 3D control, by its label. */
function layoutButton(label)
{
	return wrapper.findAll('[aria-label="Workspace layout"] button')
		.find((node) => node.text() === label);
}

beforeEach(async () =>
{
	// Installed before the mount, because what is being counted is whether the
	// mount creates one. Every kind is counted, not only webgl2: a renderer that
	// fell back to webgl1 is still a renderer.
	contexts = [];
	originalGetContext = window.HTMLCanvasElement.prototype.getContext;
	window.HTMLCanvasElement.prototype.getContext = function (kind, ...rest)
	{
		if (typeof kind === 'string' && kind.startsWith('webgl')) { contexts.push(kind); }
		return originalGetContext.call(this, kind, ...rest);
	};

	window.localStorage.clear();
	wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	// Two frames and a beat, the settle the other browser suites use.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 200));
});

afterEach(() =>
{
	window.HTMLCanvasElement.prototype.getContext = originalGetContext;
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
});

describe('M-54 - a boot builds no 3D engine', () =>
{
	it('creates no WebGL context, and attaches no viewer', () =>
	{
		expect(contexts, `a boot created ${contexts.length} WebGL contexts: ${contexts.join(', ')}`)
			.toEqual([]);
		expect(store().three.value).toBeNull();
		expect(store().instance.value.three).toBeNull();
	});

	it('draws the plan anyway, which is what makes that a saving', () =>
	{
		// The other half of the trade, and the reason this is not simply "the 3D
		// view is broken". A boot with no engine still has a document, a plan
		// canvas with the default design on it, and a 3D pane sized and waiting -
		// both viewports are laid out at full size in every layout, which has been
		// load-bearing since S6 because the library measures its containers.
		expect(wrapper.find('#app-shell').exists()).toBe(true);
		expect(wrapper.find('canvas#floorplanner-canvas').exists()).toBe(true);
		expect(wrapper.find('#viewer').exists()).toBe(true);
		expect(store().model.value).not.toBeNull();
		expect(store().floorplanner.value).not.toBeNull();
		expect(store().model.value.floorplan.getRooms().length).toBeGreaterThan(0);
	});

	it('creates exactly one the moment the 3D view is shown', async () =>
	{
		// Which is what makes the assertions above a measurement rather than a
		// tautology: an application whose 3D view never worked would pass them.
		await layoutButton('3D').trigger('click');
		await store().ensureViewer();
		await nextTick();

		expect(contexts.length).toBe(1);
		expect(store().three.value).not.toBeNull();
	});

	it('and one only, however many times the layout moves', async () =>
	{
		await layoutButton('3D').trigger('click');
		await store().ensureViewer();
		await layoutButton('2D').trigger('click');
		await layoutButton('Split').trigger('click');
		await store().ensureViewer();
		await layoutButton('3D').trigger('click');
		await store().ensureViewer();
		await nextTick();

		// The import is cached in the store, and `attachViewer` returns the viewer
		// already attached rather than building a second renderer over the same
		// element. A layout watcher can fire several times before a chunk lands,
		// which is why that is a property and not an accident.
		expect(contexts.length).toBe(1);
	});

	it('renders once it is there, in the pane it was asked for', async () =>
	{
		await layoutButton('3D').trigger('click');
		const viewer = await store().ensureViewer();
		await nextTick();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

		// The engine is not merely constructed, it is running and attached where
		// the person is looking: the render loop is unpaused and Main's canvas is
		// inside the container the component owns.
		expect(viewer.pauseRender).toBe(false);
		expect(document.querySelector('#viewer canvas')).not.toBeNull();
	});
});
