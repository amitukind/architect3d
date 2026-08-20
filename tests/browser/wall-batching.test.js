/**
 * Fewer meshes for the same picture (RM-015 M2, finding AA-3, tier 2).
 *
 * AA-3 measured a 36-room plan at **802 draw calls for 2,516 triangles** - 3.1
 * triangles per call, a scene bound entirely by call overhead - and found the
 * furniture was not the cause: 150 items added 300 calls, and the building
 * itself was the other 802.
 *
 * Two things batch, and the reason only two do is `Edge.updateVisibility`. It
 * walks `planes` on every camera move and writes `material.opacity` per edge, so
 * a wall face fades when the camera is behind it. Geometry that shares a mesh
 * shares a material and therefore shares that fade, which rules out batching
 * across faces. What is left:
 *
 *   base planes   excluded from that loop - the code calls them "always
 *                 visible" - so every face's base is one mesh for the whole plan
 *   side fillers  the two of one face always fade together, so they are one
 *                 mesh per face sharing one material with both originals
 *
 * These are draw-call ceilings, not frame times. A millisecond on a CI runner
 * measures the runner; a draw call is the same number on every machine, and
 * AA-3's table says the frame was never the thing that was wrong.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {BlueprintJS} from '../../src/scripts/blueprint.js';
import {Configuration, configDimUnit} from '../../src/scripts/core/configuration.js';
import {dimCentiMeter} from '../../src/scripts/core/units.js';

let hosts = [];

/** A grid of unconnected square rooms, which is the shape AA-3 measured. */
function design(rooms)
{
	const corners = {};
	const walls = [];
	let n = 0;
	const side = Math.round(Math.sqrt(rooms));
	for (let i = 0; i < side; i++)
	{
		for (let j = 0; j < side; j++)
		{
			const x = i * 400;
			const y = j * 400;
			const ids = [];
			for (const [dx, dy] of [[0, 0], [400, 0], [400, 400], [0, 400]])
			{
				const id = `c${n++}`;
				corners[id] = {x: x + dx, y: y + dy, elevation: 0};
				ids.push(id);
			}
			for (let k = 0; k < 4; k++) { walls.push({corner1: ids[k], corner2: ids[(k + 1) % 4]}); }
		}
	}
	return JSON.stringify({floorplan: {corners, walls, rooms: {}, units: 'cm', version: '2.0.0'}, items: []});
}

async function mount(rooms)
{
	const host = document.createElement('div');
	host.innerHTML = '<canvas style="display:block;width:800px;height:600px"></canvas>'
		+ '<div style="width:800px;height:600px"></div>';
	document.body.appendChild(host);
	hosts.push(host);
	const blueprint = new BlueprintJS({
		floorplannerElement: host.querySelector('canvas'),
		threeElement: host.querySelector('div'),
		threeCanvasElement: null,
		textureDir: 'models/textures/',
		widget: false,
	});
	Configuration.setValue(configDimUnit, dimCentiMeter);
	blueprint.model.scene.setItemLoader(() => {});
	blueprint.model.loadSerialized(design(rooms));
	await new Promise((resolve) => setTimeout(resolve, 250));
	blueprint.three.render(true);
	return blueprint;
}

function meshesNamed(blueprint, name)
{
	let found = 0;
	blueprint.three.scene.getScene().traverse((node) =>
	{
		if (node.isMesh && node.name === name) { found += 1; }
	});
	return found;
}

afterEach(() => {hosts.forEach((host) => host.remove()); hosts = [];});

describe('the building draws in fewer calls than it did', () =>
{
	/**
	 * A ratchet on what M2 achieved, in the shape the coverage floors have: the
	 * measurement, with enough margin that it fails on a regression rather than
	 * on noise. Measured 449 at 144 walls and 972 at 400, against 802 at 144
	 * before the sprint.
	 */
	it('draws a 144-wall plan in under 500 calls, against 802 before', async () =>
	{
		const blueprint = await mount(36);
		expect(blueprint.model.floorplan.getWalls().length).toBe(144);
		expect(blueprint.three.renderer.info.render.calls).toBeLessThan(500);
		blueprint.dispose?.();
	});

	it('draws a 400-wall plan in under 1,100 calls', async () =>
	{
		// 2.8 times the plan for 1.2 times the calls of the pre-sprint 144-wall
		// scene. M-52 asked for under 802 here and this does not reach it; the
		// landing block records why, and the number is not softened to match.
		const blueprint = await mount(100);
		expect(blueprint.model.floorplan.getWalls().length).toBe(400);
		expect(blueprint.three.renderer.info.render.calls).toBeLessThan(1100);
		blueprint.dispose?.();
	});

	it('draws every face base with one mesh, whatever the plan size', async () =>
	{
		// The claim that makes it a batch rather than a saving: the count does not
		// grow. One at 36 rooms and one at 100.
		const small = await mount(36);
		expect(meshesNamed(small, 'wall-bases')).toBe(1);
		small.dispose?.();
		hosts.forEach((host) => host.remove());
		hosts = [];

		const large = await mount(100);
		expect(meshesNamed(large, 'wall-bases')).toBe(1);
		large.dispose?.();
	});

	it('draws both side fillers of a face with one mesh, and neither on its own', async () =>
	{
		const blueprint = await mount(36);
		const walls = blueprint.model.floorplan.getWalls().length;

		expect(meshesNamed(blueprint, 'wall-sides')).toBe(walls);

		// The originals still exist, because the r98 goldens pin `planes` at five
		// entries and pin the geometry at each index. What changed is what reaches
		// the scene, not what the edge builds.
		const edge = blueprint.three.floorplan.edges[0];
		expect(edge.planes.length).toBe(5);
		expect(edge.batchedPlanes.size).toBe(2);
		edge.batchedPlanes.forEach((plane) =>
		{
			expect(blueprint.three.scene.getScene().children).not.toContain(plane);
		});

		blueprint.dispose?.();
	});

	/**
	 * The behaviour that could break silently, and the reason the batch shares a
	 * material object rather than making its own.
	 */
	it('still fades a face away from the camera, batch included', async () =>
	{
		const blueprint = await mount(36);
		const edge = blueprint.three.floorplan.edges[0];

		// The batch and the two planes it draws are one material, so whatever
		// updateVisibility writes reaches all three.
		expect(edge.sideBatch.material).toBe(edge.planes[3].material);
		expect(edge.sideBatch.material).toBe(edge.planes[4].material);

		edge.planes.forEach((plane) => {plane.material.opacity = 1.0;});
		edge.visible = true;
		// Drive it the way a camera move does, rather than setting the field.
		edge.updateVisibility();
		const afterOneSide = edge.sideBatch.material.opacity;

		// Put the camera on the other side of the same wall and ask again.
		const camera = blueprint.three.controls.object;
		camera.position.set(-camera.position.x, camera.position.y, -camera.position.z);
		edge.updateVisibility();
		const afterOther = edge.sideBatch.material.opacity;

		expect(new Set([afterOneSide, afterOther])).toEqual(new Set([1.0, 0.3]));
		blueprint.dispose?.();
	});
});
