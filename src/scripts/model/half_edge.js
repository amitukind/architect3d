// @ts-check
import {EventDispatcher, Vector2, Vector3, Matrix4, Mesh, MeshBasicMaterial, Box3} from 'three';
import {firstFaceNormal, triangleFanGeometry} from '../core/geometry_builders.js';
import {disposeObject} from '../core/resource_registry.js';
import {EVENT_REDRAW} from '../core/events.js';
import {Utils} from '../core/utils.js';
import {WallTypes} from '../core/constants.js';



/**
 * A wall-picking plane carrying a back-reference to the edge that owns it.
 *
 * The `edge` property is a monkey patch - `generatePlane()` says so - and the
 * raycaster reads it to answer "which wall face did I just click". Same shape
 * as `RoomPlane` in `room.js` (RM-005 C2).
 *
 * @typedef {import('three').Mesh & {edge?: HalfEdge}} EdgePlane
 */
/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('./corner.js').Corner} Corner
 * @typedef {import('./room.js').Room} Room
 * @typedef {import('./wall.js').Wall} Wall
 */
/**
 * Half Edges are created by Room.
 *
 * Once rooms have been identified, Half Edges are created for each interior wall.
 *
 * A wall can have two half edges if it is visible from both sides.
 */
export class HalfEdge extends EventDispatcher
{
	/**
	 * Constructs a half edge.
	 * @param {?Room} room The associated room, or null for an ORPHAN wall - one
	 * with no room on either side. `Floorplan.update()` builds a pair of these
	 * so an orphan still has planes to pick against (RM-005 C2).
	 * @param {Wall} wall The corresponding wall. Instance of Wall
	 * @param {boolean} front True if front side. Boolean value
	 */
	constructor(room, wall, front)
	{
		super();

		/**  The minimum point in space calculated from the bounds
		 * @property {Vector3} min  The minimum point in space calculated from the bounds
		 * @type {?Vector3} Null until generatePlane() computes the bounds.
		 * @see https://threejs.org/docs/#api/en/math/Vector3
		**/
		this.min = null;
		
		/**
		 * The maximum point in space calculated from the bounds
		 * @property {Vector3} max	 The maximum point in space calculated from the bounds
		 * @type {?Vector3} Null until generatePlane() computes the bounds.
		 * @see https://threejs.org/docs/#api/en/math/Vector3
		**/
		this.max = null;

		/**
		 * The center of this half edge
		 * @property {Vector3} center The center of this half edge
		 * @type {?Vector3} Null until generatePlane() computes the bounds.
		 * @see https://threejs.org/docs/#api/en/math/Vector3
		**/
		this.center = null;

		/**
		 * Reference to a Room instance
		 * @property {Room} room Reference to a Room instance
		 * @type {?Room}
		**/
		this.room = room;
		
		/** 
		 *  Reference to a Wall instance
		 * @property {Wall} room Reference to a Wall instance
		 * @type {Wall}
		**/
		this.wall = wall;
		
		/**
		 * Reference to the next halfedge instance connected to this
		 * @property {HalfEdge} next Reference to the next halfedge instance connected to this
		 * @type {?HalfEdge}
		**/
		this.next = null;
		
		/**
		 * Reference to the previous halfedge instance connected to this
		 * @property {HalfEdge} prev Reference to the previous halfedge instance connected to this
		 * @type {?HalfEdge}
		**/
		this.prev = null;
		
		/** 
		 * The offset to maintain for the front and back walls from the midline of a wall
		 * @property {Number} offset The offset to maintain for the front and back walls from the midline of a wall
		 * @type {Number}
		**/
		this.offset = 0.0;

		/**
		 *  The height of a wall
		 * @property {Number} height The height of a wall
		 * @type {Number}
		**/
		this.height = 0.0;
		
		/**
		 * The plane mesh that will be used for checking intersections of wall items
		 * @property {Mesh} plane The plane mesh that will be used for checking intersections of wall items
		 * @type {?EdgePlane} Null between construction and generatePlane(), and
		 * again after remove(). `edge` on it is a monkey patch the raycaster reads.
		 * @see https://threejs.org/docs/#api/en/objects/Mesh
		 */
		this.plane = null;
		
		/**
		 * The interior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @property {Matrix4} interiorTransform The interior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @type {Matrix4} 
		 * @see https://threejs.org/docs/#api/en/math/Matrix4
		 */
		this.interiorTransform = new Matrix4();
		
		/**
		 * The inverse of the interior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @property {Matrix4} invInteriorTransform The inverse of the interior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @type {Matrix4}
		 * @see https://threejs.org/docs/#api/en/math/Matrix4
		 */
		this.invInteriorTransform = new Matrix4();
		
		/**
		 * The exterior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @property {Matrix4} exteriorTransform The exterior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @type {Matrix4} 
		 * @see https://threejs.org/docs/#api/en/math/Matrix4
		 */
		this.exteriorTransform = new Matrix4();
		
		/**
		 * The inverse of the exterior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @property {Matrix4} invExteriorTransform The inverse of the exterior transformation matrix that contains the homogeneous transformation of the plane based on the two corner positions of the wall
		 * @type {Matrix4}
		 * @see https://threejs.org/docs/#api/en/math/Matrix4
		 */
		this.invExteriorTransform = new Matrix4();
		
		/**
		 * This is an array of callbacks to be call when redraw happens
		 * @depreceated 
		 */
		this.redrawCallbacks = null;
		
		/**
		 * Is this is the front edge or the back edge
		 * @property {boolean} front Is this is the front edge or the back edge
		 * @type {boolean}
		 */
		this.front = front || false;

		/**
		 * This face's identity: its wall's, plus which side (RM-003 A3).
		 *
		 * Derived rather than assigned, and correctly so - a wall has exactly two
		 * faces and which one this is is not an accident of construction. It is
		 * stable because `Wall.id` is now stable, and it is never persisted,
		 * because a save file records walls and the sides come back with them.
		 *
		 * @type {string}
		 */
		this.id = `${wall.id}:${this.front ? 'front' : 'back'}`;

		this.offset = wall.thickness / 2.0;
		this.height = wall.height;

		if (this.front)
		{
			this.wall.frontEdge = this;
		}
		else
		{
			this.wall.backEdge = this;
		}

	}

