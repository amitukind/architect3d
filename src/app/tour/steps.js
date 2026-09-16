// @ts-check
import {LAYOUT_PLAN, LAYOUT_SPLIT} from '../composables/useLayout.js';

/**
 * The first-run tour, as data (RM-014 L2, finding Z-7).
 *
 * ## Why this is a list and not a component
 *
 * Because the acceptance clause is about the list. Every step names an element
 * by id, and an id that has been renamed produces an empty popover pointing at
 * nothing - a failure a person would report as "the tour is broken" and nobody
 * would be able to reproduce from a screenshot. Kept as data, the whole list
 * can be walked against a mounted shell and asserted, which is what
 * `tests/tour.test.js` does.
 *
 * ## The anchors already existed
 *
 * Z-7 counted **13 stable ids** in the shell before this sprint, and every
 * anchor below is one of them but for `#top-bar`, which this sprint adds to the
 * one landmark that did not have one. Reka's `PopoverAnchor` takes a
 * `reference` element, and `PopoverRoot` was already in the bundle for the two
 * components that use it - so a tour costs no dependency and no new layout
 * code.
 *
 * ## Two steps change the layout, on purpose
 *
 * `AppWorkspace` keeps both panes mounted at all times and hides one by giving
 * it no width, for the reason its own note gives: a viewer hidden with `v-if`
 * measures zero and cannot be sized when it comes back. So `#viewer` exists in
 * the plan layout - as a zero-width box, which is not a thing to point at. A
 * step that needs a pane says which layout shows it, the tour switches, and
 * whatever the person had is restored when the tour ends.
 */

/**
 * @typedef {Object} TourStep
 * @property {string} id Stable, and what the storage records if a tour is ever
 *           resumed. Not the anchor: an anchor may move between releases and
 *           the step it belongs to does not.
 * @property {string} anchor A CSS selector for an element in the shell.
 * @property {?string} layout Which layout shows the anchor, or null for one
 *           that is visible in all three.
 * @property {string} side Where the card sits relative to the anchor.
 * @property {string} title
 * @property {string} body Second person, one idea, no jargon. These are the
 *           first words this application has ever addressed to somebody using
 *           it rather than integrating it.
 */

/**
 * Bumped when the steps change enough that somebody who saw the old tour should
 * be offered the new one. Not on a wording fix - on a step being added or a
 * feature being taught that did not exist.
 */
export const TOUR_VERSION = 1;

/** @type {Array<TourStep>} */
export const TOUR_STEPS = [
	{
		id: 'plan',
		anchor: '#floorplanner',
		layout: LAYOUT_PLAN,
		side: 'right',
		title: 'This is the plan',
		body: 'Draw here, from above. A room is four walls, and the one you start with is '
			+ 'already drawn — drag a corner and watch the whole thing follow.',
	},
	{
		id: 'tools',
		anchor: '#tool-rail',
		layout: null,
		side: 'right',
		title: 'Pick a tool, or press its key',
		body: 'Walls, rooms, a tape measure, a text label. Every tool shows its key when you '
			+ 'hover it, and W draws a wall from anywhere.',
	},
	{
		id: 'furniture',
		anchor: '#tool-rail',
		layout: null,
		side: 'right',
		title: 'Furniture lives behind A',
		body: 'Two hundred and seventeen things, filed by room. Click one and it lands on the '
			+ 'floor or wall you last clicked in 3D. You can bring your own model too.',
	},
	{
		id: 'view',
		anchor: '#viewer',
		layout: LAYOUT_SPLIT,
		side: 'left',
		title: 'The same room, in 3D',
		body: 'Drag to orbit, scroll to zoom. Press 1, 2 and 3 to show the plan, both, or only '
			+ 'the view — and F to walk through it at eye height.',
	},
	{
		id: 'inspector',
		anchor: '#inspector',
		layout: null,
		side: 'left',
		title: 'Change what you picked',
		body: 'Select a wall, a room, a corner or a chair, and everything about it appears '
			+ 'here — length, height, materials, colour.',
	},
	{
		id: 'keep',
		anchor: '#top-bar',
		layout: null,
		side: 'bottom',
		title: 'Keep it, or send it',
		body: 'Designs are saved in this browser, on this machine — nothing is uploaded and '
			+ 'there is no account. Send one as a link or a file. The ? here reopens this tour.',
	},
];
