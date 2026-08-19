// @ts-check
import Enum from './enum.js';

export const VIEW_TOP = 'topview';
export const VIEW_FRONT = 'frontview';
export const VIEW_RIGHT = 'rightview';
export const VIEW_LEFT = 'leftview';
export const VIEW_ISOMETRY = 'isometryview';
/**
 * The whole building, from outside (RM-010 G3).
 *
 * Not a sixth face of the view cube. The five above are directions - they point
 * the camera and leave the distance to whatever it was - and this one is a
 * *subject*: frame the building, all of it, however many storeys it has and
 * whatever roof is on top. It is on `switchView` beside them because that is
 * the one method that moves the camera, not because it is the same kind of
 * thing.
 */
export const VIEW_EXTERIOR = 'exteriorview';

export const WallTypes = Enum('STRAIGHT', 'CURVED');