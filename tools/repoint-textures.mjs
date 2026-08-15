/**
 * Point every reference at the transcoded texture it now needs (B5).
 *
 *   npm run repoint                 rewrite containers and catalogs
 *   npm run repoint -- --check      exit non-zero if any reference is stale
 *   npm run repoint -- --dry        report what would change, write nothing
 *
 * `encode-textures.mjs` replaces the files. This replaces the references, and
 * they live in three different places with three different rules:
 *
 *   **Inside 21 `.glb` containers.** `GLTFLoader` resolves `images[].uri`
 *   relative to the model file, so these never pass through `AssetResolver` and
 *   a manifest retirement cannot reach them. They have to be rewritten.
 *
 *   **In `src/catalog/textures.json` and `room.js`.** These name the room
 *   textures a user can pick. Updating them is what makes NEW designs record
 *   the new name.
 *
 *   **In saved designs, which cannot be rewritten at all.** Handled by the
 *   retirement table in `make-asset-manifest.mjs`, not here - listed so the
 *   third case is visibly accounted for rather than forgotten.
 *
 * ## Surgery on the JSON chunk, not a round trip
 *
 * The obvious implementation reads each `.glb` with glTF-Transform, changes the
 * textures and writes it back. That would re-run the Draco encoder over
 * geometry B1 spent a sprint proving, and B1's guarantee - no triangle lost, no
 * vertex moved more than 5 um - would have to be re-established afterwards.
 *
 * So this parses the container, edits the JSON chunk, and copies the BIN chunk
 * through byte for byte. The geometry is not decoded, re-encoded or touched,
 * which makes B1's fidelity claim true here by construction rather than by
 * re-measurement. `binUnchanged` in the report records the BIN hash before and
 * after so the claim is checkable rather than asserted.
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, posix, relative, resolve, sep} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const MODELS = join(PUBLIC, 'models');
const TRANSCODE_PATH = join(ROOT, 'asset-pipeline', 'texture-transcode.json');
const REPORT_PATH = join(ROOT, 'asset-pipeline', 'texture-repoint.json');
const CATALOG_TEXTURES = join(ROOT, 'src', 'catalog', 'textures.json');
const ROOM_JS = join(ROOT, 'src', 'scripts', 'model', 'room.js');

const BASISU = 'KHR_texture_basisu';
const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** @param {string} directory @returns {string[]} */
function walk(directory)
{
	const out = [];
	for (const entry of readdirSync(directory).sort())
	{
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) { out.push(...walk(path)); }
		else if (entry.toLowerCase().endsWith('.glb')) { out.push(path); }
	}
	return out;
}

/**
 * Split a GLB into its JSON chunk and everything after it.
 *
 * @param {Buffer} bytes
 * @returns {{json: Object, jsonStart: number, jsonLength: number, rest: Buffer} | null}
 */
export function readGlb(bytes)
{
	if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) { return null; }
	let offset = 12;
	while (offset + 8 <= bytes.length)
	{
		const length = bytes.readUInt32LE(offset);
		const type = bytes.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			const text = bytes.subarray(offset + 8, offset + 8 + length).toString('utf8');
			return {
				json: JSON.parse(text),
				jsonStart: offset,
				jsonLength: length,
				rest: bytes.subarray(offset + 8 + length),
			};
		}
		offset += 8 + length;
	}
	return null;
}

/**
 * Reassemble a GLB around a new JSON chunk, copying everything after it.
 *
 * @param {Object} json @param {Buffer} rest @returns {Buffer}
 */
