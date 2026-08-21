// @ts-check
import {EventDispatcher, Mesh, MeshBasicMaterial} from 'three';
import {mergePositionGeometries} from '../core/geometry_builders.js';
import {EVENT_CHANGESET} from '../core/events.js';
import {CHANGE_TOPOLOGY, CHANGE_GEOMETRY} from '../core/change_set.js';
import {Floor} from './floor.js';
import {Edge} from './edge.js';
import {runtimeOf} from '../core/design_runtime.js';


/**
 * The 3D projection of a floorplan: one {@link Floor} per room, one {@link Edge}
 * per wall face.
 *
 * ## What A2 changed
 *
 * This class used to do exactly one thing on exactly one signal: on every
 * `EVENT_UPDATED`, `redraw()` - dispose every Floor, remove every Edge, and
 * build the lot again from scratch. That is correct, and it is what happened on
 * every pointermove of a corner drag, because a corner drag dispatches
 * EVENT_UPDATED. Dragging one corner of a four-wall room tore down and rebuilt
 * eight wall faces and two floor planes, sixty times a second.
 *
 * It now subscribes to `EVENT_CHANGESET` instead, and reacts to what actually
 * changed (RM-003 A2):
 *
 * - **topology** - the room set was re-derived, so reconcile: build a view for
 *   every model entity that has none, dispose every view whose model entity is
 *   gone, keep the rest.
 * - **geometry** - existing entities moved, so redraw only the faces and floors
 *   the moved corners touch.
 *
 * ## Why topology still rebuilds everything, for now
 *
 * `Floorplan.update(true)` constructs a new `Room` for every room and a new
 * `HalfEdge` for every wall face, every time - room identity is derived from its
 * corners rather than assigned, which is finding H-5 and sprint A3's subject. So
 * reconciliation after a topology change currently finds nothing in common and
 * rebuilds the lot, exactly as `redraw()` did.
 *
 * It is written as a reconciliation anyway, because that is the shape that
 * becomes genuinely incremental the moment A3 lands, with no further change to
 * this class. What A2 delivers today is the *geometry* path, which is the one a
 * drag takes.
 *
 * ## The flag
 *
 * `incremental` defaults to true. Setting it false restores the old behaviour -
 * a full `redraw()` on every change - with the ChangeSet contract still in
 * place, so the two halves of this sprint revert separately. It is also how the
 * reference diff in `tests/change-projection.test.js` gets a reference to diff
 * against: the same plan, the same edits, both paths, compared scene graph to
 * scene graph.
 */
export class Floorplan3D extends EventDispatcher
{
	constructor(scene, floorPlan, controls, profile)
	{
		super();
		/**
		 * Which document this is projecting (RM-003 A4). Every `Edge` built below
		 * is handed it, so the wall meshes a document is holding are countable from
		 * `runtime.stats()`.
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = runtimeOf(floorPlan);
	/**
	 * The look this object draws with (RM-002 R-02, P7). Falls back to this
	 * document's profile, which for a document that asked for no profile of its
	 * own is the shared one - what every construction site did before and what
	 * the parity grid still measures.
	 */
		this.renderProfile = profile || this.runtime.renderProfile;
		this.scene = scene;
		this.floorplan = floorPlan;
		this.controls = controls;
		this.floors = [];
		this.edges = [];
		/**
		 * Project incrementally, or fall back to a full redraw on every change.
		 *
		 * The rollback switch for A2's second half. True is the shipped path.
		 *
		 * @type {boolean}
		 */
		this.incremental = true;
		/**
		 * Which model entity each view object is drawing.
		 *
		 * Keyed by object identity, which is the only identity these have before
		 * A3. A Map rather than a field on the Room/HalfEdge because the model layer
		 * does not know the 3D view exists and should not start knowing.
		 *
		 * @type {Map<Object, Floor>}
		 */
		this.floorsByRoom = new Map();
		/** @type {Map<Object, Edge>} */
		this.edgesByHalfEdge = new Map();
		/**
		 * Every edge's base plane, as one mesh (RM-015 M2, finding AA-3).
		 *
		 * AA-3 measured a 36-room plan at 802 draw calls for 2,516 triangles - 3.1
		 * triangles per call, a scene paying overhead rather than drawing anything.
		 * 144 of those calls were base planes: one flat quad per wall face, in one
		 * colour, that nothing ever hides. They are now one.
		 *
		 * @type {?Mesh}
		 */
		this._baseBatch = null;
		/**
		 * The batch's own material, held separately so it can be released.
		 *
		 * `Mesh.material` is a material OR an array of them, and the checker will
		 * not let `dispose()` be called on the union - correctly, since an array
		 * has no such method. This field is the one thing that was constructed
		 * here, typed as the one thing it is (RM-004 B3).
		 *
		 * @type {?MeshBasicMaterial}
		 */
		this._baseBatchMaterial = null;
		/**
		 * What this projection has done, for the tests that assert it did less
		 * (RM-003 A2, M-5). Read with {@link Floorplan3D#projectionStats}.
		 */
		this._stats = {
			full: 0, topology: 0, geometry: 0, ignored: 0,
			floorsAdded: 0, floorsRemoved: 0, floorsRedrawn: 0,
			edgesAdded: 0, edgesRemoved: 0, edgesRedrawn: 0,
		};
		var scope = this;
		this.updatedroomsevent = (evt) => {scope.project(evt.changes);};
		this.floorplan.addEventListener(EVENT_CHANGESET, this.updatedroomsevent);
	}

