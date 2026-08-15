<script setup>
import {PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent} from 'reka-ui';
import {
	FilePlus2, FolderOpen, Save, Undo2, Redo2, Box, Share2,
	Moon, Sun, Keyboard, PanelRight, ChevronDown, Ruler,
} from '@lucide/vue';

import AppTip from './AppTip.vue';
import {LAYOUTS} from '../composables/useLayout.js';
import {THEME_DARK} from '../composables/useTheme.js';

/**
 * The application bar: identity, file, history, layout, and the global toggles.
 *
 * ## What it replaces
 *
 * Two floating button clusters - one over each viewport - that carried the same
 * five file actions twice, because the demo's two panes each needed their own
 * copy while only one was ever on screen. With both panes visible in split mode
 * that duplication becomes visible nonsense, and the actions are not
 * pane-specific anyway: New, Open and Save act on the design, not on a view.
 *
 * So the file actions come out of the viewports and go here, once. What stays
 * floating over a viewport is only what belongs to that viewport - zoom for the
 * plan, cameras for the 3D.
 *
 * ## Grouping
 *
 * Left is the document (what file am I in, what can I undo). Centre is the
 * workspace (what am I looking at). Right is the session (units, theme, help,
 * panels). That ordering is the one people already know from every editor, and
 * the centre group is centred rather than left-packed so the layout switch sits
 * in the same place regardless of how wide the window is.
 */

const props = defineProps({
	layout: {type: String, required: true},
	theme: {type: String, required: true},
	unit: {type: String, required: true},
	units: {type: Array, required: true},
	canUndo: {type: Boolean, default: false},
	canRedo: {type: Boolean, default: false},
	exporting: {type: Boolean, default: false},
	inspectorOpen: {type: Boolean, default: true},
	savedAt: {type: Number, default: null},
});

const emit = defineEmits([
	'new-design', 'open-design', 'save-design', 'save-mesh', 'save-gltf',
	'undo', 'redo', 'set-layout', 'set-unit', 'toggle-theme',
	'toggle-inspector', 'show-shortcuts',
]);

function onFile(event)
{
	const input = event.target;
	if (input.files && input.files.length)
	{
		emit('open-design', input.files[0]);
	}
	// Cleared so picking the same file twice in a row still fires a change.
	input.value = '';
}

/** `savedAt` is a timestamp; the bar shows a clock time, not a duration, so it
 * does not have to re-render every second to stay true. */
function savedLabel(stamp)
{
	if (!stamp)
	{
		return '';
	}
	return new Date(stamp).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
}
</script>

<template>
	<header class="relative z-[300] flex h-12 flex-none items-center gap-1 border-b border-line bg-surface px-2.5">
		<!-- identity -->
		<div class="mr-1 flex items-center gap-2 pr-2">
			<span class="grid h-6 w-6 place-items-center rounded-md bg-accent text-accent-ink">
				<Ruler :size="14" :stroke-width="2.2" />
			</span>
			<span class="hidden text-[13px] font-semibold tracking-tight sm:inline">Architect<span class="text-accent">3D</span></span>
		</div>

		<!-- document -->
		<div class="flex items-center gap-0.5">
			<AppTip label="New layout" keys="mod+n">
				<button type="button" class="btn btn-icon" title="New layout" @click="emit('new-design')">
					<FilePlus2 :size="15" />
				</button>
			</AppTip>
			<AppTip label="Open layout" keys="mod+o">
				<label class="btn btn-icon btn-file" title="Open layout">
					<FolderOpen :size="15" />
					<input type="file" accept=".blueprint3d,application/json" aria-label="Open layout" @change="onFile">
				</label>
			</AppTip>
			<AppTip label="Save layout" keys="mod+s">
				<button type="button" class="btn btn-icon" title="Save layout" @click="emit('save-design')">
					<Save :size="15" />
				</button>
			</AppTip>

			<PopoverRoot>
				<PopoverTrigger as-child>
					<button type="button" class="btn gap-1 px-1.5" title="Export">
						<Share2 :size="15" />
						<ChevronDown :size="12" class="opacity-60" />
					</button>
				</PopoverTrigger>
				<PopoverPortal>
					<PopoverContent
						side="bottom" align="start" :side-offset="6"
						class="a3d-pop z-[600] w-56 rounded-panel border border-line bg-overlay p-1 shadow-float">
						<p class="eyebrow px-2 py-1.5">Export the model</p>
						<button type="button" class="btn w-full justify-start" @click="emit('save-mesh')">
							<Box :size="15" /> Wavefront OBJ
						</button>
						<button
							type="button" class="btn w-full justify-start" :disabled="props.exporting"
							@click="emit('save-gltf')">
							<Share2 :size="15" />
							{{ props.exporting ? 'Exporting glTF…' : 'glTF 2.0' }}
						</button>
					</PopoverContent>
				</PopoverPortal>
			</PopoverRoot>
		</div>

		<div class="mx-1.5 h-5 w-px bg-line" />

		<!-- history -->
		<div class="flex items-center gap-0.5">
			<AppTip label="Undo" keys="mod+z">
				<button
					type="button" class="btn btn-icon" title="Undo"
					:disabled="!props.canUndo" @click="emit('undo')">
					<Undo2 :size="15" />
				</button>
			</AppTip>
			<AppTip label="Redo" keys="mod+shift+z">
				<button
					type="button" class="btn btn-icon" title="Redo"
					:disabled="!props.canRedo" @click="emit('redo')">
					<Redo2 :size="15" />
				</button>
			</AppTip>
		</div>

		<!-- workspace: centred independently of the group widths on either side -->
		<div class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center">
			<div class="segmented pointer-events-auto" role="group" aria-label="Workspace layout">
				<button
					v-for="entry in LAYOUTS" :key="entry.id" type="button"
					class="segment" :class="{'is-active': props.layout === entry.id}"
					:aria-pressed="props.layout === entry.id"
					:title="`${entry.title} (${entry.key})`"
					@click="emit('set-layout', entry.id)">
					{{ entry.label }}
				</button>
			</div>
		</div>

		<div class="ml-auto flex items-center gap-1">
			<span v-if="props.savedAt" class="num hidden text-ink-faint lg:inline" :title="`Draft kept in this browser at ${savedLabel(props.savedAt)}`">
				draft {{ savedLabel(props.savedAt) }}
			</span>

			<select
				class="field-input num h-7 w-[104px] text-left" aria-label="Display unit"
				:value="props.unit" @change="emit('set-unit', $event.target.value)">
				<option v-for="entry in props.units" :key="entry.value" :value="entry.value">{{ entry.label }}</option>
			</select>

			<AppTip :label="props.theme === THEME_DARK ? 'Light theme' : 'Dark theme'">
				<button type="button" class="btn btn-icon" title="Toggle theme" @click="emit('toggle-theme')">
					<Sun v-if="props.theme === THEME_DARK" :size="15" />
					<Moon v-else :size="15" />
				</button>
			</AppTip>
			<AppTip label="Keyboard shortcuts" keys="shift+?">
				<button type="button" class="btn btn-icon" title="Keyboard shortcuts" @click="emit('show-shortcuts')">
					<Keyboard :size="15" />
				</button>
			</AppTip>
			<AppTip :label="props.inspectorOpen ? 'Hide inspector' : 'Show inspector'" keys="mod+.">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': props.inspectorOpen}"
					title="Toggle inspector" @click="emit('toggle-inspector')">
					<PanelRight :size="15" />
				</button>
			</AppTip>
		</div>
	</header>
</template>
