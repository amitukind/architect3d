<script setup>
import {CircleAlert, CircleCheck, Info, X} from '@lucide/vue';
import {useToasts, TOAST_ERROR, TOAST_SUCCESS} from '../composables/useToasts.js';

/**
 * The notice stack.
 *
 * Replaces a single red bar pinned to the top of the window that showed
 * `io.lastError` and never dismissed itself.
 *
 * Bottom-centre rather than top-right: the top-right corner is where the
 * inspector is, and a notice that covers the panel reporting the thing it is
 * about is the wrong place for it. Newest at the bottom, so a stack grows
 * upward away from the pointer.
 *
 * `role="status"` with `aria-live="polite"` on the region, so a screen reader
 * announces a save without interrupting whatever is being read. Errors are
 * `assertive`, because an error the user does not hear about is one they will
 * act on the assumption of.
 */

const {toasts, dismiss} = useToasts();

const ICONS = {
	[TOAST_ERROR]: CircleAlert,
	[TOAST_SUCCESS]: CircleCheck,
};

const TONE = {
	[TOAST_ERROR]: 'text-danger',
	[TOAST_SUCCESS]: 'text-good',
};

function run(toast)
{
	toast.action.run();
	dismiss(toast.id);
}
</script>

<template>
	<div
		class="pointer-events-none fixed inset-x-0 bottom-11 z-[700] flex flex-col items-center gap-2 px-4"
		role="region" aria-label="Notifications">
		<TransitionGroup
			enter-active-class="transition duration-200 ease-out"
			enter-from-class="translate-y-2 opacity-0"
			leave-active-class="transition duration-150 ease-in absolute"
			leave-to-class="translate-y-1 opacity-0">
			<div
				v-for="toast in toasts" :key="toast.id"
				class="panel pointer-events-auto flex max-w-[520px] items-start gap-2.5 px-3 py-2.5 shadow-float"
				:role="toast.kind === TOAST_ERROR ? 'alert' : 'status'"
				:aria-live="toast.kind === TOAST_ERROR ? 'assertive' : 'polite'">
				<component
					:is="ICONS[toast.kind] || Info" :size="15"
					class="mt-px flex-none" :class="TONE[toast.kind] || 'text-ink-faint'" />

				<div class="min-w-0 flex-1">
					<p class="text-[12px] leading-snug">{{ toast.message }}</p>
					<p v-if="toast.detail" class="num mt-0.5 break-words text-ink-faint">{{ toast.detail }}</p>
				</div>

				<button
					v-if="toast.action" type="button" class="btn btn-primary h-6 flex-none px-2 text-[11px]"
					@click="run(toast)">
					{{ toast.action.label }}
				</button>

				<button
					type="button" class="btn btn-icon h-6 w-6 flex-none"
					aria-label="Dismiss" @click="dismiss(toast.id)">
					<X :size="13" />
				</button>
			</div>
		</TransitionGroup>
	</div>
</template>
