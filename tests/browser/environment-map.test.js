/**
 * The environment map still arrives after P6 re-encoded it (tier 2).
 *
 * `Skybox.defaultEnvironment` changed from `rooms/textures/envs/Garden.png` to
 * `.jpg` - 3.4 MB to 844 kB, the single largest saving in the asset pass. That
 * rename is the one change P6 made to a hardcoded path in library source rather
 * than to a catalog entry or a glb, and it is on the least-travelled code path
 * in the project: the map only loads when the viewer enters first-person mode.
 *
 * `TextureLoader` reports a 404 by calling the error callback, and `Skybox`'s
 * error callback logs a line and returns. Nothing throws, nothing rejects, and
 * the sky simply stays on the plain gradient material - which is also what a
 * perfectly healthy viewer looks like before the load completes. Under jsdom the
 * loader is stubbed, so no headless test can see the difference either.
 *
 * Hence this: a real fetch of the real file, decoded by a real browser, and an
 * assertion that the material actually swapped.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {WebGLRenderer} from 'three';

import {Skybox} from '../../src/scripts/three/skybox.js';
import {describeFrom, hasCompressedTextures, resetFormatSupport} from '../../src/scripts/core/texture_formats.js';

/**
 * The three-side scene surface Skybox wants: add/remove and a dirty flag.
 *
 * Plus a runtime, since RM-005 C1. `Skybox` resolves both of its texture names
 * through `scene.runtime.assets` now, and the ground one is a KTX2 - so without
 * a transcoder path the loader would fetch `basis_transcoder.js` relative to
 * whatever URL the runner happens to serve this file from. Standing in for the
 * real runtime is the honest fake here: the paths are absolute because the dev
 * server roots `public/` at `/`, which is the one thing this fake has to get
 * right for the fetch to be real.
 */
function fakeScene()
{
	const added = [];
	return {
		needsUpdate: false,
		add(object) {added.push(object);},
		remove(object) {added.splice(added.indexOf(object), 1);},
		getScene() {return this;},
		runtime: {assets: {resolve: (name) => ({url: '/' + name}), transcoderPath: () => '/basis/'}},
		added,
	};
}

let skybox;
let renderer;

beforeEach(() =>
{
	// A real renderer, unlike before. `Skybox` asks `core/texture_formats.js`
	// what this GPU can read before it will build a KTX2 loader at all, and
	// describing the answer from the renderer the tier actually draws with is
	// closer to production than letting it probe a throwaway context.
	renderer = new WebGLRenderer({canvas: document.createElement('canvas')});
	describeFrom(renderer);
	skybox = new Skybox(fakeScene(), renderer);
});

afterEach(() =>
{
	skybox.dispose();
	renderer.dispose();
	skybox = null;
	renderer = null;
});

/** Poll until the loader's callback has built the material, or give up. */
async function waitForEnvironment(timeout = 5000)
{
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline)
	{
		if (skybox.skyMat) { return true; }
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return false;
}

describe('the environment map', () =>
{
	it('is a path that actually exists on the server', async () =>
	{
		// Ahead of the load, and separately, because a 404 here and a decode failure
		// downstream produce exactly the same symptom through Skybox.
		const response = await fetch(skybox.defaultEnvironment);
		expect(response.status, `${skybox.defaultEnvironment} did not resolve`).toBe(200);
		expect(response.headers.get('content-type')).toMatch(/^image\/jpeg/);
	});

	it('loads and becomes the sky material', async () =>
	{
		expect(skybox.skyMat).toBeUndefined();
		skybox.toggleEnvironment(true);

		expect(await waitForEnvironment(), 'the environment texture never arrived').toBe(true);
		expect(skybox.sky.material).toBe(skybox.skyMat);
		expect(skybox.ground.visible).toBe(false);
	});

	it('decodes to the image it is supposed to be', async () =>
	{
		// This assertion used to read `2048 x 1024`, and the comment beside it
		// bundled two different claims into one pair of numbers:
		//
		//   1. that P6's re-encode did not resample anything, and
		//   2. that 2:1 is the equirectangular ratio the sky shader's UV
		//      mapping assumes.
		//
		// Only the second is a property of the software. RM-004 B4 resized this
		// map to 1024x512 on purpose - it was 10.67 MB of VRAM, the largest
		// single file in the tree, and the skybox samples it across a dome that
		// never resolves 2048 texels. So claim 1 is now false by design, while
		// claim 2 is exactly as true as it was.
		//
		// Split accordingly: the RATIO is asserted as the invariant, because
		// that is what the shader would actually break on, and the dimensions
		// are pinned separately so a future resize has to come here and say so.
		skybox.toggleEnvironment(true);
		expect(await waitForEnvironment()).toBe(true);

		const image = skybox.skyMat.uniforms.envMap.value.image;
		expect(image).toBeTruthy();
		expect(image.width / image.height, 'equirectangular maps must be 2:1').toBe(2);
		// The B4 cap. Changing it means changing tools/resize-textures.mjs.
		expect(image.width).toBe(1024);
		expect(image.height).toBe(512);
	});
});

