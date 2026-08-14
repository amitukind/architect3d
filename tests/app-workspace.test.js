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
	/** Enough of an Item for the actions under test. */
	function fakeItem(scene)
	{
		return {
			id: 'fake-1',
			position: {x: 10, y: 0, z: 20, clone() {return {...this, clone: this.clone};}},
			rotation: {y: 0.5},
			scale: {clone() {return {x: 1, y: 1, z: 1};}},
			currentWallEdge: null,
			removed: false,
			remove() {this.removed = true; scene.dispatchEvent({type: 'ITEM_REMOVED_EVENT', item: this});},
			getMetaData() {return {itemName: 'Fake', itemType: 1, modelUrl: 'models/x.glb', format: 'glb'};},
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

	it('deletes the selected item and drops the selection first', () =>
	{
		mountStore();
		const selection = run(() => useSelection(store));
		const history = run(() => useHistory(store));
		const actions = run(() => useItemActions(store, selection, history));

		const item = fakeItem(store.model.value.scene);
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

		selection.select(SELECTION_ITEM, fakeItem(scene));
		expect(actions.duplicateSelected()).toBe(true);

		expect(added).toHaveLength(1);
		const [type, url, meta, position] = added[0];
		expect(type).toBe(1);
		expect(url).toBe('models/x.glb');
		expect(meta.itemName).toBe('Fake');
		// Offset on the floor plane only: lifting in Y would put a wall-mounted
		// duplicate through the ceiling.
		expect(position.x).toBe(40);
		expect(position.z).toBe(50);
		expect(position.y).toBe(0);
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
	it('reads back nothing when there is nothing, and ignores a corrupt entry', () =>
	{
		expect(readDraft(Date.now())).toBeNull();

		window.localStorage.setItem('architect3d.autosave', 'not json at all');
		expect(readDraft(Date.now())).toBeNull();

		window.localStorage.setItem('architect3d.autosave', JSON.stringify({design: 7}));
		expect(readDraft(Date.now())).toBeNull();
	});

	it('offers a fresh draft and refuses a stale one', () =>
	{
		const now = 1_700_000_000_000;
		window.localStorage.setItem('architect3d.autosave', JSON.stringify({
			design: TWO_ROOMS,
			savedAt: now - 60_000,
		}));
		expect(readDraft(now).design).toBe(TWO_ROOMS);

		// A week-old draft is not a crash recovery, it is a surprise.
		expect(readDraft(now + (8 * 24 * 60 * 60 * 1000))).toBeNull();

		clearDraft();
		expect(readDraft(now)).toBeNull();
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
	it('is dispatched on the scene, where item lifecycle events already live', () =>
	{
		const blueprint = mountStore();
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
