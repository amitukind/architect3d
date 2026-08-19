// @ts-check
import {Vector2} from 'three';
import {WallTypes} from '../core/constants.js';
import {Utils} from '../core/utils.js';
import {EVENT_UPDATED} from '../core/events.js';

import {gridSpacing, configWallThickness, configWallHeight} from '../core/configuration.js';
import {resolveCanvas, measureViewport, pixelRatio} from '../core/dom.js';
import {footprintCorners} from '../model/plan_projection.js';
import {dimensionLine} from '../model/annotation.js';
import {stairPlan, normaliseStair} from '../items/stair.js';
import {isOverhead, normaliseStructure, SECTION_ROUND} from '../items/structure.js';
import {OPENING_DOOR as OPENING_KIND_DOOR, OPENING_WINDOW as OPENING_KIND_WINDOW} from '../items/opening.js';
import {CanvasBackend} from './backends.js';

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

/** The size every measurement on this canvas has been drawn at since it was written. */
const LABEL_SIZE_PIXELS = 12;

/**
 * The gap between what a dimension measures and where its witness line starts,
 * and how far that line runs past the dimension line, in CSS pixels (RM-008 E3).
 *
 * Screen pixels rather than centimetres so the drawing looks the same at every
 * zoom - the gap is a typographic space, not a distance in the building.
 */
const WITNESS_GAP_PIXELS = 6;
const WITNESS_OVERSHOOT_PIXELS = 7;

/** Half-length of the tick drawn where a dimension line meets its witness line. */
const DIMENSION_TICK_PIXELS = 5;

/** The dot drawn at a text label's anchor, which is what a click actually targets. */
const ANNOTATION_ANCHOR_PIXELS = 3;

/**
 * The north arrow's radius and its inset from the top-right of the canvas, in
 * CSS pixels.
 *
 * Fixed to the canvas rather than placed on the plan, because it describes the
 * whole drawing rather than a place in it - so it must not pan away, and its
 * size must not change with the zoom.
 */
const NORTH_RADIUS_PIXELS = 17;
const NORTH_INSET_PIXELS = 30;

/**
 * The vertical step between the lines stacked at a room's centre, in CSS pixels
 * (RM-008 E3).
 *
 * Screen pixels, not plan centimetres, and the difference is not cosmetic. The
 * name used to be offset 30 *centimetres* below the area while both were drawn
 * at a fixed 12 px, so the gap between two lines of type shrank with the zoom:
 * at the default scale 30 cm is about 16 px, which is one line height, and the
 * two labels touched. That was invisible until E3's declutter pass started
 * asking whether they touched - at which point the room's own name vanished
 * under its own area, at the default zoom, on every plan.
 *
 * A stack of type is typography. It is spaced in the units type is measured in,
 * the same choice the font size and the witness-line gaps already make.
 */
const ROOM_LABEL_STEP_PIXELS = 17;

/** Air around a label when deciding whether two of them collide, in CSS pixels. */
const LABEL_PADDING_PIXELS = 2;
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
/**
 * RECTANGLE added by RM-008 E2. The three before it are the demo's and their
 * numbers are load-bearing in nothing persisted - modes are interface state,
 * never written to a file - but they are appended to rather than renumbered,
 * because an embedder may have the old values in its own code.
 */
/**
 * What a click does.
 *
 * MOVE, DRAW and DELETE are original; RECTANGLE arrived with RM-008 E2 and the
 * two annotation tools with E3. Numbered rather than named because the values
 * are compared across the library/application boundary and are persisted in
 * nothing - a new tool appends, and no existing number moves.
 */
