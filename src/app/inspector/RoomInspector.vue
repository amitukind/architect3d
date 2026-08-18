<script setup>
// @ts-check
import {onBeforeUnmount, ref, watch} from 'vue';
import TextField from './fields/TextField.vue';
import {Dimensioning, EVENT_ROOM_ATTRIBUTES_CHANGED} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A room's name, and its area for reference.
 *
 * Sprint S7, replacing the dat.GUI "Current Room" folder - one text field and
 * nothing else.
 *
 * `Room.name` is a setter that dispatches EVENT_ROOM_ATTRIBUTES_CHANGED; the
 * redraw is so the label on the canvas follows the field as you type, rather
 * than on the next mouse move, which is all the demo managed.
 */

const props = defineProps({
	room: {type: Object, required: true},
	floorplanner: {type: Object, default: null},
});

const {unit} = useDisplayUnit();

const name = ref('');
const area = ref('');

/**
 * The same call the canvas makes (floorplanner_view.js:612), so the panel and
 * the label on the plan can never disagree - including about the `power = 2`
 * that turns the centimetres-squared the model holds into the active unit.
 */
function readBack()
{
	name.value = props.room.name;
	area.value = Dimensioning.cmToMeasure(props.room.area || 0, 2);
}

function rename(next)
{
	props.room.name = next;
	name.value = next;
	if (props.floorplanner)
	{
		props.floorplanner.redraw();
	}
}

let attached = null;

function attach(room)
{
	detach();
	attached = {room, onChanged: () => {readBack();}};
	room.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, attached.onChanged);
	readBack();
}

function detach()
{
	if (attached)
	{
		attached.room.removeEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, attached.onChanged);
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
		<p class="inspector-readout">
			Area <strong>{{ area }}&sup2;</strong>
		</p>
	</section>
</template>
