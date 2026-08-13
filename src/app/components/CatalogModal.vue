<script setup>
import {nextTick, onBeforeUnmount, ref, watch} from 'vue';

/**
 * The furniture catalog.
 *
 * Reproduces the "Furniture Inventory" modal (build/index.html:118-216) without
 * Bootstrap's JavaScript: the accordion, the show/hide and the dismiss-on-pick
 * were all `data-toggle` / `data-dismiss` attributes handled by a jQuery plugin.
 * Sections come from the catalog rather than from eight hand-written panels
 * that items.js then filled in by id.
 *
 * Only one section is open at a time, which is what `data-parent="#add-items"`
 * meant.
 */

const props = defineProps({
	sections: {type: Array, required: true},
});

const emit = defineEmits(['close', 'add-item']);

const openSection = ref(props.sections.length ? props.sections[0].id : null);
const dialog = ref(null);

function toggle(id)
{
	openSection.value = (openSection.value === id) ? null : id;
}

function pick(entry)
{
	emit('add-item', entry);
	emit('close');
}

function onKeydown(event)
{
	if (event.key === 'Escape')
	{
		emit('close');
	}
}

watch(dialog, async (element) =>
{
	if (element)
	{
		await nextTick();
		element.focus();
	}
});

window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => {window.removeEventListener('keydown', onKeydown);});
</script>

<template>
	<div class="catalog-backdrop" @click.self="emit('close')">
		<div
			ref="dialog" class="catalog-dialog" role="dialog" aria-modal="true"
			aria-label="Furniture Inventory" tabindex="-1">
			<div class="catalog-header">
				<h4 class="catalog-title">Furniture Inventory</h4>
				<button type="button" class="catalog-close" aria-label="Close" @click="emit('close')">&times;</button>
			</div>

			<div class="catalog-body">
				<div v-for="section in props.sections" :key="section.id" class="catalog-section">
					<button
						type="button" class="catalog-section-heading"
						:aria-expanded="openSection === section.id" @click="toggle(section.id)">
						{{ section.heading }}
						<small>({{ section.items.length }})</small>
					</button>
					<div v-show="openSection === section.id" class="catalog-grid">
						<button
							v-for="entry in section.items" :key="entry.model" type="button"
							class="catalog-item" :title="entry.name" @click="pick(entry)">
							<img :src="entry.image" :alt="entry.name" loading="lazy">
							{{ entry.name }}
						</button>
					</div>
				</div>
			</div>

			<div class="catalog-footer">
				<button type="button" class="btn" @click="emit('close')">Close</button>
			</div>
		</div>
	</div>
</template>
