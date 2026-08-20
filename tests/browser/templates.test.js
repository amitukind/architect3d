/**
 * The starter plans, opened for real (RM-013 K1, gap Q-6).
 *
 * ## What needs a browser here
 *
 * Two things, and the second is the one that could quietly be wrong.
 *
 * **The plans open.** `tools/make-templates.mjs` builds them by calling the
 * library's own `Floorplan`, so they parse by construction and the headless
 * suite checks that. What it cannot check is that a loaded plan produces the
 * rooms it was named for, because room detection runs on load.
 *
 * **The furniture rests on the floor.** A saved item's `ypos` is its CENTRE, and
 * `FloorItem.placeInRoom` only supplies one when the document does not - so a
 * sample written with zeroes ships furniture buried to its waist, and nothing
 * anywhere would say so. The tool computes each centre from the model's own
 * `POSITION` accessor bounds times the row's `unitScale`, without walking node
 * transforms. This is where that arithmetic is checked against what three.js
 * actually loads, which is the only authority on it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Box3} from 'three';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {loadTemplateManifest, resetTemplates} from '../../src/app/composables/useTemplates.js';

/** How far above or below the floor an item may sit, in centimetres. */
const FLOOR_TOLERANCE_CM = 1.5;

let host;
let blueprint;

function boot()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:800px;height:600px"></canvas>'
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
}

/** Load a document and wait for its furniture to arrive. */
async function open(text, itemCount)
{
	const settled = new Promise((resolve) =>
	{
		if (!itemCount)
		{
			resolve();
			return;
		}
		let seen = 0;
		const onLoaded = () =>
		{
			seen += 1;
			if (seen >= itemCount)
			{
				blueprint.model.scene.removeEventListener('ITEM_LOADED_EVENT', onLoaded);
				resolve();
			}
		};
		blueprint.model.scene.addEventListener('ITEM_LOADED_EVENT', onLoaded);
		setTimeout(resolve, 25000);
	});
	blueprint.model.loadSerialized(text);
	await settled;
	// One more beat, so the last item's `initObject` has run.
	await new Promise((resolve) => {setTimeout(resolve, 250);});
}

async function documents()
{
	const entries = await loadTemplateManifest();
	const texts = {};
	for (const entry of entries)
	{
		const response = await fetch(entry.file);
		texts[entry.id] = await response.text();
	}
	return {entries, texts};
}

beforeEach(() =>
{
	resetTemplates();
	boot();
});

afterEach(() =>
{
	blueprint.dispose();
	host.remove();
	host = null;
	blueprint = null;
});

describe('every starter plan opens into the rooms it names', () =>
{
	it('finds the rooms the manifest declares, on every entry', async () =>
	{
		const {entries, texts} = await documents();
		const found = {};

		for (const entry of entries)
		{
			await open(texts[entry.id], 0);
			found[entry.id] = {
				rooms: blueprint.model.floorplan.getRooms().length,
				named: blueprint.model.floorplan.getRooms().filter((room) => Boolean(room.name)).length,
			};
		}

		for (const entry of entries)
		{
			expect(found[entry.id].rooms, `${entry.id} room count`).toBe(entry.rooms);
			// Every room a template ships is named. An unnamed room in a starter
			// plan is a room somebody has to work out for themselves, which is the
			// opposite of what a starter plan is for.
			expect(found[entry.id].named, `${entry.id} named rooms`).toBe(entry.rooms);
		}
	}, 60000);
});

describe('the furniture in a sample rests on the floor', () =>
{
	it('puts every item on the floor, and inside the plan', async () =>
	{
		const {entries, texts} = await documents();
		const sample = entries.find((entry) => entry.id === 'sample-studio');

		await open(texts[sample.id], sample.items);

		const items = blueprint.model.scene.getItems();
		expect(items.length).toBe(sample.items);

		const box = new Box3();
		const sunk = [];
		const outside = [];
		const bounds = {minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity};
		blueprint.model.floorplan.getCorners().forEach((corner) =>
		{
			bounds.minX = Math.min(bounds.minX, corner.x);
			bounds.maxX = Math.max(bounds.maxX, corner.x);
			bounds.minZ = Math.min(bounds.minZ, corner.y);
			bounds.maxZ = Math.max(bounds.maxZ, corner.y);
		});

		items.forEach((item) =>
		{
			box.setFromObject(item);
			if (Math.abs(box.min.y) > FLOOR_TOLERANCE_CM)
			{
				sunk.push(`${item.metadata.itemName} bottom at ${box.min.y.toFixed(1)} cm`);
			}
			if (item.position.x < bounds.minX || item.position.x > bounds.maxX
				|| item.position.z < bounds.minZ || item.position.z > bounds.maxZ)
			{
				outside.push(`${item.metadata.itemName} at ${item.position.x}, ${item.position.z}`);
			}
		});

		// The arithmetic in `make-templates.mjs` reads accessor bounds and does not
		// walk node transforms. If a kit ever authors its meshes under a scaled
		// node this is the assertion that will say so, and it will name the item.
		expect(sunk, `items not resting on the floor:\n  ${sunk.join('\n  ')}`).toEqual([]);
		expect(outside, `items outside the plan:\n  ${outside.join('\n  ')}`).toEqual([]);
	}, 60000);

	it('re-saves what it opened', async () =>
	{
		const {entries, texts} = await documents();
		const sample = entries.find((entry) => entry.id === 'sample-studio');

		await open(texts[sample.id], sample.items);
		const again = blueprint.model.exportSerialized();

		// Not byte-identical - item ids are the document's and corner order is the
		// model's - but the same design: the same furniture, at the same places,
		// at the same size.
		const before = JSON.parse(texts[sample.id]).items;
		const after = JSON.parse(again).items;
		expect(after).toHaveLength(before.length);
		before.forEach((item) =>
		{
			const match = after.find((row) => row.id === item.id);
			expect(match, `${item.id} survived the round trip`).toBeTruthy();
			expect(match.xpos).toBeCloseTo(item.xpos, 3);
			expect(match.ypos).toBeCloseTo(item.ypos, 3);
			expect(match.zpos).toBeCloseTo(item.zpos, 3);
			expect(match.scale_x).toBeCloseTo(item.scale_x, 6);
		});
	}, 60000);
});
