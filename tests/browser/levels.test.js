/**
 * Storeys, stacked and measured (RM-010 G1).
 *
 * **M-38** is the metric this file exists for, and it is asserted off the scene
 * rather than off the model: every mesh a level owns - floor, ceiling, wall
 * faces, fillers, furniture - sits between that level's base elevation and its
 * base plus its height. RM-010 V-4 is why it needs asserting at all. Nothing in
 * this tree was drawn at a base elevation before G1: every floor sat at y = 0
 * and a corner's `elevation` was the wall *top*, so a second storey is not
 * corners with a bigger number, it is a translation that did not exist.
 *
 * The other half of M-26 - a single-storey file re-saving byte-identical - is
 * headless and lives in `tests/levels.test.js`, because it is a string
 * comparison and does not need a GPU.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Box3} from 'three';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WALL_HEIGHT = 250;

/** A four-metre room, for whichever storey it is loaded onto. */
function room(size)
{
	return {
		corners: {
			c1: {x: 0, y: 0, elevation: WALL_HEIGHT},
			c2: {x: size, y: 0, elevation: WALL_HEIGHT},
			c3: {x: size, y: size, elevation: WALL_HEIGHT},
			c4: {x: 0, y: size, elevation: WALL_HEIGHT},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
		units: 'cm',
		version: '2.0.0',
	};
}

const ONE_STOREY = JSON.stringify({floorplan: room(400), items: []});

const THREE_STOREYS = JSON.stringify({
	floorplan: room(400),
	items: [],
	levels: [
		{name: 'Ground floor', height: 280},
		{name: 'First floor', height: 280, floorplan: room(400), items: []},
		{name: 'Second floor', height: 300, floorplan: room(400), items: []},
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

/**
 * The vertical extent of everything in one storey's group.
 *
 * Read off the scene graph, which is the only place the base elevation exists -
 * it is applied to the group and to nothing else, so a level whose meshes are
 * at the wrong height is a level whose group is in the wrong place, and this is
 * how that shows.
 */
function levelSpan(index)
{
	const level = bp.model.levels[index];
	const group = bp.model.scene.levelGroup(level);
	group.updateMatrixWorld(true);
	const box = new Box3();
	let min = Infinity;
	let max = -Infinity;
	group.traverse((object) =>
	{
		if (!object.isMesh || !object.geometry || !object.geometry.attributes.position)
		{
			return;
		}
		box.setFromObject(object);
		min = Math.min(min, box.min.y);
		max = Math.max(max, box.max.y);
	});
	return {min, max};
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

describe('M-38 - a storey is where it says it is', () =>
{
	it('draws a one-storey design on the ground, as it always did', () =>
	{
		bp.model.loadSerialized(ONE_STOREY);
		bp.model.floorplan.update();

		expect(bp.model.levels).toHaveLength(1);
		expect(bp.model.levelBase(0)).toBe(0);
		const span = levelSpan(0);
		expect(span.min).toBeCloseTo(0, 3);
		expect(span.max).toBeCloseTo(WALL_HEIGHT, 3);
	});

	it('stacks three storeys at their own heights', () =>
	{
		bp.model.loadSerialized(THREE_STOREYS);
		bp.model.levels.forEach((level) => {level.floorplan.update();});

		expect(bp.model.levels).toHaveLength(3);
		// Bases are the running sum of the heights below, derived and not stored.
		expect(bp.model.levelBase(0)).toBe(0);
		expect(bp.model.levelBase(1)).toBe(280);
		expect(bp.model.levelBase(2)).toBe(560);

		[0, 1, 2].forEach((index) =>
		{
			const base = bp.model.levelBase(index);
			const span = levelSpan(index);
			expect(span.min).toBeCloseTo(base, 3);
			expect(span.max).toBeCloseTo(base + WALL_HEIGHT, 3);
		});
	});

	it('moves every storey above one whose height is edited', () =>
	{
		bp.model.loadSerialized(THREE_STOREYS);
		bp.model.levels.forEach((level) => {level.floorplan.update();});

		bp.model.setLevelHeight(0, 400);

		expect(bp.model.levelBase(1)).toBe(400);
		expect(bp.model.levelBase(2)).toBe(680);
		expect(levelSpan(1).min).toBeCloseTo(400, 3);
		expect(levelSpan(2).min).toBeCloseTo(680, 3);
		// And the ground floor did not move.
		expect(levelSpan(0).min).toBeCloseTo(0, 3);
	});

	it('puts furniture on the storey it was added to, at that storey\'s height', async () =>
	{
		bp.model.loadSerialized(THREE_STOREYS);
		bp.model.levels.forEach((level) => {level.floorplan.update();});
		bp.model.setActiveLevel(1);

		const item = await new Promise((resolve) =>
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
			bp.model.scene.addItem(12, '', {
				itemName: 'Column', itemType: 12, format: 'parametric', resizable: true,
				structure: {kind: 'column', width: 30, depth: 30, length: 250},
			});
		});

		expect(item).not.toBeNull();
		expect(bp.model.levels[1].items).toContain(item);
		expect(bp.model.levels[0].items).not.toContain(item);

		// A 250 cm column standing on the first floor, whose floor is at 280.
		item.updateMatrixWorld(true);
		item.geometry.computeBoundingBox();
		const world = item.geometry.boundingBox.clone().applyMatrix4(item.matrixWorld);
		expect(world.min.y).toBeCloseTo(280, 3);
		expect(world.max.y).toBeCloseTo(530, 3);
	});

	it('shows the active storey\'s furniture on the plan and nobody else\'s', async () =>
	{
		bp.model.loadSerialized(THREE_STOREYS);
		bp.model.setActiveLevel(2);
		await new Promise((resolve) =>
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
			bp.model.scene.addItem(12, '', {
				itemName: 'Column', itemType: 12, format: 'parametric', resizable: true, structure: {},
			});
		});

		expect(bp.model.scene.getItems()).toHaveLength(1);
		expect(bp.model.scene.allItems()).toHaveLength(1);

		bp.model.setActiveLevel(0);
		bp.model.projectItemsToPlan();

		// The plan is a section through one floor; the column upstairs is not on it.
		expect(bp.model.scene.getItems()).toHaveLength(0);
		expect(bp.model.floorplan.itemProjection).toHaveLength(0);
		// But it is still in the building, and still resolvable by id.
		expect(bp.model.scene.allItems()).toHaveLength(1);
		expect(bp.model.itemById(bp.model.scene.allItems()[0].designId)).toBeTruthy();
	});
});
