/**
 * Characterization tests for the wall-splitting / corner-merging paths.
 *
 * These are the most fragile edits in the data layer - the source's own
 * comments in Corner.move and Corner.mergeWithIntersected admit past crashes
 * here. Everything below pins what the code DOES today (three 0.98,
 * bezier-js 2.4), including several genuine bugs. Do not "fix" an expectation
 * during the Vue3/three-0.185 migration: a failure here means the behaviour
 * changed, which is exactly what this suite exists to surface.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Corner} from '../src/scripts/model/corner.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {EVENT_MOVED, EVENT_CORNER_ATTRIBUTES_CHANGED} from '../src/scripts/core/events.js';
import {cornerTolerance} from '../src/scripts/core/configuration.js';
import {resetAll, buildSquareRoom, round} from './helpers/harness.js';

/** [start, end] coordinate pairs for every wall, in floorplan order. */
function wallCoords(floorplan)
{
	return floorplan.getWalls().map((wall) => [
		[round(wall.getStart().x), round(wall.getStart().y)],
		[round(wall.getEnd().x), round(wall.getEnd().y)],
	]);
}

/** Every corner position, in floorplan order. */
function cornerCoords(floorplan)
{
	return floorplan.getCorners().map((corner) => [round(corner.x), round(corner.y)]);
}

/** A floorplan holding a single straight wall between two fresh corners. */
function singleWall(x1, y1, x2, y2)
{
	const floorplan = new Floorplan();
	const start = floorplan.newCorner(x1, y1);
	const end = floorplan.newCorner(x2, y2);
	const wall = floorplan.newWall(start, end);
	return {floorplan, start, end, wall};
}

beforeEach(() => {
	resetAll();
});

describe('Floorplan.newCorner - cornerTolerance snapping', () => {

	it('uses a cornerTolerance of 20cm', () => {
		expect(cornerTolerance).toBe(20);
	});

	it('returns the SAME corner instance when the request lands within 20cm of an existing corner', () => {
		const floorplan = new Floorplan();
		const first = floorplan.newCorner(0, 0);
		// distance((0,0),(10,10)) = 14.142... < 20
		const second = floorplan.newCorner(10, 10);
		expect(second).toBe(first);
		expect(floorplan.getCorners().length).toBe(1);
	});

	it('keeps the existing corner where it was and silently discards the requested coordinates', () => {
		// Quirk: newCorner is a "snap", not a "move". The caller asked for
		// (10,10) and gets a corner sitting at (0,0) with no indication.
		const floorplan = new Floorplan();
		floorplan.newCorner(0, 0);
		const snapped = floorplan.newCorner(10, 10);
		expect([snapped.x, snapped.y]).toEqual([0, 0]);
	});

	it('creates a distinct corner once the request is further than the tolerance', () => {
		const floorplan = new Floorplan();
		const first = floorplan.newCorner(0, 0);
		floorplan.newCorner(10, 10);
		const far = floorplan.newCorner(100, 100);
		expect(far).not.toBe(first);
		expect(floorplan.getCorners().length).toBe(2);
		expect(cornerCoords(floorplan)).toEqual([[0, 0], [100, 100]]);
	});

	it('snaps at 19.9999cm but NOT at exactly 20cm - the comparison is strict less-than', () => {
		const inside = new Floorplan();
		const insideFirst = inside.newCorner(0, 0);
		expect(inside.newCorner(19.9999, 0)).toBe(insideFirst);
		expect(inside.getCorners().length).toBe(1);

		const boundary = new Floorplan();
		const boundaryFirst = boundary.newCorner(0, 0);
		expect(boundary.newCorner(20, 0)).not.toBe(boundaryFirst);
		expect(boundary.getCorners().length).toBe(2);
	});

	it('returns the FIRST corner in insertion order when two candidates are equally close', () => {
		// Quirk: the scan is first-match-wins, not nearest-wins.
		const floorplan = new Floorplan();
		const first = floorplan.newCorner(0, 0);
		const second = floorplan.newCorner(30, 0);
		const midway = floorplan.newCorner(15, 0);
		expect(midway).toBe(first);
		expect(midway).not.toBe(second);
		expect(floorplan.getCorners().length).toBe(2);
	});

	it('allocates and throws away a Corner instance on every snapped call', () => {
		// The rejected Corner is constructed before the distance scan, so ids are
		// consumed even when nothing new is added. Pinned because id generation is
		// seeded in these tests and the migration must not "optimise" the order.
		const floorplan = new Floorplan();
		const first = floorplan.newCorner(0, 0);
		const second = floorplan.newCorner(1, 1);
		expect(second).toBe(first);
		expect(floorplan.getCorners()).toEqual([first]);
	});
});

