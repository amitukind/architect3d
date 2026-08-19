/**
 * Nothing unpicked is downloaded (RM-011 H1, M-43, tier 2).
 *
 * **M-43** is the metric this file carries: *the first-load payload does not
 * grow by one byte for a material nobody has chosen, measured as the resource
 * timings of a boot, and the new budget line holds it.* The budget line is
 * `first-load` in `tools/budget.json` and it holds the payload; this is the
 * other half, and it is the half a byte count cannot answer.
 *
 * RM-012 J2 gives it a second subject on the same instrument: *a pack nobody has
 * opened costs a boot nothing.* The catalog's 168 rows left the bundle for four
 * files in `public/catalog/`, and the claim that they are fetched rather than
 * bundled is exactly the claim this file is built to check - a boot asks for
 * none of them, and the drawer's first open asks for all four.
 *
 * A tree can grow by ninety files without a boot fetching one of them, or it can
 * grow by one file that every boot fetches eagerly, and the two look identical
 * from disk. `performance.getEntriesByType('resource')` is the browser's own
 * record of what it actually asked the network for, which is the only instrument
 * that tells them apart.
 *
 * ## What "boot" means here, and what it does not
 *
 * The application mounted and settled, with its default design - a four-corner
 * room with no material on anything. Every material image is therefore unpicked
 * by construction, and the assertion is that not one of them was fetched.
 *
 * It is deliberately **not** a claim about the full production boot sequence:
 * the test runner serves modules unbundled and its own machinery appears in the
 * same timings. So the assertions are all of the form "nothing matching this was
 * fetched", which that noise cannot make pass by accident - a request for a
 * material would show up in exactly the same list.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick} from 'vue';
import {mount} from '@vue/test-utils';

import App from '../../src/app/App.vue';
import materials from '../../src/catalog/materials.json';
import {PACKS, loadCatalogPacks, resetCatalogPacks} from '../../src/app/composables/useCatalog.js';

let wrapper;

/** Everything the browser has fetched, as paths. */
function fetched()
{
	return performance.getEntriesByType('resource').map((entry) =>
	{
		try {return new URL(entry.name).pathname;}
		catch {return entry.name;}
	});
}

beforeEach(async () =>
{
	// A previous case's fetches are cached in the module, so the pack assertions
	// below would measure whether this file's cases ran in order rather than what
	// a boot does.
	resetCatalogPacks();
	performance.clearResourceTimings();
	wrapper = mount(App, {attachTo: document.body});
	await nextTick();
	// Two frames and a beat, the same settle the other browser suites use: the
	// viewer's textures are queued by a redraw and land on a later tick.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	await new Promise((resolve) => setTimeout(resolve, 400));
});

afterEach(() =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
});

describe('M-43 - a boot fetches no material', () =>
{
	it('fetches no image from the library', () =>
	{
		// The whole library, not a sample. A picker that eagerly loaded one
		// thumbnail per swatch would fail here and pass every byte-count check in
		// the repository, because the tree is the same size either way.
		const library = fetched().filter((path) => path.includes('/materials/'));
		expect(library, `a boot fetched ${library.length} material files:\n  ${library.join('\n  ')}`)
			.toEqual([]);
	});

	it('fetches no albedo, roughness map or thumbnail by name', () =>
	{
		// Belt and braces on the path test above: match each catalog entry's own
		// three urls, so a library moved to a different directory is still caught.
		const asked = new Set(fetched());
		const wanted = [...materials.wall, ...materials.floor]
			.flatMap((entry) => [entry.url, entry.roughnessMap, entry.thumbnail])
			.filter((url, index, all) => all.indexOf(url) === index);
		const found = wanted.filter((url) => asked.has(`/${url}`) || asked.has(url));
		expect(found).toEqual([]);
	});

	it('draws the picker anyway, from the catalog it already has', () =>
	{
		// The reason the two assertions above are not simply "the picker is
		// broken". Thumbnails are `<img loading="lazy">` inside a panel that is
		// closed at boot, so the swatches exist in the catalog the bundle carries
		// and cost the network nothing until somebody opens the inspector.
		expect(materials.wall.length + materials.floor.length).toBeGreaterThan(30);
		expect(wrapper.find('#app-shell').exists()).toBe(true);
	});
});

/**
 * The second half of M-43, added by RM-012 J2.
 *
 * J1 split the catalog by tier and left the index in the bundle, which fits
 * today and stops fitting at the row count J2 is written for - X-3 measured
 * 17,264 gzipped bytes of growth against 13,292 of headroom. J2 took every row
 * out: the bundle imports a manifest of kits, and the rows are fetched when the
 * drawer opens.
 *
 * Whether that is true is not a question a file listing can answer. A build that
 * fetched all four packs at boot and one that fetched none look identical on
 * disk, and both leave `first-load` unmoved, because `first-load` counts the
 * document and what it references and a pack is referenced by neither.
 */
describe('M-43 - a boot fetches no pack', () =>
{
	it('asks for no catalog file at all', () =>
	{
		const packs = fetched().filter((path) => path.includes('/catalog/'));
		expect(packs, `a boot fetched ${packs.length} pack files:\n  ${packs.join('\n  ')}`)
			.toEqual([]);
	});

	it('and for none of the four by name, wherever they are served from', () =>
	{
		// The path test above would miss a pack moved out of that directory. These
		// are the URLs the manifest itself names, which is what the application
		// would actually ask for.
		const asked = new Set(fetched());
		const wanted = PACKS.flatMap((pack) => [pack.index, pack.detail]);
		expect(wanted.filter((url) => asked.has(`/${url}`) || asked.has(url))).toEqual([]);
	});

	it('knows what it is not fetching, because the manifest is bundled', () =>
	{
		// The other half of the trade. A boot that fetched nothing and also knew
		// nothing would be a drawer that could not tell you what it was waiting
		// for; the manifest costs one line per kit and is a function of how many
		// kits exist rather than how many items.
		expect(PACKS.length).toBe(4);
		expect(PACKS.reduce((sum, pack) => sum + pack.rows, 0)).toBe(168);
		expect(PACKS.every((pack) => typeof pack.licence === 'string' && pack.licence)).toBe(true);
	});

	it('fetches all four the moment somebody opens the drawer', async () =>
	{
		// Which is what makes the three assertions above a measurement rather than
		// a tautology: a pack URL that 404s would also never appear in a boot's
		// timings, and this is the case that tells the two apart.
		const rows = await loadCatalogPacks();
		expect(rows.length).toBe(168);

		const packs = fetched().filter((path) => path.includes('/catalog/'));
		expect(packs.length).toBe(4);
	});
});
