// @ts-check
import {BufferAttribute, BufferGeometry} from 'three';

/**
 * Flatten a loaded model hierarchy into one BufferGeometry plus a material list.
 *
 * Added in sprint S3, replacing the legacy-Geometry merge that lived inline in
 * Scene.addItem. That version built a `Geometry`, stamped `face.materialIndex`
 * on every face and called `Geometry.merge()`; `Geometry` was removed from
 * three in r125, so this is the piece of the r185 bump that had to happen
 * first. It lands here, a sprint early, while the engine and both loaders are
 * otherwise untouched - so if a model comes out wrong, the merge is the only
 * thing that changed.
 *
 * The output shape is what a modern renderer wants: one geometry carrying
 * `groups`, and a parallel material array. `Mesh` reads group.materialIndex
 * into that array, which is exactly the job face.materialIndex used to do.
 */

/** Attributes carried through the merge. Anything else on a source mesh is dropped. */
const MERGED_ATTRIBUTES = [
	{name: 'position', itemSize: 3},
	{name: 'normal', itemSize: 3},
	{name: 'uv', itemSize: 2},
];

/**
 * Materials are pooled by name, matching what the pre-S3 code did: a model
 * whose primitives all reference one glTF material collapses to a single
 * material and a single draw call. Unnamed materials fall back to identity, so
 * they never collide with each other.
 */
function createMaterialPool()
{
	var materials = [];
	var byName = new Map();

	return {
		materials: materials,
		indexOf: function (material)
		{
			if (material.name)
			{
				if (byName.has(material.name))
				{
					return byName.get(material.name);
				}
				byName.set(material.name, materials.length);
			}
			else
			{
				var existing = materials.indexOf(material);
				if (existing !== -1)
				{
					return existing;
				}
			}
			materials.push(material);
			return materials.length - 1;
		},
	};
}

/**
 * A mesh's geometry, de-indexed and baked into world space, split into one
 * chunk per material it draws with.
 */
function chunksFor(mesh, pool)
{
	var geometry = mesh.geometry;
	if (!geometry || !geometry.attributes || !geometry.attributes.position)
	{
		return [];
	}

	// De-indexing costs a little memory and makes concatenation a copy rather
	// than an index-rebasing exercise. The models here are small enough that the
	// simplicity is worth more than the bytes.
	var flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
	if (!flat.attributes.normal)
	{
		flat.computeVertexNormals();
	}

	// mesh.matrixWorld, not mesh.matrix - fixed in S4.
	//
	// Every version of this merge before S4 baked each mesh's LOCAL matrix, so a
	// mesh sitting under a transformed glTF node was flattened without its
	// parent's transform and came out at the wrong scale or offset. It affected
	// 42 of the 168 catalog models; Duck.gltf was a factor of 100 out, which is
	// why the demo's duck was invisible unless you knew where to look.
	//
	// S3 preserved the bug on purpose, so that the switch from legacy Geometry to
	// BufferGeometry could be proved to change nothing. With that established,
	// this is the fix, and it is the only intentional visual change in S4.
	// tests/model-conversion.test.js checks the corrected bounds against
	// tests/fixtures/legacy-merge-r98.json, which records both readings for every
	// model, and tools/merge-transform-ab.html renders the 42 side by side.
	mesh.updateMatrixWorld(true);
	// applyMatrix4 runs the inverse-transpose over the normals, so this is safe
	// for the non-uniform scales the glTF nodes carry.
	flat.applyMatrix4(mesh.matrixWorld);

	var meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
	var vertexCount = flat.attributes.position.count;

	// A single-material mesh is the common case and needs no slicing.
	if (meshMaterials.length === 1 || flat.groups.length === 0)
	{
		return [{geometry: flat, materialIndex: pool.indexOf(meshMaterials[0]), start: 0, count: vertexCount}];
	}

	return flat.groups.map(function (group)
	{
		var material = meshMaterials[group.materialIndex] || meshMaterials[0];
		return {
			geometry: flat,
			materialIndex: pool.indexOf(material),
			start: group.start,
			count: (group.count === Infinity) ? vertexCount - group.start : group.count,
		};
	});
}

/**
 * @param {import('three').Object3D} root A loaded glTF scene, OBJ group, or any Object3D.
 * @returns {{geometry: BufferGeometry, materials: Array}} The geometry carries
 *          one group per material run; the array is indexed by group.materialIndex.
 */
export function mergeMeshes(root)
{
	var pool = createMaterialPool();
	var chunks = [];
	root.traverse(function (child)
	{
		if (child.isMesh)
		{
			chunks = chunks.concat(chunksFor(child, pool));
		}
	});

	var merged = new BufferGeometry();
	if (chunks.length === 0)
	{
		return {geometry: merged, materials: pool.materials};
	}

	// An attribute is carried only if some source mesh has it; the ones that do
	// not get zeros, so the buffers stay rectangular.
	var present = MERGED_ATTRIBUTES.filter(function (attribute)
	{
		return chunks.some(function (chunk) {return chunk.geometry.attributes[attribute.name] !== undefined;});
	});
	var total = chunks.reduce(function (sum, chunk) {return sum + chunk.count;}, 0);

	var buffers = {};
	present.forEach(function (attribute)
	{
		buffers[attribute.name] = new Float32Array(total * attribute.itemSize);
	});

	var offset = 0;
	chunks.forEach(function (chunk)
	{
		present.forEach(function (attribute)
		{
			var source = chunk.geometry.attributes[attribute.name];
			var target = buffers[attribute.name];
			var size = attribute.itemSize;
			if (!source)
			{
				return; // already zero-filled
			}
			for (var i = 0; i < chunk.count; i++)
			{
				for (var c = 0; c < size; c++)
				{
					target[(offset + i) * size + c] = source.array[(chunk.start + i) * size + c];
				}
			}
		});
		offset += chunk.count;
	});

	present.forEach(function (attribute)
	{
		// setAttribute; addAttribute was the r98 spelling and was removed in r125.
		merged.setAttribute(attribute.name, new BufferAttribute(buffers[attribute.name], attribute.itemSize));
	});

	// Coalesce runs so a model whose primitives all share one material ends up
	// with one draw call, not one per primitive.
	offset = 0;
	chunks.forEach(function (chunk)
	{
		var last = merged.groups[merged.groups.length - 1];
		if (last && last.materialIndex === chunk.materialIndex && last.start + last.count === offset)
		{
			last.count += chunk.count;
		}
		else
		{
			merged.addGroup(offset, chunk.count, chunk.materialIndex);
		}
		offset += chunk.count;
	});

	return {geometry: merged, materials: pool.materials};
}
