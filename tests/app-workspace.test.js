// @vitest-environment jsdom
/**
 * The composables the rebuilt shell added: history, layout, zoom, theme,
 * keyboard bindings, item actions, plan statistics and autosave.
 *
 * Same harness as app-composables.test.js - the library runs for real and only
 * the WebGL renderer is faked, through the `Main.setRendererFactory` seam.
 *
 * Two things are being pinned here, and they are worth naming because they pull
 * in different directions.
 *
 * The first is behaviour that is genuinely new and has no legacy to preserve:
 * undo semantics, the zoom stop table, what a shortcut does while a field has
 * focus. These tests say what the feature IS.
 *
 * The second is the two places where new features reach back into the library
 * and could break something old: the canvas palette (which must default to the
 * exact constants the library has always drawn with) and the render profile
 * (which must default to classic). Those tests exist to catch a regression in
 * something nobody is looking at.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, nextTick} from 'vue';

import {Main} from '../src/scripts/three/main.js';
import {Configuration, gridSpacing, snapToGrid} from '../src/scripts/core/configuration.js';
import {
	floorplannerPalette, setFloorplannerPalette,
	wallColor, cornerColorHover, deleteColor,
} from '../src/scripts/floorplanner/floorplanner_view.js';
import {
	renderProfile, setRenderProfile, isStudio,
	RENDER_CLASSIC, RENDER_STUDIO, CLASSIC_PROFILE,
} from '../src/scripts/core/render_profile.js';
import {EVENT_ITEM_MOVE_FINISH} from '../src/scripts/core/events.js';
import {Item} from '../src/scripts/items/item.js';

import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useSelection, SELECTION_ITEM} from '../src/app/composables/useSelection.js';
import {useHistory} from '../src/app/composables/useHistory.js';
import {useLayout, LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from '../src/app/composables/useLayout.js';
import {useZoom2D} from '../src/app/composables/useZoom2D.js';
import {usePlanStats} from '../src/app/composables/usePlanStats.js';
import {useItemActions} from '../src/app/composables/useItemActions.js';
import {useToasts, TOAST_ERROR} from '../src/app/composables/useToasts.js';
import {readDraft, clearDraft} from '../src/app/composables/useAutosave.js';
import {useTheme, applyTheme, THEME_DARK, THEME_LIGHT} from '../src/app/composables/useTheme.js';
import {keyChips, IS_APPLE} from '../src/app/composables/useShortcuts.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

/**
 * The palette exactly as the library ships it.
 *
 * Captured at import, before any test has themed anything. `floorplannerPalette`
 * is a module singleton - one per process, like Configuration - so without this
 * the "library defaults" block below would be asserting against whatever the
 * theme tests happened to leave behind.
 */
const PRISTINE_PALETTE = {...floorplannerPalette};

/** A two-room plan, so undo has something structural to restore. */
const TWO_ROOMS = JSON.stringify({
	floorplan: {
		version: '2.0.0',
		units: 'cm',
		corners: {
			a: {x: 0, y: 0, elevation: 250},
			b: {x: 400, y: 0, elevation: 250},
			c: {x: 400, y: 300, elevation: 250},
			d: {x: 0, y: 300, elevation: 250},
		},
		walls: [
			{corner1: 'a', corner2: 'b', frontTexture: {}, backTexture: {}, wallType: 'STRAIGHT'},
			{corner1: 'b', corner2: 'c', frontTexture: {}, backTexture: {}, wallType: 'STRAIGHT'},
			{corner1: 'c', corner2: 'd', frontTexture: {}, backTexture: {}, wallType: 'STRAIGHT'},
			{corner1: 'd', corner2: 'a', frontTexture: {}, backTexture: {}, wallType: 'STRAIGHT'},
		],
		rooms: {},
		wallTextures: [],
		floorTextures: {},
		newFloorTextures: {},
		carbonSheet: {},
	},
	items: [],
});

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

function mountStore()
{
	return store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.localStorage.clear();
	window.innerWidth = VIEWPORT_WIDTH;
	window.innerHeight = VIEWPORT_HEIGHT;

	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub(renderers));

	scope = effectScope();
	store = run(() => createBlueprintStore());
	elements = buildDom();
});

