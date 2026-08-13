import {defineConfig} from 'vite';
import {resolve} from 'node:path';

/**
 * Vite replaces the rollup 1 + Babel 6 toolchain (migration sprint S1).
 *
 * Two modes, because the project has two outputs:
 *
 *   npm run dev        dev server + HMR. Serves index.html at the repo root,
 *                      which is the legacy demo wired to load the library
 *                      FROM SOURCE via src/legacy-bridge.js. Demo assets
 *                      (css, models, rooms, js/lib, js/app.js) are still served
 *                      out of build/ - that directory stays frozen as the S0
 *                      reference until S9 restructures it into public/.
 *
 *   npm run build      library build: an IIFE exposing the global BP3DJS,
 *                      byte-for-byte replaceable with the old
 *                      build/js/bp3djs.js. Output goes to dist/, NOT build/,
 *                      so the frozen reference bundle is never overwritten.
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
					entry: resolve(__dirname, 'src/scripts/blueprint.js'),
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
		root: __dirname,
		publicDir: false,
		server: {
			port: 10001,
			open: false,
			fs: {
				// index.html pulls assets from build/ and source from src/.
				allow: [__dirname],
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
