<script setup>
// @ts-check
import {computed, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import {
	Dimensioning, STRUCTURE_COLUMN, STRUCTURE_BEAM, SECTION_RECTANGULAR, SECTION_ROUND,
} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * A column or a beam, as the numbers it is (RM-008 F2).
 *
 * **The fields are named for the member, not for the axis.** A column has a
 * height and a beam has a span, and they are the same field — `length`, along
 * whichever way the member runs. Calling both of them &ldquo;length&rdquo;
 * would be honest about the data model and useless to somebody placing a beam,
 * so the label follows the kind. Depth does the same thing in reverse: it is
 * the second cross-section dimension either way, and for a beam that dimension
 * is the vertical one — which is exactly what a beam's depth means on a
 * structural drawing.
 *
 * A round column has one cross-section dimension, so the second field goes away
 * rather than being shown greyed: `normaliseStructure` forces the depth to the
 * width, and a field that cannot disagree with another field should not be on
 * screen next to it.
 */

const props = defineProps({
	item: {type: Object, required: true},
});

const emit = defineEmits(['changed']);

const {unit} = useDisplayUnit();

const kind = ref(STRUCTURE_COLUMN);
const section = ref(SECTION_RECTANGULAR);
const width = ref(0);
const depth = ref(0);
const length = ref(0);
const soffit = ref(0);
const top = ref(0);

const isColumn = computed(() => kind.value === STRUCTURE_COLUMN);
const isRound = computed(() => section.value === SECTION_ROUND);
const heading = computed(() => (isColumn.value ? 'Column' : 'Beam'));
const widthLabel = computed(() => (isRound.value ? 'Diameter' : 'Width'));
const lengthLabel = computed(() => (isColumn.value ? 'Height' : 'Span'));
const soffitLabel = computed(() => (isColumn.value ? 'Base' : 'Soffit'));

function readBack()
{
	var structure = props.item.structure;
	kind.value = structure.kind;
	section.value = structure.section;
	width.value = Dimensioning.cmToMeasureRaw(structure.width);
	depth.value = Dimensioning.cmToMeasureRaw(structure.depth);
	length.value = Dimensioning.cmToMeasureRaw(structure.length);
	soffit.value = Dimensioning.cmToMeasureRaw(structure.soffit);
	top.value = structure.soffit + (structure.kind === STRUCTURE_COLUMN ? structure.length : structure.depth);
}

/**
 * Read-after-write, as everywhere in this directory: `normaliseStructure`
 * clamps a width past 500 and forces a round column's depth to its width, so
 * the fields must show what the item took.
 */
function apply(changes)
{
	props.item.setStructure(changes);
	readBack();
	emit('changed');
}

/** A length as the display unit writes it, for the derived total. */
function measure(cm)
{
	return Dimensioning.cmToMeasure(cm);
}

watch(() => props.item, readBack, {immediate: true});
watch(unit, readBack);
</script>

<template>
	<section class="inspector-section">
		<h2 class="inspector-heading">{{ heading }}</h2>

		<div class="field">
			<span class="field-label">Member</span>
			<div class="segmented">
				<button
					type="button" class="segment" :class="{'is-active': isColumn}"
					:aria-pressed="isColumn" @click="apply({kind: STRUCTURE_COLUMN})">
					Column
				</button>
				<button
					type="button" class="segment" :class="{'is-active': !isColumn}"
					:aria-pressed="!isColumn" @click="apply({kind: STRUCTURE_BEAM})">
					Beam
				</button>
			</div>
		</div>

		<div v-if="isColumn" class="field">
			<span class="field-label">Section</span>
			<div class="segmented">
				<button
					type="button" class="segment" :class="{'is-active': !isRound}"
					:aria-pressed="!isRound" @click="apply({section: SECTION_RECTANGULAR})">
					Rectangular
				</button>
				<button
					type="button" class="segment" :class="{'is-active': isRound}"
					:aria-pressed="isRound" @click="apply({section: SECTION_ROUND})">
					Round
				</button>
			</div>
		</div>

		<NumberField
			:label="widthLabel" :unit="unit" :min="0" :step="0.01"
			:model-value="width" @update:model-value="apply({width: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			v-if="!isRound"
			label="Depth" :unit="unit" :min="0" :step="0.01"
			:model-value="depth" @update:model-value="apply({depth: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			:label="lengthLabel" :unit="unit" :min="0" :step="0.01"
			:model-value="length" @update:model-value="apply({length: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			:label="soffitLabel" :unit="unit" :min="0" :step="0.01"
			:model-value="soffit" @update:model-value="apply({soffit: Dimensioning.cmFromMeasureRaw($event)})" />

		<p class="inspector-readout">
			Top at <strong class="num">{{ measure(top) }}</strong> above the floor
		</p>

		<p class="inspector-note">
			{{ isColumn
				? 'A column is drawn solid on the plan: the plan’s section cuts through it.'
				: 'A beam is drawn dashed on the plan, because it is above the section rather than cut by it. Its depth is its vertical dimension.' }}
		</p>
	</section>
</template>