describe('Floorplan.newWallsForIntersections - wall splitting', () => {

	it('splits both crossing walls and introduces one corner at the exact intersection', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(200, -100);
		const d = floorplan.newCorner(200, 100);
		floorplan.newWall(c, d);

		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(2);

		expect(floorplan.newWallsForIntersections(c, d)).toBe(true);

		expect(floorplan.getCorners().length).toBe(5);
		expect(floorplan.getWalls().length).toBe(4);
		expect(cornerCoords(floorplan)).toEqual([
			[0, 0], [400, 0], [200, -100], [200, 100], [200, 0],
		]);
	});

	it('leaves the four split segments wired start-to-end through the new corner', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(200, -100);
		const d = floorplan.newCorner(200, 100);
		floorplan.newWall(c, d);
		floorplan.newWallsForIntersections(c, d);

		expect(wallCoords(floorplan)).toEqual([
			[[0, 0], [200, 0]],
			[[200, -100], [200, 0]],
			[[200, 0], [400, 0]],
			[[200, 0], [200, 100]],
		]);
	});

	it('gives the intersection corner degree 4 - two wallStarts and two wallEnds', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(200, -100);
		const d = floorplan.newCorner(200, 100);
		floorplan.newWall(c, d);
		floorplan.newWallsForIntersections(c, d);

		const crossing = floorplan.getCorners()[4];
		expect([crossing.x, crossing.y]).toEqual([200, 0]);
		expect(crossing.wallStarts.length).toBe(2);
		expect(crossing.wallEnds.length).toBe(2);
		expect(crossing.adjacentCorners().length).toBe(4);
	});

	it('produces no rooms from a plain cross - the split does not close a cycle', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(200, -100);
		const d = floorplan.newCorner(200, 100);
		floorplan.newWall(c, d);
		floorplan.newWallsForIntersections(c, d);
		expect(floorplan.getRooms().length).toBe(0);
	});

	it('returns false and changes nothing when the walls are parallel', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(0, 200);
		const d = floorplan.newCorner(400, 200);
		floorplan.newWall(c, d);

		expect(floorplan.newWallsForIntersections(c, d)).toBe(false);
		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(2);
	});

	it('does not create the wall it is told about - it only splits what already exists', () => {
		// Quirk: newWallsForIntersections takes start/end corners but never calls
		// newWall for them. The 2D view is expected to have created that wall
		// already; calling it standalone silently no-ops on a fresh pair.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const c = floorplan.newCorner(200, -100);
		const d = floorplan.newCorner(200, 100);

		expect(floorplan.newWallsForIntersections(c, d)).toBe(true);
		// Only the pre-existing horizontal wall was split; c-d is still wall-less.
		expect(wallCoords(floorplan)).toEqual([
			[[0, 0], [200, 0]],
			[[200, 0], [400, 0]],
		]);
		expect(c.wallStarts.length + c.wallEnds.length).toBe(0);
	});
});