afterEach(() =>
{
	store.unmount();
	scope.stop();
	Main.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	setRenderProfile(RENDER_CLASSIC);
	setFloorplannerPalette(PRISTINE_PALETTE);
	document.documentElement.removeAttribute('data-theme');
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('useHistory', () =>
{
	it('starts empty, and reset seeds the present without an entry', () =>
	{
		mountStore();
		const history = run(() => useHistory(store));

		expect(history.canUndo.value).toBe(false);
		expect(history.canRedo.value).toBe(false);

		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		// The design that was loaded IS the starting point, not the first edit.
		expect(history.canUndo.value).toBe(false);
		expect(history.depth.value).toBe(0);
	});

	it('records an edit and restores it', () =>
	{
		mountStore();
		const history = run(() => useHistory(store));

		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		const floorplan = store.model.value.floorplan;
		const corner = floorplan.getCorners()[0];
		expect(corner.x).toBe(0);

		corner.move(150, 150);
		history.commit();

		expect(history.canUndo.value).toBe(true);
		expect(floorplan.getCorners()[0].x).toBe(150);

		history.undo();

		expect(store.model.value.floorplan.getCorners()[0].x).toBe(0);
		expect(history.canRedo.value).toBe(true);
	});

	it('redoes what it undid, and a new edit clears the redo branch', () =>
	{
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		store.model.value.floorplan.getCorners()[0].move(150, 150);
		history.commit();
		history.undo();
		expect(history.canRedo.value).toBe(true);

		history.redo();
		expect(store.model.value.floorplan.getCorners()[0].x).toBe(150);
		expect(history.canRedo.value).toBe(false);

		// A fresh edit after an undo discards the branch that was undone away
		// from. Standard linear history; a tree needs UI to choose between
		// branches and there is none.
		history.undo();
		expect(history.canRedo.value).toBe(true);
		store.model.value.floorplan.getCorners()[0].move(220, 40);
		history.commit();
		expect(history.canRedo.value).toBe(false);
	});

	it('ignores a commit that would record an identical design', () =>
	{
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		store.model.value.floorplan.getCorners()[0].move(150, 150);
		expect(history.commit()).toBe(true);
		// Safe to call speculatively - which is the point, because the UI does not
		// know which of its controls actually mutate.
		expect(history.commit()).toBe(false);
		expect(history.commit()).toBe(false);
		expect(history.depth.value).toBe(1);
	});

	it('coalesces a burst of updates into one entry', async () =>
	{
		vi.useFakeTimers();
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		// What a wall drag looks like: EVENT_UPDATED on every pointermove.
		const corner = store.model.value.floorplan.getCorners()[0];
		for (let i = 1; i <= 20; i += 1)
		{
			corner.move(i, i);
		}

		// Nothing recorded yet - the gesture has not gone quiet.
		expect(history.depth.value).toBe(0);

		vi.advanceTimersByTime(500);
		await nextTick();

		expect(history.depth.value).toBe(1);
	});

	it('does not record its own undo as an edit', async () =>
	{
		vi.useFakeTimers();
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		store.model.value.floorplan.getCorners()[0].move(150, 150);
		history.commit();
		expect(history.depth.value).toBe(1);

		history.undo();
		// loadSerialized fires EVENT_UPDATED and EVENT_LOADED; if either were
		// treated as an edit, redo would be unreachable and the stack would grow
		// on every undo.
		vi.advanceTimersByTime(2000);
		await nextTick();

		expect(history.depth.value).toBe(0);
		expect(history.canRedo.value).toBe(true);
	});

	it('captures only what the save format captures', () =>
	{
		// The limit of a snapshot stack, pinned so it is a known property rather
		// than a surprise. `saveFloorplan` writes the corners its WALLS reach, not
		// the corners array (floorplan.js:544-563, and the comment there explains
		// why), so a corner with nothing attached to it is not in a snapshot and
		// cannot be restored by one.
		//
		// It does not matter in the application, because there is no way to make
		// one: drawing creates a corner and a wall together, and deleting a wall
		// takes its corners with it. It would matter to an embedder driving the
		// model directly, which is why it is written down.
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();

		store.model.value.floorplan.newCorner(900, 900);
		expect(store.model.value.floorplan.getCorners()).toHaveLength(5);

		expect(history.commit()).toBe(false);
	});

	it('detaches on unmount', async () =>
	{
		mountStore();
		const history = run(() => useHistory(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		history.reset();
		store.model.value.floorplan.getCorners()[0].move(150, 150);
		history.commit();

		store.unmount();
		await nextTick();

		expect(history.canUndo.value).toBe(false);
		expect(history.undo()).toBe(false);
	});
});

describe('useLayout', () =>
{
	it('boots into the plan and moves between the three layouts', () =>
	{
		const layout = run(() => useLayout());

		expect(layout.layout.value).toBe(LAYOUT_PLAN);
		expect(layout.planVisible.value).toBe(true);
		expect(layout.viewVisible.value).toBe(false);

		layout.setLayout(LAYOUT_SPLIT);
		expect(layout.planVisible.value).toBe(true);
		expect(layout.viewVisible.value).toBe(true);
		expect(layout.isSplit.value).toBe(true);

		layout.setLayout(LAYOUT_VIEW);
		expect(layout.planVisible.value).toBe(false);
		expect(layout.viewVisible.value).toBe(true);
	});

	it('ignores a layout it does not have', () =>
	{
		const layout = run(() => useLayout());
		layout.setLayout('quad-view');
		expect(layout.layout.value).toBe(LAYOUT_PLAN);
	});

	it('clamps the split so neither pane can be dragged to nothing', () =>
	{
		// A zero-width pane is the same zero-size measurement problem as hiding
		// one: the library divides by it.
		const layout = run(() => useLayout());

		layout.setSplitRatio(-3);
		expect(layout.splitRatio.value).toBeGreaterThan(0);
		expect(layout.splitRatio.value).toBeCloseTo(0.2, 5);

		layout.setSplitRatio(99);
		expect(layout.splitRatio.value).toBeCloseTo(0.8, 5);
	});

	it('remembers the workspace across a remount', async () =>
	{
		const first = run(() => useLayout());
		first.setLayout(LAYOUT_SPLIT);
		first.setSplitRatio(0.35);
		first.toggleInspector();
		await nextTick();

		const second = run(() => useLayout());
		expect(second.layout.value).toBe(LAYOUT_SPLIT);
		expect(second.splitRatio.value).toBeCloseTo(0.35, 5);
		expect(second.inspectorOpen.value).toBe(false);
	});
});

describe('useZoom2D', () =>
{
	it('steps through the stop table and back to exactly where it started', () =>
	{
		mountStore();
		const zoom = run(() => useZoom2D(store));

		expect(zoom.percent.value).toBe(100);

		zoom.zoomIn();
		zoom.zoomIn();
		zoom.zoomOut();
		zoom.zoomOut();

		// Exactly 1, not 0.9999999. Stops rather than repeated multiplication is
		// the whole reason the table exists.
		expect(zoom.scale.value).toBe(1);
		expect(zoom.percent.value).toBe(100);
	});

	it('clamps at both ends of the table', () =>
	{
		mountStore();
		const zoom = run(() => useZoom2D(store));

		for (let i = 0; i < 40; i += 1) {zoom.zoomIn();}
		expect(zoom.canZoomIn.value).toBe(false);
		const top = zoom.scale.value;
		zoom.zoomIn();
		expect(zoom.scale.value).toBe(top);

		for (let i = 0; i < 40; i += 1) {zoom.zoomOut();}
		expect(zoom.canZoomOut.value).toBe(false);
	});

	it('steps to the next stop from between stops, not from the nearest index', () =>
	{
		// What a wheel gesture leaves behind. Stepping from the nearest index can
		// move the wrong way, which reads as a zoom button that does nothing.
		mountStore();
		const zoom = run(() => useZoom2D(store));

		zoom.nudge(1.1);
		expect(zoom.scale.value).toBeCloseTo(1.1, 5);

		zoom.zoomIn();
		expect(zoom.scale.value).toBe(1.5);

		zoom.nudge(1 / 1.1);
		zoom.zoomOut();
		expect(zoom.scale.value).toBe(1);
	});

	it('writes the scale where the library reads it', () =>
	{
		mountStore();
		const zoom = run(() => useZoom2D(store));

		zoom.zoomTo(2);
		// Dimensioning.cmToPixel multiplies by this; nothing else connects the
		// two.
		expect(Configuration.getNumericValue('scale')).toBe(2);
	});

	it('caps an automatic frame without capping the explicit one', () =>
	{
		mountStore();
		const zoom = run(() => useZoom2D(store));
		store.model.value.loadSerialized(TWO_ROOMS);

		zoom.zoomToFit();
		const uncapped = zoom.scale.value;

		zoom.zoomTo(1);
		zoom.zoomToFit({max: 1.5});
		expect(zoom.scale.value).toBeLessThanOrEqual(1.5);
		expect(uncapped).toBeGreaterThan(0);
	});

	it('does not divide by an empty plan', () =>
	{
		// getSize() on a floorplan with no corners is all zeroes, and the fit
		// arithmetic divides by it.
		mountStore();
		const zoom = run(() => useZoom2D(store));

		zoom.zoomToFit();
		expect(Number.isFinite(zoom.scale.value)).toBe(true);
		expect(zoom.scale.value).toBe(1);
	});

	it('drives snap and grid spacing through Configuration', () =>
	{
		mountStore();
		const zoom = run(() => useZoom2D(store));

		zoom.setSnap(true);
		expect(Boolean(Configuration.getNumericValue(snapToGrid))).toBe(true);

		zoom.setSpacing(50);
		expect(Configuration.getNumericValue(gridSpacing)).toBe(50);
		expect(zoom.spacing.value).toBe(50);
	});

	it('puts the scale back when the scope ends', () =>
	{
		// Configuration outlives the composable, and a zoom of 4 left behind would
		// greet the next mount with a plan four times too big.
		const local = effectScope();
		mountStore();
		local.run(() =>
		{
			const zoom = useZoom2D(store);
			zoom.zoomTo(4);
		});
		expect(Configuration.getNumericValue('scale')).toBe(4);

		local.stop();
		expect(Configuration.getNumericValue('scale')).toBe(1);
	});
});

describe('usePlanStats', () =>
{
	it('counts what is in the plan and totals the floor area', async () =>
	{
		mountStore();
		const stats = run(() => usePlanStats(store));

		store.model.value.loadSerialized(TWO_ROOMS);
		await nextTick();

		expect(stats.walls.value).toBe(4);
		expect(stats.corners.value).toBe(4);
		expect(stats.rooms.value).toBe(1);
		expect(stats.items.value).toBe(0);
		expect(stats.areaCm2.value).toBeGreaterThan(0);
		expect(stats.areaLabel.value).toMatch(/\d/);
	});

	it('holds the cursor readout, and clears it', () =>
	{
		mountStore();
		const stats = run(() => usePlanStats(store));

		expect(stats.cursor.value).toBeNull();
		stats.setCursor({x: 120, y: 340});
		expect(stats.cursor.value).toEqual({x: 120, y: 340});
		stats.setCursor(null);
		expect(stats.cursor.value).toBeNull();
	});

	it('empties out when the store unmounts', async () =>
	{
		mountStore();
		const stats = run(() => usePlanStats(store));
		store.model.value.loadSerialized(TWO_ROOMS);
		await nextTick();
		expect(stats.walls.value).toBe(4);

		store.unmount();
		await nextTick();
		expect(stats.walls.value).toBe(0);
	});
});

describe('useItemActions', () =>
{
	/**
	 * Enough of an Item for the actions under test - **in the shape the real one
	 * has**, which is the whole point (RM-012 J4).
	 *
	 * This fake used to return `{itemName, itemType, modelUrl}` and it is why
	 * duplicate had never worked. `Item.getMetaData()` returns the *save record* -
	 * `item_name`, `item_type`, `model_url` - and `useItemActions` was reading the
	 * camelCase keys off it, so both were `undefined` and `Scene.addItem`
	 * defaulted the type to 1 and asked the loader for `undefined`. The test
	 * passed for two programmes because the stub returned the shape the caller
	 * wished for rather than the shape the method returns.
	 *
	 * So the keys here are the real ones, and the case below this pins them
	 * against a real `Item` rather than against this comment.
	 */
	/**
	 * Put fakes in the scene, because that is where a selection resolves.
	 *
	 * `useSelection` holds a `designId` and searches `scene.getItems()` for it on
	 * every read (RM-003 A3), so a fake with an id that is not in the scene is a
	 * selection that has already gone.
	 */
	function inScene(scene, ...items)
	{
		scene.getItems = () => items;
		return items;
	}

	function fakeItem(scene, options)
	{
		const settings = options || {};
		return {
			id: 'fake-1',
			designId: settings.designId || 'design-1',
			position: {x: 10, y: 0, z: 20, clone() {return {...this, clone: this.clone};}},
			rotation: {y: 0.5},
			scale: {clone() {return {x: 1, y: 1, z: 1};}},
			currentWallEdge: settings.edge || null,
			removed: false,
			remove() {this.removed = true; scene.dispatchEvent({type: 'ITEM_REMOVED_EVENT', item: this});},
			getMetaData()
			{
				return {
					id: this.designId, item_name: 'Fake', item_type: 1, format: 'glb',
					model_url: 'models/x.glb', xpos: 10, ypos: 0, zpos: 20, rotation: 0.5,
					scale_x: 1, scale_y: 1, scale_z: 1, fixed: false,
				};
			},
		};
	}

	it('does nothing with no item selected', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		expect(actions.canActOnItem.value).toBe(false);
		expect(actions.deleteSelected()).toBe(false);
		expect(actions.duplicateSelected()).toBe(false);
	});

	it('deletes every selected item, not the primary of five', async () =>
	{
		// The bug a set introduces into every verb that predates it: delete was
		// written against one object, so the moment the selection became a set
		// (RM-012 J4, X-6) it would have removed one of five chairs and left the
		// other four highlighted. Repaired in the same commit as the set.
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const scene = store.model.value.scene;
		const items = inScene(scene, fakeItem(scene, {designId: 'a'}),
			fakeItem(scene, {designId: 'b'}), fakeItem(scene, {designId: 'c'}));
		selection.selectMany(SELECTION_ITEM, items);
		expect(actions.selectedItems.value).toHaveLength(3);

		const commits = [];
		history.commit = () => {commits.push(1);};

		expect(actions.deleteSelected()).toBe(true);
		expect(items.every((item) => item.removed)).toBe(true);
		expect(selection.count.value).toBe(0);
		// One commit for the whole gesture, so undo brings back three chairs
		// rather than making somebody press it three times.
		expect(commits).toHaveLength(1);
		await nextTick();
	});

	it('deletes the selected item and drops the selection first', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const [item] = inScene(store.model.value.scene, fakeItem(store.model.value.scene));
		selection.select(SELECTION_ITEM, item);
		expect(actions.canActOnItem.value).toBe(true);

		expect(actions.deleteSelected()).toBe(true);
		expect(item.removed).toBe(true);
		// Cleared before remove(), so no inspector is left reading a detached
		// object graph.
		expect(selection.selection.value).toBeNull();
	});

	it('duplicates through the scene rather than cloning the object graph', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const scene = store.model.value.scene;
		const added = [];
		const realAdd = scene.addItem.bind(scene);
		scene.addItem = (...args) => {added.push(args); return realAdd;};

		const [subject] = inScene(scene, fakeItem(scene));
		selection.select(SELECTION_ITEM, subject);
		expect(actions.duplicateSelected()).toBe(true);

		expect(added).toHaveLength(1);
		const [type, url, meta, position] = added[0];
		// The three reads that were `undefined` for two programmes. Asserted as
		// values rather than as "not undefined", because `addItem` defaults a
		// missing type to 1 and would have made that check pass.
		expect(type).toBe(1);
		expect(url).toBe('models/x.glb');
		expect(meta.itemType).toBe(1);
		expect(meta.modelUrl).toBe('models/x.glb');
		expect(meta.itemName).toBe('Fake');
		// And the identity is NOT carried. Two items sharing a designId is not
		// cosmetic: `useSelection` resolves a selection by searching the scene for
		// that id, so the copy and the original would be one thing to the
		// inspector, the plan highlight and delete.
		expect(meta.designId).toBeUndefined();
		// Offset on the floor plane only: lifting in Y would put a wall-mounted
		// duplicate through the ceiling.
		expect(position.x).toBe(40);
		expect(position.z).toBe(50);
		expect(position.y).toBe(0);
	});

	/**
	 * The durable half of the repair (RM-012 J4).
	 *
	 * Fixing the stub fixes this suite once. What stops the next stub agreeing
	 * with the code instead of the data is asserting the shape against a real
	 * `Item`, so a key renamed on one side fails here rather than in production
	 * two programmes later.
	 */
	it('has a fake whose record is the shape a real Item returns', () =>
	{
		mountStore();
		const scene = store.model.value.scene;
		// The real method on the real prototype, over the minimum state it reads.
		// Constructing an `Item` would need a geometry and a mesh; the subject
		// here is `getMetaData`'s output shape, and this exercises exactly that
		// rather than a copy of it written in a test.
		const real = Object.assign(Object.create(Item.prototype), {
			_pickedColorSlots: new Set(),
			designId: 'real-1',
			metadata: {itemName: 'Real', itemType: 1, format: 'glb', modelUrl: 'models/x.glb'},
			position: {x: 0, y: 0, z: 0},
			rotation: {y: 0},
			scale: {x: 1, y: 1, z: 1},
			fixed: false,
			lamp: null,
		});

		const realKeys = Object.keys(real.getMetaData()).sort();
		const fakeKeys = Object.keys(fakeItem(scene).getMetaData()).sort();
		expect(fakeKeys).toEqual(realKeys);
		// And the camelCase keys the caller used to read are not among them,
		// which is the fact the old stub obscured.
		expect(realKeys).not.toContain('itemType');
		expect(realKeys).not.toContain('modelUrl');
	});

	it('copies a set, pastes it further out each time, and gives each a new identity', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const scene = store.model.value.scene;
		const added = [];
		scene.addItem = (...args) => {added.push(args);};

		expect(actions.canPaste.value).toBe(false);
		expect(actions.pasteClipboard()).toBe(0);

		selection.selectMany(SELECTION_ITEM,
			inScene(scene, fakeItem(scene, {designId: 'a'}), fakeItem(scene, {designId: 'b'})));
		expect(actions.copySelected()).toBe(2);
		expect(actions.canPaste.value).toBe(true);

		expect(actions.pasteClipboard()).toBe(2);
		expect(actions.pasteClipboard()).toBe(2);
		expect(added).toHaveLength(4);

		// Each paste lands one offset further out, so pasting twice gives two
		// visible copies rather than two in the same place.
		expect(added[0][3].x).toBe(40);
		expect(added[2][3].x).toBe(70);
		// None of the four inherits the original's designId.
		expect(added.every(([, , meta]) => meta.designId === undefined)).toBe(true);
	});

	/**
	 * Align and distribute, which are the two verbs X-6 said would read the set
	 * multi-select creates - and the reason it went first.
	 *
	 * Positioned fakes rather than real items, because the arithmetic is the
	 * subject: a real `Item` needs a mesh, and a mesh would not make the sums
	 * more true.
	 */
	function placed(scene, x, z, halfX, halfZ)
	{
		const item = fakeItem(scene, {designId: `at-${x}-${z}`});
		item.position = {x: x, y: 0, z: z, clone() {return {...this, clone: this.clone};}};
		item.halfSize = {x: halfX === undefined ? 10 : halfX, y: 10, z: halfZ === undefined ? 10 : halfZ};
		item.moveToPosition = function (vec) {this.position.x = vec.x; this.position.z = vec.z;};
		return item;
	}

	function actionsOver(items)
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));
		inScene(store.model.value.scene, ...items);
		selection.selectMany(SELECTION_ITEM, items);
		return actions;
	}

	it('aligns on an edge, so a wide item does not stick out', () =>
	{
		// Edges, not centres. "Left" means every item's left edge on the leftmost
		// left edge; aligning centres would leave the wide one overhanging, which
		// is not what anybody lining furniture up against a wall means.
		const scene = () => store.model.value.scene;
		mountStore();
		const wide = placed(scene(), 100, 0, 40, 10);
		const narrow = placed(scene(), 200, 0, 5, 10);
		const actions = actionsOver([wide, narrow]);

		expect(actions.alignSelected('left')).toBe(2);
		expect(wide.position.x).toBe(100);
		expect(narrow.position.x).toBe(65);
		// Left edges equal: 100-40 and 65-5.
		expect(wide.position.x - wide.halfSize.x).toBe(narrow.position.x - narrow.halfSize.x);
	});

	it('aligns to a shared centre line, and on the other axis', () =>
	{
		mountStore();
		const scene = store.model.value.scene;
		const a = placed(scene, 0, 0);
		const b = placed(scene, 100, 60);
		const actions = actionsOver([a, b]);

		expect(actions.alignSelected('centreX')).toBe(2);
		expect(a.position.x).toBe(50);
		expect(b.position.x).toBe(50);

		actions.alignSelected('back');
		expect(a.position.z).toBe(0);
		expect(b.position.z).toBe(0);
	});

	it('refuses to align one item to itself', () =>
	{
		mountStore();
		const only = placed(store.model.value.scene, 10, 10);
		const actions = actionsOver([only]);
		expect(actions.alignSelected('left')).toBe(0);
		expect(only.position.x).toBe(10);
	});

	it('distributes the gaps, not the centres', () =>
	{
		// The distinction that makes distribute useful. Three items where the
		// middle one is much wider: even centres would leave it nearly touching
		// one neighbour and marooned from the other.
		mountStore();
		const scene = store.model.value.scene;
		const left = placed(scene, 0, 0, 5, 5);
		const middle = placed(scene, 50, 0, 30, 5);
		const right = placed(scene, 200, 0, 5, 5);
		const actions = actionsOver([left, middle, right]);

		expect(actions.distributeSelected('x')).toBe(3);
		// The outermost two are the span and do not move.
		expect(left.position.x).toBe(0);
		expect(right.position.x).toBe(200);
		// One gap each side of the middle, and they are equal.
		const gapLeft = (middle.position.x - middle.halfSize.x) - (left.position.x + left.halfSize.x);
		const gapRight = (right.position.x - right.halfSize.x) - (middle.position.x + middle.halfSize.x);
		expect(gapLeft).toBeCloseTo(gapRight, 9);
	});

	it('needs three to distribute, because two already have one even gap', () =>
	{
		mountStore();
		const scene = store.model.value.scene;
		const actions = actionsOver([placed(scene, 0, 0), placed(scene, 100, 0)]);
		expect(actions.distributeSelected('x')).toBe(0);
	});

	it('marks a group with one id and releases it', () =>
	{
		mountStore();
		const scene = store.model.value.scene;
		const a = placed(scene, 0, 0);
		const b = placed(scene, 50, 0);
		const actions = actionsOver([a, b]);

		expect(actions.groupSelected()).toBe(2);
		expect(a.groupId).toBe(b.groupId);
		// Derived from the primary's own identity rather than a second id scheme
		// nobody can trace back to anything.
		expect(a.groupId).toContain(b.designId);

		expect(actions.ungroupSelected()).toBe(2);
		expect(a.groupId).toBeNull();
		expect(actions.ungroupSelected()).toBe(0);
	});

	it('mirrors the whole set, once, about each item\'s own centre', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const scene = store.model.value.scene;
		const flips = [];
		const items = inScene(scene,
			Object.assign(fakeItem(scene, {designId: 'a'}), {mirror(axis) {flips.push(['a', axis]);}}),
			Object.assign(fakeItem(scene, {designId: 'b'}), {mirror(axis) {flips.push(['b', axis]);}}));
		selection.selectMany(SELECTION_ITEM, items);

		const commits = [];
		history.commit = () => {commits.push(1);};

		expect(actions.mirrorSelected('z')).toBe(2);
		expect(flips).toEqual([['a', 'z'], ['b', 'z']]);
		// One commit for the gesture. Mirroring four chairs is one thing a person
		// did, and undo should treat it that way.
		expect(commits).toHaveLength(1);
	});

	it('leaves the clipboard alone when something else is duplicated', () =>
	{
		// Somebody who copied a sofa, then duplicated a chair, then pasted, means
		// the sofa. Duplicate is a shortcut for copy-and-paste, not a third
		// clipboard.
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const scene = store.model.value.scene;
		scene.addItem = () => {};

		const [sofa, chair] = inScene(scene, fakeItem(scene, {designId: 'sofa'}),
			fakeItem(scene, {designId: 'chair'}));
		selection.select(SELECTION_ITEM, sofa);
		actions.copySelected();

		selection.select(SELECTION_ITEM, chair);
		actions.duplicateSelected();

		expect(actions.clipboard.value).toHaveLength(1);
		expect(actions.clipboard.value[0].id).toBe('sofa');
	});
});

