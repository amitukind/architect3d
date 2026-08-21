// @vitest-environment jsdom
/**
 * The dialog that asks the one question a model file cannot answer (RM-012 J3).
 *
 * A glTF states no unit - the specification says a unit is a metre and the
 * tools very often disagree - and nothing anywhere states which axis the author
 * called up. So the dialog is not a form over a schema: it is a question asked
 * by drawing the answer, and what is asserted here is that the drawing moves
 * when the answer does.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {nextTick, ref} from 'vue';
import {mount} from '@vue/test-utils';

import ImportModelDialog from '../src/app/components/ImportModelDialog.vue';
import {MODEL_IMPORT_KEY} from '../src/app/composables/useModelImport.js';
import {UNITS, fitScaleFor, orientedSize, unitScaleFor} from '../src/app/import/model_file.js';

/** A pending file, shaped the way `useModelImport.choose` produces one. */
const PENDING = {
	id: '6f3a91c2aa11bb22',
	file: 'grandmother-chair.glb',
	format: 'gltf',
	extension: 'glb',
	size: 1_310_720,
	measured: {min: [0, 0, 0], max: [1, 2, 0.5], size: [1, 2, 0.5], empty: false},
	name: 'local/6f3a91c2aa11bb22.glb',
	known: null,
};

const STORED = [
	{id: 'aaa', name: 'local/aaa.glb', file: 'chair.glb', format: 'gltf', up: 'y', bytes: 524_288, added: 2},
	{id: 'bbb', name: 'local/bbb.obj', file: 'lamp.obj', format: 'obj', up: 'z', bytes: 1_048_576, added: 1},
];

/** The real arithmetic, so the dialog is checked against the composable's sum. */
function preview(decision)
{
	const extent = orientedSize(PENDING.measured.size, decision.up);
	const scale = decision.longest > 0 ? fitScaleFor(extent, decision.longest) : unitScaleFor(decision.unit);
	return {scale: scale, size: extent.map((value) => value * scale)};
}

function panel()
{
	return document.querySelector('[role="dialog"]');
}

function textOf(selector)
{
	const node = panel().querySelector(selector);
	return node ? node.textContent.trim() : null;
}

function buttonBy(label)
{
	return [...panel().querySelectorAll('button')]
		.find((node) => node.getAttribute('aria-label') === label || node.textContent.trim() === label);
}

/**
 * The dialog reads `useModelImport` through injection since RM-020 S-5.
 *
 * `open()` still takes the same object every case here already passed - what
 * used to be props are now the composable's own fields, so the mapping happens
 * once here rather than at sixteen call sites. `limit` and `units` keep their
 * old names on the way in and land on `MAX_MODEL_BYTES` and `UNITS`, which is
 * what the composable calls them.
 */
function importStub(state)
{
	var given = state || {};
	var calls = {choose: [], cancel: [], forget: []};
	function record(name)
	{
		return function () {calls[name].push([].slice.call(arguments));};
	}
	return {
		calls: calls,
		pending: ref(given.pending === undefined ? null : given.pending),
		stored: ref(given.stored || []),
		busy: ref(Boolean(given.busy)),
		refusal: ref(given.refusal === undefined ? null : given.refusal),
		available: ref(given.available === undefined ? true : given.available),
		ACCEPT: given.accept || '.glb,.gltf,.obj',
		MAX_MODEL_BYTES: given.limit === undefined ? 33554432 : given.limit,
		UNITS: given.units || UNITS,
		preview: given.preview || preview,
		choose: given.choose || record('choose'),
		cancel: given.cancel || record('cancel'),
		forget: given.forget || record('forget'),
	};
}

