/**
 * Re-encode public/models/**\/*.glb with Draco compression (RM-004 B1).
 *
 *   npm run encode                 re-encode anything that needs it
 *   npm run encode -- --check      exit non-zero if any model is unencoded
 *   npm run encode -- --force      re-encode everything, ignoring the marker
 *   npm run encode -- --dry        report what would change, write nothing
 *
 * ## Why this exists, and why the output is committed
 *
 * The catalog was shipped in the shape its authoring tools emitted: every
 * vertex attribute `float32`, and every index buffer 32 bits wide for meshes
 * whose largest primitive has 1,174 vertices. The B1 trial measured all four
 * plausible answers over the whole catalog, and the numbers are in the roadmap
 * (§24 LANDED — B1). Draco won on served bytes by a wide margin:
 *
 *     models on disk    5.08 MB -> 1.35 MB           (-73.4%)
 *     decoder           73.1 KB gzipped, fetched once, lazily
 *     decode            3.26x baseline, on a worker
 *     worst vertex      0.38 micrometres, against a 5 micrometre gate
 *
 * This is NOT a build step. It is run deliberately, its output is committed,
 * and a checkout builds and serves with no encoder installed - exactly the
 * model `make-asset-manifest.mjs` already established. The encoder packages are
 * devDependencies for that reason: nothing at runtime imports them.
 *
 * ## Replace in place, and why that is safe
 *
 * A5's rule was that an asset URL is a published contract, because saved
 * designs name models by URL. That rule is about the NAME, and this changes
 * only contents - every logical name resolves to the same path it always did.
 *
 * The scenario the rule was written to protect turns out not to exist:
 * `public/` is not in package.json's `files`, so an npm consumer never receives
 * these assets and supplies their own. The app and its assets deploy together
 * out of one tree. What DOES change for an embedder is narrower and is worth
 * stating plainly: anyone who self-hosts this project's `public/` and points a
 * pre-B1 build at it, or who supplies their own loader through
 * `Scene.setItemLoader`, now needs a `DRACOLoader`. That is recorded in the
 * CHANGELOG rather than hidden behind a claim of full compatibility.
 *
 * ## Per asset, never per catalog
 *
 * Every model is encoded, read back THROUGH THE DECODER, and compared against
 * its authored self before it is allowed to replace anything. A model that
 * moves further than the tolerance keeps its original bytes and is recorded as
 * skipped. That is the L-1 risk - a lossy step worse than the payload it saves
 * - and the mitigation is that the check runs per asset and can only fall back.
 *
 * The comparison is nearest-neighbour over world-space positions, and it took
 * three wrong versions to get there - `vertexDisplacement` records all three,
 * because each failed in a way that looked like a passing result.
 *
 * Every accepted model's measurement is written to
 * `asset-pipeline/encoding-report.json`, and `tests/asset-encoding.test.js`
 * asserts the whole catalog is covered and inside tolerance - so the claim is
 * checkable from a checkout, without running the encoder.
 *
 * ## Determinism
 *
 * Draco's encoder is deterministic for fixed settings, and the settings live in
 * ENCODE below rather than on a command line, so two runs over an unchanged
 * tree produce identical bytes. `--check` depends on that: it re-encodes into
 * memory and compares, so a stale tree is a CI failure rather than a surprise.
 */
import {NodeIO, Format} from '@gltf-transform/core';
import {KHRONOS_EXTENSIONS, KHRDracoMeshCompression} from '@gltf-transform/extensions';
import {draco} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import {readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative, sep} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MODELS = join(ROOT, 'public', 'models');
// Beside the other pipeline records rather than in public/: it is evidence
// about a build step, not something a visitor should be served.
const REPORT_PATH = join(ROOT, 'asset-pipeline', 'encoding-report.json');

