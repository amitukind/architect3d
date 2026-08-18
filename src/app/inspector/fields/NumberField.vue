<script setup>
// @ts-check
import {computed} from 'vue';

/**
 * A labelled number input (sprint S7).
 *
 * The one thing worth knowing: the value is committed on `change`, not on
 * `input`. Every one of these writes through to a live model object, and
 * committing per keystroke means typing "250" into a wall length briefly sets
 * it to 2, then 25 - each of which drags corners, re-runs room detection and
 * redraws. dat.GUI had the same problem and the demo lived with it.
 *
 * Arrow keys and the spinner still fire `change` immediately, so nudging a
 * value stays live.
 */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: Number, required: true},
	unit: {type: String, default: ''},
	min: {type: Number, default: null},
	max: {type: Number, default: null},
	step: {type: Number, default: 0.01},
	disabled: {type: Boolean, default: false},
});

const emit = defineEmits(['update:modelValue']);

const caption = computed(() => (props.unit ? `${props.label} (${props.unit})` : props.label));

function commit(event)
{
	var next = Number(event.target.value);
	if (Number.isFinite(next))
	{
		emit('update:modelValue', next);
	}
	// Whether the number was accepted or rejected, show what the model holds.
	event.target.value = props.modelValue;
}
</script>

<template>
	<label class="field">
		<span class="field-label">{{ caption }}</span>
		<input
			class="field-input" type="number" :value="props.modelValue"
			:min="props.min ?? undefined" :max="props.max ?? undefined" :step="props.step"
			:disabled="props.disabled" @change="commit">
	</label>
</template>
