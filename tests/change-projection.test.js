// @vitest-environment jsdom
/**
 * What changed, and who had to care (RM-003 A2).
 *
 * ## The finding this suite exists for
 *
 * `Floorplan` had one way of saying anything had happened - `EVENT_UPDATED`,
 * carrying the floorplan the listener already had a reference to - and six
 * unrelated consumers hung off it. None of them could tell a corner drag from a
 * file open, so every one did its most expensive thing every time. Dragging one
 * corner of a four-wall room tore down and rebuilt every wall face and every
 * floor in the 3D scene, and yanked the camera back to the plan centre, on every
 * pointermove.
 *
 * Measured on this suite's own fixtures before the change: **10 full
 * `Floorplan3D.redraw()` calls and 10 `centerCamera()` calls for a ten-step
 * drag**, with no topological change at all.
 *
 * ## What is asserted
 *
 * Three things, in increasing order of how hard they are to fake:
 *
 * 1. The contract itself - a ChangeSet says which kinds changed, which entities
 *    each kind affects, and why.
 * 2. The consumers do less. Counters on the projection and the camera, because
 *    "it does less now" is a claim and a claim nobody can compute is a slogan.
 * 3. **The incremental path and the full redraw produce the same scene.** This
 *    is the one that matters: every fixture design, every edit kind, both paths,
 *    compared mesh by mesh through `tests/helpers/scene_graph.js`. Doing less
 *    work is only an improvement if the picture is unchanged.
 *
 * ## What is deliberately not asserted
 *
 * That `EVENT_UPDATED` fires a particular number of times per gesture. It fires
 * where it always fired - the adapter derives it from every ChangeSet - and the
 * `docs/events.md` walk below checks each documented event still arrives with
 * its documented payload. Pinning counts on the legacy event would pin the very
 * thing A3 and later sprints have to be free to change.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {Scene as ThreeScene, EventDispatcher, Vector2} from 'three';
import {WallTypes} from '../src/scripts/core/constants.js';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Floorplan3D} from '../src/scripts/three/floorPlan.js';
import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {
	ChangeSet, CHANGE_KINDS, CHANGE_TOPOLOGY, CHANGE_GEOMETRY, CHANGE_SURFACE,
	REASON_LOAD, REASON_EDIT, REASON_UNDO,
} from '../src/scripts/core/change_set.js';
import {
	EVENT_CHANGESET, EVENT_UPDATED, EVENT_NEW, EVENT_DELETED, EVENT_MOVED,
	EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED, EVENT_LOADED,
} from '../src/scripts/core/events.js';
import {describeScene, meshCount} from './helpers/scene_graph.js';
import {resetAll, buildSquareRoom, buildLShapedRoom, buildSharedWallRooms} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** As in the resource-lifecycle suite: `Edge` needs two camera events and a position. */
function createControlsStub()
{
	const controls = new EventDispatcher();
	controls.object = {position: {clone: () => ({sub: () => ({normalize: () => ({x: 0, y: 1, z: 0})})})}};
	return controls;
}

/**
 * Record every ChangeSet a plan dispatches.
 * @param {Floorplan} floorplan
 */
function recordChanges(floorplan)
{
	const seen = [];
	const listener = (evt) => {seen.push(evt.changes);};
	floorplan.addEventListener(EVENT_CHANGESET, listener);
	return {
		seen,
		kinds: () => seen.map((changes) => changes.kinds().join('+')),
		reasons: () => seen.map((changes) => changes.reason),
		stop: () => floorplan.removeEventListener(EVENT_CHANGESET, listener),
	};
}

let scene;
let controls;

beforeEach(() =>
{
	resetAll();
	installCanvas2D(window);
	scene = new ThreeScene();
	controls = createControlsStub();
});

afterEach(() =>
{
	scene = null;
	controls = null;
});

