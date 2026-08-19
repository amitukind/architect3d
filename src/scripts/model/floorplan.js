// @ts-check
import {EVENT_UPDATED, EVENT_LOADED, EVENT_NEW, EVENT_DELETED, EVENT_ROOM_NAME_CHANGED, EVENT_CHANGESET} from '../core/events.js';
import {EVENT_ITEMS_PROJECTED} from '../core/events.js';
import {EVENT_ANNOTATIONS_CHANGED} from '../core/events.js';
import {EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_WALL_ATTRIBUTES_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED, EVENT_MOVED} from '../core/events.js';
import {ChangeSet, CHANGE_TOPOLOGY, CHANGE_GEOMETRY, REASON_EDIT, REASON_LOAD, newChangeCounts} from '../core/change_set.js';
import {matchRooms, rekeyInPlace} from './room_matcher.js';
import {EventDispatcher, Vector2, Vector3} from 'three';
import {Utils} from '../core/utils.js';
import {Dimensioning} from '../core/dimensioning.js';
import {WallTypes} from '../core/constants.js';
import {Version} from '../core/version.js';
import {cornerTolerance} from '../core/configuration.js';
import {resolveRuntime} from '../core/design_runtime.js';


import {HalfEdge} from './half_edge.js';
import {Corner} from './corner.js';
import {Wall} from './wall.js';
import {deriveWallIds} from '../core/wall_identity.js';
import {Room} from './room.js';
import {Dimension, TextAnnotation, dimensionLine} from './annotation.js';


/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('../floorplanner/carbonsheet.js').CarbonSheet} CarbonSheet
 * @typedef {import('three').Mesh} Mesh
 */
/** */
export const defaultFloorPlanTolerance = 10.0;

/**
 * The unit every coordinate in a save file this build writes is expressed in,
 * and the value of the file's `units` field.
 *
 * Centimetres, because that is what the model itself holds - so writing the
 * file in them makes the numbers in it the numbers in memory, and makes a
 * design independent of the display unit the user happened to have selected.
 */
export const SAVE_UNITS = 'cm';

/**
 * How far a corner may sit off the line between its neighbours and still count
 * as collinear, as a fraction of the distance between them (RM-008 E2).
 *
 * A ratio rather than a distance, so the test means the same thing on a
 * two-metre wall and a twenty-metre one. 0.002 is about a tenth of a degree of
 * bend across a typical run - tight enough that a corner somebody drew on
 * purpose survives, loose enough that one left behind by a merge or a split does
 * not.
 */
export const COLLINEAR_SAGITTA_RATIO = 0.002;

/**
 * Choose how to turn a stored coordinate into centimetres.
 *
 * @param {?string} units The file's `units` field, absent on 0.0.2a and older.
 * @returns {function(number): number}
 */
function cornerReader(units)
{
	if (units === undefined || units === null)
	{
		// Pre-2.0.0: written in the display unit active at save time.
		return (value) => Dimensioning.cmFromMeasureRaw(value);
	}
	if (units !== SAVE_UNITS)
	{
		// Nothing writes anything else, so this is a file from a build that does
		// not exist yet, or a hand-edited one. Warn and read it as centimetres
		// rather than throw: refusing to open a design is a worse outcome than
		// opening one whose scale the user can see is wrong.
		console.warn(
			`architect3d: save file declares units "${units}", which this build does not know. ` +
			`Reading coordinates as ${SAVE_UNITS}.`);
	}
	return (value) => value;
}

/**
 * A Floorplan represents a number of Walls, Corners and Rooms. This is an
 * abstract that keeps the 2d and 3d in sync
 */
export class Floorplan extends EventDispatcher
{
	/** Constructs a floorplan. */
	/**
	 * @param {?(import('../core/configuration.js').Configuration|import('../core/design_runtime.js').DesignRuntime)} [runtime]
	 * This design's services, or just its settings. Omit to share the page-wide
	 * defaults, which is what every caller did before P7 and what a page with one
	 * design should keep doing. A bare `Configuration` is still accepted and is
	 * what P7 documented; a runtime is built around it.
	 */
	constructor(runtime)
	{
		super();
		/**
		 * This design's services (RM-003 A4): its configuration, the dimensioning
		 * bound to that, the render profile, the load session and the resource
		 * registries.
		 *
		 * The model layer needs no other plumbing to reach it: `Corner` already
		 * took a floorplan as its first constructor argument, `Floorplan` is the
		 * only factory for Corners and Walls, and a Wall gets here through
		 * `this.start.floorplan`. That is what made P7's stage three lines rather
		 * than a rewrite, and it is what makes A4's the same shape.
		 *
		 * @property {DesignRuntime} runtime
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = resolveRuntime(runtime || null);
		/**
		 * List of elements of Wall instance
		 * 
		 * @property {Wall[]} walls Array of walls
		 * @type {Wall[]}
		 */
		this.walls = [];
		/**
		 * List of elements of Corner instance
		 * 
		 * @property {Corner[]} corners array of corners
		 * @type {Corner[]}
		 */
		this.corners = [];

		/**
		 * List of elements of Room instance
		 * 
		 * @property {Room[]} walls Array of walls
		 * @type {Room[]}
		 */
		this.rooms = [];

		/**
		 * An {@link Object} that stores the metadata of rooms like name
		 * 
		 * @property {Object} metaroomsdata stores the metadata of rooms like
		 *           name
		 * @type {Object}
		 */
		this.metaroomsdata = {};
		/**
		 * How many nested batches are open (RM-003 A1).
		 *
		 * `newCorner()` and `newWall()` each call `update()`, which re-derives every
		 * room in the plan and dispatches EVENT_UPDATED. That is right for a single
		 * edit and badly wrong for a bulk build: opening a four-corner, four-wall
		 * design dispatched EVENT_UPDATED **25 times**, and every one of them drove
		 * a full 3D teardown and rebuild and a camera recentre.
		 *
		 * While a batch is open, `update()` records what it was asked for and
		 * returns; `endBatch()` performs it once. Deliberately the smallest thing
		 * that works - A2 replaces it with a typed change contract, and this is the
		 * seed of that rather than a competing mechanism.
		 *
		 * @type {number}
		 */
		this._batchDepth = 0;
		/** What the deferred update has to do: null when nothing is pending. */
		this._pendingUpdate = null;
		/**
		 * Why the open batch is happening, or null outside one (RM-003 A2).
		 *
		 * Set by the OUTERMOST `beginBatch()` and cleared when depth returns to
		 * zero, because the outermost batch is the gesture: `loadFloorplan()` opens
		 * one for `'load'` and every `newCorner()` inside it is part of that load,
		 * not an edit of its own.
		 *
		 * @type {?string}
		 */
		this._batchReason = null;
		/**
		 * How many ChangeSets carrying each kind this plan has dispatched.
		 *
		 * The observability half of A2: "one EVENT_UPDATED per document open
		 * instead of twenty-five" is a claim, and a claim nobody can compute is a
		 * slogan. Read it with {@link Floorplan#changeStats}.
		 *
		 * @type {import('../core/change_set.js').ChangeCounts}
		 */
		this._changeCounts = newChangeCounts();
		/** How many ChangeSets have been dispatched at all, of any kind. */
		this._changeDispatches = 0;
		// Removed in S1: new_wall_callbacks, new_corner_callbacks,
		// redraw_callbacks, updated_rooms and roomLoadedCallbacks. They were
		// plain Arrays whose only registrars (fireOnNewWall and friends) called
		// .add() on them - a TypeError had anything ever called them. Nothing
		// did; every event on this class goes through EventDispatcher.

		this.floorTextures = {};
		/**
		 * What the 2D view is allowed to know about the furniture (RM-008 E1, T-1).
		 *
		 * Plain data, written by `Model` and read by the plan - never live items,
		 * and never a reference to the `Scene` that holds them. The measured reason
		 * this exists at all is that a `Floorplan` has no path to a `Scene`: the 2D
		 * view is handed this object and nothing else, so before E1 it could not
		 * draw a chair even in principle.
		 *
		 * It sits beside `floorTextures` deliberately - that is the other thing here
		 * that describes something the floorplan does not own. Empty until `Model`
		 * fills it, which means a bare `Floorplan` built by a test is still a whole
		 * `Floorplan`, and that is the property worth protecting.
		 *
		 * @type {Array<import('./plan_projection.js').ItemFootprint>}
		 */
		this.itemProjection = [];
		/**
		 * The storey below, to trace over, or null (RM-010 G1).
		 *
		 * Plain data set by `Model`, for the reason `itemProjection` is: this class
		 * has no path to a `Model` and must not gain one, so a second plan on the
		 * same canvas arrives as a description. See `model/level_projection.js`.
		 *
		 * @type {?import('./level_projection.js').GhostPlan}
		 */
		this.ghostPlan = null;
		/**
		 * What the last `setFloorOpenings` was handed, so an unchanged list does
		 * not cost a redraw. A string rather than a deep compare because the list
		 * is small, plain and rebuilt from scratch every time.
		 * @type {string}
		 */
		this._floorOpeningSignature = '';
		/**
		 * The openings themselves, kept so a room rebuild can be handed them again.
		 * @type {Array<Array<{x: number, y: number}>>}
		 */
		this._floorOpenings = [];
		/**
		 * What this plan says about itself (RM-008 E3).
		 *
		 * The first entities here that are authored rather than derived - see
		 * `model/annotation.js` for why that matters and what follows from it.
		 * Beside `itemProjection` and `floorTextures` because all three are things
		 * the wall graph does not produce; unlike `itemProjection`, these two are
		 * owned here and persisted here.
		 *
		 * @type {Array<Dimension>}
		 */
		this.dimensions = [];
		/** @type {Array<TextAnnotation>} */
		this.annotations = [];
		/**
		 * Which way is north, in degrees clockwise from up (RM-008 E3).
		 *
		 * A property of the building, not of the view: it survives a save, and a
		 * plan drawn with the front door at the bottom is a different building from
		 * one drawn with it at the top even when the walls are identical. Zero -
		 * north is up - is the default and is not written to a file, so a design
		 * nobody oriented is unchanged by this sprint.
		 *
		 * @type {number}
		 */
		this._north = 0;
		/**
		 * How the plan asks for an item to change - see {@link Floorplan#setItemCommands}.
		 * @type {?Object}
		 */
		this._itemCommands = null;
		/**
		 * The {@link CarbonSheet} that handles the background image to show in
		 * the 2D view
		 * 
		 * @property {CarbonSheet} _carbonSheet The carbonsheet instance
		 * @type {?CarbonSheet} Null in widget mode and headless, where there is
		 * no 2D view to inject one.
		 */
		this._carbonSheet = null;
	}

