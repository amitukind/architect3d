/**
 * Several triangle fans in one geometry (RM-015 M2, finding AA-3).
 *
 * AA-3 measured a 36-room plan at 802 draw calls for 2,516 triangles - 3.1
 * triangles per call. `fanBatchGeometry` is what lets geometry that shares a
 * material and shares a visibility also share a mesh.
 *
 * These are arithmetic tests, deliberately. The failure mode of an index
 * rebase is not an exception, it is a stray triangle stretched across the room
 * from one fan's vertex to another's - which a pixel test in the browser tier
 * catches once it is on screen, and which this catches in the buffer where it
 * can be read.
 */
import {describe, expect, it} from 'vitest';
import {fanBatchGeometry, triangleFanGeometry} from '../src/scripts/core/geometry_builders.js';

/** A quad at a given x offset, in the shape the edge builders produce. */
function quad(x)
{
	return [
		{x: x, y: 0, z: 0},
		{x: x + 10, y: 0, z: 0},
		{x: x + 10, y: 250, z: 0},
		{x: x, y: 250, z: 0},
	];
}

describe('fanBatchGeometry', () =>
{
	it('produces the same buffer as the single-fan builder for one fan', () =>
	{
		const one = triangleFanGeometry(quad(0));
		const batched = fanBatchGeometry([quad(0)]);

		expect([...batched.getAttribute('position').array])
			.toEqual([...one.getAttribute('position').array]);
		expect([...batched.getIndex().array]).toEqual([...one.getIndex().array]);
	});

	it('concatenates vertices and rebases every index onto them', () =>
	{
		const batched = fanBatchGeometry([quad(0), quad(100)]);

		expect(batched.getAttribute('position').count).toBe(8);
		// Two quads, two triangles each, six indices each.
		expect([...batched.getIndex().array]).toEqual([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);

		// The second fan's vertices are its own, not the first's.
		const positions = batched.getAttribute('position').array;
		expect(positions[4 * 3]).toBe(100);
	});

	it('draws the same triangles as the fans it replaces', () =>
	{
		// The property that matters: every triangle in the batch is a triangle one
		// of the inputs would have drawn, at the same coordinates. An index rebase
		// that is off by one passes the count assertions above and fails this.
		const fans = [quad(0), quad(100), quad(250)];
		const batched = fanBatchGeometry(fans);
		const positions = batched.getAttribute('position').array;
		const index = batched.getIndex().array;

		const drawn = [];
		for (let i = 0; i < index.length; i += 3)
		{
			drawn.push([0, 1, 2].map((k) =>
			{
				const v = index[i + k];
				return `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
			}).join(' | '));
		}

		const expected = [];
		fans.forEach((points) =>
		{
			const one = triangleFanGeometry(points);
			const p = one.getAttribute('position').array;
			const ix = one.getIndex().array;
			for (let i = 0; i < ix.length; i += 3)
			{
				expected.push([0, 1, 2].map((k) =>
				{
					const v = ix[i + k];
					return `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`;
				}).join(' | '));
			}
		});

		expect(drawn).toEqual(expected);
	});

	it('tolerates an empty batch and a degenerate fan, like the builder it batches', () =>
	{
		const empty = fanBatchGeometry([]);
		expect(empty.getAttribute('position').count).toBe(0);
		expect(empty.getIndex().count).toBe(0);

		// Two points cannot make a triangle. They occupy vertices and contribute no
		// index, which is what the single-fan builder does with a degenerate room.
		const degenerate = fanBatchGeometry([[{x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}], quad(0)]);
		expect(degenerate.getAttribute('position').count).toBe(6);
		expect([...degenerate.getIndex().array]).toEqual([2, 3, 4, 2, 4, 5]);
	});
});
