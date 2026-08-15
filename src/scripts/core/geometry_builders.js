import {BufferAttribute, BufferGeometry} from 'three';

/**
 * The hand-built meshes this app makes, as BufferGeometry.
 *
 * Added in sprint S4. `Geometry` and `Face3` were removed from three in r125,
 * and five places in this codebase built meshes the same way with them: push
 * some vertices, then push `Face3(0, i-1, i)` for each one after the second -
 * a triangle fan from the first vertex. Two of those five were quads, which is
 * just a four-point fan.
 *
 * Collecting it here means the fan is written once and the winding order is
 * decided in one place. That order is load-bearing: these meshes are
 * single-sided in places, and reversing a triangle turns a wall filler
 * invisible from the side it is meant to be seen from.
 *
 * The output is indexed, which the legacy path effectively was too - `Geometry`
 * shared its vertex list across faces in exactly the same way.
 */

/**
 * A triangle fan over `points`, wound `(0, i-1, i)`.
 *
 * Reproduces the legacy `Face3(0, i-1, i)` loop exactly, including for the
 * four-point quad case, where it yields `(0,1,2)` and `(0,2,3)` - the same two
 * triangles the old code pushed by hand.
 *
 * @param {Vector3[]} points Fan vertices, in order. Fewer than three yields an
 *   empty (but valid) geometry rather than throwing, matching the legacy code's
 *   tolerance for degenerate rooms mid-edit.
 * @returns {BufferGeometry} Indexed, with a `position` attribute and nothing else.
 */
export function triangleFanGeometry(points)
{
	var geometry = new BufferGeometry();
	var positions = new Float32Array(points.length * 3);

	points.forEach(function (point, i)
	{
		positions[i * 3] = point.x;
		positions[i * 3 + 1] = point.y;
		positions[i * 3 + 2] = point.z;
	});
	geometry.setAttribute('position', new BufferAttribute(positions, 3));

	var index = [];
	for (var i = 2; i < points.length; i++)
	{
		index.push(0, i - 1, i);
	}
	geometry.setIndex(index);

	return geometry;
}

/**
 * The normal of a geometry's first triangle.
 *
 * `Geometry.computeFaceNormals()` stored a normal per face and one caller reads
 * it - `WallItem.placeInRoom` takes the wall plane's first face normal to work
 * out which way the item should face. BufferGeometry has no per-face normals,
 * so the value is computed on demand from the position attribute instead.
 *
 * @param {BufferGeometry} geometry Must be indexed and hold at least one triangle.
 * @returns {Vector3} Unit normal, or a zero vector for a degenerate triangle.
 */
export function firstFaceNormal(geometry, target)
{
	var index = geometry.getIndex();
	var position = geometry.getAttribute('position');
	var a = index ? index.getX(0) : 0;
	var b = index ? index.getX(1) : 1;
	var c = index ? index.getX(2) : 2;

	var ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
	var ux = position.getX(b) - ax, uy = position.getY(b) - ay, uz = position.getZ(b) - az;
	var vx = position.getX(c) - ax, vy = position.getY(c) - ay, vz = position.getZ(c) - az;

	target.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
	// A zero-length cross product means the triangle is degenerate; normalize()
	// would divide by zero, and three's own Triangle.getNormal returns zero here.
	if (target.lengthSq() > 0)
	{
		target.normalize();
	}
	return target;
}

/**
 * Every triangle of an indexed or non-indexed geometry, as vertex index triples.
 *
 * Replaces iteration over `Geometry.faces`; `RoofItem.roofContainsPoint` walks
 * a roof mesh triangle by triangle to find the ceiling above an item.
 *
 * @param {BufferGeometry} geometry Any triangle-list geometry.
 * @returns {number[][]} One `[a, b, c]` per triangle.
 */
export function faceIndices(geometry)
{
	var index = geometry.getIndex();
	var count = index ? index.count : geometry.getAttribute('position').count;
	var faces = [];

	for (var i = 0; i < count; i += 3)
	{
		faces.push(index
			? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
			: [i, i + 1, i + 2]);
	}
	return faces;
}
