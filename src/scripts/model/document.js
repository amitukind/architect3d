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
		/**
		 * The storeys, ground floor first, or null on a design that has one
		 * (RM-010 G1).
		 *
		 * Null rather than a one-entry array, because "this file says nothing about
		 * levels" and "this file says it has one level" are different statements
		 * and only the first is true of every design written before G1.
		 *
		 * `levels[0]` carries a name and a height only - the ground floor's plan
		 * and furniture stay at `floorplan` and `items`, which is what lets a build
		 * that has never heard of storeys open a three-storey house and get the
		 * ground floor rather than an error.
		 *
		 * @type {?Array<Object>}
		 */
		this.levels = Array.isArray(data.levels) && data.levels.length ? data.levels : null;
		/**
		 * The building's roof, or null (RM-010 G2). Absent from every design
		 * written before it, which is what keeps those files byte-identical.
		 * @type {?Object}
		 */
		this.roof = isPlainObject(data.roof) ? data.roof : null;
		/**
		 * The sun over the building, or null (RM-011 H2). Absent from every design
		 * written before it. `{}` is meaningful and not empty: it says the building
		 * has a sun and takes the defaults, which is why presence is tested rather
		 * than content.
		 * @type {?Object}
		 */
		this.sun = isPlainObject(data.sun) ? data.sun : null;
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
			levels: this.levels ? this.levels.length : 1,
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
		validateLevels(data.levels, data.floorplan, errors, warnings);
		validateRoof(data.roof, errors);
		validateSun(data.sun, errors);

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
		// A parametric item names no model, because it has none to name: an
		// opening's mesh is built from `opening` (RM-008 F1), a flight's from
		// `stair` (F3) and a column or beam's from `structure` (F2). Every other
		// item must still say what to load, which is the check this has always been.
		if (!isPlainObject(item.opening) && !isPlainObject(item.stair) && !isPlainObject(item.structure)
			&& (typeof item.model_url !== 'string' || item.model_url === ''))
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

		// The flight description, additive since RM-008 F3 and absent from every
		// older file. Same rule as the opening above: `normaliseStair` fills in a
		// missing going or handrail from the defaults and clamps a going of 4 cm
		// to the minimum, but a rise of "steep" or a tread count of -3 is a file
		// saying something it cannot mean.
		if (item.stair !== undefined && item.stair !== null)
		{
			if (!isPlainObject(item.stair))
			{
				errors.push({path: `items[${index}].stair`, message: 'must be an object when present'});
			}
			else
			{
				['treads', 'rise', 'going', 'width'].forEach(function (field)
				{
					var value = item.stair[field];
					if (value !== undefined && value !== null && (!isFiniteNumber(value) || value <= 0))
					{
						errors.push({
							path: `items[${index}].stair.${field}`,
							message: `must be a positive number when present, not ${JSON.stringify(value)}`,
						});
					}
				});
			}
		}

		// The column or beam description, additive since RM-008 F2. Same rule
		// again: `normaliseStructure` fills in a missing soffit and clamps a width
		// of 900 cm, but a depth of "deep" or a length of -3 is a file saying
		// something it cannot mean. `soffit` is checked separately because zero is
		// the correct and usual value for a column.
		if (item.structure !== undefined && item.structure !== null)
		{
			if (!isPlainObject(item.structure))
			{
				errors.push({path: `items[${index}].structure`, message: 'must be an object when present'});
			}
			else
			{
				['width', 'depth', 'length'].forEach(function (field)
				{
					var value = item.structure[field];
					if (value !== undefined && value !== null && (!isFiniteNumber(value) || value <= 0))
					{
						errors.push({
							path: `items[${index}].structure.${field}`,
							message: `must be a positive number of centimetres when present, not ${JSON.stringify(value)}`,
						});
					}
				});
				var soffit = item.structure.soffit;
				if (soffit !== undefined && soffit !== null && (!isFiniteNumber(soffit) || soffit < 0))
				{
					errors.push({
						path: `items[${index}].structure.soffit`,
						message: `must be zero or a positive number of centimetres when present, not ${JSON.stringify(soffit)}`,
					});
				}
			}
		}
	});
}

