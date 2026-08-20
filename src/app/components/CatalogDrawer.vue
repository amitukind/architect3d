<script setup>
// @ts-check
import {computed, nextTick, ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {Scale, Search, X, Plus, Star, Upload} from '@lucide/vue';
import CatalogCredits from './CatalogCredits.vue';
import {PACKS, loadCatalogDetail, loadCatalogPacks, ROOMS} from '../composables/useCatalog.js';
import {useCatalogBrowse} from '../composables/useCatalogBrowse.js';
import {Dimensioning} from '../../scripts/blueprint.js';

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
 * Matching is a case-insensitive substring over the item name **and its tags**,
 * so typing "seating" finds twenty-five chairs whose names do not contain the
 * word. Not fuzzy: fuzzy matching on 168 short strings mostly produces confident
 * wrong answers, and every name here is a word someone would actually type.
 *
 * ## Three filters, and why they are drawn differently (RM-012 J1)
 *
 * **Room** is the one a person browses by, so it is chips: eight of them, always
 * visible, one click each. **Favourites and recents** are two more chips at the
 * front of the same row, because they answer the same question - "show me a
 * smaller set" - and a person who has starred six things wants them one click
 * away, not behind a menu.
 *
 * **Placement type** is a `<select>`. It was the chip row before J1, and it is
 * the filter an embedder or a power user reaches for rather than the one
 * somebody furnishing a bedroom reaches for; twelve chips of it crowded out the
 * eight that answer the everyday question. Nothing was removed - it moved to the
 * control that suits a long list that is used rarely.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	sections: {
		/**
		 * A bare `Array` types every element `unknown`, which made this whole
		 * template uncheckable - eight of this file's nine errors were the one
		 * missing annotation. Typing the prop is what turns a cluster into zero
		 * rather than into one (RM-004 B3).
		 *
		 * @type {import('vue').PropType<Array<import('../composables/useCatalog.js').CatalogSection>>}
		 */
		type: Array,
		required: true,
	},
	/** Where a wall-bound item would land, so the drawer can say. */
	placement: {type: Object, default: null},
	/**
	 * How many rows every pack in the manifest adds up to, fetched or not
	 * (RM-012 J2).
	 *
	 * The header says "12 of 180" while the packs are in flight rather than
	 * "12 of 12", because the second is true of what has arrived and misleading
	 * about what is coming. The manifest knows this number without downloading a
	 * row, which is the point of having one.
	 */
	promised: {type: Number, default: 0},
});

const emit = defineEmits(['update:open', 'add-item', 'prefetch-item', 'import-model']);

const query = ref('');
/** @type {import('vue').Ref<?string>} The room filter, or null for all. */
const activeRoom = ref(null);
/**
 * Which shortlist is showing: 'favourites', 'recent', or null for neither.
 *
 * A third filter axis rather than a room, because it cuts across rooms - the
 * point of a favourite is that you do not have to remember which room it was
 * filed under.
 *
 * @type {import('vue').Ref<?string>}
 */
const activeList = ref(null);

const browse = useCatalogBrowse();
// `ref(null)` infers `Ref<null>`, so assigning anything else is an error and
// reading a property off it is an error on `never`. Both of these hold null
// most of the time and something else the rest, which is what the annotation
// has to say (RM-004 B3).
/** @type {import('vue').Ref<?number>} The section filter, or null for all. */
const activeSection = ref(null);
/** @type {import('vue').Ref<?HTMLInputElement>} */
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
	// Order matters for one of the three: a recents list is *in* recency order,
	// and re-sorting it into catalog order would throw away the only information
	// it carries. The other two keep the catalog's own order.
	const shortlist = (activeList.value === 'favourites') ? browse.favourites.value
		: (activeList.value === 'recent') ? browse.recent.value : null;

	const rows = props.sections
		.filter((section) => activeSection.value === null || section.id === activeSection.value)
		.flatMap((section) => section.items.map((item) => ({item: item, section: section})))
		.filter((row) => activeRoom.value === null || row.item.room === activeRoom.value)
		.filter((row) => needle === '' || matches(row.item, needle));

	if (!shortlist)
	{
		return rows;
	}
	// Built by walking the shortlist rather than by filtering `rows`, because the
	// shortlist's order is the answer for recents and `filter` would discard it.
	// A push loop rather than `map(...).filter(Boolean)`: the latter is typed
	// `Array<Row|undefined>` and every reader in the template then has to prove
	// the row exists (RM-004 B3).
	const kept = new Map(rows.map((row) => [row.item.model, row]));
	const ordered = [];
	for (const model of shortlist)
	{
		const row = kept.get(model);
		if (row)
		{
			ordered.push(row);
		}
	}
	return ordered;
});

/**
 * Does this row answer the search?
 *
 * Name first, then tags. A tag is a whole word from a closed list of fourteen,
 * so it is compared whole rather than by substring: typing "bed" should find the
 * beds by name, not every row tagged `bed` *and* every row whose name contains
 * the letters - which for this catalog is the difference between four results
 * and eleven.
 *
 * @param {Object} item
 * @param {string} needle Already lowercased and trimmed.
 */
