// @vitest-environment jsdom
/**
 * Undo that does not re-download the furniture, and a selection that survives
 * an edit (RM-003 A3).
 *
 * ## The two findings
 *
 * **H-6.** `useHistory` is well built and its own docblock argues its case
 * honestly: a snapshot cannot be subtly wrong, and writing command inverses for
 * `Corner.mergeWithIntersected` would be a library rewrite. That reasoning was
 * right when it was written. The cost was the load path: `apply()` calls
 * `loadSerialized()`, and `Model.newRoom` opened with `scene.clearItems()`, so
 * **every undo destroyed every item and re-fetched every model**. Undoing a
 * corner nudge re-downloaded the sofa.
 *
 * A3 does not replace the snapshot with a command stack. It gives items an
 * identity, which is all `newRoom` needed to tell what actually changed: an item
 * the incoming snapshot still has, with the same model, is kept and moved.
 *
 * **H-5, the other half.** `useSelection` held the selected object directly, and
 * `Floorplan.update()` replaces every `Room` and every `HalfEdge` object it
 * finds. So selecting a room and then editing anything at all left the inspector
 * bound to an object no longer in the plan - still editable, and editing it did
 * nothing anybody could see.
 *
 * ## What is measured
 *
 * M-8: `EVENT_ITEM_LOADING` across an undo of an edit that touched no item.
 * Before A3 that was every item in the design; the target is zero.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';

import {effectScope} from 'vue';

import {Model} from '../src/scripts/model/model.js';
import {Main} from '../src/scripts/three/main.js';
import {EVENT_ITEM_LOADING, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED} from '../src/scripts/core/events.js';
import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useSelection, SELECTION_ITEM, SELECTION_WALL, SELECTION_ROOM_2D} from '../src/app/composables/useSelection.js';
import {useHistory} from '../src/app/composables/useHistory.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

/** A four-metre room with three pieces of furniture in it. */
function design(items)
{
	return JSON.stringify({
		floorplan: {
			corners: {
				c1: {x: 0, y: 0, elevation: 0}, c2: {x: 400, y: 0, elevation: 0},
				c3: {x: 400, y: 400, elevation: 0}, c4: {x: 0, y: 400, elevation: 0},
			},
			walls: [
				{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
				{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
			],
			rooms: {}, units: 'cm', version: '2.0.0',
		},
		items: items,
	});
}

function furniture()
{
	return ['sofa', 'lamp', 'table'].map((name, index) => ({
		item_name: name, item_type: 1, model_url: `${name}.glb`, format: 'gltf',
		xpos: index * 50, ypos: 0, zpos: index * 30, rotation: 0,
		scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
	}));
}

/** Count the loads a block of work starts. */
function countLoads(scene, work)
{
	var loads = 0;
	var listener = () => {loads += 1;};
	scene.addEventListener(EVENT_ITEM_LOADING, listener);
	try
	{
		work();
	}
	finally
	{
		scene.removeEventListener(EVENT_ITEM_LOADING, listener);
	}
	return loads;
}

let model;

beforeEach(() =>
{
	resetAll();
	installCanvas2D(window);
	model = new Model('/');
	model.scene.setItemLoader(stubItemLoader(THREE));
});

afterEach(() =>
{
	model = null;
});

describe('restoring a snapshot keeps the furniture it already has (M-8)', () =>
{
	it('an undo of a corner move loads nothing', () =>
	{
		model.loadSerialized(design(furniture()));
		expect(model.scene.getItems()).toHaveLength(3);
		const before = model.exportSerialized();

		const corner = model.floorplan.getCorners()[0];
		corner.move(corner.x - 40, corner.y - 40);

		const loads = countLoads(model.scene, () => {model.loadSerialized(before);});

		expect(loads).toBe(0);
		expect(model.scene.getItems()).toHaveLength(3);
	});

	it('and the items are the same objects, not replacements', () =>
	{
		model.loadSerialized(design(furniture()));
		const items = model.scene.getItems().slice();
		const before = model.exportSerialized();

		const corner = model.floorplan.getCorners()[0];
		corner.move(corner.x - 40, corner.y - 40);
		model.loadSerialized(before);

		expect(model.scene.getItems()).toEqual(items);
	});

	it('keeps their geometry and materials, which is what the fetch was for', () =>
	{
		model.loadSerialized(design(furniture()));
		const geometries = model.scene.getItems().map((item) => item.geometry);
		let disposed = 0;
		geometries.forEach((geometry) => geometry.addEventListener('dispose', () => {disposed += 1;}));
		const before = model.exportSerialized();

		model.floorplan.getCorners()[0].move(10, 10);
		model.loadSerialized(before);

		expect(disposed).toBe(0);
		expect(model.scene.getItems().map((item) => item.geometry)).toEqual(geometries);
	});

	it('puts an item back where the snapshot says it was', () =>
	{
		model.loadSerialized(design(furniture()));
		const before = model.exportSerialized();

		const sofa = model.scene.getItems()[0];
		sofa.position.set(999, 5, 888);
		sofa.rotation.y = 1.25;

		model.loadSerialized(before);

		const restored = model.scene.getItems()[0];
		expect(restored).toBe(sofa);
		expect(restored.position.x).toBe(0);
		expect(restored.position.z).toBe(0);
		expect(restored.rotation.y).toBe(0);
	});

	it('restores a scale exactly, rather than compounding it', () =>
	{
		// Item.setScale multiplies into the current scale rather than replacing
		// it, so handing it the target absolutely would square it on every undo.
		model.loadSerialized(design(furniture()));
		const before = model.exportSerialized();
		const item = model.scene.getItems()[0];
		const scale = item.scale.clone();

		item.setScale(2, 2, 2);
		model.loadSerialized(before);
		model.loadSerialized(before);

		expect(item.scale.x).toBeCloseTo(scale.x, 6);
		expect(item.scale.y).toBeCloseTo(scale.y, 6);
		expect(item.scale.z).toBeCloseTo(scale.z, 6);
	});

	it('loads only the item that is genuinely new', () =>
	{
		model.loadSerialized(design(furniture()));
		const withOneMore = furniture().concat([{
			item_name: 'chair', item_type: 1, model_url: 'chair.glb', format: 'gltf',
			xpos: 300, ypos: 0, zpos: 300, rotation: 0,
			scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
		}]);
		// Give the existing three the ids they already have, as a snapshot would.
		const live = model.scene.getItems();
		withOneMore.forEach((record, index) => {if (live[index]) {record.id = live[index].designId;}});

		const loads = countLoads(model.scene, () => {model.loadSerialized(design(withOneMore));});

		expect(loads).toBe(1);
		expect(model.scene.getItems()).toHaveLength(4);
	});

	it('removes the item a snapshot no longer has, and only that one', () =>
	{
		model.loadSerialized(design(furniture()));
		const removed = [];
		model.scene.addEventListener(EVENT_ITEM_REMOVED, (evt) => {removed.push(evt.item);});

		// Sliced from the SAVED order, not from getItems(): the file is written in
		// id order, which is not the order the items were loaded in.
		const saved = JSON.parse(model.exportSerialized());
		saved.items = saved.items.slice(0, 2);
		const keptIds = saved.items.map((item) => item.id).sort();
		const loads = countLoads(model.scene, () => {model.loadSerialized(JSON.stringify(saved));});

		expect(loads).toBe(0);
		expect(removed).toHaveLength(1);
		expect(model.scene.getItems().map((item) => item.designId).sort()).toEqual(keptIds);
	});

	it('reloads an item whose model url changed, because it is a different thing', () =>
	{
		model.loadSerialized(design(furniture()));
		const saved = JSON.parse(model.exportSerialized());
		saved.items[0].model_url = 'something-else.glb';

		const loads = countLoads(model.scene, () => {model.loadSerialized(JSON.stringify(saved));});

		expect(loads).toBe(1);
	});

	it('reloads an item whose picked colours changed, because a colour cannot be un-picked', () =>
	{
		// An item's original material colour is overwritten when one is chosen and
		// is not kept anywhere, so a colour can be applied to a live item but not
		// removed from it. Undo has to be able to do both, so a colour change makes
		// it a different item and it reloads - which is what used to happen to
		// every item on every undo, and now happens to the one that changed.
		model.loadSerialized(design(furniture()));
		const before = model.exportSerialized();
		model.scene.getItems()[0].setMaterialColor('#ff0000');

		const loads = countLoads(model.scene, () => {model.loadSerialized(before);});

		expect(loads).toBe(1);
	});

	it('opening a different document still loads everything', () =>
	{
		// The reconciliation must not turn a document open into a partial one: a
		// document whose items are unrelated shares no id with what is here.
		model.loadSerialized(design(furniture()));
		const other = furniture().map((item) => Object.assign({}, item, {model_url: `other-${item.model_url}`}));

		const loads = countLoads(model.scene, () => {model.loadSerialized(design(other));});

		expect(loads).toBe(3);
		expect(model.scene.getItems()).toHaveLength(3);
	});

	it('reloads a wall-bound item, and leaves it bound to a wall that exists', () =>
	{
		// The carve-out, and the property it protects. A WallItem holds a
		// `currentWallEdge`, and every load destroys and rebuilds the whole
		// floorplan - so keeping one across a restore would leave it pointing at a
		// HalfEdge that no longer exists, and it would try to detach from that
		// edge when it was eventually removed. Wall-bound items reload; everything
		// else reconciles.
		const window = {
			id: undefined, item_name: 'window', item_type: 2, model_url: 'w.glb', format: 'gltf',
			xpos: 200, ypos: 100, zpos: 0, rotation: 0,
			scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
		};
		model.loadSerialized(design(furniture().concat([window])));
		const wallItem = model.scene.getItems().find((item) => item.boundToFloorplan);
		expect(wallItem).toBeTruthy();
		const before = model.exportSerialized();

		const corner = model.floorplan.getCorners()[0];
		corner.move(corner.x - 20, corner.y - 20);
		const loads = countLoads(model.scene, () => {model.loadSerialized(before);});

		// One load: the wall item. The three free-standing ones were kept.
		expect(loads).toBe(1);
		const restored = model.scene.getItems().find((item) => item.boundToFloorplan);
		expect(restored).not.toBe(wallItem);
		if (restored.currentWallEdge)
		{
			expect(model.floorplan.wallEdges()).toContain(restored.currentWallEdge);
		}
	});

	it('keeps every LOADING matched by exactly one LOADED', () =>
	{
		// RM-002 R-01's guarantee, and reconciliation must not break it by
		// dispatching one without the other for an item it kept.
		model.loadSerialized(design(furniture()));
		let loading = 0;
		let loaded = 0;
		model.scene.addEventListener(EVENT_ITEM_LOADING, () => {loading += 1;});
		model.scene.addEventListener(EVENT_ITEM_LOADED, () => {loaded += 1;});
		const before = model.exportSerialized();

		model.floorplan.getCorners()[0].move(11, 11);
		model.loadSerialized(before);

		expect(loading).toBe(loaded);
	});
});

/**
 * The app store, a selection and a history inside one effect scope, over a
 * mounted blueprint - the same shape `tests/app-composables.test.js` uses. Kept
 * local because this suite is about what happens to both *after* the plan
 * changes.
 */
function mountApp()
{
	const viewer = document.createElement('div');
	viewer.id = 'a3-viewer';
	document.body.appendChild(viewer);
	const wrapper = document.createElement('div');
	const canvas = document.createElement('canvas');
	wrapper.appendChild(canvas);
	document.body.appendChild(wrapper);

	Main.setRendererFactory(() => createRendererStub());
	const observer = installResizeObserver(window);
	const pointerApis = installPointerApis(window);
	const scope = effectScope();
	const store = scope.run(() => createBlueprintStore());
	const blueprint = store.mount({floorplannerElement: canvas, threeElement: viewer});
	const selection = scope.run(() => useSelection(store));
	const history = scope.run(() => useHistory(store));
	blueprint.model.scene.setItemLoader(stubItemLoader(THREE));
	blueprint.model.loadSerialized(design(furniture()));

	return {
		store, blueprint, selection, history,
		teardown: () =>
		{
			scope.stop();
			store.unmount();
			Main.setRendererFactory(null);
			pointerApis.restore();
			observer.restore();
			document.body.innerHTML = '';
		},
	};
}

describe('the selection survives an edit', () =>
{
	it('keeps a selected room selected when a distant wall is edited', () =>
	{
		// The H-5 half nobody sees until they try to use the inspector:
		// Floorplan.update() replaces every Room object, so before A3 this left
		// the panel bound to a room that was no longer in the plan.
		const app = mountApp();
		const floorplan = app.blueprint.model.floorplan;
		const room = floorplan.getRooms()[0];
		app.selection.select(SELECTION_ROOM_2D, room);
		expect(app.selection.selection.value.object).toBe(room);

		const corner = floorplan.getCorners()[0];
		corner.move(corner.x - 30, corner.y - 30);
		floorplan.update();

		const after = app.selection.selection.value;
		expect(after).not.toBeNull();
		expect(after.object).not.toBe(room);
		expect(after.object).toBe(floorplan.getRooms()[0]);
		expect(after.object.id).toBe(room.id);

		app.teardown();
	});

	it('keeps a selected wall face selected across a re-derivation', () =>
	{
		const app = mountApp();
		const floorplan = app.blueprint.model.floorplan;
		const face = floorplan.wallEdges()[0];
		app.selection.select(SELECTION_WALL, face);

		floorplan.update();

		const after = app.selection.selection.value;
		expect(after).not.toBeNull();
		expect(after.object).not.toBe(face);
		expect(after.object.id).toBe(face.id);

		app.teardown();
	});

	it('clears itself when the selected entity is gone, rather than going stale', () =>
	{
		const app = mountApp();
		const floorplan = app.blueprint.model.floorplan;
		app.selection.select(SELECTION_ROOM_2D, floorplan.getRooms()[0]);

		floorplan.getWalls()[0].remove();

		expect(floorplan.getRooms()).toHaveLength(0);
		expect(app.selection.selection.value).toBeNull();

		app.teardown();
	});

	it('keeps a selected item selected across an undo that moves it', () =>
	{
		const app = mountApp();
		const model = app.blueprint.model;
		const item = model.scene.getItems()[0];
		app.selection.select(SELECTION_ITEM, item);
		const before = model.exportSerialized();

		item.position.set(300, 0, 300);
		model.loadSerialized(before);

		expect(app.selection.selection.value.object).toBe(item);

		app.teardown();
	});

	it('still selects something that has no identity at all', () =>
	{
		// Selection is a public surface: an embedder can dispatch
		// EVENT_ITEM_SELECTED with anything. Something with no id is held
		// directly, exactly as everything was before A3 - it simply does not
		// survive a re-derivation.
		const app = mountApp();
		const stranger = {name: 'not a model object'};
		app.selection.select(SELECTION_ITEM, stranger);

		expect(app.selection.selection.value.object).toBe(stranger);

		app.teardown();
	});
});

describe('history says how much it is holding', () =>
{
	it('holds one entry after a document is opened, and no history behind it', () =>
	{
		const app = mountApp();
		const stats = app.history.stats();
		expect(stats.past).toBe(0);
		expect(stats.future).toBe(0);
		expect(stats.entries).toBe(1);
		expect(stats.bytes).toBe(app.blueprint.model.exportSerialized().length);
		expect(stats.limit).toBe(50);
		app.teardown();
	});

	it('counts the snapshots it retains, and the bytes behind them', () =>
	{
		// The docblock's "perhaps 20 KB for a furnished plan" was an estimate
		// nobody could check. This makes it checkable.
		const app = mountApp();
		const floorplan = app.blueprint.model.floorplan;

		app.history.commit();
		const one = app.history.stats();
		floorplan.getCorners()[0].move(10, 10);
		app.history.commit();
		floorplan.getCorners()[0].move(20, 20);
		app.history.commit();

		const three = app.history.stats();
		expect(one.entries).toBe(1);
		expect(three.past).toBe(2);
		expect(three.entries).toBe(3);
		// Three designs of roughly one design's size each. Not exactly three times
		// one, because the corner coordinates that moved are a different number of
		// characters - which is itself the point of counting rather than estimating.
		expect(three.bytes).toBeGreaterThan(one.bytes * 2.9);
		expect(three.bytes).toBeLessThan(one.bytes * 3.1);

		app.teardown();
	});

	it('moves an entry from past to future on undo, holding the same bytes', () =>
	{
		const app = mountApp();
		app.history.commit();
		app.blueprint.model.floorplan.getCorners()[0].move(15, 15);
		app.history.commit();
		const before = app.history.stats();

		app.history.undo();

		const after = app.history.stats();
		expect(after.past).toBe(before.past - 1);
		expect(after.future).toBe(before.future + 1);
		expect(after.entries).toBe(before.entries);

		app.teardown();
	});
});

describe('undo and redo round-trip, over generated edit sequences', () =>
{
	/**
	 * The property A3 owes, in the form that ships.
	 *
	 * The sprint plan called for a command layer with an `invert` per operation
	 * and a property test asserting `apply(invert(c), apply(c, s))` serializes
	 * identically to `s`. That layer was not built - see the note in the roadmap
	 * and the measurements behind it - but the property it was protecting is the
	 * one that matters and is testable against what did ship: **after any edit
	 * and an undo, the design is byte-identical to what it was.**
	 *
	 * It is a real check rather than a tautology because undo is no longer a
	 * wholesale rebuild. Items are reconciled by id and moved in place, and an
	 * in-place update is exactly the kind of thing that can be *nearly* right -
	 * `Item.setScale` multiplying instead of setting is one this caught.
	 *
	 * The sequences are generated from a seeded source, so a failure is
	 * reproducible from the seed printed with it.
	 */
	const EDITS = [
		{
			name: 'move a corner',
			apply: (model, pick) =>
			{
				const corners = model.floorplan.getCorners();
				const corner = corners[pick(corners.length)];
				corner.move(corner.x + pick(80) - 40, corner.y + pick(80) - 40);
			},
		},
		{
			name: 'rename a room',
			apply: (model, pick) =>
			{
				const rooms = model.floorplan.getRooms();
				if (!rooms.length) {return;}
				rooms[pick(rooms.length)].name = `Room ${pick(1000)}`;
			},
		},
		{
			name: 'retexture a room',
			apply: (model, pick) =>
			{
				const rooms = model.floorplan.getRooms();
				if (!rooms.length) {return;}
				rooms[pick(rooms.length)].setTexture(`rooms/textures/t${pick(5)}.png`, true, 100 + pick(300));
			},
		},
		{
			name: 'move an item',
			apply: (model, pick) =>
			{
				const items = model.scene.getItems();
				if (!items.length) {return;}
				const item = items[pick(items.length)];
				item.position.set(pick(300), 0, pick(300));
			},
		},
		{
			name: 'rotate an item',
			apply: (model, pick) =>
			{
				const items = model.scene.getItems();
				if (!items.length) {return;}
				items[pick(items.length)].rotation.y = pick(6) / 2;
			},
		},
		{
			name: 'recolour an item',
			apply: (model, pick) =>
			{
				const items = model.scene.getItems();
				if (!items.length) {return;}
				items[pick(items.length)].setMaterialColor(`#${(pick(0xffffff)).toString(16).padStart(6, '0')}`);
			},
		},
		{
			name: 'scale an item',
			apply: (model, pick) =>
			{
				const items = model.scene.getItems();
				if (!items.length) {return;}
				const factor = 1 + (pick(20) / 20);
				items[pick(items.length)].setScale(factor, factor, factor);
			},
		},
		{
			name: 'set a wall thickness',
			apply: (model, pick) =>
			{
				const walls = model.floorplan.getWalls();
				walls[pick(walls.length)].thickness = 5 + pick(20);
			},
		},
	];

	/** A 32-bit LCG, so a failing sequence can be replayed from its seed. */
	function picker(seed)
	{
		let state = seed >>> 0;
		return (limit) =>
		{
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return limit ? state % limit : 0;
		};
	}

	for (let seed = 1; seed <= 12; seed++)
	{
		it(`restores the design exactly, sequence ${seed}`, () =>
		{
			const pick = picker(seed);
			const model = new Model('/');
			model.scene.setItemLoader(stubItemLoader(THREE));
			model.loadSerialized(design(furniture()));

			for (let step = 0; step < 6; step++)
			{
				const edit = EDITS[pick(EDITS.length)];
				const before = model.exportSerialized();

				edit.apply(model, pick);

				model.loadSerialized(before);
				expect(model.exportSerialized(), `seed ${seed}, step ${step}, "${edit.name}"`).toBe(before);
			}
		});
	}

	it('and a whole sequence undone step by step comes back to the start', () =>
	{
		const pick = picker(99);
		const model = new Model('/');
		model.scene.setItemLoader(stubItemLoader(THREE));
		model.loadSerialized(design(furniture()));

		const stack = [];
		for (let step = 0; step < 8; step++)
		{
			stack.push(model.exportSerialized());
			EDITS[pick(EDITS.length)].apply(model, pick);
		}

		while (stack.length)
		{
			const previous = stack.pop();
			model.loadSerialized(previous);
			expect(model.exportSerialized()).toBe(previous);
		}
	});
});