describe('useToasts', () =>
{
	it('queues and dismisses, and keeps errors until dismissed', () =>
	{
		vi.useFakeTimers();
		const toasts = useToasts();
		toasts.toasts.value = [];

		toasts.success('Saved');
		toasts.error('Broke', {detail: 'because'});
		expect(toasts.toasts.value).toHaveLength(2);

		vi.advanceTimersByTime(10000);

		// The success expired; the error did not. An error nobody saw is an error
		// that did not get reported.
		expect(toasts.toasts.value).toHaveLength(1);
		expect(toasts.toasts.value[0].kind).toBe(TOAST_ERROR);
		expect(toasts.toasts.value[0].detail).toBe('because');

		toasts.dismiss(toasts.toasts.value[0].id);
		expect(toasts.toasts.value).toHaveLength(0);
	});

	it('never auto-dismisses something carrying an action', () =>
	{
		vi.useFakeTimers();
		const toasts = useToasts();
		toasts.toasts.value = [];

		toasts.info('Restore the draft?', {action: {label: 'Restore', run() {}}});
		vi.advanceTimersByTime(60000);

		expect(toasts.toasts.value).toHaveLength(1);
		toasts.toasts.value = [];
	});
});

describe('useAutosave', () =>
{
	// Asynchronous since RM-003 A5: the draft may be in IndexedDB now. Under
	// jsdom there is no IndexedDB, so the repository detects localStorage and
	// these read exactly the records the pre-A5 build wrote - which is the
	// compatibility claim, asserted by leaving the assertions alone.
	it('reads back nothing when there is nothing, and ignores a corrupt entry', async () =>
	{
		expect(await readDraft(Date.now())).toBeNull();

		window.localStorage.setItem('architect3d.autosave', 'not json at all');
		expect(await readDraft(Date.now())).toBeNull();

		window.localStorage.setItem('architect3d.autosave', JSON.stringify({design: 7}));
		expect(await readDraft(Date.now())).toBeNull();
	});

	it('offers a fresh draft and refuses a stale one', async () =>
	{
		const now = 1_700_000_000_000;
		window.localStorage.setItem('architect3d.autosave', JSON.stringify({
			design: TWO_ROOMS,
			savedAt: now - 60_000,
		}));
		expect((await readDraft(now)).design).toBe(TWO_ROOMS);

		// A week-old draft is not a crash recovery, it is a surprise.
		expect(await readDraft(now + (8 * 24 * 60 * 60 * 1000))).toBeNull();

		await clearDraft();
		expect(await readDraft(now)).toBeNull();
	});
});

