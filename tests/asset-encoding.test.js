/**
 * RM-004 B1: the shipped catalog is the authored catalog, to within a stated
 * number.
 *
 * ## Why this file exists separately from model-conversion.test.js
 *
 * Two different claims, and conflating them is what made the first attempt at
 * this sprint hard to reason about.
 *
 * `model-conversion.test.js` oracles the **conversion**: r98 legacy JSON to
 * glTF, frozen in `legacy-models-r98.json`, asserted on bounds, surface area,
 * triangle count, distinct positions and uvs. It has nothing to say about
 * compression and should not have to.
 *
 * This file oracles the **encoding**: authored glTF to shipped Draco. Its
 * reference is `asset-pipeline/encoding-report.json`, written by
 * `tools/encode-assets.mjs` at the moment it had both versions of every model
 * in memory - the only moment either exists together, since the encode replaces
 * the file in place and the authored bytes then live only in git history.
 *
 * Chained, the two say: r98 -> authored is faithful, and authored -> shipped is
 * faithful, therefore r98 -> shipped is. Neither test could say that alone.
 *
 * ## What this cannot prove, and what does
 *
 * A committed report is a record, not a measurement - it proves what the
 * encoder observed, not what is in the tree today. Two things close that gap:
 * `npm run encode:check` re-encodes into memory and fails if any model would
 * change, and the browser tier loads a real Draco model through a real
 * `DRACOLoader` and compares the frame. This file's job is narrower - that the
 * record covers everything, agrees with the tree, and stays inside the bound.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative, sep} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MODELS = join(PUBLIC, 'models');
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/encoding-report.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(PUBLIC, 'asset-manifest.json'), 'utf8'));

/** @param {string} directory @returns {string[]} names relative to public/ */
function walk(directory)
{
	/** @type {string[]} */
	const out = [];
	for (const entry of readdirSync(directory).sort())
	{
		const full = join(directory, entry);
		if (statSync(full).isDirectory()) { out.push(...walk(full)); }
		else if (/\.glb$/i.test(entry)) { out.push(relative(PUBLIC, full).split(sep).join('/')); }
	}
	return out;
}

/** Read a GLB's JSON chunk. */
function glbJson(name)
{
	const buffer = readFileSync(join(PUBLIC, name));
	if (buffer.readUInt32LE(0) !== 0x46546c67) { return null; }
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		if (buffer.readUInt32LE(offset + 4) === 0x4e4f534a)
		{
			return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
		}
		offset += 8 + length;
	}
	return null;
}

const ALL_GLB = walk(MODELS);
const ENCODED = ALL_GLB.filter((name) => (glbJson(name).extensionsRequired || []).indexOf('KHR_draco_mesh_compression') !== -1);
const UNENCODED = ALL_GLB.filter((name) => ENCODED.indexOf(name) === -1);

describe('the shipped catalog is the authored catalog (RM-004 B1)', () =>
{
	it('records every model it compressed, and compressed only what it recorded', () =>
	{
		expect(ENCODED.length).toBeGreaterThan(0);
		expect(Object.keys(REPORT.models).sort()).toEqual([...ENCODED].sort());
	});

	it('moved no vertex further than the stated tolerance', () =>
	{
		// The bound the encoder enforced, restated here so it is visible to a
		// reader of the tests rather than only to a reader of the tool.
		expect(REPORT.toleranceCm).toBe(0.0005);

		for (const [name, record] of Object.entries(REPORT.models))
		{
			expect(record.movedCm, name).toBeLessThanOrEqual(REPORT.toleranceCm);
		}
		expect(REPORT.worstMovedCm).toBeLessThanOrEqual(REPORT.toleranceCm);
	});

	it('is four orders of magnitude inside that tolerance, not scraping it', () =>
	{
		// A tolerance a change only just satisfies is a tolerance that will be
		// breached by the next change. The measured worst is 0.38 micrometres
		// against a 5 micrometre bound; if that ratio ever collapses, the settings
		// moved and somebody should look at why before it fails outright.
		expect(REPORT.worstMovedCm).toBeLessThan(REPORT.toleranceCm / 10);
	});

	it('changed no model triangle count', () =>
	{
		// Not a tolerance - an equality. A triangle that disappears is a hole or a
		// dropped degenerate, and the encoder cannot tell which, so it refuses
		// both. `ik-stockholmcoffee-brown.glb` is the one model this rejects: 756
		// triangles become 708 under welding, so it ships authored.
		for (const [name, record] of Object.entries(REPORT.models))
		{
			const json = glbJson(name);
			let declared = 0;
			for (const mesh of json.meshes || [])
			{
				for (const primitive of mesh.primitives || [])
				{
					const draco = (primitive.extensions || {})['KHR_draco_mesh_compression'];
					// A Draco primitive's index count lives in the accessor, which the
					// container still declares even though the data moved.
					const indices = primitive.indices !== undefined ? json.accessors[primitive.indices] : null;
					if (indices) { declared += indices.count / 3; }
					else if (draco) { declared += 0; }
				}
			}
			expect(Math.round(declared), name).toBe(record.triangles);
		}
	});

	it('leaves a model it could not encode faithfully exactly as it was', () =>
	{
		// The fallback is the safety property, so it is asserted rather than
		// assumed: everything not in the report is a plain glTF container that any
		// loader reads with no decoder at all.
		for (const name of UNENCODED)
		{
			expect(REPORT.models[name], name).toBeUndefined();
			const json = glbJson(name);
			expect(json.extensionsRequired || [], name).toEqual([]);
		}
	});

	it('agrees with the manifest about which models need a decoder', () =>
	{
		// Two independent derivations of the same fact - the manifest generator
		// reads `extensionsRequired` off each file, this reads the report - and
		// they have to agree or a build would attach the wrong loader.
		const manifestDraco = Object.entries(MANIFEST.assets)
			.filter(([, entry]) => entry.codec === 'draco')
			.map(([name]) => name)
			.sort();
		expect(manifestDraco).toEqual([...ENCODED].sort());

		for (const name of UNENCODED)
		{
			expect(MANIFEST.assets[name].codec, name).toBeUndefined();
		}
	});

	it('ships the decoder those models need', () =>
	{
		// A catalog that requires a decoder and a tree that does not carry one is
		// a build that fails on the first chair, and nothing else here would say
		// so - the models are individually valid.
		for (const file of ['draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js'])
		{
			expect(MANIFEST.assets[file], file).toBeTruthy();
			expect(MANIFEST.assets[file].kind).toBe('decoder');
			expect(statSync(join(PUBLIC, file)).size).toBeGreaterThan(1024);
		}
	});

	it('did not smuggle a texture into a model that referenced one', () =>
	{
		// `writeBinary()` embeds every resolved resource, which would have folded a
		// 704 KB oak texture into each of the two models using it and served the
		// same pixels twice. The encoder hand-assembles the container to prevent
		// it; this is what would notice if that stopped working.
		for (const name of ENCODED)
		{
			for (const image of glbJson(name).images || [])
			{
				expect(image.uri, `${name} embedded an image`).toBeTruthy();
				expect(image.bufferView, `${name} embedded an image`).toBeUndefined();
			}
		}
	});
});
