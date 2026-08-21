<script setup>
import {injectFloorplannerMode} from '../composables/useFloorplannerMode.js';
import {injectZoom2D} from '../composables/useZoom2D.js';
import {injectPlanStats} from '../composables/usePlanStats.js';
// @ts-check
import {computed, ref} from 'vue';
import {PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent} from 'reka-ui';
import {ZoomIn, ZoomOut, Maximize2, Crosshair, Grid3x3, Magnet, Triangle, ChevronDown} from '@lucide/vue';

import AppTip from './AppTip.vue';
import {floorplannerModes, Dimensioning} from '../../scripts/blueprint.js';

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

/**
 * Zoom and the wall count are injected, not passed (RM-020 S-5).
 *
 * Six props and seven emits on this component were `useZoom2D` relayed through
 * `App.vue` one value and one callback at a time. Reaching for the composable
 * directly removes both halves: there is nothing for the parent to forward and
 * nothing for it to forward back. What is still a prop is what the parent
 * genuinely owns - the active tool and the display unit.
 */
const zoom = injectZoom2D();
const stats = injectPlanStats();

const editor = injectFloorplannerMode();

const props = defineProps({
	unit: {type: String, default: ''},
});



/**
 * The typed half of "draw to a number" (RM-008 E2).
 *
 * Two fields that mirror what the plan is already drawing beside the pointer,
 * and write back to it. Local refs rather than a computed over the prop,
 * because the prop changes on every pointermove and a field bound straight to
 * it would rewrite itself under the cursor mid-type. `editing` is which field
 * has focus; while one does, it keeps whatever was typed and the other keeps
 * following the pointer.
 */
const typedLength = ref('');
const typedAngle = ref('');
const editing = ref('');

const drawing = computed(() => editor.drawTarget.value !== null);

/** What each field shows: what was typed while focused, the live value if not. */
const lengthShown = computed(() => (editing.value === 'length')
	? typedLength.value
	: (editor.drawTarget.value ? round(Dimensioning.cmToMeasureRaw(editor.drawTarget.value.length)) : ''));

const angleShown = computed(() => (editing.value === 'angle')
	? typedAngle.value
	: (editor.drawTarget.value ? round(editor.drawTarget.value.angle) : ''));

/** Two decimals is finer than anybody draws and shorter than a float prints. */
function round(value)
{
	return String(Math.round(value * 100) / 100);
}

/**
 * Read a field's value without asserting about the event target.
 *
 * `$event.target` is an `EventTarget`, which declares no `value` - only
 * `HTMLInputElement` does. Narrowing here rather than in the template keeps the
 * assertion in one place the checker can see (RM-004 B3).
 *
 * @param {string} which
 * @param {Event} event
 */
function onTyped(which, event)
{
	const target = event.target;
	if (!(target instanceof HTMLInputElement))
	{
		return;
	}
	if (which === 'length')
	{
		typedLength.value = target.value;
		return;
	}
	typedAngle.value = target.value;
}

function focusField(which)
{
	editing.value = which;
	typedLength.value = lengthShown.value;
	typedAngle.value = angleShown.value;
}

/**
 * Send both numbers, whichever was typed.
 *
 * Both, rather than only the edited one, because a length typed while the
 * pointer keeps moving would otherwise land on a bearing the user never saw.
 * Sending the pair pins the wall exactly where the two fields say it is.
 */
function commitTyped(place)
{
	const length = Dimensioning.cmFromMeasureRaw(Number(typedLength.value));
	const angle = Number(typedAngle.value);
	editor.applyDrawTarget({
		length: isFinite(length) ? length : null,
		angle: isFinite(angle) ? angle : null,
		place: place === true,
	});
	editing.value = '';
}
</script>

