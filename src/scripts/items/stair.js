// @ts-check
import {MeshStandardMaterial} from 'three';
import {newSink, box, rotateAboutX, rotateAboutY, appendInto, finishGeometry} from './solid_builder.js';

/**
 * A flight of stairs, described by numbers (RM-008 F3).
 *
 * ## The finding this exists to answer
 *
 * RM-009 U-3 measured the four stair meshes this build ships - `stairs`,
 * `stairsCorner`, `stairsOpen`, `stairsOpenSingle` - and found them arriving
 * 5.5 metres wide and 4 metres tall, because every model under two units wide
 * is multiplied by 300 on load and the Kenney kit is authored at roughly one
 * unit per metre. They are not stairs anybody can put in a house, and Q-3 says
 * the same thing from the other end: *one storey; stairs go nowhere.*
 *
 * They are **superseded rather than scaled**. Fixing the multiplier is RM-007
 * J1's - per-item real dimensions - and a generated flight does not go near it,
 * because it has no mesh to scale. The four rows stay in `catalog.json`, which
 * is the list of model files this build ships and is asserted as exactly that
 * by six suites; what changes is that there is now something else to reach for.
 *
 * ## Five numbers and two choices, again
 *
 * Tread count, rise, going, width and handrail; shape and turn. Everything else
 * - the height, the plan length, where the landing is, which steps a floor
 * above would have to open around - is *derived*, which is the property that
 * makes the mesh, the plan symbol and the inspector three consequences of one
 * description rather than three things somebody has to keep in agreement.
 *
 * **Rise and going are what a building code is written in**, so they are what
 * the fields say. A regulation states a maximum rise and a minimum going and
 * says nothing about a total height, because the total is what you get.
 *
 * ## The top tread is the floor above
 *
 * `treads` counts risers: a flight of n treads climbs n x rise, and its nth
 * tread surface is at that height - which is the level of the floor it arrives
 * at. That is M-37 stated as an arrangement rather than a check: tread count
 * times rise *is* the height and tread count times going *is* the plan length,
 * for every flight, because there is no other way for either number to be
 * computed.
 *
 * ## Centimetres, like everything else
 *
 * Every number here is centimetres, matching the model layer and the save
 * format.
 */

/** One straight run. */
export const STAIR_STRAIGHT = 'straight';
/** Two runs with a quarter landing, turning ninety degrees. */
export const STAIR_L = 'l';
/** Two parallel runs with a half landing, turning back on themselves. */
export const STAIR_U = 'u';

/** The shapes this build knows. Anything else in a file is read as straight. */
export const STAIR_SHAPES = Object.freeze([STAIR_STRAIGHT, STAIR_L, STAIR_U]);

/** Which way an L or a U turns, seen by somebody climbing it. */
export const TURN_LEFT = 'left';
export const TURN_RIGHT = 'right';

export const HANDRAIL_NONE = 'none';
export const HANDRAIL_LEFT = 'left';
export const HANDRAIL_RIGHT = 'right';
export const HANDRAIL_BOTH = 'both';
export const HANDRAIL_SIDES = Object.freeze([HANDRAIL_NONE, HANDRAIL_LEFT, HANDRAIL_RIGHT, HANDRAIL_BOTH]);

/**
 * What a new flight starts at, in centimetres.
 *
 * 16 x 175 mm is 2800 mm floor to floor, and 16 x 250 mm is a 4000 mm run -
 * round numbers in millimetres, the same convention as F1's 900 x 2100 door,
 * and a real domestic stair rather than one derived from whatever mesh happened
 * to be in the kit. 2800 is a floor-to-floor height: this build's 250 cm wall
 * default is a clear height, and there is nothing above the flight yet (Q-3).
 */
export const STAIR_DEFAULTS = Object.freeze({
	treads: 16,
	rise: 17.5,
	going: 25,
	width: 90,
	handrail: HANDRAIL_RIGHT,
	turn: TURN_RIGHT,
	style: 'plain',
});

/** The material slots a generated flight uses, in the order the groups name them. */
export const STAIR_MATERIALS = Object.freeze(['structure', 'tread', 'handrail']);

