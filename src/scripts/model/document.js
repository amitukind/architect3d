// @ts-check
// SAVE_UNITS lives with the code that writes it. No cycle: floorplan.js does not
// import this module - Model is what puts the two together.
import {SAVE_UNITS} from './floorplan.js';

/**
 * Parse, validate and normalise a `.blueprint3d` document (RM-003 A1).
 *
 * ## What this exists to stop
 *
 * `Model.loadSerialized()` used to parse and then mutate live state directly,
 * and `Model.newRoom()` called `scene.clearItems()` *before*
 * `floorplan.loadFloorplan()` - which itself opens with `reset()`. So the open
 * design was destroyed before the incoming one had been examined at all. Ten
 * well-formed-JSON documents that are not designs each emptied the current plan,
 * and `{"items":[]}` did it without even throwing: EVENT_LOADED fired, the
 * application reported success, and autosave wrote the empty plan over the
 * draft. Only a JSON *syntax* error was safe, and only by accident.
 *
 * ## Validate completely, then apply
 *
 * Everything below runs before a single byte of live state is touched. The
 * atomicity guarantee is therefore structural rather than careful: by the time
 * anything is mutated, the only way to fail is a bug, not a bad file.
 *
 * The RM-003 plan called for building a replacement `Floorplan` off to the side
 * and swapping it in. That is not what this does, and the reason is worth
 * recording. `Model.floorplan` is subscribed to by `Main`, `Floorplan3D`,
 * `Floorplanner2D` and four Vue composables, all by object identity - swapping
 * the object silently detaches every one of them. Validating the whole document
 * up front delivers the same guarantee (a bad document never reaches live state)
 * without touching the identity that half the codebase is holding. The "build
 * off to the side" step still happens; it happens at the *data* level, which is
 * what this class returns.
 *
 * ## Lenient where the format is lenient
 *
 * The validator must not be stricter than the corpus of files people already
 * have. A pre-2.0.0 document has no `units` stamp, no `elevation` on its
 * corners, and no control points on its walls; all three are optional here for
 * exactly the reasons `Floorplan.loadFloorplan` documents. An unknown `units`
 * value is a **warning**, not a refusal - refusing to open a design is a worse
 * outcome than opening one whose scale the user can see is wrong, which is the
 * rule that code already followed with a `console.warn`.
 */

/**
 * @typedef {Object} DocumentProblem
 * @property {string} path Where in the document, in dotted notation.
 * @property {string} message What is wrong with it, in a sentence.
 */

/**
 * A discriminated union rather than four independent properties (RM-005 C2).
 *
 * It used to read `{ok: boolean, document: ?DesignDocument, ...}`, which says
 * the two are unrelated - so `if (!result.ok) { return; }` narrowed nothing and
 * every use of `result.document` past that guard was a possibly-null. The
 * comment "Null when `ok` is false" was the whole of the relationship, and a
 * comment is not a type.
 *
 * @typedef {Object} ParseFailure
 * @property {false} ok
 * @property {null} document
 * @property {Array<DocumentProblem>} errors
 * @property {Array<DocumentProblem>} warnings
 */

/**
 * @typedef {Object} ParseSuccess
 * @property {true} ok
 * @property {DesignDocument} document
 * @property {Array<DocumentProblem>} errors
 * @property {Array<DocumentProblem>} warnings
 */

/** @typedef {ParseFailure|ParseSuccess} ParseResult */

/**
 * @param {*} value
 * @returns {boolean}
 */
