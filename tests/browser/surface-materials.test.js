/**
 * The mesh agrees with the description (RM-011 H1).
 *
 * **M-42**'s third clause, and the only one that needs a GPU: *for every
 * combination the picker offers, the mesh's maps, colour and repeat equal the
 * description that produced them.* The other two are string comparisons and
 * live in `tests/surface-materials.test.js`.
 *
 * Read off the live scene rather than off the model, because the whole point of
 * a material is that it reaches a surface. RM-011 W-2 found not one PBR map
 * anywhere in the tree by traversing exactly this way; these assertions are that
 * measurement run again with something to find.
 *
 * ## Both profiles, and they differ on purpose
 *
 * W-1 measured that `classic` draws walls with an unlit `MeshBasicMaterial`,
 * which has no `normalMap` and no `roughnessMap` to put anything in. H1's answer
 * is that maps are Studio-only and the tint applies to both, since a tint is a
 * multiply. That is a decision rather than a gap, so it is asserted rather than
 * worked around.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';
import {setRenderProfile, RENDER_CLASSIC, RENDER_STUDIO} from '../../src/scripts/core/render_profile.js';

const WALL_HEIGHT = 250;

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: WALL_HEIGHT},
			c2: {x: 400, y: 0, elevation: WALL_HEIGHT},
			c3: {x: 400, y: 400, elevation: WALL_HEIGHT},
			c4: {x: 0, y: 400, elevation: WALL_HEIGHT},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
	},
	items: [],
});

let host;
let bp;

function boot(profile)
{
	setRenderProfile(profile);
	host = document.createElement('div');
	host.innerHTML = '<canvas id="floorplanner-canvas" style="display:block;width:600px;height:400px"></canvas>'
		+ '<div id="viewer" style="width:640px;height:480px"></div>';
	document.body.appendChild(host);
	bp = new BlueprintJS({
		floorplannerElement: host.querySelector('#floorplanner-canvas'),
		threeElement: host.querySelector('#viewer'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	bp.model.loadSerialized(ROOM);
	bp.model.floorplan.update();
}

async function settled()
{
	bp.three.render(true);
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 300));
	bp.three.render(true);
}

/** Every material in the scene, flattened. */
function materials()
{
	const found = [];
	bp.three.scene.getScene().traverse((object) =>
	{
		if (!object.isMesh) { return; }
		(Array.isArray(object.material) ? object.material : [object.material])
			.forEach((material) => {if (material) {found.push({object, material});}});
	});
	return found;
}

/**
 * The wall *faces*, which is narrower than "everything named wall".
 *
 * An `Edge` builds five surfaces and only two of them are the painted face: the
 * others are the fillers and the sides, which carry no texture and their own
 * flat colours out of the profile. Selecting by "has the wall's map" is what
 * separates them, and the first draft of this file did not - which showed up as
 * a wall that was 0xdddddd before anybody had tinted anything.
 */
function wallFaces()
{
	return materials().filter(({object, material}) => object.name === 'wall' && material.map);
}

afterEach(() =>
{
	if (bp) { bp.dispose(); }
	if (host) { host.remove(); }
	host = null;
	bp = null;
	setRenderProfile(RENDER_CLASSIC);
});

describe('a tint reaches the surface, in both profiles', () =>
{
	it('tints a wall under studio', async () =>
	{
		boot(RENDER_STUDIO);
		await settled();
		// The painted faces are white and the fillers - the top of the wall - are
		// the profile's 0xdddddd. Both carry the wall's map, which is why this
		// counts rather than asserting one value.
		const before = wallFaces().map(({material}) => material.color.getHexString()).sort();
		expect(new Set(before)).toEqual(new Set(['ffffff', 'dddddd']));

		bp.model.floorplan.wallEdges()[0].setMaterial({color: '#204060'});
		await settled();

		const tinted = wallFaces().filter(({material}) => material.color.getHexString() === '204060');
		expect(tinted.length).toBeGreaterThan(0);
		// And its top edge went with it: 0xdddddd multiplied by the tint, which is 0x1c3753.
		const filler = wallFaces().filter(({material}) => material.color.getHexString() === '1c3753');
		expect(filler.length).toBeGreaterThan(0);
	});

	it('tints a wall under classic, where there are no maps to go with it', async () =>
	{
		boot(RENDER_CLASSIC);
		await settled();

		bp.model.floorplan.wallEdges()[0].setMaterial({color: '#204060'});
		await settled();

		const tinted = wallFaces().filter(({material}) => material.color.getHexString() === '204060');
		expect(tinted.length).toBeGreaterThan(0);
		// An unlit material, and the tint still multiplies its map.
		expect(tinted[0].material.type).toBe('MeshBasicMaterial');
	});

	it('tints a floor without discarding the profile\'s own colour', async () =>
	{
		boot(RENDER_CLASSIC);
		await settled();
		const floor = () => materials().find(({material}) => material.type === 'MeshPhongMaterial');
		// Classic multiplies its floor texture down to 0xcccccc.
		expect(floor().material.color.getHexString()).toBe('cccccc');

		bp.model.floorplan.getRooms()[0].setMaterial({color: '#808080'});
		bp.model.floorplan.update();
		await settled();

		// Half of 0xcc, not 0x80: a tint multiplies what it tints.
		expect(floor().material.color.getHexString()).toBe('666666');
	});
});