	switchWireframe(flag)
	{
		this.floors.forEach((floor)=>{
			floor.switchWireframe(flag);
		});
		this.edges.forEach((edge)=>{
			edge.switchWireframe(flag);
		});
	}

	/**
	 * React to a change by doing as little as it allows.
	 *
	 * ## Asking for a frame
	 *
	 * Every branch that touches the scene sets `scene.needsUpdate`, which is the
	 * only thing `Main.shouldRender()` will accept as a reason to draw. That was
	 * missing until RM-019 R1, and it was missing invisibly: before A2 this class
	 * shared `EVENT_UPDATED` with `Main.centerCamera()`, which ends in
	 * `controls.update()`, which fires `change`, which sets the *controls*' flag -
	 * so every rebuild was followed by a frame drawn for the camera's sake. A2
	 * stopped recentring the camera on a drag, correctly, and the repaint went
	 * with it. Nothing in tier 2 caught it because every test there renders with
	 * `render(true)`, which bypasses the question entirely.
	 *
	 * Measured: a corner drag produced zero writes to `scene.needsUpdate`, and
	 * the 3D pane held its last frame until something unrelated - a texture
	 * finishing, a resize, a pointer over the viewer - asked for one.
	 *
	 * A ChangeSet that carries both kinds - `update(true, corners)`, which the
	 * load path produces - takes the topology branch alone: reconciliation
	 * rebuilds from current model state, so redrawing the moved corners' faces
	 * afterwards would redraw what was just built.
	 *
	 * A change carrying neither kind reaches nothing here and is counted as
	 * ignored, which is the point of the contract.
	 *
	 * @param {?import('../core/change_set.js').ChangeSet} changes
	 */
	project(changes)
	{
		if (!this.incremental || !changes)
		{
			// No ChangeSet means a caller dispatched EVENT_CHANGESET by hand, or the
			// flag is off. Either way the safe reading is "something changed and I
			// cannot tell what", and the safe reaction is the old one.
			this._stats.full += 1;
			this.redraw();
			this.scene.needsUpdate = true;
			return;
		}
		if (changes.has(CHANGE_TOPOLOGY))
		{
			this._stats.topology += 1;
			this.reconcile();
			this.scene.needsUpdate = true;
			return;
		}
		if (changes.has(CHANGE_GEOMETRY))
		{
			this._stats.geometry += 1;
			this.refresh(changes.entities(CHANGE_GEOMETRY));
			this.scene.needsUpdate = true;
			return;
		}
		// Not `needsUpdate`: an ignored change altered nothing here, and drawing a
		// frame to show the same picture is the cost the contract exists to avoid.
		this._stats.ignored += 1;
	}

