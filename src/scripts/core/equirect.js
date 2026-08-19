// @ts-check
/**
 * Six square faces in, one equirectangular image out (RM-011 H3).
 *
 * ## What this is and is not
 *
 * It is the *projection*: the arithmetic that decides, for every pixel of a
 * 2:1 panorama, which of six cube faces to read and where. It holds no three.js
 * types, allocates no GPU memory and never sees a renderer - `three/panorama.js`
 * captures the faces and calls this, and this reads nothing above it. Same
 * one-way arrow `model/sun.js` sits behind, and for the same reason: the half of
 * a feature that is pure arithmetic is the half that can be tested exactly, and
 * putting it behind a WebGL context would mean testing it by looking at it.
 *
 * It is **not** a cube-map sampler in the OpenGL sense. The GL cube-map
 * convention is a left-handed layout with its own per-face flips, and reasoning
 * from it means reasoning about a spec rather than about the cameras that
 * actually took the pictures. So the face basis below is **derived from three's
 * own `CubeCamera` orientations** - the six `lookAt`/`up` pairs in
 * `CubeCamera.updateCoordinateSystem()` - and the right vector is computed here
 * rather than typed, which means a reader can check it and a change in three
 * would show up as a failing test rather than as a rotated panorama.
 *
 * ## The convention, stated once
 *
 * A **face** is RGBA bytes, row 0 at the **top** of the picture the camera took,
 * column 0 at its **left**. That is not what `readRenderTargetPixels` hands back
 * - GL reads bottom-up - and the flip belongs to the capture, which is the only
 * part that knows it is talking to GL. Everything here is in picture order.
 *
 * The **output** follows three's own equirectangular mapping, the `equirectUv`
 * in its shader chunks: `u = atan2(z, x) / 2pi + 0.5`, `v = asin(y) / pi + 0.5`,
 * with row 0 of the image at `v = 1`. Nothing here invents a convention, and the
 * payoff is concrete rather than tidy: a panorama this writes can be loaded
 * straight back in as an `EquirectangularReflectionMapping` texture and will
 * line up with the scene it was taken in.
 *
 * So the centre column of the image looks along **+X**, and the image runs
 * anticlockwise from there when seen from above. North is not built in - a
 * design's north is `Model.north`, and a viewer that wants to label the image
 * can rotate by it.
 *
 * ## Nearest neighbour, and why that is enough
 *
 * Sampling is nearest. It would be undersampling if a face were ever coarser
 * than the output asks for, so the default sizing makes that impossible: a face
 * spans 90 degrees over `size` pixels and the output spans 360 over `width`, so
 * at `width = 4 * size` the two match exactly at the centre of a face - and
 * everywhere else on a face a perspective projection is *denser* than at its
 * centre, never sparser. Bilinear would need neighbouring faces at every seam to
 * avoid a visible edge, which is real work to buy a difference that only exists
 * where the sampling is already adequate.
 */

/**
 * @typedef {Object} CubeFace
 * @property {string} name Human-readable, and what a failing test prints.
 * @property {ReadonlyArray<number>} forward Where that face's camera looked.
 * @property {ReadonlyArray<number>} up That camera's up vector.
 * @property {ReadonlyArray<number>} right Derived: `forward` x `up`.
 */

/** `a` x `b`, for three-element arrays. */
function cross(a, b)
{
	return [
		a[1] * b[2] - a[2] * b[1],
		a[2] * b[0] - a[0] * b[2],
		a[0] * b[1] - a[1] * b[0],
	];
}

/**
 * The six cameras, in the order a `WebGLCubeRenderTarget` stores them.
 *
 * Copied from `CubeCamera.updateCoordinateSystem()` for `WebGLCoordinateSystem`
 * - the branch a `WebGLRenderer` takes. The `right` vectors are computed, so
 * this table has six lines of input and no arithmetic to get wrong.
 *
 * @type {ReadonlyArray<CubeFace>}
 */
export const CUBE_FACES = Object.freeze([
	{name: '+X', forward: [1, 0, 0], up: [0, 1, 0]},
	{name: '-X', forward: [-1, 0, 0], up: [0, 1, 0]},
	{name: '+Y', forward: [0, 1, 0], up: [0, 0, -1]},
	{name: '-Y', forward: [0, -1, 0], up: [0, 0, 1]},
	{name: '+Z', forward: [0, 0, 1], up: [0, 1, 0]},
	{name: '-Z', forward: [0, 0, -1], up: [0, 1, 0]},
].map(function (face)
{
	return Object.freeze(Object.assign({}, face, {right: Object.freeze(cross(face.forward, face.up))}));
}));

/**
 * The same six faces, reduced to the three axis picks the inner loop needs.
 *
 * Every vector in `CUBE_FACES` is a signed unit axis, so `dot(d, v)` is one
 * signed component of `d` rather than three multiplies. Derived from the table
 * above rather than written out again: the two cannot disagree.
 */
const FACE_AXES = CUBE_FACES.map(function (face)
{
	function pick(vector)
	{
		var axis = vector.findIndex(function (value) {return value !== 0;});
		return {axis: axis, sign: vector[axis]};
	}
	return {
		forward: pick(face.forward),
		right: pick(face.right),
		up: pick(face.up),
	};
});

/**
 * The direction a pixel of the panorama looks along.
 *
 * @param {number} u Column, 0 at the left edge and 1 at the right.
 * @param {number} v Row, 0 at the **top** and 1 at the bottom.
 * @returns {{x: number, y: number, z: number}} A unit vector.
 */
