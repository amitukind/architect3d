// @vitest-environment jsdom
/**
 * Storeys, in the model and in the file (RM-010 G1).
 *
 * **M-26** is the metric this file carries: *a two-storey fixture saves, loads
 * and renders both levels; every existing single-level fixture is
 * byte-identical on re-save.* The rendering half needs a GPU and lives in
 * `tests/browser/levels.test.js` with M-38; the saving and loading half is a
 * string comparison and lives here, run against the real fixtures rather than
 * against a design written for the purpose.
 *
 * The other thing asserted here is G1's third acceptance line, which is
 * structural rather than behavioural: **nothing outside `Model` asks which
 * level it is on in order to work.** `model.floorplan` is a getter onto the
 * active storey, so the 2D view, the 3D view, the inspectors and the file all
 * read it exactly as they did before there were any.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

import {Model} from '../src/scripts/model/model.js';
import {Level, DEFAULT_LEVEL_HEIGHT, defaultLevelName} from '../src/scripts/model/level.js';
import {projectPlanOutline} from '../src/scripts/model/level_projection.js';
import {DesignDocument} from '../src/scripts/model/document.js';
import {STAIR_DEFAULTS} from '../src/scripts/items/stair.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D} from './helpers/dom.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');

/** The one fixture that is a building rather than a plan (RM-010 G3). */
const MULTI_LEVEL = 'three-storey.blueprint3d';

let canvasStub;

beforeEach(() =>
{
	resetAll();
	canvasStub = installCanvas2D(window);
});

afterEach(() =>
{
	canvasStub.restore();
});

/** A four-corner room, for whichever storey wants one. */
function room(size)
{
	return {
		corners: {
			c1: {x: 0, y: 0, elevation: 250},
			c2: {x: size, y: 0, elevation: 250},
			c3: {x: size, y: size, elevation: 250},
			c4: {x: 0, y: size, elevation: 250},
		},
		walls: [
			{corner1: 'c1', corner2: 'c2'}, {corner1: 'c2', corner2: 'c3'},
			{corner1: 'c3', corner2: 'c4'}, {corner1: 'c4', corner2: 'c1'},
		],
		rooms: {},
		units: 'cm',
		version: '2.0.0',
	};
}

describe('a level', () =>
{
	it('carries a floor-to-floor height and nothing about where it sits', () =>
	{
		const level = new Level();

		expect(level.height).toBe(DEFAULT_LEVEL_HEIGHT);
		expect(level.items).toEqual([]);
		// A base elevation would be a second answer to a question the list below
		// already answers, so a level does not have one.
		expect(level.base).toBeUndefined();
	});

	/**
	 * Two defaults that have to agree, asserted so that changing either one has
	 * to change the other on purpose: F3's default flight is 16 treads at 175 mm,
	 * and a default storey is 2800 floor to floor. A default stair on a default
	 * level therefore arrives at the floor above rather than near it.
	 */
	it('is exactly what a default flight of stairs climbs', () =>
	{
		expect(STAIR_DEFAULTS.treads * STAIR_DEFAULTS.rise).toBe(DEFAULT_LEVEL_HEIGHT);
	});

	it('names itself from its position, the way a building is numbered', () =>
	{
		expect(defaultLevelName(0)).toBe('Ground floor');
		expect(defaultLevelName(1)).toBe('Floor 1');
		expect(new Level(null, {name: 'Loft'}).displayName(3)).toBe('Loft');
		// Derived rather than stamped at construction: a level's position changes
		// when one below it goes, and "Floor 2" sitting on the ground is worse
		// than no name of its own.
		expect(new Level().displayName(2)).toBe('Floor 2');
	});

	it('clamps a height that is not a storey', () =>
	{
		expect(new Level(null, {height: 5}).height).toBe(100);
		expect(new Level(null, {height: 99999}).height).toBe(1000);
		expect(new Level(null, {height: 'tall'}).height).toBe(DEFAULT_LEVEL_HEIGHT);
	});
});

