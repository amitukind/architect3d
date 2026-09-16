/**
 * Characterization tests for Floorplan.findRooms (src/scripts/model/floorplan.js).
 *
 * findRooms is the semantic centre of the data layer: it walks the planar
 * straight-line graph of corners/walls, keeps the tightest cycles, drops
 * duplicates and drops clockwise loops. It was frozen as-is for the
 * Vue 3 / three 0.185 migration, so everything below records what the
 * algorithm DOES TODAY - including its quirks - rather than what a textbook
 * room finder would do. A failure here is a signal to re-check the change.
 *
 * Coordinates are in cm, y grows DOWNWARD on the 2D canvas.
 *
 * ## `centrelineArea`, not `area` (RM-008 F2)
 *
 * Every figure below was written against `Room.area`, which was the area
 * between the wall CENTRELINES. F2 made `area` the interior polygon - the floor
 * a person can stand on - because the centreline figure is neither the inside
 * of the room nor the outside, and it reads 5.2 % high at the default 10 cm
 * wall thickness and about 23 % high at 40 (RM-009 U-7).
 *
 * Re-pointed rather than re-numbered, and the distinction matters: these tests
 * are about room DETECTION - which cycles are found, and that the polygon
 * arithmetic is the shoelace formula rather than a bounding box. The centreline
 * polygon is the one that answers those questions, and it is still computed and
 * still exposed. `tests/wall-joins.test.js` is where the interior figure is
 * asserted.
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Utils} from '../src/scripts/core/utils.js';
import {resetAll, unseedRandom, buildPolygon, buildSquareRoom, buildLShapedRoom,
	buildSharedWallRooms, roomSignature, roomSignatures, round} from './helpers/harness.js';

/** [x, y] pairs, rounded, for any array of things with x/y (corners or Vector2s). */
function xy(points)
{
	return points.map((p) => [round(p.x), round(p.y)]);
}

/** Total number of (corner, adjacent corner) pairs findRooms starts a walk from. */
function candidateCycleCount(floorplan)
{
	return floorplan.getCorners().reduce((n, c) => n + c.adjacentCorners().length, 0);
}

beforeEach(() => {
	resetAll(1);
});

afterEach(() => {
	unseedRandom();
});

