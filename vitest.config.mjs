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
		globals: false,
		reporters: ['default'],
		exclude: ['node_modules/**', 'build/**', 'resources/**', 'docs/**'],
	},
});