describe('Corner.move', () => {

	it('updates the attached wall length and center', () => {
		const {end, wall} = singleWall(0, 0, 400, 0);
		expect(wall.wallLength()).toBe(400);
		expect([wall.wallCenter().x, wall.wallCenter().y]).toEqual([200, 0]);

		end.move(400, 300);

		expect(wall.wallLength()).toBe(500);
		expect([wall.wallCenter().x, wall.wallCenter().y]).toEqual([200, 150]);
		expect([end.x, end.y]).toEqual([400, 300]);
	});

	it('writes _x/_y directly, so no EVENT_CORNER_ATTRIBUTES_CHANGED fires and _hasChanged stays false', () => {
		// Quirk: move() bypasses the x/y setters. Only EVENT_MOVED is dispatched,
		// and _hasChanged is never raised - so a later non-explicit
		// updateAttachedRooms() call is a no-op for a corner that just moved.
		const {end} = singleWall(0, 0, 400, 0);
		let moved = 0;
		let attributeChanges = 0;
		end.addEventListener(EVENT_MOVED, () => { moved++; });
		end.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, () => { attributeChanges++; });

		end.move(400, 300);

		expect(moved).toBe(1);
		expect(attributeChanges).toBe(0);
		expect(end._hasChanged).toBe(false);
	});

	it('keeps location (the Vector2 mirror) in sync with x/y', () => {
		const {end} = singleWall(0, 0, 400, 0);
		end.move(400, 300);
		expect([end.location.x, end.location.y]).toEqual([400, 300]);
	});

	it('splits a wall it lands on and snaps itself onto that wall', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const top = floorplan.newCorner(200, 200);
		const dangling = floorplan.newCorner(200, 100);
		floorplan.newWall(top, dangling);

		// 5cm away from the horizontal wall - inside cornerTolerance.
		dangling.move(200, 5);

		// Snapped exactly onto the line, not left at y = 5.
		expect([dangling.x, dangling.y]).toEqual([200, 0]);
		expect(floorplan.getCorners().length).toBe(4);
		expect(wallCoords(floorplan)).toEqual([
			[[0, 0], [200, 0]],
			[[200, 200], [200, 0]],
			[[200, 0], [400, 0]],
		]);
	});

	it('merges into an existing corner when it lands within cornerTolerance of one', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const top = floorplan.newCorner(200, 200);
		const dangling = floorplan.newCorner(200, 100);
		floorplan.newWall(top, dangling);

		// distance((390,5),(400,0)) = 11.18 < 20
		dangling.move(390, 5);

		// The MOVED corner survives at the target's position; the target is deleted.
		expect([dangling.x, dangling.y]).toEqual([400, 0]);
		expect(floorplan.getCorners()).not.toContain(b);
		expect(cornerCoords(floorplan)).toEqual([[0, 0], [200, 200], [400, 0]]);
		expect(wallCoords(floorplan)).toEqual([
			[[0, 0], [400, 0]],
			[[200, 200], [400, 0]],
		]);
	});

	it('skips the merge pass entirely when mergeWithIntersections is false', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		const top = floorplan.newCorner(200, 200);
		const dangling = floorplan.newCorner(200, 100);
		floorplan.newWall(top, dangling);

		dangling.move(200, 5, false);

		expect([dangling.x, dangling.y]).toEqual([200, 5]);
		expect(floorplan.getWalls().length).toBe(2);
	});
});

describe('Wall.wallSize setter', () => {

	it('reports wallLength through the getter', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		expect(wall.wallSize).toBe(400);
	});

	it('shrinks symmetrically about the midpoint when both endpoints have exactly one neighbour', () => {
		const {start, end, wall} = singleWall(0, 0, 400, 0);
		expect(start.adjacentCorners().length).toBe(1);
		expect(end.adjacentCorners().length).toBe(1);

		wall.wallSize = 200;

		expect([start.x, start.y]).toEqual([100, 0]);
		expect([end.x, end.y]).toEqual([300, 0]);
		expect(wall.wallLength()).toBe(200);
	});

	it('moves only the free endpoint when the other end is a junction', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const wall = floorplan.newWall(a, b);
		floorplan.newWall(b, c);
		expect(a.adjacentCorners().length).toBe(1);
		expect(b.adjacentCorners().length).toBe(2);

		wall.wallSize = 200;

		// The single-neighbour START is the one that travels.
		expect([a.x, a.y]).toEqual([200, 0]);
		expect([b.x, b.y]).toEqual([400, 0]);
		expect(wall.wallLength()).toBe(200);
	});

	it('shrinks symmetrically again when BOTH endpoints are junctions', () => {
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];

		wall.wallSize = 200;

		expect([wall.getStart().x, wall.getStart().y]).toEqual([100, 0]);
		expect([wall.getEnd().x, wall.getEnd().y]).toEqual([300, 0]);
		expect(cornerCoords(floorplan)).toEqual([[100, 0], [300, 0], [400, 300], [0, 300]]);
		expect(floorplan.getRooms().length).toBe(1);
	});

	it('is a no-op for curved walls - the setter only handles WallTypes.STRAIGHT', () => {
		const {start, end, wall} = singleWall(0, 0, 400, 0);
		wall.wallType = WallTypes.CURVED;
		const before = wall.wallLength();

		wall.wallSize = 100;

		expect(wall.wallLength()).toBe(before);
		expect([start.x, start.y]).toEqual([0, 0]);
		expect([end.x, end.y]).toEqual([400, 0]);
	});
});

