// @vitest-environment jsdom
/**
 * Sprint S7: the native inspectors that replaced dat.GUI.
 *
 * Contract tests. Each panel is mounted against a real model object wherever
 * one can be built headlessly - a Corner and a Room come from the floorplan,
 * an Item is faked because constructing one needs a loaded glTF - and the
 * assertions are on what reached the *model*, not on what the panel rendered.
 *
 * Three things here answer the sprint's exit gate directly:
 *
 *   - the item inspector edits the item that is actually selected, which is
 *     the regression named in the gate;
 *   - a unit switch redraws the 2D canvas, which is the other;
 *   - and the corner panel follows a drag, which the demo's never did.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import CornerInspector from '../src/app/inspector/CornerInspector.vue';
import RoomInspector from '../src/app/inspector/RoomInspector.vue';
import Wall2DInspector from '../src/app/inspector/Wall2DInspector.vue';
import ItemInspector from '../src/app/inspector/ItemInspector.vue';
import SurfaceInspector from '../src/app/inspector/SurfaceInspector.vue';
import TexturePicker from '../src/app/inspector/TexturePicker.vue';
import App from '../src/app/App.vue';

import textures from '../src/catalog/textures.json';
import {Main} from '../src/scripts/three/main.js';
import {Configuration, configDimUnit, gridSpacing} from '../src/scripts/core/configuration.js';
import {dimCentiMeter, dimMeter} from '../src/scripts/core/units.js';
import {Dimensioning} from '../src/scripts/core/dimensioning.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {SELECTION_WALL, SELECTION_FLOOR} from '../src/app/composables/useSelection.js';
import {EVENT_CORNER_2D_CLICKED} from '../src/scripts/core/events.js';
import {syncDisplayUnit} from '../src/app/composables/useDisplayUnit.js';

import {buildSquareRoom, resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

let canvasStub;
let observer;
let pointerApis;

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = 1024;
	window.innerHeight = 768;
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Configuration.setValue(configDimUnit, dimCentiMeter);
	syncDisplayUnit();
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
	document.body.innerHTML = '';
	Configuration.setValue(configDimUnit, dimCentiMeter);
	syncDisplayUnit();
});

/** A floorplanner stand-in: the inspectors only ever ask it to redraw. */
function fakeFloorplanner()
{
	return {redraws: 0, redraw() {this.redraws++;}};
}

function fieldNamed(wrapper, label)
{
	var field = wrapper.findAll('.field').find((entry) => entry.find('.field-label').text().startsWith(label));
	return field ? field.find('input') : null;
}

async function setField(wrapper, label, value)
{
	var input = fieldNamed(wrapper, label);
	input.element.value = String(value);
	await input.trigger('change');
}

describe('CornerInspector', () =>
{
	it('shows the corner in the active display unit', () =>
	{
		const {corners} = buildSquareRoom();
		const wrapper = mount(CornerInspector, {props: {corner: corners[1]}});

		// Centimetres, so the numbers are the model's own.
		expect(fieldNamed(wrapper, 'X').element.value).toBe('400');
		expect(fieldNamed(wrapper, 'Y').element.value).toBe('0');

		wrapper.unmount();
	});

	it('writes an edit through to the corner', async () =>
	{
		const {corners} = buildSquareRoom();
		const corner = corners[0];
		const wrapper = mount(CornerInspector, {props: {corner}});

		await setField(wrapper, 'X', 25);
		expect(corner.x).toBeCloseTo(25, 6);

		await setField(wrapper, 'Elevation', 300);
		expect(corner.elevation).toBeCloseTo(300, 6);

		wrapper.unmount();
	});

	it('follows the corner being dragged on the plan', async () =>
	{
		// The demo's panel did not. It listened for
		// EVENT_CORNER_ATTRIBUTES_CHANGED, which the x/y setters dispatch, and had
		// EVENT_MOVED commented out - but Corner.move() writes the private fields
		// directly and dispatches only EVENT_MOVED. Dragging never moved a number.
		const {corners} = buildSquareRoom();
		const corner = corners[0];
		const wrapper = mount(CornerInspector, {props: {corner}});

		corner.move(120, 80);
		await nextTick();

		expect(fieldNamed(wrapper, 'X').element.value).toBe('120');
		expect(fieldNamed(wrapper, 'Y').element.value).toBe('80');

		wrapper.unmount();
	});

	it('re-reads when the display unit changes', async () =>
	{
		const {corners} = buildSquareRoom();
		const wrapper = mount(CornerInspector, {props: {corners: corners[1], corner: corners[1]}});
		expect(fieldNamed(wrapper, 'X').element.value).toBe('400');

		Configuration.setValue(configDimUnit, dimMeter);
		syncDisplayUnit();
		await nextTick();

		expect(fieldNamed(wrapper, 'X').element.value).toBe('4');
		expect(wrapper.find('.field-label').text()).toBe('X (m)');

		wrapper.unmount();
	});

	it('detaches its listeners on unmount', () =>
	{
		const {corners} = buildSquareRoom();
		const corner = corners[0];
		const wrapper = mount(CornerInspector, {props: {corner}});
		wrapper.unmount();

		// Would throw if the handler were still attached to a torn-down component.
		expect(() => corner.move(10, 10)).not.toThrow();
	});
});