describe('findRooms: a closed square', () => {

	it('finds exactly one room from four closed corners', () => {
		const {floorplan} = buildSquareRoom();
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	it('gives the square room four corners in insertion order', () => {
		const {floorplan} = buildSquareRoom();
		expect(xy(floorplan.getRooms()[0].corners)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
	});

	it('reports the 400x300 square area as 120000 square cm', () => {
		const {floorplan} = buildSquareRoom();
		// Room.updateArea uses Region (shoelace) over the raw corner locations,
		// so area is in cm^2 regardless of the active display unit.
		expect(floorplan.getRooms()[0].centrelineArea).toBe(120000);
	});

	it('names every freshly detected room "A New Room"', () => {
		const {floorplan} = buildSquareRoom();
		expect(floorplan.getRooms()[0].name).toBe('A New Room');
	});

	it('puts the area centre of the square at its centroid', () => {
		const {floorplan} = buildSquareRoom();
		const centre = floorplan.getRooms()[0].areaCenter;
		expect([round(centre.x), round(centre.y)]).toEqual([200, 150]);
	});

	it('collapses the eight candidate cycles of a square down to one room', () => {
		// findRooms starts a walk from every (corner, adjacent corner) pair: 4
		// corners x 2 adjacents = 8 candidate cycles. _removeDuplicateRooms folds
		// the rotations together and Utils.isClockwise drops the reversed loops.
		const {floorplan} = buildSquareRoom();
		expect(candidateCycleCount(floorplan)).toBe(8);
		expect(floorplan.findRooms(floorplan.getCorners())).toHaveLength(1);
	});

	it('leaves no wall orphaned when the loop closes', () => {
		const {floorplan} = buildSquareRoom();
		expect(floorplan.getWalls().map((w) => !!w.orphan)).toEqual([false, false, false, false]);
	});

	it('gives each square wall a front edge only, never a back edge', () => {
		// A single-room loop is traversed once, so only one HalfEdge per wall exists.
		const {floorplan} = buildSquareRoom();
		expect(floorplan.getWalls().map((w) => [!!w.frontEdge, !!w.backEdge]))
			.toEqual([[true, false], [true, false], [true, false], [true, false]]);
	});
});

describe('findRooms: an L-shaped room', () => {

	it('finds exactly one room with six corners for the L', () => {
		const {floorplan} = buildLShapedRoom();
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(floorplan.getRooms()[0].corners).toHaveLength(6);
	});

	it('reports the L area as 120000 square cm, matching the true polygon area', () => {
		// True area of (0,0),(400,0),(400,200),(200,200),(200,400),(0,400):
		// 400x200 bottom limb (80000) + 200x200 upper limb (40000) = 120000.
		// The library agrees exactly - no discrepancy to preserve here.
		const {floorplan} = buildLShapedRoom();
		expect(floorplan.getRooms()[0].centrelineArea).toBe(120000);
	});

	it('keeps the concave vertex in the L room cycle', () => {
		const {floorplan} = buildLShapedRoom();
		expect(xy(floorplan.getRooms()[0].corners))
			.toEqual([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]]);
	});

	it('places the L area centre at the shoelace centroid, not the bounding-box centre', () => {
		const {floorplan} = buildLShapedRoom();
		const centre = floorplan.getRooms()[0].areaCenter;
		expect([round(centre.x), round(centre.y)]).toEqual([166.6667, 166.6667]);
	});
});

describe('findRooms: two rectangles sharing a wall (the dedup path)', () => {

	it('finds exactly two rooms, not three, for two rectangles sharing a wall', () => {
		// The outer 600x300 boundary is also a cycle, but it is never the tightest
		// one from any starting pair, so only the two 300x300 cells survive.
		const {floorplan} = buildSharedWallRooms();
		expect(floorplan.getRooms()).toHaveLength(2);
	});

	it('produces the exact corner signatures of the two shared-wall rooms', () => {
		const {floorplan} = buildSharedWallRooms();
		expect(roomSignatures(floorplan)).toEqual([
			'[[0,0],[300,0],[300,300],[0,300]]',
			'[[300,0],[600,0],[600,300],[300,300]]',
		]);
	});

	it('gives both shared-wall rooms an area of 90000 square cm', () => {
		const {floorplan} = buildSharedWallRooms();
		expect(floorplan.getRooms().map((r) => r.centrelineArea)).toEqual([90000, 90000]);
	});

	it('gives the shared wall both a front and a back edge', () => {
		const {floorplan, corners} = buildSharedWallRooms();
		const shared = corners[1].wallToOrFrom(corners[2]);
		expect([!!shared.frontEdge, !!shared.backEdge]).toEqual([true, true]);
		expect(floorplan.getWalls().filter((w) => w.frontEdge && w.backEdge)).toHaveLength(1);
	});

	it('attaches the two shared corners to two rooms each and the rest to one', () => {
		const {corners} = buildSharedWallRooms();
		expect(corners.map((c) => c.getAttachedRooms().length)).toEqual([1, 2, 2, 1, 1, 1]);
	});

	it('merges the two cells into one six-corner room when the shared wall is deleted', () => {
		const {floorplan, corners} = buildSharedWallRooms();
		corners[1].wallToOrFrom(corners[2]).remove();
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(roomSignatures(floorplan)).toEqual(['[[0,0],[300,0],[600,0],[600,300],[300,300],[0,300]]']);
	});

	it('keeps two independent rooms for two disjoint squares', () => {
		const floorplan = new Floorplan();
		[0, 500].forEach((ox) => {
			const cs = [[0, 0], [200, 0], [200, 200], [0, 200]].map(([x, y]) => floorplan.newCorner(x + ox, y));
			for (let i = 0; i < 4; i++)
			{
				floorplan.newWall(cs[i], cs[(i + 1) % 4]);
			}
		});
		floorplan.update();
		expect(roomSignatures(floorplan)).toEqual([
			'[[0,0],[200,0],[200,200],[0,200]]',
			'[[500,0],[700,0],[700,200],[500,200]]',
		]);
	});
});

describe('findRooms: open polylines yield no rooms', () => {

	it('finds no room for three walls that do not close the loop', () => {
		const floorplan = new Floorplan();
		const cs = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => floorplan.newCorner(x, y));
		floorplan.newWall(cs[0], cs[1]);
		floorplan.newWall(cs[1], cs[2]);
		floorplan.newWall(cs[2], cs[3]);
		floorplan.update();
		expect(floorplan.getRooms()).toHaveLength(0);
	});

	it('returns an empty loop list from findRooms for an open polyline', () => {
		// _findTightestCycle returns [] for every start pair; the empty cycles do
		// survive _removeDuplicateRooms (its `lookup[str]` write leaks the loop
		// variable and never runs for a zero-length room), but Utils.isClockwise
		// on an empty array sums to 0 and its `tSum >= 0` test calls that
		// clockwise, so removeIf discards them. Preserved quirk pair.
		const floorplan = new Floorplan();
		const cs = [[0, 0], [400, 0], [400, 300]].map(([x, y]) => floorplan.newCorner(x, y));
		floorplan.newWall(cs[0], cs[1]);
		floorplan.newWall(cs[1], cs[2]);
		floorplan.update();
		expect(floorplan.findRooms(floorplan.getCorners())).toEqual([]);
		expect(Utils.isClockwise([])).toBe(true);
	});

	it('marks every wall of an open polyline as an orphan', () => {
		const floorplan = new Floorplan();
		const cs = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => floorplan.newCorner(x, y));
		floorplan.newWall(cs[0], cs[1]);
		floorplan.newWall(cs[1], cs[2]);
		floorplan.newWall(cs[2], cs[3]);
		floorplan.update();
		expect(floorplan.getWalls().map((w) => !!w.orphan)).toEqual([true, true, true]);
		expect(floorplan.getCorners().map((c) => c.getAttachedRooms().length)).toEqual([0, 0, 0, 0]);
	});

	it('ignores a dangling stub wall but still finds the closed room, marking the stub orphan', () => {
		const floorplan = new Floorplan();
		const cs = [[0, 0], [400, 0], [400, 300], [0, 300]].map(([x, y]) => floorplan.newCorner(x, y));
		for (let i = 0; i < 4; i++)
		{
			floorplan.newWall(cs[i], cs[(i + 1) % 4]);
		}
		floorplan.newWall(cs[2], floorplan.newCorner(600, 300));
		floorplan.update();
		expect(roomSignatures(floorplan)).toEqual(['[[0,0],[400,0],[400,300],[0,300]]']);
		expect(floorplan.getWalls().map((w) => !!w.orphan)).toEqual([false, false, false, false, true]);
	});
});

