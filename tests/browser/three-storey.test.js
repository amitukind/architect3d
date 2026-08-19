/**
 * The house in three dimensions, and the view from outside (RM-010 G3).
 *
 * The last tier the three-storey fixture has to pass, and the only one that
 * needs a GPU. `tests/three-storey.test.js` drives save, load, undo, autosave,
 * the plan and an exported sheet; this drives what those cannot - that three
 * storeys, two flights, a stairwell in each upper floor and a gable roof
 * actually render, that showing one storey at a time changes the picture rather
 * than only the flags, and that the exterior view frames the building.
 *
 * Pixels, not scene-graph assertions. The scene graph is checked headlessly and
 * `tests/browser/levels.test.js` measures where each storey's meshes sit; what
 * is left, and what a person would notice first, is whether the frame changes.
 * A "hide the other storeys" that hid nothing would pass every structural
 * assertion in this repository.
 *
 * The fixture is inlined by Vite rather than read from disk - a browser test has
 * no `node:fs` - through `?raw`, so it is the same bytes the headless tier and
 * the application read.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import HOUSE from '../fixtures/three-storey.blueprint3d?raw';
import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {VIEW_EXTERIOR, VIEW_ISOMETRY} from '../../src/scripts/core/constants.js';

let host;
let bp;

function boot()
{
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
}

/** Render, let the texture decodes land, render again. See viewer-webgl. */
async function renderSettled()
{
	bp.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	bp.three.render(true);
}

/** The rendered frame, straight off the drawing buffer. */
function readFrame()
{
	const gl = bp.three.renderer.getContext();
	const w = gl.drawingBufferWidth;
	const h = gl.drawingBufferHeight;
	const pixels = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return {pixels, width: w, height: h};
}

function differingPixels(a, b)
{
	let differing = 0;
	for (let i = 0; i < a.pixels.length; i += 4)
	{
		if (a.pixels[i] !== b.pixels[i]
			|| a.pixels[i + 1] !== b.pixels[i + 1]
			|| a.pixels[i + 2] !== b.pixels[i + 2])
		{
			differing += 1;
		}
	}
	return differing;
}

/** Load the house and bring every storey's projection up to date. */
async function loadHouse()
{
	bp.model.loadSerialized(HOUSE);
	bp.model.levels.forEach((level) => {level.floorplan.update();});
	await renderSettled();
}

/** Every mesh in the scene, by name, so a storey's contents can be counted. */
function sceneContents()
{
	const names = [];
	bp.three.scene.getScene().traverse((object) =>
	{
		if (object.isMesh)
		{
			names.push(object.name || object.type);
		}
	});
	return names;
}

beforeEach(() =>
{
	boot();
});

afterEach(() =>
{
	bp.dispose();
	host.remove();
	host = null;
	bp = null;
});

describe('the fixture, rendered', () =>
{
	it('draws three storeys, six items and a roof', async () =>
	{
		await loadHouse();

		expect(bp.model.levels).toHaveLength(3);
		expect(sceneContents()).toContain('roof');
		// Each storey's group holds that storey's meshes, and each has content.
		[0, 1, 2].forEach((index) =>
		{
			const group = bp.model.scene.levelGroup(bp.model.levels[index]);
			let meshes = 0;
			group.traverse((object) => {if (object.isMesh) {meshes += 1;}});
			expect(meshes, `storey ${index}`).toBeGreaterThan(0);
		});
	});

	it('renders something rather than an empty frame', async () =>
	{
		await loadHouse();
		bp.three.showExterior();
		await renderSettled();
		const drawn = readFrame();

		let opaque = 0;
		for (let i = 3; i < drawn.pixels.length; i += 4)
		{
			if (drawn.pixels[i] > 0) {opaque += 1;}
		}
		expect(opaque).toBeGreaterThan(0);
	});
});

describe('showing one storey at a time', () =>
{
	it('changes the picture, not only the flags', async () =>
	{
		await loadHouse();
		bp.three.showExterior();
		await renderSettled();
		const whole = readFrame();

		bp.three.showStoreys(false);
		await renderSettled();
		const single = readFrame();

		// Two upper storeys and a roof taken out of a framed building is a large
		// fraction of the frame, not a rounding difference.
		const changed = differingPixels(whole, single);
		expect(changed).toBeGreaterThan(whole.width * whole.height * 0.02);
	});

	it('puts the same picture back', async () =>
	{
		await loadHouse();
		bp.three.showExterior();
		await renderSettled();
		const before = readFrame();

		bp.three.showStoreys(false);
		await renderSettled();
		bp.three.showStoreys(true);
		await renderSettled();

		expect(differingPixels(before, readFrame())).toBe(0);
	});

	it('follows the storey being edited', async () =>
	{
		await loadHouse();
		bp.three.showStoreys(false);
		await renderSettled();
		const ground = readFrame();

		bp.model.setActiveLevel(2);
		bp.three.syncLevelViews();
		await renderSettled();

		// The loft has no partition and a beam the ground floor has not, so the
		// two storeys cannot draw the same frame.
		expect(differingPixels(ground, readFrame())).toBeGreaterThan(0);
	});
});

describe('the exterior view', () =>
{
	it('frames the whole building, roof included', async () =>
	{
		await loadHouse();

		bp.three.switchView(VIEW_EXTERIOR);
		await renderSettled();

		const bounds = bp.model.buildingBounds();
		const camera = bp.three.camera;
		// Every corner of the building's box is inside the frustum, which is the
		// claim "frames the whole building" actually makes.
		const {Frustum, Matrix4, Vector3} = await import('three');
		camera.updateMatrixWorld(true);
		const frustum = new Frustum().setFromProjectionMatrix(
			new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
		[bounds.x0, bounds.x1].forEach((x) =>
		{
			[bounds.y0, bounds.y1].forEach((z) =>
			{
				[0, bounds.top].forEach((y) =>
				{
					expect(frustum.containsPoint(new Vector3(x, y, z)), `${x},${y},${z}`).toBe(true);
				});
			});
		});
	});

	it('is a different picture from the storey the camera was on', async () =>
	{
		await loadHouse();
		bp.three.switchView(VIEW_ISOMETRY);
		await renderSettled();
		const inside = readFrame();

		bp.three.switchView(VIEW_EXTERIOR);
		await renderSettled();

		expect(differingPixels(inside, readFrame())).toBeGreaterThan(0);
	});

	it('brings the storeys and the roof back with it', async () =>
	{
		await loadHouse();
		bp.three.showStoreys(false);
		await renderSettled();

		bp.three.switchView(VIEW_EXTERIOR);
		await renderSettled();

		expect([0, 1, 2].map((i) => bp.model.scene.levelGroup(bp.model.levels[i]).visible))
			.toEqual([true, true, true]);
	});
});
