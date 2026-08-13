import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {resolve} from 'node:path';

/**
 * The repository root. `import.meta.dirname` rather than the CommonJS
 * `__dirname` this used to hold: Vite 8
 * warns that its native config loader cannot supply the CommonJS globals, and
 * this file has been ESM since S1.
 */
const ROOT = import.meta.dirname;

/**
 * Vite replaces the rollup 1 + Babel 6 toolchain (migration sprint S1).
 *
 * Two modes, because the project has two outputs:
 *
 *   npm run dev        dev server + HMR. Serves index.html at the repo root -
 *                      the Vue application, as of S6. The pre-S6 jQuery demo
 *                      is served alongside it at /legacy.html so the two can be
 *                      compared; both draw their assets (models, rooms, css,
 *                      fonts) from build/, which stays frozen as the S0
 *                      reference until S9 restructures it into public/.
 *
 *   npm run build      library build: an IIFE exposing the global BP3DJS,
 *                      byte-for-byte replaceable with the old
 *                      build/js/bp3djs.js. Output goes to dist/, NOT build/,
 *                      so the frozen reference bundle is never overwritten.
 *                      Note that the library build takes no Vue plugin and has
 *                      no Vue in it: src/scripts/ is the library and src/app/
 *                      is one consumer of it, and an embedder gets neither Vue
 *                      nor lil-gui.
 *
 * No Babel: the source is already ES2015+ modules and esbuild handles the
 * rest. The rollup-era `replace` plugin injected an ENV constant that nothing
 * in src/ ever read, and the postcss plugin processed a stylesheet nothing
 * imported - both dropped rather than ported.
 */
export default defineConfig(({mode}) => {
	const isLib = mode === 'lib';

	if (isLib)
	{
		return {
			build: {
				outDir: 'dist',
				emptyOutDir: true,
				// Matches the old rollup output: one self-executing bundle that
				// hangs the public API off window.BP3DJS for build/js/app.js.
				lib: {
					entry: resolve(ROOT, 'src/scripts/blueprint.js'),
					name: 'BP3DJS',
					formats: ['iife'],
					fileName: () => 'bp3djs.js',
				},
				sourcemap: true,
				// three r98 is large and not tree-shakeable; the warning is noise.
				chunkSizeWarningLimit: 5000,
				minify: false,
			},
		};
	}

	return {
		root: ROOT,
		// Not 'build'. Vite would copy the whole directory into dist-demo on
		// every demo build, and 58 MB of that is build/vrtest - a standalone
		// A-Frame page nothing references (see the dead-code ledger in
		// docs/roadmap.html section 01). Assets are reached through the
		// <base href="/build/"> in index.html instead, which the dev server
		// serves straight off disk. S9 turns build/ into a real public/ and this
		// goes back to the default.
		publicDir: false,
		plugins: [vue()],
		server: {
			port: 10001,
			open: false,
			fs: {
				// index.html pulls assets from build/ and source from src/.
				allow: [ROOT],
			},
		},
		build: {
			outDir: 'dist-demo',
			emptyOutDir: true,
			sourcemap: true,
			chunkSizeWarningLimit: 5000,
		},
	};
});
