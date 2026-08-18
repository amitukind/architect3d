// @ts-check
import {Vector3} from 'three';
import {InWallItem} from './in_wall_item.js';
import {normaliseOpening, openingRectangle, buildOpeningGeometry, openingToJSON} from './opening.js';

/**
 * A door, a window or an archway generated from its numbers (RM-008 F1).
 *
 * ## Why a new type rather than a change to `InWallItem`
 *
 * Every design already on somebody's disk holds mesh doors, and they have to go
 * on opening and re-saving byte-identically. So this is item type **10**,
 * appended to the eight the factory already knows, and nothing about the
 * existing ones moves. A person who wants the catalog's mesh door keeps it; a
 * person who wants a 900 mm one gets this.
 *
 * ## Its size is its description, not its geometry
 *
 * `Item.objectHalfSize` measures the loaded mesh's bounding box, which is the
 * right answer for a chair and the wrong one here for a reason that is easy to
 * miss: **a door's leaf is drawn open**. A 90 cm door standing 90 degrees open
 * has a bounding box 86 cm deep, so a size read off the geometry would cut an
 * 86 cm hole through the wall, hand the plan an 86 cm-deep footprint to draw,
 * and give it an 86 cm-deep target to pick.
 *
 * The leaf sticking out is drawing. The *extent* is the opening: its width, its
 * height, and the thickness of the wall it is set into. That is what this
 * returns, and it is why RM-009 F1 put the description before the generator.
 */
