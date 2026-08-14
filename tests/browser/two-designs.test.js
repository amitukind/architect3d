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
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {Configuration, scale} from '../../src/scripts/core/configuration.js';
import {setFloorplannerPalette, floorplannerPalette} from '../../src/scripts/floorplanner/floorplanner_view.js';
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
