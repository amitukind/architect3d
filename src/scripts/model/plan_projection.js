// @ts-check

/**
 * What the 2D plan is allowed to know about the furniture (RM-008 E1, T-1).
 *
 * ## The problem this exists to solve
 *
 * `BlueprintJS` hands the 2D view `model.floorplan` and nothing else
 * (`blueprint.js:234`), and a `Floorplan` has six own properties - runtime,
 * walls, corners, rooms, metaroomsdata, floorTextures. There is no `model` and
 * no `scene` on it, measured rather than assumed: RM-008 T-1 constructed one in
 * a live page and read the keys back. So the plan cannot reach an item even in
 * principle, which is why it has never drawn one.
 *
 * Three ways to close that, and this is the third:
 *
 *   1. Pass the `Model` into `Floorplanner2D`. Widens a public constructor and
 *      points the view at a whole document to read one list.
 *   2. Give `Floorplan` a back-reference to `Model`. Puts the scene inside the
 *      layer whose entire discipline is that it holds plain data with no DOM
 *      and no GPU - and every test that builds a bare `Floorplan` would then be
 *      building half a document.
 *   3. A projection. `Model` derives this list and hands it to the floorplan as
 *      DATA; the view draws what it was given.
 *
 * The third adds no coupling, changes no constructor, and - the reason it is
 * worth the file - can be tested without a canvas, a renderer or a browser.
 * The five files E1 touches are the least-covered in the library (T-3), so a
 * contract that is exercisable headlessly is not a nicety here.
 *
 * ## Why a footprint is not an Item
 *
 * Deliberately plain: numbers, strings and booleans, no three.js types, no
 * methods, nothing that can be mutated into affecting the scene. A footprint is
 * a DESCRIPTION of an item at a moment, the same way a saved design describes a
 * wall by its corners rather than by a reference to one. Two consequences that
 * are both wanted:
 *
 *   - The plan cannot accidentally become a second editor of the scene. To
 *     change an item it has to say so through the command interface, which is
 *     one place and is auditable.
 *   - A projection can be compared. `M-23` asserts that the number of
 *     footprints equals the number of items, per fixture - a claim that is only
 *     checkable because the projection is data rather than a live view onto the
 *     scene graph.
 *
 * ## Coordinates
 *
 * Plan space, centimetres, `y` being the 3D `z` - the same convention every
 * `Corner`, `Wall` and `Room` in this layer already uses, and the same one
 * `Item.getCorners('x', 'z')` returns. Rotation is `Item.rotation.y` in
 * radians, carried as the item's own angle rather than baked into corners, so
 * the drawing code can rotate a rectangle instead of stroking a polygon and so
 * a hit test can un-rotate a point instead of running a polygon predicate.
 * That last part matters: the polygon predicates in `core/utils.js` are pinned
 * constants (four PRESERVED BUGS) and nothing new should be built on them.
 */

/**
 * One item, as the plan needs to see it.
 *
 * @typedef {Object} ItemFootprint
 * @property {string} id The item's `designId` - the same identity a saved file
 *           carries and the same one `useSelection` resolves against, so a
 *           footprint clicked on the plan names an item the rest of the
 *           application already knows how to find.
 * @property {number} x Centre in plan space, centimetres.
 * @property {number} y Centre in plan space, centimetres (the 3D `z`).
 * @property {number} elevation Height of the item's centre above the floor,
 *           centimetres (the 3D `y`). Not used to draw the footprint; carried
 *           because a wall cabinet and a rug occupy the same plan rectangle and
 *           only this separates them.
 * @property {number} halfWidth Half the item's extent along its own x, before
 *           rotation, centimetres.
 * @property {number} halfDepth Half the item's extent along its own z, before
 *           rotation, centimetres.
 * @property {number} rotation Radians about the vertical axis.
 * @property {number} type The `item_type` from the catalog - which class built
 *           it, and therefore how the plan should draw it. Wall-bound types
 *           (2, 3, 7, 9) are drawn against the wall run rather than as free
 *           boxes.
 * @property {string} label The item's name, for the caption.
 * @property {boolean} fixed Locked in place.
 * @property {?string} edgeId The half edge a wall-bound item is attached to, or
 *           null. Lets the plan draw an opening in the right wall without
 *           searching for the nearest one.
 */

/**
 * Read a number off a possibly-absent object without inventing one.
 *
 * An item that is still loading has `halfSize` (0,0,0) and no geometry, and an
 * item built by a test may have neither. Both are legitimate - `Scene.addItem`
 * dispatches EVENT_ITEM_LOADED and the projection is recomputed - so this
 * returns 0 rather than throwing or skipping the item. A footprint with zero
 * extent draws nothing and hit-tests to nothing, which is the honest picture of
 * an item whose size is not known yet.
 *
 * @param {*} source
 * @param {string} axis
 * @returns {number}
 */
