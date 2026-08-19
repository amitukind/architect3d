// @vitest-environment node
/**
 * Item-to-item snapping and stacking, at the numbers (RM-012 J4).
 *
 * RM-007 calls this the first thing in programme J that needs new geometry, and
 * the geometry is arithmetic over rectangles. So it is a pure module with no
 * scene, no mesh and no renderer in it, tested at the numbers rather than at the
 * pixels - which is the only way "did it snap to the right line" is a question
 * with an exact answer.
 *
 * What is snapped to is deliberately not the grid. `Configuration.snapToGrid`
 * already does that for the 2D drawing tools, and a grid is a property of the
 * paper rather than of the furniture. This snaps to **what is already there**:
 * a sofa's edge against the bookcase beside it, a rug's centre with a table's.
 * Those are the alignments somebody furnishing a room is trying to hit by eye.
 */
import {describe, expect, it} from 'vitest';

import {
	STACK_COVERAGE, STACK_REACH_CM, boxOf, overlap, snapAxis, snapToNeighbours, stackOn,
} from '../src/scripts/items/snapping.js';

/** A box at a centre with a half size, the way an item reports itself. */
function box(x, z, halfX, halfZ, y, halfY)
{
	return {
		x: x, z: z, y: y === undefined ? 0 : y,
		halfX: halfX === undefined ? 10 : halfX,
		halfZ: halfZ === undefined ? 10 : halfZ,
		height: (halfY === undefined ? 10 : halfY) * 2,
	};
}

describe('reading a box off an item', () =>
{
	it('normalises the centre three keeps to the base a surface needs', () =>
	{
		// `initObject` centres the geometry on the origin and `FloorItem.resized`
		// sets `position.y = halfSize.y`, which puts the base on the floor. So the
		// base is the centre less the half height, and "what can I stand on" is a
		// question about base plus height.
		const read = boxOf({position: {x: 5, y: 40, z: 7}, halfSize: {x: 30, y: 40, z: 20}});
		expect(read.y).toBe(0);
		expect(read.height).toBe(80);
		expect(read.halfX).toBe(30);
	});

	it('takes the half sizes absolute, so a mirrored item is the size it looks', () =>
	{
		const read = boxOf({position: {x: 0, y: 10, z: 0}, halfSize: {x: -25, y: 10, z: 5}});
		expect(read.halfX).toBe(25);
		expect(read.y).toBe(0);
	});
});

describe('snapping to what is already there', () =>
{
	it('puts an item flush beside its neighbour', () =>
	{
		// The commonest one: two units side by side, the moving item's left edge
		// on the neighbour's right edge.
		const neighbour = box(0, 0, 20, 10);
		const moving = box(46, 0, 20, 10);
		const out = snapToNeighbours(moving, [neighbour], {tolerance: 25});

		expect(out.snappedX).toBe(true);
		expect(out.x).toBe(40);
		expect(out.x - 20).toBe(neighbour.x + 20);
	});

	it('lines two items up on the same edge', () =>
	{
		// Edge to edge rather than side by side: a bookcase and a cabinet with
		// their backs on one line.
		const out = snapToNeighbours(box(100, 3, 30, 10), [box(0, 0, 5, 10)], {tolerance: 25});
		expect(out.snappedZ).toBe(true);
		expect(out.z).toBe(0);
	});

	it('and on a shared centre line, when that is the nearest thing going', () =>
	{
		// Nearest wins over any preference between the nine pairings, which is
		// what makes it feel like it did what you were aiming at rather than what
		// it would rather you had aimed at. From 2, centre-to-centre is 2 away and
		// the nearest edge pairing is 3.
		const out = snapToNeighbours(box(2, 0, 30, 10), [box(0, 0, 5, 10)], {tolerance: 25});
		expect(out.x).toBe(0);
	});

	it('leaves an item alone when nothing is near it', () =>
	{
		const moving = box(500, 500);
		const out = snapToNeighbours(moving, [box(0, 0)], {tolerance: 25});
		expect(out.snappedX).toBe(false);
		expect(out.snappedZ).toBe(false);
		expect(out.x).toBe(500);
		expect(out.z).toBe(500);
	});

	it('takes the nearest of several candidates rather than the first', () =>
	{
		const near = snapAxis(box(21, 0), [box(0, 0, 10, 10), box(40, 0, 10, 10)], 'x', 25);
		// Left neighbour's right edge is 10, its centre 0; right neighbour's left
		// edge is 30 and its centre 40. From 21, the nearest reachable line for the
		// moving item's own left edge (-10) is 30 - 10 = 20.
		expect(near.centre).toBe(20);
		expect(near.distance).toBe(1);
	});

	it('keeps the first of two equally near candidates, so it does not flicker', () =>
	{
		// Dead centre between two neighbours ten centimetres away on each side:
		// both offer a flush pairing at the same distance, and a strict `<` keeps
		// the first rather than swapping as the pointer jitters.
		const tie = snapAxis(box(0, 0, 5, 5), [box(-20, 0, 5, 5), box(20, 0, 5, 5)], 'x', 25);
		expect(tie.distance).toBe(10);
		expect(tie.centre).toBe(-10);
	});

	it('reports the guide lines it hit, for a view that wants to draw them', () =>
	{
		const out = snapToNeighbours(box(2, 2, 10, 10), [box(0, 0, 10, 10)], {tolerance: 25});
		expect(out.guides).toHaveLength(2);
		expect(out.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'z']);
	});
});

