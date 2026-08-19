// @ts-check
import {onScopeDispose, ref, watch} from 'vue';
import {EVENT_FPS_EXIT} from '../../scripts/blueprint.js';
import {VIEW_TOP, VIEW_FRONT, VIEW_RIGHT, VIEW_LEFT, VIEW_ISOMETRY, VIEW_EXTERIOR} from '../../scripts/blueprint.js';

/**
 * Which pane is showing, and everything the 3D camera can be told to do.
 *
 * Sprint S6, replacing the `#showFloorPlan` / `#showDesign` / `#showFirstPerson`
 * click handlers at build/js/app.js:904-962.
 *
 * The mode transitions are not just "show a different div": each one puts the
 * viewer into a different state, and the order matters. Reproduced from the
 * demo exactly.
 */

/** The five presets, in the order the view cube lays them out. */
export const CAMERA_VIEWS = [
	{id: VIEW_LEFT, label: 'Left', title: 'Show side view (left)'},
	{id: VIEW_TOP, label: 'Top', title: 'Show top view'},
	{id: VIEW_ISOMETRY, label: '3D', title: 'Show 3d view'},
	{id: VIEW_FRONT, label: 'Front', title: 'Show front view'},
	{id: VIEW_RIGHT, label: 'Right', title: 'Show side view (right)'},
];

export const MODE_FLOORPLAN = 'floorplan';
export const MODE_DESIGN = 'design';
export const MODE_WALKTHROUGH = 'walkthrough';
/**
 * The building from outside (RM-010 G3).
 *
 * A mode rather than a sixth preset on the view cube, and beside the
 * walkthrough rather than beside the elevations, because it is the same kind of
 * thing the walkthrough is: a way of looking at the design that is not a way of
 * editing it. The elevations point the camera at whatever is being edited; both
 * of these two put you somewhere and show you the whole house.
 */
export const MODE_EXTERIOR = 'exterior';

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useCameraViews(store)
{
	var mode = ref(MODE_FLOORPLAN);
	var orthographic = ref(false);
	var wireframe = ref(false);
	var viewLocked = ref(false);
	var activeView = ref(VIEW_ISOMETRY);
	/** Whether the 3D view shows every storey or only the one being edited. */
	var allStoreys = ref(true);

	function three()
	{
		return store.three.value;
	}

	/**
	 * The auto-spin contract, reproduced rather than configured away.
	 *
	 * `Main` defaults `spin: true`, which means: rotate slowly until the user
	 * touches the view, pause while the pointer is over it, and stop for good on
	 * the first click. The demo then calls `stopSpin()` at boot
	 * (build/js/app.js:896), so the app you actually see never spins.
	 *
	 * Passing `spin: false` at construction would look equivalent and is not.
	 * `stopSpin()` sets `hasClicked = true`, which is also what suppresses the
	 * hover/click resume path - so the two differ in what happens after the
	 * first pointer event. Boot state stays byte-identical to the demo by doing
	 * what the demo did.
	 */
	function applyBootState(blueprint)
	{
		blueprint.three.stopSpin();
		// The demo boots into the 2D pane, so the 3D render loop starts paused -
		// it is behind the unflipped card and nobody is looking at it.
		blueprint.three.pauseTheRendering(mode.value === MODE_FLOORPLAN);
	}

	function showFloorplan()
	{
		var view = three();
		mode.value = MODE_FLOORPLAN;
		if (!view)
		{
			return;
		}
		view.switchFPSMode(false);
		view.pauseTheRendering(true);
		// Was `three.getController().setSelectedObject(null)` in the demo.
		view.clearSelection();
	}

	function showDesign()
	{
		var view = three();
		mode.value = MODE_DESIGN;
		if (!view)
		{
			return;
		}
		// The 2D pane can have changed the plan while 3D was paused; this is what
		// rebuilds the walls before they are shown again.
		store.model.value.floorplan.update();
		view.pauseTheRendering(false);
		view.switchFPSMode(false);
	}

	function showWalkthrough()
	{
		var view = three();
		mode.value = MODE_WALKTHROUGH;
		if (!view)
		{
			return;
		}
		store.model.value.floorplan.update();
		view.pauseTheRendering(false);
		view.switchFPSMode(true);
		// Walking with a wireframe on is not a state the demo could reach, and
		// Main.switchFPSMode clears it in the library anyway; keep the flag in
		// step so the button does not lie.
		wireframe.value = false;
	}

	/**
	 * Show the whole building from outside.
	 *
	 * Everything `showDesign` does, and then the framing - it is a design view
	 * that has been pointed at the building rather than at the storey, so the
	 * plan still has to be brought up to date and the renderer still has to be
	 * running before the camera is moved.
	 */
	function showExterior()
	{
		var view = three();
		mode.value = MODE_EXTERIOR;
		if (!view)
		{
			return;
		}
		store.model.value.floorplan.update();
		view.pauseTheRendering(false);
		view.switchFPSMode(false);
		allStoreys.value = true;
		view.showExterior();
		activeView.value = VIEW_EXTERIOR;
	}

	/**
	 * @param {boolean} flag True for the whole building, false for one storey.
	 */
	function setAllStoreys(flag)
	{
		allStoreys.value = flag;
		if (three())
		{
			three().showStoreys(flag);
		}
	}

	function switchView(viewId)
	{
		activeView.value = viewId;
		if (three())
		{
			three().switchView(viewId);
		}
	}

	function setOrthographic(flag)
	{
		orthographic.value = flag;
		if (three())
		{
			three().switchOrthographicMode(flag);
		}
	}

	function setWireframe(flag)
	{
		wireframe.value = flag;
		if (three())
		{
			three().switchWireframe(flag);
		}
	}

	/**
	 * Note the negation. `Main.lockView(locked)` assigns straight through to
	 * `controls.enableRotate`, so its argument is really "rotation enabled" and
	 * the demo passed `!locked` to compensate (build/js/app.js:230). Preserved
	 * rather than fixed: the roadmap's freeze covers library behaviour, and
	 * flipping the sense would break any embedder that already compensates.
	 */
	function setViewLocked(flag)
	{
		viewLocked.value = flag;
		if (three())
		{
			three().lockView(!flag);
		}
	}

	function setClipping(ratio, ratio2)
	{
		if (three())
		{
			three().changeClippingPlanes(ratio, ratio2);
		}
	}

	function resetClipping()
	{
		if (three())
		{
			three().resetClipping();
		}
	}

	var attached = null;

	function attach(blueprint)
	{
		attached = {
			three: blueprint.three,
			// Pointer-lock can end without the app asking - Esc, or the browser
			// dropping the lock. The demo routed that back through a synthetic
			// click on #showDesign; here it is a direct call.
			fpsExit: () => {showDesign();},
		};
		blueprint.three.addEventListener(EVENT_FPS_EXIT, attached.fpsExit);
		applyBootState(blueprint);
	}

	function detach()
	{
		if (!attached)
		{
			return;
		}
		attached.three.removeEventListener(EVENT_FPS_EXIT, attached.fpsExit);
		attached = null;
	}

	watch(store.instance, (blueprint) =>
	{
		detach();
		if (blueprint)
		{
			attach(blueprint);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	return {
		mode, orthographic, wireframe, viewLocked, activeView, allStoreys,
		showFloorplan, showDesign, showWalkthrough, showExterior,
		switchView, setOrthographic, setWireframe, setViewLocked, setAllStoreys,
		setClipping, resetClipping,
	};
}
