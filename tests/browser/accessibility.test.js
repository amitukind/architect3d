/**
 * axe-core over the real application (RM-002 P5, tier 2).
 *
 * The review counted 29 components carrying 16 `aria-label`s, 12 `role`s, one
 * `tabindex` and two `focus-visible` rules, and noted that Reka UI supplies a
 * great deal of this for free - which is exactly why an automated check is
 * worth having. It tells you where it did not.
 *
 * ## What is checked, and what is deliberately not
 *
 * The rules run are WCAG 2 A and AA plus axe's own best-practice set. Two
 * things are excluded by selector rather than by turning rules off:
 *
 *   #floorplanner-canvas   A drawing surface. axe wants a text alternative for
 *                          canvas content, and there is no honest one for a
 *                          live editable plan - the accessible equivalent is
 *                          the inspector and the status bar, which are checked.
 *   #viewer                Same, for the WebGL canvas.
 *
 * Excluding by selector keeps every rule armed everywhere else, so a missing
 * button label in the tool rail still fails. Switching the rules off globally
 * would have hidden that.
 *
 * ## Why violations are asserted individually
 *
 * `expect(violations).toEqual([])` produces an unreadable dump. Each violation
 * is reported with its rule id, impact and the offending selectors, so a
 * failure says "button-name: 2 nodes, .tool-rail button:nth-child(3)" rather
 * than printing the whole accessibility tree.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';
import axe from 'axe-core';

import App from '../../src/app/App.vue';
import {LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from '../../src/app/composables/useLayout.js';

/** The two drawing surfaces, which have no text alternative worth inventing. */
const EXCLUDED = [['#floorplanner-canvas'], ['#viewer']];

const AXE_OPTIONS = {
	runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']},
};

let wrapper;

/** Readable one-liners, most severe first. */
function summarise(violations)
{
	const order = {critical: 0, serious: 1, moderate: 2, minor: 3};
	return violations
		.slice()
		.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9))
		.map((violation) =>
		{
			const where = violation.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(' | ');
			return `${violation.impact}: ${violation.id} (${violation.nodes.length}) -> ${where}`;
		});
}

async function analyse()
{
	const results = await axe.run({include: [['#app-root']], exclude: EXCLUDED}, AXE_OPTIONS);
	return summarise(results.violations);
}

beforeEach(async () =>
{
	window.localStorage.clear();
	const root = document.createElement('div');
	root.id = 'app-root';
	document.body.appendChild(root);

	wrapper = mount(App, {attachTo: root});
	await nextTick();
	// Reka portals its overlays into body on open; nothing is open at mount, so
	// one tick is enough for the shell itself to settle.
	await nextTick();
});

afterEach(() =>
{
	wrapper.unmount();
	document.querySelectorAll('#app-root').forEach((node) => node.remove());
	document.body.innerHTML = '';
});

describe('the application is accessible', () =>
{
	it('has no violations in the plan layout', async () =>
	{
		const found = await analyse();
		expect(found, `axe violations:\n  ${found.join('\n  ')}`).toEqual([]);
	});

	it('has no violations in split or 3D either', async () =>
	{
		for (const layout of [LAYOUT_SPLIT, LAYOUT_VIEW, LAYOUT_PLAN])
		{
			wrapper.vm.$.setupState.workspace.setLayout(layout);
			await nextTick();

			const found = await analyse();
			expect(found, `axe violations in layout ${layout}:\n  ${found.join('\n  ')}`).toEqual([]);
		}
	});

	it('every control the rail and top bar expose has an accessible name', async () =>
	{
		// The rule that matters most for this interface: it is almost entirely
		// icon buttons, and an icon button with no name is invisible to a screen
		// reader while looking completely fine.
		const results = await axe.run(
			{include: [['#app-root']], exclude: EXCLUDED},
			{runOnly: {type: 'rule', values: ['button-name', 'link-name', 'aria-command-name', 'aria-toggle-field-name']}},
		);
		const found = summarise(results.violations);
		expect(found, `unnamed controls:\n  ${found.join('\n  ')}`).toEqual([]);
	});

	it('keeps the catalog drawer accessible when it is open', async () =>
	{
		// A portalled dialog is the classic place for a focus trap or a missing
		// label to hide, because it does not exist in the DOM until it is opened.
		wrapper.vm.$.setupState.toggleCatalog();
		await nextTick();
		await nextTick();

		// The drawer portals to body, so this pass looks at the whole document
		// rather than at the shell root.
		const results = await axe.run({exclude: EXCLUDED}, AXE_OPTIONS);
		const found = summarise(results.violations);
		expect(found, `axe violations with the catalog open:\n  ${found.join('\n  ')}`).toEqual([]);
	});
});
