// @ts-check
import {computed, markRaw, onScopeDispose, ref, shallowRef, watch} from 'vue';
import {EVENT_ITEM_SELECTED, EVENT_ITEM_UNSELECTED, EVENT_WALL_CLICKED, EVENT_FLOOR_CLICKED} from '../../scripts/blueprint.js';
import {EVENT_NOTHING_CLICKED, EVENT_CORNER_2D_CLICKED, EVENT_WALL_2D_CLICKED, EVENT_ROOM_2D_CLICKED} from '../../scripts/blueprint.js';
import {EVENT_ITEM_2D_CLICKED} from '../../scripts/blueprint.js';
import {EVENT_DIMENSION_2D_CLICKED, EVENT_ANNOTATION_2D_CLICKED, EVENT_ANNOTATIONS_CHANGED} from '../../scripts/blueprint.js';
import {EVENT_CHANGESET} from '../../scripts/blueprint.js';

/**
 * One reactive selection, replacing the demo's `aWall` / `anItem` globals.
 *
 * Sprint S6. The legacy demo kept two module-level variables, each holding a
 * *properties object* rather than the thing selected, each written by a
 * different event handler, and neither ever cleared. That is where the
 * null-wall crash comes from (see `placementContext` below), and it is why the
 * item inspector could be showing one item's dimensions while a different item
 * was selected.
 *
 * Here there is exactly one selection at a time and it is a plain
 * `{type, object}` pair. Inspectors switch on `type`; nothing else needs to
 * know which event produced it.
 *
 * The selected object is `markRaw`'d - it is a live Wall / Corner / Room /
 * Item that the library compares by identity. See useBlueprint's note.
 *
 * ## What is held, since RM-003 A3
 *
 * An **id**, not the object. `Floorplan.update()` builds a new `Room` and a new
 * `HalfEdge` for every one it finds, every time, so holding the object meant
 * that selecting a room and then editing anything at all left the inspector
 * bound to something no longer in the plan - still editable, and editing it
 * changed nothing anybody could see.
 *
 * The shape callers read is unchanged: `selection.value` is still
 * `{type, object}`. `object` is now resolved from the id on demand, and
 * re-resolved whenever the model says the plan changed, so a room that survives
 * an edit stays selected and one that does not clears itself rather than going
 * stale.
 */

/** Selection kinds. `null` for no selection. */
export const SELECTION_ITEM = 'item';
export const SELECTION_WALL = 'wall';
export const SELECTION_FLOOR = 'floor';
export const SELECTION_CORNER_2D = 'corner2d';
export const SELECTION_WALL_2D = 'wall2d';
export const SELECTION_ROOM_2D = 'room2d';
/**
 * The two authored entities (RM-008 E3).
 *
 * Kinds of their own rather than a shared 'annotation', because the inspectors
 * are genuinely different - one edits an offset and reads a measurement, the
 * other edits text - and because `Floorplan.annotationById` searching both
 * collections is the lookup, not the type.
 */
