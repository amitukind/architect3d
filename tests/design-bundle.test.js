// @vitest-environment jsdom
/**
 * The zip container, and what a bundle carries (RM-013 K2).
 *
 * Two claims worth proving separately. That the container is a real zip - which
 * is checked against the format's own bytes here and against Node's `unzip`
 * nowhere, because there is no unzip in Node's standard library; the browser
 * tier round-trips it through the same reader, and the signatures below are
 * what make a third-party tool's agreement predictable rather than hoped for.
 * And that a bundle carries what the recipient will not have, which is the
 * whole finding: the largest sample this build ships names 20 files and every
 * one of them is already in the app that would open it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {deflateRawSync, inflateRawSync} from 'node:zlib';

import {writeZip, readZip, crc32} from '../src/app/share/zip.js';
import {
	buildBundle, readBundle, assetsIn, DESIGN_ENTRY, MANIFEST_ENTRY, ASSET_PREFIX, BUNDLE_VERSION,
} from '../src/app/share/design_bundle.js';

const DESIGN = JSON.stringify({
	floorplan: {
		corners: {a: {x: 0, y: 0}}, rooms: {},
		walls: [
			{corner1: 'a', corner2: 'a', frontTexture: {url: 'rooms/textures/wallmap.png'},
				backTexture: {url: 'rooms/textures/wallmap.png'}},
		],
		newFloorTextures: {'a,b': {url: 'rooms/textures/hardwood.png'}},
		carbonSheet: {url: ''},
	},
	items: [
		{id: 'i-0', model_url: 'models/gltf/chair.glb'},
		{id: 'i-1', model_url: 'models/gltf/desk.glb'},
		{id: 'i-2', model_url: 'models/gltf/chair.glb'},
	],
	levels: [{name: 'Ground'}, {name: 'First', floorplan: {walls: []}, items: [{model_url: 'imported/mine.glb'}]}],
});

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

const bytes = (text) => new TextEncoder().encode(text);

beforeEach(() => {installStreams();});
afterEach(() =>
{
	delete globalThis.CompressionStream;
	delete globalThis.DecompressionStream;
});

describe('the container', () =>
{
	it('round-trips several entries', async () =>
	{
		const zip = await writeZip([
			{name: 'a.txt', bytes: bytes('hello '.repeat(200))},
			{name: 'nested/b.bin', bytes: new Uint8Array([0, 1, 2, 253, 254, 255])},
			{name: 'empty.txt', bytes: new Uint8Array(0)},
		]);

		const back = await readZip(zip);

		expect([...back.keys()]).toEqual(['a.txt', 'nested/b.bin', 'empty.txt']);
		expect(new TextDecoder().decode(back.get('a.txt'))).toBe('hello '.repeat(200));
		expect([...back.get('nested/b.bin')]).toEqual([0, 1, 2, 253, 254, 255]);
		expect(back.get('empty.txt').length).toBe(0);
	});

	it('writes the signatures a zip tool looks for', async () =>
	{
		const zip = await writeZip([{name: 'a.txt', bytes: bytes('x')}]);
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

		// Local file header, first four bytes, and the end record's own signature
		// at the tail. Everything between is found by following those two.
		expect(view.getUint32(0, true)).toBe(0x04034b50);
		expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
		// One entry, in one central directory, on one disk.
		expect(view.getUint16(zip.length - 12, true)).toBe(1);
		// UTF-8 flagged, so a name with an accent is not mojibake elsewhere.
		expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
	});

	it('stores rather than deflates when deflating would be bigger', async () =>
	{
		// Incompressible: this is what a Draco model and a PNG both look like, and
		// storing them is what stops a bundle exceeding the files inside it. The
		// harness's own LCG, so the bytes are high-entropy and the same every run
		// - the first attempt used `(i * k) % 251`, which is an arithmetic
		// sequence and deflated to a third of its size.
		let seed = 1;
		const noise = new Uint8Array(2048).map(() =>
		{
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed >>> 24;
		});

		const zip = await writeZip([{name: 'n.bin', bytes: noise}]);
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

		expect(view.getUint16(8, true)).toBe(0);
		expect([...(await readZip(zip)).get('n.bin')]).toEqual([...noise]);
	});

	it('checksums each entry the way the format says', async () =>
	{
		const zip = await writeZip([{name: 'a.txt', bytes: bytes('123456789')}]);
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

		// The check value every CRC-32 implementation agrees on for "123456789".
		expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
		expect(view.getUint32(14, true)).toBe(0xcbf43926);
	});

	it('is the same bytes twice, because nothing in it is a clock', async () =>
	{
		const once = await writeZip([{name: 'a.txt', bytes: bytes('x')}]);
		const twice = await writeZip([{name: 'a.txt', bytes: bytes('x')}]);

		expect([...once]).toEqual([...twice]);
	});

	it('refuses something that is not a zip', async () =>
	{
		await expect(readZip(bytes('not a zip at all'))).rejects.toThrow(/not a zip/);
	});
});

describe('what a design names', () =>
{
	it('collects models and textures across every storey, deduplicated', () =>
	{
		expect(assetsIn(DESIGN)).toEqual([
			'imported/mine.glb',
			'models/gltf/chair.glb',
			'models/gltf/desk.glb',
			'rooms/textures/hardwood.png',
			'rooms/textures/wallmap.png',
		]);
	});

	it('is empty rather than an exception for something that is not a design', () =>
	{
		expect(assetsIn('{not json')).toEqual([]);
	});
});

describe('a bundle carries what the recipient will not have', () =>
{
	/**
	 * The finding, as an assertion. Every asset the largest shipped sample names
	 * is already in the app that would open it, so a bundle of it carries the
	 * design and nothing else.
	 */
	it('carries nothing at all when the recipient has everything', async () =>
	{
		const built = await buildBundle(DESIGN, {
			has: () => true,
			fetchAsset: async () => {throw new Error('should not be fetched');},
			name: 'Kitchen',
		});

		expect(built.manifest.carried).toEqual([]);
		expect(built.manifest.expected).toHaveLength(5);
		const back = await readZip(built.bytes);
		expect([...back.keys()]).toEqual([DESIGN_ENTRY, MANIFEST_ENTRY]);
	});

	/**
	 * And the same rule picks up an imported model without being changed, which
	 * is what "shared with J3" has to mean to be worth anything.
	 */
	it('carries exactly what the recipient lacks', async () =>
	{
		const built = await buildBundle(DESIGN, {
			has: (url) => !url.startsWith('imported/'),
			fetchAsset: async () => new Uint8Array([1, 2, 3, 4]),
		});

		expect(built.manifest.carried).toEqual(['imported/mine.glb']);
		expect(built.manifest.expected).toHaveLength(4);
		const back = await readZip(built.bytes);
		expect([...back.get(`${ASSET_PREFIX}imported/mine.glb`)]).toEqual([1, 2, 3, 4]);
	});

	it('records an asset it could not get rather than failing the bundle', async () =>
	{
		const built = await buildBundle(DESIGN, {
			has: (url) => !url.startsWith('imported/'),
			fetchAsset: async () => null,
		});

		expect(built.manifest.missing).toEqual(['imported/mine.glb']);
		expect(built.manifest.carried).toEqual([]);
		// A design that loses one file should not lose the other nineteen.
		expect((await readBundle(built.bytes)).design).toBe(DESIGN);
	});
});

