<script setup>
import AppIcon from './AppIcon.vue';
import {floorplannerModes} from '../../scripts/blueprint.js';

/**
 * The 2D pane's toolbar: file actions on the left, then the three editor modes.
 *
 * Reproduces `#floorplanner-controls` (build/index.html:33-56) and the click
 * handlers at build/js/app.js:68-81, with the mode highlight working - see
 * useFloorplannerMode for why it never did.
 *
 * S7 swapped glyphicons for inline SVG. The tooltips are unchanged; the icons
 * are not, because the demo's did not match them - "New Layout" was a floppy
 * disk, the same glyph family as Save.
 */

const props = defineProps({
	mode: {type: Number, required: true},
});

const emit = defineEmits(['set-mode', 'new-design', 'save-design', 'open-design']);

const HELP = [
	'Tips',
	'Shift Key: Snap To Axis and Snap to Grid',
	'ESC: Stop drawing walls',
	'DbL-Click(Corner): Adjust Elevation',
	'Click(Room): Change Name',
].join('\n');

const MODES = [
	{id: floorplannerModes.MOVE, icon: 'move', title: 'Move Walls', label: 'Move walls'},
	{id: floorplannerModes.DRAW, icon: 'pencil', title: 'Draw New Walls', label: 'Draw new walls'},
	{id: floorplannerModes.DELETE, icon: 'x', title: 'Delete Walls', label: 'Delete walls'},
];

function onFile(event)
{
	var input = event.target;
	if (input.files && input.files.length)
	{
		emit('open-design', input.files[0]);
	}
	// Cleared so that picking the same file twice in a row still fires a change.
	input.value = '';
}
</script>

<template>
	<div id="floorplanner-controls">
		<span class="btn-row">
			<button
				type="button" class="btn" title="New Layout" aria-label="New layout"
				@click="emit('new-design')">
				<AppIcon name="file-plus" />
			</button>
			<button
				type="button" class="btn" title="Save Layout" aria-label="Save layout"
				@click="emit('save-design')">
				<AppIcon name="save" />
			</button>
			<label class="btn btn-file" title="Open Layout">
				<AppIcon name="folder-open" />
				<input type="file" accept=".blueprint3d,application/json" @change="onFile">
			</label>
		</span>

		<span class="btn-row" style="margin-left: 8px">
			<button
				v-for="entry in MODES" :key="entry.title" type="button" class="btn"
				:class="{'is-active': props.mode === entry.id}"
				:aria-pressed="props.mode === entry.id"
				:title="entry.title" :aria-label="entry.label"
				@click="emit('set-mode', entry.id)">
				<AppIcon :name="entry.icon" />
			</button>
		</span>

		<span class="btn-row" style="margin-left: 8px">
			<button type="button" class="btn" :title="HELP" aria-label="Tips">
				<AppIcon name="info" />
			</button>
		</span>
	</div>
</template>
