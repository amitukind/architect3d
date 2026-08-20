// @ts-check
import {BufferAttribute, BufferGeometry, Vector3} from 'three';

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
 * @param {import('three').Vector3[]} points Fan vertices, in order. Fewer than three yields an
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
 * Several triangle fans in one geometry (RM-015 M2, finding AA-3).
 *
 * AA-3 measured a 36-room plan at **802 draw calls for 2,516 triangles** - 3.1
 * triangles per call, which is a scene paying overhead rather than drawing
 * anything. A large share of that is four-point fillers: two per wall face for
 * the sides, one for the base, each its own `Mesh` with its own `Material`.
 * Geometry that shares a material and shares a visibility can share a mesh, and
 * this is what lets it.
 *
 * Indexed, like {@link triangleFanGeometry}, and for the same reason: a fan of
 * n points is n vertices and n-2 triangles, and repeating the shared corner per
 * triangle would make a four-point quad six vertices instead of four.
 *
 * An empty input produces an empty (but valid) geometry, and a fan of fewer
 * than three points contributes nothing - the same tolerance the single-fan
 * builder has for a degenerate room mid-edit.
 *
 * @param {Array<Array<{x: number, y: number, z: number}>>} fans
 * @returns {BufferGeometry} Indexed, with a `position` attribute and nothing else.
 */
export function fanBatchGeometry(fans)
{
	var total = 0;
	var i;
	for (i = 0; i < fans.length; i++)
	{
		total += fans[i].length;
	}

	var geometry = new BufferGeometry();
	var positions = new Float32Array(total * 3);
	var index = [];
	var offset = 0;

	for (i = 0; i < fans.length; i++)
	{
		var points = fans[i];
		for (var p = 0; p < points.length; p++)
		{
			positions[(offset + p) * 3] = points[p].x;
			positions[(offset + p) * 3 + 1] = points[p].y;
			positions[(offset + p) * 3 + 2] = points[p].z;
		}
		// Indices are offset into the shared buffer, which is the whole trick and
		// the whole risk: an unshifted index draws another fan's vertices, and the
		// symptom is a stray triangle across the room rather than an error.
		for (var t = 2; t < points.length; t++)
		{
			index.push(offset, offset + t - 1, offset + t);
		}
		offset += points.length;
	}

	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.setIndex(index);
	return geometry;
}

/**
 * Several placed geometries in one, keeping positions and dropping the rest
 * (RM-015 M2, finding AA-3).
 *
 * Each entry is a geometry and the matrix its mesh was drawn with, because the
 * meshes being replaced carry their placement on the object rather than in the
 * buffer - `buildFillerUniformHeight` rotates and lifts its mesh, not its
 * geometry. Baking the matrix in is what lets one mesh at the origin draw what
 * n meshes at n placements drew.
 *
 * **Position only, and that is a precondition rather than a shortcut.** The
 * geometry this batches is drawn with `MeshBasicMaterial`, which reads neither
 * normals nor uvs; a caller batching anything lit or textured would lose both
 * silently. {@link Floorplan3D} checks the material before it calls this, and
 * declines to batch a render profile whose fillers are lit.
 *
 * @param {Array<{geometry: Object, matrix: Object}>} entries
 * @returns {BufferGeometry} Indexed, with a `position` attribute and nothing else.
 */
export function mergePositionGeometries(entries)
{
	var vertices = [];
	var index = [];
	var offset = 0;
	var vector = new Vector3();

	for (var e = 0; e < entries.length; e++)
	{
		var geometry = entries[e].geometry;
		var attribute = geometry && geometry.getAttribute ? geometry.getAttribute('position') : null;
		if (!attribute) { continue; }

		for (var v = 0; v < attribute.count; v++)
		{
			vector.set(attribute.getX(v), attribute.getY(v), attribute.getZ(v));
			if (entries[e].matrix) { vector.applyMatrix4(entries[e].matrix); }
			vertices.push(vector.x, vector.y, vector.z);
		}

		// An unindexed geometry draws its vertices in order; an indexed one draws
		// them in its own order. Both have to end up in one index, rebased.
		var source = geometry.getIndex();
		if (source)
		{
			for (var i = 0; i < source.count; i++) { index.push(offset + source.getX(i)); }
		}
		else
		{
			for (var j = 0; j < attribute.count; j++) { index.push(offset + j); }
		}
		offset += attribute.count;
	}

	var merged = new BufferGeometry();
	merged.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
	merged.setIndex(index);
	return merged;
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
 * @returns {import('three').Vector3} Unit normal, or a zero vector for a degenerate triangle.
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
