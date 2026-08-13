import {computed} from 'vue';
import catalog from '../../catalog/catalog.json';

/**
 * The furniture palette, read straight from the catalog.
 *
 * Sprint S6. `src/catalog/catalog.json` became the single source of truth in
 * S3, but only the generated jQuery palette (build/js/items.js) consumed it.
 * The Vue app reads the JSON itself, so adding a model is a data change with no
 * generator step.
 */

/**
 * Item types that hang off a wall edge, and so want an `edge` in their
 * placement hint: WallItem (2), InWallItem (3), InWallFloorItem (7) and
 * WallFloorItem (9). The list is the demo's (build/js/app.js:979), named.
 */
const WALL_BOUND_TYPES = [2, 3, 7, 9];

/**
 * @returns {Array<{id: number, heading: string, items: Array<Object>}>}
 */
function buildSections()
{
	return Object.keys(catalog.itemTypes)
		.map((key) => Object.assign({id: Number(key)}, catalog.itemTypes[key]))
		.sort((a, b) => a.order - b.order)
		.map((type) => ({
			id: type.id,
			heading: type.heading,
			items: catalog.items.filter((item) => item.type === type.id),
		}))
		.filter((section) => section.items.length > 0);
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {import('vue').ShallowRef<{wall: ?Object, floor: ?Object}>} placementContext
 */
export function useCatalog(store, placementContext)
{
	var sections = computed(buildSections);
	var count = computed(() => catalog.items.length);

	/**
	 * Add one catalog entry to the scene.
	 *
	 * Placement follows the last thing clicked in the 3D view: a wall-bound item
	 * lands at the centre of the last clicked wall and is bound to that edge, and
	 * anything else lands at the centre of the last clicked floor. With neither,
	 * the item is added with no hint and the controller picks it up under the
	 * pointer for the user to drop.
	 *
	 * That last case is the deliberate fix. The demo wrote
	 * `if(... && aWall.currentWall)`, and `aWall` is only assigned by the
	 * wall-clicked and floor-clicked handlers - so on a fresh page, opening the
	 * catalog and clicking any of the four wall-bound types threw
	 * `Cannot read property 'currentWall' of null` and added nothing. Every other
	 * type worked, which is why it survived: the first thing anyone adds is
	 * usually a chair.
	 *
	 * @param {Object} entry A row from catalog.json.
	 */
	function addItem(entry)
	{
		var scene = store.model.value.scene;
		var context = placementContext.value;
		var metadata = {
			itemName: entry.name,
			resizable: true,
			modelUrl: entry.model,
			itemType: entry.type,
			format: entry.format,
		};

		if (WALL_BOUND_TYPES.indexOf(entry.type) !== -1 && context.wall)
		{
			scene.addItem(entry.type, entry.model, metadata, null, null, null, false,
				{position: context.wall.center.clone(), edge: context.wall});
			return;
		}

		if (context.floor)
		{
			scene.addItem(entry.type, entry.model, metadata, null, null, null, false,
				{position: context.floor.center.clone()});
			return;
		}

		scene.addItem(entry.type, entry.model, metadata);
	}

	return {sections, count, addItem};
}