describe('the ChangeSet contract', () =>
{
	it('records kinds with the entities they affect', () =>
	{
		const a = {id: 'a'};
		const b = {id: 'b'};
		const changes = new ChangeSet(REASON_EDIT).add(CHANGE_GEOMETRY, [a, b]);

		expect(changes.has(CHANGE_GEOMETRY)).toBe(true);
		expect(changes.has(CHANGE_TOPOLOGY)).toBe(false);
		expect(changes.entities(CHANGE_GEOMETRY)).toEqual([a, b]);
		expect(changes.reason).toBe(REASON_EDIT);
	});

	it('deduplicates entities, so a union can be built by adding twice', () =>
	{
		const corner = {id: 'c'};
		const changes = new ChangeSet().add(CHANGE_GEOMETRY, [corner]).add(CHANGE_GEOMETRY, [corner]);
		expect(changes.entities(CHANGE_GEOMETRY)).toHaveLength(1);
	});

	it('accepts a single entity as well as a list', () =>
	{
		const room = {id: 'r'};
		expect(new ChangeSet().add(CHANGE_TOPOLOGY, room).entities(CHANGE_TOPOLOGY)).toEqual([room]);
	});

	it('separates "nothing changed" from "something changed and I cannot name what"', () =>
	{
		// The distinction the whole adapter rests on: update(false) with no corner
		// list still has to reach the consumers that fire on any change at all, so
		// a kind with no entities is a kind, not an empty set.
		const named = new ChangeSet().add(CHANGE_GEOMETRY, null);
		expect(named.isEmpty()).toBe(false);
		expect(named.has(CHANGE_GEOMETRY)).toBe(true);
		expect(named.entities(CHANGE_GEOMETRY)).toEqual([]);

		expect(new ChangeSet().isEmpty()).toBe(true);
	});

	it('reports kinds in a canonical order whatever order they were added', () =>
	{
		const a = new ChangeSet().add(CHANGE_SURFACE, null).add(CHANGE_TOPOLOGY, null);
		const b = new ChangeSet().add(CHANGE_TOPOLOGY, null).add(CHANGE_SURFACE, null);
		expect(a.kinds()).toEqual(b.kinds());
		expect(a.kinds()).toEqual([CHANGE_TOPOLOGY, CHANGE_SURFACE]);
		expect(CHANGE_KINDS.indexOf(CHANGE_TOPOLOGY)).toBeLessThan(CHANGE_KINDS.indexOf(CHANGE_SURFACE));
	});

	it('merges kinds and entities but keeps its own reason', () =>
	{
		// A batch is one gesture and the reason describes the gesture. Taking the
		// merged-in reason would let a deferred recomputation relabel a file open
		// as a user edit, which is the distinction history exists to make.
		const load = new ChangeSet(REASON_LOAD).add(CHANGE_TOPOLOGY, [{id: 'r'}]);
		load.merge(new ChangeSet(REASON_EDIT).add(CHANGE_GEOMETRY, [{id: 'c'}]));

		expect(load.reason).toBe(REASON_LOAD);
		expect(load.kinds()).toEqual([CHANGE_TOPOLOGY, CHANGE_GEOMETRY]);
	});

	it('describes itself for a log line', () =>
	{
		const changes = new ChangeSet(REASON_UNDO).add(CHANGE_TOPOLOGY, [{}, {}, {}]);
		expect(changes.describe()).toBe('topology(3) @undo');
		expect(new ChangeSet(REASON_EDIT).describe()).toBe('empty @edit');
	});
});

describe('what the floorplan says changed', () =>
{
	it('calls a room re-derivation a topology change and carries the rooms', () =>
	{
		const {floorplan} = buildSquareRoom();
		const log = recordChanges(floorplan);

		floorplan.update();

		expect(log.kinds()).toEqual([CHANGE_TOPOLOGY]);
		expect(log.seen[0].entities(CHANGE_TOPOLOGY)).toEqual(floorplan.getRooms());
	});

	it('calls a corner move a geometry change and carries the corners', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const log = recordChanges(floorplan);

		corners[0].move(10, 10);

		expect(log.kinds()).toEqual([CHANGE_GEOMETRY]);
		// The moved corner AND its neighbours, because those are the corners whose
		// angles have to be recomputed - which is also what makes the affected-face
		// set in Floorplan3D.refresh() complete. See its doc comment.
		const moved = log.seen[0].entities(CHANGE_GEOMETRY);
		expect(moved).toContain(corners[0]);
		expect(moved).toContain(corners[1]);
		expect(moved).toContain(corners[3]);
		expect(moved).not.toContain(corners[2]);
	});

	it('labels a document open as a load, not an edit', () =>
	{
		const model = new Model('/');
		const log = recordChanges(model.floorplan);

		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));

		expect(log.reasons()).toEqual([REASON_LOAD]);
	});

	it('labels a restoration as an undo, which only history knows', () =>
	{
		const model = new Model('/');
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));
		const saved = model.exportSerialized();

		const log = recordChanges(model.floorplan);
		model.loadSerialized(saved, {reason: REASON_UNDO});

		expect(log.reasons()).toEqual([REASON_UNDO]);
	});

	it('defaults to edit when nobody said otherwise', () =>
	{
		const {floorplan} = buildSquareRoom();
		const log = recordChanges(floorplan);
		floorplan.update();
		expect(log.reasons()).toEqual([REASON_EDIT]);
	});

	it('counts what it dispatched, per kind', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const before = floorplan.changeStats();

		floorplan.update();
		corners[0].move(5, 5);
		corners[0].move(6, 6);

		const after = floorplan.changeStats();
		expect(after.topology - before.topology).toBe(1);
		expect(after.geometry - before.geometry).toBe(2);
		expect(after.dispatches - before.dispatches).toBe(3);
		expect(after.surface).toBe(0);
	});
});