	/**
	 * Two separate textures are used for the walls. Based on which side of the wall this {HalfEdge} refers the texture is returned
	 * @return {Object} front/back Two separate textures are used for the walls. Based on which side of the wall this {@link HalfEdge} refers the texture is returned
	 */
	getTexture()
	{
		if (this.front)
		{
			return this.wall.frontTexture;
		}
		else
		{
			return this.wall.backTexture;
		}
	}

	/**
	 * Set a Texture to the wall. Based on the edge side as front or back the texture is applied appropriately to the wall
	 * @param {String} textureUrl The path to the texture image
	 * @param {boolean} textureStretch Can the texture stretch? If not it will be repeated
	 * @param {Number} textureScale The scale value using which the number of repetitions of the texture image is calculated
	 * @emits {EVENT_REDRAW}
	 */
	setTexture(textureUrl, textureStretch, textureScale)
	{
		var texture = {url: textureUrl, stretch: textureStretch, scale: textureScale};
		if (this.front)
		{
			this.wall.frontTexture = texture;
		}
		else
		{
			this.wall.backTexture = texture;
		}

		this.dispatchEvent({type:EVENT_REDRAW, item: this});
	}
	
	/**
	 * Emit the redraw event
	 * @emits {EVENT_REDRAW}
	 */
	dispatchRedrawEvent()
	{
		this.dispatchEvent({type:EVENT_REDRAW, item: this});
	}
	
	/**
	 * Transform an x,y point to a Vector3 using the y position as z
	 * @param {{x: number, y: number}} corner Any x,y pair. Documented as `Corner`
	 * and never given one: every caller passes a `Vector2` from `interiorStart()`
	 * or its siblings, and the body reads only `.x` and `.y` (RM-005 C2).
	 * @return {Vector3}
	 * @see https://threejs.org/docs/#api/en/math/Vector3
	 */
	transformCorner(corner)
	{
		return new Vector3(corner.x, 0, corner.y);
	}


