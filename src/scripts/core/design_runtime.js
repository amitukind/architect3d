// @ts-check
import {defaultConfiguration} from './configuration.js';
import {Dimensioning, defaultDimensioning} from './dimensioning.js';
import {ResourceRegistry} from './resource_registry.js';
import {LoadSession} from './load_session.js';
import {defaultAssetResolver} from './asset_resolver.js';
import {renderProfile} from './render_profile.js';
import {Utils} from './utils.js';

/**
 * Referenced only in annotations, so it is a typedef rather than an import -
 * importing the class for its type alone leaves an unused binding in the
 * bundle and a lint error in the source.
 *
 * @typedef {import('./configuration.js').Configuration} Configuration
 * @typedef {import('./asset_resolver.js').AssetResolver} AssetResolver
 */

/**
 * One document's services, with an identity (RM-003 A4).
 *
 * ## What this is for
 *
 * P7 made five module-level singletons per-instance, one at a time: the
 * configuration, the dimensioning bound to it, the render profile, the
 * floorplanner palette and the unloadable-item count. Each stage shipped alone
 * and each was right. What none of them could deliver is a **single thing to
 * dispose**, because there was nothing to hang a document's registry or its
 * load session on - and `Main.dispose()` carried a comment saying so.
 *
 * That is what this is. It is the collection step, and it is short precisely
 * because P7 did the hard part: every service below already existed, already
 * worked per-instance, and already had a module-level default.
 *
 * ## A container, not a god object
 *
 * It holds services and an id. It holds **no design data** - no corners, no
 * walls, no items, no scene. A `Floorplan` is not reachable from here, and that
 * is deliberate: the moment a runtime knows what is in the document, "which
 * runtime am I on" stops being a cheap question and every model class starts
 * wanting one.
 *
 * The direction of travel is the same as `Configuration`'s. Nothing is asked to
 * take a runtime; things that already reach their configuration through a
 * `Floorplan` now reach a runtime by the same hop.
 *
 * ## The default runtime IS the module defaults, by identity
 *
 * `defaultRuntime.configuration === defaultConfiguration`,
 * `defaultRuntime.dimensioning === defaultDimensioning`, and
 * `defaultRuntime.renderProfile === renderProfile` - the live shared object,
 * not a copy of it. This is not a nicety; it is the whole compatibility story:
 *
 * - `Configuration.getNumericValue(scale)` and the 224 `Dimensioning.` statics
 *   read the default runtime's services without knowing this file exists.
 * - `config` and `wallInformation` are exported by identity and mutated
 *   directly by the test harness and by embedders. Still the same objects.
 * - `setRenderProfile(RENDER_STUDIO)` with no profile argument writes the
 *   shared profile, which is what the application calls at boot and what every
 *   viewer on the default runtime therefore draws with.
 *
 * A runtime constructed with no options shares all three for the same reason: a
 * caller asking for an isolated *lifetime* has not asked for isolated
 * *settings*. Pass a `Configuration` or a `renderProfile` to get those.
 *
 * ## What is deliberately NOT here
 *
 * **The texture cache.** `acquireTexture` refcounts one decode per URL across
 * every viewer on the page, and A0's finding was precisely that treating that
 * shared cache as one viewer's property is what made disposing A re-decode
 * every image B was using. Hanging a per-runtime handle count off this object
 * would re-describe a shared resource as an owned one - the exact mistake, in a
 * new place. `textureCacheStats()` is page-wide and says so.
 *
 * A5 did not change that, and the two are not in tension: `assets` decides
 * *which URL* is fetched, which is a per-document question, and the cache
 * decides *how many times* the image behind it is decoded, which is a per-page
 * one.
 *
 * ## What A5 added
 *
 * `assets`, an {@link AssetResolver}. A4's note here said a resolver would be
 * "constructed here alongside the rest, and no call site above this line will
 * need to change to find it". That held: A5 added one property, and `Scene`,
 * `Edge` and `Floor` reached it through the runtime they already had.
 */
