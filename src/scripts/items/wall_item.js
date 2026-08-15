import {Vector2, Vector3} from 'three';
import {EVENT_DELETED} from '../core/events.js';
import {Utils} from '../core/utils.js';
import {Item} from './item.js';

/**
 * A Wall Item is an entity to be placed related to a wall.
 */
export class WallItem extends Item
{
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super(model, metadata, geometry, material, position, rotation, scale);
		/** The currently applied wall edge. */
		this.currentWallEdge = null;

		/**
		 * One listener, held so it can be taken off again (RM-004 B2).
		 *
		 * `changeWallEdge` used to declare this as a fresh closure on every call
		 * and then `removeEventListener` the NEW one off the old wall - removing a
		 * function that had never been added, and leaving the previous closure
		 * subscribed. Every re-bind leaked one, and there was no reference anywhere
		 * that could detach the item from a wall without destroying the item.
		 *
		 * B2 needs exactly that: a wall-bound item now survives a document load,
		 * and the way it used to die was its own subscription - `reset()` fires
		 * EVENT_DELETED on every wall, this handler ran, and the item removed
		 * itself before it could be re-bound. Bound once here so `releaseWall()`
		 * can undo it.
		 */
		this._onWallDeleted = (event) => {this.remove(event.item);};
		/*
		 * This used to carry a TODO reading "This caused a huge headache.
		 * HalfEdges get destroyed/created every time floorplan is edited. This
		 * item should store a reference to a wall and front/back, and grab its
		 * edge reference dynamically whenever it needs it."
		 *
		 * RM-004 B2 solved it, by a different route than the one suggested.
		 * Rather than have the item resolve an edge on demand, walls were given
		 * ids derived from their corner pair, which made `HalfEdge.id`
		 * (`${wall.id}:front|back`) stable across a load. `Model.newRoom` now
		 * notes which face a bound item is on before the floorplan is destroyed
		 * and puts it back on that face afterwards - not merely on the nearest
		 * one, which is the same answer everywhere except where two walls meet.
		 *
		 * Left as a record rather than deleted: the headache was real, and the
		 * shape of the fix is worth knowing before anybody re-derives it.
		 */

