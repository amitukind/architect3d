// @ts-check
import {defaultConfiguration, configDimUnit} from './configuration.js';
import {dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter, dimensioningOptions} from './units.js';

// Unit names live in the leaf module units.js so that configuration.js can
// read dimCentiMeter without importing this file (see units.js). They are
// re-exported here unchanged so every existing import site keeps working.
export {dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter, dimensioningOptions};

export const decimals = 1000;

export const cmPerFoot = 30.48;
export const pixelsPerFoot = 15.0;
export const cmPerPixel = cmPerFoot * (1.0 / pixelsPerFoot);
export const pixelsPerCm = 1.0 / cmPerPixel;


/**
 * Dimensioning functions.
 *
 * ## The instance form, and why the statics are not going anywhere (P7)
 *
 * Every method below exists twice: as an instance method reading the
 * configuration this Dimensioning was constructed with, and as a static
 * delegating to a module-level default bound to the default configuration.
 *
 * That duplication is the entire point of the design, and it is what turned
 * RM-002 R-02's largest number into a non-event. There are 224 `Dimensioning.`
 * call sites across 15 source files, and 164 more in a characterization suite
 * that pins the static form deliberately. Converting them would have been a
 * fortnight of mechanical edits with a real chance of a silent unit bug in the
 * middle of it, to reach a state where the library reads no better.
 *
 * Instead: **every one of those call sites keeps working, untouched**, and a
 * view that wants its own units asks its Floorplan for `floorplan.dimensioning`.
 * The two forms are the same code - the statics are one-line forwards, so they
 * cannot drift from the instance behaviour they stand in for.
 *
 * `roundOff` is static only. It reads no configuration, so an instance copy
 * would suggest a per-instance behaviour that does not exist.
 */
export class Dimensioning
{
	/**
	 * @param {import('./configuration.js').Configuration} [configuration] Where
	 * to read the display unit and the zoom scale from. Omit for the shared
	 * default, which is what the statics use.
	 */
	constructor(configuration)
	{
		this.configuration = configuration || defaultConfiguration;
		/**
		 * What separates a whole number from its fraction (RM-014 L3, Z-4).
		 * A full stop, which is what this class did before L3.
		 * @type {string}
		 */
		this._decimal = '.';
	}

	/** The unit this instance is currently measuring in. */
	get unit()
	{
		return this.configuration.getStringValue(configDimUnit);
	}

	cmToPixel(cm, apply_scale=true)
	{
		if(apply_scale)
		{
			return cm * pixelsPerCm * this.configuration.getNumericValue('scale');
		}
		return cm * pixelsPerCm;
	}

	pixelToCm(pixel, apply_scale=true)
	{
		if(apply_scale)
		{
			return pixel * cmPerPixel * (1.0 / this.configuration.getNumericValue('scale'));
		}
		return pixel * cmPerPixel;
	}

	/** Converts cm to dimensioning number.
	 * @param measure Value in the display unit.
	 * @returns Number representation.
	 */
	cmFromMeasureRaw(measure)
	{
		switch (this.unit)
		{
		case dimFeetAndInch:
			return Math.round(decimals * (measure * 30.480016459203095991)) / decimals;
		case dimInch:
			return Math.round(decimals * (measure * 2.5400013716002578512)) / decimals;
		case dimMilliMeter:
			return Math.round(decimals * (measure * 0.10000005400001014955)) / decimals;
		case dimCentiMeter:
			return measure;
		case dimMeter:
		default:
			return Math.round(decimals * 100 * measure) / decimals;
		}
	}

	/** Converts cm to dimensioning string.
	 * @param measure Value in the display unit.
	 * @returns String representation.
	 */
	cmFromMeasure(measure)
	{
		switch (this.unit)
		{
		case dimFeetAndInch:
			return Math.round(decimals * (measure * 30.480016459203095991)) / decimals + 'cm';
		case dimInch:
			return Math.round(decimals * (measure * 2.5400013716002578512)) / decimals  + 'cm';
		case dimMilliMeter:
			return Math.round(decimals * (measure * 0.10000005400001014955)) / decimals + 'cm';
		case dimCentiMeter:
			return measure;
		case dimMeter:
		default:
			return Math.round(decimals * 100 * measure) / decimals + 'cm';
		}
	}

