// @ts-check
/**
 * Where the plan is drawn (RM-008 E4).
 *
 * ## The finding this exists to act on
 *
 * RM-008 T-5 counted every raw `this.context.*` call in `floorplanner_view.js`
 * and attributed each one to the method it sits in: 77 calls, 64 of them inside
 * a handful of primitives, two outliers. The conclusion was that a second output
 * format is "implement the primitives against another backend and refactor two
 * methods", not a rewrite - and that is what makes plan export a one-week sprint
 * instead of a programme.
 *
 * **Re-measured at the start of E4, after E1, E2 and E3 had each added drawing
 * code: 92 calls, and the primitive surface is eleven operations rather than
 * eight.** The three extra are real and each came from a delivered sprint - E1's
 * door swings and E3's north arrow need an `arc`, E2's alignment guides need a
 * dash pattern, and E3's dimension labels need rotated text. A fourth is the
 * interesting one: E3's declutter pass needs to *measure* text, and a format
 * with no font metrics cannot. See {@link SvgBackend#measureText}.
 *
 * ## What a backend is, and what it deliberately is not
 *
 * It is a set of stateless drawing operations in **canvas pixels**, each one
 * carrying its own colour and width. There is no state to set and restore, no
 * transform stack and no current path: every call says everything about itself.
 *
 * That shape is chosen for the export, not for the canvas. A stateful interface
 * maps onto `CanvasRenderingContext2D` for free and onto SVG badly, because SVG
 * has no notion of "the style in force" - each element carries its own. Making
 * the *interface* stateless costs the canvas backend nothing measurable (it sets
 * two or three properties per call, which is what the old code did anyway) and
 * makes the SVG backend a direct translation rather than an interpreter.
 *
 * Rotation is a parameter of `text` rather than a transform, for the same
 * reason: it is the only rotation the plan draws, and an SVG `<text>` carries
 * its own.
 */

/**
 * Round a coordinate for output.
 *
 * Two decimal places, in a file whose units are pixels: a hundredth of a pixel
 * is far below anything a printer or a screen can resolve, and the full float
 * would roughly double the size of every path in the document for nothing.
 *
 * @param {number} value
 * @returns {number}
 */
function round(value)
{
	return Math.round(value * 100) / 100;
}

/**
 * XML-escape a string for a text node or an attribute.
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value)
{
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * The plan, drawn into a `CanvasRenderingContext2D`.
 *
 * This is the live view's backend and it is deliberately a thin one - every
 * method below is the body the corresponding `FloorplannerView2D` primitive had
 * before E4, moved rather than rewritten, so the screen keeps drawing exactly
 * what it drew.
 */
export class CanvasBackend
{
	/**
	 * @param {CanvasRenderingContext2D} context
	 * @param {string} [font] The family every label is set in.
	 * @param {?string} [background] A ground to paint instead of clearing to
	 *        transparency. The live view leaves this null - it clears, and
	 *        `draw()` paints the theme's own ground a line later.
	 */
	constructor(context, font, background)
	{
		this.context = context;
		this.font = font || 'Arial';
		this.background = background || null;
		/**
		 * What this backend last wrote to the context's text state (RM-015 M2).
		 *
		 * Null means "unknown", which is the safe reading: the next call assigns.
		 * See `_useFont` for why an assignment nobody needs is worth avoiding.
		 *
		 * @type {?string}
		 */
		this._font = null;
		// The two below carry the DOM's own union types rather than `string`: the
		// context properties they mirror are `CanvasTextBaseline` and
		// `CanvasTextAlign`, and a widened cache is a cache the checker will not
		// let you write back (RM-004 B3).
		/** @type {?CanvasTextBaseline} See _font. */
		this._baseline = null;
		/** @type {?CanvasTextAlign} See _font. */
		this._align = null;
	}

