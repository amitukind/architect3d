// @ts-check
import {computed, onScopeDispose, ref, shallowRef, watch} from 'vue';
import {EVENT_UPDATED, EVENT_LOADED} from '../../scripts/blueprint.js';
import {EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_MOVE_FINISH} from '../../scripts/blueprint.js';
import {REASON_UNDO} from '../../scripts/blueprint.js';

/**
 * Undo and redo.
 *
 * The application has never had either. That is the largest single gap between
 * this and any tool a person would choose to draw a floor plan in: every edit
 * here is destructive, deleting a wall silently deletes the rooms it defined,
 * and the only recovery is to start again.
 *
 * ## Snapshots, not commands
 *
 * Each history entry is a whole serialized design - the string
 * `Model.exportSerialized()` produces, which is the same string the save button
 * writes to disk. Undo is `Model.loadSerialized(previous)`.
 *
 * The alternative, a command stack with an inverse per operation, gives finer
 * entries and much less memory. It also requires every mutation in the library
 * to be expressible as an invertible command, and the library is not built that
 * way: `Corner.mergeWithIntersected` can delete a corner, relocate another and
 * rebuild the room set in one call, and `Floorplan.update` re-derives every room
 * from scratch. Writing inverses for that is a library rewrite, and getting one
 * of them subtly wrong produces a design that is silently wrong rather than an
 * undo that visibly fails.
 *
 * A snapshot cannot be subtly wrong. It costs perhaps 20 KB for a furnished
 * plan, and the cap below bounds the total.
 *
 * ## What triggers an entry
 *
 * Three library events, coalesced:
 *
 *   EVENT_UPDATED (floorplan)     walls, corners, rooms - every 2D edit
 *   EVENT_ITEM_LOADED / REMOVED   furniture added or deleted
 *   EVENT_ITEM_MOVE_FINISH        an item dragged or rotated in 3D
 *
 * The first fires continuously while a wall is dragged, so they are debounced
 * into one entry per gesture. `commit()` is also callable directly, for the
 * edits that go through none of them - a texture swap, a room rename, anything
 * the inspector writes straight onto a model object.
 */

/**
 * How many designs to keep. Fifty is roughly a working session, and at ~20 KB
 * of JSON for a furnished plan the whole stack stays around a megabyte.
 */
const HISTORY_LIMIT = 50;

/**
 * How long a gesture has to be quiet before it counts as finished.
 *
 * Long enough that dragging a wall across the canvas is one entry, short enough
 * that undo works immediately after letting go. EVENT_UPDATED arrives on every
 * pointermove, so this is really "time since the last pointermove".
 */
const COALESCE_MS = 350;

/**
 * Backstop for a restore that never finishes settling.
 *
 * Restoring a snapshot is guarded by counting in-flight item loads rather than
 * by waiting a fixed time - see `holdOff` - which is exact, and exactness is
 * only safe if the count is guaranteed to come back down.
 *
 * ## It is now, and this is no longer load-bearing
 *
 * It was not when this was written: `Scene.addItem` called its loaders with a
 * null onError and nothing around them, so a 404, a malformed model or an
 * unparseable URL dispatched EVENT_ITEM_LOADING and then dispatched nothing at
 * all. The count never came back down and the history stack stayed shut for the
 * rest of the session. This timer existed to survive that, which made it a
 * workaround wearing the word "backstop".
 *
 * RM-002 R-01 gave addItem a real failure path: every call now dispatches
 * exactly one LOADING and exactly one LOADED, the failure carrying a null item.
 * Kept anyway, because one path still escapes that guarantee - an embedder's
 * own `Scene.setItemLoader`, which is arbitrary code under no obligation to
 * call back. That is a genuine backstop: it should never fire for anything this
 * repository ships, and if it does, something outside it is misbehaving.
 */
