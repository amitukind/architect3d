<script setup>
// @ts-check
import {computed} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {AlertTriangle, ExternalLink, X} from '@lucide/vue';
import {PACKS} from '../composables/useCatalog.js';

/**
 * Who made the furniture, and under what licence (RM-012 J2).
 *
 * ## Why this exists
 *
 * RM-007's objective for programme J opens with *"enough furniture to furnish a
 * home, found by room, **with the licence on every item**"*, and J1 recorded
 * that the second half of that had not been done: the provenance went into
 * `sources.json` and the drawer, and the licence was **nowhere in the shipped
 * product**. A licence recorded in a repository is a licence honoured by the
 * repository's authors; the obligation is on the thing people use.
 *
 * The obligation is light - CC0 asks for nothing and MIT asks for the notice -
 * which is exactly why it is easy to leave undone for eight years.
 *
 * ## Drawn from the manifest, so it needs no fetch
 *
 * The pack manifest is bundled and carries a name, a licence and a row count per
 * kit (RM-012 J2), so this dialog is complete the moment it opens, whether or not
 * anybody has opened the drawer. The author, the licence URL and the evidence
 * come from each pack's detail file and fill in when it lands - the same staging
 * the grid uses, and for the same reason.
 *
 * ## The unestablished one is shown, not hidden
 *
 * One pack's licence is `unknown`, and it is drawn with a warning rather than
 * omitted or quietly called CC0. J1's whole argument for writing provenance down
 * was that assuming a licence by resemblance is the thing to avoid; a credits
 * screen that showed three kits and silently dropped the fourth would undo that
 * in the one place a person would look.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	/**
	 * The merged detail, once the drawer has fetched it. Null before that, and
	 * every reader here is written for null.
	 */
	detail: {
		/** @type {import('vue').PropType<?{sources?: Object}>} */
		type: Object,
		default: null,
	},
});

const emit = defineEmits(['update:open']);

/**
 * One row per pack: what the manifest knows, plus what the detail adds.
 *
 * @returns {Array<Object>}
 */
const packs = computed(function ()
{
	const sources = (props.detail && props.detail.sources) || {};
	return PACKS.map(function (pack)
	{
		const source = sources[pack.id] || {};
		return {
			id: pack.id,
			name: pack.name,
			rows: pack.rows,
			licence: pack.licence,
			// Null until the pack's detail lands. Rendered as absent rather than as
			// an empty link, because a link to nowhere is worse than no link.
			licenceUrl: (source.licence && source.licence.url) || null,
			author: source.author || null,
			url: source.url || null,
			evidence: source.evidence || null,
			caveat: source.caveat || null,
			unknown: pack.licence === 'unknown',
		};
	});
});

const total = computed(() => PACKS.reduce((sum, pack) => sum + pack.rows, 0));
</script>

<template>
	<DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<DialogOverlay class="a3d-fade fixed inset-0 z-[550] bg-black/50 backdrop-blur-[2px]" />
			<DialogContent
				class="a3d-pop fixed left-1/2 top-1/2 z-[560] flex max-h-[80vh] w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface shadow-float focus:outline-none">
				<div class="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
					<div>
						<DialogTitle class="text-[14px] font-semibold">Furniture credits</DialogTitle>
						<DialogDescription class="text-ink-faint">
							{{ total }} models from {{ packs.length }} kits. Every one is free to use;
							the terms are below.
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" aria-label="Close">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
					<section
						v-for="pack in packs" :key="pack.id"
						class="rounded-lg border border-line-soft p-3"
						:class="{'border-danger bg-danger-wash': pack.unknown}">
						<div class="flex items-baseline gap-2">
							<h3 class="text-[13px] font-semibold">{{ pack.name }}</h3>
							<span class="num text-[11px] text-ink-faint">{{ pack.rows }} models</span>
							<a
								v-if="pack.url" :href="pack.url" target="_blank" rel="noopener noreferrer"
								class="ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
								Source <ExternalLink :size="11" />
							</a>
						</div>

						<p class="mt-1 text-[12px] text-ink-soft">
							<span v-if="pack.author">By {{ pack.author }} · </span>
							<a
								v-if="pack.licenceUrl" :href="pack.licenceUrl" target="_blank" rel="noopener noreferrer"
								class="text-accent hover:underline">{{ pack.licence }}</a>
							<span v-else>{{ pack.licence }}</span>
						</p>

						<!-- The caveat is the part a licence line cannot carry, and it is the
						     part somebody redistributing this needs. It is written in
						     sources.json beside the evidence for the identification. -->
						<p v-if="pack.caveat" class="mt-2 flex gap-1.5 text-[11px] text-ink-faint">
							<AlertTriangle :size="12" class="mt-0.5 flex-none" />
							<span>{{ pack.caveat }}</span>
						</p>
					</section>
				</div>

				<div class="flex-none border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
					Provenance is recorded per kit in <code>src/catalog/sources.json</code>, with the
					evidence for each identification — nothing here is taken on trust.
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
