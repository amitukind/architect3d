// @ts-check
import {Model} from './model/model.js';
import {Floorplanner2D} from './floorplanner/floorplanner.js';
import {configDimUnit} from './core/configuration.js';
import {DesignRuntime} from './core/design_runtime.js';
import {dimMeter} from './core/dimensioning.js';

/**
 * A document and its 2D plan, with the 3D viewer left to the caller (RM-015 M3).
 *
 * ## Why this exists
 *
 * `BlueprintJS` in blueprint.js is unchanged and stays the entry point: it builds the
 * model, the 2D plan and the 3D viewer in one call, and embedders depend on
 * that. What it cannot do is *not* build the viewer, and its constructor is
 * where the reference to `Main` lives - so `import {BlueprintJS}` is
 * transitively `import three`, whether or not the page ever shows a room.
 *
 * AA-5 measured what that costs: three is 204,379 gzipped bytes and 47% of the
 * first load, in an application whose default layout is the plan alone. M3
 * measured what the boundary returns: with nothing eager referencing
 * `three/main.js`, the whole of three's WebGL half - `three.module.js`, 531,531
 * rendered bytes - leaves the entry chunk, and first-load falls by 112,800
 * gzipped bytes.
 *
 * So the class splits in two. This half constructs everything that does not
 * need a renderer; `attachViewer` takes the viewer class as an argument, which
 * is what lets the *caller* decide when to import it. The dynamic import is
 * then on the application's side of the package boundary, which is where
 * RM-015 said it belongs - a library cannot know whether its embedder wants to
 * wait.
 *
 * ## What this is not
 *
 * It is not a "2D mode". A `BlueprintCore` with no viewer attached is the same
 * document as one with a viewer: the model, the items and the scene graph are
 * all here, because they are the design rather than a rendering of it. The
 * only thing missing is the thing that draws pixels with WebGL.
 */
