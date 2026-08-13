<script setup>
import {onBeforeUnmount, onMounted, ref} from 'vue';

import FloorplannerView from './components/FloorplannerView.vue';
import ThreeViewport from './components/ThreeViewport.vue';
import FloorplanToolbar from './components/FloorplanToolbar.vue';
import ViewerToolbar from './components/ViewerToolbar.vue';
import InterfaceControls from './components/InterfaceControls.vue';
import CatalogModal from './components/CatalogModal.vue';
import InspectorPanel from './inspector/InspectorPanel.vue';

import {provideBlueprint} from './composables/useBlueprint.js';
import {useSelection} from './composables/useSelection.js';
import {useCameraViews, MODE_FLOORPLAN} from './composables/useCameraViews.js';
import {useFloorplannerMode} from './composables/useFloorplannerMode.js';
import {useDesignIO} from './composables/useDesignIO.js';
import {useCatalog} from './composables/useCatalog.js';
import {syncDisplayUnit} from './composables/useDisplayUnit.js';
import {floorplannerModes, Configuration, configSystemUI} from '../scripts/blueprint.js';

/**
 * The application shell (sprints S6-S7), replacing build/js/app.js.
 *
 * ## Where construction happens, and why here
 *
 * `BlueprintJS` takes the 2D canvas and the 3D container in one call, so no
 * single leaf component can own it. App.vue does: it reads both elements out of
 * its children (Vue mounts children before parents, so both exist by the time
 * this onMounted runs) and constructs once.
 *
 * That also makes the teardown one place instead of none. The demo had no
 * teardown at all - it assumed the page it booted into was the page it would
 * die on.
 *
 * ## Boot order
 *
 * Reproduced from build/js/app.js:884-903, which is load-bearing in two places:
 * the default design is loaded *before* the inspector is built, and
 * `stopSpin()` is called after construction rather than `spin: false` being
 * passed into it. See useCameraViews for the second one.
 */

const store = provideBlueprint();
const selection = useSelection(store);
const camera = useCameraViews(store);
const editor = useFloorplannerMode(store);
const io = useDesignIO(store);
const catalog = useCatalog(store, selection.placementContext);

const floorplanRef = ref(null);
const viewportRef = ref(null);
const catalogOpen = ref(false);

onMounted(() =>
{
	store.mount({
		floorplannerElement: floorplanRef.value.canvas,
		threeElement: viewportRef.value.container,
	});

	// The library asks for corner elevations and room names through
	// window.prompt when this is false, and draws its own in-canvas editors when
	// it is true. The demo set it false (build/js/app.js:655).
	//
	// S7 looked at this and kept it false. The in-canvas editors have never run
	// in this application's life, they are not covered by a single test, and the
	// native inspectors now offer both edits with a real form - so the prompt is
	// a fallback for a double-click, not the primary path it used to be.
	Configuration.setValue(configSystemUI, false);

	// BlueprintJS's constructor sets dimMeter as its first statement, so the
	// panel has to re-read the unit rather than trust what it last showed.
	syncDisplayUnit();

	io.newDesign();
});

onBeforeUnmount(() =>
{
	store.unmount();
});

function onAddItem(entry)
{
	catalog.addItem(entry);
}
</script>

<template>
	<div id="interfaces" :class="{card: true, flipped: camera.mode.value !== MODE_FLOORPLAN}">
		<FloorplannerView ref="floorplanRef">
			<FloorplanToolbar
				:mode="editor.mode.value"
				@set-mode="editor.setMode"
				@new-design="io.newDesign"
				@save-design="io.saveDesign"
				@open-design="io.openDesign" />
			<div v-show="editor.mode.value === floorplannerModes.DRAW" class="btn-hint">
				Press the "Esc" key to stop drawing walls
			</div>
		</FloorplannerView>

		<ThreeViewport ref="viewportRef">
			<ViewerToolbar
				:exporting="io.busy.value"
				@new-design="io.newDesign"
				@save-design="io.saveDesign"
				@open-design="io.openDesign"
				@save-mesh="io.saveMesh"
				@save-gltf="io.saveGLTF" />
		</ThreeViewport>
	</div>

	<InterfaceControls
		:mode="camera.mode.value"
		:active-view="camera.activeView.value"
		:orthographic="camera.orthographic.value"
		:wireframe="camera.wireframe.value"
		@show-floorplan="camera.showFloorplan"
		@show-design="camera.showDesign"
		@show-walkthrough="camera.showWalkthrough"
		@switch-view="camera.switchView"
		@toggle-orthographic="camera.setOrthographic(!camera.orthographic.value)"
		@toggle-wireframe="camera.setWireframe(!camera.wireframe.value)"
		@open-catalog="catalogOpen = true" />

	<CatalogModal
		v-if="catalogOpen"
		:sections="catalog.sections.value"
		@close="catalogOpen = false"
		@add-item="onAddItem" />

	<InspectorPanel :selection="selection.selection.value" :camera="camera" />

	<div v-if="io.lastError.value" class="app-error" role="alert">{{ io.lastError.value }}</div>
</template>