describe('findRooms: cycle orientation', () => {

	it('emits square corners in the order [0,0] [400,0] [400,300] [0,300]', () => {
		// This is "counter-clockwise" only in maths orientation (y up); drawn on
		// the 2D canvas, where y grows downward, the same order reads clockwise.
		// Pinned concretely so any future orientation flip fails loudly.
		const {floorplan} = buildSquareRoom();
		expect(roomSignature(floorplan.getRooms()[0])).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
	});

	it('keeps only the loop that Utils.isClockwise calls counter-clockwise', () => {
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(Utils.isClockwise(room.corners)).toBe(false);
		expect(Utils.isClockwise(room.corners.slice().reverse())).toBe(true);
	});

	it('normalises a clockwise-drawn square to the same corner order as a ccw-drawn one', () => {
		const {floorplan} = buildPolygon([[0, 0], [0, 300], [400, 300], [400, 0]]);
		expect(xy(floorplan.getRooms()[0].corners)).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
	});

	it('detects a room whose corners are all negative despite isClockwise reading tSubY from p.x', () => {
		// Utils.isClockwise computes BOTH tSubX and tSubY from p.x (a real bug the
		// migration must preserve). It is inert here: the translation it applies
		// cancels out of the sum((x2-x1)*(y2+y1)) test for any closed loop, so a
		// wholly negative floorplan is still classified and kept.
		const {floorplan} = buildPolygon([[-400, -300], [0, -300], [0, 0], [-400, 0]]);
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(xy(floorplan.getRooms()[0].corners)).toEqual([[-400, -300], [0, -300], [0, 0], [-400, 0]]);
		expect(floorplan.getRooms()[0].centrelineArea).toBe(120000);
	});
});

