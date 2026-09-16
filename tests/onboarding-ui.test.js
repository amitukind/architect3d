// @vitest-environment jsdom
/**
 * What the application says to somebody who does not know what to do yet
 * (RM-014 L2).
 *
 * Two subjects, and they are one subject. The tour is what it says on a first
 * visit; an empty state is what it says every other time somebody is looking at
 * nothing. Z-7 found the second half in a worse state than the first: with a
 * shortlist selected and no search term, the catalog said <em>Nothing matches
 * ""</em> - a sentence that is both untrue and unhelpful, in the one place a
 * person is most likely to be lost.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {h, nextTick, ref} from 'vue';
import {mount} from '@vue/test-utils';
import {TooltipProvider} from 'reka-ui';

import TourGuide from '../src/app/components/TourGuide.vue';
import CatalogDrawer from '../src/app/components/CatalogDrawer.vue';
import PlanOverlay from '../src/app/components/PlanOverlay.vue';
import {ZOOM_2D_KEY} from '../src/app/composables/useZoom2D.js';
import {TOUR_KEY} from '../src/app/composables/useTour.js';
import {PLAN_STATS_KEY} from '../src/app/composables/usePlanStats.js';
import {FLOORPLANNER_MODE_KEY} from '../src/app/composables/useFloorplannerMode.js';
import {TOUR_STEPS} from '../src/app/tour/steps.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {noteUsed} from '../src/app/composables/useCatalogBrowse.js';
import {installIntersectionObserver, installResizeObserver} from './helpers/dom.js';

/** An element the tour can point at, with a rectangle jsdom will not invent. */
function anchor(id, box)
{
	const node = document.createElement('div');
	node.id = id;
	node.getBoundingClientRect = () => Object.assign(
		{top: 10, left: 20, width: 300, height: 200, right: 320, bottom: 210, x: 20, y: 10},
		box || {});
	document.body.appendChild(node);
	return node;
}

function card()
{
	return document.querySelector('[data-testid="tour-card"]');
}

function buttonBy(label)
{
	return [...document.querySelectorAll('[data-testid="tour-card"] button')]
		.find((node) => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
}

async function showStep(index, extra)
{
	const step = TOUR_STEPS[index];
	anchor(step.anchor.replace('#', ''));
	// `useTour` is injected since RM-020 S-5, so what used to be six props is
	// now the composable's shape. The three navigation calls are recorded, since
	// two cases assert that a button reaches them.
	const calls = {next: [], back: [], skip: []};
	const tour = Object.assign({
		open: ref(true), step: ref(step), index: ref(index),
		total: TOUR_STEPS.length,
		first: ref(index === 0), last: ref(index === TOUR_STEPS.length - 1),
		next() {calls.next.push(1);}, back() {calls.back.push(1);}, skip() {calls.skip.push(1);},
	}, extra || {});
	const wrapper = mount(TourGuide, {
		attachTo: document.body,
		global: {provide: {[TOUR_KEY]: tour}},
	});
	wrapper.tour = tour;
	wrapper.calls = calls;
	await nextTick();
	await nextTick();
	await nextTick();
	return wrapper;
}

let wrapper;
let observers;

beforeEach(() =>
{
	document.body.innerHTML = '';
	// Reka's popover watches its anchor with an IntersectionObserver and its
	// content with a ResizeObserver; jsdom has neither.
	observers = [installIntersectionObserver(window), installResizeObserver(window)];
});

afterEach(() =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
	observers.forEach((observer) => observer.restore());
	document.body.innerHTML = '';
});

/**
 * `AppTip` is a Reka tooltip and wants a provider, which `App.vue` supplies once
 * around the whole shell. A component mounted on its own needs one too.
 */
function inProvider(component, props, provide)
{
	return mount(TooltipProvider, {
		attachTo: document.body,
		global: provide ? {provide} : {},
		slots: {default: () => h(component, props)},
	});
}

describe('the tour card', () =>
{
	it('says which step it is on, and what the step says', async () =>
	{
		wrapper = await showStep(0);
		expect(card()).not.toBeNull();
		expect(card().textContent).toContain(`Step 1 of ${TOUR_STEPS.length}`);
		expect(card().textContent).toContain(TOUR_STEPS[0].title);
		expect(card().textContent).toContain(TOUR_STEPS[0].body.slice(0, 30));
	});

	it('offers no Back on the first step, and both after it', async () =>
	{
		wrapper = await showStep(0);
		expect(buttonBy('Back')).toBeUndefined();
		expect(buttonBy('Next')).toBeTruthy();
		wrapper.unmount();
		document.body.innerHTML = '';

		wrapper = await showStep(1);
		expect(buttonBy('Back')).toBeTruthy();
	});

	it('ends with an invitation rather than with "Next"', async () =>
	{
		wrapper = await showStep(TOUR_STEPS.length - 1);
		expect(buttonBy('Start drawing')).toBeTruthy();
		expect(buttonBy('Next')).toBeUndefined();
	});

	it('emits what the buttons say they do', async () =>
	{
		wrapper = await showStep(1);
		buttonBy('Next').click();
		buttonBy('Back').click();
		buttonBy('Skip the tour').click();
		await nextTick();
		// Direct calls on the injected composable since RM-020 S-5, not events.
		expect(wrapper.calls.next).toHaveLength(1);
		expect(wrapper.calls.back).toHaveLength(1);
		expect(wrapper.calls.skip).toHaveLength(1);
	});

	it('rings the element it is pointing at, measured rather than styled onto it', async () =>
	{
		wrapper = await showStep(0);
		const ring = document.querySelector('[data-testid="tour-ring"]');
		expect(ring).not.toBeNull();
		expect(ring.style.top).toBe('10px');
		expect(ring.style.left).toBe('20px');
		expect(ring.style.width).toBe('300px');
		expect(ring.style.height).toBe('200px');
		// It owns nothing on the target, so the target is exactly as it was.
		expect(document.querySelector(TOUR_STEPS[0].anchor).className).toBe('');
	});

	it('shows nothing at all rather than an empty card when the anchor is gone', async () =>
	{
		// The failure the step list is data to prevent: a renamed id. Here the
		// element simply is not created.
		wrapper = mount(TourGuide, {
			attachTo: document.body,
			global: {provide: {[TOUR_KEY]: {
				open: ref(true), step: ref(TOUR_STEPS[0]), index: ref(0),
				total: TOUR_STEPS.length, first: ref(true), last: ref(false),
				next() {}, back() {}, skip() {},
			}}},
		});
		await nextTick();
		await nextTick();
		expect(card()).toBeNull();
		expect(document.querySelector('[data-testid="tour-ring"]')).toBeNull();
	});

	it('draws nothing when it is closed', async () =>
	{
		anchor('tool-rail');
		wrapper = mount(TourGuide, {
			attachTo: document.body,
			global: {provide: {[TOUR_KEY]: {
				open: ref(false), step: ref(TOUR_STEPS[1]), index: ref(1),
				total: TOUR_STEPS.length, first: ref(false), last: ref(false),
				next() {}, back() {}, skip() {},
			}}},
		});
		await nextTick();
		expect(card()).toBeNull();
	});
});

