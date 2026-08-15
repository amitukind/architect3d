/**
 * Files written before format 2.0.0 must keep opening, and keep meaning what
 * they meant.
 *
 * 2.0.0 changed how coordinates are stored - canonical centimetres, with a
 * `units` stamp saying so - which means the loader now has two paths. The
 * stamped one is trivial and is covered in serialization.test.js. This file
 * covers the other: what happens to the designs people already have.
 *
 * The corpus is tests/fixtures/v1/, and it is frozen. tools/make-fixtures.mjs
 * cannot reproduce it, because that writes through the current saveFloorplan;
 * the files were captured from the old writer at the commit before the change,
 * and being unreproducible is what makes them worth testing against. See the
 * README beside them.
 *
 * The uncomfortable half is `metres-room`. Reading it correctly requires
 * knowing it was written under metres, and the file does not say. There is no
 * version of this loader that can get it right without being told, which is the
 * whole argument for the stamp. What the tests below pin is that the old
 * reading rule is applied unchanged - right unit in, right plan out - so
 * nobody's file changed meaning when the format moved.
 */
import {describe, it, expect, beforeEach, afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter, dimMeter} from '../src/scripts/core/units.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {resetAll, resetConfiguration, unseedRandom} from './helpers/harness.js';

const V1_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'v1');

function readV1(name)
{
	return JSON.parse(readFileSync(join(V1_DIR, `${name}.blueprint3d`), 'utf8'));
}

function loadV1(name, unit)
{
	Configuration.setValue(configDimUnit, unit);
	const floorplan = new Floorplan();
	floorplan.loadFloorplan(readV1(name).floorplan);
	Configuration.setValue(configDimUnit, dimCentiMeter);
	return floorplan;
}