function matches(item, needle)
{
	return item.name.toLowerCase().includes(needle)
		|| (item.tags || []).some((tag) => tag === needle);
}

/**
 * Why there is nothing to show, said in the terms the person is in (RM-014 L2).
 *
 * This block used to be one line - `Nothing matches "{{ query }}"` - and with a
 * shortlist selected and no query it read <em>Nothing matches ""</em>, which is
 * both untrue and unhelpful. An empty state is where somebody is most likely to
 * be lost, so it is the one place a message has to know which emptiness it is.
 */
const emptyReason = computed(function ()
{
	if (query.value.trim())
	{
		return `Nothing matches “${query.value.trim()}”.`;
	}
	if (activeList.value === 'favourites')
	{
		// "Starred", because that is what the chip above says. An empty state that
		// renames the thing it is about is the second way to lose somebody.
		return 'Nothing starred yet. The star on any tile keeps it here, so the six things you '
			+ 'use in every room are one click away.';
	}
	if (activeList.value === 'recent')
	{
		return 'Nothing here yet from what you have placed. Recent items appear once the kit '
			+ 'they came from has loaded.';
	}
	if (activeRoom.value)
	{
		return `Nothing filed under ${activeRoom.value} in what has loaded so far.`;
	}
	return 'Nothing to show here.';
});