describe('the adapter: every legacy event still fires', () =>
{
	// docs/events.md, "Floorplan" and "Corners, walls and rooms", row by row. The
	// ChangeSet is additive and this is what says so: not "the suite still
	// passes", but each documented event asserted individually, with its payload.

	it('EVENT_UPDATED follows every ChangeSet, one for one', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const sets = [];
		const updates = [];
		floorplan.addEventListener(EVENT_CHANGESET, (e) => {sets.push(e);});
		floorplan.addEventListener(EVENT_UPDATED, (e) => {updates.push(e);});

		floorplan.update();
		corners[0].move(11, 11);
		floorplan.newCorner(700, 700);

		expect(updates).toHaveLength(sets.length);
		expect(updates.length).toBeGreaterThan(0);
	});

	it('EVENT_UPDATED still carries the floorplan as `item`', () =>
	{
		const {floorplan} = buildSquareRoom();
		let payload = null;
		floorplan.addEventListener(EVENT_UPDATED, (e) => {payload = e;});
		floorplan.update();
		expect(payload.item).toBe(floorplan);
	});

	it('EVENT_UPDATED carries the ChangeSet too, so a consumer can adopt it in place', () =>
	{
		const {floorplan} = buildSquareRoom();
		let payload = null;
		floorplan.addEventListener(EVENT_UPDATED, (e) => {payload = e;});
		floorplan.update();
		expect(payload.changes.has(CHANGE_TOPOLOGY)).toBe(true);
	});

	it('EVENT_NEW fires for a new corner and a new wall', () =>
	{
		const floorplan = new Floorplan();
		const seen = [];
		floorplan.addEventListener(EVENT_NEW, (e) => {seen.push(e.newItem);});

		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(100, 0);
		const wall = floorplan.newWall(a, b);

		expect(seen).toEqual([a, b, wall]);
	});

	it('EVENT_DELETED fires for a removed wall and a removed corner, with item_type', () =>
	{
		const {floorplan} = buildSquareRoom();
		const seen = [];
		floorplan.addEventListener(EVENT_DELETED, (e) => {seen.push(e.item_type);});

		floorplan.removeWall(floorplan.getWalls()[0]);
		floorplan.removeCorner(floorplan.getCorners()[0]);

		expect(seen).toEqual(['wall', 'corner']);
	});

	it('EVENT_LOADED still fires on the floorplan when a design is built', () =>
	{
		const model = new Model('/');
		let fired = 0;
		model.floorplan.addEventListener(EVENT_LOADED, () => {fired += 1;});
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));
		expect(fired).toBe(1);
	});

	it('EVENT_MOVED still fires on the corner and is relayed by the plan', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		let onCorner = 0;
		let onPlan = 0;
		corners[0].addEventListener(EVENT_MOVED, () => {onCorner += 1;});
		floorplan.addEventListener(EVENT_MOVED, () => {onPlan += 1;});

		corners[0].move(15, 15);

		expect(onCorner).toBe(1);
		expect(onPlan).toBe(1);
	});

	it('EVENT_CORNER_ATTRIBUTES_CHANGED still fires from the setters, and move() still does not', () =>
	{
		// The documented quirk in docs/events.md - a panel has to listen to both.
		const {floorplan, corners} = buildSquareRoom();
		let attributes = 0;
		floorplan.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, () => {attributes += 1;});

		corners[0].move(20, 20);
		expect(attributes).toBe(0);

		corners[0].x = 30;
		expect(attributes).toBe(1);
	});

	it('EVENT_ROOM_ATTRIBUTES_CHANGED is still relayed by the plan, with info', () =>
	{
		const {floorplan} = buildSquareRoom();
		let info = null;
		floorplan.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, (e) => {info = e.info;});

		floorplan.getRooms()[0].name = 'Kitchen';

		expect(info).toEqual({from: 'A New Room', to: 'Kitchen'});
	});
});

