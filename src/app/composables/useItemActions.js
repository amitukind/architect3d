// @ts-check
import {computed, ref} from 'vue';
import {Vector3} from 'three';
import {metadataFromRecord} from '../../scripts/blueprint.js';
import {SELECTION_ITEM} from './useSelection.js';
import {createInjection} from './injection.js';

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
	 * The set's bounding rectangle on the floor plane, and each member's own.
	 *
	 * Edges rather than centres, because that is what align means: "left" is the
	 * left *edge* of every item on the left edge of the leftmost one, and an item
	 * twice as wide as its neighbour does not end up sticking out. `halfSize` is
	 * the item's size after scaling and is always positive, including for a
	 * mirrored item.
	 *
	 * @param {Array<Object>} items
	 */
	function extents(items)
	{
		var boxes = items.map((item) => ({
			item: item,
			minX: item.position.x - item.halfSize.x,
			maxX: item.position.x + item.halfSize.x,
			minZ: item.position.z - item.halfSize.z,
			maxZ: item.position.z + item.halfSize.z,
		}));
		return {
			boxes: boxes,
			minX: Math.min(...boxes.map((box) => box.minX)),
			maxX: Math.max(...boxes.map((box) => box.maxX)),
			minZ: Math.min(...boxes.map((box) => box.minZ)),
			maxZ: Math.max(...boxes.map((box) => box.maxZ)),
		};
	}

	/**
	 * Move an item on the floor plane, through the path a drag takes.
	 *
	 * `moveToPosition` rather than writing `position` directly, so a wall-bound
	 * item is still bound to its wall afterwards and a floor item keeps whatever
	 * elevation it had - both of which are decisions those classes already make
	 * and neither of which align should be re-litigating.
	 */
	function moveTo(item, x, z)
	{
		var next = item.position.clone();
		next.x = x;
		next.z = z;
		item.moveToPosition(next);
	}

	/**
	 * Line the selection up on one edge, or on a shared centre line (RM-012 J4).
	 *
	 * Reads the set `useSelection` creates, which is why X-6 put multi-select
	 * first. Two items are the minimum that means anything - aligning one item to
	 * itself is a no-op that would still cost an undo entry, so it is refused.
	 *
	 * @param {string} edge `left`, `right`, `front`, `back`, `centreX`, `centreZ`.
	 * @returns {number} how many moved.
	 */
	function alignSelected(edge)
	{
		var items = selectedItems.value;
		if (items.length < 2)
		{
			return 0;
		}
		var box = extents(items);
		var midX = (box.minX + box.maxX) / 2;
		var midZ = (box.minZ + box.maxZ) / 2;

		box.boxes.forEach(function (one)
		{
			var item = one.item;
			var x = item.position.x;
			var z = item.position.z;
			// West and east on the plan, north and south. Named for the plan rather
			// than for the axis, because a person aligning furniture is looking at
			// the plan and `+z` is not a direction anybody means.
			if (edge === 'left') { x = box.minX + item.halfSize.x; }
			else if (edge === 'right') { x = box.maxX - item.halfSize.x; }
			else if (edge === 'back') { z = box.minZ + item.halfSize.z; }
			else if (edge === 'front') { z = box.maxZ - item.halfSize.z; }
			else if (edge === 'centreX') { x = midX; }
			else if (edge === 'centreZ') { z = midZ; }
			moveTo(item, x, z);
		});
		history.commit();
		return items.length;
	}

	/**
	 * Even the gaps between the selection along one axis (RM-012 J4).
	 *
	 * The gaps, not the centres. Distributing centres evenly leaves a wide item
	 * nearly touching its neighbour and a narrow one marooned, which is not what
	 * "space these out" means to anybody arranging furniture. The two outermost
	 * items stay where they are - they are the span being divided - and the rest
	 * are laid out with one gap each.
	 *
	 * Three is the minimum that means anything: with two there is one gap and it
	 * is already even.
	 *
	 * @param {string} axis `x` or `z`.
	 * @returns {number} how many moved.
	 */
	function distributeSelected(axis)
	{
		var items = selectedItems.value;
		if (items.length < 3)
		{
			return 0;
		}
		var along = (axis === 'z') ? 'z' : 'x';
		var size = (item) => ((along === 'z') ? item.halfSize.z : item.halfSize.x) * 2;
		var at = (item) => ((along === 'z') ? item.position.z : item.position.x);

		var ordered = items.slice().sort((a, b) => at(a) - at(b));
		var first = ordered[0];
		var last = ordered[ordered.length - 1];
		var span = (at(last) - (size(last) / 2)) - (at(first) + (size(first) / 2));
		var occupied = ordered.slice(1, -1).reduce((sum, item) => sum + size(item), 0);
		// Negative when the items overlap more than the span allows. Distributing
		// them then means overlapping them evenly, which is still better than
		// leaving them piled up and is what the arithmetic says.
		var gap = (span - occupied) / (ordered.length - 1);

		var cursor = at(first) + (size(first) / 2);
		ordered.slice(1, -1).forEach(function (item)
		{
			cursor += gap + (size(item) / 2);
			if (along === 'z') { moveTo(item, item.position.x, cursor); }
			else { moveTo(item, cursor, item.position.z); }
			cursor += size(item) / 2;
		});
		history.commit();
		return ordered.length;
	}

	/**
	 * Mark the selection as one group, or unmark it (RM-012 J4).
	 *
	 * A shared string on each item rather than a `Group` entity in the document.
	 * Nobody selects "the group" - they click a chair and mean the six around the
	 * table - so the only state a group needs is a mark saying which items move
	 * together. Additive in the save file, free to delete a member of, and
	 * impossible to leave dangling, which a `Group` object holding references
	 * would not be.
	 *
	 * @returns {number} how many were marked.
	 */
	function groupSelected()
	{
		var items = selectedItems.value;
		if (items.length < 2)
		{
			return 0;
		}
		// From the primary's identity, which is unique and already in the document,
		// rather than a second id scheme nobody can trace back to anything.
		var id = 'g:' + items[items.length - 1].designId;
		items.forEach((item) => {item.groupId = id;});
		history.commit();
		return items.length;
	}

	/** @returns {number} how many were released. */
	function ungroupSelected()
	{
		var items = selectedItems.value.filter((item) => item.groupId);
		if (!items.length)
		{
			return 0;
		}
		items.forEach((item) => {item.groupId = null;});
		history.commit();
		return items.length;
	}

	/**
	 * Flip every selected item on one horizontal axis (RM-012 J4).
	 *
	 * The verb RM-007 calls cheap, and it is: `Item.mirror` negates a scale
	 * component, `scale_x` has been in the save format since the format existed,
	 * and the winding reversal the drawing names as the risk turns out to be
	 * three's job already. What this adds is the set and the commit.
	 *
	 * Each item flips about its own centre rather than about the set's, which is
	 * what mirroring a *thing* means. Mirroring a *layout* - reflecting six chairs
	 * across the room's axis - is a different verb, and it belongs with align and
	 * distribute, which is where the set's own geometry is worked out.
	 *
	 * @param {string} [axis] `'x'` (default) or `'z'`.
	 * @returns {number} how many were flipped.
	 */
	function mirrorSelected(axis)
	{
		var items = selectedItems.value;
		if (!items.length)
		{
			return 0;
		}
		items.forEach((item) => {item.mirror(axis);});
		// One commit for the gesture, like delete. Mirroring four chairs is one
		// thing a person did.
		history.commit();
		return items.length;
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
		copySelected, pasteClipboard, clipboard, canPaste, mirrorSelected,
		alignSelected, distributeSelected, groupSelected, ungroupSelected,
	};
}

/**
 * `useItemActions` as an injection (RM-020 S-5). See `injection.js` for the pattern and
 * why twelve of the twenty-two composables use it.
 */
const injection = createInjection('ItemActions');

/** The key, for a component mounted outside the shell - a test, or another host. */
export const ITEM_ACTIONS_KEY = injection.key;

/**
 * Build it and make it available to every descendant.
 * @returns {ReturnType<typeof useItemActions>}
 */
export function provideItemActions(store, selection, history)
{
	return injection.put(useItemActions(store, selection, history));
}

/**
 * Take it from an ancestor that called `provideItemActions`.
 * @returns {ReturnType<typeof useItemActions>}
 */
export function injectItemActions()
{
	return injection.take();
}
