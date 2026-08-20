// @ts-check
import {computed, ref} from 'vue';
import {renderPlanThumbnail} from '../../scripts/blueprint.js';
import {createProjectRepository, cleanName, copyName, projectId, REASON_UNAVAILABLE}
	from '../persistence/project_repository.js';
import {useToasts} from './useToasts.js';

/**
 * Many designs, each with a name (RM-013 K1, gap Q-6).
 *
 * ## What a save means here, and what it deliberately does not
 *
 * Saving to the library is an act, not a background process. The draft next
 * door already writes every two seconds and on every tab hide, and that is what
 * protects somebody between decisions; this is the decision. RM-013 puts it
 * plainly: a named project is something a person chose to keep. So there is no
 * autosave into the library, no silent overwrite of a project somebody opened
 * to look at, and `dirty` says out loud whether the thing on screen has moved
 * since it was last kept.
 *
 * ## The thumbnail is captured, not rendered on demand
 *
 * Finding Y-3 is why, and it is not a preference. `renderPlanThumbnail` draws
 * through the live `FloorplannerView2D`, so a picture of a design that is not
 * open would mean loading it into a view first - which is the entire cost of
 * opening it, paid once per tile. Before the repair the same call would have
 * produced a picture of whatever plan the view *did* hold, framed by the one it
 * was handed, with nothing to tell anybody. So the picture is taken while the
 * design is on screen, at the moment it is kept, and stored beside it.
 *
 * ## WebP, measured
 *
 * Y-4 rendered the same 320-ish pixel tile three ways in Chromium: PNG 17,372
 * bytes, JPEG 11,624, WebP 5,958 - against a furnished three-bedroom design of
 * 8,518. So the picture is the larger half of a record unless it is WebP, and
 * `toDataURL` falls back to PNG by itself on a browser that cannot encode one,
 * which is the fallback and needs no second call.
 */

/**
 * WebP quality for a plan tile.
 *
 * 0.85 is what Y-4 measured, and a plan is line art on a flat ground - the
 * artefacts quality buys off are in gradients, which a plan does not have. Going
 * higher costs bytes for nothing anybody can see at 320 px.
 */
const THUMBNAIL_QUALITY = 0.85;

/**
 * The repository this module reads and writes through.
 *
 * Module-level and lazy, matching `useAutosave`: the composable may be created
 * more than once across a mount/unmount cycle and both instances must see the
 * same library.
 *
 * @type {?Object}
 */
var repository = null;

/** @returns {Object} */
function library()
{
	if (!repository)
	{
		repository = createProjectRepository();
	}
	return repository;
}

/**
 * Swap the store. How the suite runs this against a fake `IDBFactory`, and how
 * a browser with no IndexedDB is reached deliberately rather than by luck.
 *
 * @param {?Object} custom Pass null to go back to detection.
 */
export function setProjectRepository(custom)
{
	repository = custom;
}

/** Which store is in use: `indexeddb` or `unavailable`. */
export function projectStoreKind()
{
	return library().kind;
}

/**
 * A picture of the plan on screen, or null.
 *
 * Null for three separate reasons and all of them are ordinary: there is no
 * floorplanner mounted, the plan is empty, or the browser would not give up a
 * 2D context. A project with no picture is a project; a tile draws a placeholder
 * and everything else works.
 *
 * @param {?Object} planner A `Floorplanner2D`.
 * @returns {?string} A data URL.
 */
export function captureThumbnail(planner)
{
	if (!planner || !planner.view || typeof document === 'undefined')
	{
		return null;
	}
	try
	{
		var canvas = document.createElement('canvas');
		if (!renderPlanThumbnail(planner.view, canvas))
		{
			return null;
		}
		// A browser that cannot encode WebP returns a PNG from this call rather
		// than failing, so what comes back is the fallback already. Y-4: 5,958
		// bytes against 17,372 for the same tile, which is why it is asked for.
		var url = canvas.toDataURL('image/webp', THUMBNAIL_QUALITY);
		return (typeof url === 'string' && url.length > 32) ? url : null;
	}
	catch
	{
		// jsdom's canvas has no encoder at all. A missing picture is not a failed
		// save, and the caller has nothing useful to do about it either way.
		return null;
	}
}