/** How thick the tread slab on top of each step is. */
const TREAD_THICKNESS = 4;
/** How high the rail sits above the pitch line, and how thick it and its posts are. */
const RAIL_HEIGHT = 90;
const RAIL_SECTION = 5;
const POST_SECTION = 4;
/** How far in from the edge of the flight the rail stands. */
const RAIL_INSET = 5;

/**
 * How much clear height somebody on a tread needs above their head.
 *
 * Two metres is the domestic minimum nearly everywhere, and it is the only
 * number in the stairwell calculation that is not the flight's own - which is
 * why it is named here rather than buried in the expression.
 */
export const HEADROOM = 200;

/**
 * @typedef {Object} Stair
 * @property {string} shape One of {@link STAIR_SHAPES}.
 * @property {number} treads How many risers the flight climbs.
 * @property {number} rise Height of one step, centimetres.
 * @property {number} going Depth of one step, centimetres.
 * @property {number} width Clear width of the flight, centimetres.
 * @property {string} handrail One of {@link HANDRAIL_SIDES}.
 * @property {string} turn {@link TURN_LEFT} or {@link TURN_RIGHT}; ignored when straight.
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
 * Read a record into a complete, usable flight (RM-008 F3).
 *
 * Total, like `normaliseOpening`: anything missing or unusable takes the
 * default, because `DesignDocument.parse` has already refused the shapes that
 * cannot be drawn and everything past that point is a file this build opens.
 *
 * The bounds are the ones a flight stops being a flight outside of. Two treads
 * is the floor because an L and a U each need at least one step per run, and a
 * one-step stair is a kerb; forty is a flight climbing seven metres.
 *
 * @param {*} record
 * @returns {Stair}
 */
export function normaliseStair(record)
{
	var source = (record && typeof record === 'object') ? record : {};
	return {
		shape: (STAIR_SHAPES.indexOf(source.shape) >= 0) ? source.shape : STAIR_STRAIGHT,
		// Rounded, not floored: a file saying 15.5 treads means 16, and half a
		// step is not a thing that can be built.
		treads: Math.round(number(source.treads, STAIR_DEFAULTS.treads, 2, 40)),
		rise: number(source.rise, STAIR_DEFAULTS.rise, 5, 30),
		going: number(source.going, STAIR_DEFAULTS.going, 15, 45),
		width: number(source.width, STAIR_DEFAULTS.width, 50, 300),
		handrail: (HANDRAIL_SIDES.indexOf(source.handrail) >= 0) ? source.handrail : STAIR_DEFAULTS.handrail,
		turn: (source.turn === TURN_LEFT) ? TURN_LEFT : TURN_RIGHT,
		style: (typeof source.style === 'string' && source.style) ? source.style : 'plain',
	};
}

/**
 * A fresh flight of a shape, at the defaults.
 * @param {string} shape
 * @returns {Stair}
 */
export function newStair(shape)
{
	return normaliseStair({shape: shape});
}

/**
 * What the flight measures (RM-008 F3, M-37).
 *
 * Both totals are a multiplication, and that is the whole of M-37: there is no
 * stored height to disagree with `treads x rise`, and no stored plan length to
 * disagree with `treads x going`.
 *
 * @param {Stair} stair
 * @returns {{height: number, run: number, treads: number, rise: number, going: number, width: number, flights: number[]}}
 */
export function stairMetrics(stair)
{
	return {
		height: stair.treads * stair.rise,
		run: stair.treads * stair.going,
		treads: stair.treads,
		rise: stair.rise,
		going: stair.going,
		width: stair.width,
		flights: splitTreads(stair),
	};
}

/**
 * How the treads divide between the runs.
 *
 * Derived rather than stored, and the lower flight takes the odd one: it is the
 * conventional arrangement, and a stored split would be a fourth number that
 * can disagree with the other three. A person who wants a specific landing
 * position has `treads` and can pick an even count.
 *
 * @param {Stair} stair
 * @returns {number[]} One entry per run.
 */
function splitTreads(stair)
{
	if (stair.shape === STAIR_STRAIGHT)
	{
		return [stair.treads];
	}
	var lower = Math.ceil(stair.treads / 2);
	return [lower, stair.treads - lower];
}

