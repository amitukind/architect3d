// @vitest-environment jsdom
/**
 * The starter-plan shelf, and every way it can fail (RM-016 N2, finding AB-4).
 *
 * ## Why this file exists
 *
 * `useTemplates` was at **27.3 % branch coverage** - the lowest of any file in
 * the tree - and the reason was not that nobody had tested it. `M-47` asserts
 * in the browser tier that a boot fetches no template and that a click fetches
 * the manifest once; `tests/browser/templates.test.js` drives the shelf against
 * the real files. Both are real tests and neither counts, because tier 2 is
 * excluded from the coverage report: it runs against a server, so what it
 * exercises is the *happy* path over a network that answers.
 *
 * What was untested is everything else. AB-4's point is that the thinnest-
 * tested code is the code a first session runs through, and the shelf is the
 * second thing anybody clicks - so the arms that matter here are the ones a
 * first user is most likely to be the first person ever to execute: a manifest
 * that 404s, a fetch that rejects, a JSON body that is not the shape the
 * manifest is supposed to be, a plan file that is missing while its row is not.
 *
 * ## Everything is faked, and nothing is stubbed
 *
 * The fetcher is an argument - `loadTemplateManifest({fetcher})` and
 * `start(entry, {fetcher})` - so these run with no network and no module mocks.
 * The subject is the composable's own logic about what an answer means, which
 * is exactly the part a server cannot be asked to demonstrate on demand.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {effectScope} from 'vue';

import {TEMPLATE_MANIFEST_URL, loadTemplateManifest, resetTemplates, useTemplates}
	from '../src/app/composables/useTemplates.js';

/** A manifest row of the shape the generator writes. */
function row(id, extra)
{
	return {id, file: `templates/${id}.blueprint3d`, name: id, ...extra};
}

/** A fetcher that answers with one JSON body, and records what was asked for. */
function serving(body, options)
{
	const settings = options || {};
	const asked = [];
	const fetcher = (url) =>
	{
		asked.push(url);
		if (settings.reject) { return Promise.reject(new Error('the network is down')); }
		return Promise.resolve({
			ok: settings.ok !== false,
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
		});
	};
	fetcher.asked = asked;
	return fetcher;
}

/** A `useProjects` stand-in: the shelf adopts through it and nothing else. */
function fakeProjects()
{
	const adopted = [];
	return {
		adopted,
		adopt(text, meta) {adopted.push({text, meta}); return text !== 'refuse';},
	};
}

let scope;

beforeEach(() =>
{
	resetTemplates();
	scope = effectScope();
});

afterEach(() =>
{
	scope.stop();
	resetTemplates();
});

/** @returns {ReturnType<typeof useTemplates>} */
function shelf(projects)
{
	return /** @type {any} */ (scope.run(() => useTemplates(projects || fakeProjects())));
}

describe('loadTemplateManifest', () =>
{
	it('reads the rows the generator writes, through the asset resolver', async () =>
	{
		const fetcher = serving({version: 1, entries: [row('studio'), row('duplex')]});

		const entries = await loadTemplateManifest({fetcher});

		expect(entries.map((entry) => entry.id)).toEqual(['studio', 'duplex']);
		// Through the resolver, so `?assetBase=` moves the templates with
		// everything else rather than pinning them to the origin. With no manifest
		// installed the resolver is the identity, which is the URL below.
		expect(fetcher.asked).toEqual([TEMPLATE_MANIFEST_URL]);
	});

	it('fetches once however many times the shelf is opened', async () =>
	{
		const fetcher = serving({entries: [row('studio')]});

		await loadTemplateManifest({fetcher});
		await loadTemplateManifest({fetcher});
		await loadTemplateManifest({fetcher});

		expect(fetcher.asked).toHaveLength(1);
	});

	it('forgets the fetch when asked, which is the way back to a cold start', async () =>
	{
		const fetcher = serving({entries: [row('studio')]});
		await loadTemplateManifest({fetcher});

		resetTemplates();
		await loadTemplateManifest({fetcher});

		expect(fetcher.asked).toHaveLength(2);
	});

	it('is an empty shelf when the manifest 404s', async () =>
	{
		// Not an exception, and not a rejected promise: an empty list. The rule
		// `useAssets` states about its own manifest, applied here - refusing to
		// start because a metadata file is absent turns a degradation into an
		// outage.
		expect(await loadTemplateManifest({fetcher: serving(null, {ok: false})})).toEqual([]);
	});

	it('is an empty shelf when the fetch rejects outright', async () =>
	{
		expect(await loadTemplateManifest({fetcher: serving(null, {reject: true})})).toEqual([]);
	});

	it('is an empty shelf when there is no fetch to call at all', async () =>
	{
		// An environment with no `fetch` - which is not hypothetical: this module
		// is imported by the headless tier, where a jsdom without one is a
		// configuration away.
		const globalFetch = globalThis.fetch;
		try
		{
			// @ts-expect-error deliberately removing it
			delete globalThis.fetch;
			expect(await loadTemplateManifest()).toEqual([]);
		}
		finally
		{
			globalThis.fetch = globalFetch;
		}
	});

	it('is an empty shelf when the body is not a manifest', async () =>
	{
		for (const body of [null, 'a string', 42, {}, {entries: 'not an array'}])
		{
			resetTemplates();
			expect(await loadTemplateManifest({fetcher: serving(body)}), JSON.stringify(body)).toEqual([]);
		}
	});

	it('drops a row that is missing any of the three fields it is read by', async () =>
	{
		// A generated manifest cannot produce these, and a hand-edited or
		// half-deployed one can. The filter is what stops a bad row reaching the
		// shelf as a card with no name and a fetch of `undefined`.
		const fetcher = serving({entries: [
			row('good'),
			{id: 'no-file', name: 'No file'},
			{file: 'templates/x.blueprint3d', name: 'No id'},
			{id: 'no-name', file: 'templates/x.blueprint3d'},
			{id: 7, file: 'templates/x.blueprint3d', name: 'Wrong type'},
			null,
		]});

		expect((await loadTemplateManifest({fetcher})).map((entry) => entry.id)).toEqual(['good']);
	});
});

