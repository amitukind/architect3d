// @vitest-environment node
/**
 * The catalog split, and the dimensions it makes room for (RM-012 J1, X-3).
 *
 * `catalog.json` is still where a row is authored. What it is not, any more, is
 * what the application imports: `tools/split-catalog.mjs` divides it into an
 * index the bundle inlines and a detail that is a chunk nobody fetches until the
 * drawer opens. X-3 measured why - J1's metadata on the 600 rows J2 is written
 * for is 17,264 gzipped bytes of growth against 13,292 of `first-load` headroom.
 *
 * Two things are asserted here and neither is a snapshot. That the two generated
 * files are **derivable from the source and up to date**, which is what stops
 * them drifting the way `tsconfig.json`'s ledger drifted five times. And that
 * the boundary between them holds: nothing expensive in the index, nothing the
 * placement path needs in the detail.
 *
 * The dimensions are checked against **real furniture** rather than against
 * whatever the tool emitted when it was written. A double bed is 140 by 200, a
 * door is about a metre by about 2.2, and a stack of books is not three metres
 * wide - which is what the hack this measurement replaces makes it.
 *
 * ## And against architecture, because that is what the first attempt missed
 *
 * J1's first slice detected the unit from the model's own extent and got the
 * factor wrong for 141 of 168 rows. It shipped with a check exactly like the
 * paragraph above - a basin, a stack of books - and both of those are plausible
 * at either reading, so the check passed a catalog of half-size furniture.
 *
 * What discriminates is architecture, because architecture has standard sizes:
 * at the wrong scale this kit's floor tile is a metre square under a 1.29 m
 * ceiling. Those assertions are here now, and so is the cross-check that settles
 * it - two kits authored in different units by different people, agreeing on the
 * width of a door to one millimetre.
 */
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {split, validate, modelBounds, unitScale, sizeOf} from '../tools/split-catalog.mjs';

const ROOT = process.cwd();
const SOURCE = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const INDEX = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog-index.json'), 'utf8'));
const DETAIL = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog-detail.json'), 'utf8'));
const SOURCES = JSON.parse(readFileSync(join(ROOT, 'src/catalog/sources.json'), 'utf8'));

/** What a key costs, gzipped, across the whole index - the unit X-3 measured in. */
function gzipped(value)
{
	return gzipSync(Buffer.from(JSON.stringify(value)), {level: 9}).length;
}

function detailOf(name)
{
	const row = SOURCE.items.find((item) => item.name === name);
	return DETAIL.items[row.model];
}

describe('the two files are generated, and they are current', () =>
{
	it('regenerates byte-identically from the source', () =>
	{
		// The gate, and the reason it is a test rather than a convention: a row
		// added to catalog.json without running the tool would otherwise reach a
		// build that ships neither its thumbnail nor its size.
		execFileSync(process.execPath, ['tools/split-catalog.mjs', '--check'], {cwd: ROOT});
	});

	it('keeps every row, and loses no key', () =>
	{
		expect(INDEX.items).toHaveLength(SOURCE.items.length);
		SOURCE.items.forEach((item, at) =>
		{
			const indexed = INDEX.items[at];
			const detailed = DETAIL.items[item.model] || {};
			Object.keys(item).forEach((key) =>
			{
				const kept = (indexed[key] !== undefined) || (detailed[key] !== undefined);
				expect(kept, `${item.name} lost ${key}`).toBe(true);
			});
		});
	});

	it('says it is generated, in both files', () =>
	{
		expect(INDEX._comment).toMatch(/GENERATED/);
		expect(DETAIL._comment).toMatch(/GENERATED/);
	});
});

