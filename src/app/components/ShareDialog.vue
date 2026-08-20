<script setup>
// @ts-check
import {ref, watch} from 'vue';
import {DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose} from 'reka-ui';
import {X, Copy, Link2} from '@lucide/vue';

/**
 * A design as a link (RM-013 K2, finding Y-7).
 *
 * ## The link is on screen, always
 *
 * Not behind a Copy button that may or may not have worked. A browser can
 * decline the clipboard for reasons that have nothing to do with this
 * application - no permission, no secure context, no user gesture it recognised
 * - and a dialog that had said "Copied!" into thin air is worse than one that
 * shows the thing and lets somebody take it. So the field is the feature and
 * the button is the shortcut.
 *
 * ## The refusal states a number
 *
 * `MAX_LINK_CHARS` is a policy rather than a technical ceiling - Chromium kept
 * a two-million-character fragment - so "too long" would be an unexplained
 * house rule. The count and the limit are both shown, beside the one thing that
 * always works: Save layout.
 */

const props = defineProps({
	open: {type: Boolean, default: false},
	link: {
		/** @type {import('vue').PropType<?string>} */
		type: String,
		default: null,
	},
	chars: {type: Number, default: 0},
	limit: {type: Number, default: 8000},
	refusal: {
		/** @type {import('vue').PropType<?string>} */
		type: String,
		default: null,
	},
	busy: {type: Boolean, default: false},
	available: {type: Boolean, default: true},
	/**
	 * Put the link on the clipboard, and say whether it worked.
	 *
	 * A function prop rather than an emit, because the answer has to come back:
	 * `emit` returns nothing in Vue 3, so a button wired that way could only ever
	 * report what it attempted. The distinction matters here - a browser
	 * declining the clipboard is an ordinary outcome with its own behaviour.
	 *
	 */
	copy: {
		// A cast rather than an annotation: `PropType<F>` for a function type wants
		// the constructor asserted into it, which the `type:` line cannot express
		// on its own.
		type: /** @type {import('vue').PropType<function(): Promise<boolean>>} */ (Function),
		required: true,
	},
});

const emit = defineEmits(['update:open', 'save-file']);

/** Set for a moment after a copy that worked, so the button can say so. */
const copied = ref(false);
/** @type {import('vue').Ref<?HTMLInputElement>} */
const field = ref(null);
let timer = null;

watch(() => props.open, function (isOpen)
{
	copied.value = false;
	if (isOpen)
	{
		clearTimeout(timer);
	}
});

async function onCopy()
{
	copied.value = await props.copy() === true;
	if (!copied.value && field.value)
	{
		// The browser said no. Select the text, which is the next thing a person
		// was going to do with their hands.
		field.value.focus();
		field.value.select();
	}
	clearTimeout(timer);
	timer = setTimeout(() => {copied.value = false;}, 2400);
}

/**
 * Select the whole link when the field is focused.
 *
 * Narrowed in a function rather than written as `$event.target.select()` in the
 * template: an `EventTarget` declares no `select`, and the cast the template
 * would need is the kind RM-005 C2 replaced with real narrowing.
 *
 * @param {Event} event
 */
function selectAll(event)
{
	const input = event.target;
	if (input instanceof HTMLInputElement)
	{
		input.select();
	}
}
</script>

<template>
	<DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
		<DialogPortal>
			<DialogOverlay class="a3d-fade fixed inset-0 z-[550] bg-black/50 backdrop-blur-[2px]" />
			<DialogContent
				class="a3d-pop fixed left-1/2 top-1/2 z-[560] flex w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-line bg-surface shadow-float focus:outline-none">
				<div class="flex flex-none items-start gap-2 border-b border-line px-4 py-3">
					<div class="min-w-0">
						<DialogTitle class="text-[14px] font-semibold">Share this design</DialogTitle>
						<DialogDescription class="text-ink-faint">
							The whole design travels in the link. Nothing is uploaded, and there is no server to upload it to.
						</DialogDescription>
					</div>
					<DialogClose as-child>
						<button type="button" class="btn btn-icon ml-auto" aria-label="Close">
							<X :size="15" />
						</button>
					</DialogClose>
				</div>

				<div class="flex flex-col gap-3 p-4">
					<p v-if="!props.available" class="rounded-panel border border-line bg-overlay p-3 text-[12px] text-ink-soft">
						This browser cannot compress a design into a link.
						<button type="button" class="link" @click="emit('save-file')">Save it as a file</button> instead.
					</p>

					<template v-else-if="props.refusal === 'too-long'">
						<p class="rounded-panel border border-line bg-overlay p-3 text-[12px] text-ink-soft">
							This design is <strong class="text-ink">{{ props.chars.toLocaleString() }}</strong> characters
							compressed, and links hold <strong class="text-ink">{{ props.limit.toLocaleString() }}</strong>.
							Longer ones survive some inboxes and not others, so this one goes as a file.
						</p>
						<button type="button" class="btn self-start" @click="emit('save-file')">Save layout instead</button>
					</template>

					<template v-else-if="props.link">
						<label class="flex flex-col gap-1">
							<span class="eyebrow">Link</span>
							<span class="flex gap-1.5">
								<input
									ref="field" :value="props.link" readonly aria-label="Shareable link"
									class="min-w-0 flex-1 rounded-md border border-line bg-overlay px-2 py-1.5 font-mono text-[11px]"
									@focus="selectAll">
								<button type="button" class="btn flex-none gap-1.5" :disabled="props.busy" @click="onCopy">
									<Copy :size="14" />
									{{ copied ? 'Copied' : 'Copy' }}
								</button>
							</span>
						</label>
						<p class="text-[11px] text-ink-faint">
							<Link2 :size="12" class="inline align-[-2px]" />
							{{ props.chars.toLocaleString() }} of {{ props.limit.toLocaleString() }} characters.
							Whoever opens it sees the design and can keep a copy; yours is unaffected.
						</p>
					</template>

					<p v-else class="text-[12px] text-ink-soft">Making the link&hellip;</p>
				</div>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>