describe('the shelf', () =>
{
	it('loads once and reports neither loading nor an error afterwards', async () =>
	{
		const templates = shelf();
		const fetcher = serving({entries: [row('studio'), row('duplex')]});

		const promise = templates.load({fetcher});
		expect(templates.loading.value).toBe(true);

		await promise;
		expect(templates.entries.value).toHaveLength(2);
		expect(templates.loading.value).toBe(false);
		expect(templates.error.value).toBeNull();
	});

	it('does not fetch again once it holds rows', async () =>
	{
		const templates = shelf();
		const fetcher = serving({entries: [row('studio')]});
		await templates.load({fetcher});

		// A second open of the same panel. The module-level memo would catch this
		// too; the early return is what keeps it from touching `loading` at all.
		await templates.load({fetcher});

		expect(fetcher.asked).toHaveLength(1);
		expect(templates.entries.value).toHaveLength(1);
	});

	it('says so on an empty shelf rather than showing nothing', async () =>
	{
		const templates = shelf();

		await templates.load({fetcher: serving(null, {ok: false})});

		expect(templates.entries.value).toEqual([]);
		expect(templates.error.value).toBe('The starter plans could not be loaded.');
		expect(templates.loading.value).toBe(false);
	});

	it('treats a fetcher that throws as an absence, like every other failure', async () =>
	{
		const templates = shelf();
		// A fetcher that breaks its contract rather than failing inside it. This
		// was written expecting the throw to escape and the `finally` to be what
		// stopped the spinner; it does not, because `fetchJson` calls through a
		// `Promise.resolve().then()` and catches. So the assertion is the
		// behaviour rather than the guess: every way of not getting a manifest
		// produces the same empty shelf and the same sentence.
		const fetcher = () => {throw new Error('synchronously broken');};

		await templates.load({fetcher});

		expect(templates.entries.value).toEqual([]);
		expect(templates.error.value).toBe('The starter plans could not be loaded.');
		expect(templates.loading.value).toBe(false);
	});
});

describe('starting from a plan', () =>
{
	it('adopts the document, named and attributed to the row it came from', async () =>
	{
		const projects = fakeProjects();
		const templates = shelf(projects);
		const fetcher = serving('{"floorplan":{}}');

		expect(await templates.start(row('studio', {name: 'Studio'}), {fetcher})).toBe(true);

		expect(projects.adopted).toHaveLength(1);
		expect(projects.adopted[0].text).toBe('{"floorplan":{}}');
		// Adopted rather than opened, so saving creates a record instead of
		// overwriting the studio plan for whoever opens it next.
		expect(projects.adopted[0].meta).toEqual({name: 'Studio', origin: 'studio'});
		expect(templates.loading.value).toBe(false);
	});

	it('names the plan that would not load, and adopts nothing', async () =>
	{
		const projects = fakeProjects();
		const templates = shelf(projects);

		expect(await templates.start(row('duplex', {name: 'Duplex'}), {fetcher: serving(null, {ok: false})}))
			.toBe(false);

		expect(projects.adopted).toEqual([]);
		expect(templates.error.value).toBe('Duplex could not be loaded.');
		expect(templates.loading.value).toBe(false);
	});

	it('reports a refusal from the library as a failure to start', async () =>
	{
		// The document arrived and would not parse. `adopt` answers false and
		// leaves the design on screen alone - RM-003 A1's guarantee - and this is
		// the caller passing that answer on rather than claiming success.
		const projects = fakeProjects();
		const templates = shelf(projects);

		expect(await templates.start(row('broken'), {fetcher: serving('refuse')})).toBe(false);
		expect(projects.adopted).toHaveLength(1);
	});

	it('stops saying it is loading when the fetch rejects', async () =>
	{
		const templates = shelf();

		expect(await templates.start(row('studio'), {fetcher: serving(null, {reject: true})})).toBe(false);
		expect(templates.loading.value).toBe(false);
	});

	it('stops saying it is loading when the library throws on the way in', async () =>
	{
		// The one path that reaches `start`'s `finally`, and the reason it is
		// there: `adopt` runs a document through the whole load pipeline, and an
		// exception out of that would otherwise leave the shelf spinning forever
		// over a design that never arrived.
		const projects = fakeProjects();
		projects.adopt = () => {throw new Error('the loader fell over');};
		const templates = shelf(projects);

		await expect(templates.start(row('studio'), {fetcher: serving('{}')}))
			.rejects.toThrow('the loader fell over');
		expect(templates.loading.value).toBe(false);
	});
});