/**
 * Which way is +z after a rotation about the vertical.
 *
 * `rotateAboutY` sends (0,0,1) to (sin a, 0, cos a), so these four are the
 * headings a run can have and the angle each needs.
 */
const HEADING_FORWARD = 0;
const HEADING_RIGHT = Math.PI / 2;
const HEADING_LEFT = -Math.PI / 2;
const HEADING_BACK = Math.PI;

/**
 * The exact unit vectors for the four headings a run can have.
 *
 * A table rather than `Math.sin(heading)`, because `Math.sin(Math.PI)` is
 * 1.2e-16 and not zero, and that dust reaches the footprint: the first version
 * of this file put a U flight's bounding box at -5.5e-15 to 90.00000000000003
 * instead of -90 to 90. The angle is still what the geometry is rotated by -
 * three's matrix does its own trigonometry either way - but every plan
 * rectangle is built from these.
 *
 * `forward` is (sin h, cos h) and `across` is (cos h, -sin h), evaluated once
 * and written down.
 *
 * @param {number} heading
 * @returns {{forward: {x: number, z: number}, across: {x: number, z: number}}}
 */
function axes(heading)
{
	if (heading === HEADING_RIGHT)
	{
		return {forward: {x: 1, z: 0}, across: {x: 0, z: -1}};
	}
	if (heading === HEADING_LEFT)
	{
		return {forward: {x: -1, z: 0}, across: {x: 0, z: 1}};
	}
	if (heading === HEADING_BACK)
	{
		return {forward: {x: 0, z: -1}, across: {x: -1, z: 0}};
	}
	return {forward: {x: 0, z: 1}, across: {x: 1, z: 0}};
}

/**
 * @typedef {Object} StairRect
 * @property {number} x0
 * @property {number} z0
 * @property {number} x1
 * @property {number} z1
 * @property {number} top Height of the surface above the floor, centimetres.
 */

/**
 * @typedef {Object} StairRun
 * @property {number} treads
 * @property {number} base Height the run starts at, centimetres.
 * @property {number} heading Radians about the vertical; see the constants above.
 * @property {{x: number, z: number}} origin Centre of the run's width at its foot.
 * @property {StairRect} rect The run's whole plan rectangle.
 */

/**
 * The flight taken apart, in build coordinates (RM-008 F3).
 *
 * Build coordinates put the foot of the first run at the origin with the floor
 * at y = 0 and travel along +z; `stairPlan` and `buildStairGeometry` both
 * recentre onto the bounding box afterwards, so this is the one place the shape
 * is worked out and the two cannot draw different flights.
 *
 * @param {Stair} stair
 * @returns {{steps: StairRect[], landings: StairRect[], runs: StairRun[], walk: Array<{x: number, z: number}>, bounds: {x0: number, z0: number, x1: number, z1: number}, height: number}}
 */
