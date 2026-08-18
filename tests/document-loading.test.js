// @vitest-environment jsdom
/**
 * Opening a document is all-or-nothing, and a load has an owner (RM-003 A1).
 *
 * ## The two findings this suite exists for
 *
 * **H-2.** `Model.loadSerialized()` parsed and then mutated live state, and
 * `newRoom()` called `scene.clearItems()` *before* `loadFloorplan()`, which
 * itself opens with `reset()`. So the open design was gone before the new one
 * had been looked at. Four well-formed-JSON documents that are not designs each
 * destroyed the current plan, and one of them - `{"items":[]}` - did not even
 * throw: the plan was emptied, EVENT_LOADED fired, the toast said the file
 * opened, and autosave wrote the empty plan over the draft. Only a JSON *syntax*
 * error was safe, because `JSON.parse` throws before `newRoom()` runs.
 *
 * **H-3.** `Scene.addItem`'s loader callback closed over the scene and pushed
 * into it with nothing recording which document had asked. Open a design with
 * thirty items and then open another while they are in flight, and thirty
 * callbacks resolve into the second design, adding the first one's furniture to
 * it and dispatching thirty EVENT_ITEM_LOADED that the history gate counts.
 *
 * ## How the atomicity tests are written
 *
 * Not "did it throw" - that was already true for three of the four - but
 * **`exportSerialized()` before and after must be byte-identical**. That is the
 * whole claim, it is checkable without knowing anything about the failure, and
 * it is what a person actually cares about: the work is still there.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {BufferGeometry, MeshBasicMaterial} from 'three';

import {Model} from '../src/scripts/model/model.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {EVENT_UPDATED, EVENT_LOADED, EVENT_ITEM_LOADING, EVENT_ITEM_LOADED} from '../src/scripts/core/events.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

/** A valid two-item design, as the string a save button writes. */
function validDesign(items)
{
	return JSON.stringify({
		floorplan: {
			corners: {
				c1: {x: 0, y: 0, elevation: 0},
				c2: {x: 400, y: 0, elevation: 0},
				c3: {x: 400, y: 400, elevation: 0},
				c4: {x: 0, y: 400, elevation: 0},
			},
			walls: [
				{corner1: 'c1', corner2: 'c2'},
				{corner1: 'c2', corner2: 'c3'},
				{corner1: 'c3', corner2: 'c4'},
				{corner1: 'c4', corner2: 'c1'},
			],
			rooms: {}, units: 'cm', version: '2.0.0',
		},
		items: items || [],
	});
}

/** One furniture record. */
function itemRecord(name)
{
	return {
		item_name: name, item_type: 1, format: 'gltf', model_url: `models/${name}.glb`,
		xpos: 0, ypos: 0, zpos: 0, rotation: 0,
		scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
	};
}

/**
 * The corpus. Every one of these is well-formed JSON and none is a design; every
 * one of them emptied the open plan before A1.
 */
const CORPUS = [
	['an empty object', '{}'],
	['a floorplan with no items key', '{"floorplan":{"corners":{},"walls":[]}}'],
	['an array', '[]'],
	['items with no floorplan', '{"items":[]}'],
	['a truncated file', '{"floorplan":{"corners":{"c1":{"x":0,"y":0}},"wal'],
	['something that is not JSON at all', 'v 0.0 0.0 0.0\nf 1 2 3\n'],
	['a wall naming a corner that is not there', JSON.stringify({
		floorplan: {corners: {c1: {x: 0, y: 0}}, walls: [{corner1: 'c1', corner2: 'nope'}], rooms: {}, units: 'cm'},
		items: [],
	})],
	['a corner whose coordinates are not numbers', JSON.stringify({
		floorplan: {corners: {c1: {x: 'left', y: 0}}, walls: [], rooms: {}, units: 'cm'},
		items: [],
	})],
	['items that are not an array', JSON.stringify({
		floorplan: {corners: {}, walls: [], rooms: {}, units: 'cm'},
		items: {chair: 1},
	})],
	['null', 'null'],
];

let canvas2d = null;

/** A model holding the valid design, with no network in the loader path. */
function loadedModel(items)
{
	const model = new Model('');
	model.scene.setItemLoader((fileName, metadata, onLoad) =>
	{
		onLoad(new BufferGeometry().setFromPoints([]), new MeshBasicMaterial());
	});
	model.loadSerialized(validDesign(items));
	return model;
}

beforeEach(() =>
{
	resetAll();
	canvas2d = installCanvas2D(window);
});

afterEach(() =>
{
	if (canvas2d)
	{
		canvas2d.restore();
		canvas2d = null;
	}
	resetAll();
});

