// @ts-check
import {EventDispatcher, Vector2} from 'three';
import {cmPerPixel, pixelsPerCm} from '../core/dimensioning.js';
import {configDimUnit, snapTolerance} from '../core/configuration.js';
import {EVENT_MODE_RESET, EVENT_LOADED} from '../core/events.js';
import {EVENT_CORNER_ATTRIBUTES_CHANGED, EVENT_WALL_ATTRIBUTES_CHANGED, EVENT_ROOM_ATTRIBUTES_CHANGED} from '../core/events.js';
import {EVENT_CORNER_2D_HOVER, EVENT_WALL_2D_HOVER, EVENT_ROOM_2D_HOVER} from '../core/events.js';
import {EVENT_CORNER_2D_CLICKED, EVENT_ROOM_2D_CLICKED, EVENT_WALL_2D_CLICKED} from '../core/events.js';
import {EVENT_CORNER_2D_DOUBLE_CLICKED, EVENT_ROOM_2D_DOUBLE_CLICKED, EVENT_WALL_2D_DOUBLE_CLICKED} from '../core/events.js';
import {EVENT_NOTHING_CLICKED} from '../core/events.js';
import {EVENT_ITEM_2D_CLICKED, EVENT_ITEMS_PROJECTED} from '../core/events.js';
import {EVENT_ANNOTATIONS_CHANGED, EVENT_DIMENSION_2D_CLICKED, EVENT_ANNOTATION_2D_CLICKED} from '../core/events.js';
import {footprintContains} from '../model/plan_projection.js';

/**
 * How close a pointer has to be to a footprint to pick it, in CANVAS pixels
 * (RM-008 E1). Converted to centimetres per call so the target stays the same
 * size on screen at every zoom.
 */
const ITEM_PICK_TOLERANCE_PIXELS = 4;

/**
 * How close a pointer has to be to a dimension line or a label's anchor to pick
 * it, in CANVAS pixels (RM-008 E3).
 *
 * Larger than the furniture's four, because both targets are one pixel wide -
 * a line and a dot - where a footprint is an area, so the tolerance IS the
 * target rather than a margin around one.
 */
const ANNOTATION_PICK_TOLERANCE_PIXELS = 6;

/**
 * The increment angle snapping rounds to, in degrees (RM-008 E2).
 *
 * Fifteen because it contains the angles a building is actually made of - 90
 * for a square corner, 45 for a diagonal, 30 and 60 for a bay - and because the
 * next divisor down, 10, misses 45 entirely.
 */
export const ANGLE_SNAP_DEGREES = 15;

/**
 * How close, in centimetres, a drawing target has to be to an existing corner's
 * row or column before it lines up with it (RM-008 E2).
 *
 * The same 25 cm `snapTolerance` defaults to, because it is the same judgement -
 * "near enough that you meant it" - and two different numbers for one feel is
 * how snapping starts feeling arbitrary.
 */
export const ALIGN_TOLERANCE_CM = 25;

/**
 * Find corners that share a row or a column with a point (RM-008 E2).
 *
 * What a CAD tool draws as a dashed line to the thing you are lining up with,
 * and what stops a plan being a collection of walls that are almost square with
 * each other. Returns the corner it aligned to on each axis, so the caller can
 * both move the point and say WHY it moved - a target that jumps with no
 * explanation is worse than one that does not jump.
 *
 * Nearest wins on each axis independently, which is what lets a point line up
 * with one corner horizontally and a different one vertically - the common case
 * when squaring a room off two walls.
 *
 * @param {Array<Object>} corners Anything with x and y.
 * @param {number} x
 * @param {number} y
 * @param {?Object} [ignore] A corner to skip - the one being drawn from.
 * @param {number} [tolerance] Centimetres.
 * @returns {{x: number, y: number, alignedX: ?Object, alignedY: ?Object}}
 */
export function alignToCorners(corners, x, y, ignore, tolerance)
{
	var limit = (tolerance === undefined || tolerance === null) ? ALIGN_TOLERANCE_CM : tolerance;
	var result = {x: x, y: y, alignedX: null, alignedY: null};
	if (!corners || !corners.length)
	{
		return result;
	}
	var bestX = limit;
	var bestY = limit;
	for (var i = 0; i < corners.length; i++)
	{
		var corner = corners[i];
		if (!corner || corner === ignore)
		{
			continue;
		}
		var dx = Math.abs(corner.x - x);
		if (dx <= bestX)
		{
			bestX = dx;
			result.x = corner.x;
			result.alignedX = corner;
		}
		var dy = Math.abs(corner.y - y);
		if (dy <= bestY)
		{
			bestY = dy;
			result.y = corner.y;
			result.alignedY = corner;
		}
	}
	return result;
}

/**
 * Item types positioned by the wall they are attached to, and so not freely
 * draggable on the plan: WallItem (2), InWallItem (3), InWallFloorItem (7),
 * WallFloorItem (9). The same four the catalog calls wall-bound.
 */
const WALL_BOUND_ITEM_TYPES = [2, 3, 7, 9];
import {resolveCanvas} from '../core/dom.js';
import {FloorplannerView2D, floorplannerModes} from './floorplanner_view.js';


/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('../model/floorplan.js').Floorplan} Floorplan
 */
/** how much will we move a corner to make a wall axis aligned (cm) */
//export const snapTolerance = 25;//In CMS
/**
* The Floorplanner implements an interactive tool for creation of floorplans in
* 2D.
*/
/**
 * Round a point's direction from an origin to the nearest snap increment,
 * keeping its distance (RM-008 E2).
 *
 * Distance is kept rather than projected onto the snapped ray: projecting
 * shortens the wall as the pointer swings away from the increment, so the length
 * readout counts down while the pointer moves further out, which reads as the
 * tool fighting the hand.
 *
 * @param {number} originX
 * @param {number} originY
 * @param {number} pointX
 * @param {number} pointY
 * @returns {{x: number, y: number, angle: number, length: number}} `angle` in
 *          degrees, measured the way `Math.atan2` measures it.
 */