describe('the camera stops following a drag (M-5)', () =>
{
	/**
	 * A real `Main`, mounted headlessly.
	 *
	 * Deliberately the real one. The first version of this block used a stand-in
	 * that subscribed the same way and applied the same rule, and it passed with
	 * the gate deleted from `Main` - because it was testing a copy of the logic
	 * rather than the logic. A stand-in for the thing under test is not a test.
	 * The renderer is still a fake; that is a dependency, not the subject.
	 */
	function mountViewer(model)
	{
		const observer = installResizeObserver(window);
		const pointerApis = installPointerApis(window);
		const viewer = document.createElement('div');
		viewer.id = 'a2-viewer';
		document.body.appendChild(viewer);
		setLayout(viewer, {left: 0, top: 0, width: 1024, height: 768});
		Main.setRendererFactory(() => createRendererStub());
		const three = new Main(model, viewer, 'three-canvas', {resize: false, spin: false});
		return {
			three,
			teardown: () =>
			{
				three.dispose();
				Main.setRendererFactory(null);
				viewer.remove();
				pointerApis.restore();
				observer.restore();
			},
		};
	}

	it('does not recentre once during a ten-step drag', () =>
	{
		const model = new Model('/');
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));
		const {three, teardown} = mountViewer(model);
		const before = three.cameraStats();

		// Outward, away from the plan, so the bounding box grows on every step.
		// Dragging the same corner INWARD does not move the extent at all - the
		// other three corners still hold every extreme - so the extent check alone
		// would decline it and the test would pass with the kind check deleted.
		// It did, when this suite was first written. A drag has to be declined
		// because it is a drag, not because of where this one happened to go.
		const corners = model.floorplan.getCorners();
		for (let i = 1; i <= 10; i++)
		{
			corners[0].move(corners[0].x - 20, corners[0].y - 20);
		}

		const after = three.cameraStats();
		expect(after.recentred - before.recentred).toBe(0);
		expect(after.declined - before.declined).toBe(10);

		teardown();
	});

	it('still frames a document when it is opened', () =>
	{
		const model = new Model('/');
		const {three, teardown} = mountViewer(model);
		const before = three.cameraStats();

		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));

		expect(three.cameraStats().recentred - before.recentred).toBe(1);

		teardown();
	});

	it('declines a topological change that leaves the bounding box where it was', () =>
	{
		// The one intended behaviour change in this sprint. A corner added strictly
		// inside the existing extent leaves nothing to reframe - and the old code
		// reframed anyway, on every one.
		const model = new Model('/');
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));
		const {three, teardown} = mountViewer(model);
		const before = three.cameraStats();

		// Strictly inside the 400x300 fixture and well clear of every existing
		// corner, so newCorner() does not merge it away instead.
		model.floorplan.newCorner(200, 150);

		expect(three.cameraStats().recentred - before.recentred).toBe(0);
		expect(three.cameraStats().declined - before.declined).toBe(1);

		teardown();
	});

	it('reframes when the plan actually grows', () =>
	{
		const model = new Model('/');
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));
		const {three, teardown} = mountViewer(model);
		const before = three.cameraStats();

		model.floorplan.newCorner(9000, 9000);

		expect(three.cameraStats().recentred - before.recentred).toBe(1);

		teardown();
	});

	it('moves the camera to where the plan is, as it always did', () =>
	{
		// The gate changes WHEN centerCamera runs, not what it does. This is the
		// part that must not have moved.
		const model = new Model('/');
		const {three, teardown} = mountViewer(model);
		model.loadSerialized(readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8'));

		const centre = model.floorplan.getCenter();
		expect(three.controls.target.x).toBeCloseTo(centre.x, 4);
		expect(three.controls.target.z).toBeCloseTo(centre.z, 4);
		expect(three.controls.target.y).toBe(150);

		teardown();
	});
});