export function directionAt(u, v)
{
	// three's `equirectUv` reads v from the bottom; an image row counts from the
	// top. One subtraction, here, rather than a sign flipped somewhere later.
	var theta = (u - 0.5) * Math.PI * 2;
	var phi = (0.5 - v) * Math.PI;
	var horizontal = Math.cos(phi);
	return {x: horizontal * Math.cos(theta), y: Math.sin(phi), z: horizontal * Math.sin(theta)};
}

/**
 * Where a direction lands in the panorama. The inverse of `directionAt`.
 *
 * three's `equirectUv`, with `v` turned back into an image row so the two
 * functions round-trip. Not used by the projection - it is how a test states
 * *"the wall to the east must be at this pixel"* without restating the mapping.
 *
 * @param {{x: number, y: number, z: number}} direction Need not be normalised.
 * @returns {{u: number, v: number}}
 */
export function pixelFor(direction)
{
	var length = Math.sqrt((direction.x * direction.x) + (direction.y * direction.y) + (direction.z * direction.z)) || 1;
	var u = (Math.atan2(direction.z / length, direction.x / length) / (Math.PI * 2)) + 0.5;
	var v = 0.5 - (Math.asin(Math.max(-1, Math.min(1, direction.y / length))) / Math.PI);
	return {u: u, v: v};
}

/**
 * Which face a direction is on, and where on it.
 *
 * @param {{x: number, y: number, z: number}} direction Need not be normalised.
 * @returns {{face: number, s: number, t: number}} `face` indexes `CUBE_FACES`;
 *   `s` runs left to right and `t` runs **top to bottom**, both in 0..1.
 */
export function faceSample(direction)
{
	var d = [direction.x, direction.y, direction.z];
	// The major axis: the face whose camera is pointing most nearly at `d` is the
	// one whose forward has the largest dot with it, and for signed unit axes
	// that is the largest component with the matching sign.
	var face = 0;
	var best = -Infinity;
	for (var i = 0; i < FACE_AXES.length; i++)
	{
		var forward = FACE_AXES[i].forward;
		var value = d[forward.axis] * forward.sign;
		if (value > best)
		{
			best = value;
			face = i;
		}
	}
	var axes = FACE_AXES[face];
	// `best` is the distance to the face's image plane, so dividing by it is the
	// perspective divide - the same one a 90 degree camera does.
	var depth = best || Number.MIN_VALUE;
	var right = (d[axes.right.axis] * axes.right.sign) / depth;
	var up = (d[axes.up.axis] * axes.up.sign) / depth;
	return {face: face, s: (right + 1) / 2, t: (1 - up) / 2};
}

/**
 * Project six faces into one equirectangular RGBA image.
 *
 * @param {Array<Uint8Array|Uint8ClampedArray>} faces Six of them, in
 *   `CUBE_FACES` order, each `size * size` RGBA bytes in picture order.
 * @param {number} size The edge of one face, in pixels.
 * @param {number} width The output width. The height is half of it.
 * @returns {Uint8ClampedArray} `width * (width / 2)` RGBA bytes, row 0 at the top.
 */
export function projectEquirectangular(faces, size, width)
{
	if (!Array.isArray(faces) || faces.length !== CUBE_FACES.length)
	{
		throw new Error(`A panorama needs ${CUBE_FACES.length} faces, not ${faces && faces.length}.`);
	}
	var edge = Math.max(1, Math.floor(size));
	var outWidth = Math.max(2, Math.floor(width / 2) * 2);
	var outHeight = outWidth / 2;
	faces.forEach(function (face, index)
	{
		if (!face || face.length < edge * edge * 4)
		{
			throw new Error(`Face ${CUBE_FACES[index].name} is ${face && face.length} bytes, not ${edge * edge * 4}.`);
		}
	});

	var out = new Uint8ClampedArray(outWidth * outHeight * 4);
	// Hoisted out of the pixel loop: at 4096 x 2048 the inner body runs eight
	// million times, and a sine per pixel is eight million sines.
	var cosTheta = new Float64Array(outWidth);
	var sinTheta = new Float64Array(outWidth);
	for (var x = 0; x < outWidth; x++)
	{
		var theta = (((x + 0.5) / outWidth) - 0.5) * Math.PI * 2;
		cosTheta[x] = Math.cos(theta);
		sinTheta[x] = Math.sin(theta);
	}

	for (var y = 0; y < outHeight; y++)
	{
		var phi = (0.5 - ((y + 0.5) / outHeight)) * Math.PI;
		var horizontal = Math.cos(phi);
		var dy = Math.sin(phi);
		for (var column = 0; column < outWidth; column++)
		{
			var sample = faceSample({
				x: horizontal * cosTheta[column],
				y: dy,
				z: horizontal * sinTheta[column],
			});
			var source = faces[sample.face];
			// Clamped rather than wrapped: a direction exactly on a face edge lands
			// at s = 1, which is one past the last column.
			var sx = Math.min(edge - 1, Math.max(0, Math.floor(sample.s * edge)));
			var sy = Math.min(edge - 1, Math.max(0, Math.floor(sample.t * edge)));
			var from = ((sy * edge) + sx) * 4;
			var to = ((y * outWidth) + column) * 4;
			out[to] = source[from];
			out[to + 1] = source[from + 1];
			out[to + 2] = source[from + 2];
			out[to + 3] = source[from + 3];
		}
	}
	return out;
}
