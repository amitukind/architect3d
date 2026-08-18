<script setup>
// @ts-check
import {TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipArrow} from 'reka-ui';
import {keyChips} from '../composables/useShortcuts.js';

/**
 * A tooltip, with room for the shortcut that does the same thing.
 *
 * ## Why not `title`
 *
 * The whole interface used the native `title` attribute, which has three
 * problems for a tool this dense: the delay is a browser preference and is
 * typically around a second, it cannot be styled so it arrives as a white OS
 * rectangle in the middle of a dark studio, and it cannot contain anything but
 * a string - so a keyboard shortcut has to be spelled into the sentence.
 *
 * Reka's tooltip fixes all three and, more importantly, gets the accessibility
 * right: the trigger is described by the content, the content is removed from
 * the tab order, and Escape closes it. The old markup kept `title` *and*
 * `aria-label` on every button, which is a double announcement in most screen
 * readers.
 *
 * `title` is still passed through as a fallback so the tooltip text survives
 * anywhere the portal cannot render - which includes the test suite, where
 * assertions on button identity read the attribute.
 */

const props = defineProps({
	/** The tooltip text. */
	label: {type: String, required: true},
	/** A binding string from the shortcut map, e.g. 'mod+z'. Rendered as chips. */
	keys: {type: String, default: ''},
	side: {
		/**
		 * Reka's `TooltipContent` takes a literal union, not a string, so a bare
		 * `type: String` cannot be handed to it. Naming the four sides here is
		 * also the honest declaration: they are the only values that work
		 * (RM-004 B3).
		 *
		 * Written as a cast on the constructor rather than as a `@type` above it:
		 * `StringConstructor` is not assignable to a `PropType` of a literal
		 * union, so the annotation has to replace the inferred type rather than
		 * sit beside it.
		 */
		type: /** @type {import('vue').PropType<'top'|'right'|'bottom'|'left'>} */ (String),
		default: 'bottom',
	},
	/** Milliseconds before opening. Zero for the tool rail, where the pointer is
	 * moving between adjacent buttons and a delay makes the whole rail feel
	 * unresponsive. */
	delay: {type: Number, default: 260},
});
</script>

<template>
	<TooltipRoot :delay-duration="props.delay">
		<TooltipTrigger as-child>
			<slot :title="props.label" />
		</TooltipTrigger>
		<TooltipPortal>
			<TooltipContent
				:side="props.side" :side-offset="6"
				class="a3d-fade z-[600] flex items-center gap-2 rounded-lg border border-line bg-overlay px-2.5 py-1.5 text-[11px] text-ink shadow-float select-none">
				<span>{{ props.label }}</span>
				<span v-if="props.keys" class="flex gap-1">
					<kbd v-for="chip in keyChips(props.keys)" :key="chip">{{ chip }}</kbd>
				</span>
				<TooltipArrow class="fill-line" :width="9" :height="4" />
			</TooltipContent>
		</TooltipPortal>
	</TooltipRoot>
</template>
