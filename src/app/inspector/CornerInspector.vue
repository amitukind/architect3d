<script setup>
import {onBeforeUnmount, reactive, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import {Dimensioning, EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_MOVED} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A corner's position and elevation, in the active display unit.
 *
 * Sprint S7, replacing the dat.GUI "Current Corner" folder.
 *
 * Two-way, and live in both directions - which is one thing the demo's panel
 * was not. It listened for `EVENT_CORNER_ATTRIBUTES_CHANGED`, dispatched by the
 * x / y / elevation *setters*, and had a commented-out line for `EVENT_MOVED`.
 * But dragging a corner on the canvas goes through `Corner.move()`, which
 * writes the private fields directly and dispatches only `EVENT_MOVED` - so
 * dragging a corner never moved the numbers. Both are listened for here.
 */

const props = defineProps({
	corner: {type: Object, required: true},
});

const {unit} = useDisplayUnit();

const values = reactive({x: 0, y: 0, elevation: 0});

function readBack()
{
	values.x = Dimensioning.cmToMeasureRaw(props.corner.x);
	values.y = Dimensioning.cmToMeasureRaw(props.corner.y);
	values.elevation = Dimensioning.cmToMeasureRaw(props.corner.elevation);
}

function write(property, next)
{
	props.corner[property] = Dimensioning.cmFromMeasureRaw(next);
	// The setter clamps nothing, but read back anyway: it is the model's number
	// that belongs on screen, not the one that was typed.
	readBack();
}

let attached = null;

function attach(corner)
{
	detach();
	attached = {corner, onChanged: () => {readBack();}};
	corner.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, attached.onChanged);
	corner.addEventListener(EVENT_MOVED, attached.onChanged);
	readBack();
}

function detach()
{
	if (!attached)
	{
		return;
	}
	attached.corner.removeEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, attached.onChanged);
	attached.corner.removeEventListener(EVENT_MOVED, attached.onChanged);
	attached = null;
}

watch(() => props.corner, attach, {immediate: true});
// A unit change does not change the corner, only how it reads.
watch(unit, readBack);
onBeforeUnmount(detach);
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">Corner</h3>
		<NumberField
			label="X" :unit="unit" :model-value="values.x"
			@update:model-value="write('x', $event)" />
		<NumberField
			label="Y" :unit="unit" :model-value="values.y"
			@update:model-value="write('y', $event)" />
		<NumberField
			label="Elevation" :unit="unit" :min="0" :model-value="values.elevation"
			@update:model-value="write('elevation', $event)" />
	</section>
</template>
