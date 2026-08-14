// @ts-check
import {computed, onScopeDispose, ref, watch} from 'vue';
import {Configuration, gridSpacing, snapToGrid, pixelsPerCm} from '../../scripts/blueprint.js';

/**
 * Zoom, snapping and grid density for the 2D plan.
 *
 * ## Why the library cannot do this itself
 *
 * `Dimensioning.cmToPixel` multiplies by `Configuration.getNumericValue('scale')`,
 * so the whole 2D view is scaled by one global number - and nothing in the
 * library reads a wheel event, offers a zoom control, or clamps that number.
 * The demo exposed it as a dat.GUI slider from 0.5 to 1.5 and left it there.
 *
 * Zoom is also a three-step operation that has to happen in order, and getting
 * it wrong is what makes a zoom feel broken:
 *
 *   1. set `scale`, because every coordinate conversion reads it
 *   2. `floorplanner.zoom()`, which re-derives the pan origin so the *centre of
 *      the canvas* stays put - without it, zooming walks the plan off screen
 *   3. `floorplanner.redraw()`, because Configuration dispatches nothing
 *
 * ## Steps, not a slider
 *
 * The stops below are a geometric-ish series rather than `scale * 1.2`, so
 * clicking zoom-in twice and zoom-out twice returns to exactly where it started.
 * Repeated multiplication does not: floating point drifts, and 100% becomes
 * 99.99999% and then never matches the label again.
 */