export class BlueprintCore
{
	/**
	 * Creates a document, its runtime and its 2D plan. No viewer - see attachViewer().
	 *
	 * @param {Object} options The initialization options.
	 * @param {(HTMLCanvasElement|string)} options.floorplannerElement - The 2D canvas, or its element id. Ignored in widget mode.
	 * @param {(HTMLElement|string)} options.threeElement - The container for the 3D view, or its element id / CSS selector.
	 * @param {?string} options.threeCanvasElement - Unused; kept for signature compatibility.
	 * @param {string} options.textureDir - path to texture directory. No effect
	 * @param {boolean} options.widget - If widget mode then no 2D floorplanner is created and the 3D controller is disabled
	 * @param {import('./core/configuration.js').Configuration} [options.configuration] - Settings for this design alone (P7). Omit to share the page-wide default.
	 * @param {Object} [options.renderProfile] - A look for this viewer alone (P7), from `createRenderProfile`. Omit to share the page-wide default.
	 * @param {import('./core/asset_resolver.js').AssetResolver} [options.assets] - Where this document's asset URLs come from (A5), from `new AssetResolver({manifest, base})`. Omit for the identity resolver, which returns every logical name unchanged - what the library did before A5.
	 * @param {import('./core/imported_model.js').LocalModelSource} [options.localModels] - Bytes for models no deployment ships (RM-012 J3), from a store the embedder owns. A file picked off a disk has no URL for `assets` to rewrite, so `Scene` asks this first and loads from memory when it answers. Omit and nothing changes.
	 * @param {import('./core/design_runtime.js').DesignRuntime} [options.runtime] - This document's services as one object (A4): its configuration, dimensioning, render profile, load session and resource registries. Omit and one is built here from `configuration`/`renderProfile`. A runtime passed in belongs to the caller and is never disposed by `dispose()`.
	 * Passing element ids is the deprecated path, kept so existing embedders keep
	 * working. Prefer real elements - they need no document lookup and work in a
	 * component that mounts before its ids are unique.
	 */
	constructor(options)
	{
		/**
		 * This document's services (RM-003 A4).
		 *
		 * Two ways in:
		 *
		 * - `options.runtime` - an embedder that wants to hold the document's
		 *   lifetime itself, put two viewers on one document, or read
		 *   `runtime.stats()`. It is theirs; `dispose()` will not touch it.
		 * - otherwise one is built here, around `options.configuration`,
		 *   `options.renderProfile` and `options.assets` if they were given. Omit
		 *   them and it carries the page-wide defaults, which is what every caller
		 *   had before P7.
		 *
		 * Note what the second case does NOT do: reuse `defaultRuntime`. Settings
		 * are shared by default and lifetimes never are - see the note on that
		 * constant for what went wrong when they were.
		 *
		 * @property {DesignRuntime} runtime
		 * @type {import('./core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = options.runtime
			|| new DesignRuntime({
				configuration: options.configuration,
				renderProfile: options.renderProfile,
				assets: options.assets,
				localModels: options.localModels,
			});

		/**
		 * Whether `dispose()` should dispose the runtime as well. Only when this
		 * instance built it: a runtime handed in belongs to whoever handed it in,
		 * and disposing it would be one viewer reaching into another document's
		 * lifetime, which is the whole finding A4 closes.
		 */
		this._ownsRuntime = !options.runtime;

		// Has always been here, and against the shared configuration it means
		// *constructing* a second BlueprintJS silently re-unitises the first one -
		// the purest form of the singleton problem R-02 is about. It writes to
		// whichever configuration this document reads, which is the shared one
		// only when the caller asked for nothing else.
		this.configuration.setValue(configDimUnit, dimMeter);

		/**
			* @property {Object} options
			* @type {Object}
		**/
		this.options = options;
		/**
			* @property {Model} model
			* @type {Model}
		**/
		this.model = new Model(options.textureDir, this.runtime);
		// Held in a local as well as on `this`, because the property is nullable
		// (dispose() clears it) and the checker will not narrow a nullable
		// property across the branch below. The local is definitely a Main.
		//
		// `renderProfile` is NOT forwarded here as of A4, and that is the point of
		// the sprint: it is on the runtime, and Main reads it from the model's
		// floorplan. Forwarding it as well would be a second route to the same
		// answer, and two routes are how they come to disagree.
		/**
		 * The 3D viewer, or null until `attachViewer()` builds one - and null
		 * again after `dispose()`.
		 *
		 * Null is the constructed state here, not an error state. See the note at
		 * the top of this file: whoever wants a viewer says so, because saying so
		 * is what makes them import it.
		 *
		 * @property {?import('./three/main.js').Main} three
		 * @type {?any}
		 **/
		this.three = null;

		/**
		 * The 2D view, or null in widget mode - and null again after dispose().
		 * Declared before the branch so both arms agree on the type; assigning
		 * null to a property first seen as a Floorplanner2D is what the checker
		 * objected to, and it was right that the annotation said otherwise.
		 * @type {?Floorplanner2D}
		 */
		this.floorplanner = null;

		if (!options.widget)
		{
			this.floorplanner = new Floorplanner2D(options.floorplannerElement, this.model.floorplan);
		}
		// Widget mode has no 2D view, so nothing ever assigns
		// floorplan.carbonSheet. Loading a design that carries one used to
		// dereference null in Floorplan.loadFloorplan; that call is guarded as of
		// S0 and the null above makes the absence explicit. Disabling the widget's
		// controller is the other half and it needs a viewer, so it now lives in
		// attachViewer() - which runs in BlueprintJS's constructor, so for an
		// embedder the two still happen in the same call.
	}

	/**
	 * Build the 3D viewer, from a class the caller supplies.
	 *
	 * The argument is the whole point. `BlueprintJS` passes the statically
	 * imported `Main` and behaves exactly as it always has; an application that
	 * wants three to arrive later passes the `Main` off a dynamic import, and
	 * pays for the engine when somebody asks to see the room.
	 *
	 * Idempotent: a second call with a viewer already attached returns the one
	 * that is there rather than building a second renderer over the same
	 * element. That matters because the caller is now something like a layout
	 * watcher, which can fire twice before the first import resolves.
	 *
	 * @param {any} Viewer The viewer class - `Main`, or a subclass of it.
	 * @returns {any} The viewer, new or already present.
	 */
	attachViewer(Viewer)
	{
		if (this.three)
		{
			return this.three;
		}

		var options = this.options;
		// `renderProfile` is NOT forwarded here as of A4, and that is the point of
		// that sprint: it is on the runtime, and Main reads it from the model's
		// floorplan. Forwarding it as well would be a second route to the same
		// answer, and two routes are how they come to disagree.
		var three = new Viewer(this.model, options.threeElement, options.threeCanvasElement, {});
		this.three = three;

		if (options.widget)
		{
			// Main.init() runs from its constructor, so the controller exists by
			// now. The guard is not defensive padding: getController() is genuinely
			// nullable before init, and "disable the controller" is vacuously
			// satisfied when there is not one.
			var controller = three.getController();
			if (controller)
			{
				controller.enabled = false;
			}
		}

		return three;
	}

