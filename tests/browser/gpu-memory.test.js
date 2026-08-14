/**
 * Asking the driver whether it got its memory back (RM-003 A0, tier 2).
 *
 * ## Why this needs a real browser
 *
 * `tests/resource-lifecycle.test.js` proves the library *called* dispose, by
 * listening for the event three fires from it. That is the right test and it is
 * where the detail lives - twenty cases, one per ownership boundary. What it
 * cannot prove is that the resource was ever on the GPU or that the GPU let go
 * of it, because under jsdom there is no GPU and the renderer is a stub.
 *
 * `renderer.info.memory` is the renderer's own count of what it has uploaded:
 * `{geometries, textures}`, incremented where a buffer or a texture is created
 * and decremented in the dispose handlers. It is maintained by three, not by
 * this suite, so it cannot be satisfied by a library that merely looks tidy.
 *
 * ## What the assertions are, and are not
 *
 * They are all *deltas*. An absolute count would pin the number of meshes a room
 * happens to produce, which is a fact about the renderer's construction and will
 * legitimately change - A2 is going to change it deliberately. The claim here is
 * only that editing in a loop does not make the number climb, and that tearing a
 * viewer down gives back what mounting it took.
 *
 * The counts move in both directions on purpose. A registry that disposed too
 * eagerly would pass "memory came back down" while producing a black frame, so
 * the two-viewer case asserts that A's teardown leaves B's memory *unchanged* -
 * that over-disposal is the risk A0 carries, and this is the guard on it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {textureCacheStats} from '../../src/scripts/three/texture_cache.js';

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

let hosts = [];
let viewers = [];

function mount()
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
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
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

/**
 * What a renderer says it is holding.
 *
 * Takes the renderer rather than the blueprint because `BlueprintJS.dispose()`
 * nulls `this.three`, and the interesting reading is the one taken *after*
 * teardown. The `info` object is a plain counter and outlives the context, so a
 * reference captured while the viewer was alive still answers.
 */
function memory(renderer)
{
	const info = renderer.info.memory;
	return {geometries: info.geometries, textures: info.textures};
}

/** The renderer behind a viewer, captured so it survives dispose(). */
function rendererOf(blueprint)
{
	return blueprint.three.renderer;
}

/**
 * One edit, exercising both kinds of churn A0 had to fix.
 *
 * The two calls are not redundant, and finding that out is worth recording.
 * `Corner.move()` alone looks like the obvious edit, but it reaches
 * `update(false, ...)` - the branch that dispatches EVENT_UPDATED and returns
 * without re-deriving anything. That drives `Floorplan3D.redraw()`, so it churns
 * the *view*: every Edge and Floor is thrown away and rebuilt. It does not touch
 * the model's Rooms or HalfEdges at all.
 *
 * So a loop of moves exercises half of A0, and this test passed with the model
 * half of the fix reverted until the explicit `update()` was added. That is the
 * full re-derivation a wall add or delete performs, and it is where the six
 * meshes per call were being abandoned.
 */
function editCycle(blueprint, index)
{
	const floorplan = blueprint.model.floorplan;
	floorplan.getCorners()[0].move(index % 2 === 0 ? 4 : 0, 0);
	floorplan.update();
	blueprint.three.render(true);
}

beforeEach(() =>
{
	hosts = [];
	viewers = [];
});

afterEach(() =>
{
	viewers.forEach((blueprint) =>
	{
		try {blueprint.dispose();}
		catch {/* already disposed by the test */}
	});
	hosts.forEach((host) => host.remove());
	viewers = [];
	hosts = [];
});

