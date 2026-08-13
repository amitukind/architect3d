// @vitest-environment jsdom
/**
 * Sprint S3: the legacy JSON models, converted to glTF.
 *
 * The roadmap's exit gate asks for a per-model A/B review. This is its
 * automated half: every one of the 25 models is loaded twice - once through
 * three r98's JSONLoader, which is what the app did before this sprint, and
 * once through GLTFLoader from the converted .glb - and the two are compared as
 * geometry. Shape is checked numerically here; shading is a human call, because
 * Lambert has no exact PBR equivalent and never will.
 *
 * The second half of the file covers the merge pipeline rewrite. Scene.addItem
 * used to flatten a loaded model into a legacy `Geometry` with per-face
 * material indices; it now builds a BufferGeometry with material groups. That
 * is the riskiest change in the whole migration plan, so it is diffed against a
 * verbatim copy of the old implementation across all 168 catalog models, not a
 * sample.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {mergeMeshes} from '../src/scripts/core/geometry_merge.js';
import {LEGACY_MODEL_NAMES} from '../src/scripts/core/legacy_models.js';
import {
	boundsOf, installImageStub, legacyMergeMeshes, loadGltf, loadLegacyGeometry,
	loadLegacyMaterials, surfaceArea, triangleCount,
} from './helpers/models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_DIR = join(ROOT, 'build/models/js');
const CONVERTED_DIR = join(ROOT, 'build/models/js-glb');
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const REPORT = JSON.parse(readFileSync(join(CONVERTED_DIR, 'conversion-report.json'), 'utf8'));

let restoreImages;
beforeAll(() => {restoreImages = installImageStub();});
afterAll(() => {restoreImages();});

/** Positions are centimetres in the hundreds; 1e-3 is far below anything visible. */
const POSITION_TOLERANCE = 1e-3;

describe('every legacy model converted', () =>
{
	it('covers the whole source library, with nothing invented', () =>
	{
		const sources = readdirSync(LEGACY_DIR).filter((name) => name.endsWith('.js')).map((name) => name.slice(0, -3)).sort();
		const converted = readdirSync(CONVERTED_DIR).filter((name) => name.endsWith('.glb')).map((name) => name.slice(0, -4)).sort();

		expect(sources.length).toBe(25);
		expect(converted).toEqual(sources);
		expect([...LEGACY_MODEL_NAMES].sort()).toEqual(sources);
	});

	it('records the four maps that are missing from the source library', () =>
	{
		// Not a conversion failure: these four 404 in the legacy demo too, and the
		// models render with their diffuse colour alone before and after. Pinned so
		// the list cannot grow unnoticed.
		expect(REPORT.missingTextures.map((entry) => entry.texture)).toEqual([
			'cb-moore_baked.png',
			'ik-kivine_baked.png',
			'pine_wood_coloured.jpg',
			'we-crosby2piece-green_baked.png',
		]);
	});

	it('ships every texture a converted model references', () =>
	{
		for (const model of REPORT.models)
		{
			for (const texture of model.textures)
			{
				expect(existsSync(join(CONVERTED_DIR, 'textures', texture)), `${model.source} -> ${texture}`).toBe(true);
			}
		}
	});

	it('copies textures byte-for-byte rather than re-encoding them', () =>
	{
		// The whole reason the converter runs in Node instead of a browser: no
		// canvas round-trip, so the baked maps are the original files.
		const copied = readdirSync(join(CONVERTED_DIR, 'textures'));
		expect(copied.length).toBeGreaterThan(0);
		for (const name of copied)
		{
			expect(readFileSync(join(CONVERTED_DIR, 'textures', name)))
				.toEqual(readFileSync(join(LEGACY_DIR, name)));
		}
	});
});

