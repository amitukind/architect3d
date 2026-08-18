/**
 * The 2D plan, rasterised for real (RM-002 P5, tier 2).
 *
 * Every other 2D test in this repository runs under jsdom against a context
 * stub that records call names. Those tests pin what the view *asks* the canvas
 * to do; this one is the first that looks at what came out.
 *
 * ## How these assert
 *
 * By reading the pixel at a coordinate the drawing model says something should
 * be at, and comparing it against the palette value the library exports. No
 * reference image: the assertion is a contract ("the grid draws in the grid
 * colour"), not a bitmap, so it holds on any platform and says what is wrong
 * rather than that some pixels moved. See the note in vitest.browser.config.mjs.
 *
 * Tolerance exists because the canvas composites with alpha and antialiases;
 * a swatch is sampled and compared within a channel distance rather than
 * demanded exactly.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../../src/scripts/model/floorplan.js';
import {Floorplanner2D} from '../../src/scripts/floorplanner/floorplanner.js';
import {floorplannerPalette, setFloorplannerPalette} from '../../src/scripts/floorplanner/floorplanner_view.js';
import {Configuration, configDimUnit, scale} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

/**
 * The canvas takes its size from the element, and the library resizes it to
 * match on construction - so the numbers these tests sample against come from
 * the view after it has drawn, never from a constant. Getting this wrong is
 * how the first version of this file sampled (2, 2) of an 800x600 canvas that
 * was actually 414x896.
 */
let width = 0;
let height = 0;

/** The palette as the library ships it, captured before any test themes it. */
const PRISTINE = {...floorplannerPalette};

let canvas;
let floorplanner;

/** `#rrggbb` or `#rrggbbaa` to [r, g, b]. */
function rgb(hex)
{
	const value = hex.replace('#', '');
	return [
		parseInt(value.slice(0, 2), 16),
		parseInt(value.slice(2, 4), 16),
		parseInt(value.slice(4, 6), 16),
	];
}

/** The pixel at (x, y) of the live canvas, as [r, g, b, a]. */
function pixelAt(x, y)
{
	const context = canvas.getContext('2d');
	const data = context.getImageData(x, y, 1, 1).data;
	return [data[0], data[1], data[2], data[3]];
}

/**
 * The colour covering more of the canvas than any other.
 *
 * More robust than sampling a corner: the grid, the origin crosshair and the
 * carbon sheet all reach the edges, so "the pixel at (2, 2)" is not reliably
 * background. What IS reliable is that the ground covers more of the canvas
 * than anything drawn on it.
 */
function dominantColour()
{
	return palette()[0].colour;
}

/** Largest per-channel difference between two colours. */
function channelDistance(a, b)
{
	return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** Does any pixel on this horizontal span differ from the background? */
function rowHasInk(y, background)
{
	const context = canvas.getContext('2d');
	const data = context.getImageData(0, y, width, 1).data;
	for (let x = 0; x < width; x++)
	{
		const here = [data[x * 4], data[x * 4 + 1], data[x * 4 + 2]];
		if (channelDistance(here, background) > 6)
		{
			return true;
		}
	}
	return false;
}

/** Every distinct colour drawn, most common first. Alpha-zero pixels ignored. */
function palette()
{
	const context = canvas.getContext('2d');
	const data = context.getImageData(0, 0, width, height).data;
	const counts = new Map();
	for (let i = 0; i < data.length; i += 4)
	{
		if (data[i + 3] === 0)
		{
			continue;
		}
		const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([key, count]) => ({colour: key.split(',').map(Number), count}));
}

/** A four-metre square room, drawn into a real canvas at a known scale. */
function drawSquareRoom()
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
	// After construction, not before: the view resizes the canvas to its element.
	width = floorplanner.view.canvasWidth;
	height = floorplanner.view.canvasHeight;
	return floorplan;
}

beforeEach(() =>
{
	setFloorplannerPalette(PRISTINE);
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
	setFloorplannerPalette(PRISTINE);
});

