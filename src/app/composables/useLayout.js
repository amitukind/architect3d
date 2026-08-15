import {computed, ref, watch} from 'vue';

/**
 * Which viewports are on screen, and how the workspace is divided.
 *
 * ## What this replaces
 *
 * A CSS 3D card flip. The two panes were the faces of one `preserve-3d` card
 * and switching between them rotated it 180 degrees about X - jquery.flip's
 * behaviour, reproduced in CSS by S6 when jQuery came out.
 *
 * It was a good port of a 2014 idea and it has one structural problem: a card
 * has exactly two faces, so there is no arrangement in which both views are
 * visible at once. That is the arrangement people actually want from a
 * floorplanner - draw a wall on the left, watch it stand up on the right - and
 * every current tool in this space offers it.
 *
 * So the flip goes and a three-way layout takes its place. The transition is
 * now a crossfade, which is the honest animation for "these two things are
 * peers" where a flip implied "these are two sides of one thing".
 *
 * ## What must not change
 *
 * Both viewports stay laid out at full size in every mode, hidden with opacity
 * and pointer-events rather than `v-if` or `display: none`. This is the same
 * constraint the flip had and it is load-bearing: the library measures its
 * containers with `clientWidth`/`clientHeight` and watches them with a
 * ResizeObserver, so a collapsed pane reports zero and the viewer comes back
 * with a zero aspect ratio. See the note in FloorplannerView.
 */

/** The 2D plan alone. */
export const LAYOUT_PLAN = 'plan';
/** Both, side by side. */
export const LAYOUT_SPLIT = 'split';
/** The 3D view alone. */
export const LAYOUT_VIEW = 'view';

export const LAYOUTS = [
	{id: LAYOUT_PLAN, label: '2D', title: 'Floor plan only', key: '1'},
	{id: LAYOUT_SPLIT, label: 'Split', title: 'Plan and 3D side by side', key: '2'},
	{id: LAYOUT_VIEW, label: '3D', title: '3D view only', key: '3'},
];

const STORAGE_KEY = 'architect3d.layout';

/** Fraction of the workspace given to the 2D pane in split mode. */
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;

function restore(key, fallback)
{
	try
	{
		var raw = window.localStorage.getItem(key);
		return (raw === null) ? fallback : JSON.parse(raw);
	}
	catch
	{
		// A malformed or unreadable entry is the same as no entry.
		return fallback;
	}
}

function persist(key, value)
{
	try
	{
		window.localStorage.setItem(key, JSON.stringify(value));
	}
	catch
	{
		// A workspace that forgets its split ratio is fine. Failing to boot is not.
	}
}

export function useLayout()
{
	var stored = restore(STORAGE_KEY, {});

	var layout = ref(LAYOUTS.some((entry) => entry.id === stored.layout) ? stored.layout : LAYOUT_PLAN);
	var splitRatio = ref(typeof stored.splitRatio === 'number' ? stored.splitRatio : 0.5);
	var inspectorOpen = ref(stored.inspectorOpen !== false);

	/**
	 * Whether each pane is on screen.
	 *
	 * "Shown" here means visible and interactive, not mounted - both are always
	 * mounted. The 3D viewport reads `viewVisible` to decide whether to pause its
	 * render loop, which is the one place where the difference is expensive:
	 * rendering a pane at zero opacity costs exactly as much as rendering a
	 * visible one.
	 */
	var planVisible = computed(() => layout.value !== LAYOUT_VIEW);
	var viewVisible = computed(() => layout.value !== LAYOUT_PLAN);
	var isSplit = computed(() => layout.value === LAYOUT_SPLIT);

	function setLayout(next)
	{
		if (LAYOUTS.some((entry) => entry.id === next))
		{
			layout.value = next;
		}
	}

	/**
	 * @param {number} ratio Fraction of the workspace for the 2D pane, clamped so
	 * neither pane can be dragged to nothing - a zero-width pane is the same
	 * zero-size measurement problem as hiding one.
	 */
	function setSplitRatio(ratio)
	{
		splitRatio.value = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
	}

	function toggleInspector()
	{
		inspectorOpen.value = !inspectorOpen.value;
	}

	watch([layout, splitRatio, inspectorOpen], function ()
	{
		persist(STORAGE_KEY, {
			layout: layout.value,
			splitRatio: splitRatio.value,
			inspectorOpen: inspectorOpen.value,
		});
	});

	return {
		layout, layouts: LAYOUTS, splitRatio, inspectorOpen,
		planVisible, viewVisible, isSplit,
		setLayout, setSplitRatio, toggleInspector,
	};
}
