/**
 * Characterization tests for the unit / configuration / utility layer.
 *
 * Targets: src/scripts/core/dimensioning.js, configuration.js, units.js,
 * version.js, utils.js.
 *
 * These tests describe what the code DOES today. Several assertions below pin
 * behaviour that is plainly wrong (wrong arity, wrong axis, inverted
 * comparisons, drifting conversion constants). Every one of those is marked
 * PRESERVED QUIRK with an explanation. Do not "fix" the expectation during the
 * Vue3/Vite/three-0.185 migration - if one of these fails, the migration
 * changed observable behaviour and that is the thing to re-check.
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest';

import {Dimensioning, decimals, cmPerFoot, pixelsPerFoot, cmPerPixel, pixelsPerCm,
	dimInch as dimInchViaDimensioning,
	dimFeetAndInch as dimFeetAndInchViaDimensioning,
	dimMeter as dimMeterViaDimensioning,
	dimCentiMeter as dimCentiMeterViaDimensioning,
	dimMilliMeter as dimMilliMeterViaDimensioning,
	dimensioningOptions as dimensioningOptionsViaDimensioning} from '../src/scripts/core/dimensioning.js';
import {dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter,
	dimensioningOptions} from '../src/scripts/core/units.js';
import {Configuration, config, configDimUnit, configWallHeight, configWallThickness,
	configSystemUI, scale, gridSpacing, snapToGrid, snapTolerance,
	cornerTolerance, wallInformation} from '../src/scripts/core/configuration.js';
import {EVENT_CONFIG_CHANGED} from '../src/scripts/core/events.js';
import {Version} from '../src/scripts/core/version.js';
import {Utils} from '../src/scripts/core/utils.js';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Vector2} from 'three';

import {seedRandom, unseedRandom, resetConfiguration} from './helpers/harness.js';

/**
 * Captured at module-evaluation time, BEFORE any beforeEach runs, so it is the
 * value configuration.js baked in when it read dimCentiMeter from units.js.
 * This is the canary for the configuration.js <-> dimensioning.js cycle fix.
 */
const pristineConfigDimUnit = config.dimUnit;

/** Local helper: a plain {x, y} point, since most Utils methods are duck-typed. */
function pt(x, y)
{
	return {x: x, y: y};
}

/** Local helper: a Vector2, for the Utils methods that are given real vectors. */
function v2(x, y)
{
	return new Vector2(x, y);
}

beforeEach(() =>
{
	resetConfiguration();
	seedRandom(1);
});

afterEach(() =>
{
	unseedRandom();
});


describe('dimensioning.js module constants', () =>
{
	it('exposes decimals = 1000, which is what truncates every conversion to 3 places', () =>
	{
		expect(decimals).toBe(1000);
	});

	it('exposes cmPerFoot = 30.48 and pixelsPerFoot = 15', () =>
	{
		expect(cmPerFoot).toBe(30.48);
		expect(pixelsPerFoot).toBe(15.0);
	});

	it('derives cmPerPixel = 30.48 / 15 = 2.032 exactly (no float drift)', () =>
	{
		expect(cmPerPixel).toBe(2.032);
		expect(cmPerFoot * (1.0 / pixelsPerFoot)).toBe(2.032);
	});

	it('derives pixelsPerCm as the exact reciprocal 1 / 2.032', () =>
	{
		expect(pixelsPerCm).toBe(0.4921259842519685);
		expect(pixelsPerCm).toBe(1.0 / 2.032);
	});
});


describe('units.js re-export integrity (guards the ESM cycle fix)', () =>
{
	it('re-exports the five unit names from dimensioning.js with identical values', () =>
	{
		expect(dimInchViaDimensioning).toBe(dimInch);
		expect(dimFeetAndInchViaDimensioning).toBe(dimFeetAndInch);
		expect(dimMeterViaDimensioning).toBe(dimMeter);
		expect(dimCentiMeterViaDimensioning).toBe(dimCentiMeter);
		expect(dimMilliMeterViaDimensioning).toBe(dimMilliMeter);
	});

	it('re-exports the SAME dimensioningOptions array object, not a copy', () =>
	{
		// Reference identity is the real proof that dimensioning.js re-exports
		// rather than redeclares; string constants alone would compare equal
		// even if the modules had drifted apart.
		expect(dimensioningOptionsViaDimensioning).toBe(dimensioningOptions);
	});

	it('pins the unit name literals that get written into saved floorplans', () =>
	{
		expect(dimInch).toBe('inch');
		expect(dimFeetAndInch).toBe('feetAndInch');
		expect(dimMeter).toBe('m');
		expect(dimCentiMeter).toBe('cm');
		expect(dimMilliMeter).toBe('mm');
		expect(dimensioningOptions).toEqual(['inch', 'feetAndInch', 'm', 'cm', 'mm']);
	});

	it('configuration.js resolved dimCentiMeter at module-eval time (cycle is not back)', () =>
	{
		// Before units.js existed this read `undefined` under native ESM, or blew
		// up with "Cannot access 'dimCentiMeter' before initialization".
		expect(pristineConfigDimUnit).toBe('cm');
		expect(pristineConfigDimUnit).toBe(dimCentiMeter);
	});
});


describe('Dimensioning.cmToPixel / pixelToCm', () =>
{
	it('converts cm to pixels through pixelsPerCm at scale 1', () =>
	{
		Configuration.setValue(scale, 1);
		expect(Dimensioning.cmToPixel(100)).toBe(49.21259842519685);
	});

	it('maps one foot (30.48 cm) to exactly 15 pixels at scale 1', () =>
	{
		Configuration.setValue(scale, 1);
		expect(Dimensioning.cmToPixel(30.48)).toBe(15);
	});

	it('maps 2.032 cm to exactly 1 pixel at scale 1', () =>
	{
		Configuration.setValue(scale, 1);
		expect(Dimensioning.cmToPixel(2.032)).toBe(1);
	});

	it('multiplies cmToPixel by the configured scale', () =>
	{
		Configuration.setValue(scale, 2);
		expect(Dimensioning.cmToPixel(100)).toBe(98.4251968503937);
		expect(Dimensioning.cmToPixel(2.032)).toBe(2);
	});

	it('ignores scale when apply_scale is false', () =>
	{
		Configuration.setValue(scale, 2);
		expect(Dimensioning.cmToPixel(100, false)).toBe(49.21259842519685);
	});

	it('converts pixels back to cm through cmPerPixel at scale 1', () =>
	{
		Configuration.setValue(scale, 1);
		expect(Dimensioning.pixelToCm(100)).toBe(203.2);
		expect(Dimensioning.pixelToCm(15)).toBe(30.48);
	});

	it('divides pixelToCm by the configured scale', () =>
	{
		Configuration.setValue(scale, 2);
		expect(Dimensioning.pixelToCm(100)).toBe(101.6);
	});

	it('ignores scale in pixelToCm when apply_scale is false', () =>
	{
		Configuration.setValue(scale, 2);
		expect(Dimensioning.pixelToCm(100, false)).toBe(203.2);
	});

	it('round-trips cm -> pixel -> cm at scale 1 and scale 2', () =>
	{
		Configuration.setValue(scale, 1);
		expect(Dimensioning.pixelToCm(Dimensioning.cmToPixel(400))).toBe(400);
		Configuration.setValue(scale, 2);
		expect(Dimensioning.pixelToCm(Dimensioning.cmToPixel(400))).toBe(400);
	});

	it('is unaffected by the dimensioning unit - pixels are always cm-based', () =>
	{
		Configuration.setValue(configDimUnit, dimFeetAndInch);
		expect(Dimensioning.cmToPixel(30.48)).toBe(15);
		Configuration.setValue(configDimUnit, dimMilliMeter);
		expect(Dimensioning.cmToPixel(30.48)).toBe(15);
	});

	it('PRESERVED QUIRK: scale 0 yields 0 pixels and Infinity cm - no guard', () =>
	{
		Configuration.setValue(scale, 0);
		expect(Dimensioning.cmToPixel(10)).toBe(0);
		expect(Dimensioning.pixelToCm(10)).toBe(Infinity);
	});

	it('PRESERVED QUIRK: a string scale still works, because getNumericValue coerces with Number()', () =>
	{
		Configuration.setValue(scale, '3');
		expect(Configuration.getNumericValue(scale)).toBe(3);
		expect(Dimensioning.cmToPixel(100)).toBe(147.63779527559055);
	});
});