export function stairParts(stair)
{
	var w = stair.width;
	var g = stair.going;
	var r = stair.rise;
	var counts = splitTreads(stair);
	var sign = (stair.turn === TURN_LEFT) ? -1 : 1;
	/** @type {StairRect[]} */
	var steps = [];
	/** @type {StairRect[]} */
	var landings = [];
	/** @type {StairRun[]} */
	var runs = [];
	/** @type {Array<{x: number, z: number}>} */
	var walk = [];

	// Run A is the same in all three shapes but for where it sits across the
	// footprint: a U puts its two runs side by side, so the first is off-centre.
	var firstX = (stair.shape === STAIR_U) ? -sign * (w / 2) : 0;
	runs.push(run(counts[0], 0, HEADING_FORWARD, firstX, 0, w, g, r));
	walk.push({x: firstX, z: 0});

	if (stair.shape === STAIR_STRAIGHT)
	{
		walk.push({x: firstX, z: counts[0] * g});
	}
	else
	{
		var base = counts[0] * r;
		var landingZ0 = counts[0] * g;
		var landingZ1 = landingZ0 + w;
		// A quarter landing is the width of the flight both ways; a half landing
		// is twice as wide, because it has to carry both runs.
		var landingX = (stair.shape === STAIR_U) ? w : w / 2;
		landings.push({x0: -landingX, z0: landingZ0, x1: landingX, z1: landingZ1, top: base});

		if (stair.shape === STAIR_L)
		{
			// The upper run leaves the side of the landing, so its width is spread
			// along the landing's depth and its foot is at the landing's edge.
			runs.push(run(counts[1], base, sign > 0 ? HEADING_RIGHT : HEADING_LEFT,
				sign * (w / 2), landingZ0 + w / 2, w, g, r));
			walk.push({x: firstX, z: landingZ0 + w / 2});
			walk.push({x: sign * (w / 2 + counts[1] * g), z: landingZ0 + w / 2});
		}
		else
		{
			// A U turns back on itself: the upper run is parallel to the lower one,
			// on the other side of the centre line, travelling the other way.
			runs.push(run(counts[1], base, HEADING_BACK, sign * (w / 2), landingZ0, w, g, r));
			walk.push({x: firstX, z: landingZ0 + w / 2});
			walk.push({x: sign * (w / 2), z: landingZ0 + w / 2});
			walk.push({x: sign * (w / 2), z: landingZ0 - counts[1] * g});
		}
	}

	runs.forEach(function (entry)
	{
		for (var i = 0; i < entry.treads; i++)
		{
			steps.push(stepRect(entry, i, w, g, r));
		}
	});

	var all = steps.concat(landings);
	var bounds = {
		x0: Math.min.apply(null, all.map(function (rect) {return rect.x0;})),
		z0: Math.min.apply(null, all.map(function (rect) {return rect.z0;})),
		x1: Math.max.apply(null, all.map(function (rect) {return rect.x1;})),
		z1: Math.max.apply(null, all.map(function (rect) {return rect.z1;})),
	};

	return {steps: steps, landings: landings, runs: runs, walk: walk, bounds: bounds, height: stair.treads * r};
}

/**
 * One run, with the rectangle it covers.
 *
 * @param {number} treads
 * @param {number} base
 * @param {number} heading
 * @param {number} x Centre of the run's width at its foot.
 * @param {number} z
 * @param {number} width
 * @param {number} going
 * @param {number} rise
 * @returns {StairRun}
 */
function run(treads, base, heading, x, z, width, going, rise)
{
	var vectors = axes(heading);
	var forward = vectors.forward;
	var across = vectors.across;
	var length = treads * going;
	var corners = [
		{x: x + across.x * (width / 2), z: z + across.z * (width / 2)},
		{x: x - across.x * (width / 2), z: z - across.z * (width / 2)},
		{x: x + forward.x * length + across.x * (width / 2), z: z + forward.z * length + across.z * (width / 2)},
		{x: x + forward.x * length - across.x * (width / 2), z: z + forward.z * length - across.z * (width / 2)},
	];
	return {
		treads: treads,
		base: base,
		heading: heading,
		origin: {x: x, z: z},
		rect: {
			x0: Math.min.apply(null, corners.map(function (c) {return c.x;})),
			z0: Math.min.apply(null, corners.map(function (c) {return c.z;})),
			x1: Math.max.apply(null, corners.map(function (c) {return c.x;})),
			z1: Math.max.apply(null, corners.map(function (c) {return c.z;})),
			top: base + treads * rise,
		},
	};
}

/**
 * The plan rectangle of one step within a run, and the height of its surface.
 *
 * @param {StairRun} entry
 * @param {number} index Zero-based, within the run.
 * @param {number} width
 * @param {number} going
 * @param {number} rise
 * @returns {StairRect}
 */
function stepRect(entry, index, width, going, rise)
{
	var vectors = axes(entry.heading);
	var forward = vectors.forward;
	var across = vectors.across;
	var near = index * going;
	var far = (index + 1) * going;
	var xs = [
		entry.origin.x + forward.x * near + across.x * (width / 2),
		entry.origin.x + forward.x * near - across.x * (width / 2),
		entry.origin.x + forward.x * far + across.x * (width / 2),
		entry.origin.x + forward.x * far - across.x * (width / 2),
	];
	var zs = [
		entry.origin.z + forward.z * near + across.z * (width / 2),
		entry.origin.z + forward.z * near - across.z * (width / 2),
		entry.origin.z + forward.z * far + across.z * (width / 2),
		entry.origin.z + forward.z * far - across.z * (width / 2),
	];
	return {
		x0: Math.min.apply(null, xs),
		z0: Math.min.apply(null, zs),
		x1: Math.max.apply(null, xs),
		z1: Math.max.apply(null, zs),
		top: entry.base + (index + 1) * rise,
	};
}

