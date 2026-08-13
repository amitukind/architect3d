<script setup>
import {floorplannerModes} from '../../scripts/blueprint.js';

/**
 * The 2D pane's toolbar: file actions on the left, then the three editor modes.
 *
 * Reproduces `#floorplanner-controls` (build/index.html:33-56) and the click
 * handlers at build/js/app.js:68-81, with the mode highlight working - see
 * useFloorplannerMode for why it never did.
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
	{id: floorplannerModes.MOVE, icon: 'glyphicon-move', title: 'Move Walls', label: 'Move walls'},
	{id: floorplannerModes.DRAW, icon: 'glyphicon-pencil', title: 'Draw New Walls', label: 'Draw new walls'},
	{id: floorplannerModes.DELETE, icon: 'glyphicon-remove', title: 'Delete Walls', label: 'Delete walls'},
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
		<button
			type="button" class="btn btn-default btn-sm" title="New Layout"
			aria-label="New layout" @click="emit('new-design')">
			<span class="glyphicon glyphicon-floppy-disk" />
		</button>
		<button
			type="button" class="btn btn-default btn-sm" title="Save Layout"
			aria-label="Save layout" @click="emit('save-design')">
			<span class="glyphicon glyphicon-floppy-save" />
		</button>
		<label class="btn btn-sm btn-default btn-file" title="Open Layout">
			<span class="glyphicon glyphicon-floppy-open" />
			<input type="file" accept=".blueprint3d,application/json" @change="onFile">
		</label>

		<button
			v-for="entry in MODES" :key="entry.title" type="button"
			class="btn btn-sm btn-default"
			:class="{'btn-primary': props.mode === entry.id}"
			:aria-pressed="props.mode === entry.id"
			:title="entry.title" :aria-label="entry.label"
			@click="emit('set-mode', entry.id)">
			<span class="glyphicon" :class="entry.icon" />
		</button>

		<button type="button" class="btn btn-sm btn-default" :title="HELP" aria-label="Tips">
			<span class="glyphicon glyphicon-info-sign" />
		</button>
	</div>
</template>
