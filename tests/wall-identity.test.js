/**
 * A wall keeps its identity across a document load (RM-004 B2).
 *
 * ## What A3 left, and why it needed its own sprint
 *
 * A3 gave a wall an assigned `id` and stopped rooms losing their names. It left
 * a note saying wall ids are stable across editing and not across a load, that
 * fixing it would take one small change, and that the change needed a
 * disambiguator for the two-walls-between-one-pair case - which is the exact
 * collision A3 had just removed from rooms, so it wanted thinking rather than a
 * corner of that sprint.
 *
 * RM-004 §21 G-2 measured the gap before this was written. Across three
 * fixtures: **0 of 15 wall ids survive a load, 15 of 15 `getUuid()` do, and
 * every corner id comes back intact.** So the seed is already in the file and
 * this is a load-path change rather than a save-format one - which is what
 * makes it cheap, and is the same shape as A3's room fix, where the old derived
 * key became the seed of the new assigned id.
 *
 * ## The two cases that are in no fixture
 *
 * Neither of these appears in `simple-room`, `curved-walls` or `rich-design`,
 * so extending the corpus could not reach them and they are constructed here.
 * They are also the two halves of the same requirement, and getting either one
 * alone produces a wrong answer that looks right:
 *
 *  - **Direction must not matter.** `newWall(a, b)` and `newWall(b, a)` are the
 *    same wall drawn from the other end. `getUuid()` returns `a,b` for one and
 *    `b,a` for the other, so an id seeded from the pair as written gives one
 *    wall two identities depending on which way somebody dragged.
 *  - **Two walls between one pair must differ.** `newWall()` has no duplicate
 *    guard and `loadFloorplan()` calls it once per record, so this survives a
 *    round trip - measured: two records written, two walls rebuilt, ONE distinct
 *    `getUuid()`. An id that only canonicalises collides here, and two walls
 *    sharing an identity is the defect A3 removed from rooms reappearing one
 *    layer down.
 *
 * Canonicalise AND carry an ordinal. Either alone fails one of the two.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {Floorplan} from '../src/scripts/model/floorplan.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(file)
{
	return JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')).floorplan;
}

function loadFixture(file)
{
	const floorplan = new Floorplan();
	floorplan.loadFloorplan(readFixture(file));
	return floorplan;
}

/** Save and load, which is the path an undo runs down. */
function roundTrip(floorplan)
{
	const saved = JSON.parse(JSON.stringify(floorplan.saveFloorplan()));
	const reloaded = new Floorplan();
	reloaded.loadFloorplan(saved);
	return reloaded;
}

function idsOf(floorplan)
{
	return floorplan.getWalls().map((wall) => wall.id);
}

describe('a wall id survives a document load (RM-004 B2, M-13)', () =>
{
	for (const file of ['simple-room.blueprint3d', 'curved-walls.blueprint3d', 'rich-design.blueprint3d'])
	{
		it(`${file} — every id comes back`, () =>
		{
			const first = loadFixture(file);
			const before = idsOf(first);
			expect(before.length).toBeGreaterThan(0);

			const after = idsOf(roundTrip(first));

			// Sets rather than arrays: the claim is that the identities survive,
			// not that the walls come back in the order they were written. The
			// order does happen to be stable and the ordinal below depends on it,
			// but that is a separate assertion and conflating them would hide
			// which one broke.
			expect([...after].sort()).toEqual([...before].sort());
		});
	}

	it('is stable across repeated round trips, not just the first', () =>
	{
		// A derivation that fed on its own output - taking the id from the
		// previous id rather than from the corners - would pass a single round
		// trip and drift on the second.
		const first = loadFixture('rich-design.blueprint3d');
		const once = roundTrip(first);
		const twice = roundTrip(once);

		expect(idsOf(twice)).toEqual(idsOf(once));
		expect([...idsOf(twice)].sort()).toEqual([...idsOf(first)].sort());
	});

	it('gives two floorplans loaded from one file the same ids', () =>
	{
		// The property an undo actually needs: the design reloaded from a snapshot
		// must name its walls the way the one on screen does.
		const source = readFixture('rich-design.blueprint3d');

		const left = new Floorplan();
		left.loadFloorplan(JSON.parse(JSON.stringify(source)));
		const right = new Floorplan();
		right.loadFloorplan(JSON.parse(JSON.stringify(source)));

		expect(idsOf(right)).toEqual(idsOf(left));
	});
});

