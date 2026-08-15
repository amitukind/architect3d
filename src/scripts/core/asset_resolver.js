// @ts-check
import {AssetManifest} from './asset_manifest.js';

/**
 * Logical name in, physical URL out (RM-003 A5).
 *
 * ## What this is for
 *
 * A saved design names `models/js-glb/ik_nordli_full.glb`. That string is a
 * **contract** - it is in files on other people's disks - so it can never
 * change. What can change is what the browser fetches when it sees one, and
 * this is the object that decides.
 *
 * Three things become possible that were not:
 *
 * - **Versioning without renaming.** Give a manifest entry a `url` and every
 *   document naming it follows. H-8's headline, and the reason hashing the
 *   filenames was not an option.
 * - **A CDN as a deployment choice.** `base` is prepended to every resolution.
 *   Nothing in `src/` composes an absolute URL, so a base is the only thing
 *   that was missing.
 * - **Availability as a policy.** A resolver with a manifest knows what should
 *   exist, so a name that is not in it is a typed miss *before* the network is
 *   touched - which is a failure the UI can name the item in, rather than a
 *   404 that reaches a console line.
 *
 * ## The default resolves everything to itself
 *
 * With no manifest and no base, `resolve(name).url === name` for every input.
 * That is the pre-A5 behaviour exactly, and it is what the library ships with:
 * a manifest is a runtime input, not a bundled table. See
 * {@link module:core/asset_manifest} for why.
 *
 * ## Integrity is recorded and not enforced
 *
 * Every manifest entry carries a subresource-integrity hash, and
 * {@link AssetResolver#integrityFor} hands it to a caller that wants it. It is
 * off by default, and that is a judgement rather than laziness: for same-origin
 * `public/` the hash guards against nothing the origin does not already
 * guarantee, while a mismatch after a legitimate redeploy of an unhashed file
 * is an outage. It matters for the CDN deployment this sprint makes possible,
 * so it is available for that, switched on by whoever makes that deployment.
 */

/**
 * @typedef {Object} Resolution
 * @property {string} name The logical name that was asked for.
 * @property {string} url What to fetch.
 * @property {number} bytes Zero when unknown.
 * @property {?string} hash
 * @property {string} kind
 * @property {?string} codec Decoder required to read it, or null for none.
 * @property {boolean} known Whether the manifest declares this name. Always
 *           false when there is no manifest, which is why `missing()` is the
 *           question to ask rather than this one.
 */

/**
 * @typedef {Object} ResolverStats
 * @property {boolean} manifested Whether a manifest is loaded at all.
 * @property {number} assets How many names the manifest declares.
 * @property {string} base
 * @property {Object<string, number>} codecs How many entries declare each codec.
 * @property {string} decoderPath Where a Draco decoder would be fetched from.
 * @property {number} resolutions
 * @property {number} misses Names asked for that a loaded manifest did not have.
 * @property {number} preloaded How many were warmed.
 * @property {number} preloadHits How many resolutions had been warmed first.
 * @property {number} preloadBytes
 */

export class AssetResolver
{
	/**
	 * @param {Object} [options]
	 * @param {AssetManifest} [options.manifest]
	 * @param {string} [options.base] Prepended to every URL. A trailing slash is
	 *        added if it is missing, because every logical name is relative and
	 *        `https://cdn.example` + `models/x.glb` is not a URL anybody meant.
	 * @param {function(string, Object): Promise<*>} [options.fetch] Injected for
	 *        the suite, the way `Scene.setItemLoader` is: preloading is the only
	 *        thing here that touches the network.
	 */
	constructor(options)
	{
		var settings = options || {};
		/** @type {AssetManifest} */
		this.manifest = settings.manifest || AssetManifest.empty();
		this._base = normaliseBase(settings.base);
		this._fetch = settings.fetch || null;
		/** URLs already warmed, so a second preload of the same thing is free. */
		this._warmed = new Set();
		this._stats = {resolutions: 0, misses: 0, preloaded: 0, preloadHits: 0, preloadBytes: 0};
	}

	/** Whether a manifest has been supplied. */
	get manifested()
	{
		return this.manifest.count > 0;
	}

	get base()
	{
		return this._base;
	}

	/**
	 * Point every resolution somewhere else. A deployment decision, made once at
	 * boot; changing it after assets have loaded does not move what is already on
	 * the GPU.
	 *
	 * @param {string} base
	 */
	setBase(base)
	{
		this._base = normaliseBase(base);
	}

	/**
	 * Adopt a manifest. Separate from the constructor because the application
	 * fetches it, and the resolver has to exist before the fetch resolves.
	 *
	 * @param {AssetManifest} manifest
	 */
	setManifest(manifest)
	{
		this.manifest = manifest || AssetManifest.empty();
	}

	/**
	 * @param {string} name A logical name, as written in a saved design.
	 * @returns {Resolution}
	 */
	resolve(name)
	{
		this._stats.resolutions += 1;

		var entry = this.manifest.entry(name);
		if (!entry)
		{
			if (this.manifested)
			{
				// Only a miss when there was something to miss. Without a manifest
				// every name is unknown, and counting those would make the number
				// mean "how many assets did we load" rather than "how many did we
				// not have".
				this._stats.misses += 1;
			}
			var plain = this._base + name;
			this._countWarm(plain);
			return {name: name, url: plain, bytes: 0, hash: null, kind: 'asset', codec: null, known: false};
		}

		var url = this._base + entry.url;
		this._countWarm(url);
		return {name: name, url: url, bytes: entry.bytes, hash: entry.hash, kind: entry.kind, codec: entry.codec, known: true};
	}

	/** @param {string} url */
	_countWarm(url)
	{
		if (this._warmed.has(url))
		{
			this._stats.preloadHits += 1;
		}
	}