const SETTLE_BACKSTOP_MS = 8000;

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useHistory(store)
{
	/**
	 * Snapshots older than the current one, oldest first.
	 * @type {import('vue').ShallowRef<string[]>}
	 */
	var past = shallowRef([]);
	/**
	 * Snapshots undone away from, most recently undone last.
	 * @type {import('vue').ShallowRef<string[]>}
	 */
	var future = shallowRef([]);
	/**
	 * The design as it currently stands, or null before the first capture.
	 * @type {import('vue').Ref<?string>}
	 */
	var present = ref(null);

	var canUndo = computed(() => past.value.length > 0);
	var canRedo = computed(() => future.value.length > 0);
	var depth = computed(() => past.value.length);

	var coalesceTimer = null;
	var backstopTimer = null;
	/** True while a snapshot we applied is still being rebuilt. */
	var restoring = false;
	var attached = null;

	function model()
	{
		return store.model.value;
	}

	function snapshot()
	{
		var current = model();
		return current ? current.exportSerialized() : null;
	}

	/**
	 * Record the current design, if it differs from the last recorded one.
	 *
	 * The comparison is a string equality on the serialized form, which makes
	 * this safe to call speculatively - a redundant commit after an edit that
	 * changed nothing is free, and the UI does not have to know which of its
	 * controls actually mutate.
	 *
	 * ## Why this is NOT suppressed while restoring
	 *
	 * The restore guard exists to stop the library's own rebuild events being
	 * mistaken for edits. A call to `commit()` is not one of those: it comes from
	 * the application deciding that something a person did should be recorded -
	 * an inspector field, a deleted item - and nothing inside `loadSerialized`
	 * reaches it.
	 *
	 * Suppressing it here was a real bug, and a nasty one, because it only showed
	 * up in a sequence: undo, then edit something within the settle window. The
	 * edit went unrecorded AND the redo branch was left pointing at the abandoned
	 * future, so the next redo would silently discard the new work. Only the
	 * debounced path below is guarded.
	 *
	 * @returns {boolean} whether an entry was added.
	 */
	function commit()
	{
		// An explicit commit is also the definitive answer to "has the restore
		// finished" - whatever is on screen now is what the user means.
		release();

		var next = snapshot();
		if (next === null || next === present.value)
		{
			return false;
		}

		if (present.value !== null)
		{
			var entries = past.value.concat([present.value]);
			if (entries.length > HISTORY_LIMIT)
			{
				entries = entries.slice(entries.length - HISTORY_LIMIT);
			}
			past.value = entries;
		}

		present.value = next;
		// A new edit invalidates everything that was undone away from. This is the
		// standard linear-history contract and the one users expect; a tree would
		// keep the branch but needs UI to choose between branches.
		if (future.value.length)
		{
			future.value = [];
		}
		return true;
	}

	/** Commit once the edits stop arriving. */
	function scheduleCommit()
	{
		if (restoring)
		{
			return;
		}
		clearTimeout(coalesceTimer);
		coalesceTimer = setTimeout(function () {commit();}, COALESCE_MS);
	}

	/**
	 * Stop treating library events as edits until the design has finished
	 * rebuilding.
	 *
	 * `loadSerialized` rebuilds the floorplan synchronously and then starts one
	 * asynchronous model load per item. Every one of those ends in an
	 * EVENT_ITEM_LOADED that looks exactly like a user adding furniture, and
	 * recording them would mean every undo immediately pushed a new entry and
	 * redo was never reachable.
	 *
	 * The gate is a count rather than a timeout because a count is exact: it
	 * closes the moment the last model lands, however long that takes, and does
	 * not swallow a real edit that happens to arrive while an arbitrary timer is
	 * still running. The ordering that makes it work is that `Model.newRoom` calls
	 * `Scene.addItem` for every item BEFORE `loadSerialized` dispatches
	 * EVENT_LOADED, so by the time this runs the count is already complete.
	 *
	 * Since RM-003 A1 the count belongs to `scene.loadSession` rather than to this
	 * composable. It was maintained here, from EVENT_ITEM_LOADING against
	 * EVENT_ITEM_LOADED, and that was correct only while one document was ever
	 * loading - a second load starting before the first had settled interleaved
	 * two documents in one number, and the gate could close on the wrong one's
	 * last item. The session knows which generation each load belongs to.
	 */
	function holdOff()
	{
		restoring = true;
		clearTimeout(backstopTimer);
		backstopTimer = setTimeout(release, SETTLE_BACKSTOP_MS);
		settleIfIdle();
	}

	/**
	 * Close the gate if nothing is still loading.
	 *
	 * Asks the scene's load session rather than a count of its own since RM-003
	 * A1. The count was correct only while one document was ever loading: a second
	 * load starting before the first had settled left the two interleaved in one
	 * number, so the gate could close on the wrong document's last item. The
	 * session knows which generation each load belongs to and reports `settled`
	 * for the current one only.
	 */
	function settleIfIdle()
	{
		if (restoring && isSettled())
		{
			release();
		}
	}

	/** Whether the current document has stopped loading things. */
	function isSettled()
	{
		var scene = attached ? attached.scene : null;
		return scene ? scene.loadSession.settled : true;
	}

	function release()
	{
		if (!restoring)
		{
			return;
		}
		restoring = false;
		clearTimeout(backstopTimer);
		// Whatever the load produced is now the present, with no entry of its own:
		// it IS the entry that was restored.
		present.value = snapshot();
	}

	function apply(state)
	{
		clearTimeout(coalesceTimer);
		restoring = true;
		// `undo` rather than the default `load` (RM-003 A2). History is the only
		// thing that knows a document is being put back rather than opened, and a
		// consumer that wants to treat the two differently - a viewer that keeps
		// the camera still when you undo, say - has no other way to find out.
		model().loadSerialized(state, {reason: REASON_UNDO});
		// loadSerialized dispatches EVENT_LOADED on its way out, which runs
		// holdOff below; this covers the case where nothing is listening yet.
		holdOff();
	}

	/**
	 * @returns {boolean} whether anything was undone.
	 */
	function undo()
	{
		if (!canUndo.value || !model())
		{
			return false;
		}

		// Anything mid-gesture has to land in the stack before we move off it,
		// otherwise the first undo of a drag undoes the drag *before* it and the
		// drag itself is lost.
		clearTimeout(coalesceTimer);
		commit();

		var entries = past.value.slice();
		var previous = entries.pop();
		// canUndo already proved the stack is non-empty; this states the invariant
		// rather than asserting it away, so a future change that breaks it fails
		// closed instead of applying `undefined` as a design.
		if (previous === undefined)
		{
			return false;
		}

		if (present.value !== null)
		{
			future.value = future.value.concat([present.value]);
		}
		past.value = entries;
		present.value = previous;
		apply(previous);
		return true;
	}

	/**
	 * @returns {boolean} whether anything was redone.
	 */
	function redo()
	{
		if (!canRedo.value || !model())
		{
			return false;
		}

		var entries = future.value.slice();
		var next = entries.pop();
		// As in undo(): canRedo proved this, the checker cannot see it.
		if (next === undefined)
		{
			return false;
		}

		if (present.value !== null)
		{
			past.value = past.value.concat([present.value]);
		}
		future.value = entries;
		present.value = next;
		apply(next);
		return true;
	}

	/**
	 * Throw the stack away and start again from the current design.
	 *
	 * Called on new and open: the previous design's history is not reachable from
	 * the new one, and offering an undo that would replace the file the user just
	 * opened with the one they abandoned is worse than offering none.
	 */
	function reset()
	{
		clearTimeout(coalesceTimer);
		clearTimeout(backstopTimer);
		restoring = false;
		past.value = [];
		future.value = [];
		present.value = snapshot();
	}

	function attach(blueprint)
	{
		var floorplan = blueprint.model.floorplan;
		var scene = blueprint.model.scene;

		attached = {
			floorplan: floorplan,
			scene: scene,
			model: blueprint.model,
			onChange: function () {scheduleCommit();},
			// A load - new design, opened file, or our own undo - is the one moment
			// the stack must not treat as an edit.
			onLoaded: function () {holdOff();},
			// The session does the counting now, so there is nothing to do when a
			// load STARTS and the EVENT_ITEM_LOADING subscription is gone. A stale
			// item - one belonging to a document that has been superseded - still
			// arrives here on settling, and still must not be recorded as an edit;
			// the session is what knows the difference, and reports the current
			// document as settled whatever the stale ones do.
			onItemSettled: function ()
			{
				settleIfIdle();
				scheduleCommit();
			},
		};

		floorplan.addEventListener(EVENT_UPDATED, attached.onChange);
		scene.addEventListener(EVENT_ITEM_LOADED, attached.onItemSettled);
		scene.addEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		scene.addEventListener(EVENT_ITEM_MOVE_FINISH, attached.onChange);
		blueprint.model.addEventListener(EVENT_LOADED, attached.onLoaded);
	}

	function detach()
	{
		clearTimeout(coalesceTimer);
		clearTimeout(backstopTimer);
		if (!attached)
		{
			return;
		}
		attached.floorplan.removeEventListener(EVENT_UPDATED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_LOADED, attached.onItemSettled);
		attached.scene.removeEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_MOVE_FINISH, attached.onChange);
		attached.model.removeEventListener(EVENT_LOADED, attached.onLoaded);
		attached = null;

		past.value = [];
		future.value = [];
		present.value = null;
		restoring = false;
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

	return {canUndo, canRedo, depth, commit, undo, redo, reset};
}
