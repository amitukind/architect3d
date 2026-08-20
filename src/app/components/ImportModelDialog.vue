<script setup>
// @ts-check
import {computed, ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {X, Upload, Trash2, Plus, RotateCw} from '@lucide/vue';
import {Dimensioning} from '../../scripts/blueprint.js';
import {t} from '../i18n/i18n.js';

/**
 * Bring your own model (RM-012 J3).
 *
 * ## One dialog, two states, because they are the same subject
 *
 * With nothing picked it is the shelf: what this browser has stored, each row
 * placeable again and removable. With a file picked it is the decision, and the
 * shelf is out of the way. Splitting them would mean a person who imported a
 * chair last week has to remember they did before they can find it, and a
 * second entry point in a toolbar that already has twelve tools.
 *
 * ## The unit question is asked by showing the answer
 *
 * A model file states no unit. glTF's specification says one unit is a metre
 * and the tools that write glTF very often do not, so the honest question is
 * not "what unit is this in" - nobody knows - but "which of these is the right
 * size", and that can only be asked by drawing the numbers. Every control here
 * updates the same line, and that line is in the display unit the rest of the
 * application uses.
 *
 * The longest-side field is the escape hatch beside it, and it is the one that
 * always works: a model authored in whatever the modeller felt like has no unit
 * to name, and everybody knows roughly how long their sofa is.
 *
 * ## The up-axis toggle is not a rotation control
 *
 * It is a change of basis, applied to the geometry before anything measures it,
 * and it is the single thing a saved design could not already express - so it is
 * the one field J3 adds to the save format. Yaw is `rotation`, size is
 * `scale_x/y/z`, and both round-trip today.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	/** The file awaiting a decision, from `useModelImport`. */
	pending: {type: Object, default: null},
	/** Every model this browser has stored. */
	stored: {
		/** @type {import('vue').PropType<Array<import('../persistence/model_repository.js').ModelRecord>>} */
		type: Array,
		default: () => [],
	},
	busy: {type: Boolean, default: false},
	refusal: {
		/** @type {import('vue').PropType<?string>} */
		type: String,
		default: null,
	},
	available: {type: Boolean, default: true},
	accept: {type: String, default: '.glb,.gltf,.obj'},
	limit: {type: Number, default: 33554432},
	units: {
		/** @type {import('vue').PropType<Array<{id: string, label: string, cm: number}>>} */
		type: Array,
		default: () => [],
	},
	/**
	 * What a decision would make the model, in centimetres.
	 *
	 * A function prop rather than arithmetic repeated here, for the reason
	 * `ShareDialog.copy` is one: the answer has to come back, and this one comes
	 * back on every keystroke. The composable owns the sum; this draws it.
	 */
	preview: {
		type: /** @type {import('vue').PropType<function(Object): {scale: number, size: Array<number>}>} */ (Function),
		required: true,
	},
});

const emit = defineEmits(['update:open', 'choose', 'place', 'cancel', 'place-stored', 'forget']);

/** @type {import('vue').Ref<string>} */
const unit = ref('m');
/** @type {import('vue').Ref<string>} */
const up = ref('y');
/** Empty means "use the unit above"; a number overrides it. */
const longest = ref('');

// A new file is a new decision. Anything a previous import chose is a worse
// default than the specification's, except the axis of a file that has been
// imported before - the store already knows which way that one stands up.
watch(() => props.pending, function (next)
{
	unit.value = 'm';
	longest.value = '';
	up.value = (next && next.known && next.known.up) || 'y';
});

const decision = computed(() => ({up: up.value, unit: unit.value, longest: Number(longest.value) || 0}));
const result = computed(() => props.pending ? props.preview(decision.value) : {scale: 0, size: [0, 0, 0]});

/** The measured extent, in the units the file was authored in. */
const authored = computed(function ()
{
	if (!props.pending) { return ''; }
	return props.pending.measured.size.map((value) => round(value)).join(' × ');
});

const placed = computed(() => result.value.size.map((cm) => Dimensioning.cmToMeasure(cm)).join(' × '));

/** @param {number} value */
function round(value)
{
	return Math.round(value * 1000) / 1000;
}

/** @param {number} bytes */
function megabytes(bytes)
{
	return `${(bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1)} MB`;
}

/** @param {Event} event */
function onFile(event)
{
	const input = /** @type {HTMLInputElement} */ (event.target);
	const file = input.files && input.files[0];
	if (file)
	{
		emit('choose', file);
	}
	// Cleared so that picking the same file twice fires a second change event,
	// which is the same reason TopBar's design opener clears its own.
	input.value = '';
}
</script>

