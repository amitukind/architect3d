/**
 * What this GPU can read, and the several ways of having no answer (RM-006).
 *
 * ## Why this file exists at all
 *
 * `core/texture_formats.js` decides whether a KTX2 may be transcoded, and a
 * wrong answer here is not a wrong pixel - it is a texture that fails to upload.
 * The module's own docblock is explicit that a caller receiving null "must not
 * fall back to a guess", so every path that produces null is worth pinning
 * individually rather than as one lump.
 *
 * It had 27.9% branch coverage when this was written, which is how a module
 * ends up when the only thing exercising it is a browser tier that always takes
 * the same happy path. Every negative here - no document, a context that
 * throws, a jsdom stub with no `getExtension`, a Mesa driver lying about ETC -
 * is a real environment somebody runs in, and none of them had a test.
 *
 * ## Why no jsdom
 *
 * `environment: 'node'` is the default in this repository and it is the right
 * one here: the module's first question is whether `document` exists, and the
 * honest way to test "there is no document" is to not have one. Everything
 * beyond that point is reached by installing exactly the shape the code asks
 * for - `document.createElement` returning something with `getContext` - which
 * is a smaller and more legible fake than a whole DOM.
 *
 * The fakes below are deliberately literal about WebGL's contract. `has()` is
 * `getExtension(name) !== null && !== undefined`, so `unsupported` returns null
 * rather than false: a fake that returned false would pass a test the real
 * thing fails.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {describeFrom, formatSupport, hasCompressedTextures, resetFormatSupport} from '../src/scripts/core/texture_formats.js';

/** The seven names `readFrom` asks about, so a fake can answer all of them. */
const ASTC = 'WEBGL_compressed_texture_astc';

/**
 * A renderer-shaped object over a set of supported extension names.
 *
 * `get` returns an object rather than true, because `astcHDRSupported` calls
 * `.getSupportedProfiles()` on whatever comes back - so a fake handing out
 * booleans would throw where the real one works.
 *
 * @param {string[]} supported
 * @param {string[]} [profiles] what ASTC reports, when ASTC is supported
 */
function rendererWith(supported, profiles = ['ldr'])
{
	const get = (name) =>
	{
		if (!supported.includes(name)) { return null; }
		return name === ASTC ? {getSupportedProfiles: () => profiles} : {};
	};
	return {extensions: {has: (name) => get(name) !== null && get(name) !== undefined, get}};
}

/** Install a `document` whose canvas hands back `gl`. Returns the undo. */
function withCanvas(gl, {throws = false} = {})
{
	const previous = globalThis.document;
	let created = 0;
	globalThis.document = /** @type {any} */ ({
		createElement: () =>
		{
			created++;
			return {
				width: 0,
				height: 0,
				getContext: () => { if (throws) { throw new Error('context refused'); } return gl; },
			};
		},
	});
	return {
		restore: () => { if (previous === undefined) { delete globalThis.document; } else { globalThis.document = previous; } },
		createdCount: () => created,
	};
}

/** A raw WebGL context exposing `getExtension` over a name list. */
function contextWith(supported, {lose = null, profiles = ['ldr']} = {})
{
	return {
		getExtension: (name) =>
		{
			if (name === 'WEBGL_lose_context') { return lose; }
			if (!supported.includes(name)) { return null; }
			return name === ASTC ? {getSupportedProfiles: () => profiles} : {};
		},
	};
}

const ALL = [
	ASTC, 'WEBGL_compressed_texture_etc1', 'WEBGL_compressed_texture_etc',
	'WEBGL_compressed_texture_s3tc', 'EXT_texture_compression_bptc',
	'WEBGL_compressed_texture_pvrtc',
];

afterEach(() => { resetFormatSupport(); });

