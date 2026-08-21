<script setup>
// @ts-check
import {injectFloorplannerMode} from '../composables/useFloorplannerMode.js';
import {injectLayout} from '../composables/useLayout.js';
import {injectItemActions} from '../composables/useItemActions.js';
import {computed} from 'vue';
import {
	MousePointer2, PencilRuler, RectangleHorizontal, Eraser, Sofa, Footprints,
	Copy, Trash2, Image as ImageIcon, Ruler, Type, Home,
} from '@lucide/vue';

import AppTip from './AppTip.vue';
import {floorplannerModes} from '../../scripts/blueprint.js';
import {LAYOUT_VIEW} from '../composables/useLayout.js';

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

/**
 * The tool mode, the layout and the item actions, injected (RM-020 S-5).
 *
 * `catalogOpen`, `walkthrough` and `exterior` stay props, and the difference is
 * the useful one: those three are states the *shell* composes out of more than
 * one source - a camera mode plus a layout, a drawer this bar does not own -
 * whereas the three below are single composables this bar reads whole.
 */
const editor = injectFloorplannerMode();
const workspace = injectLayout();
const items = injectItemActions();

const props = defineProps({
	catalogOpen: {type: Boolean, default: false},
	walkthrough: {type: Boolean, default: false},
	exterior: {type: Boolean, default: false},
});

const emit = defineEmits(['open-catalog', 'toggle-walkthrough', 'toggle-exterior', 'open-backdrop']);

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

const showPlanTools = computed(() => workspace.layout.value !== LAYOUT_VIEW);
</script>

<template>
	<nav
		id="tool-rail"
		class="z-[200] flex w-[52px] flex-none flex-col items-center gap-1 border-r border-line bg-surface py-2"
		aria-label="Tools">
		<template v-if="showPlanTools">
			<p class="eyebrow mb-0.5 text-[9px] tracking-[0.06em]">Plan</p>
			<AppTip
				v-for="tool in TOOLS" :key="tool.id" :label="tool.label" :keys="tool.keys"
				side="right" :delay="0">
				<button
					type="button" class="btn btn-tool"
					:class="{'is-active': editor.mode.value === tool.id}"
					:aria-pressed="editor.mode.value === tool.id"
					:title="tool.label"
					@click="editor.setMode(tool.id)">
					<component :is="tool.icon" :size="17" />
				</button>
			</AppTip>

			<AppTip label="Trace a floorplan image" side="right" :delay="0">
				<button type="button" class="btn btn-tool" title="Trace a floorplan image" @click="emit('open-backdrop')">
					<ImageIcon :size="17" />
				</button>
			</AppTip>
		</template>

		<div v-if="showPlanTools" class="my-1 h-px w-6 bg-line" />

		<p class="eyebrow mb-0.5 text-[9px] tracking-[0.06em]">Scene</p>
		<AppTip label="Furniture catalog" keys="a" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.catalogOpen}"
				title="Furniture catalog" @click="emit('open-catalog')">
				<Sofa :size="17" />
			</button>
		</AppTip>
		<AppTip label="Walk through" keys="f" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.walkthrough}"
				:aria-pressed="props.walkthrough"
				title="Walk through" @click="emit('toggle-walkthrough')">
				<Footprints :size="17" />
			</button>
		</AppTip>
		<AppTip label="Exterior view" keys="e" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" :class="{'is-active': props.exterior}"
				:aria-pressed="props.exterior"
				title="Exterior view" @click="emit('toggle-exterior')">
				<Home :size="17" />
			</button>
		</AppTip>

		<div class="my-1 h-px w-6 bg-line" />

		<AppTip label="Duplicate item" keys="mod+d" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool" title="Duplicate item"
				:disabled="!items.canActOnItem.value" @click="items.duplicateSelected()">
				<Copy :size="17" />
			</button>
		</AppTip>
		<AppTip label="Delete item" keys="delete" side="right" :delay="0">
			<button
				type="button" class="btn btn-tool btn-danger" title="Delete item"
				:disabled="!items.canActOnItem.value" @click="items.deleteSelected()">
				<Trash2 :size="17" />
			</button>
		</AppTip>
	</nav>
</template>