	/**
	 * @param {number} width CSS pixels.
	 * @param {number} height
	 */
	clear(width, height)
	{
		this.context.clearRect(0, 0, width, height);
		// A PNG is composited over nothing, so a sheet needs its own ground or it
		// arrives transparent and prints as whatever is behind it.
		//
		// `renderPlanToCanvas` used to fill the canvas before calling `renderTo`,
		// which cannot work: `draw()` opens with this clear, so the ground was
		// wiped a moment after being painted. It went unnoticed because the app
		// sets `floorplannerPalette.background` from its theme and `draw()` paints
		// that immediately afterwards - so the sheet was opaque in the application
		// and transparent for a library embedder who had not styled anything.
		// Found by exporting a sheet in a bare page and reading the alpha channel
		// (RM-008 F3).
		if (this.background)
		{
			this.context.fillStyle = this.background;
			// Rounded UP, because a sheet's size is a fraction of a pixel: the
			// canvas bitmap is `Math.ceil(sheet.height)` tall and the logical size
			// is not, so filling the logical rectangle left the last row of the
			// image transparent. Measured as exactly `width` pixels with an alpha
			// below 255 - one row - which is the sort of number that says what it
			// is if you count it and says nothing if you eyeball it.
			this.context.fillRect(0, 0, Math.ceil(width), Math.ceil(height));
		}
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {number} width
	 * @param {number} height
	 * @param {string} color
	 */
	fillRect(x, y, width, height, color)
	{
		this.context.fillStyle = color;
		this.context.fillRect(x, y, width, height);
	}

	/**
	 * @param {number} x1
	 * @param {number} y1
	 * @param {number} x2
	 * @param {number} y2
	 * @param {number} width
	 * @param {string} color
	 */
	line(x1, y1, x2, y2, width, color)
	{
		this.context.beginPath();
		this.context.moveTo(x1, y1);
		this.context.lineTo(x2, y2);
		this.context.closePath();
		this.context.lineWidth = width;
		this.context.strokeStyle = color;
		this.context.stroke();
	}

	/**
	 * A cubic bezier.
	 *
	 * @param {number} x1 Start.
	 * @param {number} y1
	 * @param {number} ax First control point.
	 * @param {number} ay
	 * @param {number} bx Second control point.
	 * @param {number} by
	 * @param {number} x2 End.
	 * @param {number} y2
	 * @param {number} width
	 * @param {string} color
	 */
	curve(x1, y1, ax, ay, bx, by, x2, y2, width, color)
	{
		this.context.beginPath();
		this.context.moveTo(x1, y1);
		this.context.bezierCurveTo(ax, ay, bx, by, x2, y2);
		this.context.lineWidth = width;
		this.context.strokeStyle = color;
		this.context.stroke();
	}

	/**
	 * A closed polygon from parallel coordinate arrays.
	 *
	 * @param {Array<number>} xs
	 * @param {Array<number>} ys
	 * @param {?string} fillColor Null for no fill.
	 * @param {?string} strokeColor Null for no stroke.
	 * @param {number} [strokeWidth]
	 */
	polygon(xs, ys, fillColor, strokeColor, strokeWidth)
	{
		if (!xs.length)
		{
			return;
		}
		this.context.beginPath();
		this.context.moveTo(xs[0], ys[0]);
		for (var i = 1; i < xs.length; i++)
		{
			this.context.lineTo(xs[i], ys[i]);
		}
		this.context.closePath();
		if (fillColor)
		{
			this.context.fillStyle = fillColor;
			this.context.fill();
		}
		if (strokeColor)
		{
			this.context.lineWidth = strokeWidth || 1;
			this.context.strokeStyle = strokeColor;
			this.context.stroke();
		}
	}

	/**
	 * A closed outline of straight and curved segments.
	 *
	 * `segments` is the shape `Room.roomCornerPoints` produces once projected: an
	 * array of point arrays, where one point is a line to it and three points are
	 * a bezier's two controls and its end.
	 *
	 * @param {Array<Array<{x: number, y: number}>>} segments Canvas pixels.
	 * @param {?string} fillColor
	 * @param {?string} strokeColor
	 * @param {number} [strokeWidth]
	 */
	path(segments, fillColor, strokeColor, strokeWidth)
	{
		if (!segments.length)
		{
			return;
		}
		this.context.beginPath();
		for (var i = 0; i < segments.length; i++)
		{
			var points = segments[i];
			if (points.length === 1)
			{
				if (i === 0)
				{
					this.context.moveTo(points[0].x, points[0].y);
				}
				else
				{
					this.context.lineTo(points[0].x, points[0].y);
				}
			}
			else if (points.length === 3)
			{
				this.context.bezierCurveTo(points[0].x, points[0].y, points[1].x, points[1].y, points[2].x, points[2].y);
			}
		}
		this.context.closePath();
		if (fillColor)
		{
			this.context.fillStyle = fillColor;
			this.context.fill();
		}
		if (strokeColor)
		{
			this.context.lineWidth = strokeWidth || 1;
			this.context.strokeStyle = strokeColor;
			this.context.stroke();
		}
	}

	/**
	 * @param {number} cx
	 * @param {number} cy
	 * @param {number} radius
	 * @param {string} color
	 */
	circle(cx, cy, radius, color)
	{
		this.context.beginPath();
		this.context.arc(cx, cy, radius, 0, 2 * Math.PI, false);
		this.context.closePath();
		this.context.fillStyle = color;
		this.context.fill();
	}

	/**
	 * A stroked arc.
	 *
	 * @param {number} cx
	 * @param {number} cy
	 * @param {number} radius
	 * @param {number} start Radians.
	 * @param {number} end Radians.
	 * @param {number} width
	 * @param {string} color
	 */
	arc(cx, cy, radius, start, end, width, color)
	{
		this.context.beginPath();
		this.context.arc(cx, cy, radius, start, end, false);
		this.context.lineWidth = width;
		this.context.strokeStyle = color;
		this.context.stroke();
	}

	/**
	 * A centred label, optionally rotated and optionally with a halo behind it.
	 *
	 * @param {string} label
	 * @param {number} x Centre.
	 * @param {number} y Centre.
	 * @param {Object} options
	 * @param {string} options.color
	 * @param {?string} [options.halo] Stroked behind the fill so the text stays
	 *        legible over a filled room. Null or a zero-alpha colour for none.
	 * @param {number} options.size CSS pixels.
	 * @param {string} [options.style] A CSS font style/weight prefix.
	 * @param {number} [options.rotation] Radians.
	 * @param {number} [options.offsetY] Applied in the label's OWN frame, after
	 *        the rotation - which is the only way to put a dimension's
	 *        measurement a fixed distance clear of a line running any direction.
	 *        Applying it to `y` instead would push a vertical dimension's label
	 *        along the line rather than off it.
	 * @param {string} [options.anchor] `'middle'` (the default), `'start'` or
	 *        `'end'`. SVG's names rather than canvas', because the title block is
	 *        the only thing that needs one and SVG is the format it exists for.
	 */
	text(label, x, y, options)
	{
		var rotation = options.rotation || 0;
		var offsetY = options.offsetY || 0;
		if (rotation)
		{
			this.context.save();
			this.context.translate(x, y);
			this.context.rotate(rotation);
		}
		this._useFont(`${options.style || 'normal'} ${options.size}px ${this.font}`);
		this._useBaseline('middle');
		this._useAlign((options.anchor === 'end') ? 'right'
			: (options.anchor === 'start') ? 'left' : 'center');
		var atX = rotation ? 0 : x;
		var atY = (rotation ? 0 : y) + offsetY;
		if (options.halo)
		{
			this.context.strokeStyle = options.halo;
			this.context.lineWidth = 4;
			this.context.strokeText(label, atX, atY);
		}
		this.context.fillStyle = options.color;
		this.context.fillText(label, atX, atY);
		if (rotation)
		{
			this.context.restore();
			// `restore()` puts back the text state this method just set, so the
			// cache below no longer describes the context. Forgetting this is the
			// one way the optimisation turns into a rendering bug: the next label
			// would skip an assignment the context no longer has.
			this._forgetTextState();
		}
	}

	/**
	 * Set a canvas text property only when it is not already that.
	 *
	 * ## Why this is worth three methods (RM-015 M2)
	 *
	 * Assigning `context.font` parses a CSS font shorthand, and the 2D pass calls
	 * `text()` once per wall label. M2's phase timing at 400 walls put
	 * `drawWallLabels` at **0.595 ms of a 1.98 ms frame - 30 %, the single largest
	 * phase** - against `drawGrid` at 0.005 ms, which is what RM-007 had proposed
	 * caching. Every one of those labels asks for the same 12px face, so the
	 * assignment happens roughly a thousand times a frame and changes nothing
	 * 999 of them.
	 *
	 * The cache is per backend instance and describes what was last written to
	 * this context. Anything that can put the context's own state back - the
	 * `restore()` above - has to clear it, which is what `_forgetTextState` is for.
	 *
	 * @param {string} font
	 */
	_useFont(font)
	{
		if (this._font !== font)
		{
			this.context.font = font;
			this._font = font;
		}
	}

	/** @param {CanvasTextBaseline} baseline */
	_useBaseline(baseline)
	{
		if (this._baseline !== baseline)
		{
			this.context.textBaseline = baseline;
			this._baseline = baseline;
		}
	}

	/** @param {CanvasTextAlign} align */
	_useAlign(align)
	{
		if (this._align !== align)
		{
			this.context.textAlign = align;
			this._align = align;
		}
	}

	/** The context's text state is no longer what this backend last wrote. */
	_forgetTextState()
	{
		this._font = null;
		this._baseline = null;
		this._align = null;
	}

	/**
	 * @param {string} label
	 * @param {number} size
	 * @param {string} [style]
	 * @returns {number} Width in CSS pixels.
	 */
	measureText(label, size, style)
	{
		// Through the cache like everything else: measuring is the other half of
		// laying a label out, and a measure between two draws in the same face
		// should not cost an assignment either.
		this._useFont(`${style || 'normal'} ${size}px ${this.font}`);
		return this.context.measureText(label).width;
	}

	/**
	 * Set or clear the dash pattern subsequent strokes use.
	 * @param {Array<number>} pattern Empty for a solid line.
	 */
	dash(pattern)
	{
		this.context.setLineDash(pattern);
	}
}

/**
 * The plan, written as SVG.
 *
 * Accumulates elements and hands back a document. Deliberately a *string*
 * builder rather than a DOM one: this has to run with no browser, which is what
 * lets M-34 compare the two backends headlessly and what lets an embedder
 * generate a sheet on a server.
 *
 * ## The one thing it cannot do by itself
 *
 * Measure text. E3's declutter pass asks how wide a label will be before it
 * decides whether to draw it, and there is no font metric anywhere in a string
 * builder. Rather than guess - a guess would silently declutter the export
 * differently from the screen, which is the one thing an export must not do -
 * this takes a measuring function. The application passes the live canvas's, so
 * the sheet hides exactly the labels the screen hides. Given none, it falls back
 * to a width proportional to the character count and says so here, because a
 * fallback that is not written down is a bug waiting to be attributed to
 * something else.
 */
export class SvgBackend
{
	/**
	 * @param {number} width Document width in pixels.
	 * @param {number} height
	 * @param {Object} [options]
	 * @param {string} [options.font] The family every label is set in.
	 * @param {?function(string, number, string=): number} [options.measure]
	 *        Text measurement, usually a `CanvasBackend`'s.
	 */
	constructor(width, height, options)
	{
		var settings = options || {};
		this.width = width;
		this.height = height;
		this.font = settings.font || 'Arial';
		this.measure = settings.measure || null;
		/** @type {Array<string>} */
		this.elements = [];
		/** @type {Array<number>} */
		this._dash = [];
	}

