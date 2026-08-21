// @vitest-environment jsdom
/**
 * Who owns a geometry, and who gives it back (RM-003 A0).
 *
 * ## The finding this suite exists for
 *
 * Before A0 the entire `src/` tree contained three `geometry.dispose()` or
 * `material.dispose()` calls, and `Floorplan.update()` abandoned six meshes,
 * six geometries and six materials on every single call - with no user-visible
 * change to the plan. Opening a four-wall design dispatches `EVENT_UPDATED`
 * twenty-five times, so a file open abandoned roughly 150 of each before the
 * first frame was drawn.
 *
 * RM-002 R-04 had already fixed the equivalent problem for textures, and fixed
 * it properly with a refcounted cache. Geometries and materials were simply
 * never looked at.
 *
 * ## What is asserted, and what is deliberately not
 *
 * Every test here asks the same question - *how many resources were built,
 * dropped, and never disposed* - through `tests/helpers/resources.js`. What it
 * does not assert is an allocation count. A redraw is supposed to allocate; the
 * defect was never that the library builds geometry, it is that it lets go of it
 * without telling the GPU. So these numbers stay meaningful if a later sprint
 * makes the library allocate more or less. A2 will make `update()` allocate far
 * less; none of these expectations should have to move when it does.
 *
 * The counterpart in chromium is `tests/browser/gpu-memory.test.js`, which asks
 * the renderer the same question through `renderer.info.memory`. This suite
 * proves the library gave the resources back; that one proves the driver got
 * them.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Scene as ThreeScene, EventDispatcher, BufferGeometry, MeshBasicMaterial, Mesh} from 'three';

import {Floorplan3D} from '../src/scripts/three/floorPlan.js';
import {Floor} from '../src/scripts/three/floor.js';
import {Edge} from '../src/scripts/three/edge.js';
import {HUD} from '../src/scripts/three/hud.js';
import {Model} from '../src/scripts/model/model.js';
import {BlueprintJS} from '../src/scripts/blueprint.js';
import {Main} from '../src/scripts/three/main.js';
import {textureCacheStats} from '../src/scripts/three/texture_cache.js';
import {EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_UPDATED} from '../src/scripts/core/events.js';
import {watchResources, byType} from './helpers/resources.js';
import {resetAll, buildSquareRoom, buildSharedWallRooms} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

/**
 * A stand-in for OrbitControls: `Edge` subscribes to two camera events on it and
 * reads `controls.object.position` when deciding wall visibility.
 */
function createControlsStub()
{
	const controls = new EventDispatcher();
	controls.object = {position: {clone: () => ({sub: () => ({normalize: () => ({x: 0, y: 1, z: 0})})})}};
	return controls;
}

/** Minimal `Main` stand-in for HUD, which only ever calls this one method. */
function createThreeStub()
{
	const three = new EventDispatcher();
	three.ensureNeedsUpdate = () => {};
	return three;
}

/** An item-shaped object good enough for HUD.makeObject. */
function createItemStub()
{
	return {
		allowRotate: true,
		fixed: false,
		halfSize: {x: 10, y: 10, z: 10},
		rotation: {y: 0},
		position: {x: 0, y: 0, z: 0},
	};
}

/** jsdom has no 2D context, and an Item builds two label canvases on construction. */
let canvas2d = null;

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

