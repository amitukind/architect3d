// @ts-check
import {MeshStandardMaterial, Vector3} from 'three';
import {newSink, box, face, finishGeometry} from './solid_builder.js';

/**
 * A roof over the building (RM-010 G2).
 *
 * ## There was not one
 *
 * RM-010 V-1 traversed every mesh of a loaded design and found what
 * `Floorplan.roofPlanes()` actually returns: **one plane per room**, a triangle
 * fan over that room's corners at their elevations - two triangles for a
 * four-corner room. That is a ceiling. There is no envelope over the building,
 * no pitch, no eaves, and nothing in the file that could describe one. So this
 * is the first roof this application has ever had, and there is nothing to
 * supersede: the per-room ceiling stays, because a ceiling and a roof are
 * different things and the ceiling is what you see from inside the room.
 *
 * ## Three kinds, one solid
 *
 * A gable and a hip are the **same construction** and differ in one number.
 * Both are the volume between a rectangle at eaves level and a ridge segment
 * above it; a hip's ridge is inset from the ends by the hip run, and a gable's
 * is not inset at all. Write it once with an inset and a gable is the inset-zero
 * case, with its two vertical triangular ends falling out rather than being
 * special-cased. A flat roof is a slab and is the one that genuinely differs.
 *
 * ## The footprint is the plan's bounding rectangle, and that is a limitation
 *
 * Stated rather than hidden. A gable or a hip over an arbitrary outline is a
 * straight-skeleton problem - genuinely hard, and not two weeks of a sprint that
 * also carries stairwells. What this generates is a roof over the bounding
 * rectangle of the plan plus an eaves overhang, which is right for the
 * rectangular houses most plans are and is a box over an L-shaped one.
 * `roofFootprint()` is a separate function for that reason: a later sprint can
 * make it a real outline without touching the generators.
 *
 * ## Centimetres and degrees
 */

/** A slab. Its pitch is ignored, because it does not have one. */
export const ROOF_FLAT = 'flat';
/** Two slopes to a ridge, with vertical triangular ends. */
export const ROOF_GABLE = 'gable';
/** Four slopes to a ridge inset from both ends. */
export const ROOF_HIP = 'hip';

export const ROOF_KINDS = Object.freeze([ROOF_FLAT, ROOF_GABLE, ROOF_HIP]);

/** Which way the ridge runs, in plan. */
export const RIDGE_X = 'x';
export const RIDGE_Z = 'z';
export const RIDGE_AXES = Object.freeze([RIDGE_X, RIDGE_Z]);

/**
 * What a new roof starts at.
 *
 * A 30-degree pitch and a 40 cm overhang: a common domestic slate or tile pitch
 * and an ordinary eaves projection. 20 cm of thickness is the roof mass rather
 * than a rafter depth - what this builds is a solid, not a construction.
 */
export const ROOF_DEFAULTS = Object.freeze({
	kind: ROOF_GABLE,
	pitch: 30,
	overhang: 40,
	thickness: 20,
	ridge: RIDGE_X,
});

export const MAX_PITCH = 60;

/**
 * @typedef {Object} Roof
 * @property {string} kind One of {@link ROOF_KINDS}.
 * @property {number} pitch Degrees from horizontal, 0 to 60. Ignored when flat.
 * @property {number} overhang How far the eaves project past the walls, cm.
 * @property {number} thickness The slab's depth, cm. Flat roofs only.
 * @property {string} ridge {@link RIDGE_X} or {@link RIDGE_Z}. Ignored when flat.
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
 * Read a record into a complete, usable roof.
 *
 * Total, like every other description in this directory.
 *
 * @param {*} record
 * @returns {Roof}
 */
export function normaliseRoof(record)
{
	var source = (record && typeof record === 'object') ? record : {};
	return {
		kind: (ROOF_KINDS.indexOf(source.kind) >= 0) ? source.kind : ROOF_DEFAULTS.kind,
		pitch: number(source.pitch, ROOF_DEFAULTS.pitch, 0, MAX_PITCH),
		overhang: number(source.overhang, ROOF_DEFAULTS.overhang, 0, 200),
		thickness: number(source.thickness, ROOF_DEFAULTS.thickness, 2, 100),
		ridge: (source.ridge === RIDGE_Z) ? RIDGE_Z : RIDGE_X,
	};
}

