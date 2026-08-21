<script setup>
// @ts-check
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import {Dimensioning, EVENT_ANNOTATIONS_CHANGED} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A dimension: what it measures, and where its line sits (RM-008 E3).
 *
 * ## One field, and two readouts that are not fields
 *
 * The measurement is shown and cannot be typed. That is deliberate and it is
 * the difference between a dimension and a wall: setting a wall's length moves
 * a corner, because the wall IS the two corners. A dimension describes two
 * points that may be a wall, a piece of furniture and a wall, or nothing at
 * all - there is no single answer to "what should move", so a field here would
 * either pick one arbitrarily or do nothing.
 *
 * What can be set is the offset, which is the only thing about a dimension that
 * is purely presentational. Signed, so a negative number puts the line on the
 * other side - the same gesture as dragging it past what it measures, which is
 * how it is normally done.
 *
 * The "pinned" readout is there because it changes what the dimension will do
 * next: a pinned end follows its corner when the plan is edited, a free one does
 * not. That is invisible on the canvas and would otherwise be discovered by
 * watching a measurement fail to update.
 */

const props = defineProps({
	dimension: {type: Object, required: true},
	floorplanner: {type: Object, default: null},
});

const emit = defineEmits(['changed']);

const {unit} = useDisplayUnit();

const length = ref('');
const offset = ref(0);
const pinned = ref(0);

function readBack()
{
	length.value = Dimensioning.cmToMeasure(props.dimension.length);
	offset.value = Dimensioning.cmToMeasureRaw(props.dimension.offset);
	pinned.value = (props.dimension.aCorner ? 1 : 0) + (props.dimension.bCorner ? 1 : 0);
}

const pinnedLabel = computed(() =>
{
	if (pinned.value === 2)
	{
		return 'Both ends follow the corners they were placed on.';
	}
	if (pinned.value === 1)
	{
		return 'One end follows the corner it was placed on; the other is fixed.';
	}
	return 'Neither end is on a corner, so this measures two fixed points.';
});

/**
 * Read-after-write, the same as every other panel here: the setter refuses a
 * value it cannot use, so the field must show what the model took rather than
 * what it was handed.
 */
function setOffset(next)
{
	props.dimension.setOffset(Dimensioning.cmFromMeasureRaw(next));
	readBack();
	emit('changed');
}

function flip()
{
	props.dimension.setOffset(-props.dimension.offset);
	readBack();
	emit('changed');
}

function remove()
{
	var floorplan = props.dimension.floorplan;
	if (floorplan)
	{
		floorplan.removeDimension(props.dimension);
	}
	emit('changed');
}

let attached = null;

function attach(dimension)
{
	detach();
	// The measurement changes when the corners this is pinned to move, and the
	// offset changes when the line is dragged - neither goes through this panel.
	attached = {floorplan: dimension.floorplan, onChanged: () => {readBack();}};
	if (attached.floorplan)
	{
		attached.floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, attached.onChanged);
	}
	readBack();
}

function detach()
{
	if (attached)
	{
		if (attached.floorplan)
		{
			attached.floorplan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, attached.onChanged);
		}
		attached = null;
	}
}

watch(() => props.dimension, attach, {immediate: true});
watch(unit, readBack);
onBeforeUnmount(detach);
</script>

<template>
	<section class="inspector-section">
		<h2 class="inspector-heading">Dimension</h2>

		<p class="inspector-readout">
			Measures <strong>{{ length }}</strong>
		</p>

		<NumberField
			label="Offset" :unit="unit" :step="0.01"
			:model-value="offset" @update:model-value="setOffset" />
		<button type="button" class="btn w-full justify-center" @click="flip">
			Put the line on the other side
		</button>

		<p class="inspector-note">{{ pinnedLabel }}</p>

		<button type="button" class="btn btn-danger w-full justify-center" @click="remove">
			Delete this dimension
		</button>
	</section>
</template>
