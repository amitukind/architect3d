<script setup>
// @ts-check
import {ref} from 'vue';

/**
 * The 3D pane. `Main` appends its own canvas to this element and installs a
 * ResizeObserver on it, so all this component owns is a correctly sized box and
 * a stable reference to it.
 *
 * As with FloorplannerView, construction happens in App.vue - see the note
 * there.
 *
 * The container is `relative` so the floating control clusters slotted in
 * position against it, and `overflow-hidden` so the renderer's canvas cannot
 * push a scrollbar into the workspace during a resize transition, when the
 * element is briefly wider than the box it is being animated into.
 */

const container = ref(null);

defineExpose({container});
</script>

<template>
	<!-- Focusable since RM-014 L4. OrbitControls' arrow-key panning is bound to
	     this element rather than to the window, so the tab stop is what makes the
	     keys reachable - and what keeps them from firing while the plan or an
	     inspector field has focus. -->
	<div
		id="viewer" ref="container" tabindex="0"
		role="application"
		aria-label="3D view. Arrow keys pan the camera."
		class="relative h-full w-full overflow-hidden">
		<slot />
	</div>
</template>
