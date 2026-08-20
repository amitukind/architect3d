// @vitest-environment jsdom
/**
 * The first five minutes (RM-014 L2, finding Z-7).
 *
 * Two questions the tour has to get right, and only one of them is about
 * showing a popover.
 *
 * **Is this a first visit?** RM-014's risk table names the failure: a tour shown
 * to somebody who has been drawing here for a month because they cleared one
 * key. The evidence is already on disk - a saved theme, a moved panel, a starred
 * item, one of the three databases - and the tour reads it before it offers
 * itself.
 *
 * **Do the steps point at anything?** A renamed id produces a popover pointing
 * at nothing, which is a bug nobody can reproduce from a screenshot. The step
 * list is data for exactly this reason, and it is walked here against the ids
 * the components actually render.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {ref} from 'vue';

import {TOUR_STEPS, TOUR_VERSION} from '../src/app/tour/steps.js';
import {HELP_PAGES, HELP_HOME, helpUrl} from '../src/app/tour/help.js';
import {STORAGE_KEY, USED_KEYS, forgetTour, looksUsed,
	markTourSeen, tourSeen, useTour} from '../src/app/composables/useTour.js';
import {LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from '../src/app/composables/useLayout.js';

/** Every `id="..."` the application's components render. */
function renderedIds()
{
	const found = new Set();
	const walk = (dir) =>
	{
		for (const entry of readdirSync(dir, {withFileTypes: true}))
		{
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { walk(path); }
			else if (entry.name.endsWith('.vue'))
			{
				for (const match of readFileSync(path, 'utf8').matchAll(/\sid="([a-z0-9-]+)"/g))
				{
					found.add(match[1]);
				}
			}
		}
	};
	walk(join(process.cwd(), 'src/app'));
	return found;
}

/** A stand-in for `useLayout`, which is the only thing the tour reaches into. */
function workspace(initial)
{
	const layout = ref(initial || LAYOUT_PLAN);
	return {layout, setLayout: (value) => {layout.value = value;}};
}

beforeEach(() =>
{
	window.localStorage.clear();
});

afterEach(() =>
{
	window.localStorage.clear();
});

describe('the steps', () =>
{
	it('points every step at an id a component renders', () =>
	{
		const ids = renderedIds();
		const broken = TOUR_STEPS.filter((step) => !ids.has(step.anchor.replace('#', '')));
		expect(broken.map((step) => `${step.id} -> ${step.anchor}`)).toEqual([]);
		expect(TOUR_STEPS.length).toBeGreaterThan(3);
	});

	it('gives every step an id, a side and words', () =>
	{
		TOUR_STEPS.forEach((step) =>
		{
			expect(step.id, 'each step has an id').toBeTruthy();
			expect(['top', 'right', 'bottom', 'left']).toContain(step.side);
			expect(step.title.length, `${step.id} has a title`).toBeGreaterThan(3);
			// Long enough to say something, short enough that nobody skips it.
			expect(step.body.length, `${step.id} says something`).toBeGreaterThan(40);
			expect(step.body.length, `${step.id} is not an essay`).toBeLessThan(260);
		});
		expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(TOUR_STEPS.length);
	});

	it('names a real layout wherever it names one', () =>
	{
		// Two steps point at a pane, and `AppWorkspace` gives a hidden pane no
		// width rather than unmounting it - so a step that did not switch would
		// point at a zero-width box.
		const layouts = TOUR_STEPS.map((step) => step.layout).filter(Boolean);
		expect(layouts.length).toBeGreaterThan(0);
		layouts.forEach((layout) => expect([LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW]).toContain(layout));
	});
});

describe('whether it is offered at all', () =>
{
	it('is offered on a browser that has never been here', () =>
	{
		const tour = useTour(workspace());
		expect(tour.offer(false)).toBe(true);
		expect(tour.open.value).toBe(true);
		expect(tour.index.value).toBe(0);
	});

	it('is not offered twice', () =>
	{
		const tour = useTour(workspace());
		tour.offer(false);
		tour.finish();
		expect(tourSeen()).toBe(true);

		const second = useTour(workspace());
		expect(second.offer(false)).toBe(false);
		expect(second.open.value).toBe(false);
	});

	it('is not offered to somebody who has used the application before', () =>
	{
		// The risk RM-014 names: an introduction interrupting somebody mid-design
		// because they happened to clear one key. Each of these is written on a
		// deliberate act and none at boot.
		for (const key of USED_KEYS)
		{
			window.localStorage.clear();
			window.localStorage.setItem(key, '"something"');
			expect(looksUsed(), `${key} counts as evidence`).toBe(true);
			const tour = useTour(workspace());
			expect(tour.offer(false), `${key} suppresses the tour`).toBe(false);
			// And the question is settled rather than re-asked on every boot.
			expect(tourSeen()).toBe(true);
		}
	});

	it('takes the caller\'s word for what the storage cannot say', () =>
	{
		// The first version of this asked `indexedDB.databases()` and the browser
		// tier failed on a genuinely clean profile: the application creates all
		// three databases during boot, so their existence proves only that it
		// started. What matters is whether the browser holds anything of the
		// person's, and App.vue is the thing that knows - a recovered draft, or a
		// project in the library.
		expect(useTour(workspace()).offer(true)).toBe(false);
		expect(tourSeen()).toBe(true);

		window.localStorage.clear();
		expect(useTour(workspace()).offer(false)).toBe(true);
	});

	it('survives a browser that refuses storage', () =>
	{
		const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {throw new Error('this browser withholds storage');},
		});
		// A tour is the least important thing in the application to protect, so a
		// refusal is one tour per session and no error anywhere.
		expect(tourSeen()).toBe(false);
		expect(looksUsed()).toBe(false);
		expect(() => markTourSeen()).not.toThrow();
		expect(() => forgetTour()).not.toThrow();
		if (original) { Object.defineProperty(window, 'localStorage', original); }
	});

	it('can be forgotten, which is what the help menu offers', () =>
	{
		markTourSeen();
		expect(window.localStorage.getItem(STORAGE_KEY)).toBeTruthy();
		forgetTour();
		expect(tourSeen()).toBe(false);
	});

	it('offers a newer tour to somebody who saw an older one', () =>
	{
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({version: TOUR_VERSION - 1, at: 1}));
		expect(tourSeen()).toBe(false);
	});
});