describe('the renderer gets its memory back', () =>
{
	it('reports memory at all', async () =>
	{
		// If info.memory stops being maintained, every delta below is vacuously
		// zero and this suite would pass while measuring nothing.
		const blueprint = mount();
		await settle(blueprint);

		const used = memory(rendererOf(blueprint));
		expect(used.geometries).toBeGreaterThan(0);
		expect(used.textures).toBeGreaterThan(0);
	});

	it('editing in a loop does not make the count climb', async () =>
	{
		// M-1 and M-2. Before A0 every one of these cycles abandoned six model
		// meshes and a full set of wall faces, none of them disposed - so the
		// renderer's count rose monotonically for as long as anybody kept editing.
		//
		// Ten cycles, not the fifty the plan specified, and the reason is the
		// rasteriser rather than the claim. Each cycle re-derives the plan and
		// forces a frame, and a frame here goes through SwiftShader on the CPU.
		//
		// Fifty took 37 seconds. Twenty took 17, which passed on its own and then
		// pushed the *next* file's profile-switching test past its 15-second
		// timeout - this tier shares one browser and SwiftShader is the shared
		// resource. Ten is under five seconds and proves exactly the same thing:
		// the leak was per-cycle, so any count above one separates leaking from
		// not, and nine released generations is not a weaker claim than
		// forty-nine. Verified by reverting the fix, where this reports 2 leaked
		// geometries per cycle.
		const CYCLES = 10;
		const blueprint = mount();
		await settle(blueprint);

		// One cycle first, so the baseline is taken with an edit's worth of
		// geometry already uploaded rather than with the pristine load's.
		editCycle(blueprint, 0);
		await settle(blueprint);
		const renderer = rendererOf(blueprint);
		const before = memory(renderer);

		for (let i = 1; i <= CYCLES; i++)
		{
			editCycle(blueprint, i);
		}
		await settle(blueprint);
		const after = memory(renderer);

		// Same topology throughout, so the same number of surfaces: the count must
		// land where it started. Allowed a small slack for a decode that has not
		// been uploaded yet on the frame we happen to read.
		expect(after.geometries - before.geometries).toBeLessThanOrEqual(2);
		expect(after.textures - before.textures).toBeLessThanOrEqual(2);
	});

	it('unmounting gives back everything the viewer built', async () =>
	{
		// ## What "everything the viewer built" excludes, and why that is right
		//
		// Not quite zero, and the remainder is the A0 ownership boundary showing up
		// in the measurement. Two geometries survive: `room.floorPlane` and
		// `room.roofPlane`, the invisible hit-test meshes the MODEL owns. The view
		// borrows them - `Floor.addToScene()` puts them in the scene, which is what
		// gets them uploaded - and `Floor.dispose()` deliberately does not release
		// them, because the model is still holding them and picking still needs
		// them.
		//
		// That is `BlueprintJS.dispose()`'s documented contract: the model is left
		// standing so a caller can serialize it, or mount a new viewer over it. So
		// the honest assertion is not "zero" but "nothing beyond what the model
		// still owns", and the second half of this test proves the remainder really
		// is the model's by disposing the model too.
		const first = mount();
		await settle(first);
		const renderer = rendererOf(first);
		const withViewer = memory(renderer);
		expect(withViewer.geometries).toBeGreaterThan(0);

		const rooms = first.model.floorplan.getRooms();
		const modelOwned = rooms.length * 2;
		expect(modelOwned).toBeGreaterThan(0);

		first.dispose();

		// Read through the same renderer: dispose() releases the context, but the
		// info object is a plain counter and survives to be read.
		const after = memory(renderer);
		expect(after.geometries).toBe(modelOwned);
		expect(after.textures).toBe(0);

		// And the remainder really is the model's: release the rooms and it goes.
		rooms.forEach((room) => room.dispose());
		expect(memory(renderer).geometries).toBe(0);
	});

	it('mount and unmount five times over does not accumulate', async () =>
	{
		// The shape of leak a single mount/unmount pair cannot show: something that
		// leaks per cycle rather than per edit. Each cycle here builds its own
		// model as well as its own viewer, so the residue is per-cycle too and is
		// released explicitly - what must not happen is that it grows.
		const mounted = [];
		const residues = [];
		for (let cycle = 0; cycle < 5; cycle++)
		{
			const blueprint = mount();
			await settle(blueprint);
			const renderer = rendererOf(blueprint);
			mounted.push(memory(renderer).geometries);

			const rooms = blueprint.model.floorplan.getRooms();
			blueprint.dispose();
			residues.push(memory(renderer).geometries);
			rooms.forEach((room) => room.dispose());
			expect(memory(renderer).geometries).toBe(0);
		}

		// Every cycle uploaded the same scene, so every reading should agree.
		mounted.forEach((reading) => expect(reading).toBe(mounted[0]));
		residues.forEach((reading) => expect(reading).toBe(residues[0]));
	});
});

describe('two viewers are independent', () =>
{
	it('disposing one does not touch the other', async () =>
	{
		// The guard on A0's own risk: over-disposal is worse than the leak, because
		// it is intermittent and it corrupts a frame somewhere else. Before A0,
		// Main.dispose() ended with an unconditional clearTextureCache().
		const a = mount();
		const b = mount();
		await settle(a);
		await settle(b);

		const bRenderer = rendererOf(b);
		const bBefore = memory(bRenderer);
		const cacheBefore = textureCacheStats();
		expect(bBefore.geometries).toBeGreaterThan(0);
		expect(cacheBefore.urls).toBeGreaterThan(0);

		a.dispose();
		await settle(b);

		// B's uploads are untouched, and the images behind them are still cached -
		// so B does not have to re-decode anything because A went away.
		const bAfter = memory(bRenderer);
		expect(bAfter.geometries).toBe(bBefore.geometries);
		expect(bAfter.textures).toBe(bBefore.textures);
		expect(textureCacheStats().urls).toBeGreaterThan(0);
	});

	it('the survivor still draws a real frame', async () =>
	{
		// Memory counts alone would be satisfied by a viewer that kept its uploads
		// and drew nothing. This is the other half of the same claim.
		const a = mount();
		const b = mount();
		await settle(a);
		await settle(b);

		a.dispose();
		await settle(b);

		const gl = b.three.renderer.getContext();
		const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
		gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		const seen = new Set();
		for (let i = 0; i < pixels.length; i += 4)
		{
			seen.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
		}
		expect(seen.size).toBeGreaterThan(20);
	});
});