	/**
	 * Where this design reads its units, scale, wall defaults and snapping from
	 * (RM-002 R-02, P7).
	 *
	 * A getter over the runtime rather than a field of its own, since A4. The
	 * two would otherwise be storage in two places that have to agree, and
	 * `configurationOf(floorplan)` and `runtimeOf(floorplan).configuration`
	 * would be able to answer differently - which is the shape of bug the
	 * previous three sprints have been closing. There is one answer because
	 * there is one place it is kept.
	 *
	 * @returns {import('../core/configuration.js').Configuration}
	 */
	get configuration()
	{
		return this.runtime.configuration;
	}

	/**
	 * Unit and scale conversion bound to this design's configuration.
	 *
	 * Reached through the runtime so the 2D view, the inspectors and the model
	 * all measure with one object - and so that `floorplan.dimensioning` is the
	 * obvious thing to reach for instead of the `Dimensioning` statics, which
	 * measure with the shared default.
	 *
	 * @returns {import('../core/dimensioning.js').Dimensioning}
	 */
	get dimensioning()
	{
		return this.runtime.dimensioning;
	}

	/**
	 * @param {?CarbonSheet} val The sheet, or null to detach it - which
	 * `FloorplannerView2D.dispose()` does. Another tag whose type sat on one
	 * line and whose name sat on the next (RM-005 C2).
	 */
	set carbonSheet(val)
	{
		this._carbonSheet = val;
	}

	/**
	 * @return {?CarbonSheet} reference to the instance of {@link CarbonSheet},
	 *         or null in widget mode and headless use.
	 */
	get carbonSheet()
	{
		return this._carbonSheet;
	}

	/**
	 * @return {HalfEdge[]} edges The array of {@link HalfEdge}
	 */
	wallEdges()
	{
		var edges = [];
		this.walls.forEach((wall) => {
			if (wall.frontEdge)
			{
				edges.push(wall.frontEdge);
			}
			if (wall.backEdge)
			{
				edges.push(wall.backEdge);
			}
		});
		return edges;
	}

	/**
	 * Returns the roof planes in the floorplan for intersection testing
	 * 
	 * @return {Mesh[]} planes
	 * @see https://threejs.org/docs/#api/en/objects/Mesh
	 */
	roofPlanes()
	{
		var planes = [];
		this.rooms.forEach((room) => {
			planes.push(room.roofPlane);
		});
		return planes;
	}

	/**
	 * Returns all the planes for intersection for the walls
	 * 
	 * @return {Mesh[]} planes
	 * @see https://threejs.org/docs/#api/en/objects/Mesh
	 */
	wallEdgePlanes()
	{
		var planes = [];
		this.walls.forEach((wall) => {
			if (wall.frontEdge)
			{
				planes.push(wall.frontEdge.plane);
			}
			if (wall.backEdge)
			{
				planes.push(wall.backEdge.plane);
			}
		});
		return planes;
	}

	/**
	 * Returns all the planes for intersection of the floors in all room
	 * 
	 * @return {Mesh[]} planes
	 * @see https://threejs.org/docs/#api/en/objects/Mesh
	 */
	floorPlanes()
	{
		return Utils.map(this.rooms, (room) => {
			return room.floorPlane;
		});
	}





	// This method needs to be called from the 2d floorplan whenever
	// the other method newWall is called.
	// This is to ensure that there are no floating walls going across
	// other walls. If two walls are intersecting then the intersection point
	// has to create a new wall.
	/**
	 * Checks existing walls for any intersections they would make. If there are
	 * intersections then introduce new corners and new walls as required at
	 * places
	 * 
	 * @param {Corner}
	 *            start
	 * @param {Corner}
	 *            end
	 * @return {boolean} intersects
	 */

	newWallsForIntersections(start, end)
	{
		var intersections = false;
		// This is a bug in the logic
		// When creating a new wall with a start and end
		// it needs to be checked if it is cutting other walls
		// If it cuts then all those walls have to removed and introduced as
		// new walls along with this new wall
		var cStart = new Vector2(start.getX(), start.getY());
		var cEnd = new Vector2(end.getX(), end.getY());
		var line = {p1: cStart, p2: cEnd};
		var newCorners = [];

		for (var i=0;i<this.walls.length;i++)
		{
			var twall = this.walls[i];
			var bstart = {x:twall.getStartX(), y:twall.getStartY()};
			var bend = {x:twall.getEndX(), y:twall.getEndY()};
			var iPoint;
			if(twall.wallType == WallTypes.CURVED)
			{
				iPoint = twall.bezier.intersects(line);
				if(iPoint.length)
				{
					iPoint = twall.bezier.get(iPoint[0]);
				}
			}
			else
			{
				iPoint = Utils.lineLineIntersectPoint(cStart, cEnd, bstart, bend);
			}
			if(iPoint)
			{
				var nCorner = this.newCorner(iPoint.x, iPoint.y);
				newCorners.push(nCorner);
				nCorner.mergeWithIntersected(false);
				intersections = true;
			}
		}
		this.update();
		
		return intersections;
	}

	/**
	 * Creates a new wall.
	 * 
	 * The three trailing parameters are optional and were not declared as such,
	 * so every two-argument call in the project read as a TS2554 the moment
	 * `Floorplan` became a resolvable type (RM-005 C2). The two tags above were
	 * malformed as well - the type on one line and the name on the next, which
	 * documents neither.
	 *
	 * @param {Corner} start The start corner.
	 * @param {Corner} end The end corner.
	 * @param {Vector2} [a] Curve control point, for a curved wall.
	 * @param {Vector2} [b] The second control point.
	 * @param {string} [id] Assigned identity, when one is being restored.
	 * @returns {Wall} The new wall.
	 */
	newWall(start, end, a, b, id)
	{
		var scope = this;
		var wall = new Wall(start, end, a, b, id);
		
		this.walls.push(wall);
		wall.addEventListener(EVENT_DELETED, function(o){scope.removeWall(o.item);});
		wall.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, function(o){
			scope.dispatchEvent(o);
		});
		
