/**
 * A photograph of the 3D view (RM-011 H2, W-11, tier 2).
 *
 * `Main.dataUrl()` has existed since the fork and **nothing called it**. W-11
 * measured what it produced on a boot: the canvas at 1024 × 768 at device pixel
 * ratio 1, 391,170 characters, about 287 KiB — a screenshot of a viewport rather
 * than a picture of a design. H2's bullet is *"a photo capture through the seam
 * that exists"*, so the seam kept its name and gained the render target it always
 * needed.
 *
 * ## Supersampling is a pixel ratio, not a second canvas
 *
 * Raising the pixel ratio enlarges the drawing buffer and leaves the CSS size
 * alone, which is exactly what a device pixel ratio *is* — so the camera's
 * aspect, the picking, the layout and the controls stay correct and nothing has
 * to be told a picture is being taken. What these tests hold is that the viewer
 * is put back afterwards, including when the read throws.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC} from '../../src/scripts/core/render_profile.js';

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: 400, y: 0, elevation: 250},
			c3: {x: 400, y: 400, elevation: 250}, c4: {x: 0, y: 400, elevation: 250},
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

function boot()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>'
		+ '<div id="viewer" style="width:512px;height:384px"></div>';
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
	bp.three.render(true);
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('the capture', () =>
{
	it('returns a PNG data URL at the displayed size by default', () =>
	{
		boot();
		const url = bp.three.dataUrl();
		expect(url.startsWith('data:image/png;base64,')).toBe(true);
		// 1 is the old behaviour exactly, which is what makes the parameter safe
		// to add to a published method.
		expect(bp.three.renderer.domElement.width).toBe(512 * bp.three.renderer.getPixelRatio());
	});

	it('produces a bigger image when asked, and a bigger file with it', () =>
	{
		boot();
		const plain = bp.three.dataUrl(1);
		const large = bp.three.dataUrl(3);
		expect(large.length).toBeGreaterThan(plain.length);
	});

	it('puts the viewer back at the size it was', () =>
	{
		boot();
		const before = bp.three.renderer.getPixelRatio();
		const width = bp.three.renderer.domElement.width;

		bp.three.dataUrl(4);

		expect(bp.three.renderer.getPixelRatio()).toBe(before);
		expect(bp.three.renderer.domElement.width).toBe(width);
	});

	it('puts it back even when the read throws', () =>
	{
		// The reason the restore is in a `finally`. A tainted canvas throws on
		// `toDataURL`, and without this the viewer would render at four times its
		// size for the rest of the session - a bug that looks like a performance
		// problem and is a screenshot.
		boot();
		const before = bp.three.renderer.getPixelRatio();
		const canvas = bp.three.renderer.domElement;
		const original = canvas.toDataURL;
		canvas.toDataURL = () => {throw new Error('tainted');};

		expect(() => bp.three.dataUrl(2)).toThrow('tainted');
		expect(bp.three.renderer.getPixelRatio()).toBe(before);

		canvas.toDataURL = original;
	});

	it('never asks the GPU for a buffer it will refuse', () =>
	{
		// Exceeding MAX_TEXTURE_SIZE does not throw; it produces a buffer the
		// driver silently declines to allocate, which is a black image. The clamp
		// is measured against the renderer's own reported ceiling.
		boot();
		const limit = bp.three.renderer.capabilities.maxTextureSize;
		bp.three.dataUrl(4);
		expect(bp.three.renderer.domElement.width).toBeLessThanOrEqual(limit);
		expect(bp.three.renderer.domElement.height).toBeLessThanOrEqual(limit);
	});
});
