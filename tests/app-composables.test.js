// @vitest-environment jsdom
/**
 * Sprint S6: the composables the Vue application is built out of.
 *
 * These are not characterization tests. S6 deliberately replaced the demo's
 * module-level globals - `blueprint3d`, `aWall`, `anItem`, `gui` - with a
 * store, one selection, and a lifetime that can end. What follows pins that new
 * contract, and pins the three bugs the sprint was allowed to fix:
 *
 *   - the EVENT_MODE_RESET payload, read off `.mode` (useFloorplannerMode)
 *   - placing a wall-bound item before any wall has been clicked (useCatalog)
 *   - the item inspector binding to the selected item (see app-shell.test.js)
 *
 * The library runs for real; only the WebGL renderer is faked, through the
 * `Main.setRendererFactory` seam S0 added.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, isReactive, nextTick, toRaw} from 'vue';

import {Main} from '../src/scripts/three/main.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {
	EVENT_MODE_RESET, EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED,
	EVENT_WALL_CLICKED, EVENT_FLOOR_CLICKED, EVENT_NOTHING_CLICKED,
	EVENT_CORNER_2D_CLICKED, EVENT_GLTF_READY, EVENT_FPS_EXIT,
} from '../src/scripts/core/events.js';
import {VIEW_TOP} from '../src/scripts/core/constants.js';

import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useSelection, SELECTION_ITEM, SELECTION_WALL, SELECTION_FLOOR, SELECTION_CORNER_2D} from '../src/app/composables/useSelection.js';
import {useCameraViews, MODE_FLOORPLAN, MODE_DESIGN, MODE_WALKTHROUGH} from '../src/app/composables/useCameraViews.js';
import {useFloorplannerMode} from '../src/app/composables/useFloorplannerMode.js';
import {useDesignIO} from '../src/app/composables/useDesignIO.js';
import {useWalkthrough} from '../src/app/composables/useWalkthrough.js';
import {useCatalog, loadCatalogDetail, loadCatalogPacks} from '../src/app/composables/useCatalog.js';
import {diskFetch, loadCatalogFromDisk, resetCatalogPacks} from './helpers/catalog.js';
import {useCatalogBrowse} from '../src/app/composables/useCatalogBrowse.js';
import {ROOMS} from '../src/app/composables/useCatalog.js';
import {ROOMS as SPLIT_ROOMS} from '../tools/split-catalog.mjs';
import {DEFAULT_DESIGN} from '../src/app/designs/default-design.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

let canvasStub;
let observer;
let pointerApis;
let renderers;
let scope;
let store;
let elements;

/** The two elements App.vue hands to the store, without mounting App.vue. */
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

/**
 * Run a composable inside an effect scope, so its `watch` and `onScopeDispose`
 * behave exactly as they do inside a component - including the teardown, which
 * is half of what these tests are about.
 */
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
	document.body.innerHTML = '';
});

describe('useBlueprint', () =>
{
	it('mounts a blueprint and exposes its three parts', () =>
	{
		const blueprint = mountStore();

		expect(store.instance.value).toBe(blueprint);
		expect(store.model.value).toBe(blueprint.model);
		expect(store.three.value).toBe(blueprint.three);
		expect(store.floorplanner.value).toBe(blueprint.floorplanner);
	});

	it('keeps library objects raw, so identity comparisons still hold', () =>
	{
		const blueprint = mountStore();

		// The whole point of markRaw. A reactive proxy is not === its target, and
		// the library compares walls, corners and items with === in room detection
		// and dedupes EventDispatcher listeners by identity.
		expect(isReactive(store.instance.value)).toBe(false);
		expect(isReactive(store.model.value)).toBe(false);
		expect(toRaw(store.three.value)).toBe(blueprint.three);
		expect(store.model.value.floorplan).toBe(blueprint.model.floorplan);
	});

	it('mounts once', () =>
	{
		const first = mountStore();
		const second = mountStore();

		expect(second).toBe(first);
		expect(renderers).toHaveLength(1);
	});

	it('unmounts, disposing the renderer and clearing every ref', () =>
	{
		mountStore();
		store.unmount();

		expect(store.instance.value).toBeNull();
		expect(store.model.value).toBeNull();
		expect(store.three.value).toBeNull();
		expect(store.floorplanner.value).toBeNull();
		expect(renderers[0].disposed).toBe(true);
		expect(renderers[0].contextLost).toBe(true);
	});

	it('unmounts idempotently, and before a mount', () =>
	{
		expect(() => store.unmount()).not.toThrow();
		mountStore();
		store.unmount();
		expect(() => store.unmount()).not.toThrow();
	});

	it('remounts onto a fresh renderer', () =>
	{
		mountStore();
		store.unmount();
		const second = mountStore();

		expect(second).not.toBeNull();
		expect(renderers).toHaveLength(2);
		expect(renderers[1].disposed).toBe(false);
	});
});

