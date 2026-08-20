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

/**
 * Eye height, and the range a person is offered (RM-011 H3).
 *
 * 160 is the fork's number, which `Main` has always assigned over the class
 * default of 125 - so this constant states what actually runs rather than what
 * the constructor happens to initialise. The bounds are a person: 90 cm is a
 * small child's eye level and 220 is above the tallest adult, and past either
 * end the walkthrough stops being a way of judging a room.
 *
 * Here rather than beside `PointerLockControls`, where H3 declared it, because
 * of where it is read from: the walkthrough panel wants the bounds to draw a
 * slider, and a module that imports three's addon is an expensive place to
 * keep three numbers. See the note in three/pointerlockcontrols.js.
 */
export const EYE_HEIGHT = Object.freeze({default: 160, min: 90, max: 220});

export const WallTypes = Enum('STRAIGHT', 'CURVED');