// @vitest-environment jsdom
/**
 * A whole house, driven through every tier that does not need a GPU (RM-010 G3).
 *
 * G1 built storeys and G2 put stairwells and a roof on them, both behind
 * `levelsEnabled`. This sprint takes the flag off, and RM-010's acceptance line
 * says what earns that: *the flag comes off only when the three-storey fixture
 * passes every tier.* So this file is not a unit test of anything. It loads
 * `tests/fixtures/three-storey.blueprint3d` - a real building, produced by
 * `tools/make-fixtures.mjs` through the real `Model` - and puts it through save,
 * load, undo, autosave, the plan and an exported sheet. The tier that needs a
 * GPU, the 3D view, is `tests/browser/three-storey.test.js`.
 *
 * ## What driving it found
 *
 * Three defects, none of which a unit test would have reached, because each one
 * needs a building rather than a plan:
 *
 *   1. **No saved column or beam had ever loaded.** `Item`'s constructor calls
 *      `setScale()` when a scale is supplied, that calls `resized()`, and F2's
 *      `ParametricStructure.resized()` reads a description the subclass has not
 *      assigned yet. The catalog path supplies no scale, so placing one worked
 *      and opening one threw.
 *   2. **Room names on any storey with a stairwell were destroyed on reload.**
 *      G2 re-applies floor openings inside `Floorplan.update()` and put that
 *      block above the loop that restores each room's name; `setFloorOpenings`
 *      announces an area change, and the listener writes the room - still
 *      called "A New Room" - back over the saved name.
 *   3. **`tools/make-fixtures.mjs` had stopped reproducing its own fixtures**,
 *      four programmes earlier, when RM-003 A1 gave every plan a runtime with an
 *      id. Every corner id in all three files shifted by one.
 *
 * Each has a test below, named for the defect rather than for the code.
 *
 * ## V-7, measured rather than assumed
 *
 * RM-010 V-7 recorded that undo and autosave snapshot the whole file, and drew
 * the arithmetic conclusion that three storeys is three times the payload.
 * G3's second acceptance line asks for that as a measurement at one, two and
 * three storeys. It is at the end of this file, and it reports rather than
 * merely asserting - the numbers it prints are the ones RM-010 §47 quotes.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, nextTick} from 'vue';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {Configuration, configLevels} from '../src/scripts/core/configuration.js';
import {exportPlanSVG} from '../src/scripts/floorplanner/plan_export.js';
import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useHistory} from '../src/app/composables/useHistory.js';
import {useLevels} from '../src/app/composables/useLevels.js';
import {useDesignIO} from '../src/app/composables/useDesignIO.js';
import {readDraft, clearDraft} from '../src/app/composables/useAutosave.js';
import {useAutosave} from '../src/app/composables/useAutosave.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const HOUSE = readFileSync(join(FIXTURES, 'three-storey.blueprint3d'), 'utf8');

/** What the fixture is, so a change to it has to change this line too. */
const STOREYS = ['Ground floor', 'First floor', 'Loft'];
const HEIGHTS = [280, 280, 300];

let canvasStub;
let observer;
let pointerApis;
let renderers;
let scope;
let store;
let elements;

function buildDom()
{
	const viewer = document.createElement('div');
	viewer.id = 'viewer';
	document.body.appendChild(viewer);

	const wrapper = document.createElement('div');
	wrapper.id = 'floorplanner';
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

/** A bare `Model` with the item loader stubbed, for the tiers below the app. */
function house()
{
	const model = new Model('/textures/');
	model.scene.setItemLoader(stubItemLoader(THREE));
	model.loadSerialized(HOUSE);
	return model;
}

import * as THREE from 'three';

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.localStorage.clear();
	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub(renderers));

	scope = effectScope();
	store = run(() => createBlueprintStore());
	elements = buildDom();
});

