// @vitest-environment jsdom
/**
 * Sprint S4: the BufferGeometry rewrites, against what three r98 drew.
 *
 * `Geometry` and `Face3` were removed in r125, and this app built five kinds of
 * mesh with them: the wall quads that ShapeGeometry triangulates around door
 * and window holes, the roof fans over a room's corners, the wall fillers, the
 * invisible planes the raycaster picks against, and the HUD's rotate handle.
 * Every one had to be rewritten, and a rewrite you cannot check is a rewrite
 * you cannot ship.
 *
 * So before the bump, tools/capture-geometry-goldens.mjs drove the real classes
 * under r98 and wrote what they produced to tests/fixtures/geometry-r98.json.
 * This file rebuilds the same geometry under r185 and compares.
 *
 * The comparison is per-triangle-corner, never per-vertex. Legacy `Geometry`
 * numbered its vertices differently from an indexed BufferGeometry and shared
 * them differently, so vertex indices are not comparable and were never the
 * point. "Triangle 7's second corner sits at (x,y,z) with uv (u,v)" is what
 * decides what appears on screen, and it is the same question on both engines.
 *
 * A failure here means the mesh changed. Read the triangle index out of the
 * message and compare that corner against the fixture; the fixture is the r98
 * original and is not to be regenerated (the tool that wrote it cannot run
 * against r185 - it imports `Geometry`).
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {EventDispatcher, Path, Shape, ShapeGeometry, Vector2, Vector3} from 'three';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Edge} from '../src/scripts/three/edge.js';
import {Floor} from '../src/scripts/three/floor.js';
import {HUD} from '../src/scripts/three/hud.js';
import {Configuration, configDimUnit} from '../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../src/scripts/core/units.js';
import {installCanvas2D} from './helpers/dom.js';
import {installImageStub} from './helpers/models.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDENS = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/geometry-r98.json'), 'utf8'));

/**
 * Positions are centimetres in the hundreds and both sides store float32, so
 * agreement to 1e-4 cm is agreement to a thousandth of a millimetre. UVs are
 * held to the same absolute figure, which on a 1024px texture is a tenth of a
 * pixel.
 */
const TOLERANCE = 1e-4;

const round = (value) => Math.round(value * 1e6) / 1e6 + 0;

/**
 * BufferGeometry -> the same flat per-triangle-corner arrays the capture tool
 * wrote for legacy Geometry. Indexed or not.
 */
function canonical(geometry)
{
	const position = geometry.getAttribute('position');
	const uvAttribute = geometry.getAttribute('uv');
	const normalAttribute = geometry.getAttribute('normal');
	const index = geometry.getIndex();
	const cornerCount = index ? index.count : position.count;

	const p = [];
	const uv = [];
	const n = [];

	// A geometry with no index and no triangles is a line list; the capture tool
	// recorded its raw vertices instead, so mirror that.
	const isTriangleList = cornerCount >= 3;
	for (let i = 0; i < (isTriangleList ? cornerCount : 0); i++)
	{
		const v = index ? index.getX(i) : i;
		p.push(round(position.getX(v)), round(position.getY(v)), round(position.getZ(v)));
		if (uvAttribute) { uv.push(round(uvAttribute.getX(v)), round(uvAttribute.getY(v))); }
		if (normalAttribute) { n.push(round(normalAttribute.getX(v)), round(normalAttribute.getY(v)), round(normalAttribute.getZ(v))); }
	}

	const points = [];
	if (!isTriangleList)
	{
		for (let i = 0; i < position.count; i++)
		{
			points.push(round(position.getX(i)), round(position.getY(i)), round(position.getZ(i)));
		}
	}

	return {
		triangles: isTriangleList ? cornerCount / 3 : 0,
		p,
		uv: uvAttribute && isTriangleList ? uv : null,
		n: n.length ? n : null,
		points: points.length ? points : null,
	};
}

/** Triangles of a canonical record, as arrays of three [x,y,z] corners. */
function triangles(record)
{
	const out = [];
	for (let i = 0; i < record.p.length; i += 9)
	{
		out.push([
			[record.p[i], record.p[i + 1], record.p[i + 2]],
			[record.p[i + 3], record.p[i + 4], record.p[i + 5]],
			[record.p[i + 6], record.p[i + 7], record.p[i + 8]],
		]);
	}
	return out;
}

