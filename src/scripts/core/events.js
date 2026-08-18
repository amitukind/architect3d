// @ts-check
export const EVENT_ACTION = 'ACTION_EVENT';
export const EVENT_DELETED = 'DELETED_EVENT';
export const EVENT_MOVED = 'MOVED_EVENT';
export const EVENT_REDRAW = 'REDRAW_EVENT';
export const EVENT_NEW = 'NEW_EVENT';
export const EVENT_LOADED = 'LOADED_EVENT';
export const EVENT_LOADING = 'LOADING_EVENT';
export const EVENT_UPDATED = 'UPDATED_EVENT';
export const EVENT_SAVED = 'SAVED_EVENT';
export const EVENT_CHANGED = 'CHANGED_EVENT';
export const EVENT_GLTF_READY = 'GLTF_READY_EVENT';

/**
 * Something changed, and the payload says what (RM-003 A2).
 *
 * Carries `{item, changes}`, where `changes` is a `ChangeSet` naming the kinds
 * that changed and the entities each kind affects. See core/change_set.js for
 * the vocabulary and why it is a payload rather than six more constants.
 *
 * Dispatched by `Floorplan` immediately before the `EVENT_UPDATED` it derives,
 * so the two are one announcement seen at two levels of detail. Subscribing to
 * this one instead of EVENT_UPDATED is what lets a consumer stop doing its most
 * expensive thing on every pointermove.
 */
export const EVENT_CHANGESET = 'CHANGESET_EVENT';

export const EVENT_ITEM_LOADING = 'ITEM_LOADING_EVENT';
export const EVENT_ITEM_LOADED = 'ITEM_LOADED_EVENT';
export const EVENT_ITEM_REMOVED = 'ITEM_REMOVED_EVENT';
/**
 * An item finished being dragged or rotated in the 3D view.
 *
 * Added for undo. Nothing else marks the end of a direct manipulation: the
 * Controller mutates the item's position on every pointermove and sets
 * `scene.needsUpdate` so a frame is drawn, but the scene has no "and now it has
 * settled" signal - so a history stack listening only to what exists would
 * either record a hundred entries for one drag or none at all.
 *
 * Dispatched by Controller on the DRAGGING and ROTATING exits, which are the
 * two states a pointer-up can leave. Carries the item on `.item`.
 */
export const EVENT_ITEM_MOVE_FINISH = 'ITEM_MOVE_FINISH_EVENT';
export const EVENT_ITEM_SELECTED = 'ITEM_SELECTED_EVENT';
export const EVENT_ITEM_UNSELECTED = 'ITEM_UNSELECTED_EVENT';

/**
 * A configuration value changed.
 *
 * `Configuration` was the one change vector in the library that broadcast
 * nothing: every other mutation announces itself through an EventDispatcher,
 * while units, scale, grid spacing and snap tolerance changed silently on a
 * plain object. A consumer that wanted to react had to poll or be told out of
 * band, and the settings panel's zoom control read `Number(config.scale)` once,
 * rendered 1, and then sat there reading 1 while the plan was at 300%.
 *
 * Dispatched by `Configuration.setValue`, and only when the value actually
 * changes - setting a key to what it already holds is not a change. Carries
 * `.key`, `.value` and `.previous`.
 *
 * Listen on the class itself, not on an instance: `Configuration` is a
 * namespace of statics over module-level state, so the listener API is static
 * too. See core/configuration.js.
 */
export const EVENT_CONFIG_CHANGED = 'CONFIG_CHANGED_EVENT';

export const EVENT_MODE_RESET = 'MODE_RESET_EVENT';
export const EVENT_CAMERA_MOVED = 'CAMERA_MOVED_EVENT';
export const EVENT_CAMERA_ACTIVE_STATUS = 'CAMERA_ACTIVE_STATUS_EVENT';
export const EVENT_CAMERA_VIEW_CHANGE = 'CAMERA_VIEW_CHANGE_EVENT';
export const EVENT_FPS_EXIT = 'CAMERA_FPS_EXIT_EVENT';

