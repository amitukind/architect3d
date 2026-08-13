/**
 * Freeze what three r98 measured about the model library, so S3's A/B tests
 * survive the r185 bump.
 *
 * S3 proved its 25 conversions by loading the original `models/js/*.js` through
 * r98's JSONLoader and comparing. r185 has no JSONLoader and no `Geometry`, so
 * that comparison cannot be re-run after the bump - and a proof you can only
 * run once is not much of a proof. This script records the legacy side as data
 * while r98 is still installed; the tests then compare the converted models
 * against the record instead of against a live loader, and keep working
 * forever.
 *
 *     node tools/capture-model-goldens.mjs
 *
 * Two records are written to tests/fixtures/:
 *
 *   legacy-models-r98.json   per-model shape of the 25 legacy JSON originals
 *   legacy-merge-r98.json    what the pre-S3 merge produced for every catalog
 *                            model, with local- and world-matrix bounds side by
 *                            side - the measurement behind the node-transform
 *                            bug, and the before/after table for its fix
 *
 * Position sets are stored as a digest rather than in full: the assertion is
 * set equality, a hash decides that exactly, and the alternative is a
 * multi-megabyte fixture nobody can read. UV values are stored as a
 * value/count digest, which is elementwise-equivalent to the sorted list the
 * test compares and roughly two orders of magnitude smaller.
 */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const LEGACY_DIR = join(ROOT, 'asset-pipeline', 'legacy-json');

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

const THREE = await import('three');

// Same guard, and the same reason, as capture-geometry-goldens.mjs: this reads
// the r98 engine, and r98 is gone. See that file's assertLegacyThree.
if (typeof THREE.Geometry !== 'function')
{
	console.error(
		`This script captures what three r98 measured, and the installed three is r${THREE.REVISION}.\n` +
		'`Geometry` and `JSONLoader` were removed in r125 and r97 respectively.\n\n' +
		'tests/fixtures/legacy-models-r98.json and legacy-merge-r98.json already hold those\n' +
		'measurements; they are checked in, and tests/model-conversion.test.js compares against\n' +
		'them. To re-derive them, check out the legacy-demo tag and npm install there.');
	process.exit(1);
}

const {
	boundsOf, installImageStub, loadGltf, surfaceArea, triangleCount,
} = await import('../tests/helpers/models.js');
const {mergeMeshes} = await import('../src/scripts/core/geometry_merge.js');
const {LEGACY_MODEL_NAMES} = await import('../src/scripts/core/legacy_models.js');

installImageStub();

const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src', 'catalog', 'catalog.json'), 'utf8'));
const round = (value) => Math.round(value * 1e6) / 1e6 + 0;

/**
 * The legacy three.js JSON model, as the pre-S3 app parsed it.
 *
 * Inlined here rather than imported from tests/helpers/models.js: the helper
 * lost this function in S4, and a historical record that depends on live code
 * is not a record. Self-contained, so it still describes exactly what produced
 * the fixture.
 */
function loadLegacyGeometry(path)
{
	const json = JSON.parse(readFileSync(path, 'utf8'));
	// parse() inverts json.scale in place and reaches for a DOM to build
	// textures; a copy without materials avoids both.
	const {geometry} = new THREE.JSONLoader().parse({...json, materials: []}, '');
	return new THREE.BufferGeometry().fromGeometry(geometry);
}

