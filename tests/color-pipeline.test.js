// @vitest-environment jsdom
/**
 * Sprint S8: the colour pipeline, unfrozen.
 *
 * S4 deliberately turned three's colour management off so that the engine bump
 * could be reviewed as a geometry change rather than a colour one. S8 turns it
 * back on. That is a two-sided change and the sides must agree: every colour
 * texture is decoded by the GPU on the way in, and the frame is encoded back to
 * sRGB on the way out. Get one without the other and everything is a full gamma
 * out - too dark if a decode has no matching encode, far too bright the other
 * way round.
 *
 * Which makes the tag on each texture the thing worth pinning. There is no
 * central place it is set: seven construction sites across four files each do
 * it for themselves, and a new one added later would silently default to
 * unmanaged. So this walks a real scene and asserts on what is actually hanging
 * off the materials, after a redraw rather than only after construction -
 * `Floorplan3D.redraw()` throws every Edge and Floor away and builds new ones,
 * so a tag applied in a constructor but not in the rebuild path would pass a
 * naive test and fail in the app the first time a wall moved.
 *
 * What is deliberately NOT here: any assertion that a hex round-trip survives.
 * `new Color('#' + colour.getHexString())` is byte-exact whether management is
 * on or off, because both halves move together, so such a test passes in both
 * regimes and proves nothing. The value the shader receives is asserted in
 * viewer-lifecycle.test.js instead.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';

import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {Skybox} from '../src/scripts/three/skybox.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

/** A closed rectangle, in centimetres, so the scene has walls and one floor. */
const ROOM = '{"floorplan":{"corners":'
	+ '{"a":{"x":0,"y":0,"elevation":250},"b":{"x":400,"y":0,"elevation":250},'
	+ '"c":{"x":400,"y":300,"elevation":250},"d":{"x":0,"y":300,"elevation":250}},'
	+ '"walls":[{"corner1":"a","corner2":"b"},{"corner1":"b","corner2":"c"},'
	+ '{"corner1":"c","corner2":"d"},{"corner1":"d","corner2":"a"}],'
	+ '"rooms":{"a,b,c,d":{"name":"Room"}},"wallTextures":[],"floorTextures":{},'
	+ '"newFloorTextures":{}},"items":[]}';

let canvasStub;
let observer;
let pointerApis;
let three;
let model;

function buildDom()
{
	const viewer = document.createElement('div');
	viewer.id = 'viewer';
	document.body.appendChild(viewer);
	setLayout(viewer, {left: 0, top: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT});
	return viewer;
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = VIEWPORT_WIDTH;
	window.innerHeight = VIEWPORT_HEIGHT;

	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub([]));

	model = new Model();
	three = new Main(model, buildDom(), 'three-canvas', {});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	model.loadSerialized(ROOM);
});

