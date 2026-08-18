// @vitest-environment jsdom
/**
 * The plan on paper (RM-008 E4).
 *
 * M-34 is the metric this file exists for, and it is deliberately **not** a
 * pixel comparison. Two backends cannot produce the same pixels - one
 * rasterises and the other emits path data - so comparing images would be
 * comparing rasterisers. What has to agree is the geometry: the same plan,
 * drawn through both, must issue the same primitive calls with the same
 * arguments in the same order. A recording backend beside the two real ones is
 * how that is asserted, and it is also the cheapest possible proof that the
 * export is the view's own `draw()` rather than a second renderer.
 *
 * The other half of the acceptance is physical: a wall measured with a ruler on
 * a printed 1:100 sheet is its modelled length. That cannot be run in CI, so
 * what is asserted here is the arithmetic it rests on - the pixel width of a
 * known wall on the sheet, divided by the pixels in a centimetre of paper.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes, floorplannerPalette} from '../src/scripts/floorplanner/floorplanner_view.js';
import {CanvasBackend, SvgBackend} from '../src/scripts/floorplanner/backends.js';
import {
	planBounds, scaleProjection, fitProjection, exportPlanSVG, renderPlanToCanvas,
	drawTitleBlock, PIXELS_PER_PAPER_CM,
} from '../src/scripts/floorplanner/plan_export.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

/**
 * A backend that records rather than draws.
 *
 * The whole of M-34's method: it implements the same eleven operations and
 * keeps what it was called with, so "the same plan through both backends
 * produces the same geometry" becomes an equality between two arrays.
 */
function recorder()
{
	const calls = [];
	const push = (name) => (...args) => {calls.push({name, args});};
	return {
		calls,
		clear: push('clear'),
		fillRect: push('fillRect'),
		line: push('line'),
		curve: push('curve'),
		polygon: push('polygon'),
		path: push('path'),
		circle: push('circle'),
		arc: push('arc'),
		text: push('text'),
		dash: push('dash'),
		measureText: (text) => String(text).length * 6,
	};
}

/** Every call, flattened to a comparable string. */
function fingerprint(calls)
{
	return calls.map((call) => `${call.name}(${JSON.stringify(call.args)})`);
}

function squareRoom(size)
{
	const corners = [
		floorplan.newCorner(0, 0),
		floorplan.newCorner(size, 0),
		floorplan.newCorner(size, size),
		floorplan.newCorner(0, size),
	];
	for (let i = 0; i < 4; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	return corners;
}

/**
 * A plan with one of everything the exporter has to carry.
 *
 * Eight metres rather than four, and the note is placed in a corner rather than
 * mid-room. At 1:100 a four-metre room is four centimetres of paper, the whole
 * label stack lands inside it, and E3's declutter pass correctly suppresses most
 * of it - which is right on a sheet and useless as a fixture for asserting that
 * labels reach one.
 */
function furnishedPlan()
{
	const corners = squareRoom(800);
	floorplan.getRooms()[0].name = 'Sitting Room';
	floorplan.getRooms()[0].type = 'Living';
	floorplan.newDimension(0, 0, 800, 0, {offset: 60, aCorner: corners[0].id});
	floorplan.newAnnotation(700, 700, 'Service duct');
	floorplan.north = 30;
	return corners;
}

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	clock = installFrameClock(window);
	const dom = buildFloorplannerDom(window, {width: 1000, height: 800});
	floorplan = new Floorplan();
	planner = new Floorplanner2D(dom.canvas, floorplan);
	planner.setMode(floorplannerModes.MOVE);
});

