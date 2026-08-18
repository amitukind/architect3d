<script setup>
// @ts-check
/**
 * A colour swatch for one material (sprint S7).
 *
 * `change`, not `input`: a native colour picker fires continuously while the
 * user drags around the wheel, and every one of those rebuilds a THREE.Color
 * and marks the scene dirty.
 */

const props = defineProps({
	label: {type: String, required: true},
	modelValue: {type: String, required: true},
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
	emit('update:modelValue', input.value);
}
</script>

<template>
	<label class="field field-color">
		<span class="field-label">{{ props.label }}</span>
		<span class="field-color-row">
			<input
				class="field-swatch" type="color" :value="props.modelValue"
				@change="onChange">
			<code class="field-hex">{{ props.modelValue }}</code>
		</span>
	</label>
</template>