describe('Dimensioning.roundOff', () =>
{
	it('rounds to 3 decimal places when given decimals = 1000', () =>
	{
		expect(Dimensioning.roundOff(1.23456, 1000)).toBe(1.235);
		expect(Dimensioning.roundOff(1.0005, 1000)).toBe(1.001);
		expect(Dimensioning.roundOff(0.0005, 1000)).toBe(0.001);
		expect(Dimensioning.roundOff(0.00049, 1000)).toBe(0);
	});

	it('treats the second argument as a multiplier, not a digit count', () =>
	{
		// roundOff(v, 100) is 2 places, roundOff(v, 10) is 1 place: the parameter
		// is named `decimals` but is really 10^places.
		expect(Dimensioning.roundOff(1.23456, 100)).toBe(1.23);
		expect(Dimensioning.roundOff(1.2345, 10)).toBe(1.2);
	});

	it('PRESERVED QUIRK: rounds halves toward +Infinity, so -1.5 becomes -1', () =>
	{
		// Math.round semantics, not "round half away from zero".
		expect(Dimensioning.roundOff(1.5, 1)).toBe(2);
		expect(Dimensioning.roundOff(2.5, 1)).toBe(3);
		expect(Dimensioning.roundOff(-1.5, 1)).toBe(-1);
		expect(Dimensioning.roundOff(-2.5, 1)).toBe(-2);
	});

	it('PRESERVED QUIRK: the decimals argument has no default, so roundOff(v) is NaN', () =>
	{
		// Every caller must pass `decimals`; the module-level constant is not used.
		expect(Dimensioning.roundOff(1.5)).toBeNaN();
		expect(Dimensioning.roundOff(1.5, 0)).toBeNaN();
	});
});


describe('Dimensioning conversions - dimCentiMeter (the identity unit)', () =>
{
	beforeEach(() => { Configuration.setValue(configDimUnit, dimCentiMeter); });

	it('cmToMeasureRaw truncates to 3 decimals but otherwise passes cm through', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(100);
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(400);
		expect(Dimensioning.cmToMeasureRaw(-100)).toBe(-100);
		expect(Dimensioning.cmToMeasureRaw(1.23456)).toBe(1.235);
		expect(Dimensioning.cmToMeasureRaw(1.00049)).toBe(1);
		expect(Dimensioning.cmToMeasureRaw(1.00051)).toBe(1.001);
	});

	it('PRESERVED QUIRK: cmToMeasureRaw ignores `power` for cm (no Math.pow in this branch)', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(100, 2)).toBe(100);
		expect(Dimensioning.cmToMeasureRaw(100, 0)).toBe(100);
	});

	it('cmToMeasure appends the "cm" suffix', () =>
	{
		expect(Dimensioning.cmToMeasure(100)).toBe('100cm');
		expect(Dimensioning.cmToMeasure(1.23456)).toBe('1.235cm');
		expect(Dimensioning.cmToMeasure(0)).toBe('0cm');
	});

	it('cmFromMeasureRaw is a pure identity - no rounding at all', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(1.23456789)).toBe(1.23456789);
		expect(Dimensioning.cmFromMeasureRaw(400)).toBe(400);
		expect(Dimensioning.cmFromMeasureRaw(-100)).toBe(-100);
	});

	it('PRESERVED QUIRK: cmFromMeasure returns a NUMBER for cm while every other unit returns a String', () =>
	{
		// The cm branch is `return measure;` - it forgets the + 'cm' the other
		// branches do, so the return type of cmFromMeasure is unit-dependent.
		expect(typeof Dimensioning.cmFromMeasure(100)).toBe('number');
		expect(Dimensioning.cmFromMeasure(100)).toBe(100);
	});

	it('PRESERVED QUIRK: cmFromMeasure for cm passes non-numeric input straight through', () =>
	{
		expect(Dimensioning.cmFromMeasure('abc')).toBe('abc');
	});

	it('round-trips exactly for cm', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(Dimensioning.cmToMeasureRaw(400))).toBe(400);
	});
});


describe('Dimensioning conversions - dimMeter', () =>
{
	beforeEach(() => { Configuration.setValue(configDimUnit, dimMeter); });

	it('cmToMeasureRaw divides by 100 and truncates to 3 decimals', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmToMeasureRaw(1)).toBe(0.01);
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(1);
		expect(Dimensioning.cmToMeasureRaw(250)).toBe(2.5);
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(4);
		expect(Dimensioning.cmToMeasureRaw(30.48)).toBe(0.305);
		expect(Dimensioning.cmToMeasureRaw(1234.5678)).toBe(12.346);
		expect(Dimensioning.cmToMeasureRaw(-100)).toBe(-1);
	});

	it('cmToMeasureRaw raises the 0.01 factor to `power`', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(100, 2)).toBe(0.01);
		expect(Dimensioning.cmToMeasureRaw(100, 0)).toBe(100);
	});

	it('cmToMeasure appends "m"', () =>
	{
		expect(Dimensioning.cmToMeasure(400)).toBe('4m');
		expect(Dimensioning.cmToMeasure(1)).toBe('0.01m');
		expect(Dimensioning.cmToMeasure(1234.5678)).toBe('12.346m');
	});

	it('cmFromMeasureRaw multiplies by 100', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmFromMeasureRaw(1)).toBe(100);
		expect(Dimensioning.cmFromMeasureRaw(2.5)).toBe(250);
		expect(Dimensioning.cmFromMeasureRaw(4)).toBe(400);
		expect(Dimensioning.cmFromMeasureRaw(1234.567)).toBe(123456.7);
	});

	it('PRESERVED QUIRK: cmFromMeasure for meters labels the result "cm", not "m"', () =>
	{
		// Every non-cm branch of cmFromMeasure appends 'cm' - the string is
		// "value converted INTO cm", so the suffix is technically right but the
		// symmetry with cmToMeasure is broken.
		expect(Dimensioning.cmFromMeasure(2.5)).toBe('250cm');
	});

	it('round-trips exactly for meters', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(Dimensioning.cmToMeasureRaw(400))).toBe(400);
	});

	it('is also the default branch for an unrecognised unit string', () =>
	{
		Configuration.setValue(configDimUnit, 'furlong');
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(1);
		expect(Dimensioning.cmToMeasure(100)).toBe('1m');
		expect(Dimensioning.cmFromMeasureRaw(100)).toBe(10000);
		expect(Dimensioning.cmFromMeasure(100)).toBe('10000cm');
	});
});