describe('the tile goes where the description says', () =>
{
	it('rotates and offsets a wall texture about its own centre', async () =>
	{
		boot(RENDER_STUDIO);
		await settled();
		const mapOf = () => wallFaces().map(({material}) => material.map).find(Boolean);
		expect(mapOf().rotation).toBe(0);

		bp.model.floorplan.wallEdges()[0].setMaterial({rotation: 90, offsetX: 0.25});
		await settled();

		const turned = wallFaces()
			.map(({material}) => material.map)
			.filter((map) => map && Math.abs(map.rotation - Math.PI / 2) < 1e-9);
		expect(turned.length).toBeGreaterThan(0);
		expect(turned[0].offset.x).toBeCloseTo(0.25, 10);
		// About the middle of the tile, not its corner - three's default is (0,0),
		// which swings the tile instead of spinning it.
		expect(turned[0].center.x).toBe(0.5);
		expect(turned[0].center.y).toBe(0.5);
	});
});

describe('the maps are studio-only, and that is the decision (W-1)', () =>
{
	it('puts a normal and a roughness map on a studio wall', async () =>
	{
		boot(RENDER_STUDIO);
		bp.model.floorplan.wallEdges()[0].setMaterial({
			normalMap: 'rooms/textures/walllightmap.png',
			roughnessMap: 'rooms/textures/walllightmap.png',
		});
		await settled();

		const mapped = wallFaces().filter(({material}) => material.normalMap);
		expect(mapped.length).toBeGreaterThan(0);
		expect(mapped[0].material.type).toBe('MeshStandardMaterial');
		expect(mapped[0].material.roughnessMap).toBeTruthy();
		// Data, not colour. Decoding a normal map through a transfer function is
		// the error H1's encode trial nearly recorded as a codec verdict.
		expect(mapped[0].material.normalMap.colorSpace).toBe('');
	});

	it('puts none on a classic wall, because there is nowhere to put them', async () =>
	{
		boot(RENDER_CLASSIC);
		bp.model.floorplan.wallEdges()[0].setMaterial({
			normalMap: 'rooms/textures/walllightmap.png',
		});
		await settled();

		expect(wallFaces().every(({material}) => !material.normalMap)).toBe(true);
	});
});

describe('a ceiling has a material now (Q-4)', () =>
{
	it('draws the profile colour when nobody has said otherwise', async () =>
	{
		boot(RENDER_STUDIO);
		await settled();
		const ceiling = materials().find(({material}) => material.type === 'MeshBasicMaterial'
			&& material.color && material.color.getHexString() !== 'ffffff'
			&& !material.map);
		expect(ceiling).toBeTruthy();
		expect(bp.model.floorplan.getRooms()[0].getCeiling()).toBeNull();
	});

	it('tints it when somebody has', async () =>
	{
		boot(RENDER_STUDIO);
		await settled();
		// Not every material has a colour - the skybox is a ShaderMaterial - so the
		// census is over the ones that do.
		const colours = () => materials()
			.filter(({material}) => material.color)
			.map(({material}) => material.color.getHexString());
		const before = colours();

		bp.model.floorplan.getRooms()[0].setCeiling({color: '#804020'});
		bp.model.floorplan.update();
		await settled();

		const after = colours();
		expect(after).not.toEqual(before);
		expect(bp.model.floorplan.getRooms()[0].getCeiling()).toEqual({color: '#804020'});
	});
});
