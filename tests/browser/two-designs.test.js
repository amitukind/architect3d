/**
 * Two plans, two configurations, two real canvases (RM-002 R-02, P7, tier 2).
 *
 * `tests/instance-state.test.js` proves the whole of P7 under jsdom, and proves
 * it well - 21 tests, 11 of which fail if the configuration argument is ignored.
 * But every one of those assertions is about a *number the library computed*:
 * `convertX(100)` is four times the other one's, `wallWidth` is eight times
 * thinner.
 *
 * This is the same claim asked of the output instead. Two plans holding the
 * identical four-metre room, drawn side by side into two real canvases at
 * different scales, and the assertion is that the ink lands in different places.
 * If per-instance scale computed correctly and then drew through a shared value
 * anyway - which is exactly the shape of bug a `this.` that should have been a
 * `scope.` produces - the numbers above would still pass and this would not.
 *
 * ## The full matrix (RM-003 A4)
 *
 * P7's half of this file is the 2D plan. A4 adds the other half, and it is the
 * acceptance test for the sprint: two whole viewers, two `DesignRuntime`s, two
 * configurations, two render profiles, side by side in one chromium - and then
 * one of them disposed, in each order, with the survivor checked for **pixel
 * identity**, unchanged `renderer.info.memory`, and an unchanged texture handle
 * count.
 *
 * Pixel identity rather than "still draws something" is the point. A viewer
 * whose neighbour has just pulled its textures out from under it still draws a
 * frame - it draws a *different* frame, and a test asking only whether the
 * frame has colours in it passes while the picture is wrong. That is the exact
 * failure mode of the `clearTextureCache()` that used to end `Main.dispose()`.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Floorplan} from '../../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {Configuration, scale} from '../../src/scripts/core/configuration.js';
import {DesignRuntime} from '../../src/scripts/core/design_runtime.js';
import {createRenderProfile, isStudio, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';
import {setFloorplannerPalette, floorplannerPalette} from '../../src/scripts/floorplanner/floorplanner_view.js';
import {textureCacheStats} from '../../src/scripts/three/texture_cache.js';
import {dimCentiMeter, dimMeter} from '../../src/scripts/core/units.js';

const PRISTINE = {...floorplannerPalette};

let canvases = [];
let planners = [];

/**
 * A canvas of a known size, in a container of its own.
 *
 * The container matters and is not decoration. `FloorplannerView2D` sizes itself
 * from `canvasElement.parentElement`, so two canvases parented directly to
 * `document.body` both measure the body - and the body grows as each is
 * appended, so the second view came out a different size from the first and the
 * frames were not comparable. A fixed-size wrapper each is also how an embedder
 * would actually lay two plans out.
 */
function addCanvas(id)
{
	const container = document.createElement('div');
	container.style.cssText = 'width:480px;height:360px;position:relative';
	const canvas = document.createElement('canvas');
	canvas.id = id;
	canvas.style.display = 'block';
	container.appendChild(canvas);
	document.body.appendChild(container);
	canvases.push(container);
	return canvas;
}

/** A four-metre square room drawn into `canvas` under `configuration`. */
function drawRoom(canvas, configuration)
{
	const floorplan = new Floorplan(configuration);
	const a = floorplan.newCorner(0, 0);
	const b = floorplan.newCorner(400, 0);
	const c = floorplan.newCorner(400, 400);
	const d = floorplan.newCorner(0, 400);
	floorplan.newWall(a, b);
	floorplan.newWall(b, c);
	floorplan.newWall(c, d);
	floorplan.newWall(d, a);
	floorplan.update();

	const planner = new Floorplanner2D(canvas, floorplan);
	planner.view.draw();
	planners.push(planner);
	return planner;
}

/**
 * How many pixels on this canvas are not the background.
 *
 * Counting alpha would count every pixel: the palette below paints an opaque
 * white ground, so nothing on the canvas is transparent. What distinguishes ink
 * from ground here is colour, not coverage.
 */
