<script setup>
// @ts-check
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

import {computed} from 'vue';

const props = defineProps({
	label: {type: String, required: true},
	textures: {
		/**
		 * An entry of `src/catalog/textures.json`. A bare `Array` types each one
		 * `unknown` and took the whole template with it (RM-004 B3).
		 *
		 * @type {import('vue').PropType<Array<{name: string, url: string, thumbnail: string, stretch: boolean, scale: number, family?: string, roughnessMap?: string}>>}
		 */
		type: Array,
		required: true,
	},
	/** The `{url, stretch, scale}` the surface currently carries, if any. */
	current: {
		/**
		 * `type: Object` with `default: null` still infers `Record<string, any> |
		 * undefined`, so passing an explicit null - which is what "no texture
		 * chosen" means here - is an error (RM-004 B3).
		 *
		 * @type {import('vue').PropType<?Object>}
		 */
		type: Object,
		default: null,
	},
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

/**
 * The swatches, under headings, when the list says how it is organised.
 *
 * H1 takes this grid from seven swatches to thirty-seven, and thirty-seven
 * pictures in one flat grid is a wall rather than a choice. `family` comes from
 * `src/catalog/materials.json`, where the tool that generates it records what
 * each material is - wood, tile, stone, concrete, plaster, brick.
 *
 * An entry with no family lands under `null`, which renders with no heading.
 * That is what `src/catalog/textures.json`'s seven do, so the demo's set still
 * appears exactly as it did: one unlabelled group, first, above the library.
 */
const groups = computed(() =>
{
	/** @type {Array<{family: ?string, textures: Array<Object>}>} */
	const ordered = [];
	const byFamily = new Map();
	for (const texture of props.textures)
	{
		const family = texture.family || null;
		if (!byFamily.has(family))
		{
			const group = {family, textures: []};
			byFamily.set(family, group);
			ordered.push(group);
		}
		byFamily.get(family).textures.push(texture);
	}
	return ordered;
});
</script>

<template>
	<div class="field texture-picker">
		<span class="field-label">{{ props.label }}</span>
		<template v-for="group in groups" :key="group.family || 'plain'">
			<span v-if="group.family" class="texture-family">{{ group.family }}</span>
			<div
				class="texture-grid" role="group"
				:aria-label="group.family ? `${props.label}: ${group.family}` : props.label">
				<button
					v-for="texture in group.textures" :key="`${texture.url}|${texture.scale}`"
					type="button" class="texture-swatch"
					:class="{'is-current': isCurrent(texture)}"
					:aria-pressed="isCurrent(texture)" :disabled="props.disabled"
					:title="texture.name" @click="emit('select', texture)">
					<!--
						`alt=""` since RM-017 P2, M-60. The swatch sits inside a button
						that already carries the name in text beside it, so an alt of
						the same string makes a screen reader say "Fine Wood Fine Wood"
						- which axe reports as `image-redundant-alt`, 22 nodes on the
						wall list and 39 on the floor list. The image is decorative
						*within a labelled control*: the button is the thing being
						chosen and the span is its name.
					-->
					<img :src="texture.thumbnail" alt="" loading="lazy">
					<span class="texture-name">{{ texture.name }}</span>
				</button>
			</div>
		</template>
	</div>
</template>
