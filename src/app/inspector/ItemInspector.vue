<script setup>
// @ts-check
import {onBeforeUnmount, reactive, ref, watch} from 'vue';
import NumberField from './fields/NumberField.vue';
import CheckField from './fields/CheckField.vue';
import ColorField from './fields/ColorField.vue';
import {Trash2, Copy} from '@lucide/vue';
import {Dimensioning} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';

/**
 * The selected item: size, proportional coupling, lock, colours, delete.
 *
 * Sprint S7, and the one panel with a regression test attached to it by name.
 * Its dat.GUI ancestor was built against a constructor that never took the
 * item, with the binding line commented out beneath the call - so `currentItem`
 * stayed null, the panel showed a 10x10x10 placeholder, and every control it
 * offered was inert. S6 bound the item; this is the native version of the same
 * panel, and `tests/app-shell.test.js` pins that editing a field reaches the
 * item that is actually selected.
 */

const props = defineProps({
	item: {type: Object, required: true},
});

// Resizes and colour changes reach the design without touching the floorplan
// graph, so nothing the library dispatches would tell the history stack about
// them. See the note in InspectorPanel.
const emit = defineEmits(['changed', 'duplicate']);

const {unit} = useDisplayUnit();

const name = ref('');
const dimensions = reactive({width: 0, height: 0, depth: 0});
const flags = reactive({proportional: false, fixed: false});
// `ref([])` infers `Ref<never[]>`, so filling it is an error and reading from
// it is an error on `never` - one omission producing four (RM-004 B3).
/** @type {import('vue').Ref<Array<{index: number, label: string, color: string}>>} */
const materials = ref([]);

function readBack()
{
	name.value = props.item.metadata.itemName;
	dimensions.width = Dimensioning.cmToMeasureRaw(props.item.getWidth());
	dimensions.height = Dimensioning.cmToMeasureRaw(props.item.getHeight());
	dimensions.depth = Dimensioning.cmToMeasureRaw(props.item.getDepth());
	flags.proportional = props.item.getProportionalResize();
	flags.fixed = props.item.fixed;
}

/**
 * An item's `material` is a single material or an array of them, depending on
 * how the glTF was authored. Read once per selection: the list cannot change
 * while an item stays selected.
 */
function readMaterials()
{
	var list = Array.isArray(props.item.material) ? props.item.material : [props.item.material];
	materials.value = list.map((material, index) => ({
		index,
		label: material.name || `Material ${index + 1}`,
		color: `#${material.color.getHexString()}`,
	}));
}

/**
 * Resize, then read all three back.
 *
 * `Item.resize` may not do what it was asked: with proportional resize on it
 * scales the other two axes to match, and it ignores changes under 0.1cm. So
 * the panel writes its three numbers and then re-reads them from the item,
 * rather than assuming the edit took.
 */
function resize(axis, next)
{
	dimensions[axis] = next;
	props.item.resize(
		Dimensioning.cmFromMeasureRaw(dimensions.height),
		Dimensioning.cmFromMeasureRaw(dimensions.width),
		Dimensioning.cmFromMeasureRaw(dimensions.depth));
	readBack();
	emit('changed');
}

function setProportional(next)
{
	flags.proportional = next;
	props.item.setProportionalResize(next);
}

function setFixed(next)
{
	flags.fixed = next;
	props.item.setFixed(next);
}

function setColor(entry, hex)
{
	props.item.setMaterialColor(hex, entry.index);
	entry.color = hex;
	emit('changed');
}

function remove()
{
	// Removing dispatches EVENT_ITEM_REMOVED, the controller drops the selection,
	// and this component unmounts. Nothing to clean up here - and no `changed`
	// either, because that event IS what the history stack listens to.
	props.item.remove();
}

watch(() => props.item, () => {readBack(); readMaterials();}, {immediate: true});
watch(unit, readBack);
onBeforeUnmount(() => {materials.value = [];});
</script>

<template>
	<section class="inspector-section">
		<h3 class="inspector-heading">{{ name }}</h3>

		<NumberField
			label="Width" :unit="unit" :min="0.1" :step="0.1" :model-value="dimensions.width"
			@update:model-value="resize('width', $event)" />
		<NumberField
			label="Height" :unit="unit" :min="0.1" :step="0.1" :model-value="dimensions.height"
			@update:model-value="resize('height', $event)" />
		<NumberField
			label="Depth" :unit="unit" :min="0.1" :step="0.1" :model-value="dimensions.depth"
			@update:model-value="resize('depth', $event)" />

		<CheckField
			label="Keep proportions" :model-value="flags.proportional"
			@update:model-value="setProportional" />
		<CheckField
			label="Lock in place" :model-value="flags.fixed"
			@update:model-value="setFixed" />

		<template v-if="materials.length">
			<h4 class="inspector-subheading">Materials</h4>
			<ColorField
				v-for="entry in materials" :key="entry.index"
				:label="entry.label" :model-value="entry.color"
				@update:model-value="setColor(entry, $event)" />
		</template>

		<div class="mt-2 flex gap-1.5">
			<button type="button" class="btn btn-outline flex-1" @click="emit('duplicate')">
				<Copy :size="14" /> Duplicate
			</button>
			<button type="button" class="btn btn-outline btn-danger flex-1" @click="remove">
				<Trash2 :size="14" /> Delete
			</button>
		</div>
	</section>
</template>