	/**
	 * Discard everything drawn so far.
	 *
	 * SVG has no eraser, so "clear" is what it means for a document being built:
	 * start again. The arguments are accepted and ignored, so the two backends
	 * take the same call.
	 */
	clear()
	{
		this.elements.length = 0;
	}

	/**
	 * @param {number} x
	 * @param {number} y
	 * @param {number} width
	 * @param {number} height
	 * @param {string} color
	 */
	fillRect(x, y, width, height, color)
	{
		this.elements.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" fill="${escapeXml(color)}"/>`);
	}

	/** @returns {string} The dash attribute for the pattern in force, or ''. */
	_dashAttribute()
	{
		return this._dash.length ? ` stroke-dasharray="${this._dash.join(' ')}"` : '';
	}

	/**
	 * @param {number} x1
	 * @param {number} y1
	 * @param {number} x2
	 * @param {number} y2
	 * @param {number} width
	 * @param {string} color
	 */
	line(x1, y1, x2, y2, width, color)
	{
		this.elements.push(`<path d="M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${round(width)}"${this._dashAttribute()}/>`);
	}

	/**
	 * @param {number} x1
	 * @param {number} y1
	 * @param {number} ax
	 * @param {number} ay
	 * @param {number} bx
	 * @param {number} by
	 * @param {number} x2
	 * @param {number} y2
	 * @param {number} width
	 * @param {string} color
	 */
	curve(x1, y1, ax, ay, bx, by, x2, y2, width, color)
	{
		this.elements.push(`<path d="M ${round(x1)} ${round(y1)} C ${round(ax)} ${round(ay)} ${round(bx)} ${round(by)} ${round(x2)} ${round(y2)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${round(width)}"${this._dashAttribute()}/>`);
	}