describe('the model layer gives back the meshes it builds', () =>
{
	it('update() leaks nothing, however many times it runs', () =>
	{
		// The headline measurement of RM-003 §16 H-1. Twenty updates on a single
		// square room abandoned 120 meshes, geometries and materials before A0 -
		// six per call, every call, with the plan unchanged throughout.
		const {floorplan} = buildSquareRoom();
		const probe = watchResources({floorplan});
		probe.sample();

		for (let i = 0; i < 20; i++)
		{
			floorplan.update();
			probe.sample();
		}

		const counts = probe.count();
		expect(counts.leaked, `leaked: ${JSON.stringify(byType(probe.leakedResources()))}`).toBe(0);
		// And the plan really did keep rebuilding - otherwise this passes vacuously
		// because nothing was ever allocated to leak.
		expect(counts.seen).toBeGreaterThan(counts.live);
		expect(counts.disposed).toBeGreaterThan(0);
	});

	it('a two-room plan is no different', () =>
	{
		const {floorplan} = buildSharedWallRooms();
		const probe = watchResources({floorplan});
		probe.sample();

		for (let i = 0; i < 10; i++)
		{
			floorplan.update();
			probe.sample();
		}

		expect(probe.count().leaked).toBe(0);
	});

	it('opening a design leaks nothing', () =>
	{
		// Written in A0, when this said "across all 25 of its updates" and asserted
		// that more than one had happened - a guard against the test passing
		// vacuously because nothing was ever built to leak.
		//
		// A1 batched the load path, so a document open now dispatches one update
		// rather than twenty-five and that guard no longer holds. The claim it was
		// guarding is unchanged and is asserted directly instead: resources were
		// built, and none of them leaked.
		const model = new Model('');
		model.scene.setItemLoader(() => {});
		const probe = watchResources({floorplan: model.floorplan, scene: model.scene});

		let updates = 0;
		model.floorplan.addEventListener(EVENT_UPDATED, () => {updates += 1; probe.sample();});
		model.loadSerialized(JSON.stringify({
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
			items: [],
		}));
		probe.sample();

		const counts = probe.count();
		expect(updates).toBeGreaterThan(0);
		expect(counts.seen).toBeGreaterThan(0);
		expect(counts.leaked, `leaked: ${JSON.stringify(byType(probe.leakedResources()))}`).toBe(0);
	});

	it('reset() releases the whole plan', () =>
	{
		const {floorplan} = buildSquareRoom();
		const probe = watchResources({floorplan});
		probe.sample();

		floorplan.reset();
		floorplan.update();
		probe.sample();

		expect(probe.count().leaked).toBe(0);
		expect(floorplan.getRooms()).toHaveLength(0);
	});

	it('a Room disposes its own two planes and nothing else', () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const floorGeometry = room.floorPlane.geometry;
		const roofGeometry = room.roofPlane.geometry;

		let disposedCount = 0;
		floorGeometry.addEventListener('dispose', () => {disposedCount += 1;});
		roofGeometry.addEventListener('dispose', () => {disposedCount += 1;});

		room.dispose();
		expect(disposedCount).toBe(2);
	});

	it('a HalfEdge disposes its hit-test plane', () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = floorplan.wallEdges()[0];
		let disposed = false;
		edge.plane.geometry.addEventListener('dispose', () => {disposed = true;});

		edge.dispose();
		expect(disposed).toBe(true);
	});

	it('disposing twice is safe', () =>
	{
		// Ownership boundaries overlap - Floorplan.update() releases a room, and a
		// caller may then dispose the same plan. Idempotence is what makes the
		// boundary safe to enforce in more than one place.
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(() => {room.dispose(); room.dispose();}).not.toThrow();
	});
});

/**
 * A whole mounted design - 2D canvas, 3D viewer, four walls - and a probe on
 * everything its model owns (RM-020 S-1).
 */
