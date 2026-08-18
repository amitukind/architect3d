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
import {footprintContains} from '../model/plan_projection.js';

/**
 * How close a pointer has to be to a footprint to pick it, in CANVAS pixels
 * (RM-008 E1). Converted to centimetres per call so the target stays the same
 * size on screen at every zoom.
 */
const ITEM_PICK_TOLERANCE_PIXELS = 4;

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
		floorplan.addEventListener(EVENT_LOADED, this._floorplanLoadedEvent);
		floorplan.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.addEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, this._updateViewEvent);
		floorplan.addEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, this._updateViewEvent);
		// A new projection is a new picture (RM-008 E1). Same coalesced redraw as
		// every other attribute change - one draw per animation frame, not one per
		// event, which is what P6 established and what makes a drag affordable.
		floorplan.addEventListener(EVENT_ITEMS_PROJECTED, this._updateViewEvent);
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

		this.floorplan.removeEventListener(EVENT_LOADED, this._floorplanLoadedEvent);
		this.floorplan.removeEventListener(EVENT_ITEMS_PROJECTED, this._updateViewEvent);
		this.floorplan.removeEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, this._updateViewEvent);
		this.floorplan.removeEventListener(EVENT_WALL_ATTRIBUTES_CHANGED, this._updateViewEvent);
		this.floorplan.removeEventListener(EVENT_ROOM_ATTRIBUTES_CHANGED, this._updateViewEvent);

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
		
		if(this.gridsnapmode || this.configuration.getNumericValue('snapToGrid'))
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
		
		
		var mDownCorner = this.floorplan.overlappedCorner(this.mouseX, this.mouseY, undefined);
		var mDownWall = this.floorplan.overlappedWall(this.mouseX, this.mouseY, undefined);
		var mDownItem = this.overlappedItem(this.mouseX, this.mouseY);
		var mDownRoom = this.floorplan.overlappedRoom(this.mouseX, this.mouseY);
		this._clickedWallControl = null;

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
		if (this.mode == floorplannerModes.DRAW || (this.mode == floorplannerModes.MOVE && this.mouseDown))
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
		if (this.mouseDown && !this.activeCorner && !this.activeWall && !this._clickedWallControl && !this._draggingItemId)
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
		if (this.mode == floorplannerModes.DRAW && !this.mouseMoved)
		{
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
	 * @param {?string} type 'wall', 'corner', 'room', 'item', or null to clear.
	 * @param {*} target The selected object, or an item id when type is 'item'.
	 */
	showSelection(type, target)
	{
		var wall = null;
		var corner = null;
		var room = null;
		var itemId = null;

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

		var unchanged = (this._clickedWall === wall)
			&& (this._clickedCorner === corner)
			&& (this._clickedRoom === room)
			&& (this.selectedItemId === (itemId || null));
		if (unchanged)
		{
			return;
		}

		this._clickedWall = wall;
		this._clickedCorner = corner;
		this._clickedRoom = room;
		this.selectedItemId = itemId || null;
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
