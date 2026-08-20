// @vitest-environment jsdom
/**
 * The library, as the application sees it (RM-013 K1, gap Q-6).
 *
 * `tests/project-library.test.js` proves the store. This proves what the
 * application does with it: when a picture is taken, what a save means, what a
 * template becomes, and what happens to the design on screen when the record it
 * came from is deleted.
 *
 * The store is faked here - `setProjectRepository` over a fake `IDBFactory` -
 * and the library is not. The subject is `useProjects`.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {effectScope} from 'vue';

import {Main} from '../src/scripts/three/main.js';
import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useDesignIO} from '../src/app/composables/useDesignIO.js';
import {useProjects, setProjectRepository, projectStoreKind, captureThumbnail}
	from '../src/app/composables/useProjects.js';
import {IndexedDbProjectRepository, UnavailableProjectRepository}
	from '../src/app/persistence/project_repository.js';
import {DEFAULT_DESIGN} from '../src/app/designs/default-design.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

let canvasStub;
let observer;
let pointerApis;
let renderers;
let scope;
let store;
let elements;
let io;
let projects;

function buildDom()
{
	const viewer = document.createElement('div');
	viewer.id = 'viewer';
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

/**
 * Add a room to whatever is on screen, and say how many corners that made.
 *
 * A count rather than a constant, because the boot design is already four
 * corners at 0,0 / 0,5 / 5,5 / 5,0 in METRES and `newCorner(0, 0)` merges into
 * the one already there - so the answer is seven, and hard-coding either number
 * would be asserting a coincidence.
 */
function drawSomething()
{
	const floorplan = store.model.value.floorplan;
	const corners = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => floorplan.newCorner(x, y));
	for (let i = 0; i < corners.length; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
	}
	floorplan.update();
	return floorplan.getCorners().length;
}

beforeEach(() =>
{
	resetAll();
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
	io.newDesign();
});

