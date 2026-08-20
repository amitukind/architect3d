<script setup>
// @ts-check
import {computed, onScopeDispose, reactive, ref, watch} from 'vue';
import CollapsibleGroup from './CollapsibleGroup.vue';
import {useWalkthrough} from '../composables/useWalkthrough.js';
import CarbonSheetPanel from './CarbonSheetPanel.vue';
import NumberField from './fields/NumberField.vue';
import CheckField from './fields/CheckField.vue';
import RangeField from './fields/RangeField.vue';
import TextField from './fields/TextField.vue';
import {Configuration, Dimensioning, wallInformation} from '../../scripts/blueprint.js';
import {snapTolerance, gridSpacing} from '../../scripts/blueprint.js';
import {EVENT_ANNOTATIONS_CHANGED, EVENT_LEVELS_CHANGED} from '../../scripts/blueprint.js';
import {ROOF_FLAT, ROOF_GABLE, ROOF_HIP, RIDGE_X, RIDGE_Z, MAX_PITCH} from '../../scripts/blueprint.js';
import {SUN_DEFAULTS, solarPosition} from '../../scripts/blueprint.js';
import {useDisplayUnit} from '../composables/useDisplayUnit.js';
import {onConfigChange, useBooleanConfig} from '../composables/useConfiguration.js';
import {t} from '../i18n/i18n.js';
import {useI18n} from '../composables/useI18n.js';

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
	store: {
		/**
		 * `type: Object` alone is `Record<string, any>`, which is not the store -
		 * so passing it to a composable that wants one is an error, and every
		 * property read off it is unchecked (RM-004 B3).
		 *
		 * @type {import('vue').PropType<import('../composables/useBlueprint.js').BlueprintStore>}
		 */
		type: Object,
		required: true,
	},
	camera: {type: Object, required: true},
});

const {unit, units, setUnit} = useDisplayUnit(props.store);
const i18n = useI18n();

/**
 * Eye height (RM-011 H3). Shared module state, so this control and the viewer
 * cannot hold different ideas of how tall the walker is.
 */
const {eyeHeight, setEyeHeight, bounds: EYE} = useWalkthrough(props.store);

const floorplanner = computed(() => props.store.floorplanner.value);

/**
 * Which way is north, in degrees clockwise from up (RM-008 E3).
 *
 * A property of the building rather than a preference, so it is saved with the
 * design - but it is edited here, beside the other things that describe the
 * whole drawing rather than one selected thing, because there is nothing to
 * select. A ref mirroring the library for the reason this whole panel was
 * rebuilt in RM-002 R-03: nothing in `src/scripts` is reactive, so a template
 * bound straight to `floorplan.north` renders once and then sits there.
 */
const north = ref(0);

/**
 * The building's roof (RM-010 G2).
 *
 * A design-level thing rather than a selection, so it belongs here beside north
 * and the wall measurements rather than in a panel that appears when something
 * is clicked. There was no roof in this application before G2 — RM-010 V-1
 * measured that `roofPlanes()` returns a *ceiling* per room — so "None" is the
 * default and every design written before it has one.
 *
 * Mirrored into a ref for the reason the whole of this panel is: `Model` is not
 * reactive, so a template bound straight to `model.roof` renders once and then
 * sits there.
 */
const ROOF_KINDS_UI = [
	// `''` rather than `null` for "no roof": a `v-for` key has to be a
	// PropertyKey, and the one place the distinction matters is `setRoof`, which
	// reads an empty kind as a removal.
	{value: '', label: 'None'},
	{value: ROOF_FLAT, label: 'Flat'},
	{value: ROOF_GABLE, label: 'Gable'},
	{value: ROOF_HIP, label: 'Hip'},
];

const roof = ref({kind: '', pitch: 30, overhang: 40, ridge: RIDGE_X});

const roofNote = computed(() => (roof.value.kind
	? 'Over the plan\u2019s bounding rectangle plus the overhang, standing on the top storey\u2019s walls. A ceiling is still drawn inside each room \u2014 a ceiling and a roof are different things.'
	: 'This design has no roof. Ceilings are drawn inside each room either way.'));

function readRoof()
{
	const model = props.store.model.value;
	const current = model && model.roof;
	roof.value = current
		? {kind: current.kind, pitch: current.pitch, overhang: current.overhang, ridge: current.ridge}
		: {kind: '', pitch: 30, overhang: 40, ridge: RIDGE_X};
}

