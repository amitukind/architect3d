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
		// A JPEG that decodes to the wrong dimensions means the re-encode resampled
		// something it should not have. 2048x1024 is the equirectangular ratio the
		// sky shader's UV mapping assumes.
		skybox.toggleEnvironment(true);
		expect(await waitForEnvironment()).toBe(true);

		const image = skybox.skyMat.uniforms.envMap.value.image;
		expect(image).toBeTruthy();
		expect(image.width).toBe(2048);
		expect(image.height).toBe(1024);
	});
});
