/**
 * Stairwells and the roof, in a real page (RM-010 G2).
 *
 * The headless tier asserts the clamp's arithmetic and the roof's geometry.
 * This one asserts the two things only a scene shows: that the hole is actually
 * cut in the floor mesh somebody sees, and that the roof stands on top of the
 * building rather than through it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Box3} from 'three';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WALL_HEIGHT = 250;

function room(size)
{
	return {
		corners: {
			c1: {x: 0, y: 0, elevation: WALL_HEIGHT}, c2: {x: size, y: 0, elevation: WALL_HEIGHT},
			c3: {x: size, y: size, elevation: WALL_HEIGHT}, c4: {x: 0, y: size, elevation: WALL_HEIGHT},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {}, units: 'cm', version: '2.0.0',
	};
}

const TWO_STOREYS = JSON.stringify({
	floorplan: room(600),
	items: [],
	levels: [
		{name: 'Ground floor', height: 280},
		{name: 'First floor', height: 280, floorplan: room(600), items: []},
	],
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
}

/** Put a flight on a storey and wait for it. */
function placeStair(levelIndex)
{
	bp.model.setActiveLevel(levelIndex);
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
		bp.model.scene.addItem(11, '', {
			itemName: 'Flight', itemType: 11, format: 'parametric', resizable: true,
			stair: {shape: 'straight'},
		});
	}).then((item) =>
	{
		// Moved after it lands rather than through a placement hint: `addItem`'s
		// hint runs `moveToPosition`, which for a `FloorItem` refuses a target
		// outside a room and silently leaves the item where it was. Setting the
		// position is what this test is about - the stairwell follows the flight.
		item.position.x = 300;
		item.position.z = 300;
		bp.model.projectItemsToPlan();
		return item;
	});
}

/** The visible floor mesh of a storey's first room. */
function floorMesh(levelIndex)
{
	const level = bp.model.levels[levelIndex];
	const group = bp.model.scene.levelGroup(level);
	let found = null;
	group.traverse((object) =>
	{
		// The visible floor is the one with a real material; the model's picking
		// plane beside it is invisible.
		if (object.isMesh && object.material && object.material.visible !== false
			&& object.geometry && object.geometry.index
			&& object.rotation.x !== 0 && !found)
		{
			found = object;
		}
	});
	return found;
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

describe('M-39 in a real page', () =>
{
	it('cuts the floor somebody sees, not just the one they click', async () =>
	{
		bp.model.loadSerialized(TWO_STOREYS);
		bp.model.levels.forEach((level) => {level.floorplan.update();});
		const before = floorMesh(1).geometry.index.count;

		await placeStair(0);
		bp.model.levels.forEach((level) => {level.floorplan.update();});

		const upstairs = bp.model.levels[1].floorplan.getRooms()[0];
		expect(upstairs.floorOpenings).toHaveLength(1);
		expect(floorMesh(1).geometry.index.count).toBeGreaterThan(before);
	});

	it('does not make the upper floor any bigger', async () =>
	{
		bp.model.loadSerialized(TWO_STOREYS);
		bp.model.levels.forEach((level) => {level.floorplan.update();});
		const bare = new Box3().setFromObject(floorMesh(1));

		await placeStair(0);
		bp.model.levels.forEach((level) => {level.floorplan.update();});

		// RM-010 V-3: an unclamped hole is merged into the outline and the floor
		// GROWS. Measured on the mesh, which is the only place it shows.
		const cut = new Box3().setFromObject(floorMesh(1));
		expect(cut.min.x).toBeGreaterThanOrEqual(bare.min.x - 0.001);
		expect(cut.max.x).toBeLessThanOrEqual(bare.max.x + 0.001);
		expect(cut.min.z).toBeGreaterThanOrEqual(bare.min.z - 0.001);
		expect(cut.max.z).toBeLessThanOrEqual(bare.max.z + 0.001);
	});
});

describe('M-40 in a real page', () =>
{
	function roofMesh()
	{
		let found = null;
		bp.model.scene.getScene().traverse((object) =>
		{
			if (object.name === 'roof')
			{
				found = object;
			}
		});
		return found;
	}

	it('has no roof until one is asked for, which is every older design', () =>
	{
		bp.model.loadSerialized(JSON.stringify({floorplan: room(600), items: []}));

		expect(roofMesh()).toBeNull();
	});

	it('stands the roof on the top storey\'s walls and over the whole plan', () =>
	{
		bp.model.loadSerialized(TWO_STOREYS);
		bp.model.setRoof({kind: 'gable', pitch: 30, overhang: 40});
		bp.model.levels.forEach((level) => {level.floorplan.update();});

		const mesh = roofMesh();
		expect(mesh).not.toBeNull();
		mesh.updateMatrixWorld(true);
		const box = new Box3().setFromObject(mesh);

		// Eaves at the first floor's base plus its wall height.
		expect(box.min.y).toBeCloseTo(280 + WALL_HEIGHT, 2);
		// And covering the 600 cm plan plus 40 of overhang each side.
		expect(box.min.x).toBeLessThanOrEqual(-40 + 0.001);
		expect(box.max.x).toBeGreaterThanOrEqual(640 - 0.001);
		expect(box.min.z).toBeLessThanOrEqual(-40 + 0.001);
		expect(box.max.z).toBeGreaterThanOrEqual(640 - 0.001);
	});

	it('follows the pitch and comes off again', () =>
	{
		bp.model.loadSerialized(TWO_STOREYS);
		bp.model.setRoof({kind: 'gable', pitch: 20});
		const shallow = new Box3().setFromObject(roofMesh());

		bp.model.setRoof({pitch: 45});
		const steep = new Box3().setFromObject(roofMesh());

		expect(steep.max.y - steep.min.y).toBeGreaterThan(shallow.max.y - shallow.min.y);

		bp.model.setRoof(null);
		expect(roofMesh()).toBeNull();
	});

	it('rises with the building when a storey is added', () =>
	{
		bp.model.loadSerialized(TWO_STOREYS);
		bp.model.setRoof({kind: 'hip'});
		const twoStoreys = new Box3().setFromObject(roofMesh()).min.y;

		bp.model.setActiveLevel(1);
		bp.model.addLevel();
		bp.model.levels[2].floorplan.loadFloorplan(JSON.parse(TWO_STOREYS).floorplan);
		bp.model.setRoof({});

		expect(new Box3().setFromObject(roofMesh()).min.y).toBeGreaterThan(twoStoreys);
	});
});
