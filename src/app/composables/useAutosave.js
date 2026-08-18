// @ts-check
import {onScopeDispose, ref, watch} from 'vue';
import {EVENT_UPDATED, EVENT_LOADED, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_MOVE_FINISH} from '../../scripts/blueprint.js';
import {createDraftRepository, REASON_QUOTA, REASON_UNAVAILABLE, REASON_VERSION} from '../persistence/draft_repository.js';
import {writePointer, readPointer, clearPointer, compareRecovery, RECOVERY_LOST_TAIL} from '../persistence/recovery_pointer.js';

/**
 * Keep the working design in browser storage, and offer it back after a reload.
 *
 * The app has no server and no document model: a design exists only in memory
 * until someone presses Save, and closing the tab loses it. That is a
 * reasonable contract for a demo and a poor one for a tool - an accidental
 * reload after twenty minutes of drawing loses twenty minutes of drawing.
 *
 * ## Deliberately not a "recent files" list
 *
 * One slot, overwritten. A list implies a document model - names, deletion,
 * disambiguating two designs that are both "Untitled" - and the file system
 * already provides all of that through Save and Open. This exists to survive a
 * crash, not to replace saving, and the recovery prompt says so by being an
 * offer rather than an automatic restore.
 *
 * ## Why the offer is not automatic
 *
 * Silently restoring means someone who deliberately closed a design to start
 * fresh gets it back, which is worse than losing it: they may not notice, and
 * will save over a file they meant to abandon. So the draft is *held*, a toast
 * offers it, and the default design is what actually loads.
 *
 * ## Where it is stored, since RM-003 A5
 *
 * Not here. `../persistence/draft_repository.js` owns that, and picks
 * IndexedDB when the browser has it. What that changes for this file:
 *
 * - **The write is no longer synchronous.** It used to block the main thread
 *   for as long as `JSON.stringify` plus a `localStorage.setItem` on the whole
 *   design took, on a two-second debounce during editing. Metric M-9.
 * - **The 5 MiB cliff is gone.** The old error path was not defensive
 *   padding - it was load-bearing, and the comment on it named the size limit
 *   as one of the three things that would trip it. A furnished design could
 *   exceed the cap, and the first refusal disabled autosave for the session.
 *   IndexedDB's quota is a share of disk.
 * - **`pagehide` cannot await**, which is risk K-6 and the reason
 *   `recovery_pointer.js` exists. The pointer is written synchronously before
 *   the body write is started, so the next session can tell whether the last
 *   write landed instead of assuming it did.
 *
 * The refusal path is kept as it was - one refusal stops the writing and says
 * so - because the failure modes it covers (private browsing, a disabled
 * store) are still permanent for the session. What changed is that the message
 * can now say which one it was.
 */

/**
 * How long after the last edit to write.
 *
 * `exportSerialized` walks every item and stringifies the plan, so this is not
 * free; two seconds means a continuous drag writes once at the end of it rather
 * than sixty times during. The store beneath it is asynchronous now, but the
 * serialisation is not, so the debounce is still doing the work it was added
 * for.
 */
const WRITE_DELAY_MS = 2000;

/**
 * Drafts older than this are not offered.
 *
 * A week-old draft is not a crash recovery, it is a surprise. Anyone who wanted
 * it had seven days and a Save button.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The repository this module reads and writes through.
 *
 * Module-level and lazy, because `readDraft` is called before anything is
 * mounted - the check has to happen before the default design loads, since
 * loading it is what would overwrite the draft - and the composable needs the
 * same instance so the two agree about which store is in use.
 *
 * @type {?import('../persistence/draft_repository.js').DraftRepository}
 */
var repository = null;

/**
 * @returns {import('../persistence/draft_repository.js').DraftRepository}
 */
function store()
{
	if (!repository)
	{
		repository = createDraftRepository();
	}
	return repository;
}

/**
 * Swap the store. The rollback switch for A5's persistence half, and how the
 * suite runs both implementations against the same assertions.
 *
 * @param {?import('../persistence/draft_repository.js').DraftRepository} custom
 *        Pass null to go back to detection.
 */
