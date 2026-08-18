/**
 * Convert opaque PNG textures to JPEG, and rewrite everything that points at
 * them (RM-002 P6, the asset half).
 *
 *     node asset-pipeline/compress-textures.mjs --dry-run
 *     node asset-pipeline/compress-textures.mjs
 *
 * ## The defect
 *
 * `public/` holds 175 PNGs. 152 of them carry a real alpha channel and are
 * catalog thumbnails, totalling under 1 MB - those are fine. The other 23 are
 * photographs and baked lightmaps with no alpha at all, and they hold 6.6 MB.
 * `Garden.png`, the environment map, is a 2048x1024 photograph of a garden
 * stored losslessly: 3.4 MB, 22% of everything served.
 *
 * PNG is the wrong container for continuous-tone imagery. That is the whole
 * finding; there is no cleverness in the fix.
 *
 * ## What is deliberately left alone
 *
 * `public/rooms/textures/` is skipped in full, and this is the important rule
 * in this file. Those URLs are *serialized into saved designs* - the fixtures
 * under tests/fixtures carry `"url": "rooms/textures/hardwood.png"` and so does
 * every plan any user has ever saved. That directory is a public URL contract,
 * not an internal asset folder, and renaming a file in it breaks documents that
 * already exist. `hardwood.png` alone would have been 350 kB; it stays.
 *
 * Anything with an alpha channel is skipped too, detected from the PNG header's
 * colour type plus a tRNS scan. One texture in the model set looks opaque by
 * eye and is not - `cb-archnight-white_baked.png` has 557 transparent pixels out
 * of 262144 - which is exactly why this is read from the file rather than
 * assumed from the filename.
 *
 * Already-lossy JPEGs are not re-encoded. The three 1500x2297 wood textures are
 * 2.2 MB between them and are plainly larger than they need to be, but that is
 * a *resolution* decision - it changes what the renderer samples - and it
 * belongs to whoever owns the art direction, not to a compression pass. Recorded
 * in the report as an open question with its numbers.
 *
 * ## Why sips
 *
 * There is no image library on this machine and none in the dependency tree -
 * no sharp, no ImageMagick, no PIL. `sips` ships with macOS and this is a
 * one-time conversion whose *output* is committed, so the tool that produced it
 * does not need to run in CI. What runs in CI is `npm run budget`, which is what
 * keeps the result from being undone.
 *
 * ## The quality numbers are measured, not claimed
 *
 * Every conversion is decoded back through chromium - playwright is already a
 * devDependency - and compared against the original pixel by pixel. The report
 * records PSNR, mean absolute error and the worst single channel for each file,
 * so "visually identical" is a number somebody can check rather than an opinion.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync} from 'node:fs';
import {join, relative, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const REPORT = join(ROOT, 'asset-pipeline', 'texture-compression.json');

/** JPEG quality. Above this the file grows and the PSNR does not - measured. */
const QUALITY = 90;

/**
 * Serialized into saved designs, so the URLs are a compatibility contract.
 * See the header.
 */
const FROZEN_PREFIXES = ['rooms/textures/'];

/**
 * ...except the environment maps, which live under that path and are not part
 * of the contract.
 *
 * `rooms/textures/envs/` is not offered by `textures.json`, so a user cannot
 * pick one, so no saved design can name one - checked against the catalog and
 * against every fixture. The only reference in the project is
 * `Skybox.defaultEnvironment`. It is only under `rooms/textures/` at all by
 * historical accident, and it is where 3.4 MB of the 6.6 MB problem lives.
 */
const FROZEN_EXCEPTIONS = ['rooms/textures/envs/'];

/**
 * Source files that name an asset URL directly, rewritten alongside the GLBs.
 *
 * Listed rather than discovered: a blind search-and-replace across src/ could
 * rewrite a comment or an unrelated string, and the point of naming them is
 * that the set is small enough to check. A final sweep below fails the run if
 * any reference to a converted file survives anywhere.
 */
const REFERENCE_FILES = [
	'src/catalog/catalog.json',
	'src/catalog/textures.json',
	'src/scripts/three/skybox.js',
];

const DRY_RUN = process.argv.includes('--dry-run');

// --- PNG inspection ---------------------------------------------------------

/**
 * Colour type and transparency, straight out of the PNG header.
 *
 * Colour types 4 and 6 carry an alpha channel outright. Types 0 and 3 can carry
 * transparency through a tRNS chunk instead, which is why the chunk list is
 * walked rather than just the IHDR read.
 */
