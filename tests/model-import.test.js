// @vitest-environment jsdom
/**
 * Bringing your own model, from the file picker to the placed item (RM-012 J3).
 *
 * The pure half - what a file is called, how big it may be, how many
 * centimetres a unit is - and then the composable, driven against a real
 * `Model` and a real `GLTFLoader` parsing a real file this repository ships.
 *
 * ## Why the whole path and not a mocked one
 *
 * Because the two halves of this sprint are only correct together. The unit
 * choice is baked into `scale_x/y/z` and the axis choice is baked into the
 * geometry, so "did the decision reach the item" is the question, and a stub
 * scene would answer it by agreeing with the caller - which is the exact way
 * `duplicateSelected` stayed broken for two programmes (RM-012 J4).
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ref} from 'vue';

import {ACCEPT, DEFAULT_UNIT, ID_LENGTH, LOCAL_PREFIX, MAX_MODEL_BYTES, READABLE, UNITS,
	extensionOf, externalRefsIn, fingerprint, fitScaleFor, formatOf, importsAvailable,
	isLocalName, localNameFor, localRefsIn, orientedSize, refuseFile, unitScaleFor}
	from '../src/app/import/model_file.js';
import {IndexedDbModelRepository} from '../src/app/persistence/model_repository.js';
import {modelStore, setModelRepository} from '../src/app/import/model_store.js';
import {useModelImport} from '../src/app/composables/useModelImport.js';
import {useToasts} from '../src/app/composables/useToasts.js';
import {Model} from '../src/scripts/model/model.js';
import {DesignRuntime} from '../src/scripts/core/design_runtime.js';
import {EVENT_ITEM_LOADED} from '../src/scripts/core/events.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const BEAR = 'public/models/gltf/bear.glb';
/** What three measures the file as, in the units its author used. */
const BEAR_SIZE = [0.38971144, 0.45, 0.2475];

/** @returns {Uint8Array} */
function fileBytes(path)
{
	const buffer = readFileSync(join(process.cwd(), path));
	const copy = new Uint8Array(buffer.byteLength);
	copy.set(buffer);
	return copy;
}

/** @returns {File} */
function pick(name, bytes)
{
	return new File([bytes], name);
}

