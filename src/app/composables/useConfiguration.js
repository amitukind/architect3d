// @ts-check
import {onScopeDispose, ref} from 'vue';
import {Configuration, EVENT_CONFIG_CHANGED} from '../../scripts/blueprint.js';

/**
 * Library configuration, as something Vue can track.
 *
 * `Configuration` is a namespace of statics over a plain module-level object.
 * Vue cannot see a write to a plain object it does not own, so anything reading
 * a config value in a computed got one snapshot and kept it - which is how the
 * settings panel came to show a grid spacing the plan had long since changed,
 * and how its zoom slider used to display 1 while the plan sat at 300%.
 *
 * RM-002 R-03 gave Configuration an event. This turns that event into refs.
 *
 * ## Why the value is re-read rather than taken from the event
 *
 * EVENT_CONFIG_CHANGED carries `.value`, and using it would be one line shorter.
 * Re-reading through `Configuration` instead means a ref is correct even when
 * the change arrived some other way - a direct write to `config`, which several
 * places still do and which dispatches nothing. Those writes are still missed
 * at the moment they happen, but the next event of any kind resynchronises
 * everything rather than leaving one ref right and another wrong.
 */

/**
 * Run a handler on every configuration change, for the caller's lifetime.
 *
 * @param {function(Object): void} handler Receives `{type, key, value, previous}`.
 */
export function onConfigChange(handler)
{
	Configuration.addEventListener(EVENT_CONFIG_CHANGED, handler);
	onScopeDispose(function ()
	{
		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, handler);
	});
}

/**
 * A ref mirroring one numeric configuration key.
 *
 * @param {string} key One of the numeric keys - scale, gridSpacing,
 *        snapTolerance, wallHeight, wallThickness, snapToGrid, systemUI.
 * @returns {import('vue').Ref<number>}
 */
export function useNumericConfig(key)
{
	var value = ref(Configuration.getNumericValue(key));

	onConfigChange(function (event)
	{
		// Any change resynchronises, not only this key: re-reading a number is
		// free, and it keeps a ref honest when a direct write to `config` slipped
		// past unannounced.
		if (event.key === key || value.value !== Configuration.getNumericValue(key))
		{
			value.value = Configuration.getNumericValue(key);
		}
	});

	return value;
}

/**
 * A ref mirroring one boolean configuration key.
 *
 * The library stores these as numbers through `getNumericValue`, so this is
 * that with the coercion applied once, in one place.
 *
 * @param {string} key
 * @returns {import('vue').Ref<boolean>}
 */
export function useBooleanConfig(key)
{
	var numeric = useNumericConfig(key);
	var value = ref(Boolean(numeric.value));

	onConfigChange(function ()
	{
		value.value = Boolean(Configuration.getNumericValue(key));
	});

	return value;
}