/**
 * Read-after-write, as everywhere in this directory: `normaliseRoof` clamps a
 * pitch past 60 and reads an unknown kind as the default.
 *
 * @param {?Object} changes Null removes the roof.
 */
function setRoof(changes)
{
	const model = props.store.model.value;
	if (!model)
	{
		return;
	}
	model.setRoof((changes && changes.kind === '') ? null : changes);
	readRoof();
}
let attachedPlan = null;

function readNorth()
{
	north.value = attachedPlan ? attachedPlan.north : 0;
}

/**
 * North for the whole building, not for the storey being edited (RM-011 W-10).
 *
 * `north` has lived on `Floorplan` since E3 and still does - it is what
 * `drawNorthArrow` reads and what each sheet draws. What changed in H2 is that
 * writing it goes through `Model`, which writes every storey: since G1 a design
 * is a list of plans, so a per-plan setter let a three-storey house hold three
 * different bearings, and H2's sun needs one answer.
 */
function setNorth(next)
{
	const model = props.store.model.value;
	if (model)
	{
		model.north = next;
		// Read-after-write: the setter normalises into [0, 360), so 450 comes back
		// as 90 and the field has to show what the plan took.
		readNorth();
		readSun();
	}
}

/* ---- the sun (RM-011 H2) ---------------------------------------------- */

/**
 * A sun, or none, mirrored out of `Model` for the same reason the roof is.
 *
 * `on` is not a field of the description - `Model.sun` being null is what "no
 * sun" means, exactly as with the roof - so it is derived here for a checkbox to
 * bind to and never written to a file.
 */
const sun = ref({on: false, ...SUN_DEFAULTS});

/** Day 1 as a date, so a day number can be shown as something readable. */
const DAY_ONE = Date.UTC(2001, 0, 1);

/** `dayOfYear` as a date a person recognises. 2001 because it is not a leap year. */
function dayLabel(dayOfYear)
{
	const date = new Date(DAY_ONE + (dayOfYear - 1) * 86400000);
	return date.toLocaleDateString(undefined, {day: 'numeric', month: 'long', timeZone: 'UTC'});
}

/** `12.5` as `12:30`, because an hour with a decimal point in it is a number, not a time. */
function hourLabel(hour)
{
	const minutes = Math.round(hour * 60);
	return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Where the sun is, in words.
 *
 * The point of the whole feature: a number for the hour means nothing until the
 * view shows what it does. Below the horizon is said plainly rather than shown
 * as a negative elevation nobody reads as "it is dark".
 */
const sunNote = computed(() =>
{
	if (!sun.value.on)
	{
		return 'No sun. The key light sits where the render profile puts it, which is what every design did before this and what the classic profile keeps doing.';
	}
	const where = solarPosition(sun.value);
	const compass = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
	const heading = compass[Math.round(where.azimuth / 45) % 8];
	if (!where.up)
	{
		return `${hourLabel(sun.value.hour)} on ${dayLabel(sun.value.dayOfYear)}: the sun is ${Math.abs(where.elevation).toFixed(0)}° below the horizon. The key light is off and the sky carries the room.`;
	}
	return `${hourLabel(sun.value.hour)} on ${dayLabel(sun.value.dayOfYear)}: ${where.elevation.toFixed(0)}° above the horizon, in the ${heading}. Only the studio profile is lit, so only studio shows it.`;
});

function readSun()
{
	const model = props.store.model.value;
	const current = model && model.sun;
	sun.value = current ? {on: true, ...current} : {on: false, ...SUN_DEFAULTS};
}

/**
 * @param {?Object} changes Null removes the sun; `{}` gives it the defaults.
 */
function setSun(changes)
{
	const model = props.store.model.value;
	if (!model)
	{
		return;
	}
	model.setSun(changes);
	// Read-after-write: `normaliseSun` clamps a latitude past the pole and wraps
	// an hour past midnight, so the fields have to show what the model took.
	readSun();
}

var attachedModel = null;

watch(() => props.store.model.value, function (model)
{
	if (attachedPlan)
	{
		attachedPlan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, readNorth);
		attachedPlan = null;
	}
	if (attachedModel)
	{
		attachedModel.removeEventListener(EVENT_LEVELS_CHANGED, readRoof);
		attachedModel.removeEventListener(EVENT_LEVELS_CHANGED, readSun);
	}
	attachedModel = model || null;
	attachedPlan = model ? model.floorplan : null;
	if (attachedPlan)
	{
		// North also changes by opening a file and by undo, neither of which comes
		// through this panel.
		attachedPlan.addEventListener(EVENT_ANNOTATIONS_CHANGED, readNorth);
	}
	if (attachedModel)
	{
		// The roof changes on a load and an undo too, and on the same event a level
		// change uses - `Model.setRoof` dispatches it, because what a view has to
		// do about either is the same thing.
		attachedModel.addEventListener(EVENT_LEVELS_CHANGED, readRoof);
		attachedModel.addEventListener(EVENT_LEVELS_CHANGED, readSun);
	}
	readNorth();
	readRoof();
	readSun();
}, {immediate: true});