describe('Dimensioning conversions - dimMilliMeter', () =>
{
	beforeEach(() => { Configuration.setValue(configDimUnit, dimMilliMeter); });

	it('cmToMeasureRaw multiplies by 10 and truncates to 3 decimals', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmToMeasureRaw(1)).toBe(10);
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(1000);
		expect(Dimensioning.cmToMeasureRaw(250)).toBe(2500);
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(4000);
		expect(Dimensioning.cmToMeasureRaw(30.48)).toBe(304.8);
		expect(Dimensioning.cmToMeasureRaw(1234.567)).toBe(12345.67);
		expect(Dimensioning.cmToMeasureRaw(-100)).toBe(-1000);
	});

	it('cmToMeasureRaw raises the factor 10 to `power`', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(100, 2)).toBe(10000);
		expect(Dimensioning.cmToMeasureRaw(100, 0)).toBe(100);
	});

	it('cmToMeasure appends "mm"', () =>
	{
		expect(Dimensioning.cmToMeasure(400)).toBe('4000mm');
		expect(Dimensioning.cmToMeasure(30.48)).toBe('304.8mm');
	});

	it('PRESERVED QUIRK: cmFromMeasureRaw uses 0.10000005400001014955, not 0.1', () =>
	{
		// The inverse constant carries the same 5.4e-8 relative drift as the
		// feet/inch constants below; at 3-decimal truncation it is invisible for
		// small values and shows up as a 1-in-the-last-place error for large ones.
		expect(Dimensioning.cmFromMeasureRaw(1)).toBe(0.1);
		expect(Dimensioning.cmFromMeasureRaw(10)).toBe(1);
		expect(Dimensioning.cmFromMeasureRaw(4000)).toBe(400);
		expect(Dimensioning.cmFromMeasureRaw(1234)).toBe(123.4);
		expect(1 * 0.10000005400001014955).not.toBe(0.1);
	});

	it('cmFromMeasure appends "cm"', () =>
	{
		expect(Dimensioning.cmFromMeasure(4000)).toBe('400cm');
		expect(Dimensioning.cmFromMeasure(1)).toBe('0.1cm');
	});

	it('round-trips exactly for millimetres', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(Dimensioning.cmToMeasureRaw(400))).toBe(400);
	});
});


describe('Dimensioning conversions - dimInch', () =>
{
	beforeEach(() => { Configuration.setValue(configDimUnit, dimInch); });

	it('PRESERVED QUIRK: cmToMeasureRaw uses the truncated factor 0.393700, not 0.3937007874...', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmToMeasureRaw(1)).toBe(0.394);
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(39.37);
		expect(Dimensioning.cmToMeasureRaw(250)).toBe(98.425);
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(157.48);
		expect(Dimensioning.cmToMeasureRaw(1234.567)).toBe(486.049);
		expect(Dimensioning.cmToMeasureRaw(-100)).toBe(-39.37);
	});

	it('PRESERVED QUIRK: 2.54 cm reports as exactly 1 inch only because of the 3-decimal truncation', () =>
	{
		// 2.54 * 0.393700 = 0.999998; Math.round(999.998) / 1000 == 1.
		expect(2.54 * 0.393700).toBe(0.999998);
		expect(Dimensioning.cmToMeasureRaw(2.54)).toBe(1);
		expect(Dimensioning.cmToMeasureRaw(12.7)).toBe(5);
		expect(Dimensioning.cmToMeasureRaw(30.48)).toBe(12);
	});

	it('cmToMeasureRaw raises 0.393700 to `power`', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(100, 2)).toBe(15.5);
		expect(Dimensioning.cmToMeasureRaw(100, 0)).toBe(100);
	});

	it('PRESERVED QUIRK: cmToMeasure suffixes inches with a FOOT mark (single quote)', () =>
	{
		// dimInch renders `39.37'`, which reads as feet. The double-prime is only
		// used by the feetAndInch branch.
		expect(Dimensioning.cmToMeasure(100)).toBe('39.37\'');
		expect(Dimensioning.cmToMeasure(0)).toBe('0\'');
		expect(Dimensioning.cmToMeasure(-100)).toBe('-39.37\'');
	});

	it('PRESERVED QUIRK: cmFromMeasureRaw uses 2.5400013716002578512, not 2.54', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(1)).toBe(2.54);
		expect(Dimensioning.cmFromMeasureRaw(12)).toBe(30.48);
		expect(Dimensioning.cmFromMeasureRaw(100)).toBe(254);
		expect(Dimensioning.cmFromMeasureRaw(250)).toBe(635);
		expect(1 * 2.5400013716002578512).not.toBe(2.54);
	});

	it('PRESERVED QUIRK: the inch drift becomes visible above ~400 units', () =>
	{
		// 400 * 2.5400013716... = 1016.00054864..., truncated to 1016.001 rather
		// than the exact 1016.
		expect(Dimensioning.cmFromMeasureRaw(400)).toBe(1016.001);
		expect(Dimensioning.cmFromMeasureRaw(30.48)).toBe(77.419);
		expect(Dimensioning.cmFromMeasureRaw(1234.567)).toBe(3135.802);
	});

	it('cmFromMeasure appends "cm"', () =>
	{
		expect(Dimensioning.cmFromMeasure(1)).toBe('2.54cm');
		expect(Dimensioning.cmFromMeasure(400)).toBe('1016.001cm');
	});

	it('PRESERVED QUIRK: inch does NOT round-trip - 400 cm comes back as 399.999 cm', () =>
	{
		// cmToMeasureRaw uses 0.393700 while cmFromMeasureRaw uses
		// 2.5400013716..., and neither is the inverse of the other.
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(157.48);
		expect(Dimensioning.cmFromMeasureRaw(157.48)).toBe(399.999);
	});
});


