// @vitest-environment node
/**
 * Every thumbnail was rendered by the tool, and the tree still matches (J1).
 *
 * ## The cheap half
 *
 * Re-rendering 168 models in a headless browser takes minutes, so
 * `npm run thumbnails -- --check` is a command somebody runs and not something
 * this suite does - the same division `tests/asset-integrity.test.js` makes with
 * the transcode oracle. What is asserted here is everything that can be checked
 * without a GPU: that each row has a thumbnail, that the file on disk is the one
 * the tool recorded, and that the properties the tool exists to guarantee
 * actually hold across all 168.
 *
 * ## What the tool exists to guarantee
 *
 * RM-012 X-8 measured that all 168 collected thumbnails were already 300 x 225,
 * so this is not about size. It is about framing - a collected thumbnail is
 * whatever the person who collected it happened to crop - and about format: 21
 * of the 168 were JPEG and therefore could not carry the transparency the other
 * 147 have and the drawer's theming needs. Two of those 21 were `.JPG`,
 * uppercase, which is a 404 waiting for a case-sensitive host.
 *
 * `coverage` in the report is the fraction of the frame that is not transparent.
 * It is how framing is checked over 168 pictures without looking at 168
 * pictures: a render that failed silently is near zero, and one framed too
 * tightly touches an edge, which `clipped` records.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {WIDTH, HEIGHT, SUPERSAMPLE, CAMERA, thumbnailFor} from '../tools/render-thumbnails.mjs';

const ROOT = process.cwd();
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/thumbnails.json'), 'utf8'));

/** Width, height and colour type, read out of a PNG's IHDR rather than trusted. */
function header(bytes)
{
	expect(bytes.subarray(0, 8).toString('binary'))
		.toBe('\x89PNG\r\n\x1a\n');
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
		colourType: bytes[25],
	};
}

describe('the catalog thumbnails are rendered, not collected (RM-012 J1, X-8)', () =>
{
	it('has one for every row, and the row points at it', () =>
	{
		expect(REPORT.thumbnails).toHaveLength(CATALOG.items.length);
		const byImage = new Map(REPORT.thumbnails.map((row) => [row.image, row]));

		CATALOG.items.forEach((item) =>
		{
			expect(item.image, item.name).toBe(thumbnailFor(item.model));
			expect(byImage.has(item.image), `${item.name} has no rendered thumbnail`).toBe(true);
			expect(byImage.get(item.image).model, item.name).toBe(item.model);
		});
	});

	it('is 300 x 225 RGBA PNG, all 168 of them', () =>
	{
		// The size is unchanged from the collected set, which X-8 measured. What is
		// new is that every one of them can carry alpha: the drawer paints tiles on
		// a surface that changes with the theme, and a baked-in background is a
		// light-theme background sitting in a dark-theme panel.
		REPORT.thumbnails.forEach((row) =>
		{
			const path = join(ROOT, 'public', row.image);
			expect(existsSync(path), row.image).toBe(true);
			expect(header(readFileSync(path)), row.image)
				.toEqual({width: WIDTH, height: HEIGHT, colourType: 6});
		});
	});

	it('nothing in the catalog is a JPEG any more', () =>
	{
		// 19 `.jpg` and 2 `.JPG` before this. The uppercase pair is the reason to
		// care beyond tidiness - a case-sensitive host serves one of those and 404s
		// the other depending on which spelling a reference used.
		const extensions = new Set(CATALOG.items.map((item) => item.image.slice(item.image.lastIndexOf('.'))));
		expect([...extensions]).toEqual(['.png']);
	});

	it('is the file the tool recorded, byte for byte', () =>
	{
		// The gate that makes the report meaningful. Without it the numbers below
		// describe whatever the tool produced once, and the tree could have moved
		// underneath them.
		REPORT.thumbnails.forEach((row) =>
		{
			const bytes = readFileSync(join(ROOT, 'public', row.image));
			expect(bytes.length, row.image).toBe(row.bytes);
			expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16), row.image).toBe(row.sha256);
		});
	});

	it('framed every model, and framed none of them off the edge', () =>
	{
		// A render that silently produced nothing is near-zero coverage; one framed
		// too tightly touches the border. Both are caught by arithmetic rather than
		// by somebody looking at 168 pictures - which is the only way a check like
		// this survives J2 growing the catalog several times over.
		const empty = REPORT.thumbnails.filter((row) => row.coverage < 0.02);
		expect(empty.map((row) => row.name), 'rendered to nothing').toEqual([]);

		const clipped = REPORT.thumbnails.filter((row) => row.clipped);
		expect(clipped.map((row) => row.name), 'touches the frame').toEqual([]);
	});

	it('used one camera for all of them, which is the whole point', () =>
	{
		expect(REPORT.camera).toEqual(CAMERA);
		expect(REPORT.size).toEqual({width: WIDTH, height: HEIGHT, supersample: SUPERSAMPLE});
	});
});
