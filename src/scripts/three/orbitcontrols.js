import {OrbitControls as OrbitControlsAddon} from 'three/addons/controls/OrbitControls.js';
import {EVENT_CAMERA_MOVED} from '../core/events.js';

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

		this._cameraMoved = () =>
		{
			this.needsUpdate = true;
			this.dispatchEvent({type: EVENT_CAMERA_MOVED});
		};
		this.addEventListener('change', this._cameraMoved);

		// The fork bound keydown to window unconditionally; the addon makes that
		// opt-in. Passing window keeps arrow-key panning working exactly where it
		// worked before. disconnect() unbinds it, so dispose() is still complete.
		if (domElement)
		{
			this.listenToKeyEvents(window);
		}
	}

	dispose()
	{
		this.removeEventListener('change', this._cameraMoved);
		super.dispose();
	}
}
