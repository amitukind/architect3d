/**
 * Generate the colour-space test checker.
 *
 *   node tools/make-checker.mjs      (writes tools/parity-checker.png)
 *
 * Sprint S8. The exit gate asks that no texture render in the wrong colour
 * space, "checker fixture on every surface type" - so this is that fixture, and
 * the parity page paints it onto every wall, floor and the ground.
 *
 * ## Why these particular colours
 *
 * Getting a colour space wrong is invisible on black and white: 0 and 1 are the
 * two fixed points of the sRGB transfer function, so they come out the same
 * whichever way the texture is decoded. Every diagnostic value is in between.
 *
 * The pair that does the work is #808080 and #bcbcbc:
 *
 *   sRGB byte   decoded as sRGB   decoded as linear
 *   --------------------------------------------------
 *   0x80 (128)  0.216             0.502
 *   0xbc (188)  0.502             0.737
 *
 * So with the decode correct, #bcbcbc is the patch that reads as half
 * brightness and #808080 is visibly darker than half. Get it wrong - tag the
 * texture linear when it is sRGB - and the two swap roles: #808080 becomes the
 * half-brightness patch. That is a difference anyone can see in the grid
 * without a colour picker, which is the point of a visual gate.
 *
 * The three primaries in the corners are there for a different failure: they
 * stay at full saturation under either decode, so if they shift hue the problem
 * is not the transfer function but the working space or a channel swap.
 *
 * Written by hand rather than pulled from a package because a PNG encoder for
 * one opaque 8-bit RGB image is about forty lines, and this repository has
 * spent the whole migration removing dependencies rather than adding them.
 */
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, 'parity-checker.png');

const SIZE = 512;
const CELLS = 8;
const CELL = SIZE / CELLS;

const GREY = [0x80, 0x80, 0x80];
const HALF = [0xbc, 0xbc, 0xbc];
const RED = [0xd0, 0x20, 0x20];
const GREEN = [0x20, 0xd0, 0x20];
const BLUE = [0x20, 0x20, 0xd0];

/**
 * @param {number} cx Cell column.
 * @param {number} cy Cell row.
 * @returns {Array<number>} rgb
 */
function cellColor(cx, cy)
{
	// Corners carry the primaries; the fourth corner stays HALF so the two
	// diagnostic greys always appear adjacent to something.
	if (cx === 0 && cy === 0) { return RED; }
	if (cx === CELLS - 1 && cy === 0) { return GREEN; }
	if (cx === 0 && cy === CELLS - 1) { return BLUE; }
	return ((cx + cy) % 2 === 0) ? GREY : HALF;
}

/** Raw scanlines, each prefixed with PNG filter type 0 (none). */
function rasterize()
{
	const stride = SIZE * 3;
	const raw = Buffer.alloc(SIZE * (stride + 1));
	for (let y = 0; y < SIZE; y++)
	{
		const row = y * (stride + 1);
		raw[row] = 0;
		for (let x = 0; x < SIZE; x++)
		{
			const [r, g, b] = cellColor(Math.floor(x / CELL), Math.floor(y / CELL));
			const at = row + 1 + x * 3;
			raw[at] = r;
			raw[at + 1] = g;
			raw[at + 2] = b;
		}
	}
	return raw;
}

/** CRC-32, the flavour PNG chunks carry. */
const CRC_TABLE = (() =>
{
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++)
	{
		let c = n;
		for (let k = 0; k < 8; k++)
		{
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer)
{
	let c = 0xffffffff;
	for (const byte of buffer)
	{
		c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data)
{
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // colour type 2: truecolour RGB
ihdr[10] = 0;  // deflate
ihdr[11] = 0;  // adaptive filtering
ihdr[12] = 0;  // no interlace

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	// No sRGB or gAMA chunk on purpose. Browsers and three both treat an
	// untagged PNG as sRGB, which is what every other texture in this app is,
	// so the fixture goes through exactly the same path they do.
	chunk('IDAT', deflateSync(rasterize(), {level: 9})),
	chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(OUTPUT, png);
console.log(`wrote ${OUTPUT} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`);
