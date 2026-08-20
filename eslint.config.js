import js from '@eslint/js';
import vue from 'eslint-plugin-vue';

/**
 * ESLint 10 flat config, replacing the ESLint 4 .eslintrc.json (migration S1).
 *
 * The rule set is deliberately the same one the project already had - browser
 * globals, eslint:recommended, single quotes, semicolons, unix linebreaks,
 * console allowed, tab indentation unenforced. S1 changed the toolchain, not
 * the house style, and that still holds.
 *
 * S6 added the single-file components under src/app/. They are linted with
 * eslint-plugin-vue's `flat/recommended`, which is what catches the mistakes
 * that only exist in a template - an unused component import, a `v-for`
 * without a key, a prop mutated in place. Without it the whole application
 * layer would be invisible to the linter, since a plain JS parser cannot read
 * a .vue file at all.
 */
export default [
	{
		ignores: [
			'dist/**',
			'dist-demo/**',
			'public/**',         // deployed assets - one .gltf, no source
			'asset-pipeline/**', // conversion inputs and records, not served
			'index.html',
			'node_modules/**',
			'tools/parity/**',   // capture output: served copies of every engine's asset root

			// VitePress output and cache, not docs/** wholesale: the config
			// beside them IS source and is linted below.
			'docs/.vitepress/dist/**',
			'docs/.vitepress/cache/**',
		],
	},

	js.configs.recommended,

	{
		// Library source: browser environment, ES modules.
		files: ['src/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				console: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				Image: 'readonly',
				XMLHttpRequest: 'readonly',
				FileReader: 'readonly',
				Blob: 'readonly',
				URL: 'readonly',
				// Added by RM-011 H3. A 4096 x 2048 panorama is too long to hand to
				// an anchor as a data URL, so `useDesignIO` decodes it to bytes.
				atob: 'readonly',
				performance: 'readonly',
				alert: 'readonly',
				prompt: 'readonly',
				location: 'readonly',
				ResizeObserver: 'readonly',
				// Added by RM-005 C2. `resolveCanvas` checks `instanceof` rather than
				// casting, so a caller handing the floorplanner a <div> gets a message
				// naming the problem instead of `getContext is not a function`.
				HTMLCanvasElement: 'readonly',
				// Added by RM-003 A5. `fetch` is how the asset resolver warms the
				// HTTP cache and how the application collects its manifest;
				// `TextEncoder` is what makes a byte count a byte count rather than
				// a UTF-16 code-unit count, which matters when the number is being
				// compared against a storage quota. Both are in every environment
				// this runs in, jsdom included.
				fetch: 'readonly',
				TextEncoder: 'readonly',
				// The draft store, also A5. `indexedDB` is reached through `window`
				// everywhere in src/, but the IDB event and cursor types appear in
				// annotations.
				indexedDB: 'readonly',
				URLSearchParams: 'readonly',
				// Added by RM-013 K2. A design in a link is deflated by the platform
				// rather than by a dependency - `CompressionStream` is in every
				// browser this project targets, and its gzip output was measured
				// byte-identical to Node's - and `btoa`/`Response` are what turn the
				// bytes into something a person can paste. `crypto` is the zip
				// bundle's CRC-32 seed source, `Uint8Array` and friends are already
				// ambient.
				CompressionStream: 'readonly',
				DecompressionStream: 'readonly',
				TextDecoder: 'readonly',
				Response: 'readonly',
				btoa: 'readonly',
				// RM-013 K3. `src/app/sw.js` runs in a worker scope with no `window`
				// and no `document`; `self` is what it has instead, and everything it
				// reaches for hangs off that rather than being taken from here.
				self: 'readonly',
				caches: 'readonly',
				Request: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
			'linebreak-style': ['error', 'unix'],
			quotes: ['error', 'single'],
			semi: ['error', 'always'],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],

			// Warnings, not errors, and deliberately so.
			//
			// Both rules are new since the ESLint 4 config this replaces, and both
			// fire only on 2020-era library code (24 and 4 occurrences). Silencing
			// them would hide real cleanup; making them errors would force source
			// edits under time pressure.
			//
			// The post-migration cleanup looked at all 28 and left them, because
			// several are not style at all. utils.js:346-347 are the linter
			// pointing straight at a PRESERVED BUG: pointInPolygon takes a `start`
			// object where it used to take two coordinates, so `startX` is never
			// undefined and the block that would compute it is unreachable. Room
			// detection depends on the current output, so clearing that warning
			// means changing what rooms the app finds. The rest are C-style
			// declarations initialised to a placeholder and immediately
			// overwritten - harmless, and each one should be fixed with the
			// function it lives in rather than in a sweep.
			'no-useless-assignment': 'warn',
			'no-prototype-builtins': 'warn',
		},
	},

	...vue.configs['flat/recommended'],

	{
		// Single-file components. Same house style as the rest of src/.
		//
		// The globals list grew when the shell was rebuilt: the components now
		// schedule work against the frame clock (zoom-to-fit has to wait for
		// layout), read the pointer through PointerEvent APIs, and time their own
		// toasts. These are the browser APIs a component may reach for; anything
		// beyond them belongs in a composable.
		files: ['src/**/*.vue'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				console: 'readonly',
				navigator: 'readonly',
				HTMLElement: 'readonly',
				// Added by RM-008 E2: the plan overlay narrows an input event's target
				// rather than asserting `.value` onto an EventTarget.
				HTMLInputElement: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				Date: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
			'linebreak-style': ['error', 'unix'],
			quotes: ['error', 'single'],
			semi: ['error', 'always'],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],

			// The templates are indented with tabs like everything else, and
			// eslint-plugin-vue's default is two spaces. Matching the file rather
			// than reformatting every template to a different convention from the
			// script block above it.
			'vue/html-indent': ['error', 'tab'],
			// A closing bracket on its own line is the plugin's default; these
			// templates keep it on the last attribute line, which reads better for
			// the long lists of @event bindings in App.vue.
			'vue/html-closing-bracket-newline': 'off',
			'vue/max-attributes-per-line': 'off',
			'vue/singleline-html-element-content-newline': 'off',
		},
	},

	{
		// The inspector panels (S7).
		//
		// `vue/no-mutating-props` exists to stop a child writing to its parent's
		// reactive state, which is a real bug when the prop is data Vue owns. The
		// props here are not that: each one is a live model object - a Corner, a
		// Room, an Item - deliberately passed raw (see the markRaw note in
		// useBlueprint), and writing to it is what an inspector *is*. There is no
		// parent state to desynchronise, and the objects broadcast their own
		// changes through EventDispatcher.
		//
		// Scoped to this directory rather than switched off globally, and
		// deliberately not worked around by aliasing the prop to a local const -
		// that would satisfy the linter without changing anything real.
		files: ['src/app/inspector/**/*.vue'],
		rules: {
			'vue/no-mutating-props': 'off',
		},
	},

	{
		// The browser tier (RM-002 P5). These run inside chromium, not Node, so
		// they get the DOM rather than `process` - a test here reaching for a Node
		// global is a mistake the linter should catch, which is why this is a
		// separate block rather than the Node one widened.
		files: ['tests/browser/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				// Added by RM-008 E1, whose frame-budget test times a draw. This tier
				// is the only one with a real rasteriser, so it is the only place a
				// frame cost can honestly be measured.
				performance: 'readonly',
				navigator: 'readonly',
				console: 'readonly',
				location: 'readonly',
				fetch: 'readonly',
				setTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				clearTimeout: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				Image: 'readonly',
				Uint8Array: 'readonly',
				DataView: 'readonly',
				TextDecoder: 'readonly',
				// Added by RM-013 K2. A design travels in the fragment, so the tier
				// that proves it has to put one there and read it back;
				// `CompressionStream` is the platform the codec is built on, and this
				// is the only tier where it is the browser's own.
				TextEncoder: 'readonly',
				history: 'readonly',
				CompressionStream: 'readonly',
				DecompressionStream: 'readonly',
				URL: 'readonly',
				PointerEvent: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
			quotes: ['error', 'single'],
			semi: ['error', 'always'],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
		},
	},

	{
		// The one tool whose source is partly evaluated IN a page (RM-013 K3).
		//
		// `tools/check-offline.mjs` hands real function bodies to
		// `page.evaluate`, so ESLint parses browser code inside a Node file - the
		// thumbnail and icon tools avoid this only by building their page as a
		// template string, which ESLint never reads as JavaScript.
		//
		// A block of its own rather than widening the Node one below, because the
		// note there is right: a tool reaching for `navigator` is normally a
		// mistake, and this is the single file where it is the point.
		files: ['tools/check-offline.mjs'],
		languageOptions: {
			globals: {
				navigator: 'readonly',
				performance: 'readonly',
				document: 'readonly',
				requestAnimationFrame: 'readonly',
				PointerEvent: 'readonly',
				// Node's own too, and used on both sides of the seam here.
				URL: 'readonly',
			},
		},
	},

	{
		// Tests and tooling: Node environment.
		files: ['tests/**/*.js', 'tools/**/*.mjs', '*.config.js', '*.config.mjs', 'docs/.vitepress/*.mjs'],
		// tests/browser/ is excluded so that the block above is the ONLY one that
		// applies to it. Flat config merges `globals` from every matching entry
		// rather than letting the last one win, so without this the browser tests
		// would quietly also get `process` and `Buffer` - and the whole point of
		// giving them their own block is that reaching for one is a mistake.
		ignores: ['tests/browser/**'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				console: 'readonly',
				process: 'readonly',
				Buffer: 'readonly',
				__dirname: 'readonly',
				document: 'readonly',
				window: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				// Node's own since 18, and the only network client in tools/.
				// `tools/fetch-materials.mjs` is the one that needs it; declared
				// here rather than per-file because a second acquisition tool
				// should not have to rediscover this line.
				fetch: 'readonly',
				// RM-011 H3. `useDesignIO` decodes a panorama's data URL to bytes,
				// and the test that checks it has to encode one to hand over.
				btoa: 'readonly',
				// RM-013 K2. jsdom ships no `CompressionStream`, so the headless tier
				// puts Node's deflate behind the browser's interface - a real
				// `TransformStream`, because the codec pipes through it and anything
				// with only the right method names would prove that the fake was
				// called rather than that the codec works.
				TransformStream: 'readonly',
				// And the pair the zip container reads and writes names with. Node's
				// own since 11; declared because the tests reach for them directly
				// rather than through the module under test.
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
			quotes: ['error', 'single'],
			semi: ['error', 'always'],
			'no-mixed-spaces-and-tabs': ['error', 'smart-tabs'],
		},
	},
];