	/**
	 * Whether a manifest is loaded AND does not have this name.
	 *
	 * The question worth asking before a fetch: with no manifest the answer is
	 * always false, because a resolver that knows nothing cannot report an
	 * absence. That asymmetry is what keeps the availability policy from
	 * rejecting every load in a build that ships no manifest.
	 *
	 * @param {string} name
	 * @returns {boolean}
	 */
	missing(name)
	{
		return this.manifested && !this.manifest.has(name);
	}

	/**
	 * The integrity string for a name, or null.
	 *
	 * Not applied by this class to anything. A caller that wants it passes it to
	 * `fetch(url, {integrity})` - which is the whole of switching it on, and the
	 * reason the hashes are stored in that exact format.
	 *
	 * @param {string} name
	 * @returns {?string}
	 */
	integrityFor(name)
	{
		var entry = this.manifest.entry(name);
		return entry ? entry.hash : null;
	}

	/**
	 * Warm the HTTP cache for names likely to be wanted.
	 *
	 * The catalog knows what a user is looking at before they click it, and the
	 * manifest knows what each one weighs - so this can be bounded by bytes
	 * rather than by count, which is the difference between prefetching six
	 * thumbnails and prefetching six models.
	 *
	 * Deliberately `fetch` and not `<link rel=prefetch>`: the latter is
	 * unimplemented in Safari, cannot be cancelled, and gives no signal that it
	 * happened. Low priority where the browser supports the hint, so this never
	 * competes with a model the user is actually waiting for.
	 *
	 * Failures are silent by design. A prefetch that 404s costs nothing - the
	 * real load will report it through the ordinary path, where the user is
	 * waiting and a message is worth showing.
	 *
	 * @param {Array<string>} names
	 * @param {Object} [options]
	 * @param {number} [options.maxBytes] Stop once this much has been requested.
	 *        Names of unknown size count as zero, because guessing high would
	 *        make an unmanifested build prefetch nothing.
	 * @returns {Promise<{requested: number, bytes: number, skipped: number}>}
	 */
	async preload(names, options)
	{
		var settings = options || {};
		var budget = typeof settings.maxBytes === 'number' ? settings.maxBytes : Infinity;
		var fetcher = this._fetch || (typeof fetch === 'function' ? fetch : null);
		var requested = 0;
		var bytes = 0;
		var skipped = 0;

		if (!fetcher || !names || !names.length)
		{
			return {requested: 0, bytes: 0, skipped: names ? names.length : 0};
		}

		for (var i = 0; i < names.length; i++)
		{
			var entry = this.manifest.entry(names[i]);
			var size = entry ? entry.bytes : 0;
			if (bytes + size > budget)
			{
				skipped += 1;
				continue;
			}
			var url = this._base + (entry ? entry.url : names[i]);
			if (this._warmed.has(url))
			{
				skipped += 1;
				continue;
			}

			this._warmed.add(url);
			requested += 1;
			bytes += size;
			this._stats.preloaded += 1;
			this._stats.preloadBytes += size;

			try
			{
				// `priority` is ignored by browsers that do not know it, which is the
				// behaviour wanted: a prefetch at default priority is still better
				// than no prefetch.
				await fetcher(url, {priority: 'low', mode: 'cors', credentials: 'omit'});
			}
			catch
			{
				// See the note above: a failed prefetch is not an event.
			}
		}

		return {requested: requested, bytes: bytes, skipped: skipped};
	}

	/**
	 * Where the Draco decoder is served from (RM-004 B1).
	 *
	 * Derived from the base rather than configured separately, because a
	 * deployment that moves its assets moves its decoder with them - one of them
	 * relocating without the other is a broken build that nothing would catch
	 * until a model failed to decode. `?assetBase=` therefore reaches the decoder
	 * for free, which is the whole reason this is a method on the resolver rather
	 * than a constant in the model layer.
	 *
	 * Trailing slash included: `DRACOLoader.setDecoderPath()` concatenates rather
	 * than joins, so the caller owns the separator.
	 *
	 * @returns {string}
	 */
	decoderPath()
	{
		return this._base + 'draco/';
	}

	/**
	 * How many manifest entries declare each codec (RM-004 B1).
	 *
	 * "What is this build actually shipping" was a question only the tree could
	 * answer before, and only to somebody holding a checkout. A resolver knows
	 * it, so a running page can report it.
	 *
	 * @returns {Object<string, number>}
	 */
	codecMix()
	{
		/** @type {Object<string, number>} */
		var mix = {};
		var names = this.manifest.names();
		for (var i = 0; i < names.length; i++)
		{
			var entry = this.manifest.entry(names[i]);
			var codec = (entry && entry.codec) || 'none';
			mix[codec] = (mix[codec] || 0) + 1;
		}
		return mix;
	}

	/** @returns {ResolverStats} */
	stats()
	{
		return {
			manifested: this.manifested,
			assets: this.manifest.count,
			base: this._base,
			codecs: this.codecMix(),
			decoderPath: this.decoderPath(),
			resolutions: this._stats.resolutions,
			misses: this._stats.misses,
			preloaded: this._stats.preloaded,
			preloadHits: this._stats.preloadHits,
			preloadBytes: this._stats.preloadBytes,
		};
	}
}

/**
 * @param {string} [base]
 * @returns {string}
 */
function normaliseBase(base)
{
	if (!base)
	{
		return '';
	}
	return base.endsWith('/') ? base : base + '/';
}

/**
 * The resolver everything falls back to: no manifest, no base, every name to
 * itself.
 *
 * Shared by identity the way `defaultConfiguration` is, so a document that
 * asked for nothing gets exactly the behaviour the library had before A5.
 */
export const defaultAssetResolver = new AssetResolver();
