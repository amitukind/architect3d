// @ts-check
import {Vector2} from 'three';
// THREE.Math was renamed MathUtils in r113 and the old alias removed; it also
// shadowed the global Math, which is why the import was renamed here at all.
import {MathUtils as THREEMath} from 'three';
/**
 * Segment-segment intersection, inlined in S1 to drop the `line-intersect`
 * dependency (one call site, ~20 lines of maths).
 *
 * Ported verbatim from line-intersect@2.2.1 so the numerics - including the
 * exact `denom == 0` degenerate handling and the inclusive 0..1 bounds - are
 * unchanged. Returns the same shape the package did: {type} always, plus
 * {point} only when type is 'intersecting'.
 *
 * @returns {{type: string, point?: {x: number, y: number}}}
 */
function checkIntersection(x1, y1, x2, y2, x3, y3, x4, y4)
{
	var denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
	var numeA = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
	var numeB = (x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3);

	if (denom == 0)
	{
		if (numeA == 0 && numeB == 0)
		{
			return {type: 'colinear'};
		}
		return {type: 'parallel'};
	}

	var uA = numeA / denom;
	var uB = numeB / denom;

	if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1)
	{
		return {type: 'intersecting', point: {x: x1 + uA * (x2 - x1), y: y1 + uA * (y2 - y1)}};
	}

	return {type: 'none'};
}

/**
 * ## The polygon-predicate ledger (PRESERVED BUGS)
 *
 * Four call sites in this file pass arguments in a signature that no longer
 * exists - the pre-refactor form where a point was two loose coordinates rather
 * than one object. JavaScript discards the extras silently; the type checker
 * added in RM-002 P2 does not, and each is pinned below with `@ts-expect-error`
 * rather than corrected.
 *
 * The consequence, verified by running them rather than by reading them, and
 * pinned by the "PRESERVED BUG" tests in tests/dimensioning.test.js:
 *
 *   pointInPolygon          always false   (its lineLineIntersect call is broken)
 *   polygonPolygonIntersect always false   (its linePolygonIntersect call is broken)
 *   polygonInsidePolygon    always false   (both of the above)
 *   polygonOutsidePolygon   always true    (the inverse of the same)
 *   pointInPolygon2         CORRECT        - the sibling nobody refactored
 *
 * ## Why they stay
 *
 * Room detection depends on what this file returns today, not on what these
 * functions were meant to return. Correcting one changes which rooms the app
 * finds and where furniture may be placed, in a codebase whose test suite is
 * explicitly a characterization of current behaviour. That is a deliberate
 * change with a re-baselining exercise attached, not a cleanup.
 *
 * The one visible consequence is benign and already intended: `pointInPolygon`
 * is constant-false, so `FloorItem.isValidPosition` never finds an item to be
 * "in a room" and takes its early `return true` - which the comment there says
 * is wanted, because placement is left to the user.
 *
 * ## Why `@ts-expect-error` and not `@ts-ignore`
 *
 * `@ts-expect-error` fails when the error it names goes away. If somebody
 * corrects one of these signatures, the directive becomes an error and forces
 * them to come here, read this, and update the characterization tests in the
 * same change. It is a pin, not a silencer.
 *
 * ## The re-baseline, RM-012 J4 - and it is an addition, not a repair
 *
 * RM-007 asks for the four to be re-baselined as *"a new predicate, feature
 * flag, characterization tests updated in the same commit - not as a fix"*, and
 * RM-012 X-5 then measured why that framing is the right one. Asked who calls
 * them: `polygonInsidePolygon` has **no caller anywhere**, `polygonOutsidePolygon`
 * has one and it is inside a block comment, and the two live calls both sit in
 * `FloorItem.isValidPosition`, whose two live branches **both return true**.
 * Room detection uses `pointInPolygon2`, the correct sibling. So nothing
 * observable depends on any of the four, and repairing them would change
 * behaviour nobody can see while re-opening a characterization suite that has
 * held for nine programmes.
 *
 * Adding a correct predicate beside them costs none of that. {@link
 * Utils.polygonsOverlap} is new, is written from the separating-axis theorem
 * rather than from the broken edge-intersection path, is used only by the
 * collision warning, and is off unless `Configuration`'s `collisionWarnings` is
 * on. **The four above are untouched and their tests are unchanged** - which is
 * the point: the ledger now records a correct predicate existing beside them and
 * the reason the broken ones still stay, rather than recording a repair nobody
 * asked for.
 */
