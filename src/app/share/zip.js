// @ts-check

/**
 * A zip container, written and read by hand (RM-013 K2).
 *
 * ## Why by hand
 *
 * Because the compression is already here. `CompressionStream('deflate-raw')`
 * is exactly the bytes a zip entry stores - method 8 is a raw deflate stream,
 * with no zlib header, which is what `deflate-raw` means - so a zip library
 * would be brought in for the *container*, and the container is two structs and
 * a checksum. The project's own rule about dependencies is the one RM-011 H1
 * applied to a Basis transcoder: a payload has to earn its place.
 *
 * What this writes is the plain, universal shape: one local header per entry,
 * a central directory, an end-of-central-directory record. No zip64, no
 * encryption, no data descriptors, no multi-disk. A file written here opens in
 * Finder, in Explorer, in `unzip` and in every language's standard library, and
 * a file written by any of those opens here.
 *
 * ## The limits, stated rather than discovered
 *
 * - **No zip64.** Entries and archives are capped at 4 GiB by the 32-bit fields
 *   in the format, and a design bundle that approached that would be a problem
 *   long before the container was.
 * - **UTF-8 names, flagged.** Bit 11 of the general-purpose flags says so, which
 *   is what stops a name with an accent in it arriving as mojibake.
 * - **No timestamps.** Every entry is written at the DOS epoch. A bundle is
 *   defined by its contents, and a clock in it would mean two identical bundles
 *   differing - which makes them impossible to compare in a test and impossible
 *   to deduplicate anywhere else.
 */

/** Signatures, little-endian, as the specification names them. */
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Stored, and deflated. The only two methods anything needs. */
const STORE = 0;
const DEFLATE = 8;

/** Bit 11: the name and comment are UTF-8. */
const UTF8_FLAG = 0x0800;

/** @type {?Int32Array} */
var crcTable = null;

/**
 * CRC-32, the checksum every zip entry carries.
 *
 * Built once and kept, because a bundle of twenty files would otherwise build
 * the table twenty times. The polynomial is the reflected 0xEDB88320 that zip,
 * gzip and PNG all use.
 *
 * @param {Uint8Array} bytes
 * @returns {number} Unsigned.
 */
export function crc32(bytes)
{
	if (!crcTable)
	{
		crcTable = new Int32Array(256);
		for (var n = 0; n < 256; n++)
		{
			var c = n;
			for (var k = 0; k < 8; k++)
			{
				c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
			}
			crcTable[n] = c;
		}
	}
	var crc = -1;
	for (var i = 0; i < bytes.length; i++)
	{
		crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
	}
	return (crc ^ -1) >>> 0;
}

/** A little-endian writer over a growing array. */
class Bytes
{
	constructor()
	{
		/** @type {Array<number>} */
		this.parts = [];
		this.length = 0;
	}

	/** @param {Uint8Array} chunk */
	push(chunk)
	{
		this.parts.push(/** @type {*} */ (chunk));
		this.length += chunk.length;
	}

	/** @param {number} value */
	u16(value)
	{
		this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
	}

	/** @param {number} value */
	u32(value)
	{
		this.push(new Uint8Array([
			value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]));
	}

	/** @returns {Uint8Array<ArrayBuffer>} */
	join()
	{
		var out = new Uint8Array(this.length);
		var at = 0;
		for (var i = 0; i < this.parts.length; i++)
		{
			out.set(/** @type {*} */ (this.parts[i]), at);
			at += /** @type {*} */ (this.parts[i]).length;
		}
		return out;
	}
}

/** @param {DataView} view @param {number} at */
function u16At(view, at) {return view.getUint16(at, true);}
/** @param {DataView} view @param {number} at */
function u32At(view, at) {return view.getUint32(at, true);}

/**
 * Deflate, or say that it did not help.
 *
 * An entry is stored rather than deflated when deflating made it bigger, which
 * is the ordinary outcome for a `.glb` that is already Draco-compressed and a
 * `.png` that is already deflated. Zip has a method for that and using it is
 * not an optimisation - it is what stops a bundle of compressed assets being
 * larger than the files it contains.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<{method: number, body: Uint8Array}>}
 */
async function pack(bytes)
{
	if (typeof CompressionStream !== 'function' || !bytes.length)
	{
		return {method: STORE, body: bytes};
	}
	var stream = new CompressionStream('deflate-raw');
	var done = new Response(stream.readable).arrayBuffer().then((buffer) => buffer, () => null);
	var writer = stream.writable.getWriter();
	try
	{
		await writer.write(bytes);
		await writer.close();
	}
	catch
	{
		// Reported by the read below, so one failure is reported once.
	}
	var packed = await done;
	if (!packed || packed.byteLength >= bytes.length)
	{
		return {method: STORE, body: bytes};
	}
	return {method: DEFLATE, body: new Uint8Array(packed)};
}

