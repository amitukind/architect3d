// @ts-check
import {computed, shallowRef, watch} from 'vue';
import {Configuration, configLevels, EVENT_LEVELS_CHANGED} from '../../scripts/blueprint.js';

/**
 * The storeys, for the application (RM-010 G1).
 *
 * A thin composable, because there is very little application state here: the
 * level list and which one is active both live on the `Model`, which is where
 * the file and the two views read them from. What this adds is a reactive
 * mirror so a Vue template can re-render when they change, and the flag.
 *
 * ## The flag gates the affordance, not the feature
 *
 * `enabled` is off by default and RM-010 asked for that: *"behind a flag until
 * the fixture suite covers it."* With it off, a two-storey file still opens,
 * still stacks in 3D, still ghosts the level below and still re-saves
 * correctly - what is withheld is the control that makes a second storey. So
 * turning it on changes no behaviour, which is what makes it a flag rather than
 * a branch, and G3 removes one default.
 */

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useLevels(store)
{
	/** @type {import('vue').ShallowRef<Array<{index: number, name: string, height: number, base: number, active: boolean}>>} */
	var levels = shallowRef([]);
	var active = shallowRef(0);

	var enabled = computed(() => Boolean(Configuration.getNumericValue(configLevels)));

	function readBack()
	{
		var model = store.model.value;
		if (!model)
		{
			levels.value = [];
			return;
		}
		active.value = model.activeLevelIndex;
		// A new array each time, not a mutated one: `shallowRef` compares by
		// identity, so re-using it would leave the switcher showing the old list.
		levels.value = model.levels.map((level, index) => ({
			index: index,
			name: level.displayName(index),
			height: level.height,
			base: model.levelBase(index),
			active: index === model.activeLevelIndex,
		}));
	}

	/** @type {?Function} */
	var listener = null;

	watch(store.model, (model, previous) =>
	{
		if (previous && listener)
		{
			previous.removeEventListener(EVENT_LEVELS_CHANGED, listener);
		}
		listener = null;
		if (!model)
		{
			levels.value = [];
			return;
		}
		listener = () =>
		{
			// Point the 2D view at the storey now being edited. `Floorplanner2D`
			// holds the `Floorplan` it was constructed with, so without this the
			// switcher moved the model and the 3D view and left the canvas drawing
			// the ground floor - which looks exactly like a switch that did nothing.
			// Found by driving the switcher in the assembled application.
			var planner = store.floorplanner && store.floorplanner.value;
			if (planner && typeof planner.showFloorplan === 'function')
			{
				planner.showFloorplan(model.floorplan);
			}
			readBack();
		};
		model.addEventListener(EVENT_LEVELS_CHANGED, listener);
		readBack();
	}, {immediate: true});

	/** @param {number} index */
	function setActive(index)
	{
		var model = store.model.value;
		if (model)
		{
			model.setActiveLevel(index);
		}
	}

	function addAbove()
	{
		var model = store.model.value;
		if (model && enabled.value)
		{
			model.addLevel();
		}
	}

	/** @param {number} index */
	function remove(index)
	{
		var model = store.model.value;
		return Boolean(model && enabled.value && model.removeLevel(index));
	}

	/**
	 * @param {number} index
	 * @param {number} value Centimetres, floor to floor.
	 */
	function setHeight(index, value)
	{
		var model = store.model.value;
		if (model)
		{
			model.setLevelHeight(index, value);
		}
	}

	return {levels, active, enabled, setActive, addAbove, remove, setHeight};
}