function inkedPixels(planner)
{
	const context = planner.view.canvasElement.getContext('2d');
	const data = context.getImageData(0, 0, planner.view.canvasWidth, planner.view.canvasHeight).data;
	let inked = 0;
	for (let i = 0; i < data.length; i += 4)
	{
		if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)
		{
			inked += 1;
		}
	}
	return inked;
}

/** How many pixels differ between two plans drawn at the same canvas size. */
function differingPixels(a, b)
{
	const read = (planner) => planner.view.canvasElement
		.getContext('2d')
		.getImageData(0, 0, planner.view.canvasWidth, planner.view.canvasHeight).data;
	const pa = read(a);
	const pb = read(b);
	expect(pa.length).toBe(pb.length);

	let differing = 0;
	for (let i = 0; i < pa.length; i += 4)
	{
		if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2])
		{
			differing += 1;
		}
	}
	return differing;
}

beforeEach(() =>
{
	setFloorplannerPalette({...PRISTINE, background: '#ffffff', grid: '#ffffff', gridMajor: '#ffffff'});
	canvases = [];
	planners = [];
});

afterEach(() =>
{
	planners.forEach((planner) => planner.dispose());
	canvases.forEach((container) => container.remove());
	planners = [];
	canvases = [];
	setFloorplannerPalette(PRISTINE);
});

describe('two plans drawn side by side', () =>
{
	it('draw the same room at their own scales', () =>
	{
		// Grid and background painted white above, so what is left is the plan
		// itself: the room fill, the walls and the corners.
		const small = drawRoom(addCanvas('plan-small'), new Configuration({scale: 1, dimUnit: dimCentiMeter}));
		const large = drawRoom(addCanvas('plan-large'), new Configuration({scale: 3, dimUnit: dimCentiMeter}));

		const smallInk = inkedPixels(small);
		const largeInk = inkedPixels(large);

		// Both drew something...
		expect(smallInk).toBeGreaterThan(0);
		expect(largeInk).toBeGreaterThan(0);
		// ...and the one at 3x covers materially more of its canvas. Not an exact
		// ratio: the larger room is clipped by the canvas edge and the wall strokes
		// do not scale with the fill.
		expect(largeInk).toBeGreaterThan(smallInk * 1.5);
	});

	it('neither view moved when the other was built', () =>
	{
		// The regression this whole phase exists to prevent. Before P7, building
		// the second plan at scale 3 would have left the first one drawing at 3
		// too - and nothing would have redrawn it, so the two would disagree until
		// something touched the first canvas.
		const first = drawRoom(addCanvas('plan-first'), new Configuration({scale: 1}));
		const before = inkedPixels(first);

		drawRoom(addCanvas('plan-second'), new Configuration({scale: 3}));

		first.view.draw();
		expect(inkedPixels(first)).toBe(before);
	});

	it('label their dimensions in their own units', () =>
	{
		// Same geometry, same canvas size, different display unit: the labels are
		// the only thing that can differ, so the frames must.
		const metric = drawRoom(addCanvas('plan-cm'), new Configuration({dimUnit: dimCentiMeter}));
		const metres = drawRoom(addCanvas('plan-m'), new Configuration({dimUnit: dimMeter}));

		expect(metric.dimensioning.cmToMeasure(400)).toBe('400cm');
		expect(metres.dimensioning.cmToMeasure(400)).toBe('4m');

		// And the difference reaches the canvas. Compared as whole frames rather
		// than by ink count: the first version of this assumed '400cm' would leave
		// more ink than '4m' and it does not, because each label is stroked with a
		// white halo, so the wider string paints more *background*. Which frame has
		// more ink is an artefact of the halo; that they differ at all is the claim.
		expect(differingPixels(metric, metres)).toBeGreaterThan(50);
	});

	it('a view built with no configuration of its own still follows the page', () =>
	{
		// The other half of the contract, in the browser: an embedder who never
		// heard of P7 gets exactly what they had.
		const shared = drawRoom(addCanvas('plan-shared'), undefined);
		expect(shared.configuration.getNumericValue(scale)).toBe(Configuration.getNumericValue(scale));

		Configuration.setValue(scale, 2);
		expect(shared.configuration.getNumericValue(scale)).toBe(2);
		Configuration.setValue(scale, 1);
	});
});

