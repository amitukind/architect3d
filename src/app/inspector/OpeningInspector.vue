<script setup>
// @ts-check
import {computed, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import RangeField from './fields/RangeField.vue';
import {Dimensioning, OPENING_DOOR, OPENING_WINDOW, HINGE_LEFT, HINGE_RIGHT} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';
import {t} from '../i18n/i18n.js';

/**
 * A door, a window or an archway, as the numbers it is (RM-008 F1).
 *
 * This panel is the answer to RM-009 U-4: before it, the only way to change a
 * door's size was to scale a mesh, and there was no way at all to say which side
 * the hinge is on, because the file had nowhere to put it — `rotation` is one y
 * angle. Every control here writes one number and everything follows from it:
 * the 3D frame is regenerated, the wall re-cuts its hole from the same figures,
 * and the plan draws *this* door's swing instead of the convention it drew for
 * every door until now.
 *
 * Sill is the height of the opening's **bottom** above the floor, which is how
 * a window is specified and how a drawing states it. The centre — which is what
 * the item's position actually needs — is derived from the sill and the height,
 * so the two cannot disagree.
 */

const props = defineProps({
	item: {type: Object, required: true},
});

const emit = defineEmits(['changed']);

const {unit} = useDisplayUnit();

const width = ref(0);
const height = ref(0);
const sill = ref(0);
const hinge = ref(HINGE_LEFT);
const swing = ref(0);
const kind = ref('');

const isDoor = computed(() => kind.value === OPENING_DOOR);
const isWindow = computed(() => kind.value === OPENING_WINDOW);

const heading = computed(() => (isDoor.value ? 'Door' : isWindow.value ? 'Window' : 'Opening'));

function readBack()
{
	var opening = props.item.opening;
	kind.value = opening.kind;
	width.value = Dimensioning.cmToMeasureRaw(opening.width);
	height.value = Dimensioning.cmToMeasureRaw(opening.height);
	sill.value = Dimensioning.cmToMeasureRaw(opening.sill);
	hinge.value = opening.hinge;
	swing.value = opening.swing;
}

/**
 * Read-after-write, as everywhere in this directory: `normaliseOpening` refuses
 * a width of zero and clamps a swing past 180, so the field must show what the
 * item took rather than what it was handed.
 */
function apply(changes)
{
	props.item.setOpening(changes);
	readBack();
	emit('changed');
}

watch(() => props.item, readBack, {immediate: true});
watch(unit, readBack);
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">{{ heading }}</h3>

		<NumberField
			label="Width" :unit="unit" :min="0" :step="0.01"
			:model-value="width" @update:model-value="apply({width: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			label="Height" :unit="unit" :min="0" :step="0.01"
			:model-value="height" @update:model-value="apply({height: Dimensioning.cmFromMeasureRaw($event)})" />
		<NumberField
			label="Sill" :unit="unit" :min="0" :step="0.01"
			:model-value="sill" @update:model-value="apply({sill: Dimensioning.cmFromMeasureRaw($event)})" />

		<template v-if="isDoor">
			<div class="field">
				<span class="field-label">{{ t('Hinge') }}</span>
				<div class="segmented">
					<button
						type="button" class="segment" :class="{'is-active': hinge === HINGE_LEFT}"
						:aria-pressed="hinge === HINGE_LEFT" @click="apply({hinge: HINGE_LEFT})">
						{{ t('Left') }}
					</button>
					<button
						type="button" class="segment" :class="{'is-active': hinge === HINGE_RIGHT}"
						:aria-pressed="hinge === HINGE_RIGHT" @click="apply({hinge: HINGE_RIGHT})">
						{{ t('Right') }}
					</button>
				</div>
			</div>

			<RangeField
				label="Swing" :min="0" :max="180" :step="5"
				:model-value="swing" @update:model-value="apply({swing: $event})" />
		</template>

		<p class="inspector-note">
			Sill is the height of the opening&rsquo;s bottom above the floor. An opening
			taller than its wall is trimmed to fit.
		</p>
	</section>
</template>
