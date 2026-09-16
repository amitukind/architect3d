/**
 * The zip container, against the browser's own codec (RM-013 K2).
 *
 * The headless tier writes and reads a zip with Node's deflate standing in for
 * `CompressionStream`. What that cannot show is that the container is written
 * with the browser's deflate and read back with the browser's inflate - which
 * is the pairing every recipient will actually use, and the one place a wrong
 * assumption about `deflate-raw` would hide.
 */
import {describe, expect, it} from 'vitest';

import {writeZip, readZip, crc32} from '../../src/app/share/zip.js';
import {buildBundle, readBundle, assetsIn, DESIGN_ENTRY} from '../../src/app/share/design_bundle.js';

const encode = (text) => new TextEncoder().encode(text);

describe('the container, with the browser doing the compressing', () =>
{
	it('round-trips text, binary and empty entries', async () =>
	{
		const zip = await writeZip([
			{name: 'a.txt', bytes: encode('a design'.repeat(400))},
			{name: 'deep/b.bin', bytes: new Uint8Array([0, 127, 128, 255])},
			{name: 'nothing', bytes: new Uint8Array(0)},
		]);

		const back = await readZip(zip);

		expect(new TextDecoder().decode(back.get('a.txt'))).toBe('a design'.repeat(400));
		expect([...back.get('deep/b.bin')]).toEqual([0, 127, 128, 255]);
		expect(back.get('nothing').length).toBe(0);
	});

	it('agrees with every other CRC-32 in the world', () =>
	{
		expect(crc32(encode('123456789'))).toBe(0xcbf43926);
	});

	it('actually compresses something compressible', async () =>
	{
		const text = 'the same sentence over and over. '.repeat(500);

		const zip = await writeZip([{name: 'a.txt', bytes: encode(text)}]);

		// Not an assertion about a ratio - an assertion that deflate ran at all,
		// which the headless tier cannot make about the browser's implementation.
		expect(zip.length).toBeLessThan(text.length / 4);
		expect(new TextDecoder().decode((await readZip(zip)).get('a.txt'))).toBe(text);
	});
});

describe('a bundle of a design this build actually ships', () =>
{
	it('carries nothing, because the recipient has all twenty files', async () =>
	{
		const design = await (await fetch('templates/sample-two-bedroom.blueprint3d')).text();
		const referenced = assetsIn(design);

		const built = await buildBundle(design, {
			has: () => true,
			fetchAsset: async () => null,
			name: 'Two bedroom, furnished',
		});

		// The measurement that set the rule: 19 items naming 20 distinct files,
		// all of them already in the app that would open this.
		expect(referenced.length).toBeGreaterThan(15);
		expect(built.manifest.carried).toEqual([]);
		expect(built.manifest.expected).toEqual(referenced);

		const read = await readBundle(built.bytes);
		expect(read.design).toBe(design);
		expect(read.carried).toEqual([]);
		// A bundle of a catalog design is the document and its manifest, and
		// nothing else - so it is smaller than the assets it describes by three
		// orders of magnitude.
		expect(built.bytes.length).toBeLessThan(6000);
	});

	it('carries a real file when the recipient would not have it', async () =>
	{
		const design = await (await fetch('templates/sample-studio.blueprint3d')).text();
		const first = assetsIn(design)[0];
		const bytes = new Uint8Array(await (await fetch(first)).arrayBuffer());

		const built = await buildBundle(design, {
			has: (url) => url !== first,
			fetchAsset: async (url) => (url === first ? bytes : null),
		});

		expect(built.manifest.carried).toEqual([first]);
		const back = await readZip(built.bytes);
		expect([...back.get(`assets/${first}`)]).toEqual([...bytes]);
		expect(back.has(DESIGN_ENTRY)).toBe(true);
	});
});
