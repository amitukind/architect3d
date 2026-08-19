/**
 * Walking somewhere, and looking round from there (RM-011 H3, tier 2).
 *
 * The physics and the teleport are pinned headlessly in `tests/walkthrough.js`
 * against a real scene graph and a fake renderer, which is where they belong -
 * an Euler integrator does not need a rasteriser to be checked. What needs one
 * is the claim the two halves of this sprint make *together*: that the point the
 * walker is standing at is the point the panorama is taken from.
 *
 * So this measures it. One wall is tinted, the walker stands in the middle of
 * the room and then next to that wall, and the number of pixels of the panorama
 * that wall fills has to go up. Nothing here reads a position back out of an
 * object; the assertion is on the picture.
 *
 * Pointer lock is deliberately never requested. `switchFPSMode(true)` asks for
 * it, a headless browser with no user gesture refuses, and this tier promotes a
 * window error into a failed run - so the walkthrough is exercised through the
 * rig and the camera rather than through the button.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC} from '../../src/scripts/core/render_profile.js';
import {EYE_HEIGHT} from '../../src/scripts/three/pointerlockcontrols.js';
import {capturePanorama, capturePanoramaFaces} from '../../src/scripts/three/panorama.js';

const SIDE = 400;
const TINT = '#ff0000';

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: SIDE, y: 0, elevation: 250},
			c3: {x: SIDE, y: SIDE, elevation: 250}, c4: {x: 0, y: SIDE, elevation: 250},
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

/** Wait for the wall textures, then tint the wall at z = 0. */
async function settled()
{
	for (let tick = 0; tick < 120; tick++)
	{
		bp.three.render(true);
		const probe = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(),
			{x: SIDE / 2, y: 160, z: SIDE / 2}, {size: 8});
		const centre = (((4 * 8) + 4) * 4);
		if (Math.max(...probe.faces[5].slice(centre, centre + 3)) > 24)
		{
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('the wall textures never loaded');
}

function paintOneWall()
{
	const room = bp.model.floorplan.getRooms()[0];
	room.eachWallSide((edge) =>
	{
		// The wall along y = 0 in the plan, which is z = 0 in the world.
		if (edge.interiorStart().y < 10 && edge.interiorEnd().y < 10)
		{
			edge.setMaterial({color: TINT});
		}
	});
	bp.model.floorplan.update();
}

/** How much of a panorama is that wall. */
function share(panorama)
{
	let counted = 0;
	for (let at = 0; at < panorama.pixels.length; at += 4)
	{
		const r = panorama.pixels[at];
		const g = panorama.pixels[at + 1];
		const b = panorama.pixels[at + 2];
		if (r > 24 && r > g * 1.5 && r > b * 1.5)
		{
			counted++;
		}
	}
	return counted / (panorama.pixels.length / 4);
}

function panoramaHere()
{
	const eye = bp.three.walkPosition();
	return capturePanorama(bp.three.renderer, bp.three.scene.getScene(), eye, {width: 256});
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('the panorama is taken from where the walker is standing', () =>
{
	it('fills more of the picture with a wall once the walker is next to it', async () =>
	{
		boot();
		await settled();
		paintOneWall();
		await settled();

		bp.three.fpscontrols.teleport(SIDE / 2, SIDE / 2);
		const middle = share(panoramaHere());

		bp.three.fpscontrols.teleport(SIDE / 2, 40);
		const close = share(panoramaHere());

		expect(middle).toBeGreaterThan(0.01);
		expect(close).toBeGreaterThan(middle * 1.5);
	});

	it('follows a teleport onto a floor picked out of the view', async () =>
	{
		boot();
		await settled();
		paintOneWall();
		await settled();

		const walker = bp.three.fpscontrols.getObject();
		walker.position.set(SIDE / 2, 160, SIDE / 2);
		const middle = share(panoramaHere());

		// Aim down and toward the tinted wall, and click where that lands.
		walker.rotation.set(-Math.PI / 3, 0, 0, 'YXZ');
		const landed = bp.three.teleportToView();
		expect(landed).not.toBeNull();
		expect(landed.z).toBeLessThan(SIDE / 2);

		expect(share(panoramaHere())).toBeGreaterThan(middle);
	});
});

describe('eye height, against a real frame', () =>
{
	it('stands the walker at 160 above the floor by default', async () =>
	{
		boot();
		await settled();
		expect(EYE_HEIGHT.default).toBe(160);
		bp.three.fpscontrols.teleport(SIDE / 2, SIDE / 2);
		expect(bp.three.walkPosition().y).toBe(160);
	});

	it('changes the picture when the person changes height', async () =>
	{
		boot();
		await settled();
		paintOneWall();
		await settled();

		bp.three.fpscontrols.teleport(SIDE / 2, 40);
		const low = panoramaHere();
		bp.three.setEyeHeight(EYE_HEIGHT.max);
		const high = panoramaHere();

		expect(bp.three.walkPosition().y).toBe(EYE_HEIGHT.max);
		let differing = 0;
		for (let at = 0; at < low.pixels.length; at += 4)
		{
			if (low.pixels[at] !== high.pixels[at]) { differing++; }
		}
		// A 60 cm change of eye level in a 250 cm room is not a subtle one.
		expect(differing / (low.pixels.length / 4)).toBeGreaterThan(0.05);
	});
});