function inspectPng(path)
{
	const buffer = readFileSync(path);
	if (buffer.readUInt32BE(0) !== 0x89504e47)
	{
		return null;
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	const colourType = buffer[25];

	let hasTrns = false;
	let offset = 8;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		if (type === 'tRNS') { hasTrns = true; }
		if (type === 'IEND') { break; }
		offset += 12 + length;
	}

	return {
		width,
		height,
		colourType,
		hasAlpha: colourType === 4 || colourType === 6 || hasTrns,
	};
}

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

// --- GLB rewriting ----------------------------------------------------------

/**
 * Read a .glb's JSON chunk.
 *
 * Binary glTF is a 12-byte header followed by length-prefixed chunks: JSON
 * first, then an optional BIN. Only the JSON chunk is of interest here - the
 * textures these models use are separate files beside them, referenced by
 * relative `uri`, not packed into the buffer.
 */
function readGlb(path)
{
	const buffer = readFileSync(path);
	if (buffer.readUInt32LE(0) !== 0x46546c67)
	{
		return null;
	}
	const chunks = [];
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		chunks.push({type, data: buffer.subarray(offset + 8, offset + 8 + length)});
		offset += 8 + length;
	}
	const jsonChunk = chunks.find((chunk) => chunk.type === 0x4e4f534a);
	if (!jsonChunk)
	{
		return null;
	}
	return {chunks, json: JSON.parse(jsonChunk.data.toString('utf8'))};
}

/**
 * Write a .glb back with a new JSON chunk.
 *
 * Chunk payloads must be four-byte aligned; the spec pads JSON with spaces and
 * BIN with zeros, and the padding counts toward the chunk length. Getting that
 * wrong produces a file that loads in one parser and not another, so the caller
 * verifies by reparsing.
 */
function writeGlb(path, glb, json)
{
	const encoded = Buffer.from(JSON.stringify(json), 'utf8');
	const padding = (4 - (encoded.length % 4)) % 4;
	const jsonChunk = Buffer.concat([encoded, Buffer.alloc(padding, 0x20)]);

	const parts = [];
	for (const chunk of glb.chunks)
	{
		const data = (chunk.type === 0x4e4f534a) ? jsonChunk : chunk.data;
		const header = Buffer.alloc(8);
		header.writeUInt32LE(data.length, 0);
		header.writeUInt32LE(chunk.type, 4);
		parts.push(header, data);
	}

	const body = Buffer.concat(parts);
	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + body.length, 8);
	writeFileSync(path, Buffer.concat([header, body]));
}

// --- quality measurement ----------------------------------------------------

/**
 * Decode both files in chromium and compare them.
 *
 * The browser is the image library here, for the same reason sips is the
 * encoder: there is no other decoder available, and this one is exact.
 */
async function measure(pairs)
{
	if (pairs.length === 0)
	{
		return new Map();
	}
	const {chromium} = await import('playwright');
	const browser = await chromium.launch();
	const page = await browser.newPage();
	const results = new Map();

	for (const {from, to} of pairs)
	{
		const uri = (path) => `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(path).toString('base64')}`;
		results.set(to, await page.evaluate(async ([a, b]) =>
		{
			const load = (src) => new Promise((resolve, reject) =>
			{
				const image = new Image();
				image.onload = () => resolve(image);
				image.onerror = reject;
				image.src = src;
			});
			const pixels = (image) =>
			{
				const canvas = document.createElement('canvas');
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext('2d', {willReadFrequently: true});
				context.drawImage(image, 0, 0);
				return context.getImageData(0, 0, canvas.width, canvas.height).data;
			};

			const [imageA, imageB] = await Promise.all([load(a), load(b)]);
			const pa = pixels(imageA);
			const pb = pixels(imageB);
			let squares = 0;
			let absolute = 0;
			let worst = 0;
			let count = 0;
			for (let p = 0; p < pa.length; p += 4)
			{
				for (let c = 0; c < 3; c++)
				{
					const d = Math.abs(pa[p + c] - pb[p + c]);
					squares += d * d;
					absolute += d;
					if (d > worst) { worst = d; }
					count += 1;
				}
			}
			const mse = squares / count;
			return {
				psnr: mse === 0 ? null : Math.round(10 * Math.log10((255 * 255) / mse) * 10) / 10,
				meanAbsoluteError: Math.round((absolute / count) * 100) / 100,
				worstChannel: worst,
			};
		}, [uri(from), uri(to)]));
	}

	await browser.close();
	return results;
}

