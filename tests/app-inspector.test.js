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
import DimensionInspector from '../src/app/inspector/DimensionInspector.vue';
import AnnotationInspector from '../src/app/inspector/AnnotationInspector.vue';
import OpeningInspector from '../src/app/inspector/OpeningInspector.vue';
import StairInspector from '../src/app/inspector/StairInspector.vue';
import StructureInspector from '../src/app/inspector/StructureInspector.vue';
import App from '../src/app/App.vue';

import textures from '../src/catalog/textures.json';
import {Main} from '../src/scripts/three/main.js';
import {Configuration, configDimUnit, gridSpacing} from '../src/scripts/core/configuration.js';
import {dimCentiMeter, dimMeter} from '../src/scripts/core/units.js';
import {Dimensioning} from '../src/scripts/core/dimensioning.js';
import {WallTypes} from '../src/scripts/core/constants.js';
import {SELECTION_WALL, SELECTION_FLOOR} from '../src/app/composables/useSelection.js';
import {EVENT_CORNER_2D_CLICKED, EVENT_ROOM_2D_CLICKED, EVENT_DIMENSION_2D_CLICKED, EVENT_ANNOTATION_2D_CLICKED} from '../src/scripts/core/events.js';
import {syncDisplayUnit} from '../src/app/composables/useDisplayUnit.js';
import {normaliseStair, stairMetrics, stairwellHint} from '../src/scripts/items/stair.js';
import {normaliseStructure} from '../src/scripts/items/structure.js';

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

describe('RoomInspector, what a room is for and how high (RM-008 E3)', () =>
{
	it('sets the type without touching the name', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const floorplanner = fakeFloorplanner();
		const wrapper = mount(RoomInspector, {props: {room, floorplanner}});

		const input = fieldNamed(wrapper, 'Type');
		input.element.value = 'Bedroom';
		await input.trigger('input');

		expect(room.type).toBe('Bedroom');
		expect(room.name).toBe('A New Room');
		expect(floorplanner.redraws).toBe(1);

		wrapper.unmount();
	});

	/**
	 * The field writes the corners, because that is where a ceiling height lives -
	 * E2 measured that a wall's drawn top comes from its two corners' elevations,
	 * so a second stored number could disagree with the geometry.
	 */
	it('raises the ceiling by raising every corner of the room', async () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const wrapper = mount(RoomInspector, {props: {room, floorplanner: fakeFloorplanner()}});

		await setField(wrapper, 'Ceiling height', 320);

		corners.forEach((corner) => {expect(corner.elevation).toBe(320);});
		expect(fieldNamed(wrapper, 'Ceiling height').element.value).toBe('320');

		wrapper.unmount();
	});

	it('says the ceiling slopes when the corners disagree', async () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		corners[0].elevation = 400;
		const wrapper = mount(RoomInspector, {props: {room}});
		await nextTick();

		expect(wrapper.find('.inspector-note').text()).toContain('slopes');

		wrapper.unmount();
	});
});