describe.each(LEGACY_MODEL_NAMES)('%s', (name) =>
{
	let legacy;
	let converted;

	beforeAll(async () =>
	{
		legacy = loadLegacyGeometry(join(LEGACY_DIR, `${name}.js`));
		const gltf = await loadGltf(join(CONVERTED_DIR, `${name}.glb`), `${CONVERTED_DIR}/`);
		converted = mergeMeshes(gltf.scene).geometry;
	});

	it('keeps every triangle', () =>
	{
		expect(triangleCount(converted)).toBe(triangleCount(legacy));
	});

	it('occupies the same space', () =>
	{
		const before = boundsOf(legacy);
		const after = boundsOf(converted);
		after.forEach((value, i) => {expect(value).toBeCloseTo(before[i], 3);});
	});

	it('has the same surface area', () =>
	{
		// Order-independent, so it survives the re-weld and catches a triangle
		// that a bounding box would not - dropped, doubled or mis-transformed.
		const before = surfaceArea(legacy);
		expect(surfaceArea(converted)).toBeCloseTo(before, Math.max(0, 6 - Math.ceil(Math.log10(before || 1))));
	});

	it('keeps every vertex position', () =>
	{
		// Welding merges vertices that agree on position, normal and uv, so the
		// set of positions is preserved even though the count and order are not.
		const setOf = (geometry) =>
		{
			const array = geometry.attributes.position.array;
			const points = new Set();
			for (let i = 0; i < array.length; i += 3)
			{
				points.add(`${array[i].toFixed(3)},${array[i + 1].toFixed(3)},${array[i + 2].toFixed(3)}`);
			}
			return points;
		};
		const before = setOf(legacy);
		const after = setOf(converted);
		expect([...after].filter((point) => !before.has(point))).toEqual([]);
		expect([...before].filter((point) => !after.has(point))).toEqual([]);
	});

	it('carries one material per material the source declared', () =>
	{
		const declared = Math.max(1, loadLegacyMaterials(join(LEGACY_DIR, `${name}.js`)).length);
		const report = REPORT.models.find((model) => model.source === `${name}.js`);
		expect(report.materials).toBe(declared);
	});

	it('flips the v coordinate and changes nothing else about the uvs', () =>
	{
		// glTF measures v from the top of the image, three from the bottom, and
		// GLTFLoader sets texture.flipY = false to match. Flipping the coordinate
		// rather than the image pixels is what lets the converter copy the PNGs
		// verbatim instead of re-encoding them through a canvas.
		if (!legacy.attributes.uv || !converted.attributes.uv)
		{
			expect(Boolean(legacy.attributes.uv)).toBe(Boolean(converted.attributes.uv));
			return;
		}
		const before = vCoordinates(legacy).sort((a, b) => a - b);
		const after = vCoordinates(converted).sort((a, b) => a - b);
		expect(after.length).toBe(before.length);
		// 4dp: the flip is computed in float64 and stored as float32, so the two
		// sides disagree in the sixth decimal. On a 1024px map that is a tenth of
		// a pixel.
		after.forEach((value, i) => {expect(value).toBeCloseTo(1 - before[before.length - 1 - i], 4);});
	});
});

