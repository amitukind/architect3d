// @vitest-environment jsdom
/**
 * The 3D view's pointer, driven (RM-010 G3, finding V-8).
 *
 * `three/controller.js` is 302 statements at **36 % of branches**, and it is
 * the file that decides what a click hits. V-8 named it as the coverage debt
 * programme G lands on, and RM-010 gave G3 a stated test budget for it rather
 * than an intention - which is what worked for programme E, where the two
 * floorplanner files went from 63 % and 69 % to 82 % and 85 % across four
 * sprints while gaining features.
 *
 * ## Why this file exists rather than more tests in viewer-lifecycle
 *
 * That suite is about mounting and unmounting: it proves the viewer can be
 * built and torn down without leaking, and its four picking tests are about
 * *listener registration*. Nothing in this repository had ever pressed the
 * pointer down on an item and dragged it. So the state machine - five states,
 * three entry actions, four exit actions and four event handlers that switch on
 * all of them - was reachable only through a browser.
 *
 * Everything here drives the real `Controller` through a real `Main`, with only
 * the WebGL renderer faked through the `Main.setRendererFactory` seam. The
 * raycaster is three's, the geometry is the library's, and the pointer events
 * are the ones a browser sends.
 *
 * ## What per-level visibility has to do with picking
 *
 * The other half of V-8, and the reason this sprint owns it. `updateIntersections`
 * raycasts `Scene.getItems()` - the **active storey's** furniture since G1 - and
 * `checkWallsAndFloors` asks `model.floorplan`, the active storey's plan, for
 * its walls and floors. So a building drawn with every storey visible has two
 * storeys of walls that are visible and inert. That is a defensible answer, it
 * is the answer this build gives, and until G3 nothing said so.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {states} from '../src/scripts/three/controller.js';
import {
	EVENT_ITEM_MOVE_FINISH, EVENT_WALL_CLICKED, EVENT_FLOOR_CLICKED,
	EVENT_NOTHING_CLICKED, EVENT_CAMERA_VIEW_CHANGE,
} from '../src/scripts/core/events.js';
import {VIEW_EXTERIOR} from '../src/scripts/core/constants.js';
import {ITEM_TYPE_PARAMETRIC_STRUCTURE} from '../src/scripts/items/factory.js';
import {resetAll, stubItemLoader} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const HOUSE = readFileSync(join(FIXTURES, 'three-storey.blueprint3d'), 'utf8');

const WIDTH = 800;
const HEIGHT = 600;

let canvasStub;
let observer;
let pointerApis;
let renderers;
let viewer;

function buildViewerDom()
{
	viewer = document.createElement('div');
	viewer.id = 'viewer';
	document.body.appendChild(viewer);
	setLayout(viewer, {left: 0, top: 0, width: WIDTH, height: HEIGHT});
	return viewer;
}

/** A viewer over a model, with the item loader stubbed and the layout measured. */
function boot(design)
{
	const model = new Model('/textures/');
	model.scene.setItemLoader(stubItemLoader(THREE));
	if (design)
	{
		model.loadSerialized(design);
	}
	const three = new Main(model, buildViewerDom(), 'three-canvas', {});
	three.updateWindowSize();
	return {model, three, controller: three.getController()};
}

/** Where an object's centre lands on screen, in viewport pixels. */
function screenPoint(three, object)
{
	object.updateMatrixWorld(true);
	const world = new THREE.Vector3();
	object.getWorldPosition(world);
	const ndc = world.clone().project(three.camera);
	return {
		x: ((ndc.x + 1) / 2) * WIDTH,
		y: ((1 - ndc.y) / 2) * HEIGHT,
	};
}

/** Aim the camera straight down at a point, so a raycast through it hits. */
function lookDownAt(three, target, height)
{
	three.camera.position.set(target.x, height, target.z + 0.001);
	three.camera.lookAt(target);
	three.camera.updateMatrixWorld(true);
	three.scene.getScene().updateMatrixWorld(true);
}

function pointer(type, at, init)
{
	viewer.dispatchEvent(new window.PointerEvent(type, Object.assign({
		clientX: at.x, clientY: at.y, pointerType: 'mouse', bubbles: true, cancelable: true,
	}, init || {})));
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = WIDTH;
	window.innerHeight = HEIGHT;
	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub(renderers));
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	observer.restore();
	pointerApis.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
});

