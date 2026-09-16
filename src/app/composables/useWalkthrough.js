// @ts-check
import {ref, watch} from 'vue';
import {EYE_HEIGHT} from '../../scripts/blueprint.js';

/**
 * How tall the person walking through the design is (RM-011 H3).
 *
 * ## Why this is not in the design file
 *
 * Every other number the inspector edits describes the building, and is saved
 * with it. This one describes whoever is looking: two people opening the same
 * plan should walk it at their own eye level, and a file that carried one of
 * their heights would quietly change the other's view. So it lives where the
 * theme and the workspace layout live - in this browser, for this person,
 * across designs - and `M-26`'s conditional-key rule never comes up, because
 * nothing is written to a document at all.
 *
 * ## Module-level, like the display unit
 *
 * The ref is shared rather than per-caller, for the reason `useDisplayUnit`
 * gives: there is exactly one walker, and a settings panel holding a different
 * eye height from the viewer would be a bug rather than a feature. Two callers
 * mount it - `App.vue`, which is always alive and so is what re-applies the
 * height when a *new* viewer is constructed, and the settings panel, which is
 * behind a tab and may not be.
 */

const STORAGE_KEY = 'architect3d.walkthrough';

/** @param {number} centimetres */
function clamp(centimetres)
{
	var value = Number(centimetres);
	if (!isFinite(value))
	{
		return EYE_HEIGHT.default;
	}
	return Math.max(EYE_HEIGHT.min, Math.min(EYE_HEIGHT.max, Math.round(value)));
}

function restore()
{
	try
	{
		var raw = window.localStorage.getItem(STORAGE_KEY);
		return (raw === null) ? EYE_HEIGHT.default : clamp(JSON.parse(raw).eyeHeight);
	}
	catch
	{
		// A malformed entry is the same as no entry - the same call this makes as
		// `useLayout`, and for the same reason: a forgotten preference is fine.
		return EYE_HEIGHT.default;
	}
}

/** @param {number} centimetres */
function persist(centimetres)
{
	try
	{
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify({eyeHeight: centimetres}));
	}
	catch
	{
		// Private-mode storage refuses writes. Walking at the default is not a
		// reason to fail.
	}
}

const eyeHeight = ref(restore());

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useWalkthrough(store)
{
	function apply(viewer)
	{
		if (viewer)
		{
			viewer.setEyeHeight(eyeHeight.value);
		}
	}

	/** @param {number} centimetres */
	function setEyeHeight(centimetres)
	{
		eyeHeight.value = clamp(centimetres);
		persist(eyeHeight.value);
		apply(store.three.value);
	}

	// Immediate, so a viewer that already exists is corrected now, and on change
	// so one constructed later starts at the stored height rather than at 160.
	watch(store.three, apply, {immediate: true});

	return {eyeHeight, setEyeHeight, bounds: EYE_HEIGHT};
}
