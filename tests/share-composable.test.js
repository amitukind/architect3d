// @vitest-environment jsdom
/**
 * Sharing, as the application does it (RM-013 K2).
 *
 * `tests/design-link.test.js` proves the codec. This proves the state around
 * it: that a design arriving in the URL puts both views into read-only, that
 * the only way out is a copy, and that the fragment is cleared exactly then and
 * not before.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {effectScope} from 'vue';
import {deflateRawSync, inflateRawSync} from 'node:zlib';

import {Main} from '../src/scripts/three/main.js';
import {EVENT_ITEM_LOADED} from '../src/scripts/core/events.js';
import {AssetManifest} from '../src/scripts/core/asset_manifest.js';
import {assetResolver} from '../src/app/composables/useAssets.js';
import {floorplannerModes} from '../src/scripts/floorplanner/floorplanner_view.js';
import {createBlueprintStore} from '../src/app/composables/useBlueprint.js';
import {useDesignIO} from '../src/app/composables/useDesignIO.js';
import {useProjects, setProjectRepository} from '../src/app/composables/useProjects.js';
import {useShare} from '../src/app/composables/useShare.js';
import {useModelImport} from '../src/app/composables/useModelImport.js';
import {IndexedDbModelRepository} from '../src/app/persistence/model_repository.js';
import {modelStore, setModelRepository} from '../src/app/import/model_store.js';
import {encodeDesign, LINK_KEY} from '../src/app/share/design_link.js';
import {IndexedDbProjectRepository} from '../src/app/persistence/project_repository.js';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';
import {createFakeIndexedDb} from './helpers/indexeddb.js';

const DESIGN = JSON.stringify({
	floorplan: {
		corners: {a: {x: 0, y: 0}, b: {x: 400, y: 0}, c: {x: 400, y: 300}, d: {x: 0, y: 300}},
		walls: [{corner1: 'a', corner2: 'b'}, {corner1: 'b', corner2: 'c'},
			{corner1: 'c', corner2: 'd'}, {corner1: 'd', corner2: 'a'}],
		rooms: {}, units: 'cm', version: '2.0.0',
	},
	items: [],
});

function installStreams()
{
	const make = (transform) => class
	{
		constructor()
		{
			const chunks = [];
			const stream = new TransformStream({
				transform(chunk) {chunks.push(Buffer.from(chunk));},
				flush(controller) {controller.enqueue(new Uint8Array(transform(Buffer.concat(chunks))));},
			});
			this.readable = stream.readable;
			this.writable = stream.writable;
		}
	};
	globalThis.CompressionStream = make(deflateRawSync);
	globalThis.DecompressionStream = make(inflateRawSync);
}

let canvasStub;
let observer;
let pointerApis;
let renderers;
let scope;
let store;
let elements;
let io;
let projects;
let share;
let models;

function buildDom()
{
	const viewer = document.createElement('div');
	document.body.appendChild(viewer);
	const wrapper = document.createElement('div');
	const canvas = document.createElement('canvas');
	canvas.id = 'floorplanner-canvas';
	wrapper.appendChild(canvas);
	document.body.appendChild(wrapper);
	return {viewer, canvas};
}

function run(fn)
{
	let value;
	scope.run(() => {value = fn();});
	return value;
}

beforeEach(() =>
{
	resetAll();
	installStreams();
	document.body.innerHTML = '';
	renderers = [];
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointerApis = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub(renderers));
	setProjectRepository(new IndexedDbProjectRepository({factory: createFakeIndexedDb()}));
	setModelRepository(new IndexedDbModelRepository({factory: createFakeIndexedDb()}));

	scope = effectScope();
	store = run(() => createBlueprintStore());
	elements = buildDom();
	store.mount({floorplannerElement: elements.canvas, threeElement: elements.viewer});
	io = run(() => useDesignIO(store));
	projects = run(() => useProjects(store, io));
	models = run(() => useModelImport(store));
	share = run(() => useShare(store, projects, io, models));
	io.newDesign();
	window.history.replaceState(null, '', window.location.pathname);
});

afterEach(() =>
{
	store.unmount();
	scope.stop();
	setProjectRepository(null);
	setModelRepository(null);
	// The resolver is module-level and one case installs a manifest into it.
	assetResolver().setManifest(null);
	Main.setRendererFactory(null);
	pointerApis.restore();
	observer.restore();
	canvasStub.restore();
	delete globalThis.CompressionStream;
	delete globalThis.DecompressionStream;
	window.history.replaceState(null, '', window.location.pathname);
	document.body.innerHTML = '';
});

describe('making one', () =>
{
	it('builds a link to this page carrying this design', async () =>
	{
		const link = await share.makeLink();

		expect(link).toContain(`#${LINK_KEY}=`);
		expect(share.chars.value).toBeGreaterThan(0);
		expect(share.refusal.value).toBeNull();
	});
});

describe('receiving one', () =>
{
	it('opens the design and stops both views editing', async () =>
	{
		const made = await encodeDesign(DESIGN);

		expect(await share.openFromHash(`#${LINK_KEY}=${made.payload}`)).toBe(true);

		expect(share.viewing.value).toBe(true);
		expect(store.model.value.floorplan.getCorners().length).toBe(4);
		// Both halves, through the library rather than by hiding a tool rail.
		expect(store.floorplanner.value.readOnly).toBe(true);
		expect(store.three.value.readOnly).toBe(true);
		expect(store.three.value.controller.enabled).toBe(false);
		// And the tools are refused, not merely hidden.
		store.floorplanner.value.setMode(floorplannerModes.DRAW);
		expect(store.floorplanner.value.mode).toBe(floorplannerModes.MOVE);
	});

	it('belongs to nobody, so nothing can overwrite anything', async () =>
	{
		const made = await encodeDesign(DESIGN);

		await share.openFromHash(`#${LINK_KEY}=${made.payload}`);

		expect(projects.current.value).toBeNull();
		expect(io.documentName.value).toBe('shared design');
	});

	it('does nothing at all when there is no link', async () =>
	{
		expect(await share.openFromHash('')).toBe(false);
		expect(await share.openFromHash('#something=else')).toBe(false);
		expect(share.viewing.value).toBe(false);
		expect(store.floorplanner.value.readOnly).toBe(false);
	});

	it('leaves the design alone when the link is broken', async () =>
	{
		const made = await encodeDesign(DESIGN);
		const before = store.model.value.floorplan.getCorners().length;

		expect(await share.openFromHash(`#${LINK_KEY}=${made.payload.slice(0, 20)}`)).toBe(false);

		expect(share.viewing.value).toBe(false);
		expect(store.model.value.floorplan.getCorners().length).toBe(before);
	});
});

describe('a bundle, through the composable', () =>
{
	it('carries nothing when the recipient has everything, and reads back', async () =>
	{
		const built = await share.makeBundle();

		expect(built).not.toBeNull();
		// The boot design references `rooms/textures/wallmap.png`, which is in the
		// asset manifest of any build that ships it - so nothing has to travel.
		expect(built.manifest.format).toBe('architect3d-bundle');
		expect(built.manifest.carried).toEqual([]);

		// And the round trip puts it back on screen.
		io.newDesign();
		expect(await share.openBundle(built.bytes)).toBe(true);
		expect(projects.current.value).toBeNull();
	});

	it('refuses something that is not a bundle, without touching the design', async () =>
	{
		const before = store.model.value.exportSerialized();

		expect(await share.openBundle(new TextEncoder().encode('not a zip'))).toBe(false);

		expect(store.model.value.exportSerialized()).toBe(before);
	});
});

/**
 * The half X-7 said the two sprints would share, now that both exist.
 *
 * K2's rule was *carry what the recipient will not have, decided against their
 * own manifest*, and it shipped with an empty answer because everything a
 * design could name was in every build. An imported model is in nobody's
 * manifest, so the rule picks it up with nothing added to it - which is what
 * these cases check, rather than checking that a new branch was written.
 */
