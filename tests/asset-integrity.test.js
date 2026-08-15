/**
 * Every asset URL the project names actually resolves (RM-002 P6).
 *
 * ## Why this file exists
 *
 * P6 renamed 21 texture files. A rename that misses one reference produces no
 * build error, no type error and no test failure - just a fetch that 404s at
 * runtime and a surface that silently never gets its texture. Three's
 * `TextureLoader` logs and carries on; `GLTFLoader` renders the model with its
 * base colour. The application looks like it works.
 *
 * So the references are checked here rather than trusted: the model files, the
 * catalogs, the library's own hardcoded paths, and - the one that matters most -
 * every texture URL inside a saved design.
 *
 * ## The saved-design check is a compatibility gate, not a smoke test
 *
 * `floorplan.wallTextures` and `floorplan.newFloorTextures` are serialized with
 * a `url` in them. Every plan any user has ever saved names a file under
 * `rooms/textures/` by path, so renaming one of those files breaks documents
 * that already exist - and nothing else in this repository would have noticed.
 * `hardwood.png` is 476 kB of photograph in a lossless container and is exactly
 * the file a compression pass wants to convert; it is left alone for this
 * reason, and this test is what will say so to the next person who tries.
 *
 * The fixtures under tests/fixtures are real saved designs, so they are the
 * corpus: if a URL in one of them stops resolving, the format broke.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveModelUrl} from '../src/scripts/core/legacy_models.js';
import {AssetManifest, MANIFEST_VERSION} from '../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../src/scripts/core/asset_resolver.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const FIXTURES = join(ROOT, 'tests/fixtures');

const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const TEXTURES = JSON.parse(readFileSync(join(ROOT, 'src/catalog/textures.json'), 'utf8'));
const COMPRESSION = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/texture-compression.json'), 'utf8'));
const MANIFEST_FILE = join(PUBLIC, 'asset-manifest.json');
const MANIFEST_JSON = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

/** Anything that looks like a path into public/, wherever it appears. */
const ASSET_URL = /(?:models|rooms)\/[A-Za-z0-9_./-]+\.(?:png|jpg|jpeg|glb|gltf|js)/g;

function walk(directory)
{
	const out = [];
	for (const name of readdirSync(directory))
	{
		const path = join(directory, name);
		if (statSync(path).isDirectory()) { out.push(...walk(path)); }
		else { out.push(path); }
	}
	return out;
}

/** Read a .glb's JSON chunk. See asset-pipeline/compress-textures.mjs. */
function glbJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.readUInt32LE(0) !== 0x46546c67)
	{
		return null;
	}
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));
		}
		offset += 8 + length;
	}
	return null;
}

/** Every URL named by every saved design in tests/fixtures. */
function fixtureUrls()
{
	const found = new Map();
	for (const path of walk(FIXTURES))
	{
		const text = readFileSync(path, 'utf8');
		for (const match of text.matchAll(ASSET_URL))
		{
			if (!found.has(match[0])) { found.set(match[0], []); }
			found.get(match[0]).push(path.slice(ROOT.length + 1));
		}
	}
	return found;
}

