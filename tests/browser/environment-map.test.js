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

import {Skybox} from '../../src/scripts/three/skybox.js';

/** The three-side scene surface Skybox wants: add/remove and a dirty flag. */
function fakeScene()
{
	const added = [];
	return {
		needsUpdate: false,
		add(object) {added.push(object);},
		remove(object) {added.splice(added.indexOf(object), 1);},
		getScene() {return this;},
		added,
	};
}

let skybox;

beforeEach(() =>
{
	skybox = new Skybox(fakeScene(), null);
});

afterEach(() =>
{
	skybox = null;
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
