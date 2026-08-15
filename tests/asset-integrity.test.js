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
 *
 * The fixtures under tests/fixtures are real saved designs, so they are the
 * corpus: if a URL in one of them stops resolving, the format broke.
 *
 * ## `hardwood.png`, and a constraint that was lifted rather than ignored
 *
 * This docblock used to end: "`hardwood.png` is 476 kB of photograph in a
 * lossless container and is exactly the file a compression pass wants to
 * convert; it is left alone for this reason, and this test is what will say so
 * to the next person who tries."
 *
 * It has now been converted, and the warning was right when it was written. P6
 * had no way to rename a file a saved design names, so "do not touch it" was
 * the only safe answer available. RM-003 A5 then built the one that was
 * missing: a manifest entry may carry a `url`, which makes a name in a document
 * a NAME rather than an address. `rooms/textures/hardwood.png` is now a retired
 * name pointing at `hardwood.jpg`, every design that records it still resolves,
 * and `tools/make-asset-manifest.mjs` throws if the target ever goes away.
 *
 * The rule that replaces the warning is narrower and stronger: a file under
 * `rooms/textures/` may be renamed **only** with a retirement entry, and the
 * three assertions below are what enforce it. Do not delete a name; retire it.
 */
import {afterAll, describe, expect, it} from 'vitest';
import {readFileSync, readdirSync, existsSync, statSync, mkdtempSync, copyFileSync, rmSync, unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, sep, basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {textureVram} from '../tools/check-budget.mjs';
import {resolveModelUrl} from '../src/scripts/core/legacy_models.js';
import {AssetManifest, MANIFEST_VERSION} from '../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../src/scripts/core/asset_resolver.js';
import {defaultRoomTexture} from '../src/scripts/model/room.js';

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

		// Two indirections, applied in order, and neither is optional. The shim
		// rewrites a pre-S3 model path; the MANIFEST then maps a logical name to
		// wherever the file actually is. `rooms/textures/hardwood.png` is named
		// by rich-design.blueprint3d and no longer exists under that name - it
		// retired to a .jpg - so checking the document's URL against the
		// filesystem asks the wrong question. What a saved design is owed is not
		// that its string still matches a path, but that it still RESOLVES.
		const {manifest: liveManifest} = AssetManifest.parse(MANIFEST_JSON);
		const liveResolver = new AssetResolver({manifest: liveManifest});
		const physical = (url) => liveResolver.resolve(url).url;

		const broken = [...urls.entries()]
			.map(([url, where]) => [physical(resolveModelUrl(url).url), url, where])
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
		//
		// Still asserted of P6 specifically, and deliberately not generalised to
		// "nothing may ever move". P6 could not retire a name, so for P6 the rule
		// really was absolute; a later pass CAN, and did. The scope of this test
		// is that record, which is why it reads COMPRESSION rather than the tree.
		const renamed = COMPRESSION.converted
			.map((entry) => entry.from)
			.filter((url) => url.startsWith('rooms/textures/') && !url.startsWith('rooms/textures/envs/'));

		expect(renamed, 'these URLs appear in saved designs and must not move').toEqual([]);
	});

	it('the default room texture resolves, under both the name it has and the one it had', () =>
	{
		// The single most load-bearing asset path in the project: its URL is
		// written into every design that has a floor.
		//
		// This used to assert `existsSync('rooms/textures/hardwood.png')`, which
		// conflated two claims the way these assertions keep doing - that the
		// default is reachable, and that it is reachable at one particular
		// filename. Re-encoding it as JPEG made the second false and left the
		// first exactly as true. What has to hold is that BOTH names resolve to
		// something real: the current one because that is what new designs
		// record, and the retired one because that is what every design written
		// before now records.
		const {manifest} = AssetManifest.parse(MANIFEST_JSON);
		const resolver = new AssetResolver({manifest});

		for (const name of [defaultRoomTexture.url, 'rooms/textures/hardwood.png'])
		{
			const resolution = resolver.resolve(name);
			expect(resolution.known, `${name} is not in the manifest`).toBe(true);
			expect(existsSync(join(PUBLIC, resolution.url)), `${name} -> ${resolution.url} is not there`).toBe(true);
		}
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
				// Three containers now, not two. B5 transcoded 18 of these images
				// to KTX2, and `image/ktx2` is what `KHR_texture_basisu` requires
				// - a .ktx2 declared image/jpeg is exactly the silent failure this
				// test exists to catch, just with the newest format.
				const expected = /\.ktx2$/i.test(image.uri) ? 'image/ktx2'
					: (/\.png$/i.test(image.uri) ? 'image/png' : 'image/jpeg');
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
		// A file P6 produced may since have been replaced under a new name - B5
		// transcoded twelve of them to KTX2. Present means "present under the
		// name the LAST pass gave it", which is the same rule `reports honest
		// numbers` applies below and the same one that keeps the chain honest.
		const TRANSCODED = new Map(JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/texture-transcode.json'), 'utf8'))
			.textures.map((entry) => [entry.from, entry.to]));
		const nowAt = (name) => TRANSCODED.get(name) || name;

		const missing = COMPRESSION.converted.filter((entry) => !existsSync(join(PUBLIC, nowAt(entry.to))));
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
				entries: (report) => report.textures.map((entry) => [entry.name, {bytes: entry.to.bytes, at: entry.name}]),
			},
			{
				report: JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/texture-transcode.json'), 'utf8')),
				// B5 both replaces the bytes AND moves them to a new name, which
				// the resize pass never did - so a superseded entry has to carry
				// where to look as well as what to expect.
				name: 'RM-004 B5 KTX2 transcode',
				entries: (report) => report.textures.map((entry) => [entry.from, {bytes: entry.bytesAfter, at: entry.to}]),
			},
		];
		/** @type {Map<string, {bytes: number, at: string, pass: string}>} */
		const superseded = new Map();
		for (const pass of LATER_PASSES)
		{
			for (const [name, where] of pass.entries(pass.report)) { superseded.set(name, {...where, pass: pass.name}); }
		}

		let before = 0;
		let after = 0;
		for (const entry of COMPRESSION.converted)
		{
			expect(entry.bytesAfter).toBeLessThan(entry.bytesBefore);
			const later = superseded.get(entry.to);
			const at = later ? later.at : entry.to;
			const expected = later ? later.bytes : entry.bytesAfter;
			expect(statSync(join(PUBLIC, at)).size, later ? `${entry.to} -> ${at}, per ${later.pass}` : entry.to).toBe(expected);
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

		// This example got sharper by accident. It used to show a base moving a
		// name whose file sat at that same name, so `name` and the tail of `url`
		// were identical and the test could not tell the two concepts apart.
		// `hardwood.png` is now a RETIRED name, so the assertion below is the
		// first place in the suite where the logical name and the physical file
		// genuinely differ - which is what H-8 actually claims.
		const name = 'rooms/textures/hardwood.png';
		const resolution = resolver.resolve(name);
		expect(resolution.name).toBe(name);
		expect(resolution.url).toBe('https://cdn.example.com/a3d/rooms/textures/hardwood.jpg');
		expect(resolution.known).toBe(true);
		expect(resolution.hash).toMatch(/^sha256-/);

		// And a live name still behaves the plain way, so the indirection is not
		// quietly rewriting everything.
		const live = resolver.resolve('rooms/textures/marbletiles.jpg');
		expect(live.url).toBe('https://cdn.example.com/a3d/rooms/textures/marbletiles.jpg');
	});
});

