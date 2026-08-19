// @ts-check
import {computed, ref} from 'vue';
import manifest from '../../catalog/catalog-manifest.json';
import {assetResolver} from './useAssets.js';
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
 * ## Two tiers, four packs, and nothing bundled (RM-012 J1 X-3, J2)
 *
 * `catalog.json` is still the single place a row is authored. What changed is
 * that it is no longer what the application imports.
 *
 * J1 split it by **tier**: an *index* of what the grid draws and filters on,
 * plus what `addItem` needs to place a thing - which keeps `addItem` synchronous
 * - and a *detail* of what a person reads about one item, its measured
 * dimensions, its source and its licence. Those are the expensive keys precisely
 * because each is unique to one row and gzip has nothing to share.
 *
 * J2 split it again, by **pack**, and this time nothing stays behind. What the
 * bundle imports is a manifest: one line per kit, naming it, its licence, its
 * row count and the two URLs its rows are served from. Every row of every tier
 * is fetched from `public/catalog/` the first time somebody opens the drawer.
 *
 * The reason is that the tier split alone runs out. X-3 measured J1's metadata
 * on 600 rows at **17,264 gzipped bytes of growth against 13,292 of `first-load`
 * headroom**, and split by tier the index half is 9,857 - which fits, and that is
 * the trap. It fits until the sprint that adds rows, and the sprint that adds
 * rows is the next one. A manifest is a function of how many *kits* exist rather
 * than how many *items*, so acquiring two hundred chairs moves the payload by one
 * line. That is what makes "packs loaded lazily by manifest" a property of the
 * arrangement instead of a promise about future restraint - and it is what makes
 * M-43's gate checkable: a boot fetches no pack, so a pack nobody opened cost it
 * nothing.
 *
 * ## What that costs, and where it is paid
 *
 * The grid cannot draw before a fetch lands, where before it drew from the
 * bundle. So the index is fetched first and awaited, and the detail after it and
 * not awaited - which is the same staging as before, moved from
 * bundle-then-chunk to fetch-then-fetch: rows appear, then sizes appear under
 * them. A person opening the drawer sees the three generated sections
 * immediately, because those have no model files and are still bundled.
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
 * @property {number} [unitScale] Centimetres per authored unit, resolved from
 *           the row's kit by the splitter. In the index rather than the detail
 *           because the placement path reads it - 60 gzipped bytes for all 168.
 * @property {string} [pack] Which pack the row was fetched in. Added at merge
 *           time rather than written into the file: the row is in that pack's
 *           file, so it is of that kit, and a key saying so could disagree with
 *           the file it sits in (RM-012 J2).
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
 * The packs this build knows about, in the order the manifest lists them.
 *
 * Read straight off the bundled manifest, so it is available before any fetch -
 * a caller that wants to say "four kits, 168 items, three licences" can, without
 * downloading a row.
 *
 * @type {Array<{id: string, name: string, licence: string, rows: number,
 *   index: string, detail: string}>}
 */
export const PACKS = manifest.packs;

/**
 * Every index row from every pack that has arrived, in manifest order.
 *
 * Empty until `loadCatalogPacks()` resolves, and every reader is written for
 * that: the drawer draws its generated sections, says it is loading, and fills
 * in. Module-level for the reason `useDisplayUnit` gives - there is one catalog,
 * and two callers holding different halves of it would be a bug.
 *
 * @type {import('vue').Ref<Array<CatalogItem>>}
 */
const rows = ref([]);

/**
 * The detail, once somebody has opened the drawer. Module-level for the same
 * reason as `rows` above.
 *
 * @type {import('vue').Ref<?{items: Object<string, CatalogDetail>, sources: Object}>}
 */
const detail = ref(null);

/** The fetches in flight, so two callers on the same tick share one round trip. */
let packsPending = null;
let detailPending = null;

/**
 * Fetch one JSON file, and never throw.
 *
 * A pack that does not arrive leaves the drawer smaller rather than broken -
 * the same call `useAssets.loadManifest` makes about the asset manifest, and for
 * the same reason: a metadata file missing is a degradation, and refusing to
 * open the catalog over it would turn that into an outage.
 *
 * @param {string} url
 * @param {?function(string): Promise<*>} fetcher
 * @returns {Promise<{ok: boolean, json: ?Object}>}
 */
function fetchJson(url, fetcher)
{
	// `const` rather than `var` so the null check below narrows inside the closure
	// that uses it. A `var` is reassignable, so TypeScript widens it back and the
	// call reads as possibly-null three lines later (RM-004 B3).
	const call = fetcher || (typeof fetch === 'function' ? fetch : null);
	if (!call)
	{
		return Promise.resolve({ok: false, json: null});
	}
	// Through the resolver, like every other file this deployment serves out of
	// `public/`. With no manifest and no base that is the identity A5 promises,
	// so the URL is the one in the manifest; with `?assetBase=` the packs move to
	// the CDN along with the models they describe. A pack acquired later is a
	// file in that tree and there is no reason for it to be the one thing pinned
	// to the document's origin.
	const at = assetResolver().resolve(url);
	return Promise.resolve()
		.then(function () {return call(at.url || url);})
		.then(function (response)
		{
			if (!response || !response.ok)
			{
				return {ok: false, json: null};
			}
			return Promise.resolve(response.json()).then(function (json) {return {ok: true, json: json};});
		})
		.catch(function () {return {ok: false, json: null};});
}

