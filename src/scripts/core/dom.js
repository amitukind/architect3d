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
 * @param {Element} element
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
