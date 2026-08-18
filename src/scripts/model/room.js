// @ts-check
import {EVENT_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED} from '../core/events.js';
import {Region} from '../core/utils.js';
import {EventDispatcher, Vector2, Vector3, Shape, ShapeGeometry, Mesh, MeshBasicMaterial, DoubleSide, Box3} from 'three';
import {triangleFanGeometry} from '../core/geometry_builders.js';
import {disposeObject} from '../core/resource_registry.js';

import {WallTypes} from '../core/constants.js';

import {Utils} from '../core/utils.js';
import {HalfEdge} from './half_edge.js';


/**
 * A picking plane with a back-reference to the room that owns it.
 *
 * The `room` property is a monkey patch - the comment in `generatePlane()` has
 * said so since before the migration - and the raycaster reads it to answer
 * "which room did I just click". A typedef is what lets the patch be written
 * down rather than merely done (RM-005 C2).
 *
 * @typedef {import('three').Mesh & {room?: Room}} RoomPlane
 */

/** Default texture to be used if nothing is provided. */
export const defaultRoomTexture = {url: 'rooms/textures/hardwood.jpg', scale: 400};

/**
 * A Room is the combination of a Floorplan with a floor plane.
 */
export class Room extends EventDispatcher
{
	/**
	 *  ordered CCW
	 */
	constructor(floorplan, corners)
	{
		super();
		/**
		 * This room's identity, assigned rather than derived (RM-003 A3).
		 *
		 * A `Room` object does not survive an edit - `Floorplan.update()` builds a
		 * new one for every cycle it finds, every time - so before A3 there was
		 * nothing to hold on to. Anything that wanted to refer to a room had to use
		 * one of the two derived keys below, and both change the moment its corners
		 * do; that is finding H-5, and it is why naming a room and then drawing a
		 * wall through one of its sides lost the name.
		 *
		 * A successor room inherits this from the room it continues - see
		 * `Floorplan.update()` and `model/room_matcher.js` - so it is stable across
		 * re-derivation even though the object is not. It is deliberately NOT
		 * persisted: a saved file identifies a room by its corners, which is a
		 * description a different build can also understand, and the id is
		 * reassigned on load.
		 *
		 * @type {string}
		 */
		this.id = Utils.guide();
		this._name = 'A New Room';
		/**
		 * What this room is for - Bedroom, Kitchen, Bathroom (RM-008 E3).
		 *
		 * Separate from the name, because they answer different questions and a
		 * plan needs both: "Master" is which room this is, "Bedroom" is what it is.
		 * Free text rather than an enum, with the common ones offered in the
		 * inspector - a plan of a house nobody anticipated should be able to say
		 * "Puja room" or "Utility" without a library release.
		 *
		 * Empty by default and drawn only when set, so a plan nobody has typed into
		 * looks exactly as it did before this sprint.
		 *
		 * @type {string}
		 */
		this._type = '';
		this.min = null;
		this.max = null;
		this.center = null;
		this.area = 0.0;
		this.areaCenter = null;
		this._polygonPoints = [];

		this.floorplan = floorplan;
		this.corners = corners;
		this.interiorCorners = [];
		this.edgePointer = null;
		this.floorPlane = null;
		this.roofPlane = null;
		this.customTexture = false;
		this.floorChangeCallbacks = null;
		this.updateWalls();
		this.updateInteriorCorners();
		this.generatePlane();
		this.generateRoofPlane();

		var cornerids = [];
		for(var i=0;i<this.corners.length;i++)
		{
			var c = this.corners[i];
			c.attachRoom(this);
			cornerids.push(c.id);
		}
		this._roomByCornersId = cornerids.join(',');
	}
	
	get roomCornerPoints()
	{
		return this._polygonPoints;
	}

	get roomByCornersId()
	{
		return this._roomByCornersId;
	}

	set name(value)
	{
		var oldname = this._name;
		this._name = value;
		this.dispatchEvent({type:EVENT_ROOM_ATTRIBUTES_CHANGED, item:this, info:{from: oldname, to: this._name}});
	}
	get name()
	{
		return this._name;
	}

	/**
	 * What this room is for, or '' (RM-008 E3).
	 * @returns {string}
	 */
	get type()
	{
		return this._type;
	}

	/**
	 * Announced with the same event and the same `{from, to}` payload the name
	 * uses, and deliberately without saying which attribute moved.
	 *
	 * `tests/change-projection.test.js` pins that payload shape exactly, and every
	 * listener this repository has re-reads the room rather than acting on the
	 * values in the event - so naming the attribute would break a pin to add
	 * information nothing consumes. The event means "an attribute of this room
	 * changed; read it again".
	 *
	 * @param {string} value
	 */
	set type(value)
	{
		var next = (typeof value === 'string') ? value : '';
		if (next === this._type)
		{
			return;
		}
		var previous = this._type;
		this._type = next;
		this.dispatchEvent({type: EVENT_ROOM_ATTRIBUTES_CHANGED, item: this, info: {from: previous, to: this._type}});
	}

