/**
 * The 1024px cap is a ratchet, and this is what makes it one (RM-004 B4).
 *
 * ## Two different claims, tested differently
 *
 * **That the committed tree is correct** is checked against the manifest and
 * `asset-pipeline/resize-report.json`, with no image processing at all. That
 * half has to work from a bare checkout with no resizer installed, which is the
 * same property `asset-encoding.test.js` holds for B1's Draco output.
 *
 * **That the resizer is correct** is checked against synthetic images with
 * known answers. This half matters more than it looks: the pass rewrote five
 * catalog textures in place, the originals are only in git history, and every
 * fidelity number in the report is produced by the same module being judged.
 * A resampler with a gamma bug would report excellent fidelity against its own
 * broken output. So the synthetic cases test the arithmetic from outside, with
 * answers derived by hand rather than by running the code.
 *
 * The sharp one is `resamples in linear light`. It is the entire gamma question
 * reduced to a single integer, and the two candidate answers - 188 and 128 -
 * are 60 apart, so it cannot pass by accident or by tolerance.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {CAP, GATES, capped, lowFrequency, resample} from '../tools/resize-textures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const manifest = JSON.parse(readFileSync(join(PUBLIC, 'asset-manifest.json'), 'utf8'));
const report = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline', 'resize-report.json'), 'utf8'));
const GPU_KINDS = new Set(['model-texture', 'texture', 'environment']);

/** Header-only dimensions, so the tree can be checked without a decoder. */
function dimensions(bytes)
{
	if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47)
	{
		return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
	}
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) { return null; }
	let i = 2;
	while (i + 9 < bytes.length)
	{
		if (bytes[i] !== 0xff) { i++; continue; }
		const marker = bytes[i + 1];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
		{
			return {height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7)};
		}
		i += 2 + bytes.readUInt16BE(i + 2);
	}
	return null;
}

// Live GPU textures only: a manifest key is a logical name, and a RETIRED one
// points at a file under a different name. Reading the key directly is an
// ENOENT, and following it would count the same file twice.
const gpuTextures = Object.entries(manifest.assets)
	.filter(([name, entry]) => GPU_KINDS.has(entry.kind) && (!entry.url || entry.url === name))
	.map(([name]) => name)
	.sort();

/** Every retired name, with the live file it resolves to. */
const retired = Object.entries(manifest.assets)
	.filter(([name, entry]) => entry.url && entry.url !== name)
	.map(([name, entry]) => [name, entry.url]);

/** A solid RGBA raster. @returns {import('../tools/resize-textures.mjs').Raster} */
function solid(width, height, [r, g, b, a])
{
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++)
	{
		data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
	}
	return {width, height, data, format: 'png', hasAlpha: a !== 255};
}