// --- A4: two whole viewers, two runtimes ------------------------------------

/** A four-metre room, as a saved design. */
const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			c1: {x: 0, y: 0, elevation: 0},
			c2: {x: 400, y: 0, elevation: 0},
			c3: {x: 400, y: 400, elevation: 0},
			c4: {x: 0, y: 400, elevation: 0},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'},
			{corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'},
			{corner1: 'c4', corner2: 'c1'},
		],
		rooms: {}, units: 'cm', version: '2.0.0',
	},
	items: [],
});

let viewers = [];
let hosts = [];

/**
 * A whole viewer on a runtime of its own.
 *
 * `spin` is turned off after construction rather than passed in, because
 * `BlueprintJS` does not forward it - and it has to be off for any of the
 * pixel comparisons below to mean anything: an auto-rotating camera makes two
 * consecutive frames legitimately different, and the whole point here is that
 * they should not be.
 */
function mountViewer(runtime)
{
	const host = document.createElement('div');
	host.innerHTML = '<canvas style="display:block;width:400px;height:300px"></canvas>' +
		'<div style="width:480px;height:360px"></div>';
	document.body.appendChild(host);
	hosts.push(host);

	const blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('canvas'),
		threeElement: host.querySelector('div'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
		runtime: runtime,
	});
	blueprint.three.options.spin = false;
	blueprint.three.controls.autoRotate = false;
	blueprint.model.scene.setItemLoader(() => {});
	blueprint.model.loadSerialized(DESIGN);
	viewers.push(blueprint);
	return blueprint;
}

/** Render, and give the queued texture decodes a chance to land and upload. */
async function settle(blueprint)
{
	blueprint.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 250));
	blueprint.three.render(true);
}

/** The composited frame, read straight off the drawing buffer. */
function frameOf(blueprint)
{
	blueprint.three.render(true);
	const gl = blueprint.three.renderer.getContext();
	const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
	gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
	return pixels;
}

/** How many pixels differ between two frames of the same size. */
function differingFramePixels(a, b)
{
	expect(a.length).toBe(b.length);
	let differing = 0;
	for (let i = 0; i < a.length; i += 4)
	{
		if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])
		{
			differing += 1;
		}
	}
	return differing;
}

/** How many distinct colours a frame contains - "is this a real picture". */
function distinctColours(pixels)
{
	const seen = new Set();
	for (let i = 0; i < pixels.length; i += 4)
	{
		seen.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
	}
	return seen.size;
}

/** A runtime with its own configuration and its own look. */
function makeRuntime(configuration, mode)
{
	return new DesignRuntime({
		configuration: configuration,
		renderProfile: mode ? createRenderProfile(mode) : undefined,
	});
}

