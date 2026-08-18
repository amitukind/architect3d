/**
 * The `Wall` query methods, none of which had a test (RM-006).
 *
 * ## What these have in common
 *
 * `distanceFrom`, `oppositeCorner`, `getClosestCorner` and
 * `updateAttachedRooms` are the pure-ish questions the rest of the model asks a
 * wall, and every one of them was at zero branch coverage. They are reached
 * constantly at runtime - `Corner.mergeWithIntersected` calls `distanceFrom` on
 * every wall in the plan on every corner move - but only ever through code
 * paths whose own tests assert something further downstream, so a wrong answer
 * here shows up as a mis-drawn room three layers away.
 *
 * Each one has a failure branch that matters and that nothing was reaching:
 * a wall type neither straight nor curved, a corner that is on neither end, a
 * point near neither end, and a wall whose corners have been detached. Those
 * are the cases written down below; the happy paths are here to make the
 * negatives legible rather than because they were in doubt.
 *
 * ## Why the thickness matters in getClosestCorner
 *
 * The method does not return the nearer corner. It returns a corner only if the
 * point is within `thickness * 2` of it, and null otherwise - so "closest" is a
 * misnomer for a proximity test with a hard cutoff. Pinned explicitly, because
 * a reader who trusts the name would write a caller that never handles null.
 */
import {describe, expect, it} from 'vitest';
import {Vector2} from 'three';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {WallTypes} from '../src/scripts/core/constants.js';

/** One wall from (0,0) to (100,0). */
function wall()
{
	const floorplan = new Floorplan();
	const start = floorplan.newCorner(0, 0);
	const end = floorplan.newCorner(100, 0);
	return {floorplan, start, end, wall: floorplan.newWall(start, end)};
}

describe('Wall.distanceFrom (RM-006)', () =>
{
	it('measures perpendicular distance to a straight wall', () =>
	{
		const {wall: w} = wall();
		expect(w.distanceFrom(new Vector2(50, 30))).toBeCloseTo(30, 6);
		expect(w.distanceFrom(new Vector2(50, 0))).toBeCloseTo(0, 6);
	});

	it('projects onto the curve for a curved wall', () =>
	{
		const {wall: w} = wall();
		w.wallType = WallTypes.CURVED;
		// The bezier of a wall whose control points have not been dragged still
		// runs between the two corners, so a point above the midpoint is about its
		// vertical distance away. Loose tolerance on purpose: this asserts that the
		// CURVED branch projects rather than what bezier-js returns to six places.
		expect(w.distanceFrom(new Vector2(50, 30))).toBeGreaterThan(0);
		expect(w.distanceFrom(new Vector2(50, 30))).toBeLessThan(60);
	});

	it('returns -1 for a wall that is neither straight nor curved', () =>
	{
		// Not reachable through the setter, which rejects anything else - so this
		// writes the private field directly. The fallthrough exists because
		// `wallType` is a number and nothing in the type system stops a fourth
		// value arriving from a saved document.
		const {wall: w} = wall();
		w._walltype = 999;
		expect(w.distanceFrom(new Vector2(50, 30))).toBe(-1);
	});
});

describe('Wall.oppositeCorner (RM-006)', () =>
{
	it('returns the far corner from either end', () =>
	{
		const {wall: w, start, end} = wall();
		expect(w.oppositeCorner(start)).toBe(end);
		expect(w.oppositeCorner(end)).toBe(start);
	});

	it('returns null for a corner this wall does not touch', () =>
	{
		const {floorplan, wall: w} = wall();
		const stranger = floorplan.newCorner(500, 500);
		expect(w.oppositeCorner(stranger)).toBeNull();
	});
});

describe('Wall.getClosestCorner (RM-006)', () =>
{
	it('returns a corner only within twice the wall thickness', () =>
	{
		const {wall: w, start, end} = wall();
		const reach = w.thickness * 2;

		expect(w.getClosestCorner(new Vector2(reach - 0.1, 0))).toBe(start);
		expect(w.getClosestCorner(new Vector2(100 - (reach - 0.1), 0))).toBe(end);
	});

	it('returns null for a point near the middle, however close the wall is', () =>
	{
		// The midpoint of a wall is ON the wall and belongs to neither corner. A
		// caller that assumed "closest" meant "nearer of the two" would get null
		// here and, if it did not check, a TypeError.
		const {wall: w} = wall();
		expect(w.getClosestCorner(new Vector2(50, 0))).toBeNull();
	});
});

describe('Wall.updateAttachedRooms (RM-006)', () =>
{
	it('forwards to both corners', () =>
	{
		const {wall: w, start, end} = wall();
		let updates = 0;
		const room = {updateArea: () => { updates++; }};
		start.attachRoom(room);
		end.attachRoom(room);

		w.updateAttachedRooms(true);
		expect(updates).toBe(2);
	});

	it('does not throw when a corner has been detached', () =>
	{
		// Both ends are guarded separately, and the guards are not symmetrical in
		// the source - one tests `!= null` and the other is a bare truthiness
		// check. Either way a half-detached wall must not take down a plan update.
		const {wall: w} = wall();
		w.start = null;
		expect(() => w.updateAttachedRooms(true)).not.toThrow();

		const other = wall();
		other.wall.end = null;
		expect(() => other.wall.updateAttachedRooms(true)).not.toThrow();
	});
});