export function setDraftRepository(custom)
{
	repository = custom;
}

/** Which store is in use: `localStorage`, `indexeddb`, or a refusal. */
export function draftStoreKind()
{
	return store().kind;
}

/**
 * Read the stored draft, if there is a usable one.
 *
 * Asynchronous since A5, because IndexedDB is. The caller was already doing
 * this after first paint - see `App.vue`'s `offerDraft` - so nothing waits on
 * it that was not already waiting.
 *
 * @param {number} now Milliseconds since epoch. Passed rather than read so the
 * staleness rule is testable without mocking the clock.
 * @returns {Promise<?{design: string, savedAt: number, recovery: string, lostMs: number}>}
 *          `recovery` says whether the last write landed - see
 *          `recovery_pointer.js`. A caller that ignores it gets exactly the
 *          old two fields.
 */
export async function readDraft(now)
{
	var pointer = readPointer();
	var draft;

	try
	{
		draft = await store().read();
	}
	catch
	{
		// A corrupt or unreadable draft is the same as no draft. It is not worth
		// reporting: the user did not ask for it and cannot act on it. The
		// repository already swallows this; the guard is for a custom one that
		// does not.
		draft = null;
	}

	if (!draft)
	{
		return null;
	}
	if (now - draft.savedAt > MAX_AGE_MS)
	{
		return null;
	}

	var comparison = compareRecovery(pointer, draft);
	return {
		design: draft.design,
		savedAt: draft.savedAt,
		recovery: comparison.state,
		lostMs: comparison.lostMs,
	};
}

/**
 * Forget the draft and the pointer together.
 *
 * Both, always: a pointer left behind after the body has gone reads as
 * {@link RECOVERY_MISSING} on the next load, which would report data loss where
 * there was a deliberate discard.
 *
 * @returns {Promise<void>}
 */