describe('useSelection', () =>
{
	let selection;
	let blueprint;

	beforeEach(() =>
	{
		selection = run(() => useSelection(store));
		blueprint = mountStore();
		blueprint.model.loadSerialized(DEFAULT_DESIGN);
	});

	function anEdge()
	{
		return blueprint.model.floorplan.wallEdges()[0];
	}

	function aRoom()
	{
		return blueprint.model.floorplan.getRooms()[0];
	}

	it('starts with nothing selected and no placement context', () =>
	{
		expect(selection.selection.value).toBeNull();
		expect(selection.placementContext.value).toEqual({wall: null, floor: null});
	});

	it('follows the 3D selection events', () =>
	{
		const item = {name: 'a fake item'};
		blueprint.three.dispatchEvent({type: EVENT_ITEM_SELECTED, item});

		expect(selection.selection.value.type).toBe(SELECTION_ITEM);
		expect(selection.selection.value.object).toBe(item);

		blueprint.three.dispatchEvent({type: EVENT_ITEM_UNSELECTED});
		expect(selection.selection.value).toBeNull();
	});

	/**
	 * RM-012 J4, X-6. The composable held one object, `select` replaced it, and
	 * eight selection types shared that one slot - so multi-select is not a
	 * control over an existing set, it is the set. These are the properties that
	 * had to become true without any of the eight consumers of `selection.value`
	 * changing, because every one of them was written against exactly one object
	 * or null.
	 */
	describe('the selection is a set (RM-012 J4, X-6)', () =>
	{
		/**
		 * Two items with ids, which is how a real item is held - by `designId`,
		 * resolved against the scene on every read, so a selection survives the
		 * re-derivation an edit causes (RM-003 A3). Put in the scene for that
		 * reason: an id that resolves to nothing is a selection that has gone.
		 */
		let items;

		beforeEach(() =>
		{
			// Both halves of the interface the 3D view calls. A stub with
			// `setSelected` and no `setUnselected` is what found the half-guard in
			// `Main.showItemSelected`: it passed the check, became the controller's
			// selection, and threw from inside the library on the *next* click.
			const stub = (id) => ({designId: id, setSelected() {}, setUnselected() {}});
			items = [stub('a'), stub('b')];
			blueprint.model.scene.getItems = () => items;
		});

		function twoItems()
		{
			return items;
		}

		/** Click with the additive modifier held, the way a person does it. */
		function shiftClick(item)
		{
			window.dispatchEvent(new window.PointerEvent('pointerdown', {shiftKey: true, bubbles: true}));
			blueprint.three.dispatchEvent({type: EVENT_ITEM_SELECTED, item});
		}

		function plainClick(item)
		{
			window.dispatchEvent(new window.PointerEvent('pointerdown', {bubbles: true}));
			blueprint.three.dispatchEvent({type: EVENT_ITEM_SELECTED, item});
		}

		it('still means one thing to everything written before it', () =>
		{
			// The migration's whole claim. `selection` is the primary and resolves
			// to the same `{type, object}` it always did, so the inspector, the
			// plan highlight and the item actions read what they read before.
			const [a] = twoItems();
			plainClick(a);
			expect(selection.selection.value).toEqual({type: SELECTION_ITEM, object: a});
			expect(selection.count.value).toBe(1);
			expect(selection.selections.value).toHaveLength(1);
		});

		it('grows when the gesture is additive, and the primary is the last click', () =>
		{
			const [a, b] = twoItems();
			plainClick(a);
			shiftClick(b);

			expect(selection.count.value).toBe(2);
			expect(selection.selectedItems.value).toEqual([a, b]);
			// The primary is what an inspector should show, which is the thing the
			// person just clicked rather than the thing they clicked first.
			expect(selection.selection.value.object).toBe(b);
		});

		it('replaces when the gesture is not, which is the common case', () =>
		{
			const [a, b] = twoItems();
			plainClick(a);
			shiftClick(b);
			plainClick(a);

			expect(selection.count.value).toBe(1);
			expect(selection.selection.value.object).toBe(a);
		});

		it('toggles, because the gesture that adds a fifth removes the third', () =>
		{
			const [a, b] = twoItems();
			plainClick(a);
			shiftClick(b);
			shiftClick(b);

			expect(selection.selectedItems.value).toEqual([a]);
			// And the primary falls back to what is now last rather than to the
			// thing that was just removed.
			expect(selection.selection.value.object).toBe(a);
		});

		it('never mixes kinds, because no verb could read the result', () =>
		{
			// A set holding a wall and a chair has no meaning for align, distribute
			// or stack. So a different kind replaces rather than joining, and the
			// rule lives in the composable rather than at each call site.
			const [a] = twoItems();
			plainClick(a);
			window.dispatchEvent(new window.PointerEvent('pointerdown', {shiftKey: true, bubbles: true}));
			blueprint.model.floorplan.dispatchEvent({
				type: EVENT_CORNER_2D_CLICKED, item: blueprint.model.floorplan.getCorners()[0],
			});

			expect(selection.count.value).toBe(1);
			expect(selection.selection.value.type).toBe(SELECTION_CORNER_2D);
		});

		it('reads the modifier from the gesture, not from the event', () =>
		{
			// The selection events carry no modifier and should not - they come
			// from `src/scripts`, which has no idea there is a set to add to, and
			// threading one through would put application policy inside the
			// library. So the pointerdown that began the gesture is where it is
			// read, and a selection event with no gesture before it is not additive.
			const [a, b] = twoItems();
			plainClick(a);
			blueprint.three.dispatchEvent({type: EVENT_ITEM_SELECTED, item: b});
			expect(selection.count.value).toBe(1);
		});

		it('answers whether one thing is in it', () =>
		{
			const [a, b] = twoItems();
			plainClick(a);
			expect(selection.isSelected(SELECTION_ITEM, a)).toBe(true);
			expect(selection.isSelected(SELECTION_ITEM, b)).toBe(false);
			expect(selection.isSelected(SELECTION_ITEM, null)).toBe(false);
		});

		it('takes a whole set at once, for select-all and for paste', () =>
		{
			const [a, b] = twoItems();
			selection.selectMany(SELECTION_ITEM, [a, b]);
			expect(selection.selectedItems.value).toEqual([a, b]);
			expect(selection.selection.value.object).toBe(b);

			selection.selectMany(SELECTION_ITEM, []);
			expect(selection.selection.value).toBeNull();
			expect(selection.count.value).toBe(0);
		});

		it('shows the whole set in both views, with one primary', async () =>
		{
			// The plan draws every selected footprint and the 3D view highlights
			// every selected item, but only one of them is the controller's - a
			// drag moves one thing, and making `Controller.selectedObject` plural
			// would be J4's whole sprint rather than its first task.
			const shown = {plan: null, three: null};
			blueprint.floorplanner.showSelection = (type, target, extra) =>
			{
				shown.plan = {type, target, extra};
			};
			blueprint.three.showItemsSelected = (list) => {shown.three = list;};

			const [a, b] = twoItems();
			plainClick(a);
			shiftClick(b);
			// The cross-view push is a `watch`, which flushes on the microtask
			// rather than on the assignment - unlike the computeds above it.
			await nextTick();

			expect(shown.plan.target).toBe(b);
			expect(shown.plan.extra).toEqual(['a']);
			expect(shown.three).toEqual([a, b]);
		});
	});

	it('follows the 2D click events', () =>
	{
		const corner = blueprint.model.floorplan.getCorners()[0];
		blueprint.model.floorplan.dispatchEvent({type: EVENT_CORNER_2D_CLICKED, item: corner});

		expect(selection.selection.value.type).toBe(SELECTION_CORNER_2D);
		expect(selection.selection.value.object).toBe(corner);

		blueprint.model.floorplan.dispatchEvent({type: EVENT_NOTHING_CLICKED});
		expect(selection.selection.value).toBeNull();
	});

	it('records the last clicked wall as the placement context', () =>
	{
		const edge = anEdge();
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});

		expect(selection.selection.value.type).toBe(SELECTION_WALL);
		expect(selection.placementContext.value.wall).toBe(edge);
		expect(selection.placementContext.value.floor).toBeNull();
	});

	it('records the last clicked floor, replacing the wall', () =>
	{
		const edge = anEdge();
		const room = aRoom();
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});
		blueprint.three.dispatchEvent({type: EVENT_FLOOR_CLICKED, item: room});

		expect(selection.selection.value.type).toBe(SELECTION_FLOOR);
		expect(selection.placementContext.value.wall).toBeNull();
		expect(selection.placementContext.value.floor).toBe(room);
	});

	it('keeps the placement context when an item is selected afterwards', () =>
	{
		// Deliberate: selecting a window must not forget which wall you were
		// working on, or placing a second one on the same wall would need another
		// wall click first. The demo got this by never clearing `aWall`.
		const edge = anEdge();
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});
		blueprint.three.dispatchEvent({type: EVENT_ITEM_SELECTED, item: {name: 'a fake item'}});

		expect(selection.selection.value.type).toBe(SELECTION_ITEM);
		expect(selection.placementContext.value.wall).toBe(edge);
	});

	it('keeps the selected object raw', () =>
	{
		const edge = anEdge();
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});

		expect(isReactive(selection.selection.value.object)).toBe(false);
		expect(selection.selection.value.object).toBe(edge);
	});

	it('detaches on unmount, and does not follow a dead view', async () =>
	{
		const three = blueprint.three;
		store.unmount();
		await nextTick();

		expect(selection.selection.value).toBeNull();
		three.dispatchEvent({type: EVENT_ITEM_SELECTED, item: {name: 'too late'}});
		expect(selection.selection.value).toBeNull();
	});
});