describe('Room identity across an update() cycle', () => {

	it('rebuilds Room objects on every update() rather than reusing them', () => {
		const {floorplan} = buildSquareRoom();
		const before = floorplan.getRooms()[0];
		floorplan.update();
		expect(floorplan.getRooms()[0]).not.toBe(before);
	});

	it('keeps roomByCornersId identical across an update() of an unchanged plan', () => {
		const {floorplan} = buildSquareRoom();
		const before = floorplan.getRooms()[0].roomByCornersId;
		floorplan.update();
		expect(floorplan.getRooms()[0].roomByCornersId).toBe(before);
	});

	it('keeps getUuid() identical across an update() of an unchanged plan', () => {
		const {floorplan} = buildSquareRoom();
		const before = floorplan.getRooms()[0].getUuid();
		floorplan.update();
		expect(floorplan.getRooms()[0].getUuid()).toBe(before);
	});

	it('builds roomByCornersId from corner ids in traversal order', () => {
		const {floorplan, corners} = buildSquareRoom();
		expect(floorplan.getRooms()[0].roomByCornersId).toBe(corners.map((c) => c.id).join(','));
	});

	it('builds getUuid() from the same ids sorted, so it is not a uuid at all', () => {
		// getUuid() is Array.join() over sorted corner ids - a comma-joined list,
		// order-independent, and identical for any two rooms with the same corner
		// set. Floorplan.updateFloorTextures keys floor textures off it.
		const {floorplan, corners} = buildSquareRoom();
		const expected = corners.map((c) => c.id).sort().join(',');
		expect(floorplan.getRooms()[0].getUuid()).toBe(expected);
	});

	it('gives the two shared-wall rooms distinct uuids', () => {
		const {floorplan} = buildSharedWallRooms();
		const uuids = floorplan.getRooms().map((r) => r.getUuid());
		expect(new Set(uuids).size).toBe(2);
	});

	it('exposes room names through getMetaRoomData keyed by roomByCornersId', () => {
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(floorplan.getMetaRoomData()).toEqual({[room.roomByCornersId]: {name: 'A New Room'}});
	});
});