export async function clearDraft()
{
	clearPointer();
	await store().clear();
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store_
 */
export function useAutosave(store_)
{
	/** When the last successful write happened, or null. */
	/** @type {import('vue').Ref<?number>} */
	var savedAt = ref(null);
	/** Set once storage has refused a write, so the failure is reported once. */
	var failed = ref(false);
	/** Which refusal it was - one of the repository's REASON_* values. */
	/** @type {import('vue').Ref<?string>} */
	var reason = ref(null);

	var timer = null;
	var attached = null;
	var paused = false;
	/**
	 * Whether a write is in the store right now.
	 *
	 * An asynchronous write plus a debounce that can fire again while it is
	 * running is two writes racing for one slot, and the loser is not
	 * necessarily the older one. Serialising them is enough here: `pending`
	 * remembers that another edit arrived, and one more write happens when this
	 * one is done.
	 */
	var inFlight = false;
	var pending = false;

	/**
	 * @param {boolean} [sync] Whether this is the last chance - `pagehide` or a
	 *        tab going to the background. Writes the recovery pointer first.
	 * @returns {Promise<void>}
	 */
	async function write(sync)
	{
		var model = store_.model.value;
		if (!model || paused)
		{
			return;
		}
		if (inFlight)
		{
			pending = true;
			return;
		}

		inFlight = true;
		try
		{
			var stamp = Date.now();
			var design = model.exportSerialized();

			if (sync)
			{
				// Before the body, not after. The pointer records the write that is
				// about to be attempted, so a body that never arrives leaves a
				// pointer newer than it - which is the only way the next session can
				// tell. See recovery_pointer.js.
				writePointer({savedAt: stamp, bytes: design.length, store: store().kind});
			}

			var result = await store().put(design, stamp);
			if (result.ok)
			{
				savedAt.value = stamp;
				failed.value = false;
				reason.value = null;
				if (!sync)
				{
					// A completed background write makes the pointer redundant, and a
					// stale pointer is worse than none: it would report a lost tail
					// against a draft that is perfectly current.
					clearPointer();
				}
				return;
			}

			failed.value = true;
			reason.value = result.reason;
			paused = true;
			console.warn(`Autosave is off: ${describeRefusal(result.reason)}`);
		}
		catch (error)
		{
			// The repository contract says put() does not throw. A custom one might.
			failed.value = true;
			reason.value = 'error';
			paused = true;
			console.warn('Autosave is off: the browser refused to store the draft.', error);
		}
		finally
		{
			inFlight = false;
			if (pending)
			{
				pending = false;
				schedule();
			}
		}
	}

	function schedule()
	{
		clearTimeout(timer);
		timer = setTimeout(function () {write(false);}, WRITE_DELAY_MS);
	}

	/**
	 * Write immediately, ignoring the delay, and leave a pointer saying so.
	 *
	 * Used on unload and when the tab is backgrounded. Returns the promise so a
	 * caller that CAN wait - a test, or a deliberate "save now" - does not have
	 * to guess. `pagehide` cannot, which is the whole of K-6.
	 *
	 * @returns {Promise<void>}
	 */
	function flush()
	{
		clearTimeout(timer);
		// Not `inFlight`-gated the way a scheduled write is: this is the last
		// chance, so a write already running is allowed to be followed by this
		// one. `pending` handles the ordering.
		return write(true);
	}

	function attach(blueprint)
	{
		attached = {
			floorplan: blueprint.model.floorplan,
			scene: blueprint.model.scene,
			model: blueprint.model,
			onChange: schedule,
			// A page being closed gets no debounce.
			onUnload: flush,
			/**
			 * A tab going to the background gets the same treatment, and this is
			 * the handler that usually saves the work.
			 *
			 * `visibilitychange` fires while the page is still fully alive, so an
			 * IndexedDB transaction started here has time to complete - which
			 * `pagehide` cannot promise. On mobile it is often the ONLY signal:
			 * a backgrounded tab that is later discarded may never fire `pagehide`
			 * at all, and that is the case autosave exists for.
			 */
			onHide: function ()
			{
				if (document.visibilityState === 'hidden')
				{
					flush();
				}
			},
		};

		attached.floorplan.addEventListener(EVENT_UPDATED, attached.onChange);
		attached.scene.addEventListener(EVENT_ITEM_LOADED, attached.onChange);
		attached.scene.addEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		attached.scene.addEventListener(EVENT_ITEM_MOVE_FINISH, attached.onChange);
		attached.model.addEventListener(EVENT_LOADED, attached.onChange);

		// `pagehide` rather than `beforeunload`: the latter is unreliable on
		// mobile Safari, where a backgrounded tab can be discarded without ever
		// firing it, and it is the case autosave exists for.
		window.addEventListener('pagehide', attached.onUnload);
		document.addEventListener('visibilitychange', attached.onHide);
	}

	function detach()
	{
		clearTimeout(timer);
		if (!attached)
		{
			return;
		}
		attached.floorplan.removeEventListener(EVENT_UPDATED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_LOADED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_REMOVED, attached.onChange);
		attached.scene.removeEventListener(EVENT_ITEM_MOVE_FINISH, attached.onChange);
		attached.model.removeEventListener(EVENT_LOADED, attached.onChange);
		window.removeEventListener('pagehide', attached.onUnload);
		document.removeEventListener('visibilitychange', attached.onHide);
		attached = null;
	}

	watch(store_.instance, function (blueprint)
	{
		detach();
		if (blueprint)
		{
			attach(blueprint);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	return {
		savedAt,
		failed,
		reason,
		flush,
		clearDraft,
		/** What the store is doing. @returns {Promise<import('../persistence/draft_repository.js').RepositoryStats>} */
		stats: function () {return store().stats();},
	};
}

/**
 * @param {?string} why One of the repository's REASON_* values.
 * @returns {string}
 */
function describeRefusal(why)
{
	if (why === REASON_QUOTA)
	{
		return 'there is no room left to store the draft.';
	}
	if (why === REASON_UNAVAILABLE)
	{
		return 'this browser is not offering storage. Private browsing does this.';
	}
	if (why === REASON_VERSION)
	{
		return 'the stored draft was written by a newer version of this app, and has been left alone.';
	}
	return 'the browser refused to store the draft.';
}

export {RECOVERY_LOST_TAIL};