	/**
	 * How high this room's ceiling is, in centimetres (RM-008 E3).
	 *
	 * ## Derived, not stored, and that is the finding
	 *
	 * E3 was planned with a per-room ceiling height as a third persisted field.
	 * Building it that way would have been wrong, and E2 is why: `Wall.height`
	 * turned out not to be the height of the wall, because a wall's drawn top
	 * comes from the elevations of the two corners at its ends. The ceiling of a
	 * room *is* the elevation of its corners - there is nowhere else for a
	 * ceiling to come from - so a second number stored beside them could disagree
	 * with the geometry, and the drawing would then be a lie in the same way
	 * `Wall.height` was.
	 *
	 * So this reads the corners, and {@link Room#setCeilingHeight} writes them.
	 * Nothing new is persisted, which also means nothing new can be lost: every
	 * file ever written by this project already carries its ceiling heights.
	 *
	 * The maximum rather than an average, because that is the height of the room:
	 * a room with one corner raised has a sloped ceiling whose highest point is
	 * that corner. {@link Room#hasUniformCeiling} is how a caller tells the two
	 * cases apart, and the inspector says so rather than showing a number that
	 * describes only part of the room.
	 *
	 * @returns {number} Centimetres. Zero for a room with no corners.
	 */
	get ceilingHeight()
	{
		if (!this.corners.length)
		{
			return 0;
		}
		var highest = -Infinity;
		this.corners.forEach(function (corner)
		{
			if (corner.elevation > highest)
			{
				highest = corner.elevation;
			}
		});
		return highest;
	}

	/**
	 * Whether every corner of this room is at the same elevation (RM-008 E3).
	 * @returns {boolean}
	 */
	get hasUniformCeiling()
	{
		if (this.corners.length < 2)
		{
			return true;
		}
		var first = this.corners[0].elevation;
		for (var i = 1; i < this.corners.length; i++)
		{
			// A tolerance rather than equality: these are centimetres a person
			// typed, round-tripped through a display unit and back, so 250 and
			// 249.99999999999997 are the same ceiling.
			if (Math.abs(this.corners[i].elevation - first) > 1e-6)
			{
				return false;
			}
		}
		return true;
	}

	/**
	 * Raise or lower this room's ceiling (RM-008 E3).
	 *
	 * Writes every corner of the room, which is the honest consequence of the
	 * height living on the corners: a corner shared with the room next door is
	 * one corner, and raising this room's ceiling raises that wall's top on both
	 * sides. Two walls meeting at a corner share it, and always have - the wall
	 * inspector has said so since E2. The room inspector says it here too rather
	 * than letting somebody discover it.
	 *
	 * Batched, so eight corners on a pair of adjoining rooms are one undo entry
	 * and one re-derivation instead of eight of each.
	 *
	 * @param {number} centimetres
	 * @returns {boolean} Whether anything moved.
	 */
	setCeilingHeight(centimetres)
	{
		if (typeof centimetres !== 'number' || !isFinite(centimetres) || centimetres <= 0)
		{
			return false;
		}
		var corners = this.corners.filter(function (corner)
		{
			return Math.abs(corner.elevation - centimetres) > 1e-6;
		});
		if (!corners.length)
		{
			return false;
		}
		var plan = this.floorplan;
		if (plan && typeof plan.beginBatch === 'function')
		{
			plan.beginBatch('edit');
		}
		try
		{
			corners.forEach(function (corner) {corner.elevation = centimetres;});
		}
		finally
		{
			if (plan && typeof plan.endBatch === 'function')
			{
				plan.endBatch();
			}
		}
		return true;
	}

	roomIdentifier()
	{
		var cornerids = [];
		this.corners.forEach((corner)=>{
				cornerids.push(corner.id);
		});
		var ids = cornerids.join(',');
		return ids;
	}

	getUuid()
	{
		var cornerUuids = Utils.map(this.corners, function (c) {return c.id;});
		cornerUuids.sort();
		return cornerUuids.join();
	}

	fireOnFloorChange(callback)
	{
		this.floorChangeCallbacks.add(callback);
	}

	getTexture()
	{
		var uuid = this.getUuid();
		var tex = this.floorplan.getFloorTexture(uuid);
		return tex || defaultRoomTexture;
	}