/** Zoom stops, as multiples of 1:1. */
const STOPS = [0.1, 0.15, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/** Grid spacings offered, in centimetres. */
export const GRID_SPACINGS = [
	{value: 10, label: '10 cm'},
	{value: 25, label: '25 cm'},
	{value: 50, label: '50 cm'},
	{value: 100, label: '1 m'},
];

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useZoom2D(store)
{
	var scale = ref(Configuration.getNumericValue('scale'));
	var snap = ref(Boolean(Configuration.getNumericValue(snapToGrid)));
	var spacing = ref(Configuration.getNumericValue(gridSpacing));

	var percent = computed(() => Math.round(scale.value * 100));
	var canZoomIn = computed(() => scale.value < STOPS[STOPS.length - 1]);
	var canZoomOut = computed(() => scale.value > STOPS[0]);

	function planner()
	{
		return store.floorplanner.value;
	}

	function applyScale(next)
	{
		var clamped = Math.min(STOPS[STOPS.length - 1], Math.max(STOPS[0], next));
		scale.value = clamped;
		Configuration.setValue('scale', clamped);

		var view = planner();
		if (view)
		{
			view.zoom();
			view.redraw();
		}
	}

	function zoomIn()
	{
		// The next stop strictly larger than where we are, which is not
		// `STOPS[index + 1]`: a wheel gesture leaves the scale between stops, and
		// stepping from the nearest index can then move the wrong way. The epsilon
		// keeps a scale that is already exactly on a stop from matching itself.
		var next = STOPS.find((stop) => stop > scale.value + 1e-6);
		applyScale(next === undefined ? STOPS[STOPS.length - 1] : next);
	}

	function zoomOut()
	{
		var lower = STOPS.filter((stop) => stop < scale.value - 1e-6);
		applyScale(lower.length ? lower[lower.length - 1] : STOPS[0]);
	}

	function zoomTo(value)
	{
		applyScale(value);
	}

	function resetZoom()
	{
		applyScale(1);
	}

	/**
	 * Continuous zoom, for a wheel or a pinch.
	 *
	 * Multiplicative rather than additive so the gesture feels the same at every
	 * magnification - a fixed step of 0.1 is imperceptible at 8x and violent at
	 * 0.1x.
	 *
	 * @param {number} factor Multiplier, e.g. 1.1 to zoom in a notch.
	 */
	function nudge(factor)
	{
		applyScale(scale.value * factor);
	}

	/**
	 * Frame the whole plan.
	 *
	 * Picks the largest stop at which the plan's bounding box plus a margin still
	 * fits the canvas, then recentres. A stop rather than an exact fit, so the
	 * zoom readout stays a round number and zoom-in from here goes somewhere
	 * predictable.
	 *
	 * @param {Object} [options]
	 * @param {number} [options.max] Ceiling on the chosen stop.
	 *
	 * Used by the automatic framing that runs when a design loads, and not by the
	 * button. The difference matters: filling 88% of the canvas is exactly right
	 * when someone asks to see the whole plan, and wrong as an opening view of a
	 * floorplanner, because the empty space around the plan is where the next
	 * wall gets drawn. The default design is one 5 m room, which fits at 300% -
	 * a room that fills the screen edge to edge and nowhere to extend it.
	 */
	function zoomToFit(options)
	{
		var ceiling = (options && typeof options.max === 'number') ? options.max : Infinity;
		var view = planner();
		var blueprint = store.instance.value;
		if (!view || !blueprint)
		{
			return;
		}

		var floorplan = blueprint.model.floorplan;
		var size = floorplan.getSize();
		var width = view.view.canvasWidth;
		var height = view.view.canvasHeight;

		// An empty plan has no size to fit to. `getSize` on a floorplan with no
		// corners returns zeroes, and dividing by them gives Infinity, which
		// applyScale would clamp to maximum zoom on a blank canvas.
		if (!width || !height || size.x <= 0 || size.z <= 0)
		{
			applyScale(1);
			view.resetOrigin();
			view.redraw();
			return;
		}

		// `Dimensioning.cmToPixel(cm) === cm * pixelsPerCm * scale`, so the plan
		// occupies `size.x * pixelsPerCm * scale` pixels across. Solving that for
		// the scale at which it exactly fills the canvas:
		//
		//     scale = (width * margin) / (size.x * pixelsPerCm)
		//
		// and the fit is the smaller of the two axes. 0.88 leaves a 6% gutter each
		// side, which is where the dimension labels are drawn - they sit outside
		// the wall line and an exact fit clips them.
		var margin = 0.88;
		var ideal = Math.min(
			(width * margin) / (size.x * pixelsPerCm),
			(height * margin) / (size.z * pixelsPerCm)
		);

		var usable = STOPS.filter((stop) => stop <= ideal && stop <= ceiling);
		applyScale(usable.length ? usable[usable.length - 1] : STOPS[0]);

		view.resetOrigin();
		view.redraw();
	}

	/** Recentre without changing magnification. */
	function centre()
	{
		var view = planner();
		if (view)
		{
			view.resetOrigin();
			view.redraw();
		}
	}

	function setSnap(flag)
	{
		snap.value = Boolean(flag);
		// Stored as a boolean, matching the library's own default
		// (`snapToGrid: false` in configuration.js). It is read back through
		// getNumericValue, which coerces with Number() - so true becomes 1 and the
		// truthiness test at the call site works either way.
		Configuration.setValue(snapToGrid, snap.value);
	}

	function setSpacing(cm)
	{
		spacing.value = cm;
		Configuration.setValue(gridSpacing, cm);
		var view = planner();
		if (view)
		{
			view.redraw();
		}
	}

	/**
	 * Re-read from Configuration.
	 *
	 * Needed for the same reason `syncDisplayUnit` is: these are module globals
	 * with static setters and no change event, so anything else that writes them
	 * - a loaded design, an embedder, BlueprintJS's own constructor - leaves this
	 * composable holding a stale mirror.
	 */
	function sync()
	{
		scale.value = Configuration.getNumericValue('scale');
		snap.value = Boolean(Configuration.getNumericValue(snapToGrid));
		spacing.value = Configuration.getNumericValue(gridSpacing);
	}

	watch(store.floorplanner, function (view)
	{
		if (view)
		{
			sync();
		}
	}, {immediate: true});

	onScopeDispose(function ()
	{
		// Configuration outlives this composable, and leaving a zoom of 4 behind
		// would greet the next mount with a plan four times too big.
		Configuration.setValue('scale', 1);
	});

	return {
		scale, percent, snap, spacing, gridSpacings: GRID_SPACINGS,
		canZoomIn, canZoomOut,
		zoomIn, zoomOut, zoomTo, resetZoom, zoomToFit, nudge, centre,
		setSnap, setSpacing, sync,
	};
}