describe('Dimensioning conversions - dimFeetAndInch', () =>
{
	beforeEach(() => { Configuration.setValue(configDimUnit, dimFeetAndInch); });

	it('PRESERVED QUIRK: cmToMeasureRaw returns FEET (a fraction), not feet-and-inches', () =>
	{
		// The source comment says so explicitly: "dimFeetAndInch returns only the feet".
		expect(Dimensioning.cmToMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmToMeasureRaw(1)).toBe(0.03280841666667);
		expect(Dimensioning.cmToMeasureRaw(100)).toBe(3.2808416666669995);
		expect(Dimensioning.cmToMeasureRaw(250)).toBe(8.2021041666675);
		expect(Dimensioning.cmToMeasureRaw(400)).toBe(13.123366666667998);
		expect(Dimensioning.cmToMeasureRaw(-100)).toBe(-3.2808416666669995);
	});

	it('PRESERVED QUIRK: feetAndInch is the ONLY unit whose cmToMeasureRaw is not truncated to 3 decimals', () =>
	{
		// Every other branch wraps the result in Math.round(decimals * x) / decimals.
		expect(Dimensioning.cmToMeasureRaw(30.48)).toBe(1.0000005400001015);
		expect(Dimensioning.cmToMeasureRaw(30.48)).not.toBe(1);
	});

	it('PRESERVED QUIRK: the foot factor 0.032808416666669996953 is not the inverse of 30.48', () =>
	{
		// 1 / 30.48 == 0.03280839895013123; the literal in the source is larger,
		// so one foot of wall measures 1.00000054 ft.
		expect(1 / 30.48).toBe(0.03280839895013123);
		expect(0.032808416666669996953).not.toBe(1 / 30.48);
		expect(30.480016459203095991 * 0.032808416666669996953).toBe(1.0000010800004946);
	});

	it('cmToMeasureRaw raises the foot factor to `power`', () =>
	{
		expect(Dimensioning.cmToMeasureRaw(100, 2)).toBe(0.10763922041738296);
		expect(Dimensioning.cmToMeasureRaw(100, 0)).toBe(100);
	});

	it('cmToMeasure formats as feet\'inches" with the inches rounded', () =>
	{
		expect(Dimensioning.cmToMeasure(0)).toBe('0\'0"');
		expect(Dimensioning.cmToMeasure(30.48)).toBe('1\'0"');
		expect(Dimensioning.cmToMeasure(60.96)).toBe('2\'0"');
		expect(Dimensioning.cmToMeasure(100)).toBe('3\'3"');
		expect(Dimensioning.cmToMeasure(250)).toBe('8\'2"');
		expect(Dimensioning.cmToMeasure(400)).toBe('13\'1"');
	});

	it('PRESERVED QUIRK: cmToMeasure can emit 12 inches instead of carrying into the next foot', () =>
	{
		// remainingInches = Math.round(remainingFeet * 12) is never re-normalised,
		// so anything above 11.5/12 of a foot renders as N'12".
		expect(Dimensioning.cmToMeasure(121)).toBe('3\'12"');
		expect(Dimensioning.cmToMeasure(121.9)).toBe('3\'12"');
		expect(Dimensioning.cmToMeasure(121.92)).toBe('4\'0"');
	});

	it('PRESERVED QUIRK: negative lengths render nonsensically because of Math.floor', () =>
	{
		// -100 cm is -3.28 ft; Math.floor(-3.28) is -4, leaving a POSITIVE
		// remainder of 0.72 ft = 9 inches, so it prints -4'9".
		expect(Dimensioning.cmToMeasure(-100)).toBe('-4\'9"');
		expect(Dimensioning.cmToMeasure(-1)).toBe('-1\'12"');
	});

	it('PRESERVED QUIRK: cmFromMeasureRaw treats the input as FEET and uses 30.480016459203095991', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(0)).toBe(0);
		expect(Dimensioning.cmFromMeasureRaw(1)).toBe(30.48);
		expect(Dimensioning.cmFromMeasureRaw(2)).toBe(60.96);
		expect(Dimensioning.cmFromMeasureRaw(100)).toBe(3048.002);
		expect(Dimensioning.cmFromMeasureRaw(250)).toBe(7620.004);
		expect(Dimensioning.cmFromMeasureRaw(400)).toBe(12192.007);
		expect(30.480016459203095991).not.toBe(30.48);
	});

	it('cmFromMeasure appends "cm"', () =>
	{
		expect(Dimensioning.cmFromMeasure(1)).toBe('30.48cm');
		expect(Dimensioning.cmFromMeasure(100)).toBe('3048.002cm');
	});

	it('round-trips 400 cm exactly, because the two drifting constants cancel at 3 decimals', () =>
	{
		expect(Dimensioning.cmFromMeasureRaw(Dimensioning.cmToMeasureRaw(400))).toBe(400);
	});
});


describe('Configuration - accepted keys and throwing behaviour', () =>
{
	it('getStringValue accepts only the dimUnit key', () =>
	{
		expect(Configuration.getStringValue(configDimUnit)).toBe('cm');
		expect(configDimUnit).toBe('dimUnit');
	});

	it('getStringValue throws "Invalid string configuration parameter: <key>" for anything else', () =>
	{
		expect(() => Configuration.getStringValue(configWallHeight))
			.toThrow('Invalid string configuration parameter: wallHeight');
		expect(() => Configuration.getStringValue('nope'))
			.toThrow('Invalid string configuration parameter: nope');
		expect(() => Configuration.getStringValue(undefined))
			.toThrow('Invalid string configuration parameter: undefined');
	});

	it('getStringValue throws a plain Error, not a subclass', () =>
	{
		let caught = null;
		try
		{
			Configuration.getStringValue('nope');
		}
		catch (err)
		{
			caught = err;
		}
		expect(caught).toBeInstanceOf(Error);
		expect(caught.constructor).toBe(Error);
		expect(caught.message).toBe('Invalid string configuration parameter: nope');
	});

	it('getNumericValue accepts exactly the seven whitelisted keys', () =>
	{
		expect(Configuration.getNumericValue(configSystemUI)).toBe(0);
		expect(Configuration.getNumericValue(configWallHeight)).toBe(250);
		expect(Configuration.getNumericValue(configWallThickness)).toBe(10);
		expect(Configuration.getNumericValue(scale)).toBe(1);
		expect(Configuration.getNumericValue(snapToGrid)).toBe(0);
		expect(Configuration.getNumericValue(snapTolerance)).toBe(25);
		expect(Configuration.getNumericValue(gridSpacing)).toBe(25);
	});

	it('getNumericValue throws "Invalid numeric configuration parameter: <key>" for anything else', () =>
	{
		expect(() => Configuration.getNumericValue(configDimUnit))
			.toThrow('Invalid numeric configuration parameter: dimUnit');
		expect(() => Configuration.getNumericValue('nope'))
			.toThrow('Invalid numeric configuration parameter: nope');
		expect(() => Configuration.getNumericValue(undefined))
			.toThrow('Invalid numeric configuration parameter: undefined');
	});

	it('PRESERVED QUIRK: the booleans systemUI and snapToGrid are only readable through getNumericValue, as 0/1', () =>
	{
		Configuration.setValue(snapToGrid, true);
		expect(Configuration.getNumericValue(snapToGrid)).toBe(1);
		expect(config.snapToGrid).toBe(true);
		Configuration.setValue(snapToGrid, false);
		expect(Configuration.getNumericValue(snapToGrid)).toBe(0);
	});

	it('PRESERVED QUIRK: getStringValue coerces with String(), so a numeric dimUnit is silently stringified', () =>
	{
		Configuration.setValue(configDimUnit, 99);
		expect(Configuration.getStringValue(configDimUnit)).toBe('99');
		// ...and every Dimensioning switch then falls through to the meter branch.
		expect(Dimensioning.cmToMeasure(100)).toBe('1m');
	});

	it('PRESERVED QUIRK: setValue has NO whitelist - it writes any key onto the shared config', () =>
	{
		Configuration.setValue('totallyMadeUp', 42);
		expect(config.totallyMadeUp).toBe(42);
		// ...but it stays unreadable through either getter.
		expect(() => Configuration.getNumericValue('totallyMadeUp'))
			.toThrow('Invalid numeric configuration parameter: totallyMadeUp');
		delete config.totallyMadeUp;
	});

	/**
	 * The three label prefixes were 'e:', 'i:' and 'm:' until RM-008 E1 and are
	 * now empty. That is a deliberate behaviour change, not a drift: the plan
	 * captioned every wall `m:5m`, and the m stands for midline - a fact
	 * available nowhere outside this repository.
	 *
	 * Changing a characterization expectation is normally the wrong move, so the
	 * reasoning is here rather than in a commit message nobody will read next to
	 * this line. What the prefix is FOR is telling two measurements apart when
	 * interior and exterior lengths are drawn at once; `exterior` and `interior`
	 * both default to false, so that has never been the shipped case. The keys
	 * survive and are still configurable, so an embedder that turns those on can
	 * set them back.
	 */
	it('exposes the non-configurable module constants cornerTolerance and wallInformation', () =>
	{
		expect(cornerTolerance).toBe(20);
		expect(wallInformation).toEqual({
			exterior: false,
			interior: false,
			midline: true,
			labels: true,
			exteriorlabel: '',
			interiorlabel: '',
			midlinelabel: '',
		});
	});
});