// --- the pass ---------------------------------------------------------------

const skipped = [];
const candidates = [];

for (const path of walk(PUBLIC))
{
	if (!path.toLowerCase().endsWith('.png'))
	{
		continue;
	}
	const url = relative(PUBLIC, path).split('\\').join('/');
	const info = inspectPng(path);
	if (!info)
	{
		skipped.push({url, why: 'not a PNG'});
		continue;
	}
	const frozen = FROZEN_PREFIXES.some((prefix) => url.startsWith(prefix))
		&& !FROZEN_EXCEPTIONS.some((prefix) => url.startsWith(prefix));
	if (frozen)
	{
		skipped.push({url, why: 'URL is serialized into saved designs', bytes: statSync(path).size});
		continue;
	}
	if (info.hasAlpha)
	{
		skipped.push({url, why: 'has an alpha channel', bytes: statSync(path).size});
		continue;
	}
	candidates.push({path, url, bytes: statSync(path).size, ...info});
}

console.log(`${candidates.length} opaque PNGs to convert, ${skipped.length} left alone`);
console.log(`  convertible: ${(candidates.reduce((n, c) => n + c.bytes, 0) / 1024).toFixed(1)} kB`);

if (DRY_RUN)
{
	candidates.sort((a, b) => b.bytes - a.bytes).forEach((c) =>
	{
		console.log(`  ${(c.bytes / 1024).toFixed(1).padStart(9)} kB  ${c.width}x${c.height}  ${c.url}`);
	});
	const frozen = skipped.filter((s) => s.why.startsWith('URL is serialized'));
	console.log(`  held back by the URL contract: ${(frozen.reduce((n, s) => n + (s.bytes || 0), 0) / 1024).toFixed(1)} kB`);
	process.exit(0);
}

// 1. Encode. A conversion that does not save bytes is undone - JPEG carries
// more header than a 200-byte PNG of a flat colour needs, and swapping one for
// the other to make the file bigger would be a change for its own sake.
const converted = [];
for (const candidate of candidates)
{
	const target = candidate.path.replace(/\.png$/i, '.jpg');
	execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY), candidate.path, '--out', target], {stdio: 'ignore'});
	const targetBytes = statSync(target).size;
	if (targetBytes >= candidate.bytes)
	{
		unlinkSync(target);
		skipped.push({url: candidate.url, why: 'JPEG came out no smaller', bytes: candidate.bytes});
		continue;
	}
	converted.push({
		...candidate,
		target,
		targetUrl: candidate.url.replace(/\.png$/i, '.jpg'),
		targetBytes,
	});
}

// 2. Measure, before the originals are removed.
const quality = await measure(converted.map((c) => ({from: c.path, to: c.target})));

// 3. Rewrite every reference. GLB JSON chunks first.
const renames = new Map(converted.map((c) => [c.url, c.targetUrl]));
const touchedGlb = [];

for (const path of walk(PUBLIC))
{
	if (!path.toLowerCase().endsWith('.glb'))
	{
		continue;
	}
	const glb = readGlb(path);
	if (!glb)
	{
		continue;
	}

	let changed = false;
	for (const image of glb.json.images || [])
	{
		if (!image.uri)
		{
			continue;
		}
		// Image URIs are relative to the .glb, so resolve to a public-root URL
		// before looking them up in the rename table.
		const resolved = relative(PUBLIC, join(dirname(path), image.uri)).split('\\').join('/');
		const renamed = renames.get(resolved);
		if (!renamed)
		{
			continue;
		}
		image.uri = relative(dirname(path), join(PUBLIC, renamed)).split('\\').join('/');
		if (image.mimeType) { image.mimeType = 'image/jpeg'; }
		// `name` is a label rather than a reference - three never resolves it -
		// but every one of these carries the source filename, and leaving it
		// naming a file that no longer exists is how an asset inventory goes
		// stale. It also keeps the sweep below able to stay strict.
		if (image.name === basename(resolved)) { image.name = basename(renamed); }
		changed = true;
	}

	if (changed)
	{
		writeGlb(path, glb, glb.json);
		// Reparse. A mis-sized or mis-padded chunk produces a file that some
		// parsers accept and others reject, which is worth failing loudly on here
		// rather than discovering in a browser.
		const check = readGlb(path);
		if (!check)
		{
			throw new Error(`rewrote ${path} into something unparseable`);
		}
		touchedGlb.push(relative(ROOT, path));
	}
}

