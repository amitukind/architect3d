/**
 * Loading legacy JSON and glTF models headlessly, for the sprint-S3 A/B tests.
 *
 * jsdom environment only: GLTFLoader builds textures through TextureLoader,
 * which wants an <img>. The image never resolves in jsdom, and GLTFLoader waits
 * on that promise before it hands back the scene, so installImageStub() below
 * is not a nicety - without it every parse hangs.
 */
import * as THREE from 'three';
import GLTFLoader from 'three-gltf-loader';
import {readFileSync} from 'node:fs';

/**
 * Make ImageLoader resolve immediately with a 1x1 placeholder.
 *
 * Geometry, materials, sampler settings and texture wiring are all unaffected;
 * only the pixels are absent, and no test here looks at pixels.
 */
export function installImageStub()
{
	const original = THREE.ImageLoader.prototype.load;
	THREE.ImageLoader.prototype.load = function (url, onLoad)
	{
		const image = {width: 1, height: 1, src: url};
		if (onLoad)
		{
			setTimeout(() => onLoad(image), 0);
		}
		return image;
	};
	return () => {THREE.ImageLoader.prototype.load = original;};
}

/** The legacy three.js JSON model, as the pre-S3 app parsed it. */
export function loadLegacyGeometry(path)
{
	const json = JSON.parse(readFileSync(path, 'utf8'));
	// parse() inverts json.scale in place and reaches for a DOM to build
	// textures; a copy without materials avoids both.
	const {geometry} = new THREE.JSONLoader().parse({...json, materials: []}, '');
	return new THREE.BufferGeometry().fromGeometry(geometry);
}

/** The legacy model's material definitions, straight out of the file. */
export function loadLegacyMaterials(path)
{
	return JSON.parse(readFileSync(path, 'utf8')).materials || [];
}

/** Parse a .glb / .gltf off disk through the loader the app itself uses. */
export function loadGltf(path, resourcePath)
{
	const buffer = readFileSync(path);
	const data = path.endsWith('.gltf')
		? buffer.toString('utf8')
		: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	return new Promise((resolve, reject) =>
	{
		new GLTFLoader().parse(data, resourcePath, resolve, reject);
	});
}

/* ------------------------------------------------------- geometry measures */

/** Axis-aligned bounds of a position attribute, as six numbers. */
export function boundsOf(geometry)
{
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

/** Triangles in a BufferGeometry, indexed or not. */
export function triangleCount(geometry)
{
	return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

/**
 * Total surface area.
 *
 * An order-independent shape invariant: the conversion re-welds and re-indexes
 * the mesh, so vertex order legitimately changes, but the set of triangles must
 * not. Area catches a dropped, duplicated or mis-transformed triangle in a way
 * that a bounding box alone would not.
 */
export function surfaceArea(geometry)
{
	const position = geometry.attributes.position.array;
	const index = geometry.index ? geometry.index.array : null;
	const count = index ? index.length : position.length / 3;
	const at = (i) =>
	{
		const v = (index ? index[i] : i) * 3;
		return [position[v], position[v + 1], position[v + 2]];
	};

	let area = 0;
	for (let i = 0; i < count; i += 3)
	{
		const [ax, ay, az] = at(i);
		const [bx, by, bz] = at(i + 1);
		const [cx, cy, cz] = at(i + 2);
		const ux = bx - ax, uy = by - ay, uz = bz - az;
		const vx = cx - ax, vy = cy - ay, vz = cz - az;
		const nx = uy * vz - uz * vy;
		const ny = uz * vx - ux * vz;
		const nz = ux * vy - uy * vx;
		area += Math.sqrt(nx * nx + ny * ny + nz * nz) * 0.5;
	}
	return area;
}

/**
 * The merge Scene.addItem performed before S3, reconstructed verbatim.
 *
 * Kept so the BufferGeometry rewrite can be diffed against the thing it
 * replaced across the whole catalog, rather than argued about. Uses the legacy
 * `Geometry` class, which still exists in r98 and disappears in S4 along with
 * this function.
 */
export function legacyMergeMeshes(root)
{
	const materials = [];
	const geometry = new THREE.Geometry();

	const addToMaterials = (newMaterial) =>
	{
		for (let i = 0; i < materials.length; i++)
		{
			if (materials[i].name === newMaterial.name)
			{
				return i;
			}
		}
		materials.push(newMaterial);
		return materials.length - 1;
	};

	root.traverse((child) =>
	{
		if (child.type !== 'Mesh')
		{
			return;
		}
		const indices = [];
		if (child.material.length)
		{
			for (let k = 0; k < child.material.length; k++)
			{
				indices.push(addToMaterials(child.material[k]));
			}
		}
		else
		{
			indices.push(addToMaterials(child.material));
		}

		if (child.geometry.isBufferGeometry)
		{
			const converted = new THREE.Geometry().fromBufferGeometry(child.geometry);
			converted.faces.forEach((face) => {face.materialIndex = indices[face.materialIndex];});
			child.updateMatrix();
			geometry.merge(converted, child.matrix);
		}
		else
		{
			child.geometry.faces.forEach((face) => {face.materialIndex = indices[face.materialIndex];});
			child.updateMatrix();
			geometry.mergeMesh(child);
		}
	});

	return {geometry: new THREE.BufferGeometry().fromGeometry(geometry), materials};
}