describe('useFloorplannerMode', () =>
{
	let editor;
	let blueprint;

	beforeEach(() =>
	{
		editor = run(() => useFloorplannerMode(store));
		blueprint = mountStore();
	});

	it('starts in the mode the library booted into', () =>
	{
		expect(editor.mode.value).toBe(floorplannerModes.MOVE);
	});

	it('follows setMode', () =>
	{
		editor.setMode(floorplannerModes.DRAW);
		expect(editor.mode.value).toBe(floorplannerModes.DRAW);

		editor.setMode(floorplannerModes.DELETE);
		expect(editor.mode.value).toBe(floorplannerModes.DELETE);
	});

	it('follows a mode the library changes by itself', () =>
	{
		// Esc while drawing drops back to MOVE without the app asking. A ref set
		// on click would be wrong here; reading the event is not.
		blueprint.floorplanner.setMode(floorplannerModes.DRAW);
		expect(editor.mode.value).toBe(floorplannerModes.DRAW);

		blueprint.floorplanner.escapeKey();
		expect(editor.mode.value).toBe(floorplannerModes.MOVE);
	});

	it('reads the mode off the event, which is what the demo got wrong', () =>
	{
		// The regression test for the dead toolbar highlight. The demo's handler
		// was `function(mode){ if (mode == floorplannerModes.DRAW) ... }` against
		// three's EventDispatcher, which passes the whole event object - so the
		// comparison was between an object and a number and never once matched.
		let received = null;
		blueprint.floorplanner.addEventListener(EVENT_MODE_RESET, (evt) => {received = evt;});
		blueprint.floorplanner.setMode(floorplannerModes.DRAW);

		expect(received).not.toBe(floorplannerModes.DRAW);
		expect(received.mode).toBe(floorplannerModes.DRAW);
		expect(editor.mode.value).toBe(received.mode);
	});

	it('stops following after unmount', async () =>
	{
		const floorplanner = blueprint.floorplanner;
		store.unmount();
		await nextTick();

		floorplanner.dispatchEvent({type: EVENT_MODE_RESET, mode: floorplannerModes.DELETE});
		expect(editor.mode.value).not.toBe(floorplannerModes.DELETE);
	});
});

