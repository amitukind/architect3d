// @ts-check
import {writeZip, readZip} from './zip.js';

/**
 * A design and the assets its recipient will not have (RM-013 K2).
 *
 * ## What it carries, and what the measurement said about that
 *
 * K2's opening pass took the asset closure of the largest sample this build
 * ships: **19 items, 20 distinct files, 146,946 bytes** - and every one of them
 * is already in the application the recipient opens the bundle with. A bundle
 * that carried them would be a `.blueprint3d` with 147 kB of the recipient's
 * own files stapled to it.
 *
 * So the rule is not "carry the assets". It is **carry what the recipient will
 * not have**, decided against their own `AssetManifest` - and today, for a
 * design built out of the catalog, that set is empty and the bundle says so.
 * When J3 lands, an imported model is by definition an asset that is in nobody
 * else's build, and the same rule picks it up without being changed. That is
 * what RM-012 X-7 meant by the two sharing one answer, and it is why this ships
 * with the rule rather than with a guess at J3's schema.
 *
 * ## The honest limit, stated
 *
 * The closure is **the URLs the document names** - each item's `model_url`, and
 * the textures on walls, floors and ceilings. It is not the images *inside* a
 * `.glb`, because reading those means fetching and parsing every model to build
 * a bundle. That is a real gap for a hypothetical imported model that points at
 * external textures, and it cannot arise for the imports J3 will actually
 * produce: a person picks one file, and one file is self-contained.
 *
 * ## Reading is half a feature until J3, and says so
 *
 * A bundle's design is read here and now. Its carried assets are not, because
 * there is nowhere to put them - RM-012 X-7 measured exactly this: *"J3 needs a
 * store"*. So a bundle that carries assets is opened, its design is loaded, and
 * the reader reports what it could not place by name. Dropping them silently
 * would be the one outcome worse than not reading them.
 */

/** The design, always at this name, so any zip tool shows it first. */
export const DESIGN_ENTRY = 'design.blueprint3d';
/** What the bundle expects and what it brought. */
export const MANIFEST_ENTRY = 'bundle.json';
/** Where a carried asset lives, under its own logical path. */
export const ASSET_PREFIX = 'assets/';

/** The bundle format this build writes and understands. */
export const BUNDLE_VERSION = 1;

/**
 * Every asset URL a document names.
 *
 * Deduplicated and sorted, so two bundles of the same design are the same
 * bundle - the timestamps are already fixed at the DOS epoch for the same
 * reason. See the note above for what this deliberately does not reach.
 *
 * @param {string} design A `.blueprint3d` document.
 * @returns {Array<string>}
 */
export function assetsIn(design)
{
	/** @type {Set<string>} */
	var found = new Set();
	/** @type {*} */
	var parsed;
	try
	{
		parsed = JSON.parse(design);
	}
	catch
	{
		return [];
	}

	var addTexture = function (texture)
	{
		if (texture && typeof texture.url === 'string' && texture.url)
		{
			found.add(texture.url);
		}
	};

	var walk = function (level)
	{
		if (!level)
		{
			return;
		}
		(level.items || []).forEach(function (item)
		{
			if (item && typeof item.model_url === 'string' && item.model_url)
			{
				found.add(item.model_url);
			}
		});
		var plan = level.floorplan;
		if (!plan)
		{
			return;
		}
		(plan.walls || []).forEach(function (wall)
		{
			addTexture(wall && wall.frontTexture);
			addTexture(wall && wall.backTexture);
		});
		// Room surfaces are keyed by the room's corner list and each value is a
		// record of surfaces, so the shape is walked rather than named.
		[plan.floorTextures, plan.newFloorTextures, plan.ceilingTextures].forEach(function (collection)
		{
			Object.values(collection || {}).forEach(function (record)
			{
				addTexture(record);
				Object.values(record || {}).forEach(addTexture);
			});
		});
		addTexture(plan.carbonSheet);
	};

	walk(parsed);
	(parsed.levels || []).forEach(walk);
	return [...found].sort();
}

