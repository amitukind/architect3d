<script setup>
import AppIcon from './AppIcon.vue';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from '../../scripts/blueprint.js';

/**
 * The five camera presets, laid out as the cross the demo drew with nested
 * Bootstrap button groups (build/index.html:83-102): left and right on the
 * flanks, top / 3D / front stacked between them.
 *
 * S7 rebuilt the cross as a 3x3 grid. The Bootstrap version relied on inline
 * button groups aligning on a text baseline, which pushed the bottom two
 * buttons off the edge of the window - visible in the demo too.
 *
 * The demo read the preset out of the button's DOM id and handed the string
 * straight to `switchView` - the ids *were* the API. They still are, but the
 * constants are imported now rather than spelled out in markup.
 */

const props = defineProps({
	activeView: {type: String, default: VIEW_ISOMETRY},
});

const emit = defineEmits(['switch-view']);

const VIEWS = [
	{id: VIEW_LEFT, area: 'cube-left', icon: 'align-left', title: 'Show side view (left)'},
	{id: VIEW_TOP, area: 'cube-top', icon: 'align-top', title: 'Show top view'},
	{id: VIEW_ISOMETRY, area: 'cube-iso', icon: 'cube', title: 'Show 3d view'},
	{id: VIEW_FRONT, area: 'cube-front', icon: 'align-bottom', title: 'Show front view'},
	{id: VIEW_RIGHT, area: 'cube-right', icon: 'align-right', title: 'Show side view (right)'},
];
</script>

<template>
	<div class="view-cube" role="group" aria-label="Camera views">
		<button
			v-for="view in VIEWS" :key="view.id" type="button" class="btn"
			:class="[view.area, {'is-active': props.activeView === view.id}]"
			:aria-pressed="props.activeView === view.id"
			:title="view.title" @click="emit('switch-view', view.id)">
			<AppIcon :name="view.icon" />
		</button>
	</div>
</template>