afterEach(() =>
{
	planner.dispose();
	clock.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('M-34 · the same plan through both backends', () =>
{
	it('issues the same primitives, in the same order, with the same arguments', () =>
	{
		furnishedPlan();
		const bounds = planBounds(floorplan);
		const sheet = scaleProjection(bounds, 100);
		const size = {width: sheet.width, height: sheet.height};

		const first = recorder();
		planner.view.renderTo(first, sheet.project, size);
		const second = recorder();
		planner.view.renderTo(second, sheet.project, size);

		expect(fingerprint(first.calls)).toEqual(fingerprint(second.calls));
		expect(first.calls.length).toBeGreaterThan(20);
	});

	/**
	 * The real comparison: the geometry a recording backend sees is exactly what
	 * both real backends are handed, so a call the SVG backend cannot express
	 * would show up here as a missing element rather than as a wrong picture
	 * somebody notices after printing.
	 */
	it('reaches the SVG backend with every call the canvas one gets', () =>
	{
		furnishedPlan();
		const bounds = planBounds(floorplan);
		const sheet = scaleProjection(bounds, 100);
		const size = {width: sheet.width, height: sheet.height};

		const recorded = recorder();
		planner.view.renderTo(recorded, sheet.project, size);

		const svg = new SvgBackend(sheet.width, sheet.height, {measure: recorded.measureText});
		planner.view.renderTo(svg, sheet.project, size);

		// Every call that puts something on the page produces one element. `clear`
		// and `dash` set state instead, so they are the two that do not.
		const drawing = recorded.calls.filter((call) => call.name !== 'clear' && call.name !== 'dash');
		expect(svg.elements).toHaveLength(drawing.length);
	});

	it('draws the same geometry into a canvas as it writes into the SVG', () =>
	{
		furnishedPlan();
		const bounds = planBounds(floorplan);
		const sheet = scaleProjection(bounds, 100);
		const size = {width: sheet.width, height: sheet.height};

		canvasStub.context.calls.length = 0;
		const canvasBackend = new CanvasBackend(canvasStub.context, floorplannerPalette.labelFont);
		planner.view.renderTo(canvasBackend, sheet.project, size);
		const moves = canvasStub.context.calls
			.filter((call) => call.name === 'moveTo')
			.map((call) => call.args.map((n) => Math.round(n * 100) / 100));

		const svg = new SvgBackend(sheet.width, sheet.height, {measure: () => 30});
		planner.view.renderTo(svg, sheet.project, size);
		const starts = svg.elements
			.filter((element) => element.indexOf('<path d="M ') === 0)
			.map((element) => /^<path d="M (-?[\d.]+) (-?[\d.]+)/.exec(element))
			.filter(Boolean)
			.map((match) => [Number(match[1]), Number(match[2])]);

		// Every path the SVG starts, the canvas started at the same coordinate.
		expect(starts.length).toBeGreaterThan(0);
		starts.forEach((start) =>
		{
			expect(moves.some((move) => Math.abs(move[0] - start[0]) < 0.02 && Math.abs(move[1] - start[1]) < 0.02)).toBe(true);
		});
	});
});

describe('a stated scale is a physical promise', () =>
{
	/**
	 * The half of the acceptance a printer would check. CSS defines an inch as
	 * 96 pixels, so a centimetre of paper is 96/2.54 of them; a four-metre wall
	 * at 1:100 is four centimetres of paper, and this asserts that arithmetic
	 * rather than the ink it eventually becomes.
	 */
	it('puts a four-metre wall at four centimetres on a 1:100 sheet', () =>
	{
		squareRoom(400);
		const sheet = scaleProjection(planBounds(floorplan), 100);

		const wallPixels = sheet.project.convertX(400) - sheet.project.convertX(0);

		expect(wallPixels / PIXELS_PER_PAPER_CM).toBeCloseTo(4, 6);
	});

	it('doubles it at 1:50 and halves it at 1:200', () =>
	{
		squareRoom(400);

		const at50 = scaleProjection(planBounds(floorplan), 50);
		const at200 = scaleProjection(planBounds(floorplan), 200);

		expect((at50.project.convertX(400) - at50.project.convertX(0)) / PIXELS_PER_PAPER_CM).toBeCloseTo(8, 6);
		expect((at200.project.convertX(400) - at200.project.convertX(0)) / PIXELS_PER_PAPER_CM).toBeCloseTo(2, 6);
	});

	it('sizes the sheet to the drawing plus its margins', () =>
	{
		squareRoom(400);
		const sheet = scaleProjection(planBounds(floorplan), 100);

		// 4 cm of drawing plus 1.5 cm each side.
		expect(sheet.width / PIXELS_PER_PAPER_CM).toBeCloseTo(7, 6);
		// And the title block on top of that, below the drawing.
		expect(sheet.height).toBeGreaterThan(sheet.width);
	});

	/**
	 * A PNG has no physical size, so `fitProjection` takes a pixel width and the
	 * scale is an outcome. Asserted because the difference between the two is
	 * the reason PNG export offers no ratio.
	 */
	it('fits a plan to a pixel width instead, whatever it measures', () =>
	{
		squareRoom(400);
		const sheet = fitProjection(planBounds(floorplan), 1200);

		expect(sheet.width).toBe(1200);
		expect(sheet.project.convertX(0)).toBeCloseTo(1.5 * PIXELS_PER_PAPER_CM, 6);
		expect(sheet.project.convertX(400)).toBeCloseTo(1200 - 1.5 * PIXELS_PER_PAPER_CM, 6);
	});
});

describe('what the sheet covers', () =>
{
	it('is null for a plan with nothing in it', () =>
	{
		expect(planBounds(floorplan)).toBeNull();
		expect(exportPlanSVG(planner.view, floorplan, {scale: 100})).toBeNull();
	});

	it('covers the corners', () =>
	{
		squareRoom(400);

		expect(planBounds(floorplan)).toEqual({minX: 0, minY: 0, maxX: 400, maxY: 400});
	});

	/**
	 * A dimension is drawn *outside* the walls, which is where a dimension
	 * belongs. A sheet cropped to the walls would cut it off - and cut off the
	 * one thing the export exists for.
	 */
	it('covers a dimension line drawn outside the walls', () =>
	{
		squareRoom(400);
		floorplan.newDimension(0, 0, 400, 0, {offset: -90});


		expect(planBounds(floorplan).minY).toBe(-90);
	});

	it('covers a label placed away from the building', () =>
	{
		squareRoom(400);
		floorplan.newAnnotation(700, 700, 'Garden');

		const bounds = planBounds(floorplan);
		expect(bounds.maxX).toBe(700);
		expect(bounds.maxY).toBe(700);
	});
});

describe('the sheet carries what a drawing carries', () =>
{
	it('writes a well-formed document with a title', () =>
	{
		furnishedPlan();

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 50, title: 'Ground floor'});

		expect(svg.indexOf('<?xml version="1.0"')).toBe(0);
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('<title>Ground floor</title>');
		expect(svg.trim().endsWith('</svg>')).toBe(true);
	});

	it('states the ratio, and draws a scale bar beside it', () =>
	{
		furnishedPlan();

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 50});

		expect(svg).toContain('>1:50<');
		// The bar's zero end, which nothing else on the sheet draws.
		expect(svg).toContain('>0<');
	});

	/**
	 * A PNG has no physical size, so its title block says so rather than printing
	 * a ratio nothing can hold to. The scale bar is what stays true through a
	 * photocopier, which is why it is drawn on both.
	 */
	it('says "not to scale" on a sheet that has no stated one', () =>
	{
		furnishedPlan();
		const sheet = fitProjection(planBounds(floorplan), 1200);
		const svg = new SvgBackend(sheet.width, sheet.height, {measure: () => 20});

		drawTitleBlock(svg, sheet, {dimensioning: planner.view.dimensioning, scale: null});
		const document_ = svg.toSVG();

		expect(document_).toContain('not to scale');
		expect(document_).toContain('>0<');
	});

	it('carries the drawing, not the session', () =>
	{
		furnishedPlan();
		// State that belongs to the person at the keyboard, not to the building.
		planner.showSelection('wall', floorplan.getWalls()[0]);
		planner.activeCorner = floorplan.getCorners()[0];

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100});

		expect(svg).not.toContain(floorplannerPalette.wallSelected);
		expect(svg).not.toContain(floorplannerPalette.cornerHover);
		// The origin marker, asserted by its shape rather than its colour: the
		// palette gives it the same #0000FF the room area label uses, so a colour
		// test passes for the wrong reason. Its four rectangles are 4x15, 15x4 and
		// two smaller, and nothing else on the sheet draws a rect that tall.
		expect(svg).not.toContain('height="15"');
	});

	it('draws the plan itself: a room, its walls and its labels', () =>
	{
		furnishedPlan();

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100, measure: () => 30});

		expect(svg).toContain('Sitting Room');
		expect(svg).toContain('Living');
		expect(svg).toContain('Service duct');
		// North, which a plan without one cannot say which way the building faces.
		expect(svg).toContain('>N<');
	});

	it('puts the view back after drawing a sheet', () =>
	{
		furnishedPlan();
		const backend = planner.view.backend;
		const project = planner.view.project;
		const width = planner.view.canvasWidth;

		exportPlanSVG(planner.view, floorplan, {scale: 100});

		expect(planner.view.backend).toBe(backend);
		expect(planner.view.project).toBe(project);
		expect(planner.view.canvasWidth).toBe(width);
		expect(planner.view.exporting).toBe(false);
	});

	it('puts it back even when the drawing throws', () =>
	{
		furnishedPlan();
		const backend = planner.view.backend;
		const broken = recorder();
		broken.line = () => {throw new Error('no ink');};

		expect(() =>
		{
			planner.view.renderTo(broken, {convertX: (x) => x, convertY: (y) => y}, {width: 100, height: 100});
		}).toThrow('no ink');

		expect(planner.view.backend).toBe(backend);
		expect(planner.view.exporting).toBe(false);
	});
});