/**
 * The storeys, additive since RM-010 G1 and absent from every older file.
 *
 * Every storey above the ground floor is a whole design in miniature - it has a
 * plan and furniture of its own - so each is checked by exactly the two
 * functions that check the ground floor's, and the paths they report are
 * prefixed so a person reading an error knows which floor it is on.
 *
 * `levels[0]` is deliberately NOT checked for a plan or items: the ground
 * floor's are at `floorplan` and `items`, and `levels[0]` carries only its name
 * and height. A file that repeats them there is saying something this format
 * does not mean, which is a warning rather than a refusal - it opens fine and
 * the duplicate is ignored.
 *
 * @param {*} levels
 * @param {*} floorplan The ground floor's plan, for the shape comparison.
 * @param {Array<DocumentProblem>} errors
 * @param {Array<DocumentProblem>} warnings
 */
function validateLevels(levels, floorplan, errors, warnings)
{
	if (levels === undefined || levels === null)
	{
		return;
	}
	if (!Array.isArray(levels))
	{
		errors.push({path: 'levels', message: 'must be an array when present'});
		return;
	}
	levels.forEach(function (level, index)
	{
		if (!isPlainObject(level))
		{
			errors.push({path: `levels[${index}]`, message: 'is not an object'});
			return;
		}
		if (level.height !== undefined && level.height !== null
			&& (!isFiniteNumber(level.height) || level.height <= 0))
		{
			errors.push({
				path: `levels[${index}].height`,
				message: `must be a positive number of centimetres when present, not ${JSON.stringify(level.height)}`,
			});
		}
		if (index === 0)
		{
			if (level.floorplan !== undefined || level.items !== undefined)
			{
				warnings.push({
					path: 'levels[0]',
					message: 'carries a plan or items; the ground floor\'s are read from the design\'s own "floorplan" and "items", and these are ignored',
				});
			}
			return;
		}
		// Above the ground floor: a whole design, checked the same way.
		var problems = [];
		validateFloorplan(level.floorplan, problems, warnings);
		validateItems(level.items, problems);
		problems.forEach(function (problem)
		{
			errors.push({path: `levels[${index}].${problem.path}`, message: problem.message});
		});
	});
	// The ground floor's own record is not optional once there is a list, because
	// its position is what "the floor above" means.
	if (levels.length && !isPlainObject(levels[0]) === false && floorplan === undefined)
	{
		errors.push({path: 'floorplan', message: 'missing - the ground floor is the design\'s own "floorplan"'});
	}
}

/**
 * The sun, additive since RM-011 H2 and absent from every older file.
 *
 * @param {*} sun
 * @param {Array<DocumentProblem>} errors
 */
function validateSun(sun, errors)
{
	if (sun === undefined || sun === null)
	{
		return;
	}
	if (!isPlainObject(sun))
	{
		errors.push({path: 'sun', message: 'must be an object when present'});
		return;
	}
	// Ranges rather than mere finiteness, because all three of these are refused
	// by physics and not only by taste: there is no latitude 200, no 400th day
	// and no 30 o'clock. `normaliseSun` clamps and wraps so a live edit cannot
	// produce one; a *file* that carries one is saying something it cannot mean,
	// and that is the distinction this layer exists to draw.
	var ranges = {latitude: [-90, 90], dayOfYear: [1, 365], hour: [0, 24]};
	Object.keys(ranges).forEach(function (field)
	{
		var value = sun[field];
		if (value === undefined || value === null)
		{
			return;
		}
		var range = ranges[field];
		if (!isFiniteNumber(value) || value < range[0] || value > range[1])
		{
			errors.push({
				path: `sun.${field}`,
				message: `must be a number from ${range[0]} to ${range[1]} when present, not ${JSON.stringify(value)}`,
			});
		}
	});
}

/**
 * The roof, additive since RM-010 G2 and absent from every older file.
 *
 * Only the two numbers whose absence cannot be defaulted: `normaliseRoof` fills
 * in a missing kind and clamps a 90-degree pitch, but a pitch of "steep" or a
 * negative overhang is a file saying something it cannot mean. Zero is a valid
 * pitch - that is a flat roof described the long way round - and a valid
 * overhang, so both floors are zero rather than one.
 *
 * @param {*} roof
 * @param {Array<DocumentProblem>} errors
 */
function validateRoof(roof, errors)
{
	if (roof === undefined || roof === null)
	{
		return;
	}
	if (!isPlainObject(roof))
	{
		errors.push({path: 'roof', message: 'must be an object when present'});
		return;
	}
	['pitch', 'overhang', 'thickness'].forEach(function (field)
	{
		var value = roof[field];
		if (value !== undefined && value !== null && (!isFiniteNumber(value) || value < 0))
		{
			errors.push({
				path: `roof.${field}`,
				message: `must be zero or a positive number when present, not ${JSON.stringify(value)}`,
			});
		}
	});
}
