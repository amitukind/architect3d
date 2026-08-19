// @ts-check
import {MeshStandardMaterial} from 'three';
import {newSink, box, finishGeometry} from './solid_builder.js';

/**
 * A column or a beam, described by numbers (RM-008 F2, delivered after F3).
 *
 * ## Why this lands late, and on purpose
 *
 * F2 shipped without it and said so: *"they need a new item class, a new type
 * number, catalog rows, an inspector and their own round-trip tests - an
 * F1-sized slice rather than the line RM-007 makes them look like - and
 * shipping a new persisted item type without tests would be worse than not
 * shipping it."* This is that slice, cleared before programme G starts.
 *
 * ## One description, two things
 *
 * A column is a beam stood on end, and rather than be clever about that the
 * description says which it is and derives the rest, the way `opening.js` says
 * door, window or arch. What the two share is the shape of the numbers: a
 * **cross-section** of `width` by `depth`, a **length** along the axis, and a
 * **soffit** - the height of the underside above the floor.
 *
 * `depth` is the second cross-section dimension, always measured perpendicular
 * to the axis. For a column the axis is vertical, so the cross-section lies in
 * plan and `depth` is a plan dimension; for a beam the axis is horizontal, so
 * `depth` is the vertical one. That is not a coincidence being exploited - it
 * is exactly what those two words mean on a structural drawing, and a beam's
 * depth being its vertical dimension is the reason the word is used that way.
 *
 * ## Round is a column's, not a beam's
 *
 * A round column is common and it is one primitive. A round *beam* is a pipe,
 * and nobody draws one on a floor plan. So `section` is a column's choice, the
 * way `hinge` and `swing` are a door's - the same arrangement F1 used for the
 * fields that only one kind has.
 *
 * ## Centimetres, like everything else
 */

/** Stands up. Its length is its height, and its soffit is the floor. */
export const STRUCTURE_COLUMN = 'column';
/** Lies down. Its length is its span, and its soffit is its underside. */
export const STRUCTURE_BEAM = 'beam';

/** The kinds this build knows. Anything else in a file is read as a column. */
export const STRUCTURE_KINDS = Object.freeze([STRUCTURE_COLUMN, STRUCTURE_BEAM]);

export const SECTION_RECTANGULAR = 'rectangular';
export const SECTION_ROUND = 'round';
export const STRUCTURE_SECTIONS = Object.freeze([SECTION_RECTANGULAR, SECTION_ROUND]);

/**
 * What each kind starts at, in centimetres.
 *
 * A 300 x 300 mm column 2500 tall and a 200 x 400 mm beam spanning 3000 with
 * its soffit at 2100 - so its top lands on a 2500 wall's head. Round numbers in
 * millimetres and real member sizes, the same convention as F1's 900 x 2100
 * door and F3's 175 x 250 step.
 */
export const STRUCTURE_DEFAULTS = Object.freeze({
	[STRUCTURE_COLUMN]: Object.freeze({width: 30, depth: 30, length: 250, soffit: 0, section: SECTION_RECTANGULAR}),
	[STRUCTURE_BEAM]: Object.freeze({width: 20, depth: 40, length: 300, soffit: 210, section: SECTION_RECTANGULAR}),
});

/**
 * How many sides a round column is drawn with.
 *
 * Twenty-four is the point where the facets stop reading as facets at the size
 * a column is drawn, and it is 48 triangles for the shaft - cheap enough that
 * there is no reason to make it a setting somebody has to think about.
 */
const ROUND_SIDES = 24;

/**
 * @typedef {Object} Structure
 * @property {string} kind One of {@link STRUCTURE_KINDS}.
 * @property {number} width Cross-section, across the axis, centimetres.
 * @property {number} depth Cross-section, the other way. A beam's is vertical.
 * @property {number} length Along the axis: a column's height, a beam's span.
 * @property {number} soffit Height of the underside above the floor, cm.
 * @property {string} section {@link SECTION_RECTANGULAR} or {@link SECTION_ROUND}; a column's choice.
 * @property {string} style A name the generator understands; 'plain' for now.
 */

