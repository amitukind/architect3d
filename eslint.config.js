import js from '@eslint/js';

/**
 * ESLint 10 flat config, replacing the ESLint 4 .eslintrc.json (migration S1).
 *
 * The rule set is deliberately the same one the project already had - browser
 * globals, eslint:recommended, single quotes, semicolons, unix linebreaks,
 * console allowed, tab indentation unenforced. This sprint changes the
 * toolchain, not the house style.
 */
export default [
	{
		ignores: [
			'build/**',        // frozen legacy demo + prebuilt bundles (S0 reference)
			'dist/**',
			'dist-demo/**',
			'docs/**',         // generated esdoc output
			'resources/**',    // dead vendored TypeScript ancestor
			'models/**',
			'index.html',
			'node_modules/**',
			'tools/parity/**',  // capture output: served copies of both engines' build/
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
				performance: 'readonly',
				alert: 'readonly',
				prompt: 'readonly',
				location: 'readonly',
				ResizeObserver: 'readonly',
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
			// them would hide real cleanup; making them errors would either block
			// CI or force unrelated source edits during a toolchain-only sprint -
			// exactly the "one variable per sprint" rule the migration plan sets.
			// Clear them alongside the modules they live in, as later sprints
			// rewrite those files.
			'no-useless-assignment': 'warn',
			'no-prototype-builtins': 'warn',
		},
	},

	{
		// Tests and tooling: Node environment.
		files: ['tests/**/*.js', 'tools/**/*.mjs', '*.config.js', '*.config.mjs'],
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