describe('saved designs still resolve', () =>
{
	it('every asset URL in every fixture resolves, through the shim where there is one', () =>
	{
		// `resolveModelUrl` is applied first, because a design saved before S3 names
		// `models/js/<name>.js` - a three.js JSON model, a format no loader since
		// r98 can read - and the library rewrites those on the way in. Running the
		// URLs through the same function the loader uses means this checks the shim
		// too: a converted model that went missing would fail here.
		const urls = fixtureUrls();
		expect(urls.size).toBeGreaterThan(0);

		const broken = [...urls.entries()]
			.map(([url, where]) => [resolveModelUrl(url).url, url, where])
			.filter(([resolved]) => !existsSync(join(PUBLIC, resolved)))
			.map(([resolved, url, where]) => (resolved === url
				? `${url}  (${where[0]})`
				: `${url} -> ${resolved}  (${where[0]})`));

		expect(broken, `saved designs name files that no longer exist:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	it('nothing under rooms/textures was renamed by the compression pass', () =>
	{
		// The rule in compress-textures.mjs, asserted rather than left as a comment
		// in the tool that implements it. `rooms/textures/envs/` is exempt: it holds
		// the environment map, which no catalog offers and no design can name.
		const renamed = COMPRESSION.converted
			.map((entry) => entry.from)
			.filter((url) => url.startsWith('rooms/textures/') && !url.startsWith('rooms/textures/envs/'));

		expect(renamed, 'these URLs appear in saved designs and must not move').toEqual([]);
	});

	it('the default room texture is still where room.js says it is', () =>
	{
		// Its URL is written into every design that has a floor, so it is the single
		// most load-bearing asset path in the project.
		expect(existsSync(join(PUBLIC, 'rooms/textures/hardwood.png'))).toBe(true);
	});
});

describe('the catalogs point at real files', () =>
{
	it('every model and thumbnail in catalog.json exists', () =>
	{
		const items = CATALOG.items || CATALOG;
		const referenced = [];
		JSON.stringify(items).replace(ASSET_URL, (url) => {referenced.push(url); return url;});
		expect(referenced.length).toBeGreaterThan(0);

		const missing = [...new Set(referenced)].filter((url) => !existsSync(join(PUBLIC, url)));
		expect(missing, `catalog.json names missing files:\n  ${missing.join('\n  ')}`).toEqual([]);
	});

	it('every texture and thumbnail in textures.json exists', () =>
	{
		const referenced = [];
		JSON.stringify(TEXTURES).replace(ASSET_URL, (url) => {referenced.push(url); return url;});
		expect(referenced.length).toBeGreaterThan(0);

		const missing = [...new Set(referenced)].filter((url) => !existsSync(join(PUBLIC, url)));
		expect(missing, `textures.json names missing files:\n  ${missing.join('\n  ')}`).toEqual([]);
	});
});

describe('the model files point at real files', () =>
{
	it('every image URI in every glb resolves beside it', () =>
	{
		const models = walk(join(PUBLIC, 'models')).filter((path) => path.endsWith('.glb'));
		expect(models.length).toBeGreaterThan(100);

		const broken = [];
		let withImages = 0;
		for (const path of models)
		{
			const json = glbJson(path);
			expect(json, `${path} is not parseable binary glTF`).toBeTruthy();
			for (const image of json.images || [])
			{
				if (!image.uri) { continue; }
				withImages += 1;
				if (!existsSync(join(dirname(path), image.uri)))
				{
					broken.push(`${path.slice(ROOT.length + 1)} -> ${image.uri}`);
				}
			}
		}

		expect(withImages).toBeGreaterThan(0);
		expect(broken, `glb files name missing textures:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	it('declares the right mime type for every rewritten image', () =>
	{
		// GLTFLoader trusts `mimeType` over the extension when it is present, so a
		// .jpg declared image/png is a decode failure rather than a 404 - the same
		// silent blank texture by a different route.
		const wrong = [];
		for (const path of walk(join(PUBLIC, 'models')).filter((p) => p.endsWith('.glb')))
		{
			for (const image of glbJson(path).images || [])
			{
				if (!image.uri || !image.mimeType) { continue; }
				const expected = /\.png$/i.test(image.uri) ? 'image/png' : 'image/jpeg';
				if (image.mimeType !== expected)
				{
					wrong.push(`${path.slice(ROOT.length + 1)}: ${image.uri} declared ${image.mimeType}`);
				}
			}
		}
		expect(wrong, wrong.join('\n  ')).toEqual([]);
	});
});

describe('the compression pass left nothing behind', () =>
{
	it('every file it produced exists and every original is gone', () =>
	{
		const missing = COMPRESSION.converted.filter((entry) => !existsSync(join(PUBLIC, entry.to)));
		expect(missing.map((entry) => entry.to), 'converted files that are not there').toEqual([]);

		// Both halves matter. If an original survives, a stale reference to it keeps
		// working and the saving is never realised - the tree just got bigger.
		const survivors = COMPRESSION.converted.filter((entry) => existsSync(join(PUBLIC, entry.from)));
		expect(survivors.map((entry) => entry.from), 'originals that were not removed').toEqual([]);
	});

	it('reports honest numbers', () =>
	{
		// ## The reports are a chain, and this test used to assume P6 was the end
		//
		// `bytesAfter` is what P6 left on disk, and comparing it to the file that
		// is there now asks "has anything touched this since" - a good question
		// with a wrong default answer. RM-004 B4 resized four textures P6 had
		// converted, deliberately and with its own report, and this assertion
		// read that as P6 having lied.
		//
		// So the current bytes are checked against the LAST pass that recorded
		// touching the file, not the first. P6's own numbers are still asserted
		// exactly as written - `texture-compression.json` is a historical record
		// and editing it to match a later tree would falsify the history this
		// suite exists to hold. What is relaxed is only which report gets to
		// claim the current bytes.
		//
		// The ratchet survives: every file still has to match SOME recorded
		// pass, so nothing changes silently. A future pipeline stage adds itself
		// to `LATER_PASSES` and inherits the same discipline.
		const LATER_PASSES = [
			{
				report: JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/resize-report.json'), 'utf8')),
				name: 'RM-004 B4 resize',
				entries: (report) => report.textures.map((entry) => [entry.name, entry.to.bytes]),
			},
		];
		/** @type {Map<string, {bytes: number, pass: string}>} */
		const superseded = new Map();
		for (const pass of LATER_PASSES)
		{
			for (const [name, bytes] of pass.entries(pass.report)) { superseded.set(name, {bytes, pass: pass.name}); }
		}

		let before = 0;
		let after = 0;
		for (const entry of COMPRESSION.converted)
		{
			expect(entry.bytesAfter).toBeLessThan(entry.bytesBefore);
			const later = superseded.get(entry.to);
			const expected = later ? later.bytes : entry.bytesAfter;
			expect(statSync(join(PUBLIC, entry.to)).size, later ? `${entry.to}, per ${later.pass}` : entry.to).toBe(expected);
			before += entry.bytesBefore;
			after += entry.bytesAfter;
		}
		expect(COMPRESSION.totals.bytesBefore).toBe(before);
		expect(COMPRESSION.totals.bytesAfter).toBe(after);
	});

	it('kept every conversion above the quality floor it claims', () =>
	{
		// 36 dB is the low end of "no visible difference" for photographic content,
		// and the pass was tuned until every file cleared it. A future re-encode at
		// a lower quality would have to move this number, in a commit, on purpose.
		const poor = COMPRESSION.converted.filter((entry) => entry.psnr !== null && entry.psnr < 36);
		expect(poor.map((entry) => `${entry.to} @ ${entry.psnr} dB`)).toEqual([]);
	});
});


describe('the asset manifest describes the tree it ships with (RM-003 A5)', () =>
{
	/**
	 * Both directions, and both matter for different reasons.
	 *
	 * A manifest entry with no file is a **404 the resolver will confidently
	 * produce**: it says the asset exists, so the availability check passes and
	 * the load fails at the network instead - worse than no manifest, because it
	 * removed the one check that would have caught it early.
	 *
	 * A file with no manifest entry is the opposite failure: `missing()` returns
	 * true for it, so the availability policy **refuses to load an asset that is
	 * right there**. Somebody adds a model, forgets to regenerate, and the item
	 * silently stops working.
	 *
	 * Neither is caught by anything else in this repository, and the second is
	 * new in A5 - before it, a stale manifest could not exist to be wrong.
	 */
	it('names a real file for every entry', () =>
	{
		const phantom = Object.keys(MANIFEST_JSON.assets)
			.map((name) => [name, MANIFEST_JSON.assets[name].url || name])
			.filter(([, url]) => !existsSync(join(PUBLIC, url)))
			.map(([name, url]) => (name === url ? name : `${name} -> ${url}`));

		expect(phantom, `the manifest declares files that are not there:\n  ${phantom.join('\n  ')}`).toEqual([]);
	});

	it('and has an entry for every file', () =>
	{
		// The manifest is not part of the tree it describes.
		const onDisk = walk(PUBLIC)
			.map((path) => path.slice(PUBLIC.length + 1).split(sep).join('/'))
			.filter((name) => name !== 'asset-manifest.json');

		const undeclared = onDisk.filter((name) => !MANIFEST_JSON.assets[name]);
		expect(undeclared, `run \`npm run manifest\` - these files are not declared:\n  ${undeclared.join('\n  ')}`)
			.toEqual([]);
	});

	it('records the size and hash each file actually has', () =>
	{
		// Not a spot check: a stale byte count makes the prefetch budget and the
		// per-item ceiling lie, and a stale hash makes integrity enforcement - the
		// thing A5 records it for - reject a file that is perfectly good.
		const wrong = [];
		for (const [name, entry] of Object.entries(MANIFEST_JSON.assets))
		{
			const bytes = readFileSync(join(PUBLIC, entry.url || name));
			if (bytes.length !== entry.bytes)
			{
				wrong.push(`${name}: manifest says ${entry.bytes} bytes, file is ${bytes.length}`);
				continue;
			}
			const hash = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
			if (hash !== entry.hash)
			{
				wrong.push(`${name}: hash does not match`);
			}
		}

		expect(wrong, `run \`npm run manifest\`:\n  ${wrong.join('\n  ')}`).toEqual([]);
	});

	it('parses through the library, at the version the library understands', () =>
	{
		const result = AssetManifest.parse(MANIFEST_JSON);
		expect(MANIFEST_JSON.version).toBe(MANIFEST_VERSION);
		expect(result.ok).toBe(true);
		expect(result.manifest.count).toBe(Object.keys(MANIFEST_JSON.assets).length);
		// A floor rather than a ceiling: `public-total` in tools/budget.json is the
		// ceiling, and this exists so a manifest that parsed but came back nearly
		// empty could not pass as a real one. RM-004 B1 moved it from 10 MB to 5:
		// the tree was 10.62 MB and Draco took it to 7.39, so the old floor was
		// asserting the payload had not been optimised. Kept well below the real
		// figure for the same reason it was loose before - it is a smoke test for
		// "did the manifest actually load", not a second budget.
		expect(result.manifest.totalBytes).toBeGreaterThan(5 * 1024 * 1024);
	});

	it('resolves every URL a saved design names, through the resolver', () =>
	{
		// The compatibility gate at the top of this file, asked again of the layer
		// A5 put in front of it. A fixture that resolved before and does not now
		// is a document that stopped opening.
		const {manifest} = AssetManifest.parse(MANIFEST_JSON);
		const resolver = new AssetResolver({manifest});

		const broken = [...fixtureUrls().keys()]
			.map((url) => resolveModelUrl(url).url)
			.filter((url) => resolver.missing(url) || !existsSync(join(PUBLIC, resolver.resolve(url).url)));

		expect(broken, `the resolver cannot reach these:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	it('and a base moves every one of them without touching the name', () =>
	{
		// H-8's claim, checked rather than described: the logical name a document
		// records is unchanged and the URL a browser fetches is somewhere else.
		const {manifest} = AssetManifest.parse(MANIFEST_JSON);
		const resolver = new AssetResolver({manifest, base: 'https://cdn.example.com/a3d'});

		const name = 'rooms/textures/hardwood.png';
		const resolution = resolver.resolve(name);
		expect(resolution.name).toBe(name);
		expect(resolution.url).toBe('https://cdn.example.com/a3d/rooms/textures/hardwood.png');
		expect(resolution.known).toBe(true);
		expect(resolution.hash).toMatch(/^sha256-/);
	});
});