describe('the projection does only the work the change implies (M-5)', () =>
{
	it('rebuilds nothing at all during a ten-step drag', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const before = projection.projectionStats();

		for (let i = 1; i <= 10; i++)
		{
			corners[0].move(i, i);
		}

		const after = projection.projectionStats();
		expect(after.full - before.full).toBe(0);
		expect(after.topology - before.topology).toBe(0);
		expect(after.geometry - before.geometry).toBe(10);
		expect(after.edgesAdded - before.edgesAdded).toBe(0);
		expect(after.edgesRemoved - before.edgesRemoved).toBe(0);
		expect(after.floorsAdded - before.floorsAdded).toBe(0);

		projection.dispose();
	});

	it('redraws only the faces the moved corners touch', () =>
	{
		// A shared-wall plan has seven walls; moving one corner of the left room
		// must not redraw the far wall of the right one.
		const {floorplan, corners} = buildSharedWallRooms();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const totalFaces = projection.edges.length;
		const before = projection.projectionStats();

		corners[0].move(10, 10);

		const redrawn = projection.projectionStats().edgesRedrawn - before.edgesRedrawn;
		expect(redrawn).toBeGreaterThan(0);
		expect(redrawn).toBeLessThan(totalFaces);

		projection.dispose();
	});

	it('keeps its view objects across a drag, rather than replacing them', () =>
	{
		const {floorplan, corners} = buildLShapedRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const edges = projection.edges.slice();
		const floors = projection.floors.slice();

		corners[0].move(12, 12);

		expect(projection.edges).toEqual(edges);
		expect(projection.floors).toEqual(floors);

		projection.dispose();
	});

	it('reconciles a topology change instead of tearing the scene down', () =>
	{
		const {floorplan} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const before = projection.projectionStats();

		floorplan.update();

		const after = projection.projectionStats();
		expect(after.topology - before.topology).toBe(1);
		expect(after.full - before.full).toBe(0);

		projection.dispose();
	});

	it('leaves no mesh behind after a reconciliation', () =>
	{
		const {floorplan} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const meshes = meshCount(scene);

		floorplan.update();
		floorplan.update();

		expect(meshCount(scene)).toBe(meshes);

		projection.dispose();
		expect(meshCount(scene)).toBe(0);
	});

	it('falls back to a full redraw when the flag is off', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		projection.incremental = false;
		const before = projection.projectionStats();

		corners[0].move(13, 13);

		expect(projection.projectionStats().full - before.full).toBe(1);

		projection.dispose();
	});
});

