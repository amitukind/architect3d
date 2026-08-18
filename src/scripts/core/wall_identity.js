// @ts-check
/**
 * Reconstructing a wall's identity from the corners a save file already
 * records (RM-004 B2).
 *
 * ## Why derive rather than persist
 *
 * A3 settled this for rooms and the argument carries: a file identifies a wall
 * by its corners, and that is a description another build can read. An id
 * assigned by one build and written into the file means nothing to another, and
 * an id that dies with the wall cannot be brought back by drawing it again.
 * Nothing here is written to disk - `docs/save-format.md` says so - and a file
 * written before this change loads identically, because the input is corner ids
 * that were always there.
 *
 * ## Two rules, and either one alone gives a wrong answer
 *
 * **Canonicalise the pair.** `newWall(a, b)` and `newWall(b, a)` are the same
 * wall drawn from the other end, and `getUuid()` returns `a,b` for one and
 * `b,a` for the other. Seeding from the pair as written gives one wall two
 * identities depending on which way somebody dragged, so the pair is sorted.
 *
 * **Then add an ordinal.** Sorting alone collides in the one case that matters.
 * `Floorplan.newWall` has no duplicate guard and `loadFloorplan` calls it once
 * per record, so two walls between one corner pair survive a round trip -
 * measured in RM-004 §21 G-2 as two records written, two walls rebuilt, ONE
 * distinct `getUuid()`. Two walls sharing an identity is the defect A3 removed
 * from rooms, reappearing one layer down.
 *
 * The ordinal is a wall's position among the walls sharing its pair, in file
 * order. That is stable across a round trip because `saveFloorplan` writes
 * `this.walls` in array order and `loadFloorplan` rebuilds in file order.
 * Worth stating precisely rather than assuming: a wall missing a corner is
 * skipped on save (`floorplan.js:682`), so the ordinal is stable among the
 * walls that survive - which is the only set it has to be stable across, since
 * the others are not there to be identified.
 *
 * ## Shape
 *
 * `wall:<lo>~<hi>` and `wall:<lo>~<hi>#<n>` for the second and subsequent walls
 * on a pair. Readable on purpose: `Utils.guide()` is opaque, and the two places
 * that consume a wall id - `useSelection` matching by string and `HalfEdge`
 * interpolating `${wall.id}:front` - need nothing more than uniqueness, so
 * something greppable in a debugger costs nothing and helps.
 */

/**
 * The canonical form of a corner pair: sorted, so direction cannot matter.
 *
 * @param {string} startId
 * @param {string} endId
 * @returns {string}
 */
export function cornerPairKey(startId, endId)
{
	return [String(startId), String(endId)].sort().join('~');
}

/**
 * A wall's derived identity.
 *
 * @param {string} startId Corner id, in either order.
 * @param {string} endId Corner id, in either order.
 * @param {number} [ordinal] Position among walls sharing this pair. Zero, and
 *        omitted from the result, for the usual case of one wall per pair - so
 *        the common id is the short one and the suffix appears only where it
 *        is doing something.
 * @returns {string}
 */
export function deriveWallId(startId, endId, ordinal)
{
	var suffix = ordinal ? '#' + ordinal : '';
	return 'wall:' + cornerPairKey(startId, endId) + suffix;
}

/**
 * Assign derived ids to a run of wall records, in file order.
 *
 * Takes the records rather than the built walls so the caller can name a wall
 * at construction: `HalfEdge` composes its own id out of `wall.id` when the
 * wall is built, so an id applied afterwards would leave the faces named after
 * a guid nobody can reproduce.
 *
 * @param {Array<{corner1: string, corner2: string}>} records
 * @returns {Array<string>} one id per record, in the same order.
 */
export function deriveWallIds(records)
{
	/** @type {Object<string, number>} */
	var seen = Object.create(null);
	/** @type {Array<string>} */
	var ids = [];

	for (var i = 0; i < records.length; i++)
	{
		var record = records[i];
		var key = cornerPairKey(record.corner1, record.corner2);
		var ordinal = seen[key] || 0;
		seen[key] = ordinal + 1;
		ids.push(deriveWallId(record.corner1, record.corner2, ordinal));
	}

	return ids;
}
