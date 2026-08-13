<script setup>
import ViewCube from './ViewCube.vue';
import AppIcon from './AppIcon.vue';
import {MODE_FLOORPLAN, MODE_DESIGN, MODE_WALKTHROUGH} from '../composables/useCameraViews.js';

/**
 * The bottom control bar: which pane is showing, and everything that only makes
 * sense while the 3D pane is.
 *
 * Reproduces `#interface-controls` (build/index.html:74-116). The camera
 * controls and the catalog button hide in the 2D pane exactly as the demo hid
 * them (build/js/app.js:900-927) - they act on a view that is not on screen.
 *
 * One addition: the walk-through button. It is in the demo's markup but
 * commented out (build/index.html:113-115), which is why parity scenario P10
 * says "unreachable from the legacy UI - capture via console". S5 rebuilt those
 * controls on three's addon and the exit path (EVENT_FPS_EXIT) is wired in
 * useCameraViews, so there is no longer a reason to hide it.
 */

const props = defineProps({
	mode: {type: String, required: true},
	activeView: {type: String, required: true},
	orthographic: {type: Boolean, required: true},
	wireframe: {type: Boolean, required: true},
});

const emit = defineEmits([
	'show-floorplan', 'show-design', 'show-walkthrough',
	'switch-view', 'toggle-orthographic', 'toggle-wireframe', 'open-catalog',
]);
</script>

<template>
	<div id="interface-controls">
		<button
			type="button" class="btn"
			:class="{'is-active': props.mode === MODE_FLOORPLAN}"
			:aria-pressed="props.mode === MODE_FLOORPLAN"
			title="Edit 2D floorplan" @click="emit('show-floorplan')">
			<AppIcon name="move" /> Floor Plan
		</button>
		<button
			type="button" class="btn"
			:class="{'is-active': props.mode === MODE_DESIGN}"
			:aria-pressed="props.mode === MODE_DESIGN"
			title="Edit 3D floorplan" @click="emit('show-design')">
			<AppIcon name="cube" /> 3D
		</button>

		<div v-show="props.mode !== MODE_FLOORPLAN" id="viewcontrols">
			<ViewCube :active-view="props.activeView" @switch-view="emit('switch-view', $event)" />
			<div class="btn-row">
				<button
					type="button" class="btn"
					:class="{'is-active': props.orthographic}" :aria-pressed="props.orthographic"
					title="Switch Camera ortho/perspective" @click="emit('toggle-orthographic')">
					<AppIcon name="camera" />
				</button>
				<button
					type="button" class="btn"
					:class="{'is-active': props.wireframe}" :aria-pressed="props.wireframe"
					title="Switch wireframe mode" @click="emit('toggle-wireframe')">
					<AppIcon name="grid" />
				</button>
			</div>
		</div>

		<button
			v-show="props.mode !== MODE_FLOORPLAN" type="button" class="btn"
			title="Add/Remove items in 3D" @click="emit('open-catalog')">
			<AppIcon name="plus" />
		</button>

		<button
			type="button" class="btn"
			:class="{'is-active': props.mode === MODE_WALKTHROUGH}"
			:aria-pressed="props.mode === MODE_WALKTHROUGH"
			title="Walk through" @click="emit('show-walkthrough')">
			<AppIcon name="eye" />
		</button>
	</div>
</template>