describe('Configuration is a mutable module singleton with no change notification', () =>
{
	it('getData() returns the exported config object itself, not a copy', () =>
	{
		expect(Configuration.getData()).toBe(config);
	});

	it('setValue mutates the exported config binding in place', () =>
	{
		Configuration.setValue(configWallHeight, 321);
		expect(config.wallHeight).toBe(321);
		expect(Configuration.getData().wallHeight).toBe(321);
		expect(Configuration.getNumericValue(configWallHeight)).toBe(321);
	});

	it('a direct write to config is visible through Configuration', () =>
	{
		config.wallThickness = 77;
		expect(Configuration.getNumericValue(configWallThickness)).toBe(77);
	});

	it('a reference to config captured earlier still sees later setValue writes (same object)', () =>
	{
		const captured = Configuration.getData();
		Configuration.setValue(scale, 5);
		expect(captured.scale).toBe(5);
	});

	/**
	 * FIXED in RM-002 R-03. This block replaces a PRESERVED QUIRK test that
	 * asserted the opposite - that Configuration had no event surface at all.
	 *
	 * That was a genuine characterization of a genuine gap, not a quirk worth
	 * keeping: Configuration was the one change vector in the library that
	 * broadcast nothing, so anything caching a config value kept a stale copy
	 * forever and the settings panel's zoom control read `Number(config.scale)`
	 * once and displayed 1 while the plan sat at 300%.
	 *
	 * The expectation was changed together with the code, deliberately, which is
	 * what the preserve-or-fix policy asks for. What has NOT changed is the
	 * snapshotting below: a Wall still reads thickness and height once in its
	 * constructor and never hears about a later change. Broadcasting a change is
	 * not the same as reacting to one, and nothing in the model reacts yet.
	 */
	it('setValue dispatches EVENT_CONFIG_CHANGED with the key, the new value and the old', () =>
	{
		const seen = [];
		const listener = (event) => {seen.push(event);};
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, listener);

		Configuration.setValue(configWallHeight, 275);

		expect(seen).toHaveLength(1);
		expect(seen[0].key).toBe(configWallHeight);
		expect(seen[0].value).toBe(275);
		expect(seen[0].previous).toBe(250);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, listener);
	});

	it('setting a key to the value it already holds dispatches nothing', () =>
	{
		// Callers write from watchers and computed setters that re-run for
		// unrelated reasons. Announcing a no-op write would turn one user action
		// into a redraw storm, and a two-way bound control into a loop.
		Configuration.setValue(scale, 2);

		const seen = [];
		const listener = (event) => {seen.push(event);};
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, listener);

		Configuration.setValue(scale, 2);
		expect(seen).toHaveLength(0);

		Configuration.setValue(scale, 3);
		expect(seen).toHaveLength(1);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, listener);
	});

	it('removeEventListener actually detaches', () =>
	{
		let count = 0;
		const listener = () => {count += 1;};
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, listener);
		Configuration.setValue(gridSpacing, 33);
		expect(count).toBe(1);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, listener);
		Configuration.setValue(gridSpacing, 44);
		expect(count).toBe(1);
	});

	it('the value is written before the event fires, so a listener reads the new one', () =>
	{
		let observed = null;
		const listener = () => {observed = Configuration.getNumericValue(configWallThickness);};
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, listener);

		Configuration.setValue(configWallThickness, 15);
		expect(observed).toBe(15);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, listener);
	});

	it('a direct write to config still bypasses the event, as it always has', () =>
	{
		// getData() hands out the live object and several places write straight to
		// it. Those writes are invisible to listeners - only setValue announces.
		// Worth pinning: it is the one way to change configuration silently, and
		// anybody debugging a control that will not update should look here first.
		const seen = [];
		const listener = (event) => {seen.push(event);};
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, listener);

		config.wallHeight = 999;
		expect(Configuration.getNumericValue(configWallHeight)).toBe(999);
		expect(seen).toHaveLength(0);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, listener);
	});
});


describe('Config snapshotting - Wall captures thickness/height at construction', () =>
{
	it('a new Wall reads wallThickness/wallHeight from Configuration once, in the constructor', () =>
	{
		Configuration.setValue(configWallThickness, 10);
		Configuration.setValue(configWallHeight, 250);

		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		expect(wall.thickness).toBe(10);
		expect(wall.height).toBe(250);
	});

	it('PRESERVED QUIRK: changing configWallHeight/Thickness does NOT retro-update an existing wall', () =>
	{
		// wall.js:97-100 snapshots the values; there is no listener to refresh
		// them. Any UI that edits the defaults must walk the existing walls.
		const floorplan = new Floorplan();
		const wall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		Configuration.setValue(configWallHeight, 400);
		Configuration.setValue(configWallThickness, 25);

		expect(config.wallHeight).toBe(400);
		expect(config.wallThickness).toBe(25);
		expect(wall.height).toBe(250);
		expect(wall.thickness).toBe(10);
	});

	it('a wall created AFTER the change picks up the new defaults, so the two walls disagree', () =>
	{
		const floorplan = new Floorplan();
		const oldWall = floorplan.newWall(floorplan.newCorner(0, 0), floorplan.newCorner(100, 0));

		Configuration.setValue(configWallHeight, 400);
		Configuration.setValue(configWallThickness, 25);

		const newWall = floorplan.newWall(floorplan.newCorner(0, 100), floorplan.newCorner(100, 100));

		expect(oldWall.height).toBe(250);
		expect(oldWall.thickness).toBe(10);
		expect(newWall.height).toBe(400);
		expect(newWall.thickness).toBe(25);
	});
});