describe('the level list', () =>
{
	it('starts with one storey, so a design that never hears the word has one', () =>
	{
		const model = new Model('/textures/');

		expect(model.levels).toHaveLength(1);
		expect(model.activeLevelIndex).toBe(0);
		expect(model.levelBase(0)).toBe(0);
	});

	/**
	 * G1's third acceptance line. This getter is the whole of why nothing outside
	 * `Model` gained a level argument.
	 */
	it('resolves model.floorplan to the active storey', () =>
	{
		const model = new Model('/textures/');
		const ground = model.floorplan;

		model.addLevel();

		expect(model.floorplan).not.toBe(ground);
		expect(model.floorplan).toBe(model.levels[1].floorplan);
		model.setActiveLevel(0);
		expect(model.floorplan).toBe(ground);
	});

	it('derives each base from the heights below it, and never stores one', () =>
	{
		const model = new Model('/textures/');
		model.addLevel({height: 300});
		model.addLevel({height: 260});

		expect(model.levelBase(0)).toBe(0);
		expect(model.levelBase(1)).toBe(280);
		expect(model.levelBase(2)).toBe(580);

		model.setLevelHeight(0, 400);

		// Everything above moves, because nothing above holds the old number.
		expect(model.levelBase(1)).toBe(400);
		expect(model.levelBase(2)).toBe(700);
	});

	it('adds a storey directly above the active one, not on top of the building', () =>
	{
		const model = new Model('/textures/');
		model.addLevel({name: 'Top'});
		model.setActiveLevel(0);

		model.addLevel({name: 'Middle'});

		expect(model.levels.map((level, i) => level.displayName(i))).toEqual(['Ground floor', 'Middle', 'Top']);
		expect(model.activeLevelIndex).toBe(1);
	});

	it('refuses to remove the last storey, and says so rather than throwing', () =>
	{
		const model = new Model('/textures/');

		expect(model.removeLevel(0)).toBe(false);
		expect(model.levels).toHaveLength(1);

		model.addLevel();
		expect(model.removeLevel(1)).toBe(true);
		expect(model.levels).toHaveLength(1);
		expect(model.activeLevelIndex).toBe(0);
	});

	it('clamps a switch to a storey that is not there', () =>
	{
		const model = new Model('/textures/');
		model.addLevel();

		expect(model.setActiveLevel(9)).toBe(1);
		expect(model.setActiveLevel(-4)).toBe(0);
	});
});

describe('M-26 - two levels, one file', () =>
{
	it('writes no levels key for a single default storey', () =>
	{
		const model = new Model('/textures/');

		expect(Object.keys(JSON.parse(model.exportSerialized()))).toEqual(['floorplan', 'items']);
	});

	/**
	 * The byte-identity half, run against the fixtures rather than a design
	 * written for the purpose - those are what "every existing single-level
	 * fixture" means.
	 *
	 * Re-pointed rather than relaxed in G3, which added a fourth fixture that is
	 * a three-storey house. The `['floorplan', 'items']` assertion is what M-26's
	 * second half actually says - *a single-level design writes no levels key* -
	 * so it belongs to the single-level fixtures and not to the enumeration. The
	 * building gets the byte-identity half of the same claim below, where the key
	 * list it is allowed to write is stated explicitly.
	 */
	it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.blueprint3d') && name !== MULTI_LEVEL))(
		're-saves %s byte-identically, and still writes no levels key', (name) =>
		{
			const model = new Model('/textures/');
			const original = readFileSync(join(FIXTURES, name), 'utf8');

			model.loadSerialized(original);
			const once = model.exportSerialized();
			model.loadSerialized(once);

			expect(model.exportSerialized()).toBe(once);
			expect(Object.keys(JSON.parse(once))).toEqual(['floorplan', 'items']);
		});

	it('writes a levels key once there is something to say', () =>
	{
		const model = new Model('/textures/');
		model.addLevel({name: 'First floor'});

		const saved = JSON.parse(model.exportSerialized());

		expect(saved.levels).toHaveLength(2);
		// The ground floor's plan is NOT repeated inside levels[0]. That is what
		// lets a build which has never heard of storeys open a three-storey house
		// and get the ground floor rather than an error.
		expect(Object.keys(saved.levels[0])).toEqual(['name', 'height']);
		expect(saved.levels[1].floorplan).toBeTruthy();
		expect(saved.floorplan).toBeTruthy();
	});

	it('writes one even for a single storey that has been named or re-sized', () =>
	{
		const model = new Model('/textures/');
		model.setLevelHeight(0, 320);

		const saved = JSON.parse(model.exportSerialized());

		// Otherwise renaming the ground floor would be an edit that does not
		// survive a save.
		expect(saved.levels).toEqual([{name: 'Ground floor', height: 320}]);
	});

	it('round-trips a two-storey design, plans and all', () =>
	{
		const model = new Model('/textures/');
		const design = JSON.stringify({
			floorplan: room(400),
			items: [],
			levels: [
				{name: 'Ground floor', height: 280},
				{name: 'First floor', height: 300, floorplan: room(500), items: []},
			],
		});

		model.loadSerialized(design);

		expect(model.levels).toHaveLength(2);
		expect(model.levels[1].height).toBe(300);
		expect(model.levels[0].floorplan.getCorners()).toHaveLength(4);
		expect(model.levels[1].floorplan.getCorners()).toHaveLength(4);
		expect(Math.max(...model.levels[1].floorplan.getCorners().map((c) => c.x))).toBe(500);

		const saved = model.exportSerialized();
		model.loadSerialized(saved);
		expect(model.exportSerialized()).toBe(saved);
	});

	it('shrinks back to one storey when a one-storey design is loaded', () =>
	{
		const model = new Model('/textures/');
		model.addLevel();
		model.addLevel();

		model.loadSerialized(JSON.stringify({floorplan: room(400), items: []}));

		expect(model.levels).toHaveLength(1);
		expect(model.activeLevelIndex).toBe(0);
	});

	/**
	 * The 2D view holds `model.floorplan`, which is a level's `Floorplan` object.
	 * Rebuilding the level list on every load would leave the plan drawing a
	 * design nobody is editing - RM-008 T-1's failure in a new place.
	 */
	it('reuses the level objects across a load, so the plan keeps its floorplan', () =>
	{
		const model = new Model('/textures/');
		const ground = model.floorplan;

		model.loadSerialized(JSON.stringify({floorplan: room(400), items: []}));

		expect(model.floorplan).toBe(ground);
	});

	it('keeps the active storey across a load, which is what undo needs', () =>
	{
		const model = new Model('/textures/');
		model.addLevel();
		const two = model.exportSerialized();

		model.loadSerialized(two);

		// Undo is a document load; one that threw you to the ground floor on every
		// keystroke would be unusable. Deliberately not persisted - which storey
		// you are looking at is not a property of the building.
		expect(model.activeLevelIndex).toBe(1);
		expect(JSON.parse(two).activeLevel).toBeUndefined();
	});
});

