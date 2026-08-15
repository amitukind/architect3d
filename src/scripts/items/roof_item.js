import {Item} from './item.js';
import {Matrix4, Triangle, Plane, Vector3} from 'three';
import {faceIndices} from '../core/geometry_builders.js';
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
			this.geometry.applyMatrix4(new Matrix4().makeTranslation(-0.5 * (this.geometry.boundingBox.max.x + this.geometry.boundingBox.min.x), -0.5 * (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y),-0.5 * (this.geometry.boundingBox.max.z + this.geometry.boundingBox.min.z)));
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
		return this.model.floorplan.roofPlanes();
	}

	roofContainsPoint(roof, forpoint)
	{
			var g = roof.geometry;
			var result = {distance: Number.MAX_VALUE, contains: false, point: null, closestPoint: null};
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
			if(result.point == null)
			{
				result.closestPoint = closestPoint.clone();
			}

			return result;
	}

	closestCeilingPoint()
	{
		var roofs = this.model.floorplan.roofPlanes();
		var roof;
		var globalResult = {distance: Number.MAX_VALUE, point: null};
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
