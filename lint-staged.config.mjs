/**
 * What the pre-commit hook runs (RM-002 P1 tier 0, extended by P2).
 *
 * Moved out of package.json when the type check arrived, because the type check
 * is the one task here that cannot take a list of files.
 *
 * ## Why the type check ignores the staged paths
 *
 * `tsc` type-checks a *program*, not a file. Handing it individual paths makes
 * it ignore tsconfig.json entirely - so it would run with default options, on
 * files whose imports it has not been told how to resolve, and report a
 * different set of errors from CI. A whole-project check is the only one whose
 * result means anything, and at under two seconds there is no reason to want
 * the cheaper wrong answer.
 *
 * lint-staged appends the matched paths to a string command, which is exactly
 * what must not happen here. A function task returns the command to run
 * verbatim, so this is the shape that gets a project-wide check.
 */
export default {
	/**
	 * ESLint on what changed. Errors block; the 28 deliberate warnings in
	 * eslint.config.js do not, matching `npm run lint` in CI.
	 */
	'*.{js,mjs,vue}': [
		'eslint',
		'vitest related --run --passWithNoTests',
	],

	/**
	 * One whole-project type check, however many files were staged. The empty
	 * parameter is the staged list, deliberately unused - see above.
	 */
	'*.{js,mjs,vue,json}': () => 'npm run --silent typecheck',
};