describe('a document that is not a design leaves the design alone', () =>
{
	CORPUS.forEach(([label, bad]) =>
	{
		it(`survives ${label}`, () =>
		{
			const model = loadedModel([itemRecord('chair')]);
			const before = model.exportSerialized();
			expect(model.floorplan.getCorners()).toHaveLength(4);

			// M-6. Throwing is fine and is what the application already handles;
			// what must not happen is the design changing.
			expect(() => model.loadSerialized(bad)).toThrow();

			expect(model.exportSerialized()).toBe(before);
			expect(model.floorplan.getCorners()).toHaveLength(4);
			expect(model.floorplan.getWalls()).toHaveLength(4);
			expect(model.floorplan.getRooms()).toHaveLength(1);
			expect(model.scene.getItems()).toHaveLength(1);
		});
	});

	it('says what was wrong, naming the field', () =>
	{
		// "Could not open that design" is true and useless. The structured result
		// is what lets the application say which part of the file is broken.
		const result = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {c1: {x: 0, y: 0}}, walls: [{corner1: 'c1', corner2: 'ghost'}], rooms: {}},
			items: [],
		}));

		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].path).toBe('floorplan.walls[0].corner2');
		expect(result.errors[0].message).toContain('ghost');
	});

	it('reports every problem, not only the first', () =>
	{
		const result = DesignDocument.parse(JSON.stringify({
			floorplan: {
				corners: {c1: {x: 'left', y: 0}, c2: {x: 0, y: null}},
				walls: [{corner1: 'c1', corner2: 'ghost'}],
				rooms: {},
			},
			items: [],
		}));

		expect(result.ok).toBe(false);
		expect(result.errors.length).toBeGreaterThan(1);
		expect(result.errors.map((e) => e.path)).toContain('floorplan.corners.c1.x');
	});

	it('an unknown units stamp is a warning, not a refusal', () =>
	{
		// Refusing to open a design is a worse outcome than opening one whose scale
		// the user can see is wrong - the rule floorplan.js already followed with a
		// console.warn. It is a structured warning now rather than console noise.
		const result = DesignDocument.parse(JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}, units: 'furlongs'},
			items: [],
		}));

		expect(result.ok).toBe(true);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0].message).toContain('furlongs');
	});

	it('every fixture that opened before still opens', () =>
	{
		// The validator must not be stricter than the corpus of real files. A
		// pre-2.0.0 document has no units stamp and no elevation on its corners.
		const legacy = JSON.stringify({
			floorplan: {
				corners: {a: {x: 0, y: 0}, b: {x: 100, y: 0}},
				walls: [{corner1: 'a', corner2: 'b', wallType: 'CURVED', a: {x: 1, y: 1}, b: {x: 2, y: 2}}],
				rooms: {},
				version: '0.0.2a',
			},
			items: [],
		});
		expect(DesignDocument.parse(legacy).ok).toBe(true);
	});
});

