// @ts-check
import {computed, ref} from 'vue';
import catalog from '../../catalog/catalog-index.json';
import {noteUsed} from './useCatalogBrowse.js';
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
 *
 * ## Two files now, and only one of them ships (RM-012 J1, X-3)
 *
 * `catalog.json` is still the single place a row is authored. What changed is
 * that it is no longer what the application imports: `tools/split-catalog.mjs`
 * divides it into an **index**, which vite inlines into the bundle, and a
 * **detail**, which is a dynamic import and so becomes a chunk nobody fetches
 * until the drawer is opened.
 *
 * The line is where the *use* is, and X-3 is why it had to move. Every row is in
 * the payload every visitor downloads, and J1's metadata on 600 rows measured
 * **17,264 gzipped bytes of growth against 13,292 bytes of `first-load`
 * headroom** - M-43 broken before one model is fetched. Split, the same 600 rows
 * cost 9,857, which fits.
 *
 * So the index carries what the grid draws and filters on, plus what `addItem`
 * needs to place a thing - which keeps `addItem` synchronous, and that is worth
 * more than the 40 bytes `format` costs across all 168 rows. The detail carries
 * what a person reads about one item: its measured dimensions, its source and
 * its licence. Those are the expensive keys precisely because each is unique to
 * one row and gzip has nothing to share - except the licences, which are shared
 * by construction and so live once per kit in a `sources` table beside the rows
 * rather than 168 times.
 */

/**
 * The eight rooms a person browses by, in the order the drawer offers them
 * (RM-012 J1, X-1).
 *
 * Ordered by how much of the catalog each holds - living 60 rows, kitchen 27 -
 * so the chips a person is most likely to want are the ones they reach first,
 * and `structure` is last because it is the eighth and it is not a room. It is
 * where the building went: the twelve wall segments RM-012 measured, the
 * openings, the panel, the flights, and the three generated sections, which have
 * no model file and belong to the building just as much.
 *
 * The ids have to match `ROOMS` in `tools/split-catalog.mjs`, which is what
 * refuses to write a row carrying anything else. A test asserts the two lists
 * agree rather than trusting that they do, because a vocabulary in two files is
 * a vocabulary that drifts.
 *
 * @type {Array<{id: string, label: string}>}
 */
export const ROOMS = [
	{id: 'living', label: 'Living'},
	{id: 'kitchen', label: 'Kitchen'},
	{id: 'dining', label: 'Dining'},
	{id: 'bedroom', label: 'Bedroom'},
	{id: 'bathroom', label: 'Bathroom'},
	{id: 'office', label: 'Office'},
	{id: 'utility', label: 'Utility'},
	{id: 'structure', label: 'Structure'},
];

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
 * @property {string} [room] One of eight, `structure` among them for the parts
 *           of the building. What the drawer browses by (RM-012 J1, X-1).
 * @property {Array<string>} [tags] One or more of fourteen. What the search box
 *           matches besides the name, so "seating" finds the chairs.
 */

/**
 * What the detail file says about one row, once it has been fetched.
 *
 * @typedef {Object} CatalogDetail
 * @property {{w: number, h: number, d: number, scale: number}} [size] The
 *           model's bounding box **in centimetres**, measured from its glTF
 *           accessor bounds with the scene graph applied - not authored, and not
 *           the item's placed size. `scale` is how many centimetres one authored
 *           unit is, declared by the kit in `sources.json`, so the conversion is
 *           undoable by a reader rather than inferred a second time.
 * @property {string} [source] Which kit this came from; a key into the `sources`
 *           table beside `items`, where the licence and the author are.
 */

/**
 * The detail, once somebody has opened the drawer. Module-level for the reason
 * `useDisplayUnit` gives: there is one catalog, and two callers holding
 * different halves of it would be a bug rather than a feature.
 *
 * @type {import('vue').Ref<?{items: Object<string, CatalogDetail>, sources: Object}>}
 */
const detail = ref(null);

/** The fetch in flight, so two callers on the same tick share one chunk. */
let pending = null;

/**
 * Fetch the detail chunk, once.
 *
 * A dynamic `import()` rather than a `fetch`, because this file is in
 * `src/app`: the application is code-split, so vite emits the JSON as its own
 * chunk and a visitor who never opens the drawer never asks for it. J2's
 * external packs will need the fetch form - they are not in the build - and
 * this is the seam they will use.
 *
 * @returns {Promise<?Object>} Null if the chunk could not be loaded, in which
 *   case the drawer keeps working from the index and shows no dimensions.
 */
export function loadCatalogDetail()
{
	if (detail.value)
	{
		return Promise.resolve(detail.value);
	}
	if (!pending)
	{
		pending = import('../../catalog/catalog-detail.json')
			.then(function (module)
			{
				detail.value = module.default || module;
				return detail.value;
			})
			.catch(function ()
			{
				// Cleared so a later open tries again: a chunk that failed once on
				// a flaky connection is not a chunk that is missing.
				pending = null;
				return null;
			});
	}
	return pending;
}

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
			// Part of the building, like the mesh openings beside them, so somebody
			// browsing for a door finds the generated ones too rather than only the
			// three that happen to have a model file.
			room: 'structure',
			tags: ['opening'],
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
			room: 'structure',
			tags: ['stairs'],
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
			room: 'structure',
			tags: ['panel'],
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
		// Recorded here rather than in the drawer, because this is the one place an
		// item is added *from the catalog* and the drawer is a view of it. Not
		// persisted for a parametric row: it has no model file, so there is nothing
		// here that would tell one from another (RM-012 J1).
		noteUsed(entry.model);

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

	/**
	 * What is known about one row beyond what the grid shows.
	 *
	 * Null until `loadCatalogDetail()` has resolved, which is deliberate: a
	 * caller that renders a dimension must be prepared not to have one, because
	 * the whole point of the split is that it has not been downloaded yet.
	 *
	 * @param {CatalogItem} entry
	 * @returns {?CatalogDetail}
	 */
	function detailFor(entry)
	{
		return (detail.value && entry && detail.value.items[entry.model]) || null;
	}

	return {sections, count, addItem, detail, detailFor, loadDetail: loadCatalogDetail};
}
