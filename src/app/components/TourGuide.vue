<script setup>
// @ts-check
import {injectTour} from '../composables/useTour.js';
import {computed, ref, watch, onBeforeUnmount, onMounted, nextTick} from 'vue';
import {PopoverRoot, PopoverAnchor, PopoverPortal, PopoverContent} from 'reka-ui';
import {X} from '@lucide/vue';

/**
 * The first-run tour, drawn (RM-014 L2, finding Z-7).
 *
 * ## No dependency, and the reason is not frugality
 *
 * Reka's `PopoverAnchor` takes a `reference` element rather than requiring the
 * popover to wrap its trigger, and `PopoverRoot` was already in the bundle for
 * two other components. So a tour is a step index and a resolved element - and
 * it inherits Escape, the focus scope and the collision handling from the same
 * primitive the rest of the application uses, rather than from a tour library
 * that would have its own opinions about all three.
 *
 * ## The ring is measured, not styled onto the target
 *
 * The obvious way to highlight a step is to add a class to the anchor. That
 * writes into components this one does not own, survives a crash mid-tour, and
 * fights whatever the target's own `:focus-visible` is doing. A fixed-position
 * outline over the measured rectangle owns nothing and disappears with the
 * tour.
 *
 * It is measured after the layout has settled rather than immediately: two
 * steps switch panes, and `AppWorkspace` animates a pane's width over 180 ms,
 * so a rectangle read on the same tick is the rectangle the pane is leaving.
 */

/**
 * The whole of `useTour`, injected (RM-020 S-5).
 *
 * Every one of this component's six props and three events was that composable
 * relayed through `App.vue`. There is nothing here the shell decides.
 */
const tour = injectTour();

/** The element the current step points at. @type {import('vue').Ref<?HTMLElement>} */
const anchor = ref(null);
/** Its rectangle, for the ring. @type {import('vue').Ref<?DOMRect>} */
const rect = ref(null);
/** How long `AppWorkspace` takes to resize a pane. */
const SETTLE_MS = 220;
let timer = null;

/** Find the step's element and measure it. */
function locate()
{
	const step = tour.step.value;
	if (!tour.open.value || !step)
	{
		anchor.value = null;
		rect.value = null;
		return;
	}
	const found = /** @type {?HTMLElement} */ (document.querySelector(step.anchor));
	anchor.value = found;
	rect.value = found ? found.getBoundingClientRect() : null;
}

/** Measure now and again once a pane change has finished moving. */
function locateSettled()
{
	locate();
	if (timer) { clearTimeout(timer); }
	timer = setTimeout(() => {locate(); timer = null;}, SETTLE_MS);
}

watch(() => [tour.open.value, tour.step.value], () => {nextTick(locateSettled);}, {immediate: true});

onMounted(() => {window.addEventListener('resize', locate);});
onBeforeUnmount(() =>
{
	window.removeEventListener('resize', locate);
	if (timer) { clearTimeout(timer); }
});

const ringStyle = computed(function ()
{
	const box = rect.value;
	if (!box || !box.width || !box.height)
	{
		return {display: 'none'};
	}
	return {
		top: `${box.top}px`,
		left: `${box.left}px`,
		width: `${box.width}px`,
		height: `${box.height}px`,
	};
});

/** Whether the step points at something that is actually on screen. */
const located = computed(() => Boolean(rect.value && rect.value.width && rect.value.height));

/** @param {boolean} value */
function onOpenChange(value)
{
	// Reka reports Escape and an outside click through the same channel, and both
	// mean the same thing here.
	if (!value) { tour.skip(); }
}
</script>

<template>
	<PopoverRoot :open="tour.open.value && Boolean(anchor)" @update:open="onOpenChange">
		<PopoverAnchor :reference="anchor || undefined" />
		<PopoverPortal>
			<PopoverContent
				:side="tour.step.value ? tour.step.value.side : 'right'" :side-offset="10" :collision-padding="12"
				data-testid="tour-card"
				class="a3d-pop z-[620] w-[320px] max-w-[calc(100vw-2rem)] rounded-panel border border-line bg-surface p-3.5 shadow-float focus:outline-none"
				@open-auto-focus.prevent>
				<div class="flex items-start gap-2">
					<p class="eyebrow flex-1">Step {{ tour.index.value + 1 }} of {{ tour.total }}</p>
					<button
						type="button" class="btn btn-icon -mr-1 -mt-1 h-6 w-6" aria-label="Skip the tour"
						@click="tour.skip()">
						<X :size="13" />
					</button>
				</div>
				<h2 class="mt-1 text-[14px] font-semibold text-ink">{{ tour.step.value ? tour.step.value.title : '' }}</h2>
				<p class="mt-1 text-[12px] leading-relaxed text-ink-soft">{{ tour.step.value ? tour.step.value.body : '' }}</p>

				<div class="mt-3 flex items-center gap-1.5">
					<div class="flex flex-1 gap-1" aria-hidden="true">
						<span
							v-for="n in tour.total" :key="n"
							class="h-1 w-4 rounded-full"
							:class="n === tour.index.value + 1 ? 'bg-accent' : 'bg-line'" />
					</div>
					<button v-if="!tour.first.value" type="button" class="btn h-7 px-2 text-[12px]" @click="tour.back()">
						Back
					</button>
					<button type="button" class="btn btn-primary h-7 px-2.5 text-[12px]" @click="tour.next()">
						{{ tour.last.value ? 'Start drawing' : 'Next' }}
					</button>
				</div>
			</PopoverContent>
		</PopoverPortal>
	</PopoverRoot>

	<!-- Outside the popover's portal: it is a mark on the page, not part of the
	     card, and it must not join the card's focus scope. -->
	<div
		v-if="tour.open.value && located" data-testid="tour-ring" aria-hidden="true"
		class="pointer-events-none fixed z-[610] rounded-md outline outline-2 outline-offset-2 outline-accent"
		:style="ringStyle" />
</template>
