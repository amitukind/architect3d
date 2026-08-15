<script setup>
import {PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent} from 'reka-ui';
import {ZoomIn, ZoomOut, Maximize2, Crosshair, Grid3x3, Magnet, ChevronDown} from '@lucide/vue';

import AppTip from './AppTip.vue';
import {floorplannerModes} from '../../scripts/blueprint.js';

/**
 * The controls that float over the 2D plan.
 *
 * Zoom, framing and grid - the three things that belong to *this view* rather
 * than to the design. None of them existed. Zoom was a dat.GUI slider from 0.5
 * to 1.5 in the demo and nothing at all after S7; there was no way to frame a
 * plan that had been panned off screen, and snapping was a checkbox buried in
 * the settings panel despite being something you toggle several times a minute
 * while drawing.
 *
 * The cluster sits bottom-left, out of the way of the wall labels the canvas
 * draws around the plan's edges, and is glass rather than solid so the grid
 * behind it stays readable.
 */

const props = defineProps({
	zoomPercent: {type: Number, required: true},
	canZoomIn: {type: Boolean, default: true},
	canZoomOut: {type: Boolean, default: true},
	snap: {type: Boolean, default: false},
	spacing: {type: Number, default: 25},
	spacings: {type: Array, required: true},
	mode: {type: Number, required: true},
});

const emit = defineEmits([
	'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-reset', 'centre',
	'set-snap', 'set-spacing',
]);
</script>

<template>
	<div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-3">
		<div class="glass pointer-events-auto flex items-center gap-0.5 p-1">
			<AppTip label="Zoom out" keys="-" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" title="Zoom out"
					:disabled="!props.canZoomOut" @click="emit('zoom-out')">
					<ZoomOut :size="15" />
				</button>
			</AppTip>

			<AppTip label="Reset to 100%" side="top" :delay="0">
				<button type="button" class="btn num w-[52px] px-0" title="Reset zoom" @click="emit('zoom-reset')">
					{{ props.zoomPercent }}%
				</button>
			</AppTip>

			<AppTip label="Zoom in" keys="+" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" title="Zoom in"
					:disabled="!props.canZoomIn" @click="emit('zoom-in')">
					<ZoomIn :size="15" />
				</button>
			</AppTip>

			<span class="mx-1 h-4 w-px bg-line" />

			<AppTip label="Frame the whole plan" keys="shift+f" side="top" :delay="0">
				<button type="button" class="btn btn-icon" title="Zoom to fit" @click="emit('zoom-fit')">
					<Maximize2 :size="15" />
				</button>
			</AppTip>
			<AppTip label="Recentre" side="top" :delay="0">
				<button type="button" class="btn btn-icon" title="Recentre" @click="emit('centre')">
					<Crosshair :size="15" />
				</button>
			</AppTip>
		</div>

		<div class="glass pointer-events-auto flex items-center gap-0.5 p-1">
			<AppTip label="Snap to grid" keys="s" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': props.snap}"
					:aria-pressed="props.snap" title="Snap to grid"
					@click="emit('set-snap', !props.snap)">
					<Magnet :size="15" />
				</button>
			</AppTip>

			<PopoverRoot>
				<PopoverTrigger as-child>
					<button type="button" class="btn gap-1 px-1.5" title="Grid spacing">
						<Grid3x3 :size="15" />
						<span class="num">{{ props.spacing }}</span>
						<ChevronDown :size="11" class="opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverPortal>
					<PopoverContent
						side="top" align="end" :side-offset="8"
						class="a3d-pop z-[600] w-40 rounded-panel border border-line bg-overlay p-1 shadow-float">
						<p class="eyebrow px-2 py-1.5">Grid spacing</p>
						<button
							v-for="entry in props.spacings" :key="entry.value" type="button"
							class="btn w-full justify-between" :class="{'is-active': props.spacing === entry.value}"
							@click="emit('set-spacing', entry.value)">
							<span>{{ entry.label }}</span>
							<span v-if="props.spacing === entry.value" class="num">•</span>
						</button>
						<!-- The heavier line every fourth cell is drawn by the library, so
						     the metre rhythm follows whatever is chosen here. -->
						<p class="px-2 py-1.5 text-[10px] leading-snug text-ink-faint">
							Every fourth line is drawn heavier.
						</p>
					</PopoverContent>
				</PopoverPortal>
			</PopoverRoot>
		</div>
	</div>

	<!-- Drawing is the one mode with a rule you cannot discover by trying, so it
	     gets a persistent notice rather than only the status-bar hint. -->
	<div
		v-show="props.mode === floorplannerModes.DRAW"
		class="btn-hint pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-line bg-overlay/90 px-3 py-1.5 text-[11px] shadow-float backdrop-blur">
		Click to place corners · <kbd>Shift</kbd> to snap · <kbd>Esc</kbd> to finish
	</div>
</template>
