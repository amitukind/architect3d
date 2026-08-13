import {createApp} from 'vue';
import App from './App.vue';
import './styles/app.css';

/**
 * Entry point for the Vue application (sprint S6).
 *
 * This is the whole of what used to be `$(document).ready(...)`: the shell
 * mounts, and App.vue constructs the library once its two viewports exist.
 *
 * The library is imported as ES modules, not read off a `window.BP3DJS`
 * global. `src/legacy-bridge.js` still publishes that global for the frozen
 * demo under build/, and the lib build still emits it for embedders; neither
 * is involved here.
 */
createApp(App).mount('#app');
