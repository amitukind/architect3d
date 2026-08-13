import {EVENT_UPDATED, EVENT_LOADED, EVENT_NEW, EVENT_DELETED, EVENT_ROOM_NAME_CHANGED} from '../core/events.js';
import {EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_WALL_ATTRIBUTES_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED, EVENT_MOVED} from '../core/events.js';
import {EventDispatcher, Vector2, Vector3} from 'three';
import {Utils} from '../core/utils.js';
import {Dimensioning} from '../core/dimensioning.js';
import {WallTypes} from '../core/constants.js';
import {Version} from '../core/version.js';
import {cornerTolerance} from '../core/configuration.js';


import {HalfEdge} from './half_edge.js';
import {Corner} from './corner.js';
import {Wall} from './wall.js';
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
	constructor()
	{
		super();
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
	 * @see <https://threejs.org/docs/#api/en/objects/Mesh>
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
	 * @see <https://threejs.org/docs/#api/en/objects/Mesh>
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
	 * @see <https://threejs.org/docs/#api/en/objects/Mesh>
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
//		for( i=0;i<this.corners.length;i++)
//		{
//			var aCorner = this.corners[i];
//			if(aCorner)
//			{
//				aCorner.relativeMove(0, 0);
//				aCorner.snapToAxis(25);
//			}
//		}
//		this.update();
//		for( i=0;i<this.corners.length;i++)
//		{
//			aCorner = this.corners[i];
//			if(aCorner)
//			{
//				aCorner.relativeMove(0, 0);
//				aCorner.snapToAxis(25);
//			}
//		}
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
	newWall(start, end, a, b)
	{
		var scope = this;
		var wall = new Wall(start, end, a, b);
		
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
	 * @param {String}
	 *            id An optional id. If unspecified, the id will be created
	 *            internally.
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
//			scope.update(false);//For debug reasons
			});
		corner.addEventListener(EVENT_MOVED, function(o){
			scope.dispatchEvent(o);
			var updatecorners = o.item.adjacentCorners();
			updatecorners.push(o.item);
			scope.update(false, updatecorners);
//			scope.update(false);//For debug reasons
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
			var newtolerance = tolerance;// (tolerance+
											// ((this.walls[i].wallType ==
											// WallTypes.CURVED)*tolerance*10));
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
				// var cornerids = [];
				// room.corners.forEach((corner)=>{
				// cornerids.push(corner.id);
				// });
				// var ids = cornerids.join(',');
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
// this.corners.forEach((corner) => {
// floorplans.corners[corner.id] = {'x': corner.x,'y': corner.y};
// });

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

// this.rooms.forEach((room)=>{
// var metaroom = {};
// var cornerids = [];
// room.corners.forEach((corner)=>{
// cornerids.push(corner.id);
// });
// var ids = cornerids.join(',');
// metaroom['name'] = room.name;
// floorplans.rooms[ids] = metaroom;
// });
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
	 * @return {void}
	 * @emits {EVENT_LOADED}
	 */
	loadFloorplan(floorplan)
	{
		this.reset();		
		var corners = {};
		if (floorplan == null || !('corners' in floorplan) || !('walls' in floorplan))
		{
			return;
		}
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
		floorplan.walls.forEach((wall) => {
			var newWall = scope.newWall(corners[wall.corner1], corners[wall.corner2]);
			
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
		this.update();

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
// this.roomLoadedCallbacks.fire();
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
	update(updateroomconfiguration = true, updatecorners=null)//Should include for , updatewalls=null, updaterooms=null
	{
		if(updatecorners!=null)
		{
//			console.log('UPDATE CORNER ANGLES ::: ', updatecorners.length);
			updatecorners.forEach((corner)=>{
				corner.updateAngles();
			});
		} 
		
		if(!updateroomconfiguration)
		{
			this.dispatchEvent({type: EVENT_UPDATED, item: this});
			return;			
		}
		
//		console.log('UPDATE ROOM WITH NEW ENTRIES ::: ');
		
		var scope = this;
		this.walls.forEach((wall) => {
			wall.resetFrontBack();
		});

		// this.rooms.forEach((room)=>{room.removeEventListener(EVENT_ROOM_NAME_CHANGED,
		// scope.roomNameChanged)});

		var roomCorners = this.findRooms(this.corners);
		this.rooms = [];


		this.corners.forEach((corner)=>{
			corner.clearAttachedRooms();
//			corner.updateAngles();
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
		this.dispatchEvent({type: EVENT_UPDATED, item: this});
// console.log('TOTAL WALLS ::: ', this.walls.length);
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
					if (lookup.hasOwnProperty(str))
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
		// TODO: optimize this, only check corners with > 2 adjacents, or
		// isolated cycles
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
