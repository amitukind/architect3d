// @vitest-environment jsdom
/**
 * Sprint S3: the legacy JSON models, converted to glTF - still proved in S4.
 *
 * The roadmap's exit gate asks for a per-model A/B review. This is its
 * automated half: every one of the 25 models is compared, as geometry, against
 * the original it replaced. Shape is checked numerically here; shading is a
 * human call, because Lambert has no exact PBR equivalent and never will.
 *
 * S4 changed how the "before" side is obtained, not what is asserted. It used
 * to be produced live by three r98's JSONLoader; r185 has no such loader, so
 * the measurements were taken under r98 by tools/capture-model-goldens.mjs and
 * frozen into tests/fixtures/legacy-models-r98.json. Comparing against a record
 * is in one way stronger than comparing against a live loader: the reference
 * cannot drift when the engine moves under it.
 *
 * The second half of the file covers the merge pipeline. S3 rewrote it from a
 * legacy `Geometry` with per-face material indices to a BufferGeometry with
 * material groups, and proved the rewrite changed nothing. S4 then makes the
 * one change S3 deliberately withheld: the flatten now bakes each mesh's WORLD
 * matrix, so meshes under transformed glTF nodes stop being merged at the wrong
 * scale. tests/fixtures/legacy-merge-r98.json holds both readings for all 168
 * catalog models, which is what lets the 42 corrections be enumerated exactly
 * rather than estimated.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {mergeMeshes} from '../src/scripts/core/geometry_merge.js';
import {LEGACY_MODEL_NAMES} from '../src/scripts/core/legacy_models.js';
import {classifyNodeTransform} from '../tools/node-transform-class.mjs';
import {
	LEGACY_MERGE_RESULTS, LEGACY_MODEL_SHAPES, boundsOf, installImageStub, loadGltf,
	loadLegacyMaterials, mergeWithLocalMatrices, positionDigest, surfaceArea, triangleCount, uvDigest,
} from './helpers/models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_DIR = join(ROOT, 'asset-pipeline/legacy-json');
const CONVERTED_DIR = join(ROOT, 'public/models/js-glb');
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
// The converter's own record of what it produced. It lives beside the other
// pipeline inputs rather than in public/ - it is a build artifact this test
// reads, and it was being served to every visitor for no reason.
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/conversion-report.json'), 'utf8'));

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
		// Hashed rather than deep-compared: vitest's toEqual walks two 4 MB
		// Buffers byte by byte and the whole suite spent five seconds in here.
		const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
		const copied = readdirSync(join(CONVERTED_DIR, 'textures'));
		expect(copied.length).toBeGreaterThan(0);
		for (const name of copied)
		{
			expect(digest(join(CONVERTED_DIR, 'textures', name)), name)
				.toBe(digest(join(LEGACY_DIR, name)));
		}
	});
});

describe.each(LEGACY_MODEL_NAMES)('%s', (name) =>
{
	// The r98 reading, frozen. See the file header.
	const legacy = LEGACY_MODEL_SHAPES[name];
	let converted;

	beforeAll(async () =>
	{
		const gltf = await loadGltf(join(CONVERTED_DIR, `${name}.glb`), `${CONVERTED_DIR}/`);
		converted = mergeMeshes(gltf.scene).geometry;
	});

	it('has a frozen r98 measurement to be compared against', () =>
	{
		// Guards the comparison itself: without this, a name missing from the
		// fixture would make every assertion below read `undefined` and quietly
		// pass nothing.
		expect(legacy).toBeTruthy();
		expect(legacy.triangles).toBeGreaterThan(0);
	});

	it('keeps every triangle', () =>
	{
		expect(triangleCount(converted)).toBe(legacy.triangles);
	});

	it('occupies the same space', () =>
	{
		boundsOf(converted).forEach((value, i) => {expect(value).toBeCloseTo(legacy.bounds[i], 3);});
	});

	it('has the same surface area', () =>
	{
		// Order-independent, so it survives the re-weld and catches a triangle
		// that a bounding box would not - dropped, doubled or mis-transformed.
		const before = legacy.surfaceArea;
		expect(surfaceArea(converted)).toBeCloseTo(before, Math.max(0, 6 - Math.ceil(Math.log10(before || 1))));
	});

	it('keeps every vertex position', () =>
	{
		// Welding merges vertices that agree on position, normal and uv, so the
		// set of positions is preserved even though the count and order are not.
		// The fixture stores that set as a size and a hash; both must match.
		expect(positionDigest(converted)).toEqual(legacy.positions);
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
		const after = uvDigest(converted);
		if (!legacy.uv || !after)
		{
			expect(Boolean(legacy.uv)).toBe(Boolean(after));
			return;
		}
		expect(after.count).toBe(legacy.uv.count);

		// Both digests hold the same values, sorted ascending and run-length
		// encoded at 4dp, so the flip pairs the smallest of one with the largest
		// of the other. Compared with a tolerance rather than exactly: the flip is
		// computed in float64 and stored as float32, and the two sides can land
		// either side of a 4dp rounding boundary. On a 1024px map the residual is
		// a tenth of a pixel.
		const before = expandRuns(legacy.uv.runs);
		const values = expandRuns(after.runs);
		expect(values.length).toBe(before.length);

		let worst = 0;
		for (let i = 0; i < values.length; i++)
		{
			worst = Math.max(worst, Math.abs(values[i] - (1 - before[before.length - 1 - i])));
		}
		expect(worst).toBeLessThan(1.5e-4);
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
			const uv = LEGACY_MODEL_SHAPES[name].uv;
			if (!uv)
			{
				return false;
			}
			const values = expandRuns(uv.runs);
			return values.some((value, i) => Math.abs(value - (1 - values[values.length - 1 - i])) > 1e-3);
		});
		expect(asymmetric.length).toBeGreaterThan(0);
	});
});

/** A run-length encoded digest back into the sorted list it came from. */
function expandRuns(runs)
{
	const values = [];
	for (const [value, count] of runs)
	{
		for (let i = 0; i < count; i++) { values.push(value); }
	}
	return values;
}

