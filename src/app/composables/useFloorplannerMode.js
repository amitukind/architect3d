// @ts-check
import {onScopeDispose, ref, shallowRef, watch} from 'vue';
import {EVENT_MODE_RESET, floorplannerModes} from '../../scripts/blueprint.js';
import {createInjection} from './injection.js';

/**
 * The 2D editor's current mode, tracked from the library rather than from the
 * clicks that set it.
 *
 * Sprint S6, and one of the three deliberate fixes.
 *
 * The demo's handler (build/js/app.js:39) was
 *
 *     floorplanner.addEventListener(EVENT_MODE_RESET, function(mode) { ... })
 *
 * and then compared `mode` against `floorplannerModes.MOVE` and friends. But
 * three's EventDispatcher passes the whole *event object* to a listener, and
 * this one carries the mode on `.mode` (floorplanner.js:663). So `mode` was
 * `{type: 'MODE_RESET', mode: 1}`, never equal to any enum value, and all three
 * branches were dead: the toolbar's active-button highlight has never worked,
 * and neither has the "press Esc to stop drawing walls" hint - the demo's own
 * `$('#draw-walls-hint')` selector matches nothing in its markup either, so
 * that one was dead twice over.
 *
 * Reading `evt.mode` fixes both. It is listed as FIX rather than PRESERVE
 * because nothing can depend on the behaviour of a highlight that never
 * rendered.
 *
 * Tracking the library's event rather than setting a ref on click also means
 * the button follows modes the library sets by itself - the Esc key, and the
 * automatic drop back to MOVE when a drawn wall closes a loop
 * (floorplanner.js:602).
 *
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useFloorplannerMode(store)
{
	var mode = ref(floorplannerModes.MOVE);
	var attached = null;

	function setMode(next)
	{
		if (store.floorplanner.value)
		{
			store.floorplanner.value.setMode(next);
		}
	}

	/**
	 * Whether the wall being drawn snaps its direction to 15 degrees
	 * (RM-008 E2).
	 *
	 * A ref here rather than a read of `floorplanner.anglesnapmode`, for the
	 * reason the settings panel's controls were rebuilt in RM-002 R-03: nothing
	 * in the library is reactive, so a template bound straight to it renders once
	 * and then sits there. The library holds the state; this mirrors it.
	 */
	var angleSnap = ref(false);

	function setAngleSnap(flag)
	{
		angleSnap.value = Boolean(flag);
		if (store.floorplanner.value)
		{
			store.floorplanner.value.anglesnapmode = angleSnap.value;
		}
	}

	/**
	 * The wall currently being drawn, as a length and a bearing, or null.
	 *
	 * Polled rather than pushed: the target moves on every pointermove, and the
	 * library dispatches nothing for it - deliberately, since RM-002 R-05 spent a
	 * sprint taking work out of that handler. `useZoom2D` reads the library the
	 * same way for the same reason.
	 */
	var drawTarget = shallowRef(null);

	/**
	 * Read the target on the next frame, not on this event.
	 *
	 * The ordering matters and cost a browser round to find. App.vue's
	 * `pointermove` listener is bound when the canvas mounts, which is *before*
	 * App constructs the library - so this composable's caller runs before the
	 * library's own handler, and reading the target here returns the previous
	 * event's. Straight after a corner is placed that previous value is the
	 * corner itself, so the length field read 0 while the plan drew 1.524 m
	 * beside the pointer.
	 *
	 * A frame later is both correct and better: the plan repaints on the same
	 * frame (P6's coalescing), so the number in the field and the number drawn on
	 * the canvas are the same number, produced from the same state. Coalesced for
	 * the same reason the repaint is - one read per frame, not one per move.
	 */
	var pendingRead = 0;

	function refreshDrawTarget()
	{
		if (pendingRead)
		{
			return;
		}
		pendingRead = requestAnimationFrame(function ()
		{
			pendingRead = 0;
			var planner = store.floorplanner.value;
			drawTarget.value = planner ? planner.drawTarget() : null;
		});
	}

	/**
	 * Put the wall being drawn at an exact length and bearing, and optionally
	 * place its corner.
	 *
	 * @param {{length: ?number, angle: ?number, place: boolean}} request
	 */
	function applyDrawTarget(request)
	{
		var planner = store.floorplanner.value;
		if (!planner)
		{
			return;
		}
		if (!planner.setDrawTarget(request.length, request.angle))
		{
			return;
		}
		if (request.place)
		{
			planner.placeDrawTarget();
		}
		// Straight from the library, not through the frame above: this call
		// already ran after the library's state changed, so there is nothing to
		// wait for and a frame's delay would leave the fields showing the wall
		// that was just committed.
		drawTarget.value = planner.drawTarget();
	}

	function attach(floorplanner)
	{
		attached = {
			floorplanner: floorplanner,
			onModeReset: (evt) => {mode.value = evt.mode;},
		};
		floorplanner.addEventListener(EVENT_MODE_RESET, attached.onModeReset);
		mode.value = floorplanner.mode;
	}

	function detach()
	{
		if (!attached)
		{
			return;
		}
		attached.floorplanner.removeEventListener(EVENT_MODE_RESET, attached.onModeReset);
		attached = null;
	}

	watch(store.floorplanner, (floorplanner) =>
	{
		detach();
		if (floorplanner)
		{
			attach(floorplanner);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	onScopeDispose(function ()
	{
		if (pendingRead)
		{
			cancelAnimationFrame(pendingRead);
			pendingRead = 0;
		}
	});

	return {mode, setMode, angleSnap, setAngleSnap, drawTarget, refreshDrawTarget, applyDrawTarget};
}

/**
 * `useFloorplannerMode` as an injection (RM-020 S-5). See `injection.js` for the pattern and
 * why twelve of the twenty-two composables use it.
 */
const injection = createInjection('FloorplannerMode');

/** The key, for a component mounted outside the shell - a test, or another host. */
export const FLOORPLANNER_MODE_KEY = injection.key;

/**
 * Build it and make it available to every descendant.
 * @returns {ReturnType<typeof useFloorplannerMode>}
 */
export function provideFloorplannerMode(store)
{
	return injection.put(useFloorplannerMode(store));
}

/**
 * Take it from an ancestor that called `provideFloorplannerMode`.
 * @returns {ReturnType<typeof useFloorplannerMode>}
 */
export function injectFloorplannerMode()
{
	return injection.take();
}
