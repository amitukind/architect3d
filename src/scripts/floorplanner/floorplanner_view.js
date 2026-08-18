// @ts-check
import {Vector2} from 'three';
import {WallTypes} from '../core/constants.js';
import {Utils} from '../core/utils.js';
import {EVENT_UPDATED} from '../core/events.js';

import {gridSpacing, configWallThickness} from '../core/configuration.js';
import {resolveCanvas, measureViewport, pixelRatio} from '../core/dom.js';
import {footprintCorners} from '../model/plan_projection.js';

/**
 * Item types the plan draws as openings in a wall rather than as boxes on it
 * (RM-008 E1): WallItem (2), InWallItem (3), InWallFloorItem (7) and
 * WallFloorItem (9). The same four `useCatalog` calls wall-bound, and the same
 * four the save-format documentation lists - named here rather than imported
 * because `src/scripts` does not import from `src/app`, and duplicated with
 * this note rather than silently.
 */
const WALL_BOUND_ITEM_TYPES = [2, 3, 7, 9];
/** InWallFloorItem - a door. The only opening that gets a swing arc. */
const ITEM_TYPE_IN_WALL_FLOOR = 7;
/** OnFloorItem - a rug. Drawn before everything else so furniture sits on it. */
const ITEM_TYPE_ON_FLOOR = 8;
/**
 * Below this on-screen size, in canvas pixels, an item's caption is suppressed.
 * The same judgement `drawEdgeLabel` makes about wall lengths at 60, scaled to
 * the smaller thing being labelled.
 */
const ITEM_LABEL_MIN_PIXELS = 34;
import {CarbonSheet} from './carbonsheet.js';


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
 * @typedef {import('./floorplanner.js').Floorplanner2D} Floorplanner2D
 */
/** */
export const floorplannerModes = {MOVE: 0,DRAW: 1,DELETE: 2};

// grid parameters
//export const gridSpacing = this.dimensioning.cmToPixel(25);//20; // pixels
export const gridWidth = 1;
export const gridColor = '#f1f1f1';

// room config
export const roomColor = '#fedaff66';
export const roomColorHover = '#008cba66';
export const roomColorSelected = '#00ba8c66';

// wall config
export var wallWidth = 5;
export var wallWidthHover = 7;
export var wallWidthSelected = 9;
export const wallColor = '#dddddd';
export const wallColorHover = '#008cba';
export const wallColorSelected = '#00ba8c';

export const edgeColor = '#888888';
export const edgeColorHover = '#008cba';
export const edgeWidth = 1;

export const deleteColor = '#ff0000';

// corner config
export const cornerRadius = 3;
export const cornerRadiusHover = 6;
export const cornerRadiusSelected = 9;
export const cornerColor = '#cccccc';
export const cornerColorHover = '#008cba';
export const cornerColorSelected = '#00ba8c';

/**
 * Everything the 2D view paints with, in one mutable object.
 *
 * ## Why this exists
 *
 * Every colour above is an `export const`, which made the drawing surface
 * unthemable by construction: a host could read `wallColorHover` but never
 * change it. That was survivable while the app had one light theme baked into
 * a Bootstrap stylesheet. It is not survivable now - the application ships a
 * dark theme, and a canvas that keeps drawing #f1f1f1 hairlines and #000000
 * text inside a near-black shell is not "the 2D view in dark mode", it is an
 * unreadable rectangle.
 *
 * ## Why the constants are still there
 *
 * They are the seed values for this object and they remain exported. All 21 of
 * them are part of the library's public surface (blueprint.js:39-43), so
 * deleting them to make room for a palette would break an embedder to save a
 * duplicate literal. Instead the constants define the *defaults* and this
 * object defines what is *in use*: an embedder that never calls
 * `setFloorplannerPalette` gets pixel-identical output to before.
 *
 * Keys that have no constant above were hardcoded hex literals scattered
 * through the drawing methods - the origin crosshair's blue and red, the
 * label's black-on-white halo, the bezier control handles' greens. Those were
 * unreachable from outside by any means at all.
 */
export const floorplannerPalette = {
	/** Painted before anything else. Null leaves the canvas transparent, which
	 * is what the view did for its whole life - the page background showed
	 * through. */
	background: null,

	grid: gridColor,
	/** Every `gridMajorEvery`-th line, drawn heavier. See drawGrid. */
	gridMajor: gridColor,
	gridMajorEvery: 4,

	room: roomColor,
	roomHover: roomColorHover,
	roomSelected: roomColorSelected,

	wall: wallColor,
	wallHover: wallColorHover,
	wallSelected: wallColorSelected,

	edge: edgeColor,
	edgeHover: edgeColorHover,

	corner: cornerColor,
	cornerHover: cornerColorHover,
	cornerSelected: cornerColorSelected,

	delete: deleteColor,

	/** Dimension text, and the halo stroked behind it so a label stays legible
	 * over a filled room. */
	label: '#000000',
	labelHalo: '#ffffff',
	/** Room area and room name, which are drawn with their own emphasis. */
	area: '#0000FF',
	roomName: '#363636',
	/** The measurement typeface. Sans in the original; the application sets a
	 * mono stack so canvas dimensions match the ones in the inspector. */
	labelFont: 'Arial',

	/** The angle arc drawn while dragging a new wall. */
	angleGuide: '#FF0000',
	/** The right-angle / arc marks on a selected corner. */
	cornerAngle: '#000000',

	/** The two arms of the origin marker. */
	originPrimary: '#0000FF',
	originSecondary: '#FF0000',

	/** Bezier control handles on a selected curved wall. */
	curveHandle: '#D7D7D7',
	curveGuide: '#00FF00',
	curveGuideShadow: '#006600',
	/** The casing stroked under every curved wall. */
	curveCasing: '#999999',
	/** The drag puck on a curved wall's control point. */
	wallControl: '#F7F7F7',

	/**
	 * Furniture on the plan (RM-008 E1).
	 *
	 * Deliberately quieter than the walls: the plan is a drawing of a building
	 * and the furniture is what is standing in it, so a sofa must not out-draw
	 * the wall it stands against. Fill is translucent for the same reason - two
	 * items that overlap should look like two items, not one opaque blob.
	 */
	item: '#7E8CA3',
	itemFill: 'rgba(126,140,163,0.16)',
	itemHover: '#FF8A3D',
	itemSelected: '#2B5DA8',
	/** Locked items, which cannot be dragged and should not invite the attempt. */
	itemFixed: '#A9B2C1',
	/** The tick on the front edge, which is what tells a chair's facing. */
	itemFacing: '#5D6F83',
	/** Doors and windows, drawn into the wall run rather than as boxes on it. */
	opening: '#2B5DA8',
	openingFill: '#FFFFFF',
	itemLabel: '#5D6F83',
};

/**
 * Merge `values` into the live palette.
 *
 * Unknown keys are ignored rather than added, so a caller cannot silently
 * misspell `wallHover` into a key nothing reads. Returns the palette.
 *
 * Redrawing is the caller's job - `Floorplanner2D.redraw()` - because a theme
 * change usually arrives with several other changes and one draw at the end is
 * the right number.
 *
 * @param {Object} values
 * @returns {Object} the live palette
 */
