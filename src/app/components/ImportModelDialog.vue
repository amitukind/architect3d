<script setup>
import {injectModelImport} from '../composables/useModelImport.js';
// @ts-check
import {computed, ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {X, Upload, Trash2, Plus, RotateCw} from '@lucide/vue';
import {Dimensioning} from '../../scripts/blueprint.js';

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

/**
 * The import composable, whole, rather than ten of its parts (RM-020 S-5).
 *
 * This component took twelve bindings from `useModelImport` and sent five back
 * as events - the entire composable, relayed through `App.vue` a field at a
 * time. It reaches for it directly now.
 *
 * `open` stays a v-model: whether a dialog is showing is the shell's business,
 * not the import's. `place` and `place-stored` stay events for the same reason -
 * placing a model needs the selection and the history stack, which this
 * composable does not have.
 */
const models = injectModelImport();

const props = defineProps({
	open: {type: Boolean, default: false},
});
const emit = defineEmits(['update:open', 'place', 'place-stored']);

/** @type {import('vue').Ref<string>} */
const unit = ref('m');
/** @type {import('vue').Ref<string>} */
const up = ref('y');
/** Empty means "use the unit above"; a number overrides it. */
const longest = ref('');

// A new file is a new decision. Anything a previous import chose is a worse
// default than the specification's, except the axis of a file that has been
// imported before - the store already knows which way that one stands up.
watch(() => models.pending.value, function (next)
{
	unit.value = 'm';
	longest.value = '';
	up.value = (next && next.known && next.known.up) || 'y';
});

const decision = computed(() => ({up: up.value, unit: unit.value, longest: Number(longest.value) || 0}));
const result = computed(() => models.pending.value ? models.preview(decision.value) : {scale: 0, size: [0, 0, 0]});

/** The measured extent, in the units the file was authored in. */
const authored = computed(function ()
{
	if (!models.pending.value) { return ''; }
	return models.pending.value.measured.size.map((value) => round(value)).join(' × ');
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
		models.choose(file);
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
						<DialogTitle class="text-[14px] font-semibold">Your own models</DialogTitle>
						<DialogDescription class="text-ink-faint">
							A .glb, .gltf or .obj from this computer becomes an item you can place. It is stored in
							this browser and travels in a .zip bundle, not in a link.
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" aria-label="Close">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
					<p v-if="!models.available.value" class="rounded-panel border border-line bg-overlay p-3 text-[12px] text-ink-soft">
						This browser cannot store imported models. Private browsing and some embedded browsers
						withhold the storage this needs; everything else in the application still works.
					</p>

					<!-- The decision. -->
					<template v-else-if="models.pending.value">
						<div class="rounded-panel border border-line bg-overlay p-3">
							<p class="text-[12px] font-medium text-ink">{{ models.pending.value.file }}</p>
							<p class="text-[11px] text-ink-faint">
								{{ megabytes(models.pending.value.size) }} &middot; {{ models.pending.value.format }} &middot;
								{{ authored }} in the units it was authored in
							</p>
							<p v-if="models.pending.value.known" class="mt-1 text-[11px] text-ink-faint">
								This file is already stored &mdash; placing it again costs nothing.
							</p>
							<p
								v-if="models.pending.value.external && models.pending.value.external.length"
								data-testid="import-external" class="mt-1 text-[11px] text-danger">
								{{ models.pending.value.external.length }} file(s) this model needs are not inside it, so it
								will arrive untextured: {{ models.pending.value.external.join(', ') }}. Re-export it with the
								textures embedded to fix that.
							</p>
						</div>

						<label class="flex flex-col gap-1">
							<span class="eyebrow">One unit in the file is</span>
							<select
								v-model="unit" :disabled="Number(longest) > 0" aria-label="Authored unit"
								class="rounded-md border border-line bg-overlay px-2 py-1.5 text-[12px] disabled:opacity-50">
								<option v-for="entry in models.UNITS" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
							</select>
						</label>

						<label class="flex flex-col gap-1">
							<span class="eyebrow">Or set the longest side, in centimetres</span>
							<input
								v-model="longest" type="number" min="0" step="1" placeholder="leave empty to use the unit above"
								aria-label="Longest side in centimetres"
								class="rounded-md border border-line bg-overlay px-2 py-1.5 text-[12px]">
						</label>

						<fieldset class="flex flex-col gap-1">
							<legend class="eyebrow">Which way is up in the file</legend>
							<div class="flex gap-1.5">
								<button
									type="button" class="btn flex-1" :class="{'is-active': up === 'y'}"
									:aria-pressed="up === 'y'" @click="up = 'y'">
									Y is up
								</button>
								<button
									type="button" class="btn flex-1 gap-1.5" :class="{'is-active': up === 'z'}"
									:aria-pressed="up === 'z'" @click="up = 'z'">
									<RotateCw :size="14" />
									Z is up
								</button>
							</div>
							<p class="text-[11px] text-ink-faint">
								Blender, 3ds Max and most CAD write Z-up. If the model lies on its face, this is why.
							</p>
						</fieldset>

						<p class="rounded-panel border border-line bg-overlay p-3 text-[12px]">
							<span class="eyebrow block">It will be placed at</span>
							<strong data-testid="import-size" class="text-ink">{{ placed }}</strong>
							<span class="text-ink-faint"> (width × height × depth)</span>
						</p>

						<p v-if="models.refusal.value" class="text-[12px] text-danger">{{ models.refusal.value }}</p>

						<div class="flex gap-1.5">
							<button type="button" class="btn" :disabled="models.busy.value" @click="models.cancel()">Cancel</button>
							<button
								type="button" class="btn btn-primary gap-1.5" :disabled="models.busy.value"
								@click="emit('place', decision)">
								<Plus :size="14" />
								Place it
							</button>
						</div>
					</template>

					<!-- The shelf. -->
					<template v-else>
						<label class="btn-file flex cursor-pointer items-center gap-2 rounded-panel border border-dashed border-line bg-overlay px-3 py-4 text-[12px] text-ink-soft hover:border-accent">
							<Upload :size="16" />
							<span>
								<strong class="text-ink">Choose a model</strong>
								&mdash; .glb, .gltf or .obj, up to {{ Math.round(models.MAX_MODEL_BYTES / 1048576) }} MB
							</span>
							<input type="file" :accept="models.ACCEPT" aria-label="Choose a model" @change="onFile">
						</label>

						<p v-if="models.refusal.value" class="text-[12px] text-danger">{{ models.refusal.value }}</p>

						<p v-if="!models.stored.value.length" class="text-[12px] text-ink-faint">
							Nothing imported yet. A model you import here stays in this browser and can be placed as
							often as you like.
						</p>

						<ul v-else class="flex flex-col gap-1" data-testid="imported-list">
							<li
								v-for="record in models.stored.value" :key="record.id"
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
									@click="models.forget(record.id)">
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
