import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
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
 *                      the Vue application - with public/ (models, rooms) at
 *                      the site root beside it.
 *
 *   npm run build      library build: an IIFE exposing the global BP3DJS,
 *                      byte-for-byte replaceable with the old
 *                      build/js/bp3djs.js that the pre-S6 demo loaded. Output
 *                      goes to dist/. Note that the library build takes no Vue
 *                      plugin and has no Vue in it: src/scripts/ is the library
 *                      and src/app/ is one consumer of it, and an embedder gets
 *                      neither Vue nor the application shell.
 *
 *   npm run build:demo the application, into dist-demo/. This is what the
 *                      GitHub Pages workflow deploys, with
 *                      --base=/architect3d/ so the hashed asset URLs carry the
 *                      repository sub-path (see index.html for why the runtime
 *                      asset URLs need no such help).
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
		// The default, and only true since S9. It used to be `false`, because
		// the asset root was build/ - 91 MB of frozen legacy demo, of which
		// Vite would have copied all 91 MB into dist-demo on every build, 58 MB
		// of it a standalone A-Frame page nothing referenced. public/ holds the
		// 19 MB the running application actually asks for and nothing else; the
		// sources those were produced from live in asset-pipeline/, outside the
		// deployed tree.
		publicDir: 'public',
		// Tailwind is listed here and not in the `isLib` branch above on purpose.
		// It is a CSS-only plugin and the library build has no stylesheet at all -
		// src/scripts/ imports no CSS, which is what lets an embedder drop
		// dist/bp3djs.js into a page with its own design system and get no styling
		// of ours. The whole UI stack (Tailwind, Reka UI, lucide, VueUse) is a
		// devDependency for the same reason: `files` in package.json publishes
		// src/scripts alone, so nothing a consumer installs could import them.
		plugins: [vue(), tailwind()],
		server: {
			port: 10001,
			open: false,
			fs: {
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
