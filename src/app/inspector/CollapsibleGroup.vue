<script setup>
import {ref} from 'vue';
import {ChevronRight} from '@lucide/vue';

/**
 * A titled, collapsible group of fields (sprint S7).
 *
 * The structural piece dat.GUI's folders provided. Kept as a plain
 * button + region rather than <details>, so the open state is Vue's and a
 * parent can decide what starts open - which the settings panel does, matching
 * the folders the demo opened at boot.
 */

const props = defineProps({
	title: {type: String, required: true},
	open: {type: Boolean, default: false},
});

const expanded = ref(props.open);
</script>

<template>
	<section class="group" :class="{'is-open': expanded}">
		<button
			type="button" class="group-title" :aria-expanded="expanded"
			@click="expanded = !expanded">
			<ChevronRight class="group-caret" :size="13" aria-hidden="true" />
			{{ props.title }}
		</button>
		<div v-show="expanded" class="group-body">
			<slot />
		</div>
	</section>
</template>
