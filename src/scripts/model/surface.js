// @ts-check
/**
 * What a surface is made of (RM-011 H1).
 *
 * ## What was here before
 *
 * Three fields. A wall side carried `{url, stretch, scale}` and a room's floor
 * carried `{url, scale}`, and that was the whole description of every surface in
 * the building - RM-011 W-3 measured it. No colour, no rotation, no offset, no
 * second map, and no ceiling material at all, which is four of the clauses in
 * RM-007's gap Q-4.
 *
 * ## The shape of the addition
 *
 * A material is **beside** the texture, not instead of it. The three fields stay
 * exactly where they are and mean exactly what they meant; this adds five more
 * to the same record. That matters for one reason above all others: a build that
 * has never heard of materials opens a design that has them and draws the right
 * texture at the right scale, which is the same promise `levels` and `roof` make
 * one layer up.
 *
 * ## Written only where somebody changed something
 *
 * The rule E2's thickness, E3's dimensions, F1's opening, F3's stair, G1's
 * levels and G2's roof all follow, and the rule that makes M-26 achievable:
 * **a key is written when it differs from the default and not otherwise**. So a
 * design nobody has recoloured re-saves byte-identical, and `surfaceToJSON`
 * below is where that is enforced rather than at each of the three call sites.
 *
 * ## Why the maps are URLs and not a material id
 *
 * A library of materials is a catalog - a name, a thumbnail and some URLs - and
 * the temptation is to write the library's id into the file so a surface says
 * "oak_planks". That would make the save file depend on a library that ships
 * with the build, so a design saved against thirty materials would open wrong
 * against thirty-one. The file records what it uses, the catalog is a way of
 * *choosing*, and the resolver already turns a logical URL into whatever the
 * build actually serves (RM-003 A5). Same argument `newFloorTextures` already
 * settled for the albedo map.
 *
 * ## No roughness or metalness numbers here
 *
 * Deliberate, and RM-011 W-1 is why. The scalar roughness and metalness of a
 * wall and a floor are properties of the *render profile*, tuned per profile and
 * frozen for classic. A per-surface override would be a fourth place those
 * numbers live and the first one that could disagree with the parity grid. What
 * a surface may carry is a roughness *map*, which modulates the profile's value
 * rather than replacing it.
 */

/** A colour that multiplies nothing, which is what an untinted surface is. */
export const NO_TINT = '#ffffff';

/**
 * Everything a surface may say about itself beyond its albedo texture.
 *
 * Frozen, and every value here is the "nobody touched this" value - which is
 * what makes the conditional write below a one-line comparison rather than a
 * table of special cases.
 */
export const SURFACE_DEFAULTS = Object.freeze({
	/** Multiplied into the albedo, so white is no tint at all. */
	color: NO_TINT,
	/** Degrees, anticlockwise, about the centre of the texture's tile. */
	rotation: 0,
	/** Fractions of a tile, so 0.5 is half a repeat. */
	offsetX: 0,
	offsetY: 0,
	/** A tangent-space normal map, or null. */
	normalMap: null,
	/** A roughness map, or null. It modulates the profile's scalar. */
	roughnessMap: null,
});

/** The keys `surfaceToJSON` writes conditionally, in the order it writes them. */
const MATERIAL_KEYS = Object.freeze(['color', 'rotation', 'offsetX', 'offsetY', 'normalMap', 'roughnessMap']);

/** Rotation wraps; anything else is not a rotation. */
function angle(value)
{
	var number = Number(value);
	if (!isFinite(number))
	{
		return SURFACE_DEFAULTS.rotation;
	}
	return ((number % 360) + 360) % 360;
}

/** An offset is a fraction of a tile and wraps for the same reason a tile does. */
function fraction(value)
{
	var number = Number(value);
	if (!isFinite(number))
	{
		return 0;
	}
	// Kept in -1..1 rather than 0..1: somebody nudging a tile left expects a
	// negative number back, and the two are the same position.
	return number % 1;
}

/**
 * A six-digit hex colour, or the default.
 *
 * Three-digit hex is expanded rather than refused, because that is what a person
 * types and what half the CSS in this repository is written in.
 *
 * @param {*} value
 * @returns {string}
 */
function colour(value)
{
	if (typeof value !== 'string')
	{
		return SURFACE_DEFAULTS.color;
	}
	var text = value.trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(text))
	{
		return '#' + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
	}
	return /^#[0-9a-f]{6}$/.test(text) ? text : SURFACE_DEFAULTS.color;
}

