// @vitest-environment jsdom
/**
 * Sprint S3: the unified catalog and the legacy-URL shim.
 *
 * jsdom, because constructing an Item builds label canvases through
 * document.createElement - see helpers/dom.js for the 2D context stub.
 *
 * Two exit-gate items live here.
 *
 * "Every catalog item loads through the glTF path - a console counter proves
 * the JSONLoader branch is never entered." S4 deleted that branch along with
 * the loader, so the counter became Scene.unloadableItemCount: how many items a
 * design asked for that no loader in this build can open. It stays at zero
 * below, which is the same guarantee stated against what now exists.
 *
 * "Pre-migration .blueprint3d fixtures (old URLs) load correctly through the
 * shim; saving re-emits glb-native files that also load." The fixture is
 * tests/fixtures/legacy-items.blueprint3d - a genuine pre-migration save lifted
 * out of the demo, 20 items across 9 legacy models, with no format field on any
 * of them because the format did not exist yet.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import * as THREE from 'three';

import {Model} from '../src/scripts/model/model.js';
import {Scene} from '../src/scripts/model/scene.js';
import {item_types} from '../src/scripts/items/factory.js';
import {
	CONVERTED_MODEL_DIR, LEGACY_MODEL_MAP, LEGACY_MODEL_NAMES, resolveModelUrl, resetLegacyModelWarnings,
} from '../src/scripts/core/legacy_models.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));

let canvasStub;

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Scene.unloadableItemCount = 0;
	resetLegacyModelWarnings();
});

afterEach(() =>
{
	canvasStub.restore();
	resetLegacyModelWarnings();
});

describe('the unified catalog', () =>
{
	it('replaces both hand-maintained lists', () =>
	{
		// 27 legacy entries + 142 glTF entries, less the one that pointed at a
		// cabinet.json that has never existed in this repository.
		expect(CATALOG.items.length).toBe(217);
	});

	it('has dropped the entry whose model file was never in the repository', () =>
	{
		expect(CATALOG.items.some((item) => item.model.endsWith('cabinet.json'))).toBe(false);
	});

	it('is entirely glTF - nothing points at the retired JSON format', () =>
	{
		const legacy = CATALOG.items.filter((item) => item.format !== 'gltf' || item.model.endsWith('.js'));
		expect(legacy).toEqual([]);
	});

	it('ships every model and thumbnail it lists', () =>
	{
		const missing = CATALOG.items
			.flatMap((item) => [item.model, item.image])
			.filter((path) => !existsSync(join(ROOT, 'public', path)));
		expect(missing).toEqual([]);
	});

	it('only uses item types the factory can build', () =>
	{
		const known = Object.keys(item_types).map(Number).sort((a, b) => a - b);
		const used = [...new Set(CATALOG.items.map((item) => item.type))].sort((a, b) => a - b);
		expect(used.every((type) => known.includes(type))).toBe(true);
		// Every declared type maps to a wrapper the demo markup provides.
		for (const type of used)
		{
			expect(CATALOG.itemTypes[String(type)], `type ${type}`).toBeTruthy();
		}
	});

	it('carries all 25 converted models', () =>
	{
		const converted = CATALOG.items.filter((item) => item.model.startsWith(`${CONVERTED_MODEL_DIR}/`));
		expect(converted.length).toBe(25);
		const names = converted.map((item) => item.model.split('/').pop().replace('.glb', '')).sort();
		expect(names).toEqual([...LEGACY_MODEL_NAMES].sort());
	});

	// Removed in S9: a drift check that regenerated build/js/items.js from this
	// catalog and compared the two. It guarded a GENERATED file - the jQuery
	// palette the frozen demo appended to its Bootstrap modal - against someone
	// editing the output instead of the input. Both the demo and its generator
	// are gone, and the Vue catalog reads catalog.json directly (S7), so there
	// is no longer an output to drift.
});

describe('resolveModelUrl', () =>
{
	it('rewrites every legacy model to its conversion', () =>
	{
		for (const [oldUrl, newUrl] of Object.entries(LEGACY_MODEL_MAP))
		{
			const resolved = resolveModelUrl(oldUrl, undefined);
			expect(resolved.url).toBe(newUrl);
			expect(resolved.format).toBe('gltf');
			expect(resolved.converted).toBe(true);
		}
	});

	it('matches on the basename, so a design saved against another host still resolves', () =>
	{
		const resolved = resolveModelUrl('https://cdn.example.com/assets/v2/open_door.js');
		expect(resolved.url).toBe('models/js-glb/open_door.glb');
		expect(resolved.converted).toBe(true);
	});

	it('leaves glTF urls alone', () =>
	{
		const resolved = resolveModelUrl('models/gltf/bathtub.glb', 'gltf');
		expect(resolved).toEqual({url: 'models/gltf/bathtub.glb', format: 'gltf', converted: false});
	});

	it('passes through a .js model this build never converted, and says so once', () =>
	{
		const warnings = [];
		const original = console.warn;
		console.warn = (message) => warnings.push(message);
		try
		{
			const first = resolveModelUrl('models/js/somebody-elses-model.js');
			const second = resolveModelUrl('models/js/somebody-elses-model.js');
			expect(first.url).toBe('models/js/somebody-elses-model.js');
			expect(first.converted).toBe(false);
			expect(second.converted).toBe(false);
			expect(warnings.length).toBe(1);
			expect(warnings[0]).toMatch(/retired three\.js JSON format/);
		}
		finally
		{
			console.warn = original;
		}
	});

	it('is a no-op for anything that is not a string url', () =>
	{
		expect(resolveModelUrl(undefined).url).toBeUndefined();
		expect(resolveModelUrl(null).converted).toBe(false);
		expect(resolveModelUrl(42).converted).toBe(false);
	});
});

describe('loading a pre-migration design', () =>
{
	/** Record what Scene.addItem actually asked the loader for. */
	function loadFixtureRecording(json)
	{
		const model = new Model('models/textures/');
		const requests = [];
		const stub = stubItemLoader(THREE);
		model.scene.setItemLoader((fileName, metadata, onLoad) =>
		{
			requests.push({fileName, format: metadata.format, modelUrl: metadata.modelUrl, legacyConverted: metadata.legacyConverted});
			stub(fileName, metadata, onLoad);
		});
		model.loadSerialized(json);
		return {model, requests};
	}

	const fixture = readFileSync(join(ROOT, 'tests/fixtures/legacy-items.blueprint3d'), 'utf8');

	it('is a genuine pre-S3 save - old urls, no format field anywhere', () =>
	{
		const raw = JSON.parse(fixture);
		expect(raw.items.length).toBe(20);
		expect(raw.items.every((item) => item.model_url.startsWith('models/js/'))).toBe(true);
		expect(raw.items.every((item) => item.format === undefined)).toBe(true);
	});

	it('rewrites every item to its converted model on the way in', () =>
	{
		const {requests} = loadFixtureRecording(fixture);

		expect(requests.length).toBe(20);
		for (const request of requests)
		{
			expect(request.fileName).toMatch(/^models\/js-glb\/.*\.glb$/);
			expect(request.format).toBe('gltf');
			expect(request.legacyConverted).toBe(true);
			expect(existsSync(join(ROOT, 'public', request.fileName))).toBe(true);
		}
	});

	it('resolves every item to a loader this build actually has', () =>
	{
		// The exit-gate counter. Zero after a full design load.
		loadFixtureRecording(fixture);
		expect(Scene.unloadableItemCount).toBe(0);
	});

	it('keeps the floorplan intact', () =>
	{
		const {model} = loadFixtureRecording(fixture);
		expect(model.floorplan.getCorners().length).toBe(23);
		expect(model.floorplan.getWalls().length).toBe(30);
		expect(model.scene.getItems().length).toBe(20);
	});

	it('re-emits a glb-native file when saved', () =>
	{
		const {model} = loadFixtureRecording(fixture);
		const saved = JSON.parse(model.exportSerialized());

		expect(saved.items.length).toBe(20);
		for (const item of saved.items)
		{
			expect(item.model_url).toMatch(/^models\/js-glb\/.*\.glb$/);
			expect(item.format).toBe('gltf');
		}
	});

	it('loads the re-saved file without the shim doing anything', () =>
	{
		const {model} = loadFixtureRecording(fixture);
		const saved = model.exportSerialized();

		const second = loadFixtureRecording(saved);
		expect(second.requests.length).toBe(20);
		// Nothing left to rewrite: the design needed the shim exactly once.
		expect(second.requests.every((request) => request.legacyConverted === undefined)).toBe(true);
		expect(Scene.unloadableItemCount).toBe(0);
	});

	it('places items in the same positions before and after the round trip', () =>
	{
		const {model} = loadFixtureRecording(fixture);
		const first = JSON.parse(model.exportSerialized()).items.map(positionOf);

		const {model: reloaded} = loadFixtureRecording(model.exportSerialized());
		const second = JSON.parse(reloaded.exportSerialized()).items.map(positionOf);

		expect(second).toEqual(first);
	});
});

