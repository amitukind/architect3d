<script setup>
/** A labelled checkbox (sprint S7). */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: Boolean, default: false},
	disabled: {type: Boolean, default: false},
});

const emit = defineEmits(['update:modelValue']);
</script>

<template>
	<label class="field field-check">
		<input
			class="field-checkbox" type="checkbox" :checked="props.modelValue"
			:disabled="props.disabled"
			@change="emit('update:modelValue', $event.target.checked)">
		<span class="field-label">{{ props.label }}</span>
	</label>
</template>
