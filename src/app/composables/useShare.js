// @ts-check
import {computed, ref, watch} from 'vue';
import {encodeDesign, decodeDesign, payloadFromHash, linkFor, linksAvailable,
	LINK_KEY, MAX_LINK_CHARS} from '../share/design_link.js';
import {useToasts} from './useToasts.js';

/**
 * Send a design to somebody, and receive one (RM-013 K2).
 *
 * ## Two states, and only one of them is new
 *
 * *Sharing* is a button: encode what is on screen, hand back a link. *Viewing*
 * is a state the application boots into when the fragment carries one, and it
 * is the half with consequences - a design that arrived in a link belongs to
 * whoever sent it, so nothing here may quietly become an edit of it.
 *
 * The plan and the 3D view are put into read-only through the library rather
 * than by hiding controls. K2's measurement is the reason: the plan had **no
 * non-editing state at all** - six modes and every one of them mutates, MOVE
 * included, because MOVE is what drags corners and furniture - while the 3D
 * half has had `Controller.enabled` since the fork. Hiding a tool rail would
 * have left the pointer editing underneath it, and the keyboard map, and an
 * embedder. `Floorplanner2D.setReadOnly` and `Main.setReadOnly` are the gate;
 * the shell hiding its chrome is the manners.
 *
 * ## Leaving is a copy, never a switch
 *
 * There is no "start editing" that turns a shared design into yours in place.
 * `adopt()` puts it in the library as a new project and clears the fragment,
 * which makes the two designs two things - and means a person who opens a link,
 * changes their mind and reloads gets the design they were sent rather than
 * whatever they had started doing to it.
 */

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {Object} projects The `useProjects` instance - a shared design leaves
 *        read-only by becoming a project, which is the only way out.
 * @param {Object} io The `useDesignIO` instance, for loading and for the name.
 */
export function useShare(store, projects, io)
{
	var toasts = useToasts();
	/** Whether this session is looking at somebody else's design. */
	var viewing = ref(false);
	/** The last link made, so the dialog can show it without re-encoding. */
	/** @type {import('vue').Ref<?string>} */
	var link = ref(null);
	/** How many characters that link is, or would have been. */
	var chars = ref(0);
	/** @type {import('vue').Ref<?string>} */
	var refusal = ref(null);
	var busy = ref(false);

	var available = computed(function () {return linksAvailable();});

	/**
	 * Push read-only down into both views.
	 *
	 * Watched rather than called at the point of decision, because the viewer is
	 * rebuilt on a level change and on a remount, and a flag that was applied
	 * once would come back off underneath somebody.
	 */
	function apply()
	{
		var planner = store.floorplanner.value;
		var three = store.three.value;
		if (planner && typeof planner.setReadOnly === 'function')
		{
			planner.setReadOnly(viewing.value);
		}
		if (three && typeof three.setReadOnly === 'function')
		{
			three.setReadOnly(viewing.value);
		}
	}

	watch([viewing, store.instance], apply, {immediate: true});

	/**
	 * A link to the design on screen.
	 *
	 * @returns {Promise<?string>}
	 */
	async function makeLink()
	{
		var model = store.model.value;
		if (!model)
		{
			return null;
		}
		busy.value = true;
		try
		{
			var result = await encodeDesign(model.exportSerialized());
			chars.value = result.chars;
			refusal.value = result.reason;
			link.value = (result.ok && result.payload) ? linkFor(result.payload) : null;
			return link.value;
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Put the link on the clipboard, if the browser will take it.
	 *
	 * A refusal is not an error worth a red toast: a browser can decline the
	 * clipboard for reasons that have nothing to do with this application - no
	 * permission, no secure context, no user gesture it recognised - and the link
	 * is on screen in a field either way. So the dialog stays open and says
	 * "copy it yourself", which is what a person was about to do anyway.
	 *
	 * @returns {Promise<boolean>}
	 */
	async function copyLink()
	{
		var text = link.value || await makeLink();
		if (!text)
		{
			return false;
		}
		try
		{
			await navigator.clipboard.writeText(text);
			toasts.success('Link copied.');
			return true;
		}
		catch
		{
			return false;
		}
	}

	/**
	 * Open a design that arrived in the URL.
	 *
	 * Returns whether one was there, so the boot can decide what else to do -
	 * offering a recovered draft on top of a design somebody was sent is two
	 * documents competing for one screen.
	 *
	 * @param {string} [hash] Defaults to the document's.
	 * @returns {Promise<boolean>}
	 */
	async function openFromHash(hash)
	{
		var payload = payloadFromHash(hash !== undefined
			? hash
			: (typeof window !== 'undefined' ? window.location.hash : ''));
		if (!payload)
		{
			return false;
		}
		var result = await decodeDesign(payload);
		if (!result.ok)
		{
			toasts.error('That shared link could not be opened.', {detail: describeLinkFailure(result.reason)});
			return false;
		}
		if (!io.loadDesign(result.design, 'the shared design'))
		{
			return false;
		}
		// Not a project, and not the person's own work. `current` stays null so
		// nothing can overwrite anything, and the name is generic on purpose -
		// a link carries a design, not a title, and inventing one would put words
		// in the sender's mouth.
		projects.detach();
		io.documentName.value = 'shared design';
		viewing.value = true;
		apply();
		return true;
	}

	/**
	 * Keep a shared design as your own, and stop viewing.
	 *
	 * @param {string} [name]
	 * @returns {Promise<boolean>}
	 */
	async function adopt(name)
	{
		var card = await projects.save({name: name || 'Shared design', origin: 'shared-link'});
		if (!card)
		{
			return false;
		}
		leave();
		toasts.success(`Copied to ${card.name}. It is yours now.`);
		return true;
	}

	/**
	 * Stop viewing, and take the design out of the URL.
	 *
	 * The fragment is cleared only here. While somebody is viewing it stays put,
	 * so a reload re-opens what they were sent and the link is still in the
	 * address bar to copy - and the moment they make it theirs it goes, because
	 * a URL that would restore the sender's version over their own edits is a
	 * trap with a keyboard shortcut.
	 */
	function leave()
	{
		viewing.value = false;
		apply();
		if (typeof window !== 'undefined' && window.history && window.location.hash)
		{
			window.history.replaceState(null, '', window.location.pathname + window.location.search);
		}
	}

	return {
		viewing, link, chars, refusal, busy, available,
		makeLink, copyLink, openFromHash, adopt, leave,
		/** The fragment key and the ceiling, for anything that renders a message. */
		LINK_KEY, MAX_LINK_CHARS,
	};
}

/**
 * @param {?string} why
 * @returns {string}
 */
function describeLinkFailure(why)
{
	if (why === 'version')
	{
		return 'It was made by a newer version of this app.';
	}
	if (why === 'unsupported')
	{
		return 'This browser cannot read compressed links.';
	}
	return 'The link looks incomplete - it may have been broken across two lines.';
}