describe('the incremental path matches the full redraw', () =>
{
	/**
	 * Build one plan twice, project it two ways, and compare the scenes.
	 *
	 * Both projections watch their own `Floorplan`, so the model state is built
	 * independently for each and the only difference between the two runs is
	 * which code path drew it. Running both against one plan would not work:
	 * the two would fight over the model's own hit-test planes, which `Floor`
	 * borrows and adds to whichever scene asked last.
	 *
	 * @param {function(): {floorplan: Floorplan, corners: Array}} build
	 * @param {function(Object): void} edit
	 */
	function comparePaths(build, edit)
	{
		const incrementalScene = new ThreeScene();
		const incrementalPlan = build();
		const incremental = new Floorplan3D(incrementalScene, incrementalPlan.floorplan, createControlsStub());
		incremental.redraw();
		edit(incrementalPlan);

		const referenceScene = new ThreeScene();
		const referencePlan = build();
		const reference = new Floorplan3D(referenceScene, referencePlan.floorplan, createControlsStub());
		reference.incremental = false;
		reference.redraw();
		const referenceBefore = describeScene(referenceScene);
		edit(referencePlan);

		const result = {
			incremental: describeScene(incrementalScene),
			reference: describeScene(referenceScene),
			referenceBefore,
			stats: incremental.projectionStats(),
			referenceStats: reference.projectionStats(),
			incrementalNames: incremental.edges.map((e) => e.name),
			referenceNames: reference.edges.map((e) => e.name),
		};
		incremental.dispose();
		reference.dispose();
		return result;
	}

	const designs = {
		'a square room': buildSquareRoom,
		'an L-shaped room': buildLShapedRoom,
		'two rooms sharing a wall': buildSharedWallRooms,
	};

	/**
	 * Edits that must produce a different picture, and produce the same different
	 * picture down both paths.
	 *
	 * The split from the group below is the anti-tautology guard, and it earned
	 * its place. The first version of this matrix ran every edit through one
	 * comparison, and three of them compared equal for reasons that had nothing to
	 * do with the incremental path - they changed nothing at all. A case that
	 * cannot fail is worse than no case, because it reads like coverage. So each
	 * edit now declares which kind it is, and the assertion checks that too.
	 */
	const visibleEdits = {
		'moving one corner': ({corners}) => {corners[0].move(corners[0].x + 25, corners[0].y + 25);},
		'dragging one corner ten steps': ({corners}) =>
		{
			for (let i = 1; i <= 10; i++)
			{
				corners[0].move(corners[0].x + 2, corners[0].y + 2);
			}
		},
		'moving two corners': ({corners}) =>
		{
			corners[0].move(corners[0].x - 30, corners[0].y);
			corners[1].move(corners[1].x, corners[1].y + 30);
		},
		'adding a wall': ({floorplan, corners}) =>
		{
			floorplan.newWall(corners[0], floorplan.newCorner(-300, -300));
		},
		'removing a wall': ({floorplan}) => {floorplan.removeWall(floorplan.getWalls()[0]);},
		'removing a corner and its walls': ({corners}) => {corners[0].removeAll();},
		'moving a corner and then re-deriving': ({floorplan, corners}) =>
		{
			corners[0].move(corners[0].x + 40, corners[0].y + 40);
			floorplan.update();
		},
	};

	/**
	 * Edits that must leave the picture exactly as it was.
	 *
	 * A different and equally real check: a reconciliation that rebuilt what it
	 * should have kept, or dropped an edge while rebuilding, shows up here. Each
	 * one is inert for a reason worth recording.
	 */
	const inertEdits = {
		// Same corners, same walls, so the re-derived rooms and half edges describe
		// the same geometry - which is why reconciliation after one is allowed to
		// be a no-op from the outside even though every model object is new.
		're-deriving the rooms': ({floorplan}) => {floorplan.update();},
		// A corner with no walls joins no room and bounds no face.
		'adding an unconnected corner': ({floorplan}) => {floorplan.newCorner(1000, 1000);},
		// This projection draws a curved wall as a straight quad: only HalfEdge's
		// centre and length read the bezier and neither reaches a mesh. If that
		// ever changes, this test flips to a failure, which is the right prompt -
		// the curved wall would then belong in the group above.
		'curving a wall': ({floorplan}) =>
		{
			const wall = floorplan.getWalls()[0];
			wall.wallType = WallTypes.CURVED;
			wall.a = new Vector2(wall.getStartX() + 60, wall.getStartY() - 90);
			wall.b = new Vector2(wall.getEndX() - 60, wall.getEndY() - 90);
		},
	};

	Object.keys(designs).forEach((designName) =>
	{
		Object.keys(visibleEdits).forEach((editName) =>
		{
			it(`${designName}, ${editName}`, () =>
			{
				const result = comparePaths(designs[designName], visibleEdits[editName]);
				expect(result.incremental).toEqual(result.reference);
				// A scene with no meshes would compare equal trivially.
				expect(result.incremental.length).toBeGreaterThan(0);
				// And the order that IS observable - the public arrays, and the edge
				// names derived from their positions - has to match too.
				expect(result.incrementalNames).toEqual(result.referenceNames);
				expect(result.reference, `"${editName}" changed nothing, so this comparison proves nothing`)
					.not.toEqual(result.referenceBefore);
			});
		});

		Object.keys(inertEdits).forEach((editName) =>
		{
			it(`${designName}, ${editName} - and the picture does not move`, () =>
			{
				const result = comparePaths(designs[designName], inertEdits[editName]);
				expect(result.reference).toEqual(result.referenceBefore);
				expect(result.incremental).toEqual(result.reference);
				expect(result.incremental.length).toBeGreaterThan(0);
				expect(result.incrementalNames).toEqual(result.referenceNames);
			});
		});

		it(`${designName}, no edit at all`, () =>
		{
			const result = comparePaths(designs[designName], () => {});
			expect(result.incremental).toEqual(result.reference);
			expect(result.incremental.length).toBeGreaterThan(0);
		});
	});

	it('and does it having done less work', () =>
	{
		// The comparison above would pass if the incremental path quietly ran a full
		// redraw every time, so this is the half that says it did not.
		const result = comparePaths(buildSquareRoom, ({corners}) =>
		{
			for (let i = 1; i <= 10; i++)
			{
				corners[0].move(corners[0].x + 2, corners[0].y + 2);
			}
		});
		expect(result.stats.full).toBe(0);
		expect(result.referenceStats.full).toBe(10);
	});

	it('matches after a document is opened over an existing one', () =>
	{
		const source = readFileSync(join(FIXTURE_DIR, 'rich-design.blueprint3d'), 'utf8');
		const simple = readFileSync(join(FIXTURE_DIR, 'simple-room.blueprint3d'), 'utf8');

		function run(incremental)
		{
			const target = new ThreeScene();
			const model = new Model('/');
			const projection = new Floorplan3D(target, model.floorplan, createControlsStub());
			projection.incremental = incremental;
			model.loadSerialized(simple);
			model.loadSerialized(source);
			const described = describeScene(target);
			projection.dispose();
			return described;
		}

		const incremental = run(true);
		expect(incremental.length).toBeGreaterThan(0);
		expect(incremental).toEqual(run(false));
	});
});

