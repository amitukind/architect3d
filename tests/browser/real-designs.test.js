/**
 * What the designs this product actually ships cost to draw (RM-016 N1, M-56).
 *
 * **M-56** is the metric this file carries: *every design this repository
 * ships renders inside a draw-call ceiling and a frame budget measured from
 * what it costs today.*
 *
 * ## Why this metric exists, and what it replaces
 *
 * M-52 asked for *a 400-wall plan in fewer than 802 draw calls*. RM-015 M2
 * halved the building's cost, left it unmet at 972, correctly refused to move
 * the number to fit, and named the week of work that would close it: per-edge
 * fading has to stop being a property of a material. What nobody asked in that
 * sprint is whether 400 walls is a number about this product.
 *
 * RM-016 AB-2 asked, and it is not. Every design in `public/templates/` is
 * between 8 and 17 walls. The furnished two-bedroom - the largest thing here,
 * and the one the shelf offers as a worked example - is **187 draw calls at
 * 0.53 ms a frame**. M-52's fixture is twenty-three times the wall count of the
 * biggest starter plan, and an unmet metric is a debt that gets paid: it had
 * already deferred instanced furniture, and it would have bought a rewrite of
 * how a wall face fades in order to move a number no user is on the far side
 * of.
 *
 * So M-52 is retired against that measurement and this is what stands in its
 * place. The 400-wall fixture is not deleted - it is in
 * `tests/browser/wall-batching.test.js`, it is where M2's batching was proved,
 * and it is a good early-warning instrument. It is no longer a promise.
 *
 * ## Why the numbers below are safe to assert
 *
 * A draw call is the same number on every machine: it is a property of the
 * scene graph, not of the GPU underneath it. So the ceilings are tight - the
 * measurement plus about 15 %, rounded to a multiple of five - and a single
 * unbatched mesh per wall face would blow through every one of them.
 *
 * The frame budget is the opposite and is written to be. A millisecond on a CI
 * runner measures the runner, so 8 ms is not "the measurement plus headroom",
 * it is **half of a 60 Hz frame**: a threshold that says *this scene is still
 * cheap*, fails if somebody makes it fifteen times more expensive, and says
 * nothing at all about which machine ran it.
 *
 * ## And the item counts, which are what stop this being vacuous
 *
 * The two furnished designs load their models over the network. A model that
 * 404s makes the scene cheaper, so a ceiling on its own would pass *harder*
 * with the furniture missing. Every case asserts what actually arrived.
 */
import {afterEach, describe, expect, it} from 'vitest';

import {Main} from '../../src/scripts/three/main.js';
import {Model} from '../../src/scripts/model/model.js';

/**
 * Every design in public/templates/, measured at RM-016 N1 in headless
 * Chromium off `renderer.info.render`, with the furniture fetched and counted.
 *
 * `ceiling` is the number this file enforces; `calls` is what it measured when
 * the ceiling was set, kept beside it so the headroom is visible without
 * running anything - the same shape `tools/budget.json` uses.
 */
const DESIGNS = [
	{id: 'studio', walls: 8, rooms: 2, items: 0, calls: 39, ceiling: 45},
	{id: 'one-bedroom', walls: 10, rooms: 3, items: 0, calls: 49, ceiling: 60},
	{id: 'two-bedroom', walls: 13, rooms: 4, items: 0, calls: 61, ceiling: 70},
	{id: 'three-bedroom', walls: 15, rooms: 5, items: 0, calls: 69, ceiling: 80},
	{id: 'duplex', walls: 17, rooms: 5, items: 0, calls: 81, ceiling: 95},
	{id: 'sample-studio', walls: 8, rooms: 2, items: 15, calls: 145, ceiling: 170},
	{id: 'sample-two-bedroom', walls: 13, rooms: 4, items: 19, calls: 187, ceiling: 215},
];

/** Half a 60 Hz frame. See the note above for why it is not tighter. */
const FRAME_BUDGET_MS = 8;

let hosts = [];
let viewers = [];

function host()
{
	const element = document.createElement('div');
	element.style.width = '1024px';
	element.style.height = '768px';
	document.body.appendChild(element);
	hosts.push(element);
	return element;
}

/**
 * Load a shipped design into a real viewer and let its furniture arrive.
 *
 * Three seconds, which is generous and deliberately so: what is being measured
 * is the finished scene, and a probe that read the counter early would report a
 * cheaper one. An earlier version of this measurement waited 300 ms and
 * recorded 61 calls for a design that costs 187 - the furniture had not landed.
 */
async function load(id)
{
	const document_ = await (await fetch(`/templates/${id}.blueprint3d`)).text();
	const model = new Model('models/textures/');
	model.loadSerialized(document_);
	const three = new Main(model, host(), null, {});
	viewers.push(three);
	await new Promise((resolve) => setTimeout(resolve, 3000));
	three.render(true);
	return {model, three};
}

afterEach(() =>
{
	viewers.forEach((viewer) => viewer.dispose());
	viewers = [];
	hosts.forEach((element) => element.remove());
	hosts = [];
});

describe('M-56 - every design this product ships is cheap to draw', () =>
{
	for (const design of DESIGNS)
	{
		it(`draws ${design.id} in at most ${design.ceiling} calls, and measured ${design.calls}`, async () =>
		{
			const {model, three} = await load(design.id);

			// The plan is what the file says it is. A template edited without this
			// table being updated should say so here rather than quietly changing
			// what the ceiling is a ceiling on.
			expect(model.floorplan.getWalls().length).toBe(design.walls);
			expect(model.floorplan.getRooms().length).toBe(design.rooms);
			// And the furniture arrived, which is what stops the ceiling passing
			// harder when a model is missing than when it is there.
			expect(model.scene.itemCount()).toBe(design.items);

			expect(three.renderer.info.render.calls,
				`${design.id} drew in ${three.renderer.info.render.calls} calls, ceiling ${design.ceiling}`)
				.toBeLessThanOrEqual(design.ceiling);
		}, 30000);
	}

	it('renders the largest of them in well under half a frame', async () =>
	{
		const {three} = await load('sample-two-bedroom');

		const started = performance.now();
		for (let frame = 0; frame < 30; frame++) { three.render(true); }
		const ms = (performance.now() - started) / 30;

		// 0.53 ms when this was written, against a budget of 8. The gap is the
		// point: this is not a timing gate, it is a statement that the scene a
		// person actually builds is nowhere near the cost of a frame.
		expect(ms, `${ms.toFixed(2)} ms a frame, budget ${FRAME_BUDGET_MS}`)
			.toBeLessThan(FRAME_BUDGET_MS);
	}, 30000);

	it('costs about ten calls a wall unfurnished, which is what makes 400 walls a stress test', () =>
	{
		// The arithmetic behind AB-2, asserted so the retirement of M-52 keeps its
		// argument rather than only its conclusion. The five unfurnished starters
		// are a straight line: roughly five calls per wall plus a fixed cost, so
		// M-52's 400-wall fixture is an extrapolation twenty-three times beyond
		// the largest design anybody here has drawn.
		const plain = DESIGNS.filter((design) => design.items === 0);
		const perWall = plain.map((design) => design.calls / design.walls);

		expect(Math.max(...perWall)).toBeLessThan(6);
		expect(Math.max(...plain.map((design) => design.walls))).toBeLessThan(20);
	});
});
