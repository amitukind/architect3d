/**
 * The 3D view, composited by a real WebGL context (RM-002 P5, tier 2).
 *
 * The headless suites drive `Main` through `Main.setRendererFactory`, a stub
 * that records calls and never touches a GPU. That is the right shape for
 * lifecycle and disposal tests and it is what makes them fast, but it means the
 * studio render profile - PBR walls, an image-based environment, ACES tone
 * mapping, fog - has never actually drawn anything in a test. A profile that
 * composited pure black would pass every one of them.
 *
 * ## A readback, not a screenshot
 *
 * `renderer.readRenderTargetPixels` / `gl.readPixels` gives the framebuffer's
 * bytes, and the assertions are about properties of those bytes: is the frame
 * non-uniform, does it change when the camera moves, is it not the clear colour
 * everywhere. Those hold whatever the rasteriser is. A screenshot diff would
 * not: headless chromium renders through SwiftShader here and through a real
 * driver on a developer's machine, so the same scene produces different bytes
 * and a committed reference would be wrong somewhere.
 *
 * ## What SwiftShader means for these
 *
 * WebGL is available in headless chromium through SwiftShader, a CPU
 * rasteriser - see the launch flags in vitest.browser.config.mjs. It is slow
 * and its antialiasing differs from a GPU's, which is exactly why nothing here
 * asserts on an exact colour. What it does faithfully is composite: geometry
 * that should be on screen appears, and geometry that should not, does not.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

/** A four-metre room, as a saved design the viewer can open. */
const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			c1: {x: 0, y: 0, elevation: 0},
			c2: {x: 400, y: 0, elevation: 0},
			c3: {x: 400, y: 400, elevation: 0},
			c4: {x: 0, y: 400, elevation: 0},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2', frontTexture: null, backTexture: null},
			{corner1: 'c2', corner2: 'c3', frontTexture: null, backTexture: null},
			{corner1: 'c3', corner2: 'c4', frontTexture: null, backTexture: null},
			{corner1: 'c4', corner2: 'c1', frontTexture: null, backTexture: null},
		],
		rooms: {},
		units: 'cm',
		version: '2.0.0',
	},
	items: [],
});

let host;
let blueprint;

function buildHost()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>' +
		'<div id="viewer" style="width:640px;height:480px"></div>';
	document.body.appendChild(host);
}

