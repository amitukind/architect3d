// @ts-check
/**
 * What changed, and why (RM-003 A2).
 *
 * ## The finding
 *
 * `Floorplan` had exactly one way of saying that anything had happened:
 * `EVENT_UPDATED`, with a payload of `{item: floorplan}` - the floorplan itself,
 * which the listener already had a reference to. Six unrelated consumers hung
 * off it: the 3D projection, the camera, the lights, autosave, history and the
 * statistics panel. None of them could tell a corner drag from a file open, so
 * every one of them did its most expensive thing every time. Dragging one corner
 * tore down and rebuilt every wall and every floor in the scene, and recentred
 * the camera, on every pointermove.
 *
 * The fix is not more event constants. A constant per situation multiplies the
 * subscription surface and still cannot express "these three walls" - the
 * payload is the point, not the name.
 *
 * ## The contract
 *
 * A ChangeSet says which *kinds* of thing changed, which entities each kind
 * affects, and what the user was doing when it happened. Consumers subscribe
 * once and react to the kinds they care about:
 *
 * ```js
 * floorplan.addEventListener(EVENT_CHANGESET, ({changes}) => {
 *     if (changes.has(CHANGE_GEOMETRY)) { redrawWalls(changes.entities(CHANGE_GEOMETRY)); }
 * });
 * ```
 *
 * ## Additive, deliberately
 *
 * Every `EVENT_CHANGESET` is followed by the `EVENT_UPDATED` it derives - see
 * `Floorplan._emitChanges` - so nothing that listened before has to move, and
 * the legacy event keeps firing at exactly the moments it always did. The
 * ChangeSet rides along on the legacy payload too, as `.changes`, so a consumer
 * can adopt it without changing which event it subscribes to.
 *
 * ## What emits which kind, today
 *
 * | Kind         | Emitted by                     | Status |
 * |--------------|--------------------------------|--------|
 * | `topology`   | `Floorplan.update(true, ...)`  | live   |
 * | `geometry`   | `Floorplan.update(false, ...)` | live   |
 * | `surface`    | -                              | named  |
 * | `items`      | -                              | named  |
 * | `selection`  | -                              | named  |
 * | `view`       | -                              | named  |
 *
 * **A2 types the dispatch that exists; it does not invent dispatch.** The four
 * unemitted kinds are named rather than left out because a half-stated
 * vocabulary is worse than none - a consumer writing a `switch` needs to know
 * the whole set and which dispatcher will own each one - but nothing announces
 * them yet, and that is a decision rather than an omission:
 *
 * - **`surface`** is the interesting one, because it looks as though the
 *   floorplan should emit it and it should not. `Room.setTexture()` and
 *   `HalfEdge.setTexture()` already dispatch EVENT_CHANGED and EVENT_REDRAW
 *   straight to the `Floor` and `Edge` drawing them: the path is per-entity and
 *   already incremental, which is what A2 is trying to achieve everywhere else.
 *   Adding a plan-level broadcast on top would be *new* traffic - autosave and
 *   history subscribe to the plan, and would start recording texture changes
 *   they do not record today. That is a behaviour change, arguably an
 *   improvement, and not one A2 was asked to make.
 * - **`items`** belongs to `Scene`, and the 3D projection's reaction to it is
 *   "nothing".
 * - **`selection`** belongs to `Main` and is not a model mutation at all.
 * - **`view`** belongs to `Configuration`, which already has
 *   `EVENT_CONFIG_CHANGED` carrying `{key, value, previous}` - a better payload
 *   for its purpose than a ChangeSet would be.
 *
 * `REASON_UNDO` runs the other way: it is emitted, by `useHistory`, because
 * history is the only thing that knows a load is a restoration.
 */

/** Corners or walls added, removed or reconnected. The room set may have been re-derived. */
export const CHANGE_TOPOLOGY = 'topology';
/** Existing entities moved or resized. The room set is the same set of objects. */
export const CHANGE_GEOMETRY = 'geometry';
/** Textures, colours, materials. No geometry implication. */
export const CHANGE_SURFACE = 'surface';
/** Furniture added, removed or moved. */
export const CHANGE_ITEMS = 'items';
/** What is selected. Never a model mutation. */
export const CHANGE_SELECTION = 'selection';
/** Configuration, units, render profile, palette. */
export const CHANGE_VIEW = 'view';

/**
 * Every kind, in the order `ChangeSet.kinds()` reports them.
 *
 * A canonical order rather than insertion order, so a test can assert on the
 * list and two ChangeSets carrying the same kinds describe themselves the same
 * way whatever order they were built in.
 *
 * @type {ReadonlyArray<string>}
 */
export const CHANGE_KINDS = Object.freeze([
	CHANGE_TOPOLOGY, CHANGE_GEOMETRY, CHANGE_SURFACE,
	CHANGE_ITEMS, CHANGE_SELECTION, CHANGE_VIEW,
]);

