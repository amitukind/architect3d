<script setup>
// @ts-check
import {Eye, Copy} from '@lucide/vue';

/**
 * You are looking at somebody else's design (RM-013 K2).
 *
 * ## Why a bar and not a badge
 *
 * Because the state is not decorative. Every tool is gone, the inspector is
 * gone, and nothing on the plan responds to a drag - a person who does not know
 * *why* will conclude the application is broken, and they will be right to. So
 * the bar says what is happening, in the same place every time, and carries the
 * only way out.
 *
 * ## The only way out is a copy
 *
 * There is no "edit this". Making a copy puts the design in the library as a
 * new project and clears the link out of the URL, which keeps the two designs
 * two things: the sender's is untouched, and a reload before the copy re-opens
 * what was actually sent rather than half an edit of it.
 */

defineProps({
	busy: {type: Boolean, default: false},
});

const emit = defineEmits(['adopt', 'leave']);
</script>

<template>
	<div class="flex flex-none items-center gap-2 border-b border-line bg-overlay px-3 py-1.5 text-[12px]">
		<Eye :size="14" class="flex-none text-ink-soft" />
		<span class="min-w-0 truncate text-ink-soft">
			You are viewing a shared design. Nothing you do here changes the original.
		</span>
		<button type="button" class="btn ml-auto flex-none gap-1.5" :disabled="busy" @click="emit('adopt')">
			<Copy :size="14" /> Keep a copy
		</button>
		<button type="button" class="btn flex-none" :disabled="busy" @click="emit('leave')">Close</button>
	</div>
</template>
