/**
 * The first five minutes, against a real shell (RM-014 L2, tier 2).
 *
 * ## What this proves that the headless tier cannot
 *
 * `tests/tour.test.js` walks the step list against every `id="..."` it can find
 * in `src/app`, which is a grep. It catches a rename and it cannot catch the
 * failure underneath: an id that exists in a component nothing renders, or one
 * that renders inside a pane the layout has closed. Both produce the same
 * symptom - a popover pointing at nothing - and both need a mounted application.
 *
 * It is also where "offered once" is a fact rather than a mock, and it has
 * already earned that: the first version of `useTour` decided a browser had been
 * used before by asking `indexedDB.databases()`, and this tier failed on a
 * genuinely clean profile because **the application creates all three databases
 * during boot**. jsdom has no `databases()` at all, so nothing headless could
 * have found it.
 *
 * ## This tier runs unstyled, and the assertions are written for that
 *
 * `vitest.browser.config.mjs` registers the Vue plugin and not the Tailwind one,
 * so `@import 'tailwindcss'` resolves to nothing and no utility class applies -
 * `#app-shell` measures 8,374 px tall here because `h-screen` is not a rule.
 * That makes `getBoundingClientRect` useless as a test of whether something is
 * visible, since everything measures the height of its own content.
 *
 * So visibility is checked where it is actually decided: `AppWorkspace` sizes
 * the two panes with an **inline** style, which no stylesheet is involved in. A
 * step naming a layout is checked by reading the width its pane was given.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../../src/app/App.vue';
// The only file in this tier that needs the stylesheet, and it genuinely does:
// the ring is positioned by `fixed` and the panes are sized by Tailwind, so
// without it every element measures the height of its own content and "does
// this anchor have a size" is a question about nothing.
import '../../src/app/styles/app.css';
import {TOUR_STEPS} from '../../src/app/tour/steps.js';
import {HELP_PAGES} from '../../src/app/tour/help.js';
import {STORAGE_KEY, forgetTour, markTourSeen} from '../../src/app/composables/useTour.js';

/** How long `AppWorkspace` takes to resize a pane, plus a frame. */
const SETTLE_MS = 260;

/**
 * The databases the application creates during boot.
 *
 * Cleared between cases so a project left by another file in this tier cannot
 * suppress the tour. Their mere *existence* is deliberately not evidence - see
 * `useTour`'s note for the version of this that was wrong and how this tier
 * caught it.
 */
const DATABASES = ['architect3d', 'architect3d-projects', 'architect3d-models'];

let wrapper;

function deleteDatabase(name)
{
	return new Promise((resolve) =>
	{
		const request = window.indexedDB.deleteDatabase(name);
		request.onsuccess = resolve;
		request.onerror = resolve;
		request.onblocked = resolve;
	});
}

async function mountApp()
{
	const root = document.createElement('div');
	root.id = 'app-root';
	document.body.appendChild(root);
	wrapper = mount(App, {attachTo: root});
	await nextTick();
	await nextTick();
	return wrapper;
}

function settle(ms)
{
	return new Promise((resolve) => setTimeout(resolve, ms || SETTLE_MS));
}

beforeEach(async () =>
{
	window.localStorage.clear();
	// A profile holding one of these is evidence of an earlier visit, and the
	// tour reads it before offering itself - so a leftover database from another
	// file in this tier would silently suppress every case here.
	for (const name of DATABASES) { await deleteDatabase(name); }
	document.body.innerHTML = '';
});

afterEach(async () =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
	document.querySelectorAll('#app-root').forEach((node) => node.remove());
	document.body.innerHTML = '';
	window.localStorage.clear();
	for (const name of DATABASES) { await deleteDatabase(name); }
});