/**
 * M-15: every format the tree uploads is a format the budget can count.
 *
 * ## The hole this closes
 *
 * `textureVram()` read `.png`, `.jpg` and `.jpeg`. RM-004 B5 turned 18 textures
 * into `.ktx2` and the extension list did not change with them, so the line fell
 * 43.00 -> 12.54 MB and roughly a quarter of that fall was the measurement
 * letting go rather than the tree getting cheaper. Nothing failed, because
 * nothing was watching the watcher.
 *
 * The general shape of the bug is "a budget stops seeing a file kind", and it
 * will recur the next time a format is adopted - AVIF for the thumbnails, a
 * basis-universal successor, whatever three supports in three years. So the
 * assertion here is not "KTX2 is counted"; it is **every GPU-uploaded asset the
 * manifest declares moves this number**, which is the property that stays true
 * when the format list changes again.
 *
 * Everything runs against a temporary directory. An earlier version of this
 * check copied a file into `public/` and deleted it afterwards, which leaves a
 * stray asset in the tree the moment a run is interrupted - and `public/` is
 * exactly the directory three other tests in this file assert the contents of.
 */
describe('the VRAM budget can see every format the tree uploads (RM-005 C1)', () =>
{
	/** Manifest kinds that become a WebGL texture. Thumbnails are `<img>` and do not. */
	const GPU_KINDS = new Set(['model-texture', 'texture', 'environment']);

	const scratch = mkdtempSync(join(tmpdir(), 'a3d-vram-'));
	afterAll(() => rmSync(scratch, {recursive: true, force: true}));

	/** Copy one asset in, measure, take it out again. */
	function costOf(relative)
	{
		const staged = join(scratch, basename(relative));
		copyFileSync(join(PUBLIC, relative), staged);
		try {return textureVram(scratch);}
		finally {unlinkSync(staged);}
	}

	it('counts a compressed texture, not just an uncompressed one', () =>
	{
		// The two halves of the sum, each proved on its own. A KTX2 costing zero
		// is the exact state the tree was in before C1, and it passed every gate.
		expect(costOf('rooms/textures/marbletiles.jpg')).toBeGreaterThan(0);
		expect(costOf('models/js-glb/textures/oak_wood.ktx2')).toBeGreaterThan(0);
	});

	it('charges a compressed texture less than the same pixels uncompressed', () =>
	{
		// ## This test failed to fail, and the fix is both halves below
		//
		// It first read `costOf(hardwood.jpg)` against `costOf(oak_wood.ktx2)` and
		// asserted the second was smaller. Breaking the `.ktx2` branch to check the
		// gate left it GREEN: a texture the budget cannot see costs zero, and zero
		// is less than everything. An ordering assertion with no floor under it is
		// satisfied most completely by the bug it exists to catch.
		//
		// So: a floor first, then the ordering, and against the SAME pixels rather
		// than two different files - comparing a 512x512 photograph to a 669x1024
		// texture was measuring the dimensions as much as the format.
		const bytes = readFileSync(join(PUBLIC, 'models/js-glb/textures/oak_wood.ktx2'));
		const pixels = bytes.readUInt32LE(20) * bytes.readUInt32LE(24);
		const compressed = costOf('models/js-glb/textures/oak_wood.ktx2');

		expect(compressed).toBeGreaterThan(0);
		// Directional rather than exact, so the model can be refined - one byte per
		// texel today, and BC1 is really half that - without rewriting the test.
		// What must not change is the ordering: a format adopted to save memory has
		// to measure as saving memory, or the budget argues for the wrong thing.
		expect(compressed).toBeLessThan(Math.round(pixels * 4 * 4 / 3));
	});

	it('sees every uploaded asset the manifest declares', () =>
	{
		const uploaded = Object.entries(MANIFEST_JSON.assets)
			// A retired name points at another entry's file; costing it would count
			// the same pixels twice and prove nothing the live name has not already.
			.filter(([, entry]) => GPU_KINDS.has(entry.kind) && !entry.url)
			.map(([name]) => name);

		// A floor on the corpus, so this cannot quietly pass by measuring nothing.
		expect(uploaded.length).toBeGreaterThan(20);

		const invisible = uploaded.filter((name) => costOf(name) === 0);
		expect(invisible, `these upload to the GPU and cost the VRAM budget nothing:\n  ${invisible.join('\n  ')}`)
			.toEqual([]);
	});

	it('reports the whole tree at the figure tools/budget.json records', () =>
	{
		// Ties the per-file property above to the number the gate actually prints,
		// so a measurement that is right file-by-file and wrong in aggregate - a
		// double count, a directory skipped - still fails.
		const recorded = JSON.parse(readFileSync(join(ROOT, 'tools/budget.json'), 'utf8'));
		expect(textureVram(PUBLIC)).toBe(recorded.budgets['texture-vram'].measured);
	});
});
