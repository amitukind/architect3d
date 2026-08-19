// @vitest-environment jsdom
/**
 * Six faces in, one equirectangular image out (RM-011 H3).
 *
 * The half of the panorama that needs no GPU, which is most of its behaviour:
 * `three/panorama.js` renders six frames and reads them back, and everything
 * that decides *where a pixel comes from* is here. What a real panorama of a
 * real room looks like is `tests/browser/panorama.test.js`.
 *
 * The values below are derived rather than pinned. A direction is checked
 * against the mapping three's own shader chunk states - `u = atan2(z, x)/2pi +
 * 0.5`, `v = asin(y)/pi + 0.5` - and a face against the camera that took it, so
 * a test failure means the projection moved rather than that a number did.
 */
import {describe, expect, it} from 'vitest';

import {
	CUBE_FACES, directionAt, pixelFor, faceSample, projectEquirectangular,
} from '../src/scripts/core/equirect.js';

/** Six faces of one flat colour each, so a projected pixel names its source. */
function solidFaces(size)
{
	return CUBE_FACES.map((face, index) =>
	{
		const bytes = new Uint8Array(size * size * 4);
		for (let i = 0; i < size * size; i++)
		{
			bytes[(i * 4)] = index * 40;
			bytes[(i * 4) + 1] = 255 - (index * 40);
			bytes[(i * 4) + 2] = index;
			bytes[(i * 4) + 3] = 255;
		}
		return bytes;
	});
}

/** The RGBA at one pixel of a projected image. */
function pixelAt(pixels, width, x, y)
{
	const at = (((y * width) + x) * 4);
	return [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]];
}