	/**
	 * This generates the invisible planes in the scene that are used for interesection testing for the wall items
	 */
	generatePlane()
	{
		// Released before it is replaced (RM-003 A0). `Room.updateInteriorCorners()`
		// calls this once per edge on construction, and a plan being re-derived
		// builds a fresh HalfEdge each time - so without this line the previous
		// quad's geometry and material were dropped on every update.
		disposeObject(this.plane);

		var v1 = this.transformCorner(this.interiorStart());
		var v2 = this.transformCorner(this.interiorEnd());
		var v3 = v2.clone();
		var v4 = v1.clone();

		v3.y = this.wall.startElevation;
		v4.y = this.wall.endElevation;

		var geometry = triangleFanGeometry([v1, v2, v3, v4]);
		geometry.computeBoundingBox();

		// computeFaceNormals() is gone with Geometry, and this quad is not
		// necessarily planar - the two elevations can differ - so averaged vertex
		// normals would not reproduce it anyway. The only reader is
		// WallItem.placeInRoom, which wants the first triangle's normal to decide
		// which way an item faces; compute exactly that, once.
		this.planeNormal = firstFaceNormal(geometry, new Vector3());

		this.plane = new Mesh(geometry, new MeshBasicMaterial({visible:true}));
		//The below line was originally setting the plane visibility to false
		//Now its setting visibility to true. This is necessary to be detected
		//with the raycaster objects to click walls and floors.
		this.plane.visible = true;
		this.plane.edge = this; // js monkey patch, declared by EdgePlane


		this.computeTransforms(this.interiorTransform, this.invInteriorTransform, this.interiorStart(), this.interiorEnd());
		this.computeTransforms(this.exteriorTransform, this.invExteriorTransform, this.exteriorStart(), this.exteriorEnd());

		var b3 = new Box3();
		// precise: see the same call in room.js. These bounds decide where wall
		// items may sit, so the r140 loosening would move them.
		b3.setFromObject(this.plane, true);
		this.min = b3.min.clone();
		this.max = b3.max.clone();
		this.center = this.max.clone().sub(this.min).multiplyScalar(0.5).add(this.min);
	}
	
	/**
	 * Release the intersection plane this half edge owns (RM-003 A0).
	 *
	 * The wall is what owns a half edge - the constructor writes itself onto
	 * `wall.frontEdge` or `wall.backEdge` - so `Floorplan.update()` releases these
	 * through the wall, immediately before `resetFrontBack()` nulls the pointers
	 * and makes them unreachable. That was two of the six resources per update.
	 *
	 * Idempotent.
	 */
	dispose()
	{
		disposeObject(this.plane);
		this.plane = null;
	}

	/**
	 * Calculate the transformation matrix for the edge (front/back) baesd on the parameters.
	 * @param {Matrix4} transform The matrix reference in which the transformation is stored
	 * @param {Matrix4} invTransform The inverse of the transform that is stored in the invTransform
	 * @param {Vector2} start The starting point location
	 * @param {Vector2} end The ending point location
	 * @see https://threejs.org/docs/#api/en/math/Matrix4
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	computeTransforms(transform, invTransform, start, end)
	{
		var v1 = start;
		var v2 = end;

		var angle = Utils.angle(new Vector2(1, 0), new Vector2(v2.x - v1.x, v2.y - v1.y));

		var tt = new Matrix4();
		var tr = new Matrix4();

		tt.makeTranslation(-v1.x, 0, -v1.y);
		tr.makeRotationY(-angle);
		transform.multiplyMatrices(tr, tt);
		invTransform.copy(transform).invert();
	}

	/** Gets the distance from specified point.
	 * @param {Number} x X coordinate of the point.
	 * @param {Number} y Y coordinate of the point.
	 * @returns {Number} The distance.
	 */
	distanceTo(x, y)
	{
		if(this.wall.wallType == WallTypes.STRAIGHT)
		{
			// x, y, x1, y1, x2, y2
			return Utils.pointDistanceFromLine(new Vector2(x, y), this.interiorStart(), this.interiorEnd());
		}
		else if (this.wall.wallType == WallTypes.CURVED)
		{
			// this.wall.bezier, not this._bezier - a HalfEdge has never had a
			// _bezier of its own, so this branch threw a TypeError for every
			// curved wall. It is reached through WallItem.placeInRoom ->
			// closestWallEdge, which means any design mixing curved walls with
			// wall-bound items failed to load. Every other curved branch in this
			// file (getStartX, interiorDistance, ...) already reads through the
			// wall; this one was simply written wrong. Fixed in S4 (roadmap
			// section 01 ledger).
			var p = this.wall.bezier.project({x:x, y:y});
			var projected = new Vector2(p.x, p.y);
			return projected.distanceTo(new Vector2(x, y));
		}
		return -1;
	}
	
