// @ts-check
import {EventDispatcher} from 'three';
import {dimCentiMeter} from './units.js';
import {EVENT_CONFIG_CHANGED} from './events.js';


// GENERAL:
/** The dimensioning unit for 2D floorplan measurements. */
export var configDimUnit = 'dimUnit';
// WALL:
/** The initial wall height in cm. */
export const configWallHeight = 'wallHeight';
/** The initial wall thickness in cm. */
export const configWallThickness = 'wallThickness';

export const configSystemUI = 'systemUI';

/**
 * Whether the storey controls appear (RM-010 G1).
 *
 * **On since RM-010 G3.** It was off for G1 and G2, which is what RM-010 asked
 * for: *"behind a flag until the fixture suite covers it."* What the flag gates
 * is the **affordance**, not the feature - the model, the file, the 3D stacking
 * and the ghosted underlay all worked with it off, and a two-storey file opened
 * and rendered correctly either way. What it withheld is the control that lets
 * somebody make a second storey by accident before a three-storey house had
 * been driven through every tier.
 *
 * That distinction is the point of a flag rather than a branch: turning it on
 * changes nothing about how anything behaves, so what G3 removed is one default.
 *
 * It is kept rather than deleted, because it is the switch an embedder turns
 * *off*: a widget that hosts a single-storey plan and does not want a storey
 * control now has one line that says so. Deleting it would take that away and
 * buy nothing - the branch it guards is one `v-if`.
 */
export const configLevels = 'levelsEnabled';

export const scale = 'scale';

export const gridSpacing = 'gridSpacing';
export const snapToGrid = 'snapToGrid';
export const snapTolerance = 'snapTolerance';//In CMS

/** The values a Configuration starts with when it is given none. */
function defaultValues()
{
	return {dimUnit: dimCentiMeter, wallHeight: 250, wallThickness: 10, systemUI: false, scale: 1, snapToGrid: false, snapTolerance: 25, gridSpacing: 25, levelsEnabled: true};
}

/**
 * Which wall measurements the 2D view labels, and what it prefixes them with.
 *
 * A fifth module-level singleton, and one RM-002 R-02's list of four missed -
 * found while moving the 2D view onto per-instance settings, because it was the
 * only thing left in `floorplanner_view.js` still reaching for module scope.
 * Same treatment: it belongs to a Configuration, and the export below is the
 * default one's, by identity.
 */
function defaultWallInformation()
{
	// The three label prefixes are empty (RM-008 E1). They used to read 'e:',
	// 'i:' and 'm:', which stand for exterior, interior and midline - so every
	// wall on the plan was captioned `m:5m`, and nobody outside this repository
	// could know what the m meant. A measurement is legible on its own; the
	// prefix only becomes useful when two are shown at once, and `labels` is the
	// flag that has always turned all three on and off together.
	//
	// Kept as configurable strings rather than deleted: an embedder showing
	// interior AND exterior lengths together does need to tell them apart, and
	// that caller can set them back to anything they like.
	return {exterior: false, interior: false, midline: true, labels: true, exteriorlabel:'', interiorlabel:'', midlinelabel:''};
}


/**
 * The tolerance in cms between corners, otherwise below this tolerance they will snap together as one corner*/
export const cornerTolerance = 20;

/** Keys `getStringValue` will answer for. */
const STRING_KEYS = [configDimUnit];

/** Keys `getNumericValue` will answer for. */
const NUMERIC_KEYS = [configSystemUI, configWallHeight, configWallThickness, scale, snapToGrid, snapTolerance, gridSpacing, configLevels];