/** @param {string} kind @returns {Roof} */
export function newRoof(kind)
{
	return normaliseRoof({kind: kind});
}

/**
 * The rectangle a roof covers, in plan space (RM-010 G2).
 *
 * The bounding rectangle of every corner in every storey, grown by the eaves
 * overhang. Separate from the generators on purpose: making this a real
 * building outline is a straight-skeleton problem and a later sprint's, and
 * when it lands the three kinds should not have to change.
 *
 * @param {Array<{floorplan: Object}>} levels
 * @param {number} overhang Centimetres.
 * @returns {?{x0: number, y0: number, x1: number, y1: number, width: number, depth: number, cx: number, cy: number}}
 */
export function roofFootprint(levels, overhang)
{
	var x0 = Infinity;
	var y0 = Infinity;
	var x1 = -Infinity;
	var y1 = -Infinity;
	(levels || []).forEach(function (level)
	{
		var plan = level && level.floorplan;
		if (!plan || typeof plan.getCorners !== 'function')
		{
			return;
		}
		plan.getCorners().forEach(function (corner)
		{
			x0 = Math.min(x0, corner.x);
			y0 = Math.min(y0, corner.y);
			x1 = Math.max(x1, corner.x);
			y1 = Math.max(y1, corner.y);
		});
	});
	if (!isFinite(x0) || x1 <= x0 || y1 <= y0)
	{
		return null;
	}
	var grown = overhang || 0;
	return {
		x0: x0 - grown,
		y0: y0 - grown,
		x1: x1 + grown,
		y1: y1 + grown,
		width: (x1 - x0) + (grown * 2),
		depth: (y1 - y0) + (grown * 2),
		cx: (x0 + x1) / 2,
		cy: (y0 + y1) / 2,
	};
}

/**
 * How tall the roof stands above its eaves, and where its ridge is.
 *
 * The rise is the half-span times the tangent of the pitch, which is what a
 * pitch *means*; nothing stores a ridge height, so a pitch and a rise cannot
 * disagree. The hip inset equals the half-span too - that is what makes a hip's
 * end slopes the same pitch as its main ones, which is what a hip is.
 *
 * @param {Roof} roof
 * @param {{width: number, depth: number}} footprint
 * @returns {{span: number, run: number, rise: number, inset: number}}
 */
export function roofMetrics(roof, footprint)
{
	// The span is measured across the ridge; the run is along it.
	var alongX = (roof.ridge === RIDGE_X);
	var span = alongX ? footprint.depth : footprint.width;
	var run = alongX ? footprint.width : footprint.depth;
	var half = span / 2;
	var rise = (roof.kind === ROOF_FLAT) ? 0 : half * Math.tan((roof.pitch * Math.PI) / 180);
	var inset = (roof.kind === ROOF_HIP) ? Math.min(half, run / 2) : 0;
	return {span: span, run: run, rise: rise, inset: inset};
}

/**
 * Build the roof (RM-010 G2).
 *
 * Local coordinates centred on the footprint, with y = 0 at the eaves. The
 * caller places it at the top of the building and nothing else.
 *
 * @param {Roof} roof
 * @param {{width: number, depth: number}} footprint
 * @returns {{geometry: import('three').BufferGeometry, materials: Array<MeshStandardMaterial>}}
 */
export function buildRoofGeometry(roof, footprint)
{
	var sink = newSink();
	if (roof.kind === ROOF_FLAT)
	{
		// A slab, sitting on the eaves line rather than centred on it: a flat roof
		// is on top of the walls, not half in them.
		box(sink, 0, roof.thickness / 2, 0, footprint.width, roof.thickness, footprint.depth, 0);
	}
	else
	{
		pitched(sink, roof, footprint);
	}
	return {
		geometry: finishGeometry(sink),
		materials: [new MeshStandardMaterial({color: 0x6E5A4B, roughness: 0.85, metalness: 0})],
	};
}

/**
 * A gable or a hip: one solid, six vertices, five faces.
 *
 * Four eaves corners and two ridge points. A hip insets the ridge from both
 * ends and gets two sloped triangles; a gable does not inset it and gets two
 * vertical ones. That difference is the entire difference between the two, and
 * writing it as one number rather than as two functions is what keeps them from
 * drifting.
 *
 * @param {import('./solid_builder.js').BufferSink} sink
 * @param {Roof} roof
 * @param {{width: number, depth: number}} footprint
 */
