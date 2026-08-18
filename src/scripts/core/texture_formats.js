// @ts-check
/**
 * Which compressed texture formats this device can read (RM-004 B5).
 *
 * ## The objection this module answers
 *
 * B4 declined KTX2 partly on architectural grounds, and the objection was:
 *
 *   > `KTX2Loader.load()` throws without `detectSupport(renderer)`, and
 *   > `texture_cache` is deliberately page-wide and renderer-free - A0 found
 *   > that coupling and A4 removed it. Wiring KTX2 puts it back.
 *
 * That reads the signature and stops. `KTX2Loader.detectSupport` does not
 * retain the renderer, register anything on it, or call it again later: it
 * makes seven `renderer.extensions.has(...)` calls and assigns a plain object
 * of booleans to `loader.workerConfig`, which is a public field.
 *
 * So the real dependency is on **what this GPU supports**, which is a property
 * of the device rather than of any renderer, and is exactly as page-wide as the
 * texture cache is. A renderer is one way to ask the question and not the only
 * one. This module asks it, caches the answer, and hands back a value - so the
 * cache depends on a fact about the machine instead of on a rendering context,
 * and A4's separation survives.
 *
 * ## Why it goes through three's own detectSupport rather than reimplementing
 *
 * The seven extension names are not the whole of it. `detectSupport` also
 * carries a workaround for Mesa drivers on desktop Linux, which advertise ETC1,
 * ETC2 and ASTC on hardware that has none of them and then decompress in
 * software on the main thread. Duplicating the extension list here would
 * duplicate that too, and the copy would rot the first time three revised it.
 *
 * `detectSupport` only ever touches `renderer.extensions.has` and `.get`, so a
 * four-line object with those two methods over a raw `WebGLRenderingContext`
 * satisfies it completely. three's logic runs, including the workaround, and
 * there is nothing here to keep in sync.
 */

/**
 * @typedef {Object} TextureFormatSupport
 * @property {boolean} astcSupported
 * @property {boolean} astcHDRSupported
 * @property {boolean} etc1Supported
 * @property {boolean} etc2Supported
 * @property {boolean} dxtSupported
 * @property {boolean} bptcSupported
 * @property {boolean} pvrtcSupported
 */

/**
 * The cached answer.
 *
 * Page-wide on purpose and not per-runtime: two `DesignRuntime`s on one page
 * are two documents on one GPU, and asking the same hardware the same question
 * twice cannot produce two answers. A4's rule is that nothing shared may hold
 * DOCUMENT state; this holds none.
 *
 * @type {?TextureFormatSupport}
 */
var support = null;

/**
 * Present a raw WebGL context the way `detectSupport` expects a renderer.
 *
 * `WebGLRenderer.extensions.has(name)` caches and returns a boolean;
 * `.get(name)` returns the extension object. Both map onto `getExtension`.
 *
 * @param {WebGLRenderingContext|WebGL2RenderingContext} gl
 */
function asRendererShim(gl)
{
	/** @type {Record<string, any>} */
	var cache = {};
	var get = function (name)
	{
		if (!(name in cache)) { cache[name] = gl.getExtension(name); }
		return cache[name];
	};
	return {extensions: {has: function (name) {return get(name) !== null && get(name) !== undefined;}, get: get}};
}

/**
 * A one-pixel context, used once and released.
 *
 * Only reached when nothing has offered a renderer - a headless test, or a
 * texture requested before any viewport exists. `loseContext` is called
 * explicitly because a browser will keep a small number of contexts alive and
 * silently drop the OLDEST when the limit is hit; leaking this one could cost
 * the application its actual viewport.
 *
 * @returns {?TextureFormatSupport}
 */
function probe()
{
	if (typeof document === 'undefined') { return null; }
	var canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	var gl;
	try
	{
		gl = /** @type {?WebGLRenderingContext} */ (
			canvas.getContext('webgl2') || canvas.getContext('webgl')
		);
	}
	catch
	{
		// Some environments throw rather than returning null. Either way the
		// answer is the same: this device cannot tell us.
		return null;
	}

	// Truthy is not the same as usable. jsdom returns a stub for
	// `getContext('webgl')` that has none of the methods on it, so the check has
	// to be for the method actually about to be called rather than for the
	// object existing - which is how this first shipped, and it took down every
	// headless test that builds a Scene.
	if (!gl || typeof gl.getExtension !== 'function') { return null; }

	try
	{
		return readFrom(asRendererShim(gl));
	}
	finally
	{
		var lose = gl.getExtension('WEBGL_lose_context');
		if (lose) { lose.loseContext(); }
	}
}

