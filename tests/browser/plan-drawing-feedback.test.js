/**
 * What the plan tells you while you draw (RM-017 P1, finding AC-3, tier 2).
 *
 * **M-59** is the metric this file carries: *drawing a wall shows its length
 * and the angle to the nearest wall, on the canvas, in the plan's own units.*
 *
 * ## Why a feature this old needed a test written for it
 *
 * It has worked since the 2014 demo and nothing had ever asserted it. AC-3
 * measured that literally: the block that draws the label and the angle arc is
 * executed **once** across the whole headless suite, incidentally, by a case
 * about something else - and no test anywhere claims that a person drawing a
 * wall can see how long it is.
 *
 * It is also one of the few behaviours here that somebody would notice losing
 * within ten seconds. A floor planner whose primary tool draws a rubber band
 * and says nothing is a floor planner you cannot draw a room with, and the two
 * tools this project added itself - RM-008 E2's rectangle and E3's dimension -
 * both give the same feedback, so a regression in the oldest one would look
 * like an inconsistency rather than like a break.
 *
 * And what was written about it was wrong. Above the block sat a comment from
 * the original demo reading *"Enable the below lines for measurement while
 * drawing, still needs work as it is crashing the whole thing"* - the lines
 * enabled, nothing crashing, and the next reader told not to trust the most
 * used verb in the application. P1 deleted it; this is what replaced it.
 *
 * ## Ink, and then the string
 *
 * The claim is about what somebody sees, so the tier is the one with a real
 * canvas and the instrument is `getImageData`. A headless assertion that
 * `drawTextLabel` was called would pass over a label rendered in the
 * background colour, which is exactly the mistake RM-008 T-2 made and RM-004
 * B4 wrote the rule about: *a number that improves is not evidence until the
 * picture is checked.*
 *
 * Pixels cannot say what the label *reads*, though, so the last two cases go
 * through the backend and assert the text. That is the complement rather than
 * the substitute: the raster proves it is visible, and the string proves it is
 * right.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Model} from '../../src/scripts/model/model.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes} from '../../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, scale} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter, dimFeetAndInch} from '../../src/scripts/core/units.js';

const WIDTH = 900;
const HEIGHT = 640;

/** In positive coordinates - see the note in plan-annotations.test.js. */
const ORIGIN = 150;
/** The wall being drawn: 300 cm east of the origin corner. */
const RUN = 300;

let canvas;
let planner;
let model;

function raster()
{
	return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Pixels that differ by more than the tolerance the other raster suites use. */
function changedPixels(before, after, box)
{
	let changed = 0;
	for (let y = box.top; y < box.bottom; y += 1)
	{
		for (let x = box.left; x < box.right; x += 1)
		{
			const i = (y * canvas.width + x) * 4;
			if (Math.abs(before[i] - after[i]) > 6
				|| Math.abs(before[i + 1] - after[i + 1]) > 6
				|| Math.abs(before[i + 2] - after[i + 2]) > 6)
			{
				changed += 1;
			}
		}
	}
	return changed;
}

/** A square room, so there is an existing wall for the angle to be measured to. */
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
	model.floorplan.update();
	return corners;
}

/**
 * Put the tool in the state this metric is about: one corner placed, the
 * pointer somewhere else, nothing committed yet.
 *
 * Through the tool rather than by assigning `lastNode`, because the state
 * being asserted is the one a person reaches by clicking once - and a test
 * that set it directly would keep passing if clicking stopped producing it.
 */
function startDrawing(fromX, fromY, toX, toY)
{
	planner.setMode(floorplannerModes.DRAW);
	const bounds = canvas.getBoundingClientRect();
	const at = (x, y) => ({clientX: bounds.left + x, clientY: bounds.top + y});

	planner.mousedown(at(fromX, fromY));
	planner.mouseup(at(fromX, fromY));
	planner.mousemove(at(toX, toY));
	planner.view.draw();
}