describe('DimensionInspector (RM-008 E3)', () =>
{
	function aDimension()
	{
		const {floorplan} = buildSquareRoom();
		return floorplan.newDimension(0, 0, 400, 0, {offset: 40});
	}

	it('reports the measurement the way the canvas labels it', () =>
	{
		const dimension = aDimension();
		const wrapper = mount(DimensionInspector, {props: {dimension}});

		expect(wrapper.find('.inspector-readout').text()).toContain(Dimensioning.cmToMeasure(400));

		wrapper.unmount();
	});

	it('moves the line, and puts it on the other side', async () =>
	{
		const dimension = aDimension();
		const wrapper = mount(DimensionInspector, {props: {dimension}});

		await setField(wrapper, 'Offset', 90);
		expect(dimension.offset).toBe(90);

		await wrapper.findAll('button').find((button) => button.text().includes('other side')).trigger('click');
		expect(dimension.offset).toBe(-90);

		wrapper.unmount();
	});

	/**
	 * Invisible on the canvas and the thing that decides what happens next: a
	 * pinned end follows its corner when the plan is edited, a free one does not.
	 */
	it('says how many of its ends follow a corner', async () =>
	{
		const {floorplan, corners} = buildSquareRoom();
		const dimension = floorplan.newDimension(0, 0, 400, 0, {
			aCorner: corners[0].id, bCorner: corners[1].id,
		});
		const wrapper = mount(DimensionInspector, {props: {dimension}});

		expect(wrapper.find('.inspector-note').text()).toContain('Both ends');

		dimension.moveEnd('b', 500, 0);
		await nextTick();

		expect(wrapper.find('.inspector-note').text()).toContain('One end');

		wrapper.unmount();
	});

	it('deletes the dimension it is showing', async () =>
	{
		const dimension = aDimension();
		const floorplan = dimension.floorplan;
		const wrapper = mount(DimensionInspector, {props: {dimension}});

		await wrapper.find('.btn-danger').trigger('click');

		expect(floorplan.dimensions).toHaveLength(0);

		wrapper.unmount();
	});
});

describe('AnnotationInspector (RM-008 E3)', () =>
{
	function anAnnotation()
	{
		const {floorplan} = buildSquareRoom();
		return floorplan.newAnnotation(100, 100, 'Note');
	}

	it('writes the text as it is typed, like the room name', async () =>
	{
		const annotation = anAnnotation();
		const wrapper = mount(AnnotationInspector, {props: {annotation}});

		const input = wrapper.find('.field-input');
		input.element.value = 'Service duct';
		await input.trigger('input');

		expect(annotation.text).toBe('Service duct');

		wrapper.unmount();
	});

	it('offers four sizes and sets the one pressed', async () =>
	{
		const annotation = anAnnotation();
		const wrapper = mount(AnnotationInspector, {props: {annotation}});

		const segments = wrapper.findAll('.segment');
		expect(segments).toHaveLength(4);
		await segments[3].trigger('click');

		expect(annotation.size).toBe(Number(segments[3].text()));

		wrapper.unmount();
	});

	/**
	 * The reason the text tool drops back to the pointer after placing a label:
	 * the gesture starts on the canvas and finishes in this field, without a
	 * second click to find it.
	 */
	it('takes focus on the next frame, so a freshly placed label can just be typed', async () =>
	{
		const annotation = anAnnotation();
		const wrapper = mount(AnnotationInspector, {props: {annotation}, attachTo: document.body});

		// A frame, not a tick, and the delay is the whole point. This panel mounts
		// *during* the click that created the label - the mousedown handler creates
		// it and Vue flushes in a microtask - so focusing on mount lands and is then
		// undone by that same mousedown's default action. Measured in a real
		// browser as a focusin on the input immediately followed by a focusout,
		// with activeElement settling on <body>, and the visible symptom was that
		// typing "Living area" went to the shortcut map and opened the catalog.
		await new Promise((resolve) => {window.requestAnimationFrame(() => {resolve(null);});});

		expect(document.activeElement).toBe(wrapper.find('.field-input').element);

		wrapper.unmount();
	});

	it('deletes the label it is showing', async () =>
	{
		const annotation = anAnnotation();
		const floorplan = annotation.floorplan;
		const wrapper = mount(AnnotationInspector, {props: {annotation}});

		await wrapper.find('.btn-danger').trigger('click');

		expect(floorplan.annotations).toHaveLength(0);

		wrapper.unmount();
	});
});

