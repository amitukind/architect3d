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

/**
 * Stop the bundler shipping three's own copies of the codecs (RM-004 B1, B5).
 *
 * `three/examples/jsm/loaders/DRACOLoader.js` opens with five
 * `new URL('../libs/draco/...', import.meta.url)` constants. Vite reads those as
 * asset references and emits the files, which for this project means shipping a
 * SECOND decoder nobody fetches - `public/draco/` already holds the one we
 * serve, and `Scene` calls `setDecoderPath()`, which replaces all five paths
 * before a single byte is decoded.
 *
 * The cost of not doing this is not marginal. Measured, on one import:
 *
 *     library IIFE   226.4 KB -> 715.9 KB gzipped   (+489.5)
 *     demo JS        317.3 KB -> 486.7 KB gzipped   (+169.4)
 *
 * Most of it is `draco_decoder.js`, the 719 KB pure-JS fallback for browsers
 * with no WebAssembly - a population this application does not have, since it
 * needs WebGL. The IIFE has nowhere to put an emitted asset, so it inlines the
 * lot; that is the 489 KB.
 *
 * The rewrite points the defaults at the copies we DO ship, so a consumer who
 * never calls `setDecoderPath()` still resolves something real rather than an
 * empty string. And it throws if it matches nothing: a three upgrade that
 * renames these constants must fail the build loudly, not silently restore half
 * a megabyte to every consumer.
 */
function dropBundledCodecs()
{
	// B5 added the second entry. `KTX2Loader` has the same two constants for the
	// Basis transcoder - 527 KB of WebAssembly and 57 KB of JavaScript - and
	// `public/basis/` already holds the copies we serve, so without this the
	// build ships both and the IIFE inlines them.
	const CODECS = [
		{
			file: 'three/examples/jsm/loaders/DRACOLoader.js',
			pattern: /new URL\(\s*'\.\.\/libs\/draco\/(?:gltf\/)?([\w.]+)'\s*,\s*import\.meta\.url\s*\)\.toString\(\)/g,
			served: 'draco/',
		},
		{
			file: 'three/examples/jsm/loaders/KTX2Loader.js',
			pattern: /new URL\(\s*'\.\.\/libs\/basis\/([\w.]+)'\s*,\s*import\.meta\.url\s*\)\.toString\(\)/g,
			served: 'basis/',
		},
	];

	return {
		name: 'architect3d:drop-bundled-codecs',
		enforce: 'pre',
		transform(code, id)
		{
			const codec = CODECS.find((entry) => id.includes(entry.file));
			if (!codec) { return null; }

			const rewritten = code.replace(codec.pattern, (_, file) => JSON.stringify(codec.served + file));
			if (rewritten === code)
			{
				throw new Error(
					`architect3d:drop-bundled-codecs matched nothing in ${codec.file}. three has ` +
					'changed how it references its bundled decoder; re-check the pattern before ' +
					'shipping, or half a megabyte comes back.',
				);
			}
			return {code: rewritten, map: null};
		},
	};
}

