<script setup>
// @ts-check
import {onBeforeUnmount, reactive, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import TextField from './fields/TextField.vue';
import CheckField from './fields/CheckField.vue';
import RangeField from './fields/RangeField.vue';
import {EVENT_UPDATED} from '../../scripts/blueprint.js';

/**
 * The carbon sheet: an image traced under the 2D plan.
 *
 * Sprint S7, replacing the dat.GUI "Carbon Sheet" folder. Same nine controls,
 * in the same order.
 *
 * Dragging the sheet on the canvas writes x and y straight onto the object, so
 * the panel has to be told - EVENT_UPDATED is the sheet's own. The demo
 * registered that listener every time it rebuilt the folder and removed it
 * never, so each unit change left another one behind, updating controllers
 * whose DOM had already been thrown away.
 */

const props = defineProps({
	carbonSheet: {type: Object, required: true},
});

const values = reactive({
	url: '', width: 0, height: 0, maintainProportion: false,
	x: 0, y: 0, anchorX: 0, anchorY: 0, transparency: 1,
});

const KEYS = Object.keys(values);

function readBack()
{
	KEYS.forEach((key) => {values[key] = props.carbonSheet[key];});
}

function write(key, next)
{
	props.carbonSheet[key] = next;
	// width and height are coupled when the proportion lock is on, and the url
	// setter loads an image that resets both, so never assume the write stuck.
	readBack();
}

let attached = null;

function attach(carbonSheet)
{
	detach();
	attached = {carbonSheet, onUpdated: () => {readBack();}};
	carbonSheet.addEventListener(EVENT_UPDATED, attached.onUpdated);
	readBack();
}

function detach()
{
	if (attached)
	{
		attached.carbonSheet.removeEventListener(EVENT_UPDATED, attached.onUpdated);
		attached = null;
	}
}

watch(() => props.carbonSheet, attach, {immediate: true});
onBeforeUnmount(detach);
</script>

<template>
	<TextField
		label="Image URL" :model-value="values.url" placeholder="rooms/textures/plan.png"
		@update:model-value="write('url', $event)" />
	<NumberField
		label="Real width" :max="1000" :model-value="values.width"
		@update:model-value="write('width', $event)" />
	<NumberField
		label="Real height" :max="1000" :model-value="values.height"
		@update:model-value="write('height', $event)" />
	<CheckField
		label="Maintain proportion" :model-value="values.maintainProportion"
		@update:model-value="write('maintainProportion', $event)" />
	<NumberField
		label="Move in X" :model-value="values.x" @update:model-value="write('x', $event)" />
	<NumberField
		label="Move in Y" :model-value="values.y" @update:model-value="write('y', $event)" />
	<NumberField
		label="Anchor X" :model-value="values.anchorX" @update:model-value="write('anchorX', $event)" />
	<NumberField
		label="Anchor Y" :model-value="values.anchorY" @update:model-value="write('anchorY', $event)" />
	<RangeField
		label="Transparency" :min="0" :max="1" :step="0.05" :model-value="values.transparency"
		@update:model-value="write('transparency', $event)" />
</template>