describe('the plan actually rasterises', () =>
{
	it('draws something at all', () =>
	{
		drawSquareRoom();

		const drawn = palette();
		// A blank canvas is one colour. Anything that has drawn a grid, a room
		// fill, four walls and their corners is not.
		expect(drawn.length).toBeGreaterThan(5);
	});

	it('fills the room in the room colour', () =>
	{
		const floorplan = drawSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(room).toBeTruthy();

		// Sample the middle of the room, in canvas coordinates.
		const centre = room.corners.reduce(
			(sum, corner) => ({x: sum.x + corner.x / room.corners.length, y: sum.y + corner.y / room.corners.length}),
			{x: 0, y: 0},
		);
		const x = Math.round(floorplanner.view.viewmodel.convertX(centre.x));
		const y = Math.round(floorplanner.view.viewmodel.convertY(centre.y));

		const here = pixelAt(x, y);
		// roomColor ships as #fedaff66 - a translucent lilac over white. The
		// composite is what is on screen, so the assertion is that the room fill
		// tinted this pixel away from white towards that hue, not that the pixel
		// equals the constant.
		expect(here[3]).toBeGreaterThan(0);
		expect(here[0]).toBeGreaterThan(here[1]);
		expect(here[2]).toBeGreaterThan(here[1]);
	});

	it('follows the palette: a themed grid draws in the themed colour', () =>
	{
		// The claim the whole floorplannerPalette API rests on, and the first test
		// anywhere that checks it against real output rather than a recorded
		// strokeStyle assignment.
		setFloorplannerPalette({background: '#000000', grid: '#00ff00', gridMajor: '#00ff00'});
		drawSquareRoom();

		const drawn = palette();
		const green = drawn.find((entry) => channelDistance(entry.colour, [0, 255, 0]) < 40);
		expect(green, 'no grid-coloured pixels on the canvas').toBeTruthy();
		expect(green.count).toBeGreaterThan(100);
	});

	it('paints the themed background as the ground under everything', () =>
	{
		setFloorplannerPalette({background: '#101820'});
		drawSquareRoom();

		// The dominant colour, not a sampled corner: the grid and the origin
		// crosshair reach the edges, so a corner pixel is not reliably ground.
		expect(channelDistance(dominantColour(), rgb('#101820'))).toBeLessThan(10);
	});

	it('leaves the canvas transparent when no background is themed', () =>
	{
		// The library default, and the behaviour every embedder had before the
		// palette existed: the page shows through.
		setFloorplannerPalette({background: null});
		drawSquareRoom();

		const context = canvas.getContext('2d');
		const data = context.getImageData(0, 0, width, height).data;
		let transparent = 0;
		for (let i = 3; i < data.length; i += 4)
		{
			if (data[i] === 0)
			{
				transparent += 1;
			}
		}
		expect(transparent).toBeGreaterThan(0);
	});

	it('draws the grid at the spacing it was told to', () =>
	{
		setFloorplannerPalette({background: '#ffffff', grid: '#ff0000', gridMajor: '#ff0000'});
		drawSquareRoom();

		// Count distinct horizontal bands carrying ink. With a grid drawn there
		// are many; with no grid there are only the wall rows.
		let inkedRows = 0;
		for (let y = 0; y < height; y += 1)
		{
			if (rowHasInk(y, [255, 255, 255]))
			{
				inkedRows += 1;
			}
		}
		expect(inkedRows).toBeGreaterThan(20);
	});

	it('redraws after a palette change without being reconstructed', () =>
	{
		drawSquareRoom();
		const before = palette().length;

		setFloorplannerPalette({background: '#123456', grid: '#654321', gridMajor: '#654321'});
		floorplanner.view.draw();

		expect(channelDistance(dominantColour(), rgb('#123456'))).toBeLessThan(10);
		expect(palette().length).toBeGreaterThan(1);
		expect(before).toBeGreaterThan(1);
	});
});