describe('an imported model, through a bundle', () =>
{
	/** @returns {Uint8Array} */
	function bearBytes()
	{
		const buffer = readFileSync(join(process.cwd(), 'public/models/gltf/bear.glb'));
		const copy = new Uint8Array(buffer.byteLength);
		copy.set(buffer);
		return copy;
	}

	/** Import the file and place it, then hand back its record. */
	async function importBear()
	{
		await models.refresh();
		expect(await models.choose(new File([bearBytes()], 'bear.glb'))).toBe(true);
		const scene = store.model.value.scene;
		// Awaited: `place` returns when the load STARTS, and a bundle made before
		// the item joins the scene is a bundle of an empty design.
		const arrived = new Promise((resolve) =>
		{
			const done = () => {scene.removeEventListener(EVENT_ITEM_LOADED, done); resolve();};
			scene.addEventListener(EVENT_ITEM_LOADED, done);
		});
		expect(await models.place({up: 'z', unit: 'm', longest: 0})).toBe(true);
		await arrived;
		return models.stored.value[0];
	}

	/** Resolves when the next item load settles, however it settles. */
	function settled()
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

	it('is the one thing a bundle has ever had to carry', async () =>
	{
		// A manifest, so `has()` means what it means in a real build: the
		// recipient's own statement about what their application ships.
		const parsed = AssetManifest.parse({
			version: 1,
			assets: {'rooms/textures/wallmap.png': {url: 'rooms/textures/wallmap.png', bytes: 1, kind: 'texture'}},
		});
		expect(parsed.ok).toBe(true);
		assetResolver().setManifest(parsed.manifest);

		const record = await importBear();
		const built = await share.makeBundle();

		// Nothing in `design_bundle.js` was told that imports exist. The rule K2
		// shipped routes this here on its own, because the recipient's manifest
		// does not declare it and every other name it does.
		expect(built.manifest.carried).toEqual([record.name]);
		expect(built.manifest.expected).toEqual(['rooms/textures/wallmap.png']);
		expect(built.manifest.missing).toEqual([]);
	});

	it('arrives on a computer that has never seen it, and the item is there', async () =>
	{
		const record = await importBear();
		const built = await share.makeBundle();

		// The recipient: same application, empty store, no memory of the file.
		await modelStore().forgetAll();
		io.newDesign();
		expect(modelStore().has(record.name)).toBe(false);

		const arriving = settled();
		expect(await share.openBundle(built.bytes)).toBe(true);
		expect(await arriving).not.toBeNull();

		expect(modelStore().has(record.name)).toBe(true);
		const design = JSON.parse(store.model.value.exportSerialized());
		const item = design.items.filter((row) => row.model_url === record.name)[0];
		expect(item).toBeTruthy();
		// The axis chosen at import travelled in the document rather than in the
		// store, which is why it survives a trip to somebody who has neither.
		expect(item.local).toEqual({id: record.id, file: 'bear.glb', up: 'z'});
		// And nothing reports it missing, because it was stored before the design
		// loaded - `Scene` asks `has()` while it is placing each item.
		expect(models.audit(store.model.value.exportSerialized()).missing).toEqual([]);
	});

	it('refuses a carried file whose bytes are not what the design named', async () =>
	{
		const record = await importBear();
		const built = await share.makeBundle();
		await modelStore().forgetAll();
		io.newDesign();

		// Repack the bundle with a different file under the same name. Content
		// addressing is what makes this detectable at all: the id in the document
		// is the digest of the bytes the design was made with.
		const zip = await import('../src/app/share/zip.js');
		const files = await zip.readZip(built.bytes);
		files.set(`assets/${record.name}`, new TextEncoder().encode('not that model'));
		const tampered = await zip.writeZip([...files.entries()]
			.map(([name, bytes]) => ({name: name, bytes: bytes})));

		const arriving = settled();
		expect(await share.openBundle(tampered)).toBe(true);
		// The item is refused rather than built from bytes nobody vouched for.
		expect(await arriving).toBeNull();
		expect(modelStore().has(record.name)).toBe(false);
		// And the design still opened. "A design that loses one item must lose
		// nothing else" is the rule for a missing model; a wrong one is the same
		// rule with a stronger reason.
		expect(store.model.value.floorplan.getCorners().length).toBe(4);
	});
});

