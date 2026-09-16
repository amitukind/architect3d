/**
 * The polygon predicates, including the ones that are broken on purpose (RM-006).
 *
 * ## Two kinds of test in one file, and the difference matters
 *
 * `Utils` carries a documented ledger of PRESERVED BUGS - predicates called
 * with the pre-refactor coordinate arity, so an argument that should be an
 * array of corners receives a number, `.length` is undefined, the loop never
 * runs, and the function returns a constant. Room detection depends on those
 * constants, which is why they are pinned rather than fixed.
 *
 * `dimensioning.test.js` already pins `pointInPolygon` and
 * `polygonInsidePolygon` that way. Its siblings were never covered:
 * `polygonPolygonIntersect` and `polygonOutsidePolygon` are broken by the same
 * mechanism and had no test at all, so nothing said what they return or why.
 *
 * The rest of this file covers predicates that genuinely WORK and were simply
 * never reached from a test - `linePolygonIntersect`, `lineLineIntersect`,
 * `lineLineIntersectPoint`, `getCyclicOrder`. Those assertions are ordinary
 * geometry with hand-derived answers.
 *
 * **A constant-returning function is the easiest thing in a codebase to "fix"
 * by accident.** A future reader who deletes an `@ts-expect-error` and corrects
 * the arity will make these functions start working, and rooms will stop being
 * detected the way they are today. That is what these assertions are for: not
 * to say the behaviour is right, but to make changing it deliberate.
 */
import {describe, expect, it} from 'vitest';
import {Vector2} from 'three';
import {Utils} from '../src/scripts/core/utils.js';

const pt = (x, y) => ({x, y});
/** A unit square, counter-clockwise from the origin. */
const SQUARE = [pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)];

describe('PRESERVED BUG: polygonPolygonIntersect is a constant (RM-006)', () =>
{
	// It calls linePolygonIntersect(x1, y1, x2, y2, corners) - five arguments to
	// a three-parameter function - so `corners` receives a NUMBER. The inner loop
	// reads `corners.length`, gets undefined, never iterates, and returns false
	// every time. Marked with @ts-expect-error in the source, deliberately.

	it('reports false for two polygons that plainly overlap', () =>
	{
		const shifted = SQUARE.map((c) => pt(c.x + 5, c.y + 5));
		expect(Utils.polygonPolygonIntersect(SQUARE, shifted)).toBe(false);
	});

	it('reports false for two polygons that are far apart', () =>
	{
		const far = SQUARE.map((c) => pt(c.x + 1000, c.y + 1000));
		expect(Utils.polygonPolygonIntersect(SQUARE, far)).toBe(false);
	});

	it('reports false for a polygon against itself', () =>
	{
		// The strongest statement of the bug available: a shape does not intersect
		// itself. If this ever returns true, the arity was corrected.
		expect(Utils.polygonPolygonIntersect(SQUARE, SQUARE)).toBe(false);
	});

	it('still walks its own corner list, wrap-around included', () =>
	{
		// The outer loop DOES run - it is the inner one that cannot. Both the
		// `tI == length - 1` wrap and the ordinary step are exercised here, so a
		// change to the outer loop is visible even though the answer is constant.
		expect(Utils.polygonPolygonIntersect([pt(0, 0)], SQUARE)).toBe(false);
		expect(Utils.polygonPolygonIntersect(SQUARE, SQUARE)).toBe(false);
		expect(Utils.polygonPolygonIntersect([], SQUARE)).toBe(false);
	});
});

describe('PRESERVED BUG: polygonOutsidePolygon is a constant (RM-006)', () =>
{
	// Same doubly-broken call as polygonInsidePolygon, with the sense inverted:
	// `pointInPolygon` is itself a constant false AND is called with the wrong
	// arity, so the test inside never fires and this always returns true.

	it('reports true for a polygon entirely inside another', () =>
	{
		const inner = [pt(2, 2), pt(4, 2), pt(4, 4), pt(2, 4)];
		expect(Utils.polygonOutsidePolygon(inner, SQUARE, new Vector2(-100, -100))).toBe(true);
	});

	it('reports true for a polygon entirely outside another', () =>
	{
		const away = [pt(500, 500), pt(510, 500), pt(510, 510)];
		expect(Utils.polygonOutsidePolygon(away, SQUARE, new Vector2(-100, -100))).toBe(true);
	});

	it('defaults a missing raycast origin to zero rather than throwing', () =>
	{
		// `start.x = start.x || 0` runs before the loop, so a bare object is
		// acceptable input and is mutated in place. Worth pinning: a caller
		// passing a frozen object would throw here.
		const start = {};
		expect(Utils.polygonOutsidePolygon(SQUARE, SQUARE, start)).toBe(true);
		expect(start).toEqual({x: 0, y: 0});
	});
});