function extent(floorplan)
{
	const xs = floorplan.getCorners().map((corner) => corner.x);
	const ys = floorplan.getCorners().map((corner) => corner.y);
	return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

beforeEach(() =>
{
	resetAll();
});

afterAll(() =>
{
	unseedRandom();
	resetConfiguration();
});

describe('the corpus really is v1', () =>
{
	const NAMES = ['simple-room', 'rich-design', 'curved-walls', 'metres-room'];

	NAMES.forEach((name) =>
	{
		it(`${name} carries the old version and no unit stamp`, () =>
		{
			// If either of these ever fails, someone regenerated the corpus and
			// the compatibility path below is no longer being tested at all - the
			// tests would keep passing while proving nothing.
			const floorplan = readV1(name).floorplan;
			expect(floorplan.version).toBe('0.0.2a');
			expect(floorplan.units).toBeUndefined();
		});
	});
});

describe('a v1 file saved in centimetres', () =>
{
	it('loads to the same plan it always did', () =>
	{
		const floorplan = loadV1('simple-room', dimCentiMeter);
		expect(extent(floorplan)).toEqual([400, 300]);
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	it('keeps its textures, elevations and carbon sheet', () =>
	{
		const raw = readV1('rich-design').floorplan;
		const floorplan = loadV1('rich-design', dimCentiMeter);

		expect(floorplan.getRooms()).toHaveLength(2);
		expect(extent(floorplan)).toEqual([900, 400]);
		expect(floorplan.getWalls()[0].frontTexture.url).toBe('rooms/textures/marbletiles.jpg');
		expect(floorplan.getCorners().map((corner) => corner.elevation)).toContain(260);
		expect(raw.carbonSheet.url).toBe('rooms/textures/hardwood.png');
	});

	it('keeps its curved walls and their control points', () =>
	{
		// The control-point path is the one the old version gate used to guard,
		// so a v1 curved file is exactly the case a mistake there would break.
		const raw = readV1('curved-walls').floorplan;
		const floorplan = loadV1('curved-walls', dimCentiMeter);
		const curved = floorplan.getWalls().filter((wall) => wall.wallType === WallTypes.CURVED);

		expect(curved).toHaveLength(2);
		curved.forEach((wall, i) =>
		{
			const source = raw.walls.filter((entry) => entry.wallType === 'CURVED')[i];
			expect(wall.a.x).toBeCloseTo(source.a.x, 6);
			expect(wall.a.y).toBeCloseTo(source.a.y, 6);
			expect(wall.b.x).toBeCloseTo(source.b.x, 6);
			expect(wall.b.y).toBeCloseTo(source.b.y, 6);
		});
	});

	it('is still read through the display unit, so the wrong one still rescales it', () =>
	{
		// Unchanged behaviour, deliberately. The file does not say what unit it is
		// in; guessing "the current one" is the only rule available and it is the
		// rule these files were written under.
		const floorplan = loadV1('simple-room', dimMeter);
		expect(extent(floorplan)).toEqual([40000, 30000]);
	});
});

describe('a v1 file saved in metres', () =>
{
	it('is stored in metres, with nothing in the file saying so', () =>
	{
		// 500x400 centimetres, on disk as 5x4. This is the landmine, frozen.
		const floorplan = readV1('metres-room').floorplan;
		const corners = Object.values(floorplan.corners);
		expect(corners.map((corner) => [corner.x, corner.y]))
			.toEqual([[0, 0], [5, 0], [5, 4], [0, 4]]);
		expect(corners[0].elevation).toBe(2.6);
		expect(floorplan.units).toBeUndefined();
	});

	it('loads correctly under the unit it was written in', () =>
	{
		const floorplan = loadV1('metres-room', dimMeter);
		expect(extent(floorplan)).toEqual([500, 400]);
		expect(floorplan.getCorners()[0].elevation).toBe(260);
		expect(floorplan.getRooms()).toHaveLength(1);
	});

	it('collapses under centimetres, and no loader can prevent it', () =>
	{
		// 5x4 is inside cornerTolerance (20 cm), so newCorner merges all four into
		// the first and the plan becomes a single point with four degenerate
		// walls. The information needed to avoid this is not in the file, which is
		// the entire reason 2.0.0 stamps the unit.
		const floorplan = loadV1('metres-room', dimCentiMeter);
		expect(floorplan.getCorners()).toHaveLength(1);
		expect(floorplan.getWalls()).toHaveLength(4);
		expect(floorplan.getRooms()).toHaveLength(0);
	});
});

describe('re-saving a v1 file upgrades it', () =>
{
	it('writes 2.0.0 with the unit stamp, in centimetres', () =>
	{
		// The migration path, and there is no separate migration step: open an old
		// file under the unit it was written in, save it, and it is a 2.0.0 file.
		const floorplan = loadV1('metres-room', dimMeter);
		const upgraded = floorplan.saveFloorplan();

		expect(upgraded.version).toBe('2.0.0');
		expect(upgraded.units).toBe('cm');
		expect(Object.values(upgraded.corners).map((corner) => [corner.x, corner.y]))
			.toEqual([[0, 0], [500, 0], [500, 400], [0, 400]]);
	});

	it('makes the upgraded file immune to the display unit', () =>
	{
		const upgraded = JSON.parse(JSON.stringify(loadV1('metres-room', dimMeter).saveFloorplan()));

		for (const unit of [dimCentiMeter, dimMeter])
		{
			Configuration.setValue(configDimUnit, unit);
			const reloaded = new Floorplan();
			reloaded.loadFloorplan(upgraded);
			expect(extent(reloaded), String(unit)).toEqual([500, 400]);
		}
		Configuration.setValue(configDimUnit, dimCentiMeter);
	});
});

describe('an unknown unit stamp', () =>
{
	it('warns once and reads the coordinates as centimetres', () =>
	{
		// A file from a build that does not exist yet, or a hand-edited one.
		// Opening it at the wrong scale beats refusing to open it at all - the
		// user can see a wrong scale.
		const file = readV1('simple-room').floorplan;
		file.units = 'furlongs';

		const warnings = [];
		const original = console.warn;
		console.warn = (message) => warnings.push(message);
		try
		{
			const floorplan = new Floorplan();
			floorplan.loadFloorplan(file);
			expect(extent(floorplan)).toEqual([400, 300]);
		}
		finally
		{
			console.warn = original;
		}

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/furlongs/);
	});
});