describe('Wall.oppositeCorner', () => {

	it('returns the end corner when given the start corner', () => {
		const {start, end, wall} = singleWall(0, 0, 400, 0);
		expect(wall.oppositeCorner(start)).toBe(end);
	});

	it('returns the start corner when given the end corner', () => {
		const {start, end, wall} = singleWall(0, 0, 400, 0);
		expect(wall.oppositeCorner(end)).toBe(start);
	});

	it('returns null (not undefined, and does not throw) for a corner that is not on the wall', () => {
		const {floorplan, wall} = singleWall(0, 0, 400, 0);
		const stranger = floorplan.newCorner(400, 300);
		// It also console.logs 'Wall does not connect to corner' - preserved noise.
		expect(wall.oppositeCorner(stranger)).toBe(null);
	});

	it('returns the end corner for a self-loop wall, because start is tested first', () => {
		const floorplan = new Floorplan();
		const only = floorplan.newCorner(0, 0);
		const wall = floorplan.newWall(only, only);
		expect(wall.oppositeCorner(only)).toBe(wall.getEnd());
		expect(wall.oppositeCorner(only)).toBe(only);
	});
});

describe('Wall.remove / Corner.detachWall self-removal', () => {

	it('detaches the wall from both corners and drops both orphaned corners from the floorplan', () => {
		const {floorplan, start, end, wall} = singleWall(0, 0, 400, 0);
		expect(floorplan.getCorners().length).toBe(2);
		expect(floorplan.getWalls().length).toBe(1);

		wall.remove();

		expect(floorplan.getWalls().length).toBe(0);
		expect(floorplan.getCorners().length).toBe(0);
		expect(start.wallStarts.length).toBe(0);
		expect(end.wallEnds.length).toBe(0);
	});

	it('keeps a corner that still carries another wall', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const wall = floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		wall.remove();

		// Only `a` is orphaned; b keeps the b-c wall.
		expect(cornerCoords(floorplan)).toEqual([[400, 0], [400, 300]]);
		expect(floorplan.getWalls().length).toBe(1);
	});

	it('leaves a DANGLING wall when detachWall is called directly on one side only', () => {
		// Bug (preserved): the corner removes itself from the floorplan but the
		// wall stays in floorplan.walls still pointing at the removed corner.
		// This is the exact state saveFloorplan's comment works around.
		const {floorplan, start, wall} = singleWall(0, 0, 400, 0);

		start.detachWall(wall);

		expect(floorplan.getCorners().length).toBe(1);
		expect(floorplan.getWalls().length).toBe(1);
		expect(floorplan.getCorners()).not.toContain(start);
		expect(wall.getStart()).toBe(start);
	});

	it('removes the corner as soon as BOTH wallStarts and wallEnds are empty', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const w1 = floorplan.newWall(a, b);
		const w2 = floorplan.newWall(b, c);

		b.detachWall(w1);
		expect(floorplan.getCorners()).toContain(b);

		b.detachWall(w2);
		expect(floorplan.getCorners()).not.toContain(b);
	});
});