function boot()
{
	blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('#floorplanner-canvas'),
		threeElement: host.querySelector('#viewer'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	blueprint.model.scene.setItemLoader(() => {});
	blueprint.model.loadSerialized(DESIGN);
	return blueprint;
}

/**
 * Render, then wait for the textures to arrive, then render again.
 *
 * three logs "Texture marked for update but no image data found" for every
 * surface whose image has not landed yet, and a run prints a hundred or so of
 * them. Both plausible causes were checked and neither is the reason:
 *
 *   - not a 404. Vite serves `public/` at the server root and the library's
 *     relative URLs resolve there; fetching one directly from the page returns
 *     200 image/png.
 *   - not the cache failing to fill handles. A handle acquired before the load
 *     and one acquired after both end up with an image and a shared source.
 *
 * It is `Edge.updateTexture` setting `needsUpdate` synchronously, right after
 * acquiring - before the decode it just started could possibly have finished.
 * The line is redundant, because the cache marks live handles when the image
 * lands, but removing it is a change to the render path for the sake of log
 * noise, and the parity grid is calibrated against that path. Left alone.
 *
 * A test that reads the framebuffer before then is measuring an untextured
 * scene. It would still pass every assertion here, because these are about
 * composition rather than colour - but it would not be exercising the texture
 * path at all, which is most of what the 3D view does and all of what RM-002
 * R-04 rebuilt.
 */
async function renderSettled()
{
	blueprint.three.render(true);
	// Two frames plus a beat: enough for the decodes queued by the first render
	// to land and be uploaded on the second.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	blueprint.three.render(true);
}

/** The rendered frame, straight off the drawing buffer. */
function readFrame()
{
	const renderer = blueprint.three.renderer;
	const gl = renderer.getContext();
	const w = gl.drawingBufferWidth;
	const h = gl.drawingBufferHeight;
	const pixels = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return {pixels, width: w, height: h};
}

/** Distinct RGB values in a frame, and how much of it the commonest covers. */
function frameStats(frame)
{
	const counts = new Map();
	for (let i = 0; i < frame.pixels.length; i += 4)
	{
		const key = `${frame.pixels[i]},${frame.pixels[i + 1]},${frame.pixels[i + 2]}`;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	const sorted = [...counts.values()].sort((a, b) => b - a);
	const total = frame.pixels.length / 4;
	return {distinct: counts.size, dominantShare: sorted[0] / total};
}

beforeEach(() =>
{
	buildHost();
});

afterEach(() =>
{
	if (blueprint)
	{
		blueprint.dispose();
		blueprint = null;
	}
	host.remove();
});

describe('the 3D view composites a real frame', () =>
{
	it('has a WebGL2 context at all', () =>
	{
		// If this fails, the launch flags in vitest.browser.config.mjs stopped
		// giving headless chromium a rasteriser - and every assertion below would
		// otherwise be vacuously true rather than failing.
		boot();
		const gl = blueprint.three.renderer.getContext();
		expect(gl).toBeTruthy();
		expect(gl.drawingBufferWidth).toBeGreaterThan(0);
		expect(gl.getParameter(gl.VERSION)).toMatch(/WebGL/i);
	});

	it('draws something other than a flat clear colour', async () =>
	{
		boot();
		await renderSettled();

		const stats = frameStats(readFrame());
		// A scene that failed to composite is one colour edge to edge. A room with
		// four walls, a floor, a sky and a shadow is not.
		expect(stats.distinct).toBeGreaterThan(20);
		expect(stats.dominantShare).toBeLessThan(0.98);
	});

	it('the studio profile composites, not just the classic one', async () =>
	{
		// The profile the application actually ships, and the one no test had ever
		// rendered. Lit PBR walls under an environment map are exactly the setup
		// that can come out black while every unit test passes.
		boot();
		blueprint.three.applyRenderProfile(RENDER_STUDIO);
		await renderSettled();

		const stats = frameStats(readFrame());
		expect(stats.distinct).toBeGreaterThan(20);
		expect(stats.dominantShare).toBeLessThan(0.98);
	});

	it('the two profiles do not produce the same frame', async () =>
	{
		boot();

		blueprint.three.applyRenderProfile(RENDER_CLASSIC);
		await renderSettled();
		const classic = readFrame();

		blueprint.three.applyRenderProfile(RENDER_STUDIO);
		await renderSettled();
		const studio = readFrame();

		let differing = 0;
		for (let i = 0; i < classic.pixels.length; i += 4)
		{
			if (classic.pixels[i] !== studio.pixels[i]
				|| classic.pixels[i + 1] !== studio.pixels[i + 1]
				|| classic.pixels[i + 2] !== studio.pixels[i + 2])
			{
				differing += 1;
			}
		}
		// Tone mapping, fog and a different light budget cannot leave a scene
		// pixel-identical. If they do, applyRenderProfile stopped reaching the
		// renderer - which is a silent failure the unit tests cannot see, because
		// they assert on the profile object rather than on the picture.
		const share = differing / (classic.pixels.length / 4);
		expect(share).toBeGreaterThan(0.05);
	});

	it('moving the camera changes the picture', async () =>
	{
		boot();
		await renderSettled();
		const before = readFrame();

		blueprint.three.controls.object.position.set(600, 600, 600);
		blueprint.three.controls.update();
		blueprint.three.render(true);
		const after = readFrame();

		let differing = 0;
		for (let i = 0; i < before.pixels.length; i += 4)
		{
			if (before.pixels[i] !== after.pixels[i])
			{
				differing += 1;
			}
		}
		expect(differing).toBeGreaterThan(0);
	});

	it('tears down without losing the context first', async () =>
	{
		boot();
		await renderSettled();
		const canvas = blueprint.three.renderer.domElement;

		blueprint.dispose();
		blueprint = null;

		// dispose() calls forceContextLoss, so the canvas should no longer be in
		// the page and the context should be gone. This is the browser-side check
		// on what viewer-lifecycle.test.js asserts against a stub.
		expect(canvas.parentNode).toBeNull();
	});
});
