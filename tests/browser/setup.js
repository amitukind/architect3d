/**
 * The application's own stylesheet, loaded before anything mounts (RM-018 Q3).
 *
 * ## Not the setup file P6 deleted
 *
 * P5 shipped a `tests/browser/setup.js` that swallowed chromium's
 * `ResizeObserver loop completed with undelivered notifications` by matching
 * its exact message, and P6 deleted it rather than keep it - the notice was a
 * real defect report and the fix belonged in the library. That reasoning stands
 * and this file does not touch it: it suppresses nothing, listens for nothing,
 * and the tier still fails on any window error at all.
 *
 * ## What it does, and the loop it stops
 *
 * It imports the stylesheet. Until Q3 this tier registered only the Vue plugin,
 * so Tailwind never compiled and every utility class in the shell was inert.
 * L2 recorded half of what that costs - `getBoundingClientRect` is useless as a
 * visibility test here - and concluded nothing depended on it. Measured in Q3,
 * something did.
 *
 * `#app-shell` is `h-screen w-screen`. Unstyled, it has no height, so the
 * floorplanner's `ResizeObserver` measured a container that grew every time it
 * wrote to the canvas inside it. In a three-second window on an idle
 * application, `#floorplanner-canvas` was resized **62 times** and reached
 * **21,817 pixels tall** - a 1024-wide backing store of about 89 MB, cleared
 * and repainted, in all thirty-nine files of this tier.
 *
 * The built application does none of it: the same probe against `dist-demo`
 * served over HTTP recorded **zero** mutations in three seconds and a canvas of
 * 928 x 824, matching its parent exactly. So this was never a product defect -
 * it was the harness, and the harness was quietly costing every test in the
 * tier a runaway repaint loop while several of them read pixels off that very
 * canvas.
 *
 * With the stylesheet loaded the count is zero, because `h-screen` sizes from
 * the viewport and needs no height from a parent - which is also why nothing
 * here has to give the mount root a size.
 */
import '../../src/app/styles/app.css';