export function setFloorplannerPalette(values)
{
	if (!values)
	{
		return floorplannerPalette;
	}
	Object.keys(values).forEach(function (key)
	{
		if (Object.prototype.hasOwnProperty.call(floorplannerPalette, key))
		{
			floorplannerPalette[key] = values[key];
		}
	});
	return floorplannerPalette;
}

/**
 * Ask for an animation frame, or say there is no frame clock to ask.
 *
 * Read off `window` at call time rather than captured at module load, because
 * the jsdom suites install and remove their stubs between tests and a captured
 * reference would keep pointing at a torn-down one. Returns null where there is
 * no rAF at all - a non-visual jsdom, a server render - and the caller draws
 * synchronously instead, which is what the view did everywhere before P6.
 *
 * @returns {?number} the frame handle, or null if there is no frame clock
 */
function requestFrame(callback)
{
	if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function')
	{
		return window.requestAnimationFrame(callback);
	}
	return null;
}

function cancelFrame(handle)
{
	if (handle !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function')
	{
		window.cancelAnimationFrame(handle);
	}
}

/**
 * The View to be used by a Floorplanner to render in/interact with.
 */
export class FloorplannerView2D
{
	/**
	 * @param {Floorplan} floorplan
	 * @param {Floorplanner2D} viewmodel
	 * @param {(HTMLCanvasElement|string)} canvas The canvas to draw into, or its
	 * element id. The id form is the deprecated back-compat path.
	 */
	constructor(floorplan, viewmodel, canvas)
	{
		this.canvasElement = resolveCanvas(canvas, 'floorplanner canvas');
		/** Kept for back-compat: callers used to read `.canvas` as an element id. */
		this.canvas = (typeof canvas === 'string') ? canvas : this.canvasElement.id;
		// Non-null by construction (RM-005 C2). `getContext('2d')` returns null
		// only when the canvas already holds a context of another kind - a webgl
		// one, say - which for this canvas is a programming error and not a state
		// to draw around. Throwing here means the ~90 draw calls downstream do not
		// each have to ask, and the message names the canvas rather than surfacing
		// as `Cannot read properties of null` inside a render loop.
		var context = this.canvasElement.getContext('2d');
		if (!context)
		{
			throw new Error('architect3d: the floorplanner canvas already has a context that is not 2d.');
		}
		this.context = context;
		this.floorplan = floorplan;
		this.viewmodel = viewmodel;

		/** Canvas size in CSS pixels. Every drawing routine works in these units;
		 * the backing bitmap is `pixelRatio()` times larger (see _resizeCanvas). */
		this.canvasWidth = 0;
		this.canvasHeight = 0;
		this._pixelRatio = 1;
		/** @type {?HTMLElement} The canvas's parent, measured for sizing. */
		this._container = this.canvasElement.parentElement;
		this._disposed = false;

		/** Handle of the frame `invalidate()` has scheduled, or null. See invalidate. */
		this._frame = null;
		/** Size a deferred resize will apply before it draws, or null. See containerResized. */
		this._pendingResize = null;

		var scope = this;
		this._carbonsheet = new CarbonSheet(floorplan, viewmodel, this.canvasElement);
		// Coalesced (P6): the sheet has eight setters and each one dispatches, so
		// dragging its opacity or nudging its origin used to be one full repaint
		// per slider step.
		this._carbonSheetUpdatedEvent = function()
		{
			scope.invalidate();
		};
		this._carbonsheet.addEventListener(EVENT_UPDATED, this._carbonSheetUpdatedEvent);

		this.floorplan.carbonSheet = this._carbonsheet;

		// Named handlers, so dispose() can actually take them off again.
		this._windowResizeEvent = function() {scope.handleWindowResize();};
		this._orientationChangeEvent = function() {scope.orientationChange();};
		this._containerResizeEvent = function() {scope.containerResized();};

		// Container-driven sizing. The window listeners stay as a fallback for the
		// case measureViewport() covers - a container with no layout size of its
		// own, where the viewport is the only thing that can change.
		if (typeof ResizeObserver === 'function' && this._container)
		{
			this._resizeObserver = new ResizeObserver(this._containerResizeEvent);
			this._resizeObserver.observe(this._container);
		}
		else
		{
			this._resizeObserver = null;
		}
		window.addEventListener('resize', this._windowResizeEvent);
		window.addEventListener('orientationchange', this._orientationChangeEvent);
		this.handleWindowResize();
	}

	get carbonSheet()
	{
		return this._carbonsheet;
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

	orientationChange()
	{
		this.handleWindowResize();
	}

	/**
	 * Resize to the container and redraw.
	 *
	 * Named for the jQuery-era window handler it replaces - app.js and example.js
	 * both call it through Floorplanner2D.resizeView(), so the name is API.
	 */
	handleWindowResize()
	{
		var size = measureViewport(this._container, window.innerWidth, window.innerHeight);
		// This measurement is newer than anything containerResized deferred, so it
		// supersedes it rather than being undone by it a frame later.
		this._pendingResize = null;
		this._resizeCanvas(size.width, size.height);
		this.draw();
	}

	/**
	 * ResizeObserver callback. Unlike handleWindowResize this is a no-op when the
	 * measured size has not actually changed, which keeps the observer from
	 * re-triggering itself through the canvas it just resized.
	 *
	 * ## Why the resize itself is deferred, and not just the draw (P6)
	 *
	 * This used to size the canvas inside the callback. Writing `style.width` on
	 * an element the observer's own target contains is a layout change made
	 * during resize-observation, and the browser answers it the only way it can:
	 * it defers the follow-up delivery to the next frame and reports
	 * `ResizeObserver loop completed with undelivered notifications` as a window
	 * error. Nothing was dropped and nothing was wrong, but a page cannot tell
	 * that error apart from a real one, and P5's browser tier had to swallow it
	 * by exact message to keep every layout test from failing on it.
	 *
	 * Measuring is still done here - the observer callback is the moment the
	 * measurement is correct - and only the write is moved to the frame, where it
	 * is an ordinary layout change like any other.
	 */
	containerResized()
	{
		var size = measureViewport(this._container, window.innerWidth, window.innerHeight);
		if (size.width === this.canvasWidth && size.height === this.canvasHeight)
		{
			return;
		}
		this._pendingResize = size;
		this.invalidate();
	}

	/**
	 * Ask for a redraw on the next animation frame (P6, RM-002 R-05).
	 *
	 * ## What this changes
	 *
	 * `view.draw()` used to be called synchronously from fourteen sites, three of
	 * them reached from `pointermove`. A drag therefore repainted the whole
	 * canvas - grid, carbon sheet, every room, every wall, every corner and every
	 * dimension label - once per pointer event, on the input thread, and a mouse
	 * that reports at 1000 Hz got 1000 full repaints a second for a display that
	 * can show 60. The work past the first one per frame was thrown away
	 * unpainted.
	 *
	 * Calling this instead marks the view dirty and schedules exactly one
	 * `draw()` for the next frame. Further calls before that frame runs are free.
	 *
	 * ## What it does not change
	 *
	 * `draw()` is untouched: still synchronous, still public, still the way to
	 * say "paint now". Embedders call it, `handleWindowResize()` calls it, and
	 * the browser tier reads pixels straight after it. Deferring *that* would
	 * have made a documented API return before doing its job.
	 *
	 * The distinction is between the two kinds of caller. Something reacting to
	 * input, where the next event is milliseconds away, wants `invalidate()`.
	 * Something that has just been told to redraw and whose caller will look at
	 * the result wants `draw()`.
	 *
	 * ## Ordering
	 *
	 * Coalescing moves a draw to after the mutations that follow it in the same
	 * task, which is the behaviour change RM-002 flagged as needing its own
	 * review. It is safe here because `draw()` reads the model afresh every time
	 * - it holds no display list - so a later draw of the same frame's final
	 * state is the picture the immediate draws were converging on anyway.
	 */
	invalidate()
	{
		if (this._disposed || this._frame !== null)
		{
			return;
		}

		var scope = this;
		var handle = requestFrame(function ()
		{
			scope._frame = null;
			scope._runFrame();
		});

		if (handle === null)
		{
			// No frame clock. Behave exactly as the direct call used to.
			this._runFrame();
			return;
		}
		this._frame = handle;
	}

	/**
	 * Run whatever `invalidate()` scheduled, now, and report whether there was
	 * anything to run.
	 *
	 * For callers that need the canvas current before they look at it: a test
	 * asserting on pixels, or a host about to read the canvas back into an image.
	 * Without it the only way to wait out a coalesced draw is to await a frame,
	 * which is neither synchronous nor deterministic.
	 *
	 * @returns {boolean} true if a scheduled draw was pending and has now run
	 */
	flush()
	{
		if (this._frame === null)
		{
			return false;
		}
		cancelFrame(this._frame);
		this._frame = null;
		this._runFrame();
		return true;
	}

	/**
	 * The scheduled work: apply a deferred resize if one is waiting, then draw.
	 *
	 * The disposal check is the point of this being a method rather than a
	 * closure body. A frame scheduled on the last pointermove before a component
	 * unmounts still fires, and by then the carbon sheet is disposed and the
	 * canvas is detached - `dispose()` cancels the frame, and this is the second
	 * line of defence for a frame that was already in flight.
	 */
	_runFrame()
	{
		if (this._disposed)
		{
			return;
		}

		var size = this._pendingResize;
		this._pendingResize = null;
		if (size && (size.width !== this.canvasWidth || size.height !== this.canvasHeight))
		{
			this._resizeCanvas(size.width, size.height);
		}

		this.draw();
	}

	/**
	 * Keep whatever was in the middle of the canvas in the middle of the canvas.
	 *
	 * The pan origin is the plan coordinate at the canvas' top-left corner, so a
	 * resize that leaves it alone pins the plan to that corner: widen the pane
	 * and the drawing stays left, narrow it and the drawing slides off the right
	 * edge. That was tolerable when the only thing that resized was the browser
	 * window; it is not, now that there is a divider a user drags to resize the
	 * pane deliberately and continuously.
	 *
	 * The correction is half the size delta:
	 *
	 *     screenX = (planX - pixelToCm(originX)) * pixelsPerCm * scale
	 *
	 * so holding the plan coordinate at the centre across a change from W to W'
	 * needs `originX -= (W' - W) / 2`, in pixels. `unScaledOriginX` - the copy
	 * `Floorplanner2D.zoom()` re-derives the scaled origin from - is recomputed
	 * from the result rather than adjusted in parallel, so the two cannot drift.
	 *
	 * Skipped on the very first sizing pass, where the previous size is zero:
	 * there is nothing on screen to hold in place, and `resetOrigin()` is what
	 * establishes the initial view.
	 */
	_recentreForResize(cssWidth, cssHeight)
	{
		if (!this.canvasWidth || !this.canvasHeight || !this.viewmodel)
		{
			return;
		}

		var dx = (cssWidth - this.canvasWidth) / 2.0;
		var dy = (cssHeight - this.canvasHeight) / 2.0;
		if (dx === 0 && dy === 0)
		{
			return;
		}

		this.viewmodel.originX -= dx;
		this.viewmodel.originY -= dy;

		// The inverse of what zoom() does: it reads
		// `(unScaledOrigin + centre) * scale - centre`, so this is that solved for
		// the unscaled value against the NEW centre.
		var scale = this.configuration.getNumericValue('scale') || 1;
		var centreX = cssWidth / 2.0;
		var centreY = cssHeight / 2.0;
		this.viewmodel.unScaledOriginX = ((this.viewmodel.originX + centreX) / scale) - centreX;
		this.viewmodel.unScaledOriginY = ((this.viewmodel.originY + centreY) / scale) - centreY;
	}

	/**
	 * Size the canvas in CSS pixels while giving it a backing bitmap scaled by the
	 * device pixel ratio, then scale the context to match. Everything downstream
	 * keeps drawing in CSS pixels and comes out crisp on a retina display.
	 */
	_resizeCanvas(cssWidth, cssHeight)
	{
		var dpr = pixelRatio();
		var bitmapWidth = Math.max(1, Math.round(cssWidth * dpr));
		var bitmapHeight = Math.max(1, Math.round(cssHeight * dpr));

		this._recentreForResize(cssWidth, cssHeight);

		this.canvasWidth = cssWidth;
		this.canvasHeight = cssHeight;
		this._pixelRatio = dpr;

		this.canvasElement.style.width = `${cssWidth}px`;
		this.canvasElement.style.height = `${cssHeight}px`;
		if (this.canvasElement.width !== bitmapWidth || this.canvasElement.height !== bitmapHeight)
		{
			this.canvasElement.width = bitmapWidth;
			this.canvasElement.height = bitmapHeight;
		}
		// Assigning width/height resets the 2D context - transform included - so
		// this has to happen after, every time.
		this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	/**
	 * Detach from the window, the container and the carbon sheet. Safe to call
	 * more than once.
	 */
	dispose()
	{
		if (this._disposed)
		{
			return;
		}
		this._disposed = true;

		// Before anything else is torn down. A frame scheduled by the last
		// pointermove is still queued at this point, and letting it run would draw
		// through a disposed carbon sheet into a detached canvas.
		cancelFrame(this._frame);
		this._frame = null;
		this._pendingResize = null;

		if (this._resizeObserver)
		{
			this._resizeObserver.disconnect();
			this._resizeObserver = null;
		}
		window.removeEventListener('resize', this._windowResizeEvent);
		window.removeEventListener('orientationchange', this._orientationChangeEvent);

		this._carbonsheet.removeEventListener(EVENT_UPDATED, this._carbonSheetUpdatedEvent);
		this._carbonsheet.dispose();
		if (this.floorplan.carbonSheet === this._carbonsheet)
		{
			this.floorplan.carbonSheet = null;
		}
		this._container = null;
	}

	/** */
	draw()
	{
		wallWidth = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness));
		wallWidthHover = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness))*0.7;
		wallWidthSelected = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness))*0.9;
		
		// CSS pixels, not bitmap pixels - the context carries the DPR scale.
		this.context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

		// A themed canvas has to paint its own ground. Left transparent the page
		// showed through, which was fine when the page was white and is not when
		// it is near-black behind a light plan. Null keeps the old behaviour.
		if (floorplannerPalette.background)
		{
			this.context.fillStyle = floorplannerPalette.background;
			this.context.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
		}

		this._carbonsheet.draw();
		this.drawGrid();
		this.drawOriginCrossHair();

		this.floorplan.getRooms().forEach((room) => {this.drawRoom(room);});

		this.floorplan.getWalls().forEach((wall) => {this.drawWall(wall);});
		this.floorplan.getCorners().forEach((corner) => {
			this.drawCorner(corner);
			});

		// Furniture, after the building and before the drawing aids (RM-008 E1).
		//
		// The order is why this is one line here rather than a branch inside
		// drawRoom: a footprint sits ON the floor of a room and UNDER the wall it
		// is against, and the wall pass has already run. Aids - the wall being
		// drawn, its angle arc, the control puck - are transient and belong on
		// top of everything.
		this.drawItems();

		if (this.viewmodel.mode == floorplannerModes.DRAW)
		{
			this.drawTarget(this.viewmodel.targetX, this.viewmodel.targetY, this.viewmodel.lastNode);
			//Enable the below lines for measurement while drawing, still needs work as it is crashing the whole thing
			if(this.viewmodel.lastNode != null && this.viewmodel.lastNode != undefined)
			{
				var a = new Vector2(this.viewmodel.lastNode.x,this.viewmodel.lastNode.y);
				var b = new Vector2(this.viewmodel.targetX, this.viewmodel.targetY);
				var abvector = b.clone().sub(a);
				var midPoint = abvector.multiplyScalar(0.5).add(a);
				this.drawTextLabel(this.dimensioning.cmToMeasure(a.distanceTo(b)), this.viewmodel.convertX(midPoint.x), this.viewmodel.convertY(midPoint.y));
				
				//Show angle to the nearest wall
				var vector = b.clone().sub(a);
				var sAngle = (vector.angle()*180) / Math.PI;
				var result = this.viewmodel.lastNode.closestAngle(sAngle);				
				var eAngle = result['angle'];
				var closestVector = result['point'].sub(a);
				
				var textDistance = 60;
				var radius = Math.min(textDistance, vector.length());
				var location = vector.normalize().add(closestVector.normalize()).multiplyScalar(textDistance).add(a);
				
				var ox = this.viewmodel.convertX(this.viewmodel.lastNode.x);
				var oy = this.viewmodel.convertY(this.viewmodel.lastNode.y);
				var angle = Math.abs(eAngle - sAngle);
				angle = (angle > 180) ? 360 - angle : angle;
				angle = Math.round(angle * 10) / 10;				
				
				sAngle = (sAngle * Math.PI) / 180;
				eAngle = (eAngle * Math.PI) / 180;				
				
				this.context.strokeStyle = floorplannerPalette.angleGuide;
				this.context.lineWidth = 4;
				this.context.beginPath();
				this.context.arc(ox, oy, radius*0.5, Math.min(sAngle, eAngle), Math.max(sAngle, eAngle), false);
				this.context.stroke();
				this.drawTextLabel(`${angle}°`, this.viewmodel.convertX(location.x), this.viewmodel.convertY(location.y));
			}
		}
		this.floorplan.getWalls().forEach((wall) => {this.drawWallLabels(wall);});
		if(this.viewmodel._clickedWallControl != null)
		{
			this.drawCircle(this.viewmodel.convertX(this.viewmodel._clickedWallControl.x), this.viewmodel.convertY(this.viewmodel._clickedWallControl.y), 7, floorplannerPalette.wallControl);
		}
	}
	
	/**
	 * @depreceated
	 */
	zoom()
	{
		var originx = this.canvasWidth / 2.0;
		var originy = this.canvasHeight / 2.0;
		var dpr = this._pixelRatio;

		// The DPR scale is the identity for everything drawn here, so a reset means
		// "back to the DPR transform", never "back to 1:1".
		this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
		if(this.configuration.getNumericValue('scale') != 1)
		{
			this.context.translate(originx, originy);
			this.context.scale(this.configuration.getNumericValue('scale'), this.configuration.getNumericValue('scale'));
			this.context.translate(-originx, -originy);
		}
		this.draw();
	}
	
	/**
	 * Every item in the design, as a footprint (RM-008 E1).
	 *
	 * Reads `floorplan.itemProjection` - plain data handed over by `Model` - and
	 * never touches an item. See `model/plan_projection.js` for why the 2D view
	 * is given a description rather than the scene: a `Floorplan` has no path to
	 * a `Scene`, measured rather than assumed, and giving it one would put the
	 * GPU inside the plain-data layer.
	 *
	 * Costs 0.032 ms for twenty footprints and 0.197 ms for a hundred and fifty,
	 * measured before this was written (RM-008 T-4), against a 36-room plan that
	 * draws in 0.593 ms. Nothing here is conditional on a count, for that reason.
	 *
	 * Rugs first, so furniture standing on one is drawn over it - the one
	 * ordering rule inside the pass, and the same one the 3D view applies by
	 * giving `OnFloorItem` its own class.
	 */
	drawItems()
	{
		var projection = this.floorplan.itemProjection;
		if (!projection || !projection.length)
		{
			return;
		}
		var scope = this;
		projection.forEach(function (footprint)
		{
			if (footprint.type === ITEM_TYPE_ON_FLOOR)
			{
				scope.drawItem(footprint);
			}
		});
		projection.forEach(function (footprint)
		{
			if (footprint.type !== ITEM_TYPE_ON_FLOOR)
			{
				scope.drawItem(footprint);
			}
		});
	}

	/**
	 * One footprint.
	 *
	 * An item with no size draws nothing: that is an item still downloading, and
	 * a dot where a wardrobe is about to appear is worse than nothing. It stays
	 * in the projection regardless, because the count is what M-23 asserts.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawItem(footprint)
	{
		if (footprint.halfWidth <= 0 || footprint.halfDepth <= 0)
		{
			return;
		}
		if (WALL_BOUND_ITEM_TYPES.indexOf(footprint.type) !== -1)
		{
			this.drawOpening(footprint);
			return;
		}

		var corners = footprintCorners(footprint).map((corner) => ({
			x: this.viewmodel.convertX(corner.x),
			y: this.viewmodel.convertY(corner.y),
		}));
		var state = this.itemState(footprint);
		var stroke = (state === 'selected') ? floorplannerPalette.itemSelected
			: (state === 'hover') ? floorplannerPalette.itemHover
				: (footprint.fixed ? floorplannerPalette.itemFixed : floorplannerPalette.item);

		this.drawPolygon(
			corners.map((corner) => corner.x),
			corners.map((corner) => corner.y),
			true, floorplannerPalette.itemFill,
			true, stroke, (state === 'plain') ? 1.5 : 2.5);

		this.drawItemFacing(corners, floorplannerPalette.itemFacing);
		this.drawItemLabel(footprint);
	}

	/**
	 * The tick across the front edge.
	 *
	 * Without it a rectangle says where a chair is and not which way it faces,
	 * and facing is most of what a furniture plan is read for. Drawn as a
	 * chevron into the item rather than an arrow out of it, so it stays inside
	 * the footprint and cannot be read as a dimension line.
	 *
	 * @param {Array<{x: number, y: number}>} corners In canvas pixels.
	 * @param {string} color
	 */
	drawItemFacing(corners, color)
	{
		// footprintCorners returns the item's own -x-y, +x-y, +x+y, -x+y, so 0
		// and 1 are the front edge whatever the rotation is.
		var left = corners[0];
		var right = corners[1];
		var back = corners[3];
		var depth = 0.22;
		var apexX = ((left.x + right.x) / 2) + ((back.x - left.x) * depth);
		var apexY = ((left.y + right.y) / 2) + ((back.y - left.y) * depth);
		this.drawLine(left.x, left.y, apexX, apexY, 1.5, color);
		this.drawLine(right.x, right.y, apexX, apexY, 1.5, color);
	}

	/**
	 * The item's name, under it.
	 *
	 * Suppressed below a size threshold in CANVAS pixels rather than
	 * centimetres, because the question is whether a caption fits beside the
	 * thing it names on screen - the same test `drawEdgeLabel` applies to wall
	 * lengths at 60, and the reason a plan zoomed out to a whole house is not a
	 * field of overlapping words.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawItemLabel(footprint)
	{
		if (!footprint.label)
		{
			return;
		}
		var widthOnScreen = this.dimensioning.cmToPixel(footprint.halfWidth * 2);
		var depthOnScreen = this.dimensioning.cmToPixel(footprint.halfDepth * 2);
		if (Math.min(widthOnScreen, depthOnScreen) < ITEM_LABEL_MIN_PIXELS)
		{
			return;
		}
		this.drawTextLabel(
			footprint.label,
			this.viewmodel.convertX(footprint.x),
			this.viewmodel.convertY(footprint.y) + (depthOnScreen / 2) + 12,
			floorplannerPalette.itemLabel,
			floorplannerPalette.labelHalo);
	}

	/**
	 * A door or a window, drawn into the wall rather than onto it.
	 *
	 * An opening is a gap in a wall, and a plan that draws it as a box sitting
	 * on the wall reads as furniture pushed against it. So the wall run is
	 * masked over the opening's width, the reveal is stroked on both sides, and
	 * a door adds the quarter-circle swing every architectural plan uses. This
	 * draws the hole `three/edge.js:471` already cuts in the 3D wall - the same
	 * opening, drawn the way a plan draws one.
	 *
	 * The swing is a convention, not a measurement: nothing in the model records
	 * a hinge side or an opening angle yet. That is F1's work (RM-007 Q-2), and
	 * until then every door swings the same way and the arc says "door" rather
	 * than "this door opens like this".
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawOpening(footprint)
	{
		var corners = footprintCorners(footprint).map((corner) => ({
			x: this.viewmodel.convertX(corner.x),
			y: this.viewmodel.convertY(corner.y),
		}));
		var state = this.itemState(footprint);
		var color = (state === 'selected') ? floorplannerPalette.itemSelected
			: (state === 'hover') ? floorplannerPalette.itemHover : floorplannerPalette.opening;

		this.drawPolygon(
			corners.map((corner) => corner.x),
			corners.map((corner) => corner.y),
			true, floorplannerPalette.openingFill, false, color, 0);
		this.drawLine(corners[0].x, corners[0].y, corners[1].x, corners[1].y, 2, color);
		this.drawLine(corners[3].x, corners[3].y, corners[2].x, corners[2].y, 2, color);

		if (footprint.type === ITEM_TYPE_IN_WALL_FLOOR)
		{
			this.drawDoorSwing(corners, color);
		}
	}

	/**
	 * The quarter circle a door leaf sweeps.
	 *
	 * @param {Array<{x: number, y: number}>} corners In canvas pixels.
	 * @param {string} color
	 */
	drawDoorSwing(corners, color)
	{
		var hinge = corners[0];
		var leafX = corners[1].x - corners[0].x;
		var leafY = corners[1].y - corners[0].y;
		var radius = Math.sqrt((leafX * leafX) + (leafY * leafY));
		if (radius < 4)
		{
			return;
		}
		var start = Math.atan2(leafY, leafX);
		this.context.strokeStyle = color;
		this.context.lineWidth = 1;
		this.context.beginPath();
		this.context.arc(hinge.x, hinge.y, radius, start, start + (Math.PI / 2), false);
		this.context.stroke();
		this.drawLine(hinge.x, hinge.y,
			hinge.x + (radius * Math.cos(start + (Math.PI / 2))),
			hinge.y + (radius * Math.sin(start + (Math.PI / 2))), 1, color);
	}

	/**
	 * How a footprint should be drawn: plain, hovered or selected.
	 *
	 * Both ids come off the view model, which is where every other hover and
	 * selection state on this canvas already lives - `activeWall`, `activeCorner`,
	 * `activeRoom`. One more of the same kind, rather than a second mechanism.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 * @returns {string} 'plain', 'hover' or 'selected'
	 */
	itemState(footprint)
	{
		if (this.viewmodel.selectedItemId === footprint.id)
		{
			return 'selected';
		}
		if (this.viewmodel.activeItemId === footprint.id)
		{
			return 'hover';
		}
		return 'plain';
	}

	drawCornerAngles(corner)
	{
		var ox = this.viewmodel.convertX(corner.location.x);
		var oy = this.viewmodel.convertY(corner.location.y);
		var offsetRatio = 2.0;
		for (var i=0;i<corner.angles.length;i++)
		{
			var direction = corner.angleDirections[i];
			var location = direction.clone().add(corner.location);
			var sAngle = (corner.startAngles[i]*Math.PI)/180;
			var eAngle = (corner.endAngles[i]*Math.PI)/180;
			var angle = corner.angles[i];
			var lx = this.viewmodel.convertX(location.x);
			var ly = this.viewmodel.convertY(location.y);
			var radius = direction.length() * offsetRatio * 0.5;
			if( angle > 130 || angle == 0)
			{
				continue;
			}
			var ccwise = (Math.abs(corner.startAngles[i] - corner.endAngles[i]) > 180);			
			this.context.strokeStyle = floorplannerPalette.cornerAngle;
			this.context.lineWidth = 4;
			this.context.beginPath();
			if(angle == 90)
			{
				var location2 = direction.clone().multiplyScalar(offsetRatio).add(corner.location);
				var lxx = this.viewmodel.convertX(location2.x);
				var lyy = this.viewmodel.convertY(location2.y);
				var b = {x:lxx, y:oy};
				var c = {x:lxx, y:lyy};
				var d = {x:ox, y:lyy};
				this.drawLine(b.x,b.y,c.x,c.y,this.context.lineWidth,this.context.strokeStyle);
				this.drawLine(c.x,c.y,d.x,d.y,this.context.lineWidth,this.context.strokeStyle);
			}
			else
			{
				this.context.arc(ox, oy, radius, Math.min(sAngle, eAngle), Math.max(sAngle, eAngle), ccwise);
			}
			
			this.context.stroke();
			this.drawTextLabel(`${angle}°`, lx, ly);
		}
		
	}

	drawOriginCrossHair()
	{
		var ox = this.viewmodel.convertX(0);
		var oy = this.viewmodel.convertY(0);
		
		// Two nested plus signs. Note that the second pair are fillRects and the
		// line between them assigns strokeStyle, which fillRect never reads - so
		// all four rectangles have always been drawn in the first colour and the
		// "secondary" one has never appeared. Preserved: this is the marker the
		// app has always shown, and making the inner cross a second colour is a
		// change to the drawing, not a theming decision. The palette entry is
		// still honoured so a host that wants two colours can set the fill.
		this.context.fillStyle = floorplannerPalette.originPrimary;
		this.context.fillRect(ox-2, oy-7.5, 4, 15);
		this.context.fillRect(ox-7.5, oy-2, 15, 4);
		this.context.strokeStyle = floorplannerPalette.originSecondary;
		this.context.fillRect(ox-1.25, oy-5, 2.5, 10);
		this.context.fillRect(ox-5, oy-1.25, 10, 2.5);
	}

	/** */
	drawWallLabels(wall)
	{
		// we'll just draw the shorter label... idk
		if (wall.backEdge && wall.frontEdge)
		{
			if (wall.backEdge.interiorDistance() < wall.frontEdge.interiorDistance())
			{
				this.drawEdgeLabel(wall.backEdge);
				this.drawEdgeLabelExterior(wall.backEdge);
			}
			else
			{
				this.drawEdgeLabel(wall.frontEdge);
				this.drawEdgeLabelExterior(wall.frontEdge);
			}
		}
		else if (wall.backEdge)
		{
			this.drawEdgeLabel(wall.backEdge);
			this.drawEdgeLabelExterior(wall.backEdge);
		}
		else if (wall.frontEdge)
		{
			this.drawEdgeLabel(wall.frontEdge);
			this.drawEdgeLabelExterior(wall.frontEdge);
		}
		this.drawWallLabelsMiddle(wall);
	}

	drawWallLabelsMiddle(wall)
	{
		if(! this.configuration.wallInformation.midline)
		{
			return;
		}
		var pos = wall.wallCenter();
		var length = wall.wallLength();
		if (length < 60)
		{
			// dont draw labels on walls this short
			return;
		}
		var label = (!this.configuration.wallInformation.labels)?'':this.configuration.wallInformation.midlinelabel;
		this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.viewmodel.convertX(pos.x),this.viewmodel.convertY(pos.y));
	}

	/** */
	drawEdgeLabelExterior(edge)
	{
		var pos = edge.exteriorCenter();
		var length = edge.exteriorDistance();
		if (length < 60)
		{
			// dont draw labels on walls this short
			return;
		}
		if(this.configuration.wallInformation.exterior)
		{
			var label = (!this.configuration.wallInformation.labels)?'':this.configuration.wallInformation.exteriorlabel;
			this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.viewmodel.convertX(pos.x),this.viewmodel.convertY(pos.y+40));
		}
	}

	/** */
	drawEdgeLabel(edge)
	{
		var pos = edge.interiorCenter();
		var length = edge.interiorDistance();
		if (length < 60)
		{
			// dont draw labels on walls this short
			return;
		}
		if(this.configuration.wallInformation.interior)
		{
			var label = (!this.configuration.wallInformation.labels)?'':this.configuration.wallInformation.interiorlabel;
			this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.viewmodel.convertX(pos.x),this.viewmodel.convertY(pos.y-40));
		}
		
	}

	/**
	 * @param {string} label
	 * @param {number} x
	 * @param {number} y
	 * @param {?string} [textcolor] Null or absent means "use the theme".
	 * @param {?string} [strokecolor] Same.
	 * @param {string} [style]
	 *
	 * The two colour parameters default to `null` in the signature, which types
	 * them AS null - so every caller passing a real colour was an error and the
	 * two assignments below were too (RM-005 C2).
	 */
	drawTextLabel(label, x, y, textcolor=null, strokecolor=null, style='normal')
	{
		// Defaulting through the palette rather than in the signature: a default
		// parameter is evaluated per call, so `floorplannerPalette.label` would
		// work here too - but an explicit `undefined` and an explicit `null` are
		// both "use the theme", and callers pass both.
		textcolor = textcolor || floorplannerPalette.label;
		strokecolor = strokecolor || floorplannerPalette.labelHalo;
		this.context.font = `${style} 12px ${floorplannerPalette.labelFont}`;
		this.context.fillStyle = textcolor;
		this.context.textBaseline = 'middle';
		this.context.textAlign = 'center';
		this.context.strokeStyle = strokecolor;
		this.context.lineWidth = 4;
		this.context.strokeText(label,x,y);
		this.context.fillText(label,x,y);
	}

	/** */
	drawEdge(edge, hover, curved=false)
	{
		var color = floorplannerPalette.edge;
		if (hover && this.viewmodel.mode == floorplannerModes.DELETE)
		{
			color = floorplannerPalette.delete;
		}
		else if (hover)
		{
			color = floorplannerPalette.edgeHover;
		}
		var corners = edge.corners();
		var scope = this;
		if(!curved)
		{
			this.drawPolygon(
					Utils.map(corners, function (corner) 
					{
						return scope.viewmodel.convertX(corner.x);
					}),
					Utils.map(corners, function (corner) 
							{
								return scope.viewmodel.convertY(corner.y);
							}),false,null,true,color,edgeWidth);
		}
//		else
		
	}
	
	/** */
	drawWall(wall)
	{
		var selected = (wall === this.viewmodel.selectedWall);
		var hover = (wall === this.viewmodel.activeWall && wall != this.viewmodel.selectedWall);
		var color = floorplannerPalette.wall;

		if (hover && this.viewmodel.mode == floorplannerModes.DELETE)
		{
			color = floorplannerPalette.delete;
		}
		else if (hover)
		{
			color = floorplannerPalette.wallHover;
		}
		else if(selected)
		{
			color = floorplannerPalette.wallSelected;
		}
		var isCurved = (wall.wallType == WallTypes.CURVED);
		if(wall.wallType == WallTypes.CURVED && selected)
		{
			
			
			// The third casing line used to read '#06600' - five hex digits, an
			// invalid colour that canvas ignores, so the segment kept whatever
			// strokeStyle the previous drawLine had left behind. That happened to
			// be the same '#006600', which is why nobody ever saw it. Reading the
			// palette three times draws exactly what was on screen and stops the
			// typo being load-bearing.
			var guideShadow = floorplannerPalette.curveGuideShadow;
			var guide = floorplannerPalette.curveGuide;
			this.drawLine(this.viewmodel.convertX(wall.getStartX()),this.viewmodel.convertY(wall.getStartY()),this.viewmodel.convertX(wall.a.x),this.viewmodel.convertY(wall.a.y),5,guideShadow);
			this.drawLine(this.viewmodel.convertX(wall.a.x),this.viewmodel.convertY(wall.a.y),this.viewmodel.convertX(wall.b.x),this.viewmodel.convertY(wall.b.y),5,guideShadow);
			this.drawLine(this.viewmodel.convertX(wall.b.x),this.viewmodel.convertY(wall.b.y),this.viewmodel.convertX(wall.getEndX()),this.viewmodel.convertY(wall.getEndY()),5,guideShadow);

			this.drawLine(this.viewmodel.convertX(wall.getStartX()),this.viewmodel.convertY(wall.getStartY()),this.viewmodel.convertX(wall.a.x),this.viewmodel.convertY(wall.a.y),1,guide);
			this.drawLine(this.viewmodel.convertX(wall.a.x),this.viewmodel.convertY(wall.a.y),this.viewmodel.convertX(wall.b.x),this.viewmodel.convertY(wall.b.y),1,guide);
			this.drawLine(this.viewmodel.convertX(wall.b.x),this.viewmodel.convertY(wall.b.y),this.viewmodel.convertX(wall.getEndX()),this.viewmodel.convertY(wall.getEndY()),1,guide);

			this.drawCircle(this.viewmodel.convertX(wall.a.x), this.viewmodel.convertY(wall.a.y), 10, floorplannerPalette.curveHandle);
			this.drawCircle(this.viewmodel.convertX(wall.b.x), this.viewmodel.convertY(wall.b.y), 10, floorplannerPalette.curveHandle);
		}
		
		if(wall.wallType == WallTypes.STRAIGHT)
		{
			this.drawLine(this.viewmodel.convertX(wall.getStartX()),this.viewmodel.convertY(wall.getStartY()),this.viewmodel.convertX(wall.getEndX()),this.viewmodel.convertY(wall.getEndY()),hover ? wallWidthHover : selected ? wallWidthSelected : wallWidth,color);
		}
		else
		{
			
			this.drawCurvedLine(
					this.viewmodel.convertX(wall.getStartX()),
					this.viewmodel.convertY(wall.getStartY()),
					
					this.viewmodel.convertX(wall.a.x),
					this.viewmodel.convertY(wall.a.y),
					
					this.viewmodel.convertX(wall.b.x),
					this.viewmodel.convertY(wall.b.y),
					
					this.viewmodel.convertX(wall.getEndX()),
					this.viewmodel.convertY(wall.getEndY()),
					hover ? wallWidthHover : selected ? wallWidthSelected : wallWidth,color);
			
		}
		
		if (!hover && !selected && wall.frontEdge)
		{
			this.drawEdge(wall.frontEdge, hover, isCurved);
		}
		if (!hover && !selected && wall.backEdge)
		{
			this.drawEdge(wall.backEdge, hover, isCurved);
		}
		
		if(selected)
		{			
			if(wall.wallType != WallTypes.CURVED)
			{
				this.drawCornerAngles(wall.start);
				this.drawCornerAngles(wall.end);
			}
		}
		// Removed in S2: a 3px red dot was drawn at the canvas centre on every
		// single wall draw. It was a debugging leftover, not a feature - nothing
		// referenced it and no UI explained it.
	}

	/** */
	drawRoom(room)
	{
		var selected = (room === this.viewmodel.selectedRoom);
		var hover = (room === this.viewmodel.activeRoom && room != this.viewmodel.selectedRoom);
		var color = floorplannerPalette.room;
		if (hover)
		{
			color = floorplannerPalette.roomHover;
		}
		else if (selected)
		{
			color = floorplannerPalette.roomSelected;
		}
		
		var polygonPoints = [];
		
		for (var i=0;i<room.roomCornerPoints.length;i++)
		{
			polygonPoints.push([room.roomCornerPoints[i]]);
		}
		
		this.drawPolygonCurved(polygonPoints, true, color);
		
		// '#00FF0000' is an eight-digit hex with a zero alpha: a transparent halo,
		// i.e. no halo. Kept - the room label sits on the room's own fill, which
		// is already a flat colour, and a halo there would read as a smudge.
		this.drawTextLabel(this.dimensioning.cmToMeasure(room.area, 2)+String.fromCharCode(178), this.viewmodel.convertX(room.areaCenter.x), this.viewmodel.convertY(room.areaCenter.y), floorplannerPalette.area, '#00FF0000', 'bold');
		this.drawTextLabel(room.name, this.viewmodel.convertX(room.areaCenter.x), this.viewmodel.convertY(room.areaCenter.y+30), floorplannerPalette.roomName, '#00FF0000', 'bold italic');
	}

	/** */
	drawCorner(corner)
	{
		var cornerX = this.viewmodel.convertX(corner.x);
		var cornerY = this.viewmodel.convertY(corner.y);
		var hover = (corner === this.viewmodel.activeCorner && corner != this.viewmodel.selectedCorner);
		var selected = (corner === this.viewmodel.selectedCorner);
		var color = floorplannerPalette.corner;
		if (hover && this.viewmodel.mode == floorplannerModes.DELETE)
		{
			color = floorplannerPalette.delete;
		}
		else if (hover)
		{
			color = floorplannerPalette.cornerHover;
		}
		else if (selected)
		{
			color = floorplannerPalette.cornerSelected;
		}
		
		if(selected)
		{
			this.drawCornerAngles(corner);
			corner.adjacentCorners().forEach((neighbour) => 
			{
				this.drawCornerAngles(neighbour);
			});
		}
		
		this.drawCircle(cornerX, cornerY, hover ? cornerRadiusHover : selected ? cornerRadiusSelected : cornerRadius, color);
	}

	/** */
	drawTarget(x, y, lastNode)
	{
		this.drawCircle(this.viewmodel.convertX(x),this.viewmodel.convertY(y),cornerRadiusHover,floorplannerPalette.cornerHover);
		if (lastNode)
		{
			this.drawLine(this.viewmodel.convertX(lastNode.x),this.viewmodel.convertY(lastNode.y),this.viewmodel.convertX(x),this.viewmodel.convertY(y),wallWidthHover,floorplannerPalette.wallHover);
		}
	}
	
	drawBezierObject(bezier, width=3, color='#f0f0f0')
	{
		this.drawCurvedLine(
		this.viewmodel.convertX(bezier.points[0].x),
		this.viewmodel.convertY(bezier.points[0].y),
		
		this.viewmodel.convertX(bezier.points[1].x),
		this.viewmodel.convertY(bezier.points[1].y),
		
		this.viewmodel.convertX(bezier.points[2].x),
		this.viewmodel.convertY(bezier.points[2].y),
		
		this.viewmodel.convertX(bezier.points[3].x),
		this.viewmodel.convertY(bezier.points[3].y),
		width,color);
	}
	
	drawCurvedLine(startX, startY, aX, aY, bX, bY, endX, endY, width, color)
	{
		this.context.beginPath();
		this.context.moveTo(startX, startY);
		this.context.bezierCurveTo(aX, aY, bX, bY, endX, endY);
		this.context.lineWidth = width+3;
		this.context.strokeStyle = floorplannerPalette.curveCasing;
		this.context.stroke();
		
		// width is an integer
		// color is a hex string, i.e. #ff0000
		this.context.beginPath();
		this.context.moveTo(startX, startY);
		this.context.bezierCurveTo(aX, aY, bX, bY, endX, endY);
		this.context.lineWidth = width;
		this.context.strokeStyle = color;
		this.context.stroke();
	}

	/** */
	drawLine(startX, startY, endX, endY, width, color)
	{
		// width is an integer
		// color is a hex string, i.e. #ff0000
		this.context.beginPath();
		this.context.moveTo(startX, startY);
		this.context.lineTo(endX, endY);
		this.context.closePath();
		this.context.lineWidth = width;
		this.context.strokeStyle = color;
		this.context.stroke();
	}
	
	/** */
	drawPolygonCurved(pointsets, fill=true, fillColor='#FF00FF', stroke=false, strokeColor='#000000', strokeWidth=5)
	{
		// fillColor is a hex string, i.e. #ff0000
		fill = fill || false;
		stroke = stroke || false;
		this.context.beginPath();
		
		for (var i=0;i<pointsets.length;i++)
		{
			var pointset = pointsets[i];
//			The pointset represents a straight line if there are only 1 point in the pointset
			if(pointset.length == 1)
			{
				if(i == 0)
				{
					this.context.moveTo(this.viewmodel.convertX(pointset[0].x), this.viewmodel.convertY(pointset[0].y));
				}
				else
				{
					this.context.lineTo(this.viewmodel.convertX(pointset[0].x), this.viewmodel.convertY(pointset[0].y));
				}				
			}
//			If the pointset contains 3 points then it represents a bezier curve, ap1, ap2, cp2
			else if(pointset.length == 3)
			{
				this.context.bezierCurveTo(
						this.viewmodel.convertX(pointset[0].x), this.viewmodel.convertY(pointset[0].y),
						this.viewmodel.convertX(pointset[1].x), this.viewmodel.convertY(pointset[1].y),
						this.viewmodel.convertX(pointset[2].x), this.viewmodel.convertY(pointset[2].y)
						);
			}
		}
		
		this.context.closePath();
		if (fill)
		{
			this.context.fillStyle = fillColor;
			this.context.fill();
		}
		if (stroke)
		{
			this.context.lineWidth = strokeWidth;
			this.context.strokeStyle = strokeColor;
			this.context.stroke();
		}
	}

	/** */
	drawPolygon(xArr, yArr, fill, fillColor, stroke, strokeColor, strokeWidth)
	{
		// fillColor is a hex string, i.e. #ff0000
		fill = fill || false;
		stroke = stroke || false;
		this.context.beginPath();
		this.context.moveTo(xArr[0], yArr[0]);
		for (var i = 1; i < xArr.length; i++)
		{
			this.context.lineTo(xArr[i], yArr[i]);
		}
		this.context.closePath();
		if (fill)
		{
			this.context.fillStyle = fillColor;
			this.context.fill();
		}
		if (stroke)
		{
			this.context.lineWidth = strokeWidth;
			this.context.strokeStyle = strokeColor;
			this.context.stroke();
		}
	}

	/** */
	drawCircle(centerX, centerY, radius, fillColor)
	{
		this.context.beginPath();
		this.context.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
		this.context.closePath();
		this.context.fillStyle = fillColor;
		this.context.fill();
	}

	/** returns n where -gridSize/2 < n <= gridSize/2  */
	calculateGridOffset(n)
	{
		var gspacing = this.dimensioning.cmToPixel(this.configuration.getNumericValue(gridSpacing));
		if (n >= 0)
		{
			return (n + (gspacing) / 2.0) % (gspacing) - (gspacing) / 2.0;
		}
		else
		{
			return (n - (gspacing) / 2.0) % (gspacing) + (gspacing) / 2.0;
		}
	}

	/**
	 * The graph paper under the plan.
	 *
	 * Two weights now, not one. Every `gridMajorEvery`-th line is drawn in
	 * `gridMajor` - at the default 25 cm spacing that is a heavier line each
	 * metre, so the plan reads as metre squares subdivided into quarters instead
	 * of one undifferentiated mesh. The old single-weight grid is still exactly
	 * reachable: the palette seeds `gridMajor` to the same colour as `grid`, so
	 * an embedder that never themes anything gets the pixels it always got.
	 *
	 * ## Which line is major, and why it is not `x % 4`
	 *
	 * `x` counts from the left edge of the canvas, and `offsetX` slides the whole
	 * lattice as the plan is panned. Keying off `x` alone would make the heavy
	 * lines crawl through the grid while panning, because line `x` is a different
	 * world coordinate at every scroll position. The index below is derived from
	 * the *origin* instead, so a major line is always the same line in the plan.
	 */
	drawGrid()
	{
		var gspacing = this.dimensioning.cmToPixel(this.configuration.getNumericValue(gridSpacing));
		var offsetX = this.calculateGridOffset(-this.viewmodel.originX);
		var offsetY = this.calculateGridOffset(-this.viewmodel.originY);
		var width = this.canvasWidth;
		var height = this.canvasHeight;
		var scale = this.configuration.getNumericValue('scale');
		if(scale < 1.0)
		{
			width = width / scale;
			height = height / scale;
		}

		var every = Math.max(0, Math.round(floorplannerPalette.gridMajorEvery));
		// How many whole cells the origin sits to the left of / above the canvas.
		// Math.round because offsetX already snapped the lattice to a cell.
		var firstX = Math.round((offsetX + this.viewmodel.originX) / gspacing);
		var firstY = Math.round((offsetY + this.viewmodel.originY) / gspacing);

		function isMajor(index)
		{
			// `every` of 0 or 1 means "no major lines" and "every line is major"
			// respectively; both fall out of the modulo, but 0 would divide by
			// zero, so it is answered directly.
			return (every > 0) && (((index % every) + every) % every === 0);
		}

		for (var x = 0; x <= (width / gspacing); x++)
		{
			var major = isMajor(firstX + x);
			this.drawLine((gspacing * x) + offsetX, 0, (gspacing * x) + offsetX, height, major ? gridWidth + 0.5 : gridWidth, major ? floorplannerPalette.gridMajor : floorplannerPalette.grid);
		}
		for (var y = 0; y <= (height / gspacing); y++)
		{
			var majorY = isMajor(firstY + y);
			this.drawLine(0, (gspacing * y) + offsetY, width, (gspacing * y) + offsetY, majorY ? gridWidth + 0.5 : gridWidth, majorY ? floorplannerPalette.gridMajor : floorplannerPalette.grid);
		}
	}
}
