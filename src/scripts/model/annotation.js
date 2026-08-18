// @ts-check
import {Utils} from '../core/utils.js';

/**
 * What a plan says about itself: dimensions and free text (RM-008 E3).
 *
 * ## Why these are not derived
 *
 * Everything else the 2D view draws is computed from the wall graph - a room is
 * a cycle of corners, a wall label is the distance between two of them, an item
 * footprint is a projection of the scene (RM-008 E1). None of it is authored.
 * That is exactly why a plan drawn here could not be *read* by somebody who did
 * not draw it: the drawing states what the geometry is and never what the
 * person meant.
 *
 * A dimension between two arbitrary points and a text label are the two things
 * that carry intent, and neither can be derived from anything. They are the
 * first authored entities in the model, and that has two consequences worth
 * stating rather than discovering:
 *
 *   - **Their ids are persisted.** `Room.id` is deliberately not, because a room
 *     is identified by its corners and can be found again after a reload. A
 *     dimension has no such description - it *is* its record - so the id in the
 *     file is the identity, and a load restores it rather than minting a new one.
 *     Without that, undo (which is a save/load round trip - see
 *     `app/composables/useHistory.js`) would drop the selection on every step.
 *
 *   - **They are saved conditionally.** T-6: the writer names every field
 *     explicitly, so an additive collection has to be added to it - and a key
 *     written unconditionally makes every file that predates this sprint a
 *     different file the moment it is re-saved. `dimensions` and `annotations`
 *     appear only when there is something in them, which is what M-33's
 *     byte-identical half asserts.
 *
 * ## No events of their own
 *
 * A `Corner` dispatches its own moves because four other objects hold one and
 * need to react. Nothing holds a dimension except the `Floorplan` that owns the
 * array, so every mutator here calls back into the plan and the plan announces
 * it once, with `EVENT_ANNOTATIONS_CHANGED`. One event, one subscriber list, and
 * no listener to leak - which is the failure mode RM-003 A0 spent a sprint on.
 */

/**
 * How far a dimension line sits from the two points it measures, in
 * centimetres, when nothing says otherwise.
 *
 * Roughly a wall's thickness times four: far enough that the line and its text
 * clear the wall being measured, close enough that it reads as belonging to it.
 */
export const DEFAULT_DIMENSION_OFFSET = 40;

/** The text a label starts with, so a freshly placed one is visible and obviously editable. */
export const DEFAULT_ANNOTATION_TEXT = 'Note';

/** Font size of a text label, in CSS pixels, when nothing says otherwise. */
export const DEFAULT_ANNOTATION_SIZE = 14;

/** The sizes the inspector offers. Screen pixels; see {@link TextAnnotation#size}. */
export const ANNOTATION_SIZES = Object.freeze([11, 14, 18, 24]);

/**
 * A measurement between two points on the plan.
 *
 * ## Anchored where it can be, free where it cannot
 *
 * Both ends carry a point *and*, optionally, the id of a corner the point was
 * placed on. The corner wins whenever it still exists: a dimension drawn across
 * a room and then stretched by dragging one of that room's corners keeps
 * measuring the room, rather than quietly reporting the distance the room used
 * to be. A dimension whose corner is deleted falls back to the stored point -
 * the last place the corner was - so it degrades to a free dimension instead of
 * vanishing or throwing.
 *
 * The alternative, storing only free points, is simpler and produces a drawing
 * that lies after the first edit. The alternative in the other direction,
 * storing only corner ids, cannot express "600 mm from this wall to that piece
 * of furniture", which is most of what a dimension is for.
 */
export class Dimension
{
	/**
	 * @param {import('./floorplan.js').Floorplan} floorplan The plan that owns this.
	 * @param {number} ax Start, in centimetres.
	 * @param {number} ay
	 * @param {number} bx End, in centimetres.
	 * @param {number} by
	 * @param {Object} [options]
	 * @param {number} [options.offset] Signed distance from the measured line, cm.
	 * @param {?string} [options.aCorner] Corner id the start is pinned to.
	 * @param {?string} [options.bCorner] Corner id the end is pinned to.
	 * @param {string} [options.id] Restored from a file; minted when absent.
	 */
	constructor(floorplan, ax, ay, bx, by, options)
	{
		var settings = options || {};
		this.floorplan = floorplan;
		/** @type {string} */
		this.id = settings.id || Utils.guide();
		/** Start point, in centimetres. Used when `aCorner` names nothing that exists. */
		this.ax = finite(ax);
		this.ay = finite(ay);
		/** End point, in centimetres. */
		this.bx = finite(bx);
		this.by = finite(by);
		/**
		 * Which side of the measured line the dimension line sits on, and how far.
		 *
		 * Signed rather than a separate side flag, because "flip it to the other
		 * side" and "move it further out" are the same gesture with a pointer and
		 * the same number in a field.
		 *
		 * @type {number}
		 */
		this.offset = (typeof settings.offset === 'number' && isFinite(settings.offset))
			? settings.offset : DEFAULT_DIMENSION_OFFSET;
		/** @type {?string} */
		this.aCorner = settings.aCorner || null;
		/** @type {?string} */
		this.bCorner = settings.bCorner || null;
	}

