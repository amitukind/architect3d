<script setup>
import {onBeforeUnmount, onMounted, ref, watch} from 'vue';
import GUI from 'lil-gui';
import {useBlueprint} from '../composables/useBlueprint.js';
import {buildConfigFolders} from './config-folders.js';
import {buildSelectionFolder} from './selection-folders.js';

/**
 * The interim inspector: one lil-gui panel reproducing the demo's dat.GUI
 * folders so the app keeps every setting it had while the shell is rewritten.
 *
 * Sprint S6, and deliberately temporary. S7 replaces it with native Vue
 * inspectors (a real texture picker, a settings panel, per-selection forms) and
 * deletes this directory along with the lil-gui dependency. Treating the
 * inspector as a separate, later sprint is what lets S6 change the shell
 * without also changing the twenty-odd controls inside it.
 *
 * The panel is rebuilt from scratch whenever the blueprint is remounted, and
 * the selection folder whenever the selection changes. Nothing here caches a
 * controller across a rebuild - that was the source of the demo's stale
 * displays.
 */

const props = defineProps({
	selection: {type: Object, default: null},
});

const store = useBlueprint();
const container = ref(null);

let gui = null;
let configFolders = null;
let selectionsFolder = null;
let selectionFolder = null;

function destroySelectionFolder()
{
	if (selectionFolder)
	{
		selectionFolder.destroy();
		selectionFolder = null;
	}
}

function destroyPanel()
{
	destroySelectionFolder();
	if (configFolders)
	{
		configFolders.destroy();
		configFolders = null;
	}
	if (gui)
	{
		gui.destroy();
		gui = null;
	}
	selectionsFolder = null;
}

function buildPanel(blueprint)
{
	if (!container.value || !blueprint.floorplanner)
	{
		// Widget mode has no 2D view, and every configuration folder below is
		// about the 2D view or needs it to redraw. Nothing to show.
		return;
	}

	gui = new GUI({container: container.value, title: 'Architect3D'});
	configFolders = buildConfigFolders(gui, {
		floorplanner: blueprint.floorplanner,
		three: blueprint.three,
	});
	// Closed until something is selected, as in the demo - see the note about
	// dat.GUI's default in config-folders.js.
	selectionsFolder = gui.addFolder('Selections').close();
	rebuildSelection();
}

function rebuildSelection()
{
	destroySelectionFolder();
	if (!selectionsFolder)
	{
		return;
	}
	selectionFolder = buildSelectionFolder(selectionsFolder, props.selection, {
		floorplanner: store.floorplanner.value,
	});
	if (selectionFolder)
	{
		selectionFolder.folder.open();
		selectionsFolder.open();
	}
}

// Not `immediate`, and mount is handled separately: the panel needs both a
// blueprint and a container element, and which of the two arrives last depends
// on whether this component mounts before or after the blueprint is created.
// App.vue creates it in its own onMounted, so normally the watcher wins; a
// panel toggled on later would find the blueprint already there.
watch(store.instance, (blueprint) =>
{
	destroyPanel();
	if (blueprint)
	{
		buildPanel(blueprint);
	}
});

onMounted(() =>
{
	if (store.instance.value && !gui)
	{
		buildPanel(store.instance.value);
	}
});

watch(() => props.selection, rebuildSelection);

onBeforeUnmount(destroyPanel);
</script>

<template>
	<div id="inspector" ref="container" />
</template>
