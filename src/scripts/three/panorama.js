// @ts-check
import {PerspectiveCamera, Vector2, Vector3} from 'three';
import {CUBE_FACES, projectEquirectangular} from '../core/equirect.js';

/**
 * A 360 degree photograph, taken from a point in the design (RM-011 H3).
 *
 * RM-011 W-11 grepped the tree and found **no cube camera and no
 * equirectangular path anywhere in it**, which is why the sprint priced this as
 * construction rather than as a setting. This is the half that needs a GPU;
 * `core/equirect.js` is the half that does not, and the two share one table.
 *
 * ## Six cameras of our own, from three's own vectors
 *
 * three ships a `CubeCamera`, and this does not use it. Not because it is
 * wrong - the six orientations in `CUBE_FACES` are copied from it, and
 * `tests/panorama.test.js` builds one and asserts they still agree - but
 * because of where a `CubeCamera` renders to. It renders into a
 * `WebGLCubeRenderTarget`, and three applies **neither tone mapping nor the
 * output colour space** when the destination is a render target: read
 * `WebGLPrograms.getParameters`, where `toneMapping` is forced to `NoToneMapping`
 * and `outputColorSpace` to the working space unless `currentRenderTarget` is
 * null. The studio profile renders through `ACESFilmicToneMapping`, so a cube
 * target would hand back six faces that are not what the screen shows - and a
 * panorama that does not match the view it was taken from is a bug that looks
 * like a colour preference.
 *
 * So the six faces are rendered **to the canvas**, one at a time, through the
 * same call a frame makes. Tone mapping, exposure and sRGB are then the screen's
 * by construction rather than by re-implementation - the alternative was a
 * full-screen pass duplicating three's ACES and sRGB chunks by hand, which is
 * exactly the kind of copy that drifts a version later and goes wrong quietly.
 *
 * The cost of that choice is one real limitation, stated rather than hidden:
 * **the panorama has no post-processing**, so H2's ambient occlusion is absent
 * from it. That is not only a shortcut. Screen-space occlusion is computed from
 * one frame's depth buffer, so each 90 degree face would occlude against its own
 * view and the six results would not agree along the seams - a panorama with
 * six visible edges is worse than one without the effect.
 *
 * ## Reading the pixels back
 *
 * `gl.readPixels` on the default framebuffer, which is unambiguous in a way that
 * reading a cube face is not: the origin is the lower left, so row 0 of the
 * buffer is the **bottom** of the picture. The flip happens here, once, and
 * everything downstream of it is in picture order - `core/equirect.js` says so
 * in its first paragraph and never has to know GL exists.
 *
 * The read has to happen in the same task as the render. The context is created
 * without `preserveDrawingBuffer`, so the buffer is valid until the browser
 * composites, which is the same constraint H2's `Main.dataUrl` already works
 * under and the reason neither of them can await anything in the middle.
 */

/**
 * The edge of one cube face, in pixels.
 *
 * 1024 with the 4096-wide default below, which is the ratio the projection's
 * sampling assumes: 90 degrees over 1024 pixels is 360 over 4096, so a face is
 * never coarser than the output asks for. See `core/equirect.js`.
 */
export const PANORAMA_FACE_SIZE = 1024;

/** The default output width. The height is always half of it. */
export const PANORAMA_WIDTH = 4096;

/**
 * The six cameras, built from the one table `core/equirect.js` also projects by.
 *
 * A 90 degree vertical field of view on a square frame is 90 degrees
 * horizontally as well, which is what makes six of them a closed sphere with no
 * overlap and no gap.
 *
 * @param {number} near
 * @param {number} far
 * @returns {Array<PerspectiveCamera>} In `CUBE_FACES` order.
 */
export function panoramaCameras(near, far)
{
	return CUBE_FACES.map(function (face)
	{
		var camera = new PerspectiveCamera(90, 1, near, far);
		camera.up.set(face.up[0], face.up[1], face.up[2]);
		camera.lookAt(new Vector3(face.forward[0], face.forward[1], face.forward[2]));
		camera.updateMatrixWorld();
		return camera;
	});
}

/**
 * Render the six faces around a point and read them back.
 *
 * The renderer's size and pixel ratio are restored in a `finally` for the reason
 * H2's photo capture spells out: a `readPixels` that throws would otherwise
 * leave the viewer drawing into a square buffer for the rest of the session.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {{x: number, y: number, z: number}} position Where to stand.
 * @param {{size?: number, near?: number, far?: number}} [options]
 * @returns {{faces: Array<Uint8Array>, size: number}} Faces in `CUBE_FACES`
 *   order, RGBA, row 0 at the top.
 */
