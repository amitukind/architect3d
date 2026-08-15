import {EVENT_UPDATED, EVENT_LOADED, EVENT_NEW, EVENT_DELETED, EVENT_ROOM_NAME_CHANGED, EVENT_CHANGESET} from '../core/events.js';
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
		 * @type {Object<string, number>}
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
		 * The {@link CarbonSheet} that handles the background image to show in
		 * the 2D view
		 * 
		 * @property {CarbonSheet} _carbonSheet The carbonsheet instance
		 * @type {Object}
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
	 * @param {CarbonSheet}
	 *            val
	 */
	set carbonSheet(val)
	{
		this._carbonSheet = val;
	}

	/**
	 * @return {CarbonSheet} _carbonSheet reference to the instance of
	 *         {@link CarbonSheet}
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
	 * @param {Corner}
	 *            start The start corner.
	 * @param {Corner}
	 *            end The end corner.
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
	newCorner(x, y, id)
	{
		var scope = this;
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
	 * @return {Room}
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
	 * @param {Number}
	 *            x
	 * @param {Number}
	 *            y
	 * @param {Number}
	 *            tolerance
	 * @return {Corner}
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
	 * @param {Number}
	 *            x
	 * @param {Number}
	 *            y
	 * @param {Number}
	 *            tolerance
	 * @return {Corner}
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
	 * @param {Number}
	 *            x
	 * @param {Number}
	 *            y
	 * @param {Number}
	 *            tolerance
	 * @return {Wall}
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
		var floorplans = {version:Version.getTechnicalVersion(), units: SAVE_UNITS, corners: {}, walls: [], rooms: {}, wallTextures: [], floorTextures: {}, newFloorTextures: {}, carbonSheet:{}};
		var cornerIds = [];
// writing all the corners based on the corners array
// is having a bug. This is because some walls have corners
// that aren't part of the corners array anymore. This is a quick fix
// by adding the corners to the json file based on the corners in the walls

		this.walls.forEach((wall) => {
			if(wall.getStart() && wall.getEnd())
			{
				floorplans.walls.push({
					'corner1': wall.getStart().id,
					'corner2': wall.getEnd().id,
					'frontTexture': wall.frontTexture,
					'backTexture': wall.backTexture,
					'wallType': wall.wallType.description,
					'a':{x: wall.a.x, y:wall.a.y},
					'b':{x: wall.b.x, y:wall.b.y},
				});
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

		floorplans.newFloorTextures = this.floorTextures;
		return floorplans;
	}

	// Load the floorplan from a previously saved json object file
	/**
	 * @param {JSON}
	 *            floorplan
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
		});

		if ('newFloorTextures' in floorplan)
		{
			this.floorTextures = floorplan.newFloorTextures;
		}
		this.metaroomsdata = floorplan.rooms;
	}

	/**
	 * @deprecated
	 */
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
	 * @param {Object}
	 *            event
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
				this._pendingUpdate = {rooms: false, corners: []};
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
				if(scope.metaroomsdata[room.roomByCornersId])
				{
					scope.metaroomsdata[room.roomByCornersId]['name'] = room.name;
				}
				else
				{
					scope.metaroomsdata[room.roomByCornersId] = {};
					scope.metaroomsdata[room.roomByCornersId]['name'] = room.name;
				}
			});
		});

		// Carry the identities, and the two derived keys, across the rebuild.
		//
		// This is A3's headline and it has to happen HERE - after every room
		// exists, so the matcher sees the whole set and can match one to one, and
		// before any name is read back, so the lookup below finds the entry under
		// the key the successor now has.
		this.carryRoomIdentity(previousRooms);

		this.rooms.forEach(function (room)
		{
			if(scope.metaroomsdata)
			{
				if(scope.metaroomsdata[room.roomByCornersId])
				{
					room.name = scope.metaroomsdata[room.roomByCornersId]['name'];
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
	 * @returns {{dispatches: number, topology: number, geometry: number, surface: number, items: number, selection: number, view: number}}
	 */
	changeStats()
	{
		return Object.assign({dispatches: this._changeDispatches}, this._changeCounts);
	}

	/**
	 * Returns the center of the floorplan in the y plane
	 * 
	 * @return {Vector2} center
	 * @see https://threejs.org/docs/#api/en/math/Vector2
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
	 * @param corners
	 *            The corners of the floorplan.
	 * @returns The rooms, each room as an array of corners.
	 * @param {Corners[]}
	 *            corners
	 * @return {Corners[][]} loops
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
				for (var j = 0; j < room.length; j++)
				{
					var roomShift = Utils.cycle(room, j);
					var str = Utils.map(roomShift, hashFunc).join(sep);
					// Object.prototype.hasOwnProperty.call, not obj.hasOwnProperty. Identical for a plain object and correct for one that is not - a key literally named "hasOwnProperty" shadows the method and turns the guard into a TypeError.
					if (Object.prototype.hasOwnProperty.call(lookup, str))
					{
						add = false;
					}
				}
				if (add)
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
