<script setup>
// @ts-check
import {computed, nextTick, ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {X, Copy, Trash2, Pencil, FilePlus2, LayoutGrid, Check} from '@lucide/vue';
import {t} from '../i18n/i18n.js';

/**
 * The project library (RM-013 K1, gap Q-6).
 *
 * ## Two shelves, and they are not the same kind of thing
 *
 * *Your designs* are records: they have a name somebody chose, a date and a
 * picture of themselves, and opening one continues it. *Starter plans* are
 * documents on a shelf: opening one puts it on screen unsaved, so the first
 * save makes a record rather than overwriting the studio flat for whoever
 * opens it next. They are one dialog because they answer the same question -
 * "what am I working on?" - and two tabs because the answer to "what happens
 * when I click this" differs.
 *
 * ## Rename and delete happen on the tile
 *
 * Not in `window.prompt` and not in `window.confirm`. The application sets
 * `configSystemUI` to false precisely so the library stops reaching for those,
 * and a modal on top of a modal to ask "are you sure" is worse than a second
 * click on the thing you are already pointing at. Renaming turns the tile's
 * caption into a field; deleting turns its footer into a question. Both cancel
 * on Escape and on opening the other one.
 *
 * ## A tile with no picture is a tile
 *
 * `captureThumbnail` returns null for three ordinary reasons - no floorplanner,
 * an empty plan, a browser with no encoder - and none of them is a failure. The
 * placeholder is the plan's own dimensions where they are known and the initial
 * where they are not, rather than a broken-image glyph.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	projects: {
		/** @type {import('vue').PropType<Array<Object>>} */
		type: Array,
		required: true,
	},
	templates: {
		/** @type {import('vue').PropType<Array<Object>>} */
		type: Array,
		default: () => [],
	},
	current: {
		/** @type {import('vue').PropType<?Object>} */
		type: Object,
		default: null,
	},
	dirty: {type: Boolean, default: false},
	busy: {type: Boolean, default: false},
	available: {type: Boolean, default: true},
	templatesError: {
		/** @type {import('vue').PropType<?string>} */
		type: String,
		default: null,
	},
});

const emit = defineEmits(['update:open', 'open-project', 'rename-project', 'duplicate-project',
	'delete-project', 'start-template', 'save-current', 'tab']);

const TABS = [
	{id: 'designs', label: 'Your designs'},
	{id: 'templates', label: 'Start from a plan'},
];

const tab = ref('designs');
/** The id being renamed, and the text in the field. */
const renaming = ref(null);
const draft = ref('');
/** The id whose delete is awaiting a second click. */
const confirming = ref(null);
/**
 * The rename field, when one is open.
 *
 * A function ref rather than `ref="field"`, and the difference is not cosmetic:
 * a template ref inside `v-for` resolves to an ARRAY, so `field.value.focus()`
 * would have thrown on the first rename and the caret would never have landed
 * in the box. Only one tile renames at a time - the input is behind
 * `v-if="renaming === card.id"` - so a single element is the honest shape.
 *
 * @type {import('vue').Ref<?HTMLInputElement>}
 */
const field = ref(null);

/** @param {*} element */
function captureField(element)
{
	field.value = (element && typeof element.focus === 'function') ? element : null;
}

const empty = computed(() => props.projects.length === 0);

watch(() => props.open, function (isOpen)
{
	if (!isOpen)
	{
		renaming.value = null;
		confirming.value = null;
		return;
	}
	// A library nobody has saved into opens on the shelf that has something on
	// it, which is the one useful guess this dialog gets to make.
	tab.value = props.projects.length ? 'designs' : 'templates';
	emit('tab', tab.value);
	// Immediate, because a dialog can be mounted already open - an embedder, a
	// test, a deep link - and one that only chose its shelf on a false-to-true
	// transition would show an empty grid to somebody who has nothing kept.
}, {immediate: true});

watch(tab, (value) => emit('tab', value));

/** @param {Object} card */
async function beginRename(card)
{
	confirming.value = null;
	renaming.value = card.id;
	draft.value = card.name;
	await nextTick();
	if (field.value)
	{
		field.value.focus();
		field.value.select();
	}
}

function commitRename()
{
	if (renaming.value && draft.value.trim())
	{
		emit('rename-project', renaming.value, draft.value);
	}
	renaming.value = null;
}

/** @param {Object} card */
function askDelete(card)
{
	renaming.value = null;
	confirming.value = card.id;
}

