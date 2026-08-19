// @ts-check
import {computed} from 'vue';
import catalog from '../../catalog/catalog.json';
import openings from '../../catalog/openings.json';
import stairs from '../../catalog/stairs.json';
import structures from '../../catalog/structures.json';
import {
	ITEM_TYPE_PARAMETRIC_OPENING, ITEM_TYPE_PARAMETRIC_STAIR, ITEM_TYPE_PARAMETRIC_STRUCTURE,
} from '../../scripts/blueprint.js';

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
/**
 * One entry in the catalog, as `src/catalog/catalog.json` records it.
 *
 * Written down here rather than in the component that renders it, because this
 * is where the shape is produced - a typedef beside the consumer drifts from the
 * data the first time the data changes (RM-004 B3).
 *
 * @typedef {Object} CatalogItem
 * @property {string} name Shown under the thumbnail, and used as the item name.
 * @property {string} image Thumbnail URL, a logical asset name.
 * @property {string} model The model's logical asset name.
 * @property {number} type One of the `itemTypes` keys; selects the Item class.
 * @property {string} [format] `gltf` or `obj`. Absent means the legacy JSON
 *           format, which `resolveModelUrl` rewrites on the way in.
 */

/**
 * A heading and the items under it.
 *
 * @typedef {Object} CatalogSection
 * @property {number} id
 * @property {string} heading
 * @property {Array<CatalogItem>} items Never empty - buildSections drops those.
 */

/**
 * The generated openings, as a section (RM-008 F1).
 *
 * A second source rather than more rows in `catalog.json`, and the reason is
 * what that file is: the list of model FILES this build ships. Six suites
 * assert exactly that over it - every thumbnail exists, every format is glTF,
 * and there is a frozen r98 merge reading for each model - and a parametric
 * opening has no file at all. Merging it in would have meant weakening all six
 * to accommodate rows that are not what they are about.
 *
 * First in the list, because a door is the first thing anybody puts in a wall.
 *
 * @returns {CatalogSection}
 */
function openingSection()
{
	return {
		id: ITEM_TYPE_PARAMETRIC_OPENING,
		heading: openings.heading,
		items: openings.items.map((entry) => ({
			name: entry.name,
			// No model and no thumbnail: there is no file. The drawer draws a
			// generated tile for a row with no image, which is also what makes the
			// section look different from the mesh catalog - because it is.
			image: '',
			model: '',
			type: ITEM_TYPE_PARAMETRIC_OPENING,
			format: 'parametric',
			opening: entry.opening,
		})),
	};
}

/**
 * The generated flights (RM-008 F3).
 *
 * Second in the list, after the openings and before the mesh catalog: the two
 * generated sections belong together, and a stair is the second thing after a
 * door that a person expects a floor planner to have.
 *
 * @returns {CatalogSection}
 */
function stairSection()
{
	return {
		id: ITEM_TYPE_PARAMETRIC_STAIR,
		heading: stairs.heading,
		items: stairs.items.map((entry) => ({
			name: entry.name,
			image: '',
			model: '',
			type: ITEM_TYPE_PARAMETRIC_STAIR,
			format: 'parametric',
			stair: entry.stair,
		})),
	};
}

/**
 * The generated columns and beams (RM-008 F2).
 *
 * Third and last of the generated sections, and after the stairs for the same
 * reason the stairs come after the doors: this is the order somebody builds in.
 *
 * @returns {CatalogSection}
 */
function structureSection()
{
	return {
		id: ITEM_TYPE_PARAMETRIC_STRUCTURE,
		heading: structures.heading,
		items: structures.items.map((entry) => ({
			name: entry.name,
			image: '',
			model: '',
			type: ITEM_TYPE_PARAMETRIC_STRUCTURE,
			format: 'parametric',
			structure: entry.structure,
		})),
	};
}

/** @returns {Array<CatalogSection>} */
function buildSections()
{
	return [openingSection(), stairSection(), structureSection()].concat(Object.keys(catalog.itemTypes)
		.map((key) => Object.assign({id: Number(key)}, catalog.itemTypes[key]))
		.sort((a, b) => a.order - b.order)
		.map((type) => ({
			id: type.id,
			heading: type.heading,
			items: catalog.items.filter((item) => item.type === type.id),
		}))
		.filter((section) => section.items.length > 0));
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {import('vue').ShallowRef<{wall: ?Object, floor: ?Object}>} placementContext
 */
export function useCatalog(store, placementContext)
{
	var sections = computed(buildSections);
	var count = computed(() => catalog.items.length + openings.items.length
		+ stairs.items.length + structures.items.length);

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

		// A parametric opening carries its five numbers instead of a model URL
		// (RM-008 F1). The catalog row states only what differs from the kind's
		// defaults, and `normaliseOpening` fills the rest in where the item is
		// built - so a row is "a door" or "a door, hinged right", not a full record
		// repeated six times.
		if (entry.opening)
		{
			metadata.opening = entry.opening;
		}

		// The same arrangement for a generated flight (RM-008 F3): the row states
		// only what differs from the defaults in `items/stair.js`, and
		// `normaliseStair` fills the rest in where the item is built.
		if (entry.stair)
		{
			metadata.stair = entry.stair;
		}

		// And the same again for a column or a beam (RM-008 F2).
		if (entry.structure)
		{
			metadata.structure = entry.structure;
		}

		// The sixth key, and the first that is not a generator (RM-011 H2, W-11).
		// A row saying `"lamp": {}` is an item that emits at the defaults in
		// `items/lamp.js`; one saying `{"brightness": 2400}` is a chandelier.
		if (entry.lamp)
		{
			metadata.lamp = entry.lamp;
		}

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