/**
 * @param {*} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function number(value, fallback, min, max)
{
	if (typeof value !== 'number' || !isFinite(value))
	{
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}

/**
 * Read a record into a complete, usable member.
 *
 * Total, like `normaliseOpening` and `normaliseStair`, and for the same reason:
 * `DesignDocument.parse` has already refused the shapes that cannot be drawn.
 *
 * A round column's `depth` is forced to its `width`, because a round section
 * has one dimension and storing two would let a file say something a circle
 * cannot be. That is the same rule the rest of this tree follows - a number
 * that can be derived is not stored beside the thing it derives from.
 *
 * @param {*} record
 * @returns {Structure}
 */
export function normaliseStructure(record)
{
	var source = (record && typeof record === 'object') ? record : {};
	var kind = (STRUCTURE_KINDS.indexOf(source.kind) >= 0) ? source.kind : STRUCTURE_COLUMN;
	var defaults = STRUCTURE_DEFAULTS[kind];
	var section = (kind === STRUCTURE_COLUMN && source.section === SECTION_ROUND)
		? SECTION_ROUND : SECTION_RECTANGULAR;
	var width = number(source.width, defaults.width, 1, 500);
	return {
		kind: kind,
		width: width,
		depth: (section === SECTION_ROUND) ? width : number(source.depth, defaults.depth, 1, 500),
		length: number(source.length, defaults.length, 1, 2000),
		soffit: number(source.soffit, defaults.soffit, 0, 2000),
		section: section,
		style: (typeof source.style === 'string' && source.style) ? source.style : 'plain',
	};
}

/**
 * A fresh member of a kind, at that kind's defaults.
 * @param {string} kind
 * @returns {Structure}
 */
export function newStructure(kind)
{
	return normaliseStructure({kind: kind});
}

/**
 * Where the member sits and how big it is, all derived.
 *
 * `halfX`, `halfY` and `halfZ` are the item's extent before rotation, and
 * `centre` is the height of its middle above the floor - which is what an
 * `Item`'s y position needs. Nothing here is stored twice: turn a column into a
 * beam and every one of these changes because the axis did.
 *
 * @param {Structure} structure
 * @returns {{halfX: number, halfY: number, halfZ: number, rise: number, centre: number, top: number}}
 */
export function structureExtent(structure)
{
	var vertical = (structure.kind === STRUCTURE_COLUMN);
	// The dimension that goes up: a column's length, a beam's depth.
	var rise = vertical ? structure.length : structure.depth;
	return {
		halfX: structure.width / 2,
		halfY: rise / 2,
		halfZ: (vertical ? structure.depth : structure.length) / 2,
		rise: rise,
		centre: structure.soffit + rise / 2,
		top: structure.soffit + rise,
	};
}

/**
 * Whether this member is drawn above the plan's cut plane.
 *
 * A floor plan is a horizontal section about a metre above the floor. A column
 * is cut by it and is drawn solid; a beam is above it and is drawn dashed. That
 * is the convention on every building drawing, and it is the whole reason the
 * plan symbol distinguishes them.
 *
 * @param {Structure} structure
 * @returns {boolean}
 */
export function isOverhead(structure)
{
	return structure.kind === STRUCTURE_BEAM;
}

/**
 * Build the mesh (RM-008 F2, on F1's generator).
 *
 * The **third** caller of `solid_builder.js`, and the first to need something
 * the first two did not: a round column is not a box. That is the seam being
 * tested a second time, and the answer this time was a new primitive in the
 * shared file rather than a special case here - `prism`, which a box could also
 * have been and deliberately is not, because `box` has correct per-face UVs and
 * two callers already.
 *
 * Centred on itself, so the caller places it at `structureExtent().centre`
 * above the floor and nothing else.
 *
 * @param {Structure} structure
 * @returns {{geometry: import('three').BufferGeometry, materials: Array<MeshStandardMaterial>}}
 */