describe('every step points at something a person can see', () =>
{
	it('resolves every anchor against the mounted shell', async () =>
	{
		await mountApp();
		const tour = wrapper.vm.$.setupState.tour;
		tour.start();

		const missing = [];
		const closed = [];
		for (let step = 0; step < tour.total; step++)
		{
			await nextTick();
			// The two steps that switch panes animate over 180 ms, so anything read
			// on the same tick describes the pane the layout is leaving.
			await settle();
			const current = tour.step.value;
			const node = document.querySelector(current.anchor);
			if (!node)
			{
				missing.push(`${current.id} -> ${current.anchor}`);
			}
			else if (current.layout)
			{
				// The failure a grep cannot see. `AppWorkspace` keeps both panes
				// mounted always and closes one by giving it no width, so `#viewer`
				// exists in the plan layout and is not a thing to point at. The width
				// is an inline style, which is why it is readable in a tier with no
				// stylesheet.
				const pane = node.parentElement;
				if (!pane || pane.style.width === '0%' || pane.style.width === '0px')
				{
					closed.push(`${current.id} -> ${current.anchor} is in a closed pane`);
				}
			}
			if (step < tour.total - 1) { tour.next(); }
		}
		tour.skip();

		expect(missing, 'every anchor is rendered by the mounted shell').toEqual([]);
		expect(closed, 'every step that names a layout gets the pane it wanted').toEqual([]);
	});

	it('rings the element the step names', async () =>
	{
		await mountApp();
		const tour = wrapper.vm.$.setupState.tour;
		tour.start();
		await nextTick();
		await settle();

		// Where it is drawn is asserted in `tests/onboarding-ui.test.js`, against a
		// rectangle a stub controls. Here the question is simply that a real shell
		// produces one at all - the ring only renders when the anchor resolved and
		// measured non-empty.
		const ring = document.querySelector('[data-testid="tour-ring"]');
		expect(ring).not.toBeNull();
		expect(ring.getAttribute('style')).toContain('width');
		expect(document.querySelector(TOUR_STEPS[0].anchor).className)
			.not.toContain('tour');
		tour.skip();
	});

	it('gives the layout back exactly as it found it', async () =>
	{
		await mountApp();
		const {tour, workspace} = wrapper.vm.$.setupState;
		const before = workspace.layout.value;
		tour.start();
		while (!tour.last.value) { tour.next(); }
		await settle();
		tour.finish();
		await nextTick();
		expect(workspace.layout.value).toBe(before);
	});
});

describe('offered once, to somebody who has not been here', () =>
{
	it('opens on a clean profile and records that it did', async () =>
	{
		forgetTour();
		await mountApp();
		// `offer()` runs at the tail of the boot sequence, after a shared link and
		// after the draft has been offered.
		await settle(400);
		expect(wrapper.vm.$.setupState.tour.open.value).toBe(true);
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

		wrapper.vm.$.setupState.tour.skip();
		expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).version).toBeGreaterThan(0);
	});

	it('does not open on the next boot', async () =>
	{
		markTourSeen();
		await mountApp();
		await settle(400);
		expect(wrapper.vm.$.setupState.tour.open.value).toBe(false);
		expect(document.querySelector('[data-testid="tour-card"]')).toBeNull();
	});
});

describe('the way back in', () =>
{
	it('links the help pages at this deployment\'s own base', async () =>
	{
		markTourSeen();
		await mountApp();
		// The menu is a popover, so its contents are not in the document until it
		// is opened - and Reka portals them to the body rather than into the bar.
		document.querySelector('#help-button').click();
		await nextTick();
		await settle();
		const link = document.querySelector('a[href*="docs/"]');
		expect(link, 'the help menu links somewhere').not.toBeNull();
		// Resolved against the document rather than compared as a string: what
		// matters is where a click would land.
		const resolved = new URL(link.getAttribute('href'), document.baseURI);
		expect(resolved.pathname.endsWith(`docs/${HELP_PAGES[0].route}`)).toBe(true);
		expect(link.target).toBe('_blank');
		expect(link.rel).toContain('noopener');
	});

	it('has a help button the last step can point at', async () =>
	{
		markTourSeen();
		await mountApp();
		const button = document.querySelector('#help-button');
		expect(button).not.toBeNull();
		expect(button.getBoundingClientRect().width).toBeGreaterThan(0);
	});
});