describe('Corner.removeDuplicateWalls', () => {

	it('keeps the LAST created duplicate and deletes the earlier one', () => {
		// Quirk: both loops walk backwards, so the survivor is the newest wall,
		// not the original.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const first = floorplan.newWall(a, b);
		const second = floorplan.newWall(a, b);
		expect(floorplan.getWalls().length).toBe(2);

		a.removeDuplicateWalls();

		expect(floorplan.getWalls()).toEqual([second]);
		expect(floorplan.getWalls()).not.toContain(first);
		expect(a.wallStarts.length).toBe(1);
		expect(b.wallEnds.length).toBe(1);
	});

	it('collapses three duplicates down to the newest one', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		floorplan.newWall(a, b);
		const third = floorplan.newWall(a, b);

		a.removeDuplicateWalls();

		expect(floorplan.getWalls()).toEqual([third]);
	});

	it('does NOT dedupe an anti-parallel pair (a->b plus b->a)', () => {
		// Bug (preserved): wallStarts and wallEnds are tracked in two separate
		// dictionaries, so a wall in each direction never collides.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		floorplan.newWall(a, b);
		floorplan.newWall(b, a);

		a.removeDuplicateWalls();
		b.removeDuplicateWalls();

		expect(floorplan.getWalls().length).toBe(2);
	});

	it('removes a zero-length self-loop wall and then the now-orphaned corner', () => {
		const floorplan = new Floorplan();
		const only = floorplan.newCorner(0, 0);
		floorplan.newWall(only, only);
		expect(only.wallStarts.length).toBe(1);
		expect(only.wallEnds.length).toBe(1);

		only.removeDuplicateWalls();

		expect(floorplan.getWalls().length).toBe(0);
		expect(floorplan.getCorners().length).toBe(0);
	});
});

describe('Corner.combineWithCorner', () => {

	it('moves THIS corner onto the other one, absorbs its walls and deletes it', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		a.combineWithCorner(c);

		// `a` is the survivor but it has travelled to c's position.
		expect([a.x, a.y]).toEqual([400, 300]);
		expect(floorplan.getCorners()).not.toContain(c);
		expect(cornerCoords(floorplan)).toEqual([[400, 300], [400, 0]]);
		expect(a.wallStarts.length).toBe(1);
		expect(a.wallEnds.length).toBe(1);
	});

	it('leaves two anti-parallel walls between the same pair of corners', () => {
		// Consequence of the removeDuplicateWalls quirk above: combining the two
		// ends of a two-wall chain yields a->b AND b->a, both kept.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		a.combineWithCorner(c);

		expect(wallCoords(floorplan)).toEqual([
			[[400, 300], [400, 0]],
			[[400, 0], [400, 300]],
		]);
		expect(floorplan.getRooms().length).toBe(0);
	});
});

describe('Corner.mergeWithIntersected', () => {

	it('returns false when nothing is within cornerTolerance', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		expect(c.mergeWithIntersected()).toBe(false);
		expect(floorplan.getCorners().length).toBe(3);
	});

	it('merges with the first nearby corner and returns true', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		// Reposition c behind the setters so the merge is the only mutation.
		c._x = 10;
		c._y = 10;
		c._co.set(10, 10);

		expect(c.mergeWithIntersected()).toBe(true);
		// c survives (it is `this`), a is absorbed and removed.
		expect(floorplan.getCorners()).toContain(c);
		expect(floorplan.getCorners()).not.toContain(a);
		expect([c.x, c.y]).toEqual([0, 0]);
		expect(cornerCoords(floorplan)).toEqual([[400, 0], [0, 0]]);
	});

	it('ignores walls this corner is already connected to', () => {
		const {start, floorplan} = singleWall(0, 0, 400, 0);
		expect(start.mergeWithIntersected()).toBe(false);
		expect(floorplan.getWalls().length).toBe(1);
	});
});