describe('removing a corner updates the plan, like removing a wall always did', () =>
{
	it('announces a topology change, which it never used to', () =>
	{
		const {floorplan} = buildSquareRoom();
		const log = recordChanges(floorplan);

		floorplan.removeCorner(floorplan.getCorners()[0]);

		expect(log.kinds()).toEqual([CHANGE_TOPOLOGY]);
	});

	it('shrinks the plan back when a stray corner goes', () =>
	{
		// The visible half of the asymmetry. getSize() reads the corner list, so a
		// corner removed without a re-derivation kept inflating the bounding box -
		// which is what the camera frames and what the shadow camera is sized from.
		const {floorplan} = buildSquareRoom();
		const stray = floorplan.newCorner(5000, 5000);
		expect(floorplan.getSize().x).toBeGreaterThan(4000);

		floorplan.removeCorner(stray);

		expect(floorplan.getSize().x).toBe(400);
	});

	it('takes one re-derivation for the whole of Corner.removeAll(), not one per wall', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const log = recordChanges(floorplan);

		corners[0].removeAll();

		expect(log.seen).toHaveLength(1);
		expect(log.kinds()).toEqual([CHANGE_TOPOLOGY]);
	});

	it('leaves the plan consistent afterwards', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const removed = corners[0];
		corners[0].removeAll();

		expect(floorplan.getCorners()).not.toContain(removed);
		expect(floorplan.getRooms()).toHaveLength(0);
		// getSize() reads the corner list, so a corner that was removed but never
		// re-derived used to keep inflating the plan's bounding box.
		expect(floorplan.getCorners().every((corner) => corner !== removed)).toBe(true);
	});
});

/**
 * The model keeps up with the drag, and the viewer is told (RM-019 R1).
 *
 * ## What was wrong, and why nothing above saw it
 *
 * A `Room` derives its interior polygon once, in its constructor, and its
 * `area` is measured over that polygon. Nothing rebuilt either on a geometry
 * change - `update(false, corners)` refreshed the moved corners' angles and
 * returned - so dragging a corner moved the walls and left the floor, the
 * ceiling, the two hit-test planes and the number on the plan exactly as they
 * were. `update(true)` rebuilds every Room, and the application performs one
 * when the 3D pane is switched to, which is why the view corrected itself the
 * moment somebody looked at it.
 *
 * `comparePaths` above cannot catch this and never could. It compares the
 * incremental path against a full `redraw()` **of the same model**, and both
 * read the same stale array - which is what the docblock on
 * `Floorplan3D.refresh()` said in as many words: "which is exactly what
 * `redraw()` produced too". The oracle that was missing is not another view of
 * the model, it is the model re-derived.
 *
 * ## The second half
 *
 * `Main.shouldRender()` draws a frame when something sets a dirty flag, and the
 * projection set none. Until RM-003 A2 that did not show, because this class
 * shared `EVENT_UPDATED` with `Main.centerCamera()` and the camera's own
 * `controls.update()` requested the frame; A2 stopped recentring on a drag and
 * the repaint went with it. Every test in tier 2 renders with `render(true)`,
 * which is why the whole tier stayed green while the 3D pane held its last
 * frame. Asserted here as a contract on the projection rather than on a frame.
 */