describe('RoomInspector', () =>
{
	it('renames the room and redraws the plan', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const floorplanner = fakeFloorplanner();
		const wrapper = mount(RoomInspector, {props: {room, floorplanner}});

		const input = wrapper.find('.field-input');
		input.element.value = 'Kitchen';
		await input.trigger('input');

		expect(room.name).toBe('Kitchen');
		// The demo wrote the name and left the canvas showing the old one until
		// the next mouse move.
		expect(floorplanner.redraws).toBe(1);

		wrapper.unmount();
	});

	it('reports the area the way the canvas labels it', () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const wrapper = mount(RoomInspector, {props: {room}});

		// floorplanner_view.js:612 uses cmToMeasure(area, 2); the panel must agree
		// with the label drawn on the plan, including the squared conversion.
		expect(wrapper.find('.inspector-readout').text())
			.toContain(Dimensioning.cmToMeasure(room.area, 2));

		wrapper.unmount();
	});
});

describe('Wall2DInspector', () =>
{
	function aWall()
	{
		const {floorplan} = buildSquareRoom();
		return floorplan.getWalls()[0];
	}

	it('switches a wall between straight and curved', async () =>
	{
		const wall = aWall();
		const floorplanner = fakeFloorplanner();
		const wrapper = mount(Wall2DInspector, {props: {wall, floorplanner}});

		expect(wrapper.findAll('.segment')[0].classes()).toContain('is-active');

		await wrapper.findAll('.segment')[1].trigger('click');
		expect(wall.wallType).toBe(WallTypes.CURVED);
		expect(wrapper.findAll('.segment')[1].classes()).toContain('is-active');
		expect(floorplanner.redraws).toBe(1);

		wrapper.unmount();
	});

	it('offers a length for a straight wall only', async () =>
	{
		const wall = aWall();
		const wrapper = mount(Wall2DInspector, {props: {wall, floorplanner: fakeFloorplanner()}});

		expect(fieldNamed(wrapper, 'Length')).not.toBeNull();

		await wrapper.findAll('.segment')[1].trigger('click');
		expect(fieldNamed(wrapper, 'Length')).toBeNull();
		expect(wrapper.find('.inspector-note').exists()).toBe(true);

		wrapper.unmount();
	});

	it('resizes the wall from the length field', async () =>
	{
		const wall = aWall();
		const wrapper = mount(Wall2DInspector, {props: {wall, floorplanner: fakeFloorplanner()}});

		await setField(wrapper, 'Length', 500);
		expect(wall.wallSize).toBeCloseTo(500, 4);

		wrapper.unmount();
	});
});

