// @ts-check
// three's own addons since S4, replacing the three-gltf-loader and
// @calvinscofield/three-objloader repacks. Each of those bundled its own copy
// of three (r105 and r94), so `instanceof` silently failed across the seam and
// the bundle carried three full engines.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {formatSupport} from '../core/texture_formats.js';

/**
 * The machinery that turns model bytes into three.js objects (RM-015 M3).
 *
 * ## Why these four are in a module of their own
 *
 * They used to be four static imports at the top of `scene.js` and four
 * constructions in its constructor, which meant every page that opened a
 * document downloaded a glTF parser, a Draco decoder and a Basis transcoder -
 * whether or not it ever loaded a model.
 *
 * M3 measured what that costs a first load, one loader at a time, each against
 * a build with the other three still in place:
 *
 *     KTX2Loader (with zstddec and ktx-parse)   24,103 gzipped bytes
 *     GLTFLoader                                17,245
 *     OBJLoader                                  2,231
 *     DRACOLoader                                2,009
 *     all four                                  48,969
 *
 * Nothing on the 2D side of the application needs any of it. A plan draws
 * footprints - a rectangle and a name - from `plan_projection`, which reads an
 * item's position and size and never its geometry. So the whole set moved
 * behind one dynamic import, which `Scene` takes the first time it is asked to
 * load something.
 *
 * ## One module rather than four dynamic imports
 *
 * Because a bundler splits on the import, not on the module: four `import()`
 * calls are four chunks and four round trips for machinery that is always
 * wanted together - `GLTFLoader` refuses a `KHR_draco_mesh_compression` file
 * outright unless a `DRACOLoader` was attached before the parse. They arrive as
 * one chunk because they are useless apart.
 */

/**
 * @typedef {Object} ModelLoaders
 * @property {GLTFLoader} gltfloader With Draco and KTX2 already attached.
 * @property {OBJLoader} objloader
 * @property {DRACOLoader} dracoLoader
 * @property {KTX2Loader} ktx2Loader
 */

/**
 * Build this scene's loaders, wired to each other and to its asset resolver.
 *
 * @param {import('three').LoadingManager} manager This scene's manager, so
 *        `manager.abort()` reaches the fetches these start and nobody else's.
 * @param {import('../core/asset_resolver.js').AssetResolver} assets Where the
 *        decoder and transcoder live in this deployment.
 * @returns {ModelLoaders}
 */
export function createModelLoaders(manager, assets)
{
	var gltfloader = new GLTFLoader(manager);
	var objloader = new OBJLoader(manager);
	gltfloader.setCrossOrigin('');

	/**
	 * The Draco decoder (RM-004 B1).
	 *
	 * Every model in the catalog is `KHR_draco_mesh_compression` now, and
	 * `GLTFLoader` throws on one unless a `DRACOLoader` is attached BEFORE the
	 * parse - it cannot be supplied on demand once a compressed file has
	 * arrived. So it is attached here, unconditionally, and the cost of that is
	 * nothing until it decodes: `DRACOLoader` fetches its 73 KB of WASM and
	 * starts its worker on the FIRST compressed mesh, not on construction.
	 *
	 * The decoder path is resolved through the runtime's asset resolver rather
	 * than hard-coded, so `?assetBase=` relocates the decoder alongside
	 * everything else it relocates. A build that serves no decoder is not a
	 * broken build - it is a build whose models are uncompressed, which is every
	 * build before that sprint and any embedder shipping their own catalog.
	 */
	var dracoLoader = new DRACOLoader(manager);
	dracoLoader.setDecoderPath(assets.decoderPath());
	gltfloader.setDRACOLoader(dracoLoader);

	/**
	 * The KTX2 transcoder for model textures (RM-004 B5).
	 *
	 * 18 of the catalog's textures are KTX2 inside their `.glb`, and the
	 * containers declare `KHR_texture_basisu` as REQUIRED - so a GLTFLoader
	 * without this attached does not render them untextured, it refuses the file
	 * outright. Attached beside the Draco loader and for the same reason: it
	 * must be in place before the first parse, and it costs nothing until
	 * something needs it, because three fetches the transcoder on the first
	 * compressed texture rather than at construction.
	 *
	 * `workerConfig` is set from the device rather than by calling
	 * `detectSupport(renderer)`, because a `Scene` has no renderer - it is the
	 * model layer. `core/texture_formats.js` explains why that is the right
	 * dependency rather than a workaround. It is asked here rather than in
	 * `Scene`'s constructor as of M3, which also means the probe context it
	 * opens is created on the first model load instead of on every boot.
	 */
	var ktx2Loader = new KTX2Loader(manager);
	ktx2Loader.setTranscoderPath(assets.transcoderPath());
	var support = formatSupport();
	if (support) { ktx2Loader.workerConfig = support; }
	gltfloader.setKTX2Loader(ktx2Loader);

	return {gltfloader, objloader, dracoLoader, ktx2Loader};
}