/** @param {number} stamp */
function when(stamp)
{
	const date = new Date(stamp);
	const today = new Date();
	const sameDay = date.toDateString() === today.toDateString();
	return sameDay
		? date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'})
		: date.toLocaleDateString(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
}

/** @param {number} bytes */
function size(bytes)
{
	return bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes || 0} B`;
}
</script>

<template>
	<DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<DialogOverlay class="a3d-fade fixed inset-0 z-[550] bg-black/50 backdrop-blur-[2px]" />
			<DialogContent
				class="a3d-pop fixed left-1/2 top-1/2 z-[560] flex max-h-[84vh] w-[860px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface shadow-float focus:outline-none">
				<div class="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
					<div class="min-w-0">
						<DialogTitle class="text-[14px] font-semibold">{{ t('Designs') }}</DialogTitle>
						<DialogDescription class="text-ink-faint">
							<template v-if="props.current">
								{{ t('Working on') }} <strong class="font-medium text-ink">{{ props.current.name }}</strong>
								<span v-if="props.dirty"> &middot; unsaved changes</span>
							</template>
							<template v-else>
								{{ t('This design has not been kept yet.') }}
							</template>
						</DialogDescription>
					</div>
					<button
						v-if="props.available"
						type="button" class="btn ml-auto gap-1.5" :disabled="props.busy"
						@click="emit('save-current')">
						<Check :size="15" />
						{{ props.current ? 'Save' : 'Keep this design' }}
					</button>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon" :aria-label="t('Close')">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex flex-none gap-1 border-b border-line px-3 pt-2">
					<button
						v-for="entry in TABS" :key="entry.id" type="button"
						class="btn rounded-b-none border-b-2 px-3"
						:class="tab === entry.id ? 'border-accent text-ink' : 'border-transparent text-ink-soft'"
						@click="tab = entry.id">
						{{ entry.label }}
						<span v-if="entry.id === 'designs' && props.projects.length" class="text-ink-faint">
							{{ props.projects.length }}
						</span>
					</button>
				</div>

				<div class="flex-1 overflow-y-auto p-4">
					<p v-if="!props.available" class="rounded-panel border border-line bg-overlay p-4 text-[12px] text-ink-soft">
						This browser is not offering storage, so designs cannot be kept here.
						Private browsing does this. Save to a file instead &mdash; the file works everywhere.
					</p>

					<template v-else-if="tab === 'designs'">
						<p v-if="empty" class="rounded-panel border border-dashed border-line p-6 text-center text-[12px] text-ink-soft">
							{{ t('Nothing kept yet. Draw something and press') }} <strong class="text-ink">{{ t('Keep this design') }}</strong>{{ t(', or start from a plan.') }}
						</p>
						<ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<li
								v-for="card in props.projects" :key="card.id"
								class="group flex flex-col overflow-hidden rounded-panel border bg-overlay"
								:class="props.current && props.current.id === card.id ? 'border-accent' : 'border-line'">
								<button
									type="button"
									class="relative block aspect-[4/3] w-full bg-surface"
									:title="`Open ${card.name}`"
									@click="emit('open-project', card.id)">
									<img
										v-if="card.thumbnail" :src="card.thumbnail" alt=""
										class="h-full w-full object-cover">
									<span v-else class="grid h-full w-full place-items-center text-[22px] font-semibold text-ink-faint">
										{{ card.name.slice(0, 1).toUpperCase() }}
									</span>
								</button>

								<div class="flex flex-col gap-0.5 px-2.5 py-2">
									<input
										v-if="renaming === card.id" :ref="captureField" v-model="draft"
										class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-[12px]"
										:maxlength="120" :aria-label="t('Design name')"
										@keydown.enter.prevent="commitRename"
										@keydown.esc.prevent="renaming = null"
										@blur="commitRename">
									<span v-else class="truncate text-[12px] font-medium" :title="card.name">{{ card.name }}</span>
									<span class="text-[11px] text-ink-faint">
										{{ when(card.modifiedAt) }} &middot; {{ size(card.bytes) }}
									</span>
								</div>

								<div v-if="confirming === card.id" class="flex items-center gap-1 border-t border-line px-2 py-1.5">
									<span class="mr-auto text-[11px] text-ink-soft">{{ t('Delete this?') }}</span>
									<button type="button" class="btn px-2 text-[11px]" @click="confirming = null">{{ t('Cancel') }}</button>
									<button
										type="button" class="btn px-2 text-[11px] text-danger"
										@click="confirming = null; emit('delete-project', card.id)">
										{{ t('Delete') }}
									</button>
								</div>
								<div v-else class="flex items-center gap-0.5 border-t border-line px-1.5 py-1">
									<button
										type="button" class="btn btn-icon" :title="t('Rename')" :aria-label="t('Rename')"
										@click="beginRename(card)">
										<Pencil :size="14" />
									</button>
									<button
										type="button" class="btn btn-icon" :title="t('Duplicate')" :aria-label="t('Duplicate')"
										@click="emit('duplicate-project', card.id)">
										<Copy :size="14" />
									</button>
									<button
										type="button" class="btn btn-icon ml-auto" :title="t('Delete')" :aria-label="t('Delete')"
										@click="askDelete(card)">
										<Trash2 :size="14" />
									</button>
								</div>
							</li>
						</ul>
					</template>

					<template v-else>
						<p v-if="props.templatesError" class="rounded-panel border border-line bg-overlay p-4 text-[12px] text-ink-soft">
							{{ props.templatesError }}
						</p>
						<ul v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<li v-for="entry in props.templates" :key="entry.id">
								<button
									type="button"
									class="flex w-full items-start gap-3 rounded-panel border border-line bg-overlay p-3 text-left hover:border-accent"
									@click="emit('start-template', entry)">
									<span class="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-md bg-surface text-ink-soft">
										<LayoutGrid v-if="entry.kind === 'template'" :size="15" />
										<FilePlus2 v-else :size="15" />
									</span>
									<span class="min-w-0">
										<span class="block truncate text-[12px] font-medium">{{ entry.name }}</span>
										<span class="block text-[11px] text-ink-faint">{{ entry.summary }}</span>
										<span class="mt-1 block text-[11px] text-ink-faint">
											{{ entry.rooms }} rooms<template v-if="entry.items"> &middot; {{ entry.items }} items</template>
										</span>
									</span>
								</button>
							</li>
						</ul>
					</template>
				</div>

				<div class="flex-none border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
					{{ t('Designs are kept in this browser, on this machine. Nothing is uploaded anywhere. Use') }} <strong class="font-medium">{{ t('Save layout') }}</strong> {{ t('for a file you can move.') }}
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
