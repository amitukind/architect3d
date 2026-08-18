// @ts-check
import {OrbitControls as OrbitControlsAddon} from 'three/addons/controls/OrbitControls.js';
import {EVENT_CAMERA_MOVED, EVENT_CAMERA_ACTIVE_STATUS} from '../core/events.js';


/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('three').Camera} Camera
 */
/**
 * three's OrbitControls, plus the two things this app added to its own fork.
 *
 * Until S5 this file was a 1,045-line copy of the r70-era controls, carrying
 * local edits that were never upstreamed. Almost all of it was three's code
 * going stale - by r185 the addon had gained pointer-event input, key handling
 * you opt into, a `Controls` base class with connect/disconnect, and a great
 * many bug fixes. Only two edits were actually the app's:
 *
 *   1. a `needsUpdate` flag, which `Main.shouldRender()` reads to decide
 *      whether a frame is worth drawing at all;
 *   2. an `EVENT_CAMERA_MOVED` dispatch alongside three's own `change`, which
 *      `Edge` listens to so wall faces re-evaluate which way they are facing
 *      and fade to 0.3 opacity when the camera passes through them.
 *
 * Both are re-implemented here on top of the real addon, driven off `change`
 * rather than woven into the middle of `update()`. Everything else - damping,
 * panning, zoom limits, the ortho/perspective `object` swap `Main` performs -
 * is the addon's, unmodified.
 *
 * Note that nothing calls `update()` on a timer. That was true of the fork too:
 * the app updates on interaction and on explicit camera moves, not per frame,
 * which is why `autoRotate` and the damping tail only advance while something
 * else is already driving frames. Preserved deliberately; changing it would
 * alter idle behaviour, and the parity oracle pins "no auto-rotate at boot".
 */
export class OrbitControls extends OrbitControlsAddon
{
	/**
	 * @param {Camera} object The camera to orbit. `Main` reassigns this when it
	 *   switches between the perspective and orthographic cameras.
	 * @param {HTMLElement} domElement The viewer container.
	 */
	constructor(object, domElement)
	{
		super(object, domElement);

		/**
		 * Render-dirty flag, consumed and cleared by Main.shouldRender().
		 *
		 * Starts true so the first frame is always drawn, matching the fork.
		 */
		this.needsUpdate = true;

		var scope = this;
		/**
		 * Announce that the active camera changed.
		 *
		 * `Main` fires this at four points - a view switch, a clipping change, an
		 * orthographic toggle and entering first person - and `Edge` listens for
		 * it to re-evaluate which way each wall face is turned. Like
		 * `EVENT_CAMERA_MOVED` above it is this class's own event and not one of
		 * three's, so the map does not know the string; the cast lives here, once,
		 * rather than at each of the four call sites (RM-005 C2).
		 */
		this.signalCameraActive = function ()
		{
			scope.dispatchEvent(/** @type {any} */ ({type: EVENT_CAMERA_ACTIVE_STATUS}));
		};

		this._cameraMoved = () =>
		{
			this.needsUpdate = true;
			// This class adds an event three's map does not know about, which is the
			// whole reason it exists - `Edge` listens for it (RM-005 C2). The cast
			// is to `OrbitControlsEventMap`'s key type because the alternative is
			// re-declaring three's map to add one string to it.
			this.dispatchEvent(/** @type {any} */ ({type: EVENT_CAMERA_MOVED}));
		};
		this.addEventListener('change', this._cameraMoved);

		// The fork bound keydown to window unconditionally; the addon makes that
		// opt-in. Passing window keeps arrow-key panning working exactly where it
		// worked before. disconnect() unbinds it, so dispose() is still complete.
		if (domElement)
		{
			this.listenToKeyEvents(window);
		}

		/**
		 * The document the addon put its capture-phase keydown on.
		 *
		 * `connect()` resolves it as `domElement.getRootNode()` and `disconnect()`
		 * resolves it again the same way - so if the element has been taken out of
		 * the page in between, the removal is aimed at the detached subtree and
		 * the listener stays on the real document for the life of the page.
		 *
		 * A host that empties its container before tearing the viewer down does
		 * exactly that. Vue itself runs beforeUnmount ahead of removing the DOM,
		 * so the ordinary route unmount is safe, but @vue/test-utils detaches
		 * first and the S6 leak test caught it - which is the same thing an
		 * embedder doing `container.innerHTML = ''; blueprint.dispose();` would
		 * hit. Remembering the node makes dispose() order-independent.
		 */
		this._keyInterceptRoot = domElement ? domElement.getRootNode() : null;
	}

	dispose()
	{
		this.removeEventListener('change', this._cameraMoved);

		// Belt and braces, before super.dispose() aims its own removal at
		// wherever the element happens to be rooted now. Removing a listener
		// twice is a no-op, and if a future three renames this private the worst
		// case is the status quo: super.dispose() still does the normal thing.
		// `_interceptControlDown` is three's private, undeclared in the types, and
		// the comment above already says what happens if a future release renames
		// it. Read through a cast naming just that field (RM-005 C2).
		var addon = /** @type {{_interceptControlDown?: EventListener}} */ (/** @type {unknown} */ (this));
		if (this._keyInterceptRoot && addon._interceptControlDown)
		{
			this._keyInterceptRoot.removeEventListener('keydown', addon._interceptControlDown, {capture: true});
		}
		this._keyInterceptRoot = null;

		super.dispose();
	}
}
