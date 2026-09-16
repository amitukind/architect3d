// @ts-check
/**
 * A sun that knows what time it is (RM-011 H2).
 *
 * ## What this is and is not
 *
 * It is the *description* of a sun - a latitude, a day and an hour - plus the
 * arithmetic that turns those three numbers into a direction. It holds no
 * three.js types, touches no renderer and knows nothing about lights, which is
 * the one rule: `three/lights.js` reads this, and this reads nothing above it.
 *
 * It is **not** an ephemeris. The declination below is Cooper's equation and the
 * hour angle is local *solar* time, so there is no equation of time, no
 * longitude and no timezone: noon here means the sun is due south (in the
 * northern hemisphere), not that a clock somewhere says 12:00. For a tool whose
 * question is *"does the morning sun reach this room"* that is the honest model,
 * and the error - up to about 4° of hour angle across a year - is smaller than
 * the difference between two adjacent hours on the control that sets it.
 *
 * ## Presence is the switch
 *
 * There is no `enabled` field. A design with no sun has `Model.sun === null` and
 * its key light sits exactly where the render profile puts it, which is what
 * every design before H2 does and what `classic` keeps doing. Giving a design a
 * sun is what turns the sun on. Same shape `roof` uses, and for the same reason:
 * a flag that can disagree with the thing it flags is a second source of truth.
 *
 * ## The defaults describe themselves
 *
 * Latitude 45 on day 81 at hour 12 puts the sun at **exactly 45° of elevation**,
 * due south. That is not a coincidence and it is why those three numbers were
 * chosen: solar noon elevation is `90 - |latitude - declination|`, and day 81 is
 * where Cooper's equation below crosses zero - the March equinox as this model
 * reckons it, which is a day later than the calendar's and is the day that
 * matters, since it is the one the arithmetic here actually uses. 45 is halfway
 * from the equator to the pole. A default a reader can verify in their head
 * beats a plausible one, and the first draft of this used day 80 and landed at
 * 44.60 - close enough to look right and wrong enough to be worth catching.
 */

/** Degrees, and the tilt of the Earth's axis. */
const OBLIQUITY = 23.44;

const RADIANS = Math.PI / 180;

/**
 * @typedef {Object} Sun
 * @property {number} latitude Degrees north, -90 to 90. Negative is south.
 * @property {number} dayOfYear 1 to 365. No leap day: see the module comment.
 * @property {number} hour Local solar hour, 0 to 24. 12 is the sun due south.
 */

/** @type {Readonly<Sun>} */
export const SUN_DEFAULTS = Object.freeze({
	latitude: 45,
	dayOfYear: 81,
	hour: 12,
});

/** The keys `sunToJSON` writes conditionally, in the order it writes them. */
const SUN_KEYS = Object.freeze(['latitude', 'dayOfYear', 'hour']);

function clamp(value, low, high)
{
	return Math.min(high, Math.max(low, value));
}

/** A finite number, or the default. */
function number(value, fallback)
{
	var parsed = Number(value);
	return isFinite(parsed) ? parsed : fallback;
}

/**
 * Read whatever a record says about the sun, and fill in the rest.
 *
 * Total, like `normaliseSurface`: `{}` is the default sun rather than an error,
 * because `{}` is exactly what a design that took the defaults writes.
 *
 * @param {Object} [source]
 * @returns {Sun}
 */
export function normaliseSun(source)
{
	var record = source || {};
	return {
		latitude: clamp(number(record.latitude, SUN_DEFAULTS.latitude), -90, 90),
		// Rounded, because a fractional day is a distinction this model cannot
		// carry: declination moves about 0.4° a day and the hour control moves it
		// further than that.
		dayOfYear: clamp(Math.round(number(record.dayOfYear, SUN_DEFAULTS.dayOfYear)), 1, 365),
		// Wrapped rather than clamped, so that "an hour before midnight" and
		// "23:00" are the same instruction. The sun is below the horizon for a
		// good part of that range and `solarPosition` says so.
		hour: ((number(record.hour, SUN_DEFAULTS.hour) % 24) + 24) % 24,
	};
}

