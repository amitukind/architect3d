<script setup>
/**
 * A thumbnail grid of surfaces (sprint S7).
 *
 * Replaces the two dat.GUI dropdowns, which named textures ("Checker",
 * "Bricks") without showing them - and named the same image twice at different
 * scales, so the only way to tell the two apart was to pick one and look at the
 * wall. The thumbnails have been in the repository since the beginning; the
 * dead-code ledger in the roadmap listed `rooms/thumbnails` as unreferenced,
 * which was true of every page except `build/index2.html`, the reference UI
 * this grid is modelled on.
 *
 * Matching the current surface to a swatch takes both fields, because neither
 * alone identifies an entry:
 *
 *   - url is not enough. Checker and Bricks are both light_brick.jpg, at 50 and
 *     100, and matching on url would light up two swatches for one selection.
 *   - scale is not always meaningful. `Edge.updateTexture` only reads it when
 *     `stretch` is false (edge.js:185) - a stretched texture covers the face
 *     whatever the number says - and the numbers genuinely differ: the catalog
 *     carries the demo's `1` for the two stretched wall maps, while the default
 *     design has been saving them as `0` since before this migration started.
 *     Comparing scale there would leave a freshly loaded design showing no
 *     current swatch at all.
 */

const props = defineProps({
	label: {type: String, required: true},
	textures: {type: Array, required: true},
	/** The `{url, stretch, scale}` the surface currently carries, if any. */
	current: {type: Object, default: null},
	disabled: {type: Boolean, default: false},
});

const emit = defineEmits(['select']);

function isCurrent(texture)
{
	if (!props.current || props.current.url !== texture.url)
	{
		return false;
	}
	if (texture.stretch)
	{
		return true;
	}
	return Number(props.current.scale) === Number(texture.scale);
}
</script>

<template>
	<div class="field">
		<span class="field-label">{{ props.label }}</span>
		<div class="texture-grid" role="group" :aria-label="props.label">
			<button
				v-for="texture in props.textures" :key="`${texture.url}|${texture.scale}`"
				type="button" class="texture-swatch"
				:class="{'is-current': isCurrent(texture)}"
				:aria-pressed="isCurrent(texture)" :disabled="props.disabled"
				:title="texture.name" @click="emit('select', texture)">
				<img :src="texture.thumbnail" :alt="texture.name" loading="lazy">
				<span class="texture-name">{{ texture.name }}</span>
			</button>
		</div>
	</div>
</template>