describe('the model keeps up with the drag', () =>
{
	/** Where the plan says the interior polygon is, rounded so float noise is not the subject. */
	function interior(room)
	{
		return room.interiorCorners.map((corner) =>
			`${Math.round(corner.x)},${Math.round(corner.y)}`).join(' ');
	}

	const designs = {
		'a square room': buildSquareRoom,
		'an L-shaped room': buildLShapedRoom,
		'two rooms sharing a wall': buildSharedWallRooms,
	};

	Object.entries(designs).forEach(([label, build]) =>
	{
		it(`leaves ${label} drawn as a rebuild would draw it`, () =>
		{
			const {floorplan, corners} = build();
			const projection = new Floorplan3D(scene, floorplan, controls);
			projection.redraw();

			const corner = corners[0];
			for (let step = 0; step < 10; step += 1)
			{
				corner.move(corner.x + 8, corner.y + 4);
			}
			const afterDrag = describeScene(scene);

			// What switching to the 3D pane does, through useCameraViews.showDesign().
			floorplan.update();

			expect(describeScene(scene)).toEqual(afterDrag);
			// Not vacuous: the drag has to have changed the scene in the first place.
			expect(projection.projectionStats().geometry).toBe(10);
			expect(projection.projectionStats().full).toBe(0);
			projection.dispose();
		});
	});

	it('re-derives the area and the interior polygon on every step, not on the rebuild', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const areaBefore = room.area;
		const interiorBefore = interior(room);

		corners[0].move(corners[0].x + 80, corners[0].y + 40);

		const areaAfterDrag = room.area;
		const interiorAfterDrag = interior(room);
		expect(areaAfterDrag).not.toBe(areaBefore);
		expect(interiorAfterDrag).not.toBe(interiorBefore);

		// And the rebuild agrees, which is the half that says the drag was right
		// rather than merely different.
		floorplan.update();
		expect(floorplan.getRooms()[0].area).toBeCloseTo(areaAfterDrag, 6);
		expect(interior(floorplan.getRooms()[0])).toBe(interiorAfterDrag);
	});

	it('moves the hit-test planes with the room, and strands none of them', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const projection = new Floorplan3D(scene, floorplan, controls);
		projection.redraw();
		const meshesBefore = meshCount(scene);
		const room = floorplan.getRooms()[0];
		const planeBefore = room.floorPlane;

		for (let step = 0; step < 30; step += 1)
		{
			corners[0].move(corners[0].x + 2, corners[0].y + 1);
		}

		expect(room.floorPlane, 'the picking plane is rebuilt').not.toBe(planeBefore);
		expect(scene.children).toContain(room.floorPlane);
		expect(scene.children).not.toContain(planeBefore);
		// Thirty rebuilds of a borrowed mesh, and the scene is the size it was.
		expect(meshCount(scene)).toBe(meshesBefore);
		projection.dispose();
	});

	it('asks for a frame when it changes the scene, and not when it does not', () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		let asked = 0;
		let flag = false;
		const facade = {
			add: (mesh) => scene.add(mesh),
			remove: (mesh) => scene.remove(mesh),
			get needsUpdate() {return flag;},
			set needsUpdate(value) {flag = value; if (value) {asked += 1;}},
		};
		const projection = new Floorplan3D(facade, floorplan, controls);
		projection.redraw();

		asked = 0;
		corners[0].move(corners[0].x + 20, corners[0].y + 10);
		expect(asked, 'a geometry change').toBeGreaterThan(0);

		asked = 0;
		floorplan.update();
		expect(asked, 'a topology change').toBeGreaterThan(0);

		// A ChangeSet naming a kind this class does not project changes nothing
		// here, so it must not cost a frame - that is what the contract is for.
		asked = 0;
		floorplan.dispatchEvent({
			type: EVENT_CHANGESET,
			item: floorplan,
			changes: new ChangeSet(REASON_EDIT).add(CHANGE_SURFACE, []),
		});
		expect(asked, 'a change this projection ignores').toBe(0);
		expect(projection.projectionStats().ignored).toBe(1);
		projection.dispose();
	});
});