	/**
	 * Bring the view in line with the model's current room and wall-face sets.
	 *
	 * Build what is missing, dispose what is orphaned, leave what is still
	 * current. The public `floors` and `edges` arrays come out in the model's own
	 * order, and the edge names are reassigned by final position, so the result is
	 * indistinguishable from `redraw()`'s - which is what makes the reference diff
	 * a real check rather than a tautology.
	 */
	reconcile()
	{
		var scope = this;
		var rooms = this.floorplan.getRooms();
		var halfEdges = this.floorplan.wallEdges();
		var liveRooms = new Set(rooms);
		var liveEdges = new Set(halfEdges);

		var staleFloors = [];
		this.floorsByRoom.forEach(function (floor, room)
		{
			if (!liveRooms.has(room)) {staleFloors.push(room);}
		});
		staleFloors.forEach(function (room)
		{
			/** @type {Floor} */(scope.floorsByRoom.get(room)).dispose();
			scope.floorsByRoom.delete(room);
			scope._stats.floorsRemoved += 1;
		});

		var staleEdges = [];
		this.edgesByHalfEdge.forEach(function (edge, halfEdge)
		{
			if (!liveEdges.has(halfEdge)) {staleEdges.push(halfEdge);}
		});
		staleEdges.forEach(function (halfEdge)
		{
			/** @type {Edge} */(scope.edgesByHalfEdge.get(halfEdge)).remove();
			scope.edgesByHalfEdge.delete(halfEdge);
			scope._stats.edgesRemoved += 1;
		});

		this.floors = rooms.map(function (room)
		{
			var floor = scope.floorsByRoom.get(room);
			if (!floor)
			{
				floor = new Floor(scope.scene, room, scope.renderProfile, scope.runtime);
				floor.addToScene();
				scope.floorsByRoom.set(room, floor);
				scope._stats.floorsAdded += 1;
			}
			return floor;
		});

		this.edges = halfEdges.map(function (halfEdge, index)
		{
			var edge = scope.edgesByHalfEdge.get(halfEdge);
			if (!edge)
			{
				edge = new Edge(scope.scene, halfEdge, scope.controls, scope.renderProfile, scope.runtime);
				scope.edgesByHalfEdge.set(halfEdge, edge);
				scope._stats.edgesAdded += 1;
			}
			// By final position, not by when it was built: `redraw()` names them in
			// wallEdges() order and a surviving edge that has shifted position has to
			// be renamed to match, or the two paths diverge on a name.
			edge.name = 'edge_' + index;
			return edge;
		});
		this._rebuildBaseBatch();
	}

	/**
	 * Redraw the faces and floors that the given corners affect, and nothing else.
	 *
	 * ## Why the affected set is what it is
	 *
	 * A wall face's outline is not a function of its own two corners alone.
	 * `HalfEdge.interiorStart()` offsets the corner along the bisector of the angle
	 * between this face and its `prev`, and `interiorEnd()` does the same with
	 * `next` - so moving a corner changes the outline of every face that meets it
	 * AND of the faces those meet at the far end.
	 *
	 * The corner list already covers that, and not by luck: the EVENT_MOVED
	 * listener in `Floorplan.newCorner()` passes the moved corner *and its
	 * adjacent corners*, because those are the ones whose angles have to be
	 * recomputed. Every affected face therefore touches a corner in the list, and
	 * a face two walls away - whose prev, self and next all sit still - does not.
	 *
	 * Floors follow the rooms attached to those corners, and since RM-019 R1 they
	 * follow them all the way. `Floor.buildRoofVaryingHeight()` reads
	 * `room.corners` live and always tracked the drag; `buildFloor()` reads
	 * `room.interiorCorners`, and what A2 recorded here was that nothing
	 * recomputed that on a geometry change - so the floor polygon came back
	 * identical, exactly as `redraw()` produced it, because a rebuilt Floor read
	 * the same stale array. A2 reproduced that deliberately, on the grounds that
	 * a floor which started tracking the drag would be a visual change A2 had
	 * promised not to make.
	 *
	 * It was a defect in the model rather than a property of either path, and it
	 * outlived the sprint that documented it. `Floorplan.update(false, corners)`
	 * now re-derives the rooms those corners belong to before announcing the
	 * change, so `interiorCorners` is current by the time this runs and the floor
	 * tracks the drag. See `Floorplan._refreshRoomGeometry` for what that costs
	 * and why the scope of the two is the same set of rooms.
	 *
	 * @param {Array<Object>} corners
	 */
	refresh(corners)
	{
		var scope = this;
		var walls = new Set();
		var rooms = new Set();
		corners.forEach(function (corner)
		{
			(corner.wallStarts || []).forEach(function (wall) {walls.add(wall);});
			(corner.wallEnds || []).forEach(function (wall) {walls.add(wall);});
			(corner.attachedRooms || []).forEach(function (room) {rooms.add(room);});
		});

		walls.forEach(function (wall)
		{
			[wall.frontEdge, wall.backEdge].forEach(function (halfEdge)
			{
				var edge = halfEdge ? scope.edgesByHalfEdge.get(halfEdge) : null;
				if (edge)
				{
					edge.redraw();
					scope._stats.edgesRedrawn += 1;
				}
			});
		});

		rooms.forEach(function (room)
		{
			var floor = scope.floorsByRoom.get(room);
			if (floor)
			{
				floor.redraw();
				scope._stats.floorsRedrawn += 1;
			}
		});

		// The batch is global and this pass is not, which is the one cost of
		// batching an incremental renderer: moving one corner rebuilds a buffer
		// holding every wall's base. It is 4 vertices per wall face and no upload
		// of anything else, against the alternative of one draw call per face on
		// every frame - so the rebuild happens where an edit is, not where a frame
		// is. M-5 is unaffected: this is not a `redraw()` and does not count as one.
		if (walls.size)
		{
			this._rebuildBaseBatch();
		}
	}