function pitched(sink, roof, footprint)
{
	var metrics = roofMetrics(roof, footprint);
	var hw = footprint.width / 2;
	var hd = footprint.depth / 2;
	var alongX = (roof.ridge === RIDGE_X);
	// The ridge runs along one axis; the two ends are inset along it.
	var ridgeEnd = (alongX ? hw : hd) - metrics.inset;
	var a = alongX ? {x: -ridgeEnd, z: 0} : {x: 0, z: -ridgeEnd};
	var b = alongX ? {x: ridgeEnd, z: 0} : {x: 0, z: ridgeEnd};
	var ridgeA = {x: a.x, y: metrics.rise, z: a.z};
	var ridgeB = {x: b.x, y: metrics.rise, z: b.z};

	// Eaves, anticlockwise seen from above.
	var e = [
		{x: -hw, y: 0, z: -hd},
		{x: hw, y: 0, z: -hd},
		{x: hw, y: 0, z: hd},
		{x: -hw, y: 0, z: hd},
	];

	// The two main slopes, and the two ends. Which eaves pair belongs to which
	// depends on the ridge axis, and that is the only place the axis is read.
	var slopes = alongX
		? [[e[0], e[1], ridgeB, ridgeA], [e[2], e[3], ridgeA, ridgeB]]
		: [[e[1], e[2], ridgeB, ridgeA], [e[3], e[0], ridgeA, ridgeB]];
	var ends = alongX
		? [[e[3], e[0], ridgeA], [e[1], e[2], ridgeB]]
		: [[e[0], e[1], ridgeA], [e[2], e[3], ridgeB]];

	// A gable and a hip are both convex, so "outward" has an exact meaning: away
	// from the solid's own centre. Every face is emitted through that rather than
	// wound by hand, which is four chances to get a sign wrong - and the first
	// draft got all four, producing slope normals pointing DOWN into the roof.
	var centre = {x: 0, y: metrics.rise / 3, z: 0};
	slopes.concat(ends).forEach(function (points) {outwardFace(sink, points, centre);});
	outwardFace(sink, e, centre);
}

/**
 * Emit a face wound so its normal points away from a reference point.
 *
 * Exact for a convex solid, which a gable and a hip both are: a face of a
 * convex body has the whole body on one side of it, so "away from the centre"
 * and "outward" are the same direction.
 *
 * @param {import('./solid_builder.js').BufferSink} sink
 * @param {Array<{x: number, y: number, z: number}>} points
 * @param {{x: number, y: number, z: number}} centre
 */
function outwardFace(sink, points, centre)
{
	var normal = normalOf(points);
	var middle = points.reduce(function (sum, point)
	{
		return {x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length};
	}, {x: 0, y: 0, z: 0});
	var outward = ((middle.x - centre.x) * normal.x)
		+ ((middle.y - centre.y) * normal.y)
		+ ((middle.z - centre.z) * normal.z);
	if (outward < 0)
	{
		face(sink, points.slice().reverse(), {x: -normal.x, y: -normal.y, z: -normal.z}, 0);
		return;
	}
	face(sink, points, normal, 0);
}

/**
 * The outward normal of a wound convex face.
 *
 * Computed rather than stated, because a hip's four slopes each point somewhere
 * different and writing them out would be four chances to get a sign wrong.
 *
 * @param {Array<{x: number, y: number, z: number}>} points
 * @returns {{x: number, y: number, z: number}}
 */
function normalOf(points)
{
	var a = new Vector3(points[1].x - points[0].x, points[1].y - points[0].y, points[1].z - points[0].z);
	var b = new Vector3(points[2].x - points[0].x, points[2].y - points[0].y, points[2].z - points[0].z);
	var n = a.cross(b).normalize();
	return {x: n.x, y: n.y, z: n.z};
}

/**
 * The record written to a file (RM-008 T-6).
 *
 * Additive and conditional at the call site: a design with no roof writes no
 * `roof` key, which is every design written before G2.
 *
 * @param {Roof} roof
 * @returns {Record<string, any>}
 */
export function roofToJSON(roof)
{
	return {
		kind: roof.kind,
		pitch: roof.pitch,
		overhang: roof.overhang,
		thickness: roof.thickness,
		ridge: roof.ridge,
	};
}