describe('the state machine', () =>
{
	it('starts unselected, with nothing hovered and nothing picked', () =>
	{
		const {three, controller} = boot();

		expect(controller.state).toBe(states.UNSELECTED);
		expect(controller.selectedObject).toBeNull();
		expect(controller.mouseoverObject).toBeNull();
		expect(controller.isRotating()).toBe(false);
		three.dispose();
	});

	it('enters SELECTED when something is selected, and hands the controls back', () =>
	{
		const {three, controller} = boot(HOUSE);
		const item = three.model.level.items[0];

		controller.setSelectedObject(item);

		expect(controller.state).toBe(states.SELECTED);
		expect(controller.selectedObject).toBe(item);
		// SELECTED is the state in which orbit is allowed; DRAGGING is not.
		expect(controller.controls.enabled).toBe(true);
		three.dispose();
	});

	it('turns off orbit while dragging and rotating, and back on when it stops', () =>
	{
		const {three, controller} = boot(HOUSE);
		controller.setSelectedObject(three.model.level.items[0]);

		controller.switchState(states.DRAGGING);
		expect(controller.controls.enabled).toBe(false);

		controller.switchState(states.ROTATING);
		expect(controller.controls.enabled).toBe(false);
		expect(controller.isRotating()).toBe(true);
		expect(controller.hud.rotating).toBe(true);

		controller.switchState(states.SELECTED);
		expect(controller.controls.enabled).toBe(true);
		expect(controller.isRotating()).toBe(false);
		three.dispose();
	});

	/**
	 * The comment in `setSelectedObject` says a switch from inside its null
	 * branch recurses forever, and that the suite returned a stack overflow when
	 * it was tried. This is the state that leaves: SELECTED with nothing
	 * selected, which `clickDragged` is written to survive.
	 */
	it('may be SELECTED with nothing selected, and does not throw when dragged', () =>
	{
		const {three, controller} = boot(HOUSE);
		controller.setSelectedObject(three.model.level.items[0]);

		controller.setSelectedObject(null);

		expect(controller.state).toBe(states.SELECTED);
		expect(controller.selectedObject).toBeNull();
		expect(() => controller.clickDragged(new THREE.Vector2(10, 10))).not.toThrow();
		three.dispose();
	});

	/**
	 * And the way out from outside, which is a state transition rather than a
	 * clear - RM-008 E1 measured that clearing the selection on the plan made
	 * every wall in the 3D view unclickable, because `checkWallsAndFloors` only
	 * answers while UNSELECTED.
	 */
	/**
	 * The same defect one method up, and the one that reaches the application:
	 * `Main.clearSelection()` is called every time the plan pane is shown.
	 */
	it('clears the selection from outside without claiming one', () =>
	{
		const {three, controller} = boot(HOUSE);

		three.clearSelection();

		expect(controller.state).toBe(states.UNSELECTED);
		expect(controller.selectedObject).toBeNull();
		three.dispose();
	});

	it('deselects by transitioning, so walls stay clickable afterwards', () =>
	{
		const {three, controller} = boot(HOUSE);
		controller.setSelectedObject(three.model.level.items[0]);

		controller.deselect();

		expect(controller.state).toBe(states.UNSELECTED);
		expect(controller.selectedObject).toBeNull();
		// Idempotent, since G3. It was not: `setSelectedObject(null)` switched
		// UNSELECTED -> SELECTED on the way in whatever it was handed, so calling
		// the method named `deselect` twice left the machine claiming a selection
		// it did not have.
		controller.deselect();
		expect(controller.state).toBe(states.UNSELECTED);
		expect(controller.selectedObject).toBeNull();
		three.dispose();
	});

	it('leaves ROTATING_FREE on the next press', () =>
	{
		const {three, controller} = boot(HOUSE);
		controller.setSelectedObject(three.model.level.items[0]);
		controller.switchState(states.ROTATING_FREE);

		pointer('pointerdown', {x: 10, y: 10});

		expect(controller.state).toBe(states.SELECTED);
		three.dispose();
	});
});