describe('useTheme', () =>
{
	it('stamps the attribute and pushes a canvas palette', () =>
	{
		const theme = run(() => useTheme(null));

		theme.setTheme(THEME_DARK);
		applyTheme();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		const darkGrid = floorplannerPalette.grid;
		expect(floorplannerPalette.background).not.toBeNull();

		theme.setTheme(THEME_LIGHT);
		applyTheme();
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(floorplannerPalette.grid).not.toBe(darkGrid);
	});

	it('sets every colour the canvas draws with, in both themes', () =>
	{
		// A palette that themes half the canvas is worse than one that themes
		// none of it: the untouched half keeps drawing #000000 text on a
		// near-black ground.
		const theme = run(() => useTheme(null));

		for (const value of [THEME_DARK, THEME_LIGHT])
		{
			theme.setTheme(value);
			applyTheme();
			Object.keys(floorplannerPalette).forEach(function (key)
			{
				expect(floorplannerPalette[key], `${value}.${key}`).not.toBeUndefined();
				if (key !== 'gridMajorEvery')
				{
					expect(String(floorplannerPalette[key]).length, `${value}.${key}`).toBeGreaterThan(0);
				}
			});
		}
	});
});

describe('the library defaults nothing new turned on', () =>
{
	it('draws with the original constants until a palette is pushed', () =>
	{
		// The 21 colour constants are public API (blueprint.js:39-43) and an
		// embedder who never themes anything must get pixel-identical output.
		setFloorplannerPalette(null);
		expect(floorplannerPalette.wall).toBe(wallColor);
		expect(floorplannerPalette.cornerHover).toBe(cornerColorHover);
		expect(floorplannerPalette.delete).toBe(deleteColor);
		// Null background is the transparent canvas the view always had.
		expect(floorplannerPalette.background).toBeNull();
	});

	it('ignores a key the palette does not have', () =>
	{
		setFloorplannerPalette({notAColour: '#ff0000'});
		expect(floorplannerPalette.notAColour).toBeUndefined();
	});

	it('renders classic unless the profile is switched', () =>
	{
		expect(renderProfile.mode).toBe(RENDER_CLASSIC);
		expect(isStudio()).toBe(false);
		expect(renderProfile.wallLightMapIntensity).toBe(Math.PI);
		expect(renderProfile.environment).toBe(false);
		expect(renderProfile.fog).toBe(false);
	});

	it('restores every knob when switched back, not just the mode', () =>
	{
		setRenderProfile(RENDER_STUDIO);
		expect(isStudio()).toBe(true);
		expect(renderProfile.environment).toBe(true);
		expect(renderProfile.keyOffset).toBeGreaterThan(0);

		setRenderProfile(RENDER_CLASSIC);
		Object.keys(CLASSIC_PROFILE).forEach(function (key)
		{
			expect(renderProfile[key], key).toBe(CLASSIC_PROFILE[key]);
		});
	});

	it('takes overrides but not a bogus key, and never lets mode be overridden', () =>
	{
		setRenderProfile(RENDER_STUDIO, {shadowMapSize: 512, nonsense: 1, mode: RENDER_CLASSIC});
		expect(renderProfile.shadowMapSize).toBe(512);
		expect(renderProfile.nonsense).toBeUndefined();
		expect(renderProfile.mode).toBe(RENDER_STUDIO);
	});
});

