// @ts-check
import {MeshStandardMaterial} from 'three';
import {newSink, box, rotateAboutY, appendInto, finishGeometry} from './solid_builder.js';

/**
 * A door, a window or an archway, described by numbers (RM-008 F1).
 *
 * ## The finding this exists to answer
 *
 * RM-009 U-4: the save file has no door in it. `Item.getMetaData` writes a mesh
 * URL and three scale factors, so "900 mm wide" is recorded as "0.927 times
 * whatever `closed-door28x80_baked.glb` happens to be", a window's height above
 * the floor is derived from the mesh at placement and never stated, and
 * `rotation` is a single y angle - so a hinge side and a swing angle have
 * nowhere to live at all. That is why the plan has drawn the same swing arc for
 * every door since RM-008 E1, and said so in its own docblock.
 *
 * And U-1: the whole door-and-window vocabulary is ten meshes, seven of which
 * arrive between 3.0 and 3.9 metres tall to be cut into a wall 2.5 metres high.
 * Four of them measure identically because they are not doors at all, they are
 * wall panels with an opening in them.
 *
 * ## Numbers first, geometry second
 *
 * Five numbers and two choices - width, height, sill, hinge side, swing angle,
 * kind and style - are the whole description. The plan symbol, the hole in the
 * wall and the 3D frame are all *derived* from them, which is the property that
 * makes them agree by construction rather than by care.
 *
 * The ordering is deliberate and it is what RM-009 F1 committed to: this module
 * and its round trip land before a single triangle is generated. A procedural
 * door sized from a loaded mesh's bounding box would be U-4 again wearing a new
 * file's name.
 *
 * ## Centimetres, like everything else
 *
 * Every number here is centimetres, matching the model layer and the save
 * format. `sill` is the height of the opening's *bottom* above the floor, which
 * is how a window is specified and how a building drawing states it; a door's
 * sill is zero. The centre - which is what an `Item`'s position needs - is
 * derived, never stored, so the two cannot disagree.
 */

/** A door: a frame, a leaf, and a swing. */
export const OPENING_DOOR = 'door';
/** A window: a frame, a sash and a pane, sitting on a sill. */
export const OPENING_WINDOW = 'window';
/** An opening with nothing in it. F2's archways and pass-throughs. */
export const OPENING_ARCH = 'arch';

/** Which side the hinge is on, looking at the door from the room it opens into. */
export const HINGE_LEFT = 'left';
export const HINGE_RIGHT = 'right';

/** The kinds this build knows. Anything else in a file is read as a door. */
export const OPENING_KINDS = Object.freeze([OPENING_DOOR, OPENING_WINDOW, OPENING_ARCH]);

/**
 * What each kind starts at, in centimetres.
 *
 * A 900 x 2100 door and a 1200 x 1200 window on a 900 sill are the sizes a
 * domestic drawing uses by default in most of the world, and they are round
 * numbers in millimetres rather than the inch-derived 97 x 222 the one mesh
 * door in the catalog happens to be.
 */
export const OPENING_DEFAULTS = Object.freeze({
	[OPENING_DOOR]: Object.freeze({width: 90, height: 210, sill: 0, hinge: HINGE_LEFT, swing: 90}),
	[OPENING_WINDOW]: Object.freeze({width: 120, height: 120, sill: 90, hinge: HINGE_LEFT, swing: 0}),
	[OPENING_ARCH]: Object.freeze({width: 100, height: 210, sill: 0, hinge: HINGE_LEFT, swing: 0}),
});

/** How thick a frame member is, in centimetres. */
const FRAME_DEPTH_MARGIN = 2;
const FRAME_WIDTH = 5;
/** How thick a door leaf or a window sash is. */
const LEAF_THICKNESS = 4;
/** How thick the glazing is. Thin, but not zero: a zero-thickness box has no faces. */
const PANE_THICKNESS = 0.6;
/**
 * @typedef {Object} Opening
 * @property {string} kind One of {@link OPENING_KINDS}.
 * @property {number} width Centimetres.
 * @property {number} height Centimetres.
 * @property {number} sill Height of the opening's bottom above the floor, cm.
 * @property {string} hinge {@link HINGE_LEFT} or {@link HINGE_RIGHT}.
 * @property {number} swing Degrees the leaf stands open, 0 to 180.
 * @property {string} style A name the generator understands; 'plain' for now.
 */

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} [max]
 * @returns {number}
 */
