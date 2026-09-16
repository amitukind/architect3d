// @ts-check
import {computed, ref, watch} from 'vue';
import {encodeDesign, decodeDesign, payloadFromHash, linkFor, linksAvailable,
	LINK_KEY, MAX_LINK_CHARS} from '../share/design_link.js';
import {assetResolver} from './useAssets.js';
import {useToasts} from './useToasts.js';
import {createInjection} from './injection.js';

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
 *
 * ## The bundle is imported when it is used, and the budget is why
 *
 * `design_bundle.js` and the zip container under it are reached through a
 * dynamic `import()`, which is the same move RM-011 H2 made on the ambient
 * occlusion chain and for the same measured reason: they are machinery nobody
 * touches until they click Export or open a `.zip`, and `first-load` is the
 * thinnest line in `budget.json`. The link codec above is NOT deferred - it is
 * small, and a boot that carries a link has to decode it before first paint.
 */

/**
 * The bundle module, loaded once.
 *
 * Memoised rather than imported per call, because `import()` returns the same
 * module either way and holding the promise makes that visible instead of
 * relying on it.
 *
 * @type {?Promise<*>}
 */
var bundleModule = null;

/** @returns {Promise<*>} */
function bundleCode()
{
	if (!bundleModule)
	{
		bundleModule = import('../share/design_bundle.js');
	}
	return bundleModule;
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {Object} projects The `useProjects` instance - a shared design leaves
 *        read-only by becoming a project, which is the only way out.
 * @param {Object} io The `useDesignIO` instance, for loading and for the name.
 */
export function useShare(store, projects, io, models)
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

	// `store.three` as well since RM-015 M3: a viewer attached after the share
	// link was read would otherwise be editable in a read-only session.
	watch([viewing, store.instance, store.three], apply, {immediate: true});

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

	/**
	 * A bundle of the design on screen: the document, plus every asset the
	 * recipient will not already have.
	 *
	 * "Will not have" is decided against this build's own asset manifest, which
	 * is the same list the recipient's build ships - so for a design made out of
	 * the catalog the answer is "nothing", and the bundle is the document. See
	 * `design_bundle.js`: the measurement behind that rule is that the largest
	 * sample here names 20 files and every one of them is already in the app that
	 * would open it.
	 *
	 * @returns {Promise<?{bytes: Uint8Array, manifest: Object, name: string}>}
	 */
	async function makeBundle()
	{
		var model = store.model.value;
		if (!model)
		{
			return null;
		}
		busy.value = true;
		try
		{
			var resolver = assetResolver();
			var code = await bundleCode();
			var built = await code.buildBundle(model.exportSerialized(), {
				name: io.documentName.value,
				// `manifest.has` rather than "is it in public/": a bundle is made for
				// somebody else's build, and the manifest is the only statement this
				// one has about what a build contains.
				has: function (url) {return resolver.manifest.has(url);},
				fetchAsset: async function (url)
				{
					try
					{
						// The store before the network (RM-012 J3). An imported model
						// has no URL to fetch - that is the whole of what X-7 found J3
						// short of - so a bundle carrying one reads it out of the same
						// store the viewer loads it from. Nothing above this line knows
						// imports exist: `has()` is the recipient's manifest, and a
						// model in nobody's manifest was already routed here.
						if (models)
						{
							var own = await models.read(url);
							if (own)
							{
								return new Uint8Array(own);
							}
						}
						var at = resolver.resolve(url);
						var response = await fetch(at.url || url);
						if (!response || !response.ok)
						{
							return null;
						}
						return new Uint8Array(await response.arrayBuffer());
					}
					catch
					{
						return null;
					}
				},
			});
			return {bytes: built.bytes, manifest: built.manifest, name: io.documentName.value};
		}
		finally
		{
			busy.value = false;
		}
	}

	/**
	 * Open a `.zip` bundle somebody sent.
	 *
	 * The design lands; the carried assets are named rather than loaded, because
	 * there is nowhere to put them until J3 builds one (RM-012 X-7). Saying so is
	 * the point - a design quietly missing three models looks like a bug in the
	 * application rather than a feature that has not shipped.
	 *
	 * @param {Uint8Array<ArrayBuffer>} bytes
	 * @returns {Promise<boolean>}
	 */
	async function openBundle(bytes)
	{
		var code = await bundleCode();
		var read = await code.readBundle(bytes);
		if (!read.ok)
		{
			toasts.error('That bundle could not be opened.', {detail: read.reason});
			return false;
		}
		// Adopted BEFORE the design loads, and the order is the feature. `Scene`
		// asks the store whether a name is an import at the moment it places the
		// item, so a bundle that loaded first and stored second would report every
		// model it had just brought as missing (RM-012 J3).
		var taken = await adoptCarried(read);
		if (!io.loadDesign(read.design, 'that bundle'))
		{
			return false;
		}
		projects.detach();
		io.documentName.value = (read.manifest && read.manifest.name) || 'design';
		if (taken.stored)
		{
			toasts.success(taken.stored === 1
				? '1 model came with that bundle and is now stored here.'
				: `${taken.stored} models came with that bundle and are now stored here.`);
		}
		if (taken.rejected.length)
		{
			// A carried file whose bytes do not hash to the id the design names.
			// Content addressing is what makes this checkable at all, and refusing
			// by name is the only honest thing to do with it: the alternative is
			// storing bytes under a name that is a lie about them.
			toasts.error(`${taken.rejected.length} file(s) in that bundle did not match the design.`,
				{detail: taken.rejected.join(', ')});
		}
		return true;
	}

	/**
	 * Store what a bundle brought, checking it is what the design asked for.
	 *
	 * @param {Object} read A `readBundle` result.
	 * @returns {Promise<{stored: number, rejected: Array<string>}>}
	 */
	async function adoptCarried(read)
	{
		var stored = 0;
		/** @type {Array<string>} */
		var rejected = [];
		if (!models || !read.assets || !read.assets.size)
		{
			return {stored: stored, rejected: rejected};
		}
		var wanted = models.audit(read.design).wanted;
		for (var i = 0; i < wanted.length; i++)
		{
			var ref = wanted[i];
			var carried = read.assets.get(ref.url);
			if (!carried)
			{
				continue;
			}
			var bytes = carried.buffer.slice(carried.byteOffset, carried.byteOffset + carried.byteLength);
			if (await models.adopt(ref, bytes))
			{
				stored += 1;
			}
			else
			{
				rejected.push(ref.file);
			}
		}
		return {stored: stored, rejected: rejected};
	}

	return {
		viewing, link, chars, refusal, busy, available,
		makeLink, copyLink, openFromHash, adopt, leave, makeBundle, openBundle,
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

/**
 * `useShare` as an injection (RM-020 S-5). See `injection.js` for the pattern and
 * why twelve of the twenty-two composables use it.
 */
const injection = createInjection('Share');

/** The key, for a component mounted outside the shell - a test, or another host. */
export const SHARE_KEY = injection.key;

/**
 * Build it and make it available to every descendant.
 * @returns {ReturnType<typeof useShare>}
 */
export function provideShare(store, projects, io, models)
{
	return injection.put(useShare(store, projects, io, models));
}

/**
 * Take it from an ancestor that called `provideShare`.
 * @returns {ReturnType<typeof useShare>}
 */
export function injectShare()
{
	return injection.take();
}