/**
 * The rectangle a floor above would have to open (RM-008 F3).
 *
 * **Recorded, not acted on.** There is no floor above yet - that is G2 - and
 * the roadmap asks for the hint rather than the hole, so this is a number the
 * plan draws and the item can be asked for, and nothing in `three/` reads.
 *
 * It is derivable from the flight's own numbers and one constant. The floor
 * above sits at the flight's full height, so somebody standing on a tread whose
 * surface is at `top` has `height - top` above their head; the opening has to
 * cover every part where that is less than {@link HEADROOM}. For a 2800 mm
 * flight at 175 mm that is the top twelve treads and not the whole footprint,
 * which is the useful part - a stairwell is not the same rectangle as a stair.
 *
 * A short flight qualifies everywhere, correctly: a 150 cm flight has less than
 * two metres above every one of its treads.
 *
 * @param {Stair} stair
 * @returns {{x0: number, z0: number, x1: number, z1: number, fromTread: number}}
 */
export function stairwellHint(stair)
{
	var parts = stairParts(stair);
	var threshold = parts.height - HEADROOM;
	var covered = parts.steps.concat(parts.landings).filter(function (rect)
	{
		return rect.top > threshold;
	});
	// The top tread's surface is the floor above, so its `top` equals the height
	// and the list is never empty - but a flight is only ever as trustworthy as
	// its numbers, and an empty reduce has no answer to give.
	if (!covered.length)
	{
		covered = parts.steps.slice(-1);
	}
	var below = parts.steps.filter(function (rect) {return rect.top <= threshold;});
	return {
		x0: Math.min.apply(null, covered.map(function (rect) {return rect.x0;})),
		z0: Math.min.apply(null, covered.map(function (rect) {return rect.z0;})),
		x1: Math.max.apply(null, covered.map(function (rect) {return rect.x1;})),
		z1: Math.max.apply(null, covered.map(function (rect) {return rect.z1;})),
		fromTread: below.length + 1,
	};
}

/**
 * The flight as the plan needs to see it (RM-008 F3).
 *
 * Everything is in the item's own frame with the origin at the centre of the
 * footprint, which is where `Item` puts a generated mesh's origin - so the
 * symbol the 2D view draws and the solid the 3D view draws are the same flight
 * placed the same way, rather than two drawings that happen to line up.
 *
 * `treadLines` are the divisions between steps and not their outlines: a stair
 * symbol is a rectangle with n-1 lines across it, and drawing each step's whole
 * rectangle would double every internal line and thicken it on screen.
 *
 * @param {Stair} stair
 * @returns {{runs: Array<{x0: number, y0: number, x1: number, y1: number}>, landings: Array<{x0: number, y0: number, x1: number, y1: number}>, treadLines: Array<{x1: number, y1: number, x2: number, y2: number}>, walk: Array<{x: number, y: number}>, well: {x0: number, y0: number, x1: number, y1: number}, halfWidth: number, halfDepth: number}}
 */