describe('OpeningInspector (RM-008 F1)', () =>
{
	/**
	 * A stand-in for the item, carrying the two things the panel touches:
	 * `opening` to read and `setOpening` to write. A real `ParametricOpening`
	 * needs a model, a scene and a generated mesh, none of which this panel is
	 * about - and `tests/parametric-openings.test.js` builds the real one.
	 */
	function anOpening(overrides)
	{
		const item = {
			opening: Object.assign({
				kind: 'door', width: 90, height: 210, sill: 0, hinge: 'left', swing: 90, style: 'plain',
			}, overrides || {}),
			changes: [],
			setOpening(changes)
			{
				this.changes.push(changes);
				Object.assign(this.opening, changes);
				return this.opening;
			},
		};
		return item;
	}

	it('shows the numbers in the active display unit', () =>
	{
		const item = anOpening();
		const wrapper = mount(OpeningInspector, {props: {item}});

		expect(wrapper.find('.inspector-heading').text()).toBe('Door');
		expect(fieldNamed(wrapper, 'Width').element.value).toBe('90');
		expect(fieldNamed(wrapper, 'Sill').element.value).toBe('0');

		wrapper.unmount();
	});

	it('writes a width through to the item', async () =>
	{
		const item = anOpening();
		const wrapper = mount(OpeningInspector, {props: {item}});

		await setField(wrapper, 'Width', 110);

		expect(item.opening.width).toBe(110);

		wrapper.unmount();
	});

	/**
	 * The control RM-009 U-4 says had nowhere to live: the file recorded a single
	 * y rotation, so a hinge side could not be expressed at all, and the plan drew
	 * the same arc for every door.
	 */
	it('sets the hinge side, which the file could not carry before F1', async () =>
	{
		const item = anOpening();
		const wrapper = mount(OpeningInspector, {props: {item}});

		const right = wrapper.findAll('.segment').find((button) => button.text() === 'Right');
		await right.trigger('click');

		expect(item.opening.hinge).toBe('right');

		wrapper.unmount();
	});

	it('offers a hinge and a swing for a door and neither for a window', () =>
	{
		const door = mount(OpeningInspector, {props: {item: anOpening()}});
		const window_ = mount(OpeningInspector, {props: {item: anOpening({kind: 'window'})}});

		expect(door.findAll('.segment')).toHaveLength(2);
		expect(window_.find('.inspector-heading').text()).toBe('Window');
		expect(window_.findAll('.segment')).toHaveLength(0);

		door.unmount();
		window_.unmount();
	});

	it('shows what the item took, not what it was handed', async () =>
	{
		const item = anOpening();
		// The real setter refuses a width of zero; this one says so the same way.
		item.setOpening = (changes) =>
		{
			if (changes.width !== undefined && changes.width <= 0)
			{
				return item.opening;
			}
			Object.assign(item.opening, changes);
			return item.opening;
		};
		const wrapper = mount(OpeningInspector, {props: {item}});

		await setField(wrapper, 'Width', 0);

		expect(fieldNamed(wrapper, 'Width').element.value).toBe('90');

		wrapper.unmount();
	});
});

