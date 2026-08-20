// @ts-check
import {computed, ref} from 'vue';
import {TOUR_STEPS, TOUR_VERSION} from '../tour/steps.js';

/**
 * The first five minutes (RM-014 L2, finding Z-7).
 *
 * ## Offered once, to somebody who has not been here
 *
 * Two questions, and the second one is the interesting half.
 *
 * **Has this browser seen the tour?** One key beside the four `architect3d.*`
 * keys the application already keeps. A mechanism rather than a new one.
 *
 * **Has this browser been USED?** RM-014's risk table names the failure this
 * avoids: a tour shown to somebody who has been drawing here for a month, because
 * they happened to clear one key. Some of the evidence is on disk and costs
 * nothing to read - a saved theme, a moved panel, a starred catalog item, a
 * walkthrough height. The rest the caller already knows, and `offer()` takes it
 * as an argument. Any of it and the tour marks itself seen and says nothing: it
 * is better to miss a first-time user than to interrupt somebody mid-design with
 * an introduction to the tool they are already using.
 *
 * ## The database check that was wrong, and how it was caught
 *
 * The first version of this asked `indexedDB.databases()` whether any of the
 * three stores existed. The browser tier failed on a genuinely clean profile and
 * the reason is structural: **the application creates all three during boot**,
 * before this ever runs - `useAutosave` opens the draft store, `useProjects`
 * lists the library, and `model_store` reads its index. Existence proves the
 * application started, which is not a question worth asking. What the tour needs
 * is whether the browser holds anything *of the person's*, and the caller is the
 * thing that knows: a recovered draft, or a project in the library. So it is an
 * argument, and there is no IndexedDB code here at all.
 *
 * ## The layout is borrowed and given back
 *
 * `AppWorkspace` keeps both panes mounted always and hides one by giving it no
 * width, so `#viewer` exists in the plan layout as a zero-width box. A step that
 * needs a pane names the layout that shows it; the tour switches, and restores
 * whatever was there when it ends - whether it ended by finishing, by skipping,
 * or by Escape.
 */

/** Where "this browser has seen the tour" lives. */
export const STORAGE_KEY = 'architect3d.tour';

/**
 * What counts as evidence that somebody has used this application before.
 *
 * Every one of these is written on a deliberate act - choosing a theme, moving
 * a panel, starring an item, setting an eye height - and none is written at
 * boot. `useLayout` persists from a watcher with no `immediate`, which is what
 * makes it usable as evidence rather than as noise.
 */
export const USED_KEYS = [
	'architect3d.theme',
	'architect3d.layout',
	'architect3d.catalog',
	'architect3d.walkthrough',
	'architect3d.autosave',
];

/**
 * @returns {?{version: number, at: number}}
 */
function read()
{
	try
	{
		var raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : null;
	}
	catch
	{
		// Private browsing, a disabled setting, a webview. A tour is the least
		// important thing in the application to protect, so a browser that will
		// not remember gets it once per session and no error.
		return null;
	}
}

/** Whether this browser has already been shown the current tour. */
export function tourSeen()
{
	var stored = read();
	return Boolean(stored && stored.version >= TOUR_VERSION);
}

/** Record that it has. */
export function markTourSeen()
{
	try
	{
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({version: TOUR_VERSION, at: Date.now()}));
	}
	catch
	{
		// See read(). Nothing here is worth failing a boot for.
	}
}

/** Forget it, so the next boot offers the tour again. The suite, and a person. */
export function forgetTour()
{
	try {window.localStorage.removeItem(STORAGE_KEY);}
	catch { /* see read() */ }
}

/** Whether any deliberate act has been recorded in this browser. */
export function looksUsed()
{
	try
	{
		return USED_KEYS.some(function (key) {return window.localStorage.getItem(key) !== null;});
	}
	catch
	{
		return false;
	}
}

/**
 * @param {Object} workspace The layout store, from `useLayout`.
 * @returns {Object}
 */
export function useTour(workspace)
{
	var open = ref(false);
	var index = ref(0);
	/** What the layout was before the tour borrowed it. @type {?string} */
	var borrowed = null;

	var steps = TOUR_STEPS;
	var step = computed(function () {return steps[index.value] || null;});
	var total = steps.length;
	var first = computed(function () {return index.value === 0;});
	var last = computed(function () {return index.value === total - 1;});

	/** Put the layout a step needs on screen, remembering the first one displaced. */
	function show(entry)
	{
		if (!entry || !entry.layout || !workspace)
		{
			return;
		}
		if (borrowed === null)
		{
			borrowed = workspace.layout.value;
		}
		workspace.setLayout(entry.layout);
	}

	/** Give the layout back, exactly once, however the tour ended. */
	function restore()
	{
		if (borrowed !== null && workspace)
		{
			workspace.setLayout(borrowed);
		}
		borrowed = null;
	}

	/** Start at the beginning, whatever the browser remembers. */
	function start()
	{
		index.value = 0;
		open.value = true;
		show(steps[0]);
	}

	function next()
	{
		if (last.value)
		{
			finish();
			return;
		}
		index.value += 1;
		show(step.value);
	}

	function back()
	{
		if (first.value)
		{
			return;
		}
		index.value -= 1;
		show(step.value);
	}

	/** Reached the end. Seen, and not offered again. */
	function finish()
	{
		open.value = false;
		markTourSeen();
		restore();
	}

	/**
	 * Left early - the Skip button, the close control, or Escape.
	 *
	 * Also marks it seen, and that is a decision rather than an oversight: a
	 * person who dismissed an introduction has answered the question, and asking
	 * again on the next boot is how an application teaches people to dismiss
	 * without reading. It is reachable from the help menu whenever they want it.
	 */
	function skip()
	{
		open.value = false;
		markTourSeen();
		restore();
	}

	/**
	 * Show the tour if this is genuinely a first visit.
	 *
	 * @param {boolean} [kept] Whether the caller can see anything of the person's
	 *        - a recovered draft, a project in the library. The application knows
	 *        this and the storage does not; see the note at the top for why the
	 *        first version of this asked IndexedDB and was wrong.
	 * @returns {boolean} whether it was shown.
	 */
	function offer(kept)
	{
		if (tourSeen())
		{
			return false;
		}
		if (kept || looksUsed())
		{
			// Used before, by somebody who lost the key or arrived before this
			// existed. Recorded as seen so the question is settled once rather than
			// re-asked on every boot.
			markTourSeen();
			return false;
		}
		start();
		return true;
	}

	return {open, index, step, steps, total, first, last, start, next, back, finish, skip, offer};
}