export function writeGlb(json, rest)
{
	const chunk = Buffer.from(JSON.stringify(json), 'utf8');
	// The spec requires 4-byte alignment, and the JSON chunk pads with SPACES
	// rather than zeroes - a zero-padded JSON chunk is a parse error in strict
	// readers. `encode-assets.mjs` does the same thing for the same reason.
	const pad = (4 - (chunk.length % 4)) % 4;
	const total = 12 + 8 + chunk.length + pad + rest.length;

	const out = Buffer.alloc(total);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(total, 8);
	out.writeUInt32LE(chunk.length + pad, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	chunk.copy(out, 20);
	out.fill(0x20, 20 + chunk.length, 20 + chunk.length + pad);
	rest.copy(out, 20 + chunk.length + pad);
	return out;
}

/** What an image's `mimeType` should say, from the name it now carries. */
const MIME = {'.ktx2': 'image/ktx2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'};

/**
 * Repoint one container's images, in whichever direction the tree now needs.
 *
 * ## Why this goes both ways (RM-006)
 *
 * B5 wrote this to move references from a source to its transcode, once, and
 * that was the only direction anything needed - a texture was encoded and it
 * stayed encoded. RM-006 broke that assumption: a per-asset refusal is a verdict
 * on a MEASUREMENT, and a measurement can change. Nine of B5's eighteen turned
 * out to be past the codec gate, so eight of them go back to being JPEGs, and
 * the references have to follow them back.
 *
 * A one-way repointer would have left eight containers naming files that are no
 * longer there. `--check` catches that, which is the whole reason it looks for
 * the file beside the container - but catching it is not fixing it, and the fix
 * by hand is editing the JSON chunk of eight GLBs.
 *
 * The reverse direction takes its target from the tree rather than from the
 * report: a `.ktx2` reference with no entry in `renamed` is restored to whatever
 * source sits beside it under the same stem. That is the same question
 * `--check` asks, so a container this function leaves alone is one `--check`
 * will pass, by construction.
 *
 * @param {Object} json The glTF JSON chunk, mutated in place.
 * @param {Map<string, string>} renamed source basename -> ktx2 basename
 * @param {(stem: string, directory: string) => string | null} findSource names the
 *        source file sitting in that directory beside the container, as a BARE
 *        BASENAME - the caller joins it back onto the URI's own directory, the
 *        same way the forward path does - or null when the `.ktx2` is still the
 *        right target.
 * @returns {string[]} the images that changed
 */
export function repointJson(json, renamed, findSource = () => null)
{
	const changed = [];
	const movedImages = new Set();
	const returnedImages = new Set();
	const transcoded = new Set(renamed.values());

	for (const [index, image] of (json.images || []).entries())
	{
		if (!image.uri) { continue; }
		// URIs in these containers are relative and percent-encoded by the
		// writer; compare on the decoded basename, which is what the transcode
		// report keys on.
		const decoded = decodeURIComponent(image.uri);
		const base = posix.basename(decoded);
		const target = renamed.get(base);
		if (target)
		{
			image.uri = posix.join(posix.dirname(decoded), target);
			image.mimeType = 'image/ktx2';
			movedImages.add(index);
			changed.push(image.uri);
			continue;
		}

		// The way back. Only for a `.ktx2` the report no longer claims, so a
		// container pointing at a live transcode is never disturbed.
		if (!base.toLowerCase().endsWith('.ktx2') || transcoded.has(base)) { continue; }
		const source = findSource(base.replace(/\.ktx2$/i, ''), posix.dirname(decoded));
		if (!source) { continue; }
		image.uri = posix.join(posix.dirname(decoded), source);
		image.mimeType = MIME[posix.extname(source).toLowerCase()] || 'application/octet-stream';
		returnedImages.add(index);
		changed.push(image.uri);
	}

	if (!changed.length) { return changed; }

	// A KTX2 image is reached through the extension rather than through
	// `source`. Leaving both would be legal but ambiguous: a loader without the
	// extension would silently read `source` and try to decode a KTX2 as a
	// JPEG, which is the failure this is meant to prevent outright.
	for (const texture of json.textures || [])
	{
		if (texture.source !== undefined && movedImages.has(texture.source))
		{
			texture.extensions = texture.extensions || {};
			texture.extensions[BASISU] = {source: texture.source};
			delete texture.source;
			continue;
		}
		// And the way back: the plain `source` is how a JPEG is reached, so the
		// extension entry is removed rather than left pointing at an image that
		// is no longer a KTX2.
		const through = texture.extensions && texture.extensions[BASISU];
		if (!through || !returnedImages.has(through.source)) { continue; }
		texture.source = through.source;
		delete texture.extensions[BASISU];
		if (!Object.keys(texture.extensions).length) { delete texture.extensions; }
	}

	// Required, not merely used: without the extension there is no way to read
	// these images at all, and the spec says a container that cannot be
	// rendered without an extension must declare it required. Dropped again when
	// the last KTX2 leaves - a container that declares an extension it does not
	// use is refused outright by strict loaders.
	const stillUsed = (json.textures || []).some((texture) => texture.extensions && texture.extensions[BASISU]);
	for (const key of ['extensionsUsed', 'extensionsRequired'])
	{
		json[key] = (json[key] || []).filter((name) => name !== BASISU);
		if (stillUsed) { json[key].push(BASISU); }
		json[key].sort();
		if (!json[key].length) { delete json[key]; }
	}

	return changed;
}

function main()
{
	if (!existsSync(TRANSCODE_PATH))
	{
		console.error('\nNo asset-pipeline/texture-transcode.json. Run `npm run encode:textures` first.\n');
		process.exit(1);
	}
	const transcode = JSON.parse(readFileSync(TRANSCODE_PATH, 'utf8'));

	/** basename -> ktx2 basename, for the model textures inside containers. */
	const renamed = new Map();
	/** full logical name -> ktx2 logical name, for everything. */
	const logical = new Map();
	for (const entry of transcode.textures)
	{
		renamed.set(posix.basename(entry.from), posix.basename(entry.to));
		logical.set(entry.from, entry.to);
	}

	const report = {containers: [], catalogs: [], totals: {}};
	const problems = [];

	for (const path of walk(MODELS))
	{
		const name = relative(PUBLIC, path).split(sep).join('/');
		const bytes = readFileSync(path);
		const parsed = readGlb(bytes);
		if (!parsed) { problems.push(`${name} is not a readable GLB`); continue; }

		const before = sha(parsed.rest);
		// A source beside the container under the same stem, which is exactly
		// what `--check` requires a reference to resolve to.
		const findSource = (stem, directory) =>
		{
			for (const extension of ['.jpg', '.jpeg', '.png'])
			{
				if (existsSync(join(dirname(path), directory, stem + extension))) { return stem + extension; }
			}
			return null;
		};
		const changed = repointJson(parsed.json, renamed, findSource);
		if (!changed.length) { continue; }

		const rebuilt = writeGlb(parsed.json, parsed.rest);
		const after = sha(readGlb(rebuilt).rest);
		if (before !== after)
		{
			// Cannot happen through the code above, which copies `rest`
			// untouched - which is exactly why it is worth asserting. A silent
			// change here would be a change to Draco-encoded geometry.
			problems.push(`${name} would have its BIN chunk altered`);
			continue;
		}

		report.containers.push({name, images: changed, binSha256: before, bytesBefore: bytes.length, bytesAfter: rebuilt.length});
		if (!DRY && !CHECK) { writeFileSync(path, rebuilt); }
	}

	// The catalogs, which decide what a NEW design records.
	for (const file of [CATALOG_TEXTURES, ROOM_JS])
	{
		const relativeName = relative(ROOT, file).split(sep).join('/');
		let text = readFileSync(file, 'utf8');
		const hits = [];
		for (const [from, to] of logical)
		{
			if (!text.includes(from)) { continue; }
			text = text.split(from).join(to);
			hits.push(`${from} -> ${to}`);
		}
		if (!hits.length) { continue; }
		report.catalogs.push({file: relativeName, replacements: hits});
		if (!DRY && !CHECK) { writeFileSync(file, text); }
	}

	report.totals = {containers: report.containers.length, catalogs: report.catalogs.length};

	if (CHECK)
	{
		// Stale means: a container still names a file that no longer exists, or
		// a catalog still names one. Both are 404s at runtime and neither shows
		// up as a build error.
		for (const path of walk(MODELS))
		{
			const name = relative(PUBLIC, path).split(sep).join('/');
			const parsed = readGlb(readFileSync(path));
			if (!parsed) { problems.push(`${name} is not a readable GLB`); continue; }
			for (const image of parsed.json.images || [])
			{
				if (!image.uri) { continue; }
				const uri = decodeURIComponent(image.uri);
				const beside = join(dirname(path), uri);
				if (!existsSync(beside)) { problems.push(`${name} references ${uri}, which is not there`); }
			}
		}
		for (const [from] of logical)
		{
			for (const file of [CATALOG_TEXTURES, ROOM_JS])
			{
				if (readFileSync(file, 'utf8').includes(from))
				{
					problems.push(`${relative(ROOT, file).split(sep).join('/')} still names ${from}`);
				}
			}
		}

		if (problems.length)
		{
			console.error('\nReferences are stale:\n');
			problems.forEach((line) => console.error('  ' + line));
			console.error('\nRun `npm run repoint` and commit the result.\n');
			process.exit(1);
		}
		console.log('\nEvery container and catalog reference resolves to a file that is there.\n');
		return;
	}

	if (problems.length)
	{
		console.error('\nRefusing to write:\n');
		problems.forEach((line) => console.error('  ' + line));
		process.exit(1);
	}

	console.log(`\n${report.containers.length} containers repointed, ${report.catalogs.length} catalogs updated.\n`);
	for (const entry of report.catalogs)
	{
		console.log('  ' + entry.file);
		entry.replacements.forEach((line) => console.log('      ' + line));
	}
	console.log(`\n  ${report.containers.length} .glb files rewrote their JSON chunk; every BIN chunk is byte-identical.`);

	if (DRY) { console.log('\n  --dry: nothing written.\n'); return; }

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, '\t') + '\n');
	console.log('  wrote asset-pipeline/texture-repoint.json');
	console.log('  now add retirements to make-asset-manifest.mjs, then run `npm run manifest`.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