/**
 * Fetch every pack's index rows, once.
 *
 * `fetch` rather than a dynamic `import()`, and that is the whole change J2
 * makes here. An import is resolved at build time, which is what made the detail
 * a chunk in J1 - and a chunk is still something the build knows the size of and
 * a name for. A pack acquired later is a file dropped into `public/catalog/` and
 * a line added to the manifest; nothing about it can be known at build time, and
 * a mechanism that only works for content the build already has is not the
 * mechanism J2 needs.
 *
 * Failures are per-pack: three kits that arrive are three kits a person can
 * browse. If any pack failed, the promise is not cached, so the next open tries
 * again - a pack that failed once on a flaky connection is not a pack that is
 * missing.
 *
 * @param {Object} [options]
 * @param {function(string): Promise<*>} [options.fetch] Injected by the suite.
 * @returns {Promise<Array<CatalogItem>>}
 */
export function loadCatalogPacks(options)
{
	if (packsPending)
	{
		return packsPending;
	}
	var fetcher = (options && options.fetch) || null;
	packsPending = Promise.all(PACKS.map(function (pack)
	{
		return fetchJson(pack.index, fetcher);
	})).then(function (results)
	{
		rows.value = results.reduce(function (all, result, at)
		{
			// Tagged with the pack it arrived in, which costs nothing and cannot
			// drift: the row is in that file, so it is of that kit. A `source` key
			// in the index would be a second copy of the same fact, priced and
			// downloaded, that could disagree with the file it is in (RM-012 J2).
			return all.concat(((result.json && result.json.items) || [])
				.map((row) => Object.assign({pack: PACKS[at].id}, row)));
		}, []);
		if (results.some(function (result) {return !result.ok;}))
		{
			packsPending = null;
		}
		return rows.value;
	});
	return packsPending;
}

/**
 * Fetch every pack's detail, once, and merge them.
 *
 * Merged rather than kept per-pack because the consumer's question is about one
 * row - "what size is this?" - and it has a model URL, not a pack. The `sources`
 * table is rebuilt from each pack's own single entry, which is why a pack file
 * carries its provenance rather than pointing at a shared table: a pack has to be
 * readable on its own, or acquiring one means editing a file it does not own.
 *
 * @param {Object} [options]
 * @param {function(string): Promise<*>} [options.fetch] Injected by the suite.
 * @returns {Promise<?{items: Object, sources: Object}>} Null if nothing arrived,
 *   in which case the drawer keeps working from the index and shows no
 *   dimensions.
 */
export function loadCatalogDetail(options)
{
	if (detail.value)
	{
		return Promise.resolve(detail.value);
	}
	if (detailPending)
	{
		return detailPending;
	}
	var fetcher = (options && options.fetch) || null;
	detailPending = Promise.all(PACKS.map(function (pack)
	{
		return fetchJson(pack.detail, fetcher);
	})).then(function (results)
	{
		var merged = {items: {}, sources: {}};
		var landed = 0;
		results.forEach(function (result, at)
		{
			if (!result.ok || !result.json)
			{
				return;
			}
			landed++;
			Object.assign(merged.items, result.json.items || {});
			merged.sources[PACKS[at].id] = result.json.source || {};
		});
		if (results.some(function (result) {return !result.ok;}))
		{
			detailPending = null;
		}
		if (!landed)
		{
			return null;
		}
		detail.value = merged;
		return detail.value;
	});
	return detailPending;
}

/**
 * Forget everything fetched. For the suite, which needs each case to start where
 * a fresh page starts rather than where the previous case left off.
 */
export function resetCatalogPacks()
{
	rows.value = [];
	detail.value = null;
	packsPending = null;
	detailPending = null;
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
	// The three generated sections first and always: they have no model files, so
	// they are bundled and they are there before any pack lands. The mesh sections
	// are built from whatever packs have arrived, and `filter` drops the empty
	// ones - which before a fetch is all of them, and is why the drawer has a
	// loading state rather than an empty grid.
	return [openingSection(), stairSection(), structureSection()].concat(Object.keys(manifest.itemTypes)
		.map((key) => Object.assign({id: Number(key)}, manifest.itemTypes[key]))
		.sort((a, b) => a.order - b.order)
		.map((type) => ({
			id: type.id,
			heading: type.heading,
			items: rows.value.filter((item) => item.type === type.id),
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
	// What is showable now, not what the manifest promises. Before the packs land
	// this is the twelve generated rows, and the drawer says so - a count that
	// quoted the manifest would read 180 beside a grid holding 12.
	var count = computed(() => rows.value.length + openings.items.length
		+ stairs.items.length + structures.items.length);

	/**
	 * How many rows every pack in the manifest would add up to, fetched or not.
	 *
	 * The manifest's own arithmetic, available before a byte of it is downloaded,
	 * which is what lets the drawer say what it is waiting for.
	 */
	var promised = computed(() => PACKS.reduce((sum, pack) => sum + pack.rows, 0)
		+ openings.items.length + stairs.items.length + structures.items.length);

	/** Whether the packs have been asked for and have all arrived. */
	var ready = computed(() => rows.value.length > 0);

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
			// Centimetres per authored unit, resolved by `tools/split-catalog.mjs`
			// from the kit each row came from and written into the bundled index -
			// which is why it is here and not fetched. `Item.applyUnitScale` uses it
			// in place of the `x300` hack RM-009 U-3 measured wrong (RM-012 J1).
			unitScale: entry.unitScale,
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

	return {sections, count, promised, ready, packs: PACKS, addItem, detail, detailFor,
		loadPacks: loadCatalogPacks, loadDetail: loadCatalogDetail};
}