describe('a load has an owner', () =>
{
	/** A loader that hands back deferred resolvers instead of loading. */
	function deferredLoader()
	{
		const pending = [];
		return {
			pending,
			loader: (fileName, metadata, onLoad) =>
			{
				pending.push(() => onLoad(new BufferGeometry().setFromPoints([]), new MeshBasicMaterial()));
			},
		};
	}

	it('items from a superseded load never reach the scene', () =>
	{
		// M-7. Design A's furniture arriving in design B is the defect; the count
		// is what makes it visible.
		const model = new Model('');
		const deferred = deferredLoader();
		model.scene.setItemLoader(deferred.loader);

		model.loadSerialized(validDesign([itemRecord('a1'), itemRecord('a2'), itemRecord('a3')]));
		expect(deferred.pending).toHaveLength(3);
		expect(model.scene.getItems()).toHaveLength(0);

		// A second document arrives while all three are in flight.
		model.loadSerialized(validDesign([itemRecord('b1')]));
		expect(deferred.pending).toHaveLength(4);

		// Everything resolves, in the order the network would have.
		deferred.pending.forEach((resolve) => resolve());

		const names = model.scene.getItems().map((item) => item.metadata.itemName);
		expect(names).toEqual(['b1']);
	});

	it('the item events balance per document', () =>
	{
		// useHistory counts LOADING against LOADED to decide when a restore has
		// settled. A stale callback that dispatches LOADED unbalances a count that
		// is now measuring two documents at once.
		const model = new Model('');
		const deferred = deferredLoader();
		model.scene.setItemLoader(deferred.loader);

		let loading = 0;
		let loaded = 0;
		model.scene.addEventListener(EVENT_ITEM_LOADING, () => {loading += 1;});
		model.scene.addEventListener(EVENT_ITEM_LOADED, () => {loaded += 1;});

		model.loadSerialized(validDesign([itemRecord('a1'), itemRecord('a2')]));
		model.loadSerialized(validDesign([itemRecord('b1')]));
		deferred.pending.forEach((resolve) => resolve());

		// Three starts, three finishes: the two stale ones resolve as finished so
		// nothing is left dangling, and exactly one item is in the scene.
		expect(loading).toBe(3);
		expect(loaded).toBe(3);
		expect(model.scene.getItems()).toHaveLength(1);
	});

	it('a superseded callback does not leak the geometry it was handed', () =>
	{
		// Discarding a stale item means discarding what the loader built for it. A0
		// would be undone here otherwise: the geometry and material arrive whether
		// or not anybody still wants them.
		const model = new Model('');
		const built = [];
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			const geometry = new BufferGeometry().setFromPoints([]);
			const material = new MeshBasicMaterial();
			built.push({geometry, material, resolve: () => onLoad(geometry, material)});
		});

		model.loadSerialized(validDesign([itemRecord('stale')]));
		const stale = built[0];
		let disposed = 0;
		stale.geometry.addEventListener('dispose', () => {disposed += 1;});
		stale.material.addEventListener('dispose', () => {disposed += 1;});

		model.loadSerialized(validDesign([]));
		stale.resolve();

		expect(model.scene.getItems()).toHaveLength(0);
		expect(disposed).toBe(2);
	});

	it('reports what it is doing', () =>
	{
		const model = new Model('');
		const deferred = deferredLoader();
		model.scene.setItemLoader(deferred.loader);

		model.loadSerialized(validDesign([itemRecord('a1'), itemRecord('a2')]));
		const during = model.scene.loadSession.stats();
		expect(during.inFlight).toBe(2);
		expect(during.settled).toBe(false);

		model.loadSerialized(validDesign([]));
		const after = model.scene.loadSession.stats();
		expect(after.generation).toBe(during.generation + 1);
		expect(after.aborted).toBe(2);
		expect(after.inFlight).toBe(0);
		expect(after.settled).toBe(true);
	});

	it('a failed item still settles its session', () =>
	{
		// RM-002 R-01's guarantee, now expressed through the session as well as
		// through the events: every start is matched, whatever happens.
		const model = new Model('');
		model.scene.setItemLoader(null);
		model.loadSerialized(validDesign([
			Object.assign(itemRecord('gone'), {format: 'not-a-format'}),
		]));

		expect(model.scene.loadSession.stats().settled).toBe(true);
		expect(model.scene.loadSession.stats().failed).toBe(1);
	});
});

describe('the load path stops re-deriving once per corner', () =>
{
	it('one document open dispatches far fewer updates', () =>
	{
		// M-4, partly. Opening a four-wall design dispatched EVENT_UPDATED 25 times
		// - once per newCorner, once per newWall, once at the end - and each one
		// drove a full 3D teardown and a camera recentre. A1 batches the build; A2
		// takes it the rest of the way to 1.
		const model = new Model('');
		model.scene.setItemLoader(() => {});

		let updates = 0;
		model.floorplan.addEventListener(EVENT_UPDATED, () => {updates += 1;});
		model.loadSerialized(validDesign());

		expect(updates).toBeLessThanOrEqual(3);
		// ...and the plan is still correct, which is the thing batching could break.
		expect(model.floorplan.getRooms()).toHaveLength(1);
		expect(model.floorplan.getCorners()).toHaveLength(4);
		expect(model.floorplan.getWalls()).toHaveLength(4);
	});

	it('still announces the load itself', () =>
	{
		const model = new Model('');
		model.scene.setItemLoader(() => {});
		let loaded = 0;
		model.addEventListener(EVENT_LOADED, () => {loaded += 1;});

		model.loadSerialized(validDesign());
		expect(loaded).toBe(1);
	});
});

describe('the structured sibling', () =>
{
	it('reports success without throwing', () =>
	{
		const model = new Model('');
		model.scene.setItemLoader(() => {});
		const result = model.loadDocument(validDesign());

		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(model.floorplan.getCorners()).toHaveLength(4);
	});

	it('reports failure without throwing, and without touching the design', () =>
	{
		const model = loadedModel();
		const before = model.exportSerialized();

		const result = model.loadDocument('{"items":[]}');

		expect(result.ok).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(model.exportSerialized()).toBe(before);
	});
});