function isFiniteNumber(value)
{
	return typeof value === 'number' && isFinite(value);
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value)
{
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A validated document. Construct through {@link DesignDocument.parse}.
 */
export class DesignDocument
{
	/**
	 * @param {Object} data The raw parsed document, already validated.
	 */
	constructor(data)
	{
		/** The floorplan record, as the file carried it. */
		this.floorplan = data.floorplan;
		/** The item records, as the file carried them. */
		this.items = data.items;
		/** The `version` stamp, or null on a pre-2.0.0 file. */
		this.version = (typeof data.floorplan.version === 'string') ? data.floorplan.version : null;
		/**
		 * The `units` stamp, or null when the file does not carry one - which means
		 * pre-2.0.0, where coordinates were written in whatever display unit
		 * happened to be active at save time. `Floorplan.loadFloorplan` is what
		 * acts on that; this only records it.
		 */
		this.units = (typeof data.floorplan.units === 'string') ? data.floorplan.units : null;
	}

	/** How many corners, walls and items the document declares. */
	summary()
	{
		return {
			corners: Object.keys(this.floorplan.corners).length,
			walls: this.floorplan.walls.length,
			items: this.items.length,
			version: this.version,
			units: this.units,
		};
	}

	/**
	 * Read a `.blueprint3d` document without touching anything.
	 *
	 * Never throws - a malformed document is a result, not an exception, because
	 * the caller has to decide what to do about it and "the file is broken" is not
	 * an exceptional circumstance for a file-opening function.
	 *
	 * Every problem is collected rather than the first one thrown, so a caller can
	 * show a person what is wrong with their file instead of one arbitrary
	 * symptom of it.
	 *
	 * @param {string} json
	 * @returns {ParseResult}
	 */
	static parse(json)
	{
		/** @type {Array<DocumentProblem>} */
		var errors = [];
		/** @type {Array<DocumentProblem>} */
		var warnings = [];

		var data;
		try
		{
			data = JSON.parse(json);
		}
		catch (error)
		{
			return {
				ok: false,
				document: null,
				errors: [{path: '', message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`}],
				warnings: warnings,
			};
		}

		if (!isPlainObject(data))
		{
			return {
				ok: false,
				document: null,
				errors: [{path: '', message: `a design must be an object, not ${Array.isArray(data) ? 'an array' : String(data === null ? 'null' : typeof data)}`}],
				warnings: warnings,
			};
		}

		validateFloorplan(data.floorplan, errors, warnings);
		validateItems(data.items, errors);

		if (errors.length)
		{
			return {ok: false, document: null, errors: errors, warnings: warnings};
		}

		return {ok: true, document: new DesignDocument(data), errors: errors, warnings: warnings};
	}
}

/**
 * @param {*} floorplan
 * @param {Array<DocumentProblem>} errors
 * @param {Array<DocumentProblem>} warnings
 */
function validateFloorplan(floorplan, errors, warnings)
{
	if (!isPlainObject(floorplan))
	{
		errors.push({path: 'floorplan', message: 'missing - a design must carry a "floorplan" object'});
		return;
	}

	if (!isPlainObject(floorplan.corners))
	{
		errors.push({path: 'floorplan.corners', message: 'missing - a floorplan must carry a "corners" object, even an empty one'});
	}

	if (!Array.isArray(floorplan.walls))
	{
		errors.push({path: 'floorplan.walls', message: 'missing - a floorplan must carry a "walls" array, even an empty one'});
	}

	// Nothing below can run without both of the above.
	if (errors.length)
	{
		return;
	}

	Object.keys(floorplan.corners).forEach(function (id)
	{
		var corner = floorplan.corners[id];
		if (!isPlainObject(corner))
		{
			errors.push({path: `floorplan.corners.${id}`, message: 'is not an object'});
			return;
		}
		['x', 'y'].forEach(function (axis)
		{
			if (!isFiniteNumber(corner[axis]))
			{
				errors.push({path: `floorplan.corners.${id}.${axis}`, message: `must be a finite number, not ${JSON.stringify(corner[axis])}`});
			}
		});
		// elevation is optional - pre-2.0.0 files have none, and loadFloorplan
		// already treats a falsy value as "leave the default".
		if (corner.elevation !== undefined && corner.elevation !== null && !isFiniteNumber(corner.elevation))
		{
			errors.push({path: `floorplan.corners.${id}.elevation`, message: `must be a finite number, not ${JSON.stringify(corner.elevation)}`});
		}
	});

	floorplan.walls.forEach(function (wall, index)
	{
		if (!isPlainObject(wall))
		{
			errors.push({path: `floorplan.walls[${index}]`, message: 'is not an object'});
			return;
		}
		// The reference check is the one that matters most in practice: a wall
		// naming a corner that is not in the file used to reach `new Wall(undefined,
		// undefined)` and take the whole load down halfway through.
		['corner1', 'corner2'].forEach(function (end)
		{
			var id = wall[end];
			if (typeof id !== 'string' && typeof id !== 'number')
			{
				errors.push({path: `floorplan.walls[${index}].${end}`, message: 'missing - a wall must name the corner at each end'});
				return;
			}
			if (!Object.prototype.hasOwnProperty.call(floorplan.corners, String(id)))
			{
				errors.push({path: `floorplan.walls[${index}].${end}`, message: `names corner "${id}", which is not in this file`});
			}
		});

		// Optional since RM-008 E2 - absent means "follow the document" - so its
		// absence is never a defect. Present and unusable is, and loudly: a zero
		// or negative thickness collapses both half edges onto the wall centreline
		// and takes every room derived from them with it, which is a design that
		// opens looking empty rather than one that fails to open.
		if (wall.thickness !== undefined && wall.thickness !== null
			&& (typeof wall.thickness !== 'number' || !isFinite(wall.thickness) || wall.thickness <= 0))
		{
			errors.push({
				path: `floorplan.walls[${index}].thickness`,
				message: `must be a positive finite number of centimetres when present, not ${JSON.stringify(wall.thickness)}`,
			});
		}

		// Optional since RM-008 F2 - absent means "as high as its corners", which
		// is every wall in every older file. A zero or negative one is a wall with
		// no height, which draws nothing where a wall should be.
		if (wall.partialHeight !== undefined && wall.partialHeight !== null
			&& (typeof wall.partialHeight !== 'number' || !isFinite(wall.partialHeight) || wall.partialHeight <= 0))
		{
			errors.push({
				path: `floorplan.walls[${index}].partialHeight`,
				message: `must be a positive finite number of centimetres when present, not ${JSON.stringify(wall.partialHeight)}`,
			});
		}
	});

	// Authored collections, additive since RM-008 E3 and absent from every older
	// file, so their absence is never a defect. What is checked is only what
	// would draw wrongly or throw: a dimension needs two finite points, a label
	// needs a position. Everything else - a missing offset, a missing size, a
	// corner id naming a corner that is not here - has a documented default or a
	// documented fallback in `model/annotation.js`, and inventing requirements
	// for them would refuse files that open perfectly well.
	validateAnnotations(floorplan.dimensions, 'floorplan.dimensions', errors, function (record, path)
	{
		[['a', 'x'], ['a', 'y'], ['b', 'x'], ['b', 'y']].forEach(function (pair)
		{
			var end = record[pair[0]];
			if (!isPlainObject(end) || !isFiniteNumber(end[pair[1]]))
			{
				errors.push({path: `${path}.${pair[0]}.${pair[1]}`, message: 'a dimension must carry finite x and y at each end'});
			}
		});
		if (record.offset !== undefined && record.offset !== null && !isFiniteNumber(record.offset))
		{
			errors.push({path: `${path}.offset`, message: `must be a finite number of centimetres when present, not ${JSON.stringify(record.offset)}`});
		}
	});

	validateAnnotations(floorplan.annotations, 'floorplan.annotations', errors, function (record, path)
	{
		['x', 'y'].forEach(function (axis)
		{
			if (!isFiniteNumber(record[axis]))
			{
				errors.push({path: `${path}.${axis}`, message: `must be a finite number, not ${JSON.stringify(record[axis])}`});
			}
		});
		if (record.text !== undefined && record.text !== null && typeof record.text !== 'string')
		{
			errors.push({path: `${path}.text`, message: `must be a string when present, not ${JSON.stringify(record.text)}`});
		}
		if (record.size !== undefined && record.size !== null
			&& (!isFiniteNumber(record.size) || record.size <= 0))
		{
			errors.push({path: `${path}.size`, message: `must be a positive number of pixels when present, not ${JSON.stringify(record.size)}`});
		}
	});

	// Degrees clockwise from up. A value outside 0-360 is normalised on load
	// rather than refused - it is the same bearing written differently, and
	// refusing to open a design over it would be absurd.
	if (floorplan.north !== undefined && floorplan.north !== null && !isFiniteNumber(floorplan.north))
	{
		errors.push({path: 'floorplan.north', message: `must be a finite number of degrees when present, not ${JSON.stringify(floorplan.north)}`});
	}

	// `rooms` holds room metadata keyed by corner-id string. Absent on some files
	// and merely assigned by loadFloorplan, so its absence is not a defect - but a
	// non-object would be assigned and then indexed into.
	if (floorplan.rooms !== undefined && floorplan.rooms !== null && !isPlainObject(floorplan.rooms))
	{
		errors.push({path: 'floorplan.rooms', message: 'must be an object of room metadata when present'});
	}

	if (typeof floorplan.units === 'string' && floorplan.units !== SAVE_UNITS)
	{
		warnings.push({
			path: 'floorplan.units',
			message: `declares units "${floorplan.units}", which this build does not know. Reading coordinates as ${SAVE_UNITS}.`,
		});
	}
}

/**
 * The shape both authored collections share, checked once (RM-008 E3).
 *
 * Absent is fine, an array of objects is fine, anything else is not - and the
 * per-kind check only runs on records that are objects, so a caller never has to
 * defend against reading a field off a number.
 *
 * @param {*} collection
 * @param {string} path Dotted path to the collection, for the messages.
 * @param {Array<DocumentProblem>} errors
 * @param {function(Record<string, any>, string): void} checkRecord
 */
function validateAnnotations(collection, path, errors, checkRecord)
{
	if (collection === undefined || collection === null)
	{
		return;
	}
	if (!Array.isArray(collection))
	{
		errors.push({path: path, message: 'must be an array when present'});
		return;
	}
	collection.forEach(function (record, index)
	{
		if (!isPlainObject(record))
		{
			errors.push({path: `${path}[${index}]`, message: 'is not an object'});
			return;
		}
		checkRecord(record, `${path}[${index}]`);
	});
}

/**
 * @param {*} items
 * @param {Array<DocumentProblem>} errors
 */
function validateItems(items, errors)
{
	if (!Array.isArray(items))
	{
		errors.push({path: 'items', message: 'missing - a design must carry an "items" array, even an empty one'});
		return;
	}

	items.forEach(function (item, index)
	{
		if (!isPlainObject(item))
		{
			errors.push({path: `items[${index}]`, message: 'is not an object'});
			return;
		}
		// Only the fields whose absence breaks the load. Everything else has a
		// documented default in Model.newRoom, and inventing requirements here
		// would refuse files that open perfectly well today.
		// A parametric opening names no model, because it has none to name
		// (RM-008 F1): its mesh is built from `opening`. Every other item must
		// still say what to load, which is the check this has always been.
		if (!isPlainObject(item.opening) && (typeof item.model_url !== 'string' || item.model_url === ''))
		{
			errors.push({path: `items[${index}].model_url`, message: 'missing - an item must name the model to load'});
		}
		['xpos', 'ypos', 'zpos'].forEach(function (axis)
		{
			if (item[axis] !== undefined && !isFiniteNumber(item[axis]))
			{
				errors.push({path: `items[${index}].${axis}`, message: `must be a finite number, not ${JSON.stringify(item[axis])}`});
			}
		});

		// The opening description, additive since RM-008 F1 and absent from every
		// older file. Only the two numbers whose absence cannot be defaulted are
		// checked: `normaliseOpening` fills in a missing width or hinge from the
		// kind, but a width of "wide" or a height of -50 is a file saying something
		// it cannot mean, and a hole with no area cuts nothing and draws nothing.
		if (item.opening !== undefined && item.opening !== null)
		{
			if (!isPlainObject(item.opening))
			{
				errors.push({path: `items[${index}].opening`, message: 'must be an object when present'});
			}
			else
			{
				['width', 'height'].forEach(function (field)
				{
					var value = item.opening[field];
					if (value !== undefined && value !== null && (!isFiniteNumber(value) || value <= 0))
					{
						errors.push({
							path: `items[${index}].opening.${field}`,
							message: `must be a positive number of centimetres when present, not ${JSON.stringify(value)}`,
						});
					}
				});
			}
		}
	});
}
