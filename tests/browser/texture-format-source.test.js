/**
 * Which context answers "what can this GPU decode" (RM-018 Q1, finding AD-3).
 *
 * `core/texture_formats.js` keeps one record per page and the FIRST caller
 * fills it. There are two callers. `describeFrom(renderer)` asks the renderer
 * the application draws with; `probe()` opens its own 1x1 context and asks
 * that. The module's own docblock prefers the first, and says why: a second
 * context "might differ if the browser gave it a different adapter".
 *
 * ## The order used to be a guarantee and M3 made it a race
 *
 * `Main` calls `describeFrom` as it builds its renderer, and until RM-015 M3
 * `Main` was built inside the `BlueprintJS` constructor - so the renderer
 * always won, on every path, by construction. M3 moved the viewer behind
 * `attachViewer()` and a dynamic import, which is what took a first load from
 * 432,781 to 280,079 bytes and stays. What went with it was the ordering: a
 * plan-only session that places an item before ever opening the 3D view now
 * answers from the probe, and the renderer's answer is ignored when it arrives.
 *
 * ## What this file is for
 *
 * Two things the headless tier cannot say, because it has no GPU at all.
 * First, that both orders are reachable and each produces the record it should
 * - which is the behaviour, and it is asserted. Second, whether the two
 * sources actually disagree HERE, which is the measurement the drawing said
 * would decide whether M3's ordering has to be restored or the docblock
 * corrected. One machine cannot prove they always agree; it can only report
 * what it found, and the case below reports it rather than asserting it.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {WebGLRenderer} from 'three';

import {Model} from '../../src/scripts/model/model.js';
import {describeFrom, formatSupport, resetFormatSupport} from '../../src/scripts/core/texture_formats.js';

/** The seven fields a support record carries. */
const FIELDS = ['astcSupported', 'astcHDRSupported', 'etc1Supported', 'etc2Supported',
	'dxtSupported', 'bptcSupported', 'pvrtcSupported'];

let contexts;
let originalGetContext;
let renderers;

beforeEach(() =>
{
	resetFormatSupport();
	renderers = [];
	contexts = [];
	originalGetContext = window.HTMLCanvasElement.prototype.getContext;
	window.HTMLCanvasElement.prototype.getContext = function (kind, ...rest)
	{
		if (typeof kind === 'string' && kind.startsWith('webgl')) { contexts.push(kind); }
		return originalGetContext.call(this, kind, ...rest);
	};
});

afterEach(() =>
{
	window.HTMLCanvasElement.prototype.getContext = originalGetContext;
	for (const renderer of renderers) { renderer.dispose(); }
	resetFormatSupport();
});

/** A real renderer on this tier's SwiftShader context, disposed afterwards. */
function realRenderer()
{
	const renderer = new WebGLRenderer({canvas: document.createElement('canvas')});
	renderers.push(renderer);
	return renderer;
}

describe('M-61 - the plan-first order answers from a probe', () =>
{
	it('fills the record and opens its own context when no viewer exists', async () =>
	{
		const model = new Model('/textures/');
		const loaders = await model.scene._ensureLoaders();

		// A real answer, from a context this session opened only to ask. This is
		// the ordinary path in the shipped application: the default layout is
		// the plan, and dropping a chair into it needs loaders.
		expect(formatSupport()).not.toBeNull();
		expect(contexts.length).toBeGreaterThan(0);
		expect(loaders.ktx2Loader.workerConfig).toBe(formatSupport());
	});
});

describe('M-61 - the viewer-first order answers from the renderer', () =>
{
	it('takes the renderer\'s record and opens no second context to ask', async () =>
	{
		describeFrom(realRenderer());
		const fromRenderer = formatSupport();
		const before = contexts.length;

		const model = new Model('/textures/');
		const loaders = await model.scene._ensureLoaders();

		// First-caller-wins, working as designed: the loaders get the renderer's
		// record and nothing probes, because the question is already answered.
		expect(loaders.ktx2Loader.workerConfig).toBe(fromRenderer);
		expect(contexts.length).toBe(before);
	});
});

describe('M-61 - what the two sources report on this machine', () =>
{
	it('reports both records and compares them field by field', () =>
	{
		const fromProbe = formatSupport();

		resetFormatSupport();
		describeFrom(realRenderer());
		const fromRenderer = formatSupport();

		// Both must exist - a tier with a real WebGL2 context that cannot answer
		// this question is a broken tier, and that IS asserted.
		expect(fromProbe).not.toBeNull();
		expect(fromRenderer).not.toBeNull();

		const differ = FIELDS.filter((field) => fromProbe[field] !== fromRenderer[field]);

		// And this is a measurement, not an assertion about every machine. One
		// runner agreeing does not prove a hybrid-graphics laptop agrees, which
		// is exactly what the docblock in texture_formats.js warns about - so
		// what is pinned is that the comparison was made and what it said,
		// printed where a future run can contradict it.
		expect(differ, `probe and renderer disagree on: ${differ.join(', ')}`).toEqual([]);
	});
});