		/** used for finding rotations */
		this.refVec = new Vector2(0, 1.0);
		/** */
		this.wallOffsetScalar = 0;
		/** */
		this.sizeX = 0;
		/** */
		this.sizeY = 0;
		/** */
		this.addToWall = false;
		/** */
		this.boundToFloor = false;
		/** */
		this.frontVisible = false;
		/** */
		this.backVisible = false;
		this.allowRotate = false;
		this._freePosition = false;
	}

	/** Get the closet wall edge.
	 * @returns The wall edge.
	 */
	closestWallEdge()
	{
		var wallEdges = this.model.floorplan.wallEdges();
		var wallEdge = null;
		var minDistance = null;
		var itemX = this.position.x;
		var itemZ = this.position.z;
		wallEdges.forEach((edge) => {
			var distance = edge.distanceTo(itemX, itemZ);
			if (minDistance === null || distance < minDistance)
			{
				minDistance = distance;
				wallEdge = edge;
			}
		});
		return wallEdge;
	}

	/** */
	removed()
	{
		if (this.currentWallEdge != null && this.addToWall)
		{
			Utils.removeValue(this.currentWallEdge.wall.items, this);
			this.redrawWall();
		}
		// Detach from the wall FIRST, then release (RM-003 A0). redrawWall() above
		// rebuilds the wall's faces, which cuts the hole this item used to occupy -
		// and it reads this item's position and halfSize to do it. Releasing before
		// that would hand the rebuild a disposed geometry.
		super.removed();
	}

	/** */
	redrawWall()
	{
		if (this.addToWall)
		{
			this.currentWallEdge.wall.fireRedraw();
		}
	}

	/** */
	updateEdgeVisibility(visible, front)
	{
		if (front)
		{
			this.frontVisible = visible;
		}
		else
		{
			this.backVisible = visible;
		}
		this.visible = (this.frontVisible || this.backVisible);
	}

	/** */
	updateSize()
	{
		this.wallOffsetScalar = (this.geometry.boundingBox.max.z - this.geometry.boundingBox.min.z) * this.scale.z / 2.0;
		this.sizeX = (this.geometry.boundingBox.max.x - this.geometry.boundingBox.min.x) * this.scale.x;
		this.sizeY = (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y) * this.scale.y;
	}

	/** */
	resized()
	{
		if (this.boundToFloor)
		{
			this.position.y = 0.5 * (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y) * this.scale.y + 0.01;
		}
		this.updateSize();
		this.redrawWall();
	}

	/** */
	/**
	 * Wall-bound: this item holds a `HalfEdge`. Since RM-004 B2 that is a fact to
	 * be handled on load rather than a reason to discard the item. See
	 * {@link Item#boundToFloorplan}.
	 * @returns {boolean}
	 */
	get boundToFloorplan()
	{
		return true;
	}

	placeInRoom()
	{
		var closestWallEdge = this.closestWallEdge();
		this.changeWallEdge(closestWallEdge);
		this.updateSize();

		if (!this.position_set)
		{
			// position not set
			var center = closestWallEdge.interiorCenter();
			var newPos = new Vector3(center.x, closestWallEdge.wall.height / 2.0, center.y);
			this.boundMove(newPos);
			this.position.copy(newPos);
			this.redrawWall();
		}
	}

	/** */
	moveToPosition(vec3, intersection)
	{
		var intersectionEdge = (intersection) ? (intersection.object) ? intersection.object.edge: intersection : this.closestWallEdge();
		this.changeWallEdge(intersectionEdge);
		this.boundMove(vec3);

		super.moveToPosition(vec3);
		this.redrawWall();
	}

	/** */
	getWallOffset()
	{
		return this.wallOffsetScalar;
	}

	/** */
	/**
	 * Let go of the wall this item is on, without destroying the item.
	 *
	 * The detach half of `changeWallEdge`, split out because `Model.newRoom`
	 * needs it on its own: a document load destroys every wall, and an item still
	 * subscribed to EVENT_DELETED removes itself when that happens. Calling this
	 * first is what lets the item be re-bound afterwards instead of reloaded.
	 *
	 * Safe to call when unbound, and idempotent - it is also the first thing
	 * `changeWallEdge` does.
	 */
	releaseWall()
	{
		if (this.currentWallEdge == null)
		{
			return;
		}

		if (this.addToWall)
		{
			Utils.removeValue(this.currentWallEdge.wall.items, this);
			this.redrawWall();
		}
		else
		{
			Utils.removeValue(this.currentWallEdge.wall.onItems, this);
		}

		this.currentWallEdge.wall.removeEventListener(EVENT_DELETED, this._onWallDeleted);
		this.currentWallEdge = null;
	}

	changeWallEdge(wallEdge)
	{
		this.releaseWall();
		wallEdge.wall.addEventListener(EVENT_DELETED, this._onWallDeleted);

		// find angle between wall normals
		var normal2 = new Vector2();
		// Was geometry.faces[0].normal. BufferGeometry has no per-face normals,
		// so HalfEdge.generatePlane precomputes this one when it builds the plane.
		var normal3 = wallEdge.planeNormal;
		normal2.x = normal3.x;
		normal2.y = normal3.z;

		var angle = Utils.angle( new Vector2(this.refVec.x, this.refVec.y), new Vector2(normal2.x, normal2.y));
		this.rotation.y = angle;
		// update currentWall
		this.currentWallEdge = wallEdge;
		if (this.addToWall)
		{
			wallEdge.wall.items.push(this);
			this.redrawWall();
		}
		else
		{
			wallEdge.wall.onItems.push(this);
		}
	}

	/** Returns an array of planes to use other than the ground plane
	 * for passing intersection to clickPressed and clickDragged */
	customIntersectionPlanes()
	{
		return this.model.floorplan.wallEdgePlanes();
	}

	/** takes the move vec3, and makes sure object stays bounded on plane */
	boundMove(vec3)
	{
		var tolerance = 1;
		var edge = this.currentWallEdge;
		vec3.applyMatrix4(edge.interiorTransform);
		if (vec3.x < this.sizeX / 2.0 + tolerance)
		{
			vec3.x = this.sizeX / 2.0 + tolerance;
		}
		else if (vec3.x > (edge.interiorDistance() - this.sizeX / 2.0 - tolerance))
		{
			vec3.x = edge.interiorDistance() - this.sizeX / 2.0 - tolerance;
		}

		if (this.boundToFloor)
		{
			vec3.y = 0.5 * (this.geometry.boundingBox.max.y - this.geometry.boundingBox.min.y) * this.scale.y + 0.01;
		}
		else
		{
			if (vec3.y < this.sizeY / 2.0 + tolerance)
			{
				vec3.y = this.sizeY / 2.0 + tolerance;
			}
			// Deliberately no upper clamp. Restricting vec3.y to
			// `edge.height - sizeY/2 - tolerance` would pin every wall item to a
			// uniform height and stop it being dragged up a sloped wall.
		}
		vec3.z = this.getWallOffset();
		vec3.applyMatrix4(edge.invInteriorTransform);
	}
}
