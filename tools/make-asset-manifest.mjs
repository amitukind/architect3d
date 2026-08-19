/**
 * Generate public/asset-manifest.json (RM-003 A5).
 *
 *   npm run manifest
 *   npm run manifest -- --check     exit non-zero if the committed file is stale
 *
 * ## Why a manifest exists at all
 *
 * H-8. Vite copies `public/` to the dist root **as-is** and never hashes those
 * filenames, unlike imported assets which do get hashed. That is not an
 * oversight to fix: these URLs are written *into saved designs* - `model_url`
 * on every item, `newFloorTextures[].url` on every custom floor - so hashing
 * them would break every document that already exists. `tests/asset-integrity.test.js`
 * has defended that since P6.
 *
 * So the indirection has to happen at runtime, between the logical name in the
 * file and the physical URL on the network. This is the table that makes that
 * possible, and `src/scripts/core/asset_resolver.js` is what consults it.
 *
 * ## What it is not
 *
 * It is not a build step anybody has to run to develop. The committed file is
 * an identity map today - every logical name resolves to itself - so a checkout
 * with a stale manifest behaves exactly as one with no manifest at all. What
 * the file buys is the *ability* to make them differ: give an entry a `url` and
 * every saved design that names it follows, with no file renamed and no
 * document rewritten.
 *
 * ## Determinism
 *
 * No timestamp, sorted keys, and `url` omitted wherever it equals the key. A
 * generated file that churns on every run is a file nobody can review, and
 * `--check` in CI is only useful if regenerating an unchanged tree produces an
 * unchanged file.
 */
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative, sep} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const OUTPUT = join(PUBLIC, 'asset-manifest.json');
const INTEGRITY_OUTPUT = join(ROOT, 'asset-pipeline', 'asset-integrity.json');

/**
 * Whether the served manifest carries its hashes (RM-011 H1, M-43).
 *
 * Off by default, and the number is why. H1 added the first-load budget and its
 * opening measurement found that **17,065 of the manifest's 22,208 gzipped
 * bytes were subresource-integrity hashes** - 4.1 % of everything a person
 * downloads before their first wall, on every boot, for a feature `AssetResolver`
 * documents as off by default and that guards nothing for a same-origin
 * `public/`. It matters for a cross-origin CDN deployment, which is exactly the
 * build that should pass this flag.
 *
 * Nothing about the schema changed: `AssetManifest.parse` has always read `hash`
 * defensively and `integrityFor` has always been able to return null. What
 * changed is which builds pay for it.
 */
const INTEGRITY = process.argv.includes('--integrity');

/** The schema `AssetManifest.parse` understands. */
const MANIFEST_VERSION = 1;

/** The manifest describes the tree; it is not part of the tree it describes. */
const EXCLUDED = new Set(['asset-manifest.json']);

/**
 * What an asset is for, which is what a consumer branches on.
 *
 * Derived from the path rather than declared, because the path is what the
 * catalogs and the save files already say. A `kind` that had to be maintained
 * by hand would drift from the tree the first time somebody added a model.
 *
 * `decoder` is first because it is the one kind that is not content: it is the
 * machinery RM-004 B1 needs to read the rest, and a consumer deciding what to
 * prefetch must be able to tell it apart from a texture it would otherwise
 * match by falling through.
 *
 * @param {string} name A slash-separated path relative to public/.
 * @returns {string}
 */
