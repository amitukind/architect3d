// @ts-check
import {Item} from './item.js';
import {Utils} from '../core/utils.js';
import {Configuration, collisionWarnings} from '../core/configuration.js';

/**
 * A Floor Item is an entity to be placed related to a floor.
 */
export class FloorItem extends Item
{
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super(model, metadata, geometry, material, position, rotation, scale);
		this._freePosition = false;
	}

	/** */
	placeInRoom()
	{
		if (!this.position_set)
		{
			var center = this.floorplan.getCenter();
			this.position.x = center.x;
			this.position.z = center.z;
			// `bounds()` rather than `geometry.boundingBox`, which is null until
			// something computes it - see Item.bounds (RM-005 C2).
			var box = this.bounds();
			this.position.y = 0.5 * (box.max.y - box.min.y);
		}
	}

	/** Take action after a resize */
	resized()
	{
		this.position.y = this.halfSize.y;
	}

	/** */
	moveToPosition(vec3)
	{
		// keeps the position in the room and on the floor
		// No argument since RM-020 S-11: neither this class's override nor the
		// base reads one, and passing a position to a predicate that ignores it
		// is how the override kept looking like it did something.
		if (!this.isValidPosition())
		{
			this.showError(vec3);
			return;
		}
		else
		{
			this.hideError();
			vec3.y = this.position.y; // keep it on the floor!
			super.moveToPosition(vec3);
			// After the move, never instead of it (RM-012 J4). Collision is a
			// warning: `isValidPosition` above says in its own comment that placing
			// an item is up to the user, and eight programmes of saved designs were
			// made under that rule. Refusing a move now would make some of them
			// unopenable in the sense that matters - the furniture in them could no
			// longer be pushed around.
			this.warnOnCollision();
		}
	}

	/**
	 * Draw the error glow when this item overlaps another, and clear it when it
	 * does not (RM-012 J4).
	 *
	 * ## This is what makes `showError` reachable
	 *
	 * RM-012 recorded it as dead code: one caller, and that caller unreachable,
	 * because it sits behind `!this.isValidPosition(vec3)` and `isValidPosition`
	 * returns true on every path it has. The glow has existed since the fork with
	 * a comment claiming it fires. RM-007 gave J4 the choice - *"either the halo
	 * becomes the collision warning or it is deleted"* - and this is the first
	 * half. Nothing was written to draw a warning, because a warning was already
	 * drawn and nothing could reach it.
	 *
	 * ## Behind the flag, and off
	 *
	 * `Configuration`'s `collisionWarnings`, default false. This is the first
	 * thing in nine programmes to make a *correct* polygon predicate observable,
	 * and the four broken ones stay exactly where they are - so whether anybody
	 * sees the consequence is a decision somebody takes rather than one that
	 * arrives with an upgrade.
	 */
	warnOnCollision()
	{
		if (!Configuration.getNumericValue(collisionWarnings))
		{
			return;
		}
		if (this.collides())
		{
			this.showError(this.position);
		}
		else
		{
			this.hideError();
		}
	}

	/**
	 * Does this item's footprint overlap another's?
	 *
	 * Through `Utils.polygonsOverlap`, which is new in RM-012 J4 and written from
	 * the separating-axis theorem - not through any of the four predicates in the
	 * ledger, which are constant and stay that way. Floor items only: an item on
	 * a wall and an item on the floor share a footprint constantly and neither is
	 * in anybody's way.
	 *
	 * @returns {boolean}
	 */
	collides()
	{
		var items = (this.scene && typeof this.scene.getItems === 'function')
			? this.scene.getItems() : [];
		var mine = this.getCorners('x', 'z');
		for (var other of items)
		{
			if (other === this || !(other instanceof FloorItem) || typeof other.getCorners !== 'function')
			{
				continue;
			}
			if (Utils.polygonsOverlap(mine, other.getCorners('x', 'z')))
			{
				return true;
			}
		}
		return false;
	}

	/**
	 * Whether this item may sit at `vec3`. Always yes - deliberately.
	 *
	 * ## Why it is a constant, and why it stopped pretending otherwise
	 *
	 * A floor item may be placed anywhere: *"It is upto the user to place it
	 * anywhere he/she wants"* is the original comment, and it is still the
	 * policy. Obstruction between two items is a separate question, answered by
	 * `overlapsAnotherItem()` through `Utils.polygonsOverlap` (RM-012 J4).
	 *
	 * What used to be here reached that answer by accident (RM-020 S-11): a loop
	 * over every room, allocating a `Vector2` per room, asking
	 * `Utils.pointInPolygon` - which is one of the four predicates pinned
	 * constant-false in `core/utils.js` and can never say yes. So `isInARoom`
	 * could not become true, the `if (!isInARoom)` below it always returned true,
	 * and the block after that had been commented out since before the migration.
	 * The work was real; the branch was not.
	 *
	 * Kept as a method rather than deleted: `Item.isValidPosition` is the base
	 * this overrides, `FloorItem.moveToPosition` gates on it, and a subclass with
	 * a genuine constraint is the obvious next thing to want.
	 *
	 * @returns {boolean} Always true.
	 */
	isValidPosition()
	{
		return true;
	}
}