afterEach(async () =>
{
	store.unmount();
	scope.stop();
	Main.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	await clearDraft();
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('the fixture is a building', () =>
{
	it('is three storeys with two flights, two openings, a column, a beam and a roof', () =>
	{
		const model = house();

		expect(model.levels.map((level, i) => level.displayName(i))).toEqual(STOREYS);
		expect(model.levels.map((level) => level.height)).toEqual(HEIGHTS);
		expect(model.levels.map((level) => level.items.length)).toEqual([3, 2, 1]);
		// Every parametric type F built, so the file exercises all three
		// generators rather than the one that was easiest to place.
		const types = model.levels.flatMap((level) => level.items.map((item) => item.metadata.itemType));
		expect(types.filter((t) => t === 10)).toHaveLength(2);
		expect(types.filter((t) => t === 11)).toHaveLength(2);
		expect(types.filter((t) => t === 12)).toHaveLength(2);
		expect(model.roof.kind).toBe('gable');
	});

	it('stacks its storeys on bases nothing stores', () =>
	{
		const model = house();

		expect([0, 1, 2].map((i) => model.levelBase(i))).toEqual([0, 280, 560]);
		// The eaves are the top storey's base plus its wall head; the ridge adds
		// the rise a 35-degree pitch implies over a 9.8 m span.
		expect(model.roofBase()).toBe(810);
		const bounds = model.buildingBounds();
		expect(bounds.width).toBe(780);
		expect(bounds.depth).toBe(980);
		expect(Math.round(bounds.top)).toBe(1173);
	});

	it('cuts a stairwell in each storey that has a flight beneath it', () =>
	{
		const model = house();
		const openings = model.levels.map((level) =>
			level.floorplan.getRooms().reduce((total, room) => total + room.floorOpenings.length, 0));

		// Nothing under the ground floor, so nothing is cut in it.
		expect(openings).toEqual([0, 1, 1]);
	});
});

describe('the tiers, one house through each', () =>
{
	it('save: re-saves byte-identically, twice, with levels and roof written', () =>
	{
		const model = house();
		const once = model.exportSerialized();

		model.loadSerialized(once);
		const twice = model.exportSerialized();

		expect(twice).toBe(once);
		expect(once).toBe(JSON.stringify(JSON.parse(HOUSE)));
		expect(Object.keys(JSON.parse(once))).toEqual(['floorplan', 'items', 'levels', 'roof']);
	});

	/**
	 * The defect this pins is the one that made the assertion above fail before
	 * G3: reloading into a `Model` that already held a design lost the name of
	 * every room with a stairwell in it, because openings were re-applied before
	 * the names were restored rather than after.
	 */
	it('load: keeps every room name across a reload into the same document', () =>
	{
		const model = house();
		const before = model.levels.map((level) => level.floorplan.getRooms().map((room) => room.name));

		model.loadSerialized(model.exportSerialized());

		expect(model.levels.map((level) => level.floorplan.getRooms().map((room) => room.name)))
			.toEqual(before);
		expect(before.flat()).toContain('Loft');
	});

	/**
	 * And the other one: an item type whose saved record had never survived a
	 * load, because the elevation it derives is read before the description it
	 * derives it from exists.
	 */
	it('load: opens a file with a column and a beam in it', () =>
	{
		const model = house();
		const members = model.levels.flatMap((level) =>
			level.items.filter((item) => item.structure));

		expect(members.map((item) => item.structure.kind).sort()).toEqual(['beam', 'column']);
		// A column stands on the floor and a beam hangs at its soffit; both are
		// derived from the description rather than from the file's y.
		const column = members.find((item) => item.structure.kind === 'column');
		const beam = members.find((item) => item.structure.kind === 'beam');
		expect(column.position.y).toBe(125);
		expect(beam.position.y).toBe(255);
	});

	it('undo: restores the storey list and everything on it', async () =>
	{
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		const history = run(() => useHistory(store));
		await nextTick();

		store.model.value.loadSerialized(HOUSE);
		history.reset();
		const before = store.model.value.exportSerialized();

		store.model.value.removeLevel(2);
		history.commit();
		expect(store.model.value.levels).toHaveLength(2);

		history.undo();
		expect(store.model.value.levels).toHaveLength(3);
		expect(store.model.value.exportSerialized()).toBe(before);
	});

	it('autosave: writes the whole building and offers it back', async () =>
	{
		vi.useFakeTimers();
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		run(() => useAutosave(store));
		await nextTick();

		store.model.value.loadSerialized(HOUSE);
		store.model.value.floorplan.update();
		await vi.advanceTimersByTimeAsync(4000);
		vi.useRealTimers();

		const draft = await readDraft(Date.now());
		expect(draft).not.toBeNull();
		const restored = new Model('/textures/');
		restored.scene.setItemLoader(stubItemLoader(THREE));
		restored.loadSerialized(draft.design);
		expect(restored.levels).toHaveLength(3);
		expect(restored.roof.kind).toBe('gable');
	});

	it('the plan: draws the storey being edited, and the one below it as a ghost', () =>
	{
		const model = house();

		// The ground floor has nothing under it.
		expect(model.levels[0].floorplan.ghostPlan).toBeNull();
		model.setActiveLevel(1);
		const ghost = model.floorplan.ghostPlan;
		expect(ghost.walls.length).toBe(model.levels[0].floorplan.getWalls().length);
		// Item footprints reach the plan as plain data, per storey.
		expect(model.floorplan.itemProjection.length).toBe(2);
	});

	/**
	 * RM-013 K1: this test was passing and asserting nothing it claimed.
	 *
	 * It switched storeys on the model and exported through the view, and until
	 * finding Y-3 was repaired those two were not the same plan: `useLevels` is
	 * what re-points the canvas at the new storey and it was not mounted here, so
	 * the view drew the GROUND FLOOR three times. The three sheets still differed,
	 * because `planBounds` reads the argument rather than the view, so each was
	 * the ground floor's drawing inside a different storey's frame - and the
	 * assertion below could not tell.
	 *
	 * `useLevels` is mounted now, which is what the application does, and the
	 * assertion counts paths as well as comparing strings.
	 */
	it('an exported sheet: every storey draws, and each draws its own plan', () =>
	{
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		store.model.value.loadSerialized(HOUSE);
		const levels = run(() => useLevels(store));

		const view = store.floorplanner.value.view;
		const sheets = [0, 1, 2].map((index) =>
		{
			levels.setActive(index);
			expect(view.floorplan).toBe(store.model.value.floorplan);
			return exportPlanSVG(view, store.model.value.floorplan, {scale: 100, title: 'Floor plan'});
		});

		sheets.forEach((svg) => {expect(svg).toContain('<svg');});
		// Three different storeys, three different drawings - the first floor has
		// a partition the other two do not, so no two sheets can be equal.
		expect(new Set(sheets).size).toBe(3);
		// And the drawings differ, not only the frames around them. This is the
		// half the test was missing.
		const paths = sheets.map((svg) => (svg.match(/<path/g) || []).length);
		expect(new Set(paths).size).toBeGreaterThan(1);
	});
});

/**
 * The file tier, through the composable the application actually uses.
 *
 * V-8 lists `useDesignIO.js` at 49 % of statements and 30 % of branches with the
 * reason *"new, open and save all gain levels"*, and until G3 none of the three
 * had been driven with a building. The suite above uses `Model` directly, which
 * is the layer below this one; what this adds is the layer a person touches.
 */
describe('new, open and save, with a building in them', () =>
{
	function io()
	{
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		return run(() => useDesignIO(store));
	}

	it('opens a three-storey file and reports no error', async () =>
	{
		const design = io();

		const file = new window.File([HOUSE], 'house.blueprint3d', {type: 'application/json'});
		await design.openDesign(file);

		expect(design.lastError.value).toBeNull();
		expect(store.model.value.levels).toHaveLength(3);
		expect(store.model.value.roof.kind).toBe('gable');
	});

	it('takes the storeys back down to one on a new design', () =>
	{
		const design = io();
		store.model.value.loadSerialized(HOUSE);
		expect(store.model.value.levels).toHaveLength(3);

		design.newDesign();

		// A new design is one storey with no roof, or the second file somebody
		// opens starts on the first floor of the last one.
		expect(store.model.value.levels).toHaveLength(1);
		expect(store.model.value.activeLevelIndex).toBe(0);
		expect(store.model.value.roof).toBeNull();
	});

	it('writes the whole building when it saves, not the storey being edited', async () =>
	{
		const design = io();
		store.model.value.loadSerialized(HOUSE);
		store.model.value.setActiveLevel(1);

		const written = [];
		const originalCreate = window.URL.createObjectURL;
		window.URL.createObjectURL = (blob) => {written.push(blob); return 'blob:stub';};
		window.URL.revokeObjectURL = () => {};
		try
		{
			await design.saveDesign();
		}
		finally
		{
			window.URL.createObjectURL = originalCreate;
		}

		expect(written).toHaveLength(1);
		const saved = JSON.parse(await written[0].text());
		expect(saved.levels).toHaveLength(3);
		expect(saved.roof).toBeTruthy();
		// And the ground floor is still at the top level of the file, so a build
		// that has never heard of storeys opens it and gets a plan.
		expect(saved.floorplan.corners).toBeTruthy();
	});

	it('says which file failed rather than destroying the design', async () =>
	{
		const design = io();
		store.model.value.loadSerialized(HOUSE);

		const file = new window.File(['{"floorplan":{}}'], 'wrong.blueprint3d', {type: 'application/json'});
		await design.openDesign(file);

		expect(design.lastError.value).toContain('wrong.blueprint3d');
		// A1's guarantee, restated for a building: the three storeys are still
		// there, because validation happens before anything is mutated.
		expect(store.model.value.levels).toHaveLength(3);
	});

	it('exports a sheet of the storey being edited, and says so', () =>
	{
		const design = io();
		store.model.value.loadSerialized(HOUSE);

		const written = [];
		const originalCreate = window.URL.createObjectURL;
		window.URL.createObjectURL = (blob) => {written.push(blob); return 'blob:stub';};
		window.URL.revokeObjectURL = () => {};
		// Through the composable, because that is what re-points the canvas at the
		// storey being edited - see the note on the exported-sheet test above.
		const levels = run(() => useLevels(store));
		try
		{
			design.savePlanSVG(100);
			levels.setActive(1);
			design.savePlanSVG(100);
		}
		finally
		{
			window.URL.createObjectURL = originalCreate;
		}

		expect(written).toHaveLength(2);
		expect(design.lastError.value).toBeNull();
	});
});

describe('the storey control is on by default now (RM-010 G3)', () =>
{
	it('reports enabled without anything having to turn it on', () =>
	{
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		const levels = run(() => useLevels(store));

		expect(levels.enabled.value).toBe(true);
	});

	it('is still a switch an embedder can turn off', () =>
	{
		Configuration.setValue(configLevels, false);
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		const levels = run(() => useLevels(store));

		expect(levels.enabled.value).toBe(false);
		// And with it off, adding a storey is refused rather than silently done.
		levels.addAbove();
		expect(store.model.value.levels).toHaveLength(1);
	});
});

/**
 * V-7, at one, two and three storeys.
 *
 * The finding said the cost is arithmetic: undo stores the string
 * `exportSerialized()` produces and autosave writes the same string, so a
 * building costs what its storeys cost. What the finding could not say is what
 * that is in bytes, because nothing had three storeys to measure. These are
 * measurements, printed as well as asserted, and RM-010 §47 quotes them.
 */
describe('V-7 - what a storey costs undo and autosave', () =>
{
	/** The fixture, cut down to its first `count` storeys. */
	function truncated(count)
	{
		const model = house();
		while (model.levels.length > count)
		{
			model.removeLevel(model.levels.length - 1);
		}
		return model;
	}

	it('measures the snapshot at one, two and three storeys', () =>
	{
		const sizes = [1, 2, 3].map((count) => truncated(count).exportSerialized().length);

		console.log(`V-7 snapshot bytes: 1 storey ${sizes[0]}, 2 ${sizes[1]}, 3 ${sizes[2]}`
			+ ` (x${(sizes[2] / sizes[0]).toFixed(2)} for three)`);

		// Monotonic, and each storey adds a plan rather than a constant - which is
		// the claim V-7 actually makes. The ground floor is the cheapest of the
		// three because `levels[0]` carries only a name and a height.
		expect(sizes[0]).toBeLessThan(sizes[1]);
		expect(sizes[1]).toBeLessThan(sizes[2]);
		expect(sizes[2] / sizes[0]).toBeGreaterThan(2);
	});

	/**
	 * The best of several runs, not the mean of one.
	 *
	 * G3 wrote this as one timed loop per storey count and it was flaky at about
	 * one run in ten - caught in H1, with the one-storey figure at 0.080 ms
	 * against its usual 0.010 and therefore *above* the three-storey one, which
	 * failed an ordering assertion that is true of the code and not always true
	 * of the clock. Sub-microsecond work measured once measures the scheduler as
	 * much as the work.
	 *
	 * The minimum over repetitions is the fix and it is a better statistic, not a
	 * looser one: interference only ever *adds* time, so the smallest observation
	 * is the closest estimate of what the work costs, while a mean estimates the
	 * work plus whatever else the machine was doing.
	 *
	 * @param {() => void} work
	 * @returns {number} Milliseconds per call.
	 */
	function bestOf(work)
	{
		const ITERATIONS = 200;
		const REPETITIONS = 7;
		// Warm, so the figure is the work rather than the first-call cost.
		for (let i = 0; i < 50; i++) {work();}
		let best = Infinity;
		for (let repetition = 0; repetition < REPETITIONS; repetition++)
		{
			const started = window.performance.now();
			for (let i = 0; i < ITERATIONS; i++) {work();}
			best = Math.min(best, (window.performance.now() - started) / ITERATIONS);
		}
		return best;
	}

	it('measures the serialisation autosave debounces, at one, two and three storeys', () =>
	{
		// The write itself is asynchronous since RM-003 A5 and its cost is the
		// store's; what `useAutosave` still does on the main thread, every two
		// seconds of editing, is this. So this is the number the finding is about.
		const timings = [1, 2, 3].map((count) =>
		{
			const model = truncated(count);
			return bestOf(() => model.exportSerialized());
		});

		console.log('V-7 exportSerialized: '
			+ timings.map((ms, i) => `${i + 1} storey${i ? 's' : ''} ${ms.toFixed(3)} ms`).join(', ')
			+ ` (x${(timings[2] / timings[0]).toFixed(2)} for three)`);

		// The claim, and the only part of it worth asserting: it scales with the
		// building rather than being flat, and it stays well inside a frame.
		expect(timings[2]).toBeGreaterThan(timings[0]);
		expect(timings[2]).toBeLessThan(16);
	});

	it('measures what the history stack holds for a three-storey house', async () =>
	{
		store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
		const history = run(() => useHistory(store));
		await nextTick();

		store.model.value.loadSerialized(HOUSE);
		history.reset();
		for (let i = 0; i < 10; i++)
		{
			store.model.value.setLevelHeight(0, 280 + i);
			history.commit();
		}
		const stats = history.stats();

		console.log(`V-7 history: ${stats.entries} entries holding ${stats.bytes} bytes`
			+ ` (limit ${stats.limit} entries)`);

		// Ten commits, ten entries: `reset()` seeds the present without an entry
		// of its own, so the first commit pushes that present into the past and
		// takes its place.
		expect(stats.entries).toBe(10);
		// The whole point of the finding: the stack is entries x whole file, so
		// the ceiling is the limit times the file, and for this house that is
		// half a megabyte of strings for fifty undos.
		expect(stats.bytes).toBeGreaterThan(stats.entries * 9000);
		expect(stats.limit * (stats.bytes / stats.entries)).toBeGreaterThan(500_000);
	});
});
