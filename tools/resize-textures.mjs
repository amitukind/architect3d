/**
 * Bring oversized GPU textures under a resolution cap (RM-004 B4).
 *
 *   npm run resize                 resize anything over the cap
 *   npm run resize -- --check      exit non-zero if the tree is stale
 *   npm run resize -- --dry        report what would change, write nothing
 *
 * ## The finding this answers
 *
 * B1 added the `texture-vram` budget and found 164 MB of GPU memory behind
 * 5.23 MB of files, because an uploaded texel costs four bytes whatever the
 * file compressed to. B4 first corrected that measurement - 174 of the 202
 * images are DOM thumbnails that are never uploaded, and the manifest's own
 * `kind` was mislabelling 148 of them - which left an honest 104.67 MB over 28
 * textures, five of them holding 80 MB.
 *
 * Then it measured those five, and they are not a compression problem:
 *
 *     rooms/textures/Ground_4K.jpg    1822x1822    73 KB    0.023 bytes/texel
 *     textures/white_wood.jpg         1500x2297   229 KB    0.068 bytes/texel
 *     textures/grey-brown_wood.jpg    1500x2297   684 KB    0.203 bytes/texel
 *     textures/oak_wood.jpg           1500x2297   704 KB    0.209 bytes/texel
 *     rooms/textures/envs/Garden.jpg  2048x1024   844 KB    0.412 bytes/texel
 *
 * A JPEG carrying 0.023 bytes per texel is not a detailed image that compressed
 * well. It is a small image that was enlarged. And `Ground_4K` is the skybox
 * ground, which `skybox.js` tiles at `repeat.set(40, 40)` - so each tile covers
 * a few dozen screen pixels and the renderer samples a deep mip level for every
 * one of them. Mip 0 of that texture is memory nothing ever reads.
 *
 * ## Why resizing and not KTX2
 *
 * KTX2/ETC1S recovers more - 78.50 MB against this pass's 61.68 - and B4 built
 * and proved the encoder before choosing against it. Three things decided it:
 *
 *   1. **It reaches the whole catalog.** 19 of the 28 textures (72.78 MB, 70%)
 *      live inside .glb files, and GLTFLoader resolves their image URIs
 *      relative to the model, bypassing the resolver A5 built. KTX2 changes the
 *      file extension, so all 19 .glb files would need rewriting and B1's Draco
 *      output would go through the pipeline a second time. A resize keeps the
 *      filename, so every reference to it stays correct and no .glb is touched.
 *   2. **No renderer coupling.** `KTX2Loader.load()` throws unless
 *      `detectSupport(renderer)` has been called, and `texture_cache` is
 *      deliberately page-wide and renderer-free - A0 found that coupling and A4
 *      removed it. Wiring KTX2 puts it back.
 *   3. **It fixes the actual defect.** Compressing an upscaled image is solving
 *      the wrong problem well. The pixels above the cap carry no information;
 *      the honest fix is to stop shipping them.
 *
 * The two compose: a later sprint can still encode the resized textures and
 * take the remaining 32 MB. This pass does not foreclose that, it shrinks what
 * that pass would have to transcode. The KTX2 measurements are kept in the
 * roadmap (§25) so it can be picked up cold.
 *
 * ## Replace in place
 *
 * Same model as B1: the output is committed, a checkout builds and serves with
 * no resizer installed, and the codec packages are devDependencies because
 * nothing at runtime imports them. A5's rule that an asset URL is a published
 * contract is about the NAME, and every logical name resolves to the path it
 * always did. That is the property doing the work here - it is why the .glb
 * files need no rewriting, and it is the whole reason this route is cheap.
 *
 * ## Gamma
 *
 * Resampling is a weighted average, and averaging sRGB values is averaging the
 * wrong numbers: sRGB is perceptually spaced, so the mean of two sRGB values is
 * not the value of the mean light. Downscaling in sRGB darkens fine bright
 * detail - visibly, on exactly the high-contrast wood grain this pass targets.
 * So every image is linearised, resampled in linear light, and re-encoded.
 * Alpha is premultiplied across the same step, or a transparent pixel's
 * meaningless colour bleeds into its neighbours.
 *
 * `lowFrequency` below is the gate that would catch getting this wrong: a gamma
 * error is a global brightness shift, which survives being averaged down to 64
 * pixels while genuine detail loss does not.
 */
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const MANIFEST_PATH = join(PUBLIC, 'asset-manifest.json');
const REPORT_PATH = join(ROOT, 'asset-pipeline', 'resize-report.json');