describe('ItemInspector', () =>
{
	/**
	 * Enough of an Item for the panel: the getters it reads and the mutators it
	 * calls. `resize` records rather than scaling anything, which is exactly what
	 * has to be shown to happen - in the demo it never was.
	 */
	function fakeItem(overrides)
	{
		return Object.assign({
			metadata: {itemName: 'Sofa - Grey'},
			fixed: false,
			material: {name: 'grey', color: {getHexString: () => 'cccccc'}},
			width: 200, height: 80, depth: 90,
			proportional: false,
			resized: null,
			removed: false,
			colored: [],
			getWidth() {return this.width;},
			getHeight() {return this.height;},
			getDepth() {return this.depth;},
			getProportionalResize() {return this.proportional;},
			setProportionalResize(flag) {this.proportional = flag;},
			setFixed(flag) {this.fixed = flag;},
			setMaterialColor(color, index) {this.colored.push({color, index});},
			resize(height, width, depth) {this.resized = {height, width, depth};},
			remove() {this.removed = true;},
		}, overrides);
	}

	it('shows the selected item, not a placeholder', () =>
	{
		// The regression the exit gate names. The demo built its panel against a
		// constructor that never took the item and commented out the line that
		// would have bound it, so it showed 10x10x10 for everything.
		const item = fakeItem();
		const wrapper = mount(ItemInspector, {props: {item}});

		expect(wrapper.find('.inspector-heading').text()).toBe('Sofa - Grey');
		expect(fieldNamed(wrapper, 'Width').element.value).toBe('200');
		expect(fieldNamed(wrapper, 'Height').element.value).toBe('80');
		expect(fieldNamed(wrapper, 'Depth').element.value).toBe('90');

		wrapper.unmount();
	});

	it('edits the item that is actually selected, after the selection changes', async () =>
	{
		// The demo's failure was not "the panel is wrong once" but "the panel is
		// never wired to anything". Swap the item and the edit must follow.
		const first = fakeItem({metadata: {itemName: 'First'}});
		const second = fakeItem({metadata: {itemName: 'Second'}, width: 40, height: 50, depth: 60});
		const wrapper = mount(ItemInspector, {props: {item: first}});

		await wrapper.setProps({item: second});
		expect(wrapper.find('.inspector-heading').text()).toBe('Second');

		await setField(wrapper, 'Width', 90);

		expect(second.resized.width).toBeCloseTo(90, 4);
		expect(first.resized).toBeNull();

		wrapper.unmount();
	});

	it('drives resize, the two flags and delete', async () =>
	{
		const item = fakeItem();
		const wrapper = mount(ItemInspector, {props: {item}});

		await setField(wrapper, 'Depth', 120);
		expect(item.resized).toEqual({height: 80, width: 200, depth: 120});

		const checks = wrapper.findAll('.field-checkbox');
		await checks[0].setValue(true);
		expect(item.proportional).toBe(true);
		await checks[1].setValue(true);
		expect(item.fixed).toBe(true);

		await wrapper.find('.btn-danger').trigger('click');
		expect(item.removed).toBe(true);

		wrapper.unmount();
	});

	it('gives every material its own swatch, and a colour is not a resize', async () =>
	{
		const item = fakeItem({
			material: [
				{name: 'frame', color: {getHexString: () => 'ff0000'}},
				{name: 'cushion', color: {getHexString: () => '00ff00'}},
			],
		});
		const wrapper = mount(ItemInspector, {props: {item}});

		const swatches = wrapper.findAll('.field-swatch');
		expect(swatches).toHaveLength(2);

		swatches[1].element.value = '#0000ff';
		await swatches[1].trigger('change');

		expect(item.colored).toEqual([{color: '#0000ff', index: 1}]);
		// The demo routed every swatch through dimensionsChanged(), so picking a
		// colour re-applied the dimensions too.
		expect(item.resized).toBeNull();

		wrapper.unmount();
	});
});