/** The merge Scene.addItem performed before S3, reconstructed verbatim. */
function legacyMergeMeshes(root)
{
	const materials = [];
	const geometry = new THREE.Geometry();

	const addToMaterials = (newMaterial) =>
	{
		for (let i = 0; i < materials.length; i++)
		{
			if (materials[i].name === newMaterial.name) { return i; }
		}
		materials.push(newMaterial);
		return materials.length - 1;
	};

	root.traverse((child) =>
	{
		if (child.type !== 'Mesh') { return; }
		const indices = [];
		if (child.material.length)
		{
			for (let k = 0; k < child.material.length; k++) { indices.push(addToMaterials(child.material[k])); }
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

/** Set of positions at 3dp, reduced to a size and a hash. */
function positionDigest(geometry)
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

/**
 * Sorted v coordinates, run-length encoded at 4dp.
 *
 * 4dp because the converter computes the flip in float64 and glTF stores
 * float32; the two disagree in the sixth decimal, which on a 1024px map is a
 * tenth of a pixel. Comparing digests is the same assertion as comparing the
 * sorted lists elementwise, because both sides are sorted before encoding.
 */
function uvDigest(geometry)
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

/* ------------------------------------------------- the 25 legacy originals */

const legacyModels = {};
for (const name of LEGACY_MODEL_NAMES)
{
	const geometry = loadLegacyGeometry(join(LEGACY_DIR, `${name}.js`));
	legacyModels[name] = {
		triangles: triangleCount(geometry),
		bounds: boundsOf(geometry).map(round),
		surfaceArea: round(surfaceArea(geometry)),
		positions: positionDigest(geometry),
		uv: uvDigest(geometry),
	};
}

// One line per model rather than pretty-printed throughout: the uv digests run
// to tens of thousands of pairs each, and indenting them turns a 400 KB record
// into a 1.6 MB one for no added legibility.
const legacyLines = Object.entries(legacyModels)
	.map(([name, value]) => `\t${JSON.stringify(name)}: ${JSON.stringify(value)}`)
	.join(',\n');
writeFileSync(join(FIXTURES, 'legacy-models-r98.json'), `{\n${legacyLines}\n}\n`);

/* ----------------------------------------- the pre-S3 merge, whole catalog */

const models = CATALOG.items.map((item) => item.model).filter((model, i, all) => all.indexOf(model) === i);
const merges = {};
let transformAffected = 0;

for (const model of models)
{
	const path = join(ROOT, 'public', model);
	const gltf = await loadGltf(path, `${dirname(path)}/`);

	const before = legacyMergeMeshes(gltf.scene);
	// The same flatten with world matrices instead of local ones - i.e. what the
	// merge produces once the node-transform bug is fixed. Positions only; that
	// is all the bounds comparison needs.
	gltf.scene.updateMatrixWorld(true);
	const worldPositions = [];
	gltf.scene.traverse((child) =>
	{
		if (child.type !== 'Mesh') { return; }
		const flat = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
		flat.applyMatrix(child.matrixWorld);
		worldPositions.push(flat.attributes.position.array);
	});
	const total = worldPositions.reduce((sum, chunk) => sum + chunk.length, 0);
	const joined = new Float32Array(total);
	let cursor = 0;
	for (const chunk of worldPositions) { joined.set(chunk, cursor); cursor += chunk.length; }
	const worldGeometry = new THREE.BufferGeometry();
	worldGeometry.addAttribute('position', new THREE.BufferAttribute(joined, 3));

	const localBounds = boundsOf(before.geometry).map(round);
	const worldBounds = boundsOf(worldGeometry).map(round);
	const differs = localBounds.some((value, i) => Math.abs(value - worldBounds[i]) > 1e-4);
	if (differs) { transformAffected += 1; }

	merges[model] = {
		triangles: triangleCount(before.geometry),
		materials: before.materials.length,
		localBounds,
		worldBounds,
		nodeTransformAffected: differs,
	};

	// Sanity: the S3 rewrite must already agree with the record being written.
	const after = mergeMeshes(gltf.scene);
	const afterBounds = boundsOf(after.geometry).map(round);
	if (afterBounds.some((value, i) => Math.abs(value - localBounds[i]) > 1e-4))
	{
		throw new Error(`${model}: current mergeMeshes disagrees with the legacy merge being frozen`);
	}
}

writeFileSync(join(FIXTURES, 'legacy-merge-r98.json'), `${JSON.stringify(merges, null, '\t')}\n`);

console.log(`legacy model shape frozen   -> tests/fixtures/legacy-models-r98.json  (${LEGACY_MODEL_NAMES.length} models)`);
console.log(`pre-S3 merge frozen         -> tests/fixtures/legacy-merge-r98.json   (${models.length} models)`);
console.log(`node-transform affected     :  ${transformAffected}`);