describe('the document', () =>
{
	it('reads a levels key and reports how many', () =>
	{
		const parsed = DesignDocument.parse(JSON.stringify({
			floorplan: room(400),
			items: [],
			levels: [{name: 'Ground floor', height: 280}, {name: 'First', height: 280, floorplan: room(400), items: []}],
		}));

		expect(parsed.errors).toEqual([]);
		expect(parsed.document.summary().levels).toBe(2);
	});

	it('says one for a design that says nothing about storeys', () =>
	{
		const parsed = DesignDocument.parse(JSON.stringify({floorplan: room(400), items: []}));

		expect(parsed.document.levels).toBeNull();
		expect(parsed.document.summary().levels).toBe(1);
	});

	it('checks an upper storey the same way it checks the ground floor', () =>
	{
		const bad = DesignDocument.parse(JSON.stringify({
			floorplan: room(400),
			items: [],
			levels: [
				{name: 'Ground floor', height: 280},
				{name: 'First', height: -5, floorplan: room(400), items: [{item_name: 'Mystery', item_type: 1}]},
			],
		}));

		expect(bad.errors.map((error) => error.path)).toEqual([
			'levels[1].height', 'levels[1].items[0].model_url',
		]);
	});

	it('warns rather than refuses when levels[0] repeats the ground floor', () =>
	{
		const parsed = DesignDocument.parse(JSON.stringify({
			floorplan: room(400),
			items: [],
			levels: [{name: 'Ground floor', height: 280, floorplan: room(400), items: []}],
		}));

		expect(parsed.errors).toEqual([]);
		expect(parsed.warnings.map((warning) => warning.path)).toContain('levels[0]');
	});
});

describe('the storey below, as the plan sees it', () =>
{
	it('describes walls and room outlines and nothing else', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({floorplan: room(400), items: []}));

		const ghost = projectPlanOutline(model.floorplan);

		expect(ghost.walls).toHaveLength(4);
		expect(ghost.walls[0]).toEqual({ax: 0, ay: 0, bx: 400, by: 0, thickness: 10});
		expect(ghost.rooms).toHaveLength(1);
		// No labels, no dimensions, no furniture: a ghost says where the walls
		// downstairs are and stops.
		expect(Object.keys(ghost)).toEqual(['walls', 'rooms']);
	});

	it('is null for an empty plan, because an underlay with nothing on it is not one', () =>
	{
		expect(projectPlanOutline(new Model('/textures/').floorplan)).toBeNull();
		expect(projectPlanOutline(null)).toBeNull();
	});

	it('is handed to the storey above and never to the ground floor', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({floorplan: room(400), items: []}));

		expect(model.floorplan.ghostPlan).toBeNull();

		model.addLevel();

		expect(model.floorplan.ghostPlan).toBeTruthy();
		expect(model.floorplan.ghostPlan.walls).toHaveLength(4);

		model.setActiveLevel(0);
		expect(model.floorplan.ghostPlan).toBeNull();
	});

	it('is a copy, so the plan cannot draw a state it was not made from', () =>
	{
		const model = new Model('/textures/');
		model.loadSerialized(JSON.stringify({floorplan: room(400), items: []}));
		model.addLevel();

		const before = model.floorplan.ghostPlan.walls[0].bx;
		model.levels[0].floorplan.getCorners()[1].x = 900;

		expect(model.floorplan.ghostPlan.walls[0].bx).toBe(before);
	});
});