describe('Version', () =>
{
	/*
	 * These used to be nine PRESERVED QUIRK tests pinning a comparator that did
	 * the opposite of what its name said. It compared `checkVersion[i] >=
	 * version[i]` per component as an AND, returned the numbers 1 and 0 from
	 * `flag &=` except on two paths that returned the boolean false, threw on an
	 * undefined second argument, and treated '1.0.0' and '0.9.9' as neither
	 * above nor below each other.
	 *
	 * The migration preserved it deliberately - Floorplan.loadFloorplan gated
	 * curved-wall control points on it, so changing it changed what designs
	 * looked like. That gate now reads the wall record instead, which is what
	 * finally made the format versionable and this fixable. The quirk tests are
	 * the checklist they were meant to be; every line below replaces one.
	 */

	it('orders versions the way its name reads', () =>
	{
		expect(Version.isVersionHigherThan('0.0.2', '0.0.1')).toBe(true);
		expect(Version.isVersionHigherThan('0.0.1', '0.0.2')).toBe(false);
		expect(Version.isVersionHigherThan('0.0.10', '0.0.9')).toBe(true);
		expect(Version.isVersionHigherThan('0.0.9', '0.0.10')).toBe(false);
	});

	it('is strict, so a version is not higher than itself', () =>
	{
		expect(Version.isVersionHigherThan('0.0.2a', '0.0.2a')).toBe(false);
		expect(Version.isVersionHigherThan(Version.getTechnicalVersion(), Version.getTechnicalVersion())).toBe(false);
		// The >= form is a separate function rather than an inverted call, which
		// is exactly how the original went wrong.
		expect(Version.isVersionAtLeast('0.0.2a', '0.0.2a')).toBe(true);
		expect(Version.isVersionAtLeast('0.0.1', '0.0.2')).toBe(false);
	});

	it('returns booleans, not the numbers 1 and 0', () =>
	{
		expect(typeof Version.isVersionHigherThan('0.0.2', '0.0.1')).toBe('boolean');
		expect(typeof Version.isVersionHigherThan('0.0.1', '0.0.2')).toBe('boolean');
		expect(typeof Version.isVersionHigherThan(undefined, '0.0.2')).toBe('boolean');
		expect(typeof Version.isVersionAtLeast('1.2', '1.2.3')).toBe('boolean');
	});

	it('orders left to right, so a major bump wins whatever follows it', () =>
	{
		// The old per-component AND collapsed this to false in BOTH directions.
		expect(Version.isVersionHigherThan('1.0.0', '0.9.9')).toBe(true);
		expect(Version.isVersionHigherThan('0.9.9', '1.0.0')).toBe(false);
		expect(Version.compare('1.0.0', '0.9.9')).toBe(1);
		expect(Version.compare('0.9.9', '1.0.0')).toBe(-1);
	});

	it('pads the shorter version rather than giving up on it', () =>
	{
		// Mismatched component counts used to return false out of hand, which is
		// what would have rejected a file stamped '1.0'.
		expect(Version.compare('1.2', '1.2.0')).toBe(0);
		expect(Version.compare('1.2', '1.2.3')).toBe(-1);
		expect(Version.compare('1.3', '1.2.3')).toBe(1);
		expect(Version.isVersionAtLeast('1.2', '1.2.0')).toBe(true);
	});

	it('still parses leniently, because 0.0.2a is a real version in the wild', () =>
	{
		expect(Version.compare('0.0.2a', '0.0.2')).toBe(0);
		expect(Version.compare('1.0.0-beta', '1.0.0')).toBe(0);
		expect(Version.isVersionHigherThan('0.0.3', '0.0.2a')).toBe(true);
	});

	it('treats an absent or unusable version as the oldest thing there is', () =>
	{
		// It no longer throws on either argument - a save file is user input, and
		// the two paths that threw were reachable from a hand-edited one.
		expect(Version.isVersionHigherThan(undefined, '0.0.2')).toBe(false);
		expect(Version.isVersionHigherThan(null, '0.0.2')).toBe(false);
		expect(Version.isVersionHigherThan(0, '0.0.0')).toBe(false);
		expect(Version.isVersionHigherThan('', '0.0.0')).toBe(false);
		expect(Version.isVersionAtLeast(undefined, '0.0.0')).toBe(false);
		expect(() => Version.isVersionHigherThan('0.0.1', undefined)).not.toThrow();
		expect(Version.isVersionHigherThan('0.0.1', undefined)).toBe(true);
	});

	it('sorts unparseable components as zero rather than NaN', () =>
	{
		expect(Version.compare('a.b.c', '0.0.0')).toBe(0);
		expect(Version.isVersionHigherThan('a.b.c', '0.0.0')).toBe(false);
		expect(Version.isVersionHigherThan('1.0.0', 'a.b.c')).toBe(true);
	});

	it('pins the save-format version strings', () =>
	{
		// 0.0.2a for the whole life of the project before the format became
		// self-describing. This is the version of the FILE, not of the package.
		expect(Version.getInformalVersion()).toBe('2.0.0');
		expect(Version.getTechnicalVersion()).toBe('2.0.0');
	});
});


describe('Utils.pointInPolygon - always false (wrong arity)', () =>
{
	const square = [pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0)];

	it('PRESERVED BUG: returns false for a point clearly INSIDE the polygon', () =>
	{
		// pointInPolygon calls lineLineIntersect(start, point, c1.x, c1.y, c2.x, c2.y)
		// - six args where four objects are expected. tCCW then reads `.x` off a
		// Number, gets undefined, and every comparison is NaN-false. tIntersects
		// never increments, so the parity test always says "outside".
		expect(Utils.pointInPolygon(pt(5, 5), square)).toBe(false);
	});

	it('returns false for a point outside the polygon too (so it is never right by accident)', () =>
	{
		expect(Utils.pointInPolygon(pt(50, 50), square)).toBe(false);
	});

	it('stays false whatever raycast start is supplied', () =>
	{
		expect(Utils.pointInPolygon(pt(5, 5), square, v2(-100, -100))).toBe(false);
		expect(Utils.pointInPolygon(pt(5, 5), square, v2(0, 0))).toBe(false);
	});

	it('PRESERVED BUG: polygonInsidePolygon therefore always reports false', () =>
	{
		// It also calls pointInPolygon with the wrong arity of its own
		// (x, y, corners, start) - a second, independent shape mismatch.
		const inner = [pt(2, 2), pt(2, 8), pt(8, 8), pt(8, 2)];
		expect(Utils.polygonInsidePolygon(inner, square, v2(-100, -100))).toBe(false);
	});

	it('PRESERVED BUG: polygonOutsidePolygon therefore always reports true', () =>
	{
		const inner = [pt(2, 2), pt(2, 8), pt(8, 8), pt(8, 2)];
		expect(Utils.polygonOutsidePolygon(inner, square, v2(-100, -100))).toBe(true);
	});

	it('the unused sibling pointInPolygon2 IS correct - it is the one worth keeping', () =>
	{
		expect(Utils.pointInPolygon2(pt(5, 5), square)).toBe(true);
		expect(Utils.pointInPolygon2(pt(50, 50), square)).toBe(false);
	});
});


