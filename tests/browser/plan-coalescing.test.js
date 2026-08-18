/**
 * Frame coalescing against a real frame clock (RM-002 R-05, P6, tier 2).
 *
 * `tests/floorplanner-2d.test.js` proves the same behaviour under jsdom with a
 * hand-driven clock, which is the right place for the edge cases - dispose
 * cancellation, the no-rAF fallback, a deferred resize superseded by an explicit
 * one. All of it runs against a `requestAnimationFrame` the test itself wrote.
 *
 * This file exists because that is exactly the assumption worth checking
 * somewhere. Here the frames come from chromium's compositor, the pointer events
 * are real PointerEvents dispatched at a real canvas, and the draws land in a
 * real 2D context. If `invalidate()` coalesced only against a stub - a captured
 * reference, a handle the browser numbers differently, a frame that never fires
 * because the canvas is offscreen - the jsdom suite would not notice and this
 * one would.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {Configuration, configDimUnit, scale} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

let canvas;
let floorplanner;

/** Wait out one compositor frame, then a second so the first one's work lands. */
function nextFrame()
{
	return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Count draws by wrapping the view's own method. */
function recordDraws(view)
{
	const original = view.draw.bind(view);
	const counter = {count: 0};
	view.draw = function ()
	{
		counter.count += 1;
		return original();
	};
	return counter;
}

/** A real PointerEvent at the canvas, in viewport coordinates. */
function firePointer(type, x, y)
{
	canvas.dispatchEvent(new PointerEvent(type, {
		clientX: x, clientY: y, pointerType: 'mouse', bubbles: true, cancelable: true,
	}));
}

function build()
{
	const floorplan = new Floorplan();
	const a = floorplan.newCorner(0, 0);
	const b = floorplan.newCorner(400, 0);
	const c = floorplan.newCorner(400, 400);
	const d = floorplan.newCorner(0, 400);
	floorplan.newWall(a, b);
	floorplan.newWall(b, c);
	floorplan.newWall(c, d);
	floorplan.newWall(d, a);
	floorplan.update();

	floorplanner = new Floorplanner2D(canvas, floorplan);
	floorplanner.view.draw();
	return floorplan;
}

beforeEach(() =>
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(scale, 1);

	canvas = document.createElement('canvas');
	canvas.id = 'floorplanner-canvas';
	canvas.style.display = 'block';
	canvas.style.width = '900px';
	canvas.style.height = '640px';
	document.body.appendChild(canvas);
});

afterEach(() =>
{
	if (floorplanner)
	{
		floorplanner.dispose();
		floorplanner = null;
	}
	canvas.remove();
});

describe('the plan coalesces its repaints on a real frame clock', () =>
{
	it('repaints once for a burst of pointer moves', async () =>
	{
		build();
		await nextFrame();
		const draws = recordDraws(floorplanner.view);

		const box = canvas.getBoundingClientRect();
		firePointer('pointerdown', box.left + 100, box.top + 100);
		for (let i = 1; i <= 30; i++)
		{
			firePointer('pointermove', box.left + 100 + i, box.top + 100 + i);
		}

		// Nothing yet: thirty events, no repaint. Before P6 this was ninety - the
		// drag path reaches all three pointermove draw sites on every event.
		expect(draws.count).toBe(0);

		await nextFrame();
		expect(draws.count).toBe(1);

		floorplanner.dispose();
	});

	it('the coalesced frame really did paint - the canvas is not left stale', async () =>
	{
		// Counting draws proves the scheduling. This proves the scheduling ends in
		// pixels, which is the failure mode a counter cannot see: a frame that runs
		// after the canvas has been resized to nothing, or into a context that was
		// reset, draws exactly once and shows nothing.
		build();
		await nextFrame();

		const context = canvas.getContext('2d');
		const width = floorplanner.view.canvasWidth;
		const height = floorplanner.view.canvasHeight;

		context.clearRect(0, 0, width, height);
		const blank = context.getImageData(0, 0, width, height).data;
		let blankInk = 0;
		for (let i = 3; i < blank.length; i += 4)
		{
			if (blank[i] !== 0) { blankInk += 1; }
		}
		expect(blankInk).toBe(0);

		// A drag rather than a bare move. A single hover move over a room draws
		// nothing at all - `mousemove` only sets its `draw` flag when the hovered
		// corner or wall changed, or when nothing is hovered - which is pre-P6
		// behaviour and not what this test is about.
		const box = canvas.getBoundingClientRect();
		firePointer('pointerdown', box.left + 120, box.top + 120);
		firePointer('pointermove', box.left + 124, box.top + 124);
		await nextFrame();

		const after = context.getImageData(0, 0, width, height).data;
		let ink = 0;
		for (let i = 3; i < after.length; i += 4)
		{
			if (after[i] !== 0) { ink += 1; }
		}
		expect(ink).toBeGreaterThan(0);

		floorplanner.dispose();
	});

	it('a frame booked by the last event before teardown never runs', async () =>
	{
		// The unmount race, with real timing: chromium has genuinely queued the
		// callback by this point, so cancelling it is the only thing that stops it
		// drawing through a disposed carbon sheet into a detached canvas.
		build();
		await nextFrame();
		const draws = recordDraws(floorplanner.view);

		const box = canvas.getBoundingClientRect();
		firePointer('pointermove', box.left + 50, box.top + 50);
		floorplanner.dispose();
		floorplanner = null;

		await nextFrame();
		expect(draws.count).toBe(0);
	});
});