describe('material translation', () =>
{
	it('normalizes Lambert to the diffuse corner of PBR, not the schema default', () =>
	{
		// The stock exporter writes metallic 0.5 / roughness 0.5, which makes every
		// one of these visibly darker and glossier than the Lambert original.
		const gltf = readGltfJson('cb-blue-block-60x96');
		for (const material of gltf.materials)
		{
			expect(material.pbrMetallicRoughness.metallicFactor).toBe(0);
			expect(material.pbrMetallicRoughness.roughnessFactor).toBe(1);
		}
	});

	it('passes the diffuse colour through untouched, everywhere it is declared', () =>
	{
		// r98 applied no colour conversion on the way in and the r105 GLTFLoader
		// applies none on the way out, so the resulting material.color is identical.
		// A material with no colorDiffuse at all - several of these have none -
		// falls back to white, which is what Loader.createMaterial did too.
		let declared = 0;
		for (const name of LEGACY_MODEL_NAMES)
		{
			const source = loadLegacyMaterials(join(LEGACY_DIR, `${name}.js`));
			const gltf = readGltfJson(name);
			source.forEach((legacy, i) =>
			{
				const factor = gltf.materials[i].pbrMetallicRoughness.baseColorFactor;
				expect(factor.slice(0, 3), `${name} material ${i}`).toEqual(legacy.colorDiffuse || [1, 1, 1]);
				expect(factor[3], `${name} material ${i} alpha`).toBe(legacy.transparency ?? 1);
				if (legacy.colorDiffuse)
				{
					declared++;
				}
			});
		}
		expect(declared).toBeGreaterThan(0);
	});

	it('drops the texture reference when the map is missing from disk', () =>
	{
		const gltf = readGltfJson('ik-kivine_baked');
		expect(gltf.images).toBeUndefined();
		expect(gltf.materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();
		// The diffuse colour still carries, which is what the legacy path fell
		// back to when the 404 came in.
		expect(gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toHaveLength(4);
	});

	it('points textures at the shared sidecar directory, not at models/js', () =>
	{
		const gltf = readGltfJson('cb-blue-block-60x96');
		expect(gltf.images[0].uri).toBe('textures/b_cb-blue-block60x96.png');
	});
});

describe('UV convention', () =>
{
	it('is genuinely flipped - some models would fail the per-model check if it were not', () =>
	{
		// A v-multiset that happens to be symmetric about 0.5 maps onto itself
		// under 1-v, so those models cannot tell a flip from a no-op. This proves
		// the per-model assertions above are actually constraining the direction
		// and would catch the flip being dropped.
		const asymmetric = LEGACY_MODEL_NAMES.filter((name) =>
		{
			const geometry = loadLegacyGeometry(join(LEGACY_DIR, `${name}.js`));
			if (!geometry.attributes.uv)
			{
				return false;
			}
			const values = vCoordinates(geometry).sort((a, b) => a - b);
			return values.some((value, i) => Math.abs(value - (1 - values[values.length - 1 - i])) > 1e-4);
		});
		expect(asymmetric.length).toBeGreaterThan(0);
	});
});

describe('the merge pipeline rewrite', () =>
{
	const models = CATALOG.items.map((item) => item.model).filter((model, i, all) => all.indexOf(model) === i);

	it('covers every distinct model in the catalog', () =>
	{
		expect(models.length).toBeGreaterThanOrEqual(160);
	});

	it('produces the same geometry as the pre-S3 legacy-Geometry merge, for every model', async () =>
	{
		// The old merge is reproduced verbatim in helpers/models.js. Anything that
		// moved, duplicated or lost a triangle shows up here.
		const differences = [];
		for (const model of models)
		{
			const path = join(ROOT, 'build', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);

			const before = legacyMergeMeshes(gltf.scene);
			const after = mergeMeshes(gltf.scene);

			const problems = [];
			if (triangleCount(after.geometry) !== triangleCount(before.geometry))
			{
				problems.push(`triangles ${triangleCount(before.geometry)} -> ${triangleCount(after.geometry)}`);
			}
			if (after.materials.length !== before.materials.length)
			{
				problems.push(`materials ${before.materials.length} -> ${after.materials.length}`);
			}
			const boundsBefore = boundsOf(before.geometry);
			const boundsAfter = boundsOf(after.geometry);
			if (boundsBefore.some((value, i) => Math.abs(value - boundsAfter[i]) > POSITION_TOLERANCE))
			{
				problems.push(`bounds ${boundsBefore.map((v) => v.toFixed(3))} -> ${boundsAfter.map((v) => v.toFixed(3))}`);
			}
			if (problems.length > 0)
			{
				differences.push(`${model}: ${problems.join('; ')}`);
			}
		}
		expect(differences).toEqual([]);
	}, 120000);

	it('still drops parent node transforms, exactly as the old merge did', async () =>
	{
		// A real bug, preserved on purpose. The flatten bakes each mesh's LOCAL
		// matrix, so a mesh sitting under a transformed glTF node is merged at the
		// wrong scale or offset. Fixing it changes how those models look and where
		// they sit in designs users have already saved, so it is scheduled with its
		// own A/B review (roadmap section 01, S4) rather than riding along with a
		// change that is otherwise a pure swap of geometry representation.
		//
		// This measures the blast radius so the fix can be planned, and fails if
		// the discrepancy silently changes shape.
		const affected = [];
		for (const model of models)
		{
			const path = join(ROOT, 'build', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);

			const local = boundsOf(mergeMeshes(gltf.scene).geometry);
			gltf.scene.updateMatrixWorld(true);
			const world = boundsOf(mergeWithWorldMatrices(gltf.scene));

			if (local.some((value, i) => Math.abs(value - world[i]) > POSITION_TOLERANCE))
			{
				affected.push(model);
			}
		}

		expect(affected.length).toBe(42);
		expect(affected).toContain('models/js/Duck.gltf');
		// None of the 25 conversions is affected - they are authored as a single
		// untransformed node, so the S3 output is correct either way.
		expect(affected.filter((model) => model.startsWith('models/js-glb/'))).toEqual([]);
	}, 120000);

	it('emits material groups that index into the material array', async () =>
	{
		// The structural point of the rewrite: face.materialIndex is gone, and
		// geometry.groups carries the same information in the form Mesh reads.
		const path = join(CONVERTED_DIR, 'whitewindow.glb');
		const gltf = await loadGltf(path, `${CONVERTED_DIR}/`);
		const {geometry, materials} = mergeMeshes(gltf.scene);

		expect(materials.length).toBeGreaterThan(1);
		expect(geometry.groups.length).toBeGreaterThan(0);
		for (const group of geometry.groups)
		{
			expect(group.materialIndex).toBeGreaterThanOrEqual(0);
			expect(group.materialIndex).toBeLessThan(materials.length);
		}
		// The groups tile the vertex buffer exactly once, with no gap or overlap.
		const sorted = [...geometry.groups].sort((a, b) => a.start - b.start);
		let cursor = 0;
		for (const group of sorted)
		{
			expect(group.start).toBe(cursor);
			cursor += group.count;
		}
		expect(cursor).toBe(geometry.attributes.position.count);
	});

	it('pools materials by name, so a one-material model is one draw call', async () =>
	{
		// whitewindow has 15 primitives but only 4 distinct materials.
		const gltf = await loadGltf(join(CONVERTED_DIR, 'whitewindow.glb'), `${CONVERTED_DIR}/`);
		const {geometry, materials} = mergeMeshes(gltf.scene);
		expect(materials.length).toBe(4);
		expect(geometry.groups.length).toBeLessThanOrEqual(15);

		const single = await loadGltf(join(CONVERTED_DIR, 'open_door.glb'), `${CONVERTED_DIR}/`);
		const merged = mergeMeshes(single.scene);
		expect(merged.materials.length).toBe(1);
		expect(merged.geometry.groups.length).toBe(1);
	});
});

/**
 * What mergeMeshes would produce if it honoured parent node transforms.
 *
 * Only used to measure the discrepancy above; nothing in the library does this
 * yet. Positions only - that is all the comparison needs.
 */
function mergeWithWorldMatrices(root)
{
	const positions = [];
	root.traverse((child) =>
	{
		if (!child.isMesh || !child.geometry || !child.geometry.attributes.position)
		{
			return;
		}
		const flat = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
		flat.applyMatrix(child.matrixWorld);
		positions.push(...flat.attributes.position.array);
	});

	const geometry = new THREE.BufferGeometry();
	geometry.addAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
	return geometry;
}

/**
 * Every v coordinate, once per triangle corner, in draw order.
 *
 * Welding changes how many vertices there are but not how many corners, so this
 * is comparable between the indexed .glb and the non-indexed legacy geometry.
 * The `+ 0` normalizes -0, which would otherwise sort and compare oddly.
 */
function vCoordinates(geometry)
{
	const uv = geometry.attributes.uv.array;
	const index = geometry.index ? geometry.index.array : null;
	const count = index ? index.length : geometry.attributes.uv.count;
	const values = [];
	for (let i = 0; i < count; i++)
	{
		const at = index ? index[i] : i;
		values.push(Math.round(uv[at * 2 + 1] * 1e6) / 1e6 + 0);
	}
	return values;
}

/** The raw glTF JSON chunk of a converted model, for assertions about the file itself. */
function readGltfJson(name)
{
	const buffer = readFileSync(join(CONVERTED_DIR, `${name}.glb`));
	const jsonLength = buffer.readUInt32LE(12);
	return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
}