/**
 * The cap, and the three numbers behind it.
 *
 * 1024 was chosen over 2048 and 512 with the arithmetic on the table. At 2048
 * the pass touches three files and saves 10.78 MB, because the three wood
 * textures are already under it and they are half the entire budget - a cap
 * that misses the problem. At 512 it saves 76.19 MB, within 2.3 MB of what full
 * KTX2 buys, but takes the wood grains to 334x512 and a user zoomed onto a
 * bookcase face could see it. 1024 saves 61.68 MB and leaves every texture at
 * or above the resolution it is realistically sampled at.
 */
export const CAP = 1024;

/**
 * JPEG quality for re-encoded output.
 *
 * A resized JPEG is a second generation, and generation loss is the one part of
 * this pass that is pure waste: the resample loss buys VRAM, the codec loss
 * buys nothing. So it is worth spending disk to suppress, up to the point where
 * the spending stops working. Measured on the real path over the five targets -
 * the figure is the worst `codecRms` of the five, in 0-255 units:
 *
 *     q92    2.536    disk 2.38 MB
 *     q95    1.763    disk 2.64 MB      -30% loss for +260 KB
 *     q96    1.521    disk 2.77 MB      -14% loss for +130 KB
 *     q97    1.283    disk 2.91 MB      -16% loss for +140 KB
 *
 * 95 is the knee. Past it each ~140 KB buys about 15%, which is not a trade
 * worth making for an error already four times smaller than the resample's own.
 *
 * The first draft of this comment asserted 92 would land "around 1/255" without
 * measuring. It lands at 2.5, and at a 3.0 gate that is 18% of margin - a gate
 * the next texture added to the catalog would trip for no good reason. Left on
 * the record because the number was invented and the invented number was the
 * one that looked fine.
 */
const JPEG_QUALITY = 95;

/** Kinds that are uploaded to the GPU. Thumbnails are `<img>` and out of scope. */
const GPU_KINDS = new Set(['model-texture', 'texture', 'environment']);

/**
 * Gate thresholds, in 0-255 sRGB units.
 *
 * Set from measured separation between honest resizes and broken ones, not from
 * what this catalog happens to produce - a threshold derived from the current
 * measurement moves with the thing it constrains and stops being a threshold.
 *
 * ## The separation, measured
 *
 * Two synthetic sources at 384px resized to 171px, the real 1500->669 ratio.
 * "organic" superposes four frequencies and stands in for a photographic
 * texture; "checkerboard" is a maximum-contrast square wave at 32 cycles, which
 * is the most adversarial input this comparison can be given because 32 cycles
 * is exactly the Nyquist limit of the 64px band the comparison happens in.
 *
 *                              organic     checkerboard
 *     honest resize              0.262            2.261
 *     gamma 1.05                 3.447            1.249
 *     gamma 1.10                 6.746            2.471
 *     gamma 2.2                 55.358
 *     channel swap R<->B        63.165           40.566
 *     one-pixel misalignment     7.317
 *
 * On a realistic texture the separation is more than tenfold and any threshold
 * between 1 and 3 works. On the adversarial one it collapses: a 5% gamma error
 * reads 1.249 while an honest resize of the same image reads 2.261, so no
 * threshold whatsoever separates them. That is a real limit of this measurement
 * and it is stated rather than hidden - `lowFrequency` catches gross structural
 * failures reliably and mild ones only on images that are not pathological.
 *
 * ## Why 2.0, given that
 *
 * Because the failure modes are not symmetric. Every gate in this tool can only
 * fall back: a texture that trips one keeps its original bytes and appears in
 * the report's `skipped` list. So a false refusal costs a missed saving that is
 * written down, and a false acceptance ships a visibly wrong texture. 2.0 sits
 * below the adversarial checkerboard's 2.261, which means an image like that
 * would be REFUSED rather than resized - the conservative direction, chosen
 * deliberately. Widening the gate to 3.0 to admit it would also admit a 5%
 * gamma error on every organic texture in the catalog.
 */
export const GATES = {
	// Global agreement after averaging both images down to 64px. A gamma error,
	// a channel swap, a crop or a systematic aliasing bias all survive that
	// averaging; genuine high-frequency detail loss does not. This is the gate
	// that says "it is the same image", as distinct from "it has the same pixels".
	lowFrequencyRms: 2.0,
	lowFrequencyMax: 8.0,
	// Codec generation loss: the decoded output against the pixels that went
	// into the encoder. Zero for PNG, which is lossless.
	codecRms: 3.0,
};

