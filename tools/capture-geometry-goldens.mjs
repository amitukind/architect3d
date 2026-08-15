/**
 * Freeze the geometry three r98 produces, so the S4 BufferGeometry rewrites can
 * be proved rather than eyeballed.
 *
 * `Geometry` and `Face3` are gone in r185, and every mesh this app builds by
 * hand goes through them. Rewriting that code is mechanical; proving the
 * rewrite produces the *same mesh* is not, because after the bump there is no
 * r98 left to compare against. So this script runs while r98 is still
 * installed, drives the real classes - not a replica of their maths - and
 * writes the result to tests/fixtures/geometry-r98.json.
 *
 * The comparison form is per-triangle-corner, never per-vertex: legacy
 * `Geometry` numbers its vertices differently from an indexed BufferGeometry,
 * and duplicates or shares them differently too. Flattening to
 * "triangle 0 corner 0 sits at (x,y,z) with uv (u,v)" is the representation
 * both sides can produce, and it is the one that decides what gets drawn.
 *
 *     node tools/capture-geometry-goldens.mjs
 *
 * Kept, but no longer runnable: it needs `Geometry`, which r185 does not have.
 * It is here as the record of how tests/fixtures/geometry-r98.json was
 * produced - a fixture whose provenance you cannot read is a fixture you cannot
 * trust - and it refuses to run rather than silently producing something else.
 */
import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'tests', 'fixtures', 'geometry-r98.json');

/**
 * Refuse to run against anything but the engine this fixture describes.
 *
 * Without the guard the failure is an opaque "Geometry is not a constructor"
 * three imports deep, which reads like a broken script rather than a script
 * that has outlived its engine.
 */
function assertLegacyThree(THREE)
{
	if (typeof THREE.Geometry === 'function') { return; }
	console.error(
		`This script captures what three r98 drew, and the installed three is r${THREE.REVISION}.\n` +
		'`Geometry` was removed in r125, so the r98 reading cannot be reproduced here.\n\n' +
		'tests/fixtures/geometry-r98.json already holds that reading; it is checked in,\n' +
		'and tests/geometry-rewrites.test.js compares against it. Nothing needs regenerating.\n' +
		'To re-derive it from scratch, check out the legacy-demo tag and npm install there.');
	process.exit(1);
}

/* three's TextureLoader and Item both reach for a document the moment they are
   constructed, so the DOM has to exist before any app module is imported. */
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
// Node 24 defines a getter-only global navigator, so plain assignment throws.
Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});

const THREE = await import('three');
assertLegacyThree(THREE);
const {installCanvas2D} = await import('../tests/helpers/dom.js');
const {Vector2, Vector3, Shape, Path, ShapeGeometry} = THREE;

installCanvas2D(dom.window);

/* No network, no pixels. Geometry does not depend on either, and without this
   every TextureLoader call in Edge/Floor hangs the script. */
THREE.ImageLoader.prototype.load = function (url, onLoad)
{
	const image = {width: 1, height: 1, src: url};
	if (onLoad) { setTimeout(() => onLoad(image), 0); }
	return image;
};

const {Floorplan} = await import('../src/scripts/model/floorplan.js');
const {Edge} = await import('../src/scripts/three/edge.js');
const {Floor} = await import('../src/scripts/three/floor.js');
const {HUD} = await import('../src/scripts/three/hud.js');
const {Configuration, configDimUnit} = await import('../src/scripts/core/configuration.js');
const {dimCentiMeter} = await import('../src/scripts/core/dimensioning.js');

Configuration.setValue(configDimUnit, dimCentiMeter);

const round = (value) => Math.round(value * 1e6) / 1e6 + 0;

/**
 * Legacy `Geometry` -> flat per-triangle-corner arrays.
 *
 * `faceVertexUvs[0]` is indexed by face, not by vertex, which is precisely why
 * this form exists: an indexed BufferGeometry cannot reproduce per-face UVs,
 * only per-vertex ones. Recording what each corner actually receives lets the
 * post-bump test prove the drawn result is unchanged even though the storage
 * layout is not.
 */
function canonicalLegacy(geometry)
{
	const p = [];
	const uv = [];
	const n = [];
	const uvSets = geometry.faceVertexUvs && geometry.faceVertexUvs[0];
	const hasUv = !!(uvSets && uvSets.length === geometry.faces.length);

	geometry.faces.forEach((face, faceIndex) =>
	{
		[face.a, face.b, face.c].forEach((vertexIndex, corner) =>
		{
			const vertex = geometry.vertices[vertexIndex];
			p.push(round(vertex.x), round(vertex.y), round(vertex.z));

			if (hasUv)
			{
				const slot = uvSets[faceIndex][corner];
				uv.push(round(slot.x), round(slot.y));
			}

			const normal = (face.vertexNormals && face.vertexNormals.length === 3)
				? face.vertexNormals[corner]
				: face.normal;
			if (normal) { n.push(round(normal.x), round(normal.y), round(normal.z)); }
		});
	});

	// The HUD's rotate handle is a LineSegments: vertices, no faces. Recording
	// the raw vertex list keeps it in the comparison instead of silently
	// canonicalising to nothing.
	const points = [];
	if (geometry.faces.length === 0)
	{
		geometry.vertices.forEach((vertex) => points.push(round(vertex.x), round(vertex.y), round(vertex.z)));
	}

	return {
		triangles: geometry.faces.length,
		p,
		uv: hasUv ? uv : null,
		n: n.length ? n : null,
		points: points.length ? points : null,
	};
}