		this.dispatchEvent({type: EVENT_NEW, item: this, newItem: wall});
		this.update();
		return wall;
	}



	/**
	 * Creates a new corner.
	 * 
	 * @param {Number}
	 *            x The x coordinate.
	 * @param {Number}
	 *            y The y coordinate.
	 * @param {String} [id]
	 *            An optional id. If unspecified, the id will be created
	 *            internally. Bracketed because the word "optional" in the prose
	 *            is not what makes it optional to a type checker - and the
	 *            generated .d.ts declared it required, so every two-argument
	 *            call was an error for a typed consumer. That is every real call
	 *            in this repository.
	 * @returns {Corner} The new corner.
	 */
	/**
	 * Subscribe to a corner this plan owns.
	 *
	 * Extracted from `newCorner` by RM-008 F2 so that `splitCorner` wires its
	 * replacement corner up with exactly the same three listeners rather than a
	 * copy of them. The bodies are unchanged.
	 *
	 * @param {Corner} corner
	 * @returns {void}
	 */
	_listenToCorner(corner)
	{
		var scope = this;
		corner.addEventListener(EVENT_DELETED, function(o)
				{scope.removeCorner(o.item);}
		);
		corner.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, function(o){
			scope.dispatchEvent(o);
			var updatecorners = o.item.adjacentCorners();
			updatecorners.push(o.item);
			scope.update(false, updatecorners);
			});
		corner.addEventListener(EVENT_MOVED, function(o){
			scope.dispatchEvent(o);
			var updatecorners = o.item.adjacentCorners();
			updatecorners.push(o.item);
			scope.update(false, updatecorners);
			});
	}

	newCorner(x, y, id)
	{
		var corner = new Corner(this, x, y, id);
		
		for (var i=0;i<this.corners.length;i++)
		{
				var existingCorner = this.corners[i];
				if(existingCorner.distanceFromCorner(corner) < cornerTolerance)
				{
					return existingCorner;
				}
		}
		
		this.corners.push(corner);
		this._listenToCorner(corner);
		
		this.dispatchEvent({type: EVENT_NEW, item: this, newItem: corner});

		// This code has been added by #0K. There should be an update whenever a
		// new corner is inserted
		this.update();

		return corner;
	}

	/**
	 * Removes a wall.
	 * 
	 * @param {Wall}
	 *            wall The wall to be removed.
	 */
	/**
	 * Cut a wall in two at the point nearest a position (RM-008 E2).
	 *
	 * The wall keeps its start and gains a new end; a second wall runs from there
	 * to the old end. Both inherit the original's textures and its thickness, and
	 * the new one is a wall in its own right - so a corridor can be given a
	 * doorway-width section without redrawing the whole run.
	 *
	 * Straight walls only. A curved wall's shape lives in its bezier control
	 * points, and splitting one means solving for the two sub-curves that
	 * reproduce it - real work with a visible failure mode, and not what E2 is
	 * for. It returns null rather than approximating, because a curve silently
	 * replaced by two straight pieces is worse than a tool that declines.
	 *
	 * @param {Wall} wall
	 * @param {{x: number, y: number}} at Anywhere near the wall; the cut lands at
	 *        the closest point on it.
	 * @returns {?Corner} The corner created at the cut, or null if refused.
	 */
	splitWall(wall, at)
	{
		if (!wall || wall.wallType !== WallTypes.STRAIGHT || !at)
		{
			return null;
		}
		var start = wall.getStart();
		var end = wall.getEnd();
		if (!start || !end)
		{
			return null;
		}
		var point = Utils.closestPointOnLine(
			new Vector2(at.x, at.y),
			new Vector2(start.x, start.y),
			new Vector2(end.x, end.y));

		// A cut within merge distance of either end is not a cut. `newCorner`
		// would merge the new corner into that end, leaving one wall and a
		// second of zero length - which reads as the tool having done nothing,
		// or worse, having deleted something.
		if (point.distanceTo(new Vector2(start.x, start.y)) < cornerTolerance
			|| point.distanceTo(new Vector2(end.x, end.y)) < cornerTolerance)
		{
			return null;
		}

		this.beginBatch(REASON_EDIT);
		try
		{
			var middle = this.newCorner(point.x, point.y);
			var second = this.newWall(middle, end);
			second.frontTexture = wall.frontTexture;
			second.backTexture = wall.backTexture;
			if (wall.hasOwnThickness)
			{
				second.thickness = wall.thickness;
			}
			// Re-point the original at the new corner rather than removing and
			// rebuilding it: the wall keeps its id, so anything holding one - a
			// bound item, a selection, an undo snapshot - still names a wall that
			// exists. `setEnd` detaches the old end itself.
			wall.setEnd(middle);
			return middle;
		}
		finally
		{
			this.endBatch();
		}
	}

	/**
	 * Remove a corner where two collinear walls meet, joining them (RM-008 E2).
	 *
	 * The inverse of `splitWall`, and the reason a plan does not accumulate
	 * corners: every split, every wall drawn through another and every merge
	 * leaves one, and a run of six walls that should be one is six labels, six
	 * handles and six things to drag by mistake.
	 *
	 * Refused unless the corner joins exactly two straight walls whose directions
	 * agree within {@link COLLINEAR_TOLERANCE_DEGREES}. That is not fussiness: a
	 * corner between two walls that genuinely turn is a corner somebody drew, and
	 * removing it changes the shape of their building.
	 *
	 * @param {Corner} corner
	 * @returns {?Wall} The surviving wall, or null if refused.
	 */
	joinWallsAt(corner)
	{
		if (!corner)
		{
			return null;
		}
		var walls = corner.wallStarts.concat(corner.wallEnds);
		if (walls.length !== 2 || walls[0] === walls[1])
		{
			return null;
		}
		if (walls[0].wallType !== WallTypes.STRAIGHT || walls[1].wallType !== WallTypes.STRAIGHT)
		{
			return null;
		}

		// The far end of each wall - the two points the surviving wall will span.
		var farOf = function (wall)
		{
			return (wall.getStart() === corner) ? wall.getEnd() : wall.getStart();
		};
		var a = farOf(walls[0]);
		var b = farOf(walls[1]);
		if (!a || !b || a === b)
		{
			return null;
		}

		// Collinear means the corner sits on the line between the two far ends,
		// which is the same thing as the two directions agreeing and is cheaper
		// and steadier to compute than comparing two angles across the wrap.
		var offLine = Utils.pointDistanceFromLine(
			new Vector2(corner.x, corner.y),
			new Vector2(a.x, a.y),
			new Vector2(b.x, b.y));
		var span = new Vector2(a.x, a.y).distanceTo(new Vector2(b.x, b.y));
		if (span === 0 || offLine > (span * COLLINEAR_SAGITTA_RATIO))
		{
			return null;
		}

		this.beginBatch(REASON_EDIT);
		try
		{
			var survivor = walls[0];
			var other = walls[1];

			// Re-point BEFORE removing, and the order is not cosmetic.
			// `Corner.detachWall` removes a corner the moment its last wall
			// leaves, so removing the other wall first orphans the far corner it
			// was reaching - and the survivor is then re-pointed at a corner that
			// is no longer in the plan. Found by counting corners after a join: two
			// expected, one left.
			if (survivor.getStart() === corner)
			{
				survivor.setStart(b);
			}
			else
			{
				survivor.setEnd(b);
			}
			// The middle corner now holds only the other wall, so removing that
			// takes the corner with it - which is the whole point of the join.
			other.remove();
			return survivor;
		}
		finally
		{
			this.endBatch();
		}
	}

	/**
	 * Draw a whole rectangular room in one gesture (RM-008 E2).
	 *
	 * Four corners and four walls, in one batch, so the plan re-derives once and
	 * the undo stack gets one entry - the same reason `loadFloorplan` batches.
	 * Without it this is eight separate edits and eight room re-derivations for
	 * something a user thinks of as one act.
	 *
	 * Degenerate rectangles are refused rather than drawn. A zero width or height
	 * produces two coincident corners, which `newCorner` merges inside
	 * `cornerTolerance` anyway - leaving a plan with two walls on top of each
	 * other and no room, which looks like the tool failed silently.
	 *
	 * @param {number} x1 One corner, in centimetres.
	 * @param {number} y1
	 * @param {number} x2 The opposite corner.
	 * @param {number} y2
	 * @returns {?Corner[]} The four corners in draw order, or null if refused.
	 */
	newRoomFromRectangle(x1, y1, x2, y2)
	{
		if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2))
		{
			return null;
		}
		if (Math.abs(x2 - x1) < cornerTolerance || Math.abs(y2 - y1) < cornerTolerance)
		{
			return null;
		}

		this.beginBatch(REASON_EDIT);
		try
		{
			var corners = [
				this.newCorner(x1, y1),
				this.newCorner(x2, y1),
				this.newCorner(x2, y2),
				this.newCorner(x1, y2),
			];
			for (var i = 0; i < 4; i++)
			{
				this.newWall(corners[i], corners[(i + 1) % 4]);
			}
			return corners;
		}
		finally
		{
			// As in loadFloorplan: a throw between here and the end would otherwise
			// leave the batch open and the plan permanently frozen.
			this.endBatch();
		}
	}

	removeWall(wall)
	{
		this.dispatchEvent({type: EVENT_DELETED, item: this, deleted: wall, item_type: 'wall'});
		Utils.removeValue(this.walls, wall);
		// The departing wall's half edges have to be released here, not by the
		// update() below (RM-003 A0). That release walks `this.walls`, and this wall
		// has just left it - so its two intersection planes would be unreachable
		// from anywhere by the time anything looked for them.
		if (wall.frontEdge)
		{
			wall.frontEdge.dispose();
		}
		if (wall.backEdge)
		{
			wall.backEdge.dispose();
		}
		wall.resetFrontBack();
		this.update();
	}

	/**
	 * Removes a corner.
	 * 
	 * @param {Corner}
	 *            corner The corner to be removed.
	 */
	removeCorner(corner)
	{
		this.dispatchEvent({type: EVENT_DELETED, item: this, deleted: corner, item_type: 'corner'});
		Utils.removeValue(this.corners, corner);
		// The asymmetry A2 closes (RM-003 A2, task 6).
		//
		// removeWall() has always ended with an update() and this has never had
		// one, so removing a corner left the plan announcing EVENT_DELETED and
		// nothing else: the rooms still contained the departed corner, getSize()
		// still counted it, and the 3D view still drew it, until some unrelated
		// edit came along and re-derived. The usual path hid it - Corner.removeAll()
		// removes the corner's walls first and each of THOSE updated - so the
		// symptom only showed on a corner with no walls, or on the last update
		// before something read the plan.
		//
		// Costs nothing on the usual path either, because removeAll() now opens a
		// batch: what used to be one update per wall plus none for the corner is
		// one update for the whole gesture.
		this.update();
	}

	/**
	 * Gets the walls.
	 * 
	 * @return {Wall[]}
	 */
	getWalls()
	{
		return this.walls;
	}

	/**
	 * Gets the corners.
	 * 
	 * @return {Corner[]}
	 */
	getCorners()
	{
		return this.corners;
	}

	/**
	 * Gets the rooms.
	 * 
	 * @return {Room[]}
	 */
	getRooms()
	{
		return this.rooms;
	}

	/**
	 * Gets the room overlapping the location x, y.
	 * 
	 * @param {Number}
	 *            mx
	 * @param {Number}
	 *            my
	 * @return {?Room} The room under the point, or null.
	 */
	overlappedRoom(mx, my)
	{
			for (var i=0;i<this.rooms.length;i++)
			{
					var room = this.rooms[i];
					var flag = room.pointInRoom(new Vector2(mx, my));
					if(flag)
					{
						return room;
					}
			}

			return null;
	}
	
	/**
	 * Gets the Control of a Curved Wall overlapping the location x, y at a
	 * tolerance.
	 * 
	 * @param {number} x
	 * @param {number} y
	 * @param {number} [tolerance] Defaults to five times the plan tolerance.
	 * @return {?Corner} The control point under x,y, or null.
	 */
	overlappedControlPoint(wall, x, y, tolerance)
	{
		tolerance = tolerance || defaultFloorPlanTolerance*5;
		if (wall.a.distanceTo(new Vector2(x, y)) < tolerance && wall.wallType == WallTypes.CURVED)
		{
			return wall.a;
		}
		
		else if (wall.b.distanceTo(new Vector2(x, y)) < tolerance && wall.wallType == WallTypes.CURVED)
		{
			return wall.b;
		}
		
		return null;
	}

	/**
	 * Gets the Corner overlapping the location x, y at a tolerance.
	 * 
	 * @param {number} x
	 * @param {number} y
	 * @param {number} [tolerance] Defaults to the plan tolerance.
	 * @return {?Corner} The corner under x,y, or null.
	 */
	overlappedCorner(x, y, tolerance)
	{
		tolerance = tolerance || defaultFloorPlanTolerance;
		for (var i = 0; i < this.corners.length; i++)
		{
			if (this.corners[i].distanceFrom(new Vector2(x, y)) < tolerance)
			{
				return this.corners[i];
			}
		}
		return null;
	}

	/**
	 * Gets the Wall overlapping the location x, y at a tolerance.
	 * 
	 * @param {number} x
	 * @param {number} y
	 * @param {number} [tolerance] Defaults to the plan tolerance.
	 * @return {?Wall} The wall under x,y, or null.
	 */
	overlappedWall(x, y, tolerance)
	{
		tolerance = tolerance || defaultFloorPlanTolerance;
		for (var i = 0; i < this.walls.length; i++)
		{
			var newtolerance = tolerance;
			if (this.walls[i].distanceFrom(new Vector2(x, y)) < newtolerance)
			{
				return this.walls[i];
			}
		}
		return null;
	}

	/**
	 * The metadata object with information about the rooms.
	 * 
	 * @return {Object} metaroomdata an object with room corner ids as key and
	 *         names as values
	 */
	getMetaRoomData()
	{
		  var metaRoomData = {};
			this.rooms.forEach((room)=>{
				var metaroom = {};
				var ids = room.roomByCornersId;
				metaroom['name'] = room.name;
				metaRoomData[ids] = metaroom;
			});
			return metaRoomData;
	}

	// Save the floorplan as a json object file
	/**
	 * Serialize the plan.
	 *
	 * Writes save format 2.0.0, whose one difference from 0.0.2a is that it says
	 * what unit its coordinates are in - and that they are always the same one.
	 *
	 * 0.0.2a wrote corner coordinates through `Dimensioning.cmToMeasureRaw()`,
	 * which converts centimetres into whatever display unit happened to be
	 * active when the user pressed save. Wall control points and every item
	 * position went out raw. So one file mixed two units and recorded neither:
	 * the same plan saved under metres and under centimetres produced two files
	 * whose corner numbers differed by 100x, and loading either under the wrong
	 * unit rescaled the whole plan silently. `tests/fixtures/v1/metres-room`
	 * is that, frozen.
	 *
	 * 2.0.0 stores canonical centimetres throughout and stamps `units`. Corners
	 * therefore agree with the control points and the items for the first time,
	 * and a file is now independent of the setting it was written under.
	 *
	 * @return {Object} The serialized floorplan.
	 */
	saveFloorplan()
	{
		// Typed loosely, because an object literal takes each field's type from its
		// initialiser - so `walls: []` is `never[]` and every push into it is an
		// error, as are the three `{}` maps (RM-005 C2). This is the save format's
		// wire shape; `model/document.js` is where it is actually described.
		/** @type {Record<string, any>} */
		var floorplans = {version:Version.getTechnicalVersion(), units: SAVE_UNITS, corners: {}, walls: [], rooms: {}, wallTextures: [], floorTextures: {}, newFloorTextures: {}, carbonSheet:{}};
		var cornerIds = [];
// writing all the corners based on the corners array
// is having a bug. This is because some walls have corners
// that aren't part of the corners array anymore. This is a quick fix
// by adding the corners to the json file based on the corners in the walls

		this.walls.forEach((wall) => {
			if(wall.getStart() && wall.getEnd())
			{
				/** @type {Record<string, any>} */
				var record = {
					'corner1': wall.getStart().id,
					'corner2': wall.getEnd().id,
					'frontTexture': wall.frontTexture,
					'backTexture': wall.backTexture,
					'wallType': wall.wallType.description,
					'a':{x: wall.a.x, y:wall.a.y},
					'b':{x: wall.b.x, y:wall.b.y},
				};
				// Only when somebody chose it (RM-008 E2, T-6).
				//
				// Every other field here is written unconditionally, which is what
				// makes the format stable - and it is exactly why an additive field
				// has to be conditional. A wall whose thickness was never touched
				// inherits the document's, and writing that number would freeze a
				// default into every file: a design saved today would stop following
				// a setting changed tomorrow, and a file written before E2 would not
				// survive a re-save unchanged.
				if (wall.hasOwnThickness)
				{
					record['thickness'] = wall.thickness;
				}
				// Additive and conditional for the same reason (RM-008 F2): null is
				// "as high as its corners", which is every wall anybody has drawn, and
				// writing it would turn every file into a different file.
				if (wall.partialHeight !== null)
				{
					record['partialHeight'] = wall.partialHeight;
				}
				floorplans.walls.push(record);
				cornerIds.push(wall.getStart());
				cornerIds.push(wall.getEnd());
			}
		});

		// Raw, not Dimensioning.cmToMeasureRaw. The model holds centimetres and
		// so does the file - see the docblock above. This is the whole of the
		// 2.0.0 change on the write side.
		cornerIds.forEach((corner)=>{
			floorplans.corners[corner.id] = {'x': corner.x,'y': corner.y, 'elevation': corner.elevation};
		});

		floorplans.rooms = this.metaroomsdata;

		if(this.carbonSheet)
		{
			floorplans.carbonSheet['url'] = this.carbonSheet.url;
			floorplans.carbonSheet['transparency'] = this.carbonSheet.transparency;
			floorplans.carbonSheet['x'] = this.carbonSheet.x;
			floorplans.carbonSheet['y'] = this.carbonSheet.y;
			floorplans.carbonSheet['anchorX'] = this.carbonSheet.anchorX;
			floorplans.carbonSheet['anchorY'] = this.carbonSheet.anchorY;
			floorplans.carbonSheet['width'] = this.carbonSheet.width;
			floorplans.carbonSheet['height'] = this.carbonSheet.height;
		}

		// Additive, and written only when there is something to write (RM-008 E3,
		// T-6). The same rule per-wall thickness follows two fields above, for a
		// related but distinct reason: thickness is conditional so a document
		// default is not frozen into a file, and these are conditional so a file
		// written before this sprint survives a re-save byte for byte. That is the
		// half of M-33 that an additive collection usually gets wrong - `[]` looks
		// harmless and changes every file in existence.
		if (this.dimensions.length)
		{
			floorplans.dimensions = this.dimensions.map(function (dimension) {return dimension.toJSON();});
		}
		if (this.annotations.length)
		{
			floorplans.annotations = this.annotations.map(function (annotation) {return annotation.toJSON();});
		}
		if (this._north)
		{
			floorplans.north = this._north;
		}

		floorplans.newFloorTextures = this.floorTextures;
		return floorplans;
	}

	// Load the floorplan from a previously saved json object file
	/**
	 * @param {Record<string, any>} floorplan A saved design, already parsed. The
	 *        tag said `{JSON}` with the name on the next line, which typed the
	 *        parameter as the global JSON namespace object and left every field
	 *        read off it `unknown` (RM-005 C2).
	 * @param {string} [reason] Why this load is happening - one of
	 *            `CHANGE_REASONS`. Defaults to `REASON_LOAD`; history passes
	 *            `REASON_UNDO` so consumers can tell a restoration from an open.
	 * @return {void}
	 * @emits {EVENT_LOADED}
	 */
	loadFloorplan(floorplan, reason)
	{
		var corners = {};
		// The whole document swap is one gesture, `reset()` included (RM-003 A2).
		//
		// A1 batched the build but left `reset()` outside it, which was invisible
		// while the only tested case was opening a document into an empty plan.
		// Opening one OVER an existing design is the real case: reset() removes
		// every wall and every corner, each removal re-derives, and the second file
		// open of a session announced thirteen changes before it had built
		// anything - all of them labelled `edit`, because the batch that would have
		// labelled them `load` had not started yet.
		//
		// The finally is not defensive padding: a throw between here and the end
		// would otherwise leave the batch open and the plan permanently frozen,
		// which is a far worse failure than the one that caused it.
		var usable = floorplan != null && ('corners' in floorplan) && ('walls' in floorplan);
		this.beginBatch(reason || REASON_LOAD);
		try
		{
			this.reset();
			if (usable)
			{
				this._buildFloorplan(floorplan, corners);
			}
		}
		finally
		{
			// Closes the batch AND performs the single deferred update, so the
			// explicit update() that used to be here is not needed - and would be a
			// second full re-derivation if it stayed.
			this.endBatch();
		}

		if (!usable)
		{
			// Preserved exactly, quirk and all: a file that is not a floorplan has
			// by now wiped the plan that was open, and says nothing about it - no
			// EVENT_LOADED, no error. `tests/serialization.test.js` pins this under
			// "CONTRADICTS the no-op reading of this branch". It is not the defect
			// it looks like from here, because A1 put `DesignDocument.parse` in
			// front of the only path an application reaches this by; a caller that
			// hands raw JSON straight to loadFloorplan still gets the old behaviour.
			return;
		}

		// The CarbonSheet is injected by the 2D floorplanner view. In widget mode
		// (blueprint.js `options.widget`) and in headless use there is no 2D view,
		// so this.carbonSheet is undefined and the block below used to throw on a
		// design that carries a carbonSheet entry. Skip it instead: the data is
		// still round-tripped by saveFloorplan only when a sheet exists.
		if('carbonSheet' in floorplan && this.carbonSheet)
		{
			this.carbonSheet.clear();
			this.carbonSheet.maintainProportion = false;
			this.carbonSheet.x = floorplan.carbonSheet['x'];
			this.carbonSheet.y = floorplan.carbonSheet['y'];
			this.carbonSheet.transparency = floorplan.carbonSheet['transparency'];
			this.carbonSheet.anchorX = floorplan.carbonSheet['anchorX'];
			this.carbonSheet.anchorY = floorplan.carbonSheet['anchorY'];
			this.carbonSheet.width = floorplan.carbonSheet['width'];
			this.carbonSheet.height = floorplan.carbonSheet['height'];
			this.carbonSheet.url = floorplan.carbonSheet['url'];
			this.carbonSheet.maintainProportion = true;
		}
		this.dispatchEvent({type: EVENT_LOADED, item: this});
	}

	/**
	 * Build corners, walls and room metadata from a validated document.
	 *
	 * Split out of `loadFloorplan` in A2 only so that the reset, the build and the
	 * carbon sheet read as the three steps they are, with the batch around the
	 * first two. The body is unchanged.
	 *
	 * @param {Object} floorplan
	 * @param {Object} corners Filled in with the corners this builds, by file id.
	 */
	_buildFloorplan(floorplan, corners)
	{
		// How to read the corner coordinates, decided by the file rather than by
		// its version number - the same rule as the wall records below.
		//
		// A stamped file says what unit it is in and this build only writes one,
		// so `toCentimetres` is the identity for everything 2.0.0 and later. An
		// unstamped file is 0.0.2a or older, where coordinates were written in
		// whatever display unit was active at save time and the only guess
		// available is the unit active now. That guess is wrong whenever the two
		// differ, it always was, and no amount of care here can recover
		// information the file does not contain - which is the entire reason the
		// stamp exists. tests/fixtures/v1/ has the corpus, metres-room included.
		var toCentimetres = cornerReader(floorplan.units);

		for (var id in floorplan.corners)
		{
			var corner = floorplan.corners[id];
			corners[id] = this.newCorner(toCentimetres(corner.x), toCentimetres(corner.y), id);
			if(corner.elevation)
			{
				corners[id].elevation = toCentimetres(corner.elevation);
			}
		}
		var scope = this;
		// Identity is reconstructed here rather than assigned in the constructor
		// (RM-004 B2). Derived from the corner pair the file already carries, so a
		// file written before this change loads with the same ids as one written
		// after, and nothing was added to the save format. Computed for the whole
		// run up front because the ordinal that disambiguates two walls on one
		// pair depends on the records around it, not on the record alone.
		var wallIds = deriveWallIds(floorplan.walls);
		floorplan.walls.forEach((wall, wallIndex) => {
			var newWall = scope.newWall(corners[wall.corner1], corners[wall.corner2], undefined, undefined, wallIds[wallIndex]);
			
			if (wall.frontTexture)
			{
				newWall.frontTexture = wall.frontTexture;
			}
			if (wall.backTexture)
			{
				newWall.backTexture = wall.backTexture;
			}
			// Control points and wallType arrived with save format 0.0.2a. Whether
			// a given file carries them is a property of THAT FILE, so ask the
			// record rather than the version stamp.
			//
			// This used to read
			// `if (Version.isVersionHigherThan(floorplan.version, '0.0.2a'))`,
			// and that call is the reason the save format could not be versioned.
			// isVersionHigherThan compares its arguments the other way round from
			// the way its name reads - it is true when the SECOND is >= the first,
			// per component, as an AND - so the gate let 0.0.2a and anything older
			// through and rejected everything newer. Stamping a file 0.0.3, 0.1.0
			// or 1.0.0 turned every curved wall straight and dropped its control
			// points, with no error. Bumping `version` for any reason at all -
			// a unit stamp, a colour-space marker - would have silently corrupted
			// every curved design in existence.
			//
			// Reading the data directly removes the trap rather than reasoning
			// about it, and is what the gate was always a proxy for. It is also
			// strictly safer: the old form assigned `wall.a` unconditionally once
			// the version matched, so a file with a version but no control points
			// threw inside the setter.
			//
			// Behaviour is unchanged for every file that can exist. A genuine
			// pre-0.0.2a file has no `a`/`b` and no `wallType`, so both branches
			// are skipped exactly as before and the wall keeps the straight
			// defaults its constructor computed.
			if (wall.a && wall.b)
			{
				newWall.a = wall.a;
				newWall.b = wall.b;
			}
			if (wall.wallType !== undefined)
			{
				// Anything that is not exactly 'CURVED' means straight, including
				// lower-case 'curved'. Preserved: WallTypes are Symbols and this is
				// their description, so the file carries the description string.
				newWall.wallType = (wall.wallType === 'CURVED') ? WallTypes.CURVED : WallTypes.STRAIGHT;
			}
			// Additive since RM-008 E2, and absent from every file written before
			// it. Set through the setter, which is what marks the wall as carrying
			// a thickness of its own so the next save writes it back; a file
			// without the field leaves the wall on the document's default, which is
			// what it has always done.
			if (typeof wall.thickness === 'number')
			{
				newWall.thickness = wall.thickness;
			}
			// Additive since RM-008 F2, absent from every older file.
			if (typeof wall.partialHeight === 'number')
			{
				newWall.partialHeight = wall.partialHeight;
			}
		});

		// Authored entities, absent from every file written before RM-008 E3.
		//
		// After the walls, because a dimension may name a corner it is pinned to
		// and `Dimension.points()` resolves that against the live corner list -
		// which is only complete once the loop above has run. Read defensively:
		// `DesignDocument.parse` has already refused the shapes that cannot be
		// drawn, and a third-party file that carries something else here should
		// open with the rest of its design intact rather than not at all.
		if (Array.isArray(floorplan.dimensions))
		{
			var plan = this;
			floorplan.dimensions.forEach(function (record)
			{
				if (record && typeof record === 'object')
				{
					plan.dimensions.push(Dimension.fromJSON(plan, record));
				}
			});
		}
		if (Array.isArray(floorplan.annotations))
		{
			var owner = this;
			floorplan.annotations.forEach(function (record)
			{
				if (record && typeof record === 'object')
				{
					owner.annotations.push(TextAnnotation.fromJSON(owner, record));
				}
			});
		}
		if (typeof floorplan.north === 'number' && isFinite(floorplan.north))
		{
			this._north = ((floorplan.north % 360) + 360) % 360;
		}

		if ('newFloorTextures' in floorplan)
		{
			this.floorTextures = floorplan.newFloorTextures;
		}
		this.metaroomsdata = floorplan.rooms;
	}

	/**
	 * @deprecated
	 */
	/**
	 * How the plan asks for an item to change (RM-008 E1).
	 *
	 * The projection tells the 2D view what is there; this is how the view says
	 * "the user dragged that". Installed by `Model`, which owns both halves, in
	 * exactly the style `Scene.setItemLoader` already uses: the layer takes a
	 * function rather than importing the thing that does the work. Null in a
	 * document with no scene wired up - a bare `Floorplan` built by a test - and
	 * every call site checks, so the plan degrades to read-only rather than
	 * throwing.
	 *
	 * @typedef {Object} ItemCommands
	 * @property {function(string, number, number): void} move Item id, plan x, plan y, in cm.
	 * @property {function(string, number): void} rotate Item id, radians.
	 * @property {function(string): void} commit Item id: the gesture is over, record it.
	 *
	 * @param {?ItemCommands} commands
	 */
	setItemCommands(commands)
	{
		this._itemCommands = commands || null;
	}

	/**
	 * What the plan may do to an item, or null if nothing is wired up.
	 * @returns {?Object}
	 */
	get itemCommands()
	{
		return this._itemCommands || null;
	}

	/**
	 * Replace the plan's view of the furniture (RM-008 E1).
	 *
	 * Called by `Model` whenever the item set or an item's placement changes. The
	 * event is its own rather than EVENT_UPDATED, because EVENT_UPDATED means the
	 * wall graph moved and drives a full 3D rebuild and a camera recentre - which
	 * is the right cost for dragging a wall and an absurd one for dragging a
	 * chair.
	 *
	 * The array is stored as given, not copied. `Model` builds a fresh one on
	 * every call (`projectItems` maps and sorts), so there is nothing shared to
	 * defend against, and copying it per item move would be work done to protect
	 * against a caller that does not exist.
	 *
	 * @param {Array<import('./plan_projection.js').ItemFootprint>} projection
	 * @emits {EVENT_ITEMS_PROJECTED}
	 */
	/**
	 * Hand the plan the storey below it, to draw faintly (RM-010 G1).
	 *
	 * No event: this only ever changes alongside something that already redraws -
	 * a level switch, a level's plan being edited, a document load - and a
	 * dispatch here would be a second redraw for the same cause.
	 *
	 * @param {?import('./level_projection.js').GhostPlan} plan
	 * @returns {void}
	 */
	setGhostPlan(plan)
	{
		this.ghostPlan = plan || null;
	}

	/**
	 * Hand this storey the holes the storey below punches in it (RM-010 G2).
	 *
	 * Plain polygons in plan space, for the same reason the ghost is: this class
	 * has no path to a `Model` and must not gain one, and a stairwell is a fact
	 * about a flight of stairs one floor down. Each room takes the ones over it
	 * and clamps them to itself.
	 *
	 * The dispatch is what makes the 3D floor re-cut: `Floorplan3D` reconciles on
	 * a change set, and a room whose holes moved is a room whose floor is stale.
	 *
	 * @param {Array<Array<{x: number, y: number}>>} openings
	 * @returns {void}
	 */
	setFloorOpenings(openings)
	{
		var list = openings || [];
		var signature = JSON.stringify(list);
		if (signature === this._floorOpeningSignature)
		{
			return;
		}
		this._floorOpeningSignature = signature;
		this._floorOpenings = list;
		// Only when a room's holes actually moved. Handing every room an empty list
		// it already had would otherwise dispatch a change set on every load, and
		// `tests/change-projection.test.js` pins that a document open is one 'load'
		// and not a 'load' followed by an 'edit' - which is what it caught.
		var moved = false;
		this.rooms.forEach(function (room)
		{
			moved = room.setFloorOpenings(list) || moved;
		});
		if (moved)
		{
			this.update(false);
		}
	}

	setItemProjection(projection)
	{
		this.itemProjection = projection || [];
		this.dispatchEvent({type: EVENT_ITEMS_PROJECTED, item: this, projection: this.itemProjection});
	}

	/**
	 * Which footprint carries an id, or null (RM-008 E1).
	 *
	 * The plan hit-tests to an id and the application resolves that id to an item;
	 * this is the lookup in between, kept here so both the view and any embedder
	 * ask one question of one object.
	 *
	 * @param {string} id
	 * @returns {?import('./plan_projection.js').ItemFootprint}
	 */
	footprintById(id)
	{
		if (!id)
		{
			return null;
		}
		for (var i = 0; i < this.itemProjection.length; i++)
		{
			if (this.itemProjection[i].id === id)
			{
				return this.itemProjection[i];
			}
		}
		return null;
	}

	/**
	 * Announce that a dimension, a label or the north bearing changed (RM-008 E3).
	 *
	 * Called by the annotation objects themselves - they hold a back-reference to
	 * this plan and no listener list of their own, because nothing but this array
	 * holds one. See `model/annotation.js`.
	 *
	 * @emits {EVENT_ANNOTATIONS_CHANGED}
	 * @returns {void}
	 */
	/**
	 * Keep a room's saved metadata in step with the room (RM-008 E3).
	 *
	 * Was two branches inline in `update()` that wrote `name` and nothing else.
	 * Extracted because a second attribute arrived and the interesting rule is
	 * not the writing, it is which keys appear: `type` is written only when the
	 * room has one, so a design where nobody typed a room type produces exactly
	 * the metadata it produced before this sprint - and a room whose type is
	 * cleared loses the key rather than carrying an empty string forever.
	 *
	 * That is the same conditional-write rule as `dimensions`, `annotations` and
	 * per-wall thickness, applied one level down inside a record that is itself
	 * written whole.
	 *
	 * @param {Room} room
	 * @returns {void}
	 */
	_writeRoomMeta(room)
	{
		if (!this.metaroomsdata)
		{
			return;
		}
		var key = room.roomByCornersId;
		if (!this.metaroomsdata[key])
		{
			this.metaroomsdata[key] = {};
		}
		this.metaroomsdata[key]['name'] = room.name;
		if (room.type)
		{
			this.metaroomsdata[key]['type'] = room.type;
		}
		else
		{
			delete this.metaroomsdata[key]['type'];
		}
	}

	annotationsChanged()
	{
		this.dispatchEvent({type: EVENT_ANNOTATIONS_CHANGED, item: this});
	}

	/**
	 * Measure between two points (RM-008 E3).
	 *
	 * Refuses a zero-length dimension rather than drawing one: two coincident
	 * points give no direction to offset the line along, so the result is a
	 * measurement of 0 drawn on top of itself, which looks like the tool failed.
	 * The same judgement `newRoomFromRectangle` makes about a degenerate
	 * rectangle, and the caller gets null to say so.
	 *
	 * @param {number} ax Centimetres.
	 * @param {number} ay
	 * @param {number} bx
	 * @param {number} by
	 * @param {Object} [options] See {@link Dimension}.
	 * @returns {?Dimension}
	 */
	newDimension(ax, ay, bx, by, options)
	{
		if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by))
		{
			return null;
		}
		if (Math.abs(bx - ax) < 1e-6 && Math.abs(by - ay) < 1e-6)
		{
			return null;
		}
		var dimension = new Dimension(this, ax, ay, bx, by, options);
		this.dimensions.push(dimension);
		this.annotationsChanged();
		return dimension;
	}

	/**
	 * @param {Dimension} dimension
	 * @returns {boolean} Whether it was there to remove.
	 */
	removeDimension(dimension)
	{
		var at = this.dimensions.indexOf(dimension);
		if (at < 0)
		{
			return false;
		}
		this.dimensions.splice(at, 1);
		this.annotationsChanged();
		return true;
	}

	/**
	 * Put a piece of text on the plan (RM-008 E3).
	 *
	 * @param {number} x Centimetres.
	 * @param {number} y
	 * @param {string} [text]
	 * @param {Object} [options] See {@link TextAnnotation}.
	 * @returns {?TextAnnotation}
	 */
	newAnnotation(x, y, text, options)
	{
		if (!isFinite(x) || !isFinite(y))
		{
			return null;
		}
		var annotation = new TextAnnotation(this, x, y, text, options);
		this.annotations.push(annotation);
		this.annotationsChanged();
		return annotation;
	}

	/**
	 * @param {TextAnnotation} annotation
	 * @returns {boolean} Whether it was there to remove.
	 */
	removeAnnotation(annotation)
	{
		var at = this.annotations.indexOf(annotation);
		if (at < 0)
		{
			return false;
		}
		this.annotations.splice(at, 1);
		this.annotationsChanged();
		return true;
	}

	/**
	 * Either kind of annotation, by the id in its record (RM-008 E3).
	 *
	 * One lookup for both collections because a selection is one thing: the
	 * application asks "what is this id" and does not want to know which array it
	 * came out of.
	 *
	 * @param {string} id
	 * @returns {?(Dimension|TextAnnotation)}
	 */
	annotationById(id)
	{
		if (!id)
		{
			return null;
		}
		var i;
		for (i = 0; i < this.dimensions.length; i++)
		{
			if (this.dimensions[i].id === id)
			{
				return this.dimensions[i];
			}
		}
		for (i = 0; i < this.annotations.length; i++)
		{
			if (this.annotations[i].id === id)
			{
				return this.annotations[i];
			}
		}
		return null;
	}

	/**
	 * Which way is north, in degrees clockwise from up (RM-008 E3).
	 * @returns {number}
	 */
	get north()
	{
		return this._north;
	}

	/**
	 * Normalised into [0, 360) so the arrow, the field and the file always show
	 * the same number - otherwise -90 and 270 are the same bearing written two
	 * ways, and a round trip through a text field turns one into the other.
	 *
	 * @param {number} degrees
	 */
	set north(degrees)
	{
		if (typeof degrees !== 'number' || !isFinite(degrees))
		{
			return;
		}
		var next = ((degrees % 360) + 360) % 360;
		if (next === this._north)
		{
			return;
		}
		this._north = next;
		this.annotationsChanged();
	}

	/**
	 * The dimension line nearest a point, or null (RM-008 E3).
	 *
	 * Distance to the *dimension line* - the offset one that is drawn - not to
	 * the points being measured, because that line is what a person sees and
	 * clicks. The witness lines are deliberately not pickable: they are thin, they
	 * run through the geometry being measured, and making them targets would take
	 * clicks away from the walls underneath.
	 *
	 * @param {number} x Centimetres.
	 * @param {number} y
	 * @param {number} [tolerance] Centimetres.
	 * @returns {?Dimension}
	 */
	overlappedDimension(x, y, tolerance)
	{
		var limit = (tolerance === undefined || tolerance === null) ? cornerTolerance : tolerance;
		for (var i = this.dimensions.length - 1; i >= 0; i--)
		{
			var line = dimensionLine(this.dimensions[i]);
			if (!line)
			{
				continue;
			}
			if (Utils.pointDistanceFromLine(new Vector2(x, y), new Vector2(line.ax, line.ay), new Vector2(line.bx, line.by)) <= limit)
			{
				return this.dimensions[i];
			}
		}
		return null;
	}

	/**
	 * The text label nearest a point, or null (RM-008 E3).
	 *
	 * A radius rather than the text's bounding box, because the model layer has
	 * no font metrics and asking it to measure text would put a canvas inside the
	 * plain-data layer. The view draws a marker at the anchor for exactly this
	 * reason: what you aim at is the thing that is picked.
	 *
	 * @param {number} x Centimetres.
	 * @param {number} y
	 * @param {number} [tolerance] Centimetres.
	 * @returns {?TextAnnotation}
	 */
	overlappedAnnotation(x, y, tolerance)
	{
		var limit = (tolerance === undefined || tolerance === null) ? cornerTolerance : tolerance;
		for (var i = this.annotations.length - 1; i >= 0; i--)
		{
			var annotation = this.annotations[i];
			var dx = annotation.x - x;
			var dy = annotation.y - y;
			if (Math.sqrt(dx * dx + dy * dy) <= limit)
			{
				return annotation;
			}
		}
		return null;
	}

	getFloorTexture(uuid)
	{
		if (uuid in this.floorTextures)
		{
			return this.floorTextures[uuid];
		}
		return null;
	}

	/**
	 * @deprecated
	 */
	setFloorTexture(uuid, url, scale)
	{
		this.floorTextures[uuid] = {url: url,scale: scale};
	}

	/** clear out obsolete floor textures */
	/**
	 * @deprecated
	 */
	updateFloorTextures()
	{
		var uuids = Utils.map(this.rooms, function (room){return room.getUuid();});
		for (var uuid in this.floorTextures)
		{
			if (!Utils.hasValue(uuids, uuid))
			{
				delete this.floorTextures[uuid];
			}
		}
	}

	/**
	 * Resets the floorplan data to empty
	 * 
	 * @return {void}
	 */
	reset()
	{
		// The authored entities go first, and unconditionally (RM-008 E3).
		//
		// They hang off nothing in the graph, so nothing below would remove them:
		// before this, opening a second design would have kept the first one's
		// dimensions and notes floating over it. `north` goes back to up for the
		// same reason - it describes the building being replaced.
		this.dimensions = [];
		this.annotations = [];
		this._north = 0;

		var tmpCorners = this.corners.slice(0);
		var tmpWalls = this.walls.slice(0);
		tmpCorners.forEach((corner) => {
			corner.remove();
		});
		tmpWalls.forEach((wall) => {
			wall.remove();
		});

		// Release before the arrays are dropped (RM-003 A0).
		//
		// The two assignments below are what makes this necessary. Removing the
		// walls above runs update() once per wall, and the last of those rebuilds
		// the rooms and half edges from whatever corners remain - so there is
		// always a live set at this point, and clearing the arrays is the moment it
		// stops being reachable. This is a teardown boundary, and reset() is the
		// first thing loadFloorplan() calls, so it is on the load path too.
		this.rooms.forEach((room) => {room.dispose();});
		this.walls.forEach((wall) => {
			if (wall.frontEdge)
			{
				wall.frontEdge.dispose();
			}
			if (wall.backEdge)
			{
				wall.backEdge.dispose();
			}
		});
		this.rooms = [];
		this.corners = [];
		this.walls = [];
	}

	/**
	 * @param {{item: Room, newname: string}} e The rename, as Room dispatches it.
	 *        The tag said `event` and the parameter is `e`, which is a TS8024 -
	 *        the name was on its own line, so nothing had ever read them together.
	 * @listens {EVENT_ROOM_NAME_CHANGED} When a room name is changed and
	 *          updates to metaroomdata
	 */
	roomNameChanged(e)
	{
			if(this.metaroomsdata)
			{
					this.metaroomsdata[e.item.roomByCornersId] = e.newname;
			}
	}

	/**
	 * Update the floorplan with new rooms, remove old rooms etc.
	 */
	/**
	 * Defer the room re-derivation until `endBatch()` (RM-003 A1).
	 *
	 * Nests, so a caller need not know whether it is already inside one. Always
	 * pair with `endBatch()` in a `finally`: a batch left open silently stops the
	 * plan updating.
	 */
	/**
	 * @param {string} [reason] Why this batch is happening - one of
	 * `CHANGE_REASONS`. Only the outermost batch's reason is used; a nested
	 * `beginBatch()` inside a load is still part of the load.
	 */
	beginBatch(reason)
	{
		if (this._batchDepth === 0)
		{
			this._batchReason = reason || null;
		}
		this._batchDepth += 1;
	}

	/**
	 * Close a batch and perform the update it deferred, if any.
	 *
	 * The deferred update is the union of what was asked for: if any call during
	 * the batch wanted a full room re-derivation, the one at the end does it, and
	 * every corner any call named has its angles updated. So batching cannot do
	 * less work than not batching - only the same work, once.
	 */
	endBatch()
	{
		if (this._batchDepth === 0)
		{
			return;
		}
		this._batchDepth -= 1;
		if (this._batchDepth > 0)
		{
			return;
		}
		var reason = this._batchReason;
		this._batchReason = null;
		if (this._pendingUpdate === null)
		{
			return;
		}
		var pending = this._pendingUpdate;
		this._pendingUpdate = null;
		this.update(pending.rooms, pending.corners.length ? pending.corners : null, reason);
	}

	/**
	 * @param {boolean} [updateroomconfiguration] Re-derive the rooms. A topology
	 * change; false is a geometry change.
	 * @param {?Corner[]} [updatecorners] The corners whose angles moved.
	 * @param {?string} [reason] Why - one of `CHANGE_REASONS`. Defaults to the
	 * open batch's reason, then to `REASON_EDIT`.
	 */
	update(updateroomconfiguration = true, updatecorners=null, reason=null)//Should include for , updatewalls=null, updaterooms=null
	{
		var effectiveReason = reason || this._batchReason || REASON_EDIT;
		if (this._batchDepth > 0)
		{
			// Record and return. The union rather than the last call's arguments,
			// because a batch that contained one full update and one partial must
			// still perform the full one.
			if (this._pendingUpdate === null)
			{
				/** @type {{rooms: boolean, corners: Corner[]}} */
				var started = {rooms: false, corners: []};
				this._pendingUpdate = started;
			}
			this._pendingUpdate.rooms = this._pendingUpdate.rooms || updateroomconfiguration;
			if (updatecorners != null)
			{
				this._pendingUpdate.corners = this._pendingUpdate.corners.concat(updatecorners);
			}
			return;
		}

		if(updatecorners!=null)
		{
			updatecorners.forEach((corner)=>{
				corner.updateAngles();
			});
		} 
		
		if(!updateroomconfiguration)
		{
			// A geometry change: entities that already exist moved. The room set is
			// the same set of OBJECTS, which is what lets the 3D projection redraw
			// the handful of walls the moved corners touch instead of rebuilding the
			// scene (RM-003 A2). The corner list is the payload because the corners
			// are what the caller knew had moved - see newCorner()'s EVENT_MOVED
			// listener, which passes the corner and its neighbours.
			this._emitChanges(new ChangeSet(effectiveReason).add(CHANGE_GEOMETRY, updatecorners));
			return;
		}


		var scope = this;

		// What the rooms were, before they stop existing (RM-003 A3).
		//
		// Captured here rather than after the rebuild because the rebuild is what
		// destroys them, and the successor rooms have to be able to ask which room
		// each of them continues. Only the identity and the corner ids are needed,
		// so this is three strings per room and not a snapshot.
		var previousRooms = this.rooms.map(function (room)
		{
			return {
				id: room.id,
				nameKey: room.roomByCornersId,
				textureKey: room.getUuid(),
				cornerIds: room.corners.map(function (corner) {return corner.id;}),
			};
		});

		// Release before replacing (RM-003 A0).
		//
		// This is the largest single leak the hardening review measured: every call
		// to update() built two meshes per room and one per half edge, and dropped
		// the previous set on the floor - six geometries and six materials per call
		// on a single square room, with the plan unchanged. Opening a four-wall
		// design dispatches EVENT_UPDATED twenty-five times, so a file open
		// abandoned roughly 150 of each before the first frame was drawn.
		//
		// The two loops are separate because the ownership is: a Room owns its
		// floor and roof planes, and a Wall owns its two half edges - the HalfEdge
		// constructor writes itself onto `wall.frontEdge`/`backEdge`, which is what
		// makes the wall the thing that can still reach it. That release therefore
		// has to happen HERE, immediately before resetFrontBack() nulls the
		// pointers; a line later and the edges are unreachable.
		//
		// Both dispose() calls are idempotent, so a half edge reachable from both a
		// room's edge chain and its wall is disposed once.
		this.rooms.forEach((room) => {room.dispose();});
		this.walls.forEach((wall) => {
			if (wall.frontEdge)
			{
				wall.frontEdge.dispose();
			}
			if (wall.backEdge)
			{
				wall.backEdge.dispose();
			}
			wall.resetFrontBack();
		});


		var roomCorners = this.findRooms(this.corners);
		this.rooms = [];


		this.corners.forEach((corner)=>{
			corner.clearAttachedRooms();
		});

		roomCorners.forEach((corners) =>
		{
			var room = new Room(scope, corners);
			room.updateArea();
			scope.rooms.push(room);

			room.addEventListener(EVENT_ROOM_NAME_CHANGED, (e)=>{scope.roomNameChanged(e);});
			room.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, function(o){
				var room = o.item;
				scope.dispatchEvent(o);
				scope._writeRoomMeta(room);
			});
		});

		// Carry the identities, and the two derived keys, across the rebuild.
		//
		// This is A3's headline and it has to happen HERE - after every room
		// exists, so the matcher sees the whole set and can match one to one, and
		// before any name is read back, so the lookup below finds the entry under
		// the key the successor now has.
		this.carryRoomIdentity(previousRooms);

		// The holes the storey below punches in this one (RM-010 G2).
		//
		// Re-applied here because `update(true)` constructs a NEW `Room` for every
		// room - room identity is derived from its corners rather than assigned,
		// which is finding H-5 - so the openings a room was carrying are on an
		// object that no longer exists. Without this, drawing one wall anywhere on
		// the plan silently filled in every stairwell. Found by placing a flight
		// in a real page and calling `update()` afterwards, which is what a load
		// does.
		//
		// Applied directly rather than through `setFloorOpenings`, which would
		// call `update()` again from inside `update()`.
		if (this._floorOpenings.length)
		{
			this.rooms.forEach((room) => {room.setFloorOpenings(scope._floorOpenings);});
		}

		this.rooms.forEach(function (room)
		{
			if(scope.metaroomsdata)
			{
				var meta = scope.metaroomsdata[room.roomByCornersId];
				if(meta)
				{
					// Both values are read out BEFORE either is assigned, and that
					// ordering is load-bearing. Each setter announces itself, and the
					// listener installed above writes the room straight back into this
					// record - so assigning the name first rewrites the record from a
					// room whose type is still empty, deleting the type that was about
					// to be read. Cost one debugging round; the record is not a safe
					// place to read from once you have started writing to the room.
					var savedName = meta['name'];
					// Additive since RM-008 E3, so absent from every older file and
					// from every room nobody typed a type into.
					var savedType = meta['type'];
					room.name = savedName;
					if (savedType !== undefined)
					{
						room.type = savedType;
					}
				}
			}
		});
		this.assignOrphanEdges();
		this.updateFloorTextures();
		// A topology change, and the rooms it carries are the set as re-derived -
		// every one of them a new object, because that is what this method does.
		// Consumers reconcile against it rather than diffing it, which is why the
		// payload is the whole set rather than a delta: until A3 gives an entity an
		// identity that survives recomputation, there is no delta to state.
		//
		// A corner list means the caller asked for both at once: the angles moved
		// AND the rooms were re-derived. Both kinds go out on one ChangeSet, which
		// is the point of a set.
		var changes = new ChangeSet(effectiveReason).add(CHANGE_TOPOLOGY, this.rooms);
		if (updatecorners != null)
		{
			changes.add(CHANGE_GEOMETRY, updatecorners);
		}
		this._emitChanges(changes);
	}

	/**
	 * Give each re-derived room the identity of the room it continues (RM-003 A3).
	 *
	 * ## What this fixes
	 *
	 * A `Room` object does not survive `update()`; a new one is built for every
	 * cycle found, every time. So before this, a room was known only by two keys
	 * derived from its corners - `roomByCornersId` for its name and `getUuid()`
	 * for its floor texture - and both change the moment the corner set does.
	 * Drawing a wall through one side of a named, textured room took it from four
	 * corners to five and lost both. That is finding H-5, and splitting a wall is
	 * an ordinary drawing action.
	 *
	 * ## What it does
	 *
	 * `matchRooms` decides which successor continues which predecessor, by corner
	 * overlap, one to one - see `model/room_matcher.js` for the rule and why it
	 * has a floor under it. Each matched successor then takes the predecessor's
	 * `id`, and the two metadata maps are rekeyed from the predecessor's keys to
	 * the successor's.
	 *
	 * ## Why the maps are rekeyed rather than keyed by the id
	 *
	 * Keying them by the assigned id would be tidier in memory and is what a
	 * reader expects to find here. It was not done, for two reasons that only
	 * became clear against the code. The maps are what `saveFloorplan()` writes
	 * and what `loadFloorplan()` adopts, both **by reference**, so re-keying them
	 * in memory means translating at the file boundary in each direction - and the
	 * id is deliberately not persisted, because a file identifies a room by its
	 * corners and that is a description another build can also read. Worse, an
	 * entry under an id has no way back: today a room you delete leaves its name
	 * behind under its corner key, so drawing the room again brings the name back.
	 * Under an assigned id the id dies with the room and the name is unreachable.
	 *
	 * What the two keys needed was not to become one key, but to stop being able
	 * to disagree. They are moved together, by one rule, in one place, which is
	 * this method.
	 *
	 * @param {Array<{id: string, nameKey: string, textureKey: string, cornerIds: Array<string>}>} previousRooms
	 */
	carryRoomIdentity(previousRooms)
	{
		var scope = this;
		if (!previousRooms.length)
		{
			return;
		}
		var matched = matchRooms(
			previousRooms.map(function (room) {return room.cornerIds;}),
			this.rooms.map(function (room) {return room.corners.map(function (corner) {return corner.id;});}));

		var nameMoves = [];
		var textureMoves = [];
		matched.forEach(function (fromIndex, toIndex)
		{
			var previous = previousRooms[fromIndex];
			var current = scope.rooms[toIndex];
			current.id = previous.id;
			if (previous.nameKey !== current.roomByCornersId)
			{
				nameMoves.push({from: previous.nameKey, to: current.roomByCornersId});
			}
			if (previous.textureKey !== current.getUuid())
			{
				textureMoves.push({from: previous.textureKey, to: current.getUuid()});
			}
		});
		rekeyInPlace(this.metaroomsdata, nameMoves);
		rekeyInPlace(this.floorTextures, textureMoves);
	}

	/**
	 * Announce a change, and derive the legacy event from it (RM-003 A2).
	 *
	 * The single place either event is dispatched, and the reason the adapter is
	 * an adapter rather than a parallel mechanism: `EVENT_UPDATED` cannot fire
	 * without a ChangeSet describing it, so the two can never disagree about
	 * whether something happened. It fires at exactly the moments it fired before
	 * and carries exactly what it carried before, plus `.changes` - so a consumer
	 * can adopt the typed payload without changing which event it listens to, and
	 * one that never adopts it notices nothing.
	 *
	 * @param {ChangeSet} changes
	 */
	_emitChanges(changes)
	{
		if (changes.isEmpty())
		{
			return;
		}
		var scope = this;
		changes.kinds().forEach(function (kind) {scope._changeCounts[kind] += 1;});
		this._changeDispatches += 1;
		this.dispatchEvent({type: EVENT_CHANGESET, item: this, changes: changes});
		this.dispatchEvent({type: EVENT_UPDATED, item: this, changes: changes});
	}

	/**
	 * How many ChangeSets this plan has dispatched, per kind (RM-003 A2, M-4).
	 *
	 * `dispatches` is the number of announcements; the per-kind counts are how
	 * many of those carried each kind, so they sum to more than `dispatches` when
	 * a single change was both topological and geometric.
	 *
	 * @returns {{dispatches: number} & import('../core/change_set.js').ChangeCounts}
	 */
	changeStats()
	{
		// Spread rather than Object.assign (RM-005 C2). Assign's return type is an
		// intersection with an index signature, which TypeScript will not accept as
		// the concrete record this method documents; a spread produces the record.
		return {dispatches: this._changeDispatches, ...this._changeCounts};
	}

	/**
	 * Returns the center of the floorplan in the y plane
	 *
	 * @return {Vector3} center
	 * @see https://threejs.org/docs/#api/en/math/Vector3
	 *
	 * The tag said `Vector2` and the link pointed at Vector2 (RM-005 C2).
	 * `getDimensions` returns a `Vector3` in all three of its branches, and
	 * `FloorItem` reads `.z` off this - which type-checked as an error and works
	 * perfectly at runtime, because the documentation was the only thing wrong.
	 */
	getCenter()
	{
		return this.getDimensions(true);
	}

	/**
	 * Returns the bounding volume of the full floorplan
	 * 
	 * @return {Vector3} size
	 * @see https://threejs.org/docs/#api/en/math/Vector3
	 */
	getSize()
	{
		return this.getDimensions(false);
	}

	/**
	 * Returns the bounding size or the center location of the full floorplan
	 * 
	 * @param {boolean}
	 *            center If true return the center else the size
	 * @return {Vector3} size
	 * @see https://threejs.org/docs/#api/en/math/Vector3
	 */
	getDimensions(center)
	{
		center = center || false; // otherwise, get size

		var xMin = Infinity;
		var xMax = -Infinity;
		var zMin = Infinity;
		var zMax = -Infinity;
		this.corners.forEach((corner) => {
			if (corner.x < xMin) xMin = corner.x;
			if (corner.x > xMax) xMax = corner.x;
			if (corner.y < zMin) zMin = corner.y;
			if (corner.y > zMax) zMax = corner.y;
		});
		var ret;
		if (xMin == Infinity || xMax == -Infinity || zMin == Infinity || zMax == -Infinity)
		{
			ret = new Vector3();
		}
		else
		{
			if (center)
			{
				// center
				ret = new Vector3((xMin + xMax) * 0.5, 0, (zMin + zMax) * 0.5);
			}
			else
			{
				// size
				ret = new Vector3((xMax - xMin), 0, (zMax - zMin));
			}
		}
		return ret;
	}

	/**
	 * An internal cleanup method
	 */
	assignOrphanEdges()
	{
		// kinda hacky
		// find orphaned wall segments (i.e. not part of rooms) and
		// give them edges
		var orphanWalls = [];
		this.walls.forEach((wall) => {
			if (!wall.backEdge && !wall.frontEdge)
			{
				wall.orphan = true;
				var back = new HalfEdge(null, wall, false);
				var front = new HalfEdge(null, wall, true);
				back.generatePlane();
				front.generatePlane();
				orphanWalls.push(wall);
			}
		});
	}

	/**
	 * Find the "rooms" in our planar straight-line graph. Rooms are set of the
	 * smallest (by area) possible cycles in this graph.
	 * 
	 * `Corners` was a typo for `Corner`, and the tag was malformed besides - the
	 * name sat on one line and the parameter on the next, so it documented
	 * nothing and resolved to nothing (RM-005 C2). Two @param tags for one
	 * parameter, only one of which had a type.
	 *
	 * @param {Corner[]} corners The corners of the floorplan.
	 * @returns {Corner[][]} The rooms, each as an array of corners.
	 */
	findRooms(corners)
	{

		function _calculateTheta(previousCorner, currentCorner, nextCorner)
		{
			var theta = Utils.angle2pi(new Vector2(previousCorner.x - currentCorner.x, previousCorner.y - currentCorner.y), new Vector2(nextCorner.x - currentCorner.x, nextCorner.y - currentCorner.y));
			return theta;
		}

		function _removeDuplicateRooms(roomArray)
		{
			var results = [];
			var lookup = {};
			var hashFunc = function (corner)
			{
				return corner.id;
			};
			var sep = '-';
			for (var i = 0; i < roomArray.length; i++)
			{
				// rooms are cycles, shift it around to check uniqueness
				var add = true;
				var room = roomArray[i];
				// Hoisted out of the loop that assigns it (RM-005 C2). `var` is
				// function-scoped, so reading it below always worked - except for a
				// room with no corners, where the loop never runs and the write
				// below would have keyed `lookup` under the string "undefined".
				/** @type {?string} */
				var str = null;
				for (var j = 0; j < room.length; j++)
				{
					var roomShift = Utils.cycle(room, j);
					str = Utils.map(roomShift, hashFunc).join(sep);
					// Object.prototype.hasOwnProperty.call, not obj.hasOwnProperty. Identical for a plain object and correct for one that is not - a key literally named "hasOwnProperty" shadows the method and turns the guard into a TypeError.
					if (Object.prototype.hasOwnProperty.call(lookup, str))
					{
						add = false;
					}
				}
				if (add && str !== null)
				{
					results.push(roomArray[i]);
					lookup[str] = true;
				}
			}
			return results;
		}

		/**
		 * An internal method to find rooms based on corners and their
		 * connectivities
		 */
		function _findTightestCycle(firstCorner, secondCorner)
		{
			var stack = [];
			var next = {corner: secondCorner,previousCorners: [firstCorner]};
			var visited = {};
			visited[firstCorner.id] = true;

			while (next)
			{
				// update previous corners, current corner, and visited corners
				var currentCorner = next.corner;
				visited[currentCorner.id] = true;

				// did we make it back to the startCorner?
				if (next.corner === firstCorner && currentCorner !== secondCorner)
				{
					return next.previousCorners;
				}

				var addToStack = [];
				var adjacentCorners = next.corner.adjacentCorners();
				for (var i = 0; i < adjacentCorners.length; i++)
				{
					var nextCorner = adjacentCorners[i];

					// is this where we came from?
					// give an exception if its the first corner and we aren't
					// at the second corner
					if (nextCorner.id in visited && !(nextCorner === firstCorner && currentCorner !== secondCorner))
					{
						continue;
					}

					// nope, throw it on the queue
					addToStack.push(nextCorner);
				}

				var previousCorners = next.previousCorners.slice(0);
				previousCorners.push(currentCorner);
				if (addToStack.length > 1)
				{
					// visit the ones with smallest theta first
					var previousCorner = next.previousCorners[next.previousCorners.length - 1];
					addToStack.sort(function (a, b){return (_calculateTheta(previousCorner, currentCorner, b) - _calculateTheta(previousCorner, currentCorner, a));});
				}

				if (addToStack.length > 0)
				{
					// add to the stack
					addToStack.forEach((corner) => {
						stack.push({ corner: corner, previousCorners: previousCorners});
					});
				}

				// pop off the next one
				next = stack.pop();
			}
			return [];
		}

		// find tightest loops, for each corner, for each adjacent
		//
		// Carried a TODO reading "optimize this, only check corners with > 2
		// adjacents, or isolated cycles". Both suggestions are sound and neither
		// is free: this walk is what decides which loops become ROOMS, so a
		// corner skipped here is a room that stops existing. Any narrowing needs
		// the room-detection fixtures as its gate, and a measurement first -
		// nothing has ever established that this loop is slow on a real
		// floorplan, only that it looks quadratic.
		var loops = [];

		corners.forEach((firstCorner) => {
			firstCorner.adjacentCorners().forEach((secondCorner) => {
				loops.push(_findTightestCycle(firstCorner, secondCorner));
			});
		});

		// remove duplicates
		var uniqueLoops = _removeDuplicateRooms(loops);
		// remove CW loops
		var uniqueCCWLoops = Utils.removeIf(uniqueLoops, Utils.isClockwise);
		return uniqueCCWLoops;
	}
}
