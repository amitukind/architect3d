/**
 * Bridges the ES-module library to the legacy global-script demo.
 *
 * build/js/app.js, items.js and items_gltf.js are 2020-era scripts that expect
 * a `BP3DJS` global, exactly as the old rollup IIFE bundle provided. Rewriting
 * them is sprint S6 (the Vue application); until then this three-line shim lets
 * the untouched demo run against live ES-module source under the Vite dev
 * server, with HMR.
 *
 * Ordering is safe: this is a module script, so it is deferred and executes
 * before DOMContentLoaded, while every legacy script body is wrapped in
 * jQuery's $(document).ready. The global is therefore always in place before
 * any consumer touches it.
 *
 * This file is DEV-ONLY. The production library build (`npm run build`, Vite
 * lib mode) emits the same global from src/scripts/blueprint.js directly and
 * never includes this module.
 */
import * as BP3DJS from './scripts/blueprint.js';

window.BP3DJS = BP3DJS;