export function snapToAngle(originX, originY, pointX, pointY)
{
	var dx = pointX - originX;
	var dy = pointY - originY;
	var length = Math.sqrt((dx * dx) + (dy * dy));
	if (length === 0)
	{
		// No direction to round. Returning the origin keeps the function total; a
		// zero-length wall is refused downstream anyway.
		return {x: originX, y: originY, angle: 0, length: 0};
	}
	var degrees = Math.atan2(dy, dx) * 180 / Math.PI;
	var snapped = Math.round(degrees / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES;
	var radians = snapped * Math.PI / 180;
	return {
		x: originX + (Math.cos(radians) * length),
		y: originY + (Math.sin(radians) * length),
		angle: snapped,
		length: length,
	};
}

export class Floorplanner2D extends EventDispatcher
{
	/**
	 * @param {(HTMLCanvasElement|string)} canvas The canvas to draw into, or its
	 * element id. The id form is the deprecated back-compat path.
	 * @param {Floorplan} floorplan
	 */
	constructor(canvas, floorplan)
	{
		super();
		/** */
		this.mode = 0;
		/** */
		this.activeWall = null;
		/** */
		this.activeCorner = null;
		/** */
		this.activeRoom = null;
		
		/** */
		this._clickedWall = null;
		/** */
		this._clickedWallControl = null;
		/** */
		this._clickedCorner = null;
		/** */
		this._clickedRoom = null;
		/**
		 * The furniture, as ids (RM-008 E1).
		 *
		 * Ids rather than footprints, because a footprint is a value that is
		 * rebuilt on every projection - holding one would mean holding a stale
		 * copy the moment anything moved. The id is stable; the view looks the
		 * footprint up when it draws.
		 *
		 * `selectedItemId` lives here beside `activeItemId` for the same reason
		 * `activeWall` and `_clickedWall` do: this class is where the 2D view's
		 * interaction state is kept, and the alternative - the view asking the
		 * application what is selected - would point the library at its embedder.
		 *
		 * @type {?string}
		 */
		this.activeItemId = null;
		/** @type {?string} The item picked on the plan, drawn emphasised. */
		this.selectedItemId = null;
		/** @type {?string} The item being dragged right now, or null. */
		this._draggingItemId = null;
		/** Pointer offset within the footprint at grab time, so it does not jump. */
		this._itemGrabOffset = {x: 0, y: 0};
		/** */
		this.originX = 0;
		/** */
		this.originY = 0;
		/** */
		this.unScaledOriginX = 0;
		/** */
		this.unScaledOriginY = 0;
		/** drawing state */
		this.targetX = 0;
		/** drawing state */
		this.targetY = 0;
		/** drawing state */
		this.lastNode = null;
		/** */
		this.wallWidth = 0;

		/** */
		this.mouseDown = false;
		/** */
		this.mouseMoved = false;
		/** in ThreeJS coords */
		this.mouseX = 0;
		/** in ThreeJS coords */
		this.mouseY = 0;
		/** in ThreeJS coords */
		this.rawMouseX = 0;
		/** in ThreeJS coords */
		this.rawMouseY = 0;
		/** mouse position at last click */
		this.lastX = 0;
		/** mouse position at last click */
		this.lastY = 0;

		this.canvasElement = resolveCanvas(canvas, 'floorplanner canvas');
		/** Kept for back-compat: callers used to read `.canvas` as an element id. */
		this.canvas = (typeof canvas === 'string') ? canvas : this.canvasElement.id;
		this.floorplan = floorplan;
		this.view = new FloorplannerView2D(this.floorplan, this, this.canvasElement);
		this._disposed = false;

		this.cmPerPixel = cmPerPixel;
		this.pixelsPerCm = pixelsPerCm;
		
		this.wallWidth = this.dimensioning.cmToPixel(this.configuration.getNumericValue('wallThickness'));
		this.gridsnapmode = false;
		/**
		 * Round the direction of the wall being drawn to {@link ANGLE_SNAP_DEGREES}
		 * (RM-008 E2).
		 *
		 * Its own mode rather than a modifier key. Shift is already taken - it turns
		 * grid snapping on, which the README described as axis snapping until E2
		 * looked - and a second meaning for one key is how a gesture becomes
		 * unlearnable. Off by default, because it changes where a click lands.
		 *
		 * @type {boolean}
		 */
		this.anglesnapmode = false;
		/**
		 * The first corner of the rectangle being drawn, or null (RM-008 E2).
		 *
		 * Click-click rather than press-drag, matching the wall tool's rhythm: a
		 * five-metre room is a long way to hold a button down, and a drag that ends
		 * off the canvas has nowhere to release.
		 *
		 * @type {?{x: number, y: number}}
		 */
		/**
		 * Line the drawing target up with corners that already exist (RM-008 E2).
		 *
		 * On by default, unlike angle snapping, because it only ever moves the
		 * target within 25 cm and only onto something already in the drawing - so
		 * the wall you get is the wall you were nearly drawing, squared up.
		 *
		 * @type {boolean}
		 */
		this.alignguides = true;
		/**
		 * The corners the target is currently lined up with, per axis, or nulls.
		 * The view draws a guide to each; nothing else reads it.
		 *
		 * @type {{x: ?Object, y: ?Object}}
		 */
		this.alignedTo = {x: null, y: null};
		this.rectangleAnchor = null;
		/**
		 * The annotation the pointer is over, and the one that is selected
		 * (RM-008 E3).
		 *
		 * Objects rather than ids, unlike the furniture beside them, and the
		 * difference is real: a footprint is rebuilt on every projection, so
		 * holding one would hold a stale copy - a `Dimension` is owned by the
		 * floorplan and lives as long as the design does.
		 *
		 * @type {?import('../model/annotation.js').Dimension}
		 */
		this.activeDimension = null;
		/** @type {?import('../model/annotation.js').Dimension} */
		this.selectedDimension = null;
		/** @type {?import('../model/annotation.js').TextAnnotation} */
		this.activeAnnotation = null;
		/** @type {?import('../model/annotation.js').TextAnnotation} */
		this.selectedAnnotation = null;
		/**
		 * The first point of the dimension being placed, or null (RM-008 E3).
		 *
		 * Click-click, the same rhythm as the wall and rectangle tools, and for the
		 * same reason: a dimension across a room is a long way to hold a button
		 * down. Carries the corner it landed on when it landed on one, so the
		 * finished dimension can be pinned to it.
		 *
		 * @type {?{x: number, y: number, cornerId: ?string}}
		 */
		this.dimensionAnchor = null;
		/** @type {?import('../model/annotation.js').TextAnnotation} The label being dragged. */
		this._draggingAnnotation = null;
		/** Pointer offset within the label at grab time, so it does not jump. */
		this._annotationGrabOffset = {x: 0, y: 0};
		/** @type {?import('../model/annotation.js').Dimension} The dimension whose offset is being dragged. */
		this._draggingDimension = null;
		this.shiftkey = false;
		// Initialization:

		this.setMode(floorplannerModes.MOVE);

		var scope = this;

		// One pointer stream instead of the old touch* + mouse* pairs. Registered
		// non-passive because the touch path calls preventDefault() to stop the
		// page scrolling out from under a drag; touch-action does the same job for
		// gestures the browser would otherwise claim before a listener ever runs.
		this._pointerOptions = {passive: false};
		this._pointerDownEvent = (event) => {scope.mousedown(event);};
		this._pointerMoveEvent = (event) => {scope.mousemove(event);};
		// These three take no event - `mouseup(/*event*/)` has its parameter
		// commented out - so they are called without one (RM-005 C2). Passing an
		// argument to a zero-parameter function is a no-op in JS and a TS2554 here;
		// the handlers below that DO read the event still get it.
		this._pointerUpEvent = () => {scope.mouseup();};
		this._pointerLeaveEvent = () => {scope.mouseleave();};
		this._doubleClickEvent = () => {scope.doubleclick();};
		this._keyUpEvent = (event) => {scope.keyUp(event);};
		this._keyDownEvent = (event) => {scope.keyDown(event);};
		this._floorplanLoadedEvent = () => {scope.reset();};
		this._updateViewEvent = () => {scope.view.invalidate();};

		this._previousTouchAction = this.canvasElement.style.touchAction;
		this.canvasElement.style.touchAction = 'none';

		this.canvasElement.addEventListener('pointerdown', this._pointerDownEvent, this._pointerOptions);
		this.canvasElement.addEventListener('pointermove', this._pointerMoveEvent, this._pointerOptions);
		this.canvasElement.addEventListener('pointerup', this._pointerUpEvent, this._pointerOptions);
		this.canvasElement.addEventListener('pointerleave', this._pointerLeaveEvent, this._pointerOptions);
		// A cancelled pointer (the browser took the gesture, the pen left range)
		// would otherwise leave mouseDown stuck true and the plan panning forever.
		this.canvasElement.addEventListener('pointercancel', this._pointerLeaveEvent, this._pointerOptions);
		this.canvasElement.addEventListener('dblclick', this._doubleClickEvent, this._pointerOptions);

		document.addEventListener('keyup', this._keyUpEvent);
		document.addEventListener('keydown', this._keyDownEvent);
		this._subscribePlan(floorplan);
	}

	/**
	 * Detach everything this instance attached: canvas pointer listeners, the two
	 * document key listeners, the four floorplan listeners, and the view (which
	 * owns the window/ResizeObserver listeners and the carbon sheet). Safe to call
	 * more than once.
	 */
	dispose()
	{
		if (this._disposed)
		{
			return;
		}
		this._disposed = true;

		// No options object on removal (RM-005 C2). `removeEventListener` matches
		// on type, listener and `capture` only - `passive` is an addEventListener
		// concept and is not part of the identity, so passing `{passive: false}`
		// here was ignored at runtime and a TS2769 at build time. Both calls have
		// capture false, so the pairing is unchanged.
		this.canvasElement.removeEventListener('pointerdown', this._pointerDownEvent);
		this.canvasElement.removeEventListener('pointermove', this._pointerMoveEvent);
		this.canvasElement.removeEventListener('pointerup', this._pointerUpEvent);
		this.canvasElement.removeEventListener('pointerleave', this._pointerLeaveEvent);
		this.canvasElement.removeEventListener('pointercancel', this._pointerLeaveEvent);
		this.canvasElement.removeEventListener('dblclick', this._doubleClickEvent);
		this.canvasElement.style.touchAction = this._previousTouchAction;

		document.removeEventListener('keyup', this._keyUpEvent);
		document.removeEventListener('keydown', this._keyDownEvent);

		this._unsubscribePlan(this.floorplan);

		this.view.dispose();

		this.activeWall = null;
		this.activeCorner = null;
		this.activeRoom = null;
		this._clickedWall = null;
		this._clickedWallControl = null;
		this._clickedCorner = null;
		this._clickedRoom = null;
		this.lastNode = null;
	}

	/**
	 * This design's settings, reached through the plan being drawn (RM-002 R-02, P7).
	 *
	 * The 2D view is per-Floorplan by construction - it is handed one and draws
	 * it - so the plan is the natural place to ask, and no new plumbing was
	 * needed to get here. Reading through a getter rather than caching the
	 * reference keeps a view correct if the floorplan it draws is ever swapped.
	 *
	 * @returns {import('../core/configuration.js').Configuration}
	 */
	get configuration()
	{
		return this.floorplan.configuration;
	}

	/**
	 * Unit and scale conversion for this design (P7).
	 *
	 * @returns {import('../core/dimensioning.js').Dimensioning}
	 */
	get dimensioning()
	{
		return this.floorplan.dimensioning;
	}

	/**
	 * Everything but a mouse gets the old touch treatment: the pointer position
	 * seeds the pan origin on press, and moves suppress the browser's own scroll.
	 */
	_isTouchLike(event)
	{
		return !!(event && event.pointerType && event.pointerType !== 'mouse');
	}
	
	get selectedCorner()
	{
		return this._clickedCorner;
	}
	
	get selectedWall()
	{
		return this._clickedWall;
	}
	
	get selectedRoom()
	{
		return this._clickedRoom;
	}

	get carbonSheet()
	{
		return this.view.carbonSheet;
	}

	doubleclick()
	{
		var userinput, cid;
		function getAValidInput(message, current)
		{
			var uinput = window.prompt(message, current);
			if(uinput != null)
			{
				return uinput;
			}
			return current;
		}
		if(this.activeCorner)
		{
			this.floorplan.dispatchEvent({type:EVENT_CORNER_2D_DOUBLE_CLICKED, item: this.activeCorner});
			if(!this.configuration.getNumericValue('systemUI'))
			{
				return;
			}
			cid = this.activeCorner.id;
			var units = this.configuration.getStringValue(configDimUnit);
			this.activeCorner.elevation = getAValidInput(`Elevation at this point (in ${units},\n${cid}): `, this.dimensioning.cmToMeasureRaw(this.activeCorner.elevation));//Number(userinput);
			var x = getAValidInput(`Location: X (${this.dimensioning.cmToMeasureRaw(this.activeCorner.x)}): `, this.dimensioning.cmToMeasureRaw(this.activeCorner.x));//Number(userinput);
			var y = getAValidInput(`Location: Y (${this.dimensioning.cmToMeasureRaw(this.activeCorner.y)}): `, this.dimensioning.cmToMeasureRaw(this.activeCorner.y));//Number(userinput);
			this.activeCorner.move(this.dimensioning.cmFromMeasureRaw(x), this.dimensioning.cmFromMeasureRaw(y));
			
		}
		else if(this.activeWall)
		{
			this.floorplan.dispatchEvent({type:EVENT_WALL_2D_DOUBLE_CLICKED, item: this.activeWall});
			if(!this.configuration.getNumericValue('systemUI'))
			{
				return;
			}
		}
		else if(this.activeRoom)
		{
			this.floorplan.dispatchEvent({type:EVENT_ROOM_2D_DOUBLE_CLICKED, item: this.activeRoom});
			if(!this.configuration.getNumericValue('systemUI'))
			{
				return;
			}
			userinput = window.prompt('Enter a name for this Room: ', this.activeRoom.name);
			if(userinput != null)
			{
				this.activeRoom.name = userinput;
			}
			this.view.invalidate();
		}
	}

	keyUp(e)
	{
		if (e.keyCode == 27)
		{
			this.escapeKey();
		}
		this.gridsnapmode = false;
		this.shiftkey = false;
	}

	keyDown(e)
	{
		if(e.shiftKey || e.keyCode == 16)
		{
			this.shiftkey = true;
		}
		this.gridsnapmode = this.shiftkey;
	}

	/** */
	escapeKey()
	{
		this.setMode(floorplannerModes.MOVE);
	}

	/** */
	updateTarget()
	{
		if (this.mode == floorplannerModes.DRAW && this.lastNode)
		{
			if (Math.abs(this.mouseX - this.lastNode.x) < this.configuration.getNumericValue(snapTolerance))
			{
				this.targetX = this.lastNode.x;
			}
			else
			{
				this.targetX = this.mouseX;
			}
			if (Math.abs(this.mouseY - this.lastNode.y) < this.configuration.getNumericValue(snapTolerance))
			{
				this.targetY = this.lastNode.y;
			}
			else
			{
				this.targetY = this.mouseY;
			}
		}
		else
		{
			this.targetX = this.mouseX;
			this.targetY = this.mouseY;
		}
		
		// Lining up with corners that already exist (RM-008 E2).
		//
		// Before the two snaps below, so an explicit angle or a grid position wins
		// over a guide: a guide is a suggestion drawn from what happens to be
		// nearby, and the other two were asked for.
		this.alignedTo = {x: null, y: null};
		if ((this.mode == floorplannerModes.DRAW || this.mode == floorplannerModes.RECTANGLE
			|| this.mode == floorplannerModes.DIMENSION)
			&& this.alignguides)
		{
			var aligned = alignToCorners(this.floorplan.getCorners(), this.targetX, this.targetY, this.lastNode, undefined);
			this.targetX = aligned.x;
			this.targetY = aligned.y;
			this.alignedTo = {x: aligned.alignedX, y: aligned.alignedY};
		}

		// Angle snapping wins outright while a wall is being drawn (RM-008 E2).
		//
		// It has to: the two branches above constrain the target's POSITION and
		// this constrains its DIRECTION, and a position rounded to the grid after
		// the direction was rounded to 15 degrees is at neither. Running this last
		// and letting it overwrite is the only ordering where the wall you see is
		// the wall you asked for, so grid snapping is skipped rather than fought.
		if (this.anglesnapmode && this.mode == floorplannerModes.DRAW && this.lastNode)
		{
			var snapped = snapToAngle(this.lastNode.x, this.lastNode.y, this.mouseX, this.mouseY);
			this.targetX = snapped.x;
			this.targetY = snapped.y;
		}
		else if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
		{			
			this.targetX = Math.floor(this.targetX / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
			this.targetY = Math.floor(this.targetY / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
			
			//The below will not work, the snapTolerance is necessary for X, Y axis snapping, where as grid snapping is for snapping to grid lines
		}

		this.view.invalidate();
	}

	/** */
	mousedown(event)
	{
		this.mouseDown = true;
		this.mouseMoved = false;
		if(this._isTouchLike(event))
		{
			// A touch arrives with no preceding move, so seed the pan origin from
			// the press itself. With a mouse the last pointermove already did.
			this.rawMouseX = event.clientX;
			this.rawMouseY = event.clientY;
		}

		this.lastX = this.rawMouseX;
		this.lastY = this.rawMouseY;
		
				
		// delete
		if (this.mode == floorplannerModes.DELETE)
		{
			if (this.activeCorner)
			{
				this.activeCorner.removeAll();
			}
			else if (this.activeWall)
			{
				this.activeWall.remove();
			}
			else
			{
				//Continue the mode of deleting walls, this is necessary for deleting multiple walls
			}
		}
		
		var bounds = this.canvasElement.getBoundingClientRect();
		this.mouseX = this.dimensioning.pixelToCm((event.clientX - bounds.left)) + this.dimensioning.pixelToCm(this.originX);
		this.mouseY = this.dimensioning.pixelToCm((event.clientY - bounds.top)) + this.dimensioning.pixelToCm(this.originY);

		// A click with no pointer movement before it still has to land where the
		// pointer is (RM-008 E2). `mousemove` is otherwise the only caller, so the
		// first click of a session - or of a tool - used a target from before it.
		if (this.mode == floorplannerModes.DRAW || this.mode == floorplannerModes.RECTANGLE
			|| this.mode == floorplannerModes.DIMENSION || this.mode == floorplannerModes.TEXT)
		{
			this.updateTarget();
		}

		if(this._clickedWall)
		{
			// `tolerance` is optional in all three of these and was not declared so.
			this._clickedWallControl = this.floorplan.overlappedControlPoint(this._clickedWall, this.mouseX, this.mouseY, undefined);
			if(this._clickedWallControl != null)
			{
				this.view.invalidate();
				return;
			}
		}
		
		
		// The annotation tools place rather than pick, so they run before anything
		// is hit-tested (RM-008 E3). Clicking with the dimension tool active means
		// "here", not "select whatever is underneath".
		if (this.mode == floorplannerModes.DIMENSION)
		{
			this.placeDimensionPoint();
			this.view.invalidate();
			return;
		}
		if (this.mode == floorplannerModes.TEXT)
		{
			this.placeAnnotation();
			this.view.invalidate();
			return;
		}

		var mDownCorner = this.floorplan.overlappedCorner(this.mouseX, this.mouseY, undefined);
		var mDownWall = this.floorplan.overlappedWall(this.mouseX, this.mouseY, undefined);
		var mDownItem = this.overlappedItem(this.mouseX, this.mouseY);
		var mDownRoom = this.floorplan.overlappedRoom(this.mouseX, this.mouseY);
		this._clickedWallControl = null;

		// Authored marks are picked after corners and before walls (RM-008 E3).
		//
		// Corners stay first because they are the smallest and most precise target
		// on the canvas and every drawing gesture starts at one. Everything else
		// comes second, and the rule is that a mark somebody placed deliberately
		// beats geometry that was derived: a note pinned to a wall has to be
		// clickable, and a wall is an enormous target that would otherwise swallow
		// the dot. A dimension line sits 40 cm clear of what it measures by
		// default, so the two rarely compete at all.
		var mDownAnnotation = (mDownCorner == null) ? this.overlappedAnnotation(this.mouseX, this.mouseY) : null;
		var mDownDimension = (mDownCorner == null && mDownAnnotation == null)
			? this.overlappedDimension(this.mouseX, this.mouseY) : null;
		if (mDownAnnotation || mDownDimension)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			this.selectItem(null);
			if (this.mode == floorplannerModes.DELETE)
			{
				this.selectAnnotationTarget(null);
				if (mDownAnnotation)
				{
					this.floorplan.removeAnnotation(mDownAnnotation);
				}
				else if (mDownDimension)
				{
					this.floorplan.removeDimension(mDownDimension);
				}
				this.view.invalidate();
				return;
			}
			this.selectAnnotationTarget(mDownAnnotation || mDownDimension);
			if (this.mode == floorplannerModes.MOVE)
			{
				if (mDownAnnotation)
				{
					this._draggingAnnotation = mDownAnnotation;
					this._annotationGrabOffset = {x: this.mouseX - mDownAnnotation.x, y: this.mouseY - mDownAnnotation.y};
				}
				else
				{
					this._draggingDimension = mDownDimension;
				}
			}
			this.view.invalidate();
			return;
		}
		this.selectAnnotationTarget(null);

		// Furniture is picked before the room it stands in and after the walls
		// and corners that define it (RM-008 E1). The order is the useful one: a
		// wall passing under a wide sofa stays grabbable, and clicking a chair
		// does not select the room around it.
		if (mDownCorner == null && mDownWall == null && mDownItem != null)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			this.selectItem(mDownItem.id);
			if (this.mode == floorplannerModes.MOVE && !mDownItem.fixed && this.itemIsDraggable(mDownItem))
			{
				this._draggingItemId = mDownItem.id;
				this._itemGrabOffset = {x: this.mouseX - mDownItem.x, y: this.mouseY - mDownItem.y};
			}
			this.view.invalidate();
			return;
		}

		if(mDownCorner == null && mDownWall == null && mDownRoom == null)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			// Clicking bare canvas drops the furniture selection too, or a chair
			// stays highlighted while the inspector shows nothing (RM-008 E1).
			this.selectItem(null);
			this.floorplan.dispatchEvent({type:EVENT_NOTHING_CLICKED});
		}
		
		else if(mDownCorner != null)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			this._clickedCorner = mDownCorner;
			this.selectItem(null);
			this.floorplan.dispatchEvent({type:EVENT_CORNER_2D_CLICKED, item: this._clickedCorner});
		}
		
		else if(mDownWall != null)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			this._clickedWall = mDownWall;
			this.selectItem(null);
			this.floorplan.dispatchEvent({type:EVENT_WALL_2D_CLICKED, item: this._clickedWall});
		}
		
		else if(mDownRoom != null)
		{
			this._clickedCorner = undefined;
			this._clickedWall = undefined;
			this._clickedRoom = undefined;
			this._clickedRoom = mDownRoom;
			this.selectItem(null);
			this.floorplan.dispatchEvent({type:EVENT_ROOM_2D_CLICKED, item: this._clickedRoom});
		}
		this.view.invalidate();
	}

	/** */
	mousemove(event)
	{
		this.mouseMoved = true;

		if(this._isTouchLike(event))
		{
			event.stopPropagation();
			event.preventDefault();
		}

		// update mouse
		this.rawMouseX = event.clientX;
		this.rawMouseY = event.clientY;

		var bounds = this.canvasElement.getBoundingClientRect();
		this.mouseX = this.dimensioning.pixelToCm(event.clientX - bounds.left) + this.dimensioning.pixelToCm(this.originX);
		this.mouseY = this.dimensioning.pixelToCm(event.clientY - bounds.top) + this.dimensioning.pixelToCm(this.originY);


		// update target (snapped position of actual mouse)
		//
		// RECTANGLE added by RM-008 E2. Without it the tool's target never left
		// the origin - `updateTarget` is the only thing that writes targetX/targetY
		// and this was the only place that called it during a gesture - so every
		// rectangle was measured from (0, 0) and refused as degenerate. Caught by
		// driving the pointer, not by calling the method: a test that calls
		// `placeRectangleCorner` directly sets the target itself and passes.
		if (this.mode == floorplannerModes.DRAW || this.mode == floorplannerModes.RECTANGLE
			|| this.mode == floorplannerModes.DIMENSION || this.mode == floorplannerModes.TEXT
			|| (this.mode == floorplannerModes.MOVE && this.mouseDown))
		{
			this.updateTarget();
		}

		// update object target
		if (this.mode != floorplannerModes.DRAW && !this.mouseDown)
		{
			var hoverCorner = this.floorplan.overlappedCorner(this.mouseX, this.mouseY, undefined);
			var hoverWall = this.floorplan.overlappedWall(this.mouseX, this.mouseY, undefined);
			var hoverRoom = this.floorplan.overlappedRoom(this.mouseX, this.mouseY);
			var draw = false;			
			
			// corner takes precendence
			if (hoverCorner != this.activeCorner && this.activeWall == null)
			{
				this.activeCorner = hoverCorner;
				this.floorplan.dispatchEvent({type:EVENT_CORNER_2D_HOVER, item: hoverCorner});
				draw = true;
			}
			
			if (hoverWall != this.activeWall && this.activeCorner == null)
			{
				this.activeWall = hoverWall;
				this.floorplan.dispatchEvent({type:EVENT_WALL_2D_HOVER, item: hoverWall});
				draw = true;
			}
			else
			{
				this.activeWall = null;
			}
			
			if(this.activeWall == null && this.activeCorner == null)
			{
				this.activeRoom = hoverRoom;
			}
			
			if(this.activeCorner == null && this.activeWall == null && this.activeRoom !=null)
			{
				this.floorplan.dispatchEvent({type:EVENT_ROOM_2D_HOVER, item: hoverRoom});				
			}
			
			if(this.activeRoom == null)
			{
				draw = true;
			}

			// Furniture hover, on the same rule as the pick: only when no corner
			// or wall is under the pointer (RM-008 E1).
			var hoverItem = (this.activeCorner == null && this.activeWall == null)
				? this.overlappedItem(this.mouseX, this.mouseY) : null;
			var hoverItemId = hoverItem ? hoverItem.id : null;
			if (hoverItemId !== this.activeItemId)
			{
				this.activeItemId = hoverItemId;
				draw = true;
			}

			// Annotation hover, on the same rule as the pick above it (RM-008 E3):
			// after a corner, before anything else. Kept in step with `mousedown`
			// deliberately - a mark that highlights on hover and is not what a click
			// selects is worse than no highlight at all.
			var hoverAnnotation = (this.activeCorner == null)
				? this.overlappedAnnotation(this.mouseX, this.mouseY) : null;
			var hoverDimension = (this.activeCorner == null && hoverAnnotation == null)
				? this.overlappedDimension(this.mouseX, this.mouseY) : null;
			if (hoverAnnotation !== this.activeAnnotation || hoverDimension !== this.activeDimension)
			{
				this.activeAnnotation = hoverAnnotation;
				this.activeDimension = hoverDimension;
				draw = true;
			}

			if (draw)
			{
				this.view.invalidate();
			}
		}

		var mx, my;
		// panning.
		// `!this._draggingItemId` added by RM-008 E1: this branch runs BEFORE the
		// drag branches below, and its condition was "nothing else is grabbed" -
		// expressed as a list of the things that could be grabbed at the time.
		// A grabbed item is a new member of that list, and without it the first
		// drag of a chair panned the whole plan instead. Found by dragging one.
		if (this.mouseDown && !this.activeCorner && !this.activeWall && !this._clickedWallControl && !this._draggingItemId
			&& !this._draggingAnnotation && !this._draggingDimension)
//		else if (this.mouseDown && (this.activeCorner==null) && (this.activeWall==null) && (this._clickedWallControl == null))
//		else if (this.mouseDown && (!this._clickedCorner) && (!this._clickedWall) && (this._clickedWallControl == null))
		{
			this.originX += (this.lastX - this.rawMouseX);
			this.originY += (this.lastY - this.rawMouseY);
			this.unScaledOriginX += (this.lastX - this.rawMouseX) * (1 / this.configuration.getNumericValue('scale'));
			this.unScaledOriginY += (this.lastY - this.rawMouseY) * (1 / this.configuration.getNumericValue('scale'));
			this.lastX = this.rawMouseX;
			this.lastY = this.rawMouseY;
			this.view.invalidate();
		}
		// Dragging a note, and dragging a dimension's offset (RM-008 E3). First,
		// because mousedown returned early for both - nothing else can be grabbed
		// at the same time - and because the pan guard above already excludes them.
		if (this.mode == floorplannerModes.MOVE && this.mouseDown && this._draggingAnnotation)
		{
			this._draggingAnnotation.moveTo(
				this.mouseX - this._annotationGrabOffset.x,
				this.mouseY - this._annotationGrabOffset.y);
			this.view.invalidate();
			return;
		}
		if (this.mode == floorplannerModes.MOVE && this.mouseDown && this._draggingDimension)
		{
			this._draggingDimension.setOffset(this.offsetToPointer(this._draggingDimension, this.mouseX, this.mouseY));
			this.view.invalidate();
			return;
		}

		// dragging
		// Dragging a footprint (RM-008 E1). Before the wall-control branch because
		// grabbing an item is exclusive: nothing else can be under the pointer at
		// the same time, mousedown having returned early.
		if (this.mode == floorplannerModes.MOVE && this.mouseDown && this._draggingItemId)
		{
			var itemX = this.mouseX - this._itemGrabOffset.x;
			var itemY = this.mouseY - this._itemGrabOffset.y;
			if (this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
			{
				var step = this.configuration.getNumericValue(snapTolerance);
				itemX = Math.round(itemX / step) * step;
				itemY = Math.round(itemY / step) * step;
			}
			var commands = this.floorplan.itemCommands;
			if (commands)
			{
				// Moves and re-projects; the redraw happens on the frame this
				// invalidate schedules, so nothing is dispatched per pointermove.
				commands.move(this._draggingItemId, itemX, itemY);
			}
			this.view.invalidate();
			return;
		}

		if (this.mode == floorplannerModes.MOVE && this.mouseDown)
		{
			if(this._clickedWallControl != null)
			{
				mx = this.mouseX;
				my = this.mouseY;
				if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
				{
					mx = Math.floor(this.mouseX / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
					my = Math.floor(this.mouseY / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
				}
				
				this._clickedWallControl.x = mx;
				this._clickedWallControl.y = my;
				// Guarded together: this branch only runs when a control point was
				// grabbed, which means both were set by the same mousedown.
				if (this._clickedWall) { this._clickedWall.updateControlVectors(); }
				this.view.invalidate();
				return;
			}
			if (this.activeCorner)
			{
				if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
				{
					
					mx = Math.floor(this.mouseX / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
					my = Math.floor(this.mouseY / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
					
					this.activeCorner.move(Math.round(mx), Math.round(my));
				}
				else
				{
					this.activeCorner.move(this.mouseX, this.mouseY);
				}
			}
			else if (this.activeWall)
			{
				if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
				{
					var dx = this.dimensioning.pixelToCm(this.rawMouseX - this.lastX);
					var dy = this.dimensioning.pixelToCm(this.rawMouseY - this.lastY);
					mx = Math.floor(dx / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
					my = Math.floor(dy / this.configuration.getNumericValue(snapTolerance)) * this.configuration.getNumericValue(snapTolerance);
					this.activeWall.relativeMove(mx, my);
				}
				else
				{
					this.activeWall.relativeMove(this.dimensioning.pixelToCm(this.rawMouseX - this.lastX), this.dimensioning.pixelToCm(this.rawMouseY - this.lastY));
				}
				
				
				if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
				{
					this.activeWall.snapToAxis(this.configuration.getNumericValue(snapTolerance));
				}
				this.lastX = this.rawMouseX;
				this.lastY = this.rawMouseY;
			}
			this.view.invalidate();
		}
	}

	/** */
	mouseup(/*event*/)
	{
		this.mouseDown = false;

		// The annotation drags end here and announce nothing extra (RM-008 E3):
		// each mutator has already announced itself, and the application commits a
		// history entry off the same coalesced event, so a gesture is one entry
		// without this having to say when it finished.
		if (this._draggingAnnotation || this._draggingDimension)
		{
			this._draggingAnnotation = null;
			this._draggingDimension = null;
			this.view.invalidate();
			return;
		}

		// One undo entry for the whole drag, recorded when the pointer is let go
		// (RM-008 E1, T-7) - the same moment the 3D controller commits one.
		if (this._draggingItemId)
		{
			var commands = this.floorplan.itemCommands;
			if (commands && this.mouseMoved)
			{
				commands.commit(this._draggingItemId);
			}
			this._draggingItemId = null;
			this.view.invalidate();
			return;
		}
		// drawing
		if (this.mode == floorplannerModes.RECTANGLE && !this.mouseMoved)
		{
			this.placeRectangleCorner();
		}
		else if (this.mode == floorplannerModes.DRAW && !this.mouseMoved)
		{
			this.placeDrawTarget();
		}
		else
		{
			if(this.activeCorner != null)
			{
				this.activeCorner.updateAttachedRooms(true);
			}
			if(this.activeWall != null)
			{
				this.activeWall.updateAttachedRooms(true);
			}
			
			if(this._clickedCorner)
			{
				this._clickedCorner.updateAttachedRooms(true);
			}
			if(this._clickedWall)
			{
				this._clickedWall.updateAttachedRooms(true);
			}
		}
		this.view.invalidate();
	}

	/**
	 * Which footprint is under a point in plan space (RM-008 E1).
	 *
	 * Last match wins, so the item drawn on top is the one picked - the draw pass
	 * runs rugs first and then everything else, and a chair standing on a rug
	 * should be what a click on the chair selects.
	 *
	 * The tolerance is in centimetres and scales with the zoom: at 25 % a 4 cm
	 * lamp base is one screen pixel, and a target nobody can hit is a feature
	 * nobody has. Converting a fixed pixel margin back into centimetres is what
	 * keeps the target the same size on screen at every zoom.
	 *
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y Plan space, centimetres.
	 * @returns {?import('../model/plan_projection.js').ItemFootprint}
	 */
	overlappedItem(x, y)
	{
		var projection = this.floorplan.itemProjection;
		if (!projection || !projection.length)
		{
			return null;
		}
		var tolerance = this.dimensioning.pixelToCm(ITEM_PICK_TOLERANCE_PIXELS);
		var found = null;
		for (var i = 0; i < projection.length; i++)
		{
			if (projection[i].halfWidth > 0 && projection[i].halfDepth > 0
				&& footprintContains(projection[i], x, y, tolerance))
			{
				found = projection[i];
			}
		}
		return found;
	}

	/**
	 * Whether the plan may drag this item.
	 *
	 * Wall-bound items - doors, windows, wall cabinets - are positioned by the
	 * wall they are attached to, and `WallItem` re-derives that placement from
	 * its edge whenever the wall moves. Dragging one freely on the plan would
	 * set a position the next wall edit silently discards, which is a worse
	 * outcome than not offering the drag. They can still be selected here, and
	 * they still slide along their wall in 3D.
	 *
	 * Sliding one along its wall from the plan is real and is F1's, where the
	 * opening becomes parametric and has a position along the wall to set
	 * (RM-007 Q-2).
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 * @returns {boolean}
	 */
	itemIsDraggable(footprint)
	{
		return WALL_BOUND_ITEM_TYPES.indexOf(footprint.type) === -1;
	}

	/**
	 * Select an item from the plan, or clear the selection (RM-008 E1).
	 *
	 * Half of what T-2 found missing: before this, clicking anything on the plan
	 * changed nothing in the 3D view. This announces the pick and stops; the
	 * application hears it, resolves the id to an item, and puts that in the one
	 * selection it keeps - which is what makes the 3D view and the inspector
	 * follow without this class knowing either exists.
	 *
	 * @param {?string} id
	 */
	selectItem(id)
	{
		if (this.selectedItemId === id)
		{
			return;
		}
		this.selectedItemId = id || null;
		// One event, in the shape of the three beside it - EVENT_WALL_2D_CLICKED,
		// EVENT_CORNER_2D_CLICKED, EVENT_ROOM_2D_CLICKED - carrying the footprint
		// and the id. The application resolves that id to an item and puts it in
		// the one selection it already keeps.
		//
		// Deliberately NOT dispatched through the item commands: the library has
		// no idea there are two views on this document, and coordinating them is
		// the application's job. The clearing case needs no event of its own -
		// `mousedown` has already dispatched EVENT_NOTHING_CLICKED or one of the
		// other three, and every one of those means "not an item".
		if (this.selectedItemId)
		{
			this.floorplan.dispatchEvent({
				type: EVENT_ITEM_2D_CLICKED,
				item: this.floorplan.footprintById(this.selectedItemId),
				id: this.selectedItemId,
			});
		}
	}

	/**
	 * The text label under a point, at a target that stays the same size on
	 * screen (RM-008 E3).
	 *
	 * The pixel-to-centimetre conversion is the same argument `overlappedItem`
	 * makes: at 25 % zoom a fixed centimetre tolerance is a quarter of the target
	 * it was at 100 %, and a target nobody can hit is a feature nobody has.
	 *
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y
	 * @returns {?import('../model/annotation.js').TextAnnotation}
	 */
	overlappedAnnotation(x, y)
	{
		return this.floorplan.overlappedAnnotation(x, y, this.dimensioning.pixelToCm(ANNOTATION_PICK_TOLERANCE_PIXELS));
	}

	/**
	 * The dimension line under a point (RM-008 E3).
	 *
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y
	 * @returns {?import('../model/annotation.js').Dimension}
	 */
	overlappedDimension(x, y)
	{
		return this.floorplan.overlappedDimension(x, y, this.dimensioning.pixelToCm(ANNOTATION_PICK_TOLERANCE_PIXELS));
	}

	/**
	 * Where a corner would pin a point being placed, or the point unchanged
	 * (RM-008 E3).
	 *
	 * A dimension placed on two corners follows them - that is what stops a
	 * drawing lying after the first edit, and `model/annotation.js` argues it at
	 * length. This is the half that decides whether it got one, and it is
	 * deliberately the plan's own `overlappedCorner`, at the plan's own tolerance:
	 * the point where a click counts as being on a corner is a property of this
	 * drawing, not of this tool.
	 *
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y
	 * @returns {{x: number, y: number, cornerId: ?string}}
	 */
	snapToCorner(x, y)
	{
		var corner = this.floorplan.overlappedCorner(x, y, undefined);
		if (corner)
		{
			return {x: corner.x, y: corner.y, cornerId: corner.id};
		}
		return {x: x, y: y, cornerId: null};
	}

	/**
	 * How far a dimension's line would have to move to sit under the pointer
	 * (RM-008 E3).
	 *
	 * The signed distance from the measured line to the pointer, along the same
	 * left-hand normal `dimensionLine()` offsets by - so dragging past the line
	 * flips the dimension to the other side, which is the gesture and the sign
	 * change being one thing rather than two.
	 *
	 * @param {import('../model/annotation.js').Dimension} dimension
	 * @param {number} x Plan space, centimetres.
	 * @param {number} y
	 * @returns {number} Centimetres, signed.
	 */
	offsetToPointer(dimension, x, y)
	{
		var p = dimension.points();
		var dx = p.bx - p.ax;
		var dy = p.by - p.ay;
		var length = Math.sqrt(dx * dx + dy * dy);
		if (!(length > 1e-6))
		{
			return dimension.offset;
		}
		return ((x - p.ax) * (-dy / length)) + ((y - p.ay) * (dx / length));
	}

	/**
	 * Select a dimension or a text label, or clear both (RM-008 E3).
	 *
	 * One method for both because a selection is one thing, and one place that
	 * dispatches because two would eventually disagree about which. This is the
	 * OUTBOUND path - it announces - and {@link Floorplanner2D#showSelection} is
	 * the inbound one, which does not. Keeping the two apart is what makes a
	 * selection loop between the views impossible rather than merely unlikely,
	 * and it is the shape E1 established for items.
	 *
	 * @param {?(import('../model/annotation.js').Dimension|import('../model/annotation.js').TextAnnotation)} target
	 */
	selectAnnotationTarget(target)
	{
		/** @type {?import('../model/annotation.js').Dimension} */
		var dimension = null;
		/** @type {?import('../model/annotation.js').TextAnnotation} */
		var annotation = null;
		if (target)
		{
			// A duck test rather than an instanceof, so a caller across a bundle
			// boundary - the case the peer-dependency note in the README is about -
			// still works. Cast because the two classes are a union here and only
			// one of them has `points`, which is the whole point of asking.
			if (this.selectedAnnotationWasText(target))
			{
				annotation = /** @type {*} */ (target);
			}
			else
			{
				dimension = /** @type {*} */ (target);
			}
		}
		if (this.selectedDimension === dimension && this.selectedAnnotation === annotation)
		{
			return;
		}
		this.selectedDimension = dimension;
		this.selectedAnnotation = annotation;
		if (dimension)
		{
			this.floorplan.dispatchEvent({type: EVENT_DIMENSION_2D_CLICKED, item: dimension, id: dimension.id});
		}
		else if (annotation)
		{
			this.floorplan.dispatchEvent({type: EVENT_ANNOTATION_2D_CLICKED, item: annotation, id: annotation.id});
		}
		this.view.invalidate();
	}

	/**
	 * Place one end of a dimension (RM-008 E3).
	 *
	 * The first click anchors, the second completes and leaves the tool armed for
	 * the next one - a plan being dimensioned needs several, and dropping back to
	 * the pointer after each would make the common case the slow one. Escape and
	 * any tool change clear a half-placed anchor, through `setMode`.
	 *
	 * @returns {?import('../model/annotation.js').Dimension} The dimension the
	 *          second click completed, or null.
	 */
	placeDimensionPoint()
	{
		var point = this.snapToCorner(this.targetX, this.targetY);
		if (!this.dimensionAnchor)
		{
			this.dimensionAnchor = point;
			return null;
		}
		var anchor = this.dimensionAnchor;
		this.dimensionAnchor = null;
		var dimension = this.floorplan.newDimension(anchor.x, anchor.y, point.x, point.y, {
			aCorner: anchor.cornerId,
			bCorner: point.cornerId,
		});
		if (dimension)
		{
			this.selectAnnotationTarget(dimension);
		}
		return dimension;
	}

	/**
	 * Put a text label where the pointer is, and select it (RM-008 E3).
	 *
	 * Drops back to the pointer, unlike the dimension tool above, and the reason
	 * is what happens next: a label is placed in order to be typed into, so the
	 * gesture ends in the inspector rather than on the canvas. The wall tool makes
	 * the same call when a loop closes.
	 *
	 * @returns {?import('../model/annotation.js').TextAnnotation}
	 */
	placeAnnotation()
	{
		var annotation = this.floorplan.newAnnotation(this.targetX, this.targetY);
		if (annotation)
		{
			this.setMode(floorplannerModes.MOVE);
			this.selectAnnotationTarget(annotation);
		}
		return annotation;
	}

	/**
	 * Remove whichever annotation is selected (RM-008 E3).
	 *
	 * Here rather than in the application because the plan is what holds the
	 * selection - the application asks for the delete and this knows what "the
	 * selection" currently means.
	 *
	 * @returns {boolean} Whether anything was removed.
	 */
	deleteSelectedAnnotation()
	{
		var target = this.selectedAnnotation || this.selectedDimension;
		if (!target)
		{
			return false;
		}
		this.selectAnnotationTarget(null);
		return this.selectedAnnotationWasText(target)
			? this.floorplan.removeAnnotation(/** @type {*} */ (target))
			: this.floorplan.removeDimension(/** @type {*} */ (target));
	}

	/**
	 * The same duck test `selectAnnotationTarget` uses, named once.
	 * @param {*} target
	 * @returns {boolean}
	 */
	selectedAnnotationWasText(target)
	{
		return typeof target.points !== 'function';
	}

	/**
	 * Show on the plan what something else selected (RM-008 E1, T-2).
	 *
	 * Before E1 the plan highlighted only what the plan itself had been clicked
	 * on: `selectedWall` reads `_clickedWall`, which is written by `mousedown`
	 * and by nothing else. So selecting a wall in the 3D view changed zero pixels
	 * here - measured, not inferred - and the two views shared nothing but the
	 * inspector.
	 *
	 * This is the inbound path. It writes the same fields a plan click writes and
	 * dispatches NOTHING, which is what stops a selection echoing between the two
	 * views forever. The outbound paths - `mousedown` and `selectItem` - are the
	 * only things here that dispatch.
	 *
	 * A `HalfEdge` is accepted where a `Wall` is expected and unwrapped, because
	 * the 3D view genuinely selects a face rather than a wall (`Main.wallIsClicked`
	 * passes a HalfEdge straight through) and the plan genuinely selects a wall.
	 * They have always been different things behind one name; this is the one
	 * place that has to know it.
	 *
	 * @param {?string} type 'wall', 'corner', 'room', 'item', 'dimension',
	 *        'annotation', or null to clear.
	 * @param {*} target The selected object, or an item id when type is 'item'.
	 */
	showSelection(type, target)
	{
		var wall = null;
		var corner = null;
		var room = null;
		var itemId = null;
		/** @type {?import('../model/annotation.js').Dimension} */
		var dimension = null;
		/** @type {?import('../model/annotation.js').TextAnnotation} */
		var annotation = null;

		if (type === 'wall')
		{
			wall = (target && target.wall) ? target.wall : target;
		}
		else if (type === 'corner')
		{
			corner = target;
		}
		else if (type === 'room')
		{
			room = target;
		}
		else if (type === 'item')
		{
			itemId = (target && target.designId) ? target.designId : target;
		}
		else if (type === 'dimension' || type === 'annotation')
		{
			// An id is accepted as well as the object, because undo restores a
			// selection by id: the object it named is gone, replaced by an equal one
			// built by the load (RM-008 E3). The kind is then taken from what was
			// found rather than from what was asked for, so an id looked up in the
			// wrong collection highlights nothing instead of highlighting the wrong
			// thing.
			var found = (typeof target === 'string') ? this.floorplan.annotationById(target) : target;
			if (found && !this.selectedAnnotationWasText(found))
			{
				dimension = /** @type {*} */ (found);
			}
			else if (found)
			{
				annotation = /** @type {*} */ (found);
			}
		}

		var unchanged = (this._clickedWall === wall)
			&& (this._clickedCorner === corner)
			&& (this._clickedRoom === room)
			&& (this.selectedItemId === (itemId || null))
			&& (this.selectedDimension === dimension)
			&& (this.selectedAnnotation === annotation);
		if (unchanged)
		{
			return;
		}

		this._clickedWall = wall;
		this._clickedCorner = corner;
		this._clickedRoom = room;
		this.selectedItemId = itemId || null;
		this.selectedDimension = dimension;
		this.selectedAnnotation = annotation;
		this.view.invalidate();
	}

	/**
	 * Show an item as selected on the plan because something else selected it.
	 *
	 * The other half of T-2: an item picked in the 3D view, or restored by undo,
	 * has to light up here without this class dispatching a selection of its own
	 * and starting a loop. `selectItem` is the outbound path and this is the
	 * inbound one; keeping them separate is what makes the loop impossible rather
	 * than merely unlikely.
	 *
	 * @param {?string} id
	 */
	showItemSelected(id)
	{
		if (this.selectedItemId === (id || null))
		{
			return;
		}
		this.selectedItemId = id || null;
		this.view.invalidate();
	}

	/**
	 * Put a corner where the drawing target is, and join it to the last one.
	 *
	 * Extracted from `mouseup` by RM-008 E2 so that typing a length is the same
	 * act as clicking, rather than a second implementation of it that drifts.
	 * Nothing about the body changed.
	 *
	 * @returns {?Object} The corner placed, or null outside drawing mode.
	 */
	placeDrawTarget()
	{
		if (this.mode != floorplannerModes.DRAW)
		{
			return null;
		}
		// This creates the corner already
		var corner = this.floorplan.newCorner(this.targetX, this.targetY);

		// further create a newWall based on the newly inserted corners
		// (one in the above line and the other in the previous mouse action
		// of start drawing a new wall)
		if (this.lastNode != null)
		{
			this.floorplan.newWall(this.lastNode, corner);
			this.floorplan.newWallsForIntersections(this.lastNode, corner);
			this.view.invalidate();
		}
		if (corner.mergeWithIntersected() && this.lastNode != null)
		{
			this.setMode(floorplannerModes.MOVE);
		}
		this.lastNode = corner;
		return corner;
	}

	/**
	 * Take the next click of the rectangle tool (RM-008 E2).
	 *
	 * The first sets the anchor; the second draws the room and clears it, so the
	 * tool is immediately ready for another. It stays in RECTANGLE mode rather
	 * than dropping back to MOVE, because somebody laying out a flat draws several
	 * rooms in a row and a tool that resigns after one has to be re-selected five
	 * times.
	 *
	 * @returns {?Array<Object>} The four corners, or null if nothing was drawn.
	 */
	placeRectangleCorner()
	{
		if (this.mode != floorplannerModes.RECTANGLE)
		{
			return null;
		}
		if (!this.rectangleAnchor)
		{
			this.rectangleAnchor = {x: this.targetX, y: this.targetY};
			this.view.invalidate();
			return null;
		}
		var corners = this.floorplan.newRoomFromRectangle(
			this.rectangleAnchor.x, this.rectangleAnchor.y, this.targetX, this.targetY);
		// Cleared whether or not a room was drawn. A refused rectangle is one too
		// small to be a room, and leaving the anchor set would make the next click
		// try to finish the same degenerate one.
		this.rectangleAnchor = null;
		this.view.invalidate();
		return corners;
	}

	/**
	 * Where the wall being drawn currently ends, as a length and a bearing
	 * (RM-008 E2).
	 *
	 * What the plan already draws beside the pointer, as numbers a caller can put
	 * in a field. `angle` is degrees clockwise from east, which is what
	 * `Math.atan2` gives on a canvas whose y grows downwards - the same convention
	 * `snapToAngle` rounds and the same one the plan's own angle readout uses, so
	 * the number in the field is the number on the canvas.
	 *
	 * @returns {?{length: number, angle: number, x: number, y: number}} Null when
	 *          no wall is being drawn - not drawing mode, or no first corner yet.
	 */
	drawTarget()
	{
		if (this.mode != floorplannerModes.DRAW || !this.lastNode)
		{
			return null;
		}
		var dx = this.targetX - this.lastNode.x;
		var dy = this.targetY - this.lastNode.y;
		return {
			length: Math.sqrt((dx * dx) + (dy * dy)),
			angle: Math.atan2(dy, dx) * 180 / Math.PI,
			x: this.targetX,
			y: this.targetY,
		};
	}

	/**
	 * Move the drawing target to an exact length and bearing from the last corner
	 * (RM-008 E2).
	 *
	 * The typed half of "draw to a number". Either argument may be omitted to
	 * keep what the pointer is already saying, which is what makes typing a length
	 * alone useful: the direction stays under the hand and only the distance is
	 * pinned.
	 *
	 * It moves the target and nothing else. `placeDrawTarget()` is what commits
	 * it, so a caller can show the wall before agreeing to it - and so that a
	 * typed length behaves exactly like a click, because it ends in the same call.
	 *
	 * @param {?number} length Centimetres from the last corner, or null to keep
	 *        the current distance.
	 * @param {?number} angle Degrees, as `drawTarget` reports them, or null to
	 *        keep the current bearing.
	 * @returns {boolean} Whether the target moved. False outside drawing mode,
	 *          with no first corner, or for a length that is not a positive
	 *          finite number.
	 */
	setDrawTarget(length, angle)
	{
		var current = this.drawTarget();
		if (!current)
		{
			return false;
		}
		var wanted = (length === null || length === undefined) ? current.length : Number(length);
		var bearing = (angle === null || angle === undefined) ? current.angle : Number(angle);
		if (!isFinite(wanted) || wanted <= 0 || !isFinite(bearing))
		{
			return false;
		}
		// `drawTarget()` returned non-null, which is exactly the test that
		// `this.lastNode` is set - but the checker cannot carry a narrowing across
		// a method call, so the node is read into a local it can see (RM-004 B3).
		var origin = this.lastNode;
		if (!origin)
		{
			return false;
		}
		var radians = bearing * Math.PI / 180;
		this.targetX = origin.x + (Math.cos(radians) * wanted);
		this.targetY = origin.y + (Math.sin(radians) * wanted);
		this.view.invalidate();
		return true;
	}

	/** */
	mouseleave()
	{
		this.mouseDown = false;
	}
	
	__updateInteractiveElements()
	{
		
	}

	/**
	 * Redraw the 2D view.
	 *
	 * Added in S6. The library redraws itself on every event that changes the
	 * plan, so this is only for the cases where something *outside* the plan
	 * changed what a drawn plan should look like - the display unit, the grid
	 * spacing, the zoom scale, the wall-measurement flags. All of those live in
	 * Configuration, which dispatches nothing.
	 *
	 * It exists because the legacy demo reached through to `floorplanner.view.draw()`
	 * in five places (app.js:198, 315, 321, 700, 719) and the Vue app is not
	 * allowed to: `view` is an implementation detail that S7's inspectors would
	 * otherwise pin in place.
	 *
	 * Coalesced since P6, and this is the call that benefits most: `useZoom2D`
	 * asks for a redraw from five places and a zoom gesture reaches several of
	 * them per step. Call `view.draw()` directly for the rare case that needs the
	 * canvas current before the next frame.
	 */
	redraw()
	{
		this.view.invalidate();
	}

	/** */
	/**
	 * Listen to one plan, having stopped listening to the last (RM-010 G1).
	 *
	 * Extracted from the constructor when levels arrived, because a level switch
	 * changes *which* floorplan this view is showing and there was previously no
	 * such thing - the plan a `Floorplanner2D` was constructed with was the plan
	 * it drew forever. Every subscription below was already here; what is new is
	 * that they can be moved.
	 *
	 * @param {Object} floorplan
	 * @returns {void}
	 */
	_subscribePlan(floorplan)
	{
		floorplan.addEventListener(EVENT_LOADED, this._floorplanLoadedEvent);
		floorplan.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, this._updateViewEvent);
		// A new projection is a new picture (RM-008 E1). Same coalesced redraw as
		// every other attribute change - one draw per animation frame, not one per
		// event, which is what P6 established and what makes a drag affordable.
		floorplan.addEventListener(EVENT_ITEMS_PROJECTED, this._updateViewEvent);
		// A dimension moved, a note was typed, north turned (RM-008 E3). Same
		// coalesced redraw, and the same argument: the plan is the only view that
		// draws any of it.
		floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, this._updateViewEvent);
	}

	/** The inverse, so a plan this view has left stops keeping it alive. */
	_unsubscribePlan(floorplan)
	{
		floorplan.removeEventListener(EVENT_LOADED, this._floorplanLoadedEvent);
		floorplan.removeEventListener(EVENT_ITEMS_PROJECTED, this._updateViewEvent);
		floorplan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, this._updateViewEvent);
		floorplan.removeEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.removeEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.removeEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, this._updateViewEvent);
	}

	/**
	 * Draw a different storey's plan (RM-010 G1).
	 *
	 * The gap the live drive found. `Floorplanner2D` holds the `Floorplan` it was
	 * constructed with, in two places - here and on its view - and switching
	 * levels changes which plan is the one being edited. Without this the
	 * switcher moved the model and the 3D view and left the canvas drawing the
	 * ground floor, which looks exactly like a switch that did nothing.
	 *
	 * Idempotent, because the level composable calls it on every
	 * EVENT_LEVELS_CHANGED and most of those are a height edit rather than a
	 * switch.
	 *
	 * @param {Object} floorplan
	 * @returns {void}
	 */
	showFloorplan(floorplan)
	{
		if (!floorplan || floorplan === this.floorplan)
		{
			return;
		}
		this._unsubscribePlan(this.floorplan);
		this.floorplan = floorplan;
		this.view.floorplan = floorplan;
		// The tracing underlay belongs to the plan being drawn, and each plan holds
		// its own; re-pointing it here is what stops the ground floor's sketch
		// following somebody upstairs.
		this.floorplan.carbonSheet = this.view._carbonsheet;
		this._subscribePlan(floorplan);
		this.setMode(floorplannerModes.MOVE);
		this.view.invalidate();
	}

	reset()
	{
		this.view.carbonSheet.clear();
		this.resizeView();
		this.setMode(floorplannerModes.MOVE);
		this.resetOrigin();
		this.view.invalidate();
	}

	/** */
	resizeView()
	{
		this.view.handleWindowResize();
	}

	/** */
	setMode(mode)
	{
		this.lastNode = null;
		// A half-drawn rectangle does not survive leaving the tool (RM-008 E2).
		// Escape resets the mode, so this is also what Escape clears.
		this.rectangleAnchor = null;
		// Same rule for a half-placed dimension (RM-008 E3).
		this.dimensionAnchor = null;
		this.mode = mode;
		this.dispatchEvent({type:EVENT_MODE_RESET, mode: mode});
		this.updateTarget();
	}

	/** Sets the origin so that floorplan is centered */
	resetOrigin()
	{
		// The view owns the canvas' CSS size; the backing bitmap is DPR-scaled and
		// must not be used for layout maths.
		var centerX = this.view.canvasWidth / 2.0;
		var centerY = this.view.canvasHeight / 2.0;

		var centerFloorplan = this.floorplan.getCenter();		
		this.originX = this.dimensioning.cmToPixel(centerFloorplan.x) - centerX;
		this.originY = this.dimensioning.cmToPixel(centerFloorplan.z) - centerY;
		
		this.unScaledOriginX = this.dimensioning.cmToPixel(centerFloorplan.x, false) - centerX;
		this.unScaledOriginY = this.dimensioning.cmToPixel(centerFloorplan.z, false) - centerY;
		
	}
	
	zoom ()
	{
		var centerX = this.view.canvasWidth / 2.0;
		var centerY = this.view.canvasHeight / 2.0;
		var originScreen = new Vector2(centerX, centerY);
		var currentPan = new Vector2(this.unScaledOriginX+centerX, this.unScaledOriginY+centerY);
		currentPan = currentPan.multiplyScalar(this.configuration.getNumericValue('scale')).sub(originScreen);
		
		this.originX = currentPan.x;
		this.originY = currentPan.y;
	}

	/** Convert from THREEjs coords to canvas coords. */
	convertX(x)
	{
		return this.dimensioning.cmToPixel(x - this.dimensioning.pixelToCm(this.originX));
	}

	/** Convert from THREEjs coords to canvas coords. */
	convertY(y)
	{
		return this.dimensioning.cmToPixel(y - this.dimensioning.pixelToCm(this.originY));
	}
}