<template>
	<DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<DialogOverlay class="a3d-fade fixed inset-0 z-[550] bg-black/50 backdrop-blur-[2px]" />
			<DialogContent
				class="a3d-pop fixed left-1/2 top-1/2 z-[560] flex max-h-[calc(100vh-4rem)] w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface shadow-float focus:outline-none">
				<div class="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
					<div class="min-w-0">
						<DialogTitle class="text-[14px] font-semibold">{{ t('Your own models') }}</DialogTitle>
						<DialogDescription class="text-ink-faint">
							{{ t('A .glb, .gltf or .obj from this computer becomes an item you can place. It is stored in this browser and travels in a .zip bundle, not in a link.') }}
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" :aria-label="t('Close')">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
					<p v-if="!props.available" class="rounded-panel border border-line bg-overlay p-3 text-[12px] text-ink-soft">
						{{ t('This browser cannot store imported models. Private browsing and some embedded browsers withhold the storage this needs; everything else in the application still works.') }}
					</p>

					<!-- The decision. -->
					<template v-else-if="props.pending">
						<div class="rounded-panel border border-line bg-overlay p-3">
							<p class="text-[12px] font-medium text-ink">{{ props.pending.file }}</p>
							<p class="text-[11px] text-ink-faint">
								{{ megabytes(props.pending.size) }} &middot; {{ props.pending.format }} &middot;
								{{ authored }} in the units it was authored in
							</p>
							<p v-if="props.pending.known" class="mt-1 text-[11px] text-ink-faint">
								This file is already stored &mdash; placing it again costs nothing.
							</p>
							<p
								v-if="props.pending.external && props.pending.external.length"
								data-testid="import-external" class="mt-1 text-[11px] text-danger">
								{{ props.pending.external.length }} file(s) this model needs are not inside it, so it
								will arrive untextured: {{ props.pending.external.join(', ') }}. Re-export it with the
								textures embedded to fix that.
							</p>
						</div>

						<label class="flex flex-col gap-1">
							<span class="eyebrow">{{ t('One unit in the file is') }}</span>
							<select
								v-model="unit" :disabled="Number(longest) > 0" :aria-label="t('Authored unit')"
								class="rounded-md border border-line bg-overlay px-2 py-1.5 text-[12px] disabled:opacity-50">
								<option v-for="entry in props.units" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
							</select>
						</label>

						<label class="flex flex-col gap-1">
							<span class="eyebrow">{{ t('Or set the longest side, in centimetres') }}</span>
							<input
								v-model="longest" type="number" min="0" step="1" :placeholder="t('leave empty to use the unit above')"
								:aria-label="t('Longest side in centimetres')"
								class="rounded-md border border-line bg-overlay px-2 py-1.5 text-[12px]">
						</label>

						<fieldset class="flex flex-col gap-1">
							<legend class="eyebrow">{{ t('Which way is up in the file') }}</legend>
							<div class="flex gap-1.5">
								<button
									type="button" class="btn flex-1" :class="{'is-active': up === 'y'}"
									:aria-pressed="up === 'y'" @click="up = 'y'">
									{{ t('Y is up') }}
								</button>
								<button
									type="button" class="btn flex-1 gap-1.5" :class="{'is-active': up === 'z'}"
									:aria-pressed="up === 'z'" @click="up = 'z'">
									<RotateCw :size="14" />
									{{ t('Z is up') }}
								</button>
							</div>
							<p class="text-[11px] text-ink-faint">
								{{ t('Blender, 3ds Max and most CAD write Z-up. If the model lies on its face, this is why.') }}
							</p>
						</fieldset>

						<p class="rounded-panel border border-line bg-overlay p-3 text-[12px]">
							<span class="eyebrow block">{{ t('It will be placed at') }}</span>
							<strong data-testid="import-size" class="text-ink">{{ placed }}</strong>
							<span class="text-ink-faint"> {{ t('(width × height × depth)') }}</span>
						</p>

						<p v-if="props.refusal" class="text-[12px] text-danger">{{ props.refusal }}</p>

						<div class="flex gap-1.5">
							<button type="button" class="btn" :disabled="props.busy" @click="emit('cancel')">{{ t('Cancel') }}</button>
							<button
								type="button" class="btn btn-primary gap-1.5" :disabled="props.busy"
								@click="emit('place', decision)">
								<Plus :size="14" />
								{{ t('Place it') }}
							</button>
						</div>
					</template>

					<!-- The shelf. -->
					<template v-else>
						<label class="btn-file flex cursor-pointer items-center gap-2 rounded-panel border border-dashed border-line bg-overlay px-3 py-4 text-[12px] text-ink-soft hover:border-accent">
							<Upload :size="16" />
							<span>
								<strong class="text-ink">{{ t('Choose a model') }}</strong>
								&mdash; .glb, .gltf or .obj, up to {{ Math.round(props.limit / 1048576) }} MB
							</span>
							<input type="file" :accept="props.accept" :aria-label="t('Choose a model')" @change="onFile">
						</label>

						<p v-if="props.refusal" class="text-[12px] text-danger">{{ props.refusal }}</p>

						<p v-if="!props.stored.length" class="text-[12px] text-ink-faint">
							{{ t('Nothing imported yet. A model you import here stays in this browser and can be placed as often as you like.') }}
						</p>

						<ul v-else class="flex flex-col gap-1" data-testid="imported-list">
							<li
								v-for="record in props.stored" :key="record.id"
								class="flex items-center gap-2 rounded-md border border-line bg-overlay px-2 py-1.5">
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[12px] text-ink">{{ record.file }}</span>
									<span class="block text-[11px] text-ink-faint">
										{{ megabytes(record.bytes) }} &middot; {{ record.format }}
										&middot; {{ record.up === 'z' ? 'Z-up' : 'Y-up' }}
									</span>
								</span>
								<button
									type="button" class="btn btn-icon" :aria-label="`Place ${record.file}`"
									@click="emit('place-stored', record)">
									<Plus :size="14" />
								</button>
								<button
									type="button" class="btn btn-icon" :aria-label="`Remove ${record.file}`"
									@click="emit('forget', record.id)">
									<Trash2 :size="14" />
								</button>
							</li>
						</ul>
					</template>
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