describe('the six faces', () =>
{
	it('are three\'s CubeCamera vectors, and the right vector is derived from them', () =>
	{
		expect(CUBE_FACES.map((face) => face.name)).toEqual(['+X', '-X', '+Y', '-Y', '+Z', '-Z']);

		// right = forward x up, computed by the module. Checked here against the
		// hand-worked answers, which is the one place they are written down twice
		// on purpose - a table this short is cheaper to verify than to trust.
		expect(CUBE_FACES.map((face) => face.right.join(','))).toEqual([
			'0,0,1', '0,0,-1', '-1,0,0', '-1,0,0', '-1,0,0', '1,0,0',
		]);
	});

	it('is a frozen table, so a caller cannot rotate the projection', () =>
	{
		expect(Object.isFrozen(CUBE_FACES)).toBe(true);
		expect(Object.isFrozen(CUBE_FACES[0])).toBe(true);
		expect(Object.isFrozen(CUBE_FACES[0].right)).toBe(true);
	});

	it('are orthonormal: each right is perpendicular to its own forward and up', () =>
	{
		CUBE_FACES.forEach((face) =>
		{
			const dot = (a, b) => (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
			expect(dot(face.forward, face.up), face.name).toBe(0);
			expect(dot(face.forward, face.right), face.name).toBe(0);
			expect(dot(face.up, face.right), face.name).toBe(0);
			expect(dot(face.forward, face.forward), face.name).toBe(1);
		});
	});
});

describe('where a pixel looks', () =>
{
	it('puts +X at the centre of the image, which is three\'s equirect convention', () =>
	{
		const middle = directionAt(0.5, 0.5);
		expect(middle.x).toBeCloseTo(1, 12);
		expect(middle.y).toBeCloseTo(0, 12);
		expect(middle.z).toBeCloseTo(0, 12);
	});

	it('runs +X, +Z, -X, -Z across the image', () =>
	{
		// u = atan2(z, x)/2pi + 0.5, so a quarter of the way along is +Z and the
		// edges are -X. Anticlockwise seen from above, in three's coordinates.
		expect(directionAt(0.75, 0.5).z).toBeCloseTo(1, 12);
		expect(directionAt(0.25, 0.5).z).toBeCloseTo(-1, 12);
		expect(directionAt(0, 0.5).x).toBeCloseTo(-1, 12);
		expect(directionAt(1, 0.5).x).toBeCloseTo(-1, 12);
	});

	it('puts the sky at the top row and the floor at the bottom', () =>
	{
		expect(directionAt(0.5, 0).y).toBeCloseTo(1, 12);
		expect(directionAt(0.5, 1).y).toBeCloseTo(-1, 12);
	});

	it('round-trips through pixelFor for every corner of the image', () =>
	{
		[[0.1, 0.2], [0.5, 0.5], [0.9, 0.8], [0.33, 0.07]].forEach(([u, v]) =>
		{
			const back = pixelFor(directionAt(u, v));
			expect(back.u).toBeCloseTo(u, 12);
			expect(back.v).toBeCloseTo(v, 12);
		});
	});

	it('returns unit vectors', () =>
	{
		for (let u = 0; u <= 1; u += 0.125)
		{
			for (let v = 0; v <= 1; v += 0.125)
			{
				const d = directionAt(u, v);
				expect(Math.sqrt((d.x * d.x) + (d.y * d.y) + (d.z * d.z))).toBeCloseTo(1, 12);
			}
		}
	});
});

describe('which face a direction is on', () =>
{
	it('puts each face\'s own forward at the centre of that face', () =>
	{
		CUBE_FACES.forEach((face, index) =>
		{
			const hit = faceSample({x: face.forward[0], y: face.forward[1], z: face.forward[2]});
			expect(hit.face, face.name).toBe(index);
			expect(hit.s, face.name).toBeCloseTo(0.5, 12);
			expect(hit.t, face.name).toBeCloseTo(0.5, 12);
		});
	});

	it('runs its up vector toward the top of the frame and its right toward the right', () =>
	{
		CUBE_FACES.forEach((face, index) =>
		{
			// Half a unit off the axis rather than a full one. `forward + up` is 45
			// degrees, which is exactly the shared edge of two faces and so a tie -
			// deterministic, and no use for saying which way up a face is. Half of
			// it is unambiguously inside, and the answer is an exact quarter, which
			// checks the perspective divide rather than just the sign.
			const up = faceSample({
				x: face.forward[0] + (face.up[0] / 2),
				y: face.forward[1] + (face.up[1] / 2),
				z: face.forward[2] + (face.up[2] / 2),
			});
			expect(up.face, face.name).toBe(index);
			expect(up.t, face.name).toBeCloseTo(0.25, 12);
			expect(up.s, face.name).toBeCloseTo(0.5, 12);

			const right = faceSample({
				x: face.forward[0] + (face.right[0] / 2),
				y: face.forward[1] + (face.right[1] / 2),
				z: face.forward[2] + (face.right[2] / 2),
			});
			expect(right.face, face.name).toBe(index);
			expect(right.s, face.name).toBeCloseTo(0.75, 12);
			expect(right.t, face.name).toBeCloseTo(0.5, 12);
		});
	});

	it('resolves a direction on a shared edge to one face rather than to none', () =>
	{
		// Exactly 45 degrees between +X and +Y: both faces claim it with the same
		// dot product. The first wins, and what matters is that the answer is a
		// real pixel on a real face rather than a sample past an edge.
		const edge = faceSample({x: 1, y: 1, z: 0});
		expect([0, 2]).toContain(edge.face);
		expect(edge.s).toBeGreaterThanOrEqual(0);
		expect(edge.s).toBeLessThanOrEqual(1);
		expect(edge.t).toBeGreaterThanOrEqual(0);
		expect(edge.t).toBeLessThanOrEqual(1);
	});

	it('never lands outside a face, for any direction in the sphere', () =>
	{
		for (let u = 0; u < 1; u += 0.013)
		{
			for (let v = 0; v <= 1; v += 0.017)
			{
				const hit = faceSample(directionAt(u, v));
				expect(hit.face).toBeGreaterThanOrEqual(0);
				expect(hit.face).toBeLessThan(6);
				expect(hit.s).toBeGreaterThanOrEqual(0);
				expect(hit.s).toBeLessThanOrEqual(1);
				expect(hit.t).toBeGreaterThanOrEqual(0);
				expect(hit.t).toBeLessThanOrEqual(1);
			}
		}
	});

	it('does not need a normalised direction', () =>
	{
		const near = faceSample({x: 1, y: 0.3, z: -0.2});
		const far = faceSample({x: 1000, y: 300, z: -200});
		expect(far.face).toBe(near.face);
		expect(far.s).toBeCloseTo(near.s, 12);
		expect(far.t).toBeCloseTo(near.t, 12);
	});
});

describe('the projection', () =>
{
	it('reads the face the direction points at, at every pixel', () =>
	{
		const size = 8;
		const width = 32;
		const pixels = projectEquirectangular(solidFaces(size), size, width);
		expect(pixels).toHaveLength(width * (width / 2) * 4);

		for (let y = 0; y < width / 2; y++)
		{
			for (let x = 0; x < width; x++)
			{
				const expected = faceSample(directionAt((x + 0.5) / width, (y + 0.5) / (width / 2))).face;
				expect(pixelAt(pixels, width, x, y), `${x},${y}`)
					.toEqual([expected * 40, 255 - (expected * 40), expected, 255]);
			}
		}
	});

	it('puts +Y across the top row and -Y across the bottom', () =>
	{
		const pixels = projectEquirectangular(solidFaces(4), 4, 16);
		for (let x = 0; x < 16; x++)
		{
			expect(pixelAt(pixels, 16, x, 0)[2], `top ${x}`).toBe(2);
			expect(pixelAt(pixels, 16, x, 7)[2], `bottom ${x}`).toBe(3);
		}
	});

	it('is 2:1, and rounds an odd width down to something that halves', () =>
	{
		const odd = projectEquirectangular(solidFaces(4), 4, 15);
		expect(odd).toHaveLength(14 * 7 * 4);
	});

	it('samples the position within a face, not just the face', () =>
	{
		// One face carrying a gradient along its rows: the top of the +X face must
		// come out above the bottom of it, which is the assertion that catches a
		// projection that is upside down.
		const size = 16;
		const faces = solidFaces(size);
		for (let row = 0; row < size; row++)
		{
			for (let column = 0; column < size; column++)
			{
				faces[0][(((row * size) + column) * 4) + 1] = row * 16;
			}
		}
		const width = 64;
		const pixels = projectEquirectangular(faces, size, width);
		// Column 32 is u = 0.5, dead ahead along +X. Rows 20 and 12 are above and
		// below the horizon, which sits at row 16 of 32.
		const above = pixelAt(pixels, width, 32, 12)[1];
		const below = pixelAt(pixels, width, 32, 20)[1];
		expect(above).toBeLessThan(below);
	});

	it('refuses a set that is not six faces, or a face that is too small', () =>
	{
		expect(() => projectEquirectangular(solidFaces(4).slice(0, 5), 4, 16))
			.toThrow(/needs 6 faces/);
		expect(() => projectEquirectangular(/** @type {any} */ (null), 4, 16))
			.toThrow(/needs 6 faces/);

		const short = solidFaces(4);
		short[3] = new Uint8Array(4);
		expect(() => projectEquirectangular(short, 4, 16)).toThrow(/-Y is 4 bytes/);
	});
});