	/**
	 * Release the 3D viewer and leave the document standing.
	 *
	 * The inverse of `attachViewer`, and the reason it exists separately from
	 * `dispose()`: a caller that tore down the viewer to free a WebGL context can
	 * attach another one to the same model afterwards. Safe with nothing
	 * attached.
	 */
	detachViewer()
	{
		if (this.three)
		{
			this.three.dispose();
			this.three = null;
		}
	}

	/**
	 * This design's settings (RM-002 R-02, P7).
	 *
	 * A getter over the runtime since A4, for the same reason `Floorplan`'s is:
	 * one place the answer is kept, so `blueprint.configuration` and
	 * `blueprint.runtime.configuration` cannot come apart.
	 *
	 * @returns {import('./core/configuration.js').Configuration}
	 */
	get configuration()
	{
		return this.runtime.configuration;
	}

	/**
	 * Unmount: dispose the 2D floorplanner (if any) and the 3D view, releasing
	 * every DOM listener and the WebGL context. Safe to call more than once.
	 *
	 * ## The model's data survives; the model's meshes do not (RM-020 S-1)
	 *
	 * This used to leave the model entirely alone, on the stated grounds that it
	 * "holds no DOM or GPU resources". **The second half of that was wrong**, and
	 * `Room.dispose()` had been saying so in its own docblock the whole time: a
	 * `Room` owns two invisible hit-test meshes and every `HalfEdge` owns one, and
	 * an `Item` owns its loaded geometry, its materials and two label canvases.
	 *
	 * Measured on a four-wall, one-room design with a probe on three's own
	 * `dispose` event: **twelve resources seen, zero disposed** - two room planes
	 * and four half-edge planes, each a geometry and a material. It scales at two
	 * per room plus one per wall face, so a twenty-room plan abandoned a few
	 * hundred. Nothing else could collect them: `Floor` and `Edge` borrow those
	 * meshes and are documented never to dispose what they borrow, and
	 * `useBlueprint.unmount()` nulls the model *before* calling this, so they
	 * became unreachable as well as unreleased.
	 *
	 * What the original note got right is the reason it is worth keeping: callers
	 * do serialize a design after teardown, so the corners, walls, rooms and item
	 * records all stay exactly where they are. Only the GPU side goes back. That
	 * is the whole of the distinction - `releaseResources()` and
	 * `releaseItemResources()` are each written to release meshes without
	 * forgetting anything.
	 *
	 * The runtime is disposed only if this instance built it - see
	 * `_ownsRuntime`. A viewer handed one leaves it exactly as it found it.
	 */
	dispose()
	{
		if (this.floorplanner)
		{
			this.floorplanner.dispose();
			this.floorplanner = null;
		}
		this.detachViewer();

		// Both halves of letting the document go, under one guard.
		//
		// They were two, and the second tested `this.model` alone while its own
		// first statement reads `this.model.scene` - so it never covered the
		// precondition it needed, and a model without a scene would have thrown
		// rather than been skipped. One guard is both correct and one branch
		// cheaper, which matters on a file whose branch floor has no slack.
		//
		// Ordering inside it is deliberate and unchanged. `abortPendingLoads` is
		// the bandwidth half of abandoning a load (see DesignRuntime.dispose) and
		// runs whoever owns the runtime, because these are the fetches THIS
		// document started through its own LoadingManager. The release runs after
		// `detachViewer()` above: the viewer's own dispose tears down every Floor
		// and Edge, and those hold the borrowed references to exactly the meshes
		// released here - so releasing first would leave the projection detaching
		// planes it had already given back.
		if (this.model && this.model.scene)
		{
			this.model.scene.abortPendingLoads();
			this.model.scene.releaseItemResources();
			this.model.floorplan.releaseResources();
		}

		if (this._ownsRuntime)
		{
			this.runtime.dispose();
		}
	}
}
