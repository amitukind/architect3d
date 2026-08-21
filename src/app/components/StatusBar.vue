<script setup>
import {injectPlanStats} from '../composables/usePlanStats.js';
import {injectZoom2D} from '../composables/useZoom2D.js';
// @ts-check
import {computed} from 'vue';
import {Dimensioning, floorplannerModes} from '../../scripts/blueprint.js';
import {LAYOUT_PLAN} from '../composables/useLayout.js';

/**
 * The bottom strip: what the plan contains, where the pointer is, and what the
 * current tool expects next.
 *
 * Every number here was previously either unavailable or drawn on the canvas.
 * The three that matter most:
 *
 * - **Total area.** The canvas labels each room individually, so the area of a
 *   two-room flat required mental arithmetic.
 * - **Cursor position.** A drafting tool without a coordinate readout makes
 *   "put this wall 3 m from that one" a matter of dragging until the wall label
 *   says the right thing.
 * - **The tool hint.** The demo had exactly one - "Press Esc to stop drawing
 *   walls" - rendered by a selector that matched nothing, so it never appeared
 *   in the demo's whole life. Each mode now says what it does.
 *
 * Everything is set in the mono face with tabular figures, so a moving cursor
 * readout does not reflow the bar around it.
 */

/**
 * The plan's own numbers come from the composables, not from the parent
 * (RM-020 S-5).
 *
 * Six of this component's props were `usePlanStats` and `useZoom2D` handed over
 * one value at a time by `App.vue`, which built both and pushed them into three
 * separate components. They are injected now. What stays a prop is what the
 * *parent* decides - which tool is active, which layout is showing - because
 * that is genuinely the caller's to say.
 */
const stats = injectPlanStats();
const zoom = injectZoom2D();

const props = defineProps({
	mode: {type: Number, required: true},
	layout: {type: String, required: true},
	unitLabel: {type: String, default: ''},
});

/**
 * What the active tool is waiting for.
 *
 * Written as an instruction rather than a name - the rail already says which
 * tool is active, so repeating "Draw walls" here would be a label for a label.
 */
const hint = computed(function ()
{
	if (props.layout !== LAYOUT_PLAN && props.layout !== 'split')
	{
		return 'Drag to orbit · scroll to zoom · click an item to select it';
	}
	switch (props.mode)
	{
	case floorplannerModes.DRAW:
		return 'Click to place corners · hold Shift to snap · Esc to finish';
	case floorplannerModes.RECTANGLE:
		return 'Click two opposite corners to draw a room · Esc to cancel';
	case floorplannerModes.DIMENSION:
		return 'Click the two points to measure between · Esc to cancel';
	case floorplannerModes.TEXT:
		return 'Click where the label goes, then type it in the panel';
	case floorplannerModes.DELETE:
		return 'Click a wall, corner, dimension or label to delete it · Esc to stop';
	default:
		return 'Drag corners and walls · double-click a corner for its elevation';
	}
});

/** "1 room", "3 rooms". The bar is read at a glance and "1 rooms" is a snag. */
function plural(count, noun)
{
	return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Plan coordinates, formatted in the active display unit. */
const cursorLabel = computed(function ()
{
	if (!stats.cursor.value)
	{
		return null;
	}
	return `${Dimensioning.cmToMeasure(stats.cursor.value.x)}, ${Dimensioning.cmToMeasure(stats.cursor.value.y)}`;
});
</script>

<template>
	<footer
		id="status-bar"
		class="z-[200] flex h-7 flex-none items-center gap-3 border-t border-line bg-surface px-3 text-ink-faint">
		<p class="truncate text-[11px]">{{ hint }}</p>

		<!-- The credit. Placed after the hint and before the counts so it is the
		     one thing on this bar that never moves: the hint truncates and the
		     counts change width, and a link that shifts under the pointer is a
		     link nobody clicks on purpose. -->
		<span class="hidden h-3.5 w-px flex-none bg-line sm:block" />
		<a
			class="hidden flex-none text-[11px] transition-colors hover:text-ink sm:inline"
			href="https://amitukind.com" target="_blank" rel="noopener noreferrer"
			title="amitukind.com">
			Created by <span class="text-ink-soft">Amit Verma</span>
		</a>

		<div class="ml-auto flex items-center gap-3">
			<span class="num" :title="`${plural(stats.rooms.value, 'room')}, ${plural(stats.walls.value, 'wall')}, ${plural(stats.items.value, 'item')}`">
				<span class="text-ink-soft">{{ stats.rooms.value }}</span> {{ stats.rooms.value === 1 ? 'room' : 'rooms' }}
				· <span class="text-ink-soft">{{ stats.walls.value }}</span> {{ stats.walls.value === 1 ? 'wall' : 'walls' }}
				· <span class="text-ink-soft">{{ stats.items.value }}</span> {{ stats.items.value === 1 ? 'item' : 'items' }}
			</span>

			<span v-if="stats.areaLabel.value" class="num" title="Total floor area">
				<span class="text-ink-soft">{{ stats.areaLabel.value }}</span>
			</span>

			<span class="hidden h-3.5 w-px bg-line sm:block" />

			<!-- Reserved width, so the bar does not jump as the pointer enters and
			     leaves the canvas or the coordinates change digit count. -->
			<span class="num hidden w-[124px] text-right tabular-nums sm:inline" title="Pointer position">
				<template v-if="cursorLabel">{{ cursorLabel }}</template>
				<template v-else>—</template>
			</span>

			<span class="num w-[46px] text-right" title="Plan zoom">{{ zoom.percent.value }}%</span>
		</div>
	</footer>
</template>