	/**
	 * @param {Array<number>} xs
	 * @param {Array<number>} ys
	 * @param {?string} fillColor
	 * @param {?string} strokeColor
	 * @param {number} [strokeWidth]
	 */
	polygon(xs, ys, fillColor, strokeColor, strokeWidth)
	{
		if (!xs.length)
		{
			return;
		}
		var d = `M ${round(xs[0])} ${round(ys[0])}`;
		for (var i = 1; i < xs.length; i++)
		{
			d += ` L ${round(xs[i])} ${round(ys[i])}`;
		}
		d += ' Z';
		this._pushPath(d, fillColor, strokeColor, strokeWidth);
	}

	/**
	 * @param {Array<Array<{x: number, y: number}>>} segments
	 * @param {?string} fillColor
	 * @param {?string} strokeColor
	 * @param {number} [strokeWidth]
	 */
	path(segments, fillColor, strokeColor, strokeWidth)
	{
		if (!segments.length)
		{
			return;
		}
		var d = '';
		for (var i = 0; i < segments.length; i++)
		{
			var points = segments[i];
			if (points.length === 1)
			{
				d += `${d ? ' L' : 'M'} ${round(points[0].x)} ${round(points[0].y)}`;
			}
			else if (points.length === 3)
			{
				d += ` C ${round(points[0].x)} ${round(points[0].y)} ${round(points[1].x)} ${round(points[1].y)} ${round(points[2].x)} ${round(points[2].y)}`;
			}
		}
		if (!d)
		{
			return;
		}
		this._pushPath(`${d} Z`, fillColor, strokeColor, strokeWidth);
	}

