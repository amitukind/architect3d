/**
 * The material library, and what it is allowed to be (RM-011 H1).
 *
 * **M-27 extended** is the metric here: *every shipped material image passes
 * the 3.0 RMS oracle gate or ships uncompressed, and the count of measured
 * images equals the count of shipped ones.* The second half is the interesting
 * one, and it is why this file counts things rather than only sampling them - a
 * library where 58 of 60 images were gated is a library with two unmeasured
 * images in it, and no assertion about the other 58 would find them.
 *
 * Everything below reads the committed tree and the committed report. Nothing
 * here re-encodes anything: `npm run materials` needs the network and produced
 * these numbers once, and the property this suite defends is that the tree, the
 * report and the catalog still agree about what was produced.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createHash} from 'node:crypto';

import {CAP, GATES} from '../tools/resize-textures.mjs';
import {AssetManifest} from '../src/scripts/core/asset_manifest.js';
import {AssetResolver} from '../src/scripts/core/asset_resolver.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/material-library.json'), 'utf8'));
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/materials.json'), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(join(PUBLIC, 'asset-manifest.json'), 'utf8'));
const BUDGET = JSON.parse(readFileSync(join(ROOT, 'tools/budget.json'), 'utf8'));

/** Every catalog entry once, however many surfaces offer it. */
const ENTRIES = [...new Map([...CATALOG.wall, ...CATALOG.floor].map((entry) => [entry.url, entry])).values()];

/** Every image the library ships, thumbnails included. */
const FILES = REPORT.materials.flatMap((material) => material.files);

/** The 60 that reach a shader, which is what the gates are about. */
const SHADED = FILES.filter((file) => !file.name.includes('/thumbnails/'));

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

describe('the library is the size the trial allowed (RM-011 H1)', () =>
{
	it('ships thirty materials, two shaded maps each', () =>
	{
		// The number is the encode trial's, not this sprint's: 90 materials of
		// three maps was 44.8 MB against 78,894 bytes of headroom, and the trial
		// priced what one material really costs. A test on the count is a test
		// that somebody re-opened that arithmetic before changing it.
		expect(REPORT.materials).toHaveLength(30);
		expect(SHADED).toHaveLength(60);
		expect(REPORT.refused).toEqual([]);
	});

	it('measured every image it shipped', () =>
	{
		// M-27's extension, stated as an equality rather than as "the ones we
		// looked at were fine".
		expect(REPORT.totals.measuredImages).toBe(SHADED.length);
		for (const file of SHADED)
		{
			expect(file.codecRms, `${file.name} was shipped without a codec measurement`).toBeTypeOf('number');
			expect(file.lowFrequencyRms, `${file.name} was shipped without a resample measurement`).toBeTypeOf('number');
		}
	});

	it('passes the same two gates the rest of the tree passes', () =>
	{
		for (const file of SHADED)
		{
			expect(file.codecRms, `${file.name} codec`).toBeLessThan(GATES.codecRms);
			expect(file.lowFrequencyRms, `${file.name} resample`).toBeLessThan(GATES.lowFrequencyRms);
			expect(file.lowFrequencyMax, `${file.name} resample worst pixel`).toBeLessThanOrEqual(GATES.lowFrequencyMax);
		}
	});

	it('ships an albedo at 512 and a roughness map at 256', () =>
	{
		// Not one resolution for both. A roughness map at 256 measured MORE
		// faithful than an albedo at 512 in all six materials the tool sampled,
		// so the smaller map is not the weak link - see the tool's docblock.
		for (const material of REPORT.materials)
		{
			const [albedo, rough, thumb] = material.files;
			expect(albedo.width, `${material.slug} albedo`).toBe(512);
			expect(rough.width, `${material.slug} roughness`).toBe(256);
			expect(thumb.width, `${material.slug} thumbnail`).toBe(128);
			expect(albedo.width).toBeLessThanOrEqual(CAP);
		}
	});
});

