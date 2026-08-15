import {createApp} from 'vue';
import App from './App.vue';
import './styles/app.css';

import {setRenderProfile, RENDER_STUDIO} from '../scripts/blueprint.js';
import {applyTheme} from './composables/useTheme.js';

/**
 * Entry point for the Vue application.
 *
 * Two things happen before `mount`, and both have to.
 *
 * ## The render profile
 *
 * `Edge` and `Floor` choose their material *class* while building, and
 * `BlueprintJS` builds the whole scene in its constructor - so the profile has
 * to be set before App.vue's onMounted runs, not inside it. Switching later is
 * supported (`Main.applyRenderProfile`, which is what the Studio/Classic toggle
 * calls) but it costs a full rebuild of every wall and floor; doing it at boot
 * costs nothing.
 *
 * The library defaults to `classic` and this is the line that opts out. That
 * asymmetry is deliberate: an embedder who upgrades gets the appearance they
 * had, and the application - which has no parity obligations - gets the
 * appearance it wants.
 *
 * ## The theme
 *
 * `applyTheme` stamps `data-theme` on <html>. app.css already has a
 * `prefers-color-scheme` block so the first paint is not wrong, but the
 * attribute is what a stored preference needs and it should be on the element
 * before the first component renders rather than one frame after.
 *
 * It runs again inside App.vue's onMounted, with the store, because the *canvas*
 * half of the theme cannot be pushed into a library that does not exist yet.
 */

setRenderProfile(RENDER_STUDIO);
applyTheme();

createApp(App).mount('#app');