describe('reading a real renderer (RM-006)', () =>
{
	it('records the seven flags from what the renderer reports', () =>
	{
		describeFrom(rendererWith(ALL, ['ldr', 'hdr']));
		expect(formatSupport()).toEqual({
			astcSupported: true,
			astcHDRSupported: true,
			etc1Supported: true,
			etc2Supported: true,
			dxtSupported: true,
			bptcSupported: true,
			pvrtcSupported: true,
		});
	});

	it('reports every format false when the renderer has none of them', () =>
	{
		describeFrom(rendererWith([]));
		const found = formatSupport();
		expect(Object.values(found).every((flag) => flag === false)).toBe(true);
		// Not null. "This device supports nothing" is an ANSWER, and the module's
		// contract distinguishes it from "there is no answer" - a caller may load a
		// KTX2 either way, it just transcodes to RGBA8 and saves no memory.
		expect(found).not.toBeNull();
		expect(hasCompressedTextures()).toBe(false);
	});

	it('separates ASTC from ASTC-HDR by the profile list, not by the extension', () =>
	{
		describeFrom(rendererWith([ASTC], ['ldr']));
		expect(formatSupport()).toMatchObject({astcSupported: true, astcHDRSupported: false});
	});

	it('accepts the WebKit-prefixed PVRTC name', () =>
	{
		// Two names for one capability, and only the prefixed one on some Safari
		// builds. Reading the first and stopping would report no PVRTC on hardware
		// that has it.
		describeFrom(rendererWith(['WEBKIT_WEBGL_compressed_texture_pvrtc']));
		expect(formatSupport()).toMatchObject({pvrtcSupported: true});
	});

	it('the first answer wins, so two viewports cannot disagree', () =>
	{
		describeFrom(rendererWith(ALL));
		describeFrom(rendererWith([]));
		expect(formatSupport()).toMatchObject({dxtSupported: true});
	});

	it('ignores a renderer that cannot be asked', () =>
	{
		describeFrom(/** @type {any} */ (null));
		describeFrom(/** @type {any} */ ({}));
		// Nothing recorded, so the next call still probes - and in node there is no
		// document, so the honest answer is null rather than a half-filled record.
		expect(formatSupport()).toBeNull();
	});
});

describe('the Mesa workaround, which is a lie detector (RM-006)', () =>
{
	/**
	 * Replace `navigator` for one case.
	 *
	 * `vi.stubGlobal` rather than assignment: in Node `globalThis.navigator` is an
	 * accessor with no setter, so writing to it throws rather than shadowing it.
	 * Node's own userAgent is "Node.js/<major>" on every platform, which contains
	 * neither Linux nor Android - so the cases that do NOT stub are unaffected by
	 * the OS the suite runs on, and this file behaves the same on a Linux runner.
	 *
	 * @param {string} userAgent
	 */
	function withUserAgent(userAgent, run)
	{
		vi.stubGlobal('navigator', {userAgent});
		try { run(); }
		finally { vi.unstubAllGlobals(); }
	}

	it('strips ETC and ASTC on desktop Linux advertising all four', () =>
	{
		// Mesa claims ETC1, ETC2 and ASTC on hardware with none of them and then
		// decompresses in software on the main thread. Believing it is a frame-rate
		// bug, not a correctness one, which is why it needs a test rather than a
		// crash to be noticed.
		withUserAgent('Mozilla/5.0 (X11; Linux x86_64)', () =>
		{
			describeFrom(rendererWith(ALL));
			expect(formatSupport()).toMatchObject({
				astcSupported: false, etc1Supported: false, etc2Supported: false,
				// The two it does not lie about are left alone.
				dxtSupported: true, bptcSupported: true,
			});
		});
	});

	it('leaves Android alone, where the same formats are real', () =>
	{
		withUserAgent('Mozilla/5.0 (Linux; Android 14)', () =>
		{
			describeFrom(rendererWith(ALL));
			expect(formatSupport()).toMatchObject({astcSupported: true, etc2Supported: true});
		});
	});

	it('leaves a Linux device that reports only some of the four alone', () =>
	{
		// The workaround keys on all four together, because that combination is
		// what Mesa produces. A device reporting ASTC and ETC2 but no BPTC is
		// telling the truth as far as anyone knows.
		withUserAgent('Mozilla/5.0 (X11; Linux x86_64)', () =>
		{
			describeFrom(rendererWith([ASTC, 'WEBGL_compressed_texture_etc']));
			expect(formatSupport()).toMatchObject({astcSupported: true, etc2Supported: true});
		});
	});

	it('does not consult a navigator that is not there', () =>
	{
		// A worker, or an embedder that deleted it. The guard is a `typeof` check
		// for exactly this, and without it the workaround throws instead of being
		// skipped.
		vi.stubGlobal('navigator', undefined);
		try
		{
			describeFrom(rendererWith(ALL));
			expect(formatSupport()).toMatchObject({astcSupported: true});
		}
		finally { vi.unstubAllGlobals(); }
	});

	it('does not consult a navigator whose userAgent is not a string', () =>
	{
		vi.stubGlobal('navigator', {});
		try
		{
			describeFrom(rendererWith(ALL));
			expect(formatSupport()).toMatchObject({astcSupported: true});
		}
		finally { vi.unstubAllGlobals(); }
	});
});

