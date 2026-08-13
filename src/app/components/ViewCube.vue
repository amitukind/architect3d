<script setup>
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY} from '../../scripts/blueprint.js';

/**
 * The five camera presets, laid out as the cross the demo drew with nested
 * Bootstrap button groups (build/index.html:83-102): left and right on the
 * flanks, top / 3D / front stacked between them.
 *
 * The demo read the preset out of the button's DOM id and handed the string
 * straight to `switchView` - the ids *were* the API. They still are, but the
 * constants are imported now rather than spelled out in markup.
 */

const props = defineProps({
	activeView: {type: String, default: VIEW_ISOMETRY},
});

const emit = defineEmits(['switch-view']);

const MIDDLE = [
	{id: VIEW_TOP, icon: 'glyphicon-object-align-horizontal', title: 'Show top view'},
	{id: VIEW_ISOMETRY, icon: 'glyphicon-inbox', title: 'Show 3d view'},
	{id: VIEW_FRONT, icon: 'glyphicon-object-align-vertical', title: 'Show front view'},
];
</script>

<template>
	<div class="btn btn-sm btn-default">
		<button
			type="button" class="btn btn-default bottom" title="Show side view (left)"
			:class="{'btn-primary': props.activeView === VIEW_LEFT}"
			@click="emit('switch-view', VIEW_LEFT)">
			<span class="glyphicon glyphicon-object-align-left" />
		</button>
		<span class="btn-group-vertical">
			<button
				v-for="entry in MIDDLE" :key="entry.id" type="button" class="btn btn-default"
				:class="{'btn-primary': props.activeView === entry.id}"
				:title="entry.title" @click="emit('switch-view', entry.id)">
				<span class="glyphicon" :class="entry.icon" />
			</button>
		</span>
		<button
			type="button" class="btn btn-default bottom" title="Show side view (right)"
			:class="{'btn-primary': props.activeView === VIEW_RIGHT}"
			@click="emit('switch-view', VIEW_RIGHT)">
			<span class="glyphicon glyphicon-object-align-right" />
		</button>
	</div>
</template>
