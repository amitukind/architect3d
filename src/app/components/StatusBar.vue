<script setup>
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

const props = defineProps({
	rooms: {type: Number, default: 0},
	walls: {type: Number, default: 0},
	items: {type: Number, default: 0},
	areaLabel: {type: String, default: ''},
	cursor: {type: Object, default: null},
	zoom: {type: Number, default: 100},
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
	case floorplannerModes.DELETE:
		return 'Click a wall or corner to delete it · Esc to stop';
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
	if (!props.cursor)
	{
		return null;
	}
	return `${Dimensioning.cmToMeasure(props.cursor.x)}, ${Dimensioning.cmToMeasure(props.cursor.y)}`;
});
</script>

<template>
	<footer
		id="status-bar"
		class="z-[200] flex h-7 flex-none items-center gap-3 border-t border-line bg-surface px-3 text-ink-faint">
		<p class="truncate text-[11px]">{{ hint }}</p>

		<div class="ml-auto flex items-center gap-3">
			<span class="num" :title="`${plural(props.rooms, 'room')}, ${plural(props.walls, 'wall')}, ${plural(props.items, 'item')}`">
				<span class="text-ink-soft">{{ props.rooms }}</span> {{ props.rooms === 1 ? 'room' : 'rooms' }}
				· <span class="text-ink-soft">{{ props.walls }}</span> {{ props.walls === 1 ? 'wall' : 'walls' }}
				· <span class="text-ink-soft">{{ props.items }}</span> {{ props.items === 1 ? 'item' : 'items' }}
			</span>

			<span v-if="props.areaLabel" class="num" title="Total floor area">
				<span class="text-ink-soft">{{ props.areaLabel }}</span>
			</span>

			<span class="hidden h-3.5 w-px bg-line sm:block" />

			<!-- Reserved width, so the bar does not jump as the pointer enters and
			     leaves the canvas or the coordinates change digit count. -->
			<span class="num hidden w-[124px] text-right tabular-nums sm:inline" title="Pointer position">
				<template v-if="cursorLabel">{{ cursorLabel }}</template>
				<template v-else>—</template>
			</span>

			<span class="num w-[46px] text-right" title="Plan zoom">{{ props.zoom }}%</span>
		</div>
	</footer>
</template>
