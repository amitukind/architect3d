// @ts-check
import {CanvasBackend, SvgBackend} from './backends.js';
import {floorplannerPalette} from './floorplanner_view.js';
import {dimensionLine} from '../model/annotation.js';

/**
 * The plan, on paper (RM-008 E4).
 *
 * ## What this is and is not
 *
 * It is **not** a renderer. Every mark on the sheet below the title block is
 * drawn by `FloorplannerView2D.draw()` - the same walls, rooms, footprints,
 * dimensions and labels, in the same order, from the same code. This module
 * decides three things the screen never has to: how big the paper is, what one
 * centimetre of building measures on it, and what goes in the margin.
 *
 * That division is the whole reason RM-008 T-5 counted canvas calls before this
 * sprint was priced. A second renderer would be a second thing to keep in step,
 * and the first time it fell behind an exported sheet would quietly stop
 * matching the screen - which is the failure a person only notices after they
 * have printed and handed over the drawing.
 *
 * ## Scale is a physical claim
 *
 * A sheet marked 1:50 is a promise that a ruler laid on it will agree with the
 * model. That promise is kept in exactly one place, {@link scaleProjection},
 * and it rests on one constant: CSS defines an inch as 96 pixels, so a
 * centimetre of paper is 96/2.54 pixels. An SVG whose width is stated in those
 * pixels prints at the size it says it is.
 *
 * A PNG has no physical size at all - it is pixels, and how big they come out
 * depends on the printer - so PNG export takes a pixel width and fits the plan
 * to it. Offering a PNG "at 1:100" would be a promise nothing can keep.
 */

/** CSS pixels in one centimetre of paper: 96 per inch, 2.54 cm per inch. */
export const PIXELS_PER_PAPER_CM = 96 / 2.54;

/** The scales the application offers, and the one it starts on. */
export const PLAN_SCALES = Object.freeze([20, 50, 100, 200]);

/** Margin around the drawing on an exported sheet, in paper centimetres. */
const SHEET_MARGIN_CM = 1.5;

/** Height of the title block strip along the bottom, in paper centimetres. */
const TITLE_BLOCK_CM = 2.2;

/**
 * Everything the plan occupies, in centimetres (RM-008 E4).
 *
 * Corners, item footprints, dimension lines *including their offset* and text
 * anchors. All four, because a sheet cropped to the walls cuts off the
 * dimensions that were drawn outside them - which is where dimensions belong,
 * and would make the export useless for the one thing it is for.
 *
 * Null for a plan with nothing in it: there is no meaningful box around
 * nothing, and a caller has to decide what to do about that rather than be
 * handed a zero-sized sheet.
 *
 * @param {import('../model/floorplan.js').Floorplan} floorplan
 * @returns {?{minX: number, minY: number, maxX: number, maxY: number}} Centimetres.
 */
export function planBounds(floorplan)
{
	var minX = Infinity;
	var minY = Infinity;
	var maxX = -Infinity;
	var maxY = -Infinity;
	var seen = false;

	function include(x, y)
	{
		if (!isFinite(x) || !isFinite(y))
		{
			return;
		}
		seen = true;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}

	floorplan.getCorners().forEach(function (corner) {include(corner.x, corner.y);});
	(floorplan.itemProjection || []).forEach(function (footprint)
	{
		// The half-extents rather than the centre, and unrotated: a rotated
		// footprint's true extent is at most its diagonal, and reaching for the
		// exact one would be precision nobody can see against a 1.5 cm margin.
		var reach = Math.max(footprint.halfWidth, footprint.halfDepth);
		include(footprint.x - reach, footprint.y - reach);
		include(footprint.x + reach, footprint.y + reach);
	});
	(floorplan.dimensions || []).forEach(function (dimension)
	{
		var line = dimensionLine(dimension);
		if (!line)
		{
			return;
		}
		include(line.ax, line.ay);
		include(line.bx, line.by);
	});
	(floorplan.annotations || []).forEach(function (annotation)
	{
		include(annotation.x, annotation.y);
	});

	return seen ? {minX: minX, minY: minY, maxX: maxX, maxY: maxY} : null;
}

/**
 * A projection and a sheet size for a stated scale (RM-008 E4).
 *
 * The sheet is as big as the drawing needs at that scale, plus the margin and
 * the title block. That is the right way round: a scale is a promise about the
 * building, and forcing it onto a fixed paper size would mean either cropping
 * the plan or breaking the promise.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds Centimetres.
 * @param {number} scale The denominator: 50 means 1:50.
 * @returns {{project: {convertX: function(number): number, convertY: function(number): number},
 *            width: number, height: number, pixelsPerCm: number,
 *            drawing: {x: number, y: number, width: number, height: number}}}
 */
