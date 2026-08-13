<script setup>
import {ref} from 'vue';

/**
 * The 2D pane: the canvas the floorplanner draws into, plus whatever toolbar
 * the parent slots on top of it.
 *
 * It deliberately does not construct anything. `BlueprintJS` wants the 2D
 * canvas and the 3D container in the same call, so App.vue owns construction
 * and reads this element out of `defineExpose` - children mount before their
 * parent, so it is there by the time App's onMounted runs.
 *
 * The wrapping div is the *sizing container*: FloorplannerView2D measures
 * `canvas.parentElement` and watches it with a ResizeObserver. That is why the
 * canvas is a direct child of a div with a real height, and why the demo's
 * `$(canvasWrapper).height(window.innerHeight - offset().top)` on every window
 * resize (build/js/app.js:88) has no equivalent here - CSS gives the container
 * its size and the observer notices.
 */

const canvas = ref(null);

defineExpose({canvas});
</script>

<template>
	<div id="floorplanner" class="front">
		<slot />
		<canvas id="floorplanner-canvas" ref="canvas" />
	</div>
</template>