describe('the committed tree is under the cap (RM-004 B4)', () =>
{
	it('every texture that reaches the GPU is within the cap', () =>
	{
		// The claim the sprint exists to make, asserted against the files
		// themselves rather than against the report that describes them.
		expect(gpuTextures.length).toBeGreaterThan(20);
		const over = [];
		for (const name of gpuTextures)
		{
			const size = dimensions(readFileSync(join(PUBLIC, name)));
			expect(size, `${name} has an unreadable header`).not.toBeNull();
			if (Math.max(size.width, size.height) > CAP)
			{
				over.push(`${name} is ${size.width}x${size.height}`);
			}
		}
		expect(over).toEqual([]);
	});

	it('every retired name resolves to a file that is there', () =>
	{
		// The indirection A5 built, exercised. A retired name has no file of its
		// own by definition, so the only thing that keeps a saved design working
		// is that its `url` lands somewhere real.
		expect(retired.length).toBeGreaterThan(0);
		for (const [name, url] of retired)
		{
			expect(existsSync(join(PUBLIC, name)), `${name} is retired but a file of that name exists`).toBe(false);
			expect(existsSync(join(PUBLIC, url)), `${name} retires to ${url}, which is not there`).toBe(true);
		}
	});

	it('the report describes files that exist and still match', () =>
	{
		expect(report.textures.length).toBeGreaterThan(0);
		for (const entry of report.textures)
		{
			const path = join(PUBLIC, entry.name);
			expect(existsSync(path), `${entry.name} is in the report but not on disk`).toBe(true);
			const digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
			expect(digest, `${entry.name} has changed since the report was written`).toBe(entry.sha256);
		}
	});

	it('every recorded resize came in under every gate', () =>
	{
		// The gates run inside the tool, which means nothing outside the tool
		// has ever confirmed they were applied. This reads the numbers the tool
		// wrote and checks them against the thresholds it published.
		for (const entry of report.textures)
		{
			expect(entry.fidelity.lowFrequencyRms).toBeLessThanOrEqual(GATES.lowFrequencyRms);
			expect(entry.fidelity.lowFrequencyMax).toBeLessThanOrEqual(GATES.lowFrequencyMax);
			expect(entry.fidelity.codecRms).toBeLessThanOrEqual(GATES.codecRms);
			expect(entry.to.bytes).toBeLessThan(entry.from.bytes);
			expect(Math.max(entry.to.width, entry.to.height)).toBeLessThanOrEqual(CAP);
		}
	});

	it('the resize only ever shrank things', () =>
	{
		for (const entry of report.textures)
		{
			expect(entry.to.width).toBeLessThan(entry.from.width);
			expect(entry.to.height).toBeLessThan(entry.from.height);
			expect(entry.vram.after).toBeLessThan(entry.vram.before);
		}
		expect(report.totals.vram.after).toBeLessThan(report.totals.vram.before);
		expect(report.totals.disk.after).toBeLessThan(report.totals.disk.before);
	});
});

describe('the resampler is correct (RM-004 B4)', () =>
{
	it('resamples in linear light, not in sRGB', () =>
	{
		// THE gamma test, and the reason it is written as a split rather than a
		// checkerboard: the Lanczos kernel is symmetric about the output pixel
		// centre, so a half-black half-white image weights each half to exactly
		// 0.5 whatever the kernel's shape. No tolerance is being leaned on.
		//
		//   averaged in linear light   0.5 linear -> sRGB 188   correct
		//   averaged in sRGB           (0 + 255)/2 -> 128       wrong
		//
		// 60 apart, so this cannot pass by accident.
		const width = 64;
		const source = solid(width, 8, [0, 0, 0, 255]);
		for (let y = 0; y < 8; y++)
		{
			for (let x = width / 2; x < width; x++)
			{
				const o = (y * width + x) * 4;
				source.data[o] = 255; source.data[o + 1] = 255; source.data[o + 2] = 255;
			}
		}

		const [r, g, b] = resample(source, 1, 1).data;
		for (const channel of [r, g, b])
		{
			expect(channel).toBeGreaterThanOrEqual(186);
			expect(channel).toBeLessThanOrEqual(190);
		}
	});

	it('leaves a uniform image exactly alone', () =>
	{
		// Partition of unity: the normalisation in axisWeights has to make the
		// weights sum to one, or every image drifts in brightness and the drift
		// is worst at the borders where the kernel is truncated.
		const source = solid(50, 40, [37, 142, 201, 255]);
		const out = resample(source, 25, 20);
		expect(out.width).toBe(25);
		expect(out.height).toBe(20);
		for (let i = 0; i < out.data.length; i += 4)
		{
			expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([37, 142, 201, 255]);
		}
	});

	it('does not bleed colour out of transparent pixels', () =>
	{
		// A fully transparent pixel's RGB is undefined, and authoring tools
		// leave anything there. Premultiplying before the filter is what stops
		// it reaching a neighbour; without it the red half below comes back
		// contaminated with green.
		const width = 64;
		const source = solid(width, 8, [255, 0, 0, 255]);
		for (let y = 0; y < 8; y++)
		{
			for (let x = width / 2; x < width; x++)
			{
				const o = (y * width + x) * 4;
				source.data[o] = 0; source.data[o + 1] = 255; source.data[o + 2] = 0; source.data[o + 3] = 0;
			}
		}

		const out = resample(source, 1, 1).data;
		expect(out[3]).toBeGreaterThan(120);
		expect(out[3]).toBeLessThan(136);
		// Red survives at full strength; green never arrives.
		expect(out[0]).toBeGreaterThan(250);
		expect(out[1]).toBeLessThan(4);
	});

	it('keeps a symmetric image symmetric', () =>
	{
		// Sampling at pixel edges instead of centres shifts the image by half an
		// output pixel. That is invisible in isolation and obvious here.
		const width = 65;
		const source = solid(width, 1, [0, 0, 0, 255]);
		const middle = (Math.floor(width / 2)) * 4;
		source.data[middle] = 255; source.data[middle + 1] = 255; source.data[middle + 2] = 255;

		const out = resample(source, 13, 1).data;
		for (let i = 0; i < 6; i++)
		{
			const left = out[i * 4];
			const right = out[(12 - i) * 4];
			expect(Math.abs(left - right), `column ${i} is not mirrored`).toBeLessThanOrEqual(1);
		}
	});

	it('never emits a value outside the byte range', () =>
	{
		// Lanczos overshoots at hard edges. The clamp absorbs it; this is the
		// assertion that the clamp is actually in the path.
		const width = 128;
		const source = solid(width, 4, [0, 0, 0, 255]);
		for (let y = 0; y < 4; y++)
		{
			for (let x = 0; x < width; x += 2)
			{
				const o = (y * width + x) * 4;
				source.data[o] = 255; source.data[o + 1] = 255; source.data[o + 2] = 255;
			}
		}
		const out = resample(source, 33, 2).data;
		for (const value of out) { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(255); }
	});
});