export class Utils
{
	/** Determines the distance of a point from a line.
	 * @param point The Point coordinates as THREE.Vector2
	 * @param start The starting coordinates of the line as THREE.Vector2
	 * @param end The ending coordinates of the line as THREE.Vector2
	 * @returns The distance value (number).
	 */
	static pointDistanceFromLine(point, start, end)
	{
		var tPoint = Utils.closestPointOnLine(point, start, end);
		var tDx = point.x - tPoint.x;
		var tDy = point.y - tPoint.y;
		return Math.sqrt(tDx * tDx + tDy * tDy);
	}

	/** Gets the projection of a point onto a line.
	 * @param point the point
	 * @param start the starting coordinates of the line as THREE.Vector2
	 * @param end the ending coordinates of the line as THREE.Vector2
	 * @returns The point as THREE.Vector2.
	 */
	static closestPointOnLine(point, start, end)
	{
		// Inspired by: http://stackoverflow.com/a/6853926
		var tA = point.x - start.x;
		var tB = point.y - start.y;
		var tC = end.x - start.x;
		var tD = end.y - start.y;

		var tDot = tA * tC + tB * tD;
		var tLenSq = tC * tC + tD * tD;
		var tParam = tDot / tLenSq;

		var tXx, tYy;

		if (tParam < 0 || (start.x == end.x && start.y == end.y))
		{
			tXx = start.x;
			tYy = start.y;
		}
		else if (tParam > 1)
		{
			tXx = end.x;
			tYy = end.y;
		}
		else {
			tXx = start.x + tParam * tC;
			tYy = start.y + tParam * tD;
		}

		return new Vector2(tXx, tYy);
	}

	/** Gets the distance of two points.
	 * @param start the starting coordinate of the line as Vector2
	 * @param end the ending coordinate of the line as Vector2
	 * @returns The distance.
	 */
	static distance(start, end)
	{
		return Math.sqrt(Math.pow(end.x - start.x, 2) +  Math.pow(end.y - start.y, 2));
	}

	/**  Gets the angle between point1 -> start and 0,0 -> point2 (-pi to pi)
	 * @returns The angle.
	 */
	static angle(start, end)
	{
		var tDot = start.x * end.x + start.y * end.y;
		var tDet = start.x * end.y - start.y * end.x;
		var tAngle = -Math.atan2(tDet, tDot);
		return tAngle;
	}

	/** shifts angle to be 0 to 2pi */
	static angle2pi(start, end)
	{
		var tTheta = Utils.angle(start, end);
		if (tTheta < 0)
		{
			tTheta += 2.0 * Math.PI;
		}
		return tTheta;
	}
	
	/**
	 * shifts angle to be 0 to 2pi
	 *
	 * @param {Vector2[]} points
	 * @param {Vector2} [start] Ray origin. `= undefined` as a default infers the
	 *        parameter's type AS undefined, so the assignment below could not
	 *        type-check; the tag is what says "optional Vector2" (RM-005 C2).
	 */
	static getCyclicOrder(points, start=undefined)
	{
		if(!start)
		{
			start = new Vector2(0, 0);
		}
		var angles = [];
		for (var i=0;i<points.length;i++)
		{
			var point = points[i];
			var vect = point.clone().sub(start);
			var radians = Math.atan2(vect.y, vect.x);
			var degrees = THREEMath.radToDeg(radians);
			degrees = (degrees > 0 ) ? degrees : (degrees+360) % 360;
			angles.push(degrees);
		}
		var indices = Utils.argsort(angles);
		var sortedAngles = [];
		var sortedPoints = [];
		for (i=0;i<indices.length;i++)
		{
			sortedAngles.push(angles[indices[i]]);
			sortedPoints.push(points[indices[i]]);
		}
		return {indices: indices, angles: sortedAngles, points: sortedPoints};
	}
	
	static argsort(numericalValues, direction=1)
	{
		var indices = Array.from(new Array(numericalValues.length),(val,index)=>index);
		return indices
		  .map((item, index) => [numericalValues[index], item]) // add the clickCount to sort by
		  .sort(([count1], [count2]) => (count1 - count2)*direction) // sort by the clickCount data
		  .map(([, item]) => item); // extract the sorted items
	}

