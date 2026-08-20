// @ts-check
import {Vector3} from 'three';
import {PointerLockControls as PointerLockControlsAddon} from 'three/addons/controls/PointerLockControls.js';


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
 * three's PointerLockControls, plus the walk-through rig this app built on it.
 *
 * The vendored copy was three's r98 controls with roughly ninety lines of
 * first-person physics grown into the middle of them: WASD, friction, gravity,
 * a jump, and a floor at eye height. The addon has since been rewritten - it
 * rotates the camera directly instead of parenting it into a yaw/pitch rig, and
 * `getObject()` is gone with that rig - but it still owns none of the physics.
 * So the physics is what gets kept here, and everything else is deleted.
 *
 * Behaviour is preserved deliberately, including the numbers: friction 10/s,
 * gravity 980/s^2, walk acceleration 3000, jump impulse 350, eye height 160
 * (Main sets that; the class defaults to 125). RM-011 H3 added a floor height
 * and a teleport and changed none of them - `groundHeight` defaults to 0, which
 * makes the arithmetic below identical to the fork's, and `teleport()` writes a
 * position and nothing else. Mouse look needs no adjustment
 * at all - the addon's sensitivity constant is 0.002 and so was the fork's
 * `lookspeed`, so pointerSpeed 1.0 is exactly the old feel.
 *
 * Two things end here:
 *
 *   - `THREE.Clock`, deprecated in r183 in favour of a `Timer` that 0.185.1
 *     does not actually ship. `update()` now keeps its own clock, so nothing
 *     outside has to hold one.
 *   - the `disconnect()` bug, where two `addEventListener` calls sat where
 *     removals belonged and leaked a pair of key handlers per unmount. That was
 *     pulled forward to S2 to satisfy its exit gate; the file it was fixed in
 *     no longer exists.
 */
/**
 * Eye height, and the range a person is offered - defined in core/constants.js
 * and re-exported here, where it was declared until RM-015 M3.
 *
 * It moved because of what importing it costs. Three numbers in a frozen
 * object, imported by `useWalkthrough` to bound a slider, were pulling this
 * module - and therefore three's `PointerLockControls` addon - into the
 * application's first load: a 35 KB chunk the entry preloaded for a constant.
 * Nothing about the constant changed, and every import path that ever named
 * this file still resolves.
 */
export {EYE_HEIGHT} from '../core/constants.js';

export class PointerLockControls extends PointerLockControlsAddon
{
	/**
	 * @param {Camera} camera The first-person camera.
	 * @param {HTMLElement} [domElement] Element to lock and take fullscreen.
	 *   Defaults to document.body, which is what the fork did.
	 */
	constructor(camera, domElement)
	{
		super(camera, domElement || document.body);

		/**
		 * Eye height above the floor, in centimetres.
		 *
		 * Was *"the floor the walker cannot fall through"* until H3, which is the
		 * same number as long as the floor is at zero. It is a property of the
		 * person, not of the building, which is why `Main` sets it from a session
		 * preference and no design file carries it.
		 */
		this.characterHeight = 125;
		/**
		 * How high the floor under the walker is, in centimetres (RM-011 H3).
		 *
		 * Zero, until a teleport lands on an upper storey. The fork had no storeys
		 * to stand on, so it clamped to `characterHeight` outright; a design has
		 * had them since RM-010 G1, and without this a walker teleported to the
		 * first floor falls straight through it back to ground eye level.
		 *
		 * Default zero means the physics below is arithmetically identical to the
		 * fork's for every design that has one storey, which is the whole reason
		 * it is a second number rather than a change to the first.
		 */
		this.groundHeight = 0;
		/** Ground acceleration while a direction key is held. */
		this.walkspeed = 3000;
		/** Kept for source compatibility; the addon expresses this as pointerSpeed. */
		this.lookspeed = 0.002;

		// The fork started disabled and was switched on by Main.switchFPSMode.
		this.enabled = false;

		this._velocity = new Vector3();
		this._direction = new Vector3();
		this._moveForward = false;
		this._moveBackward = false;
		this._moveLeft = false;
		this._moveRight = false;
		this._canJump = false;
		this._lastUpdate = 0;

		this._onKeyDown = (event) => this._setKey(event, true);
		this._onKeyUp = (event) => this._setKey(event, false);
		document.addEventListener('keydown', this._onKeyDown);
		document.addEventListener('keyup', this._onKeyUp);
	}

	/**
	 * The object the walker moves.
	 *
	 * The addon removed the yaw/pitch rig and moves the camera itself, so this
	 * is the camera. Kept because `Main` parents it into the scene and positions
	 * it by this name, and because it is part of the published surface.
	 */
	getObject()
	{
		return this.object;
	}