describe('the pointer, end to end', () =>
{
	it('hovers an item, selects it on press, drags it and announces the move', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const item = model.level.items.find((entry) => entry.structure);
		lookDownAt(three, item.position, 900);
		const at = screenPoint(three, item);

		const moves = [];
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, (event) => {moves.push(event.item);});

		pointer('pointermove', at);
		expect(controller.intersectedObject).toBe(item);
		expect(controller.mouseoverObject).toBe(item);

		pointer('pointerdown', at);
		expect(controller.selectedObject).toBe(item);
		expect(controller.state).toBe(states.DRAGGING);

		pointer('pointermove', {x: at.x + 40, y: at.y + 30});
		pointer('pointerup', {x: at.x + 40, y: at.y + 30});

		expect(controller.state).toBe(states.SELECTED);
		// Only a pointer that actually moved is an edit; a click that selects is
		// not, which is what `itemMoveFinished` checks.
		expect(moves).toEqual([item]);
		three.dispose();
	});

	it('does not call a click an edit', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const item = model.level.items.find((entry) => entry.structure);
		lookDownAt(three, item.position, 900);
		const at = screenPoint(three, item);

		const moves = [];
		model.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, (event) => {moves.push(event.item);});

		pointer('pointermove', at);
		pointer('pointerdown', at);
		pointer('pointerup', at);

		expect(controller.selectedObject).toBe(item);
		expect(moves).toEqual([]);
		three.dispose();
	});

	it('moves the hover from one item to the next, and clears it on the way out', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const first = model.level.items[0];
		lookDownAt(three, new THREE.Vector3(350, 0, 450), 1400);

		pointer('pointermove', screenPoint(three, first));
		const hovered = controller.mouseoverObject;
		expect(hovered).not.toBeNull();
		expect(three.domElement.style.cursor).toBe('pointer');

		// Off every item: the ground plane is 10 000 cm across and the camera is
		// looking down, so the far corner of the viewport is over nothing.
		pointer('pointermove', {x: 2, y: 2});
		expect(controller.mouseoverObject).toBeNull();
		expect(three.domElement.style.cursor).toBe('auto');
		three.dispose();
	});

	it('reports a wall click, a floor click and a click on neither', () =>
	{
		const {three} = boot(HOUSE);
		const seen = [];
		three.addEventListener(EVENT_WALL_CLICKED, () => {seen.push('wall');});
		three.addEventListener(EVENT_FLOOR_CLICKED, () => {seen.push('floor');});
		three.addEventListener(EVENT_NOTHING_CLICKED, () => {seen.push('nothing');});

		// Straight down at the middle of the ground floor: the floor is what is
		// under the pointer, and the walls are edge-on. The move first is not
		// optional - `getIntersections` casts from `alternateMouse`, which only a
		// move sets, so a press with no move behind it aims at the viewport's
		// corner.
		lookDownAt(three, new THREE.Vector3(350, 0, 450), 1200);
		const centre = {x: WIDTH / 2, y: HEIGHT / 2};
		pointer('pointermove', centre);
		pointer('pointerdown', centre);
		pointer('pointerup', centre);
		expect(seen).toEqual(['floor']);

		// And off the building entirely, which is the third answer.
		seen.length = 0;
		pointer('pointermove', {x: 4, y: 4});
		pointer('pointerdown', {x: 4, y: 4});
		pointer('pointerup', {x: 4, y: 4});
		expect(seen).toEqual(['nothing']);
		three.dispose();
	});

	it('resolves what is under a touch on the press, since a touch has no hover', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const item = model.level.items.find((entry) => entry.structure);
		lookDownAt(three, item.position, 900);
		const at = screenPoint(three, item);

		// No pointermove first - which is the whole point.
		pointer('pointerdown', at, {pointerType: 'touch'});

		expect(controller.selectedObject).toBe(item);
		three.dispose();
	});

	it('ignores every pointer event once disabled', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const item = model.level.items[0];
		lookDownAt(three, item.position, 900);
		const at = screenPoint(three, item);
		controller.enabled = false;

		pointer('pointermove', at);
		pointer('pointerdown', at);

		expect(controller.selectedObject).toBeNull();
		expect(controller.state).toBe(states.UNSELECTED);
		three.dispose();
	});
});

