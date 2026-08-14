/**
 * Browser-tier setup (RM-002 P5, tier 2).
 *
 * ## The ResizeObserver notification
 *
 * Chromium emits `ResizeObserver loop completed with undelivered notifications`
 * as a window `error` event whenever an observer callback changes the size of
 * something before the browser has finished delivering the current batch. That
 * is exactly what this library does on purpose: `Main`'s observer resizes the
 * renderer's canvas, and `FloorplannerView2D`'s resizes the plan canvas and
 * recentres it.
 *
 * It is a notice, not a failure. The browser retries delivery on the next
 * frame, nothing is dropped, and it does not fire in the running application
 * because the resizes there are spread across frames rather than provoked
 * back-to-back by a test mounting and re-laying-out in one tick.
 *
 * Vitest's browser runner promotes any window error to an unhandled error and
 * fails the run on it, which would make every layout test flaky for a reason
 * that has nothing to do with what they assert. Swallowed by exact message so
 * that a real uncaught error still fails, loudly.
 *
 * If this ever needs revisiting: the fix on the library side is to defer the
 * resize work to a frame callback rather than doing it inside the observer -
 * which is the same rAF-coalescing change RM-002 R-05 proposes for the 2D
 * redraw path, and is P6's.
 */
const IGNORED = [
	'ResizeObserver loop completed with undelivered notifications',
	'ResizeObserver loop limit exceeded',
];

function isIgnorable(message)
{
	return typeof message === 'string' && IGNORED.some((entry) => message.includes(entry));
}

window.addEventListener('error', function (event)
{
	if (isIgnorable(event.message))
	{
		event.stopImmediatePropagation();
		event.preventDefault();
	}
}, true);

window.addEventListener('unhandledrejection', function (event)
{
	const message = event.reason && event.reason.message;
	if (isIgnorable(message))
	{
		event.stopImmediatePropagation();
		event.preventDefault();
	}
}, true);
