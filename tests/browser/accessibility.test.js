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
import {markTourSeen} from '../../src/app/composables/useTour.js';
// Imported here rather than read off `setupState`. A `<script setup>` exposes
// its refs and functions there and NOT its imported bindings, so
// `SELECTION_CORNER_2D` is `undefined` - which the first version of this
// block used, selecting a type nothing matches, leaving the inspector on its
// settings tab and auditing that five times over. See the guard in each case.
import {
	SELECTION_WALL, SELECTION_FLOOR, SELECTION_CORNER_2D, SELECTION_WALL_2D,
	SELECTION_ROOM_2D, SELECTION_DIMENSION, SELECTION_ANNOTATION,
} from '../../src/app/composables/useSelection.js';

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
	// A cleared store is a first visit, so every mount here would open the tour
	// (RM-014 L2). Its own case below turns it back on deliberately; the rest of
	// this file is about the shell without it.
	markTourSeen();
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

	it('stays accessible with the first-run tour open, on every step', async () =>
	{
		// A popover over a non-modal shell is exactly where a focus scope goes
		// wrong - RM-013 K2 found that once already with the credits dialog over
		// the catalog drawer - and the tour is the first thing a new person sees.
		const tour = wrapper.vm.$.setupState.tour;
		tour.start();
		for (let step = 0; step < tour.total; step++)
		{
			await nextTick();
			await new Promise((resolve) => setTimeout(resolve, 260));
			const found = await analyse();
			expect(found, `axe violations on tour step ${step + 1}:\n  ${found.join('\n  ')}`).toEqual([]);
			if (step < tour.total - 1) { tour.next(); }
		}
		tour.skip();
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

	it('and with the credits over it, which is a modal on top of a non-modal', async () =>
	{
		// The drawer is deliberately not modal - the point of it is that the scene
		// stays visible - and the credits dialog is. A modal opened from inside a
		// non-modal panel's portal is exactly where a focus scope goes wrong, and
		// it is why the credits are mounted as a sibling of the drawer's root
		// rather than inside its content (RM-012 J2).
		wrapper.vm.$.setupState.toggleCatalog();
		await nextTick();
		await nextTick();

		const credits = [...document.querySelectorAll('button')]
			.find((button) => button.textContent.trim() === 'Credits');
		expect(credits, 'no credits control in the drawer').toBeTruthy();
		credits.click();
		await nextTick();
		await nextTick();

		const panel = [...document.querySelectorAll('[role="dialog"]')]
			.find((node) => node.textContent.includes('Furniture credits'));
		expect(panel, 'the credits did not open').toBeTruthy();

		const results = await axe.run({exclude: EXCLUDED}, AXE_OPTIONS);
		const found = summarise(results.violations);
		expect(found, `axe violations with the credits open:\n  ${found.join('\n  ')}`).toEqual([]);
	});
});

/**
 * The screens the six cases above never reach (RM-017 P2, finding AC-4).
 *
 * **M-60** is the metric this block carries: *axe reports no violation on any
 * inspector panel or dialog the application can open.*
 *
 * ## What was audited before this, and what was not
 *
 * The six cases above are the plan layout, split and 3D, every control in the
 * rail and top bar having a name, all six steps of the first-run tour, the
 * catalog drawer, and the credits modal over it. AC-4 counted that against the
 * components that render a screen: **six of about twenty.** Fifteen inspector
 * panels and four dialogs had never been audited.
 *
 * That gap is the wrong way round. The shell is icon buttons and landmarks,
 * and Reka UI supplies most of what it needs; the panels are where the *form
 * controls* are - every label, every field association, every focus order that
 * somebody not using a mouse depends on. RM-014 L4 made this application
 * keyboard-drivable end to end, and this gate is what keeps it that way. It
 * was keeping a third of it that way.
 *
 * ## Opened, never mounted
 *
 * Each panel is reached by selecting the thing it inspects and each dialog by
 * pressing what opens it, because half of what axe checks is context: whether
 * a label is associated, whether a heading order makes sense, whether a
 * control sits inside a landmark, whether a modal traps focus. A component
 * mounted alone has none of that, and would pass while the application failed.
 *
 * ## And the count is asserted, not the list
 *
 * A twenty-first screen added later has to fail this rather than be silently
 * unaudited, which is the failure mode the six cases above had for two
 * programmes. So the last case counts the components that render a screen and
 * compares it against what this file opens.
 */

