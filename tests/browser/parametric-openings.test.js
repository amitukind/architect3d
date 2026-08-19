/**
 * M-35: no opening exceeds its wall (RM-008 F1).
 *
 * The headless tier asserts the clamp's arithmetic. This one asserts the thing
 * the clamp exists for, on the geometry `Edge` actually builds - which is where
 * RM-009 U-2 was measured and where it would come back.
 *
 * U-2, restated: an opening bigger than its wall does not fail. `ShapeGeometry`
 * triangulates a contour and its holes together, so an oversized hole is merged
 * into the OUTLINE. A 300 x 387 opening in a 400 x 250 wall produced a mesh 387
 * tall - the wall grew 137 cm to swallow it, nothing warned, and the plan was
 * unaffected because it draws the graph rather than the mesh. Seven of the ten
 * catalog openings are that size, which is why none of them had ever been
 * noticed to be unusable.
 *
 * Those figures are U-2's, measured when `Item.initObject` multiplied this kit
 * by 300. RM-012 J1 replaced that with the 200 the kit is actually built on, so
 * the same model is 200 x 258 today. The wall is 250, so the opening is still
 * oversized and the clamp is still the thing under test - by 8 cm rather than by
 * 137. The history stays as it was measured; this note is what stops the two
 * disagreeing silently.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Box3} from 'three';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WALL_HEIGHT = 250;

/** A four-metre room whose walls are 250 cm high. */
const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			c1: {x: 0, y: 0, elevation: WALL_HEIGHT},
			c2: {x: 400, y: 0, elevation: WALL_HEIGHT},
			c3: {x: 400, y: 400, elevation: WALL_HEIGHT},
			c4: {x: 0, y: 400, elevation: WALL_HEIGHT},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
		units: 'cm',
		version: '2.0.0',
	},
	items: [],
});

let host;
let blueprint;

function boot()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>'
		+ '<div id="viewer" style="width:640px;height:480px"></div>';
	document.body.appendChild(host);
	blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('#floorplanner-canvas'),
		threeElement: host.querySelector('#viewer'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	blueprint.model.loadSerialized(DESIGN);
	return blueprint;
}

/** How tall the drawn walls are, from the meshes themselves. */
function drawnWallTop()
{
	const box = new Box3();
	let top = -Infinity;
	blueprint.three.scene.getScene().traverse((object) =>
	{
		if (!object.isMesh || !object.geometry || !object.geometry.attributes.position)
		{
			return;
		}
		// Wall faces only - `Edge.makeWall` is the one thing that cuts holes, and
		// it names its mesh 'wall'. The fillers and the floors would otherwise be
		// counted, and the top of a wall is exactly what is being measured.
		if (object.name !== 'wall')
		{
			return;
		}
		box.setFromObject(object);
		top = Math.max(top, box.max.y);
	});
	return top;
}

/** Put an item on the first wall and wait for it to land. */
function place(type, url, metadata)
{
	const edge = blueprint.model.floorplan.wallEdges()[0];
	return new Promise((resolve) =>
	{
		const settled = (evt) =>
		{
			if (!evt.item)
			{
				return;
			}
			blueprint.model.scene.removeEventListener('ITEM_LOADED_EVENT', settled);
			resolve(evt.item);
		};
		blueprint.model.scene.addEventListener('ITEM_LOADED_EVENT', settled);
		blueprint.model.scene.addItem(type, url, Object.assign({
			itemName: 'subject', resizable: true, modelUrl: url, itemType: type, format: 'gltf',
		}, metadata || {}), null, null, null, false, {position: edge.center.clone(), edge: edge});
		setTimeout(() => resolve(null), 10000);
	});
}

beforeEach(() =>
{
	boot();
});

afterEach(() =>
{
	blueprint.dispose();
	host.remove();
	host = null;
	blueprint = null;
});

describe('M-35 · an opening never makes its wall taller', () =>
{
	it('draws a bare wall at the corner elevations', () =>
	{
		expect(drawnWallTop()).toBeCloseTo(WALL_HEIGHT, 3);
	});

	/**
	 * The exact item U-2 was measured with. Before F1 this produced a wall 387 cm
	 * tall; the assertion is that it now produces one 250 cm tall, with the
	 * opening trimmed to fit rather than the wall grown to fit the opening.
	 *
	 * `unitScale` is passed because `useCatalog.addItem` passes it (RM-012 J1):
	 * this kit is on a 2 m grid, so its wall module is 257.9 cm - still taller
	 * than the 250 cm wall, which is what this test needs, and no longer the
	 * 386.9 the `x300` hack produced. A caller of `Scene.addItem` that omits the
	 * key now gets the model at the size its own file says, which is the new
	 * contract and is why this line changed rather than the assertion below it.
	 */
	it('clamps a catalog opening taller than the wall', async () =>
	{
		const item = await place(3, 'models/gltf/wallDoorway.glb', {unitScale: 200});
		expect(item).not.toBeNull();
		// The item is still the size it always was - this is a clamp on the hole,
		// not a resize of somebody's furniture.
		expect(item.halfSize.y * 2).toBeGreaterThan(WALL_HEIGHT);
		blueprint.model.floorplan.update();

		expect(drawnWallTop()).toBeCloseTo(WALL_HEIGHT, 3);
	});

	it('cuts a parametric door without touching the wall height', async () =>
	{
		const door = await place(10, '', {format: 'parametric', opening: {kind: 'door', width: 90, height: 210}});
		expect(door).not.toBeNull();

		expect(door.wallOpening()).toEqual({width: 90, height: 210, bottom: 0, top: 210, centre: 105});
		// Its bottom is on the floor, which is what a sill of zero means. Before
		// F1, `WallItem.boundMove` put a 210 cm item's centre at 125 - so the door
		// hung 20 cm in the air.
		expect(door.position.y).toBeCloseTo(105, 6);
		expect(drawnWallTop()).toBeCloseTo(WALL_HEIGHT, 3);
	});

	it('keeps the numbers through a save and a load', async () =>
	{
		await place(10, '', {format: 'parametric', opening: {kind: 'window', width: 180, height: 140, sill: 85}});

		const saved = blueprint.model.exportSerialized();
		blueprint.model.loadSerialized(saved);
		await new Promise((resolve) => {setTimeout(resolve, 300);});

		const reloaded = blueprint.model.scene.getItems().find((item) => item.opening);
		expect(reloaded).toBeTruthy();
		expect(reloaded.opening).toMatchObject({kind: 'window', width: 180, height: 140, sill: 85});
		expect(reloaded.wallOpening().bottom).toBe(85);
	});
});