describe('reading one', () =>
{
	it('gives back the design byte for byte', async () =>
	{
		const built = await buildBundle(DESIGN, {has: () => true, fetchAsset: async () => null});

		const read = await readBundle(built.bytes);

		expect(read.ok).toBe(true);
		expect(read.design).toBe(DESIGN);
		expect(read.manifest.format).toBe('architect3d-bundle');
		expect(read.manifest.version).toBe(BUNDLE_VERSION);
	});

	it('names what it carried rather than dropping it', async () =>
	{
		const built = await buildBundle(DESIGN, {
			has: (url) => !url.startsWith('imported/'),
			fetchAsset: async () => new Uint8Array([9]),
		});

		const read = await readBundle(built.bytes);

		// Named, not loaded: there is nowhere to put an imported model until J3
		// builds one, and silence would hand somebody a design with holes in it.
		expect(read.carried).toEqual(['imported/mine.glb']);
	});

	it('refuses a bundle from a newer build, and says which', async () =>
	{
		const zip = await writeZip([
			{name: DESIGN_ENTRY, bytes: bytes(DESIGN)},
			{name: MANIFEST_ENTRY, bytes: bytes(JSON.stringify({version: BUNDLE_VERSION + 1}))},
		]);

		const read = await readBundle(zip);

		expect(read.ok).toBe(false);
		expect(read.reason).toContain('newer version');
	});

	it('refuses an archive with no design in it', async () =>
	{
		const zip = await writeZip([{name: 'notes.txt', bytes: bytes('hello')}]);

		expect((await readBundle(zip)).reason).toContain(DESIGN_ENTRY);
	});

	it('refuses something that is not an archive, as a result rather than a throw', async () =>
	{
		const read = await readBundle(bytes('this is a text file'));

		expect(read.ok).toBe(false);
		expect(read.reason).toContain('not a zip');
	});

	it('reads a bundle that carries no manifest at all', async () =>
	{
		const zip = await writeZip([{name: DESIGN_ENTRY, bytes: bytes(DESIGN)}]);

		const read = await readBundle(zip);

		expect(read.ok).toBe(true);
		expect(read.manifest).toBeNull();
	});
});