/** A document was opened. */
export const REASON_LOAD = 'load';
/** A person did something. The default. */
export const REASON_EDIT = 'edit';
/** History put a previous state back. */
export const REASON_UNDO = 'undo';
/** The library recomputed something off the back of another change. */
export const REASON_DERIVE = 'derive';

/** @type {ReadonlyArray<string>} */
export const CHANGE_REASONS = Object.freeze([REASON_LOAD, REASON_EDIT, REASON_UNDO, REASON_DERIVE]);

/**
 * A description of what changed in one operation.
 *
 * Immutable by convention rather than by freezing: it is built by the dispatcher
 * and read by consumers, and freezing it would cost an allocation on a path that
 * runs on every pointermove.
 */
export class ChangeSet
{
	/**
	 * @param {string} [reason] One of {@link CHANGE_REASONS}. Defaults to
	 * `REASON_EDIT`, because a change with no stated cause came from a person -
	 * that is the reading that makes history and autosave behave, and the
	 * expensive one to get wrong in the other direction.
	 */
	constructor(reason = REASON_EDIT)
	{
		/** @type {string} */
		this.reason = reason;
		/**
		 * Kind to the entities it affects. A `Set` so the projection can union
		 * corners into walls without checking for duplicates, and so a kind added
		 * twice in one batch does not report its entities twice.
		 *
		 * @type {Map<string, Set<Object>>}
		 */
		this._entities = new Map();
	}

	/**
	 * Record that a kind of thing changed.
	 *
	 * Registers the kind even when `entities` is empty or absent, which is the
	 * difference between "nothing changed" and "something changed and I cannot
	 * name what". `Floorplan.update(false)` with no corner list is the second,
	 * and it still has to reach the consumers that fire on any change at all.
	 *
	 * @param {string} kind One of {@link CHANGE_KINDS}.
	 * @param {Iterable<Object>|Object|null} [entities] The affected entities.
	 * @returns {ChangeSet} this, so calls chain.
	 */
	add(kind, entities)
	{
		var set = this._entities.get(kind);
		if (!set)
		{
			set = new Set();
			this._entities.set(kind, set);
		}
		if (entities === null || entities === undefined)
		{
			return this;
		}
		if (typeof (/** @type {any} */(entities))[Symbol.iterator] === 'function')
		{
			var iterable = /** @type {Iterable<Object>} */(entities);
			for (var entity of iterable)
			{
				set.add(entity);
			}
		}
		else
		{
			set.add(entities);
		}
		return this;
	}

	/**
	 * @param {string} kind
	 * @returns {boolean} Whether this set carries that kind at all.
	 */
	has(kind)
	{
		return this._entities.has(kind);
	}

	/**
	 * The entities a kind affects, as an array.
	 *
	 * Empty for a kind that was recorded without entities, and empty for a kind
	 * that is not in this set - a consumer that has already asked `has()` does not
	 * need a second null check.
	 *
	 * @param {string} kind
	 * @returns {Array<Object>}
	 */
	entities(kind)
	{
		var set = this._entities.get(kind);
		return set ? Array.from(set) : [];
	}

	/**
	 * The kinds present, in {@link CHANGE_KINDS} order.
	 * @returns {Array<string>}
	 */
	kinds()
	{
		var scope = this;
		return CHANGE_KINDS.filter(function (kind) {return scope._entities.has(kind);});
	}

	/** @returns {boolean} Whether nothing at all was recorded. */
	isEmpty()
	{
		return this._entities.size === 0;
	}

	/**
	 * Absorb another set's kinds and entities.
	 *
	 * The reason is this set's and stays this set's: a batch is one gesture, and
	 * the gesture is what the reason describes. Merging a `load` into an `edit`
	 * and taking the later of the two would let one deferred recomputation
	 * relabel a file open as a user edit, which is exactly the distinction
	 * history exists to make.
	 *
	 * @param {ChangeSet} other
	 * @returns {ChangeSet} this
	 */
	merge(other)
	{
		if (!other)
		{
			return this;
		}
		var scope = this;
		other._entities.forEach(function (set, kind) {scope.add(kind, set);});
		return this;
	}

	/**
	 * A one-line form for logs and test failure messages: `topology(3) @load`.
	 * @returns {string}
	 */
	describe()
	{
		var scope = this;
		var parts = this.kinds().map(function (kind)
		{
			return `${kind}(${/** @type {Set<Object>} */(scope._entities.get(kind)).size})`;
		});
		return `${parts.join(' ') || 'empty'} @${this.reason}`;
	}
}

/**
 * A zeroed counter for every kind, for the `changeStats()` methods.
 *
 * Seeded with all six rather than grown on demand so the shape of the object a
 * test asserts on does not depend on which kinds happened to fire.
 *
 * @returns {Object<string, number>}
 */
export function newChangeCounts()
{
	/** @type {Object<string, number>} */
	var counts = {};
	CHANGE_KINDS.forEach(function (kind) {counts[kind] = 0;});
	return counts;
}
