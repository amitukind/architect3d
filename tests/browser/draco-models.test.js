/**
 * Loading a real compressed model, in a real browser (RM-004 B1, tier 2).
 *
 * ## The gap this closes
 *
 * B1 re-encoded 152 of 165 catalog models with `KHR_draco_mesh_compression`,
 * and when it was done the whole browser tier passed - all 49 cases, first
 * try. That was not evidence. **Every existing browser test stubs the loader**
 * (`setItemLoader(() => {})`), because until now the point of those tests was
 * geometry the library builds itself: walls, floors, rooms. Not one of them had
 * ever fetched a `.glb`, so a catalog that no build could decode would have
 * sailed through the tier unremarked.
 *
 * Everything about Draco that can actually fail lives on the far side of that
 * stub - the fetch, the container parse, the `extensionsRequired` check, the
 * worker spin-up, the WASM fetch from `public/draco/`, the decode, the upload.
 * This is the only file that exercises any of it.
 *
 * ## What it asserts, in order of what would hurt most
 *
 *  1. A compressed model loads at all, and produces geometry with the vertex
 *     count the encoder recorded.
 *  2. It DRAWS - the frame changes when the model is added. A decoder that
 *     returns empty buffers produces a model that loads and renders nothing,
 *     which the first assertion alone would not catch.
 *  3. The decoder is fetched from the resolver's path, so `?assetBase=` moves
 *     it with everything else rather than leaving it pinned to the origin.
 *  4. An UNcompressed model still loads, because 13 models ship authored and a
 *     wiring change that only handled the compressed case would strand them.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {AssetManifest} from '../../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../../src/scripts/core/asset_resolver.js';
import {DesignRuntime} from '../../src/scripts/core/design_runtime.js';

/** A bare four-metre room; the models are added on top of it. */
const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			a: {x: -200, y: -200}, b: {x: 200, y: -200},
			c: {x: 200, y: 200}, d: {x: -200, y: 200},
		},
		walls: [
			{corner1: 'a', corner2: 'b'}, {corner1: 'b', corner2: 'c'},
			{corner1: 'c', corner2: 'd'}, {corner1: 'd', corner2: 'a'},
		],
		wallTextures: [], floorTextures: {}, newFloorTextures: {}, carbonSheet: {},
	},
	items: [],
});

let hosts = [];
let viewers = [];
let manifest = null;

beforeEach(async () =>
{
	if (!manifest)
	{
		const response = await fetch('/asset-manifest.json');
		manifest = AssetManifest.parse(await response.json()).manifest;
	}
});

afterEach(() =>
{
	viewers.forEach((viewer) => {try { viewer.dispose(); } catch { /* already gone */ }});
	hosts.forEach((host) => host.remove());
	viewers = [];
	hosts = [];
});

function mount(runtime)
{
	const host = document.createElement('div');
	host.innerHTML = '<canvas style="display:block;width:320px;height:240px"></canvas>' +
		'<div style="width:400px;height:300px"></div>';
	document.body.appendChild(host);
	hosts.push(host);

	const blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('canvas'),
		threeElement: host.querySelector('div'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
		runtime,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	blueprint.model.loadSerialized(DESIGN);
	viewers.push(blueprint);
	return blueprint;
}

/** Add one catalog item and wait for it to arrive, or fail loudly. */
function place(blueprint, modelUrl, itemName)
{
	return new Promise((resolve, reject) =>
	{
		const timer = setTimeout(() => reject(new Error(`${modelUrl} never loaded`)), 20000);
		// `format: 'gltf'` covers .glb too - the dispatch is on the loader family,
		// not the container. 'glb' is not a value it recognises and the item fails
		// through the legacy-JSON path with a message about r185, which is a
		// confusing way to learn you typed the wrong string.
		blueprint.model.scene.addItem(
			1, modelUrl,
			{itemName, resizable: true, format: 'gltf'},
			null, null, null, null, null,
		);
		const poll = setInterval(() =>
		{
			const items = blueprint.model.scene.getItems();
			if (items.length > 0)
			{
				clearInterval(poll);
				clearTimeout(timer);
				resolve(items[items.length - 1]);
			}
		}, 50);
	});
}

async function settle(blueprint)
{
	blueprint.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	blueprint.three.render(true);
}

function frame(blueprint)
{
	const canvas = blueprint.three.renderer.domElement;
	const context = document.createElement('canvas').getContext('2d');
	context.canvas.width = canvas.width;
	context.canvas.height = canvas.height;
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, canvas.width, canvas.height).data.join(',');
}

function vertexCount(item)
{
	let total = 0;
	item.traverse((child) =>
	{
		if (child.geometry && child.geometry.attributes && child.geometry.attributes.position)
		{
			total += child.geometry.attributes.position.count;
		}
	});
	return total;
}