describe('TexturePicker', () =>
{
	it('renders one swatch per texture and marks the current one', () =>
	{
		const current = textures.wall[3];
		const wrapper = mount(TexturePicker, {
			props: {label: 'Wall', textures: textures.wall, current: {url: current.url, scale: current.scale}},
		});

		const swatches = wrapper.findAll('.texture-swatch');
		expect(swatches).toHaveLength(textures.wall.length);
		expect(swatches.filter((swatch) => swatch.classes().includes('is-current'))).toHaveLength(1);
		expect(swatches[3].classes()).toContain('is-current');

		wrapper.unmount();
	});

	it('tells Checker from Bricks, which share a url', () =>
	{
		// Both are light_brick.jpg; only the scale differs, so matching on url
		// alone would light up two swatches for one selection.
		const checker = textures.wall[2];
		const bricks = textures.wall[4];
		expect(checker.url).toBe(bricks.url);

		const wrapper = mount(TexturePicker, {
			props: {label: 'Wall', textures: textures.wall, current: {url: bricks.url, scale: bricks.scale}},
		});

		expect(wrapper.findAll('.texture-swatch')[2].classes()).not.toContain('is-current');
		expect(wrapper.findAll('.texture-swatch')[4].classes()).toContain('is-current');

		wrapper.unmount();
	});

	it('highlights a stretched texture whatever scale the design saved', () =>
	{
		// The default design has carried `scale: 0` on its stretched wall maps
		// since before this migration; the catalog carries the demo's `1`. Neither
		// is read - `Edge.updateTexture` only looks at scale when stretch is false
		// - so comparing it would leave a freshly loaded design with no swatch
		// marked at all.
		const grey = textures.wall[0];
		expect(grey.stretch).toBe(true);

		const wrapper = mount(TexturePicker, {
			props: {label: 'Wall', textures: textures.wall, current: {url: grey.url, stretch: true, scale: 0}},
		});

		expect(wrapper.findAll('.texture-swatch')[0].classes()).toContain('is-current');

		wrapper.unmount();
	});

	it('emits the whole entry when a swatch is picked', async () =>
	{
		const wrapper = mount(TexturePicker, {props: {label: 'Floor', textures: textures.floor}});
		await wrapper.findAll('.texture-swatch')[1].trigger('click');

		expect(wrapper.emitted('select')[0][0]).toEqual(textures.floor[1]);

		wrapper.unmount();
	});
});

describe('SurfaceInspector', () =>
{
	it('retextures the clicked wall', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = floorplan.wallEdges()[0];
		const wrapper = mount(SurfaceInspector, {
			props: {selection: {type: SELECTION_WALL, object: edge}},
		});

		await wrapper.findAll('.texture-swatch')[3].trigger('click');

		const applied = textures.wall[3];
		expect(edge.getTexture().url).toBe(applied.url);
		expect(edge.getTexture().scale).toBe(applied.scale);

		wrapper.unmount();
	});

	it('retextures a floor, and its room\'s walls only when asked', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const wrapper = mount(SurfaceInspector, {
			props: {selection: {type: SELECTION_FLOOR, object: room}},
		});

		const grids = wrapper.findAll('.texture-grid');
		expect(grids).toHaveLength(2);

		await grids[0].findAll('.texture-swatch')[1].trigger('click');
		expect(room.getTexture().url).toBe(textures.floor[1].url);

		// The wall grid is disabled until the room-wide toggle is on - which is
		// the only state in which it does anything, since it is the Room that
		// knows its walls.
		expect(grids[1].find('.texture-swatch').attributes('disabled')).toBeDefined();

		await wrapper.find('.field-checkbox').setValue(true);
		await grids[1].findAll('.texture-swatch')[1].trigger('click');

		floorplan.wallEdges().forEach((edge) =>
		{
			expect(edge.getTexture().url).toBe(textures.wall[1].url);
		});

		wrapper.unmount();
	});
});

