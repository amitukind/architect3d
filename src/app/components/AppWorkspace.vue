<script setup>
import {injectLayout} from '../composables/useLayout.js';
// @ts-check
import {computed, onBeforeUnmount, ref} from 'vue';
import {LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from '../composables/useLayout.js';

/**
 * The two viewports and the divider between them.
 *
 * ## Both panes are always full height and never zero wide
 *
 * This is the constraint the whole component is built around, and it is
 * inherited from the card flip it replaces. `FloorplannerView2D` measures
 * `canvas.parentElement` and `Main` measures its container, both with
 * `clientWidth`/`clientHeight`, and both install a ResizeObserver. A pane
 * hidden with `v-if` or `display: none` measures zero, and a viewer that
 * re-measures at zero comes back with a zero aspect ratio - a divide by zero in
 * the projection matrix. So a hidden pane here is a *transparent* pane: full
 * size, `opacity: 0`, and out of the hit-test.
 *
 * ## Why absolute positioning rather than a flex row
 *
 * A flex row would collapse the hidden pane to zero width, which is the same
 * problem. Two absolutely positioned panes anchored to opposite edges can be
 * sized independently and can both be 100% at the same time - which is exactly
 * what the single-pane layouts need.
 *
 * ## The width transition
 *
 * Width is animated, not just opacity, so moving between split and single reads
 * as one pane growing rather than as a cut. That does drive the ResizeObservers
 * for the length of the transition - roughly a dozen callbacks, each one a
 * canvas resize and a redraw - which is affordable at this scale and is the
 * reason the duration is 180ms rather than something more leisurely. Reduced
 * motion turns it off entirely, globally, in app.css.
 */

/**
 * The layout, injected (RM-020 S-5).
 *
 * All three of this component's bindings were `useLayout`, and one of them was
 * a v-model relaying the split ratio back to the composable that owns it.
 */
const workspace = injectLayout();



/** @type {import('vue').Ref<?HTMLElement>} The split container, null until mount. */
const container = ref(null);
const dragging = ref(false);

const isSplit = computed(() => workspace.layout.value === LAYOUT_SPLIT);

/** Fraction of the width the plan occupies, per layout. */
const planFraction = computed(function ()
{
	if (workspace.layout.value === LAYOUT_PLAN)
	{
		return 1;
	}
	if (workspace.layout.value === LAYOUT_VIEW)
	{
		return 0;
	}
	return workspace.splitRatio.value;
});

/**
 * A hidden pane keeps its full width and loses only its opacity, so it never
 * measures zero - see the note above. The divider's own width is taken off the
 * plan side in split mode so the two panes plus the divider fill the row
 * exactly.
 */
const DIVIDER = 5;

// `pointerEvents: 'none'` is a `string` to the checker and `PointerEvents` to
// Vue's style binding, and the two branches produce different object shapes on
// top of that. Declaring the return type is what reconciles them (RM-004 B3).
/** @type {import('vue').ComputedRef<import('vue').CSSProperties>} */
const planStyle = computed(function ()
{
	if (workspace.layout.value === LAYOUT_PLAN)
	{
		return {width: '100%', opacity: 1};
	}
	if (workspace.layout.value === LAYOUT_VIEW)
	{
		return {width: '100%', opacity: 0, pointerEvents: 'none'};
	}
	return {width: `calc(${planFraction.value * 100}% - ${DIVIDER / 2}px)`, opacity: 1};
});

/** @type {import('vue').ComputedRef<import('vue').CSSProperties>} */
const viewStyle = computed(function ()
{
	if (workspace.layout.value === LAYOUT_VIEW)
	{
		return {width: '100%', opacity: 1};
	}
	if (workspace.layout.value === LAYOUT_PLAN)
	{
		return {width: '100%', opacity: 0, pointerEvents: 'none'};
	}
	return {width: `calc(${(1 - planFraction.value) * 100}% - ${DIVIDER / 2}px)`, opacity: 1};
});

/**
 * Drag the divider.
 *
 * Pointer capture rather than window listeners: it keeps the drag alive when
 * the pointer leaves the window, releases automatically if the browser cancels
 * the gesture, and means there is no listener to leak if the component
 * unmounts mid-drag. The transition is suspended while dragging - a 180ms ease
 * on something following the pointer is lag, not polish.
 */
function onPointerDown(event)
{
	dragging.value = true;
	event.currentTarget.setPointerCapture(event.pointerId);
}

function onPointerMove(event)
{
	if (!dragging.value || !container.value)
	{
		return;
	}
	const box = container.value.getBoundingClientRect();
	if (box.width <= 0)
	{
		return;
	}
	workspace.setSplitRatio((event.clientX - box.left) / box.width);
}

function onPointerUp(event)
{
	dragging.value = false;
	if (event.currentTarget.hasPointerCapture(event.pointerId))
	{
		event.currentTarget.releasePointerCapture(event.pointerId);
	}
}

/**
 * Keyboard resizing, so the divider is not a mouse-only control. 2% a press,
 * which is a few pixels short of imperceptible and takes about a second to
 * cross the useful range.
 */
function onKeydown(event)
{
	if (event.key === 'ArrowLeft')
	{
		event.preventDefault();
		workspace.setSplitRatio(workspace.splitRatio.value - 0.02);
	}
	else if (event.key === 'ArrowRight')
	{
		event.preventDefault();
		workspace.setSplitRatio(workspace.splitRatio.value + 0.02);
	}
	else if (event.key === 'Home')
	{
		event.preventDefault();
		workspace.setSplitRatio(0.5);
	}
}

onBeforeUnmount(() => {dragging.value = false;});
</script>

<template>
	<!-- <main>, not <div>: this is the page's main content, and without a landmark
	     here everything between the banner and the status bar sat outside one.
	     axe's `region` rule caught it, and it is a real gap - a screen-reader
	     user had no way to skip to the plan. -->
	<main id="workspace" ref="container" class="relative flex-1 overflow-hidden bg-ground">
		<div
			class="absolute inset-y-0 left-0 overflow-hidden"
			:class="dragging ? '' : 'transition-[width,opacity] duration-[180ms] ease-out'"
			:style="planStyle">
			<slot name="plan" />
		</div>

		<div
			class="absolute inset-y-0 right-0 overflow-hidden"
			:class="dragging ? '' : 'transition-[width,opacity] duration-[180ms] ease-out'"
			:style="viewStyle">
			<slot name="view" />
		</div>

		<div
			v-if="isSplit"
			class="group absolute inset-y-0 z-30 flex w-[5px] -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
			:style="{left: `${planFraction * 100}%`}"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the plan and 3D panes"
			:aria-valuenow="Math.round(planFraction * 100)"
			:aria-valuemin="20"
			:aria-valuemax="80"
			tabindex="0"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
			@keydown="onKeydown">
			<span
				class="h-full w-px bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
				:class="{'bg-accent': dragging}" />
			<!-- A wider invisible target than the visible line: a 1px hairline is
			     honest about where the boundary is and impossible to grab. -->
			<span class="absolute inset-y-0 -inset-x-1.5" />
		</div>
	</main>
</template>
