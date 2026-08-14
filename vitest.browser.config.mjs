import {defineConfig} from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import {playwright} from '@vitest/browser-playwright';

/**
 * Tier 2 of the RM-002 gate ladder: the suite that needs a real browser.
 *
 *   npm run test:browser
 *
 * ## What this exists to catch
 *
 * Ten of the seventeen headless suites run under jsdom, where
 * `canvas.getContext('2d')` is a stub that records the names of the calls made
 * to it and WebGL is a renderer stub. They are good tests - they pin what the
 * library *asks* the canvas to do - but nothing in them has ever rasterised a
 * pixel or composited a frame. A 2D palette change that produced an invisible
 * plan, or a render profile that composited black, would pass all 886 of them.
 *
 * ## Why the assertions read pixels rather than diff screenshots
 *
 * Vitest 4 ships `toMatchScreenshot`, and the obvious thing to do here is
 * capture the plan and diff it against a committed reference. That is
 * deliberately NOT what most of this suite does, for two reasons.
 *
 * The first is that a reference image is environment-bound. Font rasterisation,
 * GPU and browser build all move the bytes, so a baseline captured on a
 * developer's macOS is not comparable with a run on a Linux CI container -
 * Vitest names the files per platform for exactly this reason, and the docs are
 * explicit that a consistent environment is required. There is no Docker on
 * this machine, so a Linux baseline cannot honestly be produced here, and
 * committing a macOS one would give CI nothing to compare against.
 *
 * The second reason is the better one, and it would hold even with Docker. What
 * these tests want to know is "does the grid draw in the grid colour, and does
 * the room fill in the room colour" - a *contract*, checkable by reading the
 * pixel at a known coordinate and comparing it to the palette value the library
 * exports. That is deterministic on every platform, needs no stored artefact,
 * and when it fails it says which colour was wrong rather than that 0.3% of
 * pixels moved.
 *
 * Screenshot diffing is kept for the case it is actually good at - unanticipated
 * change across the whole chrome - behind `npm run test:visual`. See the note
 * there.
 */
export default defineConfig({
	plugins: [vue()],
	test: {
		name: 'browser',
		include: ['tests/browser/**/*.test.js'],
		// Swallows chromium's benign ResizeObserver notice, which the runner
		// would otherwise promote to a run-failing unhandled error. See the file.
		setupFiles: ['tests/browser/setup.js'],
		// Chromium only. A second engine doubles the runtime and this tier exists
		// to prove the renderers work at all, not to survey engine differences -
		// which is a question for the parity harness, not for CI.
		browser: {
			enabled: true,
			// Vitest 4 takes a provider factory here, not the string the older
			// docs show; the string form fails at startup with a pointer to this.
			provider: playwright({
				launch: {
					args: [
						// Headless chromium falls back to SwiftShader for WebGL, which is
						// what makes the 3D readback test possible on a runner with no
						// GPU. Named explicitly rather than relied on: the default has
						// moved across Chrome versions, and a silent fallback to no-WebGL
						// would turn the 3D test from failing into skipping.
						'--use-gl=angle',
						'--use-angle=swiftshader',
						'--enable-unsafe-swiftshader',
					],
				},
			}),
			headless: true,
			// The default browser-mode viewport is phone-shaped (414x896). The
			// library sizes its canvas from clientWidth, so that is the canvas
			// these tests get unless it is said otherwise - and a plan drawn into
			// a narrow column is not what anybody is checking.
			viewport: {width: 1024, height: 768},
			screenshotFailures: false,
			instances: [{browser: 'chromium'}],
		},
	},
});
