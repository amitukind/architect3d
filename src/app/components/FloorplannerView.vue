<script setup>
// @ts-check
import {ref} from 'vue';

/**
 * The 2D pane: the canvas the floorplanner draws into, plus whatever the parent
 * slots on top of it.
 *
 * It deliberately does not construct anything. `BlueprintJS` wants the 2D canvas
 * and the 3D container in the same call, so App.vue owns construction and reads
 * this element out of `defineExpose` - children mount before their parent, so it
 * is there by the time App's onMounted runs.
 *
 * The wrapping div is the *sizing container*: FloorplannerView2D measures
 * `canvas.parentElement` and watches it with a ResizeObserver. That is why the
 * canvas is a direct child of a div with a real height, and why the demo's
 * `$(canvasWrapper).height(window.innerHeight - offset().top)` on every window
 * resize (build/js/app.js:88) has no equivalent here - CSS gives the container
 * its size and the observer notices.
 *
 * ## The wheel handler
 *
 * `wheel` is listened for here rather than in the library because zoom is an
 * application concern - the library has a `scale` in Configuration and no
 * opinion about what should change it. `passive: false` is required: the
 * default action of a wheel over a canvas is to scroll the page, and only a
 * non-passive listener may call preventDefault. Vue's `.prevent` modifier alone
 * would register a passive listener in browsers that default wheel to passive,
 * and the page would scroll anyway.
 */

const emit = defineEmits(['wheel-zoom', 'pointer-move', 'pointer-leave', 'canvas-focus', 'canvas-blur']);

const canvas = ref(null);

/**
 * @param {WheelEvent} event
 */
function onWheel(event)
{
	event.preventDefault();
	// deltaY is in whatever unit deltaMode says - pixels on a trackpad, lines on
	// most wheels - so only its sign is trustworthy across devices. A fixed
	// factor per notch is more predictable than scaling by the magnitude, which
	// makes a trackpad flick jump four stops.
	emit('wheel-zoom', event.deltaY < 0 ? 1.1 : 1 / 1.1);
}

defineExpose({canvas});
</script>

<template>
	<div id="floorplanner" class="relative h-full w-full overflow-hidden">
		<!-- Focusable since RM-014 L4 (finding Z-5), which is what puts the plan in
		     the tab order and scopes the drawing keys to it. `role="application"`
		     tells a screen reader to pass the arrow keys through rather than using
		     them to browse, which is the whole gesture. The label names the keys
		     because there is no other way to discover them from here. -->
		<canvas
			id="floorplanner-canvas" ref="canvas" class="block h-full w-full"
			tabindex="0"
			role="application"
			aria-label="Floor plan. Arrow keys move the cursor, Enter presses, Space picks up and puts down."
			@wheel.prevent="onWheel"
			@focus="emit('canvas-focus')"
			@blur="emit('canvas-blur')"
			@pointermove="emit('pointer-move', $event)"
			@pointerleave="emit('pointer-leave')" />
		<slot />
	</div>
</template>
