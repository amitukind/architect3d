// @ts-check
import {Item} from './item.js';
import {Matrix4, Triangle, Plane, Vector3} from 'three';
import {faceIndices} from '../core/geometry_builders.js';

/**
 * What `roofContainsPoint` reports about one roof mesh.
 *
 * @typedef {Object} RoofResult
 * @property {number} distance
 * @property {boolean} contains
 * @property {?Vector3} point Where the point projects onto the roof plane, or
 *           null if no triangle was closer than the running best.
 * @property {?Vector3} closestPoint The nearest point on the last triangle
 *           examined, or null if the mesh had no triangles.
 */
/**
 * A Floor Item is an entity to be placed related to a floor.
 */
export class RoofItem extends Item
{
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super(model, metadata, geometry, material, position, rotation, scale);
		this.allowRotate = false;
		this.boundToFloor = false;
		this._freePosition = false;
		if(this.geometry)
		{
			var box = this.bounds();
			this.geometry.applyMatrix4(new Matrix4().makeTranslation(-0.5 * (box.max.x + box.min.x), -0.5 * (box.max.y - box.min.y),-0.5 * (box.max.z + box.min.z)));
			this.geometry.computeBoundingBox();
		}
		this.halfSize = this.objectHalfSize();
		this.canvasPlaneWH.position.set(0, this.getHeight() * -0.5, this.getDepth()*0.5);
		this.canvasPlaneWD.position.set(0, -this.getHeight(), 0);

		var co = this.closestCeilingPoint();
		this.moveToPosition(co);
	}

	/** Returns an array of planes to use other than the ground plane
	 * for passing intersection to clickPressed and clickDragged */
	customIntersectionPlanes()
	{
		return this.floorplan.roofPlanes();
	}

	roofContainsPoint(roof, forpoint)
	{
			var g = roof.geometry;
			// Typed, because an object literal takes its field types from its
			// initialisers - so `point: null` declared the field AS null and every
			// assignment below was an error (RM-005 C2). The same shape appears in
			// closestCeilingPoint, and both are documented by RoofResult.
			/** @type {RoofResult} */
			var result = {distance: Number.MAX_VALUE, contains: false, point: null, closestPoint: null};
			/** @type {?Vector3} */
			var closestPoint = null;
			// Geometry.faces/.vertices are gone; the same triangles now come out
			// of the index and position attributes.
			var faces = faceIndices(g);
			var position = g.getAttribute('position');
			var vertexAt = (i) => new Vector3(position.getX(i), position.getY(i), position.getZ(i));
			for (var i=0;i< faces.length;i++)
			{
					var f = faces[i];
					var plane = new Plane();
					var triangle = new Triangle(vertexAt(f[0]), vertexAt(f[1]), vertexAt(f[2]));
					var ipoint = new Vector3();
					var cpoint = new Vector3();
					var contains;
					var distance;
					closestPoint = triangle.closestPointToPoint(forpoint, cpoint);
					triangle.getPlane(plane);
					plane.projectPoint(forpoint, ipoint);
					contains = triangle.containsPoint(ipoint);
					distance = plane.distanceToPoint(forpoint);
					if(distance < result.distance && contains)
					{
						result.distance = distance;
						result.contains = contains;
						result.point = ipoint;
						result.closestPoint = closestPoint.clone();
					}
			}
			//No good result so return the closest point of the last triangle in this roof mesh
			// `closestPoint` is null when the mesh has no faces at all, which is the
			// same emptiness J-5 found one level up.
			if(result.point == null && closestPoint)
			{
				result.closestPoint = closestPoint.clone();
			}

			return result;
	}

	closestCeilingPoint()
	{
		var roofs = this.floorplan.roofPlanes();
		var roof;
		/** @type {{distance: number, point: ?Vector3}} */
		var globalResult = {distance: Number.MAX_VALUE, point: null};
		/** @type {?RoofResult} */
		var result = null;
		for (var i=0;i< roofs.length; i++)
		{
				roof = roofs[i];
				result = this.roofContainsPoint(roof, this.position);
				if(result.point !=null && result.distance < globalResult.distance && result.contains)
				{
						globalResult.distance = result.distance;
						globalResult.point = result.point.clone();
				}
		}
		//No good results so assign the closestPoint of the last roof in the above iteration
		if(globalResult.point == null)
		{
				// `result` is null when the loop never ran, which is every design with
				// no rooms - and `roofPlanes()` pushes one plane per room (RM-005 C2).
				//
				// This threw. Not in an odd corner of the API either: the constructor
				// calls `closestCeilingPoint()` on line 24, so adding a ceiling item
				// before drawing a room was `TypeError: Cannot read properties of null
				// (reading 'closestPoint')`, and the state it needs is the one every
				// design starts in.
				//
				// Found by reading the type checker's output rather than by anybody
				// hitting it - two of the 355 sit on the line below, TS18047 for
				// `result` and again for `result.closestPoint`. That is the second
				// defect this family has produced, after P2's and B3's.
				//
				// Staying where it is, is the honest answer to "what is the nearest
				// ceiling" when there is no ceiling. `moveToPosition` with the current
				// position is a no-op, so the item lands wherever it was placed and
				// the user moves it - which is what `FloorItem.isValidPosition` already
				// does when it cannot find a room to be in.
				if(result == null || result.closestPoint == null)
				{
						return this.position.clone();
				}
				return result.closestPoint.clone();
		}
		return globalResult.point.clone();
	}

	/** */
	placeInRoom()
	{
		if (!this.position_set)
		{
			var co = this.closestCeilingPoint();
			this.moveToPosition(co);
		}
	}
}