	/** Checks if an array of points is clockwise.
	 * @param points Is array of points with x,y attributes
	 * @returns True if clockwise.
	 */
	static isClockwise(points)
	{
		// make positive
		let tSubX = Math.min(0, Math.min.apply(null, Utils.map(points, function (p) {
			return p.x;
		})));
		let tSubY = Math.min(0, Math.min.apply(null, Utils.map(points, function (p) {
			return p.x;
		})));

		var tNewPoints = Utils.map(points, function (p) {
			return {
				x: p.x - tSubX,
				y: p.y - tSubY
			};
		});

		// determine CW/CCW, based on:
			// http://stackoverflow.com/questions/1165647
		var tSum = 0;
		for (var tI = 0; tI < tNewPoints.length; tI++)
		{
			var tC1 = tNewPoints[tI];
			var tC2;
			if (tI == tNewPoints.length - 1)
			{
				tC2 = tNewPoints[0];
			}
			else
			{
				tC2 = tNewPoints[tI + 1];
			}
			tSum += (tC2.x - tC1.x) * (tC2.y + tC1.y);
		}
		return (tSum >= 0);
	}

	/**
	 * The override installed by {@link Utils.setRandomSource}, or null.
	 *
	 * This used to be assigned onto the class object without ever being
	 * declared, because the rollup 1 + Babel 6 toolchain could not parse static
	 * class properties - with a note to remove the constraint after S1. S1
	 * removed it, and the type checker is what noticed the note was still
	 * outstanding: an undeclared static is invisible to it.
	 *
	 * `null` and `undefined` are both falsy, so declaring it changes nothing
	 * about the fallback in guide().
	 *
	 * @type {?function(): number}
	 */
	static _randomSource = null;

	/**
	 * Override the random source backing {@link Utils.guide}.
	 * Tests use this to make generated corner/wall ids deterministic; passing
	 * no argument (or null) restores Math.random. Production behaviour is
	 * unchanged - guide() falls back to Math.random whenever nothing is set.
	 *
	 * @param {function(): number} [fn] Returns a float in [0, 1).
	 */
	static setRandomSource(fn)
	{
		Utils._randomSource = (typeof fn === 'function') ? fn : null;
	}

	/** Creates a Guide.
	 * @returns A new Guide.
	 */
	static guide()
	{
		var tRandom = Utils._randomSource || Math.random;
		var tS4 = function ()
		{
			return Math.floor((1 + tRandom()) * 0x10000).toString(16).substring(1);
		};
		return tS4() + tS4() + '-' + tS4() + '-' + tS4() + '-' + tS4() + '-' + tS4() + tS4() + tS4();
	}

	/** both arguments are arrays of corners with x,y attributes */
	static polygonPolygonIntersect(firstCorners, secondCorners)
	{
		for (var tI = 0; tI < firstCorners.length; tI++)
		{
			var tFirstCorner = firstCorners[tI], tSecondCorner;
			if (tI == firstCorners.length - 1)
			{
				tSecondCorner = firstCorners[0];
			}
			else
			{
				tSecondCorner = firstCorners[tI + 1];
			}
			// PRESERVED BUG - do not "fix" this call. See the ledger above the
			// class. linePolygonIntersect takes (point, point2, corners); this
			// passes the pre-refactor coordinate form, so `corners` receives a
			// number, `corners.length` is undefined, the loop never runs, and
			// polygonPolygonIntersect therefore always returns false.
			// @ts-expect-error 5 arguments to a 3-parameter function, deliberately.
			if (Utils.linePolygonIntersect(tFirstCorner.x, tFirstCorner.y,tSecondCorner.x, tSecondCorner.y, secondCorners))
			{
				return true;
			}
		}
		return false;
	}

	/** Corners is an array of points with x,y attributes */
	static linePolygonIntersect(point, point2, corners)
	{
		for (var tI = 0; tI < corners.length; tI++)
		{
			var tFirstCorner = corners[tI],tSecondCorner;
			if (tI == corners.length - 1)
			{
				tSecondCorner = corners[0];
			}
			else
			{
				tSecondCorner = corners[tI + 1];
			}
			if (Utils.lineLineIntersect(point, point2, {x:tFirstCorner.x, y:tFirstCorner.y}, {x:tSecondCorner.x, y:tSecondCorner.y}))
			{
				return true;
			}
		}
		return false;
	}