export class DesignRuntime
{
	/**
	 * @param {Object} [options]
	 * @param {Configuration} [options.configuration] Settings for this document
	 *        alone. Omit to share the page-wide default.
	 * @param {Object} [options.renderProfile] A look for this document alone,
	 *        from `createRenderProfile`. Omit to share the page-wide default.
	 * @param {AssetResolver} [options.assets] Where this document's asset URLs
	 *        come from (A5). Omit for the identity resolver, which returns every
	 *        logical name unchanged.
	 * @param {string} [options.id] An id of the embedder's choosing. Omit for a
	 *        generated one.
	 */
	constructor(options)
	{
		var settings = options || {};

		/**
		 * Which document this is. Generated, not persisted, and not written to a
		 * save file - a document's identity outside this page is its file, and a
		 * runtime is torn down and rebuilt every time one is opened.
		 * @type {string}
		 */
		this.id = settings.id || Utils.guide();

		/**
		 * Where this document reads units, scale, wall defaults and snapping from.
		 * @type {Configuration}
		 */
		this.configuration = settings.configuration || defaultConfiguration;

		/**
		 * Unit and scale conversion bound to the configuration above.
		 *
		 * The identity check is what keeps `defaultRuntime.dimensioning` the very
		 * object the `Dimensioning` statics forward to. A fresh
		 * `new Dimensioning(defaultConfiguration)` would *behave* identically -
		 * it holds no state of its own - but then there would be two answers to
		 * "which Dimensioning measures the page", and a test that asserts one is
		 * the other is worth more than the allocation it saves.
		 *
		 * @type {Dimensioning}
		 */
		this.dimensioning = (this.configuration === defaultConfiguration)
			? defaultDimensioning
			: new Dimensioning(this.configuration);

		/**
		 * How this document's 3D view is shaded. The shared profile unless one was
		 * asked for, which is what every `Main` did before A4.
		 * @type {Object}
		 */
		this.renderProfile = settings.renderProfile || renderProfile;

		/**
		 * Logical asset name to physical URL (RM-003 A5).
		 *
		 * The shared identity resolver unless one was asked for, which resolves
		 * every name to itself and is what the library did before A5. An
		 * application that has fetched a manifest passes one with it - see
		 * asset_resolver.js for what that buys.
		 *
		 * @type {AssetResolver}
		 */
		this.assets = settings.assets || defaultAssetResolver;

		/**
		 * GPU resources belonging to the document itself rather than to a view
		 * that rebuilds. Empty in most designs; it is the place for a resource
		 * with no other owner, so that "nothing owns this" stops being an option.
		 * @type {ResourceRegistry}
		 */
		this.resources = new ResourceRegistry();

		/**
		 * Which load is current, and what it is waiting on (A1).
		 *
		 * Held here rather than on `Scene` since A4, because a session is a
		 * property of the document and disposing the document has to be able to
		 * invalidate it. `Scene.loadSession` is this same object.
		 *
		 * @type {LoadSession}
		 */
		this.loadSession = new LoadSession();

		/**
		 * Registries handed out by {@link DesignRuntime#registry}.
		 *
		 * Tracking them is what lets this object answer "how much is this document
		 * holding" and "release all of it", neither of which is answerable from a
		 * pile of private registries. It is a strong Set on purpose: a registry
		 * whose owner has been dropped without releasing is exactly what must not
		 * be collected quietly, because its GPU resources are not collectable at
		 * all.
		 *
		 * @type {Set<ResourceRegistry>}
		 */
		this._registries = new Set();

		this._disposed = false;
	}

	/**
	 * A registry belonging to this document, for an owner with its own release
	 * point.
	 *
	 * `Edge` calls `releaseAll()` on every rebuild, so it needs a registry of its
	 * own rather than a share of one; what it gains by asking here is that the
	 * document knows the registry exists. Call {@link DesignRuntime#forget} when
	 * the owner is finished for good, or the empty registry stays tracked.
	 *
	 * @returns {ResourceRegistry}
	 */
	registry()
	{
		var created = new ResourceRegistry();
		this._registries.add(created);
		return created;
	}

	/**
	 * Stop tracking a registry. Does not release it - the owner calling this has
	 * just released it itself.
	 *
	 * @param {?ResourceRegistry} registry
	 */
	forget(registry)
	{
		if (registry)
		{
			this._registries.delete(registry);
		}
	}

	/**
	 * Give this document's resources back and abandon whatever it was loading.
	 *
	 * Safe to call twice, and safe to call on a runtime still in use - it
	 * releases what is there rather than latching shut, so a runtime that is
	 * disposed, reloaded and disposed again cleans up both times. `stats().disposed`
	 * is how a caller finds out it happened.
	 *
	 * ## What "abandon" means here
	 *
	 * `loadSession.begin()`, which is A1's vocabulary for it: every load in
	 * flight becomes a load nobody wants, its callback is discarded when it
	 * arrives, and `stats().session.aborted` counts it. That is the half that
	 * works whatever the loader is.
	 *
	 * The other half - `LoadingManager.abort()`, which saves the bandwidth - is
	 * NOT called from here, and deliberately. The manager belongs to the loaders
	 * and the loaders belong to `Scene`; reaching it would mean the runtime
	 * holding a callback per `Scene` constructed against it, and on the page-wide
	 * default that is an unbounded list holding every `Scene` the process has
	 * ever built. `BlueprintJS.dispose()` calls `abortPendingLoads()` itself.
	 *
	 * NOT called by `Main.dispose()`, nor by `BlueprintJS.dispose()` when the
	 * runtime came from outside: an embedder who passes one in owns it, and may
	 * be about to hand it to a second viewer. `BlueprintJS` disposes only a
	 * runtime it built for itself.
	 */
	dispose()
	{
		this._disposed = true;

		this.loadSession.begin();

		this._registries.forEach(function (registry) {registry.releaseAll();});
		this._registries.clear();
		this.resources.releaseAll();
	}

