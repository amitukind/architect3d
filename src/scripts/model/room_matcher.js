// @ts-check
/**
 * Which re-derived room is which room from before (RM-003 A3).
 *
 * ## The finding
 *
 * Rooms are not stored, they are derived: `Floorplan.update()` walks the wall
 * graph for closed cycles and builds a new `Room` for every one it finds, every
 * time. So a room has no identity of its own - it is known by the corners it
 * happens to have, through two derived keys that do not even agree with each
 * other. `Room.getUuid()` sorts the corner ids and backs the floor texture;
 * `Room.roomByCornersId` does not sort and backs the name.
 *
 * Measured before this sprint: name a room "Kitchen", give it a floor texture,
 * then draw a wall through one of its sides. The room goes from four corners to
 * five, both keys change, and the room comes back as "A New Room" on the default
 * floor. Splitting a wall is an ordinary drawing action.
 *
 * ## The rule
 *
 * A re-derived room inherits the identity of the previous room it overlaps
 * most, where overlap is measured over corner ids:
 *
 *     score = |shared| / |union|
 *
 * Jaccard rather than a raw count, so a large room does not out-bid a small one
 * for the small one's identity merely by being large. Matching is **one to
 * one**: a previous room can be claimed by at most one successor, which is what
 * stops both halves of a split room answering to the same name.
 *
 * Ties are broken deterministically - by shared count, then by the order the
 * rooms appear in - because a matcher that answers differently on two runs of
 * the same edit is worse than one that answers arbitrarily but consistently.
 *
 * ## Why a floor under the score
 *
 * Two rooms that share a single corner touch at a point; they are not the same
 * room, and letting one inherit the other's name is a *visible* wrong answer -
 * "why is the hall called Kitchen?" - where failing to inherit is merely the
 * old behaviour. So a match needs at least an edge in common:
 * {@link MIN_SHARED_CORNERS}. Everything above that floor is decided by score,
 * including the genuinely ambiguous case of one room split into two, where one
 * half keeps the name and the other becomes new. Which half is arbitrary; that
 * it is one of them, and the same one every time, is not.
 */

/**
 * The fewest corners two rooms must share to be considered the same room.
 *
 * Two, because two corners is an edge and one is a point. See the module note.
 */
export const MIN_SHARED_CORNERS = 2;

/**
 * @typedef {Object} RoomSnapshot
 * @property {string} id The identity to carry forward.
 * @property {Array<string>} cornerIds
 */

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} How many members the two sets have in common.
 */
function sharedCount(a, b)
{
	var shared = 0;
	a.forEach(function (member)
	{
		if (b.has(member))
		{
			shared += 1;
		}
	});
	return shared;
}

/**
 * Pair each current room with the previous room it continues, if any.
 *
 * Pure: it takes corner ids and returns indices, and knows nothing about
 * `Room`, `Floorplan` or the two key schemes it exists to keep in step. That is
 * what makes the rule testable on its own, which matters because it is the one
 * piece of A3 that can be *subtly* wrong - a mismatch does not throw, it moves
 * somebody's room name somewhere else.
 *
 * @param {Array<Array<string>>} previous Corner ids per room, before.
 * @param {Array<Array<string>>} current Corner ids per room, after.
 * @returns {Map<number, number>} Current room index to previous room index.
 *          Absent means the room is new.
 */
export function matchRooms(previous, current)
{
	var previousSets = previous.map(function (ids) {return new Set(ids);});
	var currentSets = current.map(function (ids) {return new Set(ids);});

	/** @type {Array<{score: number, shared: number, from: number, to: number}>} */
	var candidates = [];
	currentSets.forEach(function (currentSet, to)
	{
		previousSets.forEach(function (previousSet, from)
		{
			var shared = sharedCount(currentSet, previousSet);
			if (shared < MIN_SHARED_CORNERS)
			{
				return;
			}
			var union = currentSet.size + previousSet.size - shared;
			candidates.push({score: union ? shared / union : 0, shared: shared, from: from, to: to});
		});
	});

	// Best first, and every comparison after the score is a tiebreak that exists
	// only to make the order total. Two equally good candidates must resolve the
	// same way on every run or the same edit renames a different room each time.
	candidates.sort(function (a, b)
	{
		if (a.score !== b.score) {return b.score - a.score;}
		if (a.shared !== b.shared) {return b.shared - a.shared;}
		if (a.to !== b.to) {return a.to - b.to;}
		return a.from - b.from;
	});

	/** @type {Map<number, number>} */
	var matched = new Map();
	var claimed = new Set();
	candidates.forEach(function (candidate)
	{
		if (matched.has(candidate.to) || claimed.has(candidate.from))
		{
			return;
		}
		matched.set(candidate.to, candidate.from);
		claimed.add(candidate.from);
	});
	return matched;
}

/**
 * Move map entries from one key to another, in place.
 *
 * Lift every value out before putting any back, so a set of moves that swaps
 * two keys - or that renames A to B while something else renames B to C -
 * cannot overwrite a value it is about to need. Mutating rather than replacing
 * the object is deliberate: `Floorplan.metaroomsdata` and
 * `Floorplan.floorTextures` are handed out by `saveFloorplan()` by reference and
 * adopted from a loaded file the same way, and two characterization tests pin
 * that aliasing.
 *
 * Entries nobody is moving are left alone, which is what keeps the name of a
 * room you deleted available if you draw it again.
 *
 * @param {?Object<string, any>} map
 * @param {Array<{from: string, to: string}>} moves
 */
export function rekeyInPlace(map, moves)
{
	if (!map)
	{
		return;
	}
	var lifted = [];
	moves.forEach(function (move)
	{
		if (Object.prototype.hasOwnProperty.call(map, move.from))
		{
			lifted.push({to: move.to, value: map[move.from]});
			delete map[move.from];
		}
	});
	lifted.forEach(function (entry)
	{
		map[entry.to] = entry.value;
	});
}
