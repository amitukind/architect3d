// @ts-check
/**
 * DOM helpers shared by the 2D floorplanner and the 3D view.
 *
 * Added in migration sprint S2, when jQuery was removed from the library. Every
 * function here replaces a jQuery idiom that the library used to rely on, and
 * each one is deliberately the *narrow* native equivalent rather than a general
 * utility - the library only ever needed these four things.
 */

/**
 * jQuery's `$(target)` accepted an element, an id, or a selector. The library
 * called it three different ways: `$(element)` with a raw node, `$('#viewer')`
 * with a selector, and `$('#' + canvasId)` with a hand-built one. This accepts
 * all of them so existing embedders keep working.
 *
 * Passing an id or selector string is the deprecated path - prefer handing the
 * constructors a real HTMLElement.
 *
 * @param {(Element|string)} target An element, an element id (with or without
 * a leading '#'), or any CSS selector.
 * @param {string} description Used in the error message when nothing matches.
 * @returns {Element}
 */
export function resolveElement(target, description)
{
	// `typeof target !== 'string'` is here for the type checker, not the runtime:
	// a string has no `nodeType`, so the original `target && target.nodeType === 1`
	// already fell through for one. Reading a property off the union is what the
	// checker objects to, and the guard is exactly equivalent for every input.
	if (target && typeof target !== 'string' && target.nodeType === 1)
	{
		return target;
	}
	if (typeof target === 'string' && target.length > 0)
	{
		var id = (target.charAt(0) === '#') ? target.slice(1) : target;
		var byId = document.getElementById(id);
		if (byId)
		{
			return byId;
		}
		try
		{
			var found = document.querySelector(target);
			if (found)
			{
				return found;
			}
		}
		catch
		{
			// Not a valid CSS selector either. Fall through to the throw below.
		}
	}
	throw new Error(`Cannot resolve ${description || 'element'}: ${String(target)} did not match any element in the document.`);
}

/**
 * Replaces `$(el).offset()` + `$(el).innerWidth()/innerHeight()`.
 *
 * Two different boxes on purpose:
 *
 * - `left`/`top` come from getBoundingClientRect, so they are **viewport**
 *   relative and line up with the clientX/clientY on a pointer event. jQuery's
 *   .offset() is document relative (it adds window.scrollX/Y), which meant every
 *   `event.clientX - offset.left` in the old code was wrong by the scroll
 *   position. That is the deliberate scroll-offset fix noted in the roadmap; it
 *   is invisible in the demo, whose page never scrolls.
 * - `width`/`height` come from clientWidth/clientHeight, matching jQuery's
 *   .innerWidth()/.innerHeight() (content + padding, no border, no scrollbar).
 *   Unlike getBoundingClientRect these are not affected by CSS transforms, which
 *   matters because the demo flips its two panes with rotateX.
 *
 * @param {Element} element
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function elementBox(element)
{
	var rect = element.getBoundingClientRect();
	return {left: rect.left, top: rect.top, width: element.clientWidth, height: element.clientHeight};
}

/**
 * The size the library should render at, measured from `element`.
 *
 * Falls back to the supplied viewport-derived values when the element has no
 * layout size of its own. That fallback exists for the legacy demo: jquery.flip
 * stamps `height: 100%` inline on both panes, and their shared wrapper collapses
 * to zero height because both panes are absolutely positioned. The pre-S2 code
 * never noticed, because it simply read window.innerWidth/innerHeight and never
 * measured anything. Hosts that give their container a real size get
 * container-driven sizing; hosts that do not get exactly the old behaviour.
 *
 * @param {?Element} element The container, or null before one is attached -
 * the body already handles that and returns the fallback size (RM-005 C2).
 * @param {number} fallbackWidth
 * @param {number} fallbackHeight
 * @returns {{width: number, height: number}}
 */
export function measureViewport(element, fallbackWidth, fallbackHeight)
{
	var width = element ? element.clientWidth : 0;
	var height = element ? element.clientHeight : 0;
	return {width: (width > 0) ? width : fallbackWidth, height: (height > 0) ? height : fallbackHeight};
}

/**
 * Device pixel ratio, clamped to something sane and safe in a headless test.
 *
 * @returns {number}
 */
export function pixelRatio()
{
	if (typeof window === 'undefined' || !window.devicePixelRatio)
	{
		return 1;
	}
	return Math.max(1, Math.min(window.devicePixelRatio, 4));
}

/**
 * The same resolution, for a target the caller knows is a canvas.
 *
 * Three of `resolveElement`'s four call sites want a canvas and then read
 * `getContext`, `width`, `height` and `style` off it - none of which are on
 * `Element`, which is 14 of the floorplanner's type errors (RM-005 C2). The
 * fourth, `Main`'s viewer container, is a div and keeps the general function.
 *
 * The check is `instanceof HTMLCanvasElement` rather than a cast, so a caller
 * that hands a `<div id="floorplanner">` gets a message naming the problem
 * instead of `getContext is not a function` several frames later.
 *
 * @param {(Element|string)} target
 * @param {string} description Used in the error message when nothing matches.
 * @returns {HTMLCanvasElement}
 */
export function resolveCanvas(target, description)
{
	var element = resolveElement(target, description);
	if (!(element instanceof HTMLCanvasElement))
	{
		throw new Error('architect3d: ' + description + ' is not a <canvas>.');
	}
	return element;
}

/** The query that decides whether the application is allowed to move. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether this person has asked the system to stop animating things
 * (RM-014 L4, finding Z-6).
 *
 * A function rather than a constant, because the preference can change while
 * the page is open - a user switching it in system settings expects the tab
 * they left open to obey - and because a constant evaluated at import time
 * would be read before jsdom has a `matchMedia` in some test setups.
 *
 * Absent `matchMedia`, the answer is **false**: an environment that cannot be
 * asked has not asked for anything, and defaulting to "reduce" would silently
 * turn off motion for every embedder on an older host.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion()
{
	try
	{
		return Boolean(window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches);
	}
	catch
	{
		// A host that throws on an unknown media feature. Not worth a boot.
		return false;
	}
}

/**
 * Call `onChange` whenever the reduced-motion preference flips.
 *
 * `addEventListener` where it exists and `addListener` where it does not: the
 * latter is deprecated but is the only form Safari understood until 14, and a
 * preference listener that silently does nothing is worse than none.
 *
 * @param {function(boolean): void} onChange
 * @returns {function(): void} Detach. Safe to call more than once.
 */
export function watchReducedMotion(onChange)
{
	var query = null;
	try
	{
		query = window.matchMedia ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
	}
	catch
	{
		query = null;
	}
	if (!query)
	{
		return function () {};
	}
	var handler = function (event) {onChange(Boolean(event && event.matches));};
	if (query.addEventListener)
	{
		query.addEventListener('change', handler);
		return function () {query.removeEventListener('change', handler);};
	}
	if (query.addListener)
	{
		query.addListener(handler);
		return function () {query.removeListener(handler);};
	}
	return function () {};
}