describe('picking and the storeys (V-8)', () =>
{
	it('picks only the storey being edited, however many are drawn', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		// Every storey visible, which is the default.
		three.showStoreys(true);
		const upstairs = model.levels[2].items[0];
		lookDownAt(three, new THREE.Vector3(350, 0, 450), 2400);
		const at = screenPoint(three, upstairs);

		pointer('pointermove', at);

		// The loft's beam is drawn and is nearest the camera, and it is not
		// pickable, because the ground floor is the storey being edited. What the
		// raycast is offered is `Scene.getItems()`, which is that storey's list.
		expect(controller.intersectedObject).not.toBe(upstairs);

		model.setActiveLevel(2);
		three.syncLevelViews();
		pointer('pointermove', at);
		expect(controller.intersectedObject).toBe(upstairs);
		three.dispose();
	});

	it('shows one storey at a time when asked, and puts them all back', () =>
	{
		const {three, model} = boot(HOUSE);
		const groupOf = (index) => model.scene.levelGroup(model.levels[index]);

		three.showStoreys(false);
		expect([0, 1, 2].map((i) => groupOf(i).visible)).toEqual([true, false, false]);

		model.setActiveLevel(1);
		three.syncLevelViews();
		// The mode survives a storey switch, which is what makes it a mode.
		expect([0, 1, 2].map((i) => groupOf(i).visible)).toEqual([false, true, false]);

		three.showStoreys(true);
		expect([0, 1, 2].map((i) => groupOf(i).visible)).toEqual([true, true, true]);
		three.dispose();
	});

	it('takes the roof off with the other storeys, and puts it back', () =>
	{
		const {three} = boot(HOUSE);
		expect(three._roofMesh).not.toBeNull();

		three.showStoreys(false);
		expect(three._roofMesh.visible).toBe(false);

		three.showStoreys(true);
		expect(three._roofMesh.visible).toBe(true);
		three.dispose();
	});

	it('keeps a storey hidden when its roof is rebuilt underneath it', () =>
	{
		const {three, model} = boot(HOUSE);
		three.showStoreys(false);

		model.setRoof({pitch: 45});
		three.syncRoof();

		expect(three._roofMesh.visible).toBe(false);
		three.dispose();
	});
});

describe('the exterior view', () =>
{
	it('frames the whole building rather than the storey being edited', () =>
	{
		const {three, model} = boot(HOUSE);
		const bounds = model.buildingBounds();

		three.showExterior();

		// The camera looks at the middle of the building's height, not at the
		// ground floor - which is what `switchView`'s other five cases do.
		expect(three.controls.target.y).toBeCloseTo(bounds.height / 2, 6);
		expect(three.controls.target.x).toBeCloseTo(bounds.cx, 6);
		// And it stands far enough back to contain the box. Half the diagonal is
		// the radius of the sphere around it; the camera must be outside that.
		const radius = 0.5 * Math.sqrt(
			(bounds.width ** 2) + (bounds.depth ** 2) + (bounds.height ** 2));
		expect(three.camera.position.distanceTo(three.controls.target)).toBeGreaterThan(radius);
		three.dispose();
	});

	it('puts every storey and the roof back on before framing', () =>
	{
		const {three, model} = boot(HOUSE);
		three.showStoreys(false);

		three.switchView(VIEW_EXTERIOR);

		expect([0, 1, 2].map((i) => model.scene.levelGroup(model.levels[i]).visible))
			.toEqual([true, true, true]);
		expect(three._roofMesh.visible).toBe(true);
		three.dispose();
	});

	it('announces itself like the other viewpoints do', () =>
	{
		const {three} = boot(HOUSE);
		const seen = [];
		three.addEventListener(EVENT_CAMERA_VIEW_CHANGE, (event) => {seen.push(event.view);});

		three.switchView(VIEW_EXTERIOR);

		expect(seen).toEqual([VIEW_EXTERIOR]);
		three.dispose();
	});

	it('frames a taller building from further away', () =>
	{
		const {three, model} = boot(HOUSE);
		three.showExterior();
		const near = three.camera.position.distanceTo(three.controls.target);

		model.setLevelHeight(0, 600);
		three.showExterior();

		expect(three.camera.position.distanceTo(three.controls.target)).toBeGreaterThan(near);
		three.dispose();
	});

	it('declines rather than throwing when there is no building yet', () =>
	{
		const {three} = boot();

		expect(() => three.showExterior()).not.toThrow();
		expect(three.model.buildingBounds()).toBeNull();
		three.dispose();
	});

	it('is inert after dispose, like every other camera method', () =>
	{
		const {three} = boot(HOUSE);
		three.dispose();

		expect(() => three.showExterior()).not.toThrow();
		expect(() => three.switchView(VIEW_EXTERIOR)).not.toThrow();
	});
});

