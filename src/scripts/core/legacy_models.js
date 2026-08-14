// @ts-check
/**
 * Compatibility shim for designs saved before the glTF conversion (sprint S3).
 *
 * Every furniture model used to ship as three.js JSON Model 3.1 - a format no
 * loader after r98 can read. The 25 of them were converted to glTF 2.0 by
 * tools/convert-legacy-json.mjs, but saved .blueprint3d files still name the
 * old ones, and there is no migration step a user could be asked to run: the
 * files live in their downloads folder.
 *
 * So the library rewrites the URL on the way in. Scene.addItem calls
 * resolveModelUrl() for every item it loads, whoever created it, and the item
 * carries the new URL from then on - which means the next save is glb-native
 * and the file stops needing this shim.
 *
 * This lives in the library rather than in the demo on purpose: programmatic
 * embedders load their users' saved files too.
 */

/** Where the legacy models used to live, and where their conversions live now. */
export const LEGACY_MODEL_DIR = 'models/js';
export const CONVERTED_MODEL_DIR = 'models/js-glb';

/**
 * The 25 legacy models, by basename without extension.
 *
 * An explicit list rather than a blanket "any .js under models/js" rule, so a
 * URL this project never shipped is passed through untouched instead of being
 * silently rewritten to a 404.
 */
export const LEGACY_MODEL_NAMES = Object.freeze([
	'BlakeAvenuejoshuatreecheftable',
	'DWR_MATERA_DRESSER2',
	'GUSossingtonendtable',
	'bd-shalebedside-smoke_baked',
	'cb-archnight-white_baked',
	'cb-blue-block-60x96',
	'cb-clapboard_baked',
	'cb-kendallbookcasewalnut_baked',
	'cb-moore_baked',
	'cb-rochelle-gray_baked',
	'cb-scholartable_baked',
	'cb-tecs_baked',
	'closed-door28x80_baked',
	'gus-churchchair-whiteoak',
	'ik-ekero-blue_baked',
	'ik-ekero-orange_baked',
	'ik-kivine_baked',
	'ik-stockholmcoffee-brown',
	'ik_nordli_full',
	'nyc-poster2',
	'open_door',
	'ore-3legged-white_baked',
	'we-crosby2piece-greenbaked',
	'we-narrow6white_baked',
	'whitewindow',
]);

const LEGACY_NAME_SET = new Set(LEGACY_MODEL_NAMES);

/** Old URL -> new URL, for every legacy model. Exported for tests and tooling. */
export const LEGACY_MODEL_MAP = Object.freeze(LEGACY_MODEL_NAMES.reduce((map, name) =>
{
	map[`${LEGACY_MODEL_DIR}/${name}.js`] = `${CONVERTED_MODEL_DIR}/${name}.glb`;
	return map;
}, {}));

/** Names already reported, so a broken design warns once instead of per item. */
const warned = new Set();

/**
 * Rewrite a saved model URL to its converted equivalent.
 *
 * Matching is on the basename, not the whole path, so a design saved by an
 * embedder that served the models from somewhere else still resolves - the
 * directory is replaced along with the extension.
 *
 * @param {string} modelUrl The url as it appears in the saved design.
 * @param {string} [format] The format recorded alongside it, if any.
 * @returns {{url: string, format: (string|undefined), converted: boolean}}
 *          `converted` is true only when this call actually rewrote something,
 *          which is what marks an item as needing the legacy texture treatment.
 */
export function resolveModelUrl(modelUrl, format)
{
	if (typeof modelUrl !== 'string' || !modelUrl.endsWith('.js'))
	{
		return {url: modelUrl, format, converted: false};
	}

	var name = modelUrl.slice(modelUrl.lastIndexOf('/') + 1, -3);
	if (!LEGACY_NAME_SET.has(name))
	{
		if (!warned.has(modelUrl))
		{
			warned.add(modelUrl);
			console.warn(`Model "${modelUrl}" is in the retired three.js JSON format and is not one of the models this build converted. It will not load. See src/scripts/core/legacy_models.js.`);
		}
		return {url: modelUrl, format, converted: false};
	}

	return {url: `${CONVERTED_MODEL_DIR}/${name}.glb`, format: 'gltf', converted: true};
}

/** Test hook: forget which URLs have already been warned about. */
export function resetLegacyModelWarnings()
{
	warned.clear();
}