describe('StairInspector (RM-008 F3)', () =>
{
	/**
	 * A stand-in for the item, carrying the four things the panel touches. A real
	 * `ParametricStair` needs a model, a scene and a generated mesh, none of which
	 * this panel is about - and `tests/parametric-stairs.test.js` builds the real
	 * one. The stand-in runs the real `normaliseStair`, so what the panel reads
	 * back is what the item would have taken.
	 */
	function aStair(overrides)
	{
		return {
			stair: normaliseStair(overrides || {}),
			changes: [],
			setStair(changes)
			{
				this.changes.push(changes);
				this.stair = normaliseStair(Object.assign({}, this.stair, changes));
				return this.stair;
			},
			metrics()
			{
				return stairMetrics(this.stair);
			},
			stairwell()
			{
				return stairwellHint(this.stair);
			},
		};
	}

	it('shows rise and going, because that is what a code is written in', () =>
	{
		const wrapper = mount(StairInspector, {props: {item: aStair()}});

		expect(fieldNamed(wrapper, 'Rise').element.value).toBe('17.5');
		expect(fieldNamed(wrapper, 'Going').element.value).toBe('25');
		expect(fieldNamed(wrapper, 'Treads').element.value).toBe('16');

		wrapper.unmount();
	});

	/**
	 * M-37 made visible. The two totals are shown and not settable, because there
	 * is nowhere for a height to come from except the multiplication.
	 */
	it('shows the height and the plan length as the multiplication they are', async () =>
	{
		const item = aStair();
		const wrapper = mount(StairInspector, {props: {item}});

		expect(wrapper.find('.inspector-readout').text()).toContain(Dimensioning.cmToMeasure(280));

		await setField(wrapper, 'Treads', 20);

		expect(item.stair.treads).toBe(20);
		expect(wrapper.find('.inspector-readout').text()).toContain(Dimensioning.cmToMeasure(350));

		wrapper.unmount();
	});

	it('shows what the item took, not what it was handed', async () =>
	{
		const item = aStair();
		const wrapper = mount(StairInspector, {props: {item}});

		await setField(wrapper, 'Treads', 900);

		expect(item.stair.treads).toBe(40);
		expect(fieldNamed(wrapper, 'Treads').element.value).toBe('40');

		wrapper.unmount();
	});

	it('offers a turn for a quarter and a half flight and none for a straight one', async () =>
	{
		const item = aStair();
		const wrapper = mount(StairInspector, {props: {item}});

		expect(wrapper.findAll('.field-label').map((label) => label.text())).not.toContain('Turn');

		const quarter = wrapper.findAll('.segment').find((button) => button.text() === 'Quarter');
		await quarter.trigger('click');

		expect(item.stair.shape).toBe('l');
		expect(wrapper.findAll('.field-label').map((label) => label.text())).toContain('Turn');

		wrapper.unmount();
	});

	it('sets the handrail side', async () =>
	{
		const item = aStair();
		const wrapper = mount(StairInspector, {props: {item}});

		const both = wrapper.findAll('.segment').find((button) => button.text() === 'Both');
		await both.trigger('click');

		expect(item.stair.handrail).toBe('both');

		wrapper.unmount();
	});

	it('names the tread a floor above would have to open from', () =>
	{
		const wrapper = mount(StairInspector, {props: {item: aStair()}});

		// 280 cm to the floor above and two metres of headroom: from tread 5.
		expect(wrapper.find('.inspector-note').text()).toContain('tread 5');

		wrapper.unmount();
	});

	it('re-reads when the display unit changes', async () =>
	{
		const wrapper = mount(StairInspector, {props: {item: aStair()}});

		Configuration.setValue(configDimUnit, dimMeter);
		syncDisplayUnit();
		await nextTick();

		expect(fieldNamed(wrapper, 'Going').element.value).toBe('0.25');

		wrapper.unmount();
	});
});

