// @vitest-environment jsdom
/**
 * Identity that survives recomputation (RM-003 A3).
 *
 * ## The finding this suite exists for
 *
 * `Corner.id` was the only assigned identity in the model. Everything else was
 * derived from state, which means it changed whenever the state did:
 *
 *   - `Wall.id` was `[start.id, end.id].join()`, computed once at construction
 *     and never again. Frozen, so it became a lie the moment a corner was merged
 *     into another, and two walls between the same pair of corners collided.
 *   - `Room` had **two** derived keys that did not agree with each other:
 *     `getUuid()` sorts the corner ids and backs the floor texture,
 *     `roomByCornersId` does not sort and backs the name.
 *   - `HalfEdge` and `Item` had none at all.
 *
 * Measured before the change: name a room "Kitchen", give it a floor texture,
 * then draw a wall through one of its sides. The room goes from four corners to
 * five, both keys change, and it comes back as **"A New Room" on the default
 * floor**. Splitting a wall is an ordinary drawing action.
 *
 * ## What is asserted
 *
 * That measurement, inverted, plus the rule underneath it. The matcher in
 * `model/room_matcher.js` is tested on its own because it is the one piece of
 * A3 that can be *subtly* wrong: a mismatch does not throw, it quietly moves
 * somebody's room name onto a different room.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {matchRooms, rekeyInPlace, MIN_SHARED_CORNERS} from '../src/scripts/model/room_matcher.js';
import {resetAll, buildSquareRoom, buildLShapedRoom, buildSharedWallRooms, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

beforeEach(() =>
{
	resetAll();
	installCanvas2D(window);
});

describe('the matcher: which re-derived room is which', () =>
{
	it('matches a room to itself when nothing changed', () =>
	{
		const rooms = [['a', 'b', 'c', 'd']];
		expect([...matchRooms(rooms, rooms)]).toEqual([[0, 0]]);
	});

	it('matches a room that gained a corner - the H-5 case', () =>
	{
		// Drawing a wall through one side splits it, adding a corner. Four of the
		// five corners are the ones it had.
		const before = [['a', 'b', 'c', 'd']];
		const after = [['a', 'b', 'e', 'c', 'd']];
		expect(matchRooms(before, after).get(0)).toBe(0);
	});

	it('matches a room that lost a corner', () =>
	{
		expect(matchRooms([['a', 'b', 'c', 'd', 'e']], [['a', 'b', 'c', 'd']]).get(0)).toBe(0);
	});

	it('keeps each room distinct when there are several', () =>
	{
		const before = [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']];
		const after = [['e', 'f', 'g', 'h'], ['a', 'b', 'c', 'd', 'i']];
		const matched = matchRooms(before, after);
		expect(matched.get(0)).toBe(1);
		expect(matched.get(1)).toBe(0);
	});

	it('gives a predecessor to at most one successor', () =>
	{
		// One room split in two. Both halves overlap the original; only one may
		// inherit it, or they would both answer to the same name.
		const before = [['a', 'b', 'c', 'd']];
		const after = [['a', 'b', 'x', 'y'], ['x', 'y', 'c', 'd']];
		const matched = matchRooms(before, after);
		expect([...matched.values()].filter((v) => v === 0)).toHaveLength(1);
	});

	it('answers the same way twice for an ambiguous split', () =>
	{
		// Which half inherits is arbitrary. That it is the same half on every run
		// is not: a matcher that answers differently on two runs of the same edit
		// renames a different room each time.
		const before = [['a', 'b', 'c', 'd']];
		const after = [['a', 'b', 'x', 'y'], ['x', 'y', 'c', 'd']];
		expect([...matchRooms(before, after)]).toEqual([...matchRooms(before, after)]);
	});

	it('refuses a match on a single shared corner', () =>
	{
		// Two rooms that share one corner touch at a point. Inheriting a name
		// across that is a visible wrong answer; not inheriting is merely the old
		// behaviour.
		expect(matchRooms([['a', 'b', 'c', 'd']], [['a', 'w', 'x', 'y']]).size).toBe(0);
		expect(MIN_SHARED_CORNERS).toBe(2);
	});

	it('prefers the better proportional match over the bigger absolute one', () =>
	{
		// A large room shares three corners with the small one in absolute terms
		// and is nevertheless a worse continuation of it. Raw overlap would hand
		// the small room's identity to the large one.
		const before = [['a', 'b', 'c']];
		const after = [['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ['a', 'b', 'c']];
		expect(matchRooms(before, after).get(1)).toBe(0);
		expect(matchRooms(before, after).has(0)).toBe(false);
	});

	it('matches nothing when there was nothing before', () =>
	{
		expect(matchRooms([], [['a', 'b', 'c']]).size).toBe(0);
	});
});

describe('the matcher: moving map entries', () =>
{
	it('moves a value from one key to another', () =>
	{
		const map = {a: 1, b: 2};
		rekeyInPlace(map, [{from: 'a', to: 'c'}]);
		expect(map).toEqual({c: 1, b: 2});
	});

	it('swaps two keys without losing either value', () =>
	{
		// Lift-then-place, not move-one-at-a-time: writing a before lifting b
		// would overwrite the value b is about to need.
		const map = {a: 1, b: 2};
		rekeyInPlace(map, [{from: 'a', to: 'b'}, {from: 'b', to: 'a'}]);
		expect(map).toEqual({a: 2, b: 1});
	});

	it('leaves entries nobody is moving alone', () =>
	{
		// This is what keeps the name of a room you deleted available if you draw
		// it again.
		const map = {gone: {name: 'Study'}, live: {name: 'Hall'}};
		rekeyInPlace(map, [{from: 'live', to: 'moved'}]);
		expect(map).toEqual({gone: {name: 'Study'}, moved: {name: 'Hall'}});
	});

	it('mutates rather than replaces, because two callers hold the object', () =>
	{
		const map = {a: 1};
		const alias = map;
		rekeyInPlace(map, [{from: 'a', to: 'b'}]);
		expect(alias).toBe(map);
		expect(alias.b).toBe(1);
	});

	it('does nothing to a map that is not there', () =>
	{
		expect(() => rekeyInPlace(null, [{from: 'a', to: 'b'}])).not.toThrow();
	});
});

describe('every entity has an identity', () =>
{
	it('a room has one, and it is not either of the derived keys', () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		expect(typeof room.id).toBe('string');
		expect(room.id.length).toBeGreaterThan(0);
		expect(room.id).not.toBe(room.roomByCornersId);
		expect(room.id).not.toBe(room.getUuid());
	});

	it('two rooms do not share one', () =>
	{
		const {floorplan} = buildSharedWallRooms();
		const ids = floorplan.getRooms().map((room) => room.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('a wall has one, and it is no longer the corner pair', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];
		expect(wall.id).not.toBe(wall.getUuid());
		// getUuid() is still the derived pair, because that is what the save file
		// records and what a reader of an old file has.
		expect(wall.getUuid()).toBe([wall.getStart().id, wall.getEnd().id].join());
	});

	it('two walls between the same two corners no longer collide', () =>
	{
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const first = floorplan.newWall(a, b);
		const second = floorplan.newWall(a, b);
		expect(first.getUuid()).toBe(second.getUuid());
		expect(first.id).not.toBe(second.id);
	});

	it('a half edge has one, derived from its wall and its side', () =>
	{
		const {floorplan} = buildSquareRoom();
		const wall = floorplan.getWalls()[0];
		const faces = [wall.frontEdge, wall.backEdge].filter(Boolean);
		expect(faces.length).toBeGreaterThan(0);
		faces.forEach((face) =>
		{
			expect(face.id).toBe(`${wall.id}:${face.front ? 'front' : 'back'}`);
		});
	});
});

describe('a room keeps its identity when the plan is re-derived (H-5)', () =>
{
	/** Name a room and give it a floor texture - the two things H-5 loses. */
	function furnish(floorplan, name = 'Kitchen')
	{
		const room = floorplan.getRooms()[0];
		room.name = name;
		room.setTexture('rooms/textures/marble.png', true, 300);
		return room;
	}

	it('survives an update that changes nothing', () =>
	{
		const {floorplan} = buildSquareRoom();
		const before = furnish(floorplan);
		const id = before.id;

		floorplan.update();

		const after = floorplan.getRooms()[0];
		expect(after).not.toBe(before);
		expect(after.name).toBe('Kitchen');
		expect(after.getTexture().url).toBe('rooms/textures/marble.png');
		expect(after.id).toBe(id);
	});

	it('survives a wall drawn through one of its sides - the measured case', () =>
	{
		const {floorplan} = buildSquareRoom();
		const before = furnish(floorplan);
		const id = before.id;
		expect(before.corners).toHaveLength(4);

		// The gesture the 2D view actually performs: drop a corner on a wall and
		// let it merge, which splits the wall in two without the room ever
		// ceasing to exist. `Corner.mergeWithIntersected` is what a drag calls.
		const middle = floorplan.newCorner(200, 4);
		middle.mergeWithIntersected();

		// Name and texture first: they are what a person loses, and a failure here
		// should say "A New Room" rather than report two unequal uuids.
		const after = floorplan.getRooms()[0];
		expect(after.corners).toHaveLength(5);
		expect(after.name).toBe('Kitchen');
		expect(after.getTexture().url).toBe('rooms/textures/marble.png');
		expect(after.getTexture().scale).toBe(300);
		expect(after.id).toBe(id);
	});

	it('survives a corner being merged into another', () =>
	{
		// The one route that used to half-work: combineWithCorner rewrote the name
		// key by string-replacing one corner id with another, and did nothing at
		// all about the floor texture.
		const {floorplan, corners} = buildLShapedRoom();
		const before = furnish(floorplan, 'Studio');
		const id = before.id;

		corners[3].combineWithCorner(corners[2]);

		const after = floorplan.getRooms()[0];
		expect(after.name).toBe('Studio');
		expect(after.getTexture().url).toBe('rooms/textures/marble.png');
		expect(after.id).toBe(id);
	});

	it('keeps two rooms apart when only one of them changes', () =>
	{
		const {floorplan, corners} = buildSharedWallRooms();
		const rooms = floorplan.getRooms();
		expect(rooms).toHaveLength(2);
		rooms[0].name = 'Left';
		rooms[1].name = 'Right';
		const ids = rooms.map((room) => room.id);

		corners[0].move(-40, -40);
		floorplan.update();

		const after = floorplan.getRooms();
		expect(after.map((room) => room.id)).toEqual(ids);
		expect(after.map((room) => room.name)).toEqual(['Left', 'Right']);
	});

	it('does not hand a name to a room that is genuinely new', () =>
	{
		const {floorplan} = buildSquareRoom();
		furnish(floorplan);

		// A second room, well clear of the first and sharing no corner with it.
		const e = floorplan.newCorner(1000, 1000);
		const f = floorplan.newCorner(1400, 1000);
		const g = floorplan.newCorner(1400, 1300);
		const h = floorplan.newCorner(1000, 1300);
		floorplan.newWall(e, f);
		floorplan.newWall(f, g);
		floorplan.newWall(g, h);
		floorplan.newWall(h, e);
		floorplan.update();

		const names = floorplan.getRooms().map((room) => room.name).sort();
		expect(names).toEqual(['A New Room', 'Kitchen']);
	});

	it('brings a name back if the room is drawn again', () =>
	{
		// The behaviour that keying the metadata by the assigned id would have
		// silently lost: an entry nobody claims stays under its corner key, so the
		// room is recognised if it returns.
		const {floorplan, corners} = buildSquareRoom();
		furnish(floorplan, 'Pantry');

		const wall = corners[0].wallTo(corners[1]) || corners[1].wallTo(corners[0]);
		wall.remove();
		expect(floorplan.getRooms()).toHaveLength(0);

		floorplan.newWall(corners[0], corners[1]);
		floorplan.update();

		expect(floorplan.getRooms()[0].name).toBe('Pantry');
	});
});