describe('Room area recomputation when a corner moves', () => {

	it('recomputes the area in place when a corner is moved with move()', () => {
		const {floorplan, corners} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(room.centrelineArea).toBe(120000);
		corners[1].move(600, 0);
		// (0,0),(600,0),(400,300),(0,300) shoelace = 300000 / 2 = 150000.
		expect(room.centrelineArea).toBe(150000);
	});

	it('does not re-run room detection on a move, so the Room object survives', () => {
		// Corner.move fires EVENT_MOVED, whose Floorplan listener calls
		// update(false, ...) - the early-return branch that only refreshes corner
		// angles. Rooms are patched in place by Corner.updateAttachedRooms.
		const {floorplan, corners} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		corners[1].move(600, 0);
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(floorplan.getRooms()[0]).toBe(room);
	});

	it('keeps the recomputed area after a full update() re-detects the room', () => {
		const {floorplan, corners} = buildSquareRoom();
		corners[1].move(600, 0);
		floorplan.update();
		expect(floorplan.getRooms()[0].centrelineArea).toBe(150000);
		expect(roomSignatures(floorplan)).toEqual(['[[0,0],[600,0],[400,300],[0,300]]']);
	});

	it('recomputes the area when corners are moved through the x setter', () => {
		const {floorplan, corners} = buildSquareRoom();
		corners[1].x = 600;
		corners[2].x = 600;
		// 600x300 rectangle.
		expect(floorplan.getRooms()[0].centrelineArea).toBe(180000);
	});

	it('refreshes the area on a move however many rooms the plan holds', () => {
		// This pinned a quirk until RM-019 R1: `Corner.move` only calls
		// `updateAttachedRooms` when `this.floorplan.rooms.length < 10`, so at ten
		// rooms the area went stale until someone called `Floorplan.update()`.
		//
		// That guard is still in `Corner.move` and still does nothing here. What
		// changed is that the refresh no longer depends on it: the geometry branch
		// of `Floorplan.update()` re-derives the rooms the moved corners belong to,
		// and its scope is those rooms rather than the plan, so there is nothing
		// for a plan-size guard to protect. Keeping the old behaviour would have
		// meant fixing the stale-3D bug on small plans and leaving it on large
		// ones, which is where a rebuild is least affordable.
		const floorplan = new Floorplan();
		const movable = [];
		for (let k = 0; k < 10; k++)
		{
			const cs = [[0, 0], [200, 0], [200, 200], [0, 200]].map(([x, y]) => floorplan.newCorner(x + (k * 500), y));
			for (let i = 0; i < 4; i++)
			{
				floorplan.newWall(cs[i], cs[(i + 1) % 4]);
			}
			movable.push(cs[1]);
		}
		floorplan.update();
		const room = floorplan.getRooms()[0];
		expect(floorplan.getRooms()).toHaveLength(10);
		expect(room.centrelineArea).toBe(40000);

		movable[0].move(400, 0);
		expect(room.centrelineArea, 'refreshed in place, at ten rooms').toBe(60000);

		// And a full update agrees with what the in-place refresh produced.
		floorplan.update();
		expect(floorplan.getRooms()[0].centrelineArea).toBe(60000);
	});
});

describe('Deleting and restoring a wall', () => {

	it('drops the room count to zero when one wall of the square is removed', () => {
		const {floorplan} = buildSquareRoom();
		expect(floorplan.getRooms()).toHaveLength(1);
		floorplan.getWalls()[0].remove();
		expect(floorplan.getRooms()).toHaveLength(0);
	});

	it('keeps all four corners alive after the wall is removed', () => {
		// Corner.detachWall only removes a corner once BOTH its wall lists empty,
		// so the two endpoints of the deleted wall stay in the floorplan.
		const {floorplan} = buildSquareRoom();
		floorplan.getWalls()[0].remove();
		expect(floorplan.getWalls()).toHaveLength(3);
		expect(floorplan.getCorners()).toHaveLength(4);
	});

	it('restores exactly one room when the deleted wall is added back', () => {
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];
		const start = wall.getStart();
		const end = wall.getEnd();
		wall.remove();
		floorplan.newWall(start, end);
		expect(floorplan.getWalls()).toHaveLength(4);
		expect(floorplan.getRooms()).toHaveLength(1);
		expect(roomSignatures(floorplan)).toEqual(['[[0,0],[400,0],[400,300],[0,300]]']);
	});
});

