// @ts-check
import {computed, ref} from 'vue';
import {Vector3} from 'three';
import {metadataFromRecord} from '../../scripts/blueprint.js';
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
 * produces exactly the description a design is saved from, so a duplicate is a
 * save and a load of one item.
 *
 * That also means a duplicate arrives asynchronously, like any other add, and
 * inherits the original's colours and dimensions because they are in the
 * metadata.
 *
 * ## And it had never once worked (RM-012 J4)
 *
 * The sentence above used to end *"`getMetaData()` already produces exactly the
 * description `Scene.addItem` consumes"*, and that was the bug. It produces the
 * **save record** - `item_type`, `model_url`, `item_name` - and `addItem`
 * consumes the **constructor metadata** - `itemType`, `modelUrl`, `itemName`.
 * This file read `meta.itemType` and `meta.modelUrl`; both were `undefined`, so
 * `addItem` defaulted the type to 1 and asked the loader for `undefined`.
 *
 * It went unseen for two programmes because the test's fake returned the
 * camelCase shape this caller wished for rather than the shape the real method
 * returns - the second time in this document set a stub has agreed with the code
 * instead of with the data. The repair is not a rename: `metadataFromRecord` in
 * `model/model.js` is now the one translation between the two shapes, used by
 * the design loader and by this file, so there is nothing left to disagree.
 *
 * ## Copy and paste are the same machinery, with the record kept
 *
 * A copy is the set's save records held in a module-level ref; a paste is those
 * records re-added with a fresh identity. Which makes duplicate what it should
 * always have been - a copy and a paste in one gesture - rather than a third
 * implementation of the same idea.
 *
 * The clipboard is this application's, not the system's. Putting a design
 * fragment on the OS clipboard is a serialisation format and a security surface;
 * RM-007 puts sharing in K2, where a `.zip` bundle and a URL are already the
 * subject. What a person means by copy and paste inside one plan is this.
 */

/**
 * How far to offset a duplicate from its original, in centimetres.
 *
 * Enough to be visibly a second object rather than z-fighting with the first,
 * small enough to stay inside the room it was copied in.
 */
const DUPLICATE_OFFSET_CM = 30;

/**
 * How far each successive paste lands from where it was copied.
 *
 * Multiplied by how many pastes have happened since the copy, so pasting four
 * times gives four visible copies rather than four in one place - which is the
 * behaviour that makes paste useful for laying out a row of chairs.
 */
const PASTE_OFFSET_CM = 30;

/**
 * What was copied, as save records.
 *
 * Module-level, like the display unit and the favourites list, and for the same
 * reason: there is one person at the keyboard and one clipboard. It also means a
 * copy survives the composable being torn down and set up again, which is what
 * happens when the workspace layout changes.
 *
 * @type {import('vue').Ref<Array<Object>>}
 */
const clipboard = ref([]);

/** How many pastes since the last copy, so each lands further out. */
const pasteCount = ref(0);

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

	/** Whether there is anything on the clipboard to paste. */
	var canPaste = computed(() => clipboard.value.length > 0);

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
	 * Put one item into the scene from a saved record, offset, without its
	 * identity.
	 *
	 * The one place a record becomes an item in this file, so copy, paste and
	 * duplicate cannot drift from each other the way this file drifted from the
	 * design loader.
	 *
	 * @param {Object} record A `getMetaData()` result.
	 * @param {number} dx Centimetres east.
	 * @param {number} dz Centimetres south.
	 */
	function placeRecord(record, dx, dz)
	{
		var scene = store.model.value.scene;
		// No `designId`. Two items sharing one is not cosmetic: `useSelection`
		// resolves a selection by searching the scene for that id, so the copy and
		// the original would be one thing to the inspector, to the plan highlight
		// and to delete.
		var metadata = metadataFromRecord(record);
		// Offset on the floor plane only. Lifting a copy in Y would put a
		// wall-mounted item through the ceiling and a floor item in mid-air.
		var position = new Vector3(record.xpos + dx, record.ypos, record.zpos + dz);
		var scale = new Vector3(record.scale_x, record.scale_y, record.scale_z);

		scene.addItem(
			record.item_type,
			record.model_url,
			metadata,
			position,
			record.rotation,
			scale,
			record.fixed,
			// A wall-bound copy keeps the edge its original is on; the controller
			// re-derives the position along that edge from the hint.
			record.edge ? {position: position, edge: record.edge} : null
		);
	}

	/**
	 * Copy the selection.
	 *
	 * The record, plus the wall edge, which the save format does not carry
	 * because a saved design re-derives it from the item's position. A paste in
	 * the same session can do better than re-derive it.
	 *
	 * @returns {number} how many were copied.
	 */
	function copySelected()
	{
		var items = selectedItems.value;
		if (!items.length)
		{
			return 0;
		}
		clipboard.value = items.map((item) => Object.assign(item.getMetaData(),
			{edge: item.currentWallEdge || null}));
		// A new origin, so the next paste lands one offset out rather than
		// continuing from wherever the previous clipboard had got to.
		pasteCount.value = 0;
		return clipboard.value.length;
	}

	/**
	 * Paste whatever was copied, offset from where it was copied from.
	 *
	 * Not committed here. The items are still loading, and useHistory's
	 * EVENT_ITEM_LOADED listener records them when they arrive - committing now
	 * would snapshot the design *without* the paste and leave the paste itself
	 * outside the stack.
	 *
	 * @returns {number} how many were started.
	 */
	function pasteClipboard()
	{
		var records = clipboard.value;
		if (!records.length || !store.model.value)
		{
			return 0;
		}
		// Each paste lands further out than the last, so pasting four times gives
		// four visible copies rather than four in one place. Reset by the next
		// copy, because that is a new origin.
		pasteCount.value += 1;
		var offset = PASTE_OFFSET_CM * pasteCount.value;
		records.forEach((record) => {placeRecord(record, offset, offset);});
		return records.length;
	}

	/**
	 * Copy and paste in one gesture, which is what duplicate is.
	 *
	 * Deliberately does not disturb the clipboard: somebody who copied a sofa,
	 * then duplicated a chair, then pasted, means the sofa. Duplicate is a
	 * shortcut, not a third clipboard.
	 *
	 * @returns {boolean} whether a duplicate was started.
	 */
	function duplicateSelected()
	{
		var items = selectedItems.value;
		if (!items.length || !store.model.value)
		{
			return false;
		}
		items.forEach(function (item)
		{
			var record = Object.assign(item.getMetaData(), {edge: item.currentWallEdge || null});
			placeRecord(record, DUPLICATE_OFFSET_CM, DUPLICATE_OFFSET_CM);
		});
		return true;
	}

	return {
		selectedItem, selectedItems, canActOnItem, deleteSelected, duplicateSelected,
		copySelected, pasteClipboard, clipboard, canPaste,
	};
}
