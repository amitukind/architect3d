/**
 * A column and a beam in the assembled application (RM-008 F2).
 *
 * The headless tier asserts the description, the mesh and the symbol. This one
 * asserts the thing only a real page has ever shown: **where the member ends up
 * standing.** F1 found a 210 cm door hanging 20 cm above the floor that way and
 * F3 found a flight that would have floated 45 cm; a beam is the third of the
 * same kind, and the only one that was expected before it was placed.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WALL_HEIGHT = 250;

const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			c1: {x: 0, y: 0, elevation: WALL_HEIGHT},
			c2: {x: 600, y: 0, elevation: WALL_HEIGHT},
			c3: {x: 600, y: 600, elevation: WALL_HEIGHT},
			c4: {x: 0, y: 600, elevation: WALL_HEIGHT},
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
let bp;

function boot()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>'
		+ '<div id="viewer" style="width:640px;height:480px"></div>';
	document.body.appendChild(host);
	bp = new BlueprintJS({
		floorplannerElement: host.querySelector('#floorplanner-canvas'),
		threeElement: host.querySelector('#viewer'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	bp.model.loadSerialized(DESIGN);
}

/** Add an item and wait for it to land. */
function place(type, metadata, hint)
{
	return new Promise((resolve) =>
	{
		const settled = (evt) =>
		{
			if (!evt.item)
			{
				return;
			}
			bp.model.scene.removeEventListener('ITEM_LOADED_EVENT', settled);
			resolve(evt.item);
		};
		bp.model.scene.addEventListener('ITEM_LOADED_EVENT', settled);
		bp.model.scene.addItem(type, '', Object.assign({
			itemName: 'member', resizable: true, itemType: type, format: 'parametric',
		}, metadata || {}), null, null, null, false, hint || null);
		setTimeout(() => resolve(null), 10000);
	});
}

/**
 * The member's own geometry in world space.
 *
 * Not `Box3.setFromObject`: every `Item` carries two hidden size-label planes
 * and one sits 3 mm above the top (`item.js:274`), which F3 measured turning a
 * 280 cm flight into 280.3.
 */
function worldBox(item)
{
	item.updateMatrixWorld(true);
	item.geometry.computeBoundingBox();
	return item.geometry.boundingBox.clone().applyMatrix4(item.matrixWorld);
}

beforeEach(() =>
{
	boot();
});

afterEach(() =>
{
	bp.dispose();
	host.remove();
	host = null;
	bp = null;
});

describe('M-41 in a real page', () =>
{
	it('stands a column on the floor at the height its numbers say', async () =>
	{
		const column = await place(12, {structure: {kind: 'column', width: 30, depth: 30, length: 250}});
		expect(column).not.toBeNull();

		const box = worldBox(column);
		expect(box.min.y).toBeCloseTo(0, 3);
		expect(box.max.y).toBeCloseTo(250, 3);
		expect(box.max.x - box.min.x).toBeCloseTo(30, 3);
	});

	/**
	 * The one that would have been a bug. `FloorItem.resized` sets the origin to
	 * half the mesh, which stands everything on the floor - so a beam with a
	 * 210 cm soffit would have sat with its underside at zero.
	 */
	it('hangs a beam at its soffit, not on the floor', async () =>
	{
		const beam = await place(12, {structure: {kind: 'beam', width: 20, depth: 40, length: 300, soffit: 210}});

		const box = worldBox(beam);
		expect(box.min.y).toBeCloseTo(210, 3);
		expect(box.max.y).toBeCloseTo(250, 3);
		expect(box.max.z - box.min.z).toBeCloseTo(300, 3);
	});

	it('keeps a beam at its soffit when it is dropped into a room', async () =>
	{
		const floor = bp.model.floorplan.getRooms()[0];
		const beam = await place(12, {structure: {kind: 'beam', soffit: 190, depth: 60}},
			{position: floor.floorPlane.position.clone()});

		// `placeInRoom` measures the mesh and halves it; the override is what keeps
		// this from landing at 30 instead of 220.
		expect(worldBox(beam).min.y).toBeCloseTo(190, 3);
	});

	it('follows the numbers when they are edited', async () =>
	{
		const beam = await place(12, {structure: {kind: 'beam'}});

		beam.setStructure({depth: 60, soffit: 150, length: 480});
		bp.model.floorplan.update();

		const box = worldBox(beam);
		expect(box.min.y).toBeCloseTo(150, 3);
		expect(box.max.y).toBeCloseTo(210, 3);
		expect(box.max.z - box.min.z).toBeCloseTo(480, 3);
	});

	it('round-trips through a save and a load', async () =>
	{
		await place(12, {structure: {kind: 'beam', width: 25, depth: 55, length: 520, soffit: 195}});

		const saved = bp.model.exportSerialized();
		bp.model.loadSerialized(saved);
		await new Promise((resolve) => {setTimeout(resolve, 300);});

		const reloaded = bp.model.scene.getItems().find((item) => item.structure);
		expect(reloaded).toBeTruthy();
		expect(reloaded.structure).toMatchObject({
			kind: 'beam', width: 25, depth: 55, length: 520, soffit: 195,
		});
		expect(worldBox(reloaded).min.y).toBeCloseTo(195, 3);
	});

	it('builds a round column round', async () =>
	{
		const round = await place(12, {structure: {kind: 'column', section: 'round', width: 36}});

		const box = worldBox(round);
		expect(box.max.x - box.min.x).toBeCloseTo(36, 3);
		expect(box.max.z - box.min.z).toBeCloseTo(36, 3);
		// A box would be 12 triangles; a 24-sided prism is 96.
		expect(round.geometry.index.count / 3).toBe(96);
	});
});