describe('a model no loader can open', () =>
{
	// S3 kept a JSONLoader branch behind a counter so the exit gate could prove
	// it was never entered. S4 deleted the branch with the loader. What replaces
	// it is the failure case: a formatless model now has nowhere to go, and the
	// thing worth asserting is that it fails loudly instead of hanging.

	it('reports the item, counts it, and does not leave the load pending', () =>
	{
		const model = new Model('models/textures/');
		const errors = [];
		const original = console.error;
		console.error = (message) => errors.push(message);

		let loaded = 0;
		model.scene.addEventListener('ITEM_LOADED_EVENT', () => {loaded += 1;});

		try
		{
			// Not a .js name, so the shim leaves it alone and it arrives with no
			// format - exactly the shape of a design referencing a model that was
			// never part of the shipped library.
			model.scene.addItem(1, 'models/js/not-converted.dat', {itemType: 1}, null, null, null, false);
		}
		finally
		{
			console.error = original;
		}

		expect(Scene.unloadableItemCount).toBe(1);
		expect(errors.some((message) => /retired three\.js JSON model format/.test(message))).toBe(true);
		// EVENT_ITEM_LOADING fired; something has to close the pair or an
		// embedder's spinner never comes down.
		expect(loaded).toBe(1);
		expect(model.scene.getItems().length).toBe(0);
	});

	it('does not fire for anything in the shipped catalog', () =>
	{
		// The S3 exit-gate guarantee, restated against the new counter: every
		// catalog entry declares a format the build can actually load.
		const formats = new Set(CATALOG.items.map((item) => item.format));
		expect([...formats].sort()).toEqual(['gltf']);
		expect(Scene.unloadableItemCount).toBe(0);
	});
});

function positionOf(item)
{
	return [item.model_url, item.xpos, item.ypos, item.zpos, item.rotation, item.scale_x, item.scale_y, item.scale_z];
}