export function stairPlan(stair)
{
	var parts = stairParts(stair);
	var cx = (parts.bounds.x0 + parts.bounds.x1) / 2;
	var cz = (parts.bounds.z0 + parts.bounds.z1) / 2;
	/** @param {{x0: number, z0: number, x1: number, z1: number}} rect */
	var place = function (rect)
	{
		return {x0: rect.x0 - cx, y0: rect.z0 - cz, x1: rect.x1 - cx, y1: rect.z1 - cz};
	};

	/** @type {Array<{x1: number, y1: number, x2: number, y2: number}>} */
	var treadLines = [];
	parts.runs.forEach(function (entry)
	{
		var vectors = axes(entry.heading);
		var forward = vectors.forward;
		var across = vectors.across;
		for (var i = 1; i < entry.treads; i++)
		{
			var along = i * stair.going;
			var mid = {
				x: entry.origin.x + forward.x * along - cx,
				y: entry.origin.z + forward.z * along - cz,
			};
			treadLines.push({
				x1: mid.x + across.x * (stair.width / 2),
				y1: mid.y + across.z * (stair.width / 2),
				x2: mid.x - across.x * (stair.width / 2),
				y2: mid.y - across.z * (stair.width / 2),
			});
		}
	});

	return {
		runs: parts.runs.map(function (entry) {return place(entry.rect);}),
		landings: parts.landings.map(place),
		treadLines: treadLines,
		walk: parts.walk.map(function (point) {return {x: point.x - cx, y: point.z - cz};}),
		well: place(stairwellHint(stair)),
		halfWidth: (parts.bounds.x1 - parts.bounds.x0) / 2,
		halfDepth: (parts.bounds.z1 - parts.bounds.z0) / 2,
	};
}

/**
 * Build the mesh for a flight (RM-008 F3).
 *
 * The second caller of `solid_builder.js`, which is what this sprint was for.
 * Every part is a box: a step is a body with a tread slab on it, a landing is
 * the same thing at one height, and a rail is a box rotated to the run's pitch
 * with a post at each end.
 *
 * Each step is **solid to the floor** rather than a tread cantilevered in
 * space. That is what a domestic flight looks like from outside, it is the
 * arrangement whose bounding box is exactly `treads x going` by `treads x rise`
 * - which is M-37, read straight off the geometry - and the interior faces
 * where two steps meet are enclosed by the solid and never seen.
 *
 * Centred on its own footprint and half its height, matching where `Item`'s
 * constructor would put the origin anyway; doing it here means `stairPlan` and
 * this agree without either depending on `Item`.
 *
 * @param {Stair} stair
 * @returns {{geometry: import('three').BufferGeometry, materials: Array<MeshStandardMaterial>}}
 */
export function buildStairGeometry(stair)
{
	var parts = stairParts(stair);
	var sink = newSink();
	var ox = -(parts.bounds.x0 + parts.bounds.x1) / 2;
	var oy = 0;
	var oz = -(parts.bounds.z0 + parts.bounds.z1) / 2;

	parts.steps.concat(parts.landings).forEach(function (rect)
	{
		var width = rect.x1 - rect.x0;
		var depth = rect.z1 - rect.z0;
		var cx = ox + (rect.x0 + rect.x1) / 2;
		var cz = oz + (rect.z0 + rect.z1) / 2;
		// A tread slab thinner than the step it sits on, so a five-centimetre
		// rise still has a body under its tread rather than a negative one.
		var slab = Math.min(TREAD_THICKNESS, rect.top / 2);
		box(sink, cx, oy + (rect.top - slab) / 2, cz, width, rect.top - slab, depth, 0);
		box(sink, cx, oy + rect.top - slab / 2, cz, width, slab, depth, 1);
	});

	sides(stair).forEach(function (side)
	{
		parts.runs.forEach(function (entry)
		{
			appendInto(sink, railFor(entry, stair, side), ox + entry.origin.x, oy, oz + entry.origin.z);
		});
	});

	// Centred on the mesh rather than on the flight, and the difference is a
	// handrail: it stands 90 cm above the top nosing, so a flight with one is
	// taller than `treads x rise` and the two centres are 45 cm apart.
	// `FloorItem.resized` puts an item's origin at `halfSize.y` above the floor
	// and `Item.objectHalfSize` is half the mesh, so centring on the flight
	// would leave a railed stair hanging 45 cm in the air - which is F1's door
	// bug exactly, in a new file, and is why this is done here rather than
	// trusted to `Item`'s constructor: `rebuild()` does not go through it.
	var lowest = Infinity;
	var highest = -Infinity;
	for (var i = 1; i < sink.positions.length; i += 3)
	{
		lowest = Math.min(lowest, sink.positions[i]);
		highest = Math.max(highest, sink.positions[i]);
	}
	var lift = -(lowest + highest) / 2;
	for (var j = 1; j < sink.positions.length; j += 3)
	{
		sink.positions[j] += lift;
	}
	var geometry = finishGeometry(sink);

	return {
		geometry: geometry,
		materials: [
			new MeshStandardMaterial({color: 0xD9D3C7, roughness: 0.85, metalness: 0}),
			new MeshStandardMaterial({color: 0xB08968, roughness: 0.6, metalness: 0}),
			new MeshStandardMaterial({color: 0x6B5B4B, roughness: 0.45, metalness: 0.1}),
		],
	};
}