describe('identity round-trips through a save file', () =>
{
	it('a named, textured room comes back named and textured', () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		room.name = 'Bedroom';
		room.setTexture('rooms/textures/light_fine_wood.jpg', true, 250);

		const file = JSON.parse(JSON.stringify(floorplan.saveFloorplan()));
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);

		const restored = reloaded.getRooms()[0];
		expect(restored.name).toBe('Bedroom');
		expect(restored.getTexture().url).toBe('rooms/textures/light_fine_wood.jpg');
	});

	it('and then survives an edit, which is the point', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		floorplan.getRooms()[0].name = 'Bedroom';

		const file = JSON.parse(JSON.stringify(floorplan.saveFloorplan()));
		const reloaded = new Floorplan();
		reloaded.loadFloorplan(file);

		const reloadedCorners = reloaded.getCorners();
		reloadedCorners[0].move(reloadedCorners[0].x - 50, reloadedCorners[0].y - 50);
		reloaded.update();

		expect(reloaded.getRooms()[0].name).toBe('Bedroom');
		expect(corners).toHaveLength(4);
	});

	it('the file is unchanged in shape - no id is written into it', () =>
	{
		// Ids are in-memory handles. A file identifies a room by its corners,
		// which is a description another build can also read.
		const {floorplan} = buildSquareRoom();
		floorplan.getRooms()[0].name = 'Hall';
		const file = floorplan.saveFloorplan();

		Object.keys(file.rooms).forEach((key) =>
		{
			expect(Object.keys(file.rooms[key])).toEqual(['name']);
		});
		file.walls.forEach((wall) =>
		{
			expect(Object.keys(wall).sort()).toEqual(
				['a', 'b', 'backTexture', 'corner1', 'corner2', 'frontTexture', 'wallType']);
		});
	});
});

