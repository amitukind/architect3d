/**
 * The arithmetic behind the floor report (RM-018 Q1, finding AD-4).
 *
 * The tool exists because a percentage hides its denominator, so the one thing
 * it must not do is get the denominator wrong. Every case here is a floor whose
 * written percentage and enforced percentage differ, or a glob shape the
 * config actually uses - because a matcher that answers `false` for a shape it
 * does not know would silently report a floor as unmatched, and this file's
 * whole job is that a floor's real position is not a thing anybody guesses at.
 */
import {describe, expect, it} from 'vitest';
import {matchesGlob, slackFor, effectiveFloor, floorsIn} from '../tools/coverage-slack.mjs';

describe('M-61 - which files a threshold covers', () =>
{
	it('matches a recursive glob by prefix', () =>
	{
		expect(matchesGlob('src/app/tour/**', 'src/app/tour/steps.js')).toBe(true);
		expect(matchesGlob('src/app/tour/**', 'src/app/tour/deep/inner.js')).toBe(true);
		expect(matchesGlob('src/app/tour/**', 'src/app/tourist.js')).toBe(false);
	});

	it('matches a single-level glob with a brace list, and not into subdirectories', () =>
	{
		expect(matchesGlob('src/app/*.{js,vue}', 'src/app/App.vue')).toBe(true);
		expect(matchesGlob('src/app/*.{js,vue}', 'src/app/main.js')).toBe(true);
		// The reason this shape exists: `src/app/*.{js,vue}` is App.vue and its
		// neighbours, NOT the twenty-odd composables under it, which carry their
		// own floor at a different number.
		expect(matchesGlob('src/app/*.{js,vue}', 'src/app/composables/useLayout.js')).toBe(false);
		expect(matchesGlob('src/app/*.{js,vue}', 'src/app/styles/app.css')).toBe(false);
	});

	it('matches a single-level glob with one extension', () =>
	{
		expect(matchesGlob('src/scripts/*.js', 'src/scripts/blueprint.js')).toBe(true);
		expect(matchesGlob('src/scripts/*.js', 'src/scripts/model/scene.js')).toBe(false);
	});

	it('throws on a shape it has not been taught', () =>
	{
		// Answering `false` here is the dangerous behaviour: a new threshold
		// would quietly cover nothing and the report would say every floor is
		// comfortable. Failing loudly is the whole design.
		expect(() => matchesGlob('src/**/use*.js', 'src/app/composables/useLayout.js'))
			.toThrow(/unrecognised threshold glob/);
	});
});

describe('M-61 - slack is units, not percentage points', () =>
{
	it('counts how many units can be lost before the floor fails', () =>
	{
		// 89 % of 13,636 is 12,136.04, so the check needs 12,137 and a build
		// with exactly that has nothing to spare. This is the number that was
		// zero for three sprints while the config said 89 and the report said
		// 89.00.
		expect(slackFor(12137, 13636, 89)).toBe(0);
		expect(slackFor(12136, 13636, 89)).toBe(-1);
		expect(slackFor(12147, 13636, 89)).toBe(10);
	});

	it('reports what a floor is really enforced at on a small denominator', () =>
	{
		// Ten branches, floor 85: the check needs 9, which is 90 %. A directory
		// sitting at 9/10 looks five points clear and is one branch from red.
		expect(effectiveFloor(10, 85)).toBe(90);
		expect(slackFor(9, 10, 85)).toBe(0);

		// Twenty branches, same written floor, and it lands on the number.
		expect(effectiveFloor(20, 85)).toBe(85);
		expect(slackFor(18, 20, 85)).toBe(1);
	});

	it('is the plain difference when the denominator is large enough not to matter', () =>
	{
		expect(effectiveFloor(1000, 80)).toBe(80);
		expect(slackFor(850, 1000, 80)).toBe(50);
	});
});

describe('M-61 - the report over a whole set of thresholds', () =>
{
	const summary = {
		total: {
			statements: {covered: 89, total: 100, pct: 89},
			branches: {covered: 80, total: 100, pct: 80},
			functions: {covered: 90, total: 100, pct: 90},
			lines: {covered: 89, total: 100, pct: 89},
		},
		// Absolute, the way v8 writes them, so the path handling is exercised
		// rather than bypassed.
		[`${process.cwd()}/src/app/tour/steps.js`]: metrics(9, 10),
		[`${process.cwd()}/src/app/composables/useLayout.js`]: metrics(70, 100),
	};

	function metrics(covered, total)
	{
		const one = {covered, total, pct: (covered / total) * 100};
		return {statements: one, branches: one, functions: one, lines: one};
	}

	it('puts the tightest floor first and finds the zero-slack one', () =>
	{
		const rows = floorsIn({
			statements: 89,
			'src/app/tour/**': {branches: 85},
			'src/app/composables/**': {branches: 70},
		}, summary);

		expect(rows.map((r) => `${r.scope} ${r.metric}`)).toEqual([
			'GLOBAL statements', 'src/app/tour/** branches', 'src/app/composables/** branches',
		]);
		expect(rows[0].slack).toBe(0);
		expect(rows[1].slack).toBe(0);
		expect(rows[1].pct).toBe(90);
		expect(rows[2].slack).toBe(0);
	});

	it('refuses a threshold that matches nothing rather than reporting it comfortable', () =>
	{
		// A directory renamed out from under a floor is a floor that stopped
		// enforcing anything. Silence there is exactly the failure this whole
		// sprint is about.
		expect(() => floorsIn({'src/app/gone/**': {branches: 80}}, summary))
			.toThrow(/matched no file/);
	});
});