function kindOf(name)
{
	// Both codecs' machinery, not just Draco's. B5 vendored the Basis
	// transcoder beside it, and a consumer deciding what to prefetch needs the
	// same answer for both - `basis/` falling through to `texture` would have
	// put 580 KB of WebAssembly into the texture-vram measurement.
	if (name.startsWith('draco/') || name.startsWith('basis/')) { return 'decoder'; }
	if (/\.(glb|gltf)$/i.test(name)) { return 'model'; }
	// Any thumbnails directory, not just models/thumbnails/. RM-004 B4 found the
	// narrower test mislabelling 148 files: `models/thumbnails_new/` (142, every
	// one an `image` in catalog.json) fell through to `model-texture`, and
	// `rooms/thumbnails/` (6, the texture picker's) to `texture`. Both are DOM
	// `<img>` sources that never reach the GPU, and calling them textures made
	// every consumer that branches on kind wrong about them - including B1's
	// texture-vram budget, which was measuring 60 MB of memory nothing uploads.
	// A file that is not an image is not a texture, whatever directory it is in.
	// The fall-through at the bottom of this function has decided `texture` since
	// A5, which was true while every file down here was one - and stopped being
	// true the moment H1 put a CREDITS.md beside the material library. The same
	// shape of mislabelling B4 found twice before, caught this time by
	// `tests/asset-integrity.test.js` before it reached a budget: the VRAM line
	// asks every `texture` for its dimensions, and a markdown file has none.
	if (!/\.(png|jpe?g|ktx2|webp|avif|basis)$/i.test(name)) { return 'document'; }
	// `_new` is kept in the pattern although RM-012 J1 emptied that directory -
	// every catalog thumbnail is now a render under `models/thumbnails/`. A
	// classifier that stops recognising a name is a classifier that mislabels the
	// day somebody restores one, and this costs two characters.
	if (/(^|\/)thumbnails(_new)?\//.test(name)) { return 'thumbnail'; }
	if (name.startsWith('rooms/textures/envs/')) { return 'environment'; }
	if (name.startsWith('models/')) { return 'model-texture'; }
	return 'texture';
}

const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * What decoder a file needs, read from the file rather than declared.
 *
 * Same argument as `kindOf`: a codec column maintained by hand drifts from the
 * tree the first time somebody re-encodes something, and this one has a much
 * worse failure mode than a wrong `kind` - a consumer that trusts it and does
 * not attach a decoder gets a model that will not open. So it is derived from
 * the container's own `extensionsRequired`, which is the same thing the loader
 * reads. RM-004 B1.
 *
 * @param {string} name
 * @param {Buffer} bytes
 * @returns {?string}
 */
function codecOf(name, bytes)
{
	// A KTX2 image declares itself in its first twelve bytes, which is a
	// stronger claim than the extension and costs nothing to check. Recorded so
	// `resolver.codecMix()` can answer "what is this build shipping" for
	// textures the way it already does for geometry.
	if (bytes.length >= 12 && bytes.subarray(0, 12).equals(KTX2_MAGIC)) { return 'ktx2'; }
	if (!/\.glb$/i.test(name) || bytes.length < 20) { return null; }
	if (bytes.readUInt32LE(0) !== 0x46546c67) { return null; }

	let offset = 12;
	while (offset + 8 <= bytes.length)
	{
		const length = bytes.readUInt32LE(offset);
		const type = bytes.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			try
			{
				const json = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
				const required = json.extensionsRequired || [];
				if (required.indexOf('KHR_draco_mesh_compression') !== -1) { return 'draco'; }
				if (required.indexOf('EXT_meshopt_compression') !== -1) { return 'meshopt'; }
			}
			catch { return null; }
			return null;
		}
		offset += 8 + length;
	}
	return null;
}

/** @param {string} directory @returns {string[]} absolute paths */
function walk(directory)
{
	const out = [];
	for (const entry of readdirSync(directory))
	{
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) { out.push(...walk(path)); }
		else { out.push(path); }
	}
	return out;
}

/**
 * Subresource-integrity form, which is what makes the hash directly usable:
 * `fetch(url, {integrity})` and `<link integrity>` both take exactly this.
 *
 * @param {Buffer} bytes
 * @returns {string}
 */
function sriHash(bytes)
{
	return 'sha256-' + createHash('sha256').update(bytes).digest('base64');
}

/**
 * Logical names that no longer have a file of their own.
 *
 * A5's rule is that an asset URL in a saved design is a NAME, not an address,
 * and the manifest's `url` field is the indirection that makes the rule true.
 * Nothing had used it until now: every entry's file sat at its own name, so the
 * generator omitted `url` everywhere and the seam was load-bearing only in
 * principle.
 *
 * `rooms/textures/hardwood.png` is the first retirement. It is the DEFAULT room
 * texture, so its name is written into every design that kept the default
 * floor, and re-encoding it as JPEG changed the extension. Without an entry
 * here those designs would resolve to a 404 - the manifest would say the asset
 * exists, the availability check would pass, and the load would fail at the
 * network instead, which `AssetResolver.missing()` exists to prevent.
 *
 * A name retires here rather than disappearing. The rule for adding one: the
 * old name keeps resolving forever, and the entry carries the hash and size of
 * the file it now points at, so nothing downstream has to special-case it.
 */
const RETIRED = {
	// The only one. `rooms/textures/hardwood.png` was re-encoded as JPEG, and it
	// is the DEFAULT room texture, so its name is in every design that kept the
	// default floor.
	//
	// B5 transcoded the MODEL textures to KTX2 and deliberately added nothing
	// here for them: they are reached through `images[].uri` inside a `.glb`,
	// which `repoint-textures.mjs` rewrites, and no document names them. The
	// room textures were left as JPEG - see tools/encode-textures.mjs for why
	// the texture cache cannot load a KTX2 today.
	'rooms/textures/hardwood.png': 'rooms/textures/hardwood.jpg',

	// The ground photograph, transcoded in RM-005 C1. No saved design names it -
	// it is not in any catalog and no picker offers it - so this entry is not
	// protecting documents the way the one above is. It is protecting the
	// PUBLISHED NAME: `Skybox` resolves this string, an embedder may pass it to
	// `setEnvironmentMap`, and P6 already renamed one of these two files once
	// (`Garden.png` -> `.jpg`) with nothing to catch a missed reference.
	//
	// Retiring it rather than only moving the constant is what makes both true
	// at once: current builds fetch the KTX2, and a build or a caller still
	// naming the JPEG gets the KTX2 rather than a 404.
	//
	// `envs/Garden.jpg` is deliberately NOT here. It was measured and refused -
	// ETC1S bands a sky gradient - so it is still a JPEG under its own name.
	'rooms/textures/Ground_4K.jpg': 'rooms/textures/Ground_4K.ktx2',
};