describe('stacking, which is a different question and is asked separately', () =>
{
	it('rests an item on the top of what it is over', () =>
	{
		// A table 75 cm tall with its base on the floor, and a bowl over it.
		const table = box(0, 0, 60, 40, 0, 37.5);
		const bowl = box(0, 0, 8, 8, 0, 4);
		expect(stackOn(bowl, [table], {tolerance: 100}).y).toBe(75);
	});

	it('needs half the footprint over the surface, not a corner of it', () =>
	{
		// A bowl on the corner of a table is on the table. A bowl beside the table
		// with a centimetre of overhang is not, and a rule taking any overlap at
		// all would lift everything that ever passed near anything.
		const table = box(0, 0, 60, 40, 0, 37.5);
		expect(overlap(box(0, 0, 8, 8), table)).toBe(1);
		expect(stackOn(box(67, 0, 8, 8, 0, 4), [table], {tolerance: 100}).on).toBeNull();
		expect(STACK_COVERAGE).toBe(0.5);
	});

	it('will not levitate an item onto something it could not reach', () =>
	{
		// A bookcase is something to put a thing BESIDE. Without this, dragging a
		// lamp across a furnished room would teleport it to the top of the tallest
		// thing in it.
		const bookcase = box(0, 0, 40, 20, 0, 100);
		const lamp = box(0, 0, 10, 10, 0, 20);
		expect(stackOn(lamp, [bookcase], {tolerance: 25}).on).toBeNull();
		// Reachable once the lamp is already up there, so something on top of a
		// bookcase can still be nudged around on it.
		const lifted = box(0, 0, 10, 10, 190, 20);
		expect(stackOn(lifted, [bookcase], {tolerance: 25}).y).toBe(200);
	});

	it('draws the line where this catalog\'s own measurements put it', () =>
	{
		// STACK_REACH_CM is 120, and it is not a round number picked to feel
		// right: J1 measured six standard heights out of this catalog while
		// establishing the Kenney kit's unit scale. 120 is above every working
		// surface among them - kitchen unit 90, bar stool 87, table and desk 75 -
		// and below the two things that are not surfaces, a 180 cm fridge and a
		// 203 cm door frame. So a bowl dragged across a counter lands on it and a
		// bowl dragged past a fridge does not.
		expect(STACK_REACH_CM).toBe(120);
		const bowl = box(0, 0, 8, 8, 0, 4);
		const counter = box(0, 0, 30, 30, 0, 45);
		const fridge = box(0, 0, 30, 30, 0, 90);
		expect(stackOn(bowl, [counter], {tolerance: 25}).y).toBe(90);
		expect(stackOn(bowl, [fridge], {tolerance: 25}).on).toBeNull();
	});

	it('picks the tallest surface it is genuinely on', () =>
	{
		const rug = box(0, 0, 100, 100, 0, 0.5);
		const table = box(0, 0, 60, 40, 0, 37.5);
		const thing = box(0, 0, 8, 8, 60, 4);
		expect(stackOn(thing, [rug, table], {tolerance: 100}).y).toBe(75);
	});

	it('falls back to the floor with nothing under it', () =>
	{
		expect(stackOn(box(0, 0), [], {tolerance: 25})).toEqual({y: 0, on: null});
	});
});
