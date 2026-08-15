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
	if (name.startsWith('draco/')) { return 'decoder'; }
	if (/\.(glb|gltf)$/i.test(name)) { return 'model'; }
	// Any thumbnails directory, not just models/thumbnails/. RM-004 B4 found the
	// narrower test mislabelling 148 files: `models/thumbnails_new/` (142, every
	// one an `image` in catalog.json) fell through to `model-texture`, and
	// `rooms/thumbnails/` (6, the texture picker's) to `texture`. Both are DOM
	// `<img>` sources that never reach the GPU, and calling them textures made
	// every consumer that branches on kind wrong about them - including B1's
	// texture-vram budget, which was measuring 60 MB of memory nothing uploads.
	if (/(^|\/)thumbnails(_new)?\//.test(name)) { return 'thumbnail'; }
	if (name.startsWith('rooms/textures/envs/')) { return 'environment'; }
	if (name.startsWith('models/')) { return 'model-texture'; }
	return 'texture';
}

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
	'rooms/textures/hardwood.png': 'rooms/textures/hardwood.jpg',
};

function build()
{
	/** @type {Record<string, {bytes: number, hash: string, kind: string, codec?: string, url?: string}>} */
	const assets = {};

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
			hash: sriHash(bytes),
			kind: kindOf(name),
		};
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

	return {
		version: MANIFEST_VERSION,
		_comment: [
			'Generated by tools/make-asset-manifest.mjs. Do not edit by hand;',
			'run `npm run manifest`. An entry carries a `url` when the physical',
			'file is not at the logical name - that is the whole point of the',
			'indirection - and it is omitted wherever the two are equal, which is',
			'everywhere except the retired names listed in the generator.',
			'Hashes are subresource-integrity form and are recorded, not enforced;',
			'see AssetResolver for why that is a deployment decision.',
		].join(' '),
		assets: sorted,
	};
}

const manifest = build();
const text = JSON.stringify(manifest, null, '\t') + '\n';

if (process.argv.includes('--check'))
{
	let current = null;
	try {current = readFileSync(OUTPUT, 'utf8');} catch { /* reported below */ }
	if (current !== text)
	{
		console.error('public/asset-manifest.json is out of date. Run `npm run manifest`.');
		process.exit(1);
	}
	console.log(`asset manifest is up to date (${Object.keys(manifest.assets).length} assets).`);
}
else
{
	writeFileSync(OUTPUT, text);
	const total = Object.values(manifest.assets).reduce((sum, entry) => sum + entry.bytes, 0);
	console.log(`Wrote ${Object.keys(manifest.assets).length} assets, ${(total / 1048576).toFixed(2)} MB, to public/asset-manifest.json`);
}