	/**
	 * Where this dimension's two ends actually are, right now.
	 *
	 * The one place the corner-or-point rule is applied, so the drawing, the
	 * measurement, the hit test and the file can never disagree about it.
	 *
	 * @returns {{ax: number, ay: number, bx: number, by: number}} Centimetres.
	 */
	points()
	{
		var a = this._resolve(this.aCorner, this.ax, this.ay);
		var b = this._resolve(this.bCorner, this.bx, this.by);
		return {ax: a.x, ay: a.y, bx: b.x, by: b.y};
	}

	/**
	 * @param {?string} cornerId
	 * @param {number} x Fallback.
	 * @param {number} y
	 * @returns {{x: number, y: number}}
	 */
	_resolve(cornerId, x, y)
	{
		if (cornerId && this.floorplan)
		{
			var corners = this.floorplan.getCorners();
			for (var i = 0; i < corners.length; i++)
			{
				if (corners[i].id === cornerId)
				{
					return {x: corners[i].x, y: corners[i].y};
				}
			}
		}
		return {x: x, y: y};
	}

	/** What this dimension measures, in centimetres. */
	get length()
	{
		var p = this.points();
		return Math.sqrt((p.bx - p.ax) * (p.bx - p.ax) + (p.by - p.ay) * (p.by - p.ay));
	}

	/**
	 * Move the dimension line nearer to or further from what it measures.
	 * @param {number} value Signed centimetres.
	 */
	setOffset(value)
	{
		if (typeof value !== 'number' || !isFinite(value) || value === this.offset)
		{
			return;
		}
		this.offset = value;
		this._changed();
	}

	/**
	 * Move one end.
	 *
	 * Detaches that end from its corner, because a point dragged somewhere else
	 * is no longer the corner's - and leaving the id behind would make the drag
	 * appear to do nothing at all.
	 *
	 * @param {string} end `'a'` or `'b'`.
	 * @param {number} x Centimetres.
	 * @param {number} y
	 * @param {?string} [cornerId] The corner it landed on, if any.
	 */
	moveEnd(end, x, y, cornerId)
	{
		if (!isFinite(x) || !isFinite(y))
		{
			return;
		}
		if (end === 'a')
		{
			this.ax = x;
			this.ay = y;
			this.aCorner = cornerId || null;
		}
		else
		{
			this.bx = x;
			this.by = y;
			this.bCorner = cornerId || null;
		}
		this._changed();
	}

	/**
	 * The record written to a file.
	 *
	 * Explicit, per T-6, and the two corner ids are omitted when null so a free
	 * dimension does not carry two nulls into every file.
	 *
	 * @returns {Record<string, any>}
	 */
	toJSON()
	{
		/** @type {Record<string, any>} */
		var record = {
			id: this.id,
			a: {x: this.ax, y: this.ay},
			b: {x: this.bx, y: this.by},
			offset: this.offset,
		};
		if (this.aCorner)
		{
			record.aCorner = this.aCorner;
		}
		if (this.bCorner)
		{
			record.bCorner = this.bCorner;
		}
		return record;
	}

	/**
	 * Read one back.
	 *
	 * Tolerant in the same way `Floorplan._buildFloorplan` is: a record missing a
	 * field gets this class's default rather than refusing the load, because
	 * `DesignDocument.parse` has already rejected the shapes that cannot be drawn
	 * and everything past that point is a file this build should open.
	 *
	 * @param {import('./floorplan.js').Floorplan} floorplan
	 * @param {Record<string, any>} record
	 * @returns {Dimension}
	 */
	static fromJSON(floorplan, record)
	{
		var a = record.a || {};
		var b = record.b || {};
		return new Dimension(floorplan, a.x, a.y, b.x, b.y, {
			offset: record.offset,
			aCorner: record.aCorner,
			bCorner: record.bCorner,
			id: record.id,
		});
	}
}

/**
 * A piece of free text on the plan.
 *
 * ## Screen pixels, not centimetres
 *
 * `size` is a font size in CSS pixels, so a label stays legible at every zoom
 * rather than turning into two pixels of grey when the plan is zoomed out to
 * find something. That is the same choice every other piece of text on this
 * canvas already makes - `drawTextLabel` has been a fixed `12px` since the
 * drawing code was written - and a label that scaled while the wall lengths
 * beside it did not would read as a bug.
 *
 * It is the wrong choice for a sheet printed at 1:50, where text has a physical
 * size. E4 owns that: the export backend knows its scale and this class does
 * not, so the conversion belongs there and is noted in E4's plan rather than
 * anticipated here with a field nothing sets.
 */
