/**
 * The incremental projection, compared against a full redraw in pixels
 * (RM-003 A2, tier 2).
 *
 * ## Why this needs a real browser
 *
 * `tests/change-projection.test.js` compares the two paths' scene graphs, mesh
 * by mesh, and that is where the detail lives - three designs, ten edit kinds.
 * What a scene-graph diff cannot see is anything the renderer decides for
 * itself: which material got compiled, whether a texture was uploaded, whether
 * a mesh that is present in the graph actually composites. A2's promise is "the
 * picture does not change", and a picture is pixels.
 *
 * ## Why a pixel-exact comparison is legitimate here, when tier 2 usually
 * avoids one
 *
 * `viewer-webgl.test.js` explains at length why nothing in this tier asserts on
 * an exact colour: WebGL in headless chromium goes through SwiftShader, a CPU
 * rasteriser, and a committed reference frame would be wrong on any machine
 * with a real driver. That argument is about references stored in the
 * repository. It does not apply to two frames drawn seconds apart, by the same
 * rasteriser, in the same process, from the same camera - which is exactly the
 * comparison A2 needs. Whatever SwiftShader does to the incremental frame it
 * does identically to the reference one, so a difference between them is a
 * difference in what was drawn.
 *
 * The guard against the comparison being vacuous is asserted too: the drag has
 * to have changed the frame, and the frame has to be a scene rather than a
 * clear colour. Two identical black frames would otherwise pass.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
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
		rooms: {}, units: 'cm', version: '2.0.0',
	},
	items: [],
});

let host;
let blueprint;

function boot()
{
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>' +
		'<div id="viewer" style="width:640px;height:480px"></div>';
	document.body.appendChild(host);

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

/** Render, wait for the texture decodes to land, render again. See viewer-webgl. */
async function renderSettled()
{
	blueprint.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	blueprint.three.render(true);
}

/** The rendered frame, straight off the drawing buffer. */
function readFrame()
{
	const gl = blueprint.three.renderer.getContext();
	const w = gl.drawingBufferWidth;
	const h = gl.drawingBufferHeight;
	const pixels = new Uint8Array(w * h * 4);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return {pixels, width: w, height: h};
}

/** How many pixels differ in RGB between two frames of the same size. */
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

/** Distinct RGB values, so "this is a scene, not a clear colour" is checkable. */
function distinctColours(frame)
{
	const seen = new Set();
	for (let i = 0; i < frame.pixels.length; i += 4)
	{
		seen.add(`${frame.pixels[i]},${frame.pixels[i + 1]},${frame.pixels[i + 2]}`);
	}
	return seen.size;
}

beforeEach(() =>
{
	boot();
});

afterEach(() =>
{
	if (blueprint)
	{
		blueprint.dispose();
		blueprint = null;
	}
	if (host)
	{
		host.remove();
		host = null;
	}
	document.body.innerHTML = '';
});

describe('a corner drag, incremental against full redraw', () =>
{
	it('draws the same frame both ways', async () =>
	{
		await renderSettled();
		const beforeDrag = readFrame();
		expect(distinctColours(beforeDrag)).toBeGreaterThan(2);

		// Ten steps, outward, the way a person drags a corner.
		const corner = blueprint.model.floorplan.getCorners()[0];
		for (let i = 1; i <= 10; i++)
		{
			corner.move(corner.x - 15, corner.y - 15);
		}
		await renderSettled();
		const incremental = readFrame();

		// The comparison is only worth making if the drag moved the picture.
		expect(differingPixels(beforeDrag, incremental)).toBeGreaterThan(0);

		// Now the reference: throw the whole projection away and rebuild it from
		// the same model. Anything the incremental path failed to update shows up
		// here as a difference.
		blueprint.three.floorplan.redraw();
		await renderSettled();
		const reference = readFrame();

		expect(differingPixels(incremental, reference)).toBe(0);
	});

	it('draws the same frame after a topological edit', async () =>
	{
		await renderSettled();
		const beforeEdit = readFrame();

		const floorplan = blueprint.model.floorplan;
		floorplan.removeWall(floorplan.getWalls()[0]);
		await renderSettled();
		const incremental = readFrame();

		expect(differingPixels(beforeEdit, incremental)).toBeGreaterThan(0);

		blueprint.three.floorplan.redraw();
		await renderSettled();

		expect(differingPixels(incremental, readFrame())).toBe(0);
	});

	it('does not rebuild the projection during the drag', async () =>
	{
		// The other half of the claim: the frames match AND less was done to
		// produce them. Without this, an incremental path that quietly ran a full
		// redraw every time would pass the comparison above.
		await renderSettled();
		const before = blueprint.three.floorplan.projectionStats();

		const corner = blueprint.model.floorplan.getCorners()[0];
		for (let i = 1; i <= 10; i++)
		{
			corner.move(corner.x - 15, corner.y - 15);
		}

		const after = blueprint.three.floorplan.projectionStats();
		expect(after.full - before.full).toBe(0);
		expect(after.geometry - before.geometry).toBe(10);
		expect(after.edgesAdded - before.edgesAdded).toBe(0);
	});

	it('does not move the camera during the drag', async () =>
	{
		await renderSettled();
		const target = blueprint.three.controls.target.clone();
		const position = blueprint.three.camera.position.clone();
		// Two by now, and both wanted: `Main.init()` frames the empty plan before
		// it subscribes to anything, and opening the design frames the design.
		const before = blueprint.three.cameraStats();
		expect(before.recentred).toBe(2);

		const corner = blueprint.model.floorplan.getCorners()[0];
		for (let i = 1; i <= 10; i++)
		{
			corner.move(corner.x - 15, corner.y - 15);
		}

		expect(blueprint.three.controls.target.equals(target)).toBe(true);
		expect(blueprint.three.camera.position.equals(position)).toBe(true);
		expect(blueprint.three.cameraStats().recentred - before.recentred).toBe(0);
		expect(blueprint.three.cameraStats().declined - before.declined).toBe(10);
	});
});
