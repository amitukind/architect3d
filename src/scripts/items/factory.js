// @ts-check
import {Item} from './item.js';
import {FloorItem} from './floor_item.js';
import {WallItem} from './wall_item.js';
import {InWallItem} from './in_wall_item.js';
import {InWallFloorItem} from './in_wall_floor_item.js';
import {OnFloorItem} from './on_floor_item.js';
import {WallFloorItem} from './wall_floor_item.js';
import {RoofItem} from './roof_item.js';
import {ParametricOpening} from './parametric_opening.js';
import {ParametricStair} from './parametric_stair.js';

/**
 * Which class each item type number builds.
 *
 * 10 is RM-008 F1's parametric opening and 11 is F3's parametric stair, both
 * appended rather than filling one of the gaps at 5 and 6: the numbers are
 * compared across the library/application boundary and are written into every
 * save file, so a number that once meant something else is a trap, and a gap is
 * only untidy.
 */
export const item_types = {1: FloorItem, 2: WallItem, 3: InWallItem, 7: InWallFloorItem, 8: OnFloorItem, 9: WallFloorItem, 0: Item, 4: RoofItem, 10: ParametricOpening, 11: ParametricStair};

/** The item type a generated door, window or archway carries (RM-008 F1). */
export const ITEM_TYPE_PARAMETRIC_OPENING = 10;

/** The item type a generated flight of stairs carries (RM-008 F3). */
export const ITEM_TYPE_PARAMETRIC_STAIR = 11;

/** Factory class to create items. */
export class Factory
{
	/** Gets the class for the specified item. */
	static getClass(itemType)
	{
		return item_types[itemType];
	}
}