describe('useCameraViews', () =>
{
	let camera;
	let blueprint;

	beforeEach(() =>
	{
		camera = run(() => useCameraViews(store));
		blueprint = mountStore();
		blueprint.model.loadSerialized(DEFAULT_DESIGN);
	});

	it('boots into the 2D pane, not spinning, with 3D rendering paused', () =>
	{
		// The demo's boot state, reproduced: `spin: true` at construction and
		// stopSpin() immediately after. hasClicked is what stopSpin sets, and it
		// is also what suppresses the hover resume - so `spin: false` would not
		// be the same thing.
		expect(camera.mode.value).toBe(MODE_FLOORPLAN);
		expect(blueprint.three.options.spin).toBe(true);
		expect(blueprint.three.hasClicked).toBe(true);
		expect(blueprint.three.controls.autoRotate).toBe(false);
		expect(blueprint.three.pauseRender).toBe(true);
	});

	it('resumes rendering when the 3D pane is shown', () =>
	{
		camera.showDesign();

		expect(camera.mode.value).toBe(MODE_DESIGN);
		expect(blueprint.three.pauseRender).toBe(false);
		expect(blueprint.three.firstpersonmode).toBe(false);
	});

	it('pauses rendering and clears the selection on the way back to 2D', () =>
	{
		const item = {
			setSelected() {this.selected = true;},
			setUnselected() {this.selected = false;},
		};
		camera.showDesign();
		blueprint.three.getController().setSelectedObject(item);
		expect(blueprint.three.getController().selectedObject).toBe(item);

		camera.showFloorplan();

		expect(blueprint.three.pauseRender).toBe(true);
		expect(blueprint.three.getController().selectedObject).toBeNull();
		expect(item.selected).toBe(false);
	});

	it('enters and leaves walk-through', () =>
	{
		camera.showWalkthrough();
		expect(camera.mode.value).toBe(MODE_WALKTHROUGH);
		expect(blueprint.three.firstpersonmode).toBe(true);

		camera.showDesign();
		expect(blueprint.three.firstpersonmode).toBe(false);
	});

	it('returns to the 3D pane when pointer lock ends on its own', () =>
	{
		// Esc, or the browser dropping the lock. The demo routed this through a
		// synthetic click on #showDesign.
		camera.showWalkthrough();
		blueprint.three.dispatchEvent({type: EVENT_FPS_EXIT});

		expect(camera.mode.value).toBe(MODE_DESIGN);
		expect(blueprint.three.firstpersonmode).toBe(false);
	});

	it('inverts the lock flag, because Main.lockView means "rotation enabled"', () =>
	{
		camera.setViewLocked(true);
		expect(camera.viewLocked.value).toBe(true);
		expect(blueprint.three.controls.enableRotate).toBe(false);

		camera.setViewLocked(false);
		expect(blueprint.three.controls.enableRotate).toBe(true);
	});

	it('tracks the active view preset', () =>
	{
		camera.switchView(VIEW_TOP);
		expect(camera.activeView.value).toBe(VIEW_TOP);
	});

	it('toggles orthographic and wireframe through the library', () =>
	{
		camera.setOrthographic(true);
		expect(camera.orthographic.value).toBe(true);
		expect(blueprint.three.camera).toBe(blueprint.three.orthocamera);

		camera.setOrthographic(false);
		expect(blueprint.three.camera).toBe(blueprint.three.perspectivecamera);

		camera.setWireframe(true);
		expect(camera.wireframe.value).toBe(true);
	});
});