describe('the fidelity gate has teeth (RM-004 B4)', () =>
{
	// 384 -> 171 is the real 1500 -> 669 ratio, so these cases exercise the
	// comparison at the scale it actually runs at rather than a toy one.
	const SIZE = 384;
	const RESIZED = 171;

	/**
	 * A stand-in for a photographic texture: four superposed frequencies and no
	 * single hard edge band.
	 *
	 * The first version of these tests used a checkerboard, and it was the wrong
	 * image in a way worth keeping on the record. A square wave puts all its
	 * energy at one frequency and its odd harmonics, so a resize either
	 * preserves it or destroys it with nothing in between - and at 32 cycles it
	 * lands exactly on the 64px comparison's Nyquist limit, where an honest
	 * resize reads 2.261 and a 5% gamma error reads 1.249. Tests built on that
	 * image measure aliasing, not fidelity. Real textures are wood grain and
	 * brick, which look like this.
	 */
	function organic()
	{
		const raster = solid(SIZE, SIZE, [0, 0, 0, 255]);
		for (let y = 0; y < SIZE; y++)
		{
			for (let x = 0; x < SIZE; x++)
			{
				const o = (y * SIZE + x) * 4;
				const v = 128 + 50 * Math.sin(x / 23) + 30 * Math.sin(y / 11 + 1)
					+ 25 * Math.sin((x + y) / 5) + 18 * Math.sin((x - 2 * y) / 3.3);
				const clamp = (n) => Math.max(0, Math.min(255, n));
				raster.data[o] = clamp(v);
				raster.data[o + 1] = clamp(v * 0.8 + 30);
				raster.data[o + 2] = clamp(255 - v);
			}
		}
		return raster;
	}

	const base = organic();
	const honest = resample(base, RESIZED, RESIZED);
	const damage = (raster, fn) =>
	{
		const data = new Uint8Array(raster.data);
		fn(data);
		return {...raster, data};
	};

	it('passes an image against itself', () =>
	{
		const {rms, max} = lowFrequency(base, base);
		expect(rms).toBe(0);
		expect(max).toBe(0);
	});

	it('ignores detail loss, which is the whole point of the resize', () =>
	{
		// The gate must NOT fire on an honest resize. A gate that refused one
		// would be a gate against doing the job - which is the trap the
		// `lowFrequency` docblock records rejecting three other measurements
		// for. Measured at 0.262 against a 2.0 threshold.
		expect(lowFrequency(base, honest).rms).toBeLessThan(GATES.lowFrequencyRms / 4);
	});

	it('catches a gamma error', () =>
	{
		// The failure this exists to catch: resampling in sRGB rather than
		// linear light shifts brightness globally, and a global shift is exactly
		// what survives being averaged down to 64 pixels. Even a 5% error clears
		// the threshold by 1.7x on a realistic image.
		const wrong = damage(honest, (data) =>
		{
			for (let i = 0; i < data.length; i++)
			{
				if (i % 4 !== 3) { data[i] = Math.round(255 * Math.pow(data[i] / 255, 1.05)); }
			}
		});
		expect(lowFrequency(base, wrong).rms).toBeGreaterThan(GATES.lowFrequencyRms);
	});

	it('catches a channel swap', () =>
	{
		const swapped = damage(honest, (data) =>
		{
			for (let i = 0; i < data.length; i += 4)
			{
				const r = data[i]; data[i] = data[i + 2]; data[i + 2] = r;
			}
		});
		expect(lowFrequency(base, swapped).rms).toBeGreaterThan(GATES.lowFrequencyRms * 10);
	});

	it('catches a one-pixel misalignment', () =>
	{
		// Sampling at pixel edges rather than centres shifts the whole image.
		// Nothing about the result looks broken in isolation, which is why it
		// needs a gate rather than an eye.
		const shifted = damage(honest, (data) =>
		{
			const source = new Uint8Array(honest.data);
			for (let y = 0; y < honest.height; y++)
			{
				for (let x = 0; x < honest.width; x++)
				{
					const from = (y * honest.width + Math.min(honest.width - 1, x + 1)) * 4;
					const to = (y * honest.width + x) * 4;
					for (let c = 0; c < 4; c++) { data[to + c] = source[from + c]; }
				}
			}
		});
		expect(lowFrequency(base, shifted).rms).toBeGreaterThan(GATES.lowFrequencyRms);
	});

	it('refuses a maximum-contrast square wave, which is the safe direction', () =>
	{
		// Pins the conservative bias as a deliberate property rather than an
		// accident. A 32-cycle checkerboard sits on the comparison's Nyquist
		// limit and reads 2.261 on an HONEST resize, so it trips the gate and
		// keeps its original bytes. That is a false refusal, and a false refusal
		// costs a missed saving that gets written into the report - where a
		// false acceptance would ship a visibly wrong texture.
		const block = 6;
		const checker = solid(SIZE, SIZE, [0, 0, 0, 255]);
		for (let y = 0; y < SIZE; y++)
		{
			for (let x = 0; x < SIZE; x++)
			{
				const o = (y * SIZE + x) * 4;
				const v = (Math.floor(x / block) + Math.floor(y / block)) % 2 ? 40 : 210;
				checker.data[o] = v; checker.data[o + 1] = Math.min(255, v + 20); checker.data[o + 2] = 255 - v;
			}
		}
		expect(lowFrequency(checker, resample(checker, RESIZED, RESIZED)).rms)
			.toBeGreaterThan(GATES.lowFrequencyRms);
	});
});

describe('the cap arithmetic (RM-004 B4)', () =>
{
	it('leaves anything already under the cap alone', () =>
	{
		expect(capped(512, 512)).toBeNull();
		expect(capped(CAP, CAP)).toBeNull();
		expect(capped(64, 1024)).toBeNull();
	});

	it('scales the long edge to the cap and preserves aspect', () =>
	{
		expect(capped(1822, 1822)).toEqual({width: CAP, height: CAP});
		expect(capped(2048, 1024)).toEqual({width: CAP, height: 512});
		expect(capped(1500, 2297)).toEqual({width: 669, height: CAP});
	});

	it('never rounds an axis away to nothing', () =>
	{
		// A 4000x1 texture is degenerate but legal, and Math.round would take
		// its short axis to zero without the floor in capped().
		expect(capped(40000, 1)).toEqual({width: CAP, height: 1});
	});
});