describe('the merge pipeline rewrite', () =>
{
	const models = CATALOG.items.map((item) => item.model).filter((model, i, all) => all.indexOf(model) === i);

	it('covers every distinct model in the catalog', () =>
	{
		expect(models.length).toBeGreaterThanOrEqual(160);
	});

	it('has a frozen r98 reading for every catalog model', () =>
	{
		expect(models.filter((model) => !LEGACY_MERGE_RESULTS[model])).toEqual([]);
	});

	it('keeps triangle and material counts identical to the pre-S3 merge, for every model', async () =>
	{
		// The S3 assertion, unchanged. Baking world matrices instead of local ones
		// moves vertices; it must not create, drop or re-pool a single one.
		const differences = [];
		for (const model of models)
		{
			const path = join(ROOT, 'public', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);
			const after = mergeMeshes(gltf.scene);
			const before = LEGACY_MERGE_RESULTS[model];

			const problems = [];
			if (triangleCount(after.geometry) !== before.triangles)
			{
				problems.push(`triangles ${before.triangles} -> ${triangleCount(after.geometry)}`);
			}
			if (after.materials.length !== before.materials)
			{
				problems.push(`materials ${before.materials} -> ${after.materials.length}`);
			}
			if (problems.length > 0)
			{
				differences.push(`${model}: ${problems.join('; ')}`);
			}
		}
		expect(differences).toEqual([]);
	}, 120000);

	it('now honours parent node transforms, correcting exactly the 42 models that needed it', async () =>
	{
		// The S4 fix, measured. Every model's merged bounds must equal the
		// world-matrix reading recorded under r98 - which is the same for 126 of
		// them and different for the 42 that sit under a transformed node.
		//
		// Asserting against both columns of the fixture is what makes this a
		// proof rather than a restatement: a merge that silently reverted to
		// local matrices would still match `localBounds` and would be caught, and
		// so would one that started transforming models that were already right.
		const wrong = [];
		const corrected = [];

		for (const model of models)
		{
			const path = join(ROOT, 'public', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);
			const record = LEGACY_MERGE_RESULTS[model];
			const actual = boundsOf(mergeMeshes(gltf.scene).geometry);

			if (actual.some((value, i) => Math.abs(value - record.worldBounds[i]) > POSITION_TOLERANCE))
			{
				wrong.push(`${model}: ${actual.map((v) => v.toFixed(3))} != ${record.worldBounds.map((v) => v.toFixed(3))}`);
			}
			if (record.nodeTransformAffected)
			{
				corrected.push(model);
			}
		}

		expect(wrong).toEqual([]);
		expect(corrected.length).toBe(42);
		expect(corrected).toContain('models/js/Duck.gltf');
		// None of the 25 S3 conversions moved: they are authored as a single
		// untransformed node, so their output was correct either way.
		expect(corrected.filter((model) => model.startsWith('models/js-glb/'))).toEqual([]);
	}, 120000);

	it('leaves the 126 unaffected models bit-for-bit where they were', async () =>
	{
		// The other half of the fix's blast radius: a model with no transformed
		// node must be untouched, so the change is provably confined to the 42.
		const unaffected = models.filter((model) => !LEGACY_MERGE_RESULTS[model].nodeTransformAffected);
		expect(unaffected.length).toBe(models.length - 42);

		const moved = [];
		for (const model of unaffected)
		{
			const path = join(ROOT, 'public', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);
			const actual = boundsOf(mergeMeshes(gltf.scene).geometry);
			const record = LEGACY_MERGE_RESULTS[model].localBounds;
			if (actual.some((value, i) => Math.abs(value - record[i]) > POSITION_TOLERANCE))
			{
				moved.push(model);
			}
		}
		expect(moved).toEqual([]);
	}, 120000);

	it('scales Duck.gltf by the factor its node declares, rather than ignoring it', async () =>
	{
		// The worst case, spelled out. Duck.gltf hangs its mesh under a node whose
		// matrix scales by 0.01, and the old merge dropped it - so the duck was
		// drawn a hundred times too BIG: 154 units tall, in a catalog where a
		// fridge is 0.92 and a bookcase 0.85.
		const path = join(ROOT, 'public/models/js/Duck.gltf');
		const gltf = await loadGltf(path, `${dirname(path)}/`);
		const merged = boundsOf(mergeMeshes(gltf.scene).geometry);
		const local = boundsOf(mergeWithLocalMatrices(gltf.scene));

		const sizeOf = (bounds) => bounds[4] - bounds[1];
		expect(sizeOf(merged) / sizeOf(local)).toBeCloseTo(0.01, 4);
		expect(sizeOf(local)).toBeGreaterThan(150);
		expect(sizeOf(merged)).toBeLessThan(2);
	});

	it('changes the shape of exactly two models, and leaves the other forty rigid', async () =>
	{
		// How much of the fix actually needs a human eye, read off the node
		// matrices rather than guessed at from bounding boxes.
		//
		// Bounds cannot answer this. An axis-aligned box changes just as much
		// under a rotation as under a squash, so a before/after bounds comparison
		// reports "resized" for models whose geometry is untouched - which is how
		// an earlier version of this test arrived at a 21/21 split by measuring
		// the y axis alone. Decomposing the parents' contribution gives the real
		// answer, and it is a far smaller review: 24 models have parts translated
		// into place and 2 are rotated (both rigid - the mesh is not altered),
		// 14 are uniformly rescaled (same shape, different size), and only 2 are
		// genuinely stretched.
		const counts = {translate: 0, rotate: 0, uniform: 0, nonuniform: 0};
		const stretched = [];

		for (const model of models)
		{
			if (!LEGACY_MERGE_RESULTS[model].nodeTransformAffected) { continue; }
			const path = join(ROOT, 'public', model);
			const gltf = await loadGltf(path, `${dirname(path)}/`);
			const kind = classifyNodeTransform(gltf.scene);
			counts[kind] += 1;
			if (kind === 'nonuniform') { stretched.push(model); }
		}

		expect(counts).toEqual({translate: 24, rotate: 2, uniform: 14, nonuniform: 2});
		expect(stretched.sort()).toEqual([
			'models/gltf/kitchenCoffeeMachine.glb',
			'models/gltf/kitchenFridgeBuiltIn.glb',
		]);
	}, 120000);

	it('applies a similarity transform to every model that is not stretched', () =>
	{
		// The consequence worth stating: for 40 of the 42 the transform is a
		// similarity - translation, rotation, uniform scale - so no individual
		// mesh is deformed. Only the two `nonuniform` models can be.
		//
		// Not to be overread as "those 40 look identical". Where a model is
		// assembled from several meshes the fix moves them relative to each
		// other, which is exactly the bug being fixed: bedBunk.glb had a mattress
		// floating beside the frame and now has it on it.
		//
		// Duck.gltf is the extreme and is a single mesh, so it really is
		// unchanged in shape: a uniform 0.01 on every axis.
		const record = LEGACY_MERGE_RESULTS['models/js/Duck.gltf'];
		const before = [0, 1, 2].map((i) => record.localBounds[i + 3] - record.localBounds[i]);
		const after = [0, 1, 2].map((i) => record.worldBounds[i + 3] - record.worldBounds[i]);

		// Every axis shrank by the same factor - the definition of uniform.
		const ratios = after.map((value, i) => value / before[i]);
		ratios.forEach((ratio) => {expect(ratio).toBeCloseTo(0.01, 5);});
	});

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
 * The JSON chunk of a converted .glb, straight out of the container.
 *
 * Reads the file rather than the parsed scene so the assertions above can look
 * at what the converter actually wrote - image URIs, absent texture references,
 * the PBR factors - none of which survive intact once GLTFLoader has turned
 * them into three materials.
 */
function readGltfJson(name)
{
	const buffer = readFileSync(join(CONVERTED_DIR, `${name}.glb`));
	const jsonLength = buffer.readUInt32LE(12);
	return JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
}