onScopeDispose(function ()
{
	if (attachedModel)
	{
		attachedModel.removeEventListener(EVENT_LEVELS_CHANGED, readRoof);
		attachedModel = null;
	}
	if (attachedPlan)
	{
		attachedPlan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, readNorth);
		attachedPlan = null;
	}
});
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

/**
 * The collision warning, and the flag RM-007 required for it (RM-012 J4).
 *
 * Off by default and offered here rather than on the toolbar, because it is not
 * a mode somebody switches between while working - it is a decision about
 * whether this application tells you your sofa is inside your table. It is also
 * the first thing in nine programmes to make a *correct* polygon predicate
 * observable, the four broken ones in `core/utils.js` being untouched, so
 * whether anybody sees that consequence should be something they turned on.
 *
 * A warning and never a refusal: `FloorItem.isValidPosition` says in its own
 * comment that placement is up to the user, and eight programmes of saved
 * designs were made under that rule.
 */
const collisionEnabled = useBooleanConfig('collisionWarnings');
const showCollisions = computed({
	get: () => collisionEnabled.value,
	set: (next) => {Configuration.setValue('collisionWarnings', next);},
});

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
		<CollapsibleGroup :title="t('Language')" :open="true">
			<div class="radio-list" role="radiogroup" :aria-label="t('Language')">
				<label v-for="entry in i18n.locales" :key="entry.id" class="radio-row">
					<input
						type="radio" name="app-locale" :value="entry.id" :disabled="i18n.busy.value"
						:checked="i18n.locale.value === entry.id" @change="i18n.choose(entry.id)">
					<!-- In the language itself, because that is what somebody looking
					     for it can read. -->
					<span>{{ entry.label }}</span>
					<code class="radio-suffix">{{ entry.id }}</code>
				</label>
			</div>
			<p class="px-1 pt-1 text-[11px] leading-relaxed text-ink-faint">
				{{ t('A language is downloaded when you choose it, so English costs nothing to anybody who does not need another one.') }}
			</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Units')" :open="true">
			<div class="radio-list" role="radiogroup" :aria-label="t('Display unit')">
				<label v-for="entry in units" :key="entry.value" class="radio-row">
					<input
						type="radio" name="display-unit" :value="entry.value"
						:checked="unit === entry.value" @change="setUnit(entry.value)">
					<span>{{ entry.label }}</span>
					<code class="radio-suffix">{{ entry.value }}</code>
				</label>
			</div>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('2D editor')" :open="true">
			<CheckField v-model="snapToGrid" label="Snap to grid" />
			<NumberField
				label="Snap every" :unit="unit" :min="0" :step="0.1" :model-value="editor2d.snap"
				@update:model-value="setSnap" />
			<NumberField
				label="Grid resolution" :unit="unit" :min="0" :step="0.1" :model-value="editor2d.grid"
				@update:model-value="setGrid" />
			<CheckField v-model="showCollisions" label="Warn when furniture overlaps" />
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Plan')">
			<NumberField
				label="North" unit="°" :min="0" :max="360" :step="1"
				:model-value="north" @update:model-value="setNorth" />
			<button type="button" class="btn btn-block" @click="setNorth(0)">{{ t('Point north up') }}</button>
			<p class="inspector-note">
				{{ t('Drawn in the top right of the plan, and saved with the design.') }}
			</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Sun')">
			<CheckField
				label="Light the design by the sun" :model-value="sun.on"
				@update:model-value="setSun($event ? {} : null)" />
			<template v-if="sun.on">
				<RangeField
					label="Time" :min="0" :max="24" :step="0.25" :model-value="sun.hour"
					@update:model-value="setSun({hour: $event})" />
				<RangeField
					label="Day of year" :min="1" :max="365" :step="1" :model-value="sun.dayOfYear"
					@update:model-value="setSun({dayOfYear: $event})" />
				<RangeField
					label="Latitude" unit="°" :min="-90" :max="90" :step="1" :model-value="sun.latitude"
					@update:model-value="setSun({latitude: $event})" />
			</template>
			<p class="inspector-note">{{ sunNote }}</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Walkthrough')">
			<RangeField
				label="Eye height" unit="cm" :min="EYE.min" :max="EYE.max" :step="1"
				:model-value="eyeHeight" @update:model-value="setEyeHeight($event)" />
			<p class="inspector-note">
				{{ t('How tall the person walking is. Kept in this browser rather than in the design — it describes whoever is looking, not the building. In the walkthrough, click the floor to go there.') }}
			</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Roof')">
			<div class="field">
				<span class="field-label">{{ t('Kind') }}</span>
				<div class="segmented">
					<button
						v-for="entry in ROOF_KINDS_UI" :key="entry.value"
						type="button" class="segment" :class="{'is-active': roof.kind === entry.value}"
						:aria-pressed="roof.kind === entry.value" @click="setRoof({kind: entry.value})">
						{{ entry.label }}
					</button>
				</div>
			</div>

			<template v-if="roof.kind">
				<template v-if="roof.kind !== ROOF_FLAT">
					<div class="field">
						<span class="field-label">{{ t('Ridge') }}</span>
						<div class="segmented">
							<button
								type="button" class="segment" :class="{'is-active': roof.ridge === RIDGE_X}"
								:aria-pressed="roof.ridge === RIDGE_X" @click="setRoof({ridge: RIDGE_X})">
								{{ t('Across') }}
							</button>
							<button
								type="button" class="segment" :class="{'is-active': roof.ridge === RIDGE_Z}"
								:aria-pressed="roof.ridge === RIDGE_Z" @click="setRoof({ridge: RIDGE_Z})">
								{{ t('Along') }}
							</button>
						</div>
					</div>
					<RangeField
						label="Pitch" :min="0" :max="MAX_PITCH" :step="5"
						:model-value="roof.pitch" @update:model-value="setRoof({pitch: $event})" />
				</template>
				<NumberField
					label="Overhang" :unit="unit" :min="0" :step="0.01"
					:model-value="Dimensioning.cmToMeasureRaw(roof.overhang)"
					@update:model-value="setRoof({overhang: Dimensioning.cmFromMeasureRaw($event)})" />
			</template>

			<p class="inspector-note">{{ roofNote }}</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Wall measurements')">
			<CheckField
				v-for="flag in WALL_FLAGS" :key="flag.property"
				:label="flag.label" :model-value="wallInformation[flag.property]"
				@update:model-value="setWallInfo(flag.property, $event)" />
			<TextField
				v-for="entry in WALL_LABELS" :key="entry.property"
				:label="entry.label" :model-value="wallInformation[entry.property]"
				@update:model-value="setWallInfo(entry.property, $event)" />
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('Carbon sheet')">
			<CarbonSheetPanel v-if="carbonSheet" :carbon-sheet="carbonSheet" />
			<p v-else class="inspector-note">{{ t('No 2D view, so no carbon sheet.') }}</p>
		</CollapsibleGroup>

		<CollapsibleGroup :title="t('3D camera')">
			<RangeField
				label="Clip near" :min="-1" :max="1" :step="0.01" :model-value="clipping.near"
				@update:model-value="setClipping('near', $event)" />
			<RangeField
				label="Clip far" :min="-1" :max="1" :step="0.01" :model-value="clipping.far"
				@update:model-value="setClipping('far', $event)" />
			<CheckField
				label="Lock view" :model-value="props.camera.viewLocked.value"
				@update:model-value="props.camera.setViewLocked($event)" />
			<button type="button" class="btn btn-block" @click="resetClipping">{{ t('Reset clipping') }}</button>
		</CollapsibleGroup>
	</div>
</template>