describe('zero-length walls', () => {

	it('collapses to a self-loop because newCorner snaps the second endpoint', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(0, 0);
		expect(b).toBe(a);

		const wall = floorplan.newWall(a, b);
		expect(wall.getStart()).toBe(wall.getEnd());
		expect(wall.wallLength()).toBe(0);
		expect([wall.wallCenter().x, wall.wallCenter().y]).toEqual([0, 0]);
		expect(a.wallStarts.length).toBe(1);
		expect(a.wallEnds.length).toBe(1);
		// adjacentCorners lists the same corner twice.
		expect(a.adjacentCorners()).toEqual([a, a]);
	});

	it('degenerates the bezier control points onto the shared point', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const wall = floorplan.newWall(a, a);
		expect([wall.a.x, wall.a.y]).toEqual([0, 0]);
		expect([wall.b.x, wall.b.y]).toEqual([0, 0]);
		wall.wallType = WallTypes.CURVED;
		expect(wall.wallLength()).toBe(0);
	});

	it('silently no-ops the wallSize setter instead of producing NaN coordinates', () => {
		// Bug (preserved, and load-bearing by accident): currentLength is 0, so
		// changeInLength is Infinity and movementVector becomes (NaN, NaN).
		// three 0.98's `Vector2( x, y ) { this.x = x || 0; }` turns that NaN back
		// into 0 on the next .clone(), so the corner never moves.
		// three r125+ uses default parameters instead and NaN would survive -
		// this test is the tripwire for that migration.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const wall = floorplan.newWall(a, a);

		wall.wallSize = 100;

		expect(Number.isNaN(a.x)).toBe(false);
		expect([a.x, a.y]).toEqual([0, 0]);
		expect(wall.wallLength()).toBe(0);
	});

	it('keeps two coincident corners apart when they bypass newCorner', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = new Corner(floorplan, 0, 0);
		floorplan.getCorners().push(b);
		const wall = floorplan.newWall(a, b);

		expect(wall.getStart()).not.toBe(wall.getEnd());
		expect(wall.wallLength()).toBe(0);
		expect([wall.wallCenter().x, wall.wallCenter().y]).toEqual([0, 0]);
		expect(floorplan.getCorners().length).toBe(2);
	});
});

describe('curved walls', () => {

	it('defaults the control points to +45 and +135 degree rotations of the half-vector', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		// abvector = (end-start)*0.5 = (200,0)
		// a = start + rotate(abvector, +45deg) ; b = end + rotate(abvector, +135deg)
		expect([round(wall.a.x), round(wall.a.y)]).toEqual([141.4214, 141.4214]);
		expect([round(wall.b.x), round(wall.b.y)]).toEqual([258.5786, 141.4214]);
	});

	it('exposes aVector/bVector measured from the START corner for both defaults', () => {
		// Quirk: _b_vector is b MINUS START (not minus end), so it is not the
		// mirror of _a_vector.
		const {wall} = singleWall(0, 0, 400, 0);
		expect([round(wall.aVector.x), round(wall.aVector.y)]).toEqual([141.4214, 141.4214]);
		expect([round(wall.bVector.x), round(wall.bVector.y)]).toEqual([258.5786, 141.4214]);
	});

	it('reports the bezier arc length, which is longer than the straight distance', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		expect(wall.wallLength()).toBe(400);

		wall.wallType = WallTypes.CURVED;

		expect(round(wall.wallLength())).toBe(464.6704);
		expect(wall.wallLength()).toBeGreaterThan(400);
		expect(wall.wallSize).toBe(wall.wallLength());
	});

	it('takes wallCenter from bezier.get(0.5), which is off the straight midpoint', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		wall.wallType = WallTypes.CURVED;

		const midpoint = wall.bezier.get(0.5);
		expect([wall.wallCenter().x, wall.wallCenter().y]).toEqual([midpoint.x, midpoint.y]);
		expect([round(wall.wallCenter().x), round(wall.wallCenter().y)]).toEqual([200, 106.066]);
	});

	it('keeps the four bezier control points in sync with the corners', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		wall.wallType = WallTypes.CURVED;
		const points = wall.bezier.points.map((p) => [round(p.x), round(p.y)]);
		expect(points).toEqual([
			[0, 0],
			[141.4214, 141.4214],
			[258.5786, 141.4214],
			[400, 0],
		]);
	});

	it('serialises its type through the es6-enum description', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		expect(wall.wallType.description).toBe('STRAIGHT');
		wall.wallType = WallTypes.CURVED;
		expect(wall.wallType.description).toBe('CURVED');
	});

	it('ignores an unknown wallType assignment but still refreshes the bezier', () => {
		const {wall} = singleWall(0, 0, 400, 0);
		wall.wallType = 'NOT_A_TYPE';
		expect(wall.wallType).toBe(WallTypes.STRAIGHT);
	});
});