export class TextAnnotation
{
	/**
	 * @param {import('./floorplan.js').Floorplan} floorplan
	 * @param {number} x Centimetres.
	 * @param {number} y
	 * @param {string} [text]
	 * @param {Object} [options]
	 * @param {number} [options.size] CSS pixels.
	 * @param {string} [options.id]
	 */
	constructor(floorplan, x, y, text, options)
	{
		var settings = options || {};
		this.floorplan = floorplan;
		/** @type {string} */
		this.id = settings.id || Utils.guide();
		this.x = finite(x);
		this.y = finite(y);
		/** @type {string} */
		this.text = (typeof text === 'string') ? text : DEFAULT_ANNOTATION_TEXT;
		/** @type {number} */
		this.size = (typeof settings.size === 'number' && isFinite(settings.size) && settings.size > 0)
			? settings.size : DEFAULT_ANNOTATION_SIZE;
	}

	/**
	 * @param {string} value
	 */
	setText(value)
	{
		var next = (typeof value === 'string') ? value : '';
		if (next === this.text)
		{
			return;
		}
		this.text = next;
		this._changed();
	}

	/**
	 * @param {number} value CSS pixels.
	 */
	setSize(value)
	{
		if (typeof value !== 'number' || !isFinite(value) || value <= 0 || value === this.size)
		{
			return;
		}
		this.size = value;
		this._changed();
	}

	/**
	 * @param {number} x Centimetres.
	 * @param {number} y
	 */
	moveTo(x, y)
	{
		if (!isFinite(x) || !isFinite(y) || (x === this.x && y === this.y))
		{
			return;
		}
		this.x = x;
		this.y = y;
		this._changed();
	}

	/**
	 * Explicit, per T-6. `size` is written only when it is not the default, for
	 * the same reason the collection itself is written only when it is not empty:
	 * a default in a file is a decision frozen where nobody made one.
	 *
	 * @returns {Record<string, any>}
	 */
	toJSON()
	{
		/** @type {Record<string, any>} */
		var record = {id: this.id, x: this.x, y: this.y, text: this.text};
		if (this.size !== DEFAULT_ANNOTATION_SIZE)
		{
			record.size = this.size;
		}
		return record;
	}

	/**
	 * @param {import('./floorplan.js').Floorplan} floorplan
	 * @param {Record<string, any>} record
	 * @returns {TextAnnotation}
	 */
	static fromJSON(floorplan, record)
	{
		return new TextAnnotation(floorplan, record.x, record.y, record.text, {
			size: record.size,
			id: record.id,
		});
	}
}

/**
 * Tell the owning plan that something in its annotation set moved.
 *
 * Shared by both classes through the prototype rather than written twice, and
 * defended against a plan that has no such method - a `Dimension` constructed
 * in a test with a bare object for a floorplan is a legitimate subject, and the
 * announcement is not what such a test is about.
 *
 * @this {Dimension|TextAnnotation}
 * @returns {void}
 */
function announce()
{
	if (this.floorplan && typeof this.floorplan.annotationsChanged === 'function')
	{
		this.floorplan.annotationsChanged();
	}
}

Dimension.prototype._changed = announce;
TextAnnotation.prototype._changed = announce;

/**
 * A number, or zero.
 *
 * The same rule `plan_projection.js` states and for the same reason: a NaN
 * coordinate draws nothing anywhere and is invisible in a bug report, while a
 * zero draws something wrong in a known place.
 *
 * @param {*} value
 * @returns {number}
 */
function finite(value)
{
	return (typeof value === 'number' && isFinite(value)) ? value : 0;
}

/**
 * Where a dimension's own line runs: the two measured points, pushed out
 * perpendicular by the offset (RM-008 E3).
 *
 * Exported and shared rather than computed twice, because four things need this
 * one answer and any disagreement between them is a bug nobody can see: the
 * view draws the line here, the view draws the witness lines to its ends, the
 * view puts the measurement at its midpoint, and `Floorplan.overlappedDimension`
 * hit-tests against it. Two copies of this formula would eventually be picked in
 * a place they are not drawn.
 *
 * Null for a zero-length dimension, which has no perpendicular to offset along.
 * `Floorplan.newDimension` refuses to make one, so this can only be reached by a
 * file that carried one - and a null is the caller's cue to draw nothing rather
 * than to divide by zero.
 *
 * @param {Dimension} dimension
 * @returns {?{ax: number, ay: number, bx: number, by: number, nx: number, ny: number, length: number}}
 *          The offset line, the unit normal it was offset along, and what it measures.
 */
export function dimensionLine(dimension)
{
	var p = dimension.points();
	var dx = p.bx - p.ax;
	var dy = p.by - p.ay;
	var length = Math.sqrt(dx * dx + dy * dy);
	if (!(length > 1e-6))
	{
		return null;
	}
	// The normal (-dy, dx), so a positive offset is always the same side of the
	// direction the dimension was drawn in and the sign of `offset` means
	// something stable. Which side that looks like on screen depends on the
	// canvas' y running downwards, and is deliberately not asserted here: what
	// matters is that flipping the sign flips the side, and that the drawing and
	// the hit test agree because both come through this function.
	var nx = -dy / length;
	var ny = dx / length;
	return {
		ax: p.ax + nx * dimension.offset,
		ay: p.ay + ny * dimension.offset,
		bx: p.bx + nx * dimension.offset,
		by: p.by + ny * dimension.offset,
		nx: nx,
		ny: ny,
		length: length,
	};
}
