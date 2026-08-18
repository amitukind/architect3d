// @vitest-environment jsdom
/**
 * One document's services, and the wall between two documents (RM-003 A4).
 *
 * ## The finding
 *
 * H-7: the texture cache and the loaders were process-wide, and there was no
 * object a document's lifetime belonged to. `Main.dispose()` carried a comment
 * saying its unconditional `clearTextureCache()` "becomes R-02's problem" once
 * two simultaneous viewers were supported - and P7 supported them. A0 removed
 * that call; A4 is the part that gives the condition a name.
 *
 * ## What is asserted, and in what order of difficulty
 *
 * 1. **The compatibility claim**, which is the one that would break the most
 *    code if it were wrong: every static still reads the state it always read,
 *    because `defaultRuntime`'s services ARE the module defaults by identity.
 * 2. **The two accessors cannot disagree.** `configurationOf(x)` and
 *    `runtimeOf(x).configuration` are checked against each other over every
 *    owner shape the library produces, because two ways of answering one
 *    question is the shape of bug the last three sprints have been closing.
 * 3. **Isolation.** Two documents, two runtimes: an edit, a load or a disposal
 *    in one is not observable in the other's registry, session or profile.
 * 4. **Disposal is scoped and accounted.** `runtime.stats()` climbs as a
 *    viewer builds wall meshes and falls as it is torn down, and disposing one
 *    viewer leaves the other's count exactly where it was.
 *
 * The browser tier asks (3) and (4) again of real pixels and real
 * `renderer.info.memory` - see `tests/browser/two-designs.test.js`. This suite
 * is where the detail lives; that one is where the claim is made of a GPU.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {EventDispatcher} from 'three';

import {DesignRuntime, defaultRuntime, runtimeOf, resolveRuntime} from '../src/scripts/core/design_runtime.js';
import {
	Configuration, defaultConfiguration, configurationOf, config, wallInformation,
	configDimUnit, configWallHeight, scale,
} from '../src/scripts/core/configuration.js';
import {Dimensioning, defaultDimensioning} from '../src/scripts/core/dimensioning.js';
import {
	renderProfile, createRenderProfile, isStudio, RENDER_CLASSIC, RENDER_STUDIO,
} from '../src/scripts/core/render_profile.js';
import {dimCentiMeter, dimMeter} from '../src/scripts/core/units.js';
import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {Main} from '../src/scripts/three/main.js';
import {Corner} from '../src/scripts/model/corner.js';

import {resetAll} from './helpers/harness.js';
import {installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

/** A four-metre room, as a saved design. */
const DESIGN = JSON.stringify({
	floorplan: {
		corners: {
			c1: {x: 0, y: 0, elevation: 0},
			c2: {x: 400, y: 0, elevation: 0},
			c3: {x: 400, y: 400, elevation: 0},
			c4: {x: 0, y: 400, elevation: 0},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'},
			{corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'},
			{corner1: 'c4', corner2: 'c1'},
		],
		rooms: {}, units: 'cm', version: '2.0.0',
	},
	items: [],
});

let mounted = [];

/**
 * A real `Main` over a real `Model`, mounted headlessly.
 *
 * The renderer is a stub - that is a dependency, not the subject. Everything
 * else is the shipping object, for the reason A2's suite records: a stand-in
 * that reimplements the rule under test passes with the rule deleted.
 */
function mountViewer(options)
{
	const observer = installResizeObserver(window);
	const pointerApis = installPointerApis(window);
	const host = document.createElement('div');
	document.body.appendChild(host);
	setLayout(host, {left: 0, top: 0, width: 1024, height: 768});

	const model = new Model('/textures/', options && options.runtime);
	model.scene.setItemLoader(() => {});
	Main.setRendererFactory(() => createRendererStub());
	const three = new Main(model, host, null, {resize: false, spin: false});
	Main.setRendererFactory(null);

	const viewer = {
		model,
		three,
		runtime: model.runtime,
		dispose()
		{
			three.dispose();
			host.remove();
			pointerApis.restore();
			observer.restore();
		},
	};
	mounted.push(viewer);
	return viewer;
}

beforeEach(() =>
{
	resetAll();
	mounted = [];
});

afterEach(() =>
{
	mounted.forEach((viewer) => viewer.dispose());
	mounted = [];
	// The statics are page-wide by design, so a test that moved one has to put
	// it back or the next file inherits it.
	resetAll();
});

describe('the container', () =>
{
	it('holds services and an id', () =>
	{
		const runtime = new DesignRuntime();

		expect(typeof runtime.id).toBe('string');
		expect(runtime.id.length).toBeGreaterThan(0);
		expect(runtime.configuration).toBeInstanceOf(Configuration);
		expect(runtime.dimensioning).toBeInstanceOf(Dimensioning);
		expect(runtime.renderProfile).toBeTruthy();
		expect(typeof runtime.resources.register).toBe('function');
		expect(typeof runtime.loadSession.begin).toBe('function');
	});

	it('holds no design data', () =>
	{
		// The line A4 is not allowed to cross. A runtime that knows what is in the
		// document stops being a container and starts being the thing every model
		// class wants a reference to.
		const runtime = new DesignRuntime();
		['floorplan', 'model', 'scene', 'corners', 'walls', 'rooms', 'items'].forEach((forbidden) =>
		{
			expect(runtime[forbidden]).toBeUndefined();
		});
	});

	it('gives every document a distinct id, and keeps one it is given', () =>
	{
		expect(new DesignRuntime().id).not.toBe(new DesignRuntime().id);
		expect(new DesignRuntime({id: 'left-hand-plan'}).id).toBe('left-hand-plan');
	});
});

describe('the module default is a runtime', () =>
{
	it('carries the module services by identity, not by copy', () =>
	{
		// Task 2, and the whole compatibility story. If any of these were a copy,
		// every `Configuration.` and `Dimensioning.` call site in the library would
		// be reading different state from the one an embedder writes.
		expect(defaultRuntime.configuration).toBe(defaultConfiguration);
		expect(defaultRuntime.dimensioning).toBe(defaultDimensioning);
		expect(defaultRuntime.renderProfile).toBe(renderProfile);
	});

	it('is the object `config` and `wallInformation` are the live data of', () =>
	{
		expect(defaultRuntime.configuration.getData()).toBe(config);
		expect(defaultRuntime.configuration.wallInformation).toBe(wallInformation);
	});

	it('a runtime asked for nothing shares all three', () =>
	{
		// Shared settings, own lifetime. A caller wanting an isolated document has
		// not thereby asked to stop following the page's units.
		const runtime = new DesignRuntime();
		expect(runtime.configuration).toBe(defaultConfiguration);
		expect(runtime.dimensioning).toBe(defaultDimensioning);
		expect(runtime.renderProfile).toBe(renderProfile);
		expect(runtime.loadSession).not.toBe(defaultRuntime.loadSession);
		expect(runtime.resources).not.toBe(defaultRuntime.resources);
	});

	it('a runtime given a configuration gets a dimensioning bound to it', () =>
	{
		const runtime = new DesignRuntime({configuration: new Configuration({dimUnit: dimMeter})});

		expect(runtime.dimensioning).not.toBe(defaultDimensioning);
		expect(runtime.dimensioning.configuration).toBe(runtime.configuration);
		expect(runtime.dimensioning.cmToMeasure(400)).toBe('4m');
		expect(Dimensioning.cmToMeasure(400)).toBe('400cm');
	});
});

describe('every static still reads what it always read', () =>
{
	it('through the default runtime, which is where they now live', () =>
	{
		Configuration.setValue(scale, 3);
		expect(defaultRuntime.configuration.getNumericValue(scale)).toBe(3);
		expect(Configuration.getNumericValue(scale)).toBe(3);

		defaultRuntime.configuration.setValue(scale, 5);
		expect(Configuration.getNumericValue(scale)).toBe(5);
	});

	it('and a document with its own settings does not move them', () =>
	{
		// The P7 claim, restated at runtime level: constructing a document with a
		// configuration of its own must not re-unitise the page.
		const own = new DesignRuntime({configuration: new Configuration({dimUnit: dimMeter, wallHeight: 300})});
		own.configuration.setValue(configWallHeight, 320);

		expect(Configuration.getNumericValue(configWallHeight)).toBe(250);
		expect(Configuration.getStringValue(configDimUnit)).toBe(dimCentiMeter);
		expect(own.configuration.getNumericValue(configWallHeight)).toBe(320);
	});

	it('and a document with its own profile does not move the shared one', () =>
	{
		const own = new DesignRuntime({renderProfile: createRenderProfile(RENDER_STUDIO)});

		expect(isStudio(own.renderProfile)).toBe(true);
		expect(renderProfile.mode).toBe(RENDER_CLASSIC);
		expect(isStudio(defaultRuntime.renderProfile)).toBe(false);
	});
});

describe('runtimeOf and configurationOf cannot disagree', () =>
{
	it('falls back exactly where configurationOf falls back', () =>
	{
		[null, undefined, {}].forEach((owner) =>
		{
			expect(runtimeOf(owner)).toBe(defaultRuntime);
			expect(configurationOf(owner)).toBe(defaultConfiguration);
		});
	});

	it('answers the same question the same way for everything the library builds', () =>
	{
		// The table is the test. Each of these is an owner some call site passes to
		// `configurationOf` - a Floorplan from `Corner`, a Floorplan from `Wall`,
		// and the objects above them - and for each one the two accessors have to
		// resolve to the same Configuration object.
		const own = new Configuration({dimUnit: dimMeter});
		const runtime = new DesignRuntime({configuration: own});

		const owners = [
			new Floorplan(),
			new Floorplan(own),
			new Floorplan(runtime),
			new Model('/textures/'),
			new Model('/textures/', own),
			new Model('/textures/', runtime),
		];

		owners.forEach((owner) =>
		{
			expect(configurationOf(owner)).toBe(runtimeOf(owner).configuration);
		});

		// And each got the configuration it was asked for, which is what makes the
		// agreement above worth anything - two accessors that both answered
		// `defaultConfiguration` for everything would also agree.
		expect(owners[1].configuration).toBe(own);
		expect(owners[2].configuration).toBe(own);
		expect(owners[5].configuration).toBe(own);
		expect(owners[0].configuration).toBe(defaultConfiguration);
	});

	it('a corner with no floorplan reads the page, as it always did', () =>
	{
		const orphan = new Corner(null, 0, 0);
		expect(configurationOf(orphan.floorplan)).toBe(defaultConfiguration);
		expect(runtimeOf(orphan.floorplan)).toBe(defaultRuntime);
		expect(orphan.elevation).toBe(Configuration.getNumericValue(configWallHeight));
	});

	it('and the one shape where they differ is the pre-A4 one, on purpose', () =>
	{
		// An object literal carrying a bare configuration is not something the
		// library builds; it is a hand-made owner from before runtimes existed.
		// `configurationOf` still honours it - that is P7's contract and
		// tests/instance-state.test.js pins it - and `runtimeOf` puts it on the
		// page's runtime, because it has no document of its own to be on.
		const own = new Configuration();
		const legacy = {configuration: own};

		expect(configurationOf(legacy)).toBe(own);
		expect(runtimeOf(legacy)).toBe(defaultRuntime);
	});
});

describe('resolving a constructor argument', () =>
{
	it('is idempotent for a runtime', () =>
	{
		const runtime = new DesignRuntime();
		expect(resolveRuntime(runtime)).toBe(runtime);
	});

	it('wraps a bare Configuration, keeping it by identity', () =>
	{
		const own = new Configuration({dimUnit: dimMeter});
		const runtime = resolveRuntime(own);

		expect(runtime).toBeInstanceOf(DesignRuntime);
		expect(runtime.configuration).toBe(own);
	});

	it('gives a document with no argument its own runtime, not the default one', () =>
	{
		// Shared settings, own lifetime - and this is the assertion that pins the
		// difference. The first version of A4 returned `defaultRuntime` here, which
		// looked harmless and is the subject of the next test.
		const runtime = resolveRuntime(null);

		expect(runtime).not.toBe(defaultRuntime);
		expect(runtime.configuration).toBe(defaultConfiguration);
		expect(runtime.renderProfile).toBe(renderProfile);
	});

	it('so two documents built with no arguments do not share a load session', () =>
	{
		// The regression the suite caught while A4 was being written, and the
		// reason the rule above is what it is. `Model.loadDocument` calls
		// `loadSession.begin()`, which marks everything in flight as unwanted. On a
		// shared session, opening a design in one viewer abandons the furniture
		// still arriving in the other - a fresh instance of the very finding.
		const first = new Model('/textures/');
		const second = new Model('/textures/');

		expect(first.scene.loadSession).not.toBe(second.scene.loadSession);

		second.scene.setItemLoader(() => {});
		second.scene.loadSession.started();
		expect(second.scene.loadSession.stats().inFlight).toBe(1);

		first.scene.setItemLoader(() => {});
		first.loadSerialized(DESIGN);

		expect(second.scene.loadSession.stats().inFlight).toBe(1);
		expect(second.scene.loadSession.stats().aborted).toBe(0);
	});

	it('and one document has one runtime from top to bottom', () =>
	{
		const runtime = new DesignRuntime();
		const model = new Model('/textures/', runtime);

		expect(model.runtime).toBe(runtime);
		expect(model.floorplan.runtime).toBe(runtime);
		expect(model.scene.runtime).toBe(runtime);
		expect(model.scene.loadSession).toBe(runtime.loadSession);
	});
});

describe('the 3D view is on the document it is showing', () =>
{
	it('Main, Floorplan3D and every Edge reach the same runtime', () =>
	{
		const viewer = mountViewer();
		viewer.model.loadSerialized(DESIGN);

		expect(viewer.three.runtime).toBe(viewer.model.runtime);
		expect(viewer.three.floorplan.runtime).toBe(viewer.model.runtime);
		expect(viewer.three.floorplan.edges.length).toBeGreaterThan(0);
		viewer.three.floorplan.edges.forEach((edge) =>
		{
			expect(edge.runtime).toBe(viewer.model.runtime);
		});
	});

	it('and draws with that document\'s profile', () =>
	{
		const studio = new DesignRuntime({renderProfile: createRenderProfile(RENDER_STUDIO)});
		const classic = mountViewer();
		const lit = mountViewer({runtime: studio});

		expect(isStudio(lit.three.renderProfile)).toBe(true);
		expect(isStudio(classic.three.renderProfile)).toBe(false);
		expect(classic.three.renderProfile).toBe(renderProfile);
	});
});

describe('what a document is holding', () =>
{
	it('climbs as the plan is drawn and falls as it is torn down', () =>
	{
		const viewer = mountViewer();
		expect(viewer.runtime.stats().resources).toBe(0);

		viewer.model.loadSerialized(DESIGN);
		const drawn = viewer.runtime.stats();
		expect(drawn.registries).toBeGreaterThan(0);
		expect(drawn.resources).toBeGreaterThan(0);
		expect(drawn.handles).toBeGreaterThanOrEqual(drawn.resources);

		viewer.three.dispose();
		const torn = viewer.runtime.stats();
		expect(torn.resources).toBe(0);
		// Every edge handed its registry back, so the document is not tracking a
		// pile of spent ones either.
		expect(torn.registries).toBe(0);
	});

	it('does not accumulate spent registries across rebuilds', () =>
	{
		// `Edge.remove()` forgets its registry. Without that, a document
		// re-deriving its rooms would leave one empty tracked registry per wall
		// face per rebuild - a smaller leak than A0's, and still one.
		const viewer = mountViewer();
		viewer.model.loadSerialized(DESIGN);
		const first = viewer.runtime.stats();

		for (let i = 0; i < 5; i++)
		{
			viewer.model.floorplan.update();
		}

		const after = viewer.runtime.stats();
		expect(after.registries).toBe(first.registries);
		expect(after.resources).toBe(first.resources);
	});

	it('reports the session and whether it has been disposed', () =>
	{
		const runtime = new DesignRuntime();
		expect(runtime.stats().disposed).toBe(false);
		expect(runtime.stats().session.settled).toBe(true);
		expect(runtime.stats().id).toBe(runtime.id);

		runtime.dispose();
		expect(runtime.stats().disposed).toBe(true);
	});
});

describe('disposal is scoped to one document', () =>
{
	it('releases this document\'s registries and abandons its loads', () =>
	{
		const runtime = new DesignRuntime();
		const registry = runtime.registry();
		let disposed = 0;
		registry.register({dispose: () => {disposed += 1;}});
		runtime.loadSession.started();

		expect(runtime.stats().resources).toBe(1);
		expect(runtime.stats().session.inFlight).toBe(1);

		runtime.dispose();

		expect(disposed).toBe(1);
		expect(runtime.stats().resources).toBe(0);
		expect(runtime.stats().session.settled).toBe(true);
		expect(runtime.stats().session.aborted).toBe(1);
	});

	it('is safe to call twice', () =>
	{
		const runtime = new DesignRuntime();
		runtime.registry().register({dispose: () => {}});
		runtime.dispose();
		expect(() => runtime.dispose()).not.toThrow();
		expect(runtime.stats().resources).toBe(0);
	});

	it('and leaves the other document exactly where it was', () =>
	{
		// The H-1 finding at isolation level, asked headlessly. The browser tier
		// asks the same question of `renderer.info.memory` and of pixels.
		const a = mountViewer();
		const b = mountViewer();
		a.model.loadSerialized(DESIGN);
		b.model.loadSerialized(DESIGN);

		const before = b.runtime.stats();
		expect(before.resources).toBeGreaterThan(0);

		a.three.dispose();
		a.runtime.dispose();

		const after = b.runtime.stats();
		expect(after.resources).toBe(before.resources);
		expect(after.handles).toBe(before.handles);
		expect(after.registries).toBe(before.registries);
		expect(after.disposed).toBe(false);
		expect(after.session.generation).toBe(before.session.generation);
		expect(b.three.floorplan.edges.length).toBeGreaterThan(0);
	});

	it('in either order', () =>
	{
		const a = mountViewer();
		const b = mountViewer();
		a.model.loadSerialized(DESIGN);
		b.model.loadSerialized(DESIGN);

		const aBefore = a.runtime.stats();

		b.three.dispose();
		b.runtime.dispose();

		expect(a.runtime.stats().resources).toBe(aBefore.resources);
		expect(a.runtime.stats().disposed).toBe(false);

		a.three.dispose();
		a.runtime.dispose();

		expect(a.runtime.stats().resources).toBe(0);
		expect(b.runtime.stats().resources).toBe(0);
	});
});

describe('an embedder\'s runtime belongs to the embedder', () =>
{
	it('a viewer disposes the runtime it built', async () =>
	{
		const {BlueprintJS} = await import('../src/scripts/blueprint.js');
		const host = document.createElement('div');
		host.innerHTML = '<canvas></canvas><div></div>';
		document.body.appendChild(host);
		setLayout(host.querySelector('div'), {left: 0, top: 0, width: 800, height: 600});
		const observer = installResizeObserver(window);
		const pointerApis = installPointerApis(window);
		Main.setRendererFactory(() => createRendererStub());

		const blueprint = new BlueprintJS({
			floorplannerElement: host.querySelector('canvas'),
			threeElement: host.querySelector('div'),
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			widget: true,
		});

		expect(blueprint.runtime).not.toBe(defaultRuntime);
		expect(blueprint.configuration).toBe(blueprint.runtime.configuration);

		blueprint.dispose();
		expect(blueprint.runtime.stats().disposed).toBe(true);

		Main.setRendererFactory(null);
		host.remove();
		pointerApis.restore();
		observer.restore();
	});

	it('and never one it was handed', async () =>
	{
		const {BlueprintJS} = await import('../src/scripts/blueprint.js');
		const runtime = new DesignRuntime();
		const host = document.createElement('div');
		host.innerHTML = '<canvas></canvas><div></div>';
		document.body.appendChild(host);
		setLayout(host.querySelector('div'), {left: 0, top: 0, width: 800, height: 600});
		const observer = installResizeObserver(window);
		const pointerApis = installPointerApis(window);
		Main.setRendererFactory(() => createRendererStub());

		const blueprint = new BlueprintJS({
			floorplannerElement: host.querySelector('canvas'),
			threeElement: host.querySelector('div'),
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			widget: true,
			runtime: runtime,
		});

		expect(blueprint.runtime).toBe(runtime);
		blueprint.dispose();
		// Still open for business: the embedder may be about to hand it to a
		// second viewer, and it is not this one's to close.
		expect(runtime.stats().disposed).toBe(false);

		Main.setRendererFactory(null);
		host.remove();
		pointerApis.restore();
		observer.restore();
	});

	it('and the page-wide default is nobody\'s to dispose', () =>
	{
		// Nothing constructed by the library resolves to it, so no viewer can
		// dispose it by accident. Checked rather than assumed: this is the object
		// every static reads through.
		const model = new Model('/textures/');
		expect(model.runtime).not.toBe(defaultRuntime);
		expect(runtimeOf(model.floorplan)).not.toBe(defaultRuntime);
		expect(defaultRuntime.stats().disposed).toBe(false);
	});
});

describe('a registry handed out by a runtime', () =>
{
	it('is the document\'s to count and the owner\'s to release', () =>
	{
		const runtime = new DesignRuntime();
		const registry = runtime.registry();
		const geometry = {dispose: () => {}};

		registry.register(geometry);
		registry.register(geometry);
		expect(runtime.stats().resources).toBe(1);
		expect(runtime.stats().handles).toBe(2);

		registry.releaseAll();
		expect(runtime.stats().resources).toBe(0);
		expect(runtime.stats().registries).toBe(1);

		runtime.forget(registry);
		expect(runtime.stats().registries).toBe(0);
	});

	it('and forgetting one the runtime never handed out is harmless', () =>
	{
		const runtime = new DesignRuntime();
		expect(() => runtime.forget(null)).not.toThrow();
		expect(() => runtime.forget(new DesignRuntime().registry())).not.toThrow();
	});
});

describe('an Edge built outside a Floorplan3D still finds a runtime', () =>
{
	it('through the half edge it draws', () =>
	{
		// `Edge` is public API and its four-argument form has to keep working. The
		// derivation has to reach the same runtime `Floorplan3D` would have passed,
		// or a document would be holding meshes it cannot count.
		const runtime = new DesignRuntime();
		const model = new Model('/textures/', runtime);
		model.scene.setItemLoader(() => {});
		model.loadSerialized(DESIGN);

		const halfEdge = model.floorplan.wallEdges()[0];
		expect(halfEdge).toBeTruthy();
		expect(runtimeOf(halfEdge.wall.start.floorplan)).toBe(runtime);

		const controls = new EventDispatcher();
		controls.object = {position: {clone: () => ({sub: () => ({normalize: () => ({x: 0, y: 1, z: 0})})})}};
		const scene = {add: () => {}, remove: () => {}};

		return import('../src/scripts/three/edge.js').then(({Edge}) =>
		{
			const before = runtime.stats().resources;
			const edge = new Edge(scene, halfEdge, controls, undefined);

			expect(edge.runtime).toBe(runtime);
			expect(runtime.stats().resources).toBeGreaterThan(before);

			edge.remove();
			expect(runtime.stats().resources).toBe(before);
		});
	});
});