	/**
	 * What this projection has done since it was constructed (RM-003 A2).
	 *
	 * `full` is the number of whole-scene rebuilds, and the number M-5 is about:
	 * it should stay at zero across a drag.
	 *
	 * @returns {{full: number, topology: number, geometry: number, ignored: number, floorsAdded: number, floorsRemoved: number, floorsRedrawn: number, edgesAdded: number, edgesRemoved: number, edgesRedrawn: number}}
	 */
	projectionStats()
	{
		return Object.assign({}, this._stats);
	}

	redraw()
	{
		var scope = this;
		// clear scene
		//
		// dispose(), not removeFromScene(): the floors being dropped here are
		// never used again, and removeFromScene only takes them out of the scene
		// graph. It left each one still subscribed to its room's EVENT_CHANGED and
		// still holding a texture, so every edit that rebuilt the plan added a
		// listener and a GPU texture that nothing would ever release (RM-002 R-04).
		this.floors.forEach((floor) => {
			floor.dispose();
		});

		this.edges.forEach((edge) => {
			edge.remove();
		});
		this.floors = [];
		this.edges = [];
		this.floorsByRoom.clear();
		this.edgesByHalfEdge.clear();

		// draw floors
		this.floorplan.getRooms().forEach((room) => {
			var threeFloor = new Floor(this.scene, room, this.renderProfile, this.runtime);
			this.floors.push(threeFloor);
			this.floorsByRoom.set(room, threeFloor);
			threeFloor.addToScene();
		});

		var eindex = 0;
		// draw edges
		this.floorplan.wallEdges().forEach((edge) => {
			var threeEdge = new Edge(scope.scene, edge, scope.controls, scope.renderProfile, scope.runtime);
			threeEdge.name = 'edge_'+eindex;
			this.edges.push(threeEdge);
			this.edgesByHalfEdge.set(edge, threeEdge);
			eindex+=1;
		});
		this._rebuildBaseBatch();
	}