afterEach(() =>
{
	if (three) { three.dispose(); three = null; }
	Main.setRendererFactory(null);
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

/** Every wall face three built for the current plan. */
function edges()
{
	return three.floorplan.edges;
}

function floors()
{
	return three.floorplan.floors;
}

describe('the colour management switch', () =>
{
	it('is on, and the renderer encodes to match', () =>
	{
		expect(THREE.ColorManagement.enabled).toBe(true);
		expect(three.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
	});

	it('built a scene with walls and a floor to inspect', () =>
	{
		// Guards every assertion below: an empty scene would pass all of them.
		expect(edges().length).toBeGreaterThan(0);
		expect(floors().length).toBeGreaterThan(0);
	});
});

describe('every texture carries an explicit colour space', () =>
{
	it('tags the wall colour maps sRGB', () =>
	{
		edges().forEach((edge) =>
		{
			expect(edge.texture.colorSpace).toBe(THREE.SRGBColorSpace);
		});
	});

	it('tags the wall lightmap sRGB', () =>
	{
		// Not the default three recommends for a lightMap, and chosen on purpose:
		// this asset is a hand-painted vignette, not a baked irradiance buffer.
		// Because the walls are unlit, decode-then-encode is the identity, so the
		// authored 232-253 range survives intact; left linear it would compress
		// to 244.6-254.1 and the vignette would flatten by more than half.
		edges().forEach((edge) =>
		{
			expect(edge.lightMap.colorSpace).toBe(THREE.SRGBColorSpace);
		});
	});

	it('tags the floor colour maps sRGB', () =>
	{
		// The one that matters most: the floor is the only lit surface in most
		// views, so an untagged floor texture looks like the lights being wrong.
		floors().forEach((floor) =>
		{
			expect(floor.floorPlane.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
		});
	});

	it('tags the ground plane sRGB', () =>
	{
		// The ground photograph is a KTX2 since RM-005 C1, and jsdom cannot produce
		// one: with no WebGL, `formatSupport()` has no answer, and `Skybox` declines
		// to build a transcoder at all rather than let `KTX2Loader.load()` throw on
		// a missing `workerConfig`. So `groundMat.map` is legitimately null here.
		//
		// The property under test has not changed - whatever texture arrives is
		// tagged sRGB and hung on the material - so the texture is handed over
		// directly, which is the same move the environment-map test below makes for
		// the same reason. It reads better than it did: this now exercises the
		// asynchronous path a real browser takes, where the old assertion only ever
		// saw the synchronous return that a JPEG happened to provide.
		const texture = new THREE.Texture();
		three.skybox.applyGroundTexture(texture);

		expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
		expect(three.skybox.groundMat.map).toBe(texture);
	});

	it('tags the environment map sRGB when one is loaded', () =>
	{
		// setEnvironmentMap goes through a TextureLoader callback, so drive the
		// callback directly rather than waiting on a network jsdom will not make.
		const skybox = new Skybox(new THREE.Scene(), three.renderer);
		const texture = new THREE.Texture();
		skybox.texture = {load(url, onLoad) {onLoad(texture);}};

		skybox.setEnvironmentMap('rooms/textures/envs/Garden.jpg');

		expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
		skybox.dispose();
	});

	it('keeps the tags through a redraw', () =>
	{
		// Floorplan3D.redraw() discards every Edge and Floor and builds new ones,
		// which happens on any change to the plan. A tag set in a constructor but
		// missing from the rebuild path would pass every test above and still be
		// wrong the first time a wall moved.
		three.floorplan.redraw();

		expect(edges().length).toBeGreaterThan(0);
		edges().forEach((edge) =>
		{
			expect(edge.texture.colorSpace).toBe(THREE.SRGBColorSpace);
			expect(edge.lightMap.colorSpace).toBe(THREE.SRGBColorSpace);
		});
		floors().forEach((floor) =>
		{
			expect(floor.floorPlane.material.map.colorSpace).toBe(THREE.SRGBColorSpace);
		});
	});
});

describe('the two hand-written shaders opt back into the pipeline', () =>
{
	it('ends both sky fragment shaders with the output encode', () =>
	{
		// A ShaderMaterial writes gl_FragColor itself and so skips the conversion
		// three applies to every built-in material. Without these the sky would
		// be the only surface still writing linear values into an sRGB frame.
		expect(three.skybox.plainFragmentShader).toContain('#include <colorspace_fragment>');
		expect(three.skybox.fragmentShader).toContain('#include <colorspace_fragment>');
	});

	it('puts the include on its own line, where the parser can see it', () =>
	{
		// WebGLProgram's include pattern is line-anchored. Appended to another
		// statement the directive is never substituted, and an unrecognised
		// #include is left in place rather than reported - so the failure is a
		// shader compile error at runtime, not a build error.
		[three.skybox.plainFragmentShader, three.skybox.fragmentShader].forEach((source) =>
		{
			const line = source.split('\n').find((entry) => entry.includes('colorspace_fragment'));
			expect(line).toMatch(/^[ \t]*#include +<colorspace_fragment>\s*$/);
		});
	});
});

describe('what the flip must not sweep up', () =>
{
	it('keeps lightMapIntensity at pi', () =>
	{
		// This cancels the RECIPROCAL_PI in the basic material's lightmap term.
		// It is arithmetic inside a shader - untouched by ColorManagement and by
		// outputColorSpace, which act on values entering and leaving it. A
		// comment in edge.js used to say S8 would remove it "with the rest of the
		// freeze"; doing so would darken every wall in the app by pi.
		const walls = [];
		edges().forEach((edge) =>
		{
			edge.planes.forEach((plane) =>
			{
				if (plane.material && plane.material.lightMap) { walls.push(plane.material); }
			});
		});

		expect(walls.length).toBeGreaterThan(0);
		walls.forEach((material) =>
		{
			expect(material.lightMapIntensity).toBeCloseTo(Math.PI, 12);
		});
	});

	it('pins hex as sRGB, in and out', () =>
	{
		// The convention S8 fixes for the material inspector: a hex string is
		// always the sRGB value the user sees and picks, and Color does the
		// conversion in both directions.
		const picked = '#3d7ab8';
		const colour = new THREE.Color(picked);

		expect(`#${colour.getHexString()}`).toBe(picked);
		// And the shader receives the decoded value, not the bytes.
		expect(colour.r).toBeCloseTo(0.04667, 4);
		expect(colour.r).not.toBeCloseTo(0x3d / 255, 3);
	});

	it('holds the hover highlight at the strength it always had', () =>
	{
		// item.js re-picked emissiveColor from 0x444444 to 0x8d8d8d. The literal
		// is never read back or serialized, so what matters is the linear value
		// it decodes to: 0x444444 meant 0.2667 under the freeze and would mean
		// 0.0578 now, a highlight 4.6x dimmer.
		const emissive = new THREE.Color(0x8d8d8d);
		expect(emissive.r).toBeCloseTo(0x44 / 255, 3);
	});
});