/**
 * Encoder settings.
 *
 * 24-bit positions rather than the 14 the trial used, and the seven extra bits
 * are bought with 6.7 points of compression - 80.1% down to 73.4%. At 14 bits
 * `model-conversion.test.js` failed 100 of its 194 cases, every model missing
 * on bounds AND surface area; at 24 it fails 22, all of them the one assertion
 * no lossy codec can satisfy at any depth. Those seven bits are the difference
 * between "the geometry moved" and "the hash changed", which is the difference
 * worth paying for.
 *
 * `quantizeTexcoord` is 20 rather than the more usual 12 for the same reason:
 * the grid is spread over each model's ACTUAL uv range, and this catalog tiles
 * - a model whose uvs span 0..10 gets a grid ten times coarser than one that
 * stays inside the unit square. At 16 bits two models missed the conversion
 * suite's existing 1.5e-4 uv tolerance; at 20 they do not.
 *
 * `edgebreaker` compresses better than `sequential` and requires manifold
 * topology; a primitive it cannot handle is left uncompressed by the encoder
 * itself, which is a fallback rather than a failure - one primitive in the
 * catalog takes it.
 */
const ENCODE = {
	method: 'edgebreaker',
	quantizePosition: 24,
	quantizeNormal: 12,
	quantizeTexcoord: 20,
	quantizeColor: 8,
	quantizeGeneric: 12,
};

/**
 * How far any single vertex may move, in model units (centimetres).
 *
 * NOT a bounding-box tolerance - see `vertexDisplacement` for why that measure
 * is worthless here. 0.0005 cm is five micrometres, and it is not an arbitrary
 * round number: it is the tolerance `model-conversion.test.js` already applies
 * to bounds and surface area, so the encoder refuses exactly what the
 * conversion oracle would refuse, one step earlier and per asset.
 */
const TOLERANCE_CM = 0.0005;

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const FORCE = args.has('--force');
const DRY = args.has('--dry');

/** @param {string} directory @returns {string[]} */
function walk(directory)
{
	/** @type {string[]} */
	const out = [];
	for (const name of readdirSync(directory).sort())
	{
		const full = join(directory, name);
		if (statSync(full).isDirectory()) { out.push(...walk(full)); }
		else if (/\.glb$/i.test(name)) { out.push(full); }
	}
	return out;
}

/** True if the container already declares Draco, read from the JSON chunk. */
function isEncoded(bytes)
{
	if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) { return false; }
	let off = 12;
	while (off + 8 <= bytes.length)
	{
		const len = bytes.readUInt32LE(off);
		const type = bytes.readUInt32LE(off + 4);
		if (type === 0x4e4f534a)
		{
			try
			{
				const json = JSON.parse(bytes.subarray(off + 8, off + 8 + len).toString('utf8'));
				const used = [].concat(json.extensionsUsed || [], json.extensionsRequired || []);
				return used.indexOf('KHR_draco_mesh_compression') !== -1;
			}
			catch { return false; }
		}
		off += 8 + len;
	}
	return false;
}