/**
 * Configuration for one design, or for the whole page (RM-002 R-02, P7).
 *
 * ## What changed, and what did not
 *
 * This used to be a namespace of statics over one module-level `config` object,
 * which meant two `BlueprintJS` instances on a page shared units, scale, grid
 * spacing and snap tolerance. Change one, both moved - and `BlueprintJS`'s own
 * constructor writes the display unit, so merely *constructing* a second viewer
 * silently re-unitised the first.
 *
 * It is now an ordinary class you can instantiate, and **the statics still
 * work exactly as they did** by delegating to one module-level default
 * instance. That is the whole trick, and it is what makes this a change nobody
 * has to migrate for: every existing `Configuration.getNumericValue(scale)`
 * call site - and there are 46 of them in `floorplanner/` alone, plus 24 in the
 * application - keeps reading the same shared state it always did. Only a
 * caller that *wants* its own settings constructs one.
 *
 * The exported `config` object is this default instance's live data, by
 * identity rather than by copy: it is public API, and both the test suite and
 * embedders mutate it directly.
 *
 * ## Why this and not a plain object
 *
 * `Floorplan` and the 2D view need somewhere to read settings from, and giving
 * them a bare `{scale: 1}` would mean two different shapes in the codebase -
 * the object for instance-aware code, the statics for everything else - and a
 * conversion at every boundary. Keeping one interface means moving a call site
 * off the singleton is a one-word edit, `Configuration.` to `this.config.`,
 * with the semantics unchanged.
 *
 * Each instance carries its own EventDispatcher, so `EVENT_CONFIG_CHANGED` is
 * per-configuration too. Before P7 there was one dispatcher for the page and a
 * settings panel bound to one design would have redrawn on the other's changes.
 */
export class Configuration
{
	/**
	 * @param {Object} [values] Overrides, merged over the defaults. Unknown keys
	 * are kept: `setValue` has always accepted any key and the suite pins that.
	 */
	constructor(values)
	{
		var settings = Object.assign({}, values || {});
		// Pulled out before the merge: it is a nested object rather than one of
		// the flat primitives `_data` holds, and getNumericValue would never
		// answer for it.
		var wallInfo = settings.wallInformation;
		delete settings.wallInformation;

		/** Configuration data loaded from/stored to extern. */
		this._data = Object.assign(defaultValues(), settings);
		/**
		 * Which wall measurements the 2D view labels. Mutated in place by callers
		 * - the settings panel writes `wallInformation.exterior = true` - so it is
		 * a plain object rather than something behind setValue.
		 */
		this.wallInformation = Object.assign(defaultWallInformation(), wallInfo || {});
		// The type parameter matters here (RM-005 C2). An `EventDispatcher` with no
		// event map infers `{}`, which makes every `type` argument `never` - so
		// addEventListener, removeEventListener and dispatchEvent all refused their
		// own arguments the moment @types/three gave the class a real signature.
		/** @type {EventDispatcher<Record<string, {type: string, key?: string, value?: any, previous?: any}>>} */
		this._emitter = new EventDispatcher();
	}

	getData()
	{
		return this._data;
	}

	/**
	 * Subscribe to configuration changes on THIS configuration.
	 *
	 * @param {string} type Currently only EVENT_CONFIG_CHANGED.
	 * @param {function(Object): void} listener Receives `{type, key, value, previous}`.
	 */
	addEventListener(type, listener)
	{
		this._emitter.addEventListener(type, listener);
	}

	/**
	 * @param {string} type
	 * @param {function(Object): void} listener The same reference passed to addEventListener.
	 */
	removeEventListener(type, listener)
	{
		this._emitter.removeEventListener(type, listener);
	}

	/**
	 * Set a configuration parameter, and tell anybody listening.
	 *
	 * The event fires only on an actual change. Callers set values from watchers
	 * and computed setters that re-run for unrelated reasons, so announcing a
	 * write that changed nothing would turn one user action into a redraw storm -
	 * and, for a two-way bound control, a loop.
	 *
	 * The comparison is `!==`, which is right for the primitives this holds
	 * (numbers, booleans, and the unit strings). It would be wrong for an object
	 * value, and nothing stores one.
	 */
	setValue(key, value)
	{
		var previous = this._data[key];
		this._data[key] = value;
		if (previous !== value)
		{
			this._emitter.dispatchEvent({type: EVENT_CONFIG_CHANGED, key: key, value: value, previous: previous});
		}
	}