/** Reach every inspector panel by selecting what it inspects. */
const PANELS = [
	{name: 'corner', open: (app) => app.selection.select(SELECTION_CORNER_2D, corner(app))},
	{name: 'wall', open: (app) => app.selection.select(SELECTION_WALL_2D, wall(app))},
	{name: 'room', open: (app) => app.selection.select(SELECTION_ROOM_2D, room(app))},
	{name: 'dimension', open: (app) => app.selection.select(SELECTION_DIMENSION, dimension(app))},
	{name: 'annotation', open: (app) => app.selection.select(SELECTION_ANNOTATION, annotation(app))},
	// A wall face picked in the 3D view rather than the wall picked on the plan:
	// the same wall reached two ways, and the two render different panels.
	{name: 'surface', open: (app) => app.selection.select(SELECTION_WALL, edge(app))},
	{name: 'floor surface', open: (app) => app.selection.select(SELECTION_FLOOR, room(app))},
];

function plan(app) {return app.store.model.value.floorplan;}
function corner(app) {return plan(app).getCorners()[0];}
function wall(app) {return plan(app).getWalls()[0];}
function room(app) {return plan(app).getRooms()[0];}
function dimension(app) {return plan(app).newDimension(0, 0, 200, 0, {});}
function annotation(app) {return plan(app).newAnnotation(100, 100, 'A note');}
function edge(app) {return plan(app).wallEdges()[0];}

/** axe over the whole document, because dialogs portal out of the shell root. */
async function analyseDocument()
{
	const results = await axe.run({exclude: EXCLUDED}, AXE_OPTIONS);
	return summarise(results.violations);
}

describe('M-60 - the inspector panels are accessible', () =>
{
	for (const panel of PANELS)
	{
		it(`has no violations with the ${panel.name} panel open`, async () =>
		{
			const app = wrapper.vm.$.setupState;
			app.workspace.inspectorOpen.value = true;
			panel.open(app);
			await nextTick();
			await nextTick();

			// The panel really is the thing on screen, and this guard is the second
			// version of itself. The first asserted that the inspector held some
			// controls, which the SETTINGS tab satisfies - so five cases audited the
			// settings tab and reported it as five panels. What distinguishes them
			// is the tab and the panel's own heading.
			expect(app.inspectorTab, `the ${panel.name} selection did not open the selection tab`)
				.toBe('selection');
			const heading = document.querySelector('#inspector h2.inspector-heading');
			expect(heading, `the ${panel.name} panel rendered no heading`).toBeTruthy();
			expect(document.querySelectorAll('#inspector input, #inspector select, #inspector button').length,
				`the ${panel.name} panel rendered no controls`).toBeGreaterThan(0);

			const found = await analyseDocument();
			expect(found, `axe violations with the ${panel.name} panel:\n  ${found.join('\n  ')}`).toEqual([]);
		});
	}

	it('has no violations on the settings tab, which is the one that is open at boot', async () =>
	{
		const app = wrapper.vm.$.setupState;
		app.workspace.inspectorOpen.value = true;
		app.inspectorTab = 'settings';
		await nextTick();
		await nextTick();

		const found = await analyseDocument();
		expect(found, `axe violations on the settings tab:\n  ${found.join('\n  ')}`).toEqual([]);
	});
});