function number(value, fallback, min, max)
{
	if (typeof value !== 'number' || !isFinite(value))
	{
		return fallback;
	}
	var limited = Math.max(min, value);
	return (max === undefined) ? limited : Math.min(max, limited);
}

/**
 * Read a record into a complete, usable description (RM-008 F1).
 *
 * Total: anything missing takes the kind's default and anything unusable takes
 * it too. That is the same leniency `Floorplan._buildFloorplan` applies to a
 * wall record, and for the same reason - `DesignDocument.parse` has already
 * refused the shapes that cannot be drawn, and everything past that point is a
 * file this build should open.
 *
 * @param {*} record
 * @returns {Opening}
 */
export function normaliseOpening(record)
{
	var source = (record && typeof record === 'object') ? record : {};
	var kind = (OPENING_KINDS.indexOf(source.kind) >= 0) ? source.kind : OPENING_DOOR;
	var defaults = OPENING_DEFAULTS[kind];
	return {
		kind: kind,
		// A one-centimetre floor rather than zero: a zero-width opening is a hole
		// with no area, which draws nothing and cuts nothing, and a person who
		// typed 0 has made a mistake rather than a request.
		width: number(source.width, defaults.width, 1),
		height: number(source.height, defaults.height, 1),
		sill: number(source.sill, defaults.sill, 0),
		hinge: (source.hinge === HINGE_RIGHT) ? HINGE_RIGHT : HINGE_LEFT,
		swing: number(source.swing, defaults.swing, 0, 180),
		style: (typeof source.style === 'string' && source.style) ? source.style : 'plain',
	};
}

/**
 * A fresh opening of a kind, at that kind's defaults.
 * @param {string} kind
 * @returns {Opening}
 */
export function newOpening(kind)
{
	return normaliseOpening({kind: kind});
}

/**
 * The rectangle this opening cuts, in the wall's own coordinates (RM-008 F1).
 *
 * `centre` is the height of the opening's middle above the floor, which is what
 * an `Item`'s y position wants, derived from the sill and the height rather
 * than stored beside them - so the two cannot drift.
 *
 * @param {Opening} opening
 * @returns {{width: number, height: number, centre: number, bottom: number, top: number}}
 */
export function openingRectangle(opening)
{
	return {
		width: opening.width,
		height: opening.height,
		bottom: opening.sill,
		top: opening.sill + opening.height,
		centre: opening.sill + opening.height / 2,
	};
}

/**
 * Fit an opening inside the wall it is being cut into (RM-009 U-2).
 *
 * The finding this closes is not that an oversized opening looks wrong - it is
 * that it does not fail at all. `ShapeGeometry` triangulates a wall outline and
 * its holes together, so a hole taller than the wall is *merged into the
 * outline*: a 300 x 387 opening in a 400 x 250 wall produces a mesh 387 tall.
 * The wall grows 137 cm to swallow it, nothing warns, and the plan is unaffected
 * because it draws the graph rather than the mesh. That is why nobody noticed
 * that seven of the ten catalog openings were unusable.
 *
 * Clamped rather than refused, because refusing would mean an item that cannot
 * be placed and a person with no way to see why. The clamp keeps the opening's
 * bottom where it was asked for whenever it can, and only then trims the top.
 *
 * @param {Opening} opening
 * @param {number} wallHeight Centimetres.
 * @returns {Opening} The same object when nothing had to move.
 */
export function clampOpening(opening, wallHeight)
{
	if (!(wallHeight > 0))
	{
		return opening;
	}
	var rectangle = openingRectangle(opening);
	if (rectangle.top <= wallHeight)
	{
		return opening;
	}
	var sill = Math.max(0, Math.min(opening.sill, wallHeight - 1));
	return Object.assign({}, opening, {
		sill: sill,
		height: Math.max(1, wallHeight - sill),
	});
}
/**
 * The box builder `buildOpeningGeometry` runs on lives in `solid_builder.js`.
 *
 * It was written here for F1 and moved out by F3, unchanged, when stairs became
 * its second caller - see that file's docblock for what the move discovered.
 */

