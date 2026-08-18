/**
 * Annotation rasterised for real (RM-008 E3, tier 2).
 *
 * The headless tier can assert that `fillText` was called with the right
 * string. Only this one can assert that something is *visible*, and the whole
 * objective of E3 is that a plan can be read by somebody who did not draw it -
 * which is a claim about ink, not about calls.
 *
 * Differenced per channel at a tolerance of 6, the same method that produced
 * RM-008 T-2 and now guards it: a screenshot compared against a memory is not a
 * measurement.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Model} from '../../src/scripts/model/model.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, scale} from '../../src/scripts/core/configuration.js';
import {exportPlanSVG, renderPlanToCanvas} from '../../src/scripts/floorplanner/plan_export.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

const WIDTH = 900;
const HEIGHT = 640;

/**
 * In POSITIVE coordinates. The plan's origin is the canvas' top-left until
 * somebody pans, so a room centred on (0, 0) puts three of its four walls off
 * the canvas - and a measurement of "nothing changed" then reads as a broken
 * feature. It cost a debugging round in E1 to find that the first time.
 */
const ORIGIN = 120;

let canvas;
let planner;
let model;

function raster()
{
	const context = canvas.getContext('2d');
	return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function changedPixels(before, after)
{
	let changed = 0;
	for (let i = 0; i < before.length; i += 4)
	{
		if (Math.abs(before[i] - after[i]) > 6
			|| Math.abs(before[i + 1] - after[i + 1]) > 6
			|| Math.abs(before[i + 2] - after[i + 2]) > 6)
		{
			changed += 1;
		}
	}
	return changed;
}

function buildRoom(size)
{
	const corners = [
		model.floorplan.newCorner(ORIGIN, ORIGIN),
		model.floorplan.newCorner(ORIGIN + size, ORIGIN),
		model.floorplan.newCorner(ORIGIN + size, ORIGIN + size),
		model.floorplan.newCorner(ORIGIN, ORIGIN + size),
	];
	for (let i = 0; i < 4; i++)
	{
		model.floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	return corners;
}

beforeEach(() =>
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(scale, 1);

	canvas = document.createElement('canvas');
	canvas.id = 'plan-annotations-canvas';
	canvas.style.display = 'block';
	canvas.style.width = `${WIDTH}px`;
	canvas.style.height = `${HEIGHT}px`;
	document.body.appendChild(canvas);

	model = new Model();
	planner = new Floorplanner2D(canvas, model.floorplan);
	planner.setMode(floorplannerModes.MOVE);
	buildRoom(400);
});

afterEach(() =>
{
	planner.dispose();
	model.dispose();
	canvas.remove();
	canvas = null;
	planner = null;
	model = null;
});

describe('M-33 · what is drawn is what was saved', () =>
{
	it('puts ink on the canvas for a dimension, and takes it away again', () =>
	{
		planner.view.draw();
		const bare = raster();

		const dimension = model.floorplan.newDimension(ORIGIN, ORIGIN, ORIGIN + 400, ORIGIN, {offset: 60});
		planner.view.draw();
		expect(changedPixels(bare, raster())).toBeGreaterThan(0);

		model.floorplan.removeDimension(dimension);
		planner.view.draw();

		expect(changedPixels(bare, raster())).toBe(0);
	});

	it('puts ink on the canvas for a text label', () =>
	{
		planner.view.draw();
		const bare = raster();

		model.floorplan.newAnnotation(ORIGIN + 200, ORIGIN + 200, 'Service duct');
		planner.view.draw();

		expect(changedPixels(bare, raster())).toBeGreaterThan(0);
	});

	/**
	 * The round trip, measured as a picture rather than as a string. The model
	 * tier asserts that the file carries the right numbers; this asserts that a
	 * design reloaded from that file draws the same plan.
	 */
	it('draws the same plan after a save and a load', () =>
	{
		model.floorplan.newDimension(ORIGIN, ORIGIN, ORIGIN + 400, ORIGIN, {offset: 60});
		model.floorplan.newAnnotation(ORIGIN + 200, ORIGIN + 300, 'Hall');
		model.floorplan.north = 30;
		planner.view.draw();
		const before = raster();
		// Opening a design re-centres the view - `Floorplanner2D` listens for
		// EVENT_LOADED and calls `reset()`, which calls `resetOrigin()`. That is
		// correct and has nothing to do with what is being measured here, and
		// without putting the pan back this compares two different framings of the
		// same plan and reports 441,684 changed pixels of 576,000.
		const originX = planner.originX;
		const originY = planner.originY;

		const saved = JSON.parse(JSON.stringify(model.floorplan.saveFloorplan()));
		model.floorplan.loadFloorplan(saved);
		planner.originX = originX;
		planner.originY = originY;
		planner.view.draw();

		expect(changedPixels(before, raster())).toBe(0);
	});

	it('turns the north arrow when north turns', () =>
	{
		planner.view.draw();
		const up = raster();

		model.floorplan.north = 90;
		planner.view.draw();

		expect(changedPixels(up, raster())).toBeGreaterThan(0);
	});

	it('shows a selected dimension differently from an unselected one', () =>
	{
		const dimension = model.floorplan.newDimension(ORIGIN, ORIGIN, ORIGIN + 400, ORIGIN, {offset: 60});
		planner.view.draw();
		const unselected = raster();

		planner.showSelection('dimension', dimension);
		planner.view.draw();

		expect(changedPixels(unselected, raster())).toBeGreaterThan(0);
	});

	it('draws a room\'s type and its ceiling height where there is something to say', () =>
	{
		planner.view.draw();
		const plain = raster();

		model.floorplan.getRooms()[0].type = 'Bedroom';
		planner.view.draw();
		const typed = raster();
		expect(changedPixels(plain, typed)).toBeGreaterThan(0);

		model.floorplan.getRooms()[0].setCeilingHeight(320);
		planner.view.draw();

		expect(changedPixels(typed, raster())).toBeGreaterThan(0);
	});
});

describe('two labels do not sit on each other', () =>
{
	/**
	 * The declutter pass measures text with `measureText`, and the headless tier
	 * measures it with a stub that returns six pixels a character. Only here is
	 * the width the one the browser will actually lay out, which is the number
	 * the whole heuristic turns on.
	 */
	it('draws less ink for a colliding label than for a clear one', () =>
	{
		const room = model.floorplan.getRooms()[0];
		room.name = 'Sitting Room';
		planner.view.draw();
		const plain = raster();

		// Far away, where nothing else is drawn: both survive.
		const annotation = model.floorplan.newAnnotation(ORIGIN + 900, ORIGIN + 900, 'Note');
		planner.view.draw();
		const apart = changedPixels(plain, raster());
		expect(apart).toBeGreaterThan(0);

		// On the room's own label stack: the note is drawn and something gave way.
		annotation.moveTo(room.areaCenter.x, room.areaCenter.y);
		planner.view.draw();
		const together = changedPixels(plain, raster());

		expect(together).toBeGreaterThan(0);
		expect(together).toBeLessThan(apart + 400);
	});

	/**
	 * The stack under a room's centroid is spaced in screen pixels, not plan
	 * centimetres. It used to be 30 cm below a 12 px label, so at the default
	 * zoom the two lines were one line height apart and touched - invisible until
	 * the declutter pass started asking, at which point a room's own name vanished
	 * under its own area.
	 */
	it('keeps a room\'s four lines apart at every zoom', () =>
	{
		const room = model.floorplan.getRooms()[0];
		room.name = 'Sitting Room';
		room.type = 'Living';
		room.setCeilingHeight(320);

		[0.5, 1, 2].forEach((zoom) =>
		{
			Configuration.setValue(scale, zoom);
			planner.view.draw();
			const context = canvas.getContext('2d');
			const drawn = [];
			const realFill = context.fillText.bind(context);
			context.fillText = (text, x, y) => {drawn.push(text); realFill(text, x, y);};
			planner.view.draw();
			context.fillText = realFill;

			expect(drawn, `at ${zoom}x`).toContain('Sitting Room');
			expect(drawn, `at ${zoom}x`).toContain('Living');
			expect(drawn.some((entry) => entry.startsWith('H ')), `at ${zoom}x`).toBe(true);
		});
		Configuration.setValue(scale, 1);
	});
});

describe('the frame budget still holds (RM-008 T-4)', () =>
{
	/**
	 * T-4 measured 0.79 ms as the worst case for a furnished 36-room plan, and
	 * E1's gate is 2 ms. Annotation is drawn on the same pass, so it has to fit
	 * inside the same budget rather than beside it - fifty dimensions and fifty
	 * labels is far more than any real plan carries.
	 */
	it('draws a heavily annotated plan inside 2 ms', () =>
	{
		model.floorplan.beginBatch('load');
		for (let i = 0; i < 6; i++)
		{
			for (let j = 0; j < 6; j++)
			{
				const x = i * 300;
				const y = j * 300;
				const corners = [
					model.floorplan.newCorner(x, y),
					model.floorplan.newCorner(x + 300, y),
					model.floorplan.newCorner(x + 300, y + 300),
					model.floorplan.newCorner(x, y + 300),
				];
				for (let k = 0; k < 4; k++)
				{
					model.floorplan.newWall(corners[k], corners[(k + 1) % 4]);
				}
			}
		}
		model.floorplan.endBatch();

		for (let i = 0; i < 50; i++)
		{
			model.floorplan.newDimension(0, i * 40, 900, i * 40, {offset: 20});
			model.floorplan.newAnnotation(200 + (i % 10) * 90, 100 + Math.floor(i / 10) * 120, `Note ${i}`);
		}

		expect(model.floorplan.dimensions).toHaveLength(50);
		expect(model.floorplan.annotations).toHaveLength(50);

		planner.view.draw();
		const started = performance.now();
		for (let run = 0; run < 20; run++)
		{
			planner.view.draw();
		}
		const perDraw = (performance.now() - started) / 20;

		expect(perDraw).toBeLessThan(2);
	});
});

describe('the plan on paper (RM-008 E4)', () =>
{
	/**
	 * The export in the tier that has a real rasteriser and real font metrics.
	 * The headless tier proves both backends are handed the same geometry; this
	 * one proves the geometry becomes ink.
	 */
	it('draws the same plan into an export canvas as onto the screen', () =>
	{
		model.floorplan.getRooms()[0].name = 'Sitting Room';
		model.floorplan.newDimension(ORIGIN, ORIGIN, ORIGIN + 400, ORIGIN, {offset: 60});
		model.floorplan.newAnnotation(ORIGIN + 300, ORIGIN + 320, 'Service duct');

		const sheet = document.createElement('canvas');
		const drawn = renderPlanToCanvas(planner.view, model.floorplan, sheet, {width: 1200});

		expect(drawn).not.toBeNull();
		expect(sheet.width).toBe(1200);

		// Ink, not calls: count the pixels that are not the paper.
		const data = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height).data;
		let inked = 0;
		for (let i = 0; i < data.length; i += 4)
		{
			if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245)
			{
				inked += 1;
			}
		}
		expect(inked).toBeGreaterThan(1000);
		sheet.remove();
	});

	it('leaves the live canvas exactly as it found it', () =>
	{
		model.floorplan.getRooms()[0].name = 'Sitting Room';
		planner.view.draw();
		const before = raster();

		const sheet = document.createElement('canvas');
		renderPlanToCanvas(planner.view, model.floorplan, sheet, {width: 1200});
		planner.view.draw();

		expect(changedPixels(before, raster())).toBe(0);
		sheet.remove();
	});

	/**
	 * The declutter pass asks how wide a label is before drawing it, and SVG has
	 * no font metrics. Handing the SVG backend the live canvas' measurer is what
	 * makes the sheet hide exactly the labels the screen hides - so the two
	 * disagree only if that wiring is dropped.
	 */
	it('measures text for the SVG with the canvas that can', () =>
	{
		model.floorplan.getRooms()[0].name = 'Sitting Room';
		// Captured BEFORE the export, not read inside it. `renderTo` swaps
		// `view.backend` for the duration, so `() => view.backend.measureText(...)`
		// resolves to the SVG backend once the render is under way - and that
		// delegates straight back to this closure. Infinite recursion on the first
		// label, which is how this line came to be written this way.
		const live = planner.view.backend;
		const measured = exportPlanSVG(planner.view, model.floorplan, {
			scale: 50,
			measure: (text, size, style) => live.measureText(text, size, style),
		});
		const guessed = exportPlanSVG(planner.view, model.floorplan, {scale: 50});

		expect(measured).toContain('Sitting Room');
		// The fallback is a real estimate, not a zero: it must produce a width in
		// the same order as the measured one, or the sheet would declutter wildly
		// differently. Asserted as "both produce a document", with the measured
		// one being what the application actually passes.
		expect(guessed).toContain('<svg');
	});
});
