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
import {NodeIO} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS, KHRDracoMeshCompression} from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
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

/**
 * Decompress a Draco-encoded container back to plain accessors (RM-004 B1).
 *
 * three's own `DRACOLoader` cannot be used here. It fetches its decoder over
 * HTTP from a path, and under Node there is nothing to serve `public/draco/` -
 * so the loader the browser uses is not available to a headless test, and the
 * catalog became unreadable to this suite the moment it was compressed.
 *
 * `draco3dgltf` is the same decoder, callable in-process, and it is already a
 * devDependency because the encoder needs it. **The dependency is decompressed,
 * never the subject**: what this suite tests is `mergeMeshes` against frozen r98
 * goldens, and Draco is transport underneath that, exactly as
 * `Scene.setItemLoader` is transport underneath the model layer.
 *
 * Built lazily and once - constructing the WASM decoder per model turned a
 * two-second file into a thirty-second one.
 */
let decompressIO = null;
async function decompressor()
{
	if (!decompressIO)
	{
		decompressIO = new NodeIO()
			.registerExtensions(KHRONOS_EXTENSIONS)
			.registerExtensions([KHRDracoMeshCompression])
			.registerDependencies({'draco3d.decoder': await draco3d.createDecoderModule()});
	}
	return decompressIO;
}

/** True if the container declares it needs a Draco decoder. */
function needsDraco(buffer)
{
	if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) { return false; }
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			try
			{
				const json = JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
				return (json.extensionsRequired || []).indexOf('KHR_draco_mesh_compression') !== -1;
			}
			catch { return false; }
		}
		offset += 8 + length;
	}
	return false;
}

/** Parse a .glb / .gltf off disk through the loader the app itself uses. */
export async function loadGltf(path, resourcePath)
{
	let buffer = readFileSync(path);

	if (needsDraco(buffer))
	{
		const io = await decompressor();
		const document = await io.read(path);
		// Reading DECODES into plain accessors; the extension is still attached to
		// the document and would be re-applied on write. Disposing it is what makes
		// the round trip a decompression rather than a no-op.
		for (const extension of document.getRoot().listExtensionsUsed())
		{
			if (extension.extensionName === 'KHR_draco_mesh_compression') { extension.dispose(); }
		}
		// Textures stay external and are stubbed by installImageStub(); dropping
		// them here keeps writeBinary from embedding files this suite never reads.
		for (const texture of document.getRoot().listTextures()) { texture.dispose(); }
		buffer = Buffer.from(await io.writeBinary(document));
	}

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