describe('the geometry the picker does', () =>
{
	it('maps a viewport point to the ground plane the raycaster uses', () =>
	{
		const {three, controller} = boot();
		lookDownAt(three, new THREE.Vector3(0, 0, 0), 500);

		const hits = controller.getIntersections(
			new THREE.Vector2(WIDTH / 2, HEIGHT / 2), controller.plane);

		expect(hits).toHaveLength(1);
		expect(hits[0].point.y).toBeCloseTo(0, 6);
		three.dispose();
	});

	it('drops what faces away from the camera when asked to filter by normals', () =>
	{
		const {three, controller} = boot();
		lookDownAt(three, new THREE.Vector3(0, 0, 0), 500);
		const at = new THREE.Vector2(WIDTH / 2, HEIGHT / 2);

		// The ground plane faces up, so it survives the filter; flipped, it does
		// not, and that is the difference between picking a wall's inside face
		// and picking through it.
		expect(controller.getIntersections(at, controller.plane, true)).toHaveLength(1);
		controller.plane.rotation.x = Math.PI / 2;
		controller.plane.updateMatrixWorld(true);
		expect(controller.getIntersections(at, controller.plane, true)).toHaveLength(0);
		three.dispose();
	});

	it('drops what is invisible when asked to filter by visibility', () =>
	{
		const {three, controller} = boot();
		lookDownAt(three, new THREE.Vector3(0, 0, 0), 500);
		const at = new THREE.Vector2(WIDTH / 2, HEIGHT / 2);

		expect(controller.getIntersections(at, [controller.plane], false, true)).toHaveLength(1);
		controller.showGroundPlane(false);
		expect(controller.getIntersections(at, [controller.plane], false, true)).toHaveLength(0);
		controller.showGroundPlane(true);
		three.dispose();
	});

	it('normalises against the viewer even before the first resize has measured it', () =>
	{
		const {three, controller} = boot();
		three.widthMargin = null;
		three.heightMargin = null;

		const centre = controller.normalizeVector2(new THREE.Vector2(WIDTH / 2, HEIGHT / 2));

		expect(centre.x).toBeCloseTo(0, 9);
		expect(centre.y).toBeCloseTo(0, 9);
		three.dispose();
	});
});

describe('what the controller does when the scene changes under it', () =>
{
	it('drops the selection when the selected item is removed', () =>
	{
		const {three, controller, model} = boot(HOUSE);
		const item = model.level.items[0];
		controller.setSelectedObject(item);

		model.scene.removeItem(item);

		expect(controller.selectedObject).toBeNull();
		three.dispose();
	});

	it('survives a load that failed, which arrives as a null item', () =>
	{
		const {three, controller} = boot();

		// The formatless branch in `Scene.addItem` has dispatched a null item
		// since S4 so that everything counting loads in flight stays balanced.
		// Nothing had ever exercised it with a Controller attached.
		expect(() => controller.itemLoaded(null)).not.toThrow();
		expect(controller.selectedObject).toBeNull();
		three.dispose();
	});

	it('picks up a freshly placed item so the pointer is already holding it', () =>
	{
		const {three, controller, model} = boot(HOUSE);

		model.scene.addItem(ITEM_TYPE_PARAMETRIC_STRUCTURE, null,
			{itemName: 'Column', itemType: ITEM_TYPE_PARAMETRIC_STRUCTURE, structure: {kind: 'column'}});

		const placed = model.level.items[model.level.items.length - 1];
		expect(controller.selectedObject).toBe(placed);
		expect(controller.state).toBe(states.DRAGGING);
		three.dispose();
	});

	it('follows the camera when the view switches to orthographic', () =>
	{
		const {three, controller} = boot(HOUSE);
		const before = controller.camera;

		three.switchOrthographicMode(true);

		expect(controller.camera).not.toBe(before);
		expect(controller.camera).toBe(three.camera);
		three.dispose();
	});
});