export class ParametricOpening extends InWallItem
{
	/**
	 * @param {Object} model
	 * @param {Object} metadata Carries `opening`, the description.
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
		 * The five numbers and two choices this item is (see `opening.js`).
		 *
		 * Held here rather than on `metadata` because it is edited: the inspector
		 * writes a width and the geometry, the hole and the plan symbol all follow
		 * from the same object. `metadata` is what the loader was told; this is
		 * what the item is.
		 *
		 * @type {import('./opening.js').Opening}
		 */
		this.opening = normaliseOpening(metadata.opening);
		/** The wall thickness the current geometry was built for. */
		this._builtForThickness = (metadata.wallThickness > 0) ? metadata.wallThickness : 10;
		// Never proportional: width, height and depth are independent numbers here,
		// and tying them together would make "make it 10 cm wider" also make it
		// taller.
		this.resizeProportionally = false;
		this.halfSize = this.objectHalfSize();
	}

	/**
	 * The opening's extent, from its numbers.
	 *
	 * @returns {Vector3} Half extents, in centimetres.
	 */
	objectHalfSize()
	{
		// Called by `Item`'s constructor before this subclass has assigned
		// `this.opening`, which is unavoidable - a base constructor runs first.
		// Falling back to the geometry there is right: the value is replaced a
		// line later, and a half-built item that throws is worse than one that
		// briefly measures its own mesh.
		if (!this.opening)
		{
			return super.objectHalfSize();
		}
		return new Vector3(
			this.opening.width / 2,
			this.opening.height / 2,
			this._builtForThickness / 2);
	}

	/**
	 * The rectangle this cuts in its wall, in wall coordinates (RM-008 F1).
	 *
	 * The whole point of the sprint, in one method: `three/edge.js` asks the item
	 * for this instead of measuring its bounding box, so the hole and the drawing
	 * are two consequences of one description rather than two measurements of one
	 * mesh that may disagree.
	 *
	 * @returns {{width: number, height: number, centre: number, bottom: number, top: number}}
	 */
	wallOpening()
	{
		return openingRectangle(this.opening);
	}

	/**
	 * Replace the description and rebuild (RM-008 F1).
	 *
	 * Everything downstream follows: the geometry is regenerated, the extent is
	 * recomputed from the new numbers, the wall re-cuts its hole and the plan
	 * re-projects. A caller sets a width; it does not also have to know that four
	 * other things depend on it.
	 *
	 * @param {Partial<import('./opening.js').Opening>} changes
	 * @returns {import('./opening.js').Opening} What the item took.
	 */
	setOpening(changes)
	{
		var next = normaliseOpening(Object.assign({}, this.opening, changes || {}));
		if (JSON.stringify(next) === JSON.stringify(this.opening))
		{
			return this.opening;
		}
		this.opening = next;
		this.rebuild();
		return this.opening;
	}

	/**
	 * Regenerate the mesh for the current description and wall.
	 *
	 * The old geometry is disposed here and not merely dropped: RM-003 A0 spent a
	 * sprint on exactly this class of leak, and an item whose size is edited from
	 * a slider regenerates on every step.
	 *
	 * @returns {void}
	 */
	rebuild()
	{
		var thickness = this.currentWallEdge && this.currentWallEdge.wall
			? this.currentWallEdge.wall.thickness : this._builtForThickness;
		var built = buildOpeningGeometry(this.opening, thickness);
		var previous = this.geometry;
		this._builtForThickness = thickness;
		this.geometry = built.geometry;
		this.material = built.materials;
		if (previous && typeof previous.dispose === 'function' && previous !== built.geometry)
		{
			previous.dispose();
		}
		this.halfSize = this.objectHalfSize();
		// The centre of the opening is derived from the sill and the height, so
		// changing either moves the item - and the y position is the one thing a
		// caller must not have to compute for itself.
		this.position.y = openingRectangle(this.opening).centre;
		this.resized();
		if (this.model && this.model.scene)
		{
			this.model.scene.needsUpdate = true;
		}
		this.redrawWall();
	}

	/**
	 * Ask the wall this sits in to re-cut its hole.
	 *
	 * Guarded because an item can exist before it is bound to a wall - during a
	 * load, and in a test that builds one to read its numbers.
	 *
	 * @returns {void}
	 */
	redrawWall()
	{
		if (this.currentWallEdge && typeof this.currentWallEdge.redraw === 'function')
		{
			this.currentWallEdge.redraw();
		}
	}

	/**
	 * Rebuild for the wall it has just been attached to.
	 *
	 * A frame is set into the wall's thickness, so a door moved from a 10 cm wall
	 * to a 30 cm one is a different mesh.
	 *
	 * @param {Object} edge
	 */
	changeWallEdge(edge)
	{
		super.changeWallEdge(edge);
		if (edge && edge.wall && edge.wall.thickness !== this._builtForThickness)
		{
			this.rebuild();
		}
	}

	/**
	 * Where along and up the wall this sits (RM-008 F1).
	 *
	 * `WallItem.boundMove` decides an in-wall item's height from its own size -
	 * `sizeY / 2 + tolerance` - which for a 210 cm door puts its centre at 125 and
	 * therefore its bottom 20 cm above the floor. Measured in a live page, which
	 * is the only place this shows: a door hanging in the air.
	 *
	 * The height of an opening is its sill, and the centre is derived from the
	 * sill and the height. So the sideways clamp is inherited unchanged - a door
	 * still cannot be dragged past the end of its wall - and the vertical one is
	 * replaced by the number the description already carries.
	 *
	 * @param {import('three').Vector3} vec3
	 */
	boundMove(vec3)
	{
		super.boundMove(vec3);
		// The interior transform is a rotation about the vertical axis and a
		// translation in the plane, so height is the same number on both sides of
		// it - which is why this can be applied after the round trip rather than
		// inside it.
		vec3.y = openingRectangle(this.opening).centre;
	}

	/**
	 * The saved record, with the description on it (RM-008 T-6).
	 *
	 * The whole `opening` key is what makes this additive: an item that has none
	 * writes none, which is every item in every file written before F1.
	 *
	 * @returns {Record<string, any>}
	 */
	getMetaData()
	{
		var data = super.getMetaData();
		data.opening = openingToJSON(this.opening);
		return data;
	}
}