/**
 * Build a bundle.
 *
 * @param {string} design
 * @param {Object} options
 * @param {function(string): boolean} options.has Whether the receiving build
 *        already has this asset. In the application this is the asset
 *        manifest's own `declares`; a caller with no manifest passes
 *        `() => true` and gets a bundle carrying nothing, which is honest.
 * @param {function(string): Promise<?Uint8Array<ArrayBuffer>>} options.fetchAsset
 *        The bytes of an asset that has to travel, or null if they cannot be
 *        got. A missing asset is recorded rather than failing the bundle: a
 *        design that loses one file should not lose the other nineteen.
 * @param {string} [options.name] What the design is called, for the manifest.
 * @returns {Promise<{bytes: Uint8Array<ArrayBuffer>, manifest: Object}>}
 */
export async function buildBundle(design, options)
{
	var settings = options || {};
	var referenced = assetsIn(design);
	var carried = [];
	var expected = [];
	var missing = [];
	/** @type {Array<{name: string, bytes: Uint8Array<ArrayBuffer>}>} */
	var entries = [];

	for (var i = 0; i < referenced.length; i++)
	{
		var url = referenced[i];
		if (settings.has(url))
		{
			expected.push(url);
			continue;
		}
		var bytes = await settings.fetchAsset(url);
		if (!bytes)
		{
			missing.push(url);
			continue;
		}
		carried.push(url);
		entries.push({name: ASSET_PREFIX + url, bytes: bytes});
	}

	var manifest = {
		format: 'architect3d-bundle',
		version: BUNDLE_VERSION,
		name: settings.name || 'design',
		design: DESIGN_ENTRY,
		// Three lists, not one. `expected` is what the reader must already have,
		// `carried` is what travelled, and `missing` is what could not be got -
		// and a bundle that quietly merged the third into neither of the others
		// would arrive looking complete.
		expected: expected,
		carried: carried,
		missing: missing,
	};

	entries.unshift({name: MANIFEST_ENTRY, bytes: new TextEncoder().encode(JSON.stringify(manifest, null, '\t'))});
	entries.unshift({name: DESIGN_ENTRY, bytes: new TextEncoder().encode(design)});

	return {bytes: await writeZip(entries), manifest: manifest};
}

/**
 * Read a bundle.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<{ok: boolean, design: ?string, manifest: ?Object,
 *          carried: Array<string>, reason: ?string}>}
 */
export async function readBundle(bytes)
{
	/** @type {Map<string, Uint8Array>} */
	var files;
	try
	{
		files = await readZip(bytes);
	}
	catch (error)
	{
		return {ok: false, design: null, manifest: null, carried: [],
			reason: (error instanceof Error) ? error.message : 'that file could not be read'};
	}

	var body = files.get(DESIGN_ENTRY);
	if (!body)
	{
		return {ok: false, design: null, manifest: null, carried: [],
			reason: `that archive has no ${DESIGN_ENTRY} in it`};
	}

	/** @type {?Object} */
	var manifest = null;
	var raw = files.get(MANIFEST_ENTRY);
	if (raw)
	{
		try {manifest = JSON.parse(new TextDecoder().decode(raw));}
		catch { manifest = null; }
	}
	if (manifest && manifest.version > BUNDLE_VERSION)
	{
		return {ok: false, design: null, manifest: manifest, carried: [],
			reason: 'that bundle was written by a newer version of this app'};
	}

	// Named, not loaded. There is nowhere to put an imported model until J3
	// builds one, and a reader that dropped them silently would hand somebody a
	// design with holes in it and no way to know why.
	var carried = [...files.keys()]
		.filter(function (name) {return name.indexOf(ASSET_PREFIX) === 0;})
		.map(function (name) {return name.slice(ASSET_PREFIX.length);});

	return {ok: true, design: new TextDecoder().decode(body), manifest: manifest,
		carried: carried, reason: null};
}
