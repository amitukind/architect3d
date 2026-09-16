// @ts-check

/**
 * Holes in a floor, where the stairs from below arrive (RM-010 G2).
 *
 * ## Derived, not authored
 *
 * A stairwell is not a thing somebody draws. It is the consequence of a flight
 * of stairs on the storey below, and F3 already worked out the rectangle: the
 * part of a flight's footprint with less than two metres of headroom under the
 * floor above, which for a default sixteen-tread flight is its top twelve
 * treads and not the whole thing. So there is nothing new to persist here - the
 * stair is saved, and the hole follows from it, which is the rule that keeps a
 * flight's height and an opening's centre out of the file too.
 *
 * ## The clamp, and why it is not optional
 *
 * RM-009 U-2 measured that `ShapeGeometry` does not cut a hole that pokes
 * outside its outline - it **merges the hole into the outline**, so a wall grew
 * 137 cm to swallow an oversized opening. RM-010 V-3 measured the same
 * primitive doing the same thing to a floor: a 400 cm floor with a hole
 * straddling its edge came out with a bounding box of -100..500. The floor gets
 * *bigger*. It does not fail, it does not warn, and the plan is unaffected
 * because the plan draws the graph.
 *
 * So every opening is clamped inside its room before it is cut, and the clamp
 * is a real containment test rather than a bounding-box one, because a room can
 * be L-shaped and a rectangle can have all four corners inside such a room
 * while spanning the notch.
 *
 * ## The predicates here are new, deliberately
 *
 * `core/utils.js` holds four PRESERVED BUGS - `pointInPolygon` returns false
 * and `polygonPolygonIntersect` returns false, pinned by characterization tests
 * and left alone on purpose. `model/plan_projection.js` states the rule this
 * file follows: *nothing new should be built on them.* Turning them on is
 * RM-007 J4's deliberate re-baseline and is not this sprint's. What is written
 * below is a fresh, correct pair used by this module and nothing else.
 */

/**
 * @typedef {{x: number, y: number}} Point
 */

/**
 * Is a point inside a simple polygon?
 *
 * The standard crossing-number test. A ray is cast in +x and the number of
 * edges it crosses is counted; odd is inside. Written here rather than imported
 * for the reason in the docblock above.
 *
 * @param {Point} point
 * @param {Array<Point>} polygon
 * @returns {boolean}
 */