/**
 * Which sides of the flight carry a rail, as a signed offset across it.
 *
 * Facing the way you climb, with the vertical up, your right hand points along
 * -x: in a right-handed frame `forward x up` is `z x y`, which is -x. So the
 * left rail is at +x in the run's own frame. Asserted rather than asserted-in-
 * prose - `tests/parametric-stairs.test.js` reads the rail's position out of
 * the geometry for each choice.
 *
 * @param {Stair} stair
 * @returns {number[]}
 */
function sides(stair)
{
	var offset = Math.max(0, stair.width / 2 - RAIL_INSET);
	if (stair.handrail === HANDRAIL_BOTH)
	{
		return [offset, -offset];
	}
	if (stair.handrail === HANDRAIL_LEFT)
	{
		return [offset];
	}
	if (stair.handrail === HANDRAIL_RIGHT)
	{
		return [-offset];
	}
	return [];
}

/**
 * One run's rail, in that run's own frame: +z up the flight, origin at its foot.
 *
 * Built locally and rotated into place rather than assembled in build
 * coordinates, because a box is axis-aligned and a rail is not - it follows the
 * pitch. Two rotations do it: about x for the pitch, about y for the run's
 * heading, both from `solid_builder.js`.
 *
 * @param {StairRun} entry
 * @param {Stair} stair
 * @param {number} offset Across the run; see {@link sides}.
 * @returns {import('./solid_builder.js').BufferSink}
 */
function railFor(entry, stair, offset)
{
	var length = entry.treads * stair.going;
	var climb = entry.treads * stair.rise;
	var pitch = Math.atan2(climb, length);
	// Sized and placed so that nothing the rail adds reaches past the run it
	// serves. A rail the length of the pitch line, rotated, is longer than the
	// run in plan by half its own section; a post centred on the run's foot is
	// half a post outside it. Both were measured first - they put a straight
	// flight's mesh at 404 cm over a 400 cm footprint - and the reason to spend
	// four lines on 4 cm is that it is what makes the plan symbol and the solid
	// the same rectangle rather than nearly the same one.
	var rail = newSink();
	box(rail, 0, 0, 0, RAIL_SECTION, RAIL_SECTION,
		(length - RAIL_SECTION * Math.sin(pitch)) / Math.cos(pitch), 2);
	rotateAboutX(rail.positions, rail.normals, -pitch);

	var run = newSink();
	appendInto(run, rail, offset, entry.base + climb / 2 + RAIL_HEIGHT, length / 2);
	box(run, offset, entry.base + RAIL_HEIGHT / 2, POST_SECTION / 2,
		POST_SECTION, RAIL_HEIGHT, POST_SECTION, 2);
	box(run, offset, entry.base + climb + RAIL_HEIGHT / 2, length - POST_SECTION / 2,
		POST_SECTION, RAIL_HEIGHT, POST_SECTION, 2);
	rotateAboutY(run.positions, run.normals, entry.heading);
	return run;
}

/**
 * The record written to a file (RM-008 T-6).
 *
 * Explicit and complete, like `openingToJSON`: there is no document default a
 * flight can fall back on. What makes it additive is that the whole `stair` key
 * is absent from an item that has none - which is every item in every file
 * written before F3.
 *
 * @param {Stair} stair
 * @returns {Record<string, any>}
 */
export function stairToJSON(stair)
{
	return {
		shape: stair.shape,
		treads: stair.treads,
		rise: stair.rise,
		going: stair.going,
		width: stair.width,
		handrail: stair.handrail,
		turn: stair.turn,
		style: stair.style,
	};
}