describe('the only way out is a copy', () =>
{
	it('keeps it as a project, stops viewing, and clears the URL', async () =>
	{
		const made = await encodeDesign(DESIGN);
		window.history.replaceState(null, '', `#${LINK_KEY}=${made.payload}`);
		await share.openFromHash();
		// The fragment stays while somebody is looking, so a reload re-opens what
		// they were sent and the link is still there to copy.
		expect(window.location.hash).not.toBe('');

		expect(await share.adopt('Their kitchen')).toBe(true);

		expect(share.viewing.value).toBe(false);
		expect(projects.current.value.name).toBe('Their kitchen');
		expect(projects.current.value.origin).toBe('shared-link');
		expect(window.location.hash).toBe('');
		// And the views are editable again.
		expect(store.floorplanner.value.readOnly).toBe(false);
		expect(store.three.value.controller.enabled).toBe(true);
	});

	it('closing without keeping it also clears the URL', async () =>
	{
		const made = await encodeDesign(DESIGN);
		window.history.replaceState(null, '', `#${LINK_KEY}=${made.payload}`);
		await share.openFromHash();

		share.leave();

		expect(share.viewing.value).toBe(false);
		expect(window.location.hash).toBe('');
		expect(store.floorplanner.value.readOnly).toBe(false);
	});

	/**
	 * The walkthrough and read-only both turn the 3D controller off, and before
	 * K2 the flag had one owner - so leaving a walkthrough in a shared design
	 * handed the pointer back and made the furniture draggable again.
	 */
	it('does not hand the pointer back when a walkthrough ends inside a shared design', async () =>
	{
		const made = await encodeDesign(DESIGN);
		await share.openFromHash(`#${LINK_KEY}=${made.payload}`);
		const three = store.three.value;

		three.switchFPSMode(true);
		expect(three.controller.enabled).toBe(false);
		three.switchFPSMode(false);

		expect(three.controller.enabled).toBe(false);
		expect(three.readOnly).toBe(true);
	});
});
