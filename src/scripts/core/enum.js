/**
 * Minimal replacement for the abandoned `es6-enum` package (last published
 * 2018), inlined in migration sprint S1.
 *
 * SERIALIZATION CONTRACT - do not change lightly. Wall types are persisted to
 * .blueprint3d files as `wall.wallType.description`, i.e. the literal strings
 * "STRAIGHT" and "CURVED" (model/floorplan.js saveFloorplan). Members must
 * therefore stay Symbols carrying exactly their member name as the description.
 * tests/serialization.test.js pins this both ways.
 *
 * Behaviour kept from es6-enum: members are unique Symbols, the enum object is
 * frozen, and an unknown key reads as undefined.
 *
 * @param {...string} names Member names.
 * @returns {Object} Frozen object mapping each name to a unique Symbol.
 */
export default function Enum(...names)
{
	const members = {};
	names.forEach((name) => { members[name] = Symbol(name); });
	return Object.freeze(members);
}