export function capturePanoramaFaces(renderer, scene, position, options)
{
	var settings = options || {};
	var size = Math.max(1, Math.floor(settings.size || PANORAMA_FACE_SIZE));
	// The GPU's own ceiling, asked for rather than assumed - the same read H2's
	// photo capture makes, and for the same reason: a buffer past the limit is
	// not refused loudly, it is refused silently and comes back black.
	var limit = (renderer.capabilities && renderer.capabilities.maxTextureSize) || 4096;
	size = Math.min(size, limit);

	var cameras = panoramaCameras(settings.near || 10, settings.far || 10000);
	var gl = renderer.getContext();
	var restoreRatio = renderer.getPixelRatio();
	var restoreSize = renderer.getSize(new Vector2());
	var faces = [];

	try
	{
		// Ratio 1 so the drawing buffer is exactly `size` square, and
		// `updateStyle: false` so the canvas does not visibly resize while six
		// frames are taken through it.
		renderer.setPixelRatio(1);
		renderer.setSize(size, size, false);
		renderer.setRenderTarget(null);

		cameras.forEach(function (camera)
		{
			camera.position.set(position.x, position.y, position.z);
			camera.updateMatrixWorld();
			renderer.render(scene, camera);

			var buffer = new Uint8Array(size * size * 4);
			gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
			faces.push(flipRows(buffer, size));
		});
	}
	finally
	{
		renderer.setPixelRatio(restoreRatio);
		renderer.setSize(restoreSize.x, restoreSize.y, false);
	}

	return {faces: faces, size: size};
}

/**
 * Turn a bottom-up GL read into a top-down picture.
 *
 * @param {Uint8Array} buffer `size * size` RGBA bytes, row 0 at the bottom.
 * @param {number} size
 * @returns {Uint8Array} The same bytes, row 0 at the top.
 */
export function flipRows(buffer, size)
{
	var stride = size * 4;
	var out = new Uint8Array(buffer.length);
	for (var row = 0; row < size; row++)
	{
		out.set(buffer.subarray((size - 1 - row) * stride, (size - row) * stride), row * stride);
	}
	return out;
}

/**
 * A panorama, as RGBA pixels.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {{x: number, y: number, z: number}} position
 * @param {{width?: number, size?: number, near?: number, far?: number}} [options]
 * @returns {{pixels: Uint8ClampedArray, width: number, height: number}}
 */
export function capturePanorama(renderer, scene, position, options)
{
	var settings = options || {};
	var width = Math.max(4, Math.floor((settings.width || PANORAMA_WIDTH) / 2) * 2);
	// The face size follows the output unless it was asked for: four faces span
	// the 360 degrees the width covers.
	var captured = capturePanoramaFaces(renderer, scene, position, {
		size: settings.size || Math.max(1, Math.round(width / 4)),
		near: settings.near,
		far: settings.far,
	});
	var pixels = projectEquirectangular(captured.faces, captured.size, width);
	return {pixels: pixels, width: width, height: width / 2};
}

/**
 * A panorama, as a PNG data URL.
 *
 * Opaque, unconditionally. The renderer is constructed with `alpha: true` and
 * clears to opaque white, so the alpha that comes back is already 255 - but a
 * photograph of a place is not a thing with holes in it, and an export whose
 * transparency depends on what happened to be in front of the sky is an export
 * that behaves differently in two viewers for no reason a reader could predict.
 *
 * @param {{pixels: Uint8ClampedArray, width: number, height: number}} panorama
 * @returns {string} A PNG data URL, or an empty string with no 2D context.
 */
export function panoramaDataUrl(panorama)
{
	var canvas = document.createElement('canvas');
	canvas.width = panorama.width;
	canvas.height = panorama.height;
	var context = canvas.getContext('2d');
	if (!context)
	{
		return '';
	}
	var image = context.createImageData(panorama.width, panorama.height);
	image.data.set(panorama.pixels);
	for (var i = 3; i < image.data.length; i += 4)
	{
		image.data[i] = 255;
	}
	context.putImageData(image, 0, 0);
	return canvas.toDataURL('image/png');
}