describe('StructureInspector (RM-008 F2)', () =>
{
	/**
	 * A stand-in carrying the two things the panel touches, running the real
	 * `normaliseStructure` so what the panel reads back is what the item took.
	 */
	function aMember(overrides)
	{
		return {
			structure: normaliseStructure(overrides || {}),
			setStructure(changes)
			{
				this.structure = normaliseStructure(Object.assign({}, this.structure, changes));
				return this.structure;
			},
		};
	}

	/**
	 * The label follows the member rather than the axis. `length` is one field,
	 * and calling it that in both panels would be honest about the data model and
	 * useless to somebody placing a beam.
	 */
	it('calls the same field a height on a column and a span on a beam', async () =>
	{
		const item = aMember();
		const wrapper = mount(StructureInspector, {props: {item}});

		expect(wrapper.find('.inspector-heading').text()).toBe('Column');
		expect(fieldNamed(wrapper, 'Height')).not.toBeNull();

		const beam = wrapper.findAll('.segment').find((button) => button.text() === 'Beam');
		await beam.trigger('click');

		expect(wrapper.find('.inspector-heading').text()).toBe('Beam');
		expect(fieldNamed(wrapper, 'Span')).not.toBeNull();
		expect(fieldNamed(wrapper, 'Soffit')).not.toBeNull();

		wrapper.unmount();
	});

	it('hides the second cross-section field for a round column', async () =>
	{
		const item = aMember();
		const wrapper = mount(StructureInspector, {props: {item}});

		expect(fieldNamed(wrapper, 'Depth')).not.toBeNull();

		const round = wrapper.findAll('.segment').find((button) => button.text() === 'Round');
		await round.trigger('click');

		// A round section has one dimension, so a field that cannot disagree with
		// another field is not shown next to it.
		expect(fieldNamed(wrapper, 'Depth')).toBeNull();
		expect(fieldNamed(wrapper, 'Diameter')).not.toBeNull();

		wrapper.unmount();
	});

	it('offers a section for a column and none for a beam', async () =>
	{
		const item = aMember({kind: 'beam'});
		const wrapper = mount(StructureInspector, {props: {item}});

		expect(wrapper.findAll('.field-label').map((label) => label.text())).not.toContain('Section');

		wrapper.unmount();
	});

	it('shows the top as the derived number it is', async () =>
	{
		const item = aMember({kind: 'beam'});
		const wrapper = mount(StructureInspector, {props: {item}});

		// Soffit 210 plus depth 40: the top lands on a 250 wall's head.
		expect(wrapper.find('.inspector-readout').text()).toContain(Dimensioning.cmToMeasure(250));

		await setField(wrapper, 'Depth', 60);

		expect(wrapper.find('.inspector-readout').text()).toContain(Dimensioning.cmToMeasure(270));

		wrapper.unmount();
	});

	it('shows what the item took, not what it was handed', async () =>
	{
		const item = aMember();
		const wrapper = mount(StructureInspector, {props: {item}});

		await setField(wrapper, 'Width', 900);

		expect(item.structure.width).toBe(500);
		expect(fieldNamed(wrapper, 'Width').element.value).toBe('500');

		wrapper.unmount();
	});

	it('says which side of the plan\'s section the member is on', async () =>
	{
		const wrapper = mount(StructureInspector, {props: {item: aMember({kind: 'beam'})}});

		expect(wrapper.find('.inspector-note').text()).toContain('dashed');

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

	it('tints a wall, and offers to clear the tint only once there is one', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = floorplan.wallEdges()[0];
		const wrapper = mount(SurfaceInspector, {
			props: {selection: {type: SELECTION_WALL, object: edge}},
		});

		// Nothing to clear until something is tinted - a button that undoes a
		// thing nobody has done is a button that has to be explained.
		expect(wrapper.find('.btn-outline').exists()).toBe(false);

		const swatch = wrapper.find('input[type="color"]');
		swatch.element.value = '#204060';
		await swatch.trigger('change');

		expect(edge.getMaterial().color).toBe('#204060');
		expect(wrapper.find('.btn-outline').exists()).toBe(true);

		await wrapper.find('.btn-outline').trigger('click');
		expect(edge.getMaterial().color).toBe('#ffffff');
		expect(wrapper.find('.btn-outline').exists()).toBe(false);

		wrapper.unmount();
	});

	it('turns and slides a wall\'s tile', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const edge = floorplan.wallEdges()[0];
		const wrapper = mount(SurfaceInspector, {
			props: {selection: {type: SELECTION_WALL, object: edge}},
		});

		const sliders = wrapper.findAll('input[type="range"]');
		expect(sliders).toHaveLength(3);

		await sliders[0].setValue('90');
		await sliders[1].setValue('0.25');

		expect(edge.getMaterial().rotation).toBe(90);
		expect(edge.getMaterial().offsetX).toBeCloseTo(0.25, 10);

		wrapper.unmount();
	});

	/** RM-007's gap Q-4 names "no ceiling material", and this is the control. */
	it('tints a room\'s ceiling, and clearing it writes nothing at all', async () =>
	{
		const {floorplan} = buildSquareRoom();
		const room = floorplan.getRooms()[0];
		const wrapper = mount(SurfaceInspector, {
			props: {selection: {type: SELECTION_FLOOR, object: room}},
		});

		const swatches = wrapper.findAll('input[type="color"]');
		// Two: the floor's tint and the ceiling's.
		expect(swatches).toHaveLength(2);

		swatches[1].element.value = '#804020';
		await swatches[1].trigger('change');
		expect(room.getCeiling()).toEqual({color: '#804020'});

		// Back to white is back to "no ceiling material", not a white one.
		swatches[1].element.value = '#ffffff';
		await swatches[1].trigger('change');
		expect(room.getCeiling()).toBeNull();

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

	/**
	 * Found by driving the assembled application rather than by mounting a
	 * component: with a room selected, typing a north bearing in Settings threw
	 * the panel over to the Selection tab - away from the field being typed into.
	 *
	 * The cause is that `useSelection` resolves the selected entity afresh on
	 * every revision, so `{type, object}` is a new object even when the same thing
	 * is still selected, and the panel watched that wrapper. It watches the
	 * identity now. "Clicking something opens its panel" is the behaviour; "the
	 * model said look again" is not.
	 */
	it('stays on Settings when an annotation changes under a live selection', async () =>
	{
		const wrapper = await mountApp();
		const blueprint = wrapper.vm.$.setupState.store.instance.value;
		const floorplan = blueprint.model.floorplan;

		floorplan.dispatchEvent({type: EVENT_ROOM_2D_CLICKED, item: floorplan.getRooms()[0]});
		await nextTick();
		expect(tab(wrapper, 'Selection').classes()).toContain('is-active');

		await tab(wrapper, 'Settings').trigger('click');
		await nextTick();
		expect(tab(wrapper, 'Settings').classes()).toContain('is-active');

		floorplan.north = 45;
		await nextTick();

		expect(tab(wrapper, 'Settings').classes()).toContain('is-active');

		wrapper.unmount();
	});

	it('opens the right panel for a dimension and for a label (RM-008 E3)', async () =>
	{
		const wrapper = await mountApp();
		const blueprint = wrapper.vm.$.setupState.store.instance.value;
		const floorplan = blueprint.model.floorplan;
		const dimension = floorplan.newDimension(0, 0, 400, 0);
		const annotation = floorplan.newAnnotation(200, 200, 'Hall');

		floorplan.dispatchEvent({type: EVENT_DIMENSION_2D_CLICKED, item: dimension, id: dimension.id});
		await nextTick();
		expect(wrapper.find('.inspector-heading').text()).toBe('Dimension');

		floorplan.dispatchEvent({type: EVENT_ANNOTATION_2D_CLICKED, item: annotation, id: annotation.id});
		await nextTick();
		expect(wrapper.find('.inspector-heading').text()).toBe('Label');

		wrapper.unmount();
	});

	/**
	 * A selection has to stop being one when the thing it named is removed, or
	 * the panel goes on editing something no longer in the design - which is the
	 * whole reason RM-003 A3 made the selection hold an id.
	 */
	it('closes the panel when the annotation it was showing is deleted', async () =>
	{
		const wrapper = await mountApp();
		const blueprint = wrapper.vm.$.setupState.store.instance.value;
		const floorplan = blueprint.model.floorplan;
		const annotation = floorplan.newAnnotation(200, 200, 'Hall');

		floorplan.dispatchEvent({type: EVENT_ANNOTATION_2D_CLICKED, item: annotation, id: annotation.id});
		await nextTick();
		expect(wrapper.find('.inspector-heading').text()).toBe('Label');

		floorplan.removeAnnotation(annotation);
		await nextTick();

		expect(wrapper.find('.inspector-empty').exists()).toBe(true);

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