describe('the boundary between them', () =>
{
	it('keeps everything the placement path reads in the index', () =>
	{
		// `useCatalog.addItem` builds its metadata from these and nothing else, so
		// moving any of them would make adding an item wait for a chunk. `format`
		// is the interesting one: X-3 measured it at 40 gzipped bytes across all
		// 168 rows, because they are 168 identical strings.
		INDEX.items.forEach((row) =>
		{
			expect(row.name, 'name').toBeTypeOf('string');
			expect(row.image, 'image').toBeTypeOf('string');
			expect(row.model, 'model').toBeTypeOf('string');
			expect(row.type, 'type').toBeTypeOf('number');
		});
		const lamps = INDEX.items.filter((row) => row.lamp);
		expect(lamps, 'a lamp must light on the frame it is added').toHaveLength(8);
	});

	it('keeps the per-row dimensions out of the index', () =>
	{
		// The expensive key, and the one nobody reads until they are choosing.
		INDEX.items.forEach((row) =>
		{
			expect(row.size, `${row.name} carries a size in the index`).toBeUndefined();
		});
		expect(Object.keys(DETAIL.items).length).toBe(SOURCE.items.length);
	});

	it('costs less bundled than the unsplit file would', () =>
	{
		// Not a fixed number: what matters is the relationship, which is what X-3
		// projected forward to 600 rows. Today the split is a wash, because there
		// is nothing in the detail but the sizes it just measured - and those
		// sizes are 907 of the bytes that would otherwise be in the payload.
		const unsplit = gzipped(Object.assign({}, SOURCE, {
			items: SOURCE.items.map((item, at) => Object.assign({}, item, {size: Object.values(DETAIL.items)[at].size})),
		}));
		expect(gzipped(INDEX)).toBeLessThan(unsplit);
	});
});

describe('the dimensions are measured, and they are real', () =>
{
	it('measures every row', () =>
	{
		const missing = SOURCE.items.filter((item) => !DETAIL.items[item.model].size).map((item) => item.name);
		expect(missing, `unmeasured: ${missing.join(', ')}`).toEqual([]);
	});

	it('agrees with the real world on furniture anybody can check', () =>
	{
		// Centimetres, and each of these is a thing with a known size. A test that
		// pinned the tool's output would pass just as happily on a catalog of
		// three-metre chairs, which is what shipped before this.
		const near = (value, want, tolerance) => Math.abs(value - want) <= tolerance;

		const bed = detailOf('Full Bed').size;
		expect(near(bed.w, 140, 5) && near(bed.d, 200, 10), `bed ${bed.w}x${bed.d}`).toBe(true);

		const door = detailOf('Closed Door').size;
		expect(near(door.w, 97, 10) && near(door.h, 220, 15), `door ${door.w}x${door.h}`).toBe(true);

		const wardrobe = detailOf('Wardrobe - White').size;
		expect(near(wardrobe.h, 190, 15), `wardrobe ${wardrobe.h} tall`).toBe(true);

		const chair = detailOf('Church Chair - Oak').size;
		expect(near(chair.h, 79, 10), `church chair ${chair.h} tall`).toBe(true);

		const books = detailOf('Books').size;
		expect(books.w, 'a stack of books is not a metre wide').toBeLessThan(40);
	});

	it('and on the architecture, which is what the first attempt got wrong', () =>
	{
		// The two readings a basin cannot tell apart, a ceiling can. J1's first
		// slice put this kit at x100, which makes a room tile a metre square under
		// a 1.29 m ceiling - and the sanity check it shipped with was run on a
		// basin and a stack of books, both of which are plausible either way.
		const wall = detailOf('Wall').size;
		expect(wall.h, `a ceiling is not ${wall.h} cm`).toBeGreaterThan(220);
		expect(wall.h, `a ceiling is not ${wall.h} cm`).toBeLessThan(300);

		const tile = detailOf('Floorfull').size;
		expect(tile.w).toBe(tile.d);
		expect(tile.w, 'the kit is modular, so its floor tile is a round number').toBe(200);

		const chair = detailOf('Chair').size;
		expect(chair.h, `a dining chair is not ${chair.h} cm tall`).toBeGreaterThan(80);
		expect(chair.h).toBeLessThan(110);
	});

	it('and two kits, authored in different units, agree on the width of a door', () =>
	{
		// The cross-check that costs nothing and settles it. One kit is authored in
		// centimetres and states its size in its own filename - 28x80 inches of
		// door leaf - and the other is on a 2 m grid. Nothing connects them but the
		// building regulations both were drawn against.
		const kenney = detailOf('Doorwayopen').size;
		const demo = detailOf('Closed Door').size;
		expect(kenney.scale).toBe(200);
		expect(demo.scale).toBe(1);
		expect(Math.abs(kenney.w - demo.w), `${kenney.w} against ${demo.w}`).toBeLessThan(1);
	});

	it('nothing in the catalog is furniture-sized only by accident', () =>
	{
		// Every measured item lands in a range a room could contain. The upper
		// bound is deliberately generous - a sectional sofa is 217 cm - and the
		// point is to catch a unit that was resolved the wrong way, which would
		// put an item out by a factor of a hundred.
		Object.entries(DETAIL.items).forEach(([model, entry]) =>
		{
			const largest = Math.max(entry.size.w, entry.size.h, entry.size.d);
			// The band the tool itself refuses outside of, asserted here over the
			// tree it actually produced rather than over a hypothetical.
			expect(largest, `${model} largest extent ${largest} cm`).toBeGreaterThanOrEqual(5);
			expect(largest, `${model} largest extent ${largest} cm`).toBeLessThanOrEqual(600);
		});
	});
});