/** A map URL, or null. An empty string is "no map", not a map called nothing. */
function mapUrl(value)
{
	return (typeof value === 'string' && value.trim()) ? value.trim() : null;
}

/**
 * @typedef {Object} SurfaceMaterial
 * @property {string} color Six-digit hex, `#ffffff` for no tint.
 * @property {number} rotation Degrees, 0 to 360.
 * @property {number} offsetX Fractions of a tile.
 * @property {number} offsetY
 * @property {?string} normalMap
 * @property {?string} roughnessMap
 */

/**
 * Read whatever a record says about its material, and fill in the rest.
 *
 * Total: a record with none of these keys is the default material, which is what
 * every surface in every file written before H1 is.
 *
 * @param {Object} [source] A texture record, or a partial material.
 * @returns {SurfaceMaterial}
 */
export function normaliseSurface(source)
{
	var record = source || {};
	return {
		color: colour(record.color),
		rotation: angle(record.rotation),
		offsetX: fraction(record.offsetX),
		offsetY: fraction(record.offsetY),
		normalMap: mapUrl(record.normalMap),
		roughnessMap: mapUrl(record.roughnessMap),
	};
}

/**
 * Whether this surface says anything a default surface does not.
 *
 * The predicate the conditional write is built on, exported because the plan,
 * the inspector and the tests all want to ask it and none of them should
 * re-derive it.
 *
 * @param {Object} [source]
 * @returns {boolean}
 */
export function isPlainSurface(source)
{
	var material = normaliseSurface(source);
	return MATERIAL_KEYS.every((key) => material[key] === SURFACE_DEFAULTS[key]);
}

/**
 * Copy the material keys onto a record, writing only what differs.
 *
 * Mutates and returns the record it is given, because every caller is building
 * a save object and would otherwise merge two objects itself. **This is the one
 * place that decides what reaches the file**, so the byte-identity promise is a
 * property of one function rather than of three call sites agreeing.
 *
 * @param {Object} record The `{url, stretch, scale}` object being written.
 * @param {Object} [source] What to read the material from; the record itself by
 *   default, which is where a loaded design keeps it.
 * @returns {Object} the same record
 */
export function writeSurfaceMaterial(record, source)
{
	var material = normaliseSurface(source === undefined ? record : source);
	MATERIAL_KEYS.forEach(function (key)
	{
		if (material[key] !== SURFACE_DEFAULTS[key])
		{
			record[key] = material[key];
		}
	});
	return record;
}

/**
 * The material as a record of its own, or null when it is the default.
 *
 * For a caller that wants the material separately from the texture - the
 * inspector, and the ceiling, which has no `{url, stretch, scale}` to sit
 * beside.
 *
 * @param {Object} [source]
 * @returns {?Object}
 */
export function surfaceToJSON(source)
{
	if (isPlainSurface(source))
	{
		return null;
	}
	return writeSurfaceMaterial({}, source);
}

/**
 * `#rrggbb` as the number three wants.
 *
 * Here rather than in `three/` because it is a property of the description -
 * the model says `#c8b48c` and every consumer needs the same 0xc8b48c - and
 * because putting it here keeps the one-way arrow: `three/edge.js` reads the
 * model, and the model still knows nothing about three.
 *
 * @param {string} hex
 * @returns {number}
 */
export function colorValue(hex)
{
	return parseInt(colour(hex).slice(1), 16);
}

/**
 * One colour multiplied by another, per channel.
 *
 * Because a tint is a multiply and two of the four surfaces already have a base
 * colour of their own: classic's floor is `0xcccccc` and a ceiling is the
 * profile's `roofColor`. Tinting them by *replacing* that colour would make
 * picking white a visible change, which is the opposite of what "no tint" means.
 *
 * @param {number} base
 * @param {number} tint
 * @returns {number}
 */
export function multiplyHex(base, tint)
{
	var r = Math.round(((base >> 16) & 0xff) * ((tint >> 16) & 0xff) / 255);
	var g = Math.round(((base >> 8) & 0xff) * ((tint >> 8) & 0xff) / 255);
	var b = Math.round((base & 0xff) * (tint & 0xff) / 255);
	return (r << 16) | (g << 8) | b;
}
