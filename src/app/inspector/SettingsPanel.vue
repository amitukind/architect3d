<script setup>
import {computed, reactive, watch} from 'vue';
import CollapsibleGroup from './CollapsibleGroup.vue';
import CarbonSheetPanel from './CarbonSheetPanel.vue';
import NumberField from './fields/NumberField.vue';
import CheckField from './fields/CheckField.vue';
import RangeField from './fields/RangeField.vue';
import TextField from './fields/TextField.vue';
import {Configuration, Dimensioning, wallInformation} from '../../scripts/blueprint.js';
import {snapTolerance, gridSpacing} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';
import {onConfigChange, useBooleanConfig} from '../composables/useConfiguration.js';

/**
 * Everything that is not about the current selection.
 *
 * Sprint S7, replacing the dat.GUI "Interface & Configuration" folder and the
 * interim lil-gui port of it. Same settings, same order, same defaults; what
 * changes is that the unit buttons are a radio group rather than five
 * checkboxes pretending to be one, and that nothing has to be rebuilt when the
 * unit changes - the captions are bindings now, not folder names.
 *
 * The zoom slider that used to sit at the bottom of the 2D editor group is
 * gone, and stays gone. Zoom has a control on the plan itself - a readout,
 * stops, fit and recentre, a wheel gesture and a keyboard shortcut - so a
 * second one buried here would be redundant even now that it could be made to
 * work. It could not before: it read `Number(config.scale)` from a plain object
 * nothing makes reactive, so it rendered 1 once and then sat there saying 1
 * while the plan was at 300%.
 *
 * ## The staleness it was one case of
 *
 * The same bug applied to every control here that mirrors configuration, and
 * those are not redundant. Snap-to-grid, snap distance and grid resolution are
 * all writable from the plan overlay as well as from this panel, and this panel
 * read them once: change the grid density on the plan, open Settings, and it
 * showed the old number.
 *
 * RM-002 R-03 gave Configuration an event, and useConfiguration turns it into
 * refs. These controls now follow the library rather than their own first
 * reading of it.
 */

const props = defineProps({
	store: {type: Object, required: true},
	camera: {type: Object, required: true},
});

const {unit, units, setUnit} = useDisplayUnit(props.store);

const floorplanner = computed(() => props.store.floorplanner.value);
const carbonSheet = computed(() => (floorplanner.value ? floorplanner.value.carbonSheet : null));

function redraw()
{
	if (floorplanner.value)
	{
		floorplanner.value.redraw();
	}
}

// ---- 2D editor ------------------------------------------------------------
//
// snapTolerance and gridSpacing are stored in centimetres and shown converted,
// which is why they are mirrored rather than bound straight to `config`.
const editor2d = reactive({snap: 0, grid: 0});

function read2d()
{
	editor2d.snap = Dimensioning.cmToMeasureRaw(Configuration.getNumericValue(snapTolerance));
	editor2d.grid = Dimensioning.cmToMeasureRaw(Configuration.getNumericValue(gridSpacing));
}
read2d();
// Two reasons these need re-reading: the unit changed, so the same centimetres
// display differently; or the library's value changed, possibly from the plan
// overlay rather than from here.
watch(unit, read2d);
onConfigChange(read2d);

const snapEnabled = useBooleanConfig('snapToGrid');
const snapToGrid = computed({
	get: () => snapEnabled.value,
	set: (next) => {Configuration.setValue('snapToGrid', next);},
});

function setSnap(next)
{
	Configuration.setValue(snapTolerance, Dimensioning.cmFromMeasureRaw(next));
}

function setGrid(next)
{
	Configuration.setValue(gridSpacing, Dimensioning.cmFromMeasureRaw(next));
	redraw();
}

// ---- Wall measurements ----------------------------------------------------
const WALL_FLAGS = [
	{property: 'exterior', label: 'Exterior'},
	{property: 'interior', label: 'Interior'},
	{property: 'midline', label: 'Midline'},
	{property: 'labels', label: 'Labels'},
];

const WALL_LABELS = [
	{property: 'exteriorlabel', label: 'Exterior prefix'},
	{property: 'interiorlabel', label: 'Interior prefix'},
	{property: 'midlinelabel', label: 'Midline prefix'},
];

function setWallInfo(property, next)
{
	wallInformation[property] = next;
	redraw();
}

// ---- 3D camera limits -----------------------------------------------------
const clipping = reactive({near: 1, far: 1});

function setClipping(key, next)
{
	clipping[key] = next;
	props.camera.setClipping(clipping.near, clipping.far);
}

function resetClipping()
{
	clipping.near = 1;
	clipping.far = 1;
	props.camera.resetClipping();
}
</script>

<template>
	<div class="settings">
		<CollapsibleGroup title="Units" :open="true">
			<div class="radio-list" role="radiogroup" aria-label="Display unit">
				<label v-for="entry in units" :key="entry.value" class="radio-row">
					<input
						type="radio" name="display-unit" :value="entry.value"
						:checked="unit === entry.value" @change="setUnit(entry.value)">
					<span>{{ entry.label }}</span>
					<code class="radio-suffix">{{ entry.value }}</code>
				</label>
			</div>
		</CollapsibleGroup>

		<CollapsibleGroup title="2D editor" :open="true">
			<CheckField v-model="snapToGrid" label="Snap to grid" />
			<NumberField
				label="Snap every" :unit="unit" :min="0" :step="0.1" :model-value="editor2d.snap"
				@update:model-value="setSnap" />
			<NumberField
				label="Grid resolution" :unit="unit" :min="0" :step="0.1" :model-value="editor2d.grid"
				@update:model-value="setGrid" />
		</CollapsibleGroup>

		<CollapsibleGroup title="Wall measurements">
			<CheckField
				v-for="flag in WALL_FLAGS" :key="flag.property"
				:label="flag.label" :model-value="wallInformation[flag.property]"
				@update:model-value="setWallInfo(flag.property, $event)" />
			<TextField
				v-for="entry in WALL_LABELS" :key="entry.property"
				:label="entry.label" :model-value="wallInformation[entry.property]"
				@update:model-value="setWallInfo(entry.property, $event)" />
		</CollapsibleGroup>

		<CollapsibleGroup title="Carbon sheet">
			<CarbonSheetPanel v-if="carbonSheet" :carbon-sheet="carbonSheet" />
			<p v-else class="inspector-note">No 2D view, so no carbon sheet.</p>
		</CollapsibleGroup>

		<CollapsibleGroup title="3D camera">
			<RangeField
				label="Clip near" :min="-1" :max="1" :step="0.01" :model-value="clipping.near"
				@update:model-value="setClipping('near', $event)" />
			<RangeField
				label="Clip far" :min="-1" :max="1" :step="0.01" :model-value="clipping.far"
				@update:model-value="setClipping('far', $event)" />
			<CheckField
				label="Lock view" :model-value="props.camera.viewLocked.value"
				@update:model-value="props.camera.setViewLocked($event)" />
			<button type="button" class="btn btn-block" @click="resetClipping">Reset clipping</button>
		</CollapsibleGroup>
	</div>
</template>