function mountBlueprint()
{
	installPointerApis(window);
	installResizeObserver(window);
	Main.setRendererFactory(() => createRendererStub());

	const host = document.createElement('div');
	host.innerHTML = '<canvas id="lifecycle-plan"></canvas><div id="lifecycle-viewer"></div>';
	document.body.appendChild(host);
	setLayout(host.querySelector('#lifecycle-viewer'), {width: 640, height: 480});
	setLayout(host.querySelector('#lifecycle-plan'), {width: 600, height: 400});

	const blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('#lifecycle-plan'),
		threeElement: host.querySelector('#lifecycle-viewer'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	blueprint.model.scene.setItemLoader(() => {});
	blueprint.model.loadSerialized(JSON.stringify({
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
		items: [],
	}));

	const probe = watchResources({
		floorplan: blueprint.model.floorplan,
		scene: blueprint.model.scene,
	});
	return {blueprint, probe, host};
}

describe('teardown gives back what the whole design holds', () =>
{
	/**
	 * The outermost boundary, which had no case at all (RM-020 S-1).
	 *
	 * Everything above tests a release *inside* a living design: update(),
	 * reset(), a redraw, one item removed. None of them asked what happens when
	 * the whole thing is torn down - and that was the one place nothing was
	 * released, because `BlueprintJS.dispose()` believed the model held no GPU
	 * resources and left it alone. Measured before the fix: twelve seen, zero
	 * disposed.
	 *
	 * The two halves are asserted separately on purpose. Releasing the meshes is
	 * the fix; keeping the *data* is the contract the old note was protecting,
	 * and a fix that emptied the plan to pass the first half would be worse than
	 * the leak.
	 */
	it('BlueprintJS.dispose() releases the meshes the model owns', () =>
	{
		const {blueprint, probe} = mountBlueprint();
		probe.sample();
		expect(probe.count().seen, 'the plan built hit-test meshes').toBeGreaterThan(0);

		blueprint.dispose();

		probe.sample();
		const after = probe.count();
		expect(after.disposed, 'every one of them released').toBe(after.seen);
	});

	it('and leaves the design serializable, which is why it left it alone before', () =>
	{
		const {blueprint} = mountBlueprint();
		const before = JSON.parse(blueprint.model.exportSerialized());

		blueprint.dispose();

		const after = JSON.parse(blueprint.model.exportSerialized());
		expect(after.floorplan.corners).toEqual(before.floorplan.corners);
		expect(after.floorplan.walls).toEqual(before.floorplan.walls);
		expect(after.floorplan.rooms).toEqual(before.floorplan.rooms);
		expect(after.items).toEqual(before.items);
		expect(Object.keys(after.floorplan.corners)).toHaveLength(4);
	});

	/**
	 * Found while fixing S-1, and separate from it (RM-020 S-15).
	 *
	 * `FloorplannerView.dispose()` disposes the carbon sheet, and
	 * `CarbonSheet.dispose()` calls `clear()`, which resets every field the save
	 * format carries. So the teardown-then-save path this suite exists to
	 * protect silently dropped the underlay - a URL, a placement, a scale and a
	 * transparency, each set by hand.
	 *
	 * Only when there IS one: a sheet nobody configured exports as an empty
	 * block either way, which is why the case above compares the design rather
	 * than the whole document.
	 */
	it('keeps a configured carbon sheet across teardown', () =>
	{
		const {blueprint} = mountBlueprint();
		const sheet = blueprint.model.floorplan.carbonSheet;
		expect(sheet, 'the 2D view attached one').toBeTruthy();
		sheet.url = 'plans/underlay.png';
		sheet.x = 120;
		sheet.y = -45;
		sheet.transparency = 0.4;

		blueprint.dispose();

		const saved = JSON.parse(blueprint.model.exportSerialized()).floorplan.carbonSheet;
		expect(saved.url).toBe('plans/underlay.png');
		expect(saved.x).toBe(120);
		expect(saved.y).toBe(-45);
		expect(saved.transparency).toBe(0.4);
	});
});

describe('the 3D projection gives back what it replaces', () =>
{
	let scene;
	let controls;

	beforeEach(() =>
	{
		scene = new ThreeScene();
		controls = createControlsStub();
	});

	it('Floorplan3D.redraw() leaks nothing across repeated rebuilds', () =>
	{
		const {floorplan} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();

		const probe = watchResources({floorplan3d: projection});
		probe.sample();

		for (let i = 0; i < 10; i++)
		{
			projection.redraw();
			probe.sample();
		}

		const counts = probe.count();
		expect(counts.leaked, `leaked: ${JSON.stringify(byType(probe.leakedResources()))}`).toBe(0);
		expect(counts.disposed).toBeGreaterThan(0);

		projection.dispose();
	});

	it('Floorplan3D.dispose() releases every floor and edge it holds', () =>
	{
		const {floorplan} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();

		const probe = watchResources({floorplan3d: projection});
		probe.sample();
		projection.dispose();

		// Everything sampled is now neither live nor reachable, so all of it must
		// have been disposed rather than merely dropped.
		expect(probe.count().leaked).toBe(0);
		expect(projection.floors).toHaveLength(0);
		expect(projection.edges).toHaveLength(0);
	});

	it('Edge.remove() disposes its six meshes', () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = new Edge(scene, floorplan.wallEdges()[0], controls);

		const geometries = edge.planes.concat(edge.basePlanes).map((plane) => plane.geometry);
		expect(geometries.length).toBeGreaterThan(0);
		let disposed = 0;
		geometries.forEach((geometry) => geometry.addEventListener('dispose', () => {disposed += 1;}));

		edge.remove();
		expect(disposed).toBe(geometries.length);
	});

	it('Edge.redraw() disposes the meshes it is replacing', () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = new Edge(scene, floorplan.wallEdges()[0], controls);
		const before = edge.planes.concat(edge.basePlanes).map((plane) => plane.geometry);
		let disposed = 0;
		before.forEach((geometry) => geometry.addEventListener('dispose', () => {disposed += 1;}));

		edge.redraw();

		expect(disposed).toBe(before.length);
		// ...and it really did build replacements, rather than disposing and
		// leaving the wall with nothing.
		expect(edge.planes.length).toBeGreaterThan(0);
		edge.remove();
	});

	it('Edge.removeFromScene() is symmetric with addToScene()', () =>
	{
		// phantomPlanes was cleared by neither, so addToScene() would re-add a
		// plane removeFromScene() had already taken out. Nothing pushes to it
		// today, which is what made this latent rather than live.
		const {floorplan} = buildSquareRoom();
		const edge = new Edge(scene, floorplan.wallEdges()[0], controls);
		edge.phantomPlanes.push(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
		edge.addToScene();

		edge.removeFromScene();
		expect(edge.planes).toHaveLength(0);
		expect(edge.basePlanes).toHaveLength(0);
		expect(edge.phantomPlanes).toHaveLength(0);

		edge.remove();
	});

	it('Floor.dispose() releases its geometry as well as its texture', () =>
	{
		const {floorplan} = buildSquareRoom();
		const floor = new Floor(scene, floorplan.getRooms()[0]);
		floor.addToScene();

		let disposed = 0;
		[floor.floorPlane.geometry, floor.roofPlane.geometry].forEach((geometry) =>
			geometry.addEventListener('dispose', () => {disposed += 1;}));

		floor.dispose();
		expect(disposed).toBe(2);
	});

	it('Floor.redraw() disposes the pair it replaces', () =>
	{
		const {floorplan} = buildSquareRoom();
		const floor = new Floor(scene, floorplan.getRooms()[0]);
		const before = [floor.floorPlane.geometry, floor.roofPlane.geometry];
		let disposed = 0;
		before.forEach((geometry) => geometry.addEventListener('dispose', () => {disposed += 1;}));

		floor.redraw();
		expect(disposed).toBe(2);
		expect(floor.floorPlane).not.toBe(null);

		floor.dispose();
	});

	it('a Floor never disposes the model meshes it only borrows', () =>
	{
		// The ownership boundary A0 had to decide. Floor.addToScene() adds
		// room.floorPlane and room.roofPlane - meshes the *model* built. The view
		// borrows them for picking and must not release them, or the next redraw
		// picks against disposed geometry.
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		let modelDisposed = false;
		room.floorPlane.geometry.addEventListener('dispose', () => {modelDisposed = true;});

		const floor = new Floor(scene, room);
		floor.addToScene();
		floor.redraw();
		floor.dispose();

		expect(modelDisposed).toBe(false);
		// And the model still owns them, so the plan can still be picked.
		expect(room.floorPlane.geometry.attributes.position).toBeTruthy();
	});
});