<template>
	<!-- The empty plan, which nothing used to say anything about. Above the
	     controls rather than inside them, because it is about the whole surface. -->
	<div
		v-if="stats.walls.value === 0" data-testid="empty-plan"
		class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
		<p class="max-w-[36ch] text-center text-[13px] leading-relaxed text-ink-faint">
			<strong class="block text-ink">Nothing drawn yet</strong>
			Press <kbd>W</kbd> and drag to draw a wall, or <kbd>R</kbd> to draw a whole room at once.
			<kbd>Ctrl</kbd>+<kbd>Z</kbd> brings back anything you deleted.
		</p>
	</div>

	<div class="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-2 p-3">
		<div class="glass pointer-events-auto flex items-center gap-0.5 p-1">
			<AppTip label="Zoom out" keys="-" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" title="Zoom out"
					:disabled="!zoom.canZoomOut.value" @click="zoom.zoomOut()">
					<ZoomOut :size="15" />
				</button>
			</AppTip>

			<AppTip label="Reset to 100%" side="top" :delay="0">
				<button type="button" class="btn num w-[52px] px-0" title="Reset zoom" @click="zoom.resetZoom()">
					{{ zoom.percent.value }}%
				</button>
			</AppTip>

			<AppTip label="Zoom in" keys="+" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" title="Zoom in"
					:disabled="!zoom.canZoomIn.value" @click="zoom.zoomIn()">
					<ZoomIn :size="15" />
				</button>
			</AppTip>

			<span class="mx-1 h-4 w-px bg-line" />

			<AppTip label="Frame the whole plan" keys="shift+f" side="top" :delay="0">
				<button type="button" class="btn btn-icon" title="Zoom to fit" @click="zoom.zoomToFit()">
					<Maximize2 :size="15" />
				</button>
			</AppTip>
			<AppTip label="Recentre" side="top" :delay="0">
				<button type="button" class="btn btn-icon" title="Recentre" @click="zoom.centre()">
					<Crosshair :size="15" />
				</button>
			</AppTip>
		</div>

		<div class="glass pointer-events-auto flex items-center gap-0.5 p-1">
			<AppTip label="Snap to grid" keys="s" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': zoom.snap.value}"
					:aria-pressed="zoom.snap.value" title="Snap to grid"
					@click="zoom.setSnap(!zoom.snap.value)">
					<Magnet :size="15" />
				</button>
			</AppTip>

			<AppTip label="Snap the drawing angle to 15°" side="top" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': editor.angleSnap.value}"
					:aria-pressed="editor.angleSnap.value" title="Snap the drawing angle to 15 degrees"
					@click="editor.setAngleSnap(!editor.angleSnap.value)">
					<Triangle :size="15" />
				</button>
			</AppTip>

			<PopoverRoot>
				<PopoverTrigger as-child>
					<button type="button" class="btn gap-1 px-1.5" title="Grid spacing">
						<Grid3x3 :size="15" />
						<span class="num">{{ zoom.spacing.value }}</span>
						<ChevronDown :size="11" class="opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverPortal>
					<PopoverContent
						side="top" align="end" :side-offset="8"
						class="a3d-pop z-[600] w-40 rounded-panel border border-line bg-overlay p-1 shadow-float">
						<p class="eyebrow px-2 py-1.5">Grid spacing</p>
						<button
							v-for="entry in zoom.gridSpacings" :key="entry.value" type="button"
							class="btn w-full justify-between" :class="{'is-active': zoom.spacing.value === entry.value}"
							@click="zoom.setSpacing(entry.value)">
							<span>{{ entry.label }}</span>
							<span v-if="zoom.spacing.value === entry.value" class="num">•</span>
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
		v-show="editor.mode.value === floorplannerModes.DRAW && !drawing"
		class="btn-hint pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-line bg-overlay/90 px-3 py-1.5 text-[11px] shadow-float backdrop-blur">
		Click to place corners · <kbd>Shift</kbd> to snap to the grid · <kbd>Esc</kbd> to finish
	</div>

	<!-- Draw to a number (RM-008 E2). Only while a wall is actually being drawn:
	     before the first corner there is no length to type, and the fields would
	     be two disabled boxes explaining themselves. -->
	<div
		v-show="drawing"
		class="glass pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 px-2 py-1.5 text-[11px]">
		<label class="flex items-center gap-1">
			<span class="text-muted">Length</span>
			<input
				type="number" step="0.01" min="0" class="field-input w-20 py-0.5 text-[11px]"
				:value="lengthShown"
				@focus="focusField('length')"
				@input="onTyped('length', $event)"
				@keydown.enter.prevent="commitTyped(true)"
				@keydown.tab="commitTyped(false)"
				@blur="editing = ''">
			<span class="text-muted">{{ props.unit }}</span>
		</label>
		<label class="flex items-center gap-1">
			<span class="text-muted">Angle</span>
			<input
				type="number" step="1" class="field-input w-16 py-0.5 text-[11px]"
				:value="angleShown"
				@focus="focusField('angle')"
				@input="onTyped('angle', $event)"
				@keydown.enter.prevent="commitTyped(true)"
				@keydown.tab="commitTyped(false)"
				@blur="editing = ''">
			<span class="text-muted">°</span>
		</label>
		<span class="text-muted"><kbd>Enter</kbd> places it</span>
	</div>
</template>
