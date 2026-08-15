import {EVENT_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED} from '../core/events.js';
import {Region} from '../core/utils.js';
import {EventDispatcher, Vector2, Vector3, Shape, ShapeGeometry, Mesh, MeshBasicMaterial, DoubleSide, Box3} from 'three';
import {triangleFanGeometry} from '../core/geometry_builders.js';
import {disposeObject} from '../core/resource_registry.js';

import {WallTypes} from '../core/constants.js';

import {Utils} from '../core/utils.js';
import {HalfEdge} from './half_edge.js';

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
		var edge = this.edgePointer;
		var iterateWhile = true;
		edge.setTexture(textureUrl, textureStretch, textureScale);
		while (iterateWhile)
		{
			if (edge.next === this.edgePointer)
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
		this.roofPlane = new Mesh(geometry, new MeshBasicMaterial({side: DoubleSide, visible:false}));
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
		this.floorPlane = new Mesh(geometry, new MeshBasicMaterial({side: DoubleSide, visible:false}));
		//The below line was originally setting the plane visibility to false
		//Now its setting visibility to true. This is necessary to be detected
		//with the raycaster objects to click walls and floors.
		this.floorPlane.visible = true;
		this.floorPlane.rotation.set(Math.PI / 2, 0, 0);
		this.floorPlane.room = this; // js monkey patch

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
		var edge = this.edgePointer;
		var iterateWhile = true;
		while (iterateWhile)
		{
			this.interiorCorners.push(edge.interiorStart());
			edge.generatePlane();
			if (edge.next === this.edgePointer)
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

		var prevEdge = null;
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

			if (i == 0)
			{
				firstEdge = edge;
			}
			else
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
