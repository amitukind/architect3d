// @vitest-environment jsdom
/**
 * Two designs on one page, each with its own settings (RM-002 R-02, P7).
 *
 * ## What this file is for
 *
 * R-02's headline claim was that four pieces of module-level mutable state made
 * a second `BlueprintJS` impossible: change one viewer's units, scale, grid
 * spacing, snap tolerance, wall defaults or render profile, and the other moved
 * with it. Everything else in P7 is plumbing; this is the file that says
 * whether the plumbing bought anything.
 *
 * So every test here is written as **a pair that must not interfere**. Not
 * "instance A reads 250" - that would pass against the singleton too - but
 * "A reads 250 while B reads 300", which cannot.
 *
 * ## And the half that must not have changed
 *
 * The other half of the design is that the statics keep working, because 224
 * `Dimensioning.` call sites and 46 `Configuration.` reads in `floorplanner/`
 * were never converted and were never meant to be. The `describe` at the end
 * pins that: the statics read the shared default, the exported `config` and
 * `wallInformation` objects are still that default's own by identity, and a
 * Floorplan constructed with no argument still shares the page.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {Floorplan} from '../src/scripts/model/floorplan.js';
import {Model} from '../src/scripts/model/model.js';
import {Main} from '../src/scripts/three/main.js';
import {BlueprintJS} from '../src/scripts/blueprint.js';
import {Floorplanner2D} from '../src/scripts/floorplanner/floorplanner.js';
import {
	Configuration, configDimUnit, configWallHeight,
	scale, config, wallInformation, defaultConfiguration, configurationOf,
} from '../src/scripts/core/configuration.js';
import {Dimensioning, defaultDimensioning} from '../src/scripts/core/dimensioning.js';
import {dimCentiMeter, dimMeter, dimFeetAndInch} from '../src/scripts/core/units.js';
import {EVENT_CONFIG_CHANGED} from '../src/scripts/core/events.js';
import {createRenderProfile, renderProfile, RENDER_CLASSIC, RENDER_STUDIO, isStudio} from '../src/scripts/core/render_profile.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installListenerCounter, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';

let canvasStub;
let observer;
let listeners;
let pointers;

function buildDom(id)
{
	const viewer = document.createElement('div');
	viewer.id = `viewer-${id}`;
	document.body.appendChild(viewer);
	setLayout(viewer, {left: 0, top: 0, width: 800, height: 600});

	const wrapper = document.createElement('div');
	const canvas = document.createElement('canvas');
	canvas.id = `plan-${id}`;
	wrapper.appendChild(canvas);
	document.body.appendChild(wrapper);
	setLayout(wrapper, {left: 0, top: 0, width: 800, height: 600});
	setLayout(canvas, {left: 0, top: 0, width: 800, height: 600});

	return {viewer, canvas};
}

beforeEach(() =>
{
	resetAll();
	document.body.innerHTML = '';
	window.innerWidth = 1024;
	window.innerHeight = 768;
	listeners = installListenerCounter(window);
	canvasStub = installCanvas2D(window);
	observer = installResizeObserver(window);
	pointers = installPointerApis(window);
	Main.setRendererFactory(() => createRendererStub());
});

afterEach(() =>
{
	Main.setRendererFactory(null);
	pointers.restore();
	observer.restore();
	canvasStub.restore();
	listeners.restore();
	document.body.innerHTML = '';
	// Put the shared profile back: a test that gives a Main its own must not be
	// able to leave the page-wide one switched.
	renderProfile.mode = RENDER_CLASSIC;
});

describe('two designs, two configurations', () =>
{
	it('a wall built in each takes that design\'s own defaults', () =>
	{
		const studio = new Floorplan(new Configuration({wallHeight: 300, wallThickness: 25}));
		const cottage = new Floorplan(new Configuration({wallHeight: 210, wallThickness: 8}));

		const wallOf = (plan) =>
		{
			const a = plan.newCorner(0, 0);
			const b = plan.newCorner(400, 0);
			return plan.newWall(a, b);
		};

		const tall = wallOf(studio);
		const low = wallOf(cottage);

		// The pair is the assertion. Either number alone would pass against the
		// singleton, because the singleton would simply hold whichever was set
		// last - and before P7 that is exactly what happened.
		expect(tall.height).toBe(300);
		expect(tall.thickness).toBe(25);
		expect(low.height).toBe(210);
		expect(low.thickness).toBe(8);
	});

	it('a corner takes its elevation from the plan it belongs to', () =>
	{
		const tall = new Floorplan(new Configuration({wallHeight: 400}));
		const low = new Floorplan(new Configuration({wallHeight: 180}));

		expect(tall.newCorner(0, 0).elevation).toBe(400);
		expect(low.newCorner(0, 0).elevation).toBe(180);
	});

	it('changing one design\'s settings afterwards leaves the other alone', () =>
	{
		const a = new Floorplan(new Configuration());
		const b = new Floorplan(new Configuration());

		a.configuration.setValue(configWallHeight, 500);

		expect(a.newCorner(0, 0).elevation).toBe(500);
		expect(b.newCorner(0, 0).elevation).toBe(250);
		// And the page-wide default, which neither of them is, is untouched.
		expect(Configuration.getNumericValue(configWallHeight)).toBe(250);
	});

	it('EVENT_CONFIG_CHANGED is per configuration, not per page', () =>
	{
		// Before P7 there was one dispatcher for the whole page, so a settings
		// panel bound to one design would have woken up for the other's changes -
		// and redrawn a plan that had not moved.
		const a = new Configuration();
		const b = new Configuration();
		const heardByA = [];
		const heardByB = [];
		const heardByDefault = [];

		a.addEventListener(EVENT_CONFIG_CHANGED, (event) => heardByA.push(event.key));
		b.addEventListener(EVENT_CONFIG_CHANGED, (event) => heardByB.push(event.key));
		const onDefault = (event) => heardByDefault.push(event.key);
		Configuration.addEventListener(EVENT_CONFIG_CHANGED, onDefault);

		a.setValue(scale, 3);

		expect(heardByA).toEqual([scale]);
		expect(heardByB).toEqual([]);
		expect(heardByDefault).toEqual([]);

		Configuration.removeEventListener(EVENT_CONFIG_CHANGED, onDefault);
	});

	it('wall-measurement labels belong to a configuration too', () =>
	{
		// The fifth singleton, which R-02's list of four missed.
		const metric = new Configuration();
		const imperial = new Configuration({wallInformation: {exterior: true, exteriorlabel: 'out:'}});

		expect(metric.wallInformation.exterior).toBe(false);
		expect(imperial.wallInformation.exterior).toBe(true);
		expect(imperial.wallInformation.exteriorlabel).toBe('out:');
		// Defaults still fill in around the override.
		expect(imperial.wallInformation.midline).toBe(true);
	});
});

describe('two designs, two units', () =>
{
	it('measure simultaneously in different units', () =>
	{
		const metres = new Dimensioning(new Configuration({dimUnit: dimMeter}));
		const feet = new Dimensioning(new Configuration({dimUnit: dimFeetAndInch}));

		expect(metres.cmToMeasure(250)).toBe('2.5m');
		expect(feet.cmToMeasure(250)).toBe('8\'2"');
		// Interleaved, because a stateful implementation could pass the above by
		// switching a global between the two calls.
		expect(metres.cmToMeasure(100)).toBe('1m');
		expect(feet.cmToMeasure(100)).toBe('3\'3"');
		expect(metres.cmToMeasure(250)).toBe('2.5m');
	});

	it('convert pixels at their own zoom', () =>
	{
		const zoomedIn = new Dimensioning(new Configuration({scale: 4}));
		const zoomedOut = new Dimensioning(new Configuration({scale: 1}));

		expect(zoomedIn.cmToPixel(100)).toBeCloseTo(zoomedOut.cmToPixel(100) * 4, 9);
		// And the un-scaled form ignores both, as it always did.
		expect(zoomedIn.cmToPixel(100, false)).toBeCloseTo(zoomedOut.cmToPixel(100, false), 9);
	});

	it('a Floorplan carries one bound to its own configuration', () =>
	{
		const plan = new Floorplan(new Configuration({dimUnit: dimMeter}));
		expect(plan.dimensioning.cmToMeasure(250)).toBe('2.5m');
		expect(Dimensioning.cmToMeasure(250)).toBe('250cm');
	});
});

describe('two 2D views, two scales', () =>
{
	it('convert plan coordinates through their own configuration', () =>
	{
		// The 46 Configuration reads and 45 Dimensioning calls in floorplanner/
		// now resolve through the plan being drawn. This is what that bought.
		const one = buildDom('a');
		const two = buildDom('b');

		const planA = new Floorplan(new Configuration({scale: 1}));
		const planB = new Floorplan(new Configuration({scale: 4}));

		const viewA = new Floorplanner2D(one.canvas, planA);
		const viewB = new Floorplanner2D(two.canvas, planB);

		viewA.originX = 0;
		viewB.originX = 0;

		expect(viewB.convertX(100)).toBeCloseTo(viewA.convertX(100) * 4, 9);

		viewA.dispose();
		viewB.dispose();
	});

	it('take their wall thickness from the plan they draw', () =>
	{
		const one = buildDom('a');
		const two = buildDom('b');

		const thin = new Floorplanner2D(one.canvas, new Floorplan(new Configuration({wallThickness: 5})));
		const thick = new Floorplanner2D(two.canvas, new Floorplan(new Configuration({wallThickness: 40})));

		expect(thick.wallWidth).toBeCloseTo(thin.wallWidth * 8, 9);

		thin.dispose();
		thick.dispose();
	});
});

describe('two viewers, two looks', () =>
{
	it('a Main given its own profile does not switch the page', () =>
	{
		const {viewer} = buildDom('a');
		const profile = createRenderProfile(RENDER_STUDIO);
		const three = new Main(new Model(), viewer, null, {renderProfile: profile});

		expect(three.renderProfile).toBe(profile);
		expect(isStudio(three.renderProfile)).toBe(true);
		// The shared profile - and therefore any other viewer on the page, and
		// the parity grid - is untouched.
		expect(isStudio()).toBe(false);
		expect(renderProfile.mode).toBe(RENDER_CLASSIC);

		three.dispose();
	});

	it('applyRenderProfile writes the viewer\'s own profile, not the shared one', () =>
	{
		const {viewer} = buildDom('a');
		const profile = createRenderProfile(RENDER_CLASSIC);
		const three = new Main(new Model(), viewer, null, {renderProfile: profile});

		three.applyRenderProfile(RENDER_STUDIO);

		expect(profile.mode).toBe(RENDER_STUDIO);
		expect(profile.wallRoughness).toBeCloseTo(0.94, 9);
		expect(renderProfile.mode).toBe(RENDER_CLASSIC);

		three.dispose();
	});

	it('hands the profile down to the lights and the skybox it builds', () =>
	{
		// The profile is only useful if it reaches the objects that draw. Lights
		// and Skybox are built by Main; Edges and Floors are built by Floorplan3D,
		// which is handed it in turn.
		const {viewer} = buildDom('a');
		const profile = createRenderProfile(RENDER_STUDIO);
		const three = new Main(new Model(), viewer, null, {renderProfile: profile});

		expect(three.lights.renderProfile).toBe(profile);
		expect(three.skybox.renderProfile).toBe(profile);
		expect(three.floorplan.renderProfile).toBe(profile);

		three.dispose();
	});
});

describe('two BlueprintJS instances', () =>
{
	it('constructing the second no longer re-unitises the first', () =>
	{
		// The purest form of the finding, and the reason it was rated high.
		// `BlueprintJS`'s constructor has always written the display unit, so
		// against the shared configuration merely *building* a second viewer
		// silently changed the first one's units under it - no event, no warning,
		// and every dimension label on screen wrong until something redrew.
		const one = buildDom('a');
		const first = new BlueprintJS({
			floorplannerElement: one.canvas,
			threeElement: one.viewer,
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			widget: false,
			configuration: new Configuration({dimUnit: dimCentiMeter}),
		});
		// Its own constructor set metres, as it does for everyone.
		first.configuration.setValue(configDimUnit, dimCentiMeter);
		expect(first.model.floorplan.dimensioning.cmToMeasure(250)).toBe('250cm');

		const two = buildDom('b');
		const second = new BlueprintJS({
			floorplannerElement: two.canvas,
			threeElement: two.viewer,
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			widget: false,
			configuration: new Configuration(),
		});

		expect(second.model.floorplan.dimensioning.cmToMeasure(250)).toBe('2.5m');
		expect(first.model.floorplan.dimensioning.cmToMeasure(250)).toBe('250cm');

		first.dispose();
		second.dispose();
	});

	it('threads one configuration all the way from the option to the wall', () =>
	{
		const one = buildDom('a');
		const configuration = new Configuration({wallHeight: 275});
		const blueprint = new BlueprintJS({
			floorplannerElement: one.canvas,
			threeElement: one.viewer,
			threeCanvasElement: null,
			textureDir: 'models/textures/',
			widget: false,
			configuration,
		});

		expect(blueprint.configuration).toBe(configuration);
		expect(blueprint.model.configuration).toBe(configuration);
		expect(blueprint.model.floorplan.configuration).toBe(configuration);
		expect(blueprint.floorplanner.configuration).toBe(configuration);
		expect(blueprint.model.floorplan.newCorner(0, 0).elevation).toBe(275);

		blueprint.dispose();
	});
});

describe('the shared default, which nearly everything still uses', () =>
{
	it('is what the statics read and write', () =>
	{
		Configuration.setValue(scale, 7);
		expect(defaultConfiguration.getNumericValue(scale)).toBe(7);
		expect(Configuration.getNumericValue(scale)).toBe(7);

		defaultConfiguration.setValue(scale, 2);
		expect(Configuration.getNumericValue(scale)).toBe(2);
	});

	it('owns the exported config object by identity, not by copy', () =>
	{
		// Public API, re-exported by blueprint.js, and both the harness and the
		// dimensioning suite write to it directly. A copy would break all of them
		// silently - the writes would land somewhere nothing reads.
		expect(config).toBe(defaultConfiguration.getData());
		expect(wallInformation).toBe(defaultConfiguration.wallInformation);

		config.wallHeight = 321;
		expect(Configuration.getNumericValue(configWallHeight)).toBe(321);
	});

	it('is what the Dimensioning statics measure with', () =>
	{
		expect(defaultDimensioning.configuration).toBe(defaultConfiguration);

		Configuration.setValue(configDimUnit, dimMeter);
		expect(Dimensioning.cmToMeasure(250)).toBe('2.5m');
		expect(defaultDimensioning.cmToMeasure(250)).toBe('2.5m');
	});

	it('is what a Floorplan built with no argument shares', () =>
	{
		const plan = new Floorplan();
		expect(plan.configuration).toBe(defaultConfiguration);

		Configuration.setValue(configWallHeight, 199);
		expect(plan.newCorner(0, 0).elevation).toBe(199);
	});

	it('is the fallback for anything with no configuration at all', () =>
	{
		expect(configurationOf(null)).toBe(defaultConfiguration);
		expect(configurationOf(undefined)).toBe(defaultConfiguration);
		expect(configurationOf({})).toBe(defaultConfiguration);

		const own = new Configuration();
		expect(configurationOf({configuration: own})).toBe(own);
	});

	it('is what a Main built with no profile draws with', () =>
	{
		const {viewer} = buildDom('a');
		const three = new Main(new Model(), viewer, null, {});
		expect(three.renderProfile).toBe(renderProfile);
		three.dispose();
	});
});
