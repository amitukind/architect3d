// @ts-check
/**
 * Unit-name constants.
 *
 * This is a leaf module: it imports nothing. It exists to break the
 * configuration.js <-> dimensioning.js import cycle, which crashes under
 * native ESM (Vite dev, vitest, plain `node`) with
 *   ReferenceError: Cannot access 'dimCentiMeter' before initialization
 * because configuration.js reads dimCentiMeter at module-evaluation time
 * while dimensioning.js is still initialising. Rollup 1 only hid this by
 * flattening and reordering declarations into a single IIFE.
 *
 * dimensioning.js re-exports every symbol below, so the public API surface
 * (and the blueprint.js barrel) is unchanged.
 */

/** Dimensioning in Inch. */
export const dimInch = 'inch';

/** Dimensioning in Feet and Inch. */
export const dimFeetAndInch = 'feetAndInch';

/** Dimensioning in Meter. */
export const dimMeter = 'm';

/** Dimensioning in Centi Meter. */
export const dimCentiMeter = 'cm';

/** Dimensioning in Milli Meter. */
export const dimMilliMeter = 'mm';

export const dimensioningOptions = [dimInch, dimFeetAndInch, dimMeter, dimCentiMeter, dimMilliMeter];
