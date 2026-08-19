// @vitest-environment jsdom
/**
 * What a surface is made of (RM-011 H1).
 *
 * **M-42** is the metric this file carries: *every surface's saved record
 * round-trips byte-identically; a design where nobody touched a material writes
 * no material key at all; and for every combination the picker offers, the
 * mesh's maps, colour and repeat equal the description that produced them.*
 * The first two clauses are string and object comparisons and live here; the
 * third needs a scene, and the part of it that needs a GPU is in
 * `tests/browser/surface-materials.test.js`.
 *
 * RM-011 W-3 measured what was here before: three fields for a wall side, two
 * for a floor, and nothing at all for a ceiling. RM-007's gap Q-4 lists four
 * consequences of that and this sprint answers them, so the tests below are
 * organised by the promise rather than by the module.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {
	NO_TINT, SURFACE_DEFAULTS, normaliseSurface, isPlainSurface, surfaceToJSON,
	writeSurfaceMaterial, colorValue, multiplyHex,
} from '../src/scripts/model/surface.js';
import {Texture} from 'three';
import {applySurfaceTransform, acquireSurfaceMaps, releaseSurfaceMaps} from '../src/scripts/three/surface_material.js';
import {clearTextureCache, textureCacheStats} from '../src/scripts/three/texture_cache.js';
import {resolveRuntime} from '../src/scripts/core/design_runtime.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

let canvasStub;

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
});

afterEach(() =>
{
	canvasStub.restore();
});

/** A closed room, so there is a floor and four wall sides to talk about. */
function room(floorplan, size)
{
	const corners = [
		floorplan.newCorner(0, 0), floorplan.newCorner(size, 0),
		floorplan.newCorner(size, size), floorplan.newCorner(0, size),
	];
	for (let i = 0; i < 4; i++)
	{
		floorplan.newWall(corners[i], corners[(i + 1) % 4]);
	}
	floorplan.update();
	return floorplan.getRooms()[0];
}

describe('the description', () =>
{
	it('is total: a record that says nothing is the default material', () =>
	{
		expect(normaliseSurface()).toEqual(SURFACE_DEFAULTS);
		expect(normaliseSurface({url: 'a.png', stretch: true, scale: 0})).toEqual(SURFACE_DEFAULTS);
		expect(isPlainSurface({url: 'a.png'})).toBe(true);
	});

	it('reads a colour the way a person writes one, and refuses what is not one', () =>
	{
		expect(normaliseSurface({color: '#ABC'}).color).toBe('#aabbcc');
		expect(normaliseSurface({color: '  #C8B48C '}).color).toBe('#c8b48c');
		// Not a colour: a name, a number, a short hex that is not three digits.
		expect(normaliseSurface({color: 'red'}).color).toBe(NO_TINT);
		expect(normaliseSurface({color: 0xff0000}).color).toBe(NO_TINT);
		expect(normaliseSurface({color: '#ff00'}).color).toBe(NO_TINT);
	});

	it('wraps a rotation and an offset rather than clamping them', () =>
	{
		expect(normaliseSurface({rotation: 400}).rotation).toBe(40);
		expect(normaliseSurface({rotation: -90}).rotation).toBe(270);
		expect(normaliseSurface({rotation: 'sideways'}).rotation).toBe(0);
		// An offset is a fraction of a tile, and a whole tile is no offset.
		expect(normaliseSurface({offsetX: 1.25}).offsetX).toBeCloseTo(0.25, 10);
		expect(normaliseSurface({offsetY: -0.5}).offsetY).toBe(-0.5);
	});

	it('treats an empty map url as no map', () =>
	{
		expect(normaliseSurface({normalMap: ''}).normalMap).toBeNull();
		expect(normaliseSurface({normalMap: '  '}).normalMap).toBeNull();
		expect(normaliseSurface({normalMap: ' n.ktx2 '}).normalMap).toBe('n.ktx2');
	});

	it('multiplies a tint rather than replacing what it tints', () =>
	{
		// White is the absence of a tint, which is the whole reason it is the
		// default: a surface with a base colour keeps it.
		expect(multiplyHex(0xcccccc, colorValue(NO_TINT))).toBe(0xcccccc);
		expect(multiplyHex(0xffffff, colorValue('#c8b48c'))).toBe(0xc8b48c);
		// Half of a half.
		expect(multiplyHex(0x808080, 0x808080)).toBe(0x404040);
	});
});

describe('M-42 - written only where somebody changed something', () =>
{
	it('writes no material key for a surface nobody has touched', () =>
	{
		expect(surfaceToJSON({url: 'a.png', stretch: false, scale: 300})).toBeNull();
		expect(writeSurfaceMaterial({url: 'a.png', scale: 300}))
			.toEqual({url: 'a.png', scale: 300});
	});

	it('writes exactly the keys that differ, and no others', () =>
	{
		expect(surfaceToJSON({color: '#c8b48c'})).toEqual({color: '#c8b48c'});
		expect(surfaceToJSON({rotation: 90, offsetX: 0.25}))
			.toEqual({rotation: 90, offsetX: 0.25});
		// White is the default, so picking it explicitly writes nothing - which is
		// what makes "clear the tint" and "never tinted it" the same file.
		expect(surfaceToJSON({color: NO_TINT})).toBeNull();
	});

	/**
	 * The claim the whole conditional rule exists for, and the one that would be
	 * quietly broken by writing a key unconditionally.
	 */
	it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.blueprint3d')))(
		're-saves %s byte-identically, with no material keys anywhere', (name) =>
		{
			const model = new Model('/textures/');
			const original = readFileSync(join(FIXTURES, name), 'utf8');

			model.loadSerialized(original);
			const once = model.exportSerialized();
			model.loadSerialized(once);

			expect(model.exportSerialized()).toBe(once);
			// Asserted on the surface records rather than on the whole string: an
			// item legitimately has a `rotation`, and a test that greps the file
			// would be asserting that furniture cannot turn.
			const saved = JSON.parse(once);
			const surfaces = saved.floorplan.walls
				.flatMap((wall) => [wall.frontTexture, wall.backTexture])
				.concat(Object.values(saved.floorplan.newFloorTextures))
				.filter(Boolean);
			surfaces.forEach((record) =>
			{
				expect(Object.keys(record).sort())
					.toEqual(record.stretch === undefined ? ['scale', 'url'] : ['scale', 'stretch', 'url']);
			});
			expect(saved.floorplan.ceilings).toBeUndefined();
		});

	it('round-trips a design that does carry materials', () =>
	{
		const model = new Model('/textures/');
		const floor = room(model.floorplan, 400);
		floor.setMaterial({color: '#c8b48c', rotation: 45, offsetX: 0.25});
		model.floorplan.getWalls()[0].frontTexture = writeSurfaceMaterial(
			{url: 'rooms/textures/wallmap.png', stretch: true, scale: 0},
			{color: '#204060', roughnessMap: 'r.ktx2'});
		floor.setCeiling({color: '#e8e8e8'});

		const once = model.exportSerialized();
		model.loadSerialized(once);

		expect(model.exportSerialized()).toBe(once);
		const saved = JSON.parse(once);
		expect(saved.floorplan.walls[0].frontTexture)
			.toEqual({url: 'rooms/textures/wallmap.png', stretch: true, scale: 0,
				color: '#204060', roughnessMap: 'r.ktx2'});
		expect(Object.values(saved.floorplan.newFloorTextures)[0])
			.toMatchObject({color: '#c8b48c', rotation: 45, offsetX: 0.25});
		expect(Object.values(saved.floorplan.ceilings)[0]).toEqual({color: '#e8e8e8'});
	});
});

describe('a surface keeps what it was not asked to change', () =>
{
	it('keeps the material when the image changes', () =>
	{
		const floorplan = new Floorplan();
		const target = room(floorplan, 400);
		target.setMaterial({color: '#c8b48c', rotation: 30});

		target.setTexture('rooms/textures/marbletiles.jpg', false, 300);

		expect(target.getMaterial()).toMatchObject({color: '#c8b48c', rotation: 30});
		expect(target.getTexture().url).toBe('rooms/textures/marbletiles.jpg');
	});

	it('keeps the image when the material changes', () =>
	{
		const floorplan = new Floorplan();
		room(floorplan, 400);
		const edge = floorplan.wallEdges()[0];
		edge.setTexture('rooms/textures/light_brick.jpg', false, 100);

		edge.setMaterial({color: '#204060'});

		expect(edge.getTexture().url).toBe('rooms/textures/light_brick.jpg');
		expect(edge.getTexture().scale).toBe(100);
		expect(edge.getMaterial().color).toBe('#204060');
	});

	it('gives a wall two sides that do not share a material', () =>
	{
		// Two rooms sharing a wall, because a wall only has two half-edges when
		// there is a room on each side of it - a lone room's walls have one face.
		const floorplan = new Floorplan();
		const a = floorplan.newCorner(0, 0);
		const b = floorplan.newCorner(400, 0);
		const c = floorplan.newCorner(400, 400);
		const d = floorplan.newCorner(0, 400);
		const e = floorplan.newCorner(800, 0);
		const f = floorplan.newCorner(800, 400);
		[[a, b], [b, c], [c, d], [d, a], [b, e], [e, f], [f, c]]
			.forEach(([from, to]) => floorplan.newWall(from, to));
		floorplan.update();

		const shared = floorplan.getWalls().find((wall) => wall.frontEdge && wall.backEdge);
		expect(shared).toBeTruthy();
		const front = shared.frontEdge;
		const back = shared.backEdge;

		front.setMaterial({color: '#204060'});
		back.setMaterial({color: '#c8b48c'});
		back.setTexture('rooms/textures/light_brick.jpg', false, 100);

		// Two sides of one wall, and the inside of a room is not the outside of it.
		expect(front.getMaterial().color).toBe('#204060');
		expect(back.getMaterial().color).toBe('#c8b48c');
		expect(back.getTexture().url).toBe('rooms/textures/light_brick.jpg');
		expect(front.getTexture().url).not.toBe('rooms/textures/light_brick.jpg');
	});

	it('carries a floor and a ceiling across a rebuild that renames the room', () =>
	{
		const floorplan = new Floorplan();
		const target = room(floorplan, 400);
		target.setMaterial({color: '#c8b48c'});
		target.setCeiling({color: '#e8e8e8'});

		// Move a corner: the room's uuid is derived from its corners (H-5), so it
		// becomes a different key and A3's matcher is what carries it across.
		floorplan.getCorners()[2].move(420, 400);
		floorplan.update(true);

		const rebuilt = floorplan.getRooms()[0];
		expect(rebuilt.getMaterial().color).toBe('#c8b48c');
		expect(rebuilt.getCeiling()).toEqual({color: '#e8e8e8'});
	});

	it('forgets a ceiling whose room is gone', () =>
	{
		const floorplan = new Floorplan();
		const target = room(floorplan, 400);
		target.setCeiling({color: '#e8e8e8'});
		// A record for a room that does not exist, which is what a design that has
		// been edited for a while accumulates if nothing prunes.
		floorplan.setCeilingSurface('a-room-that-is-not-here', {color: '#123456'});
		expect(Object.keys(floorplan.ceilingSurfaces)).toHaveLength(2);

		floorplan.update(true);

		// The live room keeps its ceiling; the ghost loses its.
		expect(Object.keys(floorplan.ceilingSurfaces)).toEqual([target.getUuid()]);
	});

	it('clears a ceiling back to the profile rather than leaving an empty record', () =>
	{
		const floorplan = new Floorplan();
		const target = room(floorplan, 400);
		target.setCeiling({color: '#e8e8e8'});

		target.setCeiling(null);

		expect(target.getCeiling()).toBeNull();
		expect(floorplan.saveFloorplan().ceilings).toBeUndefined();
	});
});

/**
 * Turning the description into texture state.
 *
 * `three/surface_material.js` is the seam between the two, and it is testable
 * without a scene because a `Texture` is a plain object until something uploads
 * it. The half that needs a GPU - that these settings reach a *material* - is in
 * the browser tier.
 */
describe('what three is told', () =>
{
	afterEach(() =>
	{
		clearTextureCache();
	});

	it('rotates about the centre of the tile, not its corner', () =>
	{
		const texture = new Texture();

		applySurfaceTransform(texture, normaliseSurface({rotation: 90}));

		expect(texture.rotation).toBeCloseTo(Math.PI / 2, 12);
		// three's default centre is (0,0), which swings a tile instead of
		// spinning it - visible immediately on a brick bond.
		expect(texture.center.x).toBe(0.5);
		expect(texture.center.y).toBe(0.5);
		// `needsUpdate` is write-only on a three Texture - reading it back gives
		// undefined - so the assertion is on what setting it actually does.
		expect(texture.version).toBeGreaterThan(0);
	});

	it('makes a moved tile repeat, so the sampler does not smear its edge', () =>
	{
		const still = new Texture();
		const moved = new Texture();

		applySurfaceTransform(still, normaliseSurface({}));
		applySurfaceTransform(moved, normaliseSurface({offsetX: 0.25}));

		// Untouched: whatever wrapping the caller already chose stays.
		expect(still.wrapS).toBe(1001);
		expect(moved.wrapS).toBe(1000);
		expect(moved.offset.x).toBeCloseTo(0.25, 12);
	});

	it('does nothing to a texture that is not there', () =>
	{
		expect(() => applySurfaceTransform(null, normaliseSurface({rotation: 90}))).not.toThrow();
	});

	it('acquires each map once and hands it back when it is replaced', () =>
	{
		const runtime = resolveRuntime(null);
		const before = textureCacheStats().handles;

		const maps = acquireSurfaceMaps(runtime, normaliseSurface({
			normalMap: 'rooms/textures/walllightmap.png',
			roughnessMap: 'rooms/textures/wallmap.png',
		}), null);

		expect(maps.normalMap).toBeTruthy();
		expect(maps.roughnessMap).toBeTruthy();
		// Data, not colour: three spells "no transfer function" as the empty
		// string, and decoding a normal map through one is the error H1's own
		// encode trial nearly recorded as a codec verdict.
		expect(maps.normalMap.colorSpace).toBe('');
		expect(textureCacheStats().handles).toBe(before + 2);

		// Replacing releases what was held, so a wall that changes material twice
		// does not hold three normal maps.
		const next = acquireSurfaceMaps(runtime, normaliseSurface({normalMap: 'rooms/textures/wallmap.png'}), maps);
		expect(next.roughnessMap).toBeNull();
		expect(textureCacheStats().handles).toBe(before + 1);

		releaseSurfaceMaps(next);
		expect(textureCacheStats().handles).toBe(before);
	});

	it('acquires nothing for a surface with no maps, and releases nothing twice', () =>
	{
		const runtime = resolveRuntime(null);
		const before = textureCacheStats().handles;

		const maps = acquireSurfaceMaps(runtime, normaliseSurface({}), null);

		expect(maps).toEqual({normalMap: null, roughnessMap: null});
		expect(textureCacheStats().handles).toBe(before);
		expect(() => releaseSurfaceMaps(null)).not.toThrow();
	});
});