	/** Converts cm to dimensioning number.
	 * @param cm Centi meter value to be converted.
	 * @returns Number representation.
	 */
	cmToMeasureRaw(cm, power=1)
	{
		switch (this.unit)
		{
		case dimFeetAndInch:// dimFeetAndInch returns only the feet
			var allInFeet = (cm * Math.pow(0.032808416666669996953, power));
			return allInFeet;
		case dimInch:
			var inches = Math.round(decimals * (cm * Math.pow(0.393700, power))) / decimals;
			return inches;
		case dimMilliMeter:
			var mm = Math.round(decimals * (cm * Math.pow(10, power))) / decimals;
			return mm;
		case dimCentiMeter:
			return Math.round(decimals * cm) / decimals;
		case dimMeter:
		default:
			var m = Math.round(decimals * (cm  * Math.pow(0.01, power))) / decimals;
			return m;
		}
	}

	/**
	 * How this document writes a fraction (RM-014 L3, finding Z-4).
	 *
	 * A full stop unless somebody says otherwise, which is what every build did
	 * before L3 and what an embedder who configures nothing keeps. Z-4 is the
	 * measurement behind it: this method concatenates its suffixes and lets
	 * JavaScript write the point, so **1.5 m reads `1.5m` in every locale** and a
	 * German reader expects `1,5 m`.
	 *
	 * It is a separator rather than a locale tag on purpose. `toLocaleString`
	 * would also group thousands and round differently, and a plan's dimensions
	 * are a fixed-precision engineering number, not prose - what changes between
	 * languages here is one character.
	 *
	 * @type {string}
	 */
	get decimalSeparator()
	{
		return this._decimal || '.';
	}

	set decimalSeparator(value)
	{
		this._decimal = (typeof value === 'string' && value) ? value : '.';
	}

	/**
	 * Write a number the way this document writes numbers.
	 *
	 * @param {number} value
	 * @returns {string}
	 */
	number(value)
	{
		var text = String(value);
		return this.decimalSeparator === '.' ? text : text.replace('.', this.decimalSeparator);
	}

	/** Converts cm to dimensioning string.
	 * @param cm Centi meter value to be converted.
	 * @returns String representation.
	 */
	cmToMeasure(cm, power=1)
	{
		switch (this.unit)
		{
		case dimFeetAndInch:
			var allInFeet = (cm * Math.pow(0.032808416666669996953, power));
			var floorFeet = Math.floor(allInFeet);
			var remainingFeet = allInFeet - floorFeet;
			var remainingInches = Math.round(remainingFeet * 12);
			return floorFeet + '\'' + remainingInches + '"';
		case dimInch:
			var inches = Math.round(decimals * (cm * Math.pow(0.393700, power))) / decimals;
			return this.number(inches) + '\'';
		case dimMilliMeter:
			var mm = Math.round(decimals * (cm * Math.pow(10, power))) / decimals;
			return this.number(mm) + 'mm';
		case dimCentiMeter:
			return this.number(Math.round(decimals * cm) / decimals) + 'cm';
		case dimMeter:
		default:
			var m = Math.round(decimals * (cm  * Math.pow(0.01, power))) / decimals;
			return this.number(m) + 'm';
		}
	}

	// --- The static form -----------------------------------------------------
	//
	// One-line forwards to the module default, so the two forms cannot drift.
	// See the class comment for why every existing call site stays on these.

	static roundOff(value, decimals)
	{
		return Math.round(decimals * value) / decimals;
	}

	static cmToPixel(cm, apply_scale=true)
	{
		return defaultDimensioning.cmToPixel(cm, apply_scale);
	}

	static pixelToCm(pixel, apply_scale=true)
	{
		return defaultDimensioning.pixelToCm(pixel, apply_scale);
	}

	static cmFromMeasureRaw(measure)
	{
		return defaultDimensioning.cmFromMeasureRaw(measure);
	}

	static cmFromMeasure(measure)
	{
		return defaultDimensioning.cmFromMeasure(measure);
	}

	static cmToMeasureRaw(cm, power=1)
	{
		return defaultDimensioning.cmToMeasureRaw(cm, power);
	}

	/**
	 * Set the decimal separator every static call writes (RM-014 L3, Z-4).
	 *
	 * A static because the 224 existing call sites are statics, and they read
	 * the module default - the same reason `Configuration.setValue` is one.
	 *
	 * @param {string} value
	 */
	static setDecimalSeparator(value)
	{
		defaultDimensioning.decimalSeparator = value;
	}

	static cmToMeasure(cm, power=1)
	{
		return defaultDimensioning.cmToMeasure(cm, power);
	}
}

/** What every static call above measures with: the default configuration. */
export const defaultDimensioning = new Dimensioning();