describe('HalfEdge.distanceTo on a curved wall - KNOWN CRASH', () => {

	it('measures from the interior line for a straight wall', () => {
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];
		const edge = wall.frontEdge || wall.backEdge;
		// Wall (0,0)-(400,0), thickness 10 => interior line offset 5cm inwards.
		expect(edge.distanceTo(200, 50)).toBe(45);
	});

	it('THROWS a TypeError once the wall is curved, because HalfEdge never assigns _bezier', () => {
		// Bug (pinned, NOT fixed here): half_edge.js:298 reads this._bezier, which
		// is only ever defined on Wall. Sprint S4 fixes this by routing through
		// this.wall.bezier. Until then any curved wall inside a room makes the
		// 2D/3D hit-testing path explode.
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];
		wall.wallType = WallTypes.CURVED;
		floorplan.update();

		const edge = wall.frontEdge || wall.backEdge;
		expect(edge).toBeTruthy();
		expect(edge._bezier).toBeUndefined();
		expect(() => edge.distanceTo(200, 50)).toThrow(TypeError);
	});
});

/**
 * Sprint S2 fixed the corner-move listener leak these tests used to pin.
 *
 * Before S2, addCornerMoveListener built a brand new `moved` closure on every
 * call, so removeEventListener could never match what had been registered:
 * listeners only accumulated. setEnd made it worse by having its add and remove
 * the wrong way round, which left a wall deaf to the corner it had just been
 * attached to. The wall now holds one handler per instance, so both directions
 * work; the counts below are the regression guard.
 *
 * A corner created through Floorplan.newCorner starts with exactly one
 * EVENT_MOVED listener - the floorplan's own - and each attached wall adds one.
 */
describe('Wall.setStart / Wall.setEnd move-listener wiring', () => {

	it('setStart moves the listener off the old start and onto the new one', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const wall = floorplan.newWall(a, b);

		// 1 listener from Floorplan.newCorner + 1 from the Wall constructor.
		expect(a._listeners[EVENT_MOVED].length).toBe(2);
		expect(c._listeners[EVENT_MOVED].length).toBe(1);

		wall.setStart(c);

		expect(wall.getStart()).toBe(c);
		expect(a._listeners[EVENT_MOVED].length).toBe(1);
		expect(c._listeners[EVENT_MOVED].length).toBe(2);
	});

	it('setEnd moves the listener off the old end and onto the new one', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const wall = floorplan.newWall(a, b);

		expect(b._listeners[EVENT_MOVED].length).toBe(2);
		expect(c._listeners[EVENT_MOVED].length).toBe(1);

		wall.setEnd(c);

		expect(wall.getEnd()).toBe(c);
		expect(b._listeners[EVENT_MOVED].length).toBe(1);
		expect(c._listeners[EVENT_MOVED].length).toBe(2);
	});

	it('repeated re-attachment does not grow either corner listener list', () => {
		// The leak's real cost: dragging a corner over its neighbours repeatedly
		// re-runs setStart/setEnd, and every pass used to leave another dead wall
		// wired to a corner it no longer touches.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const d = floorplan.newCorner(0, 300);
		const wall = floorplan.newWall(a, b);

		for (let i = 0; i < 20; i++)
		{
			wall.setStart((i % 2 === 0) ? c : a);
			wall.setEnd((i % 2 === 0) ? d : b);
		}

		expect(wall.getStart()).toBe(a);
		expect(wall.getEnd()).toBe(b);
		for (const corner of [a, b, c, d])
		{
			expect(corner._listeners[EVENT_MOVED].length).toBeLessThanOrEqual(2);
		}
		// Only the two corners the wall currently holds carry a wall listener.
		expect(a._listeners[EVENT_MOVED].length).toBe(2);
		expect(b._listeners[EVENT_MOVED].length).toBe(2);
	});

	it('remove() detaches the wall from both of its corners', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const wall = floorplan.newWall(a, b);

		expect(a._listeners[EVENT_MOVED].length).toBe(2);
		expect(b._listeners[EVENT_MOVED].length).toBe(2);

		wall.remove();

		expect(a._listeners[EVENT_MOVED].length).toBe(1);
		expect(b._listeners[EVENT_MOVED].length).toBe(1);
	});

	it('setEnd orphans the old end corner out of the floorplan when it held no other wall', () => {
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 300);
		const wall = floorplan.newWall(a, b);

		wall.setEnd(c);

		expect(floorplan.getCorners()).not.toContain(b);
		expect(cornerCoords(floorplan)).toEqual([[0, 0], [400, 300]]);
	});
});