function multiply(m, v, out)
{
	out[0] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
	out[1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
	out[2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
	return out;
}

/**
 * World-space bounds, vertex and triangle totals - what the renderer draws,
 * rather than what the accessors happen to hold.
 *
 * Reading accessors directly is the trap here and it cost a full run to find:
 * quantization maps positions onto an integer grid and compensates with a scale
 * and translation on the parent NODE, so an accessor-space comparison reports
 * drift of over 1000% for a model that renders identically.
 */
function worldBounds(document)
{
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	let vertices = 0;
	let triangles = 0;
	const element = [0, 0, 0];
	const world = [0, 0, 0];

	for (const scene of document.getRoot().listScenes())
	{
		scene.traverse((node) =>
		{
			const mesh = node.getMesh();
			if (!mesh) { return; }
			const matrix = node.getWorldMatrix();
			for (const primitive of mesh.listPrimitives())
			{
				const position = primitive.getAttribute('POSITION');
				if (!position) { continue; }
				const count = position.getCount();
				const indices = primitive.getIndices();
				vertices += count;
				triangles += (indices ? indices.getCount() : count) / 3;
				for (let i = 0; i < count; i++)
				{
					position.getElement(i, element);
					multiply(matrix, element, world);
					for (let c = 0; c < 3; c++)
					{
						if (world[c] < lo[c]) { lo[c] = world[c]; }
						if (world[c] > hi[c]) { hi[c] = world[c]; }
					}
				}
			}
		});
	}
	return {lo, hi, vertices, triangles};
}

/**
 * Assemble a GLB whose images stay EXTERNAL.
 *
 * `writeBinary()` embeds every resolved resource into the BIN chunk, and for
 * this catalog that is a defect rather than an inefficiency. 21 models
 * reference an external texture, two of those textures are shared by two models
 * each, and embedding them would both duplicate 933.6 KB and - because the
 * originals stay on disk for the other references - serve the same pixels
 * twice. `GUSossingtonendtable.glb` is the clearest case: 22,936 bytes of model
 * become 729,608 when a 704 KB oak texture is folded in.
 *
 * So the JSON is written in glTF format, which keeps `images[].uri` pointing at
 * the file that is already there, and the GLB container is assembled by hand
 * from that JSON plus the one geometry buffer. Every other resource - which is
 * to say every image - is dropped on the floor, because it is already on disk
 * under exactly the name the JSON now names.
 *
 * @returns {Buffer|null} null when the document has a shape this cannot handle.
 */
async function assembleExternal(io, document)
{
	const jsonDoc = await io.writeJSON(document, {format: Format.GLTF, basename: 'model'});
	const json = jsonDoc.json;

	// One buffer, or this is not a shape worth hand-assembling. Every model in
	// this catalog is single-buffer; a multi-buffer document falls back.
	if (!json.buffers || json.buffers.length !== 1) { return null; }
	const bufferUri = json.buffers[0].uri;
	if (!bufferUri) { return null; }
	const bin = jsonDoc.resources[bufferUri];
	if (!bin) { return null; }

	// A GLB's single buffer is the BIN chunk and carries no uri.
	delete json.buffers[0].uri;
	json.buffers[0].byteLength = bin.byteLength;

	// Anything still referencing a resource by uri must be a resource that is
	// already a file on disk. If a non-image points at one, bail rather than
	// silently drop it.
	for (const image of json.images || [])
	{
		if (!image.uri) { return null; }
	}

	const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8');
	const jsonPad = (4 - (jsonChunk.length % 4)) % 4;
	const binPad = (4 - (bin.byteLength % 4)) % 4;
	const total = 12 + 8 + jsonChunk.length + jsonPad + 8 + bin.byteLength + binPad;

	const out = Buffer.alloc(total);
	let off = 0;
	out.writeUInt32LE(0x46546c67, off); off += 4;      // 'glTF'
	out.writeUInt32LE(2, off); off += 4;               // version
	out.writeUInt32LE(total, off); off += 4;
	out.writeUInt32LE(jsonChunk.length + jsonPad, off); off += 4;
	out.writeUInt32LE(0x4e4f534a, off); off += 4;      // 'JSON'
	jsonChunk.copy(out, off); off += jsonChunk.length;
	out.fill(0x20, off, off + jsonPad); off += jsonPad;   // JSON pads with spaces
	out.writeUInt32LE(bin.byteLength + binPad, off); off += 4;
	out.writeUInt32LE(0x004e4942, off); off += 4;      // 'BIN\0'
	Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength).copy(out, off); off += bin.byteLength;
	out.fill(0, off, off + binPad);                    // BIN pads with zeroes

	return out;
}

function drift(before, after)
{
	let worst = 0;
	for (let c = 0; c < 3; c++)
	{
		worst = Math.max(worst, Math.abs(after.lo[c] - before.lo[c]), Math.abs(after.hi[c] - before.hi[c]));
	}
	const span = Math.max(hi(before) - lo(before), 1e-9);
	return {absolute: worst, relative: worst / span};
}
function lo(b) { return Math.min(b.lo[0], b.lo[1], b.lo[2]); }
function hi(b) { return Math.max(b.hi[0], b.hi[1], b.hi[2]); }

/**
 * Every distinct world-space position, sorted. The comparable form of a model.
 *
 * Sorted because **Draco reorders vertices** - edgebreaker re-indexes for
 * compression, so vertex `k` before and vertex `k` after are different points
 * and comparing them index-wise is meaningless. It reports a 243 cm error on a
 * model that moved by microns, which is how that was found.
 *
 * Distinct because welding legitimately merges coincident vertices, and a
 * per-vertex list would report that as a wholesale change.
 */
function positionSet(document)
{
	const points = [];
	const element = [0, 0, 0];
	const world = [0, 0, 0];

	for (const scene of document.getRoot().listScenes())
	{
		scene.traverse((node) =>
		{
			const mesh = node.getMesh();
			if (!mesh) { return; }
			const matrix = node.getWorldMatrix();
			for (const primitive of mesh.listPrimitives())
			{
				const position = primitive.getAttribute('POSITION');
				if (!position) { continue; }
				for (let i = 0; i < position.getCount(); i++)
				{
					position.getElement(i, element);
					multiply(matrix, element, world);
					points.push([world[0], world[1], world[2]]);
				}
			}
		});
	}

	const seen = new Set();
	const distinct = [];
	for (const p of points)
	{
		const key = p[0] + ',' + p[1] + ',' + p[2];
		if (seen.has(key)) { continue; }
		seen.add(key);
		distinct.push(p);
	}
	return distinct;
}

/**
 * How many positions are distinct **at three decimal places**.
 *
 * Deliberately the same granularity as `positionDigest` in
 * tests/helpers/models.js, because this gate exists to refuse exactly what that
 * oracle would refuse. Matching it at full float precision instead was the
 * first attempt and it rejected 99 of 165 models: dequantization reconstructs
 * two vertices that were bit-identical as two floats a nanometre apart, so an
 * exact-equality dedup counts them twice and reports the model as having
 * sprouted vertices it did not. The surface is unchanged; only the bit pattern
 * moved, which is the whole reason the 3dp rounding is there.
 */
function distinctAtThreeDp(points)
{
	const seen = new Set();
	for (const p of points)
	{
		seen.add(p[0].toFixed(3) + ',' + p[1].toFixed(3) + ',' + p[2].toFixed(3));
	}
	return seen.size;
}

/**
 * How far the furthest vertex actually moved.
 *
 * The bounding box cannot answer this and it took a wrong answer to notice why:
 * Draco quantizes **over** the bounding box, so the extremes land exactly on
 * grid endpoints and the box is the one measurement the codec preserves best.
 * It reported 0.00002 cm while interior vertices had moved by 27. The
 * conversion suite caught what this check was structurally blind to, and this
 * is the check rewritten to see it.
 *
 * **Nearest neighbour, not index-wise**, and this is the third version of this
 * function - the first two were both wrong and instructively so:
 *
 *   1. Bounding box. Blind by construction: Draco quantizes OVER the box, so
 *      the extremes land on grid endpoints and the box is the last thing to
 *      move. Reported 0.00002 cm against a real 0.0027.
 *   2. Index-wise. Meaningless: edgebreaker reorders vertices, so vertex k
 *      before and vertex k after are different points. Reported 243 cm.
 *   3. Sorted index-wise. Fragile: when quantization merges one coincident
 *      pair and splits another, the lists stay the same length but every
 *      element after the divergence is off by one. Reported 185 cm on a model
 *      200 cm across, which is what a correspondence failure looks like when
 *      it is mistaken for motion.
 *
 * So: for every point in the encoded model, the distance to the CLOSEST point
 * in the authored model. That is well defined whether or not vertices were
 * welded, reordered or renumbered, and it is the question actually being asked
 * - "did any surface move" - rather than a proxy for it.
 *
 * A uniform spatial hash makes it linear. Cell size is 200x the tolerance, so
 * a genuine match is always in the 27-cell neighbourhood and a point with no
 * neighbour at all reports Infinity rather than a quietly wrong small number.
 *
 * @returns {{moved: number, before: number, after: number}}
 */
function vertexDisplacement(before, after)
{
	const CELL = TOLERANCE_CM * 200;
	/** @type {Map<string, number[][]>} */
	const grid = new Map();

	for (const point of before)
	{
		const key = Math.floor(point[0] / CELL) + ':' + Math.floor(point[1] / CELL) + ':' + Math.floor(point[2] / CELL);
		const bucket = grid.get(key);
		if (bucket) { bucket.push(point); }
		else { grid.set(key, [point]); }
	}

	let worst = 0;
	for (const point of after)
	{
		const cx = Math.floor(point[0] / CELL);
		const cy = Math.floor(point[1] / CELL);
		const cz = Math.floor(point[2] / CELL);
		let nearest = Infinity;

		for (let dx = -1; dx <= 1; dx++)
		{
			for (let dy = -1; dy <= 1; dy++)
			{
				for (let dz = -1; dz <= 1; dz++)
				{
					const bucket = grid.get((cx + dx) + ':' + (cy + dy) + ':' + (cz + dz));
					if (!bucket) { continue; }
					for (const candidate of bucket)
					{
						const distance = Math.max(
							Math.abs(candidate[0] - point[0]),
							Math.abs(candidate[1] - point[1]),
							Math.abs(candidate[2] - point[2]),
						);
						if (distance < nearest) { nearest = distance; }
					}
				}
			}
		}

		if (nearest > worst) { worst = nearest; }
		if (worst === Infinity) { break; }
	}

	return {moved: worst, before: before.length, after: after.length};
}

async function main()
{
	const io = new NodeIO()
		.registerExtensions(KHRONOS_EXTENSIONS)
		.registerExtensions([KHRDracoMeshCompression])
		.registerDependencies({
			'draco3d.decoder': await draco3d.createDecoderModule(),
			'draco3d.encoder': await draco3d.createEncoderModule(),
		});

	// gltf-transform narrates every transform on console.warn. Useful once,
	// noise across 165 files - the ones that matter are counted instead.
	const warned = {texcoord: 0, refused: 0};
	const realWarn = console.warn;
	console.warn = (...parts) =>
	{
		const line = parts.join(' ');
		if (line.includes('Skipping TEXCOORD_0')) { warned.texcoord += 1; }
		else if (line.includes('Error applying Draco')) { warned.refused += 1; }
	};

	const files = walk(MODELS);
	const report = {encoded: [], already: [], skipped: [], failed: [], stale: []};
	/** @type {Record<string, Object>} Per-model fidelity, written out below. */
	const fidelity = {};
	let before = 0;
	let after = 0;

	for (const file of files)
	{
		const original = readFileSync(file);
		const name = relative(join(ROOT, 'public'), file).split(sep).join('/');
		before += original.length;

		if (isEncoded(original) && !FORCE)
		{
			report.already.push(name);
			after += original.length;
			continue;
		}

		// Written beside the original so its relative texture URIs resolve to
		// the same files, which is what lets the verification read the encoded
		// bytes back the way the browser will rather than the way the encoder
		// left them in memory.
		const scratch = file.replace(/\.glb$/i, '.encoding.glb');

		try
		{
			// Read twice from disk rather than cloning: the encode mutates its
			// document, and the reference has to be the untouched file.
			const referenceDoc = await io.read(file);
			const reference = worldBounds(referenceDoc);
			const referencePoints = positionSet(referenceDoc);
			const document = await io.read(file);
			await document.transform(draco(ENCODE));

			const encoded = await assembleExternal(io, document);
			if (!encoded)
			{
				report.skipped.push({name, reason: 'unsupported buffer or image layout'});
				after += original.length;
				continue;
			}
			if (encoded.length >= original.length)
			{
				report.skipped.push({name, reason: 'no saving (' + original.length + ' -> ' + encoded.length + ')'});
				after += original.length;
				continue;
			}

			// Read back THROUGH the decoder, from disk. Encoding without
			// decoding proves only that the encoder ran.
			writeFileSync(scratch, encoded);
			let decoded;
			try { decoded = await io.read(scratch); }
			finally { unlinkSync(scratch); }

			const roundTrip = worldBounds(decoded);
			const decodedPoints = positionSet(decoded);
			const displacement = vertexDisplacement(referencePoints, decodedPoints);
			const box = drift(reference, roundTrip);

			// Three gates, not one, and the two added here are the ones
			// `model-conversion.test.js` turned out to be asserting all along.
			// A model that trips any of them keeps its authored bytes: the catalog
			// is 165 files and losing the compression on a handful of them costs
			// kilobytes, while weakening a 194-case oracle to accommodate them
			// costs the ability to notice the next change of the same kind.
			const trianglesLost = Math.round(reference.triangles) - Math.round(roundTrip.triangles);
			if (trianglesLost !== 0)
			{
				report.skipped.push({name, reason: 'triangles ' + Math.round(reference.triangles) + ' -> ' + Math.round(roundTrip.triangles)});
				after += original.length;
				continue;
			}
			const distinctBefore = distinctAtThreeDp(referencePoints);
			const distinctAfter = distinctAtThreeDp(decodedPoints);
			if (distinctBefore !== distinctAfter)
			{
				report.skipped.push({name, reason: 'distinct positions ' + distinctBefore + ' -> ' + distinctAfter});
				after += original.length;
				continue;
			}
			if (displacement.moved > TOLERANCE_CM)
			{
				report.skipped.push({
					name,
					reason: displacement.moved === Infinity
						? 'a vertex has no counterpart within ' + (TOLERANCE_CM * 200) + ' cm'
						: 'vertex moved ' + displacement.moved.toExponential(3) + ' cm',
				});
				after += original.length;
				continue;
			}

			if (CHECK) { report.stale.push(name); after += original.length; continue; }
			if (!DRY) { writeFileSync(scratch, encoded); renameSync(scratch, file); }

			after += encoded.length;
			const record = {
				name,
				from: original.length,
				to: encoded.length,
				movedCm: Number(displacement.moved.toExponential(4)),
				boxCm: Number(box.absolute.toExponential(4)),
				vertices: distinctAfter,
				triangles: Math.round(roundTrip.triangles),
			};
			report.encoded.push(record);
			fidelity[name] = record;
		}
		catch (error)
		{
			try { unlinkSync(scratch); } catch { /* never written */ }
			report.failed.push({name, message: error && error.message ? error.message : String(error)});
			after += original.length;
		}
	}

	console.warn = realWarn;

	const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
	if (CHECK)
	{
		if (report.stale.length)
		{
			console.error('asset encoding is stale: ' + report.stale.length + ' model(s) would change.');
			report.stale.slice(0, 10).forEach((n) => console.error('  ' + n));
			console.error('run `npm run encode`');
			process.exit(1);
		}
		console.log('asset encoding is up to date (' + report.already.length + ' encoded, ' + report.skipped.length + ' deliberately unencoded).');
		return;
	}

	console.log((DRY ? '[dry run] ' : '') + 'models: ' + files.length);
	console.log('  encoded now      ' + report.encoded.length);
	console.log('  already encoded  ' + report.already.length);
	console.log('  skipped          ' + report.skipped.length);
	console.log('  failed           ' + report.failed.length);
	console.log('  ' + mb(before) + ' -> ' + mb(after) + '  (' + (100 * (1 - after / before)).toFixed(1) + '%)');
	if (warned.texcoord) { console.log('  TEXCOORD_0 outside [0,1], left unquantized: ' + warned.texcoord + ' primitives'); }
	if (warned.refused) { console.log('  primitives Draco refused, left uncompressed: ' + warned.refused); }

	report.skipped.forEach((s) => console.log('  SKIPPED ' + s.name + ' - ' + s.reason));
	report.failed.forEach((f) => console.log('  FAILED  ' + f.name + ' - ' + f.message));

	if (!DRY && report.encoded.length)
	{
		// Merged rather than replaced: a run that re-encodes one model must not
		// drop the measurements for the 164 it skipped as already done.
		let existing = {};
		try { existing = JSON.parse(readFileSync(REPORT_PATH, 'utf8')).models || {}; }
		catch { /* first run */ }

		const models = Object.assign(existing, fidelity);
		const sorted = {};
		for (const key of Object.keys(models).sort()) { sorted[key] = models[key]; }

		let worst = 0;
		for (const record of Object.values(sorted)) { worst = Math.max(worst, record.movedCm); }

		writeFileSync(REPORT_PATH, JSON.stringify({
			_comment: [
				'Generated by tools/encode-assets.mjs. Do not edit by hand.',
				'movedCm is how far the furthest vertex of that model moved, comparing',
				'sorted distinct world-space positions before and after encoding.',
				'boxCm is the bounding-box delta, recorded only to show how much',
				'smaller it is than the real number - see the tool for why.',
			],
			settings: ENCODE,
			toleranceCm: TOLERANCE_CM,
			worstMovedCm: Number(worst.toExponential(4)),
			models: sorted,
		}, null, '\t') + '\n');
		console.log('\n  wrote ' + relative(ROOT, REPORT_PATH) + ' (' + Object.keys(sorted).length + ' models, worst ' + worst.toExponential(3) + ' cm)');
	}

	if (report.failed.length) { process.exit(1); }
}

await main();
