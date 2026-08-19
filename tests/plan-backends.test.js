/**
 * The eleven drawing operations, on both backends (RM-008 E4).
 *
 * `tests/plan-export.test.js` asserts that the two are handed the same calls.
 * This asserts what each one does with them, which is the other half: an
 * agreement between two implementations is only worth anything if at least one
 * of them is known to be right.
 *
 * No DOM. The canvas backend is driven against a recording stub, which is
 * enough at this level - that the SVG a plan produces is *visible* is the
 * browser tier's job, and it does it in `tests/browser/plan-annotations.test.js`.
 */
import {describe, expect, it} from 'vitest';

import {CanvasBackend, SvgBackend} from '../src/scripts/floorplanner/backends.js';

/** A CanvasRenderingContext2D that records instead of drawing. */
function context()
{
	const calls = [];
	const record = (name) => (...args) => {calls.push({name, args});};
	return {
		calls,
		names: () => calls.map((call) => call.name),
		beginPath: record('beginPath'),
		closePath: record('closePath'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		bezierCurveTo: record('bezierCurveTo'),
		arc: record('arc'),
		stroke: record('stroke'),
		fill: record('fill'),
		fillRect: record('fillRect'),
		clearRect: record('clearRect'),
		fillText: record('fillText'),
		strokeText: record('strokeText'),
		setLineDash: record('setLineDash'),
		save: record('save'),
		restore: record('restore'),
		translate: record('translate'),
		rotate: record('rotate'),
		measureText: (text) => ({width: String(text).length * 7}),
		font: '',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		textAlign: '',
		textBaseline: '',
	};
}

describe('the canvas backend', () =>
{
	it('draws a line as one stroked path', () =>
	{
		const ctx = context();

		new CanvasBackend(/** @type {*} */ (ctx)).line(0, 0, 10, 20, 2, '#f00');

		expect(ctx.names()).toEqual(['beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke']);
		expect(ctx.strokeStyle).toBe('#f00');
		expect(ctx.lineWidth).toBe(2);
	});

	/**
	 * The live view clears to transparency and paints its own themed ground a
	 * line later; a sheet has no theme behind it, so it asks the backend for one.
	 * Before F3 the sheet painted its ground BEFORE `renderTo`, where `draw()`'s
	 * opening clear wiped it - see `CanvasBackend.clear`.
	 */
	it('clears to transparency, or to a ground when it is given one', () =>
	{
		const bare = context();
		new CanvasBackend(/** @type {*} */ (bare)).clear(300, 200);
		expect(bare.names()).toEqual(['clearRect']);

		const grounded = context();
		new CanvasBackend(/** @type {*} */ (grounded), 'Arial', '#ffffff').clear(300.4, 200.7);
		expect(grounded.names()).toEqual(['clearRect', 'fillRect']);
		// Rounded up: the bitmap is a whole number of pixels and the sheet is not.
		expect(grounded.calls[1].args).toEqual([0, 0, 301, 201]);
		expect(grounded.fillStyle).toBe('#ffffff');
	});

	it('draws a curve as a bezier', () =>
	{
		const ctx = context();

		new CanvasBackend(/** @type {*} */ (ctx)).curve(0, 0, 1, 2, 3, 4, 5, 6, 1, '#000');

		expect(ctx.names()).toContain('bezierCurveTo');
		expect(ctx.calls.find((call) => call.name === 'bezierCurveTo').args).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('fills, strokes, both or neither, as asked', () =>
	{
		const both = context();
		new CanvasBackend(/** @type {*} */ (both)).polygon([0, 1, 2], [0, 1, 2], '#fff', '#000', 3);
		expect(both.names()).toContain('fill');
		expect(both.names()).toContain('stroke');

		const neither = context();
		new CanvasBackend(/** @type {*} */ (neither)).polygon([0, 1, 2], [0, 1, 2], null, null);
		expect(neither.names()).not.toContain('fill');
		expect(neither.names()).not.toContain('stroke');
	});

	it('draws nothing for a polygon with no points', () =>
	{
		const ctx = context();

		new CanvasBackend(/** @type {*} */ (ctx)).polygon([], [], '#fff', '#000');

		expect(ctx.calls).toHaveLength(0);
	});

	it('walks a path of straight and curved segments', () =>
	{
		const ctx = context();

		new CanvasBackend(/** @type {*} */ (ctx)).path([
			[{x: 0, y: 0}],
			[{x: 1, y: 1}],
			[{x: 2, y: 2}, {x: 3, y: 3}, {x: 4, y: 4}],
		], '#fff', null);

		expect(ctx.names()).toEqual(['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'closePath', 'fill']);
	});

	it('haloes text only when asked, and centres it', () =>
	{
		const haloed = context();
		new CanvasBackend(/** @type {*} */ (haloed)).text('Hi', 5, 6, {color: '#000', halo: '#fff', size: 12});
		expect(haloed.names()).toEqual(['strokeText', 'fillText']);
		expect(haloed.textAlign).toBe('center');

		const bare = context();
		new CanvasBackend(/** @type {*} */ (bare)).text('Hi', 5, 6, {color: '#000', halo: null, size: 12});
		expect(bare.names()).toEqual(['fillText']);
	});

	/**
	 * The offset is applied in the label's own frame, after the rotation. Getting
	 * that wrong pushes a vertical dimension's measurement along its line rather
	 * than clear of it.
	 */
	it('rotates around the anchor and offsets inside the rotated frame', () =>
	{
		const ctx = context();

		new CanvasBackend(/** @type {*} */ (ctx)).text('4m', 100, 200, {
			color: '#000', size: 12, rotation: Math.PI / 2, offsetY: -9,
		});

		expect(ctx.names()).toEqual(['save', 'translate', 'rotate', 'fillText', 'restore']);
		expect(ctx.calls.find((call) => call.name === 'translate').args).toEqual([100, 200]);
		expect(ctx.calls.find((call) => call.name === 'fillText').args).toEqual(['4m', 0, -9]);
	});

	it('measures through the context, at the font it will draw in', () =>
	{
		const ctx = context();

		const width = new CanvasBackend(/** @type {*} */ (ctx), 'Courier').measureText('abcd', 20, 'bold');

		expect(width).toBe(28);
		expect(ctx.font).toBe('bold 20px Courier');
	});
});

describe('the SVG backend', () =>
{
	function svg()
	{
		return new SvgBackend(200, 100, {measure: (text, size) => String(text).length * size * 0.5});
	}

	it('writes a document with the size it was given', () =>
	{
		const out = svg().toSVG();

		expect(out).toContain('width="200" height="100"');
		expect(out).toContain('viewBox="0 0 200 100"');
	});

	it('writes a line as path data', () =>
	{
		const backend = svg();

		backend.line(0, 0, 10.125, 20, 2, '#f00');

		// Two decimal places: a hundredth of a pixel is below anything a screen or
		// a printer resolves, and the full float doubles the size of every path.
		expect(backend.elements[0]).toContain('d="M 0 0 L 10.13 20"');
		expect(backend.elements[0]).toContain('stroke-width="2"');
	});

	it('carries a dash pattern onto the strokes that follow it', () =>
	{
		const backend = svg();

		backend.line(0, 0, 1, 1, 1, '#000');
		backend.dash([4, 4]);
		backend.line(0, 0, 2, 2, 1, '#000');
		backend.dash([]);
		backend.line(0, 0, 3, 3, 1, '#000');

		expect(backend.elements[0]).not.toContain('stroke-dasharray');
		expect(backend.elements[1]).toContain('stroke-dasharray="4 4"');
		expect(backend.elements[2]).not.toContain('stroke-dasharray');
	});

	/**
	 * Canvas takes a centre, a radius and two angles; SVG's arc command takes an
	 * endpoint and two flags. The conversion is the one piece of real translation
	 * in this class.
	 */
	it('converts an arc into endpoints and flags', () =>
	{
		const backend = svg();

		backend.arc(10, 10, 5, 0, Math.PI / 2, 1, '#000');

		expect(backend.elements[0]).toContain('M 15 10 A 5 5 0 0 1 10 15');
	});

	it('sets the large-arc flag past half a turn', () =>
	{
		const backend = svg();

		backend.arc(0, 0, 5, 0, Math.PI * 1.5, 1, '#000');

		expect(backend.elements[0]).toContain('A 5 5 0 1 1');
	});

	it('reverses the sweep flag for an arc drawn the other way', () =>
	{
		const backend = svg();

		backend.arc(0, 0, 5, Math.PI / 2, 0, 1, '#000');

		expect(backend.elements[0]).toContain('A 5 5 0 0 0');
	});

	/**
	 * A full turn cannot be one arc command - its two endpoints coincide and the
	 * renderer draws nothing at all, which is a blank where a circle should be.
	 */
	it('writes a whole turn as a circle instead', () =>
	{
		const backend = svg();

		backend.arc(10, 10, 5, 0, Math.PI * 2, 2, '#000');

		expect(backend.elements[0]).toContain('<circle');
		expect(backend.elements[0]).toContain('fill="none"');
	});

	it('writes text with its weight, style and anchor', () =>
	{
		const backend = svg();

		backend.text('Kitchen', 10, 20, {color: '#123456', size: 14, style: 'bold italic', anchor: 'end'});

		const element = backend.elements[0];
		expect(element).toContain('font-weight="bold"');
		expect(element).toContain('font-style="italic"');
		expect(element).toContain('text-anchor="end"');
		expect(element).toContain('>Kitchen</text>');
	});

	it('draws the halo behind the glyphs, not over them', () =>
	{
		const backend = svg();

		backend.text('Hi', 0, 0, {color: '#000', halo: '#fff', size: 12});

		// Without paint-order a 4px stroke eats the letterforms from the outside.
		expect(backend.elements[0]).toContain('paint-order="stroke"');
	});

	it('rotates text with a transform rather than a stack', () =>
	{
		const backend = svg();

		backend.text('4m', 100, 200, {color: '#000', size: 12, rotation: Math.PI / 2, offsetY: -9});

		expect(backend.elements[0]).toContain('transform="translate(100 200) rotate(90)"');
		expect(backend.elements[0]).toContain('x="0" y="-9"');
	});

	it('escapes anything a person could type into a label', () =>
	{
		const backend = svg();

		backend.text('Ben & Jo\'s <"study">', 0, 0, {color: '#000', size: 12});

		expect(backend.elements[0]).toContain('Ben &amp; Jo\'s &lt;&quot;study&quot;&gt;');
		expect(backend.elements[0]).not.toContain('<"');
	});

	it('starts again when cleared, because SVG has no eraser', () =>
	{
		const backend = svg();
		backend.line(0, 0, 1, 1, 1, '#000');

		backend.clear(200, 100);

		expect(backend.elements).toHaveLength(0);
	});

	it('uses the measurer it was given', () =>
	{
		const backend = svg();

		expect(backend.measureText('abcd', 10)).toBe(20);
	});

	/**
	 * The fallback exists because a caller may not have a canvas at all. It is a
	 * stated estimate rather than a silent one - a guess nobody wrote down is a
	 * bug waiting to be attributed to something else.
	 */
	it('falls back to an estimate when nobody supplied one', () =>
	{
		const bare = new SvgBackend(10, 10);

		expect(bare.measureText('abcd', 10)).toBeCloseTo(22, 6);
	});

	it('draws nothing for an empty polygon or an empty path', () =>
	{
		const backend = svg();

		backend.polygon([], [], '#fff', '#000');
		backend.path([], '#fff', '#000');
		backend.path([[]], '#fff', '#000');

		expect(backend.elements).toHaveLength(0);
	});
});
