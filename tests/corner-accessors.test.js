/**
 * The corner accessors and the paths nothing was driving (RM-006).
 *
 * ## Why these, and why now
 *
 * `Corner`'s `x` and `y` setters are not assignments. Each one decides whether
 * the value moved, latches `_hasChanged`, rewrites the shared `_co` vector,
 * re-derives every attached room and dispatches an attributes-changed event -
 * and the `y` setter had never been called by any test in the suite. That is
 * the kind of gap that survives because the class is usually driven through
 * `move()`, which sets both at once and takes the same branch every time.
 *
 * RM-005 C2 added guards through this file while taking the library type tier
 * to zero, and the branch coverage floor was breached in that sprint without
 * anybody noticing, because the C2 close-out ran every gate except
 * `npm run test:coverage`. These are the cheapest real branches to close it
 * with: no fixtures, no rendering, and every assertion is about behaviour the
 * class already promises.
 *
 * ## Characterization, not specification
 *
 * The `_hasChanged` latch below is a real oddity - once set, it stays set, so a
 * later assignment of an IDENTICAL value still fires an event. That is pinned
 * here as it is rather than corrected, for the reason `wall-corner-ops.test.js`
 * gives at the top of the file: a failure here means the behaviour changed, and
 * during a migration that is exactly what a test should surface.
 */
import {describe, expect, it} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {EVENT_CORNER_ATTRIBUTES_CHANGED} from '../src/scripts/core/events.js';

/** Record every attributes-changed event a corner dispatches. */
function watch(corner)
{
	const seen = [];
	corner.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, (event) => seen.push(event.info));
	return seen;
}

describe('Corner.x and Corner.y setters (RM-006)', () =>
{
	it('a move past the epsilon reports where it came from and where it went', () =>
	{
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(10, 20);
		const events = watch(corner);

		corner.x = 40;
		expect(corner.x).toBe(40);
		expect(events).toEqual([{from: 10, to: 40}]);

		corner.y = 55;
		expect(corner.y).toBe(55);
		expect(events[1]).toEqual({from: 20, to: 55});
	});

	it('keeps the shared location vector in step with both setters', () =>
	{
		// `_co` is handed out by `location` and is what the 2D and 3D layers read.
		// A setter that updated `_x` and forgot `_co` would leave the model correct
		// and the drawing stale, which no assertion on `corner.x` can see.
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(0, 0);

		corner.x = 12;
		corner.y = 34;
		expect({x: corner.location.x, y: corner.location.y}).toEqual({x: 12, y: 34});
	});

	it('a change smaller than the epsilon does not latch, and stays silent', () =>
	{
		// The quiet path, and the one nothing was exercising. 1e-6 is the
		// threshold; half of it must not count as movement.
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(5, 5);
		const events = watch(corner);

		corner.x = 5 + 5e-7;
		corner.y = 5 + 5e-7;

		expect(events).toEqual([]);
		// The value is still written - only the notification is suppressed - so the
		// corner is not silently pinned to its old coordinate.
		expect(corner.x).toBe(5 + 5e-7);
		expect(corner.y).toBe(5 + 5e-7);
		// And `_co` is deliberately NOT updated on this path, which is the
		// behaviour as written rather than a claim that it is right.
		expect(corner.location.x).toBe(5);
	});

	it('the changed flag is consumed by the room update, so a repeat is quiet', () =>
	{
		// Worth stating explicitly because the setter reads as a latch and is not
		// one. `_hasChanged` is set on a real move, and then
		// `updateAttachedRooms()` clears it on the way out - so the flag is
		// CONSUMED rather than sticky, and writing the same value again takes the
		// silent path.
		//
		// The first draft of this test asserted the opposite and failed, which is
		// the whole reason it is written down: reading the setter alone suggests a
		// latch, and the clearing happens sixty lines away in another method.
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(0, 0);
		const events = watch(corner);

		corner.x = 100;
		expect(events).toEqual([{from: 0, to: 100}]);

		corner.x = 100;
		expect(events, 'a repeated identical write should be silent').toHaveLength(1);

		// And a real move afterwards is heard again, so nothing has been wedged
		// shut by the clear.
		corner.x = 250;
		expect(events[1]).toEqual({from: 100, to: 250});
	});

	it('a corner with an attached room re-derives its area on a move', () =>
	{
		// This is what the flag is FOR. `updateAttachedRooms` is the only reason
		// the setter does more than assign, and it is reached from the same branch
		// the event is.
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(0, 0);
		let updates = 0;
		corner.attachRoom({updateArea: () => { updates++; }});

		corner.x = 75;
		expect(updates).toBe(1);

		// Sub-epsilon: no move, so no re-derivation either.
		corner.x = 75 + 1e-9;
		expect(updates).toBe(1);
	});
});

describe('Corner.attachRoom (RM-006)', () =>
{
	it('attaches a room and hands the list back', () =>
	{
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(0, 0);
		const room = {name: 'a room'};

		corner.attachRoom(room);
		expect(corner.getAttachedRooms()).toContain(room);
	});

	it('ignores a falsy room rather than storing a hole', () =>
	{
		// The guard exists because `attachedRooms` is iterated by
		// `updateAttachedRooms` on every coordinate change; one null in the list
		// turns a corner move into a TypeError.
		const floorplan = new Floorplan();
		const corner = floorplan.newCorner(0, 0);
		const before = corner.getAttachedRooms().length;

		corner.attachRoom(null);
		corner.attachRoom(undefined);

		expect(corner.getAttachedRooms()).toHaveLength(before);
	});
});

describe('Corner.snapToAxis (RM-006)', () =>
{
	/** Two corners joined by a wall, so they are adjacent. */
	function pair(x1, y1, x2, y2)
	{
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(x1, y1);
		const b = floorplan.newCorner(x2, y2);
		floorplan.newWall(a, b);
		return {floorplan, a, b};
	}

	it('snaps both axes when a neighbour is inside the tolerance on both', () =>
	{
		const {a, b} = pair(0, 0, 3, 3);
		expect(a.snapToAxis(10)).toEqual({x: true, y: true});
		expect({x: a.x, y: a.y}).toEqual({x: b.x, y: b.y});
	});

	it('snaps only the axis that qualifies', () =>
	{
		// x is 2 away and y is 400 away, so a tolerance of 10 must move one and
		// leave the other. Both halves of both conditions are reached here.
		const {a, b} = pair(0, 0, 2, 400);
		expect(a.snapToAxis(10)).toEqual({x: true, y: false});
		expect(a.x).toBe(b.x);
		expect(a.y).toBe(0);
	});

    it('snaps nothing when the neighbour is outside the tolerance', () =>
	{
		const {a} = pair(0, 0, 500, 500);
		expect(a.snapToAxis(10)).toEqual({x: false, y: false});
		expect({x: a.x, y: a.y}).toEqual({x: 0, y: 0});
	});

	it('reports nothing snapped for a corner with no neighbours', () =>
	{
		const floorplan = new Floorplan();
		const lonely = floorplan.newCorner(0, 0);
		expect(lonely.snapToAxis(10)).toEqual({x: false, y: false});
	});
});