export function scaleProjection(bounds, scale)
{
	var pixelsPerCm = PIXELS_PER_PAPER_CM / scale;
	var margin = SHEET_MARGIN_CM * PIXELS_PER_PAPER_CM;
	var block = TITLE_BLOCK_CM * PIXELS_PER_PAPER_CM;
	var drawingWidth = (bounds.maxX - bounds.minX) * pixelsPerCm;
	var drawingHeight = (bounds.maxY - bounds.minY) * pixelsPerCm;
	return {
		project: {
			convertX: function (x) {return margin + (x - bounds.minX) * pixelsPerCm;},
			convertY: function (y) {return margin + (y - bounds.minY) * pixelsPerCm;},
		},
		width: drawingWidth + margin * 2,
		height: drawingHeight + margin * 2 + block,
		pixelsPerCm: pixelsPerCm,
		drawing: {x: margin, y: margin, width: drawingWidth, height: drawingHeight},
	};
}

/**
 * A projection and a sheet size that fits the plan into a pixel width
 * (RM-008 E4).
 *
 * What a PNG gets, because a PNG has no physical size: it is pixels, and how
 * large they come out is the printer's business. Offering "a PNG at 1:100"
 * would be a promise nothing can keep, so the scale is an *outcome* here and is
 * reported back so the scale bar can still state it truthfully.
 *
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} bounds
 * @param {number} pixelWidth The image's width.
 * @returns {ReturnType<typeof scaleProjection>}
 */
export function fitProjection(bounds, pixelWidth)
{
	var margin = SHEET_MARGIN_CM * PIXELS_PER_PAPER_CM;
	var block = TITLE_BLOCK_CM * PIXELS_PER_PAPER_CM;
	var span = Math.max(bounds.maxX - bounds.minX, 1);
	var available = Math.max(pixelWidth - margin * 2, 1);
	var pixelsPerCm = available / span;
	var drawingHeight = (bounds.maxY - bounds.minY) * pixelsPerCm;
	return {
		project: {
			convertX: function (x) {return margin + (x - bounds.minX) * pixelsPerCm;},
			convertY: function (y) {return margin + (y - bounds.minY) * pixelsPerCm;},
		},
		width: pixelWidth,
		height: drawingHeight + margin * 2 + block,
		pixelsPerCm: pixelsPerCm,
		drawing: {x: margin, y: margin, width: available, height: drawingHeight},
	};
}

/**
 * Round a length in centimetres down to something a person would write on a
 * scale bar: 1, 2 or 5 times a power of ten.
 *
 * @param {number} centimetres
 * @returns {number}
 */
function niceLength(centimetres)
{
	if (!(centimetres > 0))
	{
		return 100;
	}
	var power = Math.pow(10, Math.floor(Math.log10(centimetres)));
	var digits = centimetres / power;
	var rounded = digits >= 5 ? 5 : digits >= 2 ? 2 : 1;
	return rounded * power;
}

/**
 * The scale bar, the title block and the border (RM-008 E4).
 *
 * The scale bar exists because the ratio in the corner stops being true the
 * moment somebody photocopies the sheet at 90 %, and the bar does not: it is
 * drawn at the same scale as the drawing, so a ruler laid on it always tells
 * the truth about that copy. That is why every survey drawing carries one, and
 * it is worth more than the ratio it sits next to.
 *
 * Drawn through the backend like everything else, so both formats get it.
 *
 * @param {Object} backend
 * @param {ReturnType<typeof scaleProjection>} sheet
 * @param {Object} options
 * @param {import('../core/dimensioning.js').Dimensioning} options.dimensioning
 * @param {string} [options.title]
 * @param {string} [options.subtitle]
 * @param {?number} [options.scale] The denominator, when there is a stated one.
 * @returns {void}
 */
export function drawTitleBlock(backend, sheet, options)
{
	var margin = SHEET_MARGIN_CM * PIXELS_PER_PAPER_CM;
	var ink = floorplannerPalette.label;
	var top = sheet.height - margin - TITLE_BLOCK_CM * PIXELS_PER_PAPER_CM;

	// A border, because a sheet with no edge does not read as a sheet - it reads
	// as a screenshot with white round it.
	backend.polygon(
		[margin / 2, sheet.width - margin / 2, sheet.width - margin / 2, margin / 2],
		[margin / 2, margin / 2, sheet.height - margin / 2, sheet.height - margin / 2],
		null, ink, 1);
	backend.line(margin / 2, top, sheet.width - margin / 2, top, 1, ink);

	// The bar: a nice round length of BUILDING, drawn at the sheet's own scale.
	var targetPixels = Math.min(sheet.width * 0.25, 220);
	var barCm = niceLength(targetPixels / sheet.pixelsPerCm);
	var barPixels = barCm * sheet.pixelsPerCm;
	var barY = top + 26;
	var barX = margin;
	backend.fillRect(barX, barY, barPixels / 2, 5, ink);
	backend.polygon(
		[barX, barX + barPixels, barX + barPixels, barX],
		[barY, barY, barY + 5, barY + 5],
		null, ink, 1);
	backend.text('0', barX, barY + 16, {color: ink, halo: null, size: 9});
	backend.text(options.dimensioning.cmToMeasure(barCm), barX + barPixels, barY + 16, {color: ink, halo: null, size: 9});

	var right = sheet.width - margin;
	if (options.title)
	{
		backend.text(options.title, right, top + 20, {color: ink, halo: null, size: 13, style: 'bold', anchor: 'end'});
	}
	var caption = options.scale ? `1:${options.scale}` : 'not to scale';
	if (options.subtitle)
	{
		caption += `  ·  ${options.subtitle}`;
	}
	backend.text(caption, right, top + 38, {color: ink, halo: null, size: 10, anchor: 'end'});
}