/**
 * The sun as a record of its own, or `{}` when it is entirely the default.
 *
 * Never null: a design *has* a sun or it does not, and that is `Model.sun`.
 * Once it has one, `{}` is a complete and meaningful description - "a sun, at
 * the defaults" - and writing it is how the file says the sun is on.
 *
 * @param {Object} [source]
 * @returns {Object}
 */
export function sunToJSON(source)
{
	var sun = normaliseSun(source);
	var record = {};
	SUN_KEYS.forEach(function (key)
	{
		if (sun[key] !== SUN_DEFAULTS[key])
		{
			record[key] = sun[key];
		}
	});
	return record;
}

/**
 * Where the sun is, given when and where you are.
 *
 * @param {Object} [source] A sun record; defaults are filled in.
 * @returns {{elevation: number, azimuth: number, up: boolean}} Degrees.
 *   `elevation` is above the horizon and goes negative at night. `azimuth` is
 *   clockwise from true north, so 180 is due south. `up` is the sign of
 *   elevation, named because every caller wants it and none should re-derive it.
 */
export function solarPosition(source)
{
	var sun = normaliseSun(source);
	var latitude = sun.latitude * RADIANS;

	// Cooper's equation. The 284 puts day 1 at the right place in the cycle;
	// declination is zero at the equinoxes and +-23.44 at the solstices.
	var declination = OBLIQUITY * RADIANS
		* Math.sin(2 * Math.PI * (284 + sun.dayOfYear) / 365);

	// 15 degrees an hour, negative before noon, which is what makes the azimuth
	// branch below a test of morning against afternoon.
	var hourAngle = (sun.hour - 12) * 15 * RADIANS;

	var sinElevation = clamp(
		Math.sin(latitude) * Math.sin(declination)
			+ Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
		-1, 1);
	var elevation = Math.asin(sinElevation);

	// Undefined when the sun is exactly overhead and the horizontal direction
	// stops meaning anything. Clamping the argument keeps `acos` real; the
	// azimuth it then returns is arbitrary, which is correct - at the zenith
	// there is no azimuth to be right about.
	var cosAzimuth = clamp(
		(Math.sin(declination) - sinElevation * Math.sin(latitude))
			/ Math.max(1e-9, Math.cos(elevation) * Math.cos(latitude)),
		-1, 1);
	var azimuth = Math.acos(cosAzimuth) / RADIANS;
	if (hourAngle > 0)
	{
		// Afternoon: the sun has crossed the meridian and is in the west.
		azimuth = 360 - azimuth;
	}

	return {
		elevation: elevation / RADIANS,
		azimuth: azimuth,
		up: elevation > 0,
	};
}

/**
 * Which way the sun is, in the world the 3D view draws.
 *
 * Two conventions meet here and both are already fixed, so this function is
 * where they are reconciled rather than where either is chosen:
 *
 *   - **North** is degrees clockwise from *up on the sheet* (RM-008 E3), and
 *     `floorplanner_view.drawNorthArrow` draws it that way.
 *   - **The plan's axes** are `x` across and `y` down the sheet, and
 *     `Floorplan.getDimensions` maps `corner.y` onto world `z`. So up on the
 *     sheet is world **-z**, and a bearing turns from -z towards +x.
 *
 * Putting those together: a bearing `b` measured clockwise from up points along
 * `(sin b, 0, -cos b)` in world space, and the sun's own bearing is the
 * building's north plus the sun's azimuth from north.
 *
 * @param {Object} [source] A sun record.
 * @param {number} [north] The building's north bearing, degrees clockwise from up.
 * @returns {{x: number, y: number, z: number, elevation: number, azimuth: number, up: boolean}}
 *   A unit vector pointing **at** the sun from anywhere in the scene, with the
 *   position that produced it, because every caller wants both.
 */
export function sunDirection(source, north)
{
	var position = solarPosition(source);
	var bearing = (number(north, 0) + position.azimuth) * RADIANS;
	var elevation = position.elevation * RADIANS;
	var horizontal = Math.cos(elevation);
	return {
		x: horizontal * Math.sin(bearing),
		y: Math.sin(elevation),
		z: -horizontal * Math.cos(bearing),
		elevation: position.elevation,
		azimuth: position.azimuth,
		up: position.up,
	};
}
