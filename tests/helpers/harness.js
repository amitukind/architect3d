/**
 * Shared harness for the headless characterization suite.
 *
 * Everything here exists to make the data layer deterministic and runnable
 * without a browser. It must not paper over library behaviour: if a helper
 * has to work around something, that something is a finding, not a detail.
 */
import {Floorplan} from '../../src/scripts/model/floorplan.js';
import {Configuration, configDimUnit, configWallHeight, configWallThickness,
	scale, snapToGrid, snapTolerance, gridSpacing, config} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {Utils} from '../../src/scripts/core/utils.js';

/**
 * Deterministic replacement for Math.random, so Utils.guide() produces stable
 * corner/wall ids and snapshots do not churn between runs.
 * Plain 32-bit LCG - value distribution is irrelevant here, repeatability is not.
 */
export function seedRandom(seed = 1)
{
	let state = seed >>> 0;
	Utils.setRandomSource(() => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	});
}

/** Restore Math.random. */
export function unseedRandom()
{
	Utils.setRandomSource(null);
}

/**
 * The library's stock configuration, as set by a fresh page load.
 * NOTE: config is a mutable module singleton shared by every test in a file,
 * so each test that touches configuration must reset through here.
 */
export function resetConfiguration()
{
	Configuration.setValue(configDimUnit, dimCentiMeter);
	Configuration.setValue(configWallHeight, 250);
	Configuration.setValue(configWallThickness, 10);
	Configuration.setValue(scale, 1);
	Configuration.setValue(snapToGrid, false);
	Configuration.setValue(snapTolerance, 25);
	Configuration.setValue(gridSpacing, 25);
	config.systemUI = false;
}

/** Standard per-test reset: deterministic ids + stock configuration. */
export function resetAll(seed = 1)
{
	seedRandom(seed);
	resetConfiguration();
}

/**
 * Build a closed polygon of walls from [x, y] pairs (in cm) and run update().
 * @returns {{floorplan: Floorplan, corners: Array}}
 */
export function buildPolygon(points, {update = true} = {})
{
	const floorplan = new Floorplan();
	const corners = points.map(([x, y]) => floorplan.newCorner(x, y));
	for (let i = 0; i < corners.length; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % corners.length]);
	}
	if (update)
	{
		floorplan.update();
	}
	return {floorplan, corners};
}

/** A 400x300 cm rectangle - the simplest room that closes. */
export function buildSquareRoom()
{
	return buildPolygon([[0, 0], [400, 0], [400, 300], [0, 300]]);
}

/** An L-shaped room (6 corners) - exercises the concave path in findRooms. */
export function buildLShapedRoom()
{
	return buildPolygon([[0, 0], [400, 0], [400, 200], [200, 200], [200, 400], [0, 400]]);
}

/**
 * Two rectangles sharing one wall - exercises room dedup and orphan-edge
 * assignment. Returns the floorplan plus the shared corners.
 */
export function buildSharedWallRooms()
{
	const floorplan = new Floorplan();
	const a = floorplan.newCorner(0, 0);
	const b = floorplan.newCorner(300, 0);
	const c = floorplan.newCorner(300, 300);
	const d = floorplan.newCorner(0, 300);
	const e = floorplan.newCorner(600, 0);
	const f = floorplan.newCorner(600, 300);

	floorplan.newWall(a, b);
	floorplan.newWall(b, c);
	floorplan.newWall(c, d);
	floorplan.newWall(d, a);
	floorplan.newWall(b, e);
	floorplan.newWall(e, f);
	floorplan.newWall(f, c);

	floorplan.update();
	return {floorplan, corners: [a, b, c, d, e, f]};
}

/**
 * Round numbers for stable comparisons. Floating-point noise in the geometry
 * pipeline is expected; structural equality is what these tests assert.
 */
export function round(value, places = 4)
{
	const factor = Math.pow(10, places);
	return Math.round(value * factor) / factor;
}

/** Recursively round every number in a structure. */
export function roundDeep(value, places = 4)
{
	if (typeof value === 'number')
	{
		return round(value, places);
	}
	if (Array.isArray(value))
	{
		return value.map((v) => roundDeep(v, places));
	}
	if (value && typeof value === 'object')
	{
		const out = {};
		Object.keys(value).sort().forEach((k) => { out[k] = roundDeep(value[k], places); });
		return out;
	}
	return value;
}

/**
 * Replace generated corner ids with stable ordinals so snapshots survive any
 * future change to the id generator. Walks a saved-floorplan object.
 */
export function normalizeIds(saved)
{
	const map = new Map();
	const idFor = (id) => {
		if (!map.has(id))
		{
			map.set(id, `corner-${map.size}`);
		}
		return map.get(id);
	};

	// Assign ordinals in wall order, which is deterministic given insertion order.
	saved.walls.forEach((wall) => { idFor(wall.corner1); idFor(wall.corner2); });

	const corners = {};
	Object.keys(saved.corners).forEach((id) => { corners[idFor(id)] = saved.corners[id]; });

	const rooms = {};
	Object.keys(saved.rooms).forEach((key) => {
		const mapped = key.split(',').map(idFor).join(',');
		rooms[mapped] = saved.rooms[key];
	});

	return Object.assign({}, saved, {
		corners,
		rooms,
		walls: saved.walls.map((w) => Object.assign({}, w, {
			corner1: idFor(w.corner1),
			corner2: idFor(w.corner2),
		})),
	});
}

/**
 * A room's identity independent of id generation: its corner coordinates in
 * traversal order, normalised to start at the lexicographically smallest point
 * so rotation of the cycle does not change the signature.
 */
export function roomSignature(room)
{
	const pts = room.corners.map((c) => [round(c.x), round(c.y)]);
	let best = 0;
	for (let i = 1; i < pts.length; i++)
	{
		if (pts[i][0] < pts[best][0] || (pts[i][0] === pts[best][0] && pts[i][1] < pts[best][1]))
		{
			best = i;
		}
	}
	return pts.slice(best).concat(pts.slice(0, best));
}

/** Sorted room signatures - order-independent comparison of a floorplan's rooms. */
export function roomSignatures(floorplan)
{
	return floorplan.getRooms()
		.map(roomSignature)
		.map((sig) => JSON.stringify(sig))
		.sort();
}

/**
 * Minimal item loader for Scene.setItemLoader(): hands back a bare geometry and
 * material without touching the network. Only used by tests that need the item
 * pipeline; geometry fidelity is not the point.
 */
export function stubItemLoader(three)
{
	return (fileName, metadata, onLoad) => {
		const geometry = new three.BoxGeometry(50, 50, 50);
		const material = new three.MeshBasicMaterial({color: 0xcccccc});
		onLoad(geometry, [material]);
	};
}
