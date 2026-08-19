// @vitest-environment jsdom
/**
 * A catalog item that emits light (RM-011 H2, W-11).
 *
 * The description, the catalog's sixth key and the save round-trip. The light
 * itself needs a renderer and a lit material, so what it does to a picture is in
 * `tests/browser/lamps.test.js`.
 *
 * W-11 priced this as **schema work over a file six suites assert about**, and
 * that is what most of this file is: the eight rows, what they may say, and the
 * promise that the other 160 are untouched.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {BufferGeometry, MeshBasicMaterial, Vector3} from 'three';

import {LAMP_COLOR, LAMP_DEFAULTS, normaliseLamp, lampToJSON} from '../src/scripts/items/lamp.js';
import {Model} from '../src/scripts/model/model.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../src/scripts/core/render_profile.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const CATALOG = JSON.parse(readFileSync(join(process.cwd(), 'src/catalog/catalog.json'), 'utf8'));
const LAMPS = CATALOG.items.filter((item) => item.lamp);

describe('the description', () =>
{
	it('is total: a row that says only "this is a lamp" is a default lamp', () =>
	{
		expect(normaliseLamp({})).toEqual({...LAMP_DEFAULTS});
		expect(normaliseLamp()).toEqual({...LAMP_DEFAULTS});
		expect(LAMP_DEFAULTS.color).toBe(LAMP_COLOR);
	});

	it('measures brightness in lumens a person can check against a box', () =>
	{
		// 800 is about a 60 W incandescent, which is what most of these models are
		// drawn as. The number is meaningful outside this repository, which is the
		// point of choosing a real unit over an engine one.
		expect(LAMP_DEFAULTS.brightness).toBe(800);
		expect(normaliseLamp({brightness: 2400}).brightness).toBe(2400);
		// Zero is a lamp that is switched off, not an error.
		expect(normaliseLamp({brightness: 0}).brightness).toBe(0);
	});

	it('clamps what cannot mean anything and keeps what can', () =>
	{
		expect(normaliseLamp({at: 5}).at).toBe(1);
		expect(normaliseLamp({at: -2}).at).toBe(0);
		expect(normaliseLamp({range: -3}).range).toBe(1);
		expect(normaliseLamp({color: '#f00'}).color).toBe('#ff0000');
		expect(normaliseLamp({color: 'warm'}).color).toBe(LAMP_COLOR);
		// A stadium floodlight is 100,000 lumens; refusing it would be taste
		// wearing a validator's coat.
		expect(normaliseLamp({brightness: 100000}).brightness).toBe(100000);
	});

	it('writes only what differs, and `{}` for a default lamp', () =>
	{
		expect(lampToJSON({})).toEqual({});
		expect(lampToJSON({brightness: 2400, at: 0.25})).toEqual({brightness: 2400, at: 0.25});
		expect(lampToJSON({...LAMP_DEFAULTS})).toEqual({});
	});
});

describe('the catalog\'s sixth key (W-11)', () =>
{
	it('tags the eight entries that are lamps, and nothing else', () =>
	{
		// W-11 counted eight entries named like lamps out of 168. Re-counted here
		// so the schema and the drawing cannot drift apart, and so that adding a
		// ninth is a decision somebody makes rather than a number that slides.
		expect(CATALOG.items).toHaveLength(168);
		expect(LAMPS).toHaveLength(8);
		expect(LAMPS.map((item) => item.name).sort()).toEqual([
			'Chandelier', 'Floor Lamp', 'Lamproundfloor', 'Lamproundtable',
			'Lampsquareceiling', 'Lampsquarefloor', 'Lampsquaretable', 'Lampwall',
		]);
	});

	it('leaves the other 160 rows at exactly the five keys they had', () =>
	{
		// The cost W-11 priced. A sixth key on a shared file is only cheap if it
		// appears on the rows that need it and nowhere else.
		const untouched = CATALOG.items.filter((item) => !item.lamp);
		for (const item of untouched)
		{
			expect(Object.keys(item).sort(), item.name)
				.toEqual(['format', 'image', 'model', 'name', 'type']);
		}
	});

	it('says only what differs from the defaults', () =>
	{
		// The same rule the opening, stair and structure rows follow: a row is "a
		// lamp" or "a lamp, brighter", never a full record repeated eight times.
		for (const item of LAMPS)
		{
			expect(lampToJSON(item.lamp), item.name).toEqual(item.lamp);
		}
		// And the three floor-standing ones say nothing at all, because the
		// defaults were chosen to be what a standard lamp is.
		const plain = LAMPS.filter((item) => Object.keys(item.lamp).length === 0);
		expect(plain.map((item) => item.name).sort())
			.toEqual(['Floor Lamp', 'Lamproundfloor', 'Lampsquarefloor']);
	});

	it('puts a pendant\'s bulb low in the fitting and a floor lamp\'s high', () =>
	{
		// `at` is a fraction of the item's own height, so the numbers have to
		// describe the models rather than a convention. A chandelier hangs from
		// its top and lights from near its bottom; a standard lamp is the reverse.
		const byName = Object.fromEntries(LAMPS.map((item) => [item.name, normaliseLamp(item.lamp)]));
		expect(byName.Chandelier.at).toBeLessThan(0.5);
		expect(byName.Lampsquareceiling.at).toBeLessThan(0.5);
		expect(byName['Floor Lamp'].at).toBeGreaterThan(0.5);
		expect(byName.Lampwall.at).toBeCloseTo(0.5, 1);
	});

	it('gives a chandelier more light than a table lamp', () =>
	{
		const byName = Object.fromEntries(LAMPS.map((item) => [item.name, normaliseLamp(item.lamp)]));
		expect(byName.Chandelier.brightness).toBeGreaterThan(byName['Floor Lamp'].brightness);
		expect(byName['Floor Lamp'].brightness).toBeGreaterThan(byName.Lamproundtable.brightness);
		// And reach further, which is the other half of what makes a room read as
		// lit by one fitting rather than by a uniform glow.
		expect(byName.Chandelier.range).toBeGreaterThan(byName.Lamproundtable.range);
	});
});

describe('what an item does with one', () =>
{
	let canvasStub;

	beforeEach(() =>
	{
		resetAll();
		canvasStub = installCanvas2D(window);
	});

	afterEach(() =>
	{
		setRenderProfile(RENDER_CLASSIC);
		if (canvasStub && canvasStub.restore) { canvasStub.restore(); }
	});

	/** A model whose loader answers at once, so an item exists on the next line. */
	function withItem(lamp)
	{
		const model = new Model('');
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			onLoad(new BufferGeometry().setFromPoints([new Vector3(-10, 0, -10), new Vector3(10, 60, 10)]),
				new MeshBasicMaterial());
		});
		model.scene.addItem(1, 'lamp.glb', {
			itemName: 'lamp', format: 'gltf', itemType: 1, modelUrl: 'lamp.glb',
			materialColors: [], lamp,
		});
		return {model, item: model.scene.getItems()[0]};
	}

	it('builds a bulb under studio and none under classic', () =>
	{
		setRenderProfile(RENDER_CLASSIC);
		expect(withItem({}).item.bulb).toBeNull();

		setRenderProfile(RENDER_STUDIO);
		const {item} = withItem({});
		expect(item.bulb).toBeTruthy();
		expect(item.bulb.isPointLight).toBe(true);
		expect(item.bulb.power).toBeCloseTo(LAMP_DEFAULTS.brightness, 6);
		expect(item.bulb.castShadow).toBe(false);
		expect(item.children).toContain(item.bulb);
	});

	it('builds nothing at all for an item that is not a lamp', () =>
	{
		setRenderProfile(RENDER_STUDIO);
		const {item} = withItem(undefined);
		expect(item.lamp).toBeNull();
		expect(item.bulb).toBeNull();
	});

	it('keeps the bulb at the top of a lamp that has been made taller', () =>
	{
		// `at` is a fraction, and the bulb is a child - so the parent's scale
		// applies on top of the local offset, and `placeBulb` divides it out. The
		// LOCAL position is therefore invariant under a resize, which looks wrong
		// until you notice that is exactly what keeps the WORLD position at the
		// top of the shade. Both are asserted, because the first draft of this
		// test expected the local one to move and it was the test that was wrong.
		setRenderProfile(RENDER_STUDIO);
		const {item} = withItem({at: 1});
		const localBefore = item.bulb.position.y;
		const worldBefore = localBefore * item.scale.y;
		expect(localBefore).toBeGreaterThan(0);

		item.resize(item.getHeight() * 2, item.getWidth(), item.getDepth());

		expect(item.bulb.position.y).toBeCloseTo(localBefore, 6);
		expect(item.bulb.position.y * item.scale.y).toBeCloseTo(worldBefore * 2, 4);
		// And it is still the top of the item, which is what `at: 1` asked for.
		expect(item.bulb.position.y * item.scale.y).toBeCloseTo(item.halfSize.y, 4);
	});

	it('takes the bulb away with the item', () =>
	{
		setRenderProfile(RENDER_STUDIO);
		const {model, item} = withItem({});
		expect(item.bulb).toBeTruthy();

		model.scene.removeItem(item);
		expect(item.bulb).toBeNull();
	});

	it('writes the lamp into the item\'s record and reads it back', () =>
	{
		setRenderProfile(RENDER_STUDIO);
		const {model} = withItem({brightness: 2400});
		const saved = JSON.parse(model.exportSerialized());
		expect(saved.items[0].lamp).toEqual({brightness: 2400});

		const reopened = new Model('');
		reopened.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			onLoad(new BufferGeometry().setFromPoints([new Vector3(0, 0, 0)]), new MeshBasicMaterial());
		});
		reopened.loadSerialized(JSON.stringify(saved));
		expect(reopened.scene.getItems()[0].lamp.brightness).toBe(2400);
	});
});