describe('useCatalog', () =>
{
	let selection;
	let catalog;
	let blueprint;
	let added;

	const A_WALL_ITEM = {name: 'NYC Poster', model: 'models/js-glb/nyc-poster2.glb', type: 2, format: 'gltf'};
	const A_FLOOR_ITEM = {name: 'Chair', model: 'models/js-glb/chair.glb', type: 1, format: 'gltf'};

	beforeEach(async () =>
	{
		// The rows are fetched now, not bundled (RM-012 J2), so a test that wants
		// a catalog has to ask for one - off the disk, from the files the
		// deployment actually serves.
		await loadCatalogFromDisk();
		selection = run(() => useSelection(store));
		catalog = run(() => useCatalog(store, selection.placementContext));
		blueprint = mountStore();
		blueprint.model.loadSerialized(DEFAULT_DESIGN);

		// Record the placement rather than actually loading a model.
		added = [];
		blueprint.model.scene.addItem = (...args) => {added.push(args);};
	});

	/**
	 * The eight mesh sections, in the demo's order, with the three generated
	 * sections ahead of them.
	 *
	 * The list used to be the eight alone. RM-008 F1 put "Doors & Windows" first,
	 * F3 put "Stairs" second and F2's late slice put "Columns & Beams" third, and
	 * re-checking says that is right rather than incidental each time: all three
	 * are separate sources because `catalog.json` is the list of model FILES this
	 * build ships and a generated item has none, and all three belong ahead of
	 * the furniture because a door, a staircase and a column are parts of a
	 * building rather than things put in one. Their order is the order somebody
	 * builds in. The eight are still asserted in their order, which is what the
	 * pin was for.
	 */
	it('offers every catalog item, grouped and ordered as the demo grouped them', () =>
	{
		const headings = catalog.sections.value.map((section) => section.heading);

		expect(headings).toEqual([
			'Doors & Windows', 'Stairs', 'Columns & Beams',
			'Floor Items', 'Ceiling Items', 'Wall Items', 'In Wall Items',
			'In Wall Floor Items', 'On Floor Items', 'Wall-Floor Items', 'Anywhere Items',
		]);
		const total = catalog.sections.value.reduce((sum, section) => sum + section.items.length, 0);
		expect(total).toBe(catalog.count.value);
	});

	it('adds a wall-bound item with no wall clicked, instead of throwing', () =>
	{
		// The fix. In the demo this read `aWall.currentWall` with `aWall` still
		// null and threw "Cannot read properties of null (reading 'currentWall')",
		// adding nothing - reachable on any fresh page by opening the catalog and
		// picking a window, a door, a poster or a wall cabinet.
		expect(selection.placementContext.value.wall).toBeNull();
		expect(() => catalog.addItem(A_WALL_ITEM)).not.toThrow();

		expect(added).toHaveLength(1);
		const [type, url, metadata, , , , , hint] = added[0];
		expect(type).toBe(2);
		expect(url).toBe(A_WALL_ITEM.model);
		expect(metadata.itemName).toBe('NYC Poster');
		expect(hint).toBeUndefined();
	});

	it('binds a wall-bound item to the last clicked wall', () =>
	{
		const edge = blueprint.model.floorplan.wallEdges()[0];
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});

		catalog.addItem(A_WALL_ITEM);

		const hint = added[0][7];
		expect(hint.edge).toBe(edge);
		expect(hint.position).toEqual(edge.center);
		expect(hint.position).not.toBe(edge.center);
	});

	it('drops a floor item at the centre of the last clicked floor', () =>
	{
		const room = blueprint.model.floorplan.getRooms()[0];
		blueprint.three.dispatchEvent({type: EVENT_FLOOR_CLICKED, item: room});

		catalog.addItem(A_FLOOR_ITEM);

		const hint = added[0][7];
		expect(hint.edge).toBeUndefined();
		expect(hint.position).toEqual(room.center);
	});

	it('ignores a clicked wall for an item that does not hang off one', () =>
	{
		const edge = blueprint.model.floorplan.wallEdges()[0];
		blueprint.three.dispatchEvent({type: EVENT_WALL_CLICKED, item: edge, wall: edge});

		catalog.addItem(A_FLOOR_ITEM);

		expect(added[0]).toHaveLength(3);
	});
});