/**
 * Build the mesh for an opening (RM-008 F1).
 *
 * Local coordinates, centred on the opening's own middle: x across the wall,
 * y up, z through the wall. That is the frame `Item` expects - its constructor
 * recentres any geometry on its bounding box anyway - and it means the caller
 * places the item at `openingRectangle(opening).centre` above the floor and
 * nothing else.
 *
 * A door's leaf is drawn *open at its swing angle*, hinged on the side the
 * description names, which is what makes the 3D view and the plan symbol two
 * drawings of one number instead of two conventions.
 *
 * @param {Opening} opening
 * @param {number} wallThickness Centimetres; the frame is set into it.
 * @returns {{geometry: import('three').BufferGeometry, materials: Array<MeshStandardMaterial>}}
 */
export function buildOpeningGeometry(opening, wallThickness)
{
	var depth = Math.max(4, (wallThickness || 10) + FRAME_DEPTH_MARGIN);
	var sink = newSink();
	var w = opening.width;
	var h = opening.height;
	var jamb = Math.min(FRAME_WIDTH, w / 3);
	var head = Math.min(FRAME_WIDTH, h / 3);

	// The frame: two jambs and a head, and a sill for a window. An arch gets the
	// jambs and head too - it is a lined opening, not a hole in plaster.
	box(sink, -(w - jamb) / 2, 0, 0, jamb, h, depth, 0);
	box(sink, (w - jamb) / 2, 0, 0, jamb, h, depth, 0);
	box(sink, 0, (h - head) / 2, 0, w - jamb * 2, head, depth, 0);
	if (opening.kind === OPENING_WINDOW)
	{
		box(sink, 0, -(h - head) / 2, 0, w - jamb * 2, head, depth, 0);
	}

	var innerWidth = w - jamb * 2;
	var innerHeight = h - head * (opening.kind === OPENING_WINDOW ? 2 : 1);
	var innerCentre = (opening.kind === OPENING_WINDOW) ? 0 : -head / 2;

	if (opening.kind === OPENING_DOOR)
	{
		// The leaf, hinged and standing open at its angle. Modelled as a box
		// rotated about the hinge edge rather than a rotated child object, because
		// `Item` takes one geometry and the swing is a property of the description
		// rather than of the scene graph.
		var swing = (opening.swing * Math.PI) / 180;
		var sign = (opening.hinge === HINGE_RIGHT) ? -1 : 1;
		var hingeX = sign * (innerWidth / 2);
		var leaf = newSink();
		box(leaf, -sign * (innerWidth / 2), 0, 0, innerWidth, innerHeight, LEAF_THICKNESS, 1);
		rotateAboutY(leaf.positions, leaf.normals, -sign * swing);
		appendInto(sink, leaf, hingeX, innerCentre, 0);
	}
	else if (opening.kind === OPENING_WINDOW)
	{
		box(sink, 0, innerCentre, 0, innerWidth, innerHeight, PANE_THICKNESS, 2);
	}
	// An arch has nothing in it, which is the whole point of an arch.

	return {
		geometry: finishGeometry(sink),
		materials: [
			new MeshStandardMaterial({color: 0xF2EFE9, roughness: 0.75, metalness: 0}),
			new MeshStandardMaterial({color: 0xE7E2D8, roughness: 0.7, metalness: 0}),
			new MeshStandardMaterial({color: 0xBFD6E4, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35}),
		],
	};
}

/**
 * The record written to a file.
 *
 * Explicit, per RM-008 T-6, and complete: unlike a wall's thickness there is no
 * document default for a door to fall back on, so every field is written for
 * every parametric opening. What makes this additive is that the whole `opening`
 * key is absent from an item that has none - which is every item in every file
 * written before F1.
 *
 * @param {Opening} opening
 * @returns {Record<string, any>}
 */
export function openingToJSON(opening)
{
	return {
		kind: opening.kind,
		width: opening.width,
		height: opening.height,
		sill: opening.sill,
		hinge: opening.hinge,
		swing: opening.swing,
		style: opening.style,
	};
}