describe('linePolygonIntersect actually works (RM-006)', () =>
{
	// The one in this family called with the RIGHT arity. It takes two points and
	// a corner array, so it is a real predicate - which is what makes the broken
	// siblings above legible as broken rather than as a design.

	it('finds a segment crossing an edge', () =>
	{
		expect(Utils.linePolygonIntersect(pt(-5, 5), pt(5, 5), SQUARE)).toBe(true);
	});

	it('finds a segment crossing the wrap-around edge', () =>
	{
		// The last-to-first edge is built by the `tI == length - 1` branch, and a
		// crossing that only touches that edge is the only way to prove it.
		expect(Utils.linePolygonIntersect(pt(-5, 5), pt(5, 5), [pt(0, 10), pt(10, 10), pt(10, 0), pt(0, 0)])).toBe(true);
	});

	it('rejects a segment that misses entirely', () =>
	{
		expect(Utils.linePolygonIntersect(pt(100, 100), pt(200, 200), SQUARE)).toBe(false);
	});

	it('rejects a segment wholly inside, which crosses no edge', () =>
	{
		// Inside is not intersecting. A caller wanting containment needs
		// pointInPolygon - which is one of the preserved bugs, and always false.
		expect(Utils.linePolygonIntersect(pt(3, 3), pt(7, 7), SQUARE)).toBe(false);
	});
});

describe('lineLineIntersect and lineLineIntersectPoint (RM-006)', () =>
{
	it('detects a crossing and reports where', () =>
	{
		const a = [pt(0, 0), pt(10, 10)];
		const b = [pt(0, 10), pt(10, 0)];
		expect(Utils.lineLineIntersect(a[0], a[1], b[0], b[1])).toBe(true);

		const where = Utils.lineLineIntersectPoint(a[0], a[1], b[0], b[1]);
		expect(where.x).toBeCloseTo(5, 6);
		expect(where.y).toBeCloseTo(5, 6);
	});

	it('reports no crossing for segments that do not reach each other', () =>
	{
		expect(Utils.lineLineIntersect(pt(0, 0), pt(1, 1), pt(50, 50), pt(60, 60))).toBe(false);
	});

	it('returns undefined rather than a point for parallel segments', () =>
	{
		// checkIntersection returns {type:'parallel'} with no `point`, and the
		// wrapper turns a missing point into undefined. A caller that assumed a
		// Vector2 always came back would read .x off undefined.
		expect(Utils.lineLineIntersectPoint(pt(0, 0), pt(10, 0), pt(0, 5), pt(10, 5))).toBeUndefined();
	});

	it('returns undefined for colinear segments too', () =>
	{
		expect(Utils.lineLineIntersectPoint(pt(0, 0), pt(10, 0), pt(20, 0), pt(30, 0))).toBeUndefined();
	});

	it('returns undefined when the lines would cross beyond their ends', () =>
	{
		// Not parallel, so there is a solution - but uA/uB fall outside 0..1, which
		// is the `{type:'none'}` arm and a third way to get undefined.
		expect(Utils.lineLineIntersectPoint(pt(0, 0), pt(1, 0), pt(50, -10), pt(50, 10))).toBeUndefined();
	});
});

describe('Utils.getCyclicOrder (RM-006)', () =>
{
	// Real Vector2s, not the plain {x, y} the predicates above accept: this one
	// calls `point.clone().sub(start)`, so a bare object throws. Worth stating
	// because every other function in this file is duck-typed on x and y, and
	// this is the single place in `Utils` where that stops being true.
	const v = (x, y) => new Vector2(x, y);

	it('orders points by angle about an explicit origin', () =>
	{
		const result = Utils.getCyclicOrder([v(1, 0), v(0, 1), v(-1, 0)], new Vector2(0, 0));
		expect(result.indices).toEqual([0, 1, 2]);
		expect(result.angles).toHaveLength(3);
	});

	it('defaults the origin to (0,0) when none is given', () =>
	{
		// The default is applied inside the body rather than in the signature, and
		// RM-005 C2's note on this function says the JSDoc tag is what makes the
		// assignment type-check. Both arms exist in the tree, so both run.
		const explicit = Utils.getCyclicOrder([v(1, 0), v(0, 1)], new Vector2(0, 0));
		const implicit = Utils.getCyclicOrder([v(1, 0), v(0, 1)]);
		expect(implicit.indices).toEqual(explicit.indices);
		expect(implicit.angles).toEqual(explicit.angles);
	});
});