describe('the inspector inside the app', () =>
{
	let renderers;

	async function mountApp()
	{
		renderers = [];
		Main.setRendererFactory(() => createRendererStub(renderers));
		const wrapper = mount(App, {attachTo: document.body});
		await nextTick();
		return wrapper;
	}

	function tab(wrapper, name)
	{
		return wrapper.get('#inspector').findAll('.inspector-tab')
			.find((entry) => entry.text().includes(name));
	}

	it('opens on Settings with nothing selected', async () =>
	{
		const wrapper = await mountApp();

		expect(tab(wrapper, 'Settings').classes()).toContain('is-active');
		expect(wrapper.find('.settings').exists()).toBe(true);

		wrapper.unmount();
	});

	it('follows a configuration change made from outside the panel (RM-002 R-03)', async () =>
	{
		// Snap-to-grid and grid resolution are writable from the plan overlay as
		// well as from here. Before Configuration had an event, this panel read
		// them once at mount: changing the grid density on the plan and then
		// opening Settings showed the old number, indefinitely.
		const wrapper = await mountApp();

		const gridField = wrapper.get('.settings').findAll('label')
			.find((entry) => entry.text().includes('Grid resolution'));
		expect(gridField).toBeTruthy();

		const before = gridField.find('input').element.value;

		// Write through the library, exactly as the plan overlay's density control
		// does - not through this panel.
		Configuration.setValue(gridSpacing, 137);
		await nextTick();

		expect(gridField.find('input').element.value).not.toBe(before);
		expect(Number(gridField.find('input').element.value))
			.toBeCloseTo(Dimensioning.cmToMeasureRaw(137), 5);

		wrapper.unmount();
	});

	it('follows a snap-to-grid change made from outside the panel', async () =>
	{
		const wrapper = await mountApp();

		Configuration.setValue('snapToGrid', false);
		await nextTick();
		const box = wrapper.get('.settings').findAll('input[type="checkbox"]')[0];
		expect(box.element.checked).toBe(false);

		Configuration.setValue('snapToGrid', true);
		await nextTick();
		expect(box.element.checked).toBe(true);

		wrapper.unmount();
	});

	it('switches to the selection when something is clicked', async () =>
	{
		const wrapper = await mountApp();
		const blueprint = wrapper.vm.$.setupState.store.instance.value;
		const corner = blueprint.model.floorplan.getCorners()[0];

		blueprint.model.floorplan.dispatchEvent({type: EVENT_CORNER_2D_CLICKED, item: corner});
		await nextTick();

		expect(tab(wrapper, 'Selection').classes()).toContain('is-active');
		expect(wrapper.find('.inspector-heading').text()).toBe('Corner');

		wrapper.unmount();
	});

	it('redraws the 2D canvas when the display unit changes', async () =>
	{
		// The exit gate, in one assertion. Every dimension label on the plan is
		// rendered in the active unit and Configuration dispatches nothing, so the
		// panel has to ask for the redraw itself.
		const wrapper = await mountApp();
		const floorplanner = wrapper.vm.$.setupState.store.floorplanner.value;

		let redraws = 0;
		const original = floorplanner.redraw.bind(floorplanner);
		floorplanner.redraw = () => {redraws++; original();};

		const centimetres = wrapper.get('#inspector').findAll('input[type=radio]')
			.find((radio) => radio.element.value === dimCentiMeter);
		await centimetres.setValue();

		expect(Configuration.getStringValue(configDimUnit)).toBe(dimCentiMeter);
		expect(redraws).toBeGreaterThan(0);

		wrapper.unmount();
	});

	it('carries the new unit into an open inspector', async () =>
	{
		const wrapper = await mountApp();
		const blueprint = wrapper.vm.$.setupState.store.instance.value;
		const corner = blueprint.model.floorplan.getCorners()[0];

		blueprint.model.floorplan.dispatchEvent({type: EVENT_CORNER_2D_CLICKED, item: corner});
		await nextTick();
		expect(wrapper.find('.field-label').text()).toBe('X (m)');

		await tab(wrapper, 'Settings').trigger('click');
		const centimetres = wrapper.get('#inspector').findAll('input[type=radio]')
			.find((radio) => radio.element.value === dimCentiMeter);
		await centimetres.setValue();

		await tab(wrapper, 'Selection').trigger('click');
		expect(wrapper.find('.field-label').text()).toBe('X (cm)');

		wrapper.unmount();
	});
});
