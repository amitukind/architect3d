// @ts-check
import {Configuration, snapTolerance} from '../core/configuration.js';

/**
 * Item-to-item and item-to-wall snapping, and stacking on surfaces
 * (RM-012 J4).
 *
 * ## Why this is a pure module and not a method on Item
 *
 * Because the interesting part is arithmetic over a set of rectangles, and
 * arithmetic that has no scene, no mesh and no renderer in it is arithmetic that
 * can be tested at the numbers rather than at the pixels. `Item` calls in; every
 * function here takes plain boxes and returns plain numbers.
 *
 * ## What snapping means here
 *
 * Not "to the grid" - `Configuration`'s `snapToGrid` already does that for the
 * 2D drawing tools, and a grid is a property of the paper rather than of the
 * furniture. This is snapping to *what is already there*: a sofa's edge lining
 * up with the bookcase beside it, a rug's centre with a table's, a cabinet's
 * back against a wall. Those are the alignments somebody furnishing a room is
 * trying to hit by eye, and they are the ones worth catching.
 *
 * Six candidate lines per axis, which is what makes it feel right rather than
 * fussy: for each neighbour, its two edges and its centre. An item's **near**
 * edge can meet a neighbour's **far** edge (they sit side by side), edge can
 * meet edge (they line up flush), and centre can meet centre.
 *
 * ## The tolerance is in centimetres and is already configured
 *
 * `Configuration`'s `snapTolerance` is 25 cm and has existed since the fork. It
 * was only ever read by the 2D corner snapping; using it here means one number
 * for "how close counts as meant", rather than a second one that disagrees.
 *
 * ## Stacking is a separate question and is answered separately
 *
 * A snap is horizontal and a stack is vertical, and mixing them makes both
 * unpredictable - an item nudged sideways onto a table would suddenly jump up
 * onto it. So `stackOn` is asked only about the vertical, only when the moving
 * item's footprint is genuinely over another's, and it returns a height rather
 * than applying one.
 */

/** How far apart two lines may be and still count as meant, in centimetres. */
export function tolerance()
{
	var configured = Configuration.getNumericValue(snapTolerance);
	return (configured > 0) ? configured : 25;
}

/**
 * An item as this module sees it: a footprint and a height.
 *
 * @typedef {Object} SnapBox
 * @property {number} x Centre, centimetres.
 * @property {number} z Centre.
 * @property {number} y **Base**, centimetres above the floor - not the centre,
 *   which is what `item.position.y` holds. See `boxOf`.
 * @property {number} halfX Half width. Always positive, including when mirrored.
 * @property {number} halfZ Half depth.
 * @property {number} height Full height.
 */

/**
 * Read a `SnapBox` off an item.
 *
 * `position.y` is the item's **centre**: `initObject` translates the geometry so
 * its bounding box is centred on the origin, and `FloorItem.resized` then sets
 * `position.y = halfSize.y`, which puts a floor item's base on the floor. So the
 * base is the centre less the half height, and that is what this normalises to -
 * because "what can I stand on" is a question about the top of a thing and the
 * top of a thing is its base plus its height.
 *
 * The half sizes are taken absolute, so a mirrored item is the size it looks
 * (RM-012 J4).
 *
 * @param {Object} item
 * @returns {SnapBox}
 */
export function boxOf(item)
{
	var half = item.halfSize || {x: 0, y: 0, z: 0};
	return {
		x: item.position.x,
		z: item.position.z,
		y: item.position.y - Math.abs(half.y),
		halfX: Math.abs(half.x),
		halfZ: Math.abs(half.z),
		height: Math.abs(half.y) * 2,
	};
}

/**
 * Every line on one axis that a neighbour offers to snap to.
 *
 * @param {SnapBox} box
 * @param {string} axis 'x' or 'z'
 * @returns {Array<number>}
 */
function linesOf(box, axis)
{
	var centre = (axis === 'z') ? box.z : box.x;
	var half = (axis === 'z') ? box.halfZ : box.halfX;
	return [centre - half, centre, centre + half];
}

/**
 * Find the nearest snap for one axis, or null.
 *
 * The moving item offers three lines of its own - its two edges and its centre -
 * and each neighbour offers three. The nearest pairing inside the tolerance
 * wins, and the answer is expressed as the *centre* the moving item should take,
 * because that is what a position is.
 *
 * @param {SnapBox} moving
 * @param {Array<SnapBox>} others
 * @param {string} axis
 * @param {number} limit
 * @returns {?{centre: number, line: number, distance: number}}
 */
export function snapAxis(moving, others, axis, limit)
{
	var half = (axis === 'z') ? moving.halfZ : moving.halfX;
	var centre = (axis === 'z') ? moving.z : moving.x;
	var mine = [-half, 0, half];
	/** @type {?{centre: number, line: number, distance: number}} */
	var best = null;

	for (var other of others)
	{
		for (var line of linesOf(other, axis))
		{
			for (var offset of mine)
			{
				// Where the moving item's centre would have to be for this one of its
				// lines to land on this one of the neighbour's.
				var wanted = line - offset;
				var distance = Math.abs(wanted - centre);
				if (distance > limit)
				{
					continue;
				}
				// Strictly nearer, so a tie keeps the first candidate rather than
				// flickering between two equal ones as the pointer moves.
				if (!best || distance < best.distance)
				{
					best = {centre: wanted, line: line, distance: distance};
				}
			}
		}
	}
	return best;
}

