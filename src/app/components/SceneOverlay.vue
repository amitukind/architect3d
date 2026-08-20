<script setup>
// @ts-check
import {Camera, Grid2x2, Sparkles, Lock, LockOpen} from '@lucide/vue';

import AppTip from './AppTip.vue';
import ViewCube from './ViewCube.vue';
import {RENDER_STUDIO, RENDER_CLASSIC} from '../../scripts/blueprint.js';

/**
 * The controls that float over the 3D view.
 *
 * Cameras on the right, where the view cube's left/right buttons line up with
 * the directions they mean; render toggles below them.
 *
 * ## The render style switch
 *
 * `Studio` and `Classic` are the two profiles in `core/render_profile.js`, and
 * the switch is here rather than buried in settings because the difference is
 * entirely visual and the only way to judge it is to look at the model while
 * flipping it. Classic is what the application looked like through 1.0.0 -
 * unlit walls, Phong floors, no tone mapping - and it is kept reachable because
 * the parity work that produced it is the reason anyone can trust this viewer's
 * output at all.
 */

const props = defineProps({
	activeView: {type: String, required: true},
	orthographic: {type: Boolean, default: false},
	wireframe: {type: Boolean, default: false},
	viewLocked: {type: Boolean, default: false},
	renderMode: {type: String, default: RENDER_STUDIO},
});

const emit = defineEmits([
	'switch-view', 'toggle-orthographic', 'toggle-wireframe',
	'toggle-lock', 'set-render-mode',
]);
</script>

<template>
	<div class="pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col items-end justify-start gap-2 p-3">
		<div class="glass pointer-events-auto p-1">
			<ViewCube :active-view="props.activeView" @switch-view="emit('switch-view', $event)" />
		</div>

		<div class="glass pointer-events-auto flex flex-col gap-0.5 p-1">
			<AppTip :label="props.orthographic ? 'Perspective camera' : 'Orthographic camera'" keys="o" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': props.orthographic}"
					:aria-pressed="props.orthographic" title="Switch camera ortho/perspective"
					@click="emit('toggle-orthographic')">
					<Camera :size="15" />
				</button>
			</AppTip>
			<AppTip label="Wireframe" keys="g" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': props.wireframe}"
					:aria-pressed="props.wireframe" title="Switch wireframe mode"
					@click="emit('toggle-wireframe')">
					<Grid2x2 :size="15" />
				</button>
			</AppTip>
			<AppTip :label="props.viewLocked ? 'Unlock orbit' : 'Lock orbit'" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': props.viewLocked}"
					:aria-pressed="props.viewLocked" title="Lock camera rotation"
					@click="emit('toggle-lock')">
					<Lock v-if="props.viewLocked" :size="15" />
					<LockOpen v-else :size="15" />
				</button>
			</AppTip>
		</div>
	</div>

	<div class="pointer-events-none absolute bottom-0 right-0 z-20 p-3">
		<div class="glass pointer-events-auto flex items-center gap-1 p-1">
			<Sparkles :size="14" class="ml-1.5 text-accent" />
			<div class="segmented border-0 bg-transparent p-0" role="group" aria-label="Render style">
				<button
					type="button" class="segment" :class="{'is-active': props.renderMode === RENDER_STUDIO}"
					:aria-pressed="props.renderMode === RENDER_STUDIO"
					title="Lit walls, image-based environment, filmic tone mapping"
					@click="emit('set-render-mode', RENDER_STUDIO)">
					Studio
				</button>
				<button
					type="button" class="segment" :class="{'is-active': props.renderMode !== RENDER_STUDIO}"
					:aria-pressed="props.renderMode !== RENDER_STUDIO"
					title="The unlit look this app shipped with through 1.0.0"
					@click="emit('set-render-mode', RENDER_CLASSIC)">
					Classic
				</button>
			</div>
		</div>
	</div>
</template>