describe('the two cases no fixture contains (RM-004 B2)', () =>
{
	it('does not care which end the wall was drawn from', () =>
	{
		const forwards = new Floorplan();
		const a1 = forwards.newCorner(0, 0);
		const b1 = forwards.newCorner(300, 0);
		forwards.newWall(a1, b1);

		// Same geometry, same corner ids, drawn the other way.
		const backwards = new Floorplan();
		const a2 = backwards.newCorner(0, 0, a1.id);
		const b2 = backwards.newCorner(300, 0, b1.id);
		backwards.newWall(b2, a2);

		const one = roundTrip(forwards).getWalls()[0];
		const other = roundTrip(backwards).getWalls()[0];

		// getUuid() is the unsorted pair and legitimately differs; the id must not.
		expect(other.getUuid()).not.toBe(one.getUuid());
		expect(other.id).toBe(one.id);
	});

	it('gives two walls between one corner pair different ids', () =>
	{
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(300, 0);
		floorplan.newWall(a, b);
		floorplan.newWall(a, b);

		const reloaded = roundTrip(floorplan);
		const ids = idsOf(reloaded);

		expect(reloaded.getWalls().length).toBe(2);
		// The collision this sprint exists to survive: one distinct getUuid(),
		// which must not become one distinct id.
		expect(new Set(reloaded.getWalls().map((w) => w.getUuid())).size).toBe(1);
		expect(new Set(ids).size).toBe(2);
	});

	it('keeps those two ids stable across a second round trip', () =>
	{
		// An ordinal assigned by iteration order is only worth having if the order
		// is stable. saveFloorplan writes `this.walls` in array order and
		// loadFloorplan rebuilds in file order, so it is - and if that ever stops
		// being true, the duplicate case is where it shows up first.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(300, 0);
		floorplan.newWall(a, b);
		floorplan.newWall(a, b);

		const once = roundTrip(floorplan);
		const twice = roundTrip(once);
		expect(idsOf(twice)).toEqual(idsOf(once));
	});

	it('separates the reverse case from the duplicate case', () =>
	{
		// Both rules at once, which is the combination neither alone satisfies:
		// a→b and b→a between the SAME pair are two walls, so they must differ
		// from each other - while still not depending on which was drawn first.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(300, 0);
		floorplan.newWall(a, b);
		floorplan.newWall(b, a);

		const reloaded = roundTrip(floorplan);
		expect(new Set(idsOf(reloaded)).size).toBe(2);
	});
});

describe('the ordinal counts per pair, not per file (RM-004 B2)', () =>
{
	it('does not renumber a wall because an unrelated one was added', () =>
	{
		// Found by a deliberate break that FAILED TO FAIL. Numbering the ordinal
		// by position in the file rather than by position among the walls sharing
		// a pair produces ids that are unique and deterministic, so every other
		// assertion here passes - and every wall silently renames itself whenever
		// a wall is inserted before it. Adding a wall in one corner of a design
		// would move the selection off a wall in the other.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(300, 0);
		const c = floorplan.newCorner(300, 300);
		floorplan.newWall(a, b);
		floorplan.newWall(b, c);

		const before = roundTrip(floorplan);
		const idsBefore = new Map(before.getWalls().map((w) => [w.getUuid(), w.id]));

		// A third wall, written FIRST, so a file-order ordinal would shift both.
		const saved = JSON.parse(JSON.stringify(before.saveFloorplan()));
		saved.corners.d = {x: 0, y: 300};
		saved.walls.unshift({corner1: 'd', corner2: [...Object.keys(saved.corners)][0]});

		const after = new Floorplan();
		after.loadFloorplan(saved);

		for (const wall of after.getWalls())
		{
			const previous = idsBefore.get(wall.getUuid());
			if (previous) { expect(wall.id, wall.getUuid()).toBe(previous); }
		}
	});
});

describe('a half edge inherits the stability (RM-004 B2)', () =>
{
	it('names the same two faces after a load', () =>
	{
		// HalfEdge.id is `${wall.id}:front|back`, assigned in A3 with a note that
		// it is stable because wall.id is. That was true within a session and not
		// across a load; this is what makes the sentence true as written, and it
		// is what a WallItem needs to find its wall again.
		const first = loadFixture('simple-room.blueprint3d');
		const edgeIds = (floorplan) => floorplan.getWalls()
			.flatMap((wall) => [wall.frontEdge, wall.backEdge])
			.filter(Boolean)
			.map((edge) => edge.id)
			.sort();

		const before = edgeIds(first);
		expect(before.length).toBeGreaterThan(0);
		expect(edgeIds(roundTrip(first))).toEqual(before);
	});
});
