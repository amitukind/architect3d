<script setup>
// @ts-check
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import TextField from './fields/TextField.vue';
import NumberField from './fields/NumberField.vue';
import {Dimensioning, EVENT_ROOM_ATTRIBUTES_CHANGED, EVENT_CORNER_ATTRIBUTES_CHANGED} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A room: what it is called, what it is for, how big and how high.
 *
 * Sprint S7 replaced the dat.GUI "Current Room" folder with one text field.
 * RM-008 E3 added the other three, and two of them are worth explaining.
 *
 * ## Type is not the name
 *
 * "Master" is which room this is; "Bedroom" is what it is. A plan that can be
 * read by somebody who did not draw it needs both, and a plan of a house nobody
 * anticipated has to be able to say "Puja room" - so the type is free text with
 * the common answers offered, not a closed list.
 *
 * ## Ceiling height is the corners
 *
 * There is no stored per-room ceiling height, and that is a finding rather than
 * an omission. E2 measured that `Wall.height` is not the height of a wall - the
 * drawn top comes from the two corners' elevations - so a room's ceiling IS the
 * elevation of its corners. A second number stored beside them could disagree
 * with the geometry, which is exactly the bug `Wall.height` was.
 *
 * So this reads the corners and writes the corners. The consequence is real and
 * the note below says it: a corner shared with the room next door is one corner,
 * and raising this ceiling raises that wall's top on both sides.
 */

const props = defineProps({
	room: {type: Object, required: true},
	floorplanner: {type: Object, default: null},
});

const emit = defineEmits(['changed']);

const {unit} = useDisplayUnit();

/** The types most plans use, offered as a datalist rather than enforced. */
const ROOM_TYPES = [
	'Living', 'Bedroom', 'Kitchen', 'Dining', 'Bathroom', 'Toilet',
	'Hall', 'Study', 'Balcony', 'Utility', 'Store', 'Garage',
];

const name = ref('');
const type = ref('');
const area = ref('');
const ceiling = ref(0);
const uniformCeiling = ref(true);

const ceilingNote = computed(() => (uniformCeiling.value
	? 'Height is stored on the room’s corners. A corner shared with the room next door is one corner, so this raises that wall on both sides.'
	: 'This room’s corners are at different elevations, so its ceiling slopes; the figure is its highest point. Setting a height levels all four.'));

/**
 * The same call the canvas makes (floorplanner_view.js), so the panel and the
 * label on the plan can never disagree - including about the `power = 2` that
 * turns the centimetres-squared the model holds into the active unit.
 */
function readBack()
{
	name.value = props.room.name;
	type.value = props.room.type || '';
	area.value = Dimensioning.cmToMeasure(props.room.area || 0, 2);
	ceiling.value = Dimensioning.cmToMeasureRaw(props.room.ceilingHeight);
	uniformCeiling.value = props.room.hasUniformCeiling;
}

function redraw()
{
	if (props.floorplanner)
	{
		props.floorplanner.redraw();
	}
}

function rename(next)
{
	props.room.name = next;
	name.value = next;
	redraw();
}

/**
 * Narrowed in a handler rather than asserted in the template, the same way
 * `TextField` does it: `Event.target` is `EventTarget | null` and `EventTarget`
 * declares no `value`, so `$event.target.value` inline is two type errors in a
 * template nothing was checking (RM-004 B3).
 *
 * @param {Event} event
 */
function onTypeInput(event)
{
	retype(/** @type {HTMLInputElement} */ (event.target).value);
}

function retype(next)
{
	props.room.type = next;
	type.value = props.room.type;
	redraw();
	// The type does not go through the floorplan graph, so nothing else records
	// it - the same reason the rename above reaches history through this event.
	emit('changed');
}

function setCeiling(next)
{
	props.room.setCeilingHeight(Dimensioning.cmFromMeasureRaw(next));
	readBack();
	redraw();
}

let attached = null;

function attach(room)
{
	detach();
	// The floorplan is named in the literal rather than added to it afterwards:
	// an object literal takes each property's type from its initialiser, so a
	// later assignment is an error against a type nobody wrote down (RM-005 C2).
	attached = {room, floorplan: room.floorplan || null, onChanged: () => {readBack();}};
	room.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, attached.onChanged);
	// Corner elevations are the ceiling height, so a corner edited in its own
	// panel - or by undo - changes what this shows.
	if (attached.floorplan)
	{
		attached.floorplan.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, attached.onChanged);
	}
	readBack();
}

function detach()
{
	if (attached)
	{
		attached.room.removeEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, attached.onChanged);
		if (attached.floorplan)
		{
			attached.floorplan.removeEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, attached.onChanged);
		}
		attached = null;
	}
}

watch(() => props.room, attach, {immediate: true});
watch(unit, readBack);
onBeforeUnmount(detach);
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">Room</h3>
		<TextField label="Name" :model-value="name" @update:model-value="rename" />

		<label class="field">
			<span class="field-label">Type</span>
			<input
				class="field-input" type="text" list="room-types"
				placeholder="Bedroom, Kitchen&hellip;"
				:value="type" @input="onTypeInput">
		</label>
		<datalist id="room-types">
			<option v-for="option in ROOM_TYPES" :key="option" :value="option" />
		</datalist>

		<NumberField
			label="Ceiling height" :unit="unit" :min="0" :step="0.01"
			:model-value="ceiling" @update:model-value="setCeiling" />

		<p class="inspector-readout">
			Area <strong>{{ area }}&sup2;</strong>
		</p>

		<p class="inspector-note">{{ ceilingNote }}</p>
	</section>
</template>