export const EVENT_WALL_CLICKED = 'WALL_CLICKED_EVENT';
export const EVENT_ROOM_CLICKED = 'ROOM_CLICKED_EVENT';
export const EVENT_FLOOR_CLICKED = 'FLOOR_CLICKED_EVENT';
export const EVENT_NOTHING_CLICKED = 'NOTHING_CLICKED_EVENT';

export const EVENT_ROOM_NAME_CHANGED = 'CHANGED_ROOM_NAME_EVENT';

export const EVENT_CORNER_ATTRIBUTES_CHANGED = 'CORNER_ATTRIBUTES_CHANGED_EVENT';
export const EVENT_WALL_ATTRIBUTES_CHANGED = 'WALL_ATTRIBUTES_CHANGED_EVENT';
export const EVENT_ROOM_ATTRIBUTES_CHANGED = 'ROOM_ATTRIBUTES_CHANGED_EVENT';

export const EVENT_CORNER_2D_CLICKED = 'CORNER_CLICKED_2D_EVENT';
export const EVENT_WALL_2D_CLICKED = 'WALL_CLICKED_2D_EVENT';
export const EVENT_ROOM_2D_CLICKED = 'ROOM_CLICKED_2D_EVENT';

export const EVENT_CORNER_2D_DOUBLE_CLICKED = 'CORNER_DOUBLE_CLICKED_2D_EVENT';
export const EVENT_WALL_2D_DOUBLE_CLICKED = 'WALL_DOUBLE_CLICKED_2D_EVENT';
export const EVENT_ROOM_2D_DOUBLE_CLICKED = 'ROOM_DOUBLE_CLICKED_2D_EVENT';

export const EVENT_CORNER_2D_HOVER = 'CORNER_HOVER_2D_EVENT';
export const EVENT_WALL_2D_HOVER = 'WALL_HOVER_2D_EVENT';
export const EVENT_ROOM_2D_HOVER = 'ROOM_HOVER_2D_EVENT';

/**
 * The plan's view of the furniture has been replaced (RM-008 E1).
 *
 * Dispatched by `Floorplan` when `Model` hands it a new projection - see
 * `model/plan_projection.js` for why the plan is given data rather than a
 * reference to the scene. Carries the list on `projection`.
 *
 * A dedicated event rather than EVENT_UPDATED, which means "the wall graph
 * changed" and drives a full 3D teardown and rebuild. Moving a chair must not
 * cost that.
 */
export const EVENT_ITEMS_PROJECTED = 'ITEMS_PROJECTED_EVENT';

/** An item's footprint was clicked on the 2D plan (RM-008 E1). Carries `id`. */
export const EVENT_ITEM_2D_CLICKED = 'ITEM_CLICKED_2D_EVENT';

/**
 * The plan's dimensions, text labels or north bearing changed (RM-008 E3).
 *
 * Its own event rather than EVENT_UPDATED for the reason
 * {@link EVENT_ITEMS_PROJECTED} is: EVENT_UPDATED means the wall graph moved,
 * and drives a full 3D teardown, a light rebuild and a camera recentre. Typing
 * a note on the plan must not cost that, and none of it would change anything -
 * annotations are drawn by the 2D view alone.
 *
 * Carries `item` (the floorplan). Deliberately no payload beyond that: the
 * collections are small, the view redraws whole, and a delta would be a second
 * description of state that already has one.
 */
export const EVENT_ANNOTATIONS_CHANGED = 'ANNOTATIONS_CHANGED_EVENT';

/** A dimension line was clicked on the 2D plan (RM-008 E3). Carries `item`. */
export const EVENT_DIMENSION_2D_CLICKED = 'DIMENSION_CLICKED_2D_EVENT';

/** A text label was clicked on the 2D plan (RM-008 E3). Carries `item`. */
export const EVENT_ANNOTATION_2D_CLICKED = 'ANNOTATION_CLICKED_2D_EVENT';