function coordinate(source, axis)
{
	if (!source)
	{
		return 0;
	}
	var value = source[axis];
	return (typeof value === 'number' && isFinite(value)) ? value : 0;
}

/**
 * Describe one item for the plan.
 *
 * Tolerant by construction: everything it reads is optional, because this runs
 * against items mid-load, items built by hand in tests, and - through
 * `projectItems` - whatever a future item class puts on itself. An item that
 * cannot answer any of it still gets a footprint, at the origin with no size,
 * rather than being dropped: a missing footprint is a picture that silently
 * disagrees with the item count, and M-23 exists to catch exactly that.
 *
 * @param {Object} item An `Item`, or anything shaped like one.
 * @returns {ItemFootprint}
 */
export function projectItem(item)
{
	var metadata = (item && item.metadata) ? item.metadata : {};
	var edge = (item && item.currentWallEdge) ? item.currentWallEdge : null;
	return {
		id: (item && item.designId) ? String(item.designId) : '',
		x: coordinate(item && item.position, 'x'),
		y: coordinate(item && item.position, 'z'),
		elevation: coordinate(item && item.position, 'y'),
		halfWidth: Math.abs(coordinate(item && item.halfSize, 'x')),
		halfDepth: Math.abs(coordinate(item && item.halfSize, 'z')),
		rotation: coordinate(item && item.rotation, 'y'),
		type: (typeof metadata.itemType === 'number') ? metadata.itemType : 0,
		label: (typeof metadata.itemName === 'string') ? metadata.itemName : '',
		fixed: Boolean(item && item.fixed),
		edgeId: (edge && typeof edge.id === 'string') ? edge.id : null,
	};
}

/**
 * Describe every item for the plan.
 *
 * Ordered by `id` rather than by scene order, for the same reason the save file
 * is (see `Model.exportSerialized`): scene order is the order model downloads
 * finished in, so two projections of a design nobody touched could otherwise
 * differ, and a test that compares them would be testing the network.
 *
 * @param {Array<Object>} items
 * @returns {Array<ItemFootprint>}
 */
export function projectItems(items)
{
	if (!items || !items.length)
	{
		return [];
	}
	return items
		.map(projectItem)
		.sort(function (a, b) {return (a.id < b.id) ? -1 : ((a.id > b.id) ? 1 : 0);});
}

/**
 * Whether a point in plan space is inside a footprint.
 *
 * Un-rotates the point about the footprint's centre and compares against the
 * half extents, which is the whole test: a rotated rectangle is an axis-aligned
 * one in its own frame. Deliberately NOT built on `Utils.pointInPolygon`, which
 * is a pinned constant-false (see the predicate ledger in `core/utils.js`) - a
 * new feature must not depend on a bug that is preserved on purpose, and this
 * needs no polygon at all.
 *
 * @param {ItemFootprint} footprint
 * @param {number} x Plan space, centimetres.
 * @param {number} y Plan space, centimetres.
 * @param {number} [tolerance] Extra margin in centimetres, so a thin item can
 *        still be picked at a low zoom. Defaults to none.
 * @returns {boolean}
 */
export function footprintContains(footprint, x, y, tolerance)
{
	var margin = tolerance || 0;
	var dx = x - footprint.x;
	var dy = y - footprint.y;
	var cos = Math.cos(-footprint.rotation);
	var sin = Math.sin(-footprint.rotation);
	var localX = (dx * cos) - (dy * sin);
	var localY = (dx * sin) + (dy * cos);
	return Math.abs(localX) <= (footprint.halfWidth + margin)
		&& Math.abs(localY) <= (footprint.halfDepth + margin);
}

/**
 * The four corners of a footprint in plan space, in order.
 *
 * For drawing and for anything that wants the outline rather than the centre.
 * `Item.getCorners` answers the same question from the live item; this answers
 * it from the description, so the 2D view needs no item.
 *
 * @param {ItemFootprint} footprint
 * @returns {Array<{x: number, y: number}>}
 */
export function footprintCorners(footprint)
{
	var cos = Math.cos(footprint.rotation);
	var sin = Math.sin(footprint.rotation);
	var w = footprint.halfWidth;
	var d = footprint.halfDepth;
	return [
		{x: -w, y: -d},
		{x: w, y: -d},
		{x: w, y: d},
		{x: -w, y: d},
	].map(function (corner)
	{
		return {
			x: footprint.x + (corner.x * cos) - (corner.y * sin),
			y: footprint.y + (corner.x * sin) + (corner.y * cos),
		};
	});
}