describe('M-60 - the dialogs are accessible', () =>
{
	it('has no violations with the shortcuts sheet open', async () =>
	{
		wrapper.vm.$.setupState.shortcutsOpen = true;
		await nextTick();
		await nextTick();

		expect(document.querySelector('[role="dialog"]'), 'no dialog rendered').toBeTruthy();
		const found = await analyseDocument();
		expect(found, `axe violations with the shortcuts sheet:\n  ${found.join('\n  ')}`).toEqual([]);
	});

	it('has no violations with the project library open', async () =>
	{
		wrapper.vm.$.setupState.libraryOpen = true;
		await nextTick();
		await nextTick();
		await new Promise((resolve) => setTimeout(resolve, 200));

		const found = await analyseDocument();
		expect(found, `axe violations with the library:\n  ${found.join('\n  ')}`).toEqual([]);
	});

	it('has no violations with the share dialog open', async () =>
	{
		wrapper.vm.$.setupState.shareOpen = true;
		await nextTick();
		await nextTick();

		const found = await analyseDocument();
		expect(found, `axe violations with the share dialog:\n  ${found.join('\n  ')}`).toEqual([]);
	});

	it('has no violations with the import dialog open', async () =>
	{
		wrapper.vm.$.setupState.importOpen = true;
		await nextTick();
		await nextTick();

		const found = await analyseDocument();
		expect(found, `axe violations with the import dialog:\n  ${found.join('\n  ')}`).toEqual([]);
	});
});

describe('M-60 - and the count is asserted, not the list', () =>
{
	/**
	 * Every component in the application that renders a screen, read off the
	 * tree rather than typed here.
	 *
	 * The failure mode the six cases above had for two programmes: they were a
	 * list, the application grew past it, and nothing said so. AC-4 found that
	 * by counting rather than by reading, so the count is what is kept - and it
	 * comes from `import.meta.glob`, because a number written in this file is a
	 * number that goes stale the same way the list did.
	 *
	 * A screen is something a person opens and then looks at. Three files in the
	 * inspector are not: `CollapsibleGroup` and `TexturePicker` are parts of a
	 * panel, and `InspectorPanel` is the frame the others render inside.
	 */
	const NOT_A_SCREEN = ['CollapsibleGroup', 'TexturePicker', 'InspectorPanel'];

	function screenFiles()
	{
		const found = [
			...Object.keys(import.meta.glob('../../src/app/inspector/*.vue')),
			...Object.keys(import.meta.glob('../../src/app/components/*Dialog.vue')),
			...Object.keys(import.meta.glob('../../src/app/components/{ProjectLibrary,CatalogDrawer,CatalogCredits,TourGuide}.vue')),
		];
		return found
			.map((path) => path.split('/').pop().replace('.vue', ''))
			.filter((name) => !NOT_A_SCREEN.includes(name));
	}

	/** What this file actually opens and points axe at. */
	const AUDITED = [
		'CornerInspector', 'Wall2DInspector', 'RoomInspector', 'DimensionInspector',
		'AnnotationInspector', 'SurfaceInspector', 'SettingsPanel',
		'ShortcutsDialog', 'ShareDialog', 'ImportModelDialog', 'ProjectLibrary',
		'CatalogDrawer', 'CatalogCredits', 'TourGuide',
	];

	/**
	 * The ones nothing here opens, and why - recorded rather than skipped
	 * quietly, which is what the acceptance asked for. Each needs a parametric
	 * item or an imported model placed in the scene first, which is a fixture
	 * this suite does not build and P2 did not price.
	 */
	const NOT_YET = ['ItemInspector', 'OpeningInspector', 'StairInspector',
		'StructureInspector', 'CarbonSheetPanel'];

	it('has a name for every screen the tree contains', () =>
	{
		const screens = screenFiles().sort();
		const accounted = [...AUDITED, ...NOT_YET].sort();

		// A twenty-first screen fails here rather than being silently unaudited,
		// which is the whole point: the list above must be revisited, and either
		// the screen is opened or it joins NOT_YET with a reason.
		expect(screens, 'screens this suite does not account for: '
			+ `${screens.filter((name) => !accounted.includes(name)).join(', ') || 'none'}`)
			.toEqual(accounted);
	});

	it('audits two thirds of them, and says which third it does not', () =>
	{
		const screens = screenFiles();

		expect(AUDITED.length + NOT_YET.length).toBe(screens.length);
		expect(AUDITED.length).toBe(14);
		// Five, all of them needing something placed in the scene first. Asserted
		// as a ceiling so the number can only come down.
		expect(NOT_YET.length).toBeLessThanOrEqual(5);
	});
});
