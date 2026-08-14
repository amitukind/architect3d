// @ts-check
import {markRaw, onScopeDispose, shallowRef, watch} from 'vue';
import {EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_WALL_CLICKED, EVENT_FLOOR_CLICKED} from '../../scripts/blueprint.js';
import {EVENT_NOTHING_CLICKED, EVENT_CORNER_2D_CLICKED, EVENT_WALL_2D_CLICKED, EVENT_ROOM_2D_CLICKED} from '../../scripts/blueprint.js';

/**
 * One reactive selection, replacing the demo's `aWall` / `anItem` globals.
 *
 * Sprint S6. The legacy demo kept two module-level variables, each holding a
 * *properties object* rather than the thing selected, each written by a
 * different event handler, and neither ever cleared. That is where the
 * null-wall crash comes from (see `placementContext` below), and it is why the
 * item inspector could be showing one item's dimensions while a different item
 * was selected.
 *
 * Here there is exactly one selection at a time and it is a plain
 * `{type, object}` pair. Inspectors switch on `type`; nothing else needs to
 * know which event produced it.
 *
 * The selected object is `markRaw`'d - it is a live Wall / Corner / Room /
 * Item that the library compares by identity. See useBlueprint's note.
 */

/** Selection kinds. `null` for no selection. */
export const SELECTION_ITEM = 'item';
export const SELECTION_WALL = 'wall';
export const SELECTION_FLOOR = 'floor';
export const SELECTION_CORNER_2D = 'corner2d';
export const SELECTION_WALL_2D = 'wall2d';
export const SELECTION_ROOM_2D = 'room2d';

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useSelection(store)
{
	/** @type {import('vue').ShallowRef<?{type: string, object: Object}>} */
	var selection = shallowRef(null);

	/**
	 * The last wall or floor clicked in the 3D view, and the only thing the
	 * catalog needs from the selection.
	 *
	 * Kept apart from `selection` on purpose, because the two answer different
	 * questions. Selecting an item replaces the selection but must not forget
	 * which wall you were working on - that is the behaviour the demo got for
	 * free by never clearing `aWall`, and losing it would make placing a second
	 * window on the same wall a two-click affair.
	 *
	 * Unlike `aWall` it starts as a real object with both fields null, so a
	 * catalog click before any 3D click reads `null` instead of throwing.
	 */
	var placementContext = shallowRef({wall: null, floor: null});

	function select(type, object)
	{
		selection.value = object ? {type: type, object: markRaw(object)} : null;
	}

	function clear()
	{
		selection.value = null;
	}

	var handlers = null;

	function attach(blueprint)
	{
		var three = blueprint.three;
		var floorplan = blueprint.model.floorplan;

		handlers = {
			three: three,
			floorplan: floorplan,
			itemSelected: (evt) => {select(SELECTION_ITEM, evt.item);},
			itemUnselected: () => {clear();},
			wallClicked: (evt) =>
			{
				placementContext.value = {wall: markRaw(evt.item), floor: null};
				select(SELECTION_WALL, evt.item);
			},
			floorClicked: (evt) =>
			{
				placementContext.value = {wall: null, floor: markRaw(evt.item)};
				select(SELECTION_FLOOR, evt.item);
			},
			nothingClicked: () => {clear();},
			corner2d: (evt) => {select(SELECTION_CORNER_2D, evt.item);},
			wall2d: (evt) => {select(SELECTION_WALL_2D, evt.item);},
			room2d: (evt) => {select(SELECTION_ROOM_2D, evt.item);},
		};

		three.addEventListener(EVENT_ITEM_SELECTED, handlers.itemSelected);
		three.addEventListener(EVENT_ITEM_UNSELECTED, handlers.itemUnselected);
		three.addEventListener(EVENT_WALL_CLICKED, handlers.wallClicked);
		three.addEventListener(EVENT_FLOOR_CLICKED, handlers.floorClicked);

		floorplan.addEventListener(EVENT_NOTHING_CLICKED, handlers.nothingClicked);
		floorplan.addEventListener(EVENT_CORNER_2D_CLICKED, handlers.corner2d);
		floorplan.addEventListener(EVENT_WALL_2D_CLICKED, handlers.wall2d);
		floorplan.addEventListener(EVENT_ROOM_2D_CLICKED, handlers.room2d);
	}

	function detach()
	{
		if (!handlers)
		{
			return;
		}
		var three = handlers.three;
		var floorplan = handlers.floorplan;

		three.removeEventListener(EVENT_ITEM_SELECTED, handlers.itemSelected);
		three.removeEventListener(EVENT_ITEM_UNSELECTED, handlers.itemUnselected);
		three.removeEventListener(EVENT_WALL_CLICKED, handlers.wallClicked);
		three.removeEventListener(EVENT_FLOOR_CLICKED, handlers.floorClicked);

		floorplan.removeEventListener(EVENT_NOTHING_CLICKED, handlers.nothingClicked);
		floorplan.removeEventListener(EVENT_CORNER_2D_CLICKED, handlers.corner2d);
		floorplan.removeEventListener(EVENT_WALL_2D_CLICKED, handlers.wall2d);
		floorplan.removeEventListener(EVENT_ROOM_2D_CLICKED, handlers.room2d);

		handlers = null;
		selection.value = null;
		placementContext.value = {wall: null, floor: null};
	}

	watch(store.instance, (blueprint) =>
	{
		detach();
		if (blueprint)
		{
			attach(blueprint);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	return {selection, placementContext, select, clear};
}
