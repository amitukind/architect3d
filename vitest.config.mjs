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
				// The service worker (RM-013 K3). Excluded explicitly, with a reason,
				// and the reason is checkable: the file is twenty lines of
				// `addEventListener` and every decision it makes is in
				// `src/app/offline/`, which is covered exhaustively by
				// `tests/offline-policy.test.js` - 19 cases over three strategies,
				// four pass-through rules and a browser that refuses a cache.
				//
				// It cannot be covered here. A worker has no DOM and no `window`, it
				// cannot be imported into a test, jsdom provides no worker scope, and
				// the browser tier runs against a dev server that never emits it -
				// `sw.js` exists only in `dist-demo/`, as a second Vite entry, because
				// a worker's URL is its scope.
				//
				// Whether this exclusion is honest is a question about how thin that
				// file is, which is why it is that thin.
				'src/app/sw.js',
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
				//
				// RM-013 K2 is the second sprint where the ratchet BIT rather than
				// moved, and it bit on exactly the right thing. The link codec, the
				// zip container, the read-only state and two new components landed at
				// 84.44 functions and 76.83 branches - under both floors, and under
				// the functions floor K1 had raised one sprint earlier.
				//
				// The floors did not come down. What the failure pointed at was two
				// components with no test at all - `ShareDialog` and `ViewerBanner`,
				// at 21 % and 0 % - and a bundle path exercised only in the browser
				// tier, which this measurement cannot see. Twenty-three tests later:
				// 86.89 statements, 86.88 lines, 78.12 branches, 85.18 functions.
				//
				// Branches crossed a whole number and is raised 77 -> 78. The other
				// three gained fractions and stay. It is worth recording that
				// branches went DOWN to 76.83 before it went up: a sprint of refusal
				// paths adds branches faster than a sprint of tests covers them, and
				// the floor is what makes the second half happen.
				//
				// RM-013 K1 moves functions 84 -> 85 and nothing else. Measured
				// 86.72 statements, 86.69 lines, 77.50 branches, 85.06 functions.
				//
				// Functions is the one that crossed a whole number, which is what a
				// sprint made of new modules does: a repository, two composables and a
				// tool are mostly functions, and every one of them is called by the
				// suites that came with them. Lines and statements gained fractions
				// (86.61 -> 86.69, 86.62 -> 86.72) and stay where they are.
				//
				// Branches went the other way, 77.70 -> 77.50, and it is recorded
				// rather than smoothed over: the new code has refusal paths that only
				// a browser produces - a WebP encoder that is absent, a quota that is
				// reached - and the fake IDBFactory reaches several but not all of
				// them. The floor is unmoved because a floor is not a measurement,
				// and 77.50 is still above it.
				//
				// RM-012 J3 moves lines and statements 86 -> 87. Measured 87.29 lines,
				// 87.28 statements, 78.71 branches, 85.63 functions.
				//
				// Worth recording where it came from, because it is not only the 104
				// new tests. A third of this sprint is refusal paths - a format
				// nothing reads, a store a browser withholds, bytes that are not what
				// the design named - and every one of them is reachable from a test
				// only because the suite's fake `IDBFactory` was made to behave like a
				// real store: it structured-clones instead of JSON round-tripping, it
				// rolls a transaction back on abort, and it weighs an `ArrayBuffer` by
				// its bytes. Before those three repairs the quota refusal in
				// `model_repository.js` was not reachable at all, because a model
				// weighed two bytes.
				//
				// Branches gained 78.22 -> 78.71 and functions 85.17 -> 85.63; both
				// stay, because rounding down is what makes these floors rather than
				// targets.
				//
				// RM-012 J2 and J4 move all four, by more than any single change has:
				// 79 -> 86 lines, 79 -> 86 statements, 68 -> 77 branches, 78 -> 84
				// functions. Ten tasks and 63 new tests, and the gap had been left
				// open for four programmes because each raised the measurement by a
				// fraction and rounding down is what keeps these floors rather than
				// targets. Measured 86.61 / 86.62 / 77.77 / 84.45; rounded down, as
				// always.
				//
				// RM-014 L4 moves branches 78 -> 79 and functions 85 -> 86. Measured
				// 87.78 lines, 87.77 statements, 79.28 branches, 86.03 functions.
				//
				// Branches is the interesting one, because a keyboard sprint should
				// not obviously move it. It does because the keyboard path is not new
				// code with new branches - it synthesises into `mousedown`,
				// `mousemove` and `mouseup`, so 28 new tests walk the branches those
				// three methods already had: the drawing modes, the delete mode, the
				// hover cases and the read-only guards RM-013 K2 wrote, several of
				// which no existing test reached from that direction. Covering old
				// branches is what a second way of driving the same code buys.
				//
				// Functions crossed on the plainer route: `dom.js` gained two, the
				// floorplanner six, and every one of them is called by the suite that
				// arrived with it. Lines and statements gained fractions (87.35 ->
				// 87.78, 87.33 -> 87.77) and stay where they are.
				//
				// RM-016 N2 moved all four, and the sprint's whole subject was where
				// they were NOT: 89.07 lines, 89.00 statements, 80.88 branches, 87.66
				// functions. Three suites arrived - the starter-plan shelf, the export
				// verbs' refusals, and the buttons and keys of App.vue - and between
				// them they took the three thinnest files in the tree from 37.3, 39.2
				// and 27.3 % branch coverage to 64.5, 70.0 and 84.1.
				lines: 89,
				statements: 89,
				branches: 80,
				functions: 87,

				/**
				 * A floor per directory (RM-016 N2, M-57, finding AB-4).
				 *
				 * ## What one number over an unequal tree measures
				 *
				 * The biggest part of it. `src/scripts` is two thirds of the 13,636
				 * statements here, and it has been well covered since the
				 * characterization suites of RM-002 - so the four figures above have
				 * been describing the library and calling it the tree. AB-4 measured
				 * what that hid: `src/scripts/model` at 87.5 % branch coverage beside
				 * `App.vue` at 37.3, `useDesignIO` at 39.2 and `useTemplates` at 27.3.
				 * Every covered statement in `App.vue` could have disappeared and the
				 * global figure would have fallen 0.99 points, which is inside the
				 * headroom the floor already had: the build would have stayed green
				 * while the boot went untested.
				 *
				 * The three files it named are the boot, the export verbs and the
				 * starter-plan shelf - which is to say, very nearly a description of
				 * somebody's first ten minutes.
				 *
				 * ## How these are set, and what they are not
				 *
				 * Each is the largest multiple of five STRICTLY BELOW the first
				 * measurement - the same never-lowered contract the four above have
				 * and have never once broken, with the margin stated rather than
				 * hoped for. Five rather than one because a directory is a smaller
				 * sample than a tree and moves further on one merged file; strictly
				 * below because two of these measured exactly 75.00 and 90.00, and a
				 * floor a green build sits precisely on is a red mark somebody learns
				 * to re-run rather than read. RM-016 N1 learned that about a
				 * Lighthouse floor four days ago; this is the same rule.
				 *
				 * They are floors per DIRECTORY and not per file. A per-file floor is
				 * a number nobody can move without touching every file in a refactor,
				 * and `perFile: true` above would apply the global four that way,
				 * which is not what is wanted here. A directory that genuinely cannot
				 * be covered gets an `exclude` entry with a reason, which is what this
				 * file has asked for since RM-002 rather than a lowered number.
				 *
				 * Branches only, deliberately. It is the lowest of the four
				 * everywhere, it is the one that distinguishes "this line ran" from
				 * "this decision was tested", and four numbers per directory would be
				 * sixty-eight numbers nobody reads.
				 */
				'src/app/*.{js,vue}': {branches: 60},
				'src/app/components/**': {branches: 80},
				'src/app/composables/**': {branches: 70},
				'src/app/import/**': {branches: 90},
				'src/app/inspector/**': {branches: 80},
				'src/app/offline/**': {branches: 90},
				'src/app/persistence/**': {branches: 80},
				'src/app/share/**': {branches: 85},
				'src/app/tour/**': {branches: 85},
				'src/scripts/*.js': {branches: 85},
				'src/scripts/core/**': {branches: 85},
				'src/scripts/floorplanner/**': {branches: 75},
				'src/scripts/items/**': {branches: 75},
				'src/scripts/model/**': {branches: 85},
				'src/scripts/three/**': {branches: 70},
			},
		},
	},
});
