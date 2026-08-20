<script setup>
// @ts-check
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import {Dimensioning, WallTypes, EVENT_MOVED, EVENT_WALL_ATTRIBUTES_CHANGED} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A wall: straight or curved, and how long.
 *
 * Sprint S7, replacing the dat.GUI "Current Wall 2D" folder. The dropdown is a
 * two-button segmented control, which is one click instead of two for a choice
 * with exactly two options.
 *
 * Length is offered only for straight walls, as in the demo: a curved wall's
 * size is a property of its bezier, and setting it directly would fight the
 * control points.
 *
 * ## Thickness, and the height that is not here (RM-008 E2)
 *
 * Thickness is a real per-wall property: `HalfEdge` sets its offset to half of
 * it, so changing it moves the faces apart, moves the plan and moves the rooms
 * derived from the graph.
 *
 * There is deliberately no height field. E2 measured what `Wall.height` does and
 * the answer is: not that. A wall's drawn top comes from the two corners'
 * elevations, and setting `Wall.height` to 400 with the corners left at 250 drew
 * a wall 250 tall. Height belongs to the corners, is edited in the corner panel,
 * and the note below says so rather than offering a control that would appear to
 * work and would not.
 */

const props = defineProps({
	wall: {type: Object, required: true},
	floorplanner: {type: Object, default: null},
});

const {unit} = useDisplayUnit();

const curved = ref(false);
const length = ref(0);
const thickness = ref(0);
const ownThickness = ref(false);
const partial = ref(0);
const isHalfWall = ref(false);

const canSetLength = computed(() => !curved.value);

function readBack()
{
	curved.value = props.wall.wallType === WallTypes.CURVED;
	length.value = Dimensioning.cmToMeasureRaw(props.wall.wallSize);
	thickness.value = Dimensioning.cmToMeasureRaw(props.wall.thickness);
	ownThickness.value = props.wall.hasOwnThickness;
	isHalfWall.value = props.wall.partialHeight !== null;
	partial.value = Dimensioning.cmToMeasureRaw(
		props.wall.partialHeight === null ? props.wall.drawnHeightAt(props.wall.getStart()) : props.wall.partialHeight);
}

function redraw()
{
	if (props.floorplanner)
	{
		props.floorplanner.redraw();
	}
}

function setCurved(next)
{
	props.wall.wallType = next ? WallTypes.CURVED : WallTypes.STRAIGHT;
	readBack();
	redraw();
}

/**
 * Thickness reaches the model as centimetres and comes straight back out, the
 * same read-after-write the item panel uses: the setter refuses a value that
 * would collapse the wall, so the field must show what the wall took rather
 * than what it was handed.
 */
function setThickness(next)
{
	props.wall.thickness = Dimensioning.cmFromMeasureRaw(next);
	readBack();
	redraw();
}

/**
 * Stop this wall below its corners, or let it reach them again (RM-008 F2).
 *
 * A half wall is one thing here and not a mode: the corners keep the height,
 * this caps where the faces stop, and nothing else in the plan changes - which
 * is what makes it safe for a wall inside a room. See `Wall.partialHeight` for
 * why it is not `Wall.height` and not a corner split; both were tried.
 */
function setPartialHeight(next)
{
	props.wall.partialHeight = Dimensioning.cmFromMeasureRaw(next);
	readBack();
	redraw();
}

function clearPartialHeight()
{
	props.wall.partialHeight = null;
	readBack();
	redraw();
}

/** Put the wall back on the document's wall thickness. */
function clearThickness()
{
	props.wall.thickness = null;
	readBack();
	redraw();
}

function setLength(next)
{
	// Zero would have produced NaN coordinates before S4 fixed the setter; it is
	// a no-op now, and the field reads back whatever the wall actually took.
	props.wall.wallSize = Dimensioning.cmFromMeasureRaw(next);
	readBack();
	redraw();
}

let attached = null;

function attach(wall)
{
	detach();
	// Dragging either end changes the length under the panel.
	attached = {wall, onMoved: () => {readBack();}};
	wall.addEventListener(EVENT_MOVED, attached.onMoved);
	// Thickness can also change from outside this panel - undo, a loaded file -
	// and the wall says so now that it has a setter (RM-008 E2).
	wall.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, attached.onMoved);
	readBack();
}

function detach()
{
	if (attached)
	{
		attached.wall.removeEventListener(EVENT_MOVED, attached.onMoved);
		attached.wall.removeEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, attached.onMoved);
		attached = null;
	}
}

watch(() => props.wall, attach, {immediate: true});
watch(unit, readBack);
onBeforeUnmount(detach);
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">Wall</h3>

		<div class="field">
			<span class="field-label">Type</span>
			<div class="segmented">
				<button
					type="button" class="segment" :class="{'is-active': !curved}"
					:aria-pressed="!curved" @click="setCurved(false)">
					Straight
				</button>
				<button
					type="button" class="segment" :class="{'is-active': curved}"
					:aria-pressed="curved" @click="setCurved(true)">
					Curved
				</button>
			</div>
		</div>

		<NumberField
			v-if="canSetLength" label="Length" :unit="unit" :min="0"
			:model-value="length" @update:model-value="setLength" />
		<p v-else class="inspector-note">
			A curved wall is sized by dragging its bezier handles on the plan.
		</p>

		<NumberField
			label="Thickness" :unit="unit" :min="0" :step="0.01"
			:model-value="thickness" @update:model-value="setThickness" />
		<button
			v-if="ownThickness" type="button" class="btn w-full justify-center"
			@click="clearThickness">
			Use the default thickness
		</button>

		<NumberField
			label="Stops at" :unit="unit" :min="0" :step="0.01"
			:model-value="partial" @update:model-value="setPartialHeight" />
		<button
			v-if="isHalfWall" type="button" class="btn w-full justify-center"
			@click="clearPartialHeight">
			Full height again
		</button>

		<p class="inspector-note">
			Full wall height is set per corner &mdash; double-click a corner on the
			plan, or select one, and set its elevation. Two walls meeting at a corner
			share its height, so &ldquo;stops at&rdquo; is how one wall is made a half
			wall without lowering its neighbour.
		</p>
	</section>
</template>