const CHECK = process.argv.includes('--check');
const DRY = process.argv.includes('--dry');

/* -------------------------------------------------------------------------
 * Decoding and encoding
 * ------------------------------------------------------------------------- */

/** @typedef {{width: number, height: number, data: Uint8Array, format: 'png'|'jpeg', hasAlpha: boolean}} Raster */

/**
 * Decode to straight (non-premultiplied) RGBA8.
 *
 * @param {Buffer} bytes
 * @returns {Raster | null} null when the bytes are not a format this handles.
 */
export function decode(bytes)
{
	if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47)
	{
		const png = PNG.sync.read(bytes);
		const data = new Uint8Array(png.data);
		let hasAlpha = false;
		for (let i = 3; i < data.length; i += 4) { if (data[i] !== 255) { hasAlpha = true; break; } }
		return {width: png.width, height: png.height, data, format: 'png', hasAlpha};
	}
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
	{
		const img = jpeg.decode(bytes, {useTArray: true, formatAsRGBA: true});
		return {width: img.width, height: img.height, data: new Uint8Array(img.data), format: 'jpeg', hasAlpha: false};
	}
	return null;
}

/** @param {Raster} raster @returns {Buffer} */
function encode(raster)
{
	if (raster.format === 'png')
	{
		const png = new PNG({width: raster.width, height: raster.height});
		png.data = Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length);
		return PNG.sync.write(png, {deflateLevel: 9});
	}
	return Buffer.from(jpeg.encode({
		width: raster.width, height: raster.height,
		data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length),
	}, JPEG_QUALITY).data);
}

