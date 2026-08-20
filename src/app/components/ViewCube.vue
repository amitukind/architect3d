<script setup>
// @ts-check
import {Box, ChevronUp, ChevronDown, ChevronLeft, ChevronRight} from '@lucide/vue';
import AppTip from './AppTip.vue';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from '../../scripts/blueprint.js';

/**
 * The five camera presets, arranged as they point.
 *
 * A 3x3 grid: the four orthogonal views on the arms, the isometric in the
 * middle. The arrangement is the control's whole explanation - the button on
 * the left shows you the plan from the left - so it survives from S7 unchanged
 * in structure and changed only in weight: the buttons are joined into one
 * plate rather than floating separately, which is what stops five identical
 * squares reading as five unrelated toggles.
 *
 * The demo read the preset out of each button's DOM id and passed the string
 * straight to `switchView` - the ids *were* the API. They still are; the
 * constants are imported rather than spelled into markup.
 */

const props = defineProps({
	activeView: {type: String, default: VIEW_ISOMETRY},
});

const emit = defineEmits(['switch-view']);

const VIEWS = [
	{id: VIEW_LEFT, area: 'col-start-1 row-start-2', icon: ChevronLeft, label: 'Left elevation'},
	{id: VIEW_TOP, area: 'col-start-2 row-start-1', icon: ChevronUp, label: 'Top view'},
	{id: VIEW_ISOMETRY, area: 'col-start-2 row-start-2', icon: Box, label: 'Isometric view'},
	{id: VIEW_FRONT, area: 'col-start-2 row-start-3', icon: ChevronDown, label: 'Front elevation'},
	{id: VIEW_RIGHT, area: 'col-start-3 row-start-2', icon: ChevronRight, label: 'Right elevation'},
];
</script>

<template>
	<div id="viewcube" class="grid grid-cols-3 grid-rows-3 gap-0.5" role="group" aria-label="Camera views">
		<AppTip
			v-for="view in VIEWS" :key="view.id" :label="view.label"
			side="left" :delay="0">
			<button
				type="button" class="btn btn-icon h-7 w-7" :class="[view.area, {'is-active': props.activeView === view.id}]"
				:aria-pressed="props.activeView === view.id"
				:title="view.label"
				@click="emit('switch-view', view.id)">
				<component :is="view.icon" :size="view.id === VIEW_ISOMETRY ? 15 : 14" />
			</button>
		</AppTip>
	</div>
</template>