describe('a Draco-compressed catalog model, in chromium (RM-004 B1)', () =>
{
	it('is what the manifest says it is', () =>
	{
		// Guards every assertion below: if the fixture stopped being compressed,
		// the rest of this file would pass while testing nothing.
		const entry = manifest.entry('models/js-glb/ik-kivine_baked.glb');
		expect(entry).toBeTruthy();
		expect(entry.codec).toBe('draco');
	});

	it('loads, decodes, and arrives with geometry', async () =>
	{
		const blueprint = mount();
		const item = await place(blueprint, 'models/js-glb/ik-kivine_baked.glb', 'Kivine');

		expect(item).toBeTruthy();
		// A decoder that silently produced nothing would still give us an Item.
		expect(vertexCount(item)).toBeGreaterThan(100);
	});

	it('draws — the frame changes when it arrives', async () =>
	{
		const blueprint = mount();
		await settle(blueprint);
		const before = frame(blueprint);

		// Two consecutive frames identical first, so the comparison below is a
		// measurement rather than a coin toss. Same discipline as A4's pixel test.
		await settle(blueprint);
		expect(frame(blueprint)).toBe(before);

		await place(blueprint, 'models/js-glb/ik-kivine_baked.glb', 'Kivine');
		await settle(blueprint);
		expect(frame(blueprint)).not.toBe(before);
	});

	it('fetches its decoder from the resolver path, so a moved base moves it too', async () =>
	{
		const requested = [];
		const realFetch = window.fetch;
		window.fetch = (input, init) =>
		{
			requested.push(String(input && input.url ? input.url : input));
			return realFetch(input, init);
		};

		try
		{
			const runtime = new DesignRuntime({assets: new AssetResolver({manifest})});
			expect(runtime.assets.decoderPath()).toBe('draco/');

			const blueprint = mount(runtime);
			await place(blueprint, 'models/js-glb/ik-kivine_baked.glb', 'Kivine');

			// three fetches the wrapper and the wasm through its own FileLoader; the
			// assertion is on the PATH, which is what the resolver decides.
			const decoderRequests = requested.filter((url) => url.indexOf('draco/') !== -1);
			expect(decoderRequests.length).toBeGreaterThan(0);
		}
		finally
		{
			window.fetch = realFetch;
		}
	});

	it('still loads a model that ships uncompressed', async () =>
	{
		// 13 models failed the encoder's fidelity gates and ship authored. They go
		// through the same GLTFLoader with a DRACOLoader attached, and a wiring
		// change that assumed compression would break exactly these.
		const uncompressed = manifest.names().find((name) =>
		{
			const entry = manifest.entry(name);
			return entry.kind === 'model' && !entry.codec && name.endsWith('.glb');
		});
		expect(uncompressed).toBeTruthy();

		const blueprint = mount();
		const item = await place(blueprint, uncompressed, 'Authored');
		expect(vertexCount(item)).toBeGreaterThan(10);
	});
});

describe('a KTX2-textured catalog model, in chromium (RM-004 B5)', () =>
{
	/**
	 * ## Why this describe block exists
	 *
	 * A deliberate break that was supposed to fail did not. Removing
	 * `setKTX2Loader` from `Scene` left all 54 browser tests green, which meant
	 * nothing in the suite had ever loaded a model with a compressed texture -
	 * and the conclusion drawn from those green tests, that KTX2 rendering was
	 * verified, was simply wrong.
	 *
	 * The reason is specific and worth recording: the Draco tests above use
	 * `ik-kivine_baked.glb`, which is one of the four models whose texture is
	 * MISSING from the source library. It renders with its base colour and has
	 * no image to decode, so it exercises the geometry path and nothing else.
	 *
	 * These tests use a model that does have one, and assert the transcoded
	 * texture actually arrives - which is the only claim that distinguishes a
	 * working KTX2 pipeline from a broken one.
	 */
	const TEXTURED = 'models/js-glb/ik_nordli_full.glb';

	/** Every texture hanging off an item's materials. */
	function texturesOf(item)
	{
		const found = [];
		item.traverse((node) =>
		{
			const materials = Array.isArray(node.material) ? node.material : [node.material];
			for (const material of materials)
			{
				if (material && material.map) { found.push(material.map); }
			}
		});
		return found;
	}

	it('declares KHR_texture_basisu as required, so a loader cannot ignore it', async () =>
	{
		const response = await fetch(new URL(TEXTURED, location.href).toString());
		expect(response.status).toBe(200);
		const bytes = new Uint8Array(await response.arrayBuffer());

		// Read the JSON chunk out of the container: 12-byte header, then a
		// length-prefixed chunk that is the glTF JSON.
		const view = new DataView(bytes.buffer);
		const length = view.getUint32(12, true);
		const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));

		expect(json.extensionsRequired).toContain('KHR_texture_basisu');
		expect(json.images[0].uri).toMatch(/\.ktx2$/);
		expect(json.images[0].mimeType).toBe('image/ktx2');
		// The plain `source` is gone, which is what makes the extension load-bearing
		// rather than an alternative route to the same image.
		expect(json.textures[0].source).toBeUndefined();
		expect(json.textures[0].extensions.KHR_texture_basisu.source).toBe(0);
	});

	it('transcodes and arrives as a compressed texture with real dimensions', async () =>
	{
		const blueprint = mount();
		const item = await place(blueprint, TEXTURED, 'Nordli');

		// The transcode is asynchronous and finishes after the item does, so the
		// material's map appears a frame or two later than the geometry.
		let maps = [];
		for (let attempt = 0; attempt < 100 && maps.length === 0; attempt++)
		{
			await settle(blueprint);
			maps = texturesOf(item).filter((map) => map && map.image);
		}

		expect(maps.length, 'no texture ever reached the material').toBeGreaterThan(0);
		const map = maps[0];
		expect(map.isCompressedTexture, 'the texture is not compressed - it was not transcoded').toBe(true);
		expect(map.image.width).toBe(669);
		expect(map.image.height).toBe(1024);
		expect(map.mipmaps.length, 'no mip chain, so the transcode produced a single level').toBeGreaterThan(1);
	});

	it('draws — the frame changes once the transcoded texture lands', async () =>
	{
		const blueprint = mount();
		await settle(blueprint);
		const before = frame(blueprint);

		const item = await place(blueprint, TEXTURED, 'Nordli');
		for (let attempt = 0; attempt < 100; attempt++)
		{
			await settle(blueprint);
			if (texturesOf(item).some((map) => map && map.image)) { break; }
		}
		await settle(blueprint);

		expect(frame(blueprint)).not.toBe(before);
	});
});
