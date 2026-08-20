// @vitest-environment jsdom
/**
 * Sharing, as the application does it (RM-013 K2).
 *
 * `tests/design-link.test.js` proves the codec. This proves the state around
 * it: that a design arriving in the URL puts both views into read-only, that
 * the only way out is a copy, and that the fragment is cleared exactly then and
 * not before.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {effectScope} from 'vue';
import {deflateRawSync, inflateRawSync} from 'node:zlib';

import {Main} from '../src/scripts/three/main.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useDesignIO} from '../src/app/composables/useDesignIO.js';
import {useProjects, setProjectRepository} from '../src/app/composables/useProjects.js';
import {useShare} from '../src/app/composables/useShare.js';
import {encodeDesign, LINK_KEY} from '../src/app/share/design_link.js';
import {IndexedDbProjectRepository} from '../src/app/persistence/project_repository.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

const DESIGN = JSON.stringify({
	floorplan: {
		corners: {a: {x: 0, y: 0}, b: {x: 400, y: 0}, c: {x: 400, y: 300}, d: {x: 0, y: 300}},
		walls: [{corner1: 'a', corner2: 'b'}, {corner1: 'b', corner2: 'c'},
			{corner1: 'c', corner2: 'd'}, {corner1: 'd', corner2: 'a'}],
		rooms: {}, units: 'cm', version: '2.0.0',
	},
	items: [],
});

function installStreams()
{
	const make = (transform) => class
	{
		constructor()
		{
			const chunks = [];
			const stream = new TransformStream({
				transform(chunk) {chunks.push(Buffer.from(chunk));},
				flush(controller) {controller.enqueue(new Uint8Array(transform(Buffer.concat(chunks))));},
			});
			this.readable = stream.readable;
			this.writable = stream.writable;
		}
	};
	globalThis.CompressionStream = make(deflateRawSync);
	globalThis.DecompressionStream = make(inflateRawSync);
}

let canvasStub;
let observer;
let pointerApis;
let renderers;
let scope;
let store;
let elements;
let io;
let projects;
let share;

function buildDom()
{
	const viewer = document.createElement('div');
	document.body.appendChild(viewer);
	const wrapper = document.createElement('div');
	const canvas = document.createElement('canvas');
	canvas.id = 'floorplanner-canvas';
	wrapper.appendChild(canvas);
	document.body.appendChild(wrapper);
	return {viewer, canvas};
}

function run(fn)
{
	let value;
	scope.run(() => {value = fn();});
	return value;
}

beforeEach(() =>
{
	resetAll();
	installStreams();
	document.body.innerHTML = '';
	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub(renderers));
	setProjectRepository(new IndexedDbProjectRepository({factory: createFakeIndexedDb()}));

	scope = effectScope();
	store = run(() => createBlueprintStore());
	elements = buildDom();
	store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
	io = run(() => useDesignIO(store));
	projects = run(() => useProjects(store, io));
	share = run(() => useShare(store, projects, io));
	io.newDesign();
	window.history.replaceState(null, '', window.location.pathname);
});

afterEach(() =>
{
	store.unmount();
	scope.stop();
	setProjectRepository(null);
	Main.setRendererFactory(null);
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
	delete globalThis.CompressionStream;
	delete globalThis.DecompressionStream;
	window.history.replaceState(null, '', window.location.pathname);
	document.body.innerHTML = '';
});

describe('making one', () =>
{
	it('builds a link to this page carrying this design', async () =>
	{
		const link = await share.makeLink();

		expect(link).toContain(`#${LINK_KEY}=`);
		expect(share.chars.value).toBeGreaterThan(0);
		expect(share.refusal.value).toBeNull();
	});
});

describe('receiving one', () =>
{
	it('opens the design and stops both views editing', async () =>
	{
		const made = await encodeDesign(DESIGN);

		expect(await share.openFromHash(`#${LINK_KEY}=${made.payload}`)).toBe(true);

		expect(share.viewing.value).toBe(true);
		expect(store.model.value.floorplan.getCorners().length).toBe(4);
		// Both halves, through the library rather than by hiding a tool rail.
		expect(store.floorplanner.value.readOnly).toBe(true);
		expect(store.three.value.readOnly).toBe(true);
		expect(store.three.value.controller.enabled).toBe(false);
		// And the tools are refused, not merely hidden.
		store.floorplanner.value.setMode(floorplannerModes.DRAW);
		expect(store.floorplanner.value.mode).toBe(floorplannerModes.MOVE);
	});

	it('belongs to nobody, so nothing can overwrite anything', async () =>
	{
		const made = await encodeDesign(DESIGN);

		await share.openFromHash(`#${LINK_KEY}=${made.payload}`);

		expect(projects.current.value).toBeNull();
		expect(io.documentName.value).toBe('shared design');
	});

	it('does nothing at all when there is no link', async () =>
	{
		expect(await share.openFromHash('')).toBe(false);
		expect(await share.openFromHash('#something=else')).toBe(false);
		expect(share.viewing.value).toBe(false);
		expect(store.floorplanner.value.readOnly).toBe(false);
	});

	it('leaves the design alone when the link is broken', async () =>
	{
		const made = await encodeDesign(DESIGN);
		const before = store.model.value.floorplan.getCorners().length;

		expect(await share.openFromHash(`#${LINK_KEY}=${made.payload.slice(0, 20)}`)).toBe(false);

		expect(share.viewing.value).toBe(false);
		expect(store.model.value.floorplan.getCorners().length).toBe(before);
	});
});

describe('the only way out is a copy', () =>
{
	it('keeps it as a project, stops viewing, and clears the URL', async () =>
	{
		const made = await encodeDesign(DESIGN);
		window.history.replaceState(null, '', `#${LINK_KEY}=${made.payload}`);
		await share.openFromHash();
		// The fragment stays while somebody is looking, so a reload re-opens what
		// they were sent and the link is still there to copy.
		expect(window.location.hash).not.toBe('');

		expect(await share.adopt('Their kitchen')).toBe(true);

		expect(share.viewing.value).toBe(false);
		expect(projects.current.value.name).toBe('Their kitchen');
		expect(projects.current.value.origin).toBe('shared-link');
		expect(window.location.hash).toBe('');
		// And the views are editable again.
		expect(store.floorplanner.value.readOnly).toBe(false);
		expect(store.three.value.controller.enabled).toBe(true);
	});

	it('closing without keeping it also clears the URL', async () =>
	{
		const made = await encodeDesign(DESIGN);
		window.history.replaceState(null, '', `#${LINK_KEY}=${made.payload}`);
		await share.openFromHash();

		share.leave();

		expect(share.viewing.value).toBe(false);
		expect(window.location.hash).toBe('');
		expect(store.floorplanner.value.readOnly).toBe(false);
	});

	/**
	 * The walkthrough and read-only both turn the 3D controller off, and before
	 * K2 the flag had one owner - so leaving a walkthrough in a shared design
	 * handed the pointer back and made the furniture draggable again.
	 */
	it('does not hand the pointer back when a walkthrough ends inside a shared design', async () =>
	{
		const made = await encodeDesign(DESIGN);
		await share.openFromHash(`#${LINK_KEY}=${made.payload}`);
		const three = store.three.value;

		three.switchFPSMode(true);
		expect(three.controller.enabled).toBe(false);
		three.switchFPSMode(false);

		expect(three.controller.enabled).toBe(false);
		expect(three.readOnly).toBe(true);
	});
});
