// @ts-check
import {onScopeDispose, ref, watch} from 'vue';
import {EVENT_UPDATED, EVENT_LOADED, EVENT_ITEM_LOADED, EVENT_ITEM_REMOVED, EVENT_ITEM_MOVE_FINISH} from '../../scripts/blueprint.js';

/**
 * Keep the working design in local storage, and offer it back after a reload.
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
 */

const STORAGE_KEY = 'architect3d.autosave';

/**
 * How long after the last edit to write.
 *
 * `exportSerialized` walks every item and stringifies the plan, so this is not
 * free; two seconds means a continuous drag writes once at the end of it rather
 * than sixty times during.
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
 * Read the stored draft, if there is a usable one.
 *
 * Exported and called before mount: the check has to happen before the default
 * design is loaded, because loading it is what would overwrite the draft.
 *
 * @param {number} now Milliseconds since epoch. Passed rather than read so the
 * staleness rule is testable without mocking the clock.
 * @returns {?{design: string, savedAt: number}}
 */
export function readDraft(now)
{
	try
	{
		var raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw)
		{
			return null;
		}

		var parsed = JSON.parse(raw);
		if (!parsed || typeof parsed.design !== 'string' || typeof parsed.savedAt !== 'number')
		{
			return null;
		}
		if (now - parsed.savedAt > MAX_AGE_MS)
		{
			return null;
		}
		return parsed;
	}
	catch
	{
		// A corrupt or unreadable draft is the same as no draft. It is not worth
		// reporting: the user did not ask for it and cannot act on it.
		return null;
	}
}

export function clearDraft()
{
	try
	{
		window.localStorage.removeItem(STORAGE_KEY);
	}
	catch
	{
		// Nothing to do. The next write will overwrite it anyway.
	}
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useAutosave(store)
{
	/** When the last successful write happened, or null. */
	/** @type {import('vue').Ref<?number>} */
	var savedAt = ref(null);
	/** Set once storage has refused a write, so the failure is reported once. */
	var failed = ref(false);

	var timer = null;
	var attached = null;
	var paused = false;

	function write()
	{
		var model = store.model.value;
		if (!model || paused)
		{
			return;
		}

		try
		{
			var stamp = Date.now();
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
				design: model.exportSerialized(),
				savedAt: stamp,
			}));
			savedAt.value = stamp;
			failed.value = false;
		}
		catch (error)
		{
			// Private browsing, a full quota, or a design larger than the 5 MB
			// storage limit. All three are permanent for this session, so stop
			// trying rather than throwing on every edit.
			failed.value = true;
			paused = true;
			console.warn('Autosave is off: the browser refused to store the draft.', error);
		}
	}

	function schedule()
	{
		clearTimeout(timer);
		timer = setTimeout(write, WRITE_DELAY_MS);
	}

	/** Write immediately, ignoring the delay. Used on unload. */
	function flush()
	{
		clearTimeout(timer);
		write();
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
		attached = null;
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

	return {savedAt, failed, flush, clearDraft};
}