/**
 * Snap a moving item to whatever is near it on the floor plane.
 *
 * @param {SnapBox} moving Where the pointer has put it.
 * @param {Array<SnapBox>} others Everything it could snap to.
 * @param {{tolerance?: number}} [options]
 * @returns {{x: number, z: number, snappedX: boolean, snappedZ: boolean,
 *   guides: Array<{axis: string, at: number}>}}
 */
export function snapToNeighbours(moving, others, options)
{
	var limit = (options && options.tolerance) || tolerance();
	var x = snapAxis(moving, others, 'x', limit);
	var z = snapAxis(moving, others, 'z', limit);
	var guides = [];
	if (x) { guides.push({axis: 'x', at: x.line}); }
	if (z) { guides.push({axis: 'z', at: z.line}); }
	return {
		x: x ? x.centre : moving.x,
		z: z ? z.centre : moving.z,
		snappedX: !!x,
		snappedZ: !!z,
		guides: guides,
	};
}

/**
 * How much of the moving item's footprint sits over another's, as a fraction of
 * its own area.
 *
 * @param {SnapBox} moving
 * @param {SnapBox} other
 * @returns {number} 0 to 1.
 */
export function overlap(moving, other)
{
	var overX = Math.min(moving.x + moving.halfX, other.x + other.halfX)
		- Math.max(moving.x - moving.halfX, other.x - other.halfX);
	var overZ = Math.min(moving.z + moving.halfZ, other.z + other.halfZ)
		- Math.max(moving.z - moving.halfZ, other.z - other.halfZ);
	if (overX <= 0 || overZ <= 0)
	{
		return 0;
	}
	var area = (moving.halfX * 2) * (moving.halfZ * 2);
	return area > 0 ? (overX * overZ) / area : 0;
}

/**
 * How much of its footprint has to be over a surface before it counts as on it.
 *
 * Half. A bowl on the corner of a table is on the table; a bowl beside the table
 * with one centimetre of overhang is not, and a rule that took any overlap at
 * all would lift everything that ever passed near anything.
 */
export const STACK_COVERAGE = 0.5;

/**
 * How high a surface may be and still be something you can put a thing on,
 * in centimetres.
 *
 * Not invented. J1 measured six standard heights out of this catalog while
 * establishing the Kenney kit's unit scale, and they are the working surfaces a
 * person actually puts things on:
 *
 *   kitchen base unit  90 cm     bar stool  87 cm
 *   round table        75 cm     desk       75 cm
 *   fridge            180 cm     door frame 203 cm
 *
 * 120 sits above every one of the four surfaces and below the two things that
 * are not surfaces. So dragging a bowl across a table puts it on the table, and
 * dragging it past a fridge does not put it on the fridge - which is the
 * distinction, and it is drawn where this catalog's own measurements put it
 * rather than where a round number would.
 *
 * Above that height a surface is still stackable, but only from close to:
 * something already on top of a bookcase can be nudged around up there.
 */
export const STACK_REACH_CM = 120;

/**
 * What height this item should rest at, given what is under it.
 *
 * The **top of the tallest thing it is genuinely over**, or the floor. Returns a
 * height rather than applying one, so the caller decides whether stacking is on
 * - which matters, because dragging a rug across a room should not put it on
 * every table it passes.
 *
 * A candidate is only a surface if its own top is at or below where the moving
 * item already is, within a tolerance: a bookcase taller than the shelf you are
 * placing is something to go *beside*, not something to levitate onto.
 *
 * @param {SnapBox} moving
 * @param {Array<SnapBox>} others
 * @param {{tolerance?: number, coverage?: number, reach?: number}} [options]
 * @returns {{y: number, on: ?SnapBox}}
 */
export function stackOn(moving, others, options)
{
	var limit = (options && options.tolerance) || tolerance();
	var coverage = (options && options.coverage !== undefined) ? options.coverage : STACK_COVERAGE;
	var best = null;
	var y = 0;

	for (var other of others)
	{
		var top = other.y + other.height;
		if (top <= 0)
		{
			continue;
		}
		if (overlap(moving, other) < coverage)
		{
			continue;
		}
		// Reachable: either it is a working surface, or the item is already up
		// there. Without this, dragging a lamp across a furnished room would
		// teleport it to the top of the tallest thing in it - and with only the
		// second half of it, dragging a bowl across a table would leave the bowl
		// on the floor, which is the whole feature not working.
		var reach = (options && options.reach !== undefined) ? options.reach : STACK_REACH_CM;
		if (top > reach && top > moving.y + limit)
		{
			continue;
		}
		if (top > y)
		{
			y = top;
			best = other;
		}
	}
	return {y: y, on: best};
}