describe('the catalog is fetched, not bundled (RM-012 J1 X-3, J2)', () =>
{
	let catalog;

	beforeEach(() =>
	{
		resetCatalogPacks();
		const selection = run(() => useSelection(store));
		catalog = run(() => useCatalog(store, selection.placementContext));
	});

	/**
	 * The claim M-43's gate is written against, stated where it can be read
	 * rather than only measured in a browser.
	 *
	 * Before anybody opens the drawer the composable holds the three generated
	 * sections and nothing else - twelve rows that have no model files and are
	 * bundled because of it. The other 168 are four files in `public/catalog/`
	 * that no boot has any reason to ask for.
	 */
	it('has no catalog row at all until somebody opens the drawer', () =>
	{
		const headings = catalog.sections.value.map((section) => section.heading);
		expect(headings).toEqual(['Doors & Windows', 'Stairs', 'Columns & Beams']);
		// The nine openings, eight flights and eight columns and beams. Generated,
		// so they have no model file, so they are not in a pack.
		expect(catalog.count.value).toBe(25);

		// And it can still say what is coming, because the manifest is bundled and
		// the manifest is a list of kits rather than a list of items.
		expect(catalog.packs).toHaveLength(4);
		expect(catalog.promised.value).toBe(193);
		expect(catalog.ready.value).toBe(false);
	});

	it('fetches one file per pack, and a second open costs nothing', async () =>
	{
		const disk = diskFetch();
		await loadCatalogPacks({fetch: disk.fetch});

		expect(disk.urls.sort()).toEqual([
			'catalog/blueprint3d.json',
			'catalog/kenney-furniture-kit.json',
			'catalog/khronos.json',
			'catalog/unattributed.json',
		]);
		expect(catalog.count.value).toBe(193);
		expect(catalog.ready.value).toBe(true);

		// The second open is the common case - the drawer is opened once per chair
		// - and it must not be a second round trip.
		await loadCatalogPacks({fetch: disk.fetch});
		expect(disk.urls).toHaveLength(4);
	});

	it('keeps every row it was given, and the packs add up to the manifest', async () =>
	{
		await loadCatalogPacks({fetch: diskFetch().fetch});

		const models = catalog.sections.value
			.flatMap((section) => section.items)
			.filter((item) => item.model)
			.map((item) => item.model);
		expect(new Set(models).size, 'a model in two packs is a model fetched twice').toBe(models.length);
		expect(models).toHaveLength(catalog.packs.reduce((sum, pack) => sum + pack.rows, 0));
	});

	it('draws a grid from a pack that arrived when another did not', async () =>
	{
		// Three kits that land are three kits somebody can browse. `useAssets`
		// makes the same call about the asset manifest: a metadata file missing is
		// a degradation, and refusing to open the catalog over it is an outage.
		const only = (url) => (url.includes('kenney')
			? Promise.resolve({ok: false, status: 500, json: () => Promise.reject(new Error('500'))})
			: diskFetch().fetch(url));

		await loadCatalogPacks({fetch: only});
		expect(catalog.count.value).toBe(25 + 25 + 1 + 2);

		// And the failure is not cached, so the next open tries the missing one
		// again rather than showing a permanently short catalog.
		await loadCatalogPacks({fetch: diskFetch().fetch});
		expect(catalog.count.value).toBe(193);
	});

	it('knows nothing about a row\'s size until somebody asks', async () =>
	{
		await loadCatalogPacks({fetch: diskFetch().fetch});

		// The index tier has no dimension in it, so the fetch that draws the grid
		// does not carry one. That is the trade X-3 made and J2 kept: 17,264
		// gzipped bytes at J2's row count against 13,292 of first-load headroom.
		const bed = catalog.sections.value
			.flatMap((section) => section.items)
			.find((item) => item.name === 'Full Bed');
		expect(bed).toBeTruthy();
		expect(bed.size, 'a size in the index defeats the split').toBeUndefined();
		expect(catalog.detailFor(bed)).toBeNull();
	});

	it('has the measured size once the detail lands, and fetches it once', async () =>
	{
		const disk = diskFetch();
		await loadCatalogPacks({fetch: disk.fetch});
		const bed = catalog.sections.value
			.flatMap((section) => section.items)
			.find((item) => item.name === 'Full Bed');

		const first = await loadCatalogDetail({fetch: disk.fetch});
		expect(first).toBeTruthy();
		expect(catalog.detailFor(bed).size.w).toBeCloseTo(140, 3);
		expect(catalog.detailFor(bed).size.scale, 'the demo kit is authored in centimetres').toBe(1);
		expect(catalog.detailFor(bed).source).toBe('blueprint3d');

		// Each pack carries its own provenance, so a pack is readable on its own
		// rather than depending on a shared table having been fetched.
		expect(first.sources.blueprint3d.licence.name).toBe('MIT');
		expect(Object.keys(first.sources).sort()).toEqual([
			'blueprint3d', 'kenney-furniture-kit', 'khronos', 'unattributed',
		]);

		// A second caller gets the same object rather than four more round trips.
		expect(await loadCatalogDetail({fetch: disk.fetch})).toBe(first);
		expect(disk.urls.filter((url) => url.includes('detail'))).toHaveLength(4);
	});

	it('returns null for a row it has never heard of', () =>
	{
		expect(catalog.detailFor({model: 'models/not-a-thing.glb'})).toBeNull();
		expect(catalog.detailFor(null)).toBeNull();
	});
});

