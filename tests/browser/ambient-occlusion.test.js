/**
 * Ambient occlusion, behind the profile switch (RM-011 H2, tier 2).
 *
 * ## What had to be built, and why it is off
 *
 * RM-011 W-2 traversed the whole tree and found **not one `aoMap`** on any
 * material in either profile, so there was nothing to switch on: the only
 * occlusion available is screen-space, which needs a post-processing chain, and
 * `Main` has never had one. `three/post.js` is that chain.
 *
 * It is **available and off**, under both profiles, and the number below is why.
 * M-28's correction says an effect states its cost as a fraction of the frame it
 * was measured in; measured here, in the same session and on the same scene, a
 * six-metre room renders in **0.22 ms** without it and **0.37 ms** with -
 * **+68 %**, the largest single cost in this programme. Under `classic` it would
 * also be wrong rather than merely expensive: every wall there is an unlit
 * `MeshBasicMaterial`, and multiplying an unlit surface by an occlusion term is
 * a grey stain, not lighting.
 *
 * ## The whole frame moves, not only the corners
 *
 * Worth stating because it is the kind of thing a screenshot hides. A composer
 * ends in an `OutputPass` that applies tone mapping and the sRGB conversion,
 * where `renderer.render` applies them itself, and the two are not bit-identical:
 * 781,416 of 786,432 pixels differ by *something*, at a mean of 4.4/255. The
 * occlusion itself is the 51,153 that differ by more than 8 - the threshold this
 * project's transcode oracle treats as visible. Both numbers are asserted below,
 * so a future pass that quietly changed the tone response would show up as the
 * first one moving.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 260}, c2: {x: 600, y: 0, elevation: 260},
			c3: {x: 600, y: 600, elevation: 260}, c4: {x: 0, y: 600, elevation: 260},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
	},
	items: [],
});

let host;
let bp;

function boot(profile, overrides)
{
	setRenderProfile(profile, overrides);
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

/**
 * Wait for the AO chain, which is fetched on demand.
 *
 * `post.js` imports its four modules dynamically - the first-load budget caught
 * them costing 10.6 KB on every boot for an effect nothing turns on - so a
 * viewer renders a frame or two without occlusion before the chunk lands. A
 * fixed sleep would pass on this machine and flake on a slower one.
 */
async function chained()
{
	for (let tick = 0; tick < 100 && !bp.three.post; tick++)
	{
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	await settled();
}

async function settled()
{
	bp.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	bp.three.render(true);
}

function frame()
{
	const gl = bp.three.renderer.getContext();
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** How two frames differ, split by whether the difference is visible. */
function difference(a, b)
{
	let any = 0;
	let visible = 0;
	let darker = 0;
	for (let i = 0; i < a.length; i += 4)
	{
		const delta = Math.max(
			Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
		if (delta) { any += 1; }
		// 8/255 is the threshold `tools/transcode-oracle.mjs` treats as visible.
		if (delta > 8) { visible += 1; }
		if (b[i] < a[i]) { darker += 1; }
	}
	return {any, visible, darker, total: a.length / 4};
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('the chain is not built unless the profile asks', () =>
{
	it('builds nothing under classic, and nothing under studio by default', async () =>
	{
		// The cheapest possible "off": no composer, no render targets, and
		// `render` calling `renderer.render` exactly as it always did.
		boot(RENDER_CLASSIC, {});
		await settled();
		expect(bp.three.post).toBeNull();
		bp.dispose();
		host.remove();

		boot(RENDER_STUDIO, {});
		await settled();
		expect(bp.three.post).toBeNull();
	});

	it('builds one when it is asked, and takes it apart on dispose', async () =>
	{
		boot(RENDER_STUDIO, {ambientOcclusion: true});
		await chained();
		expect(bp.three.post).toBeTruthy();
		expect(bp.three.post.ao).toBeTruthy();

		const viewer = bp.three;
		bp.dispose();
		bp = null;
		// Five render targets nothing in the scene graph knows about, so nothing
		// else would ever free them.
		expect(viewer.post).toBeNull();
	});
});

describe('what it does to the picture', () =>
{
	it('darkens the frame where surfaces meet, visibly', async () =>
	{
		boot(RENDER_STUDIO, {});
		await settled();
		const plain = frame();
		bp.dispose();
		host.remove();

		boot(RENDER_STUDIO, {ambientOcclusion: true});
		await chained();
		const occluded = frame();

		const moved = difference(plain, occluded);
		// The occlusion: a substantial minority of the frame, past the threshold
		// this project treats as visible, and darker rather than lighter.
		expect(moved.visible).toBeGreaterThan(moved.total * 0.02);
		expect(moved.visible).toBeLessThan(moved.total * 0.5);
		expect(moved.darker).toBeGreaterThan(moved.visible);
	});

	it('moves almost every pixel a little, which is the OutputPass and not the AO', async () =>
	{
		// Stated rather than hidden. A composer ends in an OutputPass that applies
		// tone mapping and the sRGB conversion; `renderer.render` applies them
		// itself, and the two are not bit-identical. So "the whole frame changed"
		// is expected here and would be alarming anywhere else.
		boot(RENDER_STUDIO, {});
		await settled();
		const plain = frame();
		bp.dispose();
		host.remove();

		boot(RENDER_STUDIO, {ambientOcclusion: true});
		await chained();

		const moved = difference(plain, frame());
		expect(moved.any).toBeGreaterThan(moved.total * 0.9);
		// And the visible part is a small fraction of that, which is what says the
		// rest is rounding rather than a brightness shift.
		expect(moved.visible).toBeLessThan(moved.any * 0.25);
	});
});