describe('Utils.isClockwise', () =>
{
	it('reports true for a screen-space clockwise ring', () =>
	{
		expect(Utils.isClockwise([pt(0, 0), pt(0, 10), pt(10, 10), pt(10, 0)])).toBe(true);
	});

	it('reports false for the same ring traversed the other way', () =>
	{
		expect(Utils.isClockwise([pt(0, 0), pt(10, 0), pt(10, 10), pt(0, 10)])).toBe(false);
	});

	it('reports false for the harness square room [0,0]->[400,0]->[400,300]->[0,300]', () =>
	{
		expect(Utils.isClockwise([pt(0, 0), pt(400, 0), pt(400, 300), pt(0, 300)])).toBe(false);
		expect(Utils.isClockwise([pt(0, 300), pt(400, 300), pt(400, 0), pt(0, 0)])).toBe(true);
	});

	it('handles negative coordinates the same way as positive ones', () =>
	{
		expect(Utils.isClockwise([pt(-10, -10), pt(-10, 10), pt(10, 10), pt(10, -10)])).toBe(true);
		expect(Utils.isClockwise([pt(10, -10), pt(10, 10), pt(-10, 10), pt(-10, -10)])).toBe(false);
	});

	it('PRESERVED BUG: tSubY is computed from p.x, yet the result is unaffected', () =>
	{
		// utils.js:138-140 - the tSubY reducer returns p.x, so the polygon is
		// translated in y by the minimum X. The shoelace variant used here,
		// sum((x2-x1) * (y2+y1)), is invariant under y-translation because
		// sum(x2-x1) around a closed ring is 0, so the bug is latent. This test
		// exists to keep it latent: it uses a ring whose min-x (100) is nowhere
		// near its min-y (-500), which is exactly where the bug would surface.
		const ring = [pt(100, -500), pt(200, -500), pt(200, -400), pt(100, -400)];
		expect(Utils.isClockwise(ring)).toBe(false);
		expect(Utils.isClockwise(ring.map((p) => pt(p.x, p.y + 1000)))).toBe(false);
		expect(Utils.isClockwise(ring.map((p) => pt(p.x + 7777, p.y)))).toBe(false);
		expect(Utils.isClockwise(ring.slice().reverse())).toBe(true);
	});

	it('PRESERVED QUIRK: degenerate inputs (empty, single point, straight line) are "clockwise"', () =>
	{
		// tSum stays 0 and the test is `tSum >= 0`.
		expect(Utils.isClockwise([])).toBe(true);
		expect(Utils.isClockwise([pt(5, 5)])).toBe(true);
		expect(Utils.isClockwise([pt(0, 0), pt(10, 0)])).toBe(true);
	});
});


describe('Utils.angle and Utils.angle2pi', () =>
{
	it('PRESERVED QUIRK: angle negates atan2, so it grows CLOCKWISE, not counter-clockwise', () =>
	{
		// tAngle = -Math.atan2(det, dot). Rotating `end` counter-clockwise away
		// from `start` produces an increasingly NEGATIVE angle.
		expect(Utils.angle(v2(1, 0), v2(0, 1))).toBe(-Math.PI / 2);
		expect(Utils.angle(v2(1, 0), v2(1, 1))).toBe(-Math.PI / 4);
		expect(Utils.angle(v2(0, 1), v2(1, 0))).toBe(Math.PI / 2);
		expect(Utils.angle(v2(1, 0), v2(0, -1))).toBe(Math.PI / 2);
	});

	it('returns -pi (not +pi) for opposed vectors', () =>
	{
		expect(Utils.angle(v2(1, 0), v2(-1, 0))).toBe(-Math.PI);
	});

	it('PRESERVED QUIRK: identical vectors give NEGATIVE zero', () =>
	{
		// -Math.atan2(0, positive) is -0. Object.is distinguishes it from 0, and
		// so does the `tTheta < 0` branch in angle2pi (which -0 does not take).
		expect(Object.is(Utils.angle(v2(1, 0), v2(1, 0)), -0)).toBe(true);
		expect(Object.is(Utils.angle(v2(3, 4), v2(6, 8)), -0)).toBe(true);
	});

	it('PRESERVED QUIRK: a zero-length vector yields -0 rather than NaN', () =>
	{
		expect(Object.is(Utils.angle(v2(0, 0), v2(0, 1)), -0)).toBe(true);
	});

	it('is duck-typed - plain {x, y} objects work as well as Vector2', () =>
	{
		expect(Utils.angle(pt(1, 0), pt(0, 1))).toBe(-Math.PI / 2);
	});

	it('angle2pi shifts negative results into [0, 2pi)', () =>
	{
		expect(Utils.angle2pi(v2(1, 0), v2(0, 1))).toBe(2 * Math.PI - Math.PI / 2);
		expect(Utils.angle2pi(v2(1, 0), v2(-1, 0))).toBe(Math.PI);
	});

	it('angle2pi leaves an already-positive result alone', () =>
	{
		expect(Utils.angle2pi(v2(0, 1), v2(1, 0))).toBe(Math.PI / 2);
	});

	it('PRESERVED QUIRK: angle2pi returns -0 for identical vectors because -0 < 0 is false', () =>
	{
		expect(Object.is(Utils.angle2pi(v2(1, 0), v2(1, 0)), -0)).toBe(true);
	});
});