describe('two documents, two runtimes, side by side', () =>
{
	afterEach(() =>
	{
		viewers.forEach((blueprint) => blueprint.dispose());
		hosts.forEach((host) => host.remove());
		viewers = [];
		hosts = [];
	});

	it('each draws its own document with its own profile', async () =>
	{
		const classic = makeRuntime(new Configuration({dimUnit: dimCentiMeter}));
		const studio = makeRuntime(new Configuration({dimUnit: dimMeter}), RENDER_STUDIO);
		const a = mountViewer(classic);
		const b = mountViewer(studio);
		await settle(a);
		await settle(b);

		expect(isStudio(a.three.renderProfile)).toBe(false);
		expect(isStudio(b.three.renderProfile)).toBe(true);
		expect(a.runtime.id).not.toBe(b.runtime.id);

		// Both drew a real picture, and the two pictures are not the same one.
		// Same room, same canvas size, different shading - so if the profile were
		// still shared the frames would be identical and this would fail.
		const frameA = frameOf(a);
		const frameB = frameOf(b);
		expect(distinctColours(frameA)).toBeGreaterThan(20);
		expect(distinctColours(frameB)).toBeGreaterThan(20);
		expect(differingFramePixels(frameA, frameB)).toBeGreaterThan(frameA.length / 4 * 0.05);
	});

	it('disposing one leaves the other pixel-for-pixel identical', async () =>
	{
		const a = mountViewer(makeRuntime(new Configuration()));
		const b = mountViewer(makeRuntime(new Configuration()));
		await settle(a);
		await settle(b);

		const memoryBefore = {...b.three.renderer.info.memory};
		const statsBefore = b.runtime.stats();
		const cacheBefore = textureCacheStats();
		expect(memoryBefore.geometries).toBeGreaterThan(0);
		expect(statsBefore.resources).toBeGreaterThan(0);
		expect(cacheBefore.urls).toBeGreaterThan(0);

		// Two consecutive frames of B are identical, which is what makes the
		// comparison after A's disposal a measurement rather than a coin toss.
		const before = frameOf(b);
		expect(differingFramePixels(before, frameOf(b))).toBe(0);

		a.dispose();
		await settle(b);

		expect(differingFramePixels(before, frameOf(b))).toBe(0);
		expect(b.three.renderer.info.memory.geometries).toBe(memoryBefore.geometries);
		expect(b.three.renderer.info.memory.textures).toBe(memoryBefore.textures);
		expect(b.runtime.stats().resources).toBe(statsBefore.resources);
		expect(b.runtime.stats().handles).toBe(statsBefore.handles);
		expect(b.runtime.stats().disposed).toBe(false);
		// B's images are still decoded, so it did not have to re-fetch anything.
		expect(textureCacheStats().urls).toBeGreaterThan(0);
	});

	it('and it holds in the other order too', async () =>
	{
		const a = mountViewer(makeRuntime(new Configuration()));
		const b = mountViewer(makeRuntime(new Configuration()));
		await settle(a);
		await settle(b);

		const before = frameOf(a);
		const memoryBefore = {...a.three.renderer.info.memory};
		const statsBefore = a.runtime.stats();

		b.dispose();
		await settle(a);

		expect(differingFramePixels(before, frameOf(a))).toBe(0);
		expect(a.three.renderer.info.memory.geometries).toBe(memoryBefore.geometries);
		expect(a.runtime.stats().resources).toBe(statsBefore.resources);

		// B gave its GPU resources back, and its runtime is still open - these
		// runtimes were constructed by the test, so they are the test's to close
		// and `BlueprintJS.dispose()` correctly did not close one for us.
		expect(b.runtime.stats().resources).toBe(0);
		expect(b.runtime.stats().disposed).toBe(false);

		b.runtime.dispose();
		expect(b.runtime.stats().disposed).toBe(true);
		expect(a.runtime.stats().disposed).toBe(false);
		expect(a.runtime.stats().resources).toBe(statsBefore.resources);
	});

	it('and the survivor still answers for its own document', async () =>
	{
		// Memory counts and pixels alike would be satisfied by a viewer frozen at
		// the last frame it drew. This is the other half: B is still live - it
		// takes an edit, re-derives its rooms, and redraws.
		const a = mountViewer(makeRuntime(new Configuration()));
		const b = mountViewer(makeRuntime(new Configuration()));
		await settle(a);
		await settle(b);

		const before = frameOf(b);
		a.dispose();

		const corner = b.model.floorplan.getCorners()[0];
		corner.move(corner.x - 120, corner.y - 120);
		await settle(b);

		expect(differingFramePixels(before, frameOf(b))).toBeGreaterThan(0);
		expect(b.runtime.stats().resources).toBeGreaterThan(0);
		expect(b.three.floorplan.edges.length).toBeGreaterThan(0);
	});
});