describe('what the application knows about a file', () =>
{
	it('reads the three formats X-7 found already had a loader', () =>
	{
		expect(Object.keys(READABLE).sort()).toEqual(['glb', 'gltf', 'obj']);
		expect(formatOf('chair.GLB')).toBe('gltf');
		expect(formatOf('chair.gltf')).toBe('gltf');
		expect(formatOf('chair.obj')).toBe('obj');
		expect(formatOf('chair.fbx')).toBeNull();
		expect(formatOf('chair')).toBeNull();
		expect(extensionOf('a.b.glb')).toBe('glb');
		expect(extensionOf('noextension')).toBe('');
		expect(ACCEPT).toContain('.glb');
	});

	it('states a limit, and says what it is protecting', () =>
	{
		// A policy, like MAX_LINK_CHARS: far under the 3.2 GB Y-6 measured and 130
		// times the 257,820 of the largest model this build ships.
		expect(MAX_MODEL_BYTES).toBe(32 * 1024 * 1024);
		expect(refuseFile({name: 'a.glb', size: MAX_MODEL_BYTES + 1})).toMatch(/limit for an imported model/);
		expect(refuseFile({name: 'a.glb', size: MAX_MODEL_BYTES})).toBeNull();
		expect(refuseFile({name: 'a.fbx', size: 10})).toMatch(/\.glb, \.gltf and \.obj/);
		expect(refuseFile({name: 'a.glb', size: 0})).toMatch(/is empty/);
		expect(refuseFile(null)).toMatch(/No file/);
	});

	it('names a stored model as a path, so a bundle can carry it as one', () =>
	{
		expect(localNameFor('abc123', 'glb')).toBe('local/abc123.glb');
		expect(isLocalName('local/abc123.glb')).toBe(true);
		expect(isLocalName('models/chair.glb')).toBe(false);
		expect(isLocalName(null)).toBe(false);
		expect(LOCAL_PREFIX).toBe('local/');
	});

	it('converts every unit a person can name', () =>
	{
		expect(UNITS.map((unit) => unit.id)).toEqual(['m', 'cm', 'mm', 'in', 'ft']);
		expect(unitScaleFor('m')).toBe(100);
		expect(unitScaleFor('cm')).toBe(1);
		expect(unitScaleFor('mm')).toBe(0.1);
		expect(unitScaleFor('in')).toBe(2.54);
		expect(unitScaleFor('ft')).toBe(30.48);
		// glTF's own specification, which is what makes it the right default and
		// not a guess.
		expect(DEFAULT_UNIT).toBe('m');
		expect(unitScaleFor('furlong')).toBe(1);
	});

	it('swaps the extent for a Z-up file rather than re-measuring it', () =>
	{
		expect(orientedSize([1, 2, 3], 'z')).toEqual([1, 3, 2]);
		expect(orientedSize([1, 2, 3], 'y')).toEqual([1, 2, 3]);
		expect(orientedSize(null, 'z')).toEqual([0, 0, 0]);
	});

	it('fits the longest side, which is the escape hatch that always works', () =>
	{
		expect(fitScaleFor([2, 1, 0.5], 200)).toBe(100);
		expect(fitScaleFor([0, 0, 0], 200)).toBe(0);
		expect(fitScaleFor([1, 1, 1], 0)).toBe(0);
	});

	it('keys a model on its own bytes, and the same bytes twice on one key', async () =>
	{
		const a = await fingerprint(new Uint8Array([1, 2, 3]).buffer);
		const b = await fingerprint(new Uint8Array([1, 2, 3]).buffer);
		const c = await fingerprint(new Uint8Array([1, 2, 4]).buffer);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a).toHaveLength(ID_LENGTH);
		expect(a).toMatch(/^[0-9a-f]+$/);
		expect(importsAvailable()).toBe(true);
	});

	it('finds a design\'s imports by their key, not by their URL', () =>
	{
		const design = JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [
				{item_type: 1, model_url: 'local/a.glb', local: {id: 'a', file: 'chair.glb', up: 'z'}},
				{item_type: 1, model_url: 'models/chair.glb'},
				// A second copy of the same import is one model, not two.
				{item_type: 1, model_url: 'local/a.glb', local: {id: 'a', file: 'chair.glb', up: 'z'}},
			],
			levels: [{items: [{item_type: 1, model_url: 'local/b.obj', local: {id: 'b'}}]}],
		});
		const refs = localRefsIn(design);
		expect(refs.map((ref) => ref.id)).toEqual(['a', 'b']);
		expect(refs[0]).toEqual({id: 'a', file: 'chair.glb', up: 'z', url: 'local/a.glb'});
		// A reference with no filename still has to be nameable, so it falls back
		// to the id rather than to nothing.
		expect(refs[1].file).toBe('b');
		expect(refs[1].up).toBe('y');
	});

	it('returns nothing for a document that is not one', () =>
	{
		expect(localRefsIn('not json')).toEqual([]);
		expect(localRefsIn('{}')).toEqual([]);
	});

	it('reads what a glTF points at that is not inside it', () =>
	{
		const gltf = (json) => new TextEncoder().encode(JSON.stringify(json)).buffer;
		expect(externalRefsIn(gltf({
			images: [{uri: 'textures/white_wood.ktx2'}, {uri: 'data:image/png;base64,AA'}, {}],
			buffers: [{uri: 'scene.bin'}, {byteLength: 12}],
		}), 'gltf')).toEqual(['textures/white_wood.ktx2', 'scene.bin']);
		// A self-contained file, which is what most imports will be.
		expect(externalRefsIn(gltf({images: [{bufferView: 0}]}), 'gltf')).toEqual([]);
		expect(externalRefsIn(gltf({}), 'gltf')).toEqual([]);
	});

	it('reads the same list out of a GLB container', () =>
	{
		// The one in this repository that makes the check worth having: a `.glb`
		// naming an external texture. Read as bytes rather than through a loader,
		// because this runs before anything decides the file is loadable.
		const bytes = fileBytes(join('public/models/js-glb/ik_nordli_full.glb'));
		const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		expect(externalRefsIn(buffer, 'gltf')).toEqual(['textures/white_wood.ktx2']);
	});

	it('reads an OBJ\'s one external directive, and nothing for a format with none', () =>
	{
		const obj = new TextEncoder().encode('mtllib chair.mtl\nv 0 0 0\n').buffer;
		expect(externalRefsIn(obj, 'obj')).toEqual(['chair.mtl']);
		expect(externalRefsIn(obj, 'fbx')).toEqual([]);
		expect(externalRefsIn(new TextEncoder().encode('nonsense').buffer, 'gltf')).toEqual([]);
	});
});