/**
 * How far the north arrow sits in from the sheet's corner.
 *
 * Far enough to clear the margin and the border drawn inside it, which the
 * screen's own inset does not - at the screen figure the arrow landed in the
 * margin of an exported sheet with half of it above the printed border. Found
 * by exporting one and looking at it.
 *
 * @param {ReturnType<typeof scaleProjection>} sheet
 * @returns {number}
 */
function chromeInset(sheet)
{
	return sheet.drawing.x + 26;
}

/**
 * The plan as an SVG document (RM-008 E4).
 *
 * @param {Object} view A `FloorplannerView2D`.
 * @param {import('../model/floorplan.js').Floorplan} floorplan
 * @param {Object} [options]
 * @param {number} [options.scale] The denominator; 50 means 1:50.
 * @param {string} [options.title]
 * @param {string} [options.subtitle]
 * @param {?function(string, number, string=): number} [options.measure] Text
 *        measurement. Pass the live canvas's, so the sheet hides exactly the
 *        labels the screen hides - see `SvgBackend`.
 * @returns {?string} Null for a plan with nothing in it.
 */
export function exportPlanSVG(view, floorplan, options)
{
	var settings = options || {};
	var bounds = planBounds(floorplan);
	if (!bounds)
	{
		return null;
	}
	var scale = settings.scale || 100;
	var sheet = scaleProjection(bounds, scale);
	var backend = new SvgBackend(sheet.width, sheet.height, {
		font: floorplannerPalette.labelFont,
		measure: settings.measure || null,
	});
	view.renderTo(backend, sheet.project, {width: sheet.width, height: sheet.height, inset: chromeInset(sheet)});
	drawTitleBlock(backend, sheet, {
		dimensioning: view.dimensioning,
		title: settings.title,
		subtitle: settings.subtitle,
		scale: scale,
	});
	return backend.toSVG({title: settings.title || 'Floor plan'});
}

/**
 * The plan drawn into a canvas, ready for `toDataURL` (RM-008 E4).
 *
 * Takes the canvas rather than making one, because this module has no business
 * knowing whether there is a `document`: the library runs headless in the whole
 * test suite and in anybody's build step. The application passes an offscreen
 * canvas; a test passes a stub.
 *
 * @param {Object} view A `FloorplannerView2D`.
 * @param {import('../model/floorplan.js').Floorplan} floorplan
 * @param {HTMLCanvasElement} canvas Resized to fit before drawing.
 * @param {Object} [options]
 * @param {number} [options.width] Pixels. Defaults to the canvas' current width.
 * @param {string} [options.title]
 * @param {string} [options.subtitle]
 * @returns {?{width: number, height: number, scale: number}} What was drawn, or
 *          null for an empty plan.
 */
export function renderPlanToCanvas(view, floorplan, canvas, options)
{
	var settings = options || {};
	var bounds = planBounds(floorplan);
	if (!bounds)
	{
		return null;
	}
	var sheet = fitProjection(bounds, settings.width || canvas.width || 1600);
	canvas.width = Math.ceil(sheet.width);
	canvas.height = Math.ceil(sheet.height);
	var context = canvas.getContext('2d');
	if (!context)
	{
		return null;
	}
	// The ground goes to the backend rather than being painted here: `draw()`
	// opens with `backend.clear()`, so anything painted before `renderTo` is
	// wiped a moment later. See `CanvasBackend.clear`.
	var backend = new CanvasBackend(context, floorplannerPalette.labelFont,
		floorplannerPalette.labelHalo || '#ffffff');
	view.renderTo(backend, sheet.project, {width: sheet.width, height: sheet.height, inset: chromeInset(sheet)});
	drawTitleBlock(backend, sheet, {
		dimensioning: view.dimensioning,
		title: settings.title,
		subtitle: settings.subtitle,
		// An outcome, not a promise: see `fitProjection`. Reported so the bar can
		// state the truth about this image even though its ratio depends on how it
		// is printed.
		scale: null,
	});
	return {width: canvas.width, height: canvas.height, scale: sheet.pixelsPerCm};
}