export function pointInside(point, polygon)
{
	var inside = false;
	for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
	{
		var a = polygon[i];
		var b = polygon[j];
		if (((a.y > point.y) !== (b.y > point.y))
			&& (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x))
		{
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Do two segments cross?
 *
 * Proper crossings only - segments that merely touch at an endpoint do not
 * count, which is what a hole exactly reaching a wall's inner face should be
 * allowed to do.
 *
 * @param {Point} p1
 * @param {Point} p2
 * @param {Point} p3
 * @param {Point} p4
 * @returns {boolean}
 */
function segmentsCross(p1, p2, p3, p4)
{
	var d = ((p2.x - p1.x) * (p4.y - p3.y)) - ((p2.y - p1.y) * (p4.x - p3.x));
	if (Math.abs(d) < 1e-12)
	{
		return false;
	}
	var t = (((p3.x - p1.x) * (p4.y - p3.y)) - ((p3.y - p1.y) * (p4.x - p3.x))) / d;
	var u = (((p3.x - p1.x) * (p2.y - p1.y)) - ((p3.y - p1.y) * (p2.x - p1.x))) / d;
	return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/**
 * Is one simple polygon wholly inside another?
 *
 * **Every vertex** of it is inside, AND no edge of it crosses an edge of the
 * other. For two simple polygons that pair is a proof rather than a sample: all
 * vertices in and no boundary crossing leaves nowhere for the shape to escape.
 *
 * The first draft tested the centroid instead of every vertex, and a test
 * caught it: a rectangle that *encloses* the room has its centroid inside the
 * room and no edge crossings at all - the two boundaries never meet, because
 * one is wholly within the other - so it was reported as contained and the
 * clamp let a 1400 cm hole through into a 400 cm floor. Containment is not
 * symmetric and a centroid cannot tell which way round it is.
 *
 * @param {Array<Point>} inner
 * @param {Array<Point>} outer
 * @returns {boolean}
 */
export function polygonInside(inner, outer)
{
	if (!inner.length || outer.length < 3)
	{
		return false;
	}
	for (var v = 0; v < inner.length; v++)
	{
		if (!pointInside(inner[v], outer))
		{
			return false;
		}
	}
	for (var i = 0; i < inner.length; i++)
	{
		var a = inner[i];
		var b = inner[(i + 1) % inner.length];
		for (var j = 0; j < outer.length; j++)
		{
			if (segmentsCross(a, b, outer[j], outer[(j + 1) % outer.length]))
			{
				return false;
			}
		}
	}
	return true;
}

/**
 * @param {Array<Point>} polygon
 * @returns {Point}
 */
export function centroid(polygon)
{
	var sx = 0;
	var sy = 0;
	polygon.forEach(function (point) {sx += point.x; sy += point.y;});
	return {x: sx / polygon.length, y: sy / polygon.length};
}

/**
 * The shoelace area of a polygon, in square centimetres.
 * @param {Array<Point>} polygon
 * @returns {number}
 */
export function polygonArea(polygon)
{
	if (!polygon || polygon.length < 3)
	{
		return 0;
	}
	var total = 0;
	for (var i = 0; i < polygon.length; i++)
	{
		var here = polygon[i];
		var next = polygon[(i + 1) % polygon.length];
		total += (here.x * next.y) - (next.x * here.y);
	}
	return Math.abs(total / 2);
}

/** How far a clamp may shrink an opening before it is dropped instead. */
const MIN_CLAMP_SCALE = 0.05;
/** How many halvings the bisection gets. 12 resolves to about 0.02 % of the span. */
const CLAMP_STEPS = 12;

/**
 * Shrink an opening about its centre until it fits inside a room (RM-010 V-3).
 *
 * A bisection on one scale factor rather than a polygon intersection, and the
 * choice is deliberate: what has to be guaranteed is that the hole is never
 * *bigger* than the floor, because that is the failure - an oversized hole is
 * merged into the outline and the floor grows. A boolean intersection would
 * give a tighter answer and would be an order of magnitude more code, most of
 * it edge cases in a routine whose job is to stop something from being wrong.
 *
 * Twelve halvings resolve to about 0.02 % of the span, so a clamped stairwell
 * is within a millimetre of the largest concentric one that fits.
 *
 * Returns null when the opening's centre is not in the room at all - which is
 * how "which room is this stair over" is answered, since no amount of shrinking
 * moves a hole into a room it is not above.
 *
 * @param {Array<Point>} opening
 * @param {Array<Point>} room
 * @returns {?{polygon: Array<Point>, scale: number}}
 */
export function clampOpeningToRoom(opening, room)
{
	if (!opening || opening.length < 3 || !room || room.length < 3)
	{
		return null;
	}
	var middle = centroid(opening);
	if (!pointInside(middle, room))
	{
		return null;
	}
	if (polygonInside(opening, room))
	{
		return {polygon: opening, scale: 1};
	}
	var low = 0;
	var high = 1;
	var best = null;
	for (var step = 0; step < CLAMP_STEPS; step++)
	{
		var mid = (low + high) / 2;
		var candidate = scaleAbout(opening, middle, mid);
		if (polygonInside(candidate, room))
		{
			best = {polygon: candidate, scale: mid};
			low = mid;
		}
		else
		{
			high = mid;
		}
	}
	if (!best || best.scale < MIN_CLAMP_SCALE)
	{
		// Smaller than a twentieth of what was asked for is not a stairwell, it is
		// a mark. Dropped with a note, which is strictly better than U-2's silent
		// wall-stretching and is the same answer F1 gave one layer up.
		console.warn('architect3d: a stairwell does not fit the room above it and was not cut');
		return null;
	}
	return best;
}

/**
 * @param {Array<Point>} polygon
 * @param {Point} about
 * @param {number} scale
 * @returns {Array<Point>}
 */
function scaleAbout(polygon, about, scale)
{
	return polygon.map(function (point)
	{
		return {
			x: about.x + ((point.x - about.x) * scale),
			y: about.y + ((point.y - about.y) * scale),
		};
	});
}

/**
 * Put a rectangle in the item's own frame into plan space.
 *
 * The same rotate-then-translate `footprintCorners` applies to a footprint's
 * four corners, which is what makes a stairwell under a flight turned 30
 * degrees a rectangle turned 30 degrees rather than an axis-aligned one that
 * nearly covers it.
 *
 * @param {{x0: number, y0: number, x1: number, y1: number}} rect In the item's frame.
 * @param {{x: number, y: number, rotation: number}} placement
 * @returns {Array<Point>}
 */
export function placeRectangle(rect, placement)
{
	var cos = Math.cos(placement.rotation);
	var sin = Math.sin(placement.rotation);
	return [
		{x: rect.x0, y: rect.y0}, {x: rect.x1, y: rect.y0},
		{x: rect.x1, y: rect.y1}, {x: rect.x0, y: rect.y1},
	].map(function (corner)
	{
		return {
			x: placement.x + (corner.x * cos) - (corner.y * sin),
			y: placement.y + (corner.x * sin) + (corner.y * cos),
		};
	});
}