describe('the unit rule is declared, not detected', () =>
{
	it('takes the scale from the row when it has one, and from its kit otherwise', () =>
	{
		expect(unitScale({source: 'kenney-furniture-kit'}, SOURCES)).toBe(200);
		expect(unitScale({source: 'blueprint3d'}, SOURCES)).toBe(1);
		expect(unitScale({source: 'kenney-furniture-kit', unitScale: 1}, SOURCES)).toBe(1);
	});

	it('has no answer for a row whose kit declares none, which is the point', () =>
	{
		// `unattributed` states null deliberately: its two rows have nothing in
		// common but that nobody knows where they came from, and they are not at
		// the same scale. Null forces each to declare its own on the row.
		expect(unitScale({source: 'unattributed'}, SOURCES)).toBeNull();
		expect(unitScale({source: 'no-such-kit'}, SOURCES)).toBeNull();
	});

	it('refuses a size it will not stand behind rather than writing one', () =>
	{
		const bounds = {min: [0, 0, 0], max: [0.2, 0.47, 0.2]};
		expect(sizeOf(bounds, 200).size).toEqual({w: 40, h: 94, d: 40, scale: 200});

		// The same chair at the factor J1 shipped: 47 cm tall, which is a stool,
		// and outside nothing - which is exactly why an extent band alone could
		// never have caught it. What the band does catch is the gross error.
		expect(sizeOf(bounds, 100).size).toEqual({w: 20, h: 47, d: 20, scale: 100});
		expect(sizeOf(bounds, 1).refused).toMatch(/outside/);
		expect(sizeOf(bounds, 10000).refused).toMatch(/outside/);
		expect(sizeOf(bounds, null).refused).toMatch(/no unitScale/);
	});

	it('puts this catalog on three scales, and says which', () =>
	{
		const scales = Object.values(DETAIL.items).map((entry) => entry.size.scale);
		const count = (value) => scales.filter((scale) => scale === value).length;
		expect(count(1), 'centimetres: 25 demo models, a ceiling fan and a chandelier').toBe(27);
		expect(count(10), 'the duck, which has no real-world size at all').toBe(1);
		expect(count(200), 'the 2 m kit grid, and one cabinet that is on it').toBe(140);
		expect(scales).toHaveLength(168);
	});

	it('records the scale in the file, so the conversion can be undone by a reader', () =>
	{
		// Not a unit name. The quantity that matters is centimetres per authored
		// unit, and writing it down is what lets `Item.initObject` apply it instead
		// of guessing - which is the hack RM-009 U-3 assigned to this sprint.
		Object.entries(DETAIL.items).forEach(([model, entry]) =>
		{
			expect(entry.size.scale, model).toBeTypeOf('number');
			expect(entry.size.scale, model).toBeGreaterThan(0);
		});
	});
});