// 4. Then the source files that name a URL directly.
const touchedJson = [];
for (const file of REFERENCE_FILES)
{
	const path = join(ROOT, file);
	if (!existsSync(path))
	{
		continue;
	}
	let text = readFileSync(path, 'utf8');
	const before = text;
	for (const [from, to] of renames)
	{
		text = text.split(from).join(to);
	}
	if (text !== before)
	{
		writeFileSync(path, text);
		touchedJson.push(file);
	}
}

// 5. Nothing may still point at a file that is about to stop existing. A
// rename that misses one reference is a 404 at runtime and nothing else - no
// build error, no test failure, just a texture that silently never arrives -
// so this sweeps the whole of src/ and every rewritten GLB before deleting.
const dangling = [];
const searchable = [
	...walk(join(ROOT, 'src')).filter((p) => /\.(js|mjs|json|vue|html|css)$/i.test(p)),
	...touchedGlb.map((p) => join(ROOT, p)),
];
for (const path of searchable)
{
	const text = readFileSync(path, 'latin1');
	for (const url of renames.keys())
	{
		if (text.includes(basename(url)))
		{
			dangling.push(`${relative(ROOT, path)} -> ${url}`);
		}
	}
}
if (dangling.length > 0)
{
	throw new Error(`references left pointing at converted files:\n  ${dangling.join('\n  ')}`);
}

// 6. Drop the originals.
for (const item of converted)
{
	unlinkSync(item.path);
}

// 6. Record what happened.
const totalBefore = converted.reduce((n, c) => n + c.bytes, 0);
const totalAfter = converted.reduce((n, c) => n + c.targetBytes, 0);

const report = {
	note: [
		'Produced by asset-pipeline/compress-textures.mjs (RM-002 P6).',
		'',
		'Opaque PNGs re-encoded as JPEG. PSNR, mean absolute error and worst',
		'single-channel difference are measured by decoding both files in chromium',
		'and comparing them pixel by pixel - they are not estimates.',
		'',
		'`heldBack` is the part of the problem that was deliberately not fixed, and',
		'why. Files under rooms/textures/ have their URLs written into saved',
		'designs, so renaming one breaks documents that already exist.',
	],
	quality: `JPEG q${QUALITY}`,
	totals: {
		files: converted.length,
		bytesBefore: totalBefore,
		bytesAfter: totalAfter,
		saved: totalBefore - totalAfter,
		savedPercent: Math.round(((totalBefore - totalAfter) / totalBefore) * 1000) / 10,
	},
	converted: converted
		.sort((a, b) => (b.bytes - b.targetBytes) - (a.bytes - a.targetBytes))
		.map((c) => ({
			from: c.url,
			to: c.targetUrl,
			pixels: `${c.width}x${c.height}`,
			bytesBefore: c.bytes,
			bytesAfter: c.targetBytes,
			...quality.get(c.target),
		})),
	rewroteGlb: touchedGlb,
	rewroteJson: touchedJson,
	heldBack: skipped
		.filter((s) => s.bytes)
		.sort((a, b) => b.bytes - a.bytes)
		.reduce((groups, s) =>
		{
			groups[s.why] = groups[s.why] || {files: 0, bytes: 0};
			groups[s.why].files += 1;
			groups[s.why].bytes += s.bytes;
			return groups;
		}, {}),
	openQuestions: [
		'The three 1500x2297 wood textures under models/js-glb/textures are 2.2 MB',
		'of already-lossy JPEG. Halving them to 750x1148 would be invisible on a',
		'wardrobe rendered a few hundred pixels tall and would save roughly 1.6 MB,',
		'but it is a resolution decision rather than a compression one and it',
		'changes what the renderer samples. Not taken here.',
	],
};

writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`converted ${converted.length} files: ${(totalBefore / 1024).toFixed(1)} kB -> ${(totalAfter / 1024).toFixed(1)} kB (${report.totals.savedPercent}% saved)`);
console.log(`rewrote ${touchedGlb.length} glb, ${touchedJson.length} json`);
console.log(`report: ${relative(ROOT, REPORT)}`);
for (const item of report.converted.slice(0, 5))
{
	console.log(`  ${item.to}  ${(item.bytesBefore / 1024).toFixed(0)} -> ${(item.bytesAfter / 1024).toFixed(0)} kB  PSNR ${item.psnr} dB`);
}