const goldens = {};
function record(key, geometry)
{
	if (goldens[key]) { throw new Error(`duplicate golden key: ${key}`); }
	goldens[key] = canonicalLegacy(geometry);
}

/* ---------------------------------------------------------------- shapes --
   ShapeGeometry is the single riskiest swap in the sprint: r185 exports the
   same *name* bound to a different class, so nothing fails to compile and the
   triangulation silently becomes whatever earcut does today. These four cases
   pin it on its own, away from the wall UV maths, so a failure downstream can
   be attributed rather than guessed at. */
const shapeCases = {
	'shape.square': new Shape([
		new Vector2(0, 0), new Vector2(300, 0), new Vector2(300, 250), new Vector2(0, 250),
	]),
	'shape.lshape': new Shape([
		new Vector2(0, 0), new Vector2(400, 0), new Vector2(400, 200),
		new Vector2(200, 200), new Vector2(200, 350), new Vector2(0, 350),
	]),
	'shape.concave': new Shape([
		new Vector2(0, 0), new Vector2(500, 0), new Vector2(500, 300),
		new Vector2(300, 120), new Vector2(120, 300), new Vector2(0, 300),
	]),
};

const holed = new Shape([
	new Vector2(0, 0), new Vector2(500, 0), new Vector2(500, 250), new Vector2(0, 250),
]);
holed.holes.push(new Path([
	new Vector2(80, 60), new Vector2(180, 60), new Vector2(180, 190), new Vector2(80, 190),
]));
holed.holes.push(new Path([
	new Vector2(300, 90), new Vector2(420, 90), new Vector2(420, 170), new Vector2(300, 170),
]));
shapeCases['shape.twoHoles'] = holed;

Object.entries(shapeCases).forEach(([key, shape]) =>
{
	record(key, new ShapeGeometry(shape));
});

/* ------------------------------------------------------------ floorplan --
   A real plan, not a synthetic one: rooms, half-edges and their transforms all
   have to agree for the wall UVs to mean anything. Corner elevations are
   deliberately uneven so the varying-height filler and the non-planar
   raycast plane are both exercised. */
const floorplan = new Floorplan();
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

const room = floorplan.getRooms()[0];
record('room.floorPlane', room.floorPlane.geometry);
record('room.roofPlane', room.roofPlane.geometry);

floorplan.wallEdges().forEach((edge, index) =>
{
	record(`halfEdge.plane.${index}`, edge.plane.geometry);
});

/* --------------------------------------------------------------- floor 3d -- */
const sceneStub = {add() {}, remove() {}, needsUpdate: false};
const floor = new Floor(sceneStub, room);
record('floor.buildFloor', floor.buildFloor().geometry);
record('floor.buildRoofVaryingHeight', floor.buildRoofVaryingHeight().geometry);
record('floor.buildRoofUniformHeight', floor.buildRoofUniformHeight().geometry);

/* ---------------------------------------------------------------- edges --
   Edge needs a camera to decide visibility and an EventDispatcher to listen
   to; neither influences geometry, so both are stubs. Wall items are plain
   objects on purpose - makeWall reads exactly `position` and `halfSize` off
   them, and going through the real Item loader would drag in the whole
   catalog for two vectors. */
const controlsStub = new THREE.EventDispatcher();
controlsStub.object = {position: new Vector3(600, 400, 600)};

const wallEdges = floorplan.wallEdges();
const holedEdge = wallEdges[0];
holedEdge.wall.items = [
	{position: new Vector3(120, 100, 0), halfSize: new Vector3(40, 60, 10)},
	{position: new Vector3(280, 120, 0), halfSize: new Vector3(35, 45, 10)},
];

[
	['edge.withHoles', holedEdge],
	['edge.plain', wallEdges[1]],
].forEach(([prefix, halfEdge]) =>
{
	const edge = new Edge(sceneStub, halfEdge, controlsStub);
	edge.planes.forEach((plane, index) => record(`${prefix}.plane.${index}`, plane.geometry));
	edge.basePlanes.forEach((plane, index) => record(`${prefix}.basePlane.${index}`, plane.geometry));
	record(`${prefix}.sideFiller`, edge.buildSideFillter(
		halfEdge.interiorStart(), halfEdge.exteriorStart(), 240, 0xcccccc).geometry);
});

/* ------------------------------------------------------------------ hud -- */
const hud = new HUD(new THREE.EventDispatcher(), controlsStub);
record('hud.line', hud.makeLineGeometry({halfSize: new Vector3(30, 20, 45)}));

writeFileSync(OUT, `${JSON.stringify(goldens, null, '\t')}\n`);

const totals = Object.entries(goldens)
	.map(([key, value]) => `  ${key.padEnd(30)} ${String(value.triangles).padStart(4)} tri${value.uv ? '  +uv' : ''}`)
	.join('\n');
console.log(`three r98 geometry frozen -> ${OUT}\n${totals}\n\n${Object.keys(goldens).length} geometries captured.`);