describe('what a row has to carry before either file is written', () =>
{
	const row = (extra) => Object.assign({
		name: 'A thing', image: 'a.png', model: 'models/a.glb', type: 1, format: 'gltf',
		room: 'living', tags: ['table'], source: 'blueprint3d',
	}, extra);

	it('passes the catalog that ships', () =>
	{
		expect(validate(SOURCE, SOURCES)).toEqual([]);
	});

	it('rejects a room nobody defined', () =>
	{
		expect(validate({items: [row({room: 'conservatory'})]}, SOURCES)).toHaveLength(1);
		expect(validate({items: [row({room: undefined})]}, SOURCES)[0]).toMatch(/room/);
	});

	it('rejects a tag nobody defined, and a row with none', () =>
	{
		expect(validate({items: [row({tags: ['comfy']})]}, SOURCES)[0]).toMatch(/tag/);
		expect(validate({items: [row({tags: []})]}, SOURCES)[0]).toMatch(/no tags/);
	});

	it('rejects a source that resolves to nothing', () =>
	{
		expect(validate({items: [row({source: 'somewhere'})]}, SOURCES)[0]).toMatch(/sources\.json/);
	});

	it('rejects two rows a person could not tell apart', () =>
	{
		// X-1 found two rows both called Chair by counting them. This is what stops
		// it coming back: a name is what the drawer shows and what a saved design
		// records.
		const problems = validate({items: [row({model: 'a.glb'}), row({model: 'b.glb'})]}, SOURCES);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/also used by/);
	});
});

describe('the bounding box walks the scene graph', () =>
{
	it('applies a node translation, so an offset mesh is not measured at the origin', () =>
	{
		const json = {
			scene: 0,
			scenes: [{nodes: [0]}],
			nodes: [{mesh: 0, translation: [10, 0, 0]}],
			meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
			accessors: [{min: [-1, -1, -1], max: [1, 1, 1]}],
		};
		expect(modelBounds(json)).toEqual({min: [9, -1, -1], max: [11, 1, 1]});
	});

	it('applies a node scale, and inherits it down to a child', () =>
	{
		const json = {
			scene: 0,
			scenes: [{nodes: [0]}],
			nodes: [{scale: [2, 2, 2], children: [1]}, {mesh: 0, translation: [1, 0, 0]}],
			meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
			accessors: [{min: [-1, -1, -1], max: [1, 1, 1]}],
		};
		// The child is translated by 1 in its parent's frame, and the parent
		// doubles everything: the box runs from 0 to 4 rather than from 1 to 3.
		expect(modelBounds(json)).toEqual({min: [0, -2, -2], max: [4, 2, 2]});
	});

	it('rotates all eight corners rather than the two extremes', () =>
	{
		// A quarter turn about Y. Transforming only min and max would give a box
		// that is inside out, which is the bug this is written against.
		const half = Math.SQRT1_2;
		const json = {
			scene: 0,
			scenes: [{nodes: [0]}],
			nodes: [{mesh: 0, rotation: [0, half, 0, half]}],
			meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
			accessors: [{min: [0, 0, 0], max: [2, 1, 4]}],
		};
		const bounds = modelBounds(json);
		expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(4, 6);
		expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(2, 6);
	});

	it('returns null for a model with no positions to measure', () =>
	{
		expect(modelBounds({nodes: [{}], scenes: [{nodes: [0]}], scene: 0})).toBeNull();
		expect(modelBounds(null)).toBeNull();
	});
});

describe('split() itself', () =>
{
	it('reports what it could not classify rather than guessing', () =>
	{
		const result = split({version: '1', itemTypes: {}, items: [
			{name: 'Nowhere', image: 'a.png', model: 'models/does-not-exist.glb', type: 1, format: 'gltf'},
		]}, SOURCES);
		expect(result.measured).toBe(0);
		expect(result.unmeasured).toEqual(['Nowhere']);
		expect(result.index.items[0].name).toBe('Nowhere');
	});
});
