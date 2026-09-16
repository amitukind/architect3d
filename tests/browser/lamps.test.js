/**
 * A lamp that lights the room (RM-011 H2, W-11, tier 2).
 *
 * The description and the catalog's sixth key are in `tests/lamps.test.js`. This
 * is the half that needs a renderer: whether the bulb is built at all, where it
 * ends up, what it costs, and H2's third acceptance clause - *"every light this
 * sprint adds is off, or free, under classic"*, which for a lamp means **not
 * built**, because an unlit `MeshBasicMaterial` wall cannot receive one.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';
import {normaliseLamp} from '../../src/scripts/items/lamp.js';
import catalog from '../../src/catalog/catalog.json';

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: 500, y: 0, elevation: 250},
			c3: {x: 500, y: 500, elevation: 250}, c4: {x: 0, y: 500, elevation: 250},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
	},
	items: [],
});

/** The standard lamp, which is the row that says nothing but "this is a lamp". */
const FLOOR_LAMP = catalog.items.find((item) => item.name === 'Floor Lamp');

let host;
let bp;

function boot(profile)
{
	setRenderProfile(profile);
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
	bp.model.loadSerialized(ROOM);
	bp.model.floorplan.update();
}

/** Place a catalog row and wait for its model to land. */
async function place(entry)
{
	const before = bp.model.scene.getItems().length;
	bp.model.scene.addItem(entry.type, entry.model, {
		itemName: entry.name, resizable: true, modelUrl: entry.model,
		itemType: entry.type, format: entry.format, lamp: entry.lamp,
	});
	for (let tick = 0; tick < 80 && bp.model.scene.getItems().length === before; tick++)
	{
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const items = bp.model.scene.getItems();
	expect(items.length, `${entry.name} never loaded`).toBeGreaterThan(before);
	return items[items.length - 1];
}

/** Every PointLight the scene graph holds. */
function bulbs()
{
	const found = [];
	bp.three.scene.getScene().traverse((object) =>
	{
		if (object.isPointLight) { found.push(object); }
	});
	return found;
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('a lamp emits, under studio', () =>
{
	it('builds one bulb, at the lumens the catalog asked for', async () =>
	{
		boot(RENDER_STUDIO);
		expect(bulbs()).toHaveLength(0);

		const item = await place(FLOOR_LAMP);
		const lit = bulbs();
		expect(lit).toHaveLength(1);
		expect(lit[0]).toBe(item.bulb);

		// Lumens in, candela out, and three does the division. Reading `power`
		// back is what proves the unit survived the trip.
		const lamp = normaliseLamp(FLOOR_LAMP.lamp);
		expect(lit[0].power).toBeCloseTo(lamp.brightness, 6);
		expect(lit[0].distance).toBe(lamp.range);
		// The key casts the shadows; a shadow-casting point light is six renders.
		expect(lit[0].castShadow).toBe(false);
	});

	it('hangs the bulb at the fraction of the item\'s height the row states', async () =>
	{
		boot(RENDER_STUDIO);
		const item = await place(FLOOR_LAMP);
		const lamp = normaliseLamp(FLOOR_LAMP.lamp);

		// Local to the item, so the offset is from its centre and the scale it was
		// loaded at has already been divided out.
		const height = item.halfSize.y * 2;
		expect(item.bulb.position.y).toBeCloseTo(((lamp.at - 0.5) * height) / (item.scale.y || 1), 4);
		expect(item.bulb.parent).toBe(item);
	});

	it('takes the light away with the lamp', async () =>
	{
		// A0's rule. An undisposed bulb is a deleted lamp still lighting the room,
		// and nothing else in the scene would say so.
		boot(RENDER_STUDIO);
		const item = await place(FLOOR_LAMP);
		expect(bulbs()).toHaveLength(1);

		bp.model.scene.removeItem(item);
		expect(bulbs()).toHaveLength(0);
		expect(item.bulb).toBeNull();
	});

	it('carries the lamp into the saved design and back out', async () =>
	{
		boot(RENDER_STUDIO);
		await place(FLOOR_LAMP);
		const saved = JSON.parse(bp.model.exportSerialized());
		const lamps = saved.items.filter((item) => item.lamp);
		expect(lamps).toHaveLength(1);
		// The default row writes `{}`: the key's presence is what says it emits.
		expect(lamps[0].lamp).toEqual({});

		// And a design of things that do not emit writes no key at all, which is
		// the byte-identity rule every addition since E2 has followed.
		const chairs = saved.items.filter((item) => !item.lamp);
		expect(chairs.every((item) => item.lamp === undefined)).toBe(true);
	});
});

describe('and is not built at all under classic', () =>
{
	it('gives a lamp no bulb, because there is nothing for one to light', async () =>
	{
		// H2's third acceptance clause. `classic` draws walls with an unlit
		// MeshBasicMaterial: a point light would reach the Phong floors and nothing
		// else, which is a lamp that lights the carpet and not the room. Not built
		// is the cheapest way to be both off and free.
		boot(RENDER_CLASSIC);
		const item = await place(FLOOR_LAMP);
		expect(item.lamp).not.toBeNull();
		expect(item.bulb).toBeNull();
		expect(bulbs()).toHaveLength(0);
	});
});
