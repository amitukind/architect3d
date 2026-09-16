/**
 * The filter that runs is the filter that was asked for (RM-011 W-8, H2, tier 2).
 *
 * ## The defect, and the half of it that was wrong
 *
 * `three/main.js` asked the renderer for `PCFSoftShadowMap` from the fork until
 * H2. three deprecated that constant, and `WebGLShadowMap.render` does not
 * ignore it politely: it warns on the first frame and **assigns `PCFShadowMap`
 * over the top of it**. So the property read back as `1` while the source said
 * `2`, on every boot, for as long as this project has been on a modern three.
 *
 * W-8 recorded that and then drew a second conclusion which this file measures
 * and refutes: *"The Studio profile's `shadowRadius: 2.4` is inert with that
 * filter, so the one number in the profile table that exists to soften a shadow
 * does nothing."* It is not inert. three rewrote PCF into a **five-tap Vogel
 * disk scaled by `shadow.radius`**, and that rewrite is precisely why the soft
 * variant was deprecated - the ordinary filter now does what the separate one
 * existed to do. The sweep below is the evidence.
 *
 * ## Why the repair is asserted as a zero-pixel change
 *
 * Because that is the claim, and it is the claim that makes it safe: the renderer
 * has been running `PCFShadowMap` all along, so naming it changes nothing a user
 * sees and nothing a golden capture holds. `rendersIdentically` proves it inside
 * one process rather than asking a reader to trust a diff.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {PCFShadowMap, PCFSoftShadowMap} from 'three';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';

/**
 * A five-metre room with a tall wall, which is what makes a shadow to look at.
 *
 * The key light is off vertical under studio (`keyOffset: 0.75`), so a wall
 * throws across the floor rather than straight down out of sight.
 */
const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: 500, y: 0, elevation: 250},
			c3: {x: 500, y: 500, elevation: 250}, c4: {x: 0, y: 500, elevation: 250},
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

function boot(profile)
{
	setRenderProfile(profile);
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

async function settled()
{
	bp.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	bp.three.render(true);
}

/** The rendered frame, straight off the drawing buffer. */
function frame()
{
	const gl = bp.three.renderer.getContext();
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** How many pixels of two frames disagree, on any colour channel. */
function differing(a, b)
{
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
	{
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { count += 1; }
	}
	return count;
}

/** Re-render with a different shadow radius and report what moved. */
async function atRadius(radius)
{
	bp.three.lights.dirLight.shadow.radius = radius;
	bp.three.renderer.shadowMap.needsUpdate = true;
	await settled();
	return frame();
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('W-8 repaired - the renderer keeps the filter it was given', () =>
{
	it('reads back as the filter the source names, under both profiles', async () =>
	{
		for (const profile of [RENDER_STUDIO, RENDER_CLASSIC])
		{
			boot(profile);
			const renderer = bp.three.renderer;
			expect(renderer.shadowMap.type).toBe(PCFShadowMap);
			await settled();
			// After a render is the reading that mattered: this is where three
			// used to overwrite the assignment.
			expect(renderer.shadowMap.type).toBe(PCFShadowMap);
			expect(renderer.shadowMap.enabled).toBe(true);
			bp.dispose();
			host.remove();
			bp = null;
			host = null;
		}
	});

	it('boots without three warning about a deprecated filter', async () =>
	{
		// The user-visible half of the defect. A warning on every boot trains
		// people to ignore the console, which is where the next real one lands.
		const warnings = [];
		const original = console.warn;
		console.warn = (...args) => {warnings.push(args.map(String).join(' '));};
		try
		{
			boot(RENDER_STUDIO);
			await settled();
		}
		finally
		{
			console.warn = original;
		}

		const deprecated = warnings.filter((line) => line.includes('ShadowMap') && line.includes('deprecated'));
		expect(deprecated, `three still warns:\n  ${deprecated.join('\n  ')}`).toEqual([]);
	});

	it('renders identically to what the deprecated constant produced', async () =>
	{
		// The claim that makes this repair safe against the frozen r98 goldens:
		// the renderer was already running PCFShadowMap, so naming it moves no
		// pixels. Proved by asking for the deprecated constant and letting three
		// do its substitution, rather than by trusting that it does.
		boot(RENDER_STUDIO);
		await settled();
		const repaired = frame();

		bp.three.renderer.shadowMap.type = PCFSoftShadowMap;
		bp.three.renderer.shadowMap.needsUpdate = true;
		const original = console.warn;
		console.warn = () => {};
		try { await settled(); }
		finally { console.warn = original; }

		expect(bp.three.renderer.shadowMap.type).toBe(PCFShadowMap);
		expect(differing(repaired, frame())).toBe(0);
	});
});

describe('W-8 corrected - the profile\'s softness knob is not inert', () =>
{
	it('changes the picture, and more of it the wider the blur', async () =>
	{
		// The measurement that refutes W-8's second sentence. `shadowRadius`
		// scales a five-tap Vogel disk in the PCF shader, so a wider radius
		// spreads a penumbra over more texels - monotonically, which is what
		// separates "the number reaches the shader" from "the frame is noisy".
		boot(RENDER_STUDIO);
		await settled();
		const atProfileDefault = frame();
		expect(bp.three.lights.dirLight.shadow.radius).toBe(2.4);

		const moved = [];
		for (const radius of [1, 6, 12])
		{
			moved.push(differing(atProfileDefault, await atRadius(radius)));
		}

		// Narrower than the profile moves fewest pixels, wider moves more, and
		// each step wider moves more again.
		expect(moved[0]).toBeGreaterThan(0);
		expect(moved[1]).toBeGreaterThan(moved[0]);
		expect(moved[2]).toBeGreaterThan(moved[1]);
	});

	it('is the same number the profile asked for, not a default', async () =>
	{
		// Both profiles, because the two disagree on purpose - 2.4 texels over a
		// 2048 map under studio, 1 over 1024 under classic - and a repair that
		// quietly unified them would be a parity change.
		boot(RENDER_STUDIO);
		expect(bp.three.lights.dirLight.shadow.radius).toBe(2.4);
		expect(bp.three.lights.dirLight.shadow.mapSize.width).toBe(2048);
		bp.dispose();
		host.remove();

		boot(RENDER_CLASSIC);
		expect(bp.three.lights.dirLight.shadow.radius).toBe(1);
		expect(bp.three.lights.dirLight.shadow.mapSize.width).toBe(1024);
	});
});
