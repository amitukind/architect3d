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

export const scale = 'scale';

export const gridSpacing = 'gridSpacing';
export const snapToGrid = 'snapToGrid';
export const snapTolerance = 'snapTolerance';//In CMS

export var config = {dimUnit: dimCentiMeter, wallHeight: 250, wallThickness: 10, systemUI: false, scale: 1, snapToGrid: false, snapTolerance: 25, gridSpacing: 25};

export var wallInformation = {exterior: false, interior: false, midline: true, labels: true, exteriorlabel:'e:', interiorlabel:'i:', midlinelabel:'m:'};


/** 
 * The tolerance in cms between corners, otherwise below this tolerance they will snap together as one corner*/
export const cornerTolerance = 20;

/**
 * Carries EVENT_CONFIG_CHANGED on behalf of the class below.
 *
 * `Configuration` is a namespace of statics over the module-level `config`
 * object, not something anybody instantiates - so it cannot extend
 * EventDispatcher and have that mean anything. One module-level dispatcher,
 * with the listener API forwarded as statics, gives callers the same
 * addEventListener/removeEventListener they use everywhere else in the library
 * without changing what Configuration is.
 *
 * Module-level state, and therefore shared by every BlueprintJS on the page -
 * exactly like `config` itself. That is a real limitation and it is R-02's, not
 * this one's: making the configuration per-instance is a separate change, and
 * this dispatcher moves with it when it happens.
 */
const emitter = new EventDispatcher();

/** Global configuration to customize the whole system.  */
export class Configuration
{
	constructor()
	{
		/** Configuration data loaded from/stored to extern. */
	}

	static getData()
	{
		return config;
	}

	/**
	 * Subscribe to configuration changes.
	 *
	 * @param {string} type Currently only EVENT_CONFIG_CHANGED.
	 * @param {function(Object): void} listener Receives `{type, key, value, previous}`.
	 */
	static addEventListener(type, listener)
	{
		emitter.addEventListener(type, listener);
	}

	/**
	 * @param {string} type
	 * @param {function(Object): void} listener The same reference passed to addEventListener.
	 */
	static removeEventListener(type, listener)
	{
		emitter.removeEventListener(type, listener);
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
	static setValue(key, value)
	{
		var previous = config[key];
		config[key] = value;
		if (previous !== value)
		{
			emitter.dispatchEvent({type: EVENT_CONFIG_CHANGED, key: key, value: value, previous: previous});
		}
	}

	/** Get a string configuration parameter. */
	static getStringValue(key)
	{
		switch (key) 
		{
		case configDimUnit:
			return String(Configuration.getData()[key]);
		default:
			throw new Error('Invalid string configuration parameter: ' + key);
		}
	}

	/** Get a numeric configuration parameter. */
	static getNumericValue(key)
	{
		switch (key) 
		{
		case configSystemUI:
		case configWallHeight:
		case configWallThickness:
		case scale:
		case snapToGrid:
		case snapTolerance:
		case gridSpacing:
			return Number(Configuration.getData()[key]);
		default:
			throw new Error('Invalid numeric configuration parameter: ' + key);
		}
	}
}