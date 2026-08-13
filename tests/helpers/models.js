/**
 * Loading glTF models headlessly, and reading the frozen r98 measurements.
 *
 * jsdom environment only: GLTFLoader builds textures through TextureLoader,
 * which wants an <img>. The image never resolves in jsdom, and GLTFLoader waits
 * on that promise before it hands back the scene, so installImageStub() below
 * is not a nicety - without it every parse hangs.
 *
 * S4 removed the two functions that used to load the *legacy* side of S3's A/B:
 * `loadLegacyGeometry` (three's JSONLoader) and `legacyMergeMeshes` (the
 * pre-S3 merge, built on `Geometry`). Both classes are gone from r185, so that
 * comparison can no longer be re-run live. It is not lost, though: it was
 * measured under r98 and written to tests/fixtures/legacy-models-r98.json and
 * legacy-merge-r98.json by tools/capture-model-goldens.mjs, and the readers
 * below serve it to the same tests. The oracle became data instead of code.
 */
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** What three r98 measured about the 25 legacy JSON originals. */
export const LEGACY_MODEL_SHAPES = JSON.parse(
	readFileSync(join(FIXTURES, 'legacy-models-r98.json'), 'utf8'));

/** What the pre-S3 merge produced for every catalog model, under three r98. */
export const LEGACY_MERGE_RESULTS = JSON.parse(
	readFileSync(join(FIXTURES, 'legacy-merge-r98.json'), 'utf8'));

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

/**
 * Set of positions at 3dp, reduced to a size and a hash.
 *
 * Must stay byte-identical to the encoder in tools/capture-model-goldens.mjs -
 * the fixture stores the r98 side in exactly this form, and the two are
 * compared as strings.
 */
export function positionDigest(geometry)
{
	const array = geometry.attributes.position.array;
	const points = new Set();
	for (let i = 0; i < array.length; i += 3)
	{
		points.add(`${array[i].toFixed(3)},${array[i + 1].toFixed(3)},${array[i + 2].toFixed(3)}`);
	}
	const sorted = [...points].sort();
	return {size: sorted.length, hash: createHash('sha256').update(sorted.join(';')).digest('hex').slice(0, 32)};
}

/** Sorted v coordinates, run-length encoded at 4dp. Mirrors the capture tool. */
export function uvDigest(geometry)
{
	if (!geometry.attributes.uv) { return null; }
	const array = geometry.attributes.uv.array;
	const values = [];
	for (let i = 1; i < array.length; i += 2) { values.push(Math.round(array[i] * 1e4) / 1e4 + 0); }
	values.sort((a, b) => a - b);

	const runs = [];
	for (const value of values)
	{
		const last = runs[runs.length - 1];
		if (last && last[0] === value) { last[1] += 1; }
		else { runs.push([value, 1]); }
	}
	return {count: values.length, runs};
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
	const data = path.endsWith('.gltf') ? buffer.toString('utf8') : sameRealmArrayBuffer(buffer);
	return new Promise((resolve, reject) =>
	{
		new GLTFLoader().parse(data, resourcePath, resolve, reject);
	});
}

/**
 * Copy a Node Buffer into an ArrayBuffer belonging to the *test's* realm.
 *
 * r185's GLTFLoader dispatches on `data instanceof ArrayBuffer`. Under jsdom the
 * globals come from a different realm than node:fs, so a Buffer's own
 * ArrayBuffer fails that check, the loader falls through to treating the binary
 * as a parsed glTF object, and reports "Unsupported asset" - which reads like a
 * corrupt file and is nothing of the kind. r105's repack did not dispatch this
 * way, which is why S3 never hit it.
 *
 * Purely a harness concern: in a browser the loader gets its ArrayBuffer from
 * fetch, in the same realm as the page.
 */
function sameRealmArrayBuffer(buffer)
{
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return copy.buffer;
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
 * Flatten a scene with LOCAL matrices - what the merge did before S4.
 *
 * The node-transform bug in one function: a mesh under a transformed glTF node
 * was baked without its parent's transform. `mergeMeshes` now uses
 * `matrixWorld`; this reproduces the old reading so the fix can be measured
 * against it rather than asserted. Positions only, which is all the bounds
 * comparison needs.
 */
export function mergeWithLocalMatrices(root)
{
	const chunks = [];
	root.traverse((child) =>
	{
		if (child.type !== 'Mesh') { return; }
		const flat = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
		child.updateMatrix();
		flat.applyMatrix4(child.matrix);
		chunks.push(flat.attributes.position.array);
	});

	const joined = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
	let cursor = 0;
	for (const chunk of chunks) { joined.set(chunk, cursor); cursor += chunk.length; }

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(joined, 3));
	return geometry;
}