describe('useDesignIO', () =>
{
	let io;
	let blueprint;
	let downloads;
	let revoked;

	beforeEach(() =>
	{
		io = run(() => useDesignIO(store));
		blueprint = mountStore();

		// jsdom has no object URLs and no real download. Record instead.
		downloads = [];
		revoked = [];
		window.URL.createObjectURL = (blob) => {downloads.push(blob); return `blob:${downloads.length}`;};
		window.URL.revokeObjectURL = (url) => {revoked.push(url);};
	});

	it('loads the default design, which is the demo\'s byte-for-byte', () =>
	{
		io.newDesign();

		const floorplan = blueprint.model.floorplan;
		expect(floorplan.getCorners()).toHaveLength(4);
		expect(floorplan.getRooms()[0].name).toBe('A New Room');
		// The file says 4 / 2.5 / 2.5 / 4 - the elevations P1 names - and those
		// are METRES, because a saved design carries the display unit that was
		// active when it was written. The loader converts to the centimetres the
		// model works in, so 400 and 250 here is the round trip working.
		expect(floorplan.getCorners().map((corner) => corner.elevation).sort()).toEqual([250, 250, 400, 400]);
	});

	it('downloads a design and releases the object URL', () =>
	{
		io.newDesign();
		io.saveDesign();

		expect(downloads).toHaveLength(1);
		// The demo created four of these over its lifetime and revoked none.
		expect(revoked).toEqual(['blob:1']);
	});

	/**
	 * The panorama, from the application's side (RM-011 H3). What a panorama
	 * *contains* is `tests/browser/panorama.test.js`; what is asserted here is
	 * the two things only this layer knows - that a data URL is turned into a
	 * blob rather than handed to an anchor whole, and that a viewer that cannot
	 * encode says so instead of downloading nothing.
	 */
	it('downloads the panorama as bytes rather than as a data URL', () =>
	{
		io.newDesign();
		const original = window.HTMLCanvasElement.prototype.toDataURL;
		window.HTMLCanvasElement.prototype.toDataURL = () => `data:image/png;base64,${btoa('a'.repeat(200))}`;

		io.savePanorama(32);

		expect(downloads).toHaveLength(1);
		expect(downloads[0].type).toBe('image/png');
		expect(revoked).toEqual(['blob:1']);
		window.HTMLCanvasElement.prototype.toDataURL = original;
	});

	it('says so when the browser cannot encode the panorama', () =>
	{
		io.newDesign();
		const original = window.HTMLCanvasElement.prototype.toDataURL;
		window.HTMLCanvasElement.prototype.toDataURL = () => '';

		io.savePanorama(32);

		expect(downloads).toHaveLength(0);
		expect(io.lastError.value).toMatch(/could not encode the panorama/);
		window.HTMLCanvasElement.prototype.toDataURL = original;
	});

	/**
	 * The plan export, from the application's side (RM-008 E4). What the sheet
	 * *contains* is pinned in `tests/plan-export.test.js`; what is asserted here
	 * is the three things only this layer knows - that it finds the plan view,
	 * names the file after the scale, and hands the browser a document rather
	 * than an error.
	 */
	it('downloads the plan as an SVG named after its scale', () =>
	{
		io.newDesign();

		io.savePlanSVG(50);

		expect(downloads).toHaveLength(1);
		expect(revoked).toEqual(['blob:1']);
	});

	it('says so rather than downloading an empty sheet', () =>
	{
		// A store with a plan, but nothing drawn on it.
		blueprint.model.floorplan.reset();

		io.savePlanSVG(100);

		expect(downloads).toHaveLength(0);
		expect(io.lastError.value).toContain('nothing on the plan');
	});

	it('resolves the glTF export from the event, and removes its listener', async () =>
	{
		let started = false;
		blueprint.three.exportForBlender = () => {started = true;};

		const promise = io.saveGLTF();
		expect(started).toBe(true);
		expect(io.busy.value).toBe(true);

		blueprint.three.dispatchEvent({type: EVENT_GLTF_READY, item: blueprint.three, gltf: '{"asset":{}}'});
		await expect(promise).resolves.toBe('{"asset":{}}');

		expect(io.busy.value).toBe(false);
		expect(downloads).toHaveLength(1);

		// A second export must not be served by the first one's listener. The
		// demo's listener was registered once at boot and lived forever.
		blueprint.three.dispatchEvent({type: EVENT_GLTF_READY, item: blueprint.three, gltf: 'again'});
		expect(downloads).toHaveLength(1);
	});

	it('reports a failed open rather than throwing', async () =>
	{
		const file = new window.File(['not json at all'], 'broken.blueprint3d', {type: 'text/plain'});
		await io.openDesign(file);

		expect(io.lastError.value).toContain('broken.blueprint3d');
	});

	it('a failed open leaves the design that is on screen alone', async () =>
	{
		// RM-003 A1, at the application level. This is the whole point of the
		// sprint: the toast used to say "Could not open that design" *after* the
		// design had been emptied, and the worst case did not even say that -
		// `{"items":[]}` reported success over an emptied plan.
		blueprint.model.scene.setItemLoader(() => {});
		blueprint.model.loadSerialized(JSON.stringify({
			floorplan: {
				corners: {
					c1: {x: 0, y: 0}, c2: {x: 400, y: 0}, c3: {x: 400, y: 400}, c4: {x: 0, y: 400},
				},
				walls: [
					{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
					{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
				],
				rooms: {}, units: 'cm', version: '2.0.0',
			},
			items: [],
		}));
		const before = blueprint.model.exportSerialized();
		expect(blueprint.model.floorplan.getWalls().length).toBeGreaterThan(0);

		const file = new window.File(['{"items":[]}'], 'nearly.blueprint3d', {type: 'text/plain'});
		await io.openDesign(file);

		expect(io.lastError.value).toContain('nearly.blueprint3d');
		expect(blueprint.model.exportSerialized()).toBe(before);
	});

	it('says which field is wrong', async () =>
	{
		// "Could not open that design" is true and useless. The structured result
		// carries a path per problem, and the toast shows the first.
		const broken = JSON.stringify({
			floorplan: {corners: {c1: {x: 0, y: 0}}, walls: [{corner1: 'c1', corner2: 'ghost'}], rooms: {}},
			items: [],
		});
		const file = new window.File([broken], 'ghost.blueprint3d', {type: 'text/plain'});
		await io.openDesign(file);

		expect(io.lastError.value).toContain('floorplan.walls[0].corner2');
		expect(io.lastError.value).toContain('ghost');
	});

	it('loadDesign reports failure without destroying anything', () =>
	{
		// The autosave recovery path goes through this rather than openDesign, so
		// it needs the same guarantee - a corrupt draft must not take the working
		// design with it.
		const before = blueprint.model.exportSerialized();

		expect(io.loadDesign('{"floorplan":{}}', 'the recovered draft')).toBe(false);

		expect(io.lastError.value).toContain('the recovered draft');
		expect(blueprint.model.exportSerialized()).toBe(before);
	});
});

describe('the room vocabulary lives in two files (RM-012 J1)', () =>
{
	it('and they agree, which is the only reason that is allowed', () =>
	{
		// One list drives the chips and the other refuses to write a row carrying
		// anything else. A vocabulary in two files is a vocabulary that drifts, and
		// this is the assertion instead of the hope - the same mechanism the type
		// ledger got after drifting five times.
		expect(ROOMS.map((room) => room.id).sort()).toEqual(SPLIT_ROOMS.slice().sort());
		expect(ROOMS.every((room) => room.label)).toBe(true);
	});
});

describe('useCatalogBrowse (RM-012 J1)', () =>
{
	afterEach(() =>
	{
		// The composable holds module-level state, deliberately - there is one
		// person at the keyboard - so each test clears both halves rather than
		// re-importing the module.
		const browse = useCatalogBrowse();
		browse.favourites.value.slice().forEach((model) => browse.toggleFavourite(model));
		browse.recent.value = [];
		window.localStorage.removeItem('architect3d.catalog');
	});

	it('stars and unstars by model url, and writes it down', () =>
	{
		const browse = useCatalogBrowse();
		expect(browse.isFavourite('models/gltf/chair.glb')).toBe(false);

		browse.toggleFavourite('models/gltf/chair.glb');
		expect(browse.isFavourite('models/gltf/chair.glb')).toBe(true);
		expect(JSON.parse(window.localStorage.getItem('architect3d.catalog')).favourites)
			.toEqual(['models/gltf/chair.glb']);

		browse.toggleFavourite('models/gltf/chair.glb');
		expect(browse.isFavourite('models/gltf/chair.glb')).toBe(false);
	});

	it('keeps recents newest first, once each, and capped', () =>
	{
		const browse = useCatalogBrowse();
		browse.noteUsed('a.glb');
		browse.noteUsed('b.glb');
		browse.noteUsed('a.glb');

		// Adding the same chair six times is the behaviour this drawer was built
		// around, so it has to leave one entry at the front and not six.
		expect(browse.recent.value).toEqual(['a.glb', 'b.glb']);

		for (let at = 0; at < browse.limit + 5; at++)
		{
			browse.noteUsed(`m${at}.glb`);
		}
		expect(browse.recent.value).toHaveLength(browse.limit);
		expect(browse.recent.value[0]).toBe(`m${browse.limit + 4}.glb`);
	});

	it('records nothing for a row with no model file', () =>
	{
		// A parametric opening, stair or column. It is still something somebody
		// added, but there is nothing here that tells one from another - recording
		// it would make every parametric row the same entry.
		const browse = useCatalogBrowse();
		browse.noteUsed('');
		browse.noteUsed(undefined);
		expect(browse.recent.value).toEqual([]);
	});

	it('survives a corrupt entry the way every other preference does', async () =>
	{
		window.localStorage.setItem('architect3d.catalog', 'not json');
		vi.resetModules();
		const fresh = await import('../src/app/composables/useCatalogBrowse.js?corrupt');
		expect(fresh.useCatalogBrowse().favourites.value).toEqual([]);
		expect(fresh.useCatalogBrowse().recent.value).toEqual([]);
	});

	it('is one shared shortlist, not one per caller', () =>
	{
		const first = useCatalogBrowse();
		const second = useCatalogBrowse();
		first.toggleFavourite('models/gltf/desk.glb');
		expect(second.isFavourite('models/gltf/desk.glb')).toBe(true);
	});
});

describe('useWalkthrough (RM-011 H3)', () =>
{
	afterEach(() =>
	{
		window.localStorage.removeItem('architect3d.walkthrough');
	});

	it('carries the stored height into a viewer built afterwards', async () =>
	{
		const walk = run(() => useWalkthrough(store));
		walk.setEyeHeight(175);

		// The reason `App.vue` mounts this and not only the settings panel: the
		// viewer that has to be told is the *next* one. A tick, because the watch
		// that tells it is a normal pre-flush watch rather than a synchronous one -
		// a viewer is not walked in the frame it was constructed in.
		const blueprint = mountStore();
		await nextTick();
		expect(blueprint.three.eyeHeight()).toBe(175);
	});

	it('clamps to a person, and remembers across a fresh mount', async () =>
	{
		const walk = run(() => useWalkthrough(store));
		walk.setEyeHeight(9999);
		expect(walk.eyeHeight.value).toBe(walk.bounds.max);
		expect(window.localStorage.getItem('architect3d.walkthrough'))
			.toBe(`{"eyeHeight":${walk.bounds.max}}`);

		const blueprint = mountStore();
		await nextTick();
		expect(blueprint.three.eyeHeight()).toBe(walk.bounds.max);
	});

	it('is one shared height, not one per caller', () =>
	{
		const first = run(() => useWalkthrough(store));
		const second = run(() => useWalkthrough(store));
		first.setEyeHeight(150);
		expect(second.eyeHeight.value).toBe(150);
	});
});

describe('the display unit is not reset by mounting', () =>
{
	it('is set to metres by BlueprintJS, as it always has been', () =>
	{
		Configuration.setValue(configDimUnit, dimCentiMeter);
		mountStore();

		// Load-bearing quirk, preserved: the constructor's first statement sets
		// dimMeter, so anything set before construction is discarded and saved
		// coordinates are in metres unless the app changes the unit afterwards.
		expect(Configuration.getStringValue(configDimUnit)).toBe('m');
	});
});