/** Twice the area of a 3D triangle, as a vector - magnitude and facing at once. */
function crossOf([a, b, c])
{
	const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

const magnitude = ([x, y, z]) => Math.sqrt(x * x + y * y + z * z);
const totalArea = (tris) => tris.reduce((sum, t) => sum + magnitude(crossOf(t)) / 2, 0);
const pointKey = ([x, y, z]) => `${x},${y},${z}`;

/**
 * Compare one geometry against its frozen r98 reading.
 *
 * Two modes, because r185 does not always produce the identical triangle list:
 *
 * - `exact` (the default) demands the same corners in the same order. Every
 *   mesh this app builds by hand meets it, and so does ShapeGeometry for any
 *   contour without holes.
 *
 * - `equivalent` is for the holed wall shapes. three's ear-clipping
 *   triangulator changed between r98 and r185, so it cuts a polygon-with-holes
 *   into a different set of triangles - 10 of 14 shared on the two-hole case,
 *   the other 4 being different interior diagonals across the same region. That
 *   is three's own code, not this app's, and reproducing r98's output would
 *   mean vendoring its triangulator. What must not change is what gets drawn,
 *   so this mode asserts the properties that decide that: identical vertex set,
 *   identical total area, consistent facing, same triangle count, and the same
 *   UV at every vertex position.
 *
 * `checkUv` is off for the meshes that never had UVs to begin with, and `checkN`
 * for the ones whose normals nothing reads - the raycast planes and the
 * MeshBasicMaterial fillers, where r98 stored a per-face normal that an indexed
 * BufferGeometry has no way to represent and no reason to.
 */
function expectMatchesGolden(key, geometry, {checkUv = true, checkN = false, mode = 'exact'} = {})
{
	const golden = GOLDENS[key];
	expect(golden, `no r98 golden recorded for "${key}"`).toBeTruthy();

	const actual = canonical(geometry);
	expect(actual.triangles, `${key}: triangle count`).toBe(golden.triangles);

	const compare = (label, got, want) =>
	{
		expect(got.length, `${key}: ${label} length`).toBe(want.length);
		let worst = 0;
		let worstAt = -1;
		for (let i = 0; i < want.length; i++)
		{
			const delta = Math.abs(got[i] - want[i]);
			if (delta > worst) { worst = delta; worstAt = i; }
		}
		expect(worst, `${key}: ${label} differs at triangle ${Math.floor(worstAt / 9)} (index ${worstAt}): ${got[worstAt]} vs r98 ${want[worstAt]}`)
			.toBeLessThan(TOLERANCE);
	};

	if (golden.points) { compare('line vertices', actual.points || [], golden.points); }

	if (mode === 'exact')
	{
		compare('positions', actual.p, golden.p);
		if (checkUv && golden.uv && golden.uv.length) { compare('uvs', actual.uv || [], golden.uv); }
		if (checkN && golden.n) { compare('normals', actual.n || [], golden.n); }
		return;
	}

	const before = triangles(golden);
	const after = triangles(actual);

	// Same region, to a ten-thousandth of a square centimetre.
	expect(totalArea(after), `${key}: total area`).toBeCloseTo(totalArea(before), 4);

	// Same corners, as a set. A retriangulation reuses vertices; it never
	// invents or drops one.
	const setOf = (tris) => new Set(tris.flat().map(pointKey));
	const beforeSet = setOf(before);
	const afterSet = setOf(after);
	expect([...afterSet].filter((point) => !beforeSet.has(point)), `${key}: new vertices`).toEqual([]);
	expect([...beforeSet].filter((point) => !afterSet.has(point)), `${key}: lost vertices`).toEqual([]);

	// Every triangle faces the way the r98 triangles faced. These meshes are
	// single-sided in places, so a flipped winding would make a wall vanish.
	const facing = (tris) =>
	{
		const normals = new Set();
		for (const triangle of tris)
		{
			const cross = crossOf(triangle);
			const length = magnitude(cross) || 1;
			normals.add(cross.map((component) => Math.round((component / length) * 1e3) / 1e3).join(','));
		}
		return [...normals].sort();
	};
	expect(facing(after), `${key}: winding`).toEqual(facing(before));

	if (checkUv && golden.uv && golden.uv.length)
	{
		// UV is a pure function of vertex position, so it survives retriangulation
		// exactly: the same point must carry the same coordinates it carried
		// under r98, whichever triangles now happen to reference it.
		const uvAt = new Map();
		for (let i = 0; i < golden.p.length / 3; i++)
		{
			uvAt.set(pointKey([golden.p[i * 3], golden.p[i * 3 + 1], golden.p[i * 3 + 2]]),
				[golden.uv[i * 2], golden.uv[i * 2 + 1]]);
		}

		let worst = 0;
		for (let i = 0; i < actual.p.length / 3; i++)
		{
			const want = uvAt.get(pointKey([actual.p[i * 3], actual.p[i * 3 + 1], actual.p[i * 3 + 2]]));
			expect(want, `${key}: vertex ${i} is not one r98 produced`).toBeTruthy();
			worst = Math.max(worst,
				Math.abs(actual.uv[i * 2] - want[0]),
				Math.abs(actual.uv[i * 2 + 1] - want[1]));
		}
		expect(worst, `${key}: uv at a shared vertex`).toBeLessThan(TOLERANCE);
	}
}

let restoreImages;
let canvasStub;
let floorplan;
let room;
let sceneStub;
let controlsStub;

beforeAll(() =>
{
	restoreImages = installImageStub();
	canvasStub = installCanvas2D(window);
	Configuration.setValue(configDimUnit, dimCentiMeter);

	// Identical to the plan the capture tool built. Uneven corner elevations, so
	// the varying-height filler and the non-planar raycast plane both appear.
	floorplan = new Floorplan();
	const corners = [
		floorplan.newCorner(0, 0),
		floorplan.newCorner(400, 0),
		floorplan.newCorner(400, 300),
		floorplan.newCorner(0, 300),
	];
	corners.forEach((corner, index) =>
	{
		floorplan.newWall(corner, corners[(index + 1) % corners.length]);
	});
	corners[0].elevation = 250;
	corners[1].elevation = 250;
	corners[2].elevation = 310;
	corners[3].elevation = 280;
	floorplan.update();

	room = floorplan.getRooms()[0];
	sceneStub = {add() {}, remove() {}, needsUpdate: false};
	controlsStub = new EventDispatcher();
	controlsStub.object = {position: new Vector3(600, 400, 600)};
});

afterAll(() =>
{
	restoreImages();
	canvasStub.restore();
});

describe('ShapeGeometry triangulation', () =>
{
	// The single riskiest swap in the sprint: r185 exports the same *name* bound
	// to a different class, so nothing fails to compile and the triangulation
	// silently becomes whatever earcut does today. Checked on its own, away from
	// the wall UV maths, so a failure downstream can be attributed rather than
	// guessed at.

	it('is unchanged for a rectangle', () =>
	{
		const shape = new Shape([
			new Vector2(0, 0), new Vector2(300, 0), new Vector2(300, 250), new Vector2(0, 250),
		]);
		expectMatchesGolden('shape.square', new ShapeGeometry(shape));
	});

	it('is unchanged for an L-shaped room', () =>
	{
		const shape = new Shape([
			new Vector2(0, 0), new Vector2(400, 0), new Vector2(400, 200),
			new Vector2(200, 200), new Vector2(200, 350), new Vector2(0, 350),
		]);
		expectMatchesGolden('shape.lshape', new ShapeGeometry(shape));
	});

	it('is unchanged for a concave outline', () =>
	{
		const shape = new Shape([
			new Vector2(0, 0), new Vector2(500, 0), new Vector2(500, 300),
			new Vector2(300, 120), new Vector2(120, 300), new Vector2(0, 300),
		]);
		expectMatchesGolden('shape.concave', new ShapeGeometry(shape));
	});

	it('covers the same region for a contour with two holes - the door-and-window case', () =>
	{
		// The one place r185 genuinely differs. three's ear-clipping triangulator
		// changed, so a polygon with holes is cut into a different set of
		// triangles: 10 of the 14 are the same, and the other 4 are different
		// interior diagonals across the same area. Nothing visible changes - the
		// region, its vertices, its facing and its UVs are all identical - but
		// the triangle list is not, and pretending otherwise would mean vendoring
		// r98's triangulator.
		//
		// The only place it is observable at all is wireframe mode, where the
		// diagonals inside a wall are drawn.
		const shape = new Shape([
			new Vector2(0, 0), new Vector2(500, 0), new Vector2(500, 250), new Vector2(0, 250),
		]);
		shape.holes.push(new Path([
			new Vector2(80, 60), new Vector2(180, 60), new Vector2(180, 190), new Vector2(80, 190),
		]));
		shape.holes.push(new Path([
			new Vector2(300, 90), new Vector2(420, 90), new Vector2(420, 170), new Vector2(300, 170),
		]));
		expectMatchesGolden('shape.twoHoles', new ShapeGeometry(shape), {mode: 'equivalent'});
	});

	it('cuts a holed contour into mostly - but not entirely - the same triangles', () =>
	{
		// Pins the size of that difference, so a future three bump that changes
		// the triangulator wholesale does not slip past the equivalence check
		// above unnoticed.
		const shape = new Shape([
			new Vector2(0, 0), new Vector2(500, 0), new Vector2(500, 250), new Vector2(0, 250),
		]);
		shape.holes.push(new Path([
			new Vector2(80, 60), new Vector2(180, 60), new Vector2(180, 190), new Vector2(80, 190),
		]));
		shape.holes.push(new Path([
			new Vector2(300, 90), new Vector2(420, 90), new Vector2(420, 170), new Vector2(300, 170),
		]));

		const key = (triangle) => triangle.map((corner) => corner.join(',')).sort().join('|');
		const before = new Set(triangles(GOLDENS['shape.twoHoles']).map(key));
		const after = new Set(triangles(canonical(new ShapeGeometry(shape))).map(key));
		const shared = [...after].filter((triangle) => before.has(triangle));

		expect(before.size).toBe(14);
		expect(after.size).toBe(14);
		expect(shared.length).toBe(10);
	});
});

describe('Room planes', () =>
{
	it('generatePlane builds the same floor polygon', () =>
	{
		expectMatchesGolden('room.floorPlane', room.floorPlane.geometry);
	});

	it('generateRoofPlane builds the same corner fan', () =>
	{
		// No UVs on the fan; the old code never made any.
		expectMatchesGolden('room.roofPlane', room.roofPlane.geometry, {checkUv: false});
	});
});

describe('HalfEdge raycast planes', () =>
{
	it('builds the same quad for every edge of the room', () =>
	{
		const edges = floorplan.wallEdges();
		expect(edges.length).toBe(4);
		edges.forEach((edge, index) =>
		{
			expectMatchesGolden(`halfEdge.plane.${index}`, edge.plane.geometry, {checkUv: false});
		});
	});

	it('exposes the first triangle normal that WallItem used to read off face[0]', () =>
	{
		for (const edge of floorplan.wallEdges())
		{
			expect(edge.planeNormal).toBeTruthy();
			expect(edge.planeNormal.length()).toBeCloseTo(1, 6);
		}
	});

	it('keeps the plane bounds Box3 used to report', () =>
	{
		// setFromObject(..., precise) - the r140 default would round these
		// outwards, and wall items are snapped inside them.
		for (const edge of floorplan.wallEdges())
		{
			expect(edge.min.y).toBeCloseTo(0, 6);
			expect(edge.max.y).toBeGreaterThan(0);
			expect(edge.center.y).toBeCloseTo((edge.min.y + edge.max.y) / 2, 6);
		}
	});
});

describe('Floor', () =>
{
	let floor;
	beforeAll(() => {floor = new Floor(sceneStub, room);});

	it('builds the same textured floor', () =>
	{
		expectMatchesGolden('floor.buildFloor', floor.buildFloor().geometry);
	});

	it('builds the same varying-height roof fan', () =>
	{
		// Renamed to `buildCeiling` by RM-010 G2, because it is a lid on one room and
		// not a roof. The geometry is unchanged, which is what this golden pins - the
		// key stays as it was captured.
		expectMatchesGolden('floor.buildRoofVaryingHeight', floor.buildCeiling().geometry, {checkUv: false});
	});

	it('builds the same uniform-height roof', () =>
	{
		expectMatchesGolden('floor.buildRoofUniformHeight', floor.buildRoofUniformHeight().geometry);
	});
});

describe('Edge wall meshes', () =>
{
	// The highest-risk geometry in the sprint. makeWall used to mutate
	// ShapeGeometry.vertices in place and hand-build faceVertexUvs per face
	// corner; both are gone. The rewrite transforms the position attribute and
	// writes one UV per vertex, which is only equivalent because the old UV
	// function depended on nothing but the vertex position.

	const cases = [
		['edge.withHoles', 0, [
			{position: new Vector3(120, 100, 0), halfSize: new Vector3(40, 60, 10)},
			{position: new Vector3(280, 120, 0), halfSize: new Vector3(35, 45, 10)},
		]],
		['edge.plain', 1, []],
	];

	describe.each(cases)('%s', (prefix, edgeIndex, items) =>
	{
		let edge;
		let halfEdge;

		beforeAll(() =>
		{
			halfEdge = floorplan.wallEdges()[edgeIndex];
			halfEdge.wall.items = items;
			edge = new Edge(sceneStub, halfEdge, controlsStub);
		});

		it('builds the same number of planes', () =>
		{
			const goldenPlanes = Object.keys(GOLDENS).filter((key) => key.startsWith(`${prefix}.plane.`));
			expect(edge.planes.length).toBe(goldenPlanes.length);
		});

		it('builds every plane as r98 did, uvs included', () =>
		{
			edge.planes.forEach((plane, index) =>
			{
				const key = `${prefix}.plane.${index}`;
				// The two wall shapes carry UVs; the fillers do not. The walls with
				// holes go through ShapeGeometry's changed triangulator, so they are
				// compared as an equivalent surface rather than an identical
				// triangle list - see the ShapeGeometry block above.
				const holed = items.length > 0 && GOLDENS[key].uv && GOLDENS[key].uv.length > 0;
				expectMatchesGolden(key, plane.geometry, {
					checkUv: Boolean(GOLDENS[key].uv && GOLDENS[key].uv.length),
					mode: holed ? 'equivalent' : 'exact',
				});
			});
		});

		it('builds the same always-visible base plane', () =>
		{
			edge.basePlanes.forEach((plane, index) =>
			{
				expectMatchesGolden(`${prefix}.basePlane.${index}`, plane.geometry);
			});
		});

		it('builds the same side filler', () =>
		{
			const filler = edge.buildSideFillter(halfEdge.interiorStart(), halfEdge.exteriorStart(), 240, 0xcccccc);
			expectMatchesGolden(`${prefix}.sideFiller`, filler.geometry, {checkUv: false});
		});
	});

	it('puts wall UVs where the texture expects them, not where ShapeGeometry would', () =>
	{
		// Guards the rewrite against the failure mode a golden alone would miss:
		// if the uv attribute were simply left as ShapeGeometry generated it, the
		// values would be raw centimetres rather than the 0..1 the wall texture is
		// tiled against, and every wall would be textured wrong.
		const golden = GOLDENS['edge.withHoles.plane.1'];
		const vs = golden.uv.filter((_, i) => i % 2 === 1);
		expect(Math.max(...vs)).toBeLessThanOrEqual(1.0001);
		expect(Math.min(...vs)).toBeGreaterThanOrEqual(-0.0001);
	});
});

describe('HUD', () =>
{
	it('builds the same rotate-handle line', () =>
	{
		const hud = new HUD(new EventDispatcher(), controlsStub);
		const geometry = hud.makeLineGeometry({halfSize: new Vector3(30, 20, 45)});
		expectMatchesGolden('hud.line', geometry, {checkUv: false});
		// LineSegments consumes positions in pairs, so an index would be wrong.
		expect(geometry.getIndex()).toBeNull();
		expect(geometry.getAttribute('position').count).toBe(2);
	});
});
