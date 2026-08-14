<script setup>
import {computed, ref, watch} from 'vue';

import CornerInspector from './CornerInspector.vue';
import RoomInspector from './RoomInspector.vue';
import Wall2DInspector from './Wall2DInspector.vue';
import ItemInspector from './ItemInspector.vue';
import SurfaceInspector from './SurfaceInspector.vue';
import SettingsPanel from './SettingsPanel.vue';
import {MousePointerClick, SlidersHorizontal} from '@lucide/vue';

import {useBlueprint} from '../composables/useBlueprint.js';
import {
	SELECTION_ITEM, SELECTION_WALL, SELECTION_FLOOR,
	SELECTION_CORNER_2D, SELECTION_WALL_2D, SELECTION_ROOM_2D,
} from '../composables/useSelection.js';

/**
 * The inspector sidebar (sprint S7).
 *
 * Native Vue, replacing the interim lil-gui panel S6 stood up and the dat.GUI
 * one before it. Two tabs rather than the two nested accordions dat.GUI forced:
 * what is selected, and everything that is not about a selection.
 *
 * Selecting something switches to the Selection tab, because a click on the
 * plan or in the 3D view is a request to look at that thing. Nothing switches
 * back on its own - if you are in the middle of adjusting the grid, a stray
 * click should not throw the panel away.
 *
 * Each inspector is keyed on the selected object, so switching from one corner
 * to another remounts rather than trying to re-point a live component at a new
 * model object. That keeps every listener attach/detach pair inside one
 * component's lifetime.
 *
 * ## The `changed` event
 *
 * Inspectors write straight onto live model objects - that is what an inspector
 * is, and why `vue/no-mutating-props` is switched off for this directory. Most
 * of those writes reach the undo stack through the library events they cause,
 * but some do not: renaming a room, retexturing a wall and recolouring an item
 * all change the design without touching the floorplan graph. Those emit
 * `changed`, and App.vue turns it into a history commit.
 */

const props = defineProps({
	selection: {type: Object, default: null},
	camera: {type: Object, required: true},
	/** Optional v-model, so a control outside the panel can bring a tab forward -
	 * the rail's backdrop button points at a group inside Settings. Left
	 * uncontrolled the panel still owns its own tab, as it did before. */
	tab: {type: String, default: null},
});

const emit = defineEmits(['changed', 'update:tab']);

const store = useBlueprint();
const internalTab = ref('settings');

const tab = computed({
	get: () => props.tab || internalTab.value,
	set: (value) =>
	{
		internalTab.value = value;
		emit('update:tab', value);
	},
});

const INSPECTORS = {
	[SELECTION_CORNER_2D]: CornerInspector,
	[SELECTION_ROOM_2D]: RoomInspector,
	[SELECTION_WALL_2D]: Wall2DInspector,
	[SELECTION_ITEM]: ItemInspector,
	[SELECTION_WALL]: SurfaceInspector,
	[SELECTION_FLOOR]: SurfaceInspector,
};

const component = computed(() =>
	(props.selection ? INSPECTORS[props.selection.type] || null : null));

/**
 * Each inspector takes the model object under the name it uses, so its own
 * props stay readable; the surface inspector is the exception because it needs
 * to know whether it was a wall or a floor that was clicked.
 */
const bindings = computed(() =>
{
	if (!props.selection)
	{
		return {};
	}
	var floorplanner = store.floorplanner.value;
	switch (props.selection.type)
	{
	case SELECTION_CORNER_2D:
		return {corner: props.selection.object};
	case SELECTION_ROOM_2D:
		return {room: props.selection.object, floorplanner};
	case SELECTION_WALL_2D:
		return {wall: props.selection.object, floorplanner};
	case SELECTION_ITEM:
		return {item: props.selection.object};
	default:
		return {selection: props.selection};
	}
});

watch(() => props.selection, (selection) =>
{
	if (selection)
	{
		tab.value = 'selection';
	}
});
</script>

<template>
	<aside
		id="inspector"
		class="z-[200] flex w-[300px] flex-none flex-col border-l border-line bg-surface"
		aria-label="Inspector">
		<div class="flex flex-none border-b border-line" role="tablist">
			<button
				type="button" class="inspector-tab" role="tab"
				:class="{'is-active': tab === 'selection'}" :aria-selected="tab === 'selection'"
				@click="tab = 'selection'">
				<MousePointerClick :size="14" /> Selection
			</button>
			<button
				type="button" class="inspector-tab" role="tab"
				:class="{'is-active': tab === 'settings'}" :aria-selected="tab === 'settings'"
				@click="tab = 'settings'">
				<SlidersHorizontal :size="14" /> Settings
			</button>
		</div>

		<div class="inspector-body">
			<template v-if="tab === 'selection'">
				<component
					:is="component" v-if="component"
					:key="props.selection.object.id || props.selection.object"
					v-bind="bindings"
					@changed="emit('changed')" />
				<p v-else class="inspector-empty">
					Nothing selected. Click a corner, a wall or a room on the plan, or an item,
					a wall or a floor in the 3D view.
				</p>
			</template>

			<SettingsPanel v-else :store="store" :camera="props.camera" @changed="emit('changed')" />
		</div>
	</aside>
</template>