	/** Get a string configuration parameter. */
	getStringValue(key)
	{
		if (STRING_KEYS.indexOf(key) === -1)
		{
			throw new Error('Invalid string configuration parameter: ' + key);
		}
		return String(this._data[key]);
	}

	/** Get a numeric configuration parameter. */
	getNumericValue(key)
	{
		if (NUMERIC_KEYS.indexOf(key) === -1)
		{
			throw new Error('Invalid numeric configuration parameter: ' + key);
		}
		return Number(this._data[key]);
	}

	// --- The static form -----------------------------------------------------
	//
	// Every one of these is the same call against the module default. They are
	// what the library used to be, they are what nearly every call site still
	// uses, and they are not deprecated: a page with one design wants one
	// configuration, and reaching for the singleton is the right thing to do
	// there. See the class comment.

	static getData()
	{
		return defaultConfiguration.getData();
	}

	/** @see Configuration#addEventListener */
	static addEventListener(type, listener)
	{
		defaultConfiguration.addEventListener(type, listener);
	}

	/** @see Configuration#removeEventListener */
	static removeEventListener(type, listener)
	{
		defaultConfiguration.removeEventListener(type, listener);
	}

	/** @see Configuration#setValue */
	static setValue(key, value)
	{
		defaultConfiguration.setValue(key, value);
	}

	/** @see Configuration#getStringValue */
	static getStringValue(key)
	{
		return defaultConfiguration.getStringValue(key);
	}

	/** @see Configuration#getNumericValue */
	static getNumericValue(key)
	{
		return defaultConfiguration.getNumericValue(key);
	}
}

/**
 * The configuration every static call reads and writes, and the one anything
 * constructed without an explicit configuration of its own will share.
 */
export const defaultConfiguration = new Configuration();

/**
 * The configuration an object should read from: its own, or the shared default.
 *
 * The model layer reaches its configuration through the Floorplan - a Corner is
 * constructed with one, and a Wall gets there through `start.floorplan` - and
 * every one of those hops can legitimately be absent. A Corner built by hand in
 * a test has no floorplan; a Floorplan constructed before P7 existed has no
 * configuration. Falling back to the default is what makes those keep behaving
 * exactly as they did, rather than throwing on a null.
 *
 * ## Unchanged by A4, and it could not have been otherwise
 *
 * `runtimeOf(owner)` in design_runtime.js is the generalisation of this, and
 * the two cannot disagree - not because anybody keeps them in step, but because
 * every class A4 gave a runtime to exposes `configuration` as a **getter** over
 * `runtime.configuration`. There is one place the answer is kept, so
 * `configurationOf(x)` is `runtimeOf(x).configuration` by construction.
 *
 * This is still the right function to call from the model layer: `Corner` and
 * `Wall` want a configuration, not a runtime, and asking for the smaller thing
 * keeps them from acquiring a dependency they have no use for.
 *
 * @param {?Object} owner Anything that may carry a `.configuration`.
 * @returns {Configuration}
 */
export function configurationOf(owner)
{
	return (owner && owner.configuration) || defaultConfiguration;
}

/**
 * The default configuration's live data.
 *
 * Exported since before P7 and kept by identity rather than as a copy, because
 * it is public API: `blueprint.js` re-exports it, the test harness resets
 * `config.systemUI` on it directly, and the dimensioning suite writes
 * `config.wallHeight` and reads it back. Mutating this object is mutating the
 * default configuration, which is exactly what it did before.
 */
export const config = defaultConfiguration.getData();

/**
 * The default configuration's wall-measurement settings.
 *
 * Exported for the same reason as `config`, and by identity for the same
 * reason: `blueprint.js` re-exports it and the settings panel writes to it
 * directly.
 */
export const wallInformation = defaultConfiguration.wallInformation;