	setRoomWallsTexture(textureUrl, textureStretch, textureScale)
	{
		// `edgePointer` is null only for a room with no corners, which
		// `Floorplan.update()` does not build - it comes from a cycle in the graph,
		// and a cycle has corners. The guard says that rather than assuming it, and
		// costs one comparison on a path a user drives (RM-005 C2).
		var edge = this.edgePointer;
		if (!edge)
		{
			return;
		}
		var iterateWhile = true;
		edge.setTexture(textureUrl, textureStretch, textureScale);
		while (iterateWhile)
		{
			// `!edge.next` is new (RM-005 C2). `next` is null on an unlinked edge,
			// and the walk would then assign null and throw on the next line - so
			// the guard turns a broken DCEL from a TypeError into a short walk.
			// It cannot fire on a plan `Floorplan.update()` built, where every
			// edge in a cycle has a successor.
			if (!edge.next || edge.next === this.edgePointer)
			{
				break;
			}
			else
			{
				edge = edge.next;
			}
			edge.setTexture(textureUrl, textureStretch, textureScale);
		}
	}

	/**
	 * textureStretch always true, just an argument for consistency with walls
	 */
	setTexture(textureUrl, textureStretch, textureScale)
	{
		var uuid = this.getUuid();
		this.floorplan.setFloorTexture(uuid, textureUrl, textureScale);
		this.dispatchEvent({type:EVENT_CHANGED, item: this});
	}

	generateRoofPlane()
	{
		// Detached AND disposed, since RM-003 A0. The detach was already here; the
		// disposal was not, so every regeneration left a fan geometry and a
		// material behind. See dispose() below for who owns these.
		disposeObject(this.roofPlane);
		// setup texture
		var points = this.corners.map((corner) => new Vector3(corner.x, corner.elevation, corner.y));
		var geometry = triangleFanGeometry(points);
		this.roofPlane = /** @type {RoomPlane} */ (new Mesh(geometry, new MeshBasicMaterial({side: DoubleSide, visible:false})));
		this.roofPlane.room = this;
	}

	generatePlane()
	{
		disposeObject(this.floorPlane);
		var points = [];
		this.interiorCorners.forEach((corner) => {
			points.push(new Vector2(corner.x,corner.y));
		});
		var shape = new Shape(points);
		var geometry = new ShapeGeometry(shape);
		this.floorPlane = /** @type {RoomPlane} */ (new Mesh(geometry, new MeshBasicMaterial({side: DoubleSide, visible:false})));
		//The below line was originally setting the plane visibility to false
		//Now its setting visibility to true. This is necessary to be detected
		//with the raycaster objects to click walls and floors.
		this.floorPlane.visible = true;
		this.floorPlane.rotation.set(Math.PI / 2, 0, 0);
		this.floorPlane.room = this; // js monkey patch, and RoomPlane is what declares it

		var b3 = new Box3();
		// precise: since r140 setFromObject expands the object's own bounding box
		// by default, which for a rotated mesh is looser than the r98 result.
		// These bounds feed item snapping, so the drift would be a silent
		// placement change.
		b3.setFromObject(this.floorPlane, true);
		this.min = b3.min.clone();
		this.max = b3.max.clone();
		this.center = this.max.clone().sub(this.min).multiplyScalar(0.5).add(this.min);
	}

	/**
	 * Release the two hit-test planes this room owns (RM-003 A0).
	 *
	 * ## Why a model class has a dispose() at all
	 *
	 * Because a model class builds GPU resources, which `docs/architecture.md`
	 * used to say it did not. `generatePlane()` and `generateRoofPlane()` each
	 * build a `Mesh` with its own geometry and material. They are invisible - they
	 * exist so the raycaster has something to hit for floor and ceiling picking -
	 * and being invisible is presumably how they escaped the description. A
	 * `ShapeGeometry` is a `ShapeGeometry` whether or not it is drawn, and
	 * `Floor.addToScene()` puts both of these into the live scene.
	 *
	 * `Floorplan.update()` throws every Room away and builds new ones, so before
	 * A0 this pair leaked on every call - four of the six resources the RM-003
	 * measurement counted per update.
	 *
	 * ## The ownership boundary
	 *
	 * The room owns these two planes; the half edges own theirs, and are released
	 * through the wall that points at them. The 3D `Floor` *borrows* both of these
	 * for picking and must never dispose them - see the borrowing test in
	 * `tests/resource-lifecycle.test.js`, which is what stops a well-meaning
	 * change in the view layer disposing geometry the model still needs.
	 *
	 * Idempotent, because ownership boundaries overlap in practice.
	 */
	dispose()
	{
		disposeObject(this.floorPlane);
		disposeObject(this.roofPlane);
		this.floorPlane = null;
		this.roofPlane = null;
	}

	cycleIndex(index)
	{
		if (index < 0)
		{
			return index + this.corners.length;
		}
		else
		{
			return index % this.corners.length;
		}
	}

