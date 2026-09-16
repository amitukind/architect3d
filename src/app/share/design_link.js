// @ts-check

/**
 * A design in a link (RM-013 K2, finding Y-7).
 *
 * ## No server, no shortener, no library, and each of those was measured
 *
 * Y-7 compressed four real designs before this file existed: a 120-item house
 * gzips and base64urls into **3,086 characters**, and the largest document this
 * build actually ships - the furnished two-bedroom sample, 10,895 bytes - into
 * **2,346**. A design is repetitive JSON with long stable key names and UUID
 * corners, so it compresses to about 7 % of itself. There is nothing here that
 * needs a backend, and nothing that needs a dependency: `CompressionStream` is
 * in every browser this project targets, and K2's delivery pass confirmed that
 * Chromium's `gzip` output is **byte-identical** to Node's at level 9.
 *
 * ## `deflate-raw` rather than `gzip`, measured
 *
 * The same sample: `gzip` 1,759 bytes, `deflate-raw` **1,741**. The 18 bytes
 * are gzip's 10-byte header and its 8-byte CRC-and-length trailer, and neither
 * earns its place in a fragment. The header names a compression method the
 * reader already knows; the CRC would catch a truncated link, and so does every
 * step after it - base64 decoding, inflating and `JSON.parse` all fail loudly
 * on a link somebody broke across two lines in an email. Paying 24 characters
 * for a second opinion is not a trade worth making.
 *
 * ## The fragment, not the query
 *
 * `#` rather than `?`, and it is the whole reason this is private: **a fragment
 * is never sent to a server.** A design in the query string would be in the
 * access log of whatever is hosting the build, and in the referrer of every
 * outbound link from the page. RM-007's objective for this programme is
 * *"none of it behind a login, because there is no login"*, and putting
 * somebody's floor plan in a log to achieve that would be the wrong kind of
 * serverless.
 *
 * It also settles the length question. The delivery pass drove
 * `history.replaceState` at 2,000, 8,000, 32,000, 100,000, 500,000 and
 * **2,000,000** characters in Chromium and every one was kept in full, so the
 * browser is not the constraint and {@link MAX_LINK_CHARS} is a policy rather
 * than a ceiling. See its own note for what the policy is protecting.
 */

/**
 * The format marker, first character of the payload.
 *
 * One character, because a reader that meets a payload it does not understand
 * must say so rather than inflate garbage and blame the design. `1` is
 * deflate-raw then base64url; a future format is `2` and this build refuses it
 * by name, which is the rule `draft_repository` applies to a store written by a
 * newer build.
 */
export const LINK_VERSION = '1';

/** The fragment key. Short, because every character is one somebody pastes. */
export const LINK_KEY = 'd';

/**
 * How long a link this application will make.
 *
 * **Not a technical limit.** Chromium kept a two-million-character fragment
 * without truncating it, and a fragment never reaches a server, so nothing in
 * the transport says no. The number is a judgement about what survives being
 * *carried*, and it is set where three things line up:
 *
 * - Every design this build ships fits several times over. The largest is the
 *   furnished two-bedroom sample at **2,346 characters**, and a synthetic
 *   400-item house measured **7,451**.
 * - 8,192 bytes is the request-line limit nginx and Apache default to. A
 *   fragment never becomes a request line, but the tools that rewrite, shorten,
 *   log and preview links do not all know that.
 * - Past it, the honest advice is a file. A design too big to send as a link is
 *   not a link problem, and `Save layout` has always worked.
 *
 * The refusal says the size, so the ceiling is a signpost and not a wall.
 */
export const MAX_LINK_CHARS = 8000;

