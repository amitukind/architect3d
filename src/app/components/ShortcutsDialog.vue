<script setup>
// @ts-check
import {computed} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {X} from '@lucide/vue';
import {keyChips} from '../composables/useShortcuts.js';

/**
 * The keyboard reference.
 *
 * Built from the live binding table rather than from a hand-written list, so it
 * cannot drift: a shortcut that exists appears here, one that is removed
 * disappears, and the label shown is the label the binding declares.
 *
 * Grouped by the binding's own `group` field, in first-seen order - which is
 * the order the map is written in, and that order is deliberate (document,
 * then tools, then view). Bindings marked `alias` are left out: Ctrl+Y is a
 * second key for Redo and Backspace a second key for Delete, and listing each
 * of them twice makes the sheet longer without making it more informative.
 *
 * The demo's equivalent was five lines of `\n`-joined text in the `title`
 * attribute of an info button, which is to say it was invisible to anyone who
 * did not hover the right 28 pixels.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	/** The same array useShortcuts is driven by. */
	bindings: {
		/**
		 * The typedef already existed in useShortcuts.js; this is what connects it.
		 *
		 * @type {import('vue').PropType<Array<import('../composables/useShortcuts.js').Binding>>}
		 */
		type: Array,
		required: true,
	},
});

const emit = defineEmits(['update:open']);

const groups = computed(function ()
{
	const order = [];
	const byGroup = new Map();

	props.bindings.filter((binding) => !binding.alias).forEach(function (binding)
	{
		if (!byGroup.has(binding.group))
		{
			byGroup.set(binding.group, []);
			order.push(binding.group);
		}
		byGroup.get(binding.group).push(binding);
	});

	return order.map((name) => ({name: name, bindings: byGroup.get(name)}));
});
</script>

<template>
	<DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<DialogOverlay class="a3d-fade fixed inset-0 z-[550] bg-black/50 backdrop-blur-[2px]" />
			<DialogContent
				class="a3d-pop fixed left-1/2 top-1/2 z-[560] flex max-h-[80vh] w-[620px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface shadow-float focus:outline-none">
				<div class="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
					<div>
						<DialogTitle class="text-[14px] font-semibold">Keyboard shortcuts</DialogTitle>
						<DialogDescription class="text-ink-faint">
							Shortcuts are suppressed while you are typing in a field.
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" aria-label="Close">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="grid flex-1 grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto p-4 sm:grid-cols-2">
					<section v-for="group in groups" :key="group.name">
						<h3 class="eyebrow mb-2">{{ group.name }}</h3>
						<dl class="flex flex-col gap-1.5">
							<div v-for="binding in group.bindings" :key="binding.keys" class="flex items-baseline gap-3">
								<dt class="min-w-0 flex-1 truncate text-[12px] text-ink-soft">{{ binding.label }}</dt>
								<dd class="flex flex-none gap-1">
									<kbd v-for="chip in keyChips(binding.keys)" :key="chip">{{ chip }}</kbd>
								</dd>
							</div>
						</dl>
					</section>
				</div>

				<div class="flex-none border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
					Hold <kbd>Shift</kbd> while drawing to snap to the axis and the grid.
					Double-click a corner to set its elevation.
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