	/**
	 * Get the starting corner of the wall this instance represents
	 * @return {Corner} The starting corner
	 */
	getStart()
	{
		if (this.front)
		{
			return this.wall.getStart();
		}
		else
		{
			return this.wall.getEnd();
		}
	}
	
	/**
	 * Get the ending corner of the wall this instance represents
	 * @return {Corner} The ending corner
	 */
	getEnd()
	{
		if (this.front)
		{
			return this.wall.getEnd();
		}
		else
		{
			return this.wall.getStart();
		}
	}	
	
	/**
	 * If this is the front edge then return the back edge. 
	 * For example in a wall there are two halfedges, i.e one for front and one back. Based on which side this halfedge lies return the opposite {@link HalfEdge}
	 * @return {HalfEdge} The other HalfEdge
	 */
	getOppositeEdge()
	{
		if (this.front)
		{
			return this.wall.backEdge;
		}
		else
		{
			return this.wall.frontEdge;
		}
	}
	
	/**
	 * Return the 2D interior location that is at the center/middle. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	interiorCenter()
	{
		if(this.wall.wallType == WallTypes.STRAIGHT)
		{
			// x, y, x1, y1, x2, y2
			return new Vector2((this.interiorStart().x + this.interiorEnd().x) / 2.0, (this.interiorStart().y + this.interiorEnd().y) / 2.0);
		}
		else if (this.wall.wallType == WallTypes.CURVED)
		{
			var c = this.wall.bezier.get(0.5);
			return new Vector2(c.x, c.y);
		}
		return new Vector2((this.interiorStart().x + this.interiorEnd().x) / 2.0, (this.interiorStart().y + this.interiorEnd().y) / 2.0);
	}
	
	/**
	 * Return the interior distance of the interior wall 
	 * @return {Number} The distance
	 */
	interiorDistance()
	{
		var start = this.interiorStart();
		var end = this.interiorEnd();
		if(this.wall.wallType == WallTypes.STRAIGHT)
		{
			return Utils.distance(start, end);
		}
		else if (this.wall.wallType == WallTypes.CURVED)
		{
			return this.wall.bezier.length();
		}		
		return Utils.distance(start, end);
	}
	
	/**
	 * Return the 2D interior location that is at the start. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	interiorStart()
	{
		var vec = this.halfAngleVector(this.prev, this);
		return new Vector2(this.getStart().x + vec.x, this.getStart().y + vec.y);
	}
	
	/**
	 * Return the 2D interior location that is at the end. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	// 
	interiorEnd()
	{
		var vec = this.halfAngleVector(this, this.next);
		return new Vector2(this.getEnd().x + vec.x, this.getEnd().y + vec.y);
	}
	
	/**
	 * Return the 2D exterior location that is at the end. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	exteriorEnd()
	{
		var vec = this.halfAngleVector(this, this.next);
		return new Vector2(this.getEnd().x - vec.x, this.getEnd().y - vec.y);
	}
	
	/**
	 * Return the 2D exterior location that is at the start. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	exteriorStart()
	{
		var vec = this.halfAngleVector(this.prev, this);
		return new Vector2(this.getStart().x - vec.x, this.getStart().y - vec.y);
	}
	
	/**
	 * Return the 2D exterior location that is at the center/middle. 
	 * @return {Vector2} Return an object with attributes x, y
	 * @see https://threejs.org/docs/#api/en/math/Vector2
	 */
	exteriorCenter()
	{
		if(this.wall.wallType == WallTypes.STRAIGHT)
		{
			// x, y, x1, y1, x2, y2
			return new Vector2((this.exteriorStart().x + this.exteriorEnd().x) / 2.0, (this.exteriorStart().y + this.exteriorEnd().y) / 2.0);
		}
		else if (this.wall.wallType == WallTypes.CURVED)
		{
			var c = this.wall.bezier.get(0.5);
			return new Vector2(c.x, c.y);
		}
		return new Vector2((this.exteriorStart().x + this.exteriorEnd().x) / 2.0, (this.exteriorStart().y + this.exteriorEnd().y) / 2.0);
	}
	