function build()
{
	/** @type {Record<string, {bytes: number, kind: string, hash?: string, codec?: string, url?: string}>} */
	const assets = {};
	/** @type {Record<string, string>} Every hash, whether or not one is served. */
	const integrity = {};

	for (const path of walk(PUBLIC))
	{
		const name = relative(PUBLIC, path).split(sep).join('/');
		if (EXCLUDED.has(name))
		{
			continue;
		}
		const bytes = readFileSync(path);
		const entry = {
			bytes: bytes.length,
			kind: kindOf(name),
		};
		// The hash goes into the served manifest only when somebody asks for it.
		// See INTEGRITY below for the measurement that moved it.
		if (INTEGRITY) { entry.hash = sriHash(bytes); }
		integrity[name] = sriHash(bytes);
		// Omitted rather than written as null when there is none, for the same
		// reason `url` is omitted when it equals the key: a generated file that
		// states every default is a file nobody reads.
		const codec = codecOf(name, bytes);
		if (codec) { entry.codec = codec; }
		assets[name] = entry;
	}

	// Retired names last, so they inherit the real entry rather than racing it.
	for (const [retired, actual] of Object.entries(RETIRED))
	{
		const target = assets[actual];
		if (!target)
		{
			throw new Error(`${retired} retires to ${actual}, which is not in the tree. `
				+ 'Either the file moved again or the retirement is stale; both need a decision, not a default.');
		}
		if (assets[retired])
		{
			throw new Error(`${retired} is listed as retired but a file of that name exists. `
				+ 'A name cannot be both live and retired - remove one.');
		}
		assets[retired] = {...target, url: actual};
	}

	const sorted = {};
	for (const name of Object.keys(assets).sort())
	{
		sorted[name] = assets[name];
	}

	const sortedIntegrity = {};
	for (const name of Object.keys(assets).sort())
	{
		// A retired name inherits the file's hash, the same way it inherits its
		// bytes: it is the same bytes.
		sortedIntegrity[name] = integrity[name] || integrity[assets[name].url];
	}

	return {
		manifest: {
			version: MANIFEST_VERSION,
			_comment: [
				'Generated by tools/make-asset-manifest.mjs. Do not edit by hand;',
				'run `npm run manifest`. An entry carries a `url` when the physical',
				'file is not at the logical name - that is the whole point of the',
				'indirection - and it is omitted wherever the two are equal, which is',
				'everywhere except the retired names listed in the generator.',
				INTEGRITY
					? 'Hashes are subresource-integrity form, written because this build asked for them with --integrity.'
					: 'Hashes are NOT here: they are in asset-pipeline/asset-integrity.json, and `npm run manifest -- --integrity` puts them back. See AssetResolver.',
			].join(' '),
			assets: sorted,
		},
		integrity: {
			version: MANIFEST_VERSION,
			_comment: [
				'Generated beside public/asset-manifest.json by tools/make-asset-manifest.mjs.',
				'Subresource-integrity hashes for every asset, kept OUT of the served',
				'manifest since RM-011 H1: they were 17,065 of its 22,208 gzipped bytes,',
				'on every boot, for a feature that is off by default and matters only to a',
				'cross-origin deployment. `npm run manifest -- --integrity` writes them into',
				'the served file for a build that wants them; this file is never served.',
			].join(' '),
			assets: sortedIntegrity,
		},
	};
}

const {manifest, integrity} = build();
const text = JSON.stringify(manifest, null, '\t') + '\n';
const integrityText = JSON.stringify(integrity, null, '\t') + '\n';

if (process.argv.includes('--check'))
{
	const stale = [];
	const read = (path) => {try {return readFileSync(path, 'utf8');} catch {return null;}};
	if (read(OUTPUT) !== text) { stale.push('public/asset-manifest.json'); }
	// Both, because the integrity file is what `tests/asset-integrity.test.js`
	// verifies the tree against - a stale one would pass a check of nothing.
	if (read(INTEGRITY_OUTPUT) !== integrityText) { stale.push('asset-pipeline/asset-integrity.json'); }
	if (stale.length)
	{
		console.error(`${stale.join(' and ')} out of date. Run \`npm run manifest\`.`);
		process.exit(1);
	}
	console.log(`asset manifest is up to date (${Object.keys(manifest.assets).length} assets).`);
}
else
{
	writeFileSync(OUTPUT, text);
	writeFileSync(INTEGRITY_OUTPUT, integrityText);
	const total = Object.values(manifest.assets).reduce((sum, entry) => sum + entry.bytes, 0);
	console.log(`Wrote ${Object.keys(manifest.assets).length} assets, ${(total / 1048576).toFixed(2)} MB, to public/asset-manifest.json`);
	console.log(`Wrote ${Object.keys(integrity.assets).length} hashes to asset-pipeline/asset-integrity.json`
		+ (INTEGRITY ? ' and into the manifest (--integrity).' : '.'));
}
