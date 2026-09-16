// @ts-check
import {FloorItem} from './floor_item.js';
import {normaliseStair, buildStairGeometry, stairMetrics, stairPlan, stairwellHint, stairToJSON} from './stair.js';

/**
 * A flight of stairs generated from its numbers (RM-008 F3).
 *
 * ## Why a new type rather than a change to `FloorItem`
 *
 * The same argument F1 made for item type 10, and the same answer: every design
 * already on somebody's disk holds the four mesh stairs, and they have to go on
 * opening and re-saving byte-identically. So this is item type **11**, appended
 * to the nine the factory knows, and nothing about the existing ones moves.
 *
 * ## What it does *not* need to override, and why that is the interesting part
 *
 * F1's `ParametricOpening` overrides `objectHalfSize()`, and had to: a door's
 * leaf is drawn standing open, so a 90 cm door has an 86 cm-deep bounding box
 * and a size read off the mesh would cut an 86 cm hole through the wall. The
 * drawn thing escapes the described thing.
 *
 * A flight's does not. `buildStairGeometry` sizes the handrail and its posts so
 * that neither reaches past the run it serves, so the mesh's plan rectangle is
 * the flight's plan rectangle to the millimetre, and it centres the mesh on its
 * own extent so the underside lands on the floor. With those two properties the
 * inherited `objectHalfSize` - half the bounding box - is already the right
 * answer, and an override would be a second statement of the same number with
 * somewhere to drift to.
 *
 * That is the honest report on the interface RM-009 asked F3 to test: the
 * generator moved out cleanly (`solid_builder.js`), and the item class needed
 * *less* than F1's, not more.
 */
export class ParametricStair extends FloorItem
{
	/**
	 * @param {Object} model
	 * @param {Object} metadata Carries `stair`, the description.
	 * @param {import('three').BufferGeometry} geometry
	 * @param {*} material
	 * @param {import('three').Vector3} [position]
	 * @param {number} [rotation]
	 * @param {import('three').Vector3} [scale]
	 */
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super(model, metadata, geometry, material, position, rotation, scale);
		/**
		 * The flight this is (see `stair.js`).
		 *
		 * Held here rather than on `metadata` because it is edited: the inspector
		 * writes a going and the mesh, the footprint, the stairwell hint and the
		 * saved record all follow from the same object.
		 *
		 * @type {import('./stair.js').Stair}
		 */
		this.stair = normaliseStair(metadata.stair);
		// Never proportional: rise, going and width are independent numbers, and
		// tying them together would make "one more tread" also make it wider.
		this.resizeProportionally = false;
	}

	/**
	 * What the flight measures (RM-008 F3, M-37).
	 * @returns {ReturnType<typeof stairMetrics>}
	 */
	metrics()
	{
		return stairMetrics(this.stair);
	}

	/**
	 * The flight as the plan draws it, in the item's own frame.
	 * @returns {ReturnType<typeof stairPlan>}
	 */
	stairFootprint()
	{
		return stairPlan(this.stair);
	}

	/**
	 * The rectangle a floor above would have to open (RM-008 F3).
	 *
	 * Recorded for G2 and not acted on: nothing in `three/` reads this, because
	 * there is nothing above the flight to cut. The plan draws it dashed, which
	 * is what makes it a hint somebody can see rather than a comment.
	 *
	 * @returns {ReturnType<typeof stairwellHint>}
	 */
	stairwell()
	{
		return stairwellHint(this.stair);
	}

	/**
	 * Replace the description and rebuild (RM-008 F3).
	 *
	 * @param {Partial<import('./stair.js').Stair>} changes
	 * @returns {import('./stair.js').Stair} What the item took.
	 */
	setStair(changes)
	{
		var next = normaliseStair(Object.assign({}, this.stair, changes || {}));
		if (JSON.stringify(next) === JSON.stringify(this.stair))
		{
			return this.stair;
		}
		this.stair = next;
		this.rebuild();
		return this.stair;
	}

	/**
	 * Regenerate the mesh for the current description.
	 *
	 * The old geometry is disposed rather than dropped: RM-003 A0 spent a sprint
	 * on this class of leak, and a flight whose tread count is edited from a
	 * number field regenerates on every keystroke.
	 *
	 * @returns {void}
	 */
	rebuild()
	{
		var built = buildStairGeometry(this.stair);
		var previous = this.geometry;
		this.geometry = built.geometry;
		this.material = built.materials;
		if (previous && typeof previous.dispose === 'function' && previous !== built.geometry)
		{
			previous.dispose();
		}
		this.halfSize = this.objectHalfSize();
		// `FloorItem.resized` is the one that keeps a flight standing on the floor
		// rather than sunk into it: it sets the origin to half the mesh height,
		// and the mesh is centred on its own extent.
		this.resized();
		if (this.model && this.model.scene)
		{
			this.model.scene.needsUpdate = true;
		}
	}

	/**
	 * The saved record, with the description on it (RM-008 T-6).
	 *
	 * The whole `stair` key is what makes this additive: an item that has none
	 * writes none, which is every item in every file written before F3.
	 *
	 * @returns {Record<string, any>}
	 */
	getMetaData()
	{
		var data = super.getMetaData();
		data.stair = stairToJSON(this.stair);
		return data;
	}
}
