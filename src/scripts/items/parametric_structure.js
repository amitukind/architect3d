// @ts-check
import {Vector3} from 'three';
import {FloorItem} from './floor_item.js';
import {
	normaliseStructure, buildStructureGeometry, structureExtent, structureToJSON,
} from './structure.js';

/**
 * A column or a beam generated from its numbers (RM-008 F2, delivered after F3).
 *
 * ## Item type 12
 *
 * Appended, like 10 and 11 before it, and never filling the gaps at 5 and 6: a
 * type number is written into every save file, so one that used to mean
 * something else is a trap and a gap is only untidy.
 *
 * ## The third time this class of bug has come up, and the first time it was
 * expected
 *
 * F1 measured a 210 cm door hanging 20 cm above the floor, because
 * `WallItem.boundMove` derives an in-wall item's height from its own size.
 * F3 measured a railed flight that would have floated 45 cm, because
 * `FloorItem.resized` puts the origin at half the *mesh* and the mesh is taller
 * than the flight. Both were found by placing one in a live page.
 *
 * A beam is the same shape of problem stated in advance: `FloorItem.resized`
 * sets `position.y = halfSize.y`, which stands everything on the floor, and a
 * beam's whole point is that it is not on the floor. So the two methods that
 * decide an item's height are overridden with the number the description
 * already carries, and the browser tier asserts a beam's soffit rather than
 * trusting that it was thought of.
 *
 * A column needs no override at all - its soffit is zero and half its height is
 * exactly what `FloorItem` would have computed - which is why the override is
 * written against `structureExtent().centre` rather than against `kind`.
 */
export class ParametricStructure extends FloorItem
{
	/**
	 * @param {Object} model
	 * @param {Object} metadata Carries `structure`, the description.
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
		 * The member this is (see `structure.js`).
		 *
		 * @type {import('./structure.js').Structure}
		 */
		this.structure = normaliseStructure(metadata.structure);
		// Never proportional: a 300 mm column that gets taller does not get wider.
		this.resizeProportionally = false;
		this.halfSize = this.objectHalfSize();
		// Set here as well as in `resized()`, because those are different paths and
		// only this one covers all of them. `resized()` runs on an edit and
		// `placeInRoom()` on a fresh drop with a floor under the pointer, but an
		// item added with no placement hint at all goes through neither - and a
		// loaded item arrives with a y from the file, which is derivable and
		// therefore should not be trusted over the description. The first draft
		// overrode `boundMove` instead; `FloorItem` does not have one, so it was a
		// method nothing would ever have called.
		this.position.y = this.elevation();
	}

	/**
	 * The member's extent, from its numbers.
	 *
	 * Overridden for the reason F1's was and F3's was not: the generated mesh is
	 * exactly the described solid, so the bounding box would answer correctly -
	 * but a round column's box is the circumscribed square and a caller asking
	 * "how wide is this" should get the diameter, which is the same number by
	 * construction only while the polygon happens to have a vertex on each axis.
	 * Reading it from the description removes the "happens to".
	 *
	 * @returns {Vector3} Half extents, in centimetres.
	 */
	objectHalfSize()
	{
		// Called by `Item`'s constructor before this subclass has assigned
		// `this.structure`; falling back to the geometry there is right, because
		// the value is replaced a line later.
		if (!this.structure)
		{
			return super.objectHalfSize();
		}
		var extent = structureExtent(this.structure);
		return new Vector3(extent.halfX, extent.halfY, extent.halfZ);
	}

	/**
	 * How high the member's middle sits above the floor.
	 *
	 * Guarded for the same window `objectHalfSize()` above is guarded for, and
	 * the omission was a shipped bug rather than a hypothetical one: `Item`'s
	 * constructor calls `setScale()` whenever a scale is supplied, `setScale()`
	 * calls `resized()`, and `resized()` is this. The catalog path supplies no
	 * scale, so placing a column worked; **the load path supplies the saved
	 * `scale_x/y/z`, so no file containing a column or a beam has ever opened** -
	 * `Cannot read properties of undefined (reading 'kind')`, thrown out of
	 * `structureExtent`. Found by loading G3's three-storey fixture, which is the
	 * first saved design in this repository to contain one.
	 *
	 * The fallback is what `FloorItem` would have done unaided, and it stands for
	 * one statement: the constructor assigns `this.structure` and then sets
	 * `position.y` from it directly.
	 *
	 * @returns {number}
	 */
	elevation()
	{
		if (!this.structure)
		{
			return this.halfSize.y;
		}
		return structureExtent(this.structure).centre;
	}

	/**
	 * Stand it at its soffit rather than on the floor.
	 *
	 * `FloorItem.resized` is `position.y = halfSize.y`, which is right for a
	 * column and wrong for every beam.
	 *
	 * @returns {void}
	 */
	resized()
	{
		this.position.y = this.elevation();
	}

	/**
	 * Drop it into the room at its soffit.
	 *
	 * `FloorItem.placeInRoom` measures the mesh and halves it, for the same
	 * reason and with the same result.
	 *
	 * @returns {void}
	 */
	placeInRoom()
	{
		super.placeInRoom();
		this.position.y = this.elevation();
	}

	/**
	 * Replace the description and rebuild.
	 *
	 * @param {Partial<import('./structure.js').Structure>} changes
	 * @returns {import('./structure.js').Structure} What the item took.
	 */
	setStructure(changes)
	{
		var next = normaliseStructure(Object.assign({}, this.structure, changes || {}));
		if (JSON.stringify(next) === JSON.stringify(this.structure))
		{
			return this.structure;
		}
		this.structure = next;
		this.rebuild();
		return this.structure;
	}

	/**
	 * Regenerate the mesh for the current description.
	 *
	 * The old geometry is disposed rather than dropped: RM-003 A0 spent a sprint
	 * on this class of leak, and a member whose depth is edited from a number
	 * field regenerates on every keystroke.
	 *
	 * @returns {void}
	 */
	rebuild()
	{
		var built = buildStructureGeometry(this.structure);
		var previous = this.geometry;
		this.geometry = built.geometry;
		this.material = built.materials;
		if (previous && typeof previous.dispose === 'function' && previous !== built.geometry)
		{
			previous.dispose();
		}
		this.halfSize = this.objectHalfSize();
		this.resized();
		if (this.model && this.model.scene)
		{
			this.model.scene.needsUpdate = true;
		}
	}

	/**
	 * The saved record, with the description on it (RM-008 T-6).
	 * @returns {Record<string, any>}
	 */
	getMetaData()
	{
		var data = super.getMetaData();
		data.structure = structureToJSON(this.structure);
		return data;
	}
}