	/** WASD and the arrows, by physical key so the layout does not matter. */
	_setKey(event, down)
	{
		if (this.enabled === false)
		{
			return;
		}
		switch (event.code)
		{
		case 'ArrowUp':
		case 'KeyW':
			this._moveForward = down;
			break;
		case 'ArrowLeft':
		case 'KeyA':
			this._moveLeft = down;
			break;
		case 'ArrowDown':
		case 'KeyS':
			this._moveBackward = down;
			break;
		case 'ArrowRight':
		case 'KeyD':
			this._moveRight = down;
			break;
		case 'Space':
			if (down && this._canJump)
			{
				this._velocity.y += 350;
				this._canJump = false;
			}
			break;
		}
	}

	/**
	 * Advance the walk by one frame.
	 *
	 * @param {number} [delta] Seconds since the last update. Measured internally
	 *   when omitted, which is how Main calls it now that the Clock is gone.
	 */
	update(delta)
	{
		var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
		if (delta === undefined)
		{
			// Clamped, unlike the Clock this replaces. Entering walk mode after the
			// tab has been in the background used to hand over a delta of several
			// seconds, which gravity turned into an instant fall through the floor
			// and a jarring snap back to eye height.
			delta = this._lastUpdate ? Math.min((now - this._lastUpdate) / 1000, 0.1) : 0;
		}
		this._lastUpdate = now;

		var velocity = this._velocity;
		var direction = this._direction;

		velocity.x -= velocity.x * 10.0 * delta;
		velocity.z -= velocity.z * 10.0 * delta;
		velocity.y -= 9.8 * 100.0 * delta; // 100.0 = mass

		direction.z = Number(this._moveForward) - Number(this._moveBackward);
		direction.x = Number(this._moveLeft) - Number(this._moveRight);
		direction.normalize(); // consistent speed on the diagonals

		if (this._moveForward || this._moveBackward)
		{
			velocity.z -= direction.z * this.walkspeed * delta;
		}
		if (this._moveLeft || this._moveRight)
		{
			velocity.x -= direction.x * this.walkspeed * delta;
		}

		// moveForward/moveRight read the camera's matrix, which is otherwise only
		// refreshed by the render pass - and Main updates the walk before it
		// renders, so every step would follow the previous frame's heading. The
		// fork had no such lag: it translated a rig by its quaternion. One call
		// puts that back and drops the dependency on render order.
		this.object.updateMatrix();

		// The fork translated a yaw-only rig, so its local axes were horizontal
		// and translateX/translateZ were safe. The camera carries pitch as well,
		// so walking has to go through moveRight/moveForward - which flatten the
		// direction - or looking up would fly you into the air. moveForward(d)
		// heads along -Z where translateZ(d) headed along +Z, hence the negation.
		this.moveRight(velocity.x * delta);
		this.moveForward(-velocity.z * delta);
		this.object.position.y += velocity.y * delta;

		if (this.object.position.y < this.eyeLevel())
		{
			velocity.y = 0;
			this.object.position.y = this.eyeLevel();
			this._canJump = true;
		}
	}

	/** Where the eye sits when the walker is standing still. */
	eyeLevel()
	{
		return this.groundHeight + this.characterHeight;
	}

	/**
	 * Put the walker somewhere else (RM-011 H3).
	 *
	 * *"A teleport moves the walker and changes nothing else"* is the sprint's
	 * acceptance line and it is meant literally: this writes `position` and the
	 * floor that position stands on, and touches nothing else. Not the velocity -
	 * so a walker who was moving arrives still moving, which is what carries the
	 * sense that the *room* changed rather than the person. Not the orientation,
	 * so you are still looking the way you were looking. Not `_canJump`, which
	 * the next `update()` decides from the position this just wrote.
	 *
	 * @param {number} x
	 * @param {number} z
	 * @param {number} [ground] Height of the floor arrived on. Defaults to the
	 *   one already under the walker, so a teleport across one storey is a move
	 *   in two numbers rather than three.
	 */
	teleport(x, z, ground)
	{
		this.groundHeight = (ground === undefined) ? this.groundHeight : ground;
		this.object.position.set(x, this.eyeLevel(), z);
	}

	/** Lock the pointer and, as the fork did, take the element fullscreen. */
	lock()
	{
		super.lock();

		// `domElement` is nullable on the addon's base class, and the vendor-prefixed
		// call is not in lib.dom - Safari carried `webkitRequestFullscreen` long
		// after the standard one existed and three's types do not describe it
		// (RM-005 C2). The cast is to a shape naming exactly the one method being
		// probed, rather than to `any`.
		var element = /** @type {(HTMLElement & {webkitRequestFullscreen?: function(): void})|null} */ (this.domElement);
		if (!element)
		{
			return;
		}
		if (element.requestFullscreen)
		{
			// Rejects if the call is not user-initiated; that is the browser's
			// decision to make, and an unhandled rejection here would be noise.
			var request = element.requestFullscreen();
			if (request && typeof request.catch === 'function')
			{
				request.catch(function () {});
			}
		}
		else if (element.webkitRequestFullscreen)
		{
			element.webkitRequestFullscreen();
		}
	}

	dispose()
	{
		document.removeEventListener('keydown', this._onKeyDown);
		document.removeEventListener('keyup', this._onKeyUp);
		super.dispose();
	}
}
