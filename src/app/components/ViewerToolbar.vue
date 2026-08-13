<script setup>
/**
 * The 3D pane's toolbar: the same file actions as the 2D one, plus the two mesh
 * exports.
 *
 * Reproduces `#main-controls` (build/index.html:63-71). The demo wired both
 * toolbars to the same handlers and read whichever file input happened to be
 * non-empty; here both emit the same events and App.vue has one handler each.
 */

const props = defineProps({
	exporting: {type: Boolean, default: false},
});

const emit = defineEmits(['new-design', 'save-design', 'open-design', 'save-mesh', 'save-gltf']);

function onFile(event)
{
	var input = event.target;
	if (input.files && input.files.length)
	{
		emit('open-design', input.files[0]);
	}
	input.value = '';
}
</script>

<template>
	<div id="main-controls">
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
			type="button" class="btn btn-default btn-sm" title="Save Scene as a mesh"
			aria-label="Save scene as OBJ" @click="emit('save-mesh')">
			<span class="glyphicon glyphicon-asterisk" />
		</button>
		<button
			type="button" class="btn btn-default btn-sm" title="Save Scene as a GLTF"
			aria-label="Save scene as glTF" :disabled="props.exporting"
			@click="emit('save-gltf')">
			<span class="glyphicon glyphicon-export" />
		</button>
	</div>
</template>