export function buildStructureGeometry(structure)
{
	var extent = structureExtent(structure);
	var sink = newSink();
	if (structure.section === SECTION_ROUND)
	{
		prism(sink, 0, 0, 0, structure.width / 2, extent.rise, ROUND_SIDES, 0);
	}
	else
	{
		box(sink, 0, 0, 0, extent.halfX * 2, extent.halfY * 2, extent.halfZ * 2, 0);
	}
	return {
		geometry: finishGeometry(sink),
		materials: [new MeshStandardMaterial({color: 0xCFC9BE, roughness: 0.9, metalness: 0})],
	};
}

/**
 * A vertical n-sided prism, centred on the origin.
 *
 * Kept here rather than in `solid_builder.js` for now: it has one caller, and
 * the rule that file's docblock states is that a piece moves there when a
 * second caller wants it. F3 learned that the hard way in the other direction -
 * `box` sat private in `opening.js` until stairs needed it - so the marker is
 * this comment rather than a premature move.
 *
 * @param {import('./solid_builder.js').BufferSink} sink
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} radius
 * @param {number} height
 * @param {number} sides
 * @param {number} materialIndex
 */
function prism(sink, cx, cy, cz, radius, height, sides, materialIndex)
{
	var start = sink.indices.length;
	var half = height / 2;
	var i;
	// The shaft: one quad per side, each with its own outward normal, so the
	// facets shade as facets rather than as a smoothed cylinder that is lying
	// about how many sides it has.
	for (i = 0; i < sides; i++)
	{
		var a = (i / sides) * Math.PI * 2;
		var b = ((i + 1) / sides) * Math.PI * 2;
		var ax = Math.cos(a) * radius;
		var az = Math.sin(a) * radius;
		var bx = Math.cos(b) * radius;
		var bz = Math.sin(b) * radius;
		var nx = Math.cos((a + b) / 2);
		var nz = Math.sin((a + b) / 2);
		var base = sink.positions.length / 3;
		sink.positions.push(cx + ax, cy - half, cz + az, cx + bx, cy - half, cz + bz,
			cx + bx, cy + half, cz + bz, cx + ax, cy + half, cz + az);
		for (var n = 0; n < 4; n++)
		{
			sink.normals.push(nx, 0, nz);
		}
		sink.uvs.push(i / sides, 0, (i + 1) / sides, 0, (i + 1) / sides, 1, i / sides, 1);
		sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	// The two caps, as fans about a centre vertex.
	[half, -half].forEach(function (y, cap)
	{
		var centre = sink.positions.length / 3;
		sink.positions.push(cx, cy + y, cz);
		sink.normals.push(0, cap === 0 ? 1 : -1, 0);
		sink.uvs.push(0.5, 0.5);
		for (var k = 0; k <= sides; k++)
		{
			var angle = (k / sides) * Math.PI * 2;
			sink.positions.push(cx + Math.cos(angle) * radius, cy + y, cz + Math.sin(angle) * radius);
			sink.normals.push(0, cap === 0 ? 1 : -1, 0);
			sink.uvs.push(0.5 + Math.cos(angle) / 2, 0.5 + Math.sin(angle) / 2);
		}
		for (var j = 0; j < sides; j++)
		{
			if (cap === 0)
			{
				sink.indices.push(centre, centre + j + 2, centre + j + 1);
			}
			else
			{
				sink.indices.push(centre, centre + j + 1, centre + j + 2);
			}
		}
	});
	sink.groups.push({start: start, count: sink.indices.length - start, material: materialIndex});
}

/**
 * The record written to a file (RM-008 T-6).
 *
 * Explicit and complete, like `openingToJSON` and `stairToJSON`. What makes it
 * additive is that the whole `structure` key is absent from an item that has
 * none - which is every item in every file written before this.
 *
 * @param {Structure} structure
 * @returns {Record<string, any>}
 */
export function structureToJSON(structure)
{
	return {
		kind: structure.kind,
		width: structure.width,
		depth: structure.depth,
		length: structure.length,
		soffit: structure.soffit,
		section: structure.section,
		style: structure.style,
	};
}