	/** */
	static lineLineIntersectPoint(aStart, aEnd, bStart, bEnd)
	{
		var result = checkIntersection(aStart.x, aStart.y, aEnd.x, aEnd.y, bStart.x, bStart.y, bEnd.x, bEnd.y);
		if(result.point)
		{
			return new Vector2(result.point.x, result.point.y);
		}
		return undefined;

	}

	/** */
	static lineLineIntersect(lineAStart, lineAEnd, lineBStart, lineBEnd)
	{
		function tCCW(p1, p2, p3)
		{
			var tA = p1.x, tB = p1.y, tC = p2.x, tD = p2.y, tE = p3.x, tF = p3.y;
			return (tF - tB) * (tC - tA) > (tD - tB) * (tE - tA);
		}
		var tP1 = lineAStart, tP2 = lineAEnd, tP3 = lineBStart, tP4 = lineBEnd;
		return (tCCW(tP1, tP3, tP4) != tCCW(tP2, tP3, tP4)) && (tCCW(tP1, tP2, tP3) != tCCW(tP1, tP2, tP4));
	}

	/**
     @param corners Is an array of points with x,y attributes
      @param startX X start coord for raycast
      @param startY Y start coord for raycast
	 */
	/**
	 * Do two convex polygons overlap? (RM-012 J4)
	 *
	 * **New, and deliberately not a repair.** The four predicates in the ledger
	 * above stay exactly as they are; this is written from scratch beside them,
	 * by the separating-axis theorem, and is the only correct overlap test in
	 * this file. RM-007 asked for the re-baseline in this shape and X-5 measured
	 * why: nothing observable depends on the broken four, so repairing them
	 * would change invisible behaviour and re-open a nine-programme
	 * characterization suite for nothing.
	 *
	 * ## Why SAT rather than edge intersection
	 *
	 * Edge intersection is what the broken path does, and it misses the case that
	 * matters most for furniture: one item **entirely inside** another. A rug
	 * under a table has no edge crossings at all. SAT catches it, because a
	 * contained polygon has no separating axis either.
	 *
	 * It requires convexity, which an item footprint has by construction -
	 * `Item.getCorners` returns the four corners of a rotated box. Stated rather
	 * than checked, because the caller is the collision warning and there is
	 * nothing else in this codebase that produces a concave item footprint.
	 *
	 * Touching is not overlapping: two units flush against each other share an
	 * edge and are not in collision, which is exactly the arrangement snapping
	 * produces on purpose.
	 *
	 * @param {Array<{x: number, y: number}>} first Corners, in order.
	 * @param {Array<{x: number, y: number}>} second
	 * @returns {boolean}
	 */
	static polygonsOverlap(first, second)
	{
		if (!first || !second || first.length < 3 || second.length < 3)
		{
			return false;
		}
		for (var polygon of [first, second])
		{
			for (var i = 0; i < polygon.length; i++)
			{
				var a = polygon[i];
				var b = polygon[(i + 1) % polygon.length];
				// The edge's outward normal. Any axis that separates the two proves
				// they do not overlap; finding none proves they do.
				var axisX = -(b.y - a.y);
				var axisY = b.x - a.x;
				var length = Math.sqrt((axisX * axisX) + (axisY * axisY));
				if (length === 0)
				{
					continue;
				}
				axisX /= length;
				axisY /= length;

				var firstRange = Utils.projectPolygon(first, axisX, axisY);
				var secondRange = Utils.projectPolygon(second, axisX, axisY);
				// `<=` rather than `<`: flush is not overlapping, and flush is what
				// snapping produces on purpose.
				if (firstRange.max <= secondRange.min || secondRange.max <= firstRange.min)
				{
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * A polygon's extent along one axis, for {@link Utils.polygonsOverlap}.
	 *
	 * @param {Array<{x: number, y: number}>} polygon
	 * @param {number} axisX
	 * @param {number} axisY
	 * @returns {{min: number, max: number}}
	 */
	static projectPolygon(polygon, axisX, axisY)
	{
		var min = Infinity;
		var max = -Infinity;
		for (var point of polygon)
		{
			var dot = (point.x * axisX) + (point.y * axisY);
			min = Math.min(min, dot);
			max = Math.max(max, dot);
		}
		return {min: min, max: max};
	}

	 static pointInPolygon2(point, polygon)
	 {
		 var x = point.x, y = point.y;
		 var inside = false;
		 for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
		 {
				 var intersect =  ((((polygon[i].y <= y) && (y < polygon[j].y)) ||  ((polygon[j].y <= y) && (y < polygon[i].y))) && (x < (polygon[j].x - polygon[i].x) * (y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x));
				 if (intersect)
				 {
					 inside = !inside;
				 }
		 }
		 return inside;
	 }

	/**
	 * @param {Vector2} point The point to test.
	 * @param {Vector2[]} corners An array of points with x,y attributes.
	 * @param {Vector2} [start] Ray origin. Defaults to the origin.
	 *
	 * The three tags above replace two that named `startX` and `startY`,
	 * parameters this function has not had since the pre-refactor coordinate
	 * form - the same signature change the four preserved bugs in this file are
	 * pinned against. Marking `start` optional is what stops `FloorItem` from
	 * reporting TS2554 for the ordinary two-argument call (RM-005 C2).
	 */
	static pointInPolygon(point, corners, start)
	{
		start = start || new Vector2(0,0);

		// ## Unreachable code removed, behaviour unchanged (RM-004 follow-on)
		//
		// What stood here was a block that walked the corners, found a point
		// below and left of all of them, and moved the ray origin there - so
		// the raycast would begin outside the polygon, which is what makes a
		// crossing count mean anything. It read two locals, `startX` and
		// `startY`, that existed only to feed it.
		//
		// It never ran once. Its guard was `startX === undefined || startY ===
		// undefined`, and `startX` was `start.x || 0` - an expression that
		// cannot yield undefined, because `0` is defined. The guard was false on
		// every call this function has ever received, so `startX`/`startY` were
		// computed, never read, and are gone with it.
		//
		// **And it would not have mattered if it had run.** See the PRESERVED
		// BUG below: `lineLineIntersect` is called with six arguments to a
		// four-parameter function, so every comparison inside it is false and
		// `pointInPolygon` returns false whatever ray you cast. Repairing the
		// guard would have moved a ray origin that feeds a test which cannot
		// succeed. Recorded because that is precisely the change somebody would
		// otherwise make, believing they had fixed something.
		//
		// The block carried a typo too - `tMinY = Math.min(tMinX, corners[tI].y)`
		// reads tMinX where it means tMinY - quoted here rather than left
		// commented out, since correcting it would only have made unreachable
		// code marginally less wrong.
		var tI;

		var tIntersects = 0;
		for (tI = 0; tI < corners.length; tI++)
		{
			var tFirstCorner = corners[tI], tSecondCorner;
			if (tI == corners.length - 1)
			{
				tSecondCorner = corners[0];
			}
			else
			{
				tSecondCorner = corners[tI + 1];
			}

			// PRESERVED BUG - do not "fix" this call. See the ledger above the
			// class. lineLineIntersect takes four points; this passes two points
			// and four loose coordinates, so lineBStart/lineBEnd are numbers,
			// reading .x off them yields undefined, every comparison is false,
			// and pointInPolygon therefore always returns false.
			// @ts-expect-error 6 arguments to a 4-parameter function, deliberately.
			if (Utils.lineLineIntersect(start, point, tFirstCorner.x, tFirstCorner.y, tSecondCorner.x, tSecondCorner.y))
			{
				tIntersects++;
			}
		}
		// odd intersections means the point is in the polygon
		return ((tIntersects % 2) == 1);
	}

	/** Checks if all corners of insideCorners are inside the polygon described by outsideCorners */
	static polygonInsidePolygon(insideCorners, outsideCorners, start)
	{
		start.x = start.x || 0;
		start.y = start.y || 0;

		for (var tI = 0; tI < insideCorners.length; tI++)
		{
			// PRESERVED BUG - do not "fix" this call. See the ledger above the
			// class. Doubly broken: the arity is the pre-refactor coordinate
			// form, and pointInPolygon is a constant false regardless. The first
			// corner therefore always short-circuits and this always returns false.
			// @ts-expect-error 4 arguments to a 3-parameter function, deliberately.
			if (!Utils.pointInPolygon(insideCorners[tI].x, insideCorners[tI].y,outsideCorners,start))
			{
				return false;
			}
		}
		return true;
	}

	/** Checks if any corners of firstCorners is inside the polygon described by secondCorners */
	static polygonOutsidePolygon(insideCorners, outsideCorners, start)
	{
		start.x = start.x || 0;
		start.y = start.y || 0;

		for (var tI = 0; tI < insideCorners.length; tI++)
		{
			// PRESERVED BUG - do not "fix" this call. See the ledger above the
			// class. Same doubly-broken call as polygonInsidePolygon, with the
			// sense inverted: the test never fires, so this always returns true.
			// @ts-expect-error 4 arguments to a 3-parameter function, deliberately.
			if (Utils.pointInPolygon(insideCorners[tI].x, insideCorners[tI].y,outsideCorners,start))
			{
				return false;
			}
		}
		return true;
	}

	// arrays

	static forEach(array, action)
	{
		for (var tI = 0; tI < array.length; tI++)
		{
			action(array[tI]);
		}
	}

	static forEachIndexed(array, action)
	{
		for (var tI = 0; tI < array.length; tI++)
		{
			action(tI, array[tI]);
		}
	}

	static map(array, func)
	{
		var tResult = [];
		array.forEach((element) => {
			tResult.push(func(element));
		});
		return tResult;
	}

	/** Remove elements in array if func(element) returns true */
	static removeIf(array, func)
	{
		var tResult = [];
		array.forEach((element) => {
			if (!func(element)) {
				tResult.push(element);
			}
		});
		return tResult;
	}

	/** Shift the items in an array by shift (positive integer) */
	static cycle(arr, shift)
	{
		var tReturn = arr.slice(0);
		for (var tI = 0; tI < shift; tI++) {
			var tmp = tReturn.shift();
			tReturn.push(tmp);
		}
		return tReturn;
	}

	/** Returns in the unique elemnts in arr */
	static unique(arr, hashFunc)
	{
		var tResults = [];
		var tMap = {};
		for (var tI = 0; tI < arr.length; tI++) {
			// Object.prototype.hasOwnProperty.call, not obj.hasOwnProperty. Identical
			// for a plain object and correct for one that is not - a key literally
			// named "hasOwnProperty" shadows the method and turns the guard into a
			// TypeError. `tMap` is keyed by caller-supplied array values here.
			if (!Object.prototype.hasOwnProperty.call(tMap, arr[tI])) {
				tResults.push(arr[tI]);
				tMap[hashFunc(arr[tI])] = true;
			}
		}
		return tResults;
	}

	/** Remove value from array, if it is present */
	static removeValue(array, value)
	{
		for (var tI = array.length - 1; tI >= 0; tI--)
		{
			if (array[tI] === value) {
				array.splice(tI, 1);
			}
		}
	}

	/** Checks if value is in array */
	static hasValue(array, value)
	{
		for (var tI = 0; tI < array.length; tI++)
		{
			if (array[tI] === value)
			{
				return true;
			}
		}
		return false;
	}

	/** Subtracts the elements in subArray from array */
	static subtract(array, subArray)
	{
		return Utils.removeIf(array, function (el) {
			return Utils.hasValue(subArray, el);
		});
	}
}


export class Region
{
	constructor(points)
	{
		this.points = points || [];
        this.length = points.length;
	}
	
	area() 
	{
        var area = 0,
            i,
            j,
            point1,
            point2;

        for (i = 0, j = this.length - 1; i < this.length; j = i, i += 1) {
            point1 = this.points[i];
            point2 = this.points[j];
            area += point1.x * point2.y;
            area -= point1.y * point2.x;
        }
        area *= 0.5;

        return area;
    };

    centroid() 
    {
        var x = 0,
            y = 0,
            i,
            j,
            f,
            point1,
            point2;

        for (i = 0, j = this.length - 1; i < this.length; j = i, i += 1) {
            point1 = this.points[i];
            point2 = this.points[j];
            f = point1.x * point2.y - point2.x * point1.y;
            x += (point1.x + point2.x) * f;
            y += (point1.y + point2.y) * f;
        }

        f = this.area() * 6;

        return new Vector2(x / f, y / f);
    };
}