	pointInRoom(pt)
	{
		var polygon = [];
		this.corners.forEach((corner) => {
			var co = new Vector2(corner.x,corner.y);
			polygon.push(co);
		});
		return Utils.pointInPolygon2(pt, polygon);
	}

	updateInteriorCorners()
	{
		// See setRoomWallsTexture: null only for a cornerless room.
		var edge = this.edgePointer;
		if (!edge)
		{
			return;
		}
		var iterateWhile = true;
		while (iterateWhile)
		{
			this.interiorCorners.push(edge.interiorStart());
			edge.generatePlane();
			// See setRoomWallsTexture for why `!edge.next` is here.
			if (!edge.next || edge.next === this.edgePointer)
			{
				break;
			}
			else
			{
				edge = edge.next;
			}
		}
	}
	
	updateArea()
	{
		var oldarea = this.area;
		var points;
		var allpoints = [];
		this.areaCenter = new Vector2();
		this._polygonPoints = [];
		
		var firstCorner, secondCorner, wall, i, corner, region;
		
		for(i=0;i<this.corners.length;i++)
		{
			corner = this.corners[i];
			firstCorner = this.corners[i];
			secondCorner = this.corners[(i + 1) % this.corners.length];			
			wall = firstCorner.wallToOrFrom(secondCorner);
			
			if(wall != null)
			{
				if(wall.wallType == WallTypes.CURVED)
				{
					var begin = corner.location.clone().sub(wall.bezier.get(0)).length();
					var p;
					var stepIndex;
					allpoints.push(corner.location.clone());
					
					if(begin < 1e-6)
					{
						for (stepIndex=1;stepIndex<20;stepIndex++)
						{
							p = wall.bezier.get(stepIndex/20);
							allpoints.push(new Vector2(p.x, p.y));
						}
					}
					else
					{
						for (stepIndex=19;stepIndex>0;stepIndex--)
						{
							p = wall.bezier.get(stepIndex/20);
							allpoints.push(new Vector2(p.x, p.y));
						}
					}	
				}
				else
				{
					allpoints.push(corner.location.clone());
				}
			}
			else
			{
				allpoints.push(corner.location.clone());
			}
		}
		
		points = allpoints;		
		region  = new Region(points);
		this.area = Math.abs(region.area());
		this.areaCenter = region.centroid();		
		this._polygonPoints = points;
		this.dispatchEvent({type:EVENT_ROOM_ATTRIBUTES_CHANGED, item:this, info:{from: oldarea, to: this.area}});
	}
	
	// Removed in S1: updateArea2(), an alternative area algorithm with no
	// callers anywhere in the repo. updateArea() above is the live one.

	hasAllCornersById(ids)
	{
		var sum = 0;
		for (var i=0;i<ids.length;i++)
		{
			 sum += this.hasACornerById(ids[i]);
		}
		return (sum == this.corners.length);
	}

	hasACornerById(id)
	{
		for (var i=0;i< this.corners.length;i++)
		{
			var corner = this.corners[i];
			if(corner.id == id)
			{
				return 1;
			}
		}
		return 0;
	}

	/**
	 * Populates each wall's half edge relating to this room
	 * this creates a fancy doubly connected edge list (DCEL)
	 */
	updateWalls()
	{

		/** @type {?HalfEdge} */
		var prevEdge = null;
		/** @type {?HalfEdge} */
		var firstEdge = null;

		for (var i = 0; i < this.corners.length; i++)
		{

			var firstCorner = this.corners[i];
			var secondCorner = this.corners[(i + 1) % this.corners.length];

			// find if wall is heading in that direction
			var wallTo = firstCorner.wallTo(secondCorner);
			var wallFrom = firstCorner.wallFrom(secondCorner);
			var edge = null;
			if (wallTo)
			{
				edge = new HalfEdge(this, wallTo, true);
			}
			else if (wallFrom)
			{
				edge = new HalfEdge(this, wallFrom, false);
			}
			else
			{
				// something horrible has happened
				console.log('corners arent connected by a wall, uh oh');
			}

			// The `else` branch only runs for i > 0, by which point both are set -
			// and `edge` is null only on the "corners arent connected by a wall"
			// path above, which logs and carries on. Stated rather than assumed
			// (RM-005 C2); the alternative here is a TypeError while dragging.
			if (i == 0)
			{
				firstEdge = edge;
			}
			else if (edge && prevEdge && firstEdge)
			{
				edge.prev = prevEdge;
				prevEdge.next = edge;
				if (i + 1 == this.corners.length)
				{
					firstEdge.prev = edge;
					edge.next = firstEdge;
				}
			}
			prevEdge = edge;
		}

		// hold on to an edge reference
		this.edgePointer = firstEdge;
	}
}