async function open(state)
{
	const models = importStub(state);
	const mounted = mount(ImportModelDialog, {
		attachTo: document.body,
		global: {provide: {[MODEL_IMPORT_KEY]: models}},
		props: {open: true},
	});
	// Hung off the wrapper so a case can assert the composable was reached; three
	// of these used to check an emitted event that is now a direct call.
	mounted.models = models;
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

describe('the shelf', () =>
{
	it('says what nothing looks like, rather than showing an empty box', async () =>
	{
		wrapper = await open({stored: []});
		expect(panel().textContent).toContain('Nothing imported yet');
		expect(panel().querySelector('[data-testid="imported-list"]')).toBeNull();
	});

	it('lists what is stored, with what each one is', async () =>
	{
		wrapper = await open({stored: STORED});
		const rows = panel().querySelectorAll('[data-testid="imported-list"] li');
		expect(rows.length).toBe(2);
		expect(rows[0].textContent).toContain('chair.glb');
		expect(rows[0].textContent).toContain('0.50 MB');
		expect(rows[0].textContent).toContain('Y-up');
		expect(rows[1].textContent).toContain('Z-up');
	});

	it('places and forgets by row', async () =>
	{
		wrapper = await open({stored: STORED});
		buttonBy('Place chair.glb').click();
		buttonBy('Remove lamp.obj').click();
		await nextTick();
		expect(wrapper.emitted('place-stored')[0][0].id).toBe('aaa');
		expect(wrapper.models.calls.forget[0][0]).toBe('bbb');
	});

	it('states the limit where the file is chosen, not after', async () =>
	{
		wrapper = await open({stored: [], limit: 32 * 1024 * 1024});
		expect(panel().textContent).toContain('up to 32 MB');
		expect(panel().querySelector('input[type="file"]').getAttribute('accept')).toContain('.glb');
	});

	it('says so, and offers nothing, when the browser withholds the store', async () =>
	{
		wrapper = await open({stored: [], available: false});
		expect(panel().textContent).toContain('cannot store imported models');
		expect(panel().querySelector('input[type="file"]')).toBeNull();
	});

	it('hands the chosen file up and clears the input, so the same file can be picked twice', async () =>
	{
		wrapper = await open({stored: []});
		const input = panel().querySelector('input[type="file"]');
		const file = new File([new Uint8Array([1, 2, 3])], 'chair.glb');
		Object.defineProperty(input, 'files', {value: [file], configurable: true});
		input.dispatchEvent(new Event('change'));
		await nextTick();
		expect(wrapper.models.calls.choose[0][0]).toBe(file);
		expect(input.value).toBe('');
	});
});

describe('the decision', () =>
{
	it('shows the file, its size and what it measured', async () =>
	{
		wrapper = await open({pending: PENDING});
		expect(panel().textContent).toContain('grandmother-chair.glb');
		expect(panel().textContent).toContain('1.3 MB');
		expect(panel().textContent).toContain('1 × 2 × 0.5');
	});

	it('draws the answer, in the display unit, and redraws it when the unit changes', async () =>
	{
		wrapper = await open({pending: PENDING});
		// One unit is a metre by default, which is what glTF's specification says.
		expect(textOf('[data-testid="import-size"]')).toBe('100cm × 200cm × 50cm');

		const select = panel().querySelector('select');
		select.value = 'cm';
		select.dispatchEvent(new Event('change'));
		await nextTick();
		expect(textOf('[data-testid="import-size"]')).toBe('1cm × 2cm × 0.5cm');
	});

	it('swaps height and depth when the file is Z-up', async () =>
	{
		wrapper = await open({pending: PENDING});
		buttonBy('Z is up').click();
		await nextTick();
		expect(textOf('[data-testid="import-size"]')).toBe('100cm × 50cm × 200cm');
		expect(buttonBy('Z is up').getAttribute('aria-pressed')).toBe('true');
		expect(buttonBy('Y is up').getAttribute('aria-pressed')).toBe('false');
	});

	it('lets the longest side override the unit, and says so by disabling it', async () =>
	{
		wrapper = await open({pending: PENDING});
		const field = panel().querySelector('input[type="number"]');
		field.value = '80';
		field.dispatchEvent(new Event('input'));
		await nextTick();
		// The longest authored side is 2, so 80 cm scales everything by 40.
		expect(textOf('[data-testid="import-size"]')).toBe('40cm × 80cm × 20cm');
		expect(panel().querySelector('select').disabled).toBe(true);
	});

	it('emits the decision the numbers were drawn from', async () =>
	{
		wrapper = await open({pending: PENDING});
		buttonBy('Z is up').click();
		await nextTick();
		buttonBy('Place it').click();
		await nextTick();
		expect(wrapper.emitted('place')[0][0]).toEqual({up: 'z', unit: 'm', longest: 0});
	});

	it('cancels without storing anything', async () =>
	{
		wrapper = await open({pending: PENDING});
		buttonBy('Cancel').click();
		await nextTick();
		expect(wrapper.models.calls.cancel).toHaveLength(1);
	});

	it('starts a second file at the specification\'s defaults, not the last answer', async () =>
	{
		wrapper = await open({pending: PENDING});
		buttonBy('Z is up').click();
		const field = panel().querySelector('input[type="number"]');
		field.value = '80';
		field.dispatchEvent(new Event('input'));
		await nextTick();

		wrapper.models.pending.value = Object.assign({}, PENDING, {id: 'other', file: 'sofa.glb'});
		await nextTick();
		await nextTick();
		expect(buttonBy('Y is up').getAttribute('aria-pressed')).toBe('true');
		expect(panel().querySelector('input[type="number"]').value).toBe('');
		expect(textOf('[data-testid="import-size"]')).toBe('100cm × 200cm × 50cm');
	});

	it('opens a file it has seen before at the axis it stood up at last time', async () =>
	{
		wrapper = await open({pending: PENDING});
		wrapper.models.pending.value = Object.assign({}, PENDING, {known: STORED[1]});
		await nextTick();
		await nextTick();
		expect(buttonBy('Z is up').getAttribute('aria-pressed')).toBe('true');
		expect(panel().textContent).toContain('already stored');
	});

	it('says what the file needs that is not inside it, rather than arriving grey', async () =>
	{
		wrapper = await open({pending: PENDING});
		expect(panel().querySelector('[data-testid="import-external"]')).toBeNull();

		wrapper.models.pending.value = Object.assign({}, PENDING,
			{external: ['textures/white_wood.ktx2']});
		await nextTick();
		await nextTick();
		const note = panel().querySelector('[data-testid="import-external"]');
		expect(note.textContent).toContain('textures/white_wood.ktx2');
		expect(note.textContent).toContain('untextured');
	});

	it('shows a refusal beside the decision rather than instead of it', async () =>
	{
		wrapper = await open({pending: PENDING, refusal: 'There is no room left.'});
		expect(panel().textContent).toContain('There is no room left.');
		// The decision is still on screen, which is why the dialog does not close
		// on a failed place.
		expect(buttonBy('Place it')).toBeTruthy();
	});
});