export const floorplannerModes = {MOVE: 0,DRAW: 1,DELETE: 2,RECTANGLE: 3,DIMENSION: 4,TEXT: 5};

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
	/**
	 * A generated flight (RM-008 F3).
	 *
	 * The same family as an opening rather than as furniture, because a stair is
	 * part of the building: it is drawn, not placed in a room. The stairwell hint
	 * is deliberately the annotation hue - it is the one mark here that is not
	 * the building, because there is no floor above it yet.
	 */
	stair: '#2B5DA8',
	stairFill: 'rgba(43,93,168,0.07)',
	stairTread: 'rgba(43,93,168,0.55)',
	stairWell: '#8A6D3B',
	/**
	 * A column or a beam (RM-008 F2).
	 *
	 * A column is drawn nearly solid because a plan is a section about a metre
	 * up and the column is cut by it - that heavy fill is what "cut" means on a
	 * building drawing. A beam is above the section, so it is dashed and hollow.
	 * One palette entry, two weights, because they are one thing seen from two
	 * sides of the cut.
	 */
	structure: '#3F4A5A',
	structureFill: 'rgba(63,74,90,0.55)',

	/**
	 * What the plan says about itself (RM-008 E3).
	 *
	 * A distinct hue from everything else on the canvas, and the reason is not
	 * decoration: dimensions and notes are the only marks here that are NOT the
	 * building. A reader has to be able to tell "this wall is 3.6 m long" from
	 * "there is a wall here" at a glance, and colour is what does that on every
	 * drawing anybody has ever read.
	 */
	dimension: '#8A6D3B',
	dimensionHover: '#FF8A3D',
	dimensionSelected: '#2B5DA8',
	annotation: '#4A4A4A',
	annotationHover: '#FF8A3D',
	annotationSelected: '#2B5DA8',
	/** The north arrow, which is chrome rather than drawing: fixed to the canvas. */
	north: '#5D6F83',
	/** Room type and ceiling height, under the room name. */
	roomType: '#5D6F83',
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
		/**
		 * Where text has already been put this frame, in canvas pixels (RM-008 E3).
		 * Cleared at the top of every draw. See `reserveLabel`.
		 * @type {Array<{x: number, y: number, w: number, h: number}>}
		 */
		this._labelBoxes = [];
		/**
		 * Where this view draws, and what it draws through (RM-008 E4).
		 *
		 * `backend` is the eleven drawing operations - see `backends.js` - and
		 * `project` is what turns plan centimetres into the coordinates those
		 * operations take. Both are fields rather than hard references so that
		 * `renderTo()` can point the same drawing code at a different sheet: the
		 * export is not a second implementation of the plan, it is this one
		 * pointed somewhere else, which is the entire reason T-5 was worth
		 * measuring.
		 *
		 * `project` defaults to the viewmodel, which is where `convertX` and
		 * `convertY` have always lived, so the screen path is unchanged.
		 *
		 * @type {import('./backends.js').CanvasBackend|Object}
		 */
		this.backend = new CanvasBackend(this.context, floorplannerPalette.labelFont);
		/** @type {{convertX: function(number): number, convertY: function(number): number}} */
		this.project = viewmodel;
		/**
		 * True while drawing a sheet rather than the screen.
		 *
		 * An export is the document, not the session: hover, selection and the
		 * half-drawn wall under the pointer are all state that belongs to the
		 * person at the keyboard and none of it belongs on paper.
		 *
		 * @type {boolean}
		 */
		this.exporting = false;
		/**
		 * How far the north arrow sits in from the top-right corner, in pixels.
		 *
		 * A field rather than the constant it defaults to, because a sheet has a
		 * margin and the screen does not: at the screen's figure the arrow on an
		 * exported plan landed in the margin with half of it above the printed
		 * border. Found by exporting a sheet and looking at it. Set from the sheet
		 * by `renderTo`.
		 *
		 * @type {number}
		 */
		this.chromeInset = NORTH_INSET_PIXELS;

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
	/**
	 * Whether hover and selection should be drawn at all (RM-008 E4).
	 *
	 * False on a sheet. Which wall is highlighted is a fact about the person at
	 * the keyboard, not about the building, and a printed drawing with one wall
	 * in selection green is a drawing that has to be explained. Every colour
	 * decision on this canvas goes through this, so a new one added later is
	 * wrong on the sheet only if somebody forgets - and the export test asserts
	 * the palette's emphasis colours are absent from the document.
	 *
	 * @returns {boolean}
	 */
	get emphasis()
	{
		return !this.exporting;
	}

	/**
	 * Draw this plan somewhere that is not the screen (RM-008 E4).
	 *
	 * The whole of plan export, as far as this class is concerned. It swaps the
	 * backend and the projection, draws, and puts them back - so a sheet is
	 * produced by the same `draw()` the canvas uses, walking the same rooms,
	 * walls, corners, footprints, dimensions and labels in the same order.
	 *
	 * That is the property worth having and it is the reason T-5 was measured
	 * before this sprint was priced: a second renderer would be a second thing to
	 * keep in step with every future drawing change, and the first time it fell
	 * behind, an exported sheet would quietly stop matching the screen.
	 *
	 * Transient state is suppressed rather than filtered afterwards - see
	 * `exporting`. The canvas size is set from the sheet, because `drawGrid` and
	 * the north arrow both need to know how big the page is.
	 *
	 * @param {Object} backend Any of `backends.js`.
	 * @param {{convertX: function(number): number, convertY: function(number): number}} project
	 * @param {{width: number, height: number, inset?: number}} size In the
	 *        backend's pixels. `inset` is how far chrome - the north arrow - sits
	 *        in from the edge, which on a sheet has to clear the margin.
	 * @returns {void}
	 */
	renderTo(backend, project, size)
	{
		var wasBackend = this.backend;
		var wasProject = this.project;
		var wasWidth = this.canvasWidth;
		var wasHeight = this.canvasHeight;
		var wasInset = this.chromeInset;
		this.backend = backend;
		this.project = project;
		this.canvasWidth = size.width;
		this.canvasHeight = size.height;
		this.chromeInset = (typeof size.inset === 'number') ? size.inset : NORTH_INSET_PIXELS;
		this.exporting = true;
		try
		{
			this.draw();
		}
		finally
		{
			// A throw here would otherwise leave the live view drawing into the
			// export - the same reason `loadFloorplan` wraps its batch.
			this.backend = wasBackend;
			this.project = wasProject;
			this.canvasWidth = wasWidth;
			this.canvasHeight = wasHeight;
			this.chromeInset = wasInset;
			this.exporting = false;
		}
	}

	draw()
	{
		wallWidth = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness));
		wallWidthHover = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness))*0.7;
		wallWidthSelected = this.dimensioning.cmToPixel(this.configuration.getNumericValue(configWallThickness))*0.9;
		
		// CSS pixels, not bitmap pixels - the context carries the DPR scale.
		this.backend.clear(this.canvasWidth, this.canvasHeight);

		// A themed canvas has to paint its own ground. Left transparent the page
		// showed through, which was fine when the page was white and is not when
		// it is near-black behind a light plan. Null keeps the old behaviour.
		if (floorplannerPalette.background)
		{
			this.backend.fillRect(0, 0, this.canvasWidth, this.canvasHeight, floorplannerPalette.background);
		}

		// Who gets the space, decided before anything is drawn (RM-008 E3). See
		// `reserveLabel`: priority is a property of the text, not of the pass it is
		// drawn in, so the two cannot be the same ordering.
		this._labelBoxes.length = 0;
		this.reserveAuthoredLabels();

		// The tracing underlay, the grid and the origin marker are all aids for the
		// person drawing, not part of the drawing (RM-008 E4). A sheet carries the
		// building; a screen carries the building and the tools.
		if (!this.exporting)
		{
			this._carbonsheet.draw();
			this.drawGrid();
			this.drawOriginCrossHair();
		}

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

		// What the plan says about itself, over what it says about the building
		// (RM-008 E3). Both are part of the document, so both go under the
		// transient aids below and over everything that is drawn from the graph -
		// a dimension that disappeared behind the wall it measures would be
		// useless, and one drawn over the wall being dragged would be in the way.
		this.drawDimensions();
		this.drawAnnotations();

		if (!this.exporting)
		{
			this.drawAlignmentGuides();
		}

		if (!this.exporting && this.viewmodel.mode == floorplannerModes.RECTANGLE)
		{
			this.drawRectanglePreview();
		}

		if (!this.exporting && this.viewmodel.mode == floorplannerModes.DIMENSION)
		{
			this.drawDimensionPreview();
		}

		if (!this.exporting && this.viewmodel.mode == floorplannerModes.DRAW)
		{
			this.drawTarget(this.viewmodel.targetX, this.viewmodel.targetY, this.viewmodel.lastNode);
			//Enable the below lines for measurement while drawing, still needs work as it is crashing the whole thing
			if(this.viewmodel.lastNode != null && this.viewmodel.lastNode != undefined)
			{
				var a = new Vector2(this.viewmodel.lastNode.x,this.viewmodel.lastNode.y);
				var b = new Vector2(this.viewmodel.targetX, this.viewmodel.targetY);
				var abvector = b.clone().sub(a);
				var midPoint = abvector.multiplyScalar(0.5).add(a);
				this.drawTextLabel(this.dimensioning.cmToMeasure(a.distanceTo(b)), this.project.convertX(midPoint.x), this.project.convertY(midPoint.y));
				
				//Show angle to the nearest wall
				var vector = b.clone().sub(a);
				var sAngle = (vector.angle()*180) / Math.PI;
				var result = this.viewmodel.lastNode.closestAngle(sAngle);				
				var eAngle = result['angle'];
				var closestVector = result['point'].sub(a);
				
				var textDistance = 60;
				var radius = Math.min(textDistance, vector.length());
				var location = vector.normalize().add(closestVector.normalize()).multiplyScalar(textDistance).add(a);
				
				var ox = this.project.convertX(this.viewmodel.lastNode.x);
				var oy = this.project.convertY(this.viewmodel.lastNode.y);
				var angle = Math.abs(eAngle - sAngle);
				angle = (angle > 180) ? 360 - angle : angle;
				angle = Math.round(angle * 10) / 10;				
				
				sAngle = (sAngle * Math.PI) / 180;
				eAngle = (eAngle * Math.PI) / 180;				
				
				this.backend.arc(ox, oy, radius*0.5, Math.min(sAngle, eAngle), Math.max(sAngle, eAngle), 4, floorplannerPalette.angleGuide);
				this.drawTextLabel(`${angle}°`, this.project.convertX(location.x), this.project.convertY(location.y));
			}
		}
		this.floorplan.getWalls().forEach((wall) => {this.drawWallLabels(wall);});
		// Last, and in screen coordinates: the arrow is chrome fixed to the canvas
		// rather than a mark on the plan, so nothing may draw over it. It IS on the
		// sheet - a plan without one does not say which way the building faces.
		this.drawNorthArrow();
		if(!this.exporting && this.viewmodel._clickedWallControl != null)
		{
			this.drawCircle(this.project.convertX(this.viewmodel._clickedWallControl.x), this.project.convertY(this.viewmodel._clickedWallControl.y), 7, floorplannerPalette.wallControl);
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
	 * Where text has already been put this frame, in canvas pixels (RM-008 E3).
	 *
	 * ## Why a plan needs this at all
	 *
	 * E1 shipped furniture captions with one rule - suppress below 34 pixels of
	 * on-screen size - and flagged that it is not enough: two chairs beside each
	 * other are both big enough and their captions still land on top of one
	 * another. E3 makes it worse before it makes it better, because a room can now
	 * carry four stacked lines and a person can put text anywhere they like. A
	 * drawing whose whole objective is to be readable cannot also be a field of
	 * overlapping words.
	 *
	 * ## Reserve first, then draw
	 *
	 * The high-priority text is reserved in a pre-pass at the top of `draw()`,
	 * before anything is drawn: what somebody typed, and what a dimension
	 * measures. Everything derived - a room's area, name, type and ceiling, an
	 * item's caption - then asks for its box as it draws and simply does not draw
	 * if the box is taken.
	 *
	 * The pre-pass is what makes the priority right. Reserving in draw order would
	 * let "A New Room" win over a label a person typed, because rooms are drawn
	 * first; and reordering the drawing to fix that would put the furniture over
	 * the walls. Priority is a property of the text, not of the pass it is drawn
	 * in, so it is expressed separately from both.
	 *
	 * Suppression rather than displacement, deliberately. Nudging labels apart
	 * moves them away from the thing they name, which is the one property a label
	 * cannot lose; and a caption that slides somewhere else as you pan is harder
	 * to read than one that is absent. Zoom in and the boxes stop overlapping, so
	 * the answer to a hidden label is the gesture a person would make anyway.
	 *
	 * @type {Array<{x: number, y: number, w: number, h: number}>}
	 */

	/**
	 * How wide and tall a label will be, in canvas pixels.
	 *
	 * `measureText` rather than an estimate from the character count: the width of
	 * a proportional string is what decides whether two labels touch, and guessing
	 * it is how a declutter pass ends up hiding text that would have fitted. The
	 * font has to be set before measuring, which is why this mirrors the one line
	 * `drawTextLabel` uses to set it.
	 *
	 * @param {string} text
	 * @param {number} size CSS pixels.
	 * @param {string} [style]
	 * @returns {{w: number, h: number}}
	 */
	measureLabel(text, size, style)
	{
		return {
			// A couple of pixels of air on each side, so two labels that merely
			// touch are treated as colliding - which is what a reader sees.
			w: this.backend.measureText(text, size, style) + LABEL_PADDING_PIXELS * 2,
			h: size + LABEL_PADDING_PIXELS * 2,
		};
	}

	/**
	 * Claim the space a label needs, or find out that something has it.
	 *
	 * @param {string} text
	 * @param {number} x Centre, in canvas pixels.
	 * @param {number} y Centre.
	 * @param {number} [size] CSS pixels.
	 * @param {string} [style]
	 * @returns {boolean} False when the space is taken and nothing was reserved.
	 */
	reserveLabel(text, x, y, size, style)
	{
		if (!text)
		{
			return false;
		}
		var box = this.measureLabel(text, size || LABEL_SIZE_PIXELS, style);
		var left = x - box.w / 2;
		var top = y - box.h / 2;
		for (var i = 0; i < this._labelBoxes.length; i++)
		{
			var taken = this._labelBoxes[i];
			if (left < taken.x + taken.w && left + box.w > taken.x
				&& top < taken.y + taken.h && top + box.h > taken.y)
			{
				return false;
			}
		}
		this._labelBoxes.push({x: left, y: top, w: box.w, h: box.h});
		return true;
	}

	/**
	 * Hold the space for every piece of text that is drawn whatever else wants it
	 * (RM-008 E3): what somebody typed, and what a dimension measures.
	 *
	 * Run before anything is drawn. See {@link FloorplannerView2D#reserveLabel}
	 * for why the priority cannot simply be the drawing order.
	 */
	reserveAuthoredLabels()
	{
		var scope = this;
		(this.floorplan.annotations || []).forEach(function (annotation)
		{
			scope.reserveLabel(
				annotation.text,
				scope.project.convertX(annotation.x),
				scope.project.convertY(annotation.y) - annotation.size,
				annotation.size);
		});
		(this.floorplan.dimensions || []).forEach(function (dimension)
		{
			var line = dimensionLine(dimension);
			if (!line)
			{
				return;
			}
			// The axis-aligned box at the midpoint, which is the label's box only
			// when the dimension is horizontal. A rotated label is claimed as if it
			// were not, which over-reserves for a vertical one and under-reserves
			// for a diagonal - accepted, because the alternative is a rotated
			// rectangle intersection test for a few pixels of accuracy in a
			// heuristic whose job is to be roughly right.
			scope.reserveLabel(
				scope.dimensioning.cmToMeasure(line.length),
				(scope.project.convertX(line.ax) + scope.project.convertX(line.bx)) / 2,
				(scope.project.convertY(line.ay) + scope.project.convertY(line.by)) / 2 - 9,
				LABEL_SIZE_PIXELS, 'bold');
		});
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
		// Asked of the footprint rather than of its type number, like the opening
		// above: a flight is drawn as a flight because it says it is one, and the
		// four mesh stairs - which are floor items with a `.glb` and nothing else -
		// keep the plain box they have always had.
		if (footprint.stair)
		{
			this.drawStair(footprint);
			return;
		}
		if (footprint.structure)
		{
			this.drawStructure(footprint);
			return;
		}

		var corners = footprintCorners(footprint).map((corner) => ({
			x: this.project.convertX(corner.x),
			y: this.project.convertY(corner.y),
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
	 * A flight of stairs, drawn as a plan draws one (RM-008 F3).
	 *
	 * A stair symbol is a rectangle with a line across it per tread and an arrow
	 * up the walking line, and every one of those marks is `stairPlan()`'s -
	 * derived from the same tread count, going and width the mesh is built from,
	 * so the symbol and the solid are two drawings of one flight. A quarter or a
	 * half turn is two of those rectangles with a landing between them, which is
	 * why this draws runs and landings rather than one outline.
	 *
	 * The dashed rectangle is the **stairwell hint**: the part of the footprint a
	 * floor above would have to open, worked out from the flight's own height and
	 * two metres of headroom. Nothing acts on it - there is no floor above yet,
	 * that is programme G - and drawing it is how it stops being a comment.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawStair(footprint)
	{
		var scope = this;
		// Normalised on the way in, because a footprint is plain data that a test
		// or an embedder can hand over with a field missing, and `stairPlan` needs
		// a complete flight. Total by construction, so there is no failing case.
		var plan = stairPlan(normaliseStair(footprint.stair));
		var state = this.itemState(footprint);
		var stroke = (state === 'selected') ? floorplannerPalette.itemSelected
			: (state === 'hover') ? floorplannerPalette.itemHover
				: (footprint.fixed ? floorplannerPalette.itemFixed : floorplannerPalette.stair);
		var weight = (state === 'plain') ? 1.5 : 2.5;

		/** @param {{x: number, y: number}} point */
		var place = function (point) {return scope.placeLocal(footprint, point);};
		/** @param {{x0: number, y0: number, x1: number, y1: number}} rect */
		var quad = function (rect)
		{
			return [
				{x: rect.x0, y: rect.y0}, {x: rect.x1, y: rect.y0},
				{x: rect.x1, y: rect.y1}, {x: rect.x0, y: rect.y1},
			].map(place);
		};

		plan.runs.concat(plan.landings).forEach(function (rect)
		{
			var corners = quad(rect);
			scope.drawPolygon(
				corners.map((corner) => corner.x), corners.map((corner) => corner.y),
				true, floorplannerPalette.stairFill, true, stroke, weight);
		});

		plan.treadLines.forEach(function (line)
		{
			var from = place({x: line.x1, y: line.y1});
			var to = place({x: line.x2, y: line.y2});
			scope.drawLine(from.x, from.y, to.x, to.y, 1, floorplannerPalette.stairTread);
		});

		this.drawStairWalk(plan.walk.map(place), stroke);

		var well = quad(plan.well);
		this.backend.dash([4, 4]);
		this.drawPolygon(
			well.map((corner) => corner.x), well.map((corner) => corner.y),
			false, '', true, floorplannerPalette.stairWell, 1);
		this.backend.dash([]);

		this.drawItemLabel(footprint);
	}

	/**
	 * The walking line, with an arrowhead at the top and UP at the foot.
	 *
	 * Which end each mark goes on is the whole content of the symbol: a flight
	 * drawn without it is the same rectangle whichever way it climbs, and a plan
	 * that does not say which way is up is a plan somebody will build backwards.
	 *
	 * @param {Array<{x: number, y: number}>} points In canvas pixels, foot first.
	 * @param {string} color
	 */
	drawStairWalk(points, color)
	{
		if (points.length < 2)
		{
			return;
		}
		for (var i = 1; i < points.length; i++)
		{
			this.drawLine(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, 1.5, color);
		}
		var head = points[points.length - 1];
		var before = points[points.length - 2];
		var angle = Math.atan2(head.y - before.y, head.x - before.x);
		// Short enough that it stays inside the top tread at any sane zoom: an
		// arrowhead overhanging the flight reads as a dimension line.
		var size = 9;
		var spread = Math.PI / 7;
		this.drawLine(head.x, head.y,
			head.x - (size * Math.cos(angle - spread)), head.y - (size * Math.sin(angle - spread)), 1.5, color);
		this.drawLine(head.x, head.y,
			head.x - (size * Math.cos(angle + spread)), head.y - (size * Math.sin(angle + spread)), 1.5, color);

		var foot = points[0];
		var next = points[1];
		var away = Math.atan2(next.y - foot.y, next.x - foot.x);
		this.backend.text('UP', foot.x + (16 * Math.cos(away)), foot.y + (16 * Math.sin(away)), {
			color: color,
			halo: floorplannerPalette.labelHalo,
			size: 10,
			style: 'bold',
		});
	}

	/**
	 * A column or a beam (RM-008 F2).
	 *
	 * The whole symbol is the difference between being cut and being overhead. A
	 * plan is a horizontal section about a metre above the floor: a column passes
	 * through it and is drawn **solid**, a beam is above it and is drawn
	 * **dashed**. That is the convention on every building drawing, and it is the
	 * only thing on this canvas that tells the two apart - their plan rectangles
	 * are otherwise just rectangles.
	 *
	 * A round column is drawn round, from the same `section` the mesh is built
	 * from, so the plan and the solid are two drawings of one description.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawStructure(footprint)
	{
		var structure = normaliseStructure(footprint.structure);
		var overhead = isOverhead(structure);
		var state = this.itemState(footprint);
		var stroke = (state === 'selected') ? floorplannerPalette.itemSelected
			: (state === 'hover') ? floorplannerPalette.itemHover
				: (footprint.fixed ? floorplannerPalette.itemFixed : floorplannerPalette.structure);
		var weight = (state === 'plain') ? 1.5 : 2.5;

		if (overhead)
		{
			this.backend.dash([6, 4]);
		}

		if (structure.section === SECTION_ROUND && !overhead)
		{
			// Two of E4's primitives rather than a widened one: `circle` fills and
			// `arc` strokes, and a full-turn arc is a circle's outline - which the
			// SVG backend already special-cases back into a `<circle>`. Adding a
			// stroke to `circle` would change an interface both backends implement
			// and that M-34 enumerates, for a shape that can already be drawn.
			var cx = this.project.convertX(footprint.x);
			var cy = this.project.convertY(footprint.y);
			// Through the projection, not through `cmToPixel`. The two agree on
			// screen and disagree on a sheet: `renderTo` swaps the projection and
			// leaves `dimensioning` alone, so a radius from `cmToPixel` would be the
			// column's size at the screen's zoom on a drawing at 1:100. Found by
			// exporting a sheet with a 45 cm round column beside a 40 cm square one
			// and seeing the round one come out smaller. Every other length on this
			// canvas already goes through the projection - `drawDoorSwing` takes its
			// radius from two projected corners for the same reason.
			var radius = Math.abs(this.project.convertX(footprint.x + (structure.width / 2)) - cx);
			this.backend.circle(cx, cy, radius, floorplannerPalette.structureFill);
			this.backend.arc(cx, cy, radius, 0, Math.PI * 2, weight, stroke);
		}
		else
		{
			var corners = footprintCorners(footprint).map((corner) => ({
				x: this.project.convertX(corner.x),
				y: this.project.convertY(corner.y),
			}));
			this.drawPolygon(
				corners.map((corner) => corner.x), corners.map((corner) => corner.y),
				!overhead, floorplannerPalette.structureFill, true, stroke, weight);
		}

		if (overhead)
		{
			this.backend.dash([]);
		}
		this.drawItemLabel(footprint);
	}

	/**
	 * A point in an item's own frame, in canvas pixels.
	 *
	 * The same rotate-then-translate `footprintCorners` applies to a box's four
	 * corners, for the arbitrary number of points a flight of stairs has. Kept
	 * here rather than in `plan_projection.js` because it converts to pixels, and
	 * the projection is plain centimetres that the export reads at another scale.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 * @param {{x: number, y: number}} point Centimetres, relative to the centre.
	 * @returns {{x: number, y: number}}
	 */
	placeLocal(footprint, point)
	{
		var cos = Math.cos(footprint.rotation);
		var sin = Math.sin(footprint.rotation);
		return {
			x: this.project.convertX(footprint.x + (point.x * cos) - (point.y * sin)),
			y: this.project.convertY(footprint.y + (point.x * sin) + (point.y * cos)),
		};
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
		// The other half of E1's caption rule, and the half it flagged as missing:
		// a size threshold stops a zoomed-out plan being a field of words, and it
		// does nothing at all about two chairs side by side, both big enough, whose
		// captions land on each other. A caption is the lowest-priority text on the
		// plan, so it gives way to everything (RM-008 E3).
		var captionX = this.project.convertX(footprint.x);
		var captionY = this.project.convertY(footprint.y) + (depthOnScreen / 2) + 12;
		if (!this.reserveLabel(footprint.label, captionX, captionY))
		{
			return;
		}
		this.drawTextLabel(
			footprint.label,
			captionX,
			captionY,
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
	 * The swing was a convention until RM-008 F1 (RM-009 U-4): nothing in the
	 * model recorded a hinge side or an opening angle, so every door swung the
	 * same way and the arc said "door" rather than "this door opens like this".
	 * A footprint that carries an `opening` now says both, and this draws them.
	 * One that does not - every mesh door, in every design written before F1 -
	 * keeps the convention, which is what it has always had.
	 *
	 * @param {import('../model/plan_projection.js').ItemFootprint} footprint
	 */
	drawOpening(footprint)
	{
		var corners = footprintCorners(footprint).map((corner) => ({
			x: this.project.convertX(corner.x),
			y: this.project.convertY(corner.y),
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

		var opening = footprint.opening;
		if (opening)
		{
			if (opening.kind === OPENING_KIND_DOOR && opening.swing > 0)
			{
				this.drawDoorSwing(corners, color, opening);
			}
			else if (opening.kind === OPENING_KIND_WINDOW)
			{
				// A sash line down the middle of the reveal, which is how a plan says
				// "window" rather than "hole".
				this.drawLine(
					(corners[0].x + corners[3].x) / 2, (corners[0].y + corners[3].y) / 2,
					(corners[1].x + corners[2].x) / 2, (corners[1].y + corners[2].y) / 2,
					1, color);
			}
			// An archway is drawn as the reveal alone, which is what an archway is.
			return;
		}

		if (footprint.type === ITEM_TYPE_IN_WALL_FLOOR)
		{
			this.drawDoorSwing(corners, color);
		}
	}

	/**
	 * The arc a door leaf sweeps, and the leaf at the end of it.
	 *
	 * With an `opening` it is *this* door's arc: hinged on the side the
	 * description names, through the angle it names, at the width it names. That
	 * is RM-008 F1's whole claim in one method - the plan symbol and the 3D leaf
	 * are two drawings of one number rather than two conventions that happen to
	 * agree.
	 *
	 * Without one it is the convention it has always been: hinged on the first
	 * corner, ninety degrees. Every mesh door in every design written before F1
	 * lands here.
	 *
	 * @param {Array<{x: number, y: number}>} corners In canvas pixels.
	 * @param {string} color
	 * @param {?{hinge: string, swing: number}} [opening]
	 */
	drawDoorSwing(corners, color, opening)
	{
		// Corner 0 to 1 is the wall run; the hinge is at one end of it. A
		// right-hand door hinges at the other, which reverses both the leaf
		// direction and the sweep.
		var right = Boolean(opening && opening.hinge === 'right');
		var hinge = right ? corners[1] : corners[0];
		var far = right ? corners[0] : corners[1];
		var leafX = far.x - hinge.x;
		var leafY = far.y - hinge.y;
		var radius = Math.sqrt((leafX * leafX) + (leafY * leafY));
		if (radius < 4)
		{
			return;
		}
		var sweep = (opening && typeof opening.swing === 'number')
			? (opening.swing * Math.PI / 180) : (Math.PI / 2);
		// Into the room, which for corner 0-to-1 is the direction corner 3 lies -
		// the same sense the old convention drew, so a mesh door is unmoved.
		var direction = right ? -1 : 1;
		var start = Math.atan2(leafY, leafX);
		var end = start + direction * sweep;
		this.backend.arc(hinge.x, hinge.y, radius, Math.min(start, end), Math.max(start, end), 1, color);
		this.drawLine(hinge.x, hinge.y,
			hinge.x + (radius * Math.cos(end)),
			hinge.y + (radius * Math.sin(end)), 1, color);
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
		if (!this.emphasis)
		{
			// A sheet carries the furniture, not which piece of it was clicked.
			return 'plain';
		}
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

	/**
	 * The room the rectangle tool is about to draw (RM-008 E2).
	 *
	 * Outline and dimensions only - no fill - because a filled preview over a
	 * filled room is unreadable exactly where it matters, which is when the new
	 * room overlaps an old one. The two labels are the same `cmToMeasure` the
	 * wall labels use, so a rectangle dragged to 4 m reads 4 m before it exists.
	 */
	/**
	 * The dashed lines to whatever the target has lined up with (RM-008 E2).
	 *
	 * Drawn from the corner to the target rather than across the whole canvas: a
	 * full-width rule says "something out there shares this row" and a segment
	 * says which corner, which is the question somebody squaring a room is
	 * actually asking.
	 *
	 * Dashed, and the dash is restored afterwards - `setLineDash` is context
	 * state, and leaving it set would dot every wall drawn after this in the same
	 * pass.
	 */
	drawAlignmentGuides()
	{
		var aligned = this.viewmodel.alignedTo;
		if (!aligned || (!aligned.x && !aligned.y))
		{
			return;
		}
		var targetX = this.project.convertX(this.viewmodel.targetX);
		var targetY = this.project.convertY(this.viewmodel.targetY);

		this.backend.dash([4, 4]);
		if (aligned.x)
		{
			this.drawLine(targetX, targetY, this.project.convertX(aligned.x.x), this.project.convertY(aligned.x.y), 1, floorplannerPalette.angleGuide);
		}
		if (aligned.y)
		{
			this.drawLine(targetX, targetY, this.project.convertX(aligned.y.x), this.project.convertY(aligned.y.y), 1, floorplannerPalette.angleGuide);
		}
		this.backend.dash([]);
	}

	drawRectanglePreview()
	{
		var anchor = this.viewmodel.rectangleAnchor;
		if (!anchor)
		{
			this.drawTarget(this.viewmodel.targetX, this.viewmodel.targetY, null);
			return;
		}
		var x1 = this.project.convertX(anchor.x);
		var y1 = this.project.convertY(anchor.y);
		var x2 = this.project.convertX(this.viewmodel.targetX);
		var y2 = this.project.convertY(this.viewmodel.targetY);

		this.drawPolygon([x1, x2, x2, x1], [y1, y1, y2, y2], false, null, true, floorplannerPalette.wallSelected, 2);

		var width = Math.abs(this.viewmodel.targetX - anchor.x);
		var depth = Math.abs(this.viewmodel.targetY - anchor.y);
		this.drawTextLabel(this.dimensioning.cmToMeasure(width), (x1 + x2) / 2, Math.min(y1, y2) - 12);
		this.drawTextLabel(this.dimensioning.cmToMeasure(depth), Math.max(x1, x2) + 26, (y1 + y2) / 2);
	}

	/**
	 * Every dimension the plan carries (RM-008 E3).
	 *
	 * Drawn after the building and the furniture and before the transient aids,
	 * for the same reason `drawItems` is: a dimension is part of the document and
	 * belongs over what it measures, while the wall being dragged right now
	 * belongs over everything.
	 */
	drawDimensions()
	{
		var dimensions = this.floorplan.dimensions;
		if (!dimensions || !dimensions.length)
		{
			return;
		}
		var scope = this;
		dimensions.forEach(function (dimension) {scope.drawDimension(dimension);});
	}

	/**
	 * One dimension: two witness lines, the dimension line between them, a tick
	 * at each end, and the measurement.
	 *
	 * The geometry comes from `dimensionLine()` in `model/annotation.js` rather
	 * than being recomputed here, so what is drawn and what
	 * `Floorplan.overlappedDimension` picks are the same line by construction. A
	 * second copy of that formula is how a dimension ends up clickable somewhere
	 * it is not drawn.
	 *
	 * @param {import('../model/annotation.js').Dimension} dimension
	 */
	drawDimension(dimension)
	{
		var line = dimensionLine(dimension);
		if (!line)
		{
			// Zero length: no direction to offset along, and nothing to measure.
			return;
		}
		var color = floorplannerPalette.dimension;
		if (this.emphasis && dimension === this.viewmodel.activeDimension && dimension !== this.viewmodel.selectedDimension)
		{
			color = floorplannerPalette.dimensionHover;
		}
		else if (this.emphasis && dimension === this.viewmodel.selectedDimension)
		{
			color = floorplannerPalette.dimensionSelected;
		}

		var measured = dimension.points();
		var ax = this.project.convertX(measured.ax);
		var ay = this.project.convertY(measured.ay);
		var bx = this.project.convertX(measured.bx);
		var by = this.project.convertY(measured.by);
		var lax = this.project.convertX(line.ax);
		var lay = this.project.convertY(line.ay);
		var lbx = this.project.convertX(line.bx);
		var lby = this.project.convertY(line.by);

		// The witness lines run in screen space from here on: the gap and the
		// overshoot are typographic, so they must not grow with the zoom.
		var wx = lax - ax;
		var wy = lay - ay;
		var reach = Math.sqrt(wx * wx + wy * wy);
		if (reach > 1e-6)
		{
			var ux = wx / reach;
			var uy = wy / reach;
			var gap = Math.min(WITNESS_GAP_PIXELS, reach);
			this.drawLine(ax + ux * gap, ay + uy * gap, lax + ux * WITNESS_OVERSHOOT_PIXELS, lay + uy * WITNESS_OVERSHOOT_PIXELS, 1, color);
			this.drawLine(bx + ux * gap, by + uy * gap, lbx + ux * WITNESS_OVERSHOOT_PIXELS, lby + uy * WITNESS_OVERSHOOT_PIXELS, 1, color);
		}

		this.drawLine(lax, lay, lbx, lby, 1, color);

		// Ticks rather than arrowheads: at 45 degrees across the line's ends, the
		// way a surveyed drawing marks an extent. Two strokes each instead of a
		// filled triangle, which keeps this inside the eight primitives E4's SVG
		// backend has to implement rather than adding a ninth.
		var dx = lbx - lax;
		var dy = lby - lay;
		var span = Math.sqrt(dx * dx + dy * dy);
		if (span > 1e-6)
		{
			var tx = (dx / span) * DIMENSION_TICK_PIXELS;
			var ty = (dy / span) * DIMENSION_TICK_PIXELS;
			// Rotated 45 degrees from the line's direction, both ends the same way.
			var kx = (tx - ty) * Math.SQRT1_2;
			var ky = (ty + tx) * Math.SQRT1_2;
			this.drawLine(lax - kx, lay - ky, lax + kx, lay + ky, 1, color);
			this.drawLine(lbx - kx, lby - ky, lbx + kx, lby + ky, 1, color);
		}

		this.drawDimensionLabel(line, lax, lay, lbx, lby, color);
	}

	/**
	 * The measurement, along its own line and never upside down.
	 *
	 * Rotated with the dimension, which is what makes a vertical dimension
	 * readable at all - horizontal text beside a vertical line has to be hunted
	 * for. The flip is the part that is easy to get wrong: a dimension drawn
	 * right to left has a direction pointing left, and text laid along it reads
	 * backwards, so anything past a quarter turn is drawn along the reverse
	 * direction instead. The line is the same line; only the reading direction
	 * changes.
	 *
	 * @param {Object} line What `dimensionLine()` returned, for its length.
	 * @param {number} lax Screen coordinates of the dimension line.
	 * @param {number} lay
	 * @param {number} lbx
	 * @param {number} lby
	 * @param {string} color
	 */
	drawDimensionLabel(line, lax, lay, lbx, lby, color)
	{
		var angle = Math.atan2(lby - lay, lbx - lax);
		if (angle > Math.PI / 2 || angle < -Math.PI / 2)
		{
			angle += Math.PI;
		}
		var midX = (lax + lbx) / 2;
		var midY = (lay + lby) / 2;

		// Just clear of the line, on the side the text reads from, with the halo the
		// label primitive draws so it stays legible over a room fill.
		//
		// The rotation is a parameter rather than a transform around the call
		// (RM-008 E4). A transform stack is the one piece of canvas state an SVG
		// backend has no equivalent for - an SVG element carries its own transform -
		// so the only rotation this plan draws is expressed where both backends can
		// take it.
		this.backend.text(this.dimensioning.cmToMeasure(line.length), midX, midY, {
			color: color,
			halo: floorplannerPalette.labelHalo,
			size: LABEL_SIZE_PIXELS,
			style: 'bold',
			rotation: angle,
			// The offset is along the rotated axis, so it has to be applied after
			// the rotation rather than to the midpoint. Passed as a perpendicular
			// nudge the backend applies in the label's own frame.
			offsetY: -9,
		});
	}

	/**
	 * Every text label the plan carries (RM-008 E3).
	 */
	drawAnnotations()
	{
		var annotations = this.floorplan.annotations;
		if (!annotations || !annotations.length)
		{
			return;
		}
		var scope = this;
		annotations.forEach(function (annotation) {scope.drawAnnotation(annotation);});
	}

	/**
	 * One text label, and the dot that is what a click actually targets.
	 *
	 * The dot exists because `Floorplan.overlappedAnnotation` hit-tests a radius
	 * around the anchor rather than the text's box - the model layer has no font
	 * metrics and giving it any would put a canvas inside the plain-data layer.
	 * Drawing the anchor is what makes that honest: what you aim at is what is
	 * picked, rather than a target you have to guess at.
	 *
	 * @param {import('../model/annotation.js').TextAnnotation} annotation
	 */
	drawAnnotation(annotation)
	{
		var color = floorplannerPalette.annotation;
		if (this.emphasis && annotation === this.viewmodel.activeAnnotation && annotation !== this.viewmodel.selectedAnnotation)
		{
			color = floorplannerPalette.annotationHover;
		}
		else if (this.emphasis && annotation === this.viewmodel.selectedAnnotation)
		{
			color = floorplannerPalette.annotationSelected;
		}
		var x = this.project.convertX(annotation.x);
		var y = this.project.convertY(annotation.y);
		this.drawCircle(x, y, ANNOTATION_ANCHOR_PIXELS, color);
		if (annotation.text)
		{
			this.drawTextLabel(annotation.text, x, y - annotation.size, color, null, 'normal', annotation.size);
		}
	}

	/**
	 * Which way is north (RM-008 E3).
	 *
	 * Fixed to the top right of the canvas rather than placed on the plan,
	 * because it describes the whole drawing and not a place in it: panning must
	 * not take it off screen and zooming must not change its size. That also
	 * makes it the one mark here drawn entirely in screen coordinates, which is
	 * why it does not go through `convertX`.
	 *
	 * Nothing is drawn when the canvas is too small to hold it - a split view
	 * dragged almost shut - rather than putting an arrow over the plan's only
	 * remaining strip.
	 */
	drawNorthArrow()
	{
		var radius = NORTH_RADIUS_PIXELS;
		var inset = this.chromeInset;
		if (this.canvasWidth < inset * 3 || this.canvasHeight < inset * 3)
		{
			return;
		}
		var cx = this.canvasWidth - inset;
		var cy = inset;
		// Clockwise from up, which is how a bearing is written and read. Canvas y
		// runs down, so "up" is negative y and a positive bearing turns towards
		// positive x - which is exactly what these two lines say.
		var angle = (this.floorplan.north || 0) * Math.PI / 180;
		var nx = Math.sin(angle);
		var ny = -Math.cos(angle);
		var color = floorplannerPalette.north;

		this.drawLine(cx - nx * radius, cy - ny * radius, cx + nx * radius, cy + ny * radius, 1, color);
		// The head, as two strokes back from the point at 30 degrees either side.
		var head = radius * 0.45;
		var spread = Math.PI / 6;
		var tipX = cx + nx * radius;
		var tipY = cy + ny * radius;
		var back = angle + Math.PI;
		this.drawLine(tipX, tipY, tipX + Math.sin(back - spread) * head, tipY - Math.cos(back - spread) * head, 1, color);
		this.drawLine(tipX, tipY, tipX + Math.sin(back + spread) * head, tipY - Math.cos(back + spread) * head, 1, color);
		this.drawTextLabel('N', cx + nx * (radius + 11), cy + ny * (radius + 11), color, null, 'bold');
	}

	/**
	 * The dimension being placed, between its first click and its second
	 * (RM-008 E3).
	 *
	 * The measured line itself, not the offset one - during placement the two
	 * points are what is being chosen, and drawing the finished shape would show
	 * a line 40 cm from where the pointer is. The offset is chosen afterwards, by
	 * dragging.
	 */
	drawDimensionPreview()
	{
		var anchor = this.viewmodel.dimensionAnchor;
		if (!anchor)
		{
			this.drawTarget(this.viewmodel.targetX, this.viewmodel.targetY, null);
			return;
		}
		var x1 = this.project.convertX(anchor.x);
		var y1 = this.project.convertY(anchor.y);
		var x2 = this.project.convertX(this.viewmodel.targetX);
		var y2 = this.project.convertY(this.viewmodel.targetY);

		this.drawLine(x1, y1, x2, y2, 1, floorplannerPalette.dimensionSelected);
		this.drawCircle(x1, y1, ANNOTATION_ANCHOR_PIXELS, floorplannerPalette.dimensionSelected);

		var dx = this.viewmodel.targetX - anchor.x;
		var dy = this.viewmodel.targetY - anchor.y;
		this.drawTextLabel(
			this.dimensioning.cmToMeasure(Math.sqrt(dx * dx + dy * dy)),
			(x1 + x2) / 2, (y1 + y2) / 2 - 12,
			floorplannerPalette.dimensionSelected, null, 'bold');
	}

	drawCornerAngles(corner)
	{
		var ox = this.project.convertX(corner.location.x);
		var oy = this.project.convertY(corner.location.y);
		var offsetRatio = 2.0;
		for (var i=0;i<corner.angles.length;i++)
		{
			var direction = corner.angleDirections[i];
			var location = direction.clone().add(corner.location);
			var sAngle = (corner.startAngles[i]*Math.PI)/180;
			var eAngle = (corner.endAngles[i]*Math.PI)/180;
			var angle = corner.angles[i];
			var lx = this.project.convertX(location.x);
			var ly = this.project.convertY(location.y);
			var radius = direction.length() * offsetRatio * 0.5;
			if( angle > 130 || angle == 0)
			{
				continue;
			}
			// One of T-5's two outliers, refactored onto the backend by E4. The
			// width and colour used to be read back off the context by the two
			// `drawLine` calls below - `this.context.lineWidth` as an argument -
			// which is exactly the kind of "the state is the parameter" coupling a
			// second backend cannot honour. They are locals now and nothing else
			// about the drawing changed.
			var ccwise = (Math.abs(corner.startAngles[i] - corner.endAngles[i]) > 180);
			var angleColor = floorplannerPalette.cornerAngle;
			var angleWidth = 4;
			if(angle == 90)
			{
				var location2 = direction.clone().multiplyScalar(offsetRatio).add(corner.location);
				var lxx = this.project.convertX(location2.x);
				var lyy = this.project.convertY(location2.y);
				var b = {x:lxx, y:oy};
				var c = {x:lxx, y:lyy};
				var d = {x:ox, y:lyy};
				this.drawLine(b.x,b.y,c.x,c.y,angleWidth,angleColor);
				this.drawLine(c.x,c.y,d.x,d.y,angleWidth,angleColor);
			}
			else
			{
				// `ccwise` reversed the sweep on the canvas; the backend takes the
				// two angles in draw order instead, which says the same thing in a
				// form SVG's arc command can also express.
				var from = ccwise ? Math.max(sAngle, eAngle) : Math.min(sAngle, eAngle);
				var to = ccwise ? Math.min(sAngle, eAngle) : Math.max(sAngle, eAngle);
				this.backend.arc(ox, oy, radius, from, to, angleWidth, angleColor);
			}
			this.drawTextLabel(`${angle}°`, lx, ly);
		}
		
	}

	drawOriginCrossHair()
	{
		var ox = this.project.convertX(0);
		var oy = this.project.convertY(0);
		
		// Two nested plus signs. Note that the second pair are fillRects and the
		// line between them assigns strokeStyle, which fillRect never reads - so
		// all four rectangles have always been drawn in the first colour and the
		// "secondary" one has never appeared. Preserved: this is the marker the
		// app has always shown, and making the inner cross a second colour is a
		// change to the drawing, not a theming decision. The palette entry is
		// still honoured so a host that wants two colours can set the fill.
		// T-5's other outlier, refactored by E4. The `strokeStyle` assignment that
		// used to sit between the second and third rectangle is gone rather than
		// translated: fillRect never read it, which is the whole reason all four
		// rectangles have always been the primary colour. Removing a line that did
		// nothing changes nothing drawn, and the comment above says what it was.
		this.backend.fillRect(ox-2, oy-7.5, 4, 15, floorplannerPalette.originPrimary);
		this.backend.fillRect(ox-7.5, oy-2, 15, 4, floorplannerPalette.originPrimary);
		this.backend.fillRect(ox-1.25, oy-5, 2.5, 10, floorplannerPalette.originPrimary);
		this.backend.fillRect(ox-5, oy-1.25, 10, 2.5, floorplannerPalette.originPrimary);
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
		this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.project.convertX(pos.x),this.project.convertY(pos.y));
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
			this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.project.convertX(pos.x),this.project.convertY(pos.y+40));
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
			this.drawTextLabel(`${label}${this.dimensioning.cmToMeasure(length)}` ,this.project.convertX(pos.x),this.project.convertY(pos.y-40));
		}
		
	}

	/**
	 * @param {string} label
	 * @param {number} x
	 * @param {number} y
	 * @param {?string} [textcolor] Null or absent means "use the theme".
	 * @param {?string} [strokecolor] Same.
	 * @param {string} [style]
	 * @param {number} [size] Font size in CSS pixels (RM-008 E3).
	 *
	 * The two colour parameters default to `null` in the signature, which types
	 * them AS null - so every caller passing a real colour was an error and the
	 * two assignments below were too (RM-005 C2).
	 */
	drawTextLabel(label, x, y, textcolor=null, strokecolor=null, style='normal', size=LABEL_SIZE_PIXELS)
	{
		// Defaulting through the palette rather than in the signature: a default
		// parameter is evaluated per call, so `floorplannerPalette.label` would
		// work here too - but an explicit `undefined` and an explicit `null` are
		// both "use the theme", and callers pass both.
		textcolor = textcolor || floorplannerPalette.label;
		strokecolor = strokecolor || floorplannerPalette.labelHalo;
		// Screen pixels, not plan centimetres, and every other piece of text on
		// this canvas has been 12 of them since it was written (RM-008 E3). A
		// label that scaled with the zoom while the wall length beside it did not
		// would read as a bug. E4 owns the export case, where text on a 1:50 sheet
		// does have a physical size.
		this.backend.text(label, x, y, {color: textcolor, halo: strokecolor, size: size, style: style});
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
						return scope.project.convertX(corner.x);
					}),
					Utils.map(corners, function (corner) 
							{
								return scope.project.convertY(corner.y);
							}),false,null,true,color,edgeWidth);
		}
//		else
		
	}
	
	/** */
	drawWall(wall)
	{
		var selected = this.emphasis && (wall === this.viewmodel.selectedWall);
		var hover = this.emphasis && (wall === this.viewmodel.activeWall && wall != this.viewmodel.selectedWall);
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
			this.drawLine(this.project.convertX(wall.getStartX()),this.project.convertY(wall.getStartY()),this.project.convertX(wall.a.x),this.project.convertY(wall.a.y),5,guideShadow);
			this.drawLine(this.project.convertX(wall.a.x),this.project.convertY(wall.a.y),this.project.convertX(wall.b.x),this.project.convertY(wall.b.y),5,guideShadow);
			this.drawLine(this.project.convertX(wall.b.x),this.project.convertY(wall.b.y),this.project.convertX(wall.getEndX()),this.project.convertY(wall.getEndY()),5,guideShadow);

			this.drawLine(this.project.convertX(wall.getStartX()),this.project.convertY(wall.getStartY()),this.project.convertX(wall.a.x),this.project.convertY(wall.a.y),1,guide);
			this.drawLine(this.project.convertX(wall.a.x),this.project.convertY(wall.a.y),this.project.convertX(wall.b.x),this.project.convertY(wall.b.y),1,guide);
			this.drawLine(this.project.convertX(wall.b.x),this.project.convertY(wall.b.y),this.project.convertX(wall.getEndX()),this.project.convertY(wall.getEndY()),1,guide);

			this.drawCircle(this.project.convertX(wall.a.x), this.project.convertY(wall.a.y), 10, floorplannerPalette.curveHandle);
			this.drawCircle(this.project.convertX(wall.b.x), this.project.convertY(wall.b.y), 10, floorplannerPalette.curveHandle);
		}
		
		if(wall.wallType == WallTypes.STRAIGHT)
		{
			this.drawLine(this.project.convertX(wall.getStartX()),this.project.convertY(wall.getStartY()),this.project.convertX(wall.getEndX()),this.project.convertY(wall.getEndY()),hover ? wallWidthHover : selected ? wallWidthSelected : wallWidth,color);
		}
		else
		{
			
			this.drawCurvedLine(
					this.project.convertX(wall.getStartX()),
					this.project.convertY(wall.getStartY()),
					
					this.project.convertX(wall.a.x),
					this.project.convertY(wall.a.y),
					
					this.project.convertX(wall.b.x),
					this.project.convertY(wall.b.y),
					
					this.project.convertX(wall.getEndX()),
					this.project.convertY(wall.getEndY()),
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
		var selected = this.emphasis && (room === this.viewmodel.selectedRoom);
		var hover = this.emphasis && (room === this.viewmodel.activeRoom && room != this.viewmodel.selectedRoom);
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
		// Each of the four lines a room can carry asks for its space and gives way
		// (RM-008 E3). A room's area and name are derived; a label somebody typed
		// over this room reserved its box before any of this ran.
		var labelX = this.project.convertX(room.areaCenter.x);
		var labelY = this.project.convertY(room.areaCenter.y);
		var area = this.dimensioning.cmToMeasure(room.area, 2)+String.fromCharCode(178);
		if (this.reserveLabel(area, labelX, labelY, LABEL_SIZE_PIXELS, 'bold'))
		{
			this.drawTextLabel(area, labelX, labelY, floorplannerPalette.area, '#00FF0000', 'bold');
		}
		if (this.reserveLabel(room.name, labelX, labelY + ROOM_LABEL_STEP_PIXELS, LABEL_SIZE_PIXELS, 'bold italic'))
		{
			this.drawTextLabel(room.name, labelX, labelY + ROOM_LABEL_STEP_PIXELS, floorplannerPalette.roomName, '#00FF0000', 'bold italic');
		}
		this.drawRoomAnnotation(room);
	}

	/**
	 * What a room is for, and how high it is (RM-008 E3).
	 *
	 * Both are drawn only when there is something to say, and the two rules are
	 * different:
	 *
	 *   - **Type** appears when somebody typed one. There is no default for what
	 *     a room is for.
	 *   - **Ceiling height** appears only when it is NOT the document's wall
	 *     height. A plan where every room is the standard height and every room
	 *     says so is a plan carrying the same number a dozen times, which is
	 *     noise; the number is worth drawing exactly where it is a surprise.
	 *     That also means a plan drawn before this sprint looks exactly as it did.
	 *
	 * Under the name, in the same stack, because they answer questions about the
	 * same thing and putting them anywhere else would need a leader line.
	 *
	 * @param {import('../model/room.js').Room} room
	 */
	drawRoomAnnotation(room)
	{
		var centre = room.areaCenter;
		if (!centre)
		{
			// A room with no corners has no centroid. `drawRoom` reaches this only
			// through `updateArea`, which sets one - but the field is nullable and
			// the checker is right that nothing here guarantees it.
			return;
		}
		var x = this.project.convertX(centre.x);
		var y = this.project.convertY(centre.y) + ROOM_LABEL_STEP_PIXELS;
		if (room.type)
		{
			y += ROOM_LABEL_STEP_PIXELS;
			if (this.reserveLabel(room.type, x, y, LABEL_SIZE_PIXELS, 'italic'))
			{
				this.drawTextLabel(room.type, x, y, floorplannerPalette.roomType, '#00FF0000', 'italic');
			}
		}
		var ceiling = room.ceilingHeight;
		if (ceiling > 0 && Math.abs(ceiling - this.configuration.getNumericValue(configWallHeight)) > 1e-6)
		{
			y += ROOM_LABEL_STEP_PIXELS;
			// "at most" when the corners disagree, because the number is then the
			// highest point of a sloped ceiling rather than the height of the room.
			var prefix = room.hasUniformCeiling ? 'H ' : 'H \u2264 ';
			var height = prefix + this.dimensioning.cmToMeasure(ceiling);
			if (this.reserveLabel(height, x, y, LABEL_SIZE_PIXELS, 'italic'))
			{
				this.drawTextLabel(height, x, y, floorplannerPalette.roomType, '#00FF0000', 'italic');
			}
		}
	}

	/** */
	drawCorner(corner)
	{
		var cornerX = this.project.convertX(corner.x);
		var cornerY = this.project.convertY(corner.y);
		var hover = this.emphasis && (corner === this.viewmodel.activeCorner && corner != this.viewmodel.selectedCorner);
		var selected = this.emphasis && (corner === this.viewmodel.selectedCorner);
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
		this.drawCircle(this.project.convertX(x),this.project.convertY(y),cornerRadiusHover,floorplannerPalette.cornerHover);
		if (lastNode)
		{
			this.drawLine(this.project.convertX(lastNode.x),this.project.convertY(lastNode.y),this.project.convertX(x),this.project.convertY(y),wallWidthHover,floorplannerPalette.wallHover);
		}
	}
	
	drawBezierObject(bezier, width=3, color='#f0f0f0')
	{
		this.drawCurvedLine(
		this.project.convertX(bezier.points[0].x),
		this.project.convertY(bezier.points[0].y),
		
		this.project.convertX(bezier.points[1].x),
		this.project.convertY(bezier.points[1].y),
		
		this.project.convertX(bezier.points[2].x),
		this.project.convertY(bezier.points[2].y),
		
		this.project.convertX(bezier.points[3].x),
		this.project.convertY(bezier.points[3].y),
		width,color);
	}
	
	drawCurvedLine(startX, startY, aX, aY, bX, bY, endX, endY, width, color)
	{
		// The casing under the wall, then the wall itself.
		this.backend.curve(startX, startY, aX, aY, bX, bY, endX, endY, width + 3, floorplannerPalette.curveCasing);
		this.backend.curve(startX, startY, aX, aY, bX, bY, endX, endY, width, color);
	}

	/** */
	drawLine(startX, startY, endX, endY, width, color)
	{
		this.backend.line(startX, startY, endX, endY, width, color);
	}
	
	/** */
	drawPolygonCurved(pointsets, fill=true, fillColor='#FF00FF', stroke=false, strokeColor='#000000', strokeWidth=5)
	{
		// The one primitive handed PLAN coordinates where every other one is handed
		// canvas pixels. Preserved rather than normalised - `drawRoom` is its only
		// caller - and the projection happens here, once, so the backend sees
		// pixels like everything else does.
		var scope = this;
		var segments = pointsets.map(function (pointset)
		{
			return pointset.map(function (point)
			{
				return {x: scope.project.convertX(point.x), y: scope.project.convertY(point.y)};
			});
		});
		this.backend.path(segments, fill ? fillColor : null, stroke ? strokeColor : null, strokeWidth);
	}

	/** */
	drawPolygon(xArr, yArr, fill, fillColor, stroke, strokeColor, strokeWidth)
	{
		this.backend.polygon(xArr, yArr, fill ? fillColor : null, stroke ? strokeColor : null, strokeWidth);
	}

	/** */
	drawCircle(centerX, centerY, radius, fillColor)
	{
		this.backend.circle(centerX, centerY, radius, fillColor);
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
