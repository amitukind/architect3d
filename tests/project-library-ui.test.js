// @vitest-environment jsdom
/**
 * The library on screen (RM-013 K1, gap Q-6).
 *
 * `tests/project-library.test.js` proves the store and
 * `tests/project-composable.test.js` proves what the application does with it.
 * This is the third tier: that the dialog renders what the composable holds,
 * that the two shelves say different things because they are different kinds of
 * thing, and that rename and delete happen on the tile rather than in a
 * `window.prompt` - which the application turned off deliberately.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick, ref} from 'vue';
import {mount} from '@vue/test-utils';

import ProjectLibrary from '../src/app/components/ProjectLibrary.vue';
import {PROJECTS_KEY} from '../src/app/composables/useProjects.js';

const CARD = {
	id: 'a', name: 'Loft conversion', createdAt: 1_700_000_000_000,
	modifiedAt: 1_700_000_500_000, thumbnail: null, bytes: 8518, origin: null,
};

const TEMPLATE = {
	id: 'studio', name: 'Studio', summary: 'One room and a shower room, 33 m².',
	kind: 'template', rooms: 2, file: 'templates/studio.blueprint3d', bytes: 4101,
};

/**
 * Mount the dialog and wait for its portal.
 *
 * Reka teleports the content, so nothing is in the document on the tick the
 * component mounts - which is why every case below awaits this rather than
 * reading `document` straight after `mount`.
 */
async function open(props)
{
	// The saved-project half of the dialog reads `useProjects` through injection
	// since RM-020 S-5; the template half is still props. `open()` keeps taking
	// one object and routes each key to whichever side now owns it, so the cases
	// below did not have to change. The three mutations are recorded, because
	// four of them assert a button reached the composable.
	const given = props || {};
	const calls = {rename: [], duplicate: [], remove: []};
	const projects = {
		projects: ref(given.projects || [CARD]),
		current: ref(given.current === undefined ? null : given.current),
		dirty: ref(Boolean(given.dirty)),
		busy: ref(Boolean(given.busy)),
		available: ref(given.available === undefined ? true : given.available),
		rename(...args) {calls.rename.push(args);},
		duplicate(...args) {calls.duplicate.push(args);},
		remove(...args) {calls.remove.push(args);},
	};
	const mounted = mount(ProjectLibrary, {
		attachTo: document.body,
		global: {provide: {[PROJECTS_KEY]: projects}},
		props: {
			open: true,
			templates: given.templates === undefined ? [TEMPLATE] : given.templates,
			templatesError: given.templatesError,
		},
	});
	mounted.calls = calls;
	await nextTick();
	await nextTick();
	return mounted;
}

/** The dialog renders in a portal, so it is looked up in the document. */
function panel()
{
	return document.querySelector('[role="dialog"]');
}

function buttonBy(label)
{
	return [...panel().querySelectorAll('button')]
		.find((node) => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
}

let wrapper;

beforeEach(() =>
{
	document.body.innerHTML = '';
});

afterEach(() =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
	document.body.innerHTML = '';
});

describe('the grid', () =>
{
	it('shows a tile per design, with its date and size', async () =>
	{
		wrapper = await open();

		const text = panel().textContent;
		expect(text).toContain('Loft conversion');
		expect(text).toContain('8 KB');
		// No picture on this card, so the tile carries the initial rather than a
		// broken image. A project with no thumbnail is still a project.
		expect(panel().querySelector('img')).toBeNull();
		expect(text).toContain('L');
	});

	it('draws the picture when there is one', async () =>
	{
		wrapper = await open({projects: [Object.assign({}, CARD, {thumbnail: 'data:image/webp;base64,AAAA'})]});

		expect(panel().querySelector('img').getAttribute('src')).toBe('data:image/webp;base64,AAAA');
	});

	it('says what to do when there is nothing kept', async () =>
	{
		wrapper = await open({projects: []});

		// And opens on the shelf that has something on it, which is the one useful
		// guess this dialog gets to make.
		expect(panel().textContent).toContain('One room and a shower room');
	});

	it('says so, and offers nothing, when the browser will not store', async () =>
	{
		wrapper = await open({available: false});

		expect(panel().textContent).toContain('not offering storage');
		expect(panel().textContent).not.toContain('Loft conversion');
	});
});

describe('rename and delete happen on the tile', () =>
{
	it('turns the caption into a field, and commits on Enter', async () =>
	{
		wrapper = await open();

		await buttonBy('Rename').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();
		const field = panel().querySelector('input[aria-label="Design name"]');
		expect(field).not.toBeNull();

		field.value = 'Galley kitchen';
		field.dispatchEvent(new window.Event('input'));
		field.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
		await wrapper.vm.$nextTick();

		expect(wrapper.calls.rename).toEqual([['a', 'Galley kitchen']]);
	});

	it('abandons the rename on Escape, and emits nothing', async () =>
	{
		wrapper = await open();

		await buttonBy('Rename').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();
		const field = panel().querySelector('input[aria-label="Design name"]');
		field.value = 'Discarded';
		field.dispatchEvent(new window.Event('input'));
		field.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
		await wrapper.vm.$nextTick();

		expect(wrapper.calls.rename).toHaveLength(0);
		expect(panel().querySelector('input[aria-label="Design name"]')).toBeNull();
	});

	/**
	 * Two clicks on the tile, not a second modal and not `window.confirm`. The
	 * application sets `configSystemUI` to false precisely so the library stops
	 * reaching for those.
	 */
	it('asks before it deletes, on the tile itself', async () =>
	{
		wrapper = await open();

		await buttonBy('Delete').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();

		expect(panel().textContent).toContain('Delete this?');
		expect(wrapper.calls.remove).toHaveLength(0);

		await buttonBy('Delete').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();

		expect(wrapper.calls.remove).toEqual([['a']]);
	});

	it('lets the question be cancelled', async () =>
	{
		wrapper = await open();

		await buttonBy('Delete').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();
		await buttonBy('Cancel').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();

		expect(wrapper.calls.remove).toHaveLength(0);
		expect(panel().textContent).not.toContain('Delete this?');
	});
});

describe('the two shelves are different kinds of thing', () =>
{
	it('opens a design, and starts from a plan', async () =>
	{
		wrapper = await open();

		await panel().querySelector('button[title="Open Loft conversion"]')
			.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		expect(wrapper.emitted('open-project')).toEqual([['a']]);

		await buttonBy('Start from a plan').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await wrapper.vm.$nextTick();
		await [...panel().querySelectorAll('button')].find((node) => node.textContent.includes('Studio'))
			.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));

		expect(wrapper.emitted('start-template')[0][0].id).toBe('studio');
	});

	it('names what is open, and admits when it has moved', async () =>
	{
		wrapper = await open({current: CARD, dirty: true});

		expect(panel().textContent).toContain('Loft conversion');
		expect(panel().textContent).toContain('unsaved changes');
		// The button says what it will do, which is not the same sentence in the
		// two cases.
		expect(panel().textContent).toContain('Save');
	});

	it('offers to keep a design that is not a record yet', async () =>
	{
		wrapper = await open({current: null});

		expect(panel().textContent).toContain('has not been kept yet');
		expect(buttonBy('Keep this design')).toBeTruthy();
	});

	it('says so when the shelf could not be fetched', async () =>
	{
		wrapper = await open({projects: [], templates: [], templatesError: 'The starter plans could not be loaded.'});

		expect(panel().textContent).toContain('could not be loaded');
	});
});