describe('an empty catalog list', () =>
{
	const SECTIONS = [{
		id: 1, name: 'Seating',
		items: [{name: 'Chair', model: 'models/chair.glb', type: 1, room: 'living', tags: ['chair']}],
	}];

	async function drawer(props)
	{
		const mounted = inProvider(CatalogDrawer, Object.assign({open: true, sections: SECTIONS}, props || {}));
		await nextTick();
		await nextTick();
		return mounted;
	}

	function emptyText()
	{
		const node = document.querySelector('[data-testid="catalog-empty"]');
		return node ? node.textContent.replace(/\s+/g, ' ').trim() : null;
	}

	function chip(label)
	{
		return [...document.querySelectorAll('[role="dialog"] button')]
			.find((node) => node.textContent.trim().startsWith(label));
	}

	it('names the search term when there was one', async () =>
	{
		wrapper = await drawer();
		const search = document.querySelector('[role="dialog"] input[type="search"], [role="dialog"] input');
		search.value = 'zzzz';
		search.dispatchEvent(new Event('input'));
		await nextTick();
		expect(emptyText()).toBe('Nothing matches “zzzz”.');
	});

	it('says what starring IS when nothing is starred, rather than matching nothing', async () =>
	{
		// The defect Z-7 found: with a shortlist on and no query this read
		// `Nothing matches ""`, which is untrue and tells nobody anything.
		wrapper = await drawer();
		chip('Starred').click();
		await nextTick();
		expect(emptyText()).toContain('Nothing starred yet');
		expect(emptyText()).toContain('star on any tile');
		expect(emptyText()).not.toContain('Nothing matches');
	});

	it('explains a recent list whose kit has not arrived', async () =>
	{
		// Reachable, and not by clicking an empty chip - the chip only appears once
		// something has been placed. This is a recently used item from a pack that
		// has not loaded, which is what a slow first open of the drawer looks like.
		noteUsed('packs/kenney/sofa.glb');
		wrapper = await drawer();
		chip('Recent').click();
		await nextTick();
		expect(emptyText()).toContain('has loaded');
		expect(emptyText()).not.toContain('“”');
	});
});

describe('an empty plan', () =>
{
	async function overlay(walls)
	{
		// Zoom and the plan counts are injected since RM-020 S-5, so a component
		// mounted on its own supplies them the way the shell does. Only the two
		// values this case is about need to be real; the rest is the shape
		// `PlanOverlay` reads.
		const mounted = inProvider(PlanOverlay, {unit: 'm'}, {
			[FLOORPLANNER_MODE_KEY]: {
				mode: ref(floorplannerModes.MOVE),
				angleSnap: ref(false),
				drawTarget: ref(null),
				setAngleSnap() {}, applyDrawTarget() {},
			},
			[ZOOM_2D_KEY]: {
				percent: ref(100), canZoomIn: ref(true), canZoomOut: ref(true),
				snap: ref(false), spacing: ref(25),
				gridSpacings: [{value: 25, label: '25'}],
				zoomIn() {}, zoomOut() {}, zoomToFit() {}, resetZoom() {},
				centre() {}, setSnap() {}, setSpacing() {},
			},
			[PLAN_STATS_KEY]: {walls: ref(walls)},
		});
		await nextTick();
		return mounted;
	}

	it('says what to press when there is nothing on it', async () =>
	{
		wrapper = await overlay(0);
		const hint = document.querySelector('[data-testid="empty-plan"]');
		expect(hint).not.toBeNull();
		expect(hint.textContent).toContain('Nothing drawn yet');
		expect(hint.textContent).toContain('W');
		// Reachable in one gesture - deleting the four walls it starts with - so
		// the hint also says how to get them back.
		expect(hint.textContent).toContain('brings back anything you deleted');
	});

	it('and says nothing at all once there is', async () =>
	{
		wrapper = await overlay(4);
		expect(document.querySelector('[data-testid="empty-plan"]')).toBeNull();
	});
});