/** The room chips, with what each would show, so an empty one can be dimmed. */
const roomCounts = computed(function ()
{
	const counts = {};
	props.sections.forEach((section) => section.items.forEach(function (item)
	{
		counts[item.room] = (counts[item.room] || 0) + 1;
	}));
	return counts;
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

/**
 * Star or unstar, without adding the thing.
 *
 * The button sits over the tile rather than inside it - axe called the nested
 * form `nested-interactive` on all 193 tiles, and it was right: a button inside
 * a button is one element to a screen reader and the inner one cannot be
 * reached. `stopPropagation` stays anyway, because the star is positioned over
 * the tile and a click landing on both would place a chair.
 *
 * @param {Object} item
 * @param {Event} event
 */
function star(item, event)
{
	event.stopPropagation();
	browse.toggleFavourite(item.model);
}

function close()
{
	emit('update:open', false);
}

/**
 * The catalog's measured dimensions, once the drawer has asked for them.
 *
 * Null until the chunk lands, and every reader below is written for that: the
 * grid renders from the bundled index and the size line appears when it can.
 * That is the whole point of RM-012 X-3's split - a visitor who never opens this
 * drawer never downloads a dimension.
 */
/** @type {import('vue').Ref<?{items: Object<string, {size?: {w: number, h: number, d: number}, source?: string}>, sources?: Object}>} */
const detail = ref(null);

/**
 * One item's size, in whatever unit the person is working in.
 *
 * Measured from the model's own glTF accessor bounds by
 * `tools/split-catalog.mjs` and stored in centimetres, so this is the same
 * conversion every other measurement in the inspector goes through.
 *
 * @param {Object} item
 * @returns {string} Empty when the detail has not arrived or has no size.
 */
function sizeLabel(item)
{
	const size = detail.value && detail.value.items[item.model] && detail.value.items[item.model].size;
	if (!size)
	{
		return '';
	}
	return [size.w, size.d, size.h].map((cm) => Dimensioning.cmToMeasure(cm)).join(' × ');
}

/**
 * Whether the packs are in flight (RM-012 J2).
 *
 * True between the first open and the last pack landing, and never again -
 * `loadCatalogPacks` caches, so a second open resolves on the same tick and this
 * flickers to false before a frame is drawn.
 */
const loading = ref(false);

/** Whether the credits are showing. */
const creditsOpen = ref(false);

/**
 * Who made one item, and under what terms.
 *
 * On the tile's `title` rather than in its layout, and that is a decision about
 * where the obligation actually falls. RM-007 asks for *the licence on every
 * item*; 193 tiles each carrying a licence line would make the grid unreadable
 * and would say the same four things fifty times each. So the per-item answer is
 * one hover away and always correct, and the readable version is the credits
 * dialog, which is the thing somebody looking for terms would actually open.
 *
 * From the manifest, so it needs no fetch and is right on the first frame.
 *
 * @param {Object} item
 * @returns {string}
 */
function creditFor(item)
{
	const pack = PACKS.find((entry) => entry.id === item.pack);
	return pack ? ` — ${pack.name}, ${pack.licence}` : '';
}

// Focus the search box on open, and fetch the catalog. The drawer's whole
// purpose is finding something, and the keyboard should already be in the right
// place, so neither fetch is awaited before the focus - a slow pack must not
// delay the cursor landing in the search box.
watch(() => props.open, async function (open)
{
	if (!open)
	{
		return;
	}
	// The rows first, because the grid cannot draw without them. Then the sizes,
	// which appear under tiles that are already on screen. Same staging J1 had
	// between the bundle and a chunk, now between two fetches (RM-012 J2).
	loading.value = true;
	loadCatalogPacks().then(function ()
	{
		loading.value = false;
		return loadCatalogDetail();
	}).then(function (loaded) {detail.value = loaded;});
	await nextTick();
	if (searchField.value)
	{
		searchField.value.focus();
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
							{{ results.length }} of {{ Math.max(total, props.promised) }} models
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
							class="field-input pl-8" placeholder="Search the catalog" aria-label="Search the catalog">
					</div>

					<div class="mt-2 flex flex-wrap gap-1">
						<button
							type="button" class="btn h-6 px-2 text-[11px]"
							:class="{'is-active': activeRoom === null && activeList === null}"
							@click="activeRoom = null; activeList = null">
							All
						</button>
						<button
							type="button" class="btn h-6 gap-1 px-2 text-[11px]"
							:class="{'is-active': activeList === 'favourites'}"
							:title="`${browse.favourites.value.length} starred`"
							@click="activeList = activeList === 'favourites' ? null : 'favourites'">
							<Star :size="11" :fill="activeList === 'favourites' ? 'currentColor' : 'none'" />
							Starred
						</button>
						<button
							v-if="browse.recent.value.length" type="button" class="btn h-6 px-2 text-[11px]"
							:class="{'is-active': activeList === 'recent'}"
							@click="activeList = activeList === 'recent' ? null : 'recent'">
							Recent
						</button>
						<button
							v-for="room in ROOMS" :key="room.id" type="button"
							class="btn h-6 px-2 text-[11px]"
							:class="{'is-active': activeRoom === room.id}"
							:disabled="!roomCounts[room.id]"
							@click="activeRoom = activeRoom === room.id ? null : room.id">
							{{ room.label }}
						</button>
					</div>

					<select
						v-model="activeSection" class="field-input mt-2 h-7 text-[11px]"
						aria-label="Filter by placement type">
						<option :value="null">Any placement</option>
						<option v-for="section in props.sections" :key="section.id" :value="section.id">
							{{ section.heading }}
						</option>
					</select>
				</div>

				<div class="flex-1 overflow-y-auto p-3">
					<p v-if="loading && !results.length" class="py-8 text-center text-ink-faint">
						Fetching the catalog…
					</p>
					<p
						v-else-if="!results.length" data-testid="catalog-empty"
						class="mx-auto max-w-[34ch] py-8 text-center leading-relaxed text-ink-faint">
						{{ emptyReason }}
					</p>

					<ul v-else class="grid grid-cols-2 gap-2">
						<li v-for="row in results" :key="row.item.model" class="group relative">
							<button
								type="button"
								class="w-full overflow-hidden rounded-lg border border-line-soft bg-sunk p-2 text-left transition-colors group-hover:border-accent"
								:title="`Add ${row.item.name}${creditFor(row.item)}`"
								@click="pick(row.item)"
								@pointerenter="emit('prefetch-item', row.item)"
								@focus="emit('prefetch-item', row.item)">
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
								<span v-else-if="sizeLabel(row.item)" class="num block truncate text-[10px] text-ink-faint">
									{{ sizeLabel(row.item) }}
								</span>
								<span
									class="pointer-events-none absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-accent text-accent-ink opacity-0 transition-opacity group-hover:opacity-100">
									<Plus :size="12" />
								</span>
							</button>
							<!-- A sibling of the tile, not a child of it. Nesting it read fine and
							     axe called it: `nested-interactive`, on all 193 tiles. A button inside
							     a button is one element to a screen reader and the inner one is
							     unreachable. Shown always when starred and on hover otherwise, so a
							     shortlist is visible at a glance rather than only under the pointer. -->
							<button
								type="button"
								class="absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md bg-surface/90 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
								:class="browse.isFavourite(row.item.model) ? 'text-accent opacity-100' : 'text-ink-faint opacity-0'"
								:aria-label="browse.isFavourite(row.item.model) ? `Unstar ${row.item.name}` : `Star ${row.item.name}`"
								:aria-pressed="browse.isFavourite(row.item.model)"
								@click="star(row.item, $event)">
								<Star :size="11" :fill="browse.isFavourite(row.item.model) ? 'currentColor' : 'none'" />
							</button>
						</li>
					</ul>
				</div>

				<div class="flex flex-none items-center gap-2 border-t border-line px-3 py-2 text-[11px] text-ink-faint">
					<span class="min-w-0 flex-1">
						Items land on the last floor or wall you clicked in 3D. The panel stays open —
						<kbd>Esc</kbd> to close.
					</span>
					<button
						type="button" class="btn h-6 flex-none gap-1 px-2 text-[11px]"
						@click="emit('import-model')">
						<Upload :size="11" /> Your own models
					</button>
					<button
						type="button" class="btn h-6 flex-none gap-1 px-2 text-[11px]"
						@click="creditsOpen = true">
						<Scale :size="11" /> Credits
					</button>
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>

	<!-- Outside the drawer's portal on purpose: it is a modal over everything,
	     including the drawer, and nesting it under a non-modal DialogContent
	     would put it in that panel's focus scope. -->
	<CatalogCredits v-model:open="creditsOpen" :detail="detail" />
</template>