/**
 * @param {number} method
 * @param {Uint8Array<ArrayBuffer>} body
 * @returns {Promise<Uint8Array>}
 */
async function unpack(method, body)
{
	if (method === STORE)
	{
		return body;
	}
	if (method !== DEFLATE || typeof DecompressionStream !== 'function')
	{
		throw new Error(`architect3d: zip entry uses compression method ${method}, which this build cannot read`);
	}
	var stream = new DecompressionStream('deflate-raw');
	var done = new Response(stream.readable).arrayBuffer().then((buffer) => buffer, () => null);
	var writer = stream.writable.getWriter();
	try
	{
		await writer.write(body);
		await writer.close();
	}
	catch
	{
		// Reported below.
	}
	var out = await done;
	if (!out)
	{
		throw new Error('architect3d: a zip entry would not inflate');
	}
	return new Uint8Array(out);
}

/**
 * Write a zip.
 *
 * @param {Array<{name: string, bytes: Uint8Array<ArrayBuffer>}>} entries
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
export async function writeZip(entries)
{
	var local = new Bytes();
	var central = new Bytes();
	var count = 0;

	for (var i = 0; i < entries.length; i++)
	{
		var name = new TextEncoder().encode(entries[i].name);
		var raw = entries[i].bytes;
		var packed = await pack(raw);
		var offset = local.length;
		var sum = crc32(raw);

		local.u32(LOCAL);
		local.u16(20);            // version needed: 2.0, which is deflate
		local.u16(UTF8_FLAG);
		local.u16(packed.method);
		local.u16(0);             // time, at the DOS epoch - see the note above
		local.u16(0);             // date
		local.u32(sum);
		local.u32(packed.body.length);
		local.u32(raw.length);
		local.u16(name.length);
		local.u16(0);             // no extra field
		local.push(name);
		local.push(packed.body);

		central.u32(CENTRAL);
		central.u16(20);          // version made by
		central.u16(20);          // version needed
		central.u16(UTF8_FLAG);
		central.u16(packed.method);
		central.u16(0);
		central.u16(0);
		central.u32(sum);
		central.u32(packed.body.length);
		central.u32(raw.length);
		central.u16(name.length);
		central.u16(0);           // extra
		central.u16(0);           // comment
		central.u16(0);           // disk
		central.u16(0);           // internal attributes
		central.u32(0);           // external attributes
		central.u32(offset);
		central.push(name);
		count += 1;
	}

	var out = new Bytes();
	out.push(local.join());
	var directoryAt = out.length;
	out.push(central.join());
	out.u32(END);
	out.u16(0);                   // this disk
	out.u16(0);                   // the disk the directory starts on
	out.u16(count);
	out.u16(count);
	out.u32(central.length);
	out.u32(directoryAt);
	out.u16(0);                   // no archive comment
	return out.join();
}

/**
 * Read a zip.
 *
 * Through the central directory rather than by walking local headers, which is
 * the specification's own answer to why the directory exists: a local header
 * may declare zeroes and defer the real sizes to a data descriptor after the
 * data, and the only place the truth is always written is the directory.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZip(bytes)
{
	var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	var end = -1;
	// Scan back for the end record. It is 22 bytes plus a comment of up to
	// 65,535, so that is how far back it can possibly be.
	for (var at = bytes.length - 22; at >= 0 && at >= bytes.length - 22 - 65535; at--)
	{
		if (u32At(view, at) === END)
		{
			end = at;
			break;
		}
	}
	if (end < 0)
	{
		throw new Error('architect3d: that file is not a zip archive');
	}

	var count = u16At(view, end + 10);
	var directoryAt = u32At(view, end + 16);
	/** @type {Map<string, Uint8Array>} */
	var found = new Map();
	var cursor = directoryAt;

	for (var i = 0; i < count; i++)
	{
		if (u32At(view, cursor) !== CENTRAL)
		{
			throw new Error('architect3d: that zip archive is damaged');
		}
		var method = u16At(view, cursor + 10);
		var compressedSize = u32At(view, cursor + 20);
		var nameLength = u16At(view, cursor + 28);
		var extraLength = u16At(view, cursor + 30);
		var commentLength = u16At(view, cursor + 32);
		var localAt = u32At(view, cursor + 42);
		var name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

		var localNameLength = u16At(view, localAt + 26);
		var localExtraLength = u16At(view, localAt + 28);
		var dataAt = localAt + 30 + localNameLength + localExtraLength;
		found.set(name, await unpack(method, bytes.subarray(dataAt, dataAt + compressedSize)));

		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return found;
}
