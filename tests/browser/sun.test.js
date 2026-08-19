/**
 * A shadow that moves with the sun (RM-011 H2, tier 2).
 *
 * H2's acceptance, in its own words: *"a shadow's penumbra visibly changes with
 * the sun's elevation, asserted on pixels rather than on the setting that was
 * assigned."* That last clause is the whole reason this file exists in the
 * browser tier - W-8 was a finding about a setting that was assigned and then
 * silently replaced, so an assertion on `light.position` would prove nothing
 * about what anybody sees.
 *
 * ## Why elevation and not time
 *
 * The sun's elevation is what a penumbra length is a function of: a low sun
 * throws a long shadow and a high one throws a short one, and the shadow map
 * samples a different part of the scene in each case. Hour, day and latitude all
 * reach the picture *through* elevation, so driving it directly is one assertion
 * rather than three that all mean the same thing. `tests/sun.test.js` is where
 * the three inputs are checked against closed forms.
 *
 * ## And why classic is asserted too
 *
 * H2's third acceptance clause: *"every light this sprint adds is off, or free,
 * under classic."* The sun is off there - `classic`'s key is the `#330000` wash
 * that contributes essentially no shadow contrast, and moving it would change a
 * frozen picture for no visible gain. Asserted rather than assumed, in the same
 * shape H1 used for its maps.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';

/**
 * A room with a wall down the middle, which is what casts a shadow worth
 * measuring: an empty box shades its own walls and very little of its floor.
 */
const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 260}, c2: {x: 700, y: 0, elevation: 260},
			c3: {x: 700, y: 700, elevation: 260}, c4: {x: 0, y: 700, elevation: 260},
			m1: {x: 350, y: 200, elevation: 260}, m2: {x: 350, y: 500, elevation: 260},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
			{corner1: 'm1', corner2: 'm2'},
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

function frame()
{
	const gl = bp.three.renderer.getContext();
	const width = gl.drawingBufferWidth;
	const height = gl.drawingBufferHeight;
	const pixels = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return pixels;
}

function differing(a, b)
{
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
	{
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) { count += 1; }
	}
	return count;
}

/** Set the sun and render. Hours are what a person picks; elevation follows. */
async function atHour(hour)
{
	bp.model.setSun({hour});
	bp.three.syncSun();
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

describe('the key light follows the sun (W-10)', () =>
{
	it('does nothing at all until a design has a sun', async () =>
	{
		// Additive, and the same promise the save key makes: a design with no sun
		// renders exactly as it did before H2. Proved by putting a sun on and
		// taking it off again rather than by reading a field.
		boot(RENDER_STUDIO);
		await settled();
		const before = frame();
		const parked = bp.three.lights.getDirLight().position.clone();

		bp.model.setSun({hour: 7});
		bp.three.syncSun();
		await settled();
		expect(bp.three.lights.getDirLight().position.equals(parked)).toBe(false);

		bp.model.setSun(null);
		bp.three.syncSun();
		await settled();
		expect(bp.three.lights.getDirLight().position.equals(parked)).toBe(true);
		expect(differing(before, frame())).toBe(0);
	});

	it('puts a morning sun east of a noon sun, in world space', async () =>
	{
		boot(RENDER_STUDIO);
		bp.model.north = 0;
		await settled();

		bp.model.setSun({hour: 9});
		bp.three.syncSun();
		const morning = bp.three.lights.getDirLight().position.clone();
		bp.model.setSun({hour: 12});
		bp.three.syncSun();
		const noon = bp.three.lights.getDirLight().position.clone();

		// North is -z, so east is +x and the morning sun is east of due south.
		expect(morning.x).toBeGreaterThan(noon.x);
		// And lower: 9am at the equinox is 30 degrees up, noon is 45.
		expect(morning.y).toBeLessThan(noon.y);
	});

	it('turns with the building', async () =>
	{
		boot(RENDER_STUDIO);
		bp.model.setSun({hour: 9});
		bp.model.north = 0;
		bp.three.syncSun();
		const facingNorth = bp.three.lights.getDirLight().position.clone();

		bp.model.north = 180;
		bp.three.syncSun();
		const turned = bp.three.lights.getDirLight().position.clone();

		// Half a turn of the building puts the same 9am sun on the opposite side -
		// of the *plan's centre*, which is where the key is aimed and is not the
		// origin. Measuring from the origin instead is off by twice the centre,
		// which is how this assertion first failed.
		const centre = bp.three.lights.getDirLight().target.position;
		expect(turned.x - centre.x).toBeCloseTo(-(facingNorth.x - centre.x), 3);
		expect(turned.z - centre.z).toBeCloseTo(-(facingNorth.z - centre.z), 3);
		expect(turned.y).toBeCloseTo(facingNorth.y, 6);
	});

	it('switches the key off below the horizon rather than lighting from underground', async () =>
	{
		boot(RENDER_STUDIO);
		const light = bp.three.lights.getDirLight();
		bp.model.setSun({hour: 12});
		bp.three.syncSun();
		expect(light.intensity).toBeGreaterThan(0);
		expect(light.position.y).toBeGreaterThan(0);

		bp.model.setSun({hour: 0});
		bp.three.syncSun();
		// Held at the horizon, not buried: a key under the floor lights the ceiling
		// through it, which is not night.
		expect(light.intensity).toBe(0);
		expect(light.position.y).toBe(0);

		// And it comes back, which is the bug a branch-local assignment would have.
		bp.model.setSun({hour: 12});
		bp.three.syncSun();
		expect(light.intensity).toBeGreaterThan(0);
	});
});

describe('M-28 acceptance - the penumbra moves with the elevation', () =>
{
	it('draws a different picture at every hour of the morning', async () =>
	{
		boot(RENDER_STUDIO);
		await settled();

		const noon = await atHour(12);
		const nine = await atHour(9);
		const seven = await atHour(7);

		// Each step away from noon lowers the sun, lengthens what the middle wall
		// throws, and moves more of the frame. Monotonic, so a frame that merely
		// flickered would not pass.
		const movedAtNine = differing(noon, nine);
		const movedAtSeven = differing(noon, seven);
		expect(movedAtNine).toBeGreaterThan(1000);
		expect(movedAtSeven).toBeGreaterThan(movedAtNine);
	});

	it('costs nothing until a design has a sun, and nothing under classic', async () =>
	{
		// The third acceptance clause. `classic` keeps its overhead `#330000` key
		// wherever the sun is, so the frame is identical with and without one -
		// which is what "off, or free, under classic" has to mean if the parity
		// grid is to stay meaningful.
		boot(RENDER_CLASSIC);
		await settled();
		const before = frame();

		bp.model.setSun({hour: 7});
		bp.three.syncSun();
		await settled();

		expect(differing(before, frame())).toBe(0);
	});
});
