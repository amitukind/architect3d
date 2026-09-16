/**
 * A 360 degree panorama of a room (RM-011 H3, W-11, tier 2).
 *
 * H3's first acceptance clause, and it is worded as a method rather than as a
 * result: *"a panorama captured from a point inside a room contains every wall
 * of that room, asserted by sampling the six faces rather than by looking at
 * it"*. So that is what happens below. Each of the four walls is tinted a colour
 * of its own through H1's surface material, the eye is put in the middle of the
 * room, and each wall is then looked for **in the direction it is actually in** -
 * `faceSample` says which of the six faces that direction lands on and where,
 * and the pixel there has to be that wall's colour.
 *
 * That is a stronger check than "the picture is not blank" in the way that
 * matters here: a panorama that is upside down, mirrored, or a quarter turn out
 * would pass a blankness test and fails every assertion in this file, because
 * every one of them ties a compass direction to a pixel.
 *
 * The projection is checked against the faces it was built from, which is the
 * end-to-end statement: what the capture put on face N in position (s, t) is
 * what the equirectangular image shows at the pixel that looks that way.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC} from '../../src/scripts/core/render_profile.js';
import {CUBE_FACES, faceSample, pixelFor, projectEquirectangular} from '../../src/scripts/core/equirect.js';
import {capturePanoramaFaces, capturePanorama} from '../../src/scripts/three/panorama.js';

const SIDE = 400;
const EYE = {x: SIDE / 2, y: 160, z: SIDE / 2};
const FACE = 128;

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

/**
 * Four tints no two of which share a channel pattern, so a pixel names its
 * wall without any tolerance on the value - only on which channels are lit.
 */
const TINTS = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff'];

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

/**
 * Tint each interior wall side, and say where each one is from the eye.
 *
 * @returns {Array<{tint: string, direction: {x: number, y: number, z: number}}>}
 */
function paintWalls()
{
	const room = bp.model.floorplan.getRooms()[0];
	const walls = [];
	room.eachWallSide((edge) =>
	{
		const tint = TINTS[walls.length % TINTS.length];
		edge.setMaterial({color: tint});
		const start = edge.interiorStart();
		const end = edge.interiorEnd();
		// Plan (x, y) is world (x, z). The eye looks level at the middle of the
		// wall, so the direction has no vertical component at all.
		walls.push({
			tint,
			direction: {
				x: ((start.x + end.x) / 2) - EYE.x,
				y: 0,
				z: ((start.y + end.y) / 2) - EYE.z,
			},
		});
	});
	bp.model.floorplan.update();
	bp.three.render(true);
	return walls;
}

/**
 * Wait until the wall textures have actually arrived.
 *
 * Measured while writing this: without it the walls come out **black**, and not
 * because the capture is wrong. A classic wall is an unlit `MeshBasicMaterial`
 * with `map` set, and a `Texture` whose image has not loaded samples as zero -
 * so the tint gets multiplied by nothing. three says so on the console
 * ("Texture marked for update but no image data found") and renders it anyway.
 *
 * Polled on the thing being waited for rather than on a fixed delay: six 8-pixel
 * faces is a cheap question to ask repeatedly, and a sleep long enough for a
 * slow machine is a sleep wasted on every fast one.
 */
