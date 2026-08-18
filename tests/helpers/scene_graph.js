/**
 * Describing a three scene precisely enough to diff two of them (RM-003 A2).
 *
 * ## What this is for
 *
 * A2 replaced "tear the 3D view down and build it again" with "change the parts
 * that changed". That is only worth doing if the two produce the same picture,
 * and "the same picture" has to mean something checkable in a headless test.
 * This turns a scene into a sorted list of strings - one per mesh, naming its
 * geometry, its material and where it sits - so `expect(a).toEqual(b)` is a real
 * comparison and a failure names the mesh that differs.
 *
 * The counterpart in chromium is `tests/browser/viewer-webgl.test.js`, which
 * compares actual pixels. This suite proves the scene graph is the same; that
 * one proves it renders the same.
 *
 * ## Why the comparison is order-insensitive
 *
 * The list is sorted, so two scenes holding the same meshes in a different order
 * compare equal. That is deliberate rather than a weakening: `scene.children`
 * order is not observable in a render - three sorts opaque geometry front to
 * back and transparent back to front, by depth, every frame - and the
 * incremental path necessarily adds meshes in the order it discovers changes.
 * Requiring insertion order would fail on a difference nobody can see.
 *
 * Order that IS observable is asserted separately and directly: the projection's
 * public `floors` and `edges` arrays follow the model's own order, and the
 * suite checks that.
 *
 * ## Precision
 *
 * Positions are rounded to four decimals, which is well below anything visible
 * in centimetres and well above the float noise two different call orders
 * produce. A geometry is summarised by its vertex count, its bounding box and a
 * checksum over every position - so a wall that moved by a millimetre differs,
 * and a wall rebuilt identically does not.
 */

import {textureUrlOf} from '../../src/scripts/three/texture_cache.js';

/** @param {number} value */
function round(value, places = 4)
{
	if (!Number.isFinite(value))
	{
		return String(value);
	}
	const factor = Math.pow(10, places);
	return String(Math.round(value * factor) / factor);
}

/**
 * A cheap order-sensitive checksum over a float array.
 *
 * Not a cryptographic hash and does not need to be: it is comparing two arrays
 * that either came out of the same arithmetic or did not. Mixing the index in is
 * what makes it order-sensitive, so two geometries with the same vertices wound
 * the other way do not collide.
 *
 * @param {ArrayLike<number>} values
 */
function checksum(values)
{
	let hash = 0x811c9dc5;
	for (let i = 0; i < values.length; i++)
	{
		// Quantise before hashing, or float noise below the visible threshold
		// produces a different checksum for a mesh nobody could tell apart.
		const quantised = Math.round(values[i] * 10000);
		hash ^= (quantised + i * 0x9e3779b1) | 0;
		hash = Math.imul(hash, 0x01000193) | 0;
	}
	return (hash >>> 0).toString(16);
}

/** @param {import('three').BufferGeometry} geometry */
function describeGeometry(geometry)
{
	if (!geometry)
	{
		return 'nogeometry';
	}
	const position = geometry.getAttribute ? geometry.getAttribute('position') : null;
	if (!position)
	{
		return `${geometry.type}:noposition`;
	}
	const parts = [geometry.type, position.count, checksum(position.array)];
	const index = geometry.getIndex ? geometry.getIndex() : null;
	if (index)
	{
		parts.push(`idx${index.count}:${checksum(index.array)}`);
	}
	return parts.join(':');
}

/**
 * A texture's identity across two independently built scenes.
 *
 * The URL, not any uuid. `Texture.uuid` is useless here - every clone the cache
 * hands out has its own - and `source.uuid`, which every clone of one URL does
 * share, is only stable while that cache entry stays alive. Two runs of the same
 * scene, one after the other, release the entry between them and get a fresh
 * master with a fresh source uuid, so a comparison built on it reports every
 * texture as different for a reason that has nothing to do with the picture.
 *
 * The URL is what "is this the same image?" actually means, and `textureUrlOf`
 * is how the cache answers it. `texture.image` is not an alternative: it is null
 * until the decode lands, and in a headless environment it is null forever.
 * `source.uuid` remains the fallback for a texture built outside the cache.
 *
 * @param {?import('three').Texture} texture
 */
function describeTexture(texture, label)
{
	if (!texture)
	{
		return `${label}=none`;
	}
	const identity = textureUrlOf(texture)
		|| (texture.source ? texture.source.uuid : 'nosource');
	const repeat = texture.repeat ? `${round(texture.repeat.x)},${round(texture.repeat.y)}` : '-';
	return `${label}=${identity}/${repeat}/${texture.colorSpace || '-'}`;
}

/** @param {import('three').Material} material */
function describeMaterial(material)
{
	if (!material)
	{
		return 'nomaterial';
	}
	if (Array.isArray(material))
	{
		return `[${material.map(describeMaterial).join('|')}]`;
	}
	const any = /** @type {any} */(material);
	const parts = [
		material.type,
		any.color ? any.color.getHexString() : '-',
		`side=${material.side}`,
		`op=${round(material.opacity, 3)}`,
		`tr=${material.transparent ? 1 : 0}`,
		`vis=${material.visible ? 1 : 0}`,
		`wire=${any.wireframe ? 1 : 0}`,
		describeTexture(any.map, 'map'),
		describeTexture(any.lightMap, 'light'),
	];
	if (any.roughness !== undefined)
	{
		parts.push(`rough=${round(any.roughness, 3)}`);
	}
	if (any.metalness !== undefined)
	{
		parts.push(`metal=${round(any.metalness, 3)}`);
	}
	return parts.join(' ');
}

/** @param {import('three').Object3D} object */
function describeTransform(object)
{
	const p = object.position;
	const r = object.rotation;
	const s = object.scale;
	return `pos(${round(p.x)},${round(p.y)},${round(p.z)}) ` +
		`rot(${round(r.x)},${round(r.y)},${round(r.z)}) ` +
		`scl(${round(s.x)},${round(s.y)},${round(s.z)})`;
}

/**
 * Every mesh in a scene, as a sorted list of descriptions.
 *
 * @param {import('three').Object3D} root
 * @returns {string[]}
 */
export function describeScene(root)
{
	/** @type {string[]} */
	const out = [];
	root.traverse((object) => {
		const mesh = /** @type {any} */(object);
		if (!mesh.isMesh)
		{
			return;
		}
		out.push([
			`visible=${object.visible ? 1 : 0}`,
			describeTransform(object),
			describeGeometry(mesh.geometry),
			describeMaterial(mesh.material),
		].join(' | '));
	});
	return out.sort();
}

/**
 * How many meshes a scene holds, without describing them.
 * @param {import('three').Object3D} root
 */
export function meshCount(root)
{
	let count = 0;
	root.traverse((object) => {
		if (/** @type {any} */(object).isMesh)
		{
			count++;
		}
	});
	return count;
}
