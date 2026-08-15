<script setup>
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
</script>

<template>
	<label class="field field-color">
		<span class="field-label">{{ props.label }}</span>
		<span class="field-color-row">
			<input
				class="field-swatch" type="color" :value="props.modelValue"
				@change="emit('update:modelValue', $event.target.value)">
			<code class="field-hex">{{ props.modelValue }}</code>
		</span>
	</label>
</template>