describe('the scale bar states a length a person would write', () =>
{
	/**
	 * The bar is a round length of *building* drawn at the sheet's own scale, so
	 * a ruler laid on any copy of the sheet still tells the truth - which is why
	 * every survey drawing carries one and why it is worth more than the ratio
	 * beside it. The rounding is to 1, 2 or 5 times a power of ten, because
	 * "3.7 m" on a scale bar is not a scale bar.
	 */
	function barLabel(scaleDenominator)
	{
		squareRoom(2000);
		const sheet = scaleProjection(planBounds(floorplan), scaleDenominator);
		const svg = new SvgBackend(sheet.width, sheet.height, {measure: () => 20});
		drawTitleBlock(svg, sheet, {dimensioning: planner.view.dimensioning, scale: scaleDenominator});
		// The far end of the bar, which is the only 9px label that is not '0'.
		const labels = svg.elements
			.filter((element) => element.indexOf('font-size="9"') > 0)
			.map((element) => /> ?([^<]*)<\/text>/.exec(element)[1]);
		return labels[labels.length - 1];
	}

	it('rounds to something round at every scale offered', () =>
	{
		[20, 50, 100, 200].forEach((ratio) =>
		{
			const label = barLabel(ratio);
			const centimetres = Number(String(label).replace(/[^0-9.]/g, ''));
			const digits = centimetres / Math.pow(10, Math.floor(Math.log10(centimetres)));
			expect([1, 2, 5], `at 1:${ratio} the bar reads ${label}`).toContain(Math.round(digits));
		});
	});
});

describe('the PNG path', () =>
{
	it('sizes the canvas to the sheet and reports what it drew', () =>
	{
		squareRoom(400);
		const canvas = document.createElement('canvas');

		const drawn = renderPlanToCanvas(planner.view, floorplan, canvas, {width: 1200});

		expect(drawn.width).toBe(1200);
		expect(canvas.width).toBe(1200);
		expect(canvas.height).toBe(drawn.height);
	});

	it('is null for a plan with nothing in it', () =>
	{
		const canvas = document.createElement('canvas');

		expect(renderPlanToCanvas(planner.view, floorplan, canvas, {width: 800})).toBeNull();
	});
});
