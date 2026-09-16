// @ts-check
/**
 * A catalog item that emits light (RM-011 H2, W-11).
 *
 * ## The sixth key
 *
 * RM-011 W-11 counted the catalog: all 168 entries carry exactly `format`,
 * `image`, `model`, `name` and `type`, **eight of them are named like lamps**,
 * and not one carries anything a renderer could read. So "light-emitting lamps
 * by catalog metadata" is a sixth key on a file six suites assert over, and the
 * drawing priced it as schema work rather than as lighting work. This is that
 * schema, and it follows exactly the shape `opening`, `stair` and `structure`
 * already set: the catalog row states only what differs from the defaults here,
 * the item fills the rest in, and the record is saved with the item so a design
 * carries its own lamps rather than depending on a catalog that may have moved
 * on.
 *
 * ## Lumens, because a person knows what one is
 *
 * `brightness` is in **lumens** - a 60 W incandescent is about 800, an LED
 * downlight about 500 - and three converts: `PointLight.power` is documented in
 * lumens and its setter is `intensity = power / (4 * PI)` for an isotropic
 * source. So the catalog says a number anybody can check against a box in a shop
 * and nothing here does arithmetic three already does correctly.
 *
 * ## Where the bulb is, as a fraction
 *
 * `at` is a fraction of the item's own height, not a distance. A floor lamp's
 * bulb is near its top and a pendant's is near its bottom, and both stay true
 * when somebody resizes the model - which a stored centimetre offset would not.
 * Nothing about the bulb's position is stored in a design: it is derived from
 * the item's own bounding box every time, which is the rule this project has
 * followed since a stair stopped storing its height.
 *
 * ## No shadows, and that is a decision
 *
 * A shadow-casting point light is six shadow-map renders - a cube - and a room
 * with four lamps in it would be twenty-four. `three/lights.js` already declined
 * the same trade for the fill light: *"two shadow maps for a fill light is not a
 * trade worth making"*. The key light casts the shadows; lamps light surfaces.
 */

/** A warm bulb. Not white: an unfiltered white lamp reads as a fluorescent tube. */
export const LAMP_COLOR = '#ffe9c4';

/**
 * @typedef {Object} Lamp
 * @property {string} color Six-digit hex.
 * @property {number} brightness Lumens.
 * @property {number} range Centimetres at which the light has fallen to nothing.
 * @property {number} at Where the bulb sits, as a fraction of the item's height.
 */

/** @type {Readonly<Lamp>} */
export const LAMP_DEFAULTS = Object.freeze({
	color: LAMP_COLOR,
	// About a 60 W incandescent, which is what most of these models are drawn as.
	brightness: 800,
	// Three metres. Beyond that a domestic bulb is not lighting anything, and a
	// finite range is what keeps the shader's work local.
	range: 300,
	// Near the top, which is where a floor lamp and a table lamp both put it.
	// A pendant states its own.
	at: 0.85,
});

/** The keys `lampToJSON` writes conditionally, in the order it writes them. */
const LAMP_KEYS = Object.freeze(['color', 'brightness', 'range', 'at']);

function number(value, fallback, low, high)
{
	var parsed = Number(value);
	if (!isFinite(parsed))
	{
		return fallback;
	}
	return Math.min(high, Math.max(low, parsed));
}

/** Six-digit hex, three-digit expanded, anything else the default. */
function colour(value)
{
	if (typeof value !== 'string')
	{
		return LAMP_DEFAULTS.color;
	}
	var text = value.trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(text))
	{
		return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
	}
	return /^#[0-9a-f]{6}$/.test(text) ? text : LAMP_DEFAULTS.color;
}

/**
 * Read whatever a row or a saved item says about its lamp, and fill in the rest.
 *
 * Total: `{}` is a default lamp, which is what a catalog row saying only "this
 * one is a lamp" means.
 *
 * @param {Object} [source]
 * @returns {Lamp}
 */
export function normaliseLamp(source)
{
	var record = source || {};
	return {
		color: colour(record.color),
		// No upper bound worth inventing - a stadium floodlight is 100,000 lumens
		// and refusing it would be a taste judgement wearing a validator's coat.
		// Zero is allowed and means a lamp that is switched off.
		brightness: number(record.brightness, LAMP_DEFAULTS.brightness, 0, 1e6),
		range: number(record.range, LAMP_DEFAULTS.range, 1, 1e5),
		at: number(record.at, LAMP_DEFAULTS.at, 0, 1),
	};
}

/**
 * The lamp as a record of its own, writing only what differs from the default.
 *
 * `{}` for a default lamp, and that is meaningful rather than empty for the same
 * reason `sun` is: the presence of the record is what says this item emits.
 *
 * @param {Object} [source]
 * @returns {Object}
 */
export function lampToJSON(source)
{
	var lamp = normaliseLamp(source);
	var record = {};
	LAMP_KEYS.forEach(function (key)
	{
		if (lamp[key] !== LAMP_DEFAULTS[key])
		{
			record[key] = lamp[key];
		}
	});
	return record;
}