	/**
	 * What this document is holding.
	 *
	 * `resources` and `handles` sum this runtime's own registry and every one it
	 * handed out, so they are the document-wide totals. Two things are NOT in
	 * them and both are deliberate: images from the shared texture cache, which
	 * belong to the page (see the class comment), and the geometries a `Floor`
	 * or a `Room` disposes directly through `disposeObject` - A0 chose that for
	 * owners that build and drop within one method, and a registry there would
	 * be ceremony around a single pairing.
	 *
	 * @returns {{id: string, disposed: boolean, registries: number, resources: number, handles: number, session: import('./load_session.js').LoadSessionStats, assets: import('./asset_resolver.js').ResolverStats}}
	 */
	stats()
	{
		var own = this.resources.stats();
		var resources = own.resources;
		var handles = own.handles;
		var registries = 0;

		this._registries.forEach(function (registry)
		{
			var counted = registry.stats();
			resources += counted.resources;
			handles += counted.handles;
			registries += 1;
		});

		return {
			id: this.id,
			disposed: this._disposed,
			registries: registries,
			resources: resources,
			handles: handles,
			session: this.loadSession.stats(),
			assets: this.assets.stats(),
		};
	}
}

/**
 * Where the module-level services are collected, and what `runtimeOf` answers
 * for something that has no runtime at all.
 *
 * ## It is the default *services*, not a shared *lifetime*
 *
 * This distinction is the whole of A4 and it is easy to get backwards. A
 * `Floorplan` or a `Model` built with no argument does **not** get this object -
 * it gets a runtime of its own whose configuration, dimensioning and render
 * profile *are* the module defaults. Settings are shared, because that is what
 * a page with one design wants and what P7 promised. Lifetime is not, because a
 * lifetime shared between two documents is the finding.
 *
 * Getting that wrong is not theoretical: the first version of A4 returned this
 * object from `resolveRuntime(null)`, so every viewer with no configuration of
 * its own shared one `LoadSession` - and `Model.loadDocument` calls
 * `loadSession.begin()`, which means opening a design in one viewer would
 * abandon the furniture still arriving in the other. The suite caught it as an
 * abort count that had stopped resetting between documents.
 *
 * What actually falls back here is what has no document to belong to: a
 * `Corner` built by hand in a test, an `Edge` constructed from a detached half
 * edge, an object literal from before any of this existed.
 */
export const defaultRuntime = new DesignRuntime();

/**
 * The runtime an object belongs to: its own, or the shared default.
 *
 * The generalisation of `configurationOf`, and it keeps that function's
 * fallback for the same reason - a `Corner` built by hand in a test has no
 * floorplan, and a `Floorplan` from an embedder's own subclass may have no
 * runtime. Falling back is what makes those keep behaving exactly as they did.
 *
 * ## Why the two cannot disagree
 *
 * `configurationOf(owner)` reads `owner.configuration`; this reads
 * `owner.runtime`. They would be two mechanisms if both were storage - so
 * neither is. Every class the library gives a runtime to exposes
 * `configuration` as a **getter over `runtime.configuration`**, which means
 * there is one place the answer is kept and `configurationOf(x)` is
 * `runtimeOf(x).configuration` by construction rather than by agreement.
 *
 * The one shape where they differ is an object literal carrying a bare
 * `configuration` and no runtime, which is the pre-A4 shape. The default
 * runtime is the right answer for it: something that has never heard of
 * runtimes belongs to the page's.
 *
 * @param {?Object} owner Anything that may carry a `.runtime`.
 * @returns {DesignRuntime}
 */
export function runtimeOf(owner)
{
	return (owner && owner.runtime) || defaultRuntime;
}

/**
 * Turn a constructor argument into the runtime it means.
 *
 * `Floorplan`, `Model` and `BlueprintJS` all took a `Configuration` before A4
 * and take either now, so each of them resolves through here. It is idempotent,
 * which is what lets `BlueprintJS` resolve once and pass the result down
 * without every layer making one of its own.
 *
 * Nothing resolves to {@link defaultRuntime}: a document gets a runtime of its
 * own, sharing the module-default services when it asked for nothing else. See
 * that constant for why the difference matters.
 *
 * @param {?(Configuration|DesignRuntime)} value A runtime, a bare
 *        `Configuration` (P7's form), or nothing.
 * @returns {DesignRuntime}
 */
export function resolveRuntime(value)
{
	if (value instanceof DesignRuntime)
	{
		return value;
	}
	if (!value)
	{
		return new DesignRuntime();
	}
	return new DesignRuntime({configuration: /** @type {Configuration} */(value)});
}
