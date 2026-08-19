// @ts-check
import {computed} from 'vue';
import {SELECTION_ITEM} from './useSelection.js';

/**
 * Delete and duplicate, for the selected furniture item.
 *
 * Neither existed. The only way to remove an item was the small red cross the
 * HUD draws over a hovered item in the 3D view - discoverable by accident, and
 * unusable at all if the item is behind a wall. There was no way to duplicate
 * anything: placing a second identical chair meant reopening the catalog,
 * finding it again, and dragging it into position.
 *
 * ## Duplicate is a re-add, not a clone
 *
 * `Item` holds a loaded three.js Object3D, its materials and its bound wall
 * edge; deep-copying that graph correctly is more delicate than asking the
 * scene to load a second one from the same URL. `getMetaData()` already
 * produces exactly the description `Scene.addItem` consumes - it is what the
 * save file is made of - so a duplicate is a save and a load of one item.
 *
 * That also means a duplicate arrives asynchronously, like any other add, and
 * inherits the original's colours and dimensions because they are in the
 * metadata.
 */

/**
 * How far to offset a duplicate from its original, in centimetres.
 *
 * Enough to be visibly a second object rather than z-fighting with the first,
 * small enough to stay inside the room it was copied in.
 */
const DUPLICATE_OFFSET_CM = 30;

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {ReturnType<import('./useSelection.js').useSelection>} selection
 * @param {ReturnType<import('./useHistory.js').useHistory>} history
 */
export function useItemActions(store, selection, history)
{
	var selectedItem = computed(function ()
	{
		var current = selection.selection.value;
		return (current && current.type === SELECTION_ITEM) ? current.object : null;
	});

	/**
	 * Every selected item, which since RM-012 J4 may be more than one.
	 *
	 * `selectedItem` stays beside it and stays the primary, because the two
	 * answer different questions: an inspector edits one thing and a verb acts
	 * on the set. Both read the same composable and cannot disagree.
	 */
	var selectedItems = computed(() => selection.selectedItems.value);

	var canActOnItem = computed(() => selectedItem.value !== null);

	/**
	 * Delete everything selected.
	 *
	 * Every one of them, not the primary. The moment the selection became a set
	 * (X-6) this became the difference between deleting five chairs and deleting
	 * one of five while the other four stayed highlighted - which is the shape of
	 * bug a set introduces into every verb that predates it, and the reason
	 * delete is repaired in the same commit as the set rather than after it.
	 *
	 * @returns {boolean} whether anything was deleted.
	 */
	function deleteSelected()
	{
		var items = selectedItems.value;
		if (!items.length)
		{
			return false;
		}

		// Clear the selection first. `Item.remove()` takes the mesh out of the
		// scene, and an inspector still rendering fields bound to a removed item
		// reads properties off a detached object graph.
		selection.clear();
		if (store.three.value)
		{
			store.three.value.clearSelection();
		}
		// A copy, because `remove()` mutates the scene the computed reads from.
		// Iterating the live list would delete every other chair.
		items.slice().forEach((item) => {item.remove();});
		// One commit for the whole set, so undo brings back what one gesture took
		// away rather than restoring five chairs one keystroke at a time.
		history.commit();
		return true;
	}

	/**
	 * @returns {boolean} whether a duplicate was started.
	 */
	function duplicateSelected()
	{
		var item = selectedItem.value;
		if (!item || !store.model.value)
		{
			return false;
		}

		var scene = store.model.value.scene;
		var meta = item.getMetaData();

		// Offset on the floor plane only. Lifting a duplicate in Y would put a
		// wall-mounted item through the ceiling and a floor item in mid-air.
		var position = item.position.clone();
		position.x += DUPLICATE_OFFSET_CM;
		position.z += DUPLICATE_OFFSET_CM;

		scene.addItem(
			meta.itemType,
			meta.modelUrl,
			meta,
			position,
			item.rotation.y,
			item.scale.clone(),
			false,
			// A wall-bound duplicate keeps the edge its original is on; the
			// controller re-derives the position along that edge from the hint.
			item.currentWallEdge ? {position: position, edge: item.currentWallEdge} : null
		);

		// Not committed here. The item is still loading, and useHistory's
		// EVENT_ITEM_LOADED listener records it when it arrives - committing now
		// would snapshot the design *without* the duplicate and leave the
		// duplicate itself outside the stack.
		return true;
	}

	return {selectedItem, selectedItems, canActOnItem, deleteSelected, duplicateSelected};
}