/* -------------------------------------------------------------------------
 * Resampling
 * ------------------------------------------------------------------------- */

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++)
{
	const c = i / 255;
	SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** @param {number} c linear 0..1 @returns {number} sRGB 0..255, rounded */
function linearToSrgb(c)
{
	const clamped = c <= 0 ? 0 : (c >= 1 ? 1 : c);
	const s = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
	return Math.round(s * 255);
}

/**
 * Lanczos-3.
 *
 * Chosen over a box or bilinear filter because the targets are wood grain and
 * brick - high-frequency detail where a box filter aliases into visible moire
 * and bilinear turns the grain to mush. Lanczos rings slightly at hard edges;
 * the clamp in `linearToSrgb` absorbs the overshoot, and `lowFrequency` would
 * catch it if the ringing were ever bad enough to shift the image.
 *
 * @param {number} x @returns {number}
 */
export function lanczos(x)
{
	if (x === 0) { return 1; }
	const a = Math.abs(x);
	if (a >= 3) { return 0; }
	const px = Math.PI * a;
	return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/**
 * Precompute the contributing source samples for one output axis.
 *
 * Separable: the 2D filter is two 1D passes, which is O(n) in the kernel width
 * rather than O(n^2), and lets the weights for an axis be computed once and
 * reused for every line along it.
 *
 * @param {number} sourceLength @param {number} targetLength
 * @returns {{start: number, weights: Float64Array}[]}
 */
export function axisWeights(sourceLength, targetLength)
{
	const scale = targetLength / sourceLength;
	// Downscaling widens the kernel in source space: one output pixel is an
	// average over 1/scale input pixels. Upscaling never happens here, but
	// clamping to 1 keeps the function correct rather than merely unused.
	const support = 3 / Math.min(scale, 1);
	/** @type {{start: number, weights: Float64Array}[]} */
	const out = [];

	for (let i = 0; i < targetLength; i++)
	{
		// Pixel centres, not edges. Sampling at edges shifts the image by half
		// an output pixel, which `lowFrequency` reads as a real difference -
		// correctly, because it is one.
		const centre = (i + 0.5) / scale;
		const start = Math.max(0, Math.ceil(centre - support - 0.5));
		const end = Math.min(sourceLength - 1, Math.floor(centre + support - 0.5));
		const weights = new Float64Array(end - start + 1);

		let sum = 0;
		for (let s = start; s <= end; s++)
		{
			const w = lanczos((s + 0.5 - centre) * Math.min(scale, 1));
			weights[s - start] = w;
			sum += w;
		}
		// Normalise so every output pixel is a true weighted mean. Without this
		// the truncated kernel at the image border darkens the edge.
		if (sum !== 0) { for (let k = 0; k < weights.length; k++) { weights[k] /= sum; } }
		out.push({start, weights});
	}
	return out;
}

/**
 * Resample in linear light, with alpha premultiplied across the filter.
 *
 * @param {Raster} source @param {number} width @param {number} height
 * @returns {Raster}
 */
export function resample(source, width, height)
{
	const {width: sw, height: sh, data} = source;
	// Premultiplied linear RGB + straight alpha. Premultiplied because a fully
	// transparent pixel's colour channels are undefined, and letting them into
	// a neighbour's average bleeds whatever the authoring tool left there.
	const linear = new Float64Array(sw * sh * 4);
	for (let i = 0, n = sw * sh; i < n; i++)
	{
		const a = data[i * 4 + 3] / 255;
		linear[i * 4] = SRGB_TO_LINEAR[data[i * 4]] * a;
		linear[i * 4 + 1] = SRGB_TO_LINEAR[data[i * 4 + 1]] * a;
		linear[i * 4 + 2] = SRGB_TO_LINEAR[data[i * 4 + 2]] * a;
		linear[i * 4 + 3] = a;
	}

	const horizontal = axisWeights(sw, width);
	const pass = new Float64Array(width * sh * 4);
	for (let y = 0; y < sh; y++)
	{
		for (let x = 0; x < width; x++)
		{
			const {start, weights} = horizontal[x];
			let r = 0, g = 0, b = 0, a = 0;
			for (let k = 0; k < weights.length; k++)
			{
				const w = weights[k];
				const o = (y * sw + start + k) * 4;
				r += linear[o] * w; g += linear[o + 1] * w; b += linear[o + 2] * w; a += linear[o + 3] * w;
			}
			const o = (y * width + x) * 4;
			pass[o] = r; pass[o + 1] = g; pass[o + 2] = b; pass[o + 3] = a;
		}
	}

	const vertical = axisWeights(sh, height);
	const out = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
	{
		const {start, weights} = vertical[y];
		for (let x = 0; x < width; x++)
		{
			let r = 0, g = 0, b = 0, a = 0;
			for (let k = 0; k < weights.length; k++)
			{
				const w = weights[k];
				const o = ((start + k) * width + x) * 4;
				r += pass[o] * w; g += pass[o + 1] * w; b += pass[o + 2] * w; a += pass[o + 3] * w;
			}
			const o = (y * width + x) * 4;
			// Unpremultiply. Below a pixel's worth of coverage the colour is
			// noise amplified by a tiny divisor, so it is written as black
			// rather than as whatever the division produces.
			const alpha = a <= 0 ? 0 : (a >= 1 ? 1 : a);
			if (alpha < 1 / 255) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0; continue; }
			out[o] = linearToSrgb(r / alpha);
			out[o + 1] = linearToSrgb(g / alpha);
			out[o + 2] = linearToSrgb(b / alpha);
			out[o + 3] = Math.round(alpha * 255);
		}
	}

	return {width, height, data: out, format: source.format, hasAlpha: source.hasAlpha};
}

/* -------------------------------------------------------------------------
 * Fidelity
 * ------------------------------------------------------------------------- */

/**
 * Agreement between two images at a resolution below both of their Nyquist
 * limits.
 *
 * ## Why this shape, and what was rejected
 *
 * The obvious check - compare the output against the input - cannot be written,
 * because they have different dimensions. The three ways around that are all
 * worse than they look:
 *
 *   1. **Compare the output to `resample(input, outputDims)`.** Circular: that
 *      expression IS the output. It reports zero for any resampler including a
 *      broken one, because it re-runs the same code and compares the result to
 *      itself.
 *   2. **Upscale the output back and compare at the input's resolution.** This
 *      measures the detail the resize removed, which is the intended effect of
 *      the change. Gating on it would be gating against doing the job.
 *   3. **PSNR at full resolution.** Same problem as 2, expressed in decibels.
 *      It is worth REPORTING - it is in the report below - but a threshold on
 *      it would refuse the textures that need resizing most, since the more
 *      wildly oversized an image is, the more "detail" a resize appears to
 *      destroy.
 *
 * So the gate asks a different question: not "how much detail was lost" but
 * "is this still the same image". Average both down to 64 pixels on the long
 * edge and compare there. Every structural failure is global and survives that
 * averaging - a gamma error shifts brightness, a channel swap shifts hue, a
 * half-pixel misalignment shifts everything, premultiply bugs darken edges,
 * aliasing biases the mean. Genuine detail loss averages away to nothing, which
 * is exactly the property that makes the comparison meaningful.
 *
 * Both RMS and max: RMS catches a bias spread over the whole frame, max catches
 * a failure confined to one region that an average would dilute.
 *
 * @param {Raster} a @param {Raster} b
 * @returns {{rms: number, max: number}} in 0-255 sRGB units
 */
export function lowFrequency(a, b)
{
	const long = Math.max(a.width, a.height);
	const w = Math.max(1, Math.round((a.width / long) * 64));
	const h = Math.max(1, Math.round((a.height / long) * 64));
	const left = resample(a, w, h).data;
	const right = resample(b, w, h).data;

	let sum = 0;
	let max = 0;
	for (let i = 0; i < left.length; i++)
	{
		const d = Math.abs(left[i] - right[i]);
		sum += d * d;
		if (d > max) { max = d; }
	}
	return {rms: Math.sqrt(sum / left.length), max};
}

/** Per-pixel RMS between two rasters of identical dimensions, 0-255 units. */
export function pixelRms(a, b)
{
	let sum = 0;
	for (let i = 0; i < a.length; i++)
	{
		const d = a[i] - b[i];
		sum += d * d;
	}
	return Math.sqrt(sum / a.length);
}

/**
 * What the resize removed, in decibels, at the original resolution.
 *
 * Reported and never gated - see `lowFrequency` for why a threshold on this
 * would be a threshold against doing the job. It is here because the honest
 * number for "detail was discarded" belongs on the record next to the claim
 * that discarding it is invisible, and because the browser oracle that decides
 * whether it IS invisible needs something to be compared against.
 */
function detailPsnr(original, resized)
{
	const restored = resample(resized, original.width, original.height);
	const rms = pixelRms(original.data, restored.data);
	return rms === 0 ? Infinity : 20 * Math.log10(255 / rms);
}

/* -------------------------------------------------------------------------
 * Driver
 * ------------------------------------------------------------------------- */

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const vramBytes = (w, h) => Math.round(w * h * 4 * 4 / 3);
const human = (n) => (n / 1048576).toFixed(2) + ' MB';

/** The dimensions under the cap, preserving aspect ratio. */
export function capped(width, height)
{
	const long = Math.max(width, height);
	if (long <= CAP) { return null; }
	const scale = CAP / long;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

function main()
{
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
	// Resolve through `url` before touching the filesystem. A manifest key is a
	// LOGICAL name and A5's whole point is that it need not be where the file
	// is; `rooms/textures/hardwood.png` is a retired name pointing at a .jpg,
	// and reading the key directly is an ENOENT. Retired names are skipped
	// rather than followed, because following one would process the same file
	// twice - once under each name - and double-count its VRAM.
	const seen = new Set();
	const targets = Object.entries(manifest.assets)
		.filter(([name, entry]) => GPU_KINDS.has(entry.kind) && (!entry.url || entry.url === name))
		.map(([name]) => name)
		.filter((name) => !seen.has(name) && seen.add(name))
		.sort();

	const report = {cap: CAP, quality: JPEG_QUALITY, gates: GATES, textures: [], skipped: []};
	const stale = [];
	let vramBefore = 0;
	let vramAfter = 0;
	let diskBefore = 0;
	let diskAfter = 0;
	let resized = 0;

	for (const name of targets)
	{
		const path = join(PUBLIC, name);
		const bytes = readFileSync(path);
		const source = decode(bytes);

		if (!source)
		{
			report.skipped.push({name, reason: 'header not recognised as PNG or JPEG'});
			continue;
		}

		diskBefore += bytes.length;
		vramBefore += vramBytes(source.width, source.height);
		const target = capped(source.width, source.height);

		if (!target)
		{
			diskAfter += bytes.length;
			vramAfter += vramBytes(source.width, source.height);
			continue;
		}

		// `--check` answers "is the committed tree what the pass would produce",
		// and neither half of that needs the encoder to run: the cap is a
		// property of the dimensions, and equality with the committed output is
		// a property of the hashes. Resampling here would make the check the
		// slowest thing in CI to learn nothing it does not already know.
		if (CHECK)
		{
			stale.push(`${name} is ${source.width}x${source.height}, over the ${CAP} cap`);
			diskAfter += bytes.length;
			vramAfter += vramBytes(source.width, source.height);
			continue;
		}

		const shrunk = resample(source, target.width, target.height);
		const encoded = encode(shrunk);
		const decoded = decode(encoded);

		// Every gate below can only fall back. A texture that fails one keeps
		// its original bytes and is recorded as skipped - the pass never ships
		// an image it could not verify, which is the B1 discipline and the
		// mitigation for the one risk a lossy step carries.
		const refuse = (reason) =>
		{
			report.skipped.push({name, reason, from: `${source.width}x${source.height}`, to: `${target.width}x${target.height}`});
			diskAfter += bytes.length;
			vramAfter += vramBytes(source.width, source.height);
		};

		if (!decoded)
		{
			refuse('re-encoded bytes did not decode');
			continue;
		}
		if (decoded.width !== target.width || decoded.height !== target.height)
		{
			refuse(`round trip changed dimensions to ${decoded.width}x${decoded.height}`);
			continue;
		}
		// Aspect ratio, to within the half pixel that rounding to integers can
		// cost. A texture is sampled in normalised UV, so a stretched one is
		// wrong everywhere and subtly - the kind of failure that reaches a
		// release because no single frame looks broken.
		const aspectDrift = Math.abs((target.width / target.height) - (source.width / source.height));
		if (aspectDrift > (0.5 / Math.min(target.width, target.height)))
		{
			refuse(`aspect ratio drifted by ${aspectDrift.toFixed(6)}`);
			continue;
		}
		if (source.hasAlpha && source.format !== decoded.format)
		{
			refuse('alpha would be dropped by a format change');
			continue;
		}
		// Never grow. The point is to ship fewer bytes as well as fewer texels,
		// and a re-encode that costs disk to save VRAM is a trade this pass has
		// no mandate to make.
		if (encoded.length >= bytes.length)
		{
			refuse(`re-encode grew the file, ${bytes.length} -> ${encoded.length} bytes`);
			continue;
		}

		const band = lowFrequency(source, decoded);
		if (band.rms > GATES.lowFrequencyRms || band.max > GATES.lowFrequencyMax)
		{
			refuse(`low-frequency content moved: rms ${band.rms.toFixed(3)}, max ${band.max}`);
			continue;
		}
		const codecRms = pixelRms(shrunk.data, decoded.data);
		if (codecRms > GATES.codecRms)
		{
			refuse(`codec generation loss ${codecRms.toFixed(3)} over ${GATES.codecRms}`);
			continue;
		}

		report.textures.push({
			name,
			from: {width: source.width, height: source.height, bytes: bytes.length},
			to: {width: target.width, height: target.height, bytes: encoded.length},
			vram: {before: vramBytes(source.width, source.height), after: vramBytes(target.width, target.height)},
			fidelity: {
				lowFrequencyRms: Number(band.rms.toFixed(4)),
				lowFrequencyMax: band.max,
				codecRms: Number(codecRms.toFixed(4)),
				detailPsnr: Number(detailPsnr(source, decoded).toFixed(2)),
			},
			sha256: sha(encoded),
		});

		diskAfter += encoded.length;
		vramAfter += vramBytes(target.width, target.height);
		resized += 1;

		if (!DRY && !CHECK) { writeFileSync(path, encoded); }
	}

	report.totals = {
		textures: targets.length,
		resized,
		disk: {before: diskBefore, after: diskAfter},
		vram: {before: vramBefore, after: vramAfter},
	};

	/* ---- output ---- */

	if (CHECK)
	{
		// Two independent questions, both asked every time. A tree can be under
		// the cap and still wrong - somebody re-encoding a texture by hand
		// leaves the dimensions alone - and it can be over the cap with the
		// report still matching, if a new oversized texture was added. An
		// earlier draft ran the hash check only when the cap check found
		// nothing, which made the second failure hide the first.
		const committed = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
		const live = new Set(targets);

		// A later pass may legitimately have replaced a file this one produced.
		//
		// This is the THIRD place the same shape has appeared: a pipeline pass
		// records the tree it left, and the next pass makes that record look
		// like a lie. `tests/asset-integrity.test.js` hit it when B4 resized
		// files P6 had converted, and again when hardwood was re-encoded. Here
		// B5 transcoded five of the textures B4 resized, so their .jpg is gone
		// and a .ktx2 stands in its place.
		//
		// The rule that resolves all three: a file is accounted for if the pass
		// that owns it says so, or if a LATER pass records having replaced it.
		// Only an unexplained disappearance is staleness.
		const transcoded = new Map();
		const transcodePath = join(ROOT, 'asset-pipeline', 'texture-transcode.json');
		if (existsSync(transcodePath))
		{
			for (const entry of JSON.parse(readFileSync(transcodePath, 'utf8')).textures)
			{
				transcoded.set(entry.from, entry.to);
			}
		}
		/** @type {string[]} */
		const drifted = [];
		/** @type {string[]} */
		const orphaned = [];

		for (const entry of committed.textures)
		{
			// Existence first. A report entry whose file was deleted would
			// otherwise reach readFileSync and abort the run with an ENOENT
			// stack trace - a crash where the tool has a perfectly good thing
			// to say, which is that the report is describing a tree that is
			// no longer there.
			const successor = transcoded.get(entry.name);
			if (successor)
			{
				// Superseded, not missing. The successor still has to be there.
				if (!existsSync(join(PUBLIC, successor)))
				{
					orphaned.push(`${entry.name} was transcoded to ${successor}, which is not there`);
				}
				continue;
			}
			if (!live.has(entry.name) || !existsSync(join(PUBLIC, entry.name)))
			{
				orphaned.push(`${entry.name} is in the report but is no longer a GPU texture in the tree`);
				continue;
			}
			if (sha(readFileSync(join(PUBLIC, entry.name))) !== entry.sha256)
			{
				drifted.push(`${entry.name} does not match the bytes recorded in the report`);
			}
		}

		const problems = [...stale, ...drifted, ...orphaned];
		if (problems.length)
		{
			console.error('\nTextures are stale:\n');
			problems.forEach((line) => console.error('  ' + line));
			console.error('\nRun `npm run resize` and commit the result.\n');
			process.exit(1);
		}
		console.log(`\n${targets.length} GPU textures, all within the ${CAP}px cap, all matching the report.\n`);
		return;
	}

	console.log(`\n${resized} of ${targets.length} GPU textures were over the ${CAP}px cap.\n`);
	for (const entry of report.textures)
	{
		console.log('  ' + entry.name);
		console.log('      '
			+ `${entry.from.width}x${entry.from.height} -> ${entry.to.width}x${entry.to.height}`.padEnd(26)
			+ `${(entry.from.bytes / 1024).toFixed(0)} -> ${(entry.to.bytes / 1024).toFixed(0)} KB`.padEnd(20)
			+ `VRAM ${human(entry.vram.before)} -> ${human(entry.vram.after)}`);
		console.log('      '
			+ `low-frequency rms ${entry.fidelity.lowFrequencyRms.toFixed(3)} max ${entry.fidelity.lowFrequencyMax}`.padEnd(42)
			+ `codec rms ${entry.fidelity.codecRms.toFixed(3)}   detail ${entry.fidelity.detailPsnr} dB`);
	}
	if (report.skipped.length)
	{
		console.log('\n  kept as authored:');
		report.skipped.forEach((entry) => console.log(`      ${entry.name}: ${entry.reason}`));
	}

	console.log('\n  disk  ' + human(diskBefore) + ' -> ' + human(diskAfter)
		+ '   (-' + human(diskBefore - diskAfter) + ')');
	console.log('  VRAM  ' + human(vramBefore) + ' -> ' + human(vramAfter)
		+ '   (-' + human(vramBefore - vramAfter) + ', '
		+ (100 * (vramBefore - vramAfter) / vramBefore).toFixed(1) + '%)');

	if (DRY) { console.log('\n  --dry: nothing written.\n'); return; }

	writeFileSync(REPORT_PATH, JSON.stringify(report, null, '\t') + '\n');
	console.log('\n  wrote asset-pipeline/resize-report.json');
	console.log('  now run `npm run manifest` - hashes and sizes have changed.\n');
}

/**
 * Run only when invoked directly, so the module can be imported for its parts.
 *
 * Not a formality. `tests/texture-resize.test.js` imports `resample` and
 * `lowFrequency` to test the resampler against synthetic images, and without
 * this guard that import would run the whole pass and rewrite five catalog
 * textures as a side effect of running the test suite. Found the direct way: a
 * throwaway measurement script imported this file to reuse the resampler and
 * silently resized the catalog.
 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
