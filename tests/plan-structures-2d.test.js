// @vitest-environment jsdom
/**
 * A column and a beam on the plan, and on a sheet (RM-008 F2).
 *
 * One assertion carries this file, and it is a drawing convention rather than a
 * feature: **a plan is a horizontal section about a metre above the floor**, so
 * a column passes through it and is drawn solid, and a beam is above it and is
 * drawn dashed. Their plan rectangles are otherwise identical, so the dash is
 * the only thing that tells a reader which is which.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {floorplannerModes, floorplannerPalette} from '../src/scripts/floorplanner/floorplanner_view.js';
import {exportPlanSVG} from '../src/scripts/floorplanner/plan_export.js';
import {projectItem} from '../src/scripts/model/plan_projection.js';
import {
	normaliseStructure, structureExtent, STRUCTURE_BEAM, SECTION_ROUND,
} from '../src/scripts/items/structure.js';
import {resetAll} from './helpers/harness.js';
import {buildFloorplannerDom, installCanvas2D, installFrameClock, installResizeObserver} from './helpers/dom.js';

let canvasStub;
let observer;
let clock;
let planner;
let floorplan;

function draw()
{
	canvasStub.context.calls.length = 0;
	planner.view.draw();
	return canvasStub.context.calls.slice();
}

function callNames(calls)
{
	return calls.map((call) => call.name);
}

/** Put a member on the plan, the way `Model` hands one over. */
function place(overrides, at)
{
	const structure = normaliseStructure(overrides || {});
	const extent = structureExtent(structure);
	const where = at || {x: 300, z: 300};
	floorplan.itemProjection = [projectItem({
		designId: 'member-1',
		position: {x: where.x, y: extent.centre, z: where.z},
		halfSize: {x: extent.halfX, y: extent.halfY, z: extent.halfZ},
		rotation: {y: where.rotation || 0},
		metadata: {itemType: 12, itemName: 'Member'},
		structure: structure,
	})];
	return structure;
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

describe('cut or overhead', () =>
{
	it('draws a column solid and a beam dashed', () =>
	{
		place({});
		const column = draw();
		const columnDashes = column.filter((call) => call.name === 'setLineDash' && call.args[0].length);

		place({kind: STRUCTURE_BEAM});
		const beam = draw();
		const beamDashes = beam.filter((call) => call.name === 'setLineDash' && call.args[0].length);

		expect(columnDashes.length).toBe(0);
		expect(beamDashes.length).toBe(1);
	});

	it('fills a column and leaves a beam hollow', () =>
	{
		place({});
		const columnFills = draw().filter((call) => call.name === 'fill').length;

		place({kind: STRUCTURE_BEAM});
		const beamFills = draw().filter((call) => call.name === 'fill').length;

		expect(columnFills).toBeGreaterThan(beamFills);
	});

	it('puts the dash back, so nothing later on the canvas is dotted', () =>
	{
		place({kind: STRUCTURE_BEAM});

		const dashes = draw().filter((call) => call.name === 'setLineDash');

		expect(dashes[dashes.length - 1].args[0]).toEqual([]);
	});
});

describe('the symbol', () =>
{
	it('draws a round column round, from the same field the mesh is built from', () =>
	{
		place({});
		const rectangular = draw();

		place({section: SECTION_ROUND});
		const round = draw();

		// A rectangle is a path of four `lineTo`s; a circle is an `arc`.
		expect(callNames(rectangular).filter((name) => name === 'arc').length).toBe(0);
		expect(callNames(round).filter((name) => name === 'arc').length).toBeGreaterThan(0);
	});

	it('turns a beam with the item', () =>
	{
		place({kind: STRUCTURE_BEAM}, {x: 300, z: 300, rotation: 0});
		const upright = draw().filter((call) => call.name === 'lineTo').map((call) => call.args[0]);

		place({kind: STRUCTURE_BEAM}, {x: 300, z: 300, rotation: Math.PI / 2});
		const turned = draw().filter((call) => call.name === 'lineTo').map((call) => call.args[0]);

		expect(turned.length).toBe(upright.length);
		expect(turned).not.toEqual(upright);
	});

	it('leaves a mesh item as the plain box it has always been', () =>
	{
		floorplan.itemProjection = [projectItem({
			designId: 'chair',
			position: {x: 300, y: 40, z: 300},
			halfSize: {x: 30, y: 40, z: 30},
			rotation: {y: 0},
			metadata: {itemType: 1, itemName: 'Chair'},
		})];

		const dashes = draw().filter((call) => call.name === 'setLineDash' && call.args[0].length);
		expect(dashes.length).toBe(0);
	});
});

describe('the sheet', () =>
{
	it('carries a column and a beam, and keeps the dash off the column', () =>
	{
		squareRoom(600);
		place({section: SECTION_ROUND}, {x: 300, z: 300});

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Members'});

		// A full-turn arc goes back to a `<circle>` in the SVG backend (E4), so a
		// round column arrives on the sheet as a circle rather than as 24 segments.
		expect(svg).toContain('<circle');
		expect(svg).not.toContain('stroke-dasharray');
	});

	/**
	 * The bug this pins, found by exporting a sheet with a 45 cm round column
	 * beside a 40 cm square one and seeing the round one come out smaller.
	 *
	 * A circle needs a radius in pixels, and it was taken from
	 * `Dimensioning.cmToPixel` - which reads the SCREEN's zoom. `renderTo` swaps
	 * the projection and leaves `dimensioning` alone, so on a sheet at 1:100 the
	 * column was drawn at whatever size it happened to be on screen while
	 * everything around it was drawn at the sheet's scale. Halving the scale must
	 * halve the radius; that is the whole assertion.
	 */
	it('scales a round column with the sheet, not with the screen', () =>
	{
		squareRoom(600);
		place({section: SECTION_ROUND, width: 45}, {x: 300, z: 300});

		// Matched by fill rather than by position in the document: a corner marker
		// is also a `<circle>`, and it is deliberately a fixed number of pixels at
		// any scale - so the first circle on the sheet is the wrong one to read.
		const radiusAt = (scale) =>
		{
			const svg = exportPlanSVG(planner.view, floorplan, {scale});
			const fill = floorplannerPalette.structureFill;
			const found = [...svg.matchAll(/<circle[^>]*r="([0-9.]+)"[^>]*fill="([^"]+)"/g)]
				.find((match) => match[2] === fill);
			expect(found, 'no column on the sheet').toBeTruthy();
			return Number(found[1]);
		};

		expect(radiusAt(100)).toBeGreaterThan(0);
		expect(radiusAt(50) / radiusAt(100)).toBeCloseTo(2, 2);
	});

	it('dashes a beam on the sheet too', () =>
	{
		squareRoom(600);
		place({kind: STRUCTURE_BEAM}, {x: 300, z: 300});

		const svg = exportPlanSVG(planner.view, floorplan, {scale: 100, title: 'Members'});

		expect(svg).toContain('stroke-dasharray');
	});
});
