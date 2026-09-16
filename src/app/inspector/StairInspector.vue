<script setup>
// @ts-check
import {computed, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import {
	Dimensioning, STAIR_STRAIGHT, STAIR_L, STAIR_U,
	TURN_LEFT, TURN_RIGHT,
	HANDRAIL_NONE, HANDRAIL_LEFT, HANDRAIL_RIGHT, HANDRAIL_BOTH,
} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A flight of stairs, as the numbers it is (RM-008 F3).
 *
 * **Rise and going, not height and length.** A building code states a maximum
 * rise and a minimum going and says nothing about a total, because the total is
 * what you get; so those are the fields, and the height and the plan length are
 * shown underneath as the multiplication they are. That is M-37 made visible:
 * a person can see that tread count times rise is the height, because there is
 * nowhere else for the height to come from.
 *
 * The stairwell line is a **hint** and says so. There is no floor above yet —
 * that is programme G — so the rectangle is recorded and drawn on the plan, and
 * nothing cuts anything.
 */

const props = defineProps({
	item: {type: Object, required: true},
});

const emit = defineEmits(['changed']);

const {unit} = useDisplayUnit();

const shape = ref(STAIR_STRAIGHT);
const treads = ref(0);
const rise = ref(0);
const going = ref(0);
const width = ref(0);
const handrail = ref(HANDRAIL_NONE);
const turn = ref(TURN_RIGHT);
const height = ref(0);
const run = ref(0);
const fromTread = ref(0);

const turns = computed(() => shape.value !== STAIR_STRAIGHT);

const SHAPES = [
	{value: STAIR_STRAIGHT, label: 'Straight'},
	{value: STAIR_L, label: 'Quarter'},
	{value: STAIR_U, label: 'Half'},
];

const RAILS = [
	{value: HANDRAIL_NONE, label: 'None'},
	{value: HANDRAIL_LEFT, label: 'Left'},
	{value: HANDRAIL_RIGHT, label: 'Right'},
	{value: HANDRAIL_BOTH, label: 'Both'},
];

function readBack()
{
	var stair = props.item.stair;
	var metrics = props.item.metrics();
	shape.value = stair.shape;
	treads.value = stair.treads;
	rise.value = Dimensioning.cmToMeasureRaw(stair.rise);
	going.value = Dimensioning.cmToMeasureRaw(stair.going);
	width.value = Dimensioning.cmToMeasureRaw(stair.width);
	handrail.value = stair.handrail;
	turn.value = stair.turn;
	height.value = metrics.height;
	run.value = metrics.run;
	fromTread.value = props.item.stairwell().fromTread;
}

/**
 * Read-after-write, as everywhere in this directory: `normaliseStair` rounds a
 * tread count and clamps a going to its bounds, so the field must show what the
 * item took rather than what it was handed.
 */
function apply(changes)
{
	props.item.setStair(changes);
	readBack();
	emit('changed');
}

/** A length as the display unit writes it, for the derived totals. */
function measure(cm)
{
	return Dimensioning.cmToMeasure(cm);
}

watch(() => props.item, readBack, {immediate: true});
watch(unit, readBack);
</script>

<template>
	<section class="inspector-section">
		<h2 class="inspector-heading">Stairs</h2>

		<div class="field">
			<span class="field-label">Shape</span>
			<div class="segmented">
				<button
					v-for="entry in SHAPES" :key="entry.value"
					type="button" class="segment" :class="{'is-active': shape === entry.value}"
					:aria-pressed="shape === entry.value" @click="apply({shape: entry.value})">
					{{ entry.label }}
				</button>
			</div>
		</div>

		<div v-if="turns" class="field">
			<span class="field-label">Turn</span>
			<div class="segmented">
				<button
					type="button" class="segment" :class="{'is-active': turn === TURN_LEFT}"
					:aria-pressed="turn === TURN_LEFT" @click="apply({turn: TURN_LEFT})">
					Left
				</button>
				<button
					type="button" class="segment" :class="{'is-active': turn === TURN_RIGHT}"
					:aria-pressed="turn === TURN_RIGHT" @click="apply({turn: TURN_RIGHT})">
					Right
				</button>
			</div>
		</div>

		<NumberField
			label="Treads" unit="steps" :min="2" :max="40" :step="1"
			:model-value="treads" @update:model-value="apply({treads: $event})" />
		<NumberField
			label="Rise" :unit="unit" :min="0" :step="0.005"
			:model-value="rise" @update:model-value="apply({rise: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			label="Going" :unit="unit" :min="0" :step="0.005"
			:model-value="going" @update:model-value="apply({going: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			label="Width" :unit="unit" :min="0" :step="0.01"
			:model-value="width" @update:model-value="apply({width: Dimensioning.cmFromMeasureRaw($event)})" />

		<div class="field">
			<span class="field-label">Handrail</span>
			<div class="segmented">
				<button
					v-for="entry in RAILS" :key="entry.value"
					type="button" class="segment" :class="{'is-active': handrail === entry.value}"
					:aria-pressed="handrail === entry.value" @click="apply({handrail: entry.value})">
					{{ entry.label }}
				</button>
			</div>
		</div>

		<p class="inspector-readout">
			Climbs <strong class="num">{{ measure(height) }}</strong> over
			<strong class="num">{{ measure(run) }}</strong><br>
			<span class="text-ink-faint">{{ treads }} &times; rise, {{ treads }} &times; going</span>
		</p>

		<p class="inspector-note">
			The height and the plan length are the tread count times the rise and the
			going &mdash; there is nothing else to set them. A floor above would have to
			open from tread {{ fromTread }} upward; that rectangle is drawn on the plan
			as a hint and nothing is cut yet.
		</p>
	</section>
</template>