async function settled()
{
	for (let tick = 0; tick < 120; tick++)
	{
		bp.three.render(true);
		const probe = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(), EYE, {size: 8});
		// The centre of face 5, which is -Z: from the middle of this room, a wall.
		// The corner of that face is ceiling, and checking it is how the first
		// draft of this passed while the wall was still black.
		const centre = (((4 * 8) + 4) * 4);
		if (Math.max(...probe.faces[5].slice(centre, centre + 3)) > 24)
		{
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('the wall textures never loaded');
}

/** RGB at (s, t) of one captured face, both fractions from the top left. */
function faceRGB(faces, size, index, s, t)
{
	const x = Math.min(size - 1, Math.max(0, Math.floor(s * size)));
	const y = Math.min(size - 1, Math.max(0, Math.floor(t * size)));
	const at = (((y * size) + x) * 4);
	return [faces[index][at], faces[index][at + 1], faces[index][at + 2]];
}

/** RGB at a fractional position in a projected panorama. */
function panoramaRGB(pixels, width, u, v)
{
	const height = width / 2;
	const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
	const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
	const at = (((y * width) + x) * 4);
	return [pixels[at], pixels[at + 1], pixels[at + 2]];
}

/**
 * Does this pixel carry that tint?
 *
 * By channel pattern rather than by value: the wall is textured and lit, so the
 * absolute number depends on the texture, but a red tint multiplies green and
 * blue toward nothing and cannot do that to red.
 */
function carries(rgb, tint)
{
	const wanted = [1, 3, 5].map((at) => parseInt(tint.slice(at, at + 2), 16) > 0);
	const lit = wanted.map((on, index) => (on ? rgb[index] : -1));
	const dark = wanted.map((on, index) => (on ? -1 : rgb[index]));
	const weakest = Math.min(...lit.filter((value) => value >= 0));
	const strongest = Math.max(...dark.filter((value) => value >= 0), 0);
	// Half again, not double. A tint multiplies a lit, textured wall rather than
	// replacing it, and measured here the blue wall reads (111, 113, 226) - the
	// lightmap keeps the other two channels off the floor. Half again still tells
	// the four tints apart unambiguously, which is all this has to do.
	return weakest > 24 && weakest > strongest * 1.5;
}

/** How far apart two colours are, summed over the channels. */
function apart(a, b)
{
	return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('a panorama from inside a room', () =>
{
	it('contains every wall, on the face that looks at it', async () =>
	{
		boot();
		await settled();
		const walls = paintWalls();
		await settled();
		expect(walls).toHaveLength(4);

		const taken = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(), EYE, {size: FACE});
		expect(taken.faces).toHaveLength(6);
		expect(taken.size).toBe(FACE);

		const seen = new Set();
		walls.forEach((wall) =>
		{
			const hit = faceSample(wall.direction);
			const rgb = faceRGB(taken.faces, taken.size, hit.face, hit.s, hit.t);
			expect(carries(rgb, wall.tint),
				`${wall.tint} wall: face ${CUBE_FACES[hit.face].name} at ${hit.s.toFixed(2)},${hit.t.toFixed(2)} read ${rgb}`)
				.toBe(true);
			seen.add(CUBE_FACES[hit.face].name);
		});

		// Four walls at right angles are four different faces, which is also a
		// check that `faceSample` is not collapsing them onto one.
		expect([...seen].sort()).toEqual(['+X', '+Z', '-X', '-Z']);
	});

	it('looks down at the floor and up at the ceiling', async () =>
	{
		boot();
		await settled();
		bp.model.floorplan.getRooms()[0].setMaterial({color: '#00ffff'});
		bp.model.floorplan.update();
		await settled();

		const taken = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(), EYE, {size: FACE});
		// -Y is index 3, straight down, and the tinted floor is what is there.
		expect(carries(faceRGB(taken.faces, taken.size, 3, 0.5, 0.5), '#00ffff')).toBe(true);
		// +Y is index 2. A room has a ceiling drawn inside it, so this is not sky.
		const up = faceRGB(taken.faces, taken.size, 2, 0.5, 0.5);
		expect(Math.max(...up)).toBeGreaterThan(0);
	});

	it('projects each face to the pixels that look at it', async () =>
	{
		boot();
		await settled();
		const walls = paintWalls();
		await settled();

		const width = FACE * 4;
		const taken = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(), EYE, {size: FACE});
		const pixels = projectEquirectangular(taken.faces, taken.size, width);

		walls.forEach((wall) =>
		{
			const at = pixelFor(wall.direction);
			const rgb = panoramaRGB(pixels, width, at.u, at.v);
			expect(carries(rgb, wall.tint),
				`${wall.tint} wall at u=${at.u.toFixed(3)} v=${at.v.toFixed(3)} read ${rgb}`).toBe(true);
		});

		// The horizon is halfway down a 2:1 image, and the four walls are a
		// quarter turn apart: this is the same statement in image coordinates.
		const eastward = walls.find((wall) => wall.direction.x > 1);
		expect(pixelFor(eastward.direction).v).toBeCloseTo(0.5, 6);
		expect(pixelFor(eastward.direction).u).toBeCloseTo(0.5, 6);
	});

	it('is the right way up, so a floor cannot come out above a ceiling', async () =>
	{
		boot();
		await settled();
		const width = FACE * 4;
		const taken = capturePanoramaFaces(bp.three.renderer, bp.three.scene.getScene(), EYE, {size: FACE});
		const pixels = projectEquirectangular(taken.faces, taken.size, width);

		// The top of the image is straight up and the bottom is straight down,
		// which is where the +Y and -Y faces have to land. Compared by which face
		// each row is *closer* to rather than by equality: a pixel one row below
		// the pole is one texel off the middle of a face, and pinning the exact
		// byte would be pinning the sampler rather than the orientation.
		const top = panoramaRGB(pixels, width, 0.5, 0.01);
		const bottom = panoramaRGB(pixels, width, 0.5, 0.99);
		const up = faceRGB(taken.faces, taken.size, 2, 0.5, 0.5);
		const down = faceRGB(taken.faces, taken.size, 3, 0.5, 0.5);

		expect(apart(top, up)).toBeLessThan(24);
		expect(apart(top, up)).toBeLessThan(apart(top, down));
		expect(apart(bottom, down)).toBeLessThan(24);
		expect(apart(bottom, down)).toBeLessThan(apart(bottom, up));
	});
});

describe('the whole capture, through the viewer', () =>
{
	it('gives back a 2:1 PNG and leaves the viewport as it found it', async () =>
	{
		boot();
		await settled();
		const before = {
			ratio: bp.three.renderer.getPixelRatio(),
			width: bp.three.renderer.domElement.width,
			height: bp.three.renderer.domElement.height,
		};

		const url = bp.three.panoramaUrl({width: 512});
		expect(url.startsWith('data:image/png;base64,')).toBe(true);

		expect(bp.three.renderer.getPixelRatio()).toBe(before.ratio);
		expect(bp.three.renderer.domElement.width).toBe(before.width);
		expect(bp.three.renderer.domElement.height).toBe(before.height);
	});

	it('decodes to the size it says, and is fully opaque', async () =>
	{
		boot();
		await settled();
		const url = bp.three.panoramaUrl({width: 256});
		const image = new Image();
		await new Promise((resolve, reject) =>
		{
			image.onload = resolve;
			image.onerror = reject;
			image.src = url;
		});
		expect([image.width, image.height]).toEqual([256, 128]);

		const panorama = capturePanorama(bp.three.renderer, bp.three.scene.getScene(), EYE, {width: 64});
		expect(panorama.pixels).toHaveLength(64 * 32 * 4);
		for (let i = 3; i < panorama.pixels.length; i += 4)
		{
			expect(panorama.pixels[i]).toBe(255);
		}
	});
});