describe('items and the HUD', () =>
{
	it('removing an item takes its selection box out of the scene', () =>
	{
		// initObject() did `scene.add(this.bhelper)` and nothing anywhere removed
		// it, so a deleted chair left its bounding box in the scene graph pointing
		// at an object no longer in it.
		const model = new Model('');
		const three = model.scene.getScene();
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			onLoad(new BufferGeometry().setFromPoints([]), new MeshBasicMaterial());
		});

		model.scene.addItem(1, 'x.glb', {itemName: 'x', format: 'gltf', itemType: 1, materialColors: []});
		const item = model.scene.getItems()[0];
		expect(item.bhelper).toBeTruthy();
		expect(three.children).toContain(item.bhelper);

		model.scene.removeItem(item);
		expect(three.children).not.toContain(item.bhelper);
	});

	it('removing an item disposes what the item built', () =>
	{
		const model = new Model('');
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			onLoad(new BufferGeometry().setFromPoints([]), new MeshBasicMaterial());
		});
		model.scene.addItem(1, 'x.glb', {itemName: 'x', format: 'gltf', itemType: 1, materialColors: []});
		const item = model.scene.getItems()[0];

		// The label planes are the item's own: two CanvasTextures, two
		// PlaneGeometries and two materials that never went near the texture cache.
		const owned = [
			item.geometry,
			item.canvasPlaneWH.geometry, item.canvasPlaneWD.geometry,
			item.canvasTextureWH, item.canvasTextureWD,
			item.wirematerial,
		];
		let disposed = 0;
		owned.forEach((resource) => resource.addEventListener('dispose', () => {disposed += 1;}));

		model.scene.removeItem(item);
		expect(disposed).toBe(owned.length);
	});

	it('the HUD releases its rotation handle when the selection changes', () =>
	{
		// makeObject() builds a line, a cone and a sphere - three geometries and
		// three materials - on every selection, and resetSelectedItem() removed the
		// group from the scene without disposing any of it.
		const three = createThreeStub();
		const scene = new ThreeScene();
		const hud = new HUD(three, scene);

		three.dispatchEvent({type: EVENT_ITEM_SELECTED, item: createItemStub()});
		const handle = hud.getObject();
		expect(handle).toBeTruthy();

		let disposed = 0;
		handle.children.forEach((child) =>
		{
			child.geometry.addEventListener('dispose', () => {disposed += 1;});
			child.material.addEventListener('dispose', () => {disposed += 1;});
		});

		three.dispatchEvent({type: EVENT_ITEM_UNSELECTED});
		expect(disposed).toBe(6);
		expect(hud.getObject()).toBe(null);

		hud.dispose();
	});

	it('the HUD detaches from the viewer on dispose', () =>
	{
		const three = createThreeStub();
		const hud = new HUD(three, new ThreeScene());
		hud.dispose();

		three.dispatchEvent({type: EVENT_ITEM_SELECTED, item: createItemStub()});
		expect(hud.getObject()).toBe(null);
	});
});

describe('the texture cache is shared, but teardown is not', () =>
{
	it('releasing one design does not pull images out from under another', () =>
	{
		// Main.dispose() ended with an unconditional clearTextureCache(), whose own
		// comment said it "becomes R-02's problem" once two viewers were supported.
		// P7 made them supported. This is that problem.
		const scene = new ThreeScene();
		const controls = createControlsStub();

		const first = buildSquareRoom();
		const second = buildSquareRoom();
		const a = new Floorplan3D(scene, first.floorplan, controls);
		const b = new Floorplan3D(new ThreeScene(), second.floorplan, controls);
		a.redraw();
		b.redraw();

		const shared = textureCacheStats();
		expect(shared.handles).toBeGreaterThan(0);

		a.dispose();

		// B's handles survive, and the images behind them are still cached - so B
		// does not have to re-decode anything because A went away.
		const after = textureCacheStats();
		expect(after.handles).toBeGreaterThan(0);
		expect(after.urls).toBeGreaterThan(0);

		b.dispose();
		expect(textureCacheStats().handles).toBe(0);
	});
});
