// @vitest-environment jsdom
/**
 * The two components sharing put on screen (RM-013 K2).
 *
 * The dialog is where the link is *handed over*, and the bar is where a person
 * finds out why nothing responds to a drag. Both carry decisions rather than
 * markup - the link is in a field because a clipboard can decline, the refusal
 * states a number because the ceiling is a house rule, and the bar exists at all
 * because a viewer with no explanation reads as a broken editor.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick, ref} from 'vue';
import {mount} from '@vue/test-utils';

import ShareDialog from '../src/app/components/ShareDialog.vue';
import {SHARE_KEY} from '../src/app/composables/useShare.js';
import ViewerBanner from '../src/app/components/ViewerBanner.vue';

const LINK = 'https://example.test/#d=1AbCdEf';

function panel()
{
	return document.querySelector('[role="dialog"]');
}

function buttonBy(label)
{
	return [...panel().querySelectorAll('button')]
		.find((node) => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
}

/** Mount the dialog and wait for its portal, like the library suite does. */
async function open(props)
{
	// `useShare` is injected since RM-020 S-5. `open()` still takes the same
	// object every case here passes; the keys land on the composable now, with
	// `limit` under the name it has there.
	const given = props || {};
	const share = {
		link: ref(given.link === undefined ? LINK : given.link),
		chars: ref(given.chars === undefined ? LINK.length : given.chars),
		MAX_LINK_CHARS: given.limit === undefined ? 8000 : given.limit,
		refusal: ref(given.refusal === undefined ? null : given.refusal),
		busy: ref(Boolean(given.busy)),
		available: ref(given.available === undefined ? true : given.available),
		copyLink: given.copy || (async () => true),
	};
	const mounted = mount(ShareDialog, {
		attachTo: document.body,
		global: {provide: {[SHARE_KEY]: share}},
		props: {open: true},
	});
	mounted.share = share;
	await nextTick();
	await nextTick();
	return mounted;
}

let wrapper;

beforeEach(() => {document.body.innerHTML = '';});

afterEach(() =>
{
	if (wrapper) { wrapper.unmount(); }
	wrapper = null;
	document.body.innerHTML = '';
});

describe('the link is on screen, always', () =>
{
	it('shows it in a field, with the count beside it', async () =>
	{
		wrapper = await open();

		const field = panel().querySelector('input[aria-label="Shareable link"]');
		expect(field.value).toBe(LINK);
		expect(field.readOnly).toBe(true);
		expect(panel().textContent).toContain(`${LINK.length} of 8,000 characters`);
	});

	it('says Copied when the clipboard took it', async () =>
	{
		const copy = vi.fn(async () => true);
		wrapper = await open({copy});

		await buttonBy('Copy').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await nextTick();

		expect(copy).toHaveBeenCalledTimes(1);
		expect(buttonBy('Copied')).toBeTruthy();
	});

	/**
	 * The reason the field is the feature. A browser can decline the clipboard
	 * for reasons that have nothing to do with this application, and a dialog
	 * that had said "Copied!" into thin air is worse than one that shows the
	 * thing and selects it.
	 */
	it('selects the text instead when the browser says no', async () =>
	{
		wrapper = await open({copy: async () => false});
		const field = panel().querySelector('input[aria-label="Shareable link"]');
		const selected = vi.spyOn(field, 'select');

		await buttonBy('Copy').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
		await nextTick();

		expect(selected).toHaveBeenCalled();
		expect(buttonBy('Copied')).toBeUndefined();
		expect(buttonBy('Copy')).toBeTruthy();
	});

	it('selects the whole link when the field is focused', async () =>
	{
		wrapper = await open();
		const field = panel().querySelector('input[aria-label="Shareable link"]');
		const selected = vi.spyOn(field, 'select');

		field.dispatchEvent(new window.Event('focus'));

		expect(selected).toHaveBeenCalled();
	});
});

describe('the refusals each say something a person can act on', () =>
{
	it('states the size and the limit rather than "too long"', async () =>
	{
		wrapper = await open({link: null, refusal: 'too-long', chars: 11204});

		expect(panel().textContent).toContain('11,204');
		expect(panel().textContent).toContain('8,000');
		expect(buttonBy('Save layout instead')).toBeTruthy();
		expect(panel().querySelector('input[aria-label="Shareable link"]')).toBeNull();
	});

	it('offers a file when the browser cannot compress at all', async () =>
	{
		wrapper = await open({link: null, available: false});

		expect(panel().textContent).toContain('cannot compress');
		expect(panel().querySelector('input[aria-label="Shareable link"]')).toBeNull();
	});

	it('says it is working while the link is being made', async () =>
	{
		wrapper = await open({link: null});

		expect(panel().textContent).toContain('Making the link');
	});

	it('asks for a file, and the shell is what saves it', async () =>
	{
		wrapper = await open({link: null, refusal: 'too-long', chars: 11204});

		await buttonBy('Save layout instead').dispatchEvent(new window.MouseEvent('click', {bubbles: true}));

		expect(wrapper.emitted('save-file')).toHaveLength(1);
	});
});

describe('the viewer bar', () =>
{
	it('says what is happening and carries the only way out', async () =>
	{
		wrapper = mount(ViewerBanner, {attachTo: document.body});

		expect(wrapper.text()).toContain('viewing a shared design');
		expect(wrapper.text()).toContain('Nothing you do here changes the original');

		await wrapper.findAll('button').find((node) => node.text().includes('Keep a copy')).trigger('click');
		expect(wrapper.emitted('adopt')).toHaveLength(1);

		await wrapper.findAll('button').find((node) => node.text() === 'Close').trigger('click');
		expect(wrapper.emitted('leave')).toHaveLength(1);
	});

	it('cannot be pressed twice while the copy is being made', () =>
	{
		wrapper = mount(ViewerBanner, {attachTo: document.body, props: {busy: true}});

		wrapper.findAll('button').forEach((node) => {expect(node.attributes('disabled')).toBeDefined();});
	});
});
