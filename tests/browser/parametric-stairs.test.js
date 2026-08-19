/**
 * A flight in the assembled application (RM-008 F3).
 *
 * The headless tier asserts the description, the generator and the symbol. This
 * one asserts the things only a real page can show, and the reason it exists is
 * that seven of the bugs found in programmes E and F were found this way and
 * none of them by reading code.
 *
 * RM-009 U-3 is what the last test here re-measures. The four stair meshes this
 * build ships are loaded and their size read off the live item: they arrive far
 * larger than any storey, because every model under two units across is
 * multiplied by 300 on load. A generated flight does not go near that branch,
 * and the two are measured side by side rather than asserted to differ.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WALL_HEIGHT = 250;

/** A six-metre room, big enough to stand a flight in. */
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

/** Put an item in the room and wait for it to land. */
function place(type, url, metadata)
{
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
		}, metadata || {}), null, null, null, false);
		setTimeout(() => resolve(null), 10000);
	});
}

/**
 * How the flight actually sits in the world, measured off the scene.
 *
 * The flight's own geometry through the item's world matrix, and NOT
 * `Box3.setFromObject`: every `Item` carries two hidden size-label planes, and
 * one of them is laid flat at `getHeight() * 0.5 + 0.3` (`item.js:274`) - so
 * `setFromObject` measures a flight 280 cm tall as 280.3, which is the label
 * rather than the stair. Measured here rather than worked around: the 3 mm is
 * real and it belongs to the label.
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
	blueprint.dispose();
	host.remove();
	host = null;
	blueprint = null;
});

describe('M-37 in a real page', () =>
{
	it('stands a generated flight on the floor at the height its numbers say', async () =>
	{
		const stair = await place(11, '', {
			format: 'parametric',
			stair: {shape: 'straight', treads: 16, rise: 17.5, going: 25, handrail: 'none'},
		});
		expect(stair).not.toBeNull();

		const box = worldBox(stair);

		// The underside on the floor and the top tread at 16 x 175 mm, in the
		// scene rather than in the generator - which is the thing F1's door bug
		// (a 210 cm leaf hung 20 cm up) could only be seen in.
		expect(box.min.y).toBeCloseTo(0, 3);
		expect(box.max.y).toBeCloseTo(280, 3);
		expect(box.max.z - box.min.z).toBeCloseTo(400, 3);
	});

	it('follows the numbers when they are edited, without leaving the floor', async () =>
	{
		const stair = await place(11, '', {format: 'parametric', stair: {shape: 'straight', handrail: 'none'}});

		stair.setStair({treads: 20, rise: 16, going: 28});
		blueprint.model.floorplan.update();

		const box = worldBox(stair);
		expect(box.max.y - box.min.y).toBeCloseTo(320, 3);
		expect(box.max.z - box.min.z).toBeCloseTo(560, 3);
		expect(box.min.y).toBeCloseTo(0, 3);
	});

	it('keeps a railed flight on the floor, which centring on the flight would not', async () =>
	{
		const stair = await place(11, '', {format: 'parametric', stair: {shape: 'u', handrail: 'both'}});

		const box = worldBox(stair);

		// A handrail stands 90 cm above the top nosing, so the mesh is taller than
		// the flight; centring on the flight rather than on the mesh would leave
		// this 45 cm in the air.
		expect(box.min.y).toBeCloseTo(0, 3);
		expect(box.max.y).toBeGreaterThan(280);
		expect(stair.metrics().height).toBe(280);
	});

	it('round-trips through a save and a load', async () =>
	{
		await place(11, '', {
			format: 'parametric',
			stair: {shape: 'l', treads: 19, rise: 16.5, going: 27, width: 105, turn: 'left', handrail: 'both'},
		});

		const saved = blueprint.model.exportSerialized();
		blueprint.model.loadSerialized(saved);
		await new Promise((resolve) => {setTimeout(resolve, 300);});

		const reloaded = blueprint.model.scene.getItems().find((item) => item.stair);
		expect(reloaded).toBeTruthy();
		expect(reloaded.stair).toMatchObject({
			shape: 'l', treads: 19, rise: 16.5, going: 27, width: 105, turn: 'left', handrail: 'both',
		});
		expect(reloaded.metrics().height).toBeCloseTo(19 * 16.5, 6);
		expect(worldBox(reloaded).min.y).toBeCloseTo(0, 3);
	});

	/**
	 * U-3, measured again rather than quoted. Both are loaded into the same page
	 * and their sizes read off the live items; the assertion is the comparison,
	 * so it stays true whatever the multiplier does next.
	 */
	it('supersedes a catalog stair that arrives too big for any storey', async () =>
	{
		const mesh = await place(1, 'models/gltf/stairs.glb');
		expect(mesh).not.toBeNull();
		const meshHeight = mesh.halfSize.y * 2;

		const generated = await place(11, '', {format: 'parametric', stair: {shape: 'straight', handrail: 'none'}});
		const generatedHeight = generated.halfSize.y * 2;

		expect(meshHeight).toBeGreaterThan(WALL_HEIGHT);
		expect(generatedHeight).toBeCloseTo(280, 3);
		expect(generatedHeight).toBeLessThan(meshHeight);
	});
});