afterEach(() =>
{
	store.unmount();
	scope.stop();
	setProjectRepository(null);
	Main.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('keeping a design is an act, not a background process', () =>
{
	it('creates a record, and the design becomes that record', async () =>
	{
		const card = await projects.save({name: 'Loft conversion'});

		expect(card.name).toBe('Loft conversion');
		expect(projects.current.value.id).toBe(card.id);
		expect(projects.dirty.value).toBe(false);
		expect(projects.projects.value).toHaveLength(1);
	});

	it('replaces the open record on the second save, rather than making another', async () =>
	{
		const first = await projects.save({name: 'Kitchen'});
		drawSomething();
		const second = await projects.save();

		expect(second.id).toBe(first.id);
		expect(second.createdAt).toBe(first.createdAt);
		expect(second.modifiedAt).toBeGreaterThanOrEqual(first.modifiedAt);
		expect(projects.projects.value).toHaveLength(1);
	});

	it('keeps a copy under a new id when asked', async () =>
	{
		const first = await projects.save({name: 'Kitchen'});
		const copy = await projects.save({name: 'Kitchen, take two', asCopy: true});

		expect(copy.id).not.toBe(first.id);
		expect(projects.projects.value).toHaveLength(2);
	});

	it('names an unnamed design rather than storing a blank', async () =>
	{
		const card = await projects.save({name: '   '});

		expect(card.name).toBe('Untitled design');
	});

	it('gives the seven exports the project s name', async () =>
	{
		expect(io.documentName.value).toBe('design');

		await projects.save({name: 'Loft conversion'});

		expect(io.documentName.value).toBe('Loft conversion');
	});
});

describe('opening, renaming, duplicating and deleting', () =>
{
	it('puts a stored design back on screen', async () =>
	{
		const drawn = drawSomething();
		const card = await projects.save({name: 'Kitchen'});
		io.newDesign();
		projects.detach();
		expect(io.documentName.value).toBe('design');
		expect(store.model.value.floorplan.getCorners().length).toBeLessThan(drawn);

		expect(await projects.open(card.id)).toBe(true);

		expect(projects.current.value.id).toBe(card.id);
		expect(projects.dirty.value).toBe(false);
		expect(io.documentName.value).toBe('Kitchen');
		expect(store.model.value.floorplan.getCorners().length).toBe(drawn);
	});

	it('says so when the record has gone, and re-reads the grid', async () =>
	{
		const card = await projects.save({name: 'Kitchen'});
		await projects.remove(card.id);

		expect(await projects.open(card.id)).toBe(false);
		expect(projects.projects.value).toEqual([]);
	});

	it('renames, and the open project follows', async () =>
	{
		const card = await projects.save({name: 'Kitchen'});

		expect(await projects.rename(card.id, 'Galley kitchen')).toBe(true);

		expect(projects.current.value.name).toBe('Galley kitchen');
		expect(io.documentName.value).toBe('Galley kitchen');
		expect(projects.projects.value[0].name).toBe('Galley kitchen');
	});

	it('duplicates without opening the copy', async () =>
	{
		drawSomething();
		const card = await projects.save({name: 'Kitchen'});

		const copy = await projects.duplicate(card.id);

		expect(copy.name).toBe('Kitchen copy');
		expect(copy.id).not.toBe(card.id);
		// Still looking at the original, which is what a person who pressed
		// duplicate on a tile was doing.
		expect(projects.current.value.id).toBe(card.id);
		expect(projects.projects.value).toHaveLength(2);
	});

	/**
	 * Deleting the record you are looking at must not throw away the work.
	 *
	 * The design stays on screen and becomes unkept, which is exactly what
	 * `current: null` and `dirty: true` say together - and saving again makes a
	 * new record rather than resurrecting the old id.
	 */
	it('keeps the design on screen when its record is deleted', async () =>
	{
		const drawn = drawSomething();
		const card = await projects.save({name: 'Kitchen'});

		expect(await projects.remove(card.id)).toBe(true);

		expect(projects.current.value).toBeNull();
		expect(projects.dirty.value).toBe(true);
		expect(store.model.value.floorplan.getCorners().length).toBe(drawn);

		const again = await projects.save({name: 'Kitchen'});
		expect(again.id).not.toBe(card.id);
	});
});

describe('a template is a starting point, not a project', () =>
{
	it('adopts a design without becoming it', () =>
	{
		expect(projects.adopt(DEFAULT_DESIGN, {name: 'Studio', origin: 'studio'})).toBe(true);

		expect(projects.current.value).toBeNull();
		expect(projects.dirty.value).toBe(true);
		expect(io.documentName.value).toBe('Studio');
		expect(projects.pendingOrigin()).toBe('studio');
	});

	it('records where it came from on the first save, and not again', async () =>
	{
		projects.adopt(DEFAULT_DESIGN, {name: 'Studio', origin: 'studio'});

		const card = await projects.save();

		expect(card.origin).toBe('studio');
		expect(projects.pendingOrigin()).toBeNull();
		// A second save keeps the origin it already has rather than clearing it.
		expect((await projects.save()).origin).toBe('studio');
	});

	it('leaves the design alone when the template will not parse', () =>
	{
		const drawn = drawSomething();

		expect(projects.adopt('{not a design', {name: 'Broken'})).toBe(false);

		// RM-003 A1's guarantee, still holding: a refused load changes nothing.
		expect(store.model.value.floorplan.getCorners().length).toBe(drawn);
		expect(io.lastError.value).toContain('Could not open Broken');
	});
});

describe('a browser that will not store one', () =>
{
	beforeEach(() =>
	{
		setProjectRepository(new UnavailableProjectRepository());
	});

	it('says so rather than pretending', async () =>
	{
		expect(projectStoreKind()).toBe('unavailable');
		expect(projects.available.value).toBe(false);

		expect(await projects.save({name: 'Kitchen'})).toBeNull();

		expect(projects.refusal.value).toBe('unavailable');
		expect(projects.current.value).toBeNull();
	});
});

describe('the picture', () =>
{
	/**
	 * Y-3 as a property of the composable, not only of the library function.
	 *
	 * jsdom's canvas has no encoder, so what this asserts is the contract around
	 * the capture - that it never throws and never invents a picture - and
	 * `tests/browser/project-library.test.js` is where a real one is measured.
	 */
	it('is null rather than a throw when the browser cannot encode', () =>
	{
		drawSomething();

		expect(captureThumbnail(store.floorplanner.value)).toBeNull();
	});

	it('is null for a plan with nothing drawn in it', () =>
	{
		store.model.value.floorplan.reset();

		expect(captureThumbnail(store.floorplanner.value)).toBeNull();
	});

	it('is null when there is no floorplanner at all', () =>
	{
		expect(captureThumbnail(null)).toBeNull();
	});
});
