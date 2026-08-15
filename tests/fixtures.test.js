/**
 * The frozen baseline fixtures must stay loadable, and must keep meaning what
 * they meant when S0 captured them.
 *
 * These files are the reference inputs for every later sprint's parity check
 * (roadmap docs/roadmap.html, section 07). Without a test they could rot
 * silently: a change to the load path, the room finder, or the unit handling
 * would only surface much later, in a sprint that would then be blamed for it.
 *
 * The counts below are deliberately concrete. If one changes, the model layer
 * changed - decide whether that was intended before touching this file.
 */
import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter, dimMeter} from '../src/scripts/core/units.js';
import {resetAll, roundDeep, normalizeIds} from './helpers/harness.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name)
{
	return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.blueprint3d`), 'utf8'));
}

/**
 * Fixtures are stored in centimetres (see tools/make-fixtures.mjs). Loading
 * them under any other display unit rescales every coordinate - that is the
 * unit landmine, exercised deliberately at the end of this file.
 */
function loadFixture(name)
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	const raw = readFixture(name);
	const floorplan = new Floorplan();
	floorplan.loadFloorplan(raw.floorplan);
	return {raw, floorplan};
}

describe('fixture files are well formed', () =>
{
	const names = ['simple-room', 'rich-design', 'curved-walls'];

	names.forEach((name) =>
	{
		it(`${name} parses as a {floorplan, items} design`, () =>
		{
			const raw = readFixture(name);
			expect(Object.keys(raw).sort()).toEqual(['floorplan', 'items']);
			expect(Array.isArray(raw.items)).toBe(true);
		});

		it(`${name} carries the current schema version and unit stamp`, () =>
		{
			expect(readFixture(name).floorplan.version).toBe('2.0.0');
			expect(readFixture(name).floorplan.units).toBe('cm');
		});

		it(`${name} declares every key saveFloorplan writes`, () =>
		{
			expect(Object.keys(readFixture(name).floorplan).sort()).toEqual([
				'carbonSheet', 'corners', 'floorTextures', 'newFloorTextures',
				'rooms', 'units', 'version', 'wallTextures', 'walls',
			]);
		});

		it(`${name} references only corners it defines`, () =>
		{
			const fp = readFixture(name).floorplan;
			const defined = new Set(Object.keys(fp.corners));
			fp.walls.forEach((wall) =>
			{
				expect(defined.has(wall.corner1)).toBe(true);
				expect(defined.has(wall.corner2)).toBe(true);
			});
		});
	});
});

describe('simple-room fixture', () =>
{
	it('loads as one 400x300 room', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('simple-room');
		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(4);
		expect(floorplan.getRooms().length).toBe(1);
		expect(Math.round(floorplan.getRooms()[0].area)).toBe(120000);
	});

	it('has only straight walls', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('simple-room');
		const types = floorplan.getWalls().map((w) => w.wallType.description);
		expect(new Set(types)).toEqual(new Set(['STRAIGHT']));
	});
});

describe('rich-design fixture', () =>
{
	it('loads as two rooms sharing a wall', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('rich-design');
		expect(floorplan.getCorners().length).toBe(6);
		expect(floorplan.getWalls().length).toBe(7);
		expect(floorplan.getRooms().length).toBe(2);
	});

	it('keeps both room areas', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('rich-design');
		const areas = floorplan.getRooms().map((r) => Math.round(r.area)).sort((a, b) => a - b);
		expect(areas).toEqual([160000, 200000]);
	});

	it('carries non-default wall textures on every wall', () =>
	{
		const fp = readFixture('rich-design').floorplan;
		fp.walls.forEach((wall) =>
		{
			expect(wall.frontTexture.url).toMatch(/^rooms\/textures\//);
			expect(wall.backTexture.url).toMatch(/^rooms\/textures\//);
		});
		// At least one wall must differ from the library default, or the fixture
		// would not actually exercise texture round-tripping.
		const urls = new Set(fp.walls.map((w) => w.frontTexture.url));
		expect(urls.size).toBeGreaterThan(1);
	});

	it('carries varied corner elevations', () =>
	{
		const corners = Object.values(readFixture('rich-design').floorplan.corners);
		const elevations = new Set(corners.map((c) => c.elevation));
		expect(elevations.size).toBeGreaterThan(1);
	});

	it('carries a populated carbon sheet block', () =>
	{
		const sheet = readFixture('rich-design').floorplan.carbonSheet;
		expect(sheet.url).toBe('rooms/textures/hardwood.png');
		expect(sheet.width).toBe(800);
		expect(sheet.height).toBe(600);
		expect(sheet.transparency).toBe(0.5);
	});

	it('loads without a 2D view attached, despite the carbon sheet', () =>
	{
		// Regression guard for the S0 headless seam: before it, this threw
		// because loadFloorplan dereferenced an undefined this.carbonSheet.
		resetAll();
		expect(() => loadFixture('rich-design')).not.toThrow();
		const {floorplan} = loadFixture('rich-design');
		// Floorplan initialises _carbonSheet to null; the 2D view assigns one later.
		expect(floorplan.carbonSheet).toBeNull();
	});

	it('carries floor textures keyed by room uuid', () =>
	{
		const textures = readFixture('rich-design').floorplan.newFloorTextures;
		expect(Object.keys(textures).length).toBe(2);
		Object.values(textures).forEach((t) =>
		{
			expect(t.url).toMatch(/^rooms\/textures\//);
			expect(typeof t.scale).toBe('number');
		});
	});
});

describe('curved-walls fixture', () =>
{
	it('loads as one room with two curved walls', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('curved-walls');
		expect(floorplan.getCorners().length).toBe(4);
		expect(floorplan.getWalls().length).toBe(4);
		expect(floorplan.getRooms().length).toBe(1);

		const curved = floorplan.getWalls().filter((w) => w.wallType.description === 'CURVED');
		expect(curved.length).toBe(2);
	});

	it('stores bezier control points for the curved walls', () =>
	{
		const fp = readFixture('curved-walls').floorplan;
		const curved = fp.walls.filter((w) => w.wallType === 'CURVED');
		expect(curved.length).toBe(2);
		curved.forEach((wall) =>
		{
			expect(typeof wall.a.x).toBe('number');
			expect(typeof wall.a.y).toBe('number');
			expect(typeof wall.b.x).toBe('number');
			expect(typeof wall.b.y).toBe('number');
		});
	});

	it('reports a curved room area that differs from the straight-walled rectangle', () =>
	{
		resetAll();
		const {floorplan} = loadFixture('curved-walls');
		// 600 x 450 would be 270000 if all four walls were straight; the two
		// curved walls bow inward, so the sampled area is smaller.
		expect(Math.round(floorplan.getRooms()[0].area)).toBe(144564);
	});

	it('contains no items, because wall-bound items crash on curved walls today', () =>
	{
		// half_edge.js:298 dereferences an undefined _bezier on the curved branch.
		// Keeping items out of this fixture is deliberate; see tools/make-fixtures.mjs.
		expect(readFixture('curved-walls').items).toEqual([]);
	});
});

describe('fixtures round-trip through the model layer', () =>
{
	['simple-room', 'rich-design', 'curved-walls'].forEach((name) =>
	{
		it(`${name} re-saves to an equivalent floorplan`, () =>
		{
			resetAll();
			const {floorplan} = loadFixture(name);
			const resaved = floorplan.saveFloorplan();

			const original = readFixture(name).floorplan;
			const a = roundDeep(normalizeIds(original), 3);
			const b = roundDeep(normalizeIds(resaved), 3);

			expect(b.version).toBe(a.version);
			expect(b.walls.length).toBe(a.walls.length);
			expect(Object.keys(b.corners).length).toBe(Object.keys(a.corners).length);
			expect(b.corners).toEqual(a.corners);
			expect(b.walls.map((w) => [w.corner1, w.corner2, w.wallType]))
				.toEqual(a.walls.map((w) => [w.corner1, w.corner2, w.wallType]));
		});
	});
});

describe('the fixtures are immune to the display unit now', () =>
{
	// This block used to be "the unit landmine applies to the fixtures too",
	// asserting that loading simple-room under metres inflated every coordinate
	// 100x. The fixtures carry a unit stamp as of format 2.0.0, so the display
	// unit no longer touches them. Their v1 selves are frozen under
	// tests/fixtures/v1/, where the old reading is still exercised.
	it('reads simple-room identically under every display unit', () =>
	{
		const raw = readFixture('simple-room');

		for (const unit of [dimCentiMeter, dimMeter])
		{
			resetAll();
			Configuration.setValue(configDimUnit, unit);
			const floorplan = new Floorplan();
			floorplan.loadFloorplan(raw.floorplan);
			const xs = floorplan.getCorners().map((c) => c.x).sort((p, q) => p - q);
			expect(Math.max(...xs), String(unit)).toBe(400);
		}
	});
});
