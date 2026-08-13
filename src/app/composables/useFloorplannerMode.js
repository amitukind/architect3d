import {onScopeDispose, ref, watch} from 'vue';
import {EVENT_MODE_RESET, floorplannerModes} from '../../scripts/blueprint.js';

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

	return {mode, setMode};
}
