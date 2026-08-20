<script setup>
// @ts-check
import {computed} from 'vue';
import {
	MousePointer2, PencilRuler, RectangleHorizontal, Eraser, Sofa, Footprints,
	Copy, Trash2, Image as ImageIcon, Ruler, Type, Home,
} from '@lucide/vue';

import AppTip from './AppTip.vue';
import {floorplannerModes} from '../../scripts/blueprint.js';
import {LAYOUT_VIEW} from '../composables/useLayout.js';
import {t} from '../i18n/i18n.js';

/**
 * The tool rail: what the pointer does, and what can be done to the selection.
 *
 * ## Why a rail and not a toolbar
 *
 * The three editor modes are modal - exactly one is active, and the active one
 * changes what a click on the canvas means. That is the thing a vertical rail
 * of large targets communicates and a row of small icons in a header does not:
 * the rail is beside the canvas it governs, the active tool is unmissable, and
 * the shape matches every other tool a person has used.
 *
 * The old toolbar also mixed modes with file actions in one undifferentiated
 * row of identical buttons, so "Delete Walls" - which arms a mode that destroys
 * things on the next click - looked exactly like "Save".
 *
 * ## Contextual, but only where the context is real
 *
 * The drawing tools are hidden in the 3D-only layout, because they act on a
 * canvas that is not on screen and there is nothing sensible for a click to do;
 * that is the same rule the old bottom bar used for its camera controls.
 *
 * The scene tools are NOT hidden in the plan-only layout, even though the same
 * argument nearly applies. They differ in that both of them can put the view
 * they need on screen: the walk-through button switches the layout, and opening
 * the catalog from the plan switches to split so you can see where the thing
 * you picked landed. A control that can arrange its own preconditions should
 * not make the user arrange them first.
 *
 * The selection actions are *disabled* rather than hidden when nothing is
 * selected, because they are the answer to "how do I delete this?" and a
 * control that is not there cannot answer it.
 */

const props = defineProps({
	mode: {type: Number, required: true},
	layout: {type: String, required: true},
	canActOnItem: {type: Boolean, default: false},
	catalogOpen: {type: Boolean, default: false},
	walkthrough: {type: Boolean, default: false},
	exterior: {type: Boolean, default: false},
});

const emit = defineEmits([
	'set-mode', 'open-catalog', 'duplicate-item', 'delete-item',
	'toggle-walkthrough', 'toggle-exterior', 'open-backdrop',
]);

/**
 * The plan tools, in the order their shortcut keys run.
 *
 * The two annotation tools (RM-008 E3) sit after the drawing tools and before
 * the eraser, which is where they belong in the sequence a plan is made: draw
 * the building, then say what it is, then correct. The eraser stays last
 * because it is the destructive one and the rail is read top to bottom.
 */
const TOOLS = [
	{id: floorplannerModes.MOVE, icon: MousePointer2, label: 'Select and move', keys: 'v'},
	{id: floorplannerModes.DRAW, icon: PencilRuler, label: 'Draw walls', keys: 'w'},
	{id: floorplannerModes.RECTANGLE, icon: RectangleHorizontal, label: 'Draw a rectangular room', keys: 'r'},
	{id: floorplannerModes.DIMENSION, icon: Ruler, label: 'Measure between two points', keys: 'd'},
	{id: floorplannerModes.TEXT, icon: Type, label: 'Add a text label', keys: 't'},
	{id: floorplannerModes.DELETE, icon: Eraser, label: 'Delete walls', keys: 'x'},
];

const showPlanTools = computed(() => props.layout !== LAYOUT_VIEW);
</script>

<template>
	<nav
		id="tool-rail"
		class="z-[200] flex w-[52px] flex-none flex-col items-center gap-1 border-r border-line bg-surface py-2"
		:aria-label="t('Tools')">
		<template v-if="showPlanTools">
			<p class="eyebrow mb-0.5 text-[9px] tracking-[0.06em]">{{ t('Plan') }}</p>
			<AppTip
				v-for="tool in TOOLS" :key="tool.id" :label="tool.label" :keys="tool.keys"
				side="right" :delay="0">
				<button
					type="button" class="btn btn-tool"
					:class="{'is-active': props.mode === tool.id}"
					:aria-pressed="props.mode === tool.id"
					:title="tool.label"
					@click="emit('set-mode', tool.id)">
					<component :is="tool.icon" :size="17" />
				</button>
			</AppTip>

			<AppTip label="Trace a floorplan image" side="right" :delay="0">
				<button type="button" class="btn btn-tool" :title="t('Trace a floorplan image')" @click="emit('open-backdrop')">
					<ImageIcon :size="17" />
				</button>
			</AppTip>
		</template>

		<div v-if="showPlanTools" class="my-1 h-px w-6 bg-line" />

		<p class="eyebrow mb-0.5 text-[9px] tracking-[0.06em]">{{ t('Scene') }}</p>
		<AppTip label="Furniture catalog" keys="a" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.catalogOpen}"
				:title="t('Furniture catalog')" @click="emit('open-catalog')">
				<Sofa :size="17" />
			</button>
		</AppTip>
		<AppTip label="Walk through" keys="f" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.walkthrough}"
				:aria-pressed="props.walkthrough"
				:title="t('Walk through')" @click="emit('toggle-walkthrough')">
				<Footprints :size="17" />
			</button>
		</AppTip>
		<AppTip label="Exterior view" keys="e" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.exterior}"
				:aria-pressed="props.exterior"
				:title="t('Exterior view')" @click="emit('toggle-exterior')">
				<Home :size="17" />
			</button>
		</AppTip>

		<div class="my-1 h-px w-6 bg-line" />

		<AppTip label="Duplicate item" keys="mod+d" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :title="t('Duplicate item')"
				:disabled="!props.canActOnItem" @click="emit('duplicate-item')">
				<Copy :size="17" />
			</button>
		</AppTip>
		<AppTip label="Delete item" keys="delete" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool btn-danger" :title="t('Delete item')"
				:disabled="!props.canActOnItem" @click="emit('delete-item')">
				<Trash2 :size="17" />
			</button>
		</AppTip>
	</nav>
</template>