describe('the composable', () =>
{
	/** @type {*} */
	let store;
	/** @type {*} */
	let models;
	/** @type {Function} */
	let restoreCanvas;
	/** @type {*} */
	let toasts;

	beforeEach(async () =>
	{
		resetAll();
		restoreCanvas = installCanvas2D(window).restore;
		setModelRepository(new IndexedDbModelRepository({factory: createFakeIndexedDb()}));
		toasts = useToasts();
		toasts.toasts.value.slice().forEach((toast) => toasts.dismiss(toast.id));
		// The runtime is handed the SAME store the composable writes to, which is
		// what `useBlueprint` does at every mount. Getting this wrong is silent:
		// the model stores fine and the placement then asks a different, empty
		// store, falls through to the asset manifest, and tries to fetch
		// `local/<id>.glb` off the network.
		store = {model: ref(new Model('models/textures/',
			new DesignRuntime({localModels: modelStore()})))};
		models = useModelImport(store);
		await models.refresh();
	});

	afterEach(() =>
	{
		if (restoreCanvas) { restoreCanvas(); }
	});

	/** Resolves with the item the next load produced, or null. */
	function nextItem()
	{
		const scene = store.model.value.scene;
		return new Promise((resolve) =>
		{
			const done = (event) =>
			{
				scene.removeEventListener(EVENT_ITEM_LOADED, done);
				resolve(event.item);
			};
			scene.addEventListener(EVENT_ITEM_LOADED, done);
		});
	}

	it('refuses a file it cannot read, before anything opens', async () =>
	{
		expect(await models.choose(pick('notes.txt', new Uint8Array([1])))).toBe(false);
		expect(models.pending.value).toBeNull();
		expect(models.refusal.value).toMatch(/\.glb, \.gltf and \.obj/);
	});

	it('refuses a file with no geometry in it, and stores nothing', async () =>
	{
		expect(await models.choose(pick('empty.obj', new TextEncoder().encode('# nothing\n')))).toBe(false);
		expect(models.refusal.value).toMatch(/no geometry/);
		expect(modelStore().count).toBe(0);
	});

	it('refuses bytes that are not the format the name claims', async () =>
	{
		expect(await models.choose(pick('lying.glb', new TextEncoder().encode('nope')))).toBe(false);
		expect(models.pending.value).toBeNull();
		expect(models.refusal.value).toBeTruthy();
	});

	it('measures a real file and holds the decision, having stored nothing yet', async () =>
	{
		expect(await models.choose(pick('bear.glb', fileBytes(BEAR)))).toBe(true);
		const pending = models.pending.value;
		expect(pending.file).toBe('bear.glb');
		expect(pending.format).toBe('gltf');
		expect(pending.name).toBe(`local/${pending.id}.glb`);
		expect(pending.measured.size[1]).toBeCloseTo(BEAR_SIZE[1], 5);
		// Self-contained, which most imports will be - and the case where the
		// warning must stay quiet.
		expect(pending.external).toEqual([]);
		// Measured before stored, deliberately: a record nothing can ever place is
		// worse than a refusal.
		expect(modelStore().count).toBe(0);
		models.cancel();
		expect(models.pending.value).toBeNull();
	});

	it('shows what each answer would make the model', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		// One unit is a metre: 0.45 becomes 45 cm.
		expect(models.preview({up: 'y', unit: 'm', longest: 0}).size[1]).toBeCloseTo(45, 4);
		// One unit is a centimetre: 0.45 stays 0.45 cm.
		expect(models.preview({up: 'y', unit: 'cm', longest: 0}).size[1]).toBeCloseTo(0.45, 4);
		// Read as Z-up, the height and the depth swap before the unit is applied.
		expect(models.preview({up: 'z', unit: 'm', longest: 0}).size[1]).toBeCloseTo(24.75, 4);
		// And the longest side overrides the unit entirely.
		const fitted = models.preview({up: 'y', unit: 'mm', longest: 90});
		expect(Math.max(...fitted.size)).toBeCloseTo(90, 4);
	});

	it('stores the model and puts it in the design at the size that was chosen', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		const id = models.pending.value.id;
		const arriving = nextItem();
		expect(await models.place({up: 'y', unit: 'm', longest: 0})).toBe(true);

		const item = await arriving;
		expect(item).not.toBeNull();
		const record = item.getMetaData();
		expect(record.model_url).toBe(`local/${id}.glb`);
		expect(record.local).toEqual({id: id, file: 'bear.glb', up: 'y'});
		// One unit is a metre, so the 0.45-unit bear is 45 cm tall - and the scale
		// is absolute in the save file, which is why no new key is needed for it.
		expect(record.scale_y).toBeCloseTo(100, 4);
		// `halfSize` is re-derived from the scale in `setScale`, so this is the
		// placed height in centimetres rather than the authored one.
		expect(item.getHeight()).toBeCloseTo(45, 3);
		expect(models.stored.value.map((row) => row.id)).toEqual([id]);
		expect(models.pending.value).toBeNull();
	});

	it('stands a Z-up model up, and records which way it was', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		const arriving = nextItem();
		await models.place({up: 'z', unit: 'm', longest: 0});
		const item = await arriving;
		expect(item.getMetaData().local.up).toBe('z');
		// Read as Z-up, the authored depth becomes the height - and one unit is a
		// metre, so 0.2475 units is 24.75 cm.
		expect(item.getHeight()).toBeCloseTo(BEAR_SIZE[2] * 100, 3);
	});

	it('places a stored model again without re-importing it', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		const first = nextItem();
		await models.place({up: 'y', unit: 'm', longest: 0});
		// Awaited, because `place` returns when the load STARTS - an assertion made
		// before this resolves is made about the wrong item.
		await first;
		const record = models.stored.value[0];

		const arriving = nextItem();
		expect(models.placeStored(record)).toBe(true);
		const item = await arriving;
		expect(item.getMetaData().local.id).toBe(record.id);
		// No unit scale: the stored record is the file, not a placement, so a
		// second copy does not inherit the first one's size decision.
		expect(item.getMetaData().scale_y).toBe(1);
	});

	it('refuses to place a stored model with no viewer to place it in', () =>
	{
		expect(useModelImport({model: ref(null)}).placeStored({name: 'local/a.glb'})).toBe(false);
	});

	it('says what a design is missing, by name, and only when something is', async () =>
	{
		const design = JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [{item_type: 1, model_url: 'local/gone.glb',
				local: {id: 'gone', file: 'grandmother-chair.glb', up: 'y'}}],
		});
		expect(models.audit(design).missing.length).toBe(1);
		expect(models.reportMissing(design)).toBe(1);
		const said = toasts.toasts.value[toasts.toasts.value.length - 1];
		expect(said.message).toBe('1 imported model is not on this computer.');
		expect(said.detail).toContain('grandmother-chair.glb');
		// The other half of the same clause: everything else in the design is fine,
		// so this is a notice and not a refusal.
		expect(said.detail).toContain('opened normally');

		const clean = JSON.stringify({floorplan: {corners: {}, walls: [], rooms: {}}, items: []});
		const before = toasts.toasts.value.length;
		expect(models.reportMissing(clean)).toBe(0);
		expect(toasts.toasts.value.length).toBe(before);
	});

	it('counts more than one in the plural', async () =>
	{
		const design = JSON.stringify({
			floorplan: {corners: {}, walls: [], rooms: {}},
			items: [
				{item_type: 1, model_url: 'local/a.glb', local: {id: 'a', file: 'a.glb'}},
				{item_type: 1, model_url: 'local/b.glb', local: {id: 'b', file: 'b.glb'}},
			],
		});
		expect(models.reportMissing(design)).toBe(2);
		expect(toasts.toasts.value[toasts.toasts.value.length - 1].message)
			.toBe('2 imported models are not on this computer.');
	});

	it('adopts bytes that hash to what the design asked for', async () =>
	{
		const bytes = fileBytes(BEAR);
		const id = await fingerprint(bytes.buffer);
		const ref_ = {id: id, file: 'bear.glb', up: 'y', url: `local/${id}.glb`};
		expect(await models.adopt(ref_, bytes.buffer)).toBe(true);
		expect(modelStore().has(ref_.url)).toBe(true);
	});

	it('refuses bytes that do not, because the id IS the bytes', async () =>
	{
		const bytes = fileBytes(BEAR);
		const wrong = {id: '0000000000000000', file: 'bear.glb', up: 'y', url: 'local/0000000000000000.glb'};
		expect(await models.adopt(wrong, bytes.buffer)).toBe(false);
		expect(modelStore().has(wrong.url)).toBe(false);
	});

	it('forgets a stored model', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		await models.place({up: 'y', unit: 'm', longest: 0});
		const id = models.stored.value[0].id;
		expect(await models.forget(id)).toBe(true);
		expect(models.stored.value).toEqual([]);
	});

	it('hands the bytes back for a bundle to carry', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		await models.place({up: 'y', unit: 'm', longest: 0});
		const record = models.stored.value[0];
		const read = await models.read(record.name);
		expect(read.byteLength).toBe(fileBytes(BEAR).byteLength);
		expect((await models.stats()).models).toBe(1);
	});

	it('says a second import of the same file is already stored', async () =>
	{
		await models.choose(pick('bear.glb', fileBytes(BEAR)));
		await models.place({up: 'z', unit: 'm', longest: 0});
		await models.choose(pick('bear-again.glb', fileBytes(BEAR)));
		// Content-addressed, so the same bytes are the same record - and the axis
		// it stood up at last time is a better default than the specification's.
		expect(models.pending.value.known).not.toBeNull();
		expect(models.pending.value.known.up).toBe('z');
	});

	it('refuses everything when the browser withholds the store', async () =>
	{
		setModelRepository(null);
		const none = useModelImport(store);
		expect(none.available.value).toBe(false);
		expect(await none.choose(pick('bear.glb', fileBytes(BEAR)))).toBe(false);
		expect(none.refusal.value).toMatch(/cannot store imported models/);
	});

	it('refuses when the store fills up, and says which of the reasons it was', async () =>
	{
		setModelRepository(new IndexedDbModelRepository({factory: createFakeIndexedDb({quotaBytes: 128})}));
		const tight = useModelImport(store);
		await tight.refresh();
		expect(await tight.choose(pick('bear.glb', fileBytes(BEAR)))).toBe(true);
		expect(await tight.place({up: 'y', unit: 'm', longest: 0})).toBe(false);
		expect(tight.refusal.value).toMatch(/no room left/);
	});

	it('does nothing when asked to place with nothing pending', async () =>
	{
		expect(await models.place({up: 'y', unit: 'm', longest: 0})).toBe(false);
	});
});
