<script setup>
// @ts-check
import {injectCameraViews} from '../composables/useCameraViews.js';
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

/**
 * The camera composable, injected (RM-020 S-5).
 *
 * Four of this component's props and four of its events were `useCameraViews`
 * relayed through `App.vue`, including three toggles that existed only to send
 * back the negation of a value it had just been handed. `renderMode` stays a
 * prop: it belongs to the shell's render-profile switch, not to the camera.
 */
const camera = injectCameraViews();

const props = defineProps({
	renderMode: {type: String, default: ''},
});

const emit = defineEmits(['set-render-mode']);
</script>

<template>
	<div class="pointer-events-none absolute inset-y-0 right-0 z-20 flex flex-col items-end justify-start gap-2 p-3">
		<div class="glass pointer-events-auto p-1">
			<ViewCube :active-view="camera.activeView.value" @switch-view="camera.switchView($event)" />
		</div>

		<div class="glass pointer-events-auto flex flex-col gap-0.5 p-1">
			<AppTip :label="camera.orthographic.value ? 'Perspective camera' : 'Orthographic camera'" keys="o" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': camera.orthographic.value}"
					:aria-pressed="camera.orthographic.value" title="Switch camera ortho/perspective"
					@click="camera.setOrthographic(!camera.orthographic.value)">
					<Camera :size="15" />
				</button>
			</AppTip>
			<AppTip label="Wireframe" keys="g" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': camera.wireframe.value}"
					:aria-pressed="camera.wireframe.value" title="Switch wireframe mode"
					@click="camera.setWireframe(!camera.wireframe.value)">
					<Grid2x2 :size="15" />
				</button>
			</AppTip>
			<AppTip :label="camera.viewLocked.value ? 'Unlock orbit' : 'Lock orbit'" side="left" :delay="0">
				<button
					type="button" class="btn btn-icon" :class="{'is-active': camera.viewLocked.value}"
					:aria-pressed="camera.viewLocked.value" title="Lock camera rotation"
					@click="camera.setViewLocked(!camera.viewLocked.value)">
					<Lock v-if="camera.viewLocked.value" :size="15" />
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