/**
 * A box on the pending wall, `at` of the way along it.
 *
 * Two of these are what make the length assertion a measurement. A box at the
 * midpoint contains the rubber band AND the label; a box of the same size a
 * quarter of the way along contains only the band. Comparing them subtracts
 * the band, which is the thing a single box cannot do - the first version of
 * this file asserted "ink appeared at the midpoint" and passed with the label
 * deliberately deleted, because the band runs straight through it.
 *
 * Measured with the label present and absent, on this fixture:
 *
 *     midpoint   921   ->  407
 *     quarter    417   ->  405
 *
 * So the band is about 410 either way and the label is the other 500.
 */
function boxAlong(fromX, fromY, toX, toY, at)
{
	const cx = fromX + (toX - fromX) * at;
	const cy = fromY + (toY - fromY) * at;
	return {left: Math.round(cx - 60), right: Math.round(cx + 60),
		top: Math.round(cy - 30), bottom: Math.round(cy + 12)};
}

beforeEach(() =>
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(scale, 1);

	canvas = document.createElement('canvas');
	canvas.id = 'plan-drawing-feedback-canvas';
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
	Configuration.setValue(configDimUnit, dimCentiMeter);
	planner.dispose();
	model.dispose();
	canvas.remove();
	canvas = null;
	planner = null;
	model = null;
});

describe('M-59 - the plan says how long the wall will be', () =>
{
	it('puts a measurement on the canvas, and not just a rubber band', () =>
	{
		planner.view.draw();
		const idle = raster();

		startDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160);
		const drawn = raster();

		const onTheLabel = changedPixels(idle, drawn, boxAlong(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160, 0.5));
		const bandOnly = changedPixels(idle, drawn, boxAlong(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160, 0.25));

		expect(onTheLabel, `midpoint ${onTheLabel} vs band-only ${bandOnly}: the label is not there`)
			.toBeGreaterThan(bandOnly * 1.5);
	});

	it('shows something about the angle at the corner, and more of it off the axis', () =>
	{
		planner.view.draw();
		const idle = raster();

		// What this case can and cannot say, stated because the first version of it
		// said more than it could. The guide is two marks - an arc struck about the
		// corner at about 15 px, and the degrees printed on the bisector at about
		// 30 - and the rubber band leaves the same corner through both of them. At
		// that radius no box separates the three, so this asserts the honest claim:
		// the corner region responds to the angle being drawn. Whether the ARC in
		// particular is stroked is asserted below, through the backend, because
		// that is the only instrument that can tell.
		const corner = {left: ORIGIN - 5, right: ORIGIN + 70, top: ORIGIN - 20, bottom: ORIGIN + 70};

		startDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160);
		const offAxis = changedPixels(idle, raster(), corner);

		planner.setMode(floorplannerModes.MOVE);
		planner.view.draw();
		startDrawing(ORIGIN, ORIGIN, ORIGIN + 340, ORIGIN);
		const onAxis = changedPixels(idle, raster(), corner);

		// 721 against 503 when this was written; 380 against 370 with both marks
		// deleted. The threshold sits between the two.
		expect(offAxis, `off-axis ${offAxis} vs on-axis ${onAxis}: no angle guide at all`)
			.toBeGreaterThan(onAxis * 1.25);
	});

	it('says nothing before the first corner is placed', () =>
	{
		// Which is what makes the case above a measurement rather than a tautology:
		// hovering in DRAW mode with nothing placed draws a hover dot and no label,
		// so a build that drew the label unconditionally would fail here.
		planner.view.draw();
		const idle = raster();

		planner.setMode(floorplannerModes.DRAW);
		const bounds = canvas.getBoundingClientRect();
		planner.mousemove({clientX: bounds.left + ORIGIN + RUN, clientY: bounds.top + ORIGIN});
		planner.view.draw();

		const box = boxAlong(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN, 0.5);
		expect(changedPixels(idle, raster(), box)).toBe(0);
	});

	it('takes the label away again when the tool is put down', () =>
	{
		planner.view.draw();
		const idle = raster();
		startDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN);
		const box = boxAlong(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN, 0.5);
		expect(changedPixels(idle, raster(), box)).toBeGreaterThan(0);

		// Leaving the tool drops the pending corner, so the plan goes back to being
		// a drawing of the building - which is also what `setMode` promises.
		planner.setMode(floorplannerModes.MOVE);
		planner.view.draw();

		expect(changedPixels(idle, raster(), box)).toBe(0);
	});
});