describe('Interior corners (wall-thickness offsets)', () => {

	it('produces one interior corner per room corner', () => {
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(room.interiorCorners).toBeDefined();
		expect(room.interiorCorners).toHaveLength(room.corners.length);
	});

	it('insets the square by half the wall thickness on every side', () => {
		// configWallThickness is 10, HalfEdge.offset is thickness / 2 = 5.
		const {floorplan} = buildSquareRoom();
		expect(xy(floorplan.getRooms()[0].interiorCorners))
			.toEqual([[5, 5], [395, 5], [395, 295], [5, 295]]);
	});

	it('mitres the interior corner at the concave vertex of the L to (195, 195)', () => {
		// halfAngleVector scales by offset / sin(theta / 2); at the 270-degree
		// reflex vertex (200,200) the two offset lines meet at (195,195).
		const {floorplan} = buildLShapedRoom();
		const interior = xy(floorplan.getRooms()[0].interiorCorners);
		expect(interior).toEqual([[5, 5], [395, 5], [395, 195], [195, 195], [195, 395], [5, 395]]);
		expect(interior[3]).toEqual([195, 195]);
	});

	it('offsets both sides of the shared wall independently', () => {
		const {floorplan} = buildSharedWallRooms();
		expect(xy(floorplan.getRooms()[0].interiorCorners))
			.toEqual([[5, 5], [295, 5], [295, 295], [5, 295]]);
		expect(xy(floorplan.getRooms()[1].interiorCorners))
			.toEqual([[305, 5], [595, 5], [595, 295], [305, 295]]);
	});

	it('carries float noise in the interior corners rather than exact integers', () => {
		// Preserved: halfAngleVector goes through cos/sin and a divide, so the
		// interior coordinates land near - not on - their ideal values (on V8
		// today the first one is 5.000000000000001). Interior coordinates must
		// therefore never be compared with strict equality. Asserted as a
		// tolerance so the test does not depend on a specific libm.
		const {floorplan} = buildSquareRoom();
		const ideal = [[5, 5], [395, 5], [395, 295], [5, 295]];
		floorplan.getRooms()[0].interiorCorners.forEach((point, i) => {
			expect(point.x).toBeCloseTo(ideal[i][0], 9);
			expect(point.y).toBeCloseTo(ideal[i][1], 9);
		});
	});

	it('replaces rather than appends when updateInteriorCorners is called again', () => {
		// This pinned the quirk its own comment predicted: the method pushed onto
		// `interiorCorners` without clearing it, which was "harmless today (the
		// constructor is the only caller) but a second call doubles the array".
		//
		// RM-019 R1 gave it a second caller - the geometry branch of
		// `Floorplan.update()`, which re-derives the rooms a moved corner belongs
		// to - so the day the comment described arrived and the array is reset.
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(room.interiorCorners).toHaveLength(4);
		const before = xy(room.interiorCorners);
		room.updateInteriorCorners();
		expect(room.interiorCorners).toHaveLength(4);
		expect(xy(room.interiorCorners), 'and re-derives the same polygon').toEqual(before);
	});
});

describe('Determinism', () => {

	it('produces identical room signatures for the same square built twice under one seed', () => {
		resetAll(1);
		const first = roomSignatures(buildSquareRoom().floorplan);
		resetAll(1);
		const second = roomSignatures(buildSquareRoom().floorplan);
		expect(second).toEqual(first);
		expect(first).toEqual(['[[0,0],[400,0],[400,300],[0,300]]']);
	});

	it('produces identical room signatures for the shared-wall plan built twice under one seed', () => {
		resetAll(1);
		const first = roomSignatures(buildSharedWallRooms().floorplan);
		resetAll(1);
		const second = roomSignatures(buildSharedWallRooms().floorplan);
		expect(second).toEqual(first);
	});

	it('reproduces the same corner ids under the same seed', () => {
		resetAll(1);
		const first = buildSquareRoom().floorplan.getCorners().map((c) => c.id);
		resetAll(1);
		const second = buildSquareRoom().floorplan.getCorners().map((c) => c.id);
		expect(second).toEqual(first);
	});

	it('changes the corner ids, but not the room geometry, under a different seed', () => {
		resetAll(1);
		const one = buildSquareRoom().floorplan;
		resetAll(2);
		const two = buildSquareRoom().floorplan;
		expect(two.getCorners().map((c) => c.id)).not.toEqual(one.getCorners().map((c) => c.id));
		expect(roomSignatures(two)).toEqual(roomSignatures(one));
	});
});
