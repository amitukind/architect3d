// @ts-check
import {onScopeDispose, ref, watch} from 'vue';
import {EVENT_UPDATED, EVENT_LOADED, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED} from '../../scripts/blueprint.js';
import {Dimensioning} from '../../scripts/blueprint.js';

/**
 * What the plan currently contains, for the status bar.
 *
 * Rooms, walls, items and total floor area - the four numbers a person checks
 * without opening anything. None of them were shown anywhere before; the area
 * of a single room was drawn on the canvas and that was all.
 *
 * ## Recomputed, not watched
 *
 * The floorplan is a graph of raw model objects deliberately kept outside Vue's
 * reactivity (see the markRaw note in useBlueprint), so there is nothing here
 * for a `computed` to depend on. The library's own events are the change
 * signal, and each one triggers a full recount.
 *
 * A full recount is the right call at this size: `getRooms()` and `getWalls()`
 * return arrays that already exist, and summing a dozen room areas costs less
 * than the machinery to track which one changed.
 */

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function usePlanStats(store)
{
	var rooms = ref(0);
	var walls = ref(0);
	var corners = ref(0);
	var items = ref(0);
	/** Total floor area in square centimetres. */
	var areaCm2 = ref(0);
	/** The same, formatted in the active display unit, squared. */
	var areaLabel = ref('');

	/** Plan-space cursor position in cm, or null when the pointer is elsewhere. */
	/** @type {import('vue').Ref<?{x: number, y: number}>} */
	var cursor = ref(null);

	function recount()
	{
		var blueprint = store.instance.value;
		if (!blueprint)
		{
			rooms.value = 0;
			walls.value = 0;
			corners.value = 0;
			items.value = 0;
			areaCm2.value = 0;
			areaLabel.value = '';
			return;
		}

		var floorplan = blueprint.model.floorplan;
		var roomList = floorplan.getRooms();

		rooms.value = roomList.length;
		walls.value = floorplan.getWalls().length;
		corners.value = floorplan.getCorners().length;
		items.value = blueprint.model.scene.getItems().length;

		var total = 0;
		roomList.forEach(function (room)
		{
			// `area` is computed by the library's shoelace pass and can be
			// undefined on a room that has not been measured yet - a freshly loaded
			// plan dispatches EVENT_UPDATED before every room has one.
			total += (typeof room.area === 'number' && isFinite(room.area)) ? room.area : 0;
		});

		areaCm2.value = total;
		// cmToMeasure with 2 decimals is what the canvas uses for a room label, so
		// the status bar total and the on-canvas figures are formatted alike.
		areaLabel.value = Dimensioning.cmToMeasure(total, 2) + String.fromCharCode(178);
	}

	/**
	 * @param {?{x: number, y: number}} position Plan coordinates in cm.
	 */
	function setCursor(position)
	{
		cursor.value = position;
	}

	var attached = null;

	function attach(blueprint)
	{
		attached = {
			floorplan: blueprint.model.floorplan,
			scene: blueprint.model.scene,
			model: blueprint.model,
			onChange: recount,
		};

		attached.floorplan.addEventListener(EVENT_UPDATED, attached.onChange);
		attached.scene.addEventListener(EVENT_ITEM_LOADED, attached.onChange);
		attached.scene.addEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		attached.model.addEventListener(EVENT_LOADED, attached.onChange);
		recount();
	}

	function detach()
	{
		if (!attached)
		{
			return;
		}
		attached.floorplan.removeEventListener(EVENT_UPDATED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_LOADED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		attached.model.removeEventListener(EVENT_LOADED, attached.onChange);
		attached = null;
		recount();
	}

	watch(store.instance, function (blueprint)
	{
		detach();
		if (blueprint)
		{
			attach(blueprint);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	return {rooms, walls, corners, items, areaCm2, areaLabel, cursor, setCursor, recount};
}
