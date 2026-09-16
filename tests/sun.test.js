// @vitest-environment jsdom
/**
 * A sun that knows what time it is (RM-011 H2).
 *
 * The description and its arithmetic, which is where almost all of this sprint's
 * behaviour lives: `three/lights.js` only turns a direction into a position, and
 * the part of H2 that needs a GPU - a penumbra that moves - is asserted in
 * `tests/browser/sun.test.js`.
 *
 * The values below are checked against closed forms rather than against
 * whatever the implementation returned when it was written. Solar noon elevation
 * is `90 - |latitude - declination|` and declination is zero at the equinox and
 * ±23.44 at the solstices, so every figure here can be derived on paper. A test
 * that pinned the output would pass just as happily on a sun that rose in the
 * west.
 */
import {beforeEach, describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {
	SUN_DEFAULTS, normaliseSun, sunToJSON, solarPosition, sunDirection,
} from '../src/scripts/model/sun.js';
import {Model} from '../src/scripts/model/model.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

beforeEach(() =>
{
	resetAll();
	// The three-storey fixture holds a parametric stair, and `Item`'s constructor
	// paints a placeholder texture on a 2D canvas jsdom does not provide.
	installCanvas2D(window);
});

describe('the description', () =>
{
	it('is total: a record that says nothing is the default sun', () =>
	{
		expect(normaliseSun()).toEqual({...SUN_DEFAULTS});
		expect(normaliseSun({})).toEqual({...SUN_DEFAULTS});
		expect(normaliseSun({latitude: 'noon'})).toEqual({...SUN_DEFAULTS});
	});

	it('clamps what physics refuses and wraps what it does not', () =>
	{
		// A latitude past the pole is not a place; an hour past midnight is.
		expect(normaliseSun({latitude: 200}).latitude).toBe(90);
		expect(normaliseSun({latitude: -200}).latitude).toBe(-90);
		expect(normaliseSun({dayOfYear: 900}).dayOfYear).toBe(365);
		expect(normaliseSun({dayOfYear: 0}).dayOfYear).toBe(1);
		expect(normaliseSun({hour: 26}).hour).toBe(2);
		expect(normaliseSun({hour: -1}).hour).toBe(23);
	});

	it('writes only what differs, and writes `{}` for a default sun', () =>
	{
		// Unlike every other conditional record in this project, the empty object
		// is the point: `Model.sun` being non-null is what "there is a sun" means,
		// so `{}` says "a sun, at the defaults" and is not the same as no key.
		expect(sunToJSON()).toEqual({});
		expect(sunToJSON({hour: 9})).toEqual({hour: 9});
		expect(sunToJSON({hour: 12, latitude: 45, dayOfYear: 81})).toEqual({});
		expect(sunToJSON({latitude: -33.9, dayOfYear: 355, hour: 16.5}))
			.toEqual({latitude: -33.9, dayOfYear: 355, hour: 16.5});
	});
});

describe('where the sun is', () =>
{
	it('puts the default sun at exactly 45 degrees, due south', () =>
	{
		// The defaults were chosen so this is checkable in the head: day 81 is
		// where the declination term crosses zero, and 90 - |45 - 0| is 45.
		const noon = solarPosition();
		expect(noon.elevation).toBeCloseTo(45, 6);
		expect(noon.azimuth).toBeCloseTo(180, 6);
		expect(noon.up).toBe(true);
	});

	it('reaches the solstice elevations the tilt of the Earth implies', () =>
	{
		// 90 - |45 - 23.44| and 90 - |45 + 23.44|. The solstices are days 172 and
		// 355 as this model reckons them.
		expect(solarPosition({dayOfYear: 172}).elevation).toBeCloseTo(68.44, 1);
		expect(solarPosition({dayOfYear: 355}).elevation).toBeCloseTo(21.56, 1);
	});

	it('is symmetric about noon, and east before it', () =>
	{
		const morning = solarPosition({hour: 9});
		const afternoon = solarPosition({hour: 15});
		expect(morning.elevation).toBeCloseTo(afternoon.elevation, 6);
		// Azimuth is clockwise from north, so morning is east of south and
		// afternoon is west of it, by the same angle.
		expect(morning.azimuth).toBeLessThan(180);
		expect(afternoon.azimuth).toBeGreaterThan(180);
		expect(360 - afternoon.azimuth).toBeCloseTo(morning.azimuth, 6);
	});

	it('goes below the horizon at night and says so', () =>
	{
		const midnight = solarPosition({hour: 0});
		expect(midnight.up).toBe(false);
		expect(midnight.elevation).toBeLessThan(0);
	});

	it('puts the southern hemisphere\'s sun in the north', () =>
	{
		// The check that the azimuth is a real bearing rather than a fudge that
		// happens to work above the equator.
		expect(solarPosition({latitude: -34, dayOfYear: 355}).azimuth).toBeCloseTo(0, 4);
		expect(solarPosition({latitude: -34, dayOfYear: 355}).elevation).toBeGreaterThan(0);
	});
});

describe('which way that is, in the world the 3D view draws', () =>
{
	it('points at -z for a bearing of zero, because up on the sheet is -z', () =>
	{
		// The one conversion in this file, and the one worth pinning: north is
		// clockwise from up on the sheet, plan y maps onto world z, so north is
		// world -z. A sun due south at noon is therefore at +z.
		const noon = sunDirection({}, 0);
		expect(noon.x).toBeCloseTo(0, 6);
		expect(noon.z).toBeGreaterThan(0);
		expect(noon.y).toBeCloseTo(Math.sin(45 * Math.PI / 180), 6);
	});

	it('turns with the building, not with the plan', () =>
	{
		// Rotating the building 90 degrees puts the noon sun to the west in world
		// terms - the house turned, the sun did not.
		const turned = sunDirection({}, 90);
		expect(turned.x).toBeCloseTo(-Math.cos(45 * Math.PI / 180), 6);
		expect(turned.z).toBeCloseTo(0, 6);
	});

	it('is a unit vector at every hour of the day', () =>
	{
		for (let hour = 0; hour < 24; hour += 0.5)
		{
			const direction = sunDirection({hour}, 37);
			const length = Math.hypot(direction.x, direction.y, direction.z);
			expect(length, `hour ${hour}`).toBeCloseTo(1, 9);
		}
	});
});

describe('a building has a sun, and one north (W-10)', () =>
{
	it('has none by default, and writes no key for one', () =>
	{
		const model = new Model('models/');
		expect(model.sun).toBeNull();
		expect(JSON.parse(model.exportSerialized()).sun).toBeUndefined();
	});

	it('round-trips a sun through a save and a load', () =>
	{
		const model = new Model('models/');
		model.setSun({hour: 8.5, latitude: 55});
		const saved = JSON.parse(model.exportSerialized());
		expect(saved.sun).toEqual({latitude: 55, hour: 8.5});

		const reopened = new Model('models/');
		reopened.loadSerialized(JSON.stringify(saved));
		expect(reopened.sun).toEqual({latitude: 55, dayOfYear: 81, hour: 8.5});
	});

	it('writes `sun: {}` for a default sun, because the key is the switch', () =>
	{
		const model = new Model('models/');
		model.setSun({});
		expect(JSON.parse(model.exportSerialized()).sun).toEqual({});

		const reopened = new Model('models/');
		reopened.loadSerialized(model.exportSerialized());
		expect(reopened.sun).toEqual({...SUN_DEFAULTS});
	});

	it('takes the sun away again', () =>
	{
		const model = new Model('models/');
		model.setSun({hour: 6});
		model.setSun(null);
		expect(model.sun).toBeNull();
		expect(JSON.parse(model.exportSerialized()).sun).toBeUndefined();
	});

	it('gives every storey the same north, so the sun has one answer', () =>
	{
		// W-10's defect: since G1 a design is a list of plans and each carried its
		// own bearing. The building's north is the ground floor's, and writing it
		// writes all of them - so the question of disagreement cannot arise.
		const model = new Model('models/');
		model.addLevel();
		model.addLevel();
		expect(model.levels.length).toBe(3);

		model.north = 37;
		expect(model.north).toBe(37);
		model.levels.forEach((level, index) =>
		{
			expect(level.floorplan.north, `level ${index}`).toBe(37);
		});
	});

	it('normalises the bearing the way the plan always did', () =>
	{
		const model = new Model('models/');
		model.north = 450;
		expect(model.north).toBe(90);
	});
});

describe('what a file may say about the sun', () =>
{
	const withSun = (sun) => JSON.stringify({
		floorplan: {version: '2.0.0', units: 'cm', corners: {}, walls: [], rooms: {}},
		items: [], sun,
	});

	it('accepts a sun with nothing in it', () =>
	{
		expect(DesignDocument.parse(withSun({})).ok).toBe(true);
	});

	it('refuses a latitude, a day or an hour that cannot exist', () =>
	{
		// The distinction this layer draws: `normaliseSun` clamps a live edit,
		// because a slider cannot produce a bad value on purpose. A *file* that
		// carries one is saying something it cannot mean, and that is refused
		// rather than quietly rounded.
		for (const [field, value] of [['latitude', 200], ['dayOfYear', 400], ['hour', 30]])
		{
			const result = DesignDocument.parse(withSun({[field]: value}));
			expect(result.ok, `${field}: ${value}`).toBe(false);
			expect(result.errors.some((error) => error.path === `sun.${field}`)).toBe(true);
		}
	});

	it('refuses a sun that is not an object', () =>
	{
		// Refused rather than ignored. `DesignDocument` reads a non-object `sun` as
		// null and would go on to open the file happily; saying so is what makes
		// the difference between "this design has no sun" and "this file is
		// damaged" visible to whoever has to fix it.
		for (const value of ['noon', 42, [1, 2]])
		{
			expect(DesignDocument.parse(withSun(value)).ok, JSON.stringify(value)).toBe(false);
		}
	});
});

describe('M-26 still holds: no sun, no key', () =>
{
	it('re-saves every fixture with no sun key anywhere', () =>
	{
		// The byte-identity rule this project has followed since E2. A design
		// nobody has given a sun writes exactly what it wrote before H2.
		const fixtures = readdirSync(FIXTURES).filter((name) => name.endsWith('.blueprint3d'));
		expect(fixtures.length).toBeGreaterThan(3);
		for (const name of fixtures)
		{
			const model = new Model('models/');
			model.loadSerialized(readFileSync(join(FIXTURES, name), 'utf8'));
			expect(model.sun, name).toBeNull();
			expect(JSON.parse(model.exportSerialized()).sun, name).toBeUndefined();
		}
	});
});
