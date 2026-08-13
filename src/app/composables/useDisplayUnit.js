import {ref} from 'vue';
import {Configuration, configDimUnit} from '../../scripts/blueprint.js';
import {dimFeetAndInch, dimInch, dimCentiMeter, dimMilliMeter, dimMeter} from '../../scripts/blueprint.js';

/**
 * The active display unit, as something Vue can watch.
 *
 * Sprint S7. Every measurement the inspector shows is stored in centimetres
 * and displayed converted, and every caption carries the unit name - so a unit
 * change has to re-render most of the panel and redraw the 2D canvas. There is
 * no event to hang that on: `Configuration` is a module-level object with
 * static setters and no dispatcher.
 *
 * So this mirrors it. The ref is module-level rather than per-call, which is
 * unusual for a composable and correct here: `Configuration` really is one
 * global, and two components holding different ideas of the current unit would
 * be a bug, not a feature. Every caller gets the same ref.
 *
 * The demo needed the same thing and did it by hand - a `guiControllers` array
 * threaded through the properties objects, iterated after every unit change
 * calling `updateDisplay()`, plus a full rebuild of the 2D Editor folder
 * because its captions were baked into folder names.
 */

/** The five units, in the demo's order, with its labels. */
export const UNITS = [
	{value: dimFeetAndInch, label: 'Feet & inches'},
	{value: dimInch, label: 'Inches'},
	{value: dimCentiMeter, label: 'Centimetres'},
	{value: dimMilliMeter, label: 'Millimetres'},
	{value: dimMeter, label: 'Metres'},
];

const unit = ref(Configuration.getStringValue(configDimUnit));

/**
 * Re-read the unit from Configuration.
 *
 * Needed on mount, because `BlueprintJS`'s constructor sets `dimMeter` as its
 * very first statement - so whatever the panel last showed, construction has
 * already overruled it.
 */
export function syncDisplayUnit()
{
	unit.value = Configuration.getStringValue(configDimUnit);
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useDisplayUnit(store)
{
	/**
	 * @param {string} next One of the `dim*` constants.
	 */
	function setUnit(next)
	{
		Configuration.setValue(configDimUnit, next);
		unit.value = next;
		// The 2D canvas draws its dimension labels in the active unit and has no
		// idea Configuration changed.
		if (store && store.floorplanner.value)
		{
			store.floorplanner.value.redraw();
		}
	}

	return {unit, units: UNITS, setUnit};
}
