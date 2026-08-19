<script setup>
// @ts-check
import {Layers, Plus, Trash2} from '@lucide/vue';
import AppTip from './AppTip.vue';
import {Dimensioning} from '../../scripts/blueprint.js';

/**
 * Which storey is being drawn (RM-010 G1).
 *
 * Floors are listed **top first**, which is the one thing about this control
 * that is not the obvious choice: the array is ground-floor-first because that
 * is what "the floor above" means, but a person reading a stack of storeys
 * reads it the way the building stands. Reversing it here rather than in the
 * model keeps the data in building order and the picture in eye order.
 *
 * Each row states the height of its own floor above the ground, which is the
 * number that is derived and therefore the one worth showing — nothing stores
 * it, so nothing can disagree with it.
 *
 * The whole control is behind a flag and does not render with it off. What that
 * withholds is the ability to *make* a second storey; a design that already has
 * two opens, stacks and re-saves the same either way.
 */

const props = defineProps({
	levels: {
		/** @type {import('vue').PropType<Array<{index: number, name: string, height: number, base: number, active: boolean}>>} */
		type: Array,
		required: true,
	},
	unit: {type: String, default: ''},
});

const emit = defineEmits(['set-active', 'add', 'remove']);

/** A height as the display unit writes it. */
function measure(cm)
{
	return Dimensioning.cmToMeasure(cm);
}
</script>

<template>
	<div class="pointer-events-auto flex flex-col gap-1 rounded-panel border border-line bg-overlay/90 p-1 shadow-float backdrop-blur">
		<p class="eyebrow flex items-center gap-1.5 px-1.5 pt-0.5">
			<Layers :size="12" /> Storeys
		</p>

		<button
			v-for="entry in [...props.levels].reverse()" :key="entry.index"
			type="button"
			class="btn w-full justify-between gap-3 px-2"
			:class="{'is-active': entry.active}"
			:aria-pressed="entry.active"
			:title="`${entry.name} — floor at ${measure(entry.base)}`"
			@click="emit('set-active', entry.index)">
			<span class="truncate">{{ entry.name }}</span>
			<span class="num text-ink-faint">{{ measure(entry.base) }}</span>
		</button>

		<div class="flex items-center gap-0.5 border-t border-line pt-1">
			<AppTip label="Add a storey above this one">
				<button type="button" class="btn btn-icon" title="Add a storey" @click="emit('add')">
					<Plus :size="15" />
				</button>
			</AppTip>
			<AppTip label="Remove this storey and everything on it">
				<button
					type="button" class="btn btn-icon" title="Remove this storey"
					:disabled="props.levels.length < 2"
					@click="emit('remove')">
					<Trash2 :size="15" />
				</button>
			</AppTip>
		</div>
	</div>
</template>