describe('Utils.cycle', () =>
{
	it('rotates the array left by `shift` positions', () =>
	{
		expect(Utils.cycle([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
		expect(Utils.cycle([1, 2, 3, 4], 3)).toEqual([4, 1, 2, 3]);
	});

	it('returns a copy for shift 0 and does not mutate the input', () =>
	{
		const input = [1, 2, 3];
		const output = Utils.cycle(input, 0);
		expect(output).toEqual([1, 2, 3]);
		expect(output).not.toBe(input);
		Utils.cycle(input, 2);
		expect(input).toEqual([1, 2, 3]);
	});

	it('wraps around for shift >= length', () =>
	{
		expect(Utils.cycle([1, 2, 3, 4], 4)).toEqual([1, 2, 3, 4]);
		expect(Utils.cycle([1, 2, 3, 4], 5)).toEqual([2, 3, 4, 1]);
	});

	it('PRESERVED QUIRK: a negative shift is a no-op copy, not a right rotation', () =>
	{
		expect(Utils.cycle([1, 2, 3, 4], -1)).toEqual([1, 2, 3, 4]);
	});

	it('PRESERVED BUG: cycling an EMPTY array grows it to [undefined]', () =>
	{
		// shift() on an empty array returns undefined, which is then push()ed
		// back, so the result has length 1 regardless of shift.
		const result = Utils.cycle([], 2);
		expect(result.length).toBe(1);
		expect(result[0]).toBeUndefined();
	});
});


describe('Utils.unique - the map key and the lookup key disagree', () =>
{
	it('PRESERVED BUG: membership is tested on String(element) but recorded under hashFunc(element)', () =>
	{
		// utils.js:423-425: `tMap.hasOwnProperty(arr[tI])` vs
		// `tMap[hashFunc(arr[tI])] = true`. Dedup only works when the hash
		// happens to equal the element's own string coercion.
		expect(Utils.unique([1, 1, 2, 2, 3], (x) => x)).toEqual([1, 2, 3]);
		expect(Utils.unique(['a', 'a', 'b'], (s) => s)).toEqual(['a', 'b']);
	});

	it('PRESERVED BUG: a hashFunc that is not the identity dedupes nothing', () =>
	{
		expect(Utils.unique(['a', 'a', 'b'], (s) => s.toUpperCase())).toEqual(['a', 'a', 'b']);
	});

	it('PRESERVED BUG: objects are never deduped - String(obj) is always "[object Object]"', () =>
	{
		// This is how it is actually used in the codebase (hashing by id), so
		// unique() is effectively a slow identity copy for object arrays.
		const a = {id: 'x'};
		const b = {id: 'x'};
		expect(Utils.unique([a, b, a], (o) => o.id)).toEqual([a, b, a]);
		expect(Utils.unique([a, a, a], (o) => o.id).length).toBe(3);
	});

	it('PRESERVED BUG: a constant hashFunc also dedupes nothing', () =>
	{
		expect(Utils.unique([1, 1, 2], () => 'k')).toEqual([1, 1, 2]);
	});
});


describe('Utils.removeValue and friends - strict identity semantics', () =>
{
	it('removes every occurrence, in place, and returns undefined', () =>
	{
		const array = ['x', 'y', 'x'];
		const returned = Utils.removeValue(array, 'x');
		expect(returned).toBeUndefined();
		expect(array).toEqual(['y']);
	});

	it('compares with === so a structurally equal object is NOT removed', () =>
	{
		const kept = {id: 'a'};
		const array = [kept];
		Utils.removeValue(array, {id: 'a'});
		expect(array.length).toBe(1);
		expect(array[0]).toBe(kept);
	});

	it('removes only the identical reference, leaving look-alikes behind', () =>
	{
		const a = {id: 'a'};
		const lookalike = {id: 'a'};
		const c = {id: 'c'};
		const array = [a, lookalike, a, c];
		Utils.removeValue(array, a);
		expect(array).toEqual([lookalike, c]);
		expect(array[0]).toBe(lookalike);
	});

	it('is a no-op when the value is absent', () =>
	{
		const array = [1, 2, 3];
		Utils.removeValue(array, 9);
		expect(array).toEqual([1, 2, 3]);
	});

	it('hasValue uses the same === identity rule', () =>
	{
		const a = {id: 'a'};
		expect(Utils.hasValue([1, 2, 3], 2)).toBe(true);
		expect(Utils.hasValue([1, 2, 3], 4)).toBe(false);
		expect(Utils.hasValue([a], {id: 'a'})).toBe(false);
		expect(Utils.hasValue([a], a)).toBe(true);
	});

	it('subtract and removeIf return NEW arrays rather than mutating', () =>
	{
		const array = [1, 2, 3, 4];
		expect(Utils.subtract(array, [2, 4])).toEqual([1, 3]);
		expect(Utils.removeIf(array, (x) => x % 2 === 0)).toEqual([1, 3]);
		expect(array).toEqual([1, 2, 3, 4]);
	});

	it('map/forEach/forEachIndexed/argsort behave as their names suggest', () =>
	{
		expect(Utils.map([1, 2, 3], (x) => x * 2)).toEqual([2, 4, 6]);

		const visited = [];
		Utils.forEach([1, 2], (x) => visited.push(x));
		expect(visited).toEqual([1, 2]);

		const indexed = [];
		Utils.forEachIndexed(['a', 'b'], (i, x) => indexed.push([i, x]));
		expect(indexed).toEqual([[0, 'a'], [1, 'b']]);

		expect(Utils.argsort([3, 1, 2])).toEqual([1, 2, 0]);
		expect(Utils.argsort([3, 1, 2], -1)).toEqual([0, 2, 1]);
	});
});


describe('Utils.guide determinism through the seeded random source', () =>
{
	it('produces a uuid-shaped 36-character string', () =>
	{
		seedRandom(42);
		const id = Utils.guide();
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(id.length).toBe(36);
	});

	it('replays the same first two values for two runs seeded with 42', () =>
	{
		seedRandom(42);
		const firstRun = [Utils.guide(), Utils.guide()];
		seedRandom(42);
		const secondRun = [Utils.guide(), Utils.guide()];

		expect(secondRun[0]).toBe(firstRun[0]);
		expect(secondRun[1]).toBe(firstRun[1]);
		expect(firstRun[0]).not.toBe(firstRun[1]);
		expect(firstRun[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
		expect(firstRun[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
	});

	it('produces a different sequence for a different seed', () =>
	{
		seedRandom(42);
		const fromFortyTwo = Utils.guide();
		seedRandom(1);
		const fromOne = Utils.guide();
		expect(fromOne).not.toBe(fromFortyTwo);
	});

	it('unseedRandom detaches the seeded source so the seeded value stops repeating', () =>
	{
		// Asserted behaviourally rather than by inspecting Utils' private random
		// slot: the seam is explicitly documented as an implementation detail
		// that changes shape again after the Vite migration.
		seedRandom(42);
		const seeded = Utils.guide();
		seedRandom(42);
		expect(Utils.guide()).toBe(seeded);

		unseedRandom();
		expect(Utils.guide()).not.toBe(seeded);
	});

	it('is no longer replayable once unseeded', () =>
	{
		unseedRandom();
		const ids = new Set();
		for (let i = 0; i < 20; i++)
		{
			ids.add(Utils.guide());
		}
		// 20 draws from a 128-bit space; a collision here would mean the random
		// source is stuck, not bad luck.
		expect(ids.size).toBe(20);
	});

	it('re-seeding mid-run restarts the sequence from the top', () =>
	{
		seedRandom(7);
		const a = Utils.guide();
		Utils.guide();
		Utils.guide();
		seedRandom(7);
		expect(Utils.guide()).toBe(a);
	});
});