describe('an item has an identity too', () =>
{
	const DESIGN = JSON.stringify({
		floorplan: {
			corners: {
				c1: {x: 0, y: 0, elevation: 0}, c2: {x: 400, y: 0, elevation: 0},
				c3: {x: 400, y: 400, elevation: 0}, c4: {x: 0, y: 400, elevation: 0},
			},
			walls: [
				{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
				{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
			],
			rooms: {}, units: 'cm', version: '2.0.0',
		},
		items: [
			{item_name: 'Sofa', item_type: 1, model_url: 'a.glb', format: 'gltf',
				xpos: 10, ypos: 0, zpos: 20, rotation: 0, scale_x: 1, scale_y: 1, scale_z: 1, fixed: false},
			{item_name: 'Lamp', item_type: 1, model_url: 'b.glb', format: 'gltf',
				xpos: 50, ypos: 0, zpos: 60, rotation: 0, scale_x: 1, scale_y: 1, scale_z: 1, fixed: false},
		],
	});

	let model;

	beforeEach(async () =>
	{
		const three = await import('three');
		model = new Model('/');
		model.scene.setItemLoader(stubItemLoader(three));
	});

	afterEach(() =>
	{
		model = null;
	});

	it('assigns one to an item that arrives without', () =>
	{
		model.loadSerialized(DESIGN);
		const ids = model.scene.getItems().map((item) => item.designId);
		expect(ids).toHaveLength(2);
		ids.forEach((id) => expect(typeof id).toBe('string'));
		expect(new Set(ids).size).toBe(2);
	});

	it('writes it to the save file, so a snapshot can name the same item', () =>
	{
		model.loadSerialized(DESIGN);
		const saved = JSON.parse(model.exportSerialized());
		// Sorted on both sides: the file is written in id order, deliberately, so
		// that two saves of an unchanged design produce the same bytes whatever
		// order the models finished downloading in.
		expect(saved.items.map((item) => item.id).sort())
			.toEqual(model.scene.getItems().map((item) => item.designId).sort());
	});

	it('adopts the one in the file rather than assigning a new one', () =>
	{
		model.loadSerialized(DESIGN);
		const saved = model.exportSerialized();
		const ids = model.scene.getItems().map((item) => item.designId);

		model.loadSerialized(saved);

		expect(model.scene.getItems().map((item) => item.designId).sort()).toEqual(ids.slice().sort());
	});
});