describe('walking through it', () =>
{
	it('moves forward and back without falling off either end', () =>
	{
		const tour = useTour(workspace());
		tour.start();
		expect(tour.first.value).toBe(true);
		tour.back();
		expect(tour.index.value).toBe(0);

		for (let i = 1; i < tour.total; i++)
		{
			tour.next();
			expect(tour.index.value).toBe(i);
		}
		expect(tour.last.value).toBe(true);
		tour.next();
		expect(tour.open.value).toBe(false);
		expect(tourSeen()).toBe(true);
	});

	it('borrows the layout a step needs and gives it back', () =>
	{
		const space = workspace(LAYOUT_VIEW);
		const tour = useTour(space);
		tour.start();
		// The first step is the plan, so the 3D-only layout the person had is
		// displaced immediately.
		expect(space.layout.value).toBe(LAYOUT_PLAN);
		while (!tour.last.value) { tour.next(); }
		tour.finish();
		expect(space.layout.value).toBe(LAYOUT_VIEW);
	});

	it('gives it back when somebody leaves early, too', () =>
	{
		const space = workspace(LAYOUT_VIEW);
		const tour = useTour(space);
		tour.start();
		tour.next();
		tour.skip();
		expect(space.layout.value).toBe(LAYOUT_VIEW);
		// Skipping counts as an answer. Asking again on the next boot is how an
		// application teaches people to dismiss without reading.
		expect(tourSeen()).toBe(true);
	});

	it('restores the layout once, not once per step', () =>
	{
		const space = workspace(LAYOUT_VIEW);
		const tour = useTour(space);
		tour.start();
		while (!tour.last.value) { tour.next(); }
		tour.finish();
		space.setLayout(LAYOUT_SPLIT);
		// A second finish must not resurrect a layout the person has since changed.
		tour.finish();
		expect(space.layout.value).toBe(LAYOUT_SPLIT);
	});

	it('does not touch the layout when no step asked it to', () =>
	{
		const space = workspace(LAYOUT_SPLIT);
		const tour = useTour(space);
		// Starting on a step that names no layout leaves it alone; the first real
		// step does not, which is what the previous case covers.
		expect(space.layout.value).toBe(LAYOUT_SPLIT);
		tour.skip();
		expect(space.layout.value).toBe(LAYOUT_SPLIT);
	});
});

describe('the help pages', () =>
{
	it('resolves against this deployment rather than a hard-coded path', () =>
	{
		expect(helpUrl(undefined, '/architect3d/')).toBe('/architect3d/docs/using/');
		expect(helpUrl('using/drawing', '/architect3d/')).toBe('/architect3d/docs/using/drawing');
		// A base with no trailing slash is a deployment somebody configured by
		// hand, and it must not produce `/architect3ddocs/`.
		expect(helpUrl(undefined, '/architect3d')).toBe('/architect3d/docs/using/');
		expect(helpUrl(undefined, '/')).toBe('/docs/using/');
	});

	it('has a source on disk for every page it links', () =>
	{
		HELP_PAGES.forEach((page) =>
		{
			const source = readFileSync(join(process.cwd(), 'docs', page.source), 'utf8');
			expect(source.length, `${page.source} has content`).toBeGreaterThan(400);
			// Written for somebody using the planner, which is the whole point of
			// the sprint. A page addressed to nobody is the state Z-7 measured.
			expect(source, `${page.source} addresses the reader`).toMatch(/\byou\b/i);
		});
		expect(HELP_HOME).toBe(HELP_PAGES[0]);
	});

	it('is reachable from the documentation site itself', () =>
	{
		const config = readFileSync(join(process.cwd(), 'docs/.vitepress/config.mjs'), 'utf8');
		HELP_PAGES.forEach((page) =>
		{
			expect(config, `${page.route} is in the nav or sidebar`).toContain(`'/${page.route}'`);
		});
	});
});