/**
 * The ground photograph is a KTX2 now, and this is what proves it decodes.
 *
 * RM-005 C1 transcoded `Ground_4K.jpg` to ETC1S - 5.33 MB of VRAM to 1.33 - and
 * the whole of that change is invisible to the headless tier, which has no
 * WebGL, cannot report a compressed format, and therefore never asks for a
 * transcode at all. jsdom sees `groundMat.map === null` and that is correct
 * behaviour there.
 *
 * So this is the only place the transcode is exercised, and it exists because of
 * what happened in B5: removing `setKTX2Loader` entirely left all 54 browser
 * tests green, because the one model the suite loads has no texture in the
 * library. A format nothing decodes is a format nothing is testing.
 */
describe('the ground photograph, transcoded (RM-005 C1)', () =>
{
	it('is a KTX2 on the server, under the name the library asks for', async () =>
	{
		// Ahead of the decode and separately, for the reason the environment test
		// gives: a 404 and a transcode failure look identical through Skybox.
		const response = await fetch('/rooms/textures/Ground_4K.ktx2');
		expect(response.status, 'the ground texture did not resolve').toBe(200);

		// The container's own magic, so this cannot pass on an HTML error page
		// served with a 200 by a dev server's SPA fallback - which is the trap
		// B4's oracle fell into and had to be moved off `vite preview` for.
		const magic = new Uint8Array(await response.arrayBuffer()).subarray(0, 12);
		expect([...magic]).toEqual([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
	});

	it('reports a compressed format on this device, so the transcode is real', () =>
	{
		// If this ever fails, the assertion below is measuring an RGBA8 fallback
		// rather than a compressed upload - still correct, but not the thing the
		// sprint was for. SwiftShader reports ETC2.
		expect(hasCompressedTextures()).toBe(true);
	});

	/** Poll until the transcoder's callback has delivered, or give up. */
	async function waitForGround(timeout = 15000)
	{
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline && !skybox.groundTex)
		{
			await new Promise((settle) => setTimeout(settle, 50));
		}
		return Boolean(skybox.groundTex);
	}

	it('decodes, and lands on the ground material', async () =>
	{
		expect(await waitForGround(), 'the ground texture never arrived').toBe(true);
		// `isCompressedTexture` rather than a constructor check: this is the flag
		// three's own renderer branches on to choose `compressedTexImage2D`, so it
		// is the property that decides whether the GPU upload is compressed.
		expect(skybox.groundTex.isCompressedTexture, 'decoded to an uncompressed texture').toBe(true);
		expect(skybox.groundTex.mipmaps.length, 'a full mip chain for 1024x1024').toBe(11);
		expect(skybox.groundMat.map).toBe(skybox.groundTex);
		// The sampler state `applyGroundTexture` is responsible for, checked on the
		// object a real transcode produced rather than on a stub.
		// From the profile rather than written out. The shared profile tiles at 18
		// and studio at 40, and hard-coding either measures which profile the test
		// happened to get rather than whether the tiling was applied at all.
		expect(skybox.groundTex.repeat.x).toBe(skybox.renderProfile.groundRepeat);
		expect(skybox.groundTex.colorSpace).toBe('srgb');
	});

	it('draws the ground rather than leaving it flat colour', async () =>
	{
		// Each `it` gets a fresh Skybox from beforeEach, so this waits too. The
		// first draft did not, read `groundMat.map` as null on a skybox two
		// milliseconds old, and reported it as a missing needsUpdate.
		expect(await waitForGround()).toBe(true);
		// The material has to be told to recompile when it gains a map, because
		// USE_MAP is a compile-time define. A missing `needsUpdate` renders the
		// ground in its profile colour with the texture attached and unused, which
		// every assertion above would still pass.
		expect(skybox.groundMat.map).toBeTruthy();
		expect(skybox.groundMat.version, 'the material was never told to recompile').toBeGreaterThan(0);
	});
});

// The record is page-wide and cached, so a suite that describes it from its own
// renderer has to put it back for whatever runs next.
afterEach(() => resetFormatSupport());
