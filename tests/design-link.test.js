// @vitest-environment jsdom
/**
 * A design in a link (RM-013 K2, finding Y-7).
 *
 * The codec's arithmetic runs here; `tests/browser/share-link.test.js` runs the
 * same round trip against Chromium's own `CompressionStream`, which is the
 * authority on the bytes. jsdom has neither compression stream, so this file
 * installs Node's - the platform being faked is a compressor, not the subject.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {deflateRawSync, inflateRawSync} from 'node:zlib';

import {
	encodeDesign, decodeDesign, payloadFromHash, linkFor, linksAvailable,
	toBase64Url, fromBase64Url, LINK_VERSION, LINK_KEY, MAX_LINK_CHARS,
} from '../src/app/share/design_link.js';

const DESIGN = JSON.stringify({
	floorplan: {corners: {a: {x: 0, y: 0}}, walls: [], rooms: {}, units: 'cm', version: '2.0.0'},
	items: [],
});

/**
 * Node's deflate behind the browser's interface.
 *
 * A `TransformStream` rather than a stub with the right method names: the codec
 * pipes through it and reads the result back with `Response`, so anything that
 * is not really a stream would prove only that the fake was called.
 */
function installStreams()
{
	const make = (transform) => class
	{
		constructor()
		{
			const chunks = [];
			const stream = new TransformStream({
				transform(chunk) {chunks.push(Buffer.from(chunk));},
				flush(controller) {controller.enqueue(new Uint8Array(transform(Buffer.concat(chunks))));},
			});
			this.readable = stream.readable;
			this.writable = stream.writable;
		}
	};
	globalThis.CompressionStream = make(deflateRawSync);
	globalThis.DecompressionStream = make(inflateRawSync);
}

function removeStreams()
{
	delete globalThis.CompressionStream;
	delete globalThis.DecompressionStream;
}

beforeEach(() =>
{
	installStreams();
});

afterEach(() =>
{
	removeStreams();
});

describe('the round trip', () =>
{
	it('re-serializes byte-identical', async () =>
	{
		const made = await encodeDesign(DESIGN);

		expect(made.ok).toBe(true);
		expect(made.payload.charAt(0)).toBe(LINK_VERSION);
		expect(made.chars).toBe(made.payload.length);

		const back = await decodeDesign(made.payload);

		expect(back.ok).toBe(true);
		expect(back.design).toBe(DESIGN);
	});

	it('survives a design with everything in it', async () =>
	{
		const heavy = JSON.stringify({
			floorplan: JSON.parse(DESIGN).floorplan,
			items: Array.from({length: 60}, (unused, i) => ({
				id: `i-${i}`, item_name: 'Chair', item_type: 1, format: 'gltf',
				model_url: 'models/gltf/chair.glb', xpos: i, ypos: 20, zpos: i * 3,
				rotation: 0.785398, scale_x: 200, scale_y: 200, scale_z: 200, fixed: false,
			})),
			levels: [{name: 'Ground', height: 250}],
			roof: {kind: 'gable', pitch: 30},
			sun: {latitude: 51.5},
		});

		const made = await encodeDesign(heavy);

		expect((await decodeDesign(made.payload)).design).toBe(heavy);
	});
});

describe('the refusals, which each need a different sentence', () =>
{
	it('refuses a design past the ceiling, and says how big it is', async () =>
	{
		// Random-ish item names, because a design of identical rows compresses to
		// nothing and would never reach the limit however long it was.
		const huge = JSON.stringify({
			floorplan: JSON.parse(DESIGN).floorplan,
			items: Array.from({length: 4000}, (unused, i) => ({
				id: `${i.toString(36)}-${(i * 7919).toString(36)}`,
				item_name: (i * 104729).toString(36),
				model_url: `models/${(i * 15485863).toString(36)}.glb`,
				xpos: i * 1.37, ypos: i * 0.11, zpos: i * 2.9, rotation: i / 1000,
			})),
		});

		const made = await encodeDesign(huge);

		expect(made.ok).toBe(false);
		expect(made.reason).toBe('too-long');
		expect(made.payload).toBeNull();
		// The number is the message: "this is 11,204 characters and links hold
		// 8,000" tells somebody what to do, and "too long" does not.
		expect(made.chars).toBeGreaterThan(MAX_LINK_CHARS);
	});

	it('tells a newer link apart from a broken one', async () =>
	{
		const made = await encodeDesign(DESIGN);

		expect((await decodeDesign(`9${made.payload.slice(1)}`)).reason).toBe('version');
		expect((await decodeDesign('')).reason).toBe('version');
		expect((await decodeDesign(`${LINK_VERSION}not base64!`)).reason).toBe('damaged');
		expect((await decodeDesign(LINK_VERSION)).reason).toBe('damaged');
	});

	it('treats a link broken in transit as damaged, not as a design', async () =>
	{
		const made = await encodeDesign(DESIGN);
		// What an email client does: wraps the line and loses the tail.
		const truncated = made.payload.slice(0, Math.floor(made.payload.length / 2));

		const back = await decodeDesign(truncated);

		expect(back.ok).toBe(false);
		expect(back.design).toBeNull();
	});

	it('refuses something that inflates into anything but a design', async () =>
	{
		const notADesign = await encodeDesign('{"items":[]}');

		expect((await decodeDesign(notADesign.payload)).reason).toBe('damaged');
	});

	it('says so in a browser with no compression at all', async () =>
	{
		removeStreams();

		expect(linksAvailable()).toBe(false);
		expect((await encodeDesign(DESIGN)).reason).toBe('unsupported');
		expect((await decodeDesign('1abc')).reason).toBe('unsupported');
	});
});

describe('base64url, and the fragment it goes in', () =>
{
	it('round-trips bytes without padding or URL-unsafe characters', () =>
	{
		const bytes = new Uint8Array(Array.from({length: 300}, (unused, i) => (i * 37) % 256));

		const text = toBase64Url(bytes);

		expect(text).toMatch(/^[A-Za-z0-9\-_]+$/);
		expect(fromBase64Url(text)).toEqual(bytes);
	});

	it('handles a payload past the argument limit of fromCharCode', () =>
	{
		// 8192 is the chunk size; a design of any size has to survive crossing it,
		// and spreading one array over `fromCharCode` is how a RangeError arrives
		// on exactly the large input that most needs to work.
		const bytes = new Uint8Array(50_000).map((unused, i) => i % 251);

		expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
	});

	it('is null for anything that is not base64url', () =>
	{
		expect(fromBase64Url('not base64!')).toBeNull();
		expect(fromBase64Url('a+b/c=')).toBeNull();
	});

	it('reads the payload out of a fragment, with or without the hash', async () =>
	{
		const made = await encodeDesign(DESIGN);

		expect(payloadFromHash(`#${LINK_KEY}=${made.payload}`)).toBe(made.payload);
		expect(payloadFromHash(`${LINK_KEY}=${made.payload}`)).toBe(made.payload);
		expect(payloadFromHash('')).toBeNull();
		expect(payloadFromHash('#something=else')).toBeNull();
	});

	it('builds a link onto the page it came from, replacing any fragment', () =>
	{
		expect(linkFor('1abc', 'https://example.test/plan/')).toBe('https://example.test/plan/#d=1abc');
		expect(linkFor('1abc', 'https://example.test/plan/?assetBase=x#d=old'))
			.toBe('https://example.test/plan/?assetBase=x#d=1abc');
	});
});
