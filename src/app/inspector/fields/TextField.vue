<script setup>
// @ts-check
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
function onInput(event)
{
	const input = /** @type {HTMLInputElement} */ (event.target);
	emit('update:modelValue', input.value);
}
</script>

<template>
	<label class="field">
		<span class="field-label">{{ props.label }}</span>
		<input
			class="field-input" type="text" :value="props.modelValue"
			:placeholder="props.placeholder" :disabled="props.disabled"
			@input="onInput">
	</label>
</template>