	/**
	 * @param {string} d
	 * @param {?string} fillColor
	 * @param {?string} strokeColor
	 * @param {number} [strokeWidth]
	 */
	_pushPath(d, fillColor, strokeColor, strokeWidth)
	{
		var stroke = strokeColor
			? ` stroke="${escapeXml(strokeColor)}" stroke-width="${round(strokeWidth || 1)}"${this._dashAttribute()}`
			: '';
		this.elements.push(`<path d="${d}" fill="${fillColor ? escapeXml(fillColor) : 'none'}"${stroke}/>`);
	}

	/**
	 * @param {number} cx
	 * @param {number} cy
	 * @param {number} radius
	 * @param {string} color
	 */
	circle(cx, cy, radius, color)
	{
		this.elements.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="${escapeXml(color)}"/>`);
	}

	/**
	 * An arc, as a path.
	 *
	 * Canvas takes a centre, a radius and two angles; SVG's `A` command takes an
	 * endpoint and two flags. The conversion is the endpoints from the angles,
	 * `large-arc` from the sweep exceeding half a turn, and `sweep` always 1
	 * because every caller here draws anticlockwise=false.
	 *
	 * @param {number} cx
	 * @param {number} cy
	 * @param {number} radius
	 * @param {number} start Radians.
	 * @param {number} end Radians.
	 * @param {number} width
	 * @param {string} color
	 */
	arc(cx, cy, radius, start, end, width, color)
	{
		var sweep = end - start;
		// A full turn cannot be drawn with one A command - its two endpoints
		// coincide and the renderer draws nothing at all - so it goes out as a
		// circle, which is what it is.
		if (Math.abs(sweep) >= Math.PI * 2 - 1e-9)
		{
			this.elements.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${round(width)}"${this._dashAttribute()}/>`);
			return;
		}
		var x1 = cx + Math.cos(start) * radius;
		var y1 = cy + Math.sin(start) * radius;
		var x2 = cx + Math.cos(end) * radius;
		var y2 = cy + Math.sin(end) * radius;
		var large = Math.abs(sweep) > Math.PI ? 1 : 0;
		var direction = sweep >= 0 ? 1 : 0;
		this.elements.push(`<path d="M ${round(x1)} ${round(y1)} A ${round(radius)} ${round(radius)} 0 ${large} ${direction} ${round(x2)} ${round(y2)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${round(width)}"${this._dashAttribute()}/>`);
	}

	/**
	 * @param {string} label
	 * @param {number} x
	 * @param {number} y
	 * @param {Object} options See {@link CanvasBackend#text}.
	 */
	text(label, x, y, options)
	{
		var rotation = options.rotation || 0;
		var transform = rotation
			? ` transform="translate(${round(x)} ${round(y)}) rotate(${round(rotation * 180 / Math.PI)})"`
			: '';
		var atX = rotation ? 0 : round(x);
		var atY = round((rotation ? 0 : y) + (options.offsetY || 0));
		// `paint-order: stroke` draws the halo behind the glyphs instead of over
		// them, which is what the canvas backend's strokeText-then-fillText does.
		// Without it a 4px halo eats the letterforms from the outside in.
		var halo = options.halo
			? ` stroke="${escapeXml(options.halo)}" stroke-width="4" paint-order="stroke"`
			: '';
		var style = options.style || 'normal';
		var weight = style.indexOf('bold') >= 0 ? ' font-weight="bold"' : '';
		var italic = style.indexOf('italic') >= 0 ? ' font-style="italic"' : '';
		var anchor = options.anchor || 'middle';
		this.elements.push(
			`<text x="${atX}" y="${atY}"${transform} font-family="${escapeXml(this.font)}" font-size="${round(options.size)}"`
			+ `${weight}${italic} fill="${escapeXml(options.color)}"${halo} text-anchor="${escapeXml(anchor)}" dominant-baseline="central">`
			+ `${escapeXml(label)}</text>`);
	}

	/**
	 * @param {string} label
	 * @param {number} size
	 * @param {string} [style]
	 * @returns {number} Width in pixels.
	 */
	measureText(label, size, style)
	{
		if (this.measure)
		{
			return this.measure(label, size, style);
		}
		// See the class docblock: a stated fallback rather than a silent one. 0.55
		// of the point size is about right for a proportional sans at mixed case,
		// and it is only ever used when nobody supplied a real measurer.
		return String(label).length * size * 0.55;
	}

	/** @param {Array<number>} pattern */
	dash(pattern)
	{
		this._dash = pattern || [];
	}

	/**
	 * The finished document.
	 *
	 * @param {Object} [options]
	 * @param {string} [options.title] Written into `<title>`, which is what a
	 *        screen reader announces and what a browser tab shows.
	 * @returns {string}
	 */
	toSVG(options)
	{
		var settings = options || {};
		var title = settings.title ? `<title>${escapeXml(settings.title)}</title>` : '';
		return '<?xml version="1.0" encoding="UTF-8"?>\n'
			+ `<svg xmlns="http://www.w3.org/2000/svg" width="${round(this.width)}" height="${round(this.height)}" `
			+ `viewBox="0 0 ${round(this.width)} ${round(this.height)}">${title}\n`
			+ this.elements.join('\n')
			+ '\n</svg>\n';
	}
}
