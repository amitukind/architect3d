/**
 * The catalog, served off the disk the way a browser would fetch it
 * (RM-012 J2).
 *
 * J1 put the catalog in two files and the bundle imported one of them, so a test
 * that wanted rows got them by importing the same file. J2 took the rows out of
 * the bundle entirely: `useCatalog` now fetches `public/catalog/*.json` the first
 * time somebody opens the drawer, because a pack acquired later is a file
 * dropped into that directory and nothing a build can know about.
 *
 * That leaves the suite needing a fetch. This is it - a real read of the real
 * generated files, not a fixture, so a test that passes here is a test against
 * the bytes the deployment serves. The alternative, a hand-written pack, would
 * pass while the generated one was empty.
 *
 * The counter is here because two of the claims are about *how many* round trips
 * happen: one per pack, and a second open costs none.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';

import {
	loadCatalogDetail, loadCatalogPacks, resetCatalogPacks,
} from '../../src/app/composables/useCatalog.js';

const ROOT = process.cwd();

/**
 * A `fetch` over `public/`, with the responses' shape and nothing else.
 *
 * Only `ok` and `json()` are implemented, because that is all `fetchJson` reads.
 * A stub that grew headers and a body stream would be a stub with its own bugs.
 *
 * @returns {{fetch: function(string): Promise<Object>, urls: Array<string>}}
 */
export function diskFetch()
{
	const urls = [];
	return {
		urls,
		fetch(url)
		{
			urls.push(url);
			const path = join(ROOT, 'public', url);
			if (!existsSync(path))
			{
				return Promise.resolve({ok: false, status: 404, json: () => Promise.reject(new Error('404'))});
			}
			const text = readFileSync(path, 'utf8');
			return Promise.resolve({ok: true, status: 200, json: () => Promise.resolve(JSON.parse(text))});
		},
	};
}

/**
 * Put the module back where a fresh page starts, then fetch the rows.
 *
 * Awaited, so anything mounted afterwards sees a full catalog and a test does
 * not have to know how many microtasks four packs take.
 *
 * @param {Object} [options]
 * @param {boolean} [options.detail] Also fetch the sizes. Off by default: most
 *   cases are about the grid, and the whole point of the second tier is that
 *   the grid does not wait for it.
 * @returns {Promise<{urls: Array<string>}>}
 */
export async function loadCatalogFromDisk(options)
{
	const disk = diskFetch();
	resetCatalogPacks();
	await loadCatalogPacks({fetch: disk.fetch});
	if (options && options.detail)
	{
		await loadCatalogDetail({fetch: disk.fetch});
	}
	return disk;
}

/**
 * Put a `fetch` on the global that serves the catalog and nothing else.
 *
 * For the cases whose subject is the *drawer* rather than the composable: the
 * component calls `loadCatalogPacks()` with no arguments, exactly as it does in
 * a browser, and there has to be something for it to call. Injecting a fetch
 * would test a path the application never takes.
 *
 * Scoped to `catalog/` deliberately. `useAssets` fetches `asset-manifest.json`
 * off the same global, and this suite is written against a shell where that
 * fetch fails and the resolver stays identity - a helper that quietly started
 * serving it would change what these cases are about without saying so.
 *
 * @returns {{urls: Array<string>, restore: function(): void}}
 */
export function installCatalogFetch()
{
	const disk = diskFetch();
	const had = Object.prototype.hasOwnProperty.call(globalThis, 'fetch');
	const previous = globalThis.fetch;
	globalThis.fetch = (url) => (String(url).startsWith('catalog/')
		? disk.fetch(String(url))
		: Promise.resolve({ok: false, status: 404, json: () => Promise.reject(new Error('404'))}));
	return {
		urls: disk.urls,
		restore()
		{
			if (had) { globalThis.fetch = previous; }
			else { delete globalThis.fetch; }
		},
	};
}

export {resetCatalogPacks};