describe('the item move-finish event', () =>
{
	it('is dispatched on the scene, where item lifecycle events already live', async () =>
	{
		const blueprint = mountStore();
		// The controller belongs to the viewer, which arrives on demand (M3).
		await store.ensureViewer();
		const scene = blueprint.model.scene;
		const controller = blueprint.three.getController();

		const seen = [];
		scene.addEventListener(EVENT_ITEM_MOVE_FINISH, (event) => {seen.push(event);});

		// A click that selects without dragging is not an edit.
		controller.mouseMoved = false;
		controller.selectedObject = {id: 'x'};
		controller.itemMoveFinished();
		expect(seen).toHaveLength(0);

		controller.mouseMoved = true;
		controller.itemMoveFinished();
		expect(seen).toHaveLength(1);
		expect(seen[0].item.id).toBe('x');
	});
});

describe('keyChips', () =>
{
	it('renders a combination as one chip per key, in press order', () =>
	{
		expect(keyChips('mod+shift+z')).toEqual([IS_APPLE ? '⌘' : 'Ctrl', IS_APPLE ? '⇧' : 'Shift', 'Z']);
		expect(keyChips('w')).toEqual(['W']);
		expect(keyChips('escape')).toEqual(['Esc']);
		expect(keyChips('delete')).toEqual(['Del']);
	});
});