export const SELECTION_DIMENSION = 'dimension';
export const SELECTION_ANNOTATION = 'annotation';

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useSelection(store)
{
	/**
	 * What is selected: its kind and its id, which is the only part that outlives
	 * an edit.
	 *
	 * `object` is a fallback and is normally null. Selection is a public surface -
	 * an embedder can dispatch `EVENT_ITEM_SELECTED` with anything it likes - and
	 * an entity with no id must still be selectable, exactly as it was before A3.
	 * It simply does not survive a re-derivation, which is the old behaviour.
	 *
	 * @type {import('vue').ShallowRef<?{type: string, id: ?string, object: ?Object}>}
	 */
	var selected = shallowRef(null);
	/**
	 * Bumped whenever the model changes, so the resolver below re-runs.
	 *
	 * A counter rather than a dependency on the model: the entities are plain
	 * library objects that must never be made reactive - see the identity warning
	 * in useBlueprint - so there is nothing for Vue to track, and this is the
	 * signal that says "look again".
	 */
	var revision = ref(0);
	/** @type {import('vue').ShallowRef<?Object>} */
	var attachedStore = shallowRef(null);

	/**
	 * Find what a selection refers to, in the plan as it stands now.
	 *
	 * @param {?{type: string, id: ?string, object: ?Object}} current
	 * @returns {?Object}
	 */
	function resolve(current)
	{
		var blueprint = attachedStore.value;
		if (!current || !blueprint)
		{
			return null;
		}
		var id = current.id;
		if (!id)
		{
			return current.object;
		}
		var floorplan = blueprint.model.floorplan;
		var found;
		switch (current.type)
		{
		case SELECTION_ITEM:
			found = blueprint.model.scene.getItems().find((item) => item.designId === id);
			break;
		// SELECTION_WALL is a *face*, not a wall: `Controller` picks a HalfEdge and
		// `Main.wallIsClicked` passes it straight through. The 2D view really does
		// select a Wall. They have always been different things behind one name.
		case SELECTION_WALL:
			found = floorplan.wallEdges().find((edge) => edge.id === id);
			break;
		case SELECTION_WALL_2D:
			found = floorplan.getWalls().find((wall) => wall.id === id);
			break;
		case SELECTION_CORNER_2D:
			found = floorplan.getCorners().find((corner) => corner.id === id);
			break;
		case SELECTION_FLOOR:
		case SELECTION_ROOM_2D:
			found = floorplan.getRooms().find((room) => room.id === id);
			break;
		// Both kinds resolve through one lookup, which is what makes an annotation
		// survive undo: a restore rebuilds every Dimension and TextAnnotation from
		// the file, so the object is new and the id - which IS persisted, unlike a
		// room's - still finds it (RM-008 E3).
		case SELECTION_DIMENSION:
		case SELECTION_ANNOTATION:
			found = floorplan.annotationById(id);
			break;
		default:
			found = null;
		}
		return found || null;
	}

	/**
	 * The selection as every caller reads it.
	 *
	 * Null rather than `{type, object: null}` when the entity has gone: an
	 * inspector bound to nothing is what "nothing is selected" looks like, and
	 * every consumer already handles it.
	 *
	 * @type {import('vue').ComputedRef<?{type: string, object: Object}>}
	 */
	var selection = computed(() =>
	{
		// Read, so the computed re-runs when the model changes.
		void revision.value;
		var current = selected.value;
		var object = current ? resolve(current) : null;
		return (current && object) ? {type: current.type, object: markRaw(object)} : null;
	});

	/**
	 * The last wall or floor clicked in the 3D view, and the only thing the
	 * catalog needs from the selection.
	 *
	 * Kept apart from `selection` on purpose, because the two answer different
	 * questions. Selecting an item replaces the selection but must not forget
	 * which wall you were working on - that is the behaviour the demo got for
	 * free by never clearing `aWall`, and losing it would make placing a second
	 * window on the same wall a two-click affair.
	 *
	 * Unlike `aWall` it starts as a real object with both fields null, so a
	 * catalog click before any 3D click reads `null` instead of throwing.
	 */
	var placementContext = shallowRef({wall: null, floor: null});

	/**
	 * The identity of a selectable entity, asked of the right property for its
	 * kind.
	 *
	 * Deliberately not `object.designId || object.id`. An `Item` extends
	 * `Object3D`, which *always* has an `id` - a non-writable number three
	 * assigns - so a generic fallback would hand back that number for any item
	 * missing a `designId` and then resolve it against nothing. Asking the right
	 * property per kind means an entity without one is recognised as having no
	 * identity, and is held directly instead.
	 *
	 * @param {string} type
	 * @param {?Object} object
	 * @returns {?string}
	 */
	function identify(type, object)
	{
		if (!object)
		{
			return null;
		}
		var id = (type === SELECTION_ITEM) ? object.designId : object.id;
		return (typeof id === 'string' && id) ? id : null;
	}

	function select(type, object)
	{
		if (!object)
		{
			selected.value = null;
			return;
		}
		var id = identify(type, object);
		selected.value = {type: type, id: id, object: id ? null : markRaw(object)};
	}

	function clear()
	{
		selected.value = null;
	}

	var handlers = null;

	function attach(blueprint)
	{
		var three = blueprint.three;
		var floorplan = blueprint.model.floorplan;
		attachedStore.value = blueprint;

		handlers = {
			three: three,
			floorplan: floorplan,
			changed: () => {revision.value += 1;},
			itemSelected: (evt) => {select(SELECTION_ITEM, evt.item);},
			itemUnselected: () => {clear();},
			wallClicked: (evt) =>
			{
				placementContext.value = {wall: markRaw(evt.item), floor: null};
				select(SELECTION_WALL, evt.item);
			},
			floorClicked: (evt) =>
			{
				placementContext.value = {wall: null, floor: markRaw(evt.item)};
				select(SELECTION_FLOOR, evt.item);
			},
			nothingClicked: () => {clear();},
			corner2d: (evt) => {select(SELECTION_CORNER_2D, evt.item);},
			wall2d: (evt) => {select(SELECTION_WALL_2D, evt.item);},
			room2d: (evt) => {select(SELECTION_ROOM_2D, evt.item);},
			/**
			 * A footprint was picked on the plan (RM-008 E1).
			 *
			 * The event carries a footprint and an id, not an item - the plan draws
			 * a description of the furniture and never holds it. So the id is
			 * resolved here, against the same scene `resolve()` already searches,
			 * and the result goes into the one selection this composable keeps.
			 * From there the inspector opens and the 3D view highlights, by the
			 * same path a 3D pick takes.
			 *
			 * SELECTION_ITEM, not a type of its own: it is the same chair whichever
			 * view was clicked, and giving the plan its own selection type would
			 * mean every consumer learning that two types mean one thing - which is
			 * the trap SELECTION_WALL and SELECTION_WALL_2D already are, and those
			 * two really are different objects.
			 */
			item2d: (evt) =>
			{
				var item = blueprint.model.itemById ? blueprint.model.itemById(evt.id) : null;
				if (item)
				{
					select(SELECTION_ITEM, item);
				}
			},
			// Both carry the object itself, unlike the footprint event above: an
			// annotation is owned by the floorplan and lives as long as the design,
			// so there is nothing to look up (RM-008 E3).
			dimension2d: (evt) => {select(SELECTION_DIMENSION, evt.item);},
			annotation2d: (evt) => {select(SELECTION_ANNOTATION, evt.item);},
			// A dimension deleted from the plan, or an undo that took one away,
			// must not leave the inspector bound to it. Re-resolving is what does
			// that - `resolve` returns null and the computed clears - and it is the
			// same signal EVENT_CHANGESET already provides for the wall graph.
			annotationsChanged: () => {revision.value += 1;},
		};

		three.addEventListener(EVENT_ITEM_SELECTED, handlers.itemSelected);
		three.addEventListener(EVENT_ITEM_UNSELECTED, handlers.itemUnselected);
		three.addEventListener(EVENT_WALL_CLICKED, handlers.wallClicked);
		three.addEventListener(EVENT_FLOOR_CLICKED, handlers.floorClicked);

		floorplan.addEventListener(EVENT_NOTHING_CLICKED, handlers.nothingClicked);
		floorplan.addEventListener(EVENT_CORNER_2D_CLICKED, handlers.corner2d);
		floorplan.addEventListener(EVENT_WALL_2D_CLICKED, handlers.wall2d);
		floorplan.addEventListener(EVENT_ROOM_2D_CLICKED, handlers.room2d);
		floorplan.addEventListener(EVENT_ITEM_2D_CLICKED, handlers.item2d);
		floorplan.addEventListener(EVENT_CHANGESET, handlers.changed);
		floorplan.addEventListener(EVENT_DIMENSION_2D_CLICKED, handlers.dimension2d);
		floorplan.addEventListener(EVENT_ANNOTATION_2D_CLICKED, handlers.annotation2d);
		floorplan.addEventListener(EVENT_ANNOTATIONS_CHANGED, handlers.annotationsChanged);
	}

	function detach()
	{
		if (!handlers)
		{
			return;
		}
		var three = handlers.three;
		var floorplan = handlers.floorplan;

		three.removeEventListener(EVENT_ITEM_SELECTED, handlers.itemSelected);
		three.removeEventListener(EVENT_ITEM_UNSELECTED, handlers.itemUnselected);
		three.removeEventListener(EVENT_WALL_CLICKED, handlers.wallClicked);
		three.removeEventListener(EVENT_FLOOR_CLICKED, handlers.floorClicked);

		floorplan.removeEventListener(EVENT_NOTHING_CLICKED, handlers.nothingClicked);
		floorplan.removeEventListener(EVENT_CORNER_2D_CLICKED, handlers.corner2d);
		floorplan.removeEventListener(EVENT_WALL_2D_CLICKED, handlers.wall2d);
		floorplan.removeEventListener(EVENT_ROOM_2D_CLICKED, handlers.room2d);
		floorplan.removeEventListener(EVENT_ITEM_2D_CLICKED, handlers.item2d);
		floorplan.removeEventListener(EVENT_CHANGESET, handlers.changed);
		floorplan.removeEventListener(EVENT_DIMENSION_2D_CLICKED, handlers.dimension2d);
		floorplan.removeEventListener(EVENT_ANNOTATION_2D_CLICKED, handlers.annotation2d);
		floorplan.removeEventListener(EVENT_ANNOTATIONS_CHANGED, handlers.annotationsChanged);

		handlers = null;
		attachedStore.value = null;
		selected.value = null;
		placementContext.value = {wall: null, floor: null};
	}

	watch(store.instance, (blueprint) =>
	{
		detach();
		if (blueprint)
		{
			attach(blueprint);
		}
	}, {immediate: true});

	/**
	 * Which of the 2D view's selection slots a selection type belongs in
	 * (RM-008 E1).
	 *
	 * `SELECTION_WALL` and `SELECTION_WALL_2D` both land on 'wall' because they
	 * are the same wall reached two ways - the 3D picks a face and the plan picks
	 * the wall - and `Floorplanner2D.showSelection` unwraps the face. Everything
	 * else that has no plan representation, including a floor picked in 3D that
	 * resolves to a room, maps to what the plan can actually draw.
	 */
	const PLAN_SELECTION = {
		[SELECTION_ITEM]: 'item',
		[SELECTION_WALL]: 'wall',
		[SELECTION_WALL_2D]: 'wall',
		[SELECTION_CORNER_2D]: 'corner',
		[SELECTION_FLOOR]: 'room',
		[SELECTION_ROOM_2D]: 'room',
		[SELECTION_DIMENSION]: 'dimension',
		[SELECTION_ANNOTATION]: 'annotation',
	};

	/**
	 * Keep the plan showing whatever is selected, wherever it was selected
	 * (RM-008 T-2).
	 *
	 * The measured finding this closes: a wall clicked in the 3D view changed
	 * zero of the plan's 492,000 pixels, because the plan highlighted only what
	 * the plan had been clicked on. The selection has always been shared - it
	 * lives here, in one ref - and only the drawing of it was one-sided.
	 *
	 * This is the app's job rather than the library's on purpose. `src/scripts`
	 * has no idea there are two views on one document; coordinating them is
	 * exactly what this layer is for, and putting it here means an embedder using
	 * only the 3D view pays nothing for it.
	 *
	 * Watches `selection` - the resolved object, not the stored id - so a
	 * re-derived room or a rebuilt wall lights up the successor rather than
	 * silently nothing.
	 */
	watch([selection, () => store.floorplanner.value, () => store.three.value], function ([current, planner, three])
	{
		// One local, narrowed once, rather than `current &&` at four call sites -
		// the checker cannot carry the narrowing across a property read otherwise.
		var target = (current && current.object) ? current.object : null;
		var type = (current && target) ? current.type : null;

		if (planner && typeof planner.showSelection === 'function')
		{
			planner.showSelection(type ? (PLAN_SELECTION[type] || null) : null, target);
		}

		// And the 3D view, which had the same one-sidedness in the other
		// direction: `Controller.setSelectedObject` was only ever called with a
		// real item by a click in the 3D view itself, so picking a chair on the
		// plan left the 3D chair unhighlighted - zero changed pixels, measured.
		//
		// Items only. A wall, room or corner has no selected appearance in 3D to
		// show - `Edge` and `Floor` draw hover and nothing else - so there is
		// nothing to push, and inventing a highlight for them is a visual change
		// with a parity capture attached rather than a wiring one. Named here so
		// the asymmetry is a decision on the record instead of an omission.
		if (three && typeof three.showItemSelected === 'function')
		{
			three.showItemSelected((type === SELECTION_ITEM) ? target : null);
		}
	}, {immediate: true});

	onScopeDispose(detach);

	return {selection, placementContext, select, clear};
}
