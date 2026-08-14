// @ts-check
/**
 * The save-format version, and the comparison used to reason about it.
 *
 * ## What this is a version OF
 *
 * `getTechnicalVersion()` is the version stamped into every `.blueprint3d`
 * file, not the version of the package. They are separate on purpose: the
 * package moves whenever anything ships, and the format moves only when the
 * bytes change.
 *
 * ## The comparator, rewritten
 *
 * `isVersionHigherThan` used to compare its arguments the other way round from
 * the way its name reads. It computed, per component and as an AND,
 * `checkVersion[i] >= version[i]` - so it was true when the SECOND argument was
 * the newer one - and it returned the numbers 1 and 0 from `flag &=`, except on
 * two early-out paths that returned the boolean `false`.
 *
 * That was load-bearing in the worst way. `Floorplan.loadFloorplan` gated
 * curved-wall control points on it, so a file stamped anything newer than
 * 0.0.2a had every curve silently turned straight - which meant the format
 * version could never be bumped, for any reason. Three sprints deferred work
 * into a version field that could not be used.
 *
 * The load gate now reads the wall record rather than the version (see
 * floorplan.js), and this function does what its name says. It is a behaviour
 * change to a public API and it is deliberate: the old behaviour answered a
 * different question than the one it was named for, so no caller could have
 * been depending on it on purpose.
 *
 * Both functions parse leniently, because the versions in the wild do not
 * follow semver: '0.0.2a' has always been stamped with that trailing letter.
 * Non-digit characters are stripped, missing components count as 0, and
 * anything unparseable sorts as 0 rather than throwing.
 */

/**
 * The version stamped into files this build writes.
 *
 * 0.0.2a for the whole life of the project before this. 2.0.0 marks the format
 * becoming self-describing: coordinates are canonical centimetres and the file
 * carries a `units` field saying so (see Floorplan.saveFloorplan). Reading is
 * driven by that field rather than by this number, so an old file is still
 * recognised by what it contains; the bump is for humans and for tools.
 *
 * A major bump rather than a minor one because an older build reading a 2.0.0
 * file gets the coordinates wrong unless its display unit happens to be
 * centimetres - the change is not backwards compatible in that direction, and
 * saying so is what the number is for.
 */
const SAVE_FORMAT_VERSION = '2.0.0';

/**
 * Split a version string into numeric components.
 *
 * @param {string} version e.g. '0.0.2a', '2.0.0', '1.0'
 * @returns {?number[]} null if there is nothing to parse.
 */
function components(version)
{
	if (typeof version !== 'string' || version.length === 0)
	{
		return null;
	}
	return version.replace(/[^\d.]/g, '').split('.').map((part) =>
	{
		var value = parseInt(part, 10);
		return Number.isNaN(value) ? 0 : value;
	});
}

export class Version
{
	/**
	 * Order two version strings.
	 *
	 * Component-wise and left to right, with the shorter one padded with zeros,
	 * so '1.0' and '1.0.0' are equal and '1.0.0' is above '0.9.9'. The old
	 * comparison was a per-component AND, which made those two neither above nor
	 * below one another.
	 *
	 * @param {string} a
	 * @param {string} b
	 * @returns {number} -1 if a is older, 0 if equal, 1 if a is newer.
	 */
	static compare(a, b)
	{
		var left = components(a) || [];
		var right = components(b) || [];
		var length = Math.max(left.length, right.length);

		for (var i = 0; i < length; i++)
		{
			var one = left[i] || 0;
			var two = right[i] || 0;
			if (one !== two)
			{
				return (one > two) ? 1 : -1;
			}
		}
		return 0;
	}

	/**
	 * Is `version` strictly newer than `checkVersion`?
	 *
	 * @param {string} version The version being tested.
	 * @param {string} checkVersion The version to test it against.
	 * @returns {boolean} Always a boolean. An absent or unparseable `version`
	 * is treated as the oldest thing there is, so this is false.
	 */
	static isVersionHigherThan(version, checkVersion)
	{
		if (components(version) === null)
		{
			return false;
		}
		return Version.compare(version, checkVersion) > 0;
	}

	/**
	 * Is `version` at least `checkVersion`?
	 *
	 * The test most callers actually want - "can this build read that file" is a
	 * >= question, and writing it as `!isVersionHigherThan(check, version)` is
	 * how the original went wrong.
	 *
	 * @param {string} version
	 * @param {string} checkVersion
	 * @returns {boolean}
	 */
	static isVersionAtLeast(version, checkVersion)
	{
		if (components(version) === null)
		{
			return false;
		}
		return Version.compare(version, checkVersion) >= 0;
	}

	static getInformalVersion()
	{
		return SAVE_FORMAT_VERSION;
	}

	static getTechnicalVersion()
	{
		return SAVE_FORMAT_VERSION;
	}
}
