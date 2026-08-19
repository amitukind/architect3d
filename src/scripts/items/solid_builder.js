// @ts-check
import {BufferGeometry, BufferAttribute} from 'three';

/**
 * Building geometry out of boxes (RM-008 F1, extracted by F3).
 *
 * ## Why this file exists
 *
 * RM-009's risk table said, of F1: *"the generator is written inside `Item` and
 * F3 copies it - U-6 is the reason it goes behind an interface in F1 with
 * stairs named as the second caller. If the interface is wrong, F3 is where
 * that is discovered, and 1.5 weeks is a cheap place to discover it."*
 *
 * It was half right, and this file is the discovery. F1 did put a boundary in
 * the right place at the *call* level - `buildOpeningGeometry(opening,
 * thickness)` takes numbers and returns a `BufferGeometry` and a material list,
 * with nothing about doors leaking out of it. What it did not do is share the
 * four pieces *underneath* that call: `box`, `appendInto`, `rotateAboutY` and
 * the `BufferSink` typedef were all module-private to `opening.js`, so the
 * second caller's only options were to import nothing and copy them, or to
 * import from a module named after doors.
 *
 * So the extraction is F3's first commit and `opening.js` is its first caller,
 * not its second. Nothing about the doors changed - the functions moved
 * verbatim - which is the point: if the move had needed to change them, the
 * boundary would have been in the wrong place rather than merely half drawn.
 *
 * ## Why boxes, and why by hand
 *
 * Everything this application generates - a door frame, a leaf, a pane, a
 * tread, a landing, a handrail - is an axis-aligned box, optionally rotated
 * about one axis afterwards. Building the buffers here rather than merging
 * three's `BoxGeometry` instances is about **material groups**: each box names
 * its slot as it goes. The alternative is `BufferGeometryUtils.mergeGeometries`,
 * which lives in three's examples rather than its core and would be the first
 * examples import in this library.
 *
 * Coincident interior faces are the accepted cost. Two boxes that share a face
 * both write it, and the shared pair is enclosed by the solid they form, so it
 * is never seen. Avoiding them would mean a CSG union, which is orders of
 * magnitude more code than the thing it would tidy.
 */

/**
 * Buffers under construction.
 *
 * Named as a typedef because an object literal takes each property's type from
 * its initialiser, so `groups: []` is `never[]` and every push into it is an
 * error (RM-005 C2).
 *
 * @typedef {Object} BufferSink
 * @property {number[]} positions
 * @property {number[]} normals
 * @property {number[]} uvs
 * @property {number[]} indices
 * @property {Array<{start: number, count: number, material: number}>} groups
 */

/**
 * An empty sink.
 *
 * A function rather than a frozen constant that gets cloned: every caller wants
 * its own arrays, and the one thing worse than five copies of this literal is
 * four copies of it and one shared array.
 *
 * @returns {BufferSink}
 */
export function newSink()
{
	return {positions: [], normals: [], uvs: [], indices: [], groups: []};
}

/**
 * Append one axis-aligned box to a geometry under construction.
 *
 * @param {BufferSink} sink
 * @param {number} cx Centre.
 * @param {number} cy
 * @param {number} cz
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {number} materialIndex
 */
export function box(sink, cx, cy, cz, width, height, depth, materialIndex)
{
	var hx = width / 2;
	var hy = height / 2;
	var hz = depth / 2;
	// Six faces, each four corners wound anticlockwise seen from outside, with
	// its own normal. Written out rather than generated from a table: the table
	// is the same length and reads as data about nothing.
	var faces = [
		{n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]]},
		{n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]]},
		{n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]]},
		{n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]]},
		{n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]]},
		{n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]]},
	];
	var start = sink.indices.length;
	faces.forEach(function (face)
	{
		var base = sink.positions.length / 3;
		face.v.forEach(function (vertex, corner)
		{
			sink.positions.push(cx + vertex[0], cy + vertex[1], cz + vertex[2]);
			sink.normals.push(face.n[0], face.n[1], face.n[2]);
			sink.uvs.push(corner === 1 || corner === 2 ? 1 : 0, corner >= 2 ? 1 : 0);
		});
		sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	});
	sink.groups.push({start: start, count: sink.indices.length - start, material: materialIndex});
}

/**
 * Rotate positions and normals about the y axis, in place.
 *
 * @param {number[]} positions
 * @param {number[]} normals
 * @param {number} angle Radians.
 */
export function rotateAboutY(positions, normals, angle)
{
	var cos = Math.cos(angle);
	var sin = Math.sin(angle);
	for (var i = 0; i < positions.length; i += 3)
	{
		var x = positions[i];
		var z = positions[i + 2];
		positions[i] = x * cos + z * sin;
		positions[i + 2] = -x * sin + z * cos;
		var nx = normals[i];
		var nz = normals[i + 2];
		normals[i] = nx * cos + nz * sin;
		normals[i + 2] = -nx * sin + nz * cos;
	}
}

