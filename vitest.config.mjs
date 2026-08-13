import {defineConfig} from 'vitest/config';

/**
 * Characterization-test harness for the headless data layer (src/scripts/core
 * and src/scripts/model).
 *
 * These tests describe what the code DOES today, not what it should do. Several
 * behaviours are quirky but load-bearing (see docs/roadmap.html section 01,
 * "preserve or fix" ledger) - if a test fails during the migration because the
 * legacy behaviour looks wrong, that is a signal to re-check the change, not to
 * "fix" the expectation.
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.js'],
		globals: false,
		reporters: ['default'],
		// The 2D/3D layers need a DOM and a WebGL context; the data layer does not.
		// Keep this suite headless so it stays fast and CI-friendly.
		exclude: ['node_modules/**', 'build/**', 'resources/**', 'docs/**'],
	},
});