/** Whether this browser can make or read a link at all. */
export function linksAvailable()
{
	return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/**
 * Run bytes through a compression stream.
 *
 * @param {ReadableWritablePair} stream
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function through(stream, bytes)
{
	// The read is started before the write, which is not fussiness: a
	// `TransformStream` applies backpressure once its queue is full, so writing
	// first and reading afterwards deadlocks on any input large enough to matter.
	//
	// Written against the pair directly rather than `blob.stream().pipeThrough()`,
	// which is the shorter spelling and needs one more platform API than this
	// does - jsdom, where the headless tier runs, has `Blob` without `.stream`.
	//
	// Both ends are guarded, because a stream that fails rejects BOTH of them and
	// whichever is awaited second becomes an unhandled rejection - which is not
	// hypothetical: feeding `DecompressionStream` a truncated link is the ordinary
	// case here, and it took the test run down before this was written. One
	// failure, raised from one place.
	const done = new Response(stream.readable).arrayBuffer().then(
		(buffer) => buffer, () => null);
	const writer = stream.writable.getWriter();
	try
	{
		await writer.write(bytes);
		await writer.close();
	}
	catch
	{
		// Reported below, off `done`, so the two ends cannot report it twice.
	}
	const buffer = await done;
	if (!buffer)
	{
		throw new Error('architect3d: the compression stream failed');
	}
	return new Uint8Array(buffer);
}

/**
 * Base64url, without the padding a URL does not need.
 *
 * `btoa` over a string built from the bytes, in chunks: `String.fromCharCode`
 * takes its arguments on the stack, and spreading a 200 kB design over it is
 * how a `RangeError` arrives on exactly the large input that most needs to
 * work.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {string}
 */
export function toBase64Url(bytes)
{
	var text = '';
	for (var at = 0; at < bytes.length; at += 8192)
	{
		text += String.fromCharCode.apply(null, /** @type {*} */ (bytes.subarray(at, at + 8192)));
	}
	return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} text
 * @returns {?Uint8Array<ArrayBuffer>} Null for anything that is not base64url.
 */
export function fromBase64Url(text)
{
	if (!/^[A-Za-z0-9\-_]*$/.test(text))
	{
		return null;
	}
	var padded = text.replace(/-/g, '+').replace(/_/g, '/');
	while (padded.length % 4)
	{
		padded += '=';
	}
	try
	{
		var binary = atob(padded);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++)
		{
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
	catch
	{
		return null;
	}
}

/**
 * A design as a fragment payload.
 *
 * @param {string} design A `.blueprint3d` document.
 * @returns {Promise<{ok: boolean, payload: ?string, chars: number, reason: ?string}>}
 *          `chars` is reported even on a refusal, because the number is the
 *          message: "this design is 11,204 characters and links hold 8,000"
 *          tells somebody what to do, and "too long" does not.
 */
export async function encodeDesign(design)
{
	if (!linksAvailable())
	{
		return {ok: false, payload: null, chars: 0, reason: 'unsupported'};
	}
	var packed = await through(new CompressionStream('deflate-raw'), new TextEncoder().encode(design));
	var payload = LINK_VERSION + toBase64Url(packed);
	if (payload.length > MAX_LINK_CHARS)
	{
		return {ok: false, payload: null, chars: payload.length, reason: 'too-long'};
	}
	return {ok: true, payload: payload, chars: payload.length, reason: null};
}

/**
 * A fragment payload back into a design.
 *
 * Every failure is a distinct reason rather than a null, because they call for
 * different sentences: a payload this build does not understand is a newer
 * link, a payload that will not inflate is a link that got broken in transit,
 * and one that inflates into something that is not a design is neither.
 *
 * @param {string} payload
 * @returns {Promise<{ok: boolean, design: ?string, reason: ?string}>}
 */
export async function decodeDesign(payload)
{
	if (!linksAvailable())
	{
		return {ok: false, design: null, reason: 'unsupported'};
	}
	if (!payload || payload.charAt(0) !== LINK_VERSION)
	{
		return {ok: false, design: null, reason: 'version'};
	}
	var bytes = fromBase64Url(payload.slice(1));
	if (!bytes || !bytes.length)
	{
		return {ok: false, design: null, reason: 'damaged'};
	}
	var text;
	try
	{
		var inflated = await through(new DecompressionStream('deflate-raw'), bytes);
		text = new TextDecoder().decode(inflated);
	}
	catch
	{
		return {ok: false, design: null, reason: 'damaged'};
	}
	// The shape check is deliberately shallow: `Model.loadDocument` is what
	// validates a design, field by field, with a path to each problem. All this
	// has to decide is whether the bytes are a document at all, so that a broken
	// link and a bad design produce different sentences.
	try
	{
		var parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== 'object' || !parsed.floorplan)
		{
			return {ok: false, design: null, reason: 'damaged'};
		}
	}
	catch
	{
		return {ok: false, design: null, reason: 'damaged'};
	}
	return {ok: true, design: text, reason: null};
}

/**
 * The payload on a URL, or null.
 *
 * Takes the fragment rather than reading `location`, so the parsing is testable
 * without a browser and so a caller that has a link in a string - a paste box,
 * a test - uses the same code the boot does.
 *
 * @param {string} hash Including or omitting the leading `#`.
 * @returns {?string}
 */
export function payloadFromHash(hash)
{
	var text = String(hash || '').replace(/^#/, '');
	if (!text)
	{
		return null;
	}
	// `URLSearchParams` over a fragment, which is not what it is for and is
	// exactly right here: the fragment is `d=<payload>` and may one day carry a
	// second key beside it. base64url has no `+`, so the space-decoding that
	// makes this wrong for arbitrary fragments cannot bite.
	return new URLSearchParams(text).get(LINK_KEY);
}

/**
 * A whole link to this page, carrying this design.
 *
 * @param {string} payload
 * @param {string} [href] Defaults to the current document's.
 * @returns {string}
 */
export function linkFor(payload, href)
{
	var base = href !== undefined
		? href
		: (typeof window !== 'undefined' ? window.location.href : '');
	var withoutHash = String(base).split('#')[0];
	return `${withoutHash}#${LINK_KEY}=${payload}`;
}
