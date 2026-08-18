// @ts-check

/**
 * What this build's assets are, and where they actually live (RM-003 A5).
 *
 * ## The constraint this works around
 *
 * Finding H-8. Vite copies `public/` to the dist root **as-is** and never
 * hashes those filenames. The obvious fix - content-addressed filenames - is
 * unavailable here and that is the finding, not an oversight: these URLs are
 * serialized *into saved designs*. `model_url` on every item and
 * `newFloorTextures[].url` on every custom floor name a file by path, so
 * renaming one breaks documents that already exist, on disks this project
 * cannot reach.
 *
 * So the indirection has to sit at runtime, between the **logical name** a
 * document records and the **physical URL** the browser fetches. This is the
 * table; {@link module:core/asset_resolver} is what reads it.
 *
 * ## What an entry says
 *
 * - `url` - where the file actually is, if that differs from the logical name.
 *   Absent means they are the same, which is true of every entry today. Making
 *   them differ is the point: give an entry a versioned URL and every saved
 *   design that names it follows, with nothing renamed and no document
 *   rewritten.
 * - `bytes` - what it costs to fetch. This is what lets the catalog prefetch
 *   by size and a budget ask what placing one chair costs.
 * - `hash` - subresource-integrity form, so it can be handed straight to
 *   `fetch(url, {integrity})`. Recorded, not enforced - see the resolver.
 * - `kind` - `model`, `model-texture`, `texture`, `thumbnail`, `environment`.
 * - `codec` - how the bytes are packed, when that is not simply "as authored".
 *   Absent means none, which is what every entry said before RM-004 B1 and what
 *   an embedder's own manifest will say unless they compress too.
 *
 * ## It is not bundled, and that is deliberate
 *
 * The generated manifest is 58 kB of JSON, 17.6 kB gzipped. Bundling it into
 * the library would put it in every consumer's download whether or not they
 * serve this project's assets at all, and would blow a size budget that A4 just
 * tightened. It is a **runtime input**: the application fetches
 * `asset-manifest.json` at boot and hands it over. A library with no manifest
 * resolves every name to itself, which is exactly what the library did before
 * this sprint.
 */

/**
 * @typedef {Object} AssetEntry
 * @property {string} name The logical name - what a saved design records.
 * @property {string} url Where to fetch it. Equal to `name` unless the manifest says otherwise.
 * @property {number} bytes
 * @property {?string} hash Subresource-integrity form, or null.
 * @property {string} kind
 * @property {?string} codec Decoder required to read it, or null for none.
 */

/** The schema version `tools/make-asset-manifest.mjs` writes. */
export const MANIFEST_VERSION = 1;

/**
 * @typedef {Object} ManifestParseResult
 * @property {boolean} ok
 * @property {AssetManifest} manifest Empty when `ok` is false, so a caller that
 *           ignores the result gets identity resolution rather than a crash.
 * @property {Array<string>} errors
 */

export class AssetManifest
{
	/**
	 * @param {Map<string, AssetEntry>} [entries]
	 */
	constructor(entries)
	{
		/** @type {Map<string, AssetEntry>} */
		this._entries = entries || new Map();
	}

	/** A manifest that knows nothing, which resolves every name to itself. */
	static empty()
	{
		return new AssetManifest();
	}

	/**
	 * Read a manifest document.
	 *
	 * Returns a result rather than throwing, for the reason A1's `DesignDocument`
	 * does: a manifest is fetched over a network at boot, and the failure a
	 * caller has to handle is "it did not arrive intact", not "an exception
	 * escaped". A malformed manifest degrades to identity resolution - every name
	 * to itself, which is the pre-A5 behaviour - rather than taking the
	 * application down. Missing assets are a worse failure than unversioned ones.
	 *
	 * @param {*} json The parsed document, or a string to parse.
	 * @returns {ManifestParseResult}
	 */
	static parse(json)
	{
		var errors = [];
		var document = json;

		if (typeof json === 'string')
		{
			try
			{
				document = JSON.parse(json);
			}
			catch (error)
			{
				return {
					ok: false,
					manifest: AssetManifest.empty(),
					errors: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
				};
			}
		}

		if (!document || typeof document !== 'object' || Array.isArray(document))
		{
			return {ok: false, manifest: AssetManifest.empty(), errors: ['not an object']};
		}
		if (document.version !== MANIFEST_VERSION)
		{
			// Reported and refused rather than read hopefully. A manifest at an
			// unknown version may mean something different by the same field names,
			// and resolving a model URL from a guess is how a design opens with the
			// wrong furniture in it.
			return {
				ok: false,
				manifest: AssetManifest.empty(),
				errors: [`version ${document.version} is not ${MANIFEST_VERSION}`],
			};
		}
		if (!document.assets || typeof document.assets !== 'object')
		{
			return {ok: false, manifest: AssetManifest.empty(), errors: ['assets is missing or not an object']};
		}

		/** @type {Map<string, AssetEntry>} */
		var entries = new Map();
		Object.keys(document.assets).forEach(function (name)
		{
			var raw = document.assets[name];
			if (!raw || typeof raw !== 'object')
			{
				errors.push(`assets["${name}"] is not an object`);
				return;
			}
			entries.set(name, {
				name: name,
				url: typeof raw.url === 'string' && raw.url ? raw.url : name,
				bytes: typeof raw.bytes === 'number' ? raw.bytes : 0,
				hash: typeof raw.hash === 'string' ? raw.hash : null,
				kind: typeof raw.kind === 'string' ? raw.kind : 'asset',
				codec: typeof raw.codec === 'string' && raw.codec ? raw.codec : null,
			});
		});

		return {ok: errors.length === 0, manifest: new AssetManifest(entries), errors: errors};
	}

	/** @param {string} name @returns {boolean} */
	has(name)
	{
		return this._entries.has(name);
	}

	/** @param {string} name @returns {?AssetEntry} */
	entry(name)
	{
		return this._entries.get(name) || null;
	}

	/** @returns {Array<string>} every logical name, in insertion order. */
	names()
	{
		return Array.from(this._entries.keys());
	}

	/** How many assets this build declares. */
	get count()
	{
		return this._entries.size;
	}

	/** What the whole tree weighs, in bytes. */
	get totalBytes()
	{
		var total = 0;
		this._entries.forEach(function (entry) {total += entry.bytes;});
		return total;
	}

	/**
	 * Every entry of one kind, largest first.
	 *
	 * The order is what makes this useful for prefetch budgeting: a caller
	 * spending a fixed number of bytes at idle wants to know what it is
	 * committing to before it starts.
	 *
	 * @param {string} kind
	 * @returns {Array<AssetEntry>}
	 */
	ofKind(kind)
	{
		var found = [];
		this._entries.forEach(function (entry)
		{
			if (entry.kind === kind) {found.push(entry);}
		});
		return found.sort(function (a, b) {return b.bytes - a.bytes;});
	}
}