/**
 * @typedef {Object} ProjectsApi
 * @property {import('vue').Ref<Array<Object>>} projects
 * @property {import('vue').Ref<?Object>} current
 * @property {import('vue').Ref<boolean>} dirty
 * @property {import('vue').Ref<boolean>} busy
 */

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {Object} io The `useDesignIO` instance, for loading and for the name
 *        the seven exports use.
 */
export function useProjects(store, io)
{
	var toasts = useToasts();
	/** Every card in the library, newest first. @type {import('vue').Ref<Array<Object>>} */
	var projects = ref([]);
	/** The card of the project on screen, or null for a design nobody has kept. */
	/** @type {import('vue').Ref<?Object>} */
	var current = ref(null);
	/** Whether the design has moved since it was last kept. */
	var dirty = ref(false);
	var busy = ref(false);
	/** Set once the store has refused, so the UI can say why once. */
	/** @type {import('vue').Ref<?string>} */
	var refusal = ref(null);
	/**
	 * Where the design on screen came from, until the first save records it.
	 *
	 * Set by `adopt` and read once, because a template is a starting point rather
	 * than a project: `current` stays null so saving creates a record instead of
	 * overwriting the studio plan for everybody who opens it next, and this is
	 * what keeps the answer to "which template did I start from" alive across
	 * that gap.
	 *
	 * @type {?string}
	 */
	var pendingOrigin = null;

	var available = computed(function () {return library().kind !== 'unavailable';});
	var name = computed(function () {return current.value ? current.value.name : null;});

	/** @param {?string} value */
	function setDocumentName(value)
	{
		io.documentName.value = value || 'design';
	}

	/**
	 * Re-read the card list.
	 *
	 * Every mutation ends here rather than patching the array in place. A library
	 * of tens of records costs one `getAll` of cards and no documents (that is
	 * what the two object stores are for), and an in-place patch is how a grid
	 * ends up disagreeing with the store it is showing.
	 *
	 * @returns {Promise<void>}
	 */
	async function refresh()
	{
		projects.value = await library().list();
	}

	/**
	 * @param {?string} reason
	 * @param {string} verb
	 */
	function refuse(reason, verb)
	{
		refusal.value = reason;
		if (reason === REASON_UNAVAILABLE)
		{
			toasts.error(`This browser is not offering storage, so ${verb} is unavailable.`,
				{detail: 'Private browsing does this. Save to a file instead.'});
			return;
		}
		toasts.error(`Could not ${verb}.`, {detail: describeRefusal(reason)});
	}

	/**
	 * Keep the design on screen, under a name.
	 *
	 * With no id it creates a record; with the current one it replaces it. The
	 * thumbnail is taken here, at the one moment the design is guaranteed to be
	 * both current and on screen.
	 *
	 * @param {Object} [options]
	 * @param {string} [options.name] A new name. Defaults to the current one.
	 * @param {boolean} [options.asCopy] Keep it as a new record rather than
	 *        replacing the one that is open.
	 * @param {?string} [options.origin] Where it came from, when the caller knows
	 *        and `adopt` was not what put it on screen.
	 * @returns {Promise<?Object>} The card, or null if it was refused.
	 */
	async function save(options)
	{
		var settings = options || {};
		var model = store.model.value;
		if (!model)
		{
			return null;
		}
		busy.value = true;
		try
		{
			var now = Date.now();
			var open = settings.asCopy ? null : current.value;
			var chosen = cleanName(settings.name || (open && open.name)
				|| (current.value && current.value.name));
			var card = {
				id: open ? open.id : projectId(now, undefined),
				name: chosen,
				createdAt: open ? open.createdAt : now,
				modifiedAt: now,
				thumbnail: captureThumbnail(store.floorplanner.value),
				bytes: 0,
				origin: open ? open.origin : (settings.origin || pendingOrigin),
			};
			var result = await library().put(card, model.exportSerialized());
			if (!result.ok)
			{
				refuse(result.reason, 'save this design');
				return null;
			}
			current.value = result.card;
			dirty.value = false;
			refusal.value = null;
			pendingOrigin = null;
			setDocumentName(result.card.name);
			await refresh();
			toasts.success(`Saved ${result.card.name}`);
			return result.card;
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Put a stored project on screen.
	 *
	 * Through `io.loadDesign` rather than `loadSerialized`, so a record this build
	 * cannot read reports which field is wrong instead of throwing - and, per
	 * RM-003 A1, leaves the design that is already open untouched when it fails.
	 *
	 * @param {string} id
	 * @returns {Promise<boolean>}
	 */
	async function open(id)
	{
		busy.value = true;
		try
		{
			var found = await library().read(id);
			if (!found)
			{
				toasts.error('That design is no longer in the library.');
				await refresh();
				return false;
			}
			if (!io.loadDesign(found.design, found.card.name))
			{
				return false;
			}
			current.value = found.card;
			dirty.value = false;
			pendingOrigin = null;
			setDocumentName(found.card.name);
			return true;
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Load a design that is not in the library - a template, a sample, a file.
	 *
	 * `current` becomes null rather than pointing at the template, because a
	 * template is a starting point and not a project: saving must create a
	 * record, not overwrite the studio plan for everybody who opens it next.
	 * `origin` is carried through the first save so the library can still say
	 * where a design came from.
	 *
	 * @param {string} design
	 * @param {Object} [options]
	 * @param {string} [options.name]
	 * @param {?string} [options.origin]
	 * @returns {boolean}
	 */
	function adopt(design, options)
	{
		var settings = options || {};
		if (!io.loadDesign(design, settings.name))
		{
			return false;
		}
		current.value = null;
		pendingOrigin = settings.origin || null;
		dirty.value = true;
		setDocumentName(settings.name || 'design');
		return true;
	}

	/**
	 * @param {string} id
	 * @param {string} value
	 * @returns {Promise<boolean>}
	 */
	async function rename(id, value)
	{
		var result = await library().rename(id, value, Date.now());
		if (!result.ok)
		{
			refuse(result.reason, 'rename this design');
			return false;
		}
		if (current.value && current.value.id === id)
		{
			current.value = result.card;
			setDocumentName(result.card.name);
		}
		await refresh();
		return true;
	}

	/**
	 * Copy a stored project, document and picture together.
	 *
	 * The copy is not opened. Duplicating from a grid is usually the first half
	 * of "try something on this one", and yanking the person out of what they
	 * were doing to show them the copy is the wrong half to guess at.
	 *
	 * @param {string} id
	 * @returns {Promise<?Object>}
	 */
	async function duplicate(id)
	{
		var found = await library().read(id);
		if (!found)
		{
			toasts.error('That design is no longer in the library.');
			await refresh();
			return null;
		}
		var now = Date.now();
		var card = Object.assign({}, found.card, {
			id: projectId(now, undefined),
			name: copyName(found.card.name, projects.value.map(function (row) {return row.name;})),
			createdAt: now,
			modifiedAt: now,
		});
		var result = await library().put(card, found.design);
		if (!result.ok)
		{
			refuse(result.reason, 'duplicate this design');
			return null;
		}
		await refresh();
		toasts.success(`Copied to ${result.card.name}`);
		return result.card;
	}

	/**
	 * @param {string} id
	 * @returns {Promise<boolean>}
	 */
	async function remove(id)
	{
		var result = await library().remove(id);
		if (!result.ok)
		{
			refuse(result.reason, 'delete this design');
			return false;
		}
		if (current.value && current.value.id === id)
		{
			// The design stays on screen. Deleting the record a person is looking at
			// should not also throw away their work - it makes it unkept, which is
			// what `current: null` and `dirty: true` say together.
			current.value = null;
			dirty.value = true;
		}
		await refresh();
		return true;
	}

	/** The design on screen has moved. Called by whatever already watches for that. */
	function touch()
	{
		dirty.value = true;
	}

	/** Start again: a blank design that belongs to nobody. */
	function detach()
	{
		current.value = null;
		pendingOrigin = null;
		dirty.value = false;
		setDocumentName('design');
	}

	return {
		projects, current, dirty, busy, refusal, available, name,
		refresh, save, open, adopt, rename, duplicate, remove, touch, detach,
		/** @returns {Promise<Object>} */
		stats: function () {return library().stats();},
		/** What `save` will record as the origin of a design nobody has kept yet. */
		pendingOrigin: function () {return pendingOrigin;},
	};
}

/**
 * @param {?string} why One of the repository's REASON_* values.
 * @returns {string}
 */
function describeRefusal(why)
{
	if (why === 'quota')
	{
		return 'There is no room left. Delete a design, or save this one to a file.';
	}
	if (why === 'version')
	{
		return 'The library was written by a newer version of this app, and has been left alone.';
	}
	return 'The browser refused.';
}