/**
 * Rotate positions and normals about the x axis, in place.
 *
 * F1 needed only the y axis, because the one thing it rotates is a door leaf
 * and a door swings about the vertical. F3's handrail follows a flight's pitch,
 * which is a rotation about the horizontal - so this is the one function here
 * that is new rather than moved, and it is the smallest possible piece of
 * evidence that the extraction was worth doing at all: the alternative was a
 * near-copy of `rotateAboutY` in a file about stairs.
 *
 * Signs match `rotateAboutY`'s convention: a positive angle takes +y toward +z.
 *
 * @param {number[]} positions
 * @param {number[]} normals
 * @param {number} angle Radians.
 */
export function rotateAboutX(positions, normals, angle)
{
	var cos = Math.cos(angle);
	var sin = Math.sin(angle);
	for (var i = 0; i < positions.length; i += 3)
	{
		var y = positions[i + 1];
		var z = positions[i + 2];
		positions[i + 1] = y * cos - z * sin;
		positions[i + 2] = y * sin + z * cos;
		var ny = normals[i + 1];
		var nz = normals[i + 2];
		normals[i + 1] = ny * cos - nz * sin;
		normals[i + 2] = ny * sin + nz * cos;
	}
}

/**
 * Rotate positions and normals about the z axis, in place.
 *
 * The third of these, added by RM-010 G2 for a gable's slopes. F1 needed the
 * vertical axis for a door's swing, F3 the horizontal for a handrail's pitch,
 * and a roof slope falls about whichever horizontal axis its ridge does not run
 * along - so the third was the one that made the set complete rather than
 * arbitrary.
 *
 * Signs match the other two: a positive angle takes +x toward +y.
 *
 * @param {number[]} positions
 * @param {number[]} normals
 * @param {number} angle Radians.
 */
export function rotateAboutZ(positions, normals, angle)
{
	var cos = Math.cos(angle);
	var sin = Math.sin(angle);
	for (var i = 0; i < positions.length; i += 3)
	{
		var x = positions[i];
		var y = positions[i + 1];
		positions[i] = x * cos - y * sin;
		positions[i + 1] = x * sin + y * cos;
		var nx = normals[i];
		var ny = normals[i + 1];
		normals[i] = nx * cos - ny * sin;
		normals[i + 1] = nx * sin + ny * cos;
	}
}

/**
 * Append one flat polygon as a triangle fan, with one normal.
 *
 * Boxes cover almost everything this application generates; a roof's slopes are
 * the exception, because a hip's are trapezoids and triangles rather than
 * cuboids. A fan rather than an ear-clip because every face a roof produces is
 * convex by construction - four points at most, and never re-entrant.
 *
 * @param {BufferSink} sink
 * @param {Array<{x: number, y: number, z: number}>} points Wound anticlockwise
 *        seen from the side the normal points at.
 * @param {{x: number, y: number, z: number}} normal
 * @param {number} materialIndex
 */
export function face(sink, points, normal, materialIndex)
{
	if (points.length < 3)
	{
		return;
	}
	var start = sink.indices.length;
	var base = sink.positions.length / 3;
	points.forEach(function (point, index)
	{
		sink.positions.push(point.x, point.y, point.z);
		sink.normals.push(normal.x, normal.y, normal.z);
		sink.uvs.push(index / (points.length - 1), index % 2);
	});
	for (var i = 1; i < points.length - 1; i++)
	{
		sink.indices.push(base, base + i, base + i + 1);
	}
	sink.groups.push({start: start, count: sink.indices.length - start, material: materialIndex});
}

/**
 * Append one buffer sink into another, offset.
 *
 * @param {BufferSink} sink
 * @param {BufferSink} part
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 */
export function appendInto(sink, part, dx, dy, dz)
{
	var base = sink.positions.length / 3;
	var indexBase = sink.indices.length;
	for (var i = 0; i < part.positions.length; i += 3)
	{
		sink.positions.push(part.positions[i] + dx, part.positions[i + 1] + dy, part.positions[i + 2] + dz);
	}
	part.normals.forEach(function (n) {sink.normals.push(n);});
	part.uvs.forEach(function (u) {sink.uvs.push(u);});
	part.indices.forEach(function (index) {sink.indices.push(index + base);});
	part.groups.forEach(function (group)
	{
		sink.groups.push({start: group.start + indexBase, count: group.count, material: group.material});
	});
}

/**
 * Turn a finished sink into a `BufferGeometry`.
 *
 * The bounding box is computed here rather than left to the first thing that
 * asks, because for a parametric item the bounding box is not a detail of
 * rendering - it is the check that the mesh agrees with the numbers it was
 * built from. M-37 reads it directly.
 *
 * @param {BufferSink} sink
 * @returns {BufferGeometry}
 */
export function finishGeometry(sink)
{
	var geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(sink.positions), 3));
	geometry.setAttribute('normal', new BufferAttribute(new Float32Array(sink.normals), 3));
	geometry.setAttribute('uv', new BufferAttribute(new Float32Array(sink.uvs), 2));
	geometry.setIndex(sink.indices);
	sink.groups.forEach(function (group)
	{
		geometry.addGroup(group.start, group.count, group.material);
	});
	geometry.computeBoundingBox();
	return geometry;
}