	/**
	 * Draw every edge's base plane with one mesh instead of one each.
	 *
	 * ## Why this and nothing else
	 *
	 * It is the only geometry in the plan that can be batched without changing
	 * what is on screen, and the reason is in `Edge.updateVisibility`: that method
	 * walks `planes` on every camera move and sets `material.opacity` per edge, so
	 * a wall face fades when you look at its back. Geometry sharing a mesh shares
	 * a material and therefore shares an opacity, so `planes` cannot be batched
	 * while that behaviour exists. `basePlanes` is excluded from it - the comment
	 * where it is pushed says *"always visible"* - which is what makes this safe
	 * and what stops it from being the whole answer to AA-3.
	 *
	 * ## Why it declines rather than degrades
	 *
	 * {@link mergePositionGeometries} keeps positions and drops normals and uvs,
	 * which is correct for `MeshBasicMaterial` and wrong for anything lit. A
	 * studio render profile builds its fillers as `MeshStandardMaterial`, so this
	 * checks and leaves that profile alone rather than quietly flattening its
	 * shading. Batching that cannot be done correctly is not done.
	 */
	_rebuildBaseBatch()
	{
		var scope = this;
		if (this._baseBatch)
		{
			this.scene.remove(this._baseBatch);
			this._baseBatch.geometry.dispose();
			if (this._baseBatchMaterial) { this._baseBatchMaterial.dispose(); }
			this._baseBatch = null;
			this._baseBatchMaterial = null;
		}

		var entries = [];
		// Typed, because it is only ever assigned inside the callback below and the
		// checker does not track that - without this it narrows to `never` after
		// the guard and the two reads become errors (RM-004 B3).
		/** @type {?MeshBasicMaterial} */
		var material = null;
		var batchable = this.edges.length > 0;
		this.edges.forEach(function (edge)
		{
			edge.basePlanes.forEach(function (plane)
			{
				if (!plane.material || !plane.material.isMeshBasicMaterial) { batchable = false; return; }
				// Colours are per plane in principle and identical in practice; a
				// batch has one, so a plan that ever mixes them declines too.
				if (material && plane.material.color && !plane.material.color.equals(material.color))
				{
					batchable = false;
					return;
				}
				material = material || plane.material;
				plane.updateMatrix();
				entries.push({geometry: plane.geometry, matrix: plane.matrix});
			});
		});

		if (!batchable || !entries.length || !material)
		{
			// Put them back the way they were. Idempotent: `add` of an object already
			// in the scene is a no-op in three, so this is safe on every rebuild.
			this.edges.forEach(function (edge)
			{
				edge.baseBatched = false;
				edge.basePlanes.forEach(function (plane) {scope.scene.add(plane);});
			});
			return;
		}

		this.edges.forEach(function (edge)
		{
			edge.baseBatched = true;
			edge.basePlanes.forEach(function (plane) {scope.scene.remove(plane);});
		});

		// Read into a local the checker can see. `material` is assigned only inside
		// the callback above, which control-flow analysis does not follow, so it
		// stays `null` in the checker's model and narrows to `never` past the guard
		// - the same shape as the `lastNode` cast in the floorplanner (RM-004 B3).
		var found = /** @type {MeshBasicMaterial} */ (/** @type {unknown} */ (material));
		this._baseBatchMaterial = new MeshBasicMaterial({color: found.color.getHex(), side: found.side});
		var batch = new Mesh(mergePositionGeometries(entries), this._baseBatchMaterial);
		batch.name = 'wall-bases';
		// Placed at the origin because every vertex already carries its own
		// placement - see mergePositionGeometries, which bakes each mesh's matrix.
		batch.matrixAutoUpdate = false;
		this._baseBatch = batch;
		this.scene.add(batch);
	}

	showRoof(flag)
	{
		// draw floors
		this.floors.forEach((threeFloor) => {
			threeFloor.showRoof(flag);
		});
	}

	/**
	 * Release the floors, the edges and the floorplan subscription.
	 *
	 * There was no dispose() here at all, so tearing a viewer down left this
	 * object subscribed to the model's change events - redrawing a scene it no
	 * longer belonged to - with every Floor and Edge it had built still holding
	 * their own listeners and textures. Mount and unmount a viewer repeatedly,
	 * as the lifecycle suite does, and the cost was cumulative.
	 */
	dispose()
	{
		this.floorplan.removeEventListener(EVENT_CHANGESET, this.updatedroomsevent);
		if (this._baseBatch)
		{
			this.scene.remove(this._baseBatch);
			this._baseBatch.geometry.dispose();
			if (this._baseBatchMaterial) { this._baseBatchMaterial.dispose(); }
			this._baseBatch = null;
			this._baseBatchMaterial = null;
		}
		this.floors.forEach((floor) => {floor.dispose();});
		this.edges.forEach((edge) => {edge.remove();});
		this.floors = [];
		this.edges = [];
		this.floorsByRoom.clear();
		this.edgesByHalfEdge.clear();
	}
}
