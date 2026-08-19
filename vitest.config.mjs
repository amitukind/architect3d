import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * Test harness for the library and, since S6, the Vue application on top of it.
 *
 * The library suites are characterization tests: they describe what the code
 * DOES today, not what it should do. Several behaviours are quirky but
 * load-bearing (see docs/roadmap.html section 01, "preserve or fix" ledger) -
 * if one fails during the migration because the legacy behaviour looks wrong,
 * that is a signal to re-check the change, not to "fix" the expectation.
 *
 * The application suites are the opposite: S6 deliberately changed how the app
 * is wired, and those tests pin the new contract - a single reactive selection,
 * a mode highlight that works, symmetric mount and unmount.
 *
 * `environment: 'node'` stays the default because the data layer needs no DOM
 * and staying headless keeps the suite fast. Files that need one opt in with a
 * `// @vitest-environment jsdom` pragma on line 1.
 */
export default defineConfig({
	// Single-file components are compiled by the same plugin the app is built
	// with, so a test imports App.vue exactly as index.html does.
	plugins: [vue()],
	test: {
		environment: 'node',
		include: ['tests/**/*.test.js'],
		// tests/browser/ needs a real browser and is a separate project - see
		// vitest.browser.config.mjs. Left out here so `npm test` stays headless
		// and fast, and so a machine with no chromium can still run everything
		// that does not need one.
		exclude: ['tests/browser/**', 'node_modules/**', 'public/**', 'asset-pipeline/**', 'docs/**'],
		globals: false,
		reporters: ['default'],

		/**
		 * Coverage, and the floor underneath it (RM-002 P1, tier 1).
		 *
		 * The thresholds below are not a target anybody aimed at - they are the
		 * first measurement, rounded down. 870 tests existed before any of this
		 * and nobody knew what they reached; the point of writing the number down
		 * is that it can now only go up.
		 *
		 * ## The ratchet
		 *
		 * Raise these when a change earns it. NEVER lower them to make a build
		 * pass: a threshold that moves down on demand measures nothing, and the
		 * failure it is suppressing is the finding. If a change genuinely cannot
		 * be covered, exclude that file explicitly, with a reason, so the
		 * exemption is visible in review rather than hidden in a lowered number.
		 *
		 * Branch coverage is the lowest of the four and deliberately so. Much of
		 * the library's branching is defensive - null guards, format dispatch,
		 * the preserved-bug paths in utils.js that room detection depends on -
		 * and several of those branches are unreachable by construction rather
		 * than merely untested. See RM-002 R-01 for one that turned out to be
		 * reachable after all, and wrong.
		 */
		coverage: {
			provider: 'v8',
			// Everything under src/, not just what a test happened to import -
			// otherwise a file with no test at all is invisible rather than zero.
			all: true,
			include: ['src/**/*.{js,vue}'],
			exclude: [
				// The bootstrap. It reads the DOM for #app and mounts; tests mount
				// App.vue directly, which is the right seam. Nothing here is logic.
				'src/app/main.js',
				// The ambient-occlusion chain (RM-011 H2). Excluded explicitly and
				// with a reason, which is what the paragraph above asks for rather
				// than letting a number drift down.
				//
				// Past its early return - which IS covered here, and is the branch
				// that decides whether anything is built at all - every line of this
				// file constructs an EffectComposer, a GTAOPass and three render
				// targets. All three need a WebGL context; under jsdom there is
				// none, and a stub permissive enough to let them construct would be
				// asserting that a mock returns what the mock was told to return.
				//
				// It is covered where it can be: `tests/browser/ambient-occlusion.test.js`
				// builds the chain in Chromium, renders through it, differences the
				// frame and disposes it, and `tests/viewer-lifecycle.test.js` covers
				// Main's whole side of the seam headless.
				'src/scripts/three/post.js',
			],
			reporter: ['text-summary', 'json-summary', 'html'],
			thresholds: {
				// Ratcheted from 74 by RM-002 P3, which added tests alongside three
				// library fixes and pushed lines to 75.50%. Round down to the whole
				// number; the point is that the floor only ever rises.
				//
				// P6 moved branches 61 -> 62. Lines and statements did not gain a
				// whole point (75.50 -> 75.75, 75.66 -> 75.88) and were left alone:
				// rounding down is what makes these floors rather than targets, and
				// nudging one on a fraction starts the habit of tuning them.
				//
				// P7 moved all four, which is what a change that touches the model,
				// the 2D view and the 3D view at once does when it arrives with a
				// suite of its own: 76.38 lines, 76.48 statements, 63.43 branches,
				// 74.31 functions.
				//
				// RM-003 A0 moved all four again - 77.23 lines, 77.27 statements,
				// 63.94 branches, 75.09 functions - because disposal paths are
				// reached by every test that builds a plan, not only by the twenty
				// that assert on them. Three of the four gained a whole point and
				// are raised. Branches did not (63.43 -> 63.94) and is left alone:
				// rounding down is what makes these floors rather than targets.
				//
				// A1 moved branches over the line it had been sitting under - 63.94
				// to 64.71 - which is what a sprint made mostly of validation does:
				// a validator is branches, and the corpus exercises each one. The
				// other three gained fractions (77.48 lines, 77.51 statements, 75.32
				// functions) and stay where they are.
				//
				// A2 moved all four over a whole number at once - 78.10 lines, 78.16
				// statements, 65.42 branches, 76.14 functions - and the reason is
				// worth recording, because it is not "we wrote more tests". The
				// change-projection suite drives paths that no previous suite reached
				// at all: the incremental projection compared against a full redraw on
				// three designs and ten edit kinds, and a real `Main` mounted to check
				// the camera rather than a stand-in that reimplemented its rule.
				//
				// A3 moved branches 65.42 -> 66.78 and functions 76.14 -> 77.26,
				// and both are raised. Lines and statements gained less than a whole
				// number (78.10 -> 78.85, 78.16 -> 78.91) and stay where they are:
				// rounding down is what makes these floors rather than targets, and
				// nudging one on a fraction starts the habit of tuning them.
				//
				// A4 moved lines 78.85 -> 79.06, statements 78.91 -> 79.13 and
				// branches 66.78 -> 67.15, and all three are raised. Worth noting
				// where it came from, because it was not mostly the new file: a
				// runtime is a container and there is not much of it to cover. It is
				// the isolation suite mounting two whole viewers and disposing them
				// in each order, which walks teardown paths a single-viewer test
				// never reaches. Functions gained a fraction (77.26 -> 77.62) and
				// stays at 77.
				//
				// A5 is the first sprint where the ratchet BIT rather than moved:
				// the persistence and asset code landed at 78.01 statements against
				// a floor of 79, and all four thresholds failed. The floor is not
				// negotiable - the standing rule is that a threshold never comes
				// down to make a build pass - so the answer was tests, and the tests
				// it forced were the right ones. The IndexedDB repository was 88
				// uncovered lines reachable only from the browser tier; it now has a
				// fake IDBFactory (tests/helpers/indexeddb.js) that reaches the quota
				// retry, the version refusal and the failed open, none of which a
				// real IndexedDB will produce on request.
				//
				// Final: 79.47 lines, 79.47 statements, 68.12 branches, 78.14
				// functions. Branches and functions each crossed a whole number and
				// are raised; lines and statements gained fractions and stay.
				lines: 79,
				statements: 79,
				branches: 68,
				functions: 78,
			},
		},
	},
});
