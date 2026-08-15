<script setup>
/**
 * A labelled text input (sprint S7).
 *
 * Commits on `input` rather than `change`, unlike NumberField: a room name is
 * cheap to set, and seeing the label on the canvas follow what you type is the
 * point. See useSelection's room inspector for the redraw that makes it live.
 */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: String, default: ''},
	placeholder: {type: String, default: ''},
	disabled: {type: Boolean, default: false},
});

const emit = defineEmits(['update:modelValue']);
</script>

<template>
	<label class="field">
		<span class="field-label">{{ props.label }}</span>
		<input
			class="field-input" type="text" :value="props.modelValue"
			:placeholder="props.placeholder" :disabled="props.disabled"
			@input="emit('update:modelValue', $event.target.value)">
	</label>
</template>
