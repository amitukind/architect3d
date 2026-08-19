// @ts-check
import {RepeatWrapping, NoColorSpace} from 'three';
import {acquireTexture, releaseTexture} from './texture_cache.js';

/**
 * Turning a surface's description into what three needs (RM-011 H1).
 *
 * `model/surface.js` says what a surface is made of; this is the one place that
 * turns those numbers into texture state and extra maps. Two callers - `Edge`
 * and `Floor` - which is the reason it is a module rather than a method on
 * either of them: the rotation and offset of a wall's texture and of a floor's
 * are the same arithmetic, and F3 already established what happens when the
 * same arithmetic is written twice.
 *
 * ## The two maps are cached like every other texture
 *
 * Through `texture_cache`, which means a normal map shared by four walls is one
 * decode and one upload - the same property RM-002 R-04 established for the
 * wall lightmap, and the reason `Edge` does not simply call `TextureLoader`.
 * They are released before being replaced, because the leak A0 found was
 * exactly this shape.
 *
 * ## And they are linear, not sRGB
 *
 * An albedo map is a picture and is tagged sRGB. A normal map is a vector field
 * and a roughness map is a scalar field; both are *data*, and decoding them
 * through a transfer function is the error H1's own encode trial nearly recorded
 * as a codec verdict before catching it. three's default for a new texture is
 * `NoColorSpace`, but the cache hands out clones of textures that other callers
 * have tagged sRGB, so it is set here rather than assumed.
 */

/**
 * Point a texture at the tile the surface asked for.
 *
 * Rotation is about the centre of the tile rather than its corner, because a
 * person turning a brick bond expects it to spin in place; three's default
 * `center` is (0,0), which swings it instead.
 *
 * @param {import('three').Texture} texture
 * @param {import('../model/surface.js').SurfaceMaterial} material
 * @returns {void}
 */
export function applySurfaceTransform(texture, material)
{
	if (!texture)
	{
		return;
	}
	if (material.rotation || material.offsetX || material.offsetY)
	{
		// A rotated or offset tile has to repeat, or the sampler clamps the edge
		// it just moved off and smears one row of texels across the gap.
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
	}
	texture.center.set(0.5, 0.5);
	texture.rotation = (material.rotation * Math.PI) / 180;
	texture.offset.set(material.offsetX, material.offsetY);
	texture.needsUpdate = true;
}

/**
 * Fetch the surface's extra maps, releasing whatever it had before.
 *
 * @param {Object} runtime The document's runtime, for the asset resolver.
 * @param {import('../model/surface.js').SurfaceMaterial} material
 * @param {?{normalMap: ?import('three').Texture, roughnessMap: ?import('three').Texture}} previous
 * @param {() => void} [onLoad] Called when either map lands, so the view redraws.
 * @returns {{normalMap: ?import('three').Texture, roughnessMap: ?import('three').Texture}}
 */
export function acquireSurfaceMaps(runtime, material, previous, onLoad)
{
	var held = previous || {normalMap: null, roughnessMap: null};
	var next = {normalMap: null, roughnessMap: null};

	['normalMap', 'roughnessMap'].forEach(function (slot)
	{
		releaseTexture(held[slot]);
		var url = material[slot];
		if (!url)
		{
			return;
		}
		var texture = acquireTexture(runtime.assets.resolve(url).url, onLoad);
		// Data, not colour - see the module comment.
		texture.colorSpace = NoColorSpace;
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		applySurfaceTransform(texture, material);
		next[slot] = texture;
	});

	return next;
}

/**
 * Hand both maps back, for a caller being disposed.
 *
 * @param {?{normalMap: ?import('three').Texture, roughnessMap: ?import('three').Texture}} maps
 * @returns {void}
 */
export function releaseSurfaceMaps(maps)
{
	if (!maps)
	{
		return;
	}
	releaseTexture(maps.normalMap);
	releaseTexture(maps.roughnessMap);
}