	/**
	 * Return the exterior distance of the exterior wall 
	 * @return {Number} The distance
	 */
	exteriorDistance()
	{
		var start = this.exteriorStart();
		var end = this.exteriorEnd();
		if(this.wall.wallType == WallTypes.STRAIGHT)
		{
			return Utils.distance(start, end);
		}
		else if (this.wall.wallType == WallTypes.CURVED)
		{
			return this.wall.bezier.length();
		}		
		return Utils.distance(start, end);
	}

	/** Get the corners of the half edge.
	 * @returns {Vector2[]} An array of x,y pairs - which is what the old tag's own
	 * description said, while its type said `Corner[]` (RM-005 C2).
	 */
	corners()
	{
		return [this.interiorStart(), this.interiorEnd(), this.exteriorEnd(), this.exteriorStart()];
	}	
	
	/**
	 * Gets CCW angle from v1 to v2
	 * @param {?HalfEdge} v1 The previous edge, or null at the start of a run.
	 * @param {?HalfEdge} v2 The next edge, or null at the end of one.
	 *
	 * Both tags used to say `{Vector2} v1` - the same name twice, and the wrong
	 * type: the body calls `getStart()` and `getEnd()` on them, which is the
	 * HalfEdge interface, and `interiorStart()` passes `this.prev` (RM-005 C2).
	 * @return {{x: number, y: number}} keys x and y, the half-angle point. Not a
	 * `Vector2` - the body builds a plain object and the line that used to make
	 * one is commented out beside it.
	 */
	halfAngleVector(v1, v2)
	{
		var v1startX, v1startY, v1endX, v1endY;
		var v2startX, v2startY, v2endX, v2endY;

		// One of the two may be null - the first or last edge of an open run - but
		// never both, and each arm below extrapolates from whichever survives. The
		// both-null return is written inside each arm rather than once above it,
		// because that is the shape the checker can follow: a guard at the top
		// establishes "at least one", which is not a thing narrowing can express
		// (RM-005 C2). Neither of these two returns is reachable.

		// make the best of things if we dont have prev or next
		if (!v1)
		{
			if (!v2)
			{
				return {x: 0, y: 0};
			}
			v1startX = v2.getStart().x - (v2.getEnd().x - v2.getStart().x);
			v1startY = v2.getStart().y - (v2.getEnd().y - v2.getStart().y);

			v1endX = v2.getStart().x;
			v1endY = v2.getStart().y;
		}
		else
		{
			v1startX = v1.getStart().x;
			v1startY = v1.getStart().y;
			v1endX = v1.getEnd().x;
			v1endY = v1.getEnd().y;
		}

		if (!v2)
		{
			if (!v1)
			{
				return {x: 0, y: 0};
			}
			v2startX = v1.getEnd().x;
			v2startY = v1.getEnd().y;
			v2endX = v1.getEnd().x + (v1.getEnd().x - v1.getStart().x);
			v2endY = v1.getEnd().y + (v1.getEnd().y - v1.getStart().y);
		}
		else
		{
			v2startX = v2.getStart().x;
			v2startY = v2.getStart().y;
			v2endX = v2.getEnd().x;
			v2endY = v2.getEnd().y;
		}

		// CCW angle between edges
		var theta = Utils.angle2pi( new Vector2(v1startX - v1endX, v1startY - v1endY), new Vector2(v2endX - v1endX, v2endY - v1endY));

		// cosine and sine of half angle
		var cs = Math.cos(theta / 2.0);
		var sn = Math.sin(theta / 2.0);

		// rotate v2
		var v2dx = v2endX - v2startX;
		var v2dy = v2endY - v2startY;

		var vx = v2dx * cs - v2dy * sn;
		var vy = v2dx * sn + v2dy * cs;

		// normalize
		var mag = Utils.distance(new Vector2(0, 0), new Vector2(vx, vy));
		var desiredMag = (this.offset) / sn;
		var scalar = desiredMag / mag;

		var halfAngleVector = {x:vx * scalar, y:vy * scalar};//new Vector2(vx * scalar, vy * scalar);

		// Two walls of different thickness meeting at a corner (RM-009 U-7).
		//
		// Everything above mitres with `this.offset` - the offset of whichever
		// half edge the method was called on - so at a corner between a 40 cm wall
		// and a 10 cm one, `A.interiorEnd()` mitres as if both were 20 and
		// `B.interiorStart()` as if both were 5. The two interior faces therefore
		// do not meet: measured on a 400 x 400 room, wall A's face ends at
		// (380, 20) and wall B's starts at (395, 5), and the room's floor polygon
		// runs 15 cm inside wall A's inner face.
		//
		// That was unreachable until RM-008 E2 gave walls their own thickness,
		// which is why it has never shown. Corrected only when the two offsets
		// actually differ: when they are equal this returns the vector it always
		// returned, bit for bit, so every existing design and every frozen r98
		// golden is untouched.
		return this.mitreDifferingOffsets(v1, v2, halfAngleVector);
	}