describe('the tree, the report and the catalog agree', () =>
{
	it('has every file the report claims, at the byte and the hash', () =>
	{
		// The same check `npm run materials:check` runs, here as well as there so
		// that a tree edited by hand fails in the ordinary test run rather than
		// only in a command somebody has to remember.
		for (const file of FILES)
		{
			const path = join(PUBLIC, file.name);
			expect(existsSync(path), `${file.name} is missing`).toBe(true);
			expect(statSync(path).size, `${file.name} size`).toBe(file.bytes);
			expect(sha(readFileSync(path)), `${file.name} hash`).toBe(file.hash);
		}
	});

	it('offers every shipped material and nothing else', () =>
	{
		expect(ENTRIES).toHaveLength(REPORT.materials.length);
		const shipped = new Set(REPORT.materials.map((material) => `materials/${material.slug}/albedo.jpg`));
		for (const entry of ENTRIES)
		{
			expect(shipped.has(entry.url), `${entry.url} is offered but not shipped`).toBe(true);
		}
	});

	it('resolves every url it offers through the manifest', () =>
	{
		// A5's rule: what a document names and what the browser fetches are two
		// questions. A catalog url that the resolver cannot answer is a swatch
		// that paints nothing, and the failure is silent in a texture loader.
		const resolver = new AssetResolver(AssetManifest.parse(MANIFEST));
		for (const entry of ENTRIES)
		{
			for (const url of [entry.url, entry.roughnessMap, entry.thumbnail])
			{
				const resolved = resolver.resolve(url).url;
				expect(existsSync(join(PUBLIC, resolved)), `${url} resolves to ${resolved}, which is not there`).toBe(true);
			}
		}
	});

	it('tiles at the size the material actually is', () =>
	{
		// `scale` is centimetres per tile - `Edge.updateTexture` divides a wall's
		// width in centimetres by it - and it comes from each asset's published
		// real-world size. So the assertion is that these are plausible room-scale
		// numbers, which is a claim the demo's own catalog could not make: it
		// carries 50 and 100 for the same brick image and records no reason.
		for (const entry of ENTRIES)
		{
			expect(entry.scale, `${entry.name} scale`).toBeGreaterThanOrEqual(50);
			expect(entry.scale, `${entry.name} scale`).toBeLessThanOrEqual(500);
			expect(entry.stretch, `${entry.name} stretch`).toBe(false);
		}
	});

	it('credits every material, CC0 or not', () =>
	{
		// CC0 waives attribution. The credits file exists anyway, and this asserts
		// it stays complete rather than becoming a list of whoever was in it when
		// somebody last thought about it.
		const credits = readFileSync(join(PUBLIC, 'materials/CREDITS.md'), 'utf8');
		expect(CATALOG.license.name).toMatch(/^CC0/);
		for (const material of REPORT.materials)
		{
			expect(material.authors.length, `${material.slug} has no author`).toBeGreaterThan(0);
			expect(credits, `${material.slug} is not credited`).toContain(material.slug);
		}
	});
});

describe('the library costs what the budget says (W-4, W-5)', () =>
{
	it('weighs what public-total was raised for', () =>
	{
		const shipped = FILES.reduce((sum, file) => sum + file.bytes, 0);
		expect(shipped).toBe(REPORT.totals.bytes);
		// The whole tree has to be inside the limit that was raised for it, which
		// is the arithmetic the raise's own note in tools/budget.json states.
		expect(BUDGET.budgets['public-total'].measured).toBeLessThan(BUDGET.budgets['public-total'].limit);
		expect(shipped).toBeLessThan(BUDGET.budgets['public-total'].measured);
	});

	it('is a fraction of its own sources', () =>
	{
		// 28.5 MB of 1K JPEG in, 4.5 MB out. Recorded because it is the number
		// that says the resize is doing the work rather than the codec.
		expect(REPORT.totals.sourceBytes).toBeGreaterThan(REPORT.totals.bytes * 5);
	});
});
