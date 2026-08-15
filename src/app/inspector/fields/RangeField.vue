<script setup>
import {computed} from 'vue';

/**
 * A slider with its value beside it (sprint S7).
 *
 * `input` rather than `change`, so dragging a clipping plane or the zoom is
 * continuous - these write to the renderer, not to the floorplan, and are cheap
 * to apply per frame.
 */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: Number, required: true},
	min: {type: Number, default: 0},
	max: {type: Number, default: 1},
	step: {type: Number, default: 0.01},
	unit: {type: String, default: ''},
});

const emit = defineEmits(['update:modelValue']);

const caption = computed(() => (props.unit ? `${props.label} (${props.unit})` : props.label));
const shown = computed(() => Math.round(props.modelValue * 1000) / 1000);
</script>

<template>
	<label class="field field-range">
		<span class="field-label">{{ caption }}</span>
		<span class="field-range-row">
			<input
				class="field-slider" type="range" :value="props.modelValue"
				:min="props.min" :max="props.max" :step="props.step"
				@input="emit('update:modelValue', Number($event.target.value))">
			<output class="field-output">{{ shown }}</output>
		</span>
	</label>
</template>
