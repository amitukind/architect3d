<script setup>
import {computed, nextTick, ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {Search, X, Plus} from '@lucide/vue';

/**
 * The furniture catalog.
 *
 * ## Why a drawer, not a modal
 *
 * The modal it replaces covered the room you were furnishing and closed on
 * every pick, so adding six chairs meant opening it six times and losing sight
 * of the scene six times. Furnishing is a repetitive task done while looking at
 * the result; the panel should stay open and the scene should stay visible.
 *
 * So: a right-hand drawer with no overlay dimming, and picking an item adds it
 * without closing. Escape and the close button end the session.
 *
 * ## Search first
 *
 * 168 models across 8 accordion sections, one open at a time, is a lot of
 * clicking to find a bedside table. A search box over the whole catalog is a
 * better index than the categories are, so it is the first control and the
 * categories become a filter beside it rather than the only way in.
 *
 * Matching is a case-insensitive substring over the item name. Not fuzzy:
 * fuzzy matching on 168 short strings mostly produces confident wrong answers,
 * and every name here is a word someone would actually type.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	sections: {type: Array, required: true},
	/** Where a wall-bound item would land, so the drawer can say. */
	placement: {type: Object, default: null},
});

const emit = defineEmits(['update:open', 'add-item']);

const query = ref('');
const activeSection = ref(null);
const searchField = ref(null);

/** Wall-bound item types, matching the list in useCatalog. */
const WALL_BOUND_TYPES = [2, 3, 7, 9];

const total = computed(() => props.sections.reduce((sum, section) => sum + section.items.length, 0));

/**
 * The visible rows: every item, tagged with the section it came from, filtered
 * by the query and the section chip.
 *
 * Flattened rather than kept as sections, because a search that returns three
 * items from three categories should show three items, not three headings with
 * one row each.
 */
const results = computed(function ()
{
	const needle = query.value.trim().toLowerCase();

	return props.sections
		.filter((section) => activeSection.value === null || section.id === activeSection.value)
		.flatMap((section) => section.items.map((item) => ({item: item, section: section})))
		.filter((row) => needle === '' || row.item.name.toLowerCase().includes(needle));
});

/** Whether picking this item right now needs a wall that has not been clicked. */
function needsWall(item)
{
	return WALL_BOUND_TYPES.indexOf(item.type) !== -1 && !(props.placement && props.placement.wall);
}

function pick(item)
{
	emit('add-item', item);
}

function close()
{
	emit('update:open', false);
}

// Focus the search box on open. The drawer's whole purpose is finding
// something, and the keyboard should already be in the right place.
watch(() => props.open, async function (open)
{
	if (open)
	{
		await nextTick();
		if (searchField.value)
		{
			searchField.value.focus();
		}
	}
});
</script>

<template>
	<DialogRoot :open="props.open" :modal="false" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<!-- No dimming: the point of a drawer is that the scene stays visible.
			     The overlay exists only so a click outside closes the panel. -->
			<DialogOverlay class="fixed inset-0 z-[450]" @click="close" />
			<DialogContent
				class="a3d-slide fixed inset-y-0 right-0 z-[500] flex w-[380px] max-w-full flex-col border-l border-line bg-surface shadow-float focus:outline-none"
				@escape-key-down="close"
				@interact-outside.prevent>
				<div class="flex flex-none items-center gap-2 border-b border-line px-3 py-2.5">
					<div>
						<DialogTitle class="text-[13px] font-semibold">Furniture</DialogTitle>
						<DialogDescription class="num text-ink-faint">
							{{ results.length }} of {{ total }} models
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" aria-label="Close catalog" @click="close">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex-none border-b border-line p-3">
					<div class="relative">
						<Search :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
						<input
							ref="searchField" v-model="query" type="search"
							class="field-input pl-8" placeholder="Search 168 models" aria-label="Search the catalog">
					</div>

					<div class="mt-2 flex flex-wrap gap-1">
						<button
							type="button" class="btn h-6 px-2 text-[11px]"
							:class="{'is-active': activeSection === null}"
							@click="activeSection = null">
							All
						</button>
						<button
							v-for="section in props.sections" :key="section.id" type="button"
							class="btn h-6 px-2 text-[11px]"
							:class="{'is-active': activeSection === section.id}"
							@click="activeSection = activeSection === section.id ? null : section.id">
							{{ section.heading }}
						</button>
					</div>
				</div>

				<div class="flex-1 overflow-y-auto p-3">
					<p v-if="!results.length" class="py-8 text-center text-ink-faint">
						Nothing matches “{{ query }}”.
					</p>

					<ul v-else class="grid grid-cols-2 gap-2">
						<li v-for="row in results" :key="row.item.model">
							<button
								type="button"
								class="group relative w-full overflow-hidden rounded-lg border border-line-soft bg-sunk p-2 text-left transition-colors hover:border-accent"
								:title="`Add ${row.item.name}`"
								@click="pick(row.item)">
								<!-- alt="" on purpose: the button is already named "Add {name}"
								     and the label below repeats it, so a described thumbnail makes
								     a screen reader say the item three times. axe calls this
								     image-redundant-alt, and it fired on all 122 of them. -->
								<img
									:src="row.item.image" alt="" loading="lazy"
									class="mx-auto h-[86px] w-full object-contain mix-blend-normal">
								<span class="mt-1 block truncate text-[11px] leading-tight">{{ row.item.name }}</span>
								<span v-if="needsWall(row.item)" class="block truncate text-[10px] text-ink-faint">
									click a wall first
								</span>
								<span
									class="pointer-events-none absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-accent text-accent-ink opacity-0 transition-opacity group-hover:opacity-100">
									<Plus :size="12" />
								</span>
							</button>
						</li>
					</ul>
				</div>

				<div class="flex-none border-t border-line px-3 py-2 text-[11px] text-ink-faint">
					Items land on the last floor or wall you clicked in 3D. The panel stays open —
					<kbd>Esc</kbd> to close.
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