	/**
	 * Where two interior faces of different offsets actually meet (RM-009 U-7).
	 *
	 * The intersection of the two offset lines, which is what a mitre is. Returns
	 * `fallback` unchanged whenever the two offsets are equal - the case every
	 * design had before per-wall thickness - and whenever the two edges are
	 * parallel, where there is no intersection to find and the equal-offset mitre
	 * is still the best answer available.
	 *
	 * @param {?HalfEdge} v1 The edge arriving at the corner.
	 * @param {?HalfEdge} v2 The edge leaving it.
	 * @param {{x: number, y: number}} fallback What the equal-offset mitre gave.
	 * @returns {{x: number, y: number}} Relative to the corner, as `fallback` is.
	 */
	mitreDifferingOffsets(v1, v2, fallback)
	{
		if (!v1 || !v2 || v1 === v2)
		{
			return fallback;
		}
		var o1 = v1.offset;
		var o2 = v2.offset;
		if (Math.abs(o1 - o2) < 1e-9)
		{
			return fallback;
		}
		var d1 = new Vector2(v1.getEnd().x - v1.getStart().x, v1.getEnd().y - v1.getStart().y);
		var d2 = new Vector2(v2.getEnd().x - v2.getStart().x, v2.getEnd().y - v2.getStart().y);
		if (d1.length() < 1e-9 || d2.length() < 1e-9)
		{
			return fallback;
		}
		d1.normalize();
		d2.normalize();
		// Which side is the interior, taken from the mitre that was just computed
		// rather than assumed: it already points inward, so the normal that agrees
		// with it is the inward one. That keeps this correct for a room wound
		// either way without this method having to know which.
		var n1 = new Vector2(-d1.y, d1.x);
		var n2 = new Vector2(-d2.y, d2.x);
		if ((n1.x * fallback.x) + (n1.y * fallback.y) < 0)
		{
			n1.multiplyScalar(-1);
		}
		if ((n2.x * fallback.x) + (n2.y * fallback.y) < 0)
		{
			n2.multiplyScalar(-1);
		}
		// Line 1 through corner + n1*o1 along d1, line 2 through corner + n2*o2
		// along d2, both relative to the corner so the result is a vector.
		var cross = (d1.x * d2.y) - (d1.y * d2.x);
		if (Math.abs(cross) < 1e-9)
		{
			// Parallel: no intersection. Two collinear walls of different thickness
			// have a step in them, and where that step goes is a modelling question
			// rather than a mitre.
			return fallback;
		}
		var p1x = n1.x * o1;
		var p1y = n1.y * o1;
		var p2x = n2.x * o2;
		var p2y = n2.y * o2;
		var t = (((p2x - p1x) * d2.y) - ((p2y - p1y) * d2.x)) / cross;
		return {x: p1x + d1.x * t, y: p1y + d1.y * t};
	}
}
