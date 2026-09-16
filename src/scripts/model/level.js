// @ts-check
import {Floorplan} from './floorplan.js';

/**
 * One storey of a building (RM-010 G1).
 *
 * ## Why a level is a floorplan rather than a field on one
 *
 * RM-007 priced this sprint as *"levels in the model with elevation and
 * height"*, which reads as a field on the things that already exist. RM-010 V-5
 * counted what that costs: `Floorplan` has **55 methods and 36 of them read one
 * of its seven collections**, so a level field is 36 filters and 36 places where
 * forgetting one shows up as furniture from the floor below appearing on this
 * one. Against that, N independent floorplans in one page is not a proposal -
 * it is an existing property with a browser suite over it, because RM-003 A1's
 * document-ownership work already made two `Model`s coexist.
 *
 * So a level *has* a `Floorplan` and a list of items, and every collection on
 * it is already scoped by construction.
 *
 * ## Height is stored, base elevation is derived
 *
 * A level carries one number: its **floor-to-floor height**. Where it sits is
 * the running sum of the heights below it, computed by `Model` and never
 * stored - the same rule that keeps a stair's height out of the file and an
 * opening's centre out of its record. A person specifies "2.8 m floor to
 * floor"; nobody specifies "this storey starts at 5.6 m".
 *
 * RM-010 V-4 is why this matters more than it looks: **nothing in the tree is
 * drawn at a base elevation.** Every floor sits at y = 0 and a corner's
 * `elevation` is the wall *top*, not the storey. A level's base is therefore a
 * number that did not exist, applied where the level's geometry joins the
 * scene - not inside `Floor`, `Edge` or `Item`, each of which already builds
 * relative to a plan it is handed.
 *
 * ## Plain data, deliberately
 *
 * No three.js here. The `Group` a level's meshes go into belongs to `Scene`,
 * which is where the one-way arrow puts the GPU, and it is positioned from the
 * base this file's owner derives.
 */

/**
 * Floor to floor, in centimetres.
 *
 * 280 is 250 of clear height - this build's wall default - plus 30 of floor
 * build-up, which is an ordinary domestic storey. It is also exactly what F3's
 * default flight climbs (16 treads at 175 mm), so a default stair on a default
 * level arrives at the floor above rather than near it. That is a coincidence
 * worth keeping rather than one worth relying on, and `tests/levels.test.js`
 * asserts it so that changing either default has to change the other on purpose.
 */
export const DEFAULT_LEVEL_HEIGHT = 280;

/** The bounds a storey stops being a storey outside of. */
export const MIN_LEVEL_HEIGHT = 100;
export const MAX_LEVEL_HEIGHT = 1000;

/**
 * The name a level gets when nobody has named it.
 *
 * Numbered from the ground the way a building is, not from zero the way an
 * array is: the ground floor, then the first floor above it. A basement is a
 * level below the ground one and takes a negative index in its name for the
 * same reason.
 *
 * @param {number} index Position in the level list, ground floor first.
 * @returns {string}
 */
export function defaultLevelName(index)
{
	if (index === 0)
	{
		return 'Ground floor';
	}
	return `Floor ${index}`;
}

var nextLevelId = 0;

/**
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function height(value, fallback)
{
	if (typeof value !== 'number' || !isFinite(value))
	{
		return fallback;
	}
	return Math.min(MAX_LEVEL_HEIGHT, Math.max(MIN_LEVEL_HEIGHT, value));
}

/** One storey: a floorplan, the furniture on it, and how tall it is. */
export class Level
{
	/**
	 * @param {?(import('../core/configuration.js').Configuration|import('../core/design_runtime.js').DesignRuntime)} [runtime]
	 *        This design's services, handed straight to the `Floorplan` - see
	 *        that constructor. Every level of one design shares one runtime.
	 * @param {Object} [options] `name` and `height`.
	 */
	constructor(runtime, options)
	{
		var settings = options || {};
		nextLevelId += 1;
		/**
		 * Identity, for the view to key a group by.
		 *
		 * Assigned rather than derived and deliberately **not persisted**: unlike
		 * an item, a level is identified in a file by its position in the list,
		 * because that position is what "the floor above" means. An id that
		 * survived a save would be a second answer to the same question.
		 *
		 * @type {string}
		 */
		this.id = `level-${nextLevelId}`;
		/** @type {string} */
		this.name = (typeof settings.name === 'string' && settings.name) ? settings.name : '';
		/** Floor to floor, centimetres. @type {number} */
		this.height = height(settings.height, DEFAULT_LEVEL_HEIGHT);
		/** @type {Floorplan} */
		this.floorplan = new Floorplan(runtime);
		/**
		 * The furniture standing on this level.
		 *
		 * Held here rather than in one flat list on `Scene` for the reason the
		 * floorplan is: a list that is scoped by construction cannot be read
		 * unscoped by accident.
		 *
		 * @type {Array<Object>}
		 */
		this.items = [];
	}

	/**
	 * Set the floor-to-floor height, clamped.
	 * @param {number} value
	 * @returns {number} What it took.
	 */
	setHeight(value)
	{
		this.height = height(value, this.height);
		return this.height;
	}

	/**
	 * The name to show, which is the one somebody typed or the one its position
	 * implies.
	 *
	 * Derived rather than defaulted at construction, because a level's position
	 * changes when one below it is removed - and a level called "Floor 2" sitting
	 * directly above the ground floor is worse than one with no name of its own.
	 *
	 * @param {number} index
	 * @returns {string}
	 */
	displayName(index)
	{
		return this.name || defaultLevelName(index);
	}
}
