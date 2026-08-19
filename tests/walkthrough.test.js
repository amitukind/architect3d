// @vitest-environment jsdom
/**
 * Eye height, and a teleport (RM-011 H3).
 *
 * H3's second bullet, and the acceptance clause that goes with it: *"the
 * walkthrough is still exactly the fork's physics: friction 10/s, gravity
 * 980/s^2, walk 3000, jump 350, eye 160 - a teleport moves the walker and
 * changes nothing else"*.
 *
 * The five constants are **measured off the motion** rather than read back off
 * the object. An assertion that `walkspeed === 3000` passes on a rig that has
 * stopped using it; an assertion that one held key for one step of 0.1 s moves
 * the walker exactly 30 cm does not. Each derivation is written beside the
 * number it recovers, so the arithmetic can be checked on paper.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';

import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {PointerLockControls, EYE_HEIGHT} from '../src/scripts/three/pointerlockcontrols.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const ROOM = JSON.stringify({
	floorplan: {
		version: '2.0.0', units: 'cm',
		corners: {
			c1: {x: 0, y: 0, elevation: 250}, c2: {x: 400, y: 0, elevation: 250},
			c3: {x: 400, y: 400, elevation: 250}, c4: {x: 0, y: 400, elevation: 250},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
	},
	items: [],
});

let canvasStub;
let observer;
let pointerApis;
let listeners;

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	listeners = installListenerCounter(window);
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub());
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
	listeners.restore();
	document.body.innerHTML = '';
});

function walker()
{
	const camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
	const element = document.createElement('div');
	document.body.appendChild(element);
	const controls = new PointerLockControls(camera, element);
	controls.characterHeight = EYE_HEIGHT.default;
	controls.enabled = true;
	return {controls, camera};
}

const press = (code) => document.dispatchEvent(new window.KeyboardEvent('keydown', {code}));
const release = (code) => document.dispatchEvent(new window.KeyboardEvent('keyup', {code}));

function viewer(serialized)
{
	const host = document.createElement('div');
	host.id = 'viewer';
	document.body.appendChild(host);
	setLayout(host, {left: 0, top: 0, width: 1024, height: 768});
	const model = new Model();
	if (serialized) { model.loadSerialized(serialized); }
	const three = new Main(model, host, 'three-canvas', {});
	setLayout(three.renderer.domElement, {left: 0, top: 0, width: 1024, height: 768});
	return {three, model, host};
}

describe('the fork\'s physics, measured rather than quoted', () =>
{
	it('accelerates a walk at 3000 cm/s²', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(0, 0, 0, 'YXZ');

		// One step of 0.1 s from a standstill: velocity becomes a*dt and the step
		// taken is velocity*dt, so the displacement is a*dt^2 = a/100.
		press('KeyD');
		controls.update(0.1);
		release('KeyD');
		expect(camera.position.x).toBeCloseTo(3000 * 0.01, 9);
		controls.dispose();
	});

	it('rubs a tenth of the speed off per hundredth of a second - friction 10/s', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(0, 0, 0, 'YXZ');

		press('KeyD');
		controls.update(0.05);
		release('KeyD');
		const powered = camera.position.x;
		controls.update(0.05);
		const coasting = camera.position.x - powered;

		// v *= (1 - k*dt) once per step, so two equal steps are in that ratio.
		expect(coasting / powered).toBeCloseTo(1 - (10 * 0.05), 9);
		controls.dispose();
	});

	it('falls at 980 cm/s²', () =>
	{
		const {controls, camera} = walker();
		// High enough that the floor never interrupts the fall.
		camera.position.set(0, 100000, 0);
		controls.update(0.5);
		// One Euler step: v = -g*dt, and the step taken is v*dt = -g*dt^2.
		expect(100000 - camera.position.y).toBeCloseTo(980 * 0.25, 6);
		controls.dispose();
	});

	it('jumps with an impulse of 350', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		controls.update(1 / 60); // lands, which is what arms the jump

		press('Space');
		controls.update(0.1);
		release('Space');

		// The step is (impulse - g*dt) * dt, and g is 980 by the test above.
		const rise = camera.position.y - 160;
		expect((rise / 0.1) + (980 * 0.1)).toBeCloseTo(350, 6);
		controls.dispose();
	});

	it('stands 160 cm tall, which is what Main assigns', () =>
	{
		expect(EYE_HEIGHT.default).toBe(160);
		const {three} = viewer();
		expect(three.fpscontrols.characterHeight).toBe(160);
		expect(three.eyeHeight()).toBe(160);
		three.dispose();
	});

	it('defaults its floor to zero, so the fall is the fork\'s arithmetic', () =>
	{
		const {controls, camera} = walker();
		expect(controls.groundHeight).toBe(0);
		expect(controls.eyeLevel()).toBe(160);
		camera.position.set(0, 400, 0);
		for (let i = 0; i < 60; i++) {controls.update(1 / 60);}
		expect(camera.position.y).toBe(160);
		controls.dispose();
	});
});

describe('a teleport moves the walker and changes nothing else', () =>
{
	it('writes the position, and keeps the floor it was already on', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		controls.teleport(250, -75);
		expect(camera.position.toArray()).toEqual([250, 160, -75]);
		expect(controls.groundHeight).toBe(0);
		controls.dispose();
	});

	it('leaves the way the walker is looking alone', () =>
	{
		const {controls, camera} = walker();
		camera.rotation.set(0.3, -1.2, 0, 'YXZ');
		const facing = camera.quaternion.clone();
		controls.teleport(100, 100, 0);
		expect(camera.quaternion.equals(facing)).toBe(true);
		controls.dispose();
	});

	it('leaves the velocity alone, so a walker in motion arrives in motion', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		camera.rotation.set(0, 0, 0, 'YXZ');

		press('KeyD');
		controls.update(0.05);
		release('KeyD');
		const moving = camera.position.x;

		controls.teleport(1000, 0);
		controls.update(0.05);
		// The same coasting step the friction test measures, taken from the new
		// place: the position moved and the momentum did not.
		expect(camera.position.x - 1000).toBeCloseTo(moving * (1 - (10 * 0.05)), 9);
		controls.dispose();
	});

	it('leaves a jump in the air, rather than cancelling it', () =>
	{
		const {controls, camera} = walker();
		camera.position.set(0, 160, 0);
		controls.update(1 / 60);
		press('Space');
		release('Space');

		controls.teleport(300, 300);
		expect(camera.position.y).toBe(160);
		controls.update(1 / 60);
		// Still going up, because the impulse was never touched.
		expect(camera.position.y).toBeGreaterThan(160);
		controls.dispose();
	});
});

describe('a floor that is not the ground floor', () =>
{
	it('stands on the storey it was teleported to, and does not fall through it', () =>
	{
		const {controls, camera} = walker();
		controls.teleport(50, 50, 250);
		expect(camera.position.y).toBe(410);
		expect(controls.eyeLevel()).toBe(410);

		for (let i = 0; i < 60; i++) {controls.update(1 / 60);}
		expect(camera.position.y).toBe(410);
		controls.dispose();
	});

	it('falls back to the ground floor once teleported down again', () =>
	{
		const {controls, camera} = walker();
		controls.teleport(0, 0, 250);
		controls.teleport(0, 0, 0);
		expect(camera.position.y).toBe(160);
		controls.dispose();
	});
});

describe('eye height is the person, not the building', () =>
{
	it('lifts a standing walker straight away, and clamps to a person\'s range', () =>
	{
		const {three} = viewer();
		three.fpscontrols.getObject().position.set(0, 160, 0);

		three.setEyeHeight(190);
		expect(three.eyeHeight()).toBe(190);
		expect(three.fpscontrols.getObject().position.y).toBe(190);

		three.setEyeHeight(5000);
		expect(three.eyeHeight()).toBe(EYE_HEIGHT.max);
		three.setEyeHeight(1);
		expect(three.eyeHeight()).toBe(EYE_HEIGHT.min);
		three.dispose();
	});

	it('leaves a walker in mid-air where they are', () =>
	{
		const {three} = viewer();
		three.fpscontrols.getObject().position.set(0, 900, 0);
		three.setEyeHeight(190);
		expect(three.fpscontrols.getObject().position.y).toBe(900);
		three.dispose();
	});

	it('is measured from the floor the walker is standing on', () =>
	{
		const {three} = viewer();
		three.fpscontrols.teleport(0, 0, 250);
		three.setEyeHeight(180);
		expect(three.fpscontrols.getObject().position.y).toBe(430);
		three.dispose();
	});

	it('writes nothing to the design', () =>
	{
		// The decision, asserted: eye height is a session preference, so a design
		// re-saves byte-identical after the walker has changed height.
		const {three, model} = viewer(ROOM);
		const before = model.exportSerialized();
		three.setEyeHeight(205);
		expect(model.exportSerialized()).toBe(before);
		three.dispose();
	});
});

describe('what a click in the walkthrough aims at', () =>
{
	it('collects the floors of every storey shown, and drops the hidden ones', () =>
	{
		const {three, model} = viewer(ROOM);
		model.floorplan.update();
		expect(three.walkableSurfaces().length).toBeGreaterThan(0);

		three.model.scene.levelGroups.forEach((group) => {group.visible = false;});
		expect(three.walkableSurfaces()).toEqual([]);
		three.dispose();
	});

	it('teleports to whatever the middle of the view is resting on', () =>
	{
		const {three, model} = viewer(ROOM);
		model.floorplan.update();

		const walker = three.fpscontrols.getObject();
		walker.position.set(200, 160, 200);
		// Straight down, so the aim lands on the floor of the room below.
		walker.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');

		const landed = three.teleportToView();
		expect(landed).not.toBeNull();
		expect(landed.y).toBeCloseTo(0, 6);
		expect(walker.position.x).toBeCloseTo(200, 6);
		expect(walker.position.z).toBeCloseTo(200, 6);
		expect(walker.position.y).toBeCloseTo(160, 6);
		three.dispose();
	});

	it('does nothing when there is no floor in the middle of the view', () =>
	{
		const {three, model} = viewer(ROOM);
		model.floorplan.update();

		const walker = three.fpscontrols.getObject();
		walker.position.set(200, 160, 200);
		walker.rotation.set(Math.PI / 2, 0, 0, 'YXZ'); // looking at the ceiling

		expect(three.teleportToView()).toBeNull();
		expect(walker.position.toArray()).toEqual([200, 160, 200]);
		three.dispose();
	});

	it('only fires while walking - a click in the design view still selects', () =>
	{
		const {three, model, host} = viewer(ROOM);
		model.floorplan.update();
		const walker = three.fpscontrols.getObject();
		walker.position.set(200, 160, 200);
		walker.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');

		three.firstpersonmode = false;
		host.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		expect(walker.position.toArray()).toEqual([200, 160, 200]);

		three.firstpersonmode = true;
		host.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		expect(walker.position.y).toBeCloseTo(160, 6);
		expect(three.fpscontrols.groundHeight).toBeCloseTo(0, 6);
		three.dispose();
	});
});