/**
 * What the label reads, which pixels cannot say.
 *
 * The backend is the seam: `Floorplanner2D`'s view draws through it, so
 * recording its `text` calls records exactly the strings that reached the
 * canvas in the cases above. Not a substitute for those cases - a string
 * recorded here and rendered invisibly there would pass this and fail that.
 */
describe('M-59 - and it reads in the units the plan is set to', () =>
{
	/** Every string the view drew, in order. */
	function labelsWhileDrawing(fromX, fromY, toX, toY)
	{
		const said = [];
		const backend = planner.view.backend;
		const original = backend.text;
		backend.text = function (...args) {said.push(String(args[0])); return original.apply(this, args);};
		try {startDrawing(fromX, fromY, toX, toY);}
		finally {backend.text = original;}
		return said;
	}

	/**
	 * How far apart the two ends are, in the plan's centimetres.
	 *
	 * Computed here from the coordinates the tool itself ended up with, rather
	 * than from the pixels this file dragged between: the canvas is not 1:1 with
	 * the plan, and a 300-pixel drag is 609.6 cm at the default scale. Getting
	 * that wrong is what the first version of this case did, and the label was
	 * right both times.
	 */
	function pendingLength()
	{
		const dx = planner.targetX - planner.lastNode.x;
		const dy = planner.targetY - planner.lastNode.y;
		return Math.sqrt(dx * dx + dy * dy);
	}

	it('says how far it is, in centimetres, to within a rounding', () =>
	{
		Configuration.setValue(configDimUnit, dimCentiMeter);

		const said = labelsWhileDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN);

		const measurement = said.find((text) => /^[\d.]+cm$/.test(text));
		expect(measurement, `no centimetre measurement in: ${said.join(' | ')}`).toBeTruthy();
		// The distance, arrived at independently of the code that formats it: what
		// could be wrong here is which two points are measured, not how a number
		// becomes a string.
		expect(Number.parseFloat(measurement)).toBeCloseTo(pendingLength(), 1);
	});

	it('says the same wall in feet when the document is in feet', () =>
	{
		// The unit is a property of the document, and the measurement a person
		// reads while drawing has to be in it - a plan drawn to imperial numbers
		// against a metric readout is a room built to the wrong size.
		Configuration.setValue(configDimUnit, dimFeetAndInch);

		const said = labelsWhileDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN);

		expect(said.some((text) => /['\u2032\u201d"]/.test(text)), `drew: ${said.join(' | ')}`).toBe(true);
		expect(said.some((text) => /cm$/.test(text)), `drew: ${said.join(' | ')}`).toBe(false);
	});

	it('says the angle in degrees, beside the length', () =>
	{
		const said = labelsWhileDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160);

		expect(said.some((text) => text.endsWith('°')), `drew: ${said.join(' | ')}`).toBe(true);
	});

	it('strikes the arc between the two directions, which no box can see', () =>
	{
		// The one claim in this file the raster cannot make. The arc sits about 15
		// pixels from the corner, the degrees about 30, and the rubber band passes
		// through both - so a box that contains the arc contains everything, and
		// deleting the arc alone leaves the pixel case above still passing. It was
		// tried, it did, and this is what was added instead.
		const struck = [];
		const backend = planner.view.backend;
		const original = backend.arc;
		backend.arc = function (...args) {struck.push(args); return original.apply(this, args);};
		try
		{
			startDrawing(ORIGIN, ORIGIN, ORIGIN + RUN, ORIGIN + 160);
		}
		finally
		{
			backend.arc = original;
		}

		expect(struck.length, 'no arc was stroked while drawing off the axis').toBeGreaterThan(0);
		// Centred on the corner the wall is drawn from, with a real sweep between
		// its start and end angle - a zero-width arc would draw nothing and pass a
		// bare call count.
		const [, , , from, to] = struck[0];
		expect(Math.abs(to - from)).toBeGreaterThan(0.01);
	});
});
