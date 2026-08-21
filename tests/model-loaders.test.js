/**
 * The model layer's loaders, and who decides what this device can decode.
 *
 * RM-018 Q1, metric M-61. Two things are pinned here and they are the two
 * halves of one defect.
 *
 * ## The branch that was covered by nobody, and reported as covered anyway
 *
 * `createModelLoaders` sets `ktx2Loader.workerConfig` when the caller knows
 * what the GPU supports, and that line was executed by nothing in this suite -
 * `formatSupport()` is null under Node, so the arm never ran. It was reported
 * as covered in roughly two runs in three, which moved the global statements
 * figure between 88.99 % and 89.00 % against a floor of 89 and failed the
 * build seven times in twenty-one. Measured, not inferred: a probe writing
 * straight to fd 2 recorded 22 calls with `support` falsy and none with it
 * truthy, in every run, while v8 reported the true arm taken 21 times.
 *
 * A never-executed line inside a module that is imported by a promise nobody
 * awaits is where v8's block coverage stops being reliable. The suite does not
 * argue with the instrument; it makes the arm genuinely run, which is what the
 * line deserved in the first place - it is the one place a KTX2 texture's
 * transcode target is chosen, and it had no test.
 *
 * ## And who chooses, which M3 changed by accident
 *
 * `core/texture_formats.js` is first-caller-wins, so whoever asks first decides
 * for the page. Until M3 that was always the renderer, because `Main` was built
 * inside the `BlueprintJS` constructor. M3 made the viewer lazy and the read
 * sat inside a dynamically imported module, so the answer came from whenever
 * that chunk finished downloading. `Scene._ensureLoaders` reads it on its own
 * line now and passes it in; the last case below is what holds that.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {LoadingManager} from 'three';
import {Model} from '../src/scripts/model/model.js';
import {createModelLoaders} from '../src/scripts/model/loaders.js';
import {describeFrom, resetFormatSupport} from '../src/scripts/core/texture_formats.js';

/** Where this deployment says the two codecs live. */
const assets = {
	decoderPath: () => 'https://example.test/draco/',
	transcoderPath: () => 'https://example.test/basis/',
};

/** A renderer-shaped object that reports the one extension it is given. */
function rendererWith(name)
{
	const get = (asked) => (asked === name ? {} : null);
	return {extensions: {has: (asked) => get(asked) !== null, get}};
}

afterEach(() => {resetFormatSupport();});

describe('M-61 - createModelLoaders is a function of its arguments', () =>
{
	it('builds all four loaders and wires draco and ktx2 into the glTF one', () =>
	{
		const manager = new LoadingManager();
		const loaders = createModelLoaders(manager, assets, null);

		expect(loaders.gltfloader).toBeTruthy();
		expect(loaders.objloader).toBeTruthy();
		expect(loaders.dracoLoader).toBeTruthy();
		expect(loaders.ktx2Loader).toBeTruthy();

		// A compressed .glb is refused outright by a GLTFLoader without these,
		// which is why they are attached here rather than supplied on demand.
		expect(loaders.gltfloader.dracoLoader).toBe(loaders.dracoLoader);
		expect(loaders.gltfloader.ktx2Loader).toBe(loaders.ktx2Loader);
	});

	it('points both codecs at the paths this deployment resolves', () =>
	{
		const loaders = createModelLoaders(new LoadingManager(), assets, null);

		// `?assetBase=` relocates the decoder with everything else it relocates,
		// so these come from the resolver rather than from a constant. r185's
		// DRACOLoader keeps no `decoderPath` - `setDecoderPath` expands it into
		// the three URLs it will actually fetch, and those are what a wrong base
		// would break, so those are what is asserted.
		expect(loaders.dracoLoader.decoderPaths).toEqual({
			js: 'https://example.test/draco/draco_wasm_wrapper.js',
			wasm: 'https://example.test/draco/draco_decoder.wasm',
			dep_js: 'https://example.test/draco/draco_decoder.js',
		});
		expect(loaders.ktx2Loader.transcoderPath).toBe('https://example.test/basis/');
	});

	it('leaves workerConfig alone when the caller has no answer', () =>
	{
		const loaders = createModelLoaders(new LoadingManager(), assets, null);

		// Null is the honest answer in Node and in a browser with no WebGL. A
		// caller that guessed here would transcode to a format the GPU cannot
		// read, which fails to upload - worse than not using KTX2 at all.
		expect(loaders.ktx2Loader.workerConfig).toBeNull();
	});

	it('takes workerConfig from the caller when there is one', () =>
	{
		const support = {
			astcSupported: false, astcHDRSupported: false, etc1Supported: false,
			etc2Supported: true, dxtSupported: true, bptcSupported: false,
			pvrtcSupported: false,
		};

		const loaders = createModelLoaders(new LoadingManager(), assets, support);

		// The arm the whole file exists for. Deleting the assignment in
		// loaders.js fails here, which is the property that was missing while a
		// coverage threshold was being decided by whether v8 noticed it.
		expect(loaders.ktx2Loader.workerConfig).toBe(support);
		expect(loaders.ktx2Loader.workerConfig.etc2Supported).toBe(true);
	});

	it('does not read the page-wide record itself', () =>
	{
		describeFrom(rendererWith('WEBGL_compressed_texture_etc'));

		// A record exists and this function still gets nothing, because it is
		// not the one asking. That is the difference between a function that
		// decides and a function that is told, and it is the whole fix.
		const loaders = createModelLoaders(new LoadingManager(), assets, null);

		expect(loaders.ktx2Loader.workerConfig).toBeNull();
	});
});

describe('M-61 - Scene decides the device question before the import', () =>
{
	it('reads the format record when asked for loaders, not when the chunk lands', async () =>
	{
		const model = new Model('/textures/');

		// Nothing has answered yet, so this call answers with null - which under
		// Node is what `probe()` returns and is the whole point: the value is
		// taken here, on this tick.
		const loaders = model.scene._ensureLoaders();

		// A renderer attaching AFTER the ask. Before Q1 this could win, because
		// the read happened inside the imported module and the import had not
		// settled; the answer therefore depended on a download.
		describeFrom(rendererWith('WEBGL_compressed_texture_etc'));

		expect((await loaders).ktx2Loader.workerConfig).toBeNull();
	});

	it('hands the record over when one already exists', async () =>
	{
		describeFrom(rendererWith('WEBGL_compressed_texture_etc'));

		const model = new Model('/textures/');
		const loaders = await model.scene._ensureLoaders();

		// Same code path, opposite input, and the difference is entirely in what
		// had happened before the ask. That is what "decided at a nameable
		// moment" buys, and it is the case that would have caught the inversion
		// M3 introduced.
		expect(loaders.ktx2Loader.workerConfig).toMatchObject({etc2Supported: true});
	});
});
