<script setup>
import {ref} from 'vue';

/**
 * The 3D pane. `Main` appends its own canvas to this element and installs a
 * ResizeObserver on it, so all this component owns is a correctly sized box and
 * a stable reference to it.
 *
 * As with FloorplannerView, construction happens in App.vue - see the note
 * there.
 */

const container = ref(null);

defineExpose({container});
</script>

<template>
	<div id="viewer" ref="container" class="back">
		<slot />
	</div>
</template>