describe('probing when nobody offered a renderer (RM-006)', () =>
{
	it('returns null where there is no document at all', () =>
	{
		// Node, which is this suite. The module must not assume a DOM to decide it
		// has no DOM.
		expect(globalThis.document).toBeUndefined();
		expect(formatSupport()).toBeNull();
		expect(hasCompressedTextures()).toBe(false);
	});

	it('returns null when getContext throws rather than returning null', () =>
	{
		const canvas = withCanvas(null, {throws: true});
		try { expect(formatSupport()).toBeNull(); }
		finally { canvas.restore(); }
	});

	it('returns null when there is no context', () =>
	{
		const canvas = withCanvas(null);
		try { expect(formatSupport()).toBeNull(); }
		finally { canvas.restore(); }
	});

	it('returns null for a truthy context with no getExtension', () =>
	{
		// jsdom hands back a stub for getContext('webgl') that has none of the
		// methods on it. Checking the object rather than the method is how this
		// first shipped, and it took down every headless test that builds a Scene -
		// so the check is for the method about to be called.
		const canvas = withCanvas(/** @type {any} */ ({}));
		try { expect(formatSupport()).toBeNull(); }
		finally { canvas.restore(); }
	});

	it('reads the formats from a probed context and releases it', () =>
	{
		let lost = 0;
		const canvas = withCanvas(contextWith(ALL, {lose: {loseContext: () => { lost++; }}}));
		try
		{
			expect(formatSupport()).toMatchObject({dxtSupported: true, etc2Supported: true});
			// Released explicitly: a browser keeps a small number of contexts and
			// silently drops the OLDEST when the limit is hit, so leaking this one
			// could cost the application its actual viewport.
			expect(lost, 'the probe context was not released').toBe(1);
		}
		finally { canvas.restore(); }
	});

	it('survives a context that cannot report WEBGL_lose_context', () =>
	{
		const canvas = withCanvas(contextWith(ALL, {lose: null}));
		try { expect(formatSupport()).toMatchObject({bptcSupported: true}); }
		finally { canvas.restore(); }
	});

	it('probes once and caches, so two callers cost one context', () =>
	{
		const canvas = withCanvas(contextWith(['WEBGL_compressed_texture_s3tc']));
		try
		{
			formatSupport();
			formatSupport();
			hasCompressedTextures();
			expect(canvas.createdCount()).toBe(1);
		}
		finally { canvas.restore(); }
	});
});

describe('hasCompressedTextures reports each format on its own (RM-006)', () =>
{
	const CASES = [
		[ASTC, 'astc'],
		['WEBGL_compressed_texture_etc1', 'etc1'],
		['WEBGL_compressed_texture_etc', 'etc2'],
		['WEBGL_compressed_texture_s3tc', 'dxt'],
		['EXT_texture_compression_bptc', 'bptc'],
		['WEBGL_compressed_texture_pvrtc', 'pvrtc'],
	];

	// One format is enough. Written as a loop over each because the function is a
	// six-term `||` chain, and a chain is exactly where a typo hides - reordering
	// it or dropping a term would still pass a test that only ever sets DXT.
	for (const [extension, label] of CASES)
	{
		it(`reports true for ${label} alone`, () =>
		{
			describeFrom(rendererWith([extension]));
			expect(hasCompressedTextures()).toBe(true);
		});
	}
});
