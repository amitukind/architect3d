<script setup>
// @ts-check
/** A labelled checkbox (sprint S7). */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: Boolean, default: false},
	disabled: {type: Boolean, default: false},
});

const emit = defineEmits(['update:modelValue']);
/**
 * Read the control's value from the event, typed (RM-004 B3).
 *
 * `Event.target` is `EventTarget | null` and `EventTarget` declares no `value`,
 * so the inline `$event.target.value` this replaces was two type errors in a
 * template nothing was checking. Narrowed in a handler rather than asserted in
 * the template: the element is known to be the input this component renders,
 * and a handler is where saying so belongs.
 */
/** @param {Event} event */
function onChange(event)
{
	const input = /** @type {HTMLInputElement} */ (event.target);
	emit('update:modelValue', input.checked);
}
</script>

<template>
	<label class="field field-check">
		<input
			class="field-checkbox" type="checkbox" :checked="props.modelValue"
			:disabled="props.disabled"
			@change="onChange">
		<span class="field-label">{{ props.label }}</span>
	</label>
</template>