export default defineConfig(({mode}) => {
	const isLib = mode === 'lib';
	const isLibEsm = mode === 'lib-esm';

	if (isLib)
	{
		return {
			plugins: [dropBundledCodecs()],
			build: {
				outDir: 'dist',
				emptyOutDir: true,
				// Matches the old rollup output: one self-executing bundle that
				// hangs the public API off window.BP3DJS for build/js/app.js.
				//
				// three is BUNDLED here, unlike the ESM build below, and that is the
				// point of this artifact: it is the drop-in for a plain <script> tag,
				// where there is no resolver and nothing to peer with. The ESM entry
				// is what a bundler consumer gets.
				lib: {
					entry: resolve(ROOT, 'src/scripts/blueprint.js'),
					name: 'BP3DJS',
					formats: ['iife'],
					fileName: () => 'bp3djs.js',
				},
				sourcemap: true,
				// three r98 is large and not tree-shakeable; the warning is noise.
				chunkSizeWarningLimit: 5000,
				/**
				 * Minified as of RM-003 A4, and the ESM build below deliberately is
				 * not. See the long note in tools/budget.json for how the question
				 * arose; this is the answer.
				 *
				 * The two artifacts have different consumers and want different
				 * treatment. **This one a browser downloads as written** - it is the
				 * drop-in for a plain `<script>` tag, so every byte of it is a byte
				 * an end user waits for. It was 463.7 KB gzipped, of which about 37%
				 * was this project's docblocks: documentation nobody reading it from
				 * a CDN will ever see. Minified it is **220.8 KB**, a 52.4% cut, and
				 * `lib-iife-gzip` came DOWN from 459 KB to 233 KB to match.
				 *
				 * Nothing about the source changes, and `sourcemap: true` above is
				 * what keeps it debuggable. Verified rather than assumed: the
				 * minified bundle parses, exposes all 170 exports, and its
				 * `DesignRuntime` still holds the module-level configuration,
				 * dimensioning and render profile by identity.
				 *
				 * `true` rather than a named minifier: this Vite is on rolldown,
				 * which has its own and does not ship esbuild.
				 */
				minify: true,
			},
		};
	}

	if (isLibEsm)
	{
		return {
			// Harmless here - the ESM build externalises three entirely, so
			// DRACOLoader never enters this bundle. Present so the three branches
			// cannot drift, and so the upgrade tripwire fires wherever three moves.
			plugins: [dropBundledCodecs()],
			build: {
				outDir: 'dist',
				// The IIFE build ran first and this must not delete it.
				emptyOutDir: false,
				lib: {
					entry: resolve(ROOT, 'src/scripts/blueprint.js'),
					formats: ['es'],
					fileName: () => 'architect3d.js',
				},
				sourcemap: true,
				chunkSizeWarningLimit: 5000,
				/**
				 * Minified, and this reverses a decision A4 made and A5, B1 and B4
				 * each deferred rather than revisited.
				 *
				 * ## The argument that kept it unminified, and why it was wrong
				 *
				 * A4 minified the IIFE and left this one alone, on the grounds that
				 * "what those comments buy is the JSDoc a typed consumer sees on
				 * hover, which is the documentation for a library that ships no
				 * .d.ts hand-written by anybody."
				 *
				 * The premise is false, and checking it takes one command.
				 * `package.json` sets `types` to `./dist/types/blueprint.d.ts`, and
				 * `npm run types:emit` generates that whole tree from the same
				 * source - carrying the JSDoc with it. `dist/types/core/asset_resolver.d.ts`
				 * has 190 lines of comment in it. An editor reads hover text from
				 * the declaration file, never from the bundle, so minifying here
				 * costs a typed consumer nothing at all.
				 *
				 * What it was actually buying was a readable `node_modules`, which
				 * is worth something and is not worth 65 KB gzipped on every
				 * install - and the sourcemap is still emitted for anyone who needs
				 * to read it.
				 *
				 * ## Why it took four sprints
				 *
				 * Because the limit kept being raised instead. A5 left it at 0.8%
				 * headroom and predicted the next docblock would trip it; B1's did,
				 * and raised it; B5 raised it again. Four consecutive raises for a
				 * line that had stopped measuring code and started measuring
				 * documentation - which is exactly the diagnosis A4 wrote down
				 * about the IIFE before fixing it, applied to the file it did not
				 * fix.
				 */
				minify: true,
				rollupOptions: {
					/**
					 * three and bezier-js stay OUT of this bundle (RM-002 R-06).
					 *
					 * They are peerDependencies, so the consumer already has them and
					 * their copy is the one that must be used. Bundling ours would give
					 * a page two three.js instances: `instanceof` silently false across
					 * the boundary, two WebGL renderer registries, and several hundred
					 * kB paid twice. That is the exact failure the S4 notes describe
					 * from the old bundled loader repacks, and it would have been
					 * reintroduced one level up.
					 *
					 * Subpaths are matched with a regex because the addons are imported
					 * as `three/addons/...`, which a bare string in `external` does not
					 * cover.
					 */
					external: [/^three(\/.*)?$/, /^bezier-js(\/.*)?$/],
				},
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
		plugins: [vue(), tailwind(), dropBundledCodecs()],
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
			/**
			 * A second entry, and it must land unhashed at the deploy root
			 * (RM-013 K3).
			 *
			 * A service worker's URL is both its identity and its scope. Hashed, a
			 * deploy would register a *different* worker rather than updating the
			 * one already installed, and a worker at `assets/sw-<hash>.js` would
			 * control `assets/` and nothing else - which is every URL the
			 * application does not serve.
			 *
			 * Built rather than dropped in `public/` so it can `import` the policy
			 * modules that the headless suite tests. A copied file would have meant
			 * either a second copy of those rules or a hand-rolled inliner, and the
			 * first is how two implementations of one decision start.
			 */
			rollupOptions: {
				input: {
					index: resolve(ROOT, 'index.html'),
					sw: resolve(ROOT, 'src/app/sw.js'),
				},
				output: {
					entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
				},
			},
		},
	};
});