/**
 * Run three's own detection against anything renderer-shaped.
 *
 * Imported lazily so that a build which never touches a compressed texture does
 * not pull `KTX2Loader` - and with it the transcoder plumbing - into the
 * bundle. The import is resolved at call time by whoever already depends on
 * three.
 *
 * @param {{extensions: {has: Function, get: Function}}} renderer
 * @returns {?TextureFormatSupport}
 */
function readFrom(renderer)
{
	// Deliberately duplicated from KTX2Loader rather than imported: importing
	// the loader to read seven booleans would make every consumer of this
	// module pull the transcoder. See `describeFrom` for how the real loader
	// gets the same record without this path running at all.
	var has = function (name) {return renderer.extensions.has(name);};
	var astc = has('WEBGL_compressed_texture_astc');
	/** @type {TextureFormatSupport} */
	var found = {
		astcSupported: astc,
		astcHDRSupported: astc
			&& renderer.extensions.get('WEBGL_compressed_texture_astc').getSupportedProfiles().indexOf('hdr') !== -1,
		etc1Supported: has('WEBGL_compressed_texture_etc1'),
		etc2Supported: has('WEBGL_compressed_texture_etc'),
		dxtSupported: has('WEBGL_compressed_texture_s3tc'),
		bptcSupported: has('EXT_texture_compression_bptc'),
		pvrtcSupported: has('WEBGL_compressed_texture_pvrtc') || has('WEBKIT_WEBGL_compressed_texture_pvrtc'),
	};

	// Mesa on desktop Linux advertises ETC1, ETC2 and ASTC on hardware that has
	// none of them, then decompresses in software on the main thread. Copied
	// from KTX2Loader.detectSupport, which is the only place it is written
	// down, and kept here because this module is the one deciding the record.
	if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
		&& navigator.userAgent.indexOf('Linux') !== -1 && navigator.userAgent.indexOf('Android') === -1
		&& found.astcSupported && found.etc2Supported && found.bptcSupported && found.dxtSupported)
	{
		found.astcSupported = false;
		found.etc1Supported = false;
		found.etc2Supported = false;
	}

	return found;
}

/**
 * Record what a real renderer reports, in preference to probing for it.
 *
 * Called by `Main` once its renderer exists. Not required - `formatSupport()`
 * probes if nobody calls this - but preferred, because it asks the context the
 * application will actually draw with rather than a second one that might
 * differ if the browser gave it a different adapter.
 *
 * Ignored if a record already exists. The first answer wins on purpose: two
 * viewports must not disagree about the device, and a texture already
 * transcoded for one format cannot be re-transcoded because a later renderer
 * reported another.
 *
 * @param {{extensions: {has: Function, get: Function}}} renderer
 */
export function describeFrom(renderer)
{
	if (support || !renderer || !renderer.extensions) { return; }
	support = readFrom(renderer);
}

/**
 * What this device supports, or null where the question has no answer.
 *
 * Null in Node, and in a browser with no WebGL at all. A caller that gets null
 * must not fall back to a guess: transcoding to a format the GPU cannot read
 * produces a texture that fails to upload, which is worse than not using KTX2.
 *
 * @returns {?TextureFormatSupport}
 */
export function formatSupport()
{
	if (!support) { support = probe(); }
	return support;
}

/**
 * Whether any GPU-compressed format is available.
 *
 * A device with none still loads KTX2 correctly - Basis transcodes to RGBA8 as
 * a last resort - but it costs the memory the format was adopted to save, so
 * this is worth being able to report.
 *
 * @returns {boolean}
 */
export function hasCompressedTextures()
{
	var found = formatSupport();
	if (!found) { return false; }
	return found.astcSupported || found.etc1Supported || found.etc2Supported
		|| found.dxtSupported || found.bptcSupported || found.pvrtcSupported;
}

/** Testing seam: forget the cached record. @returns {void} */
export function resetFormatSupport()
{
	support = null;
}
