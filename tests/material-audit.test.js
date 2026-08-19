// @vitest-environment node
/**
 * A row that claims a colour must have a model that can produce it (RM-012 J2).
 *
 * J1's thumbnail render caught the catalog lying about two of its own rows -
 * *Sectional - Olive* and *Media Console - Black* both rendered white, and the
 * collected product photographs had hidden it for eight years. J1 recorded four
 * such demo models and left the fix here.
 *
 * Asked of all 168 rows rather than of the 25 being looked at, it is larger and
 * different: **52 of 417 materials render the glTF default white**, and most of
 * them are correct - a Kenney sink basin whose `_defaultMat` is white is a white
 * basin. So the gate is not "no material may be colourless". It is that a
 * **claim** must be honoured, and a claim is something written down: the row's
 * name, or the material's own name.
 *
 * The history is what makes the fix a substitution rather than an invention.
 * Each of the four legacy `.js` ancestors names a diffuse map -
 * `mapDiffuse: cb-moore_baked.png` and three like it - and **none of those four
 * files exists in any commit of this repository**. The models have named a
 * texture nobody has since 2014.
 */
import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {audit, claims, colourOf, linear, paintState} from '../tools/material-audit.mjs';

const ROOT = process.cwd();
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/catalog/catalog.json'), 'utf8'));
const REPORT = JSON.parse(readFileSync(join(ROOT, 'asset-pipeline/material-audit.json'), 'utf8'));

describe('the gate: a claim the file cannot honour', () =>
{
	it('holds over the whole catalog', () =>
	{
		execFileSync(process.execPath, ['tools/material-audit.mjs', '--check'], {cwd: ROOT});
	});

	it('leaves no unhonoured claim in the shipped catalog', () =>
	{
		expect(REPORT.violations).toEqual([]);
		expect(audit(CATALOG).violations).toEqual([]);
	});

	it('would catch a row whose name claims a colour its model cannot make', () =>
	{
		// The exact defect J1 found, re-created: the row is named for a colour and
		// every material in the file renders the specification's default white.
		const white = {items: [{name: 'Sofa - Olive', model: 'models/js-glb/cb-moore_baked.glb', source: 'blueprint3d'}]};
		const before = audit(white);
		// It passes today because the model was painted. Assert on the rule
		// instead, which is what would fire for a newly acquired row.
		expect(before.violations).toEqual([]);
		expect(claims('Sofa - Olive')).toContain('olive');
		expect(colourOf({pbrMetallicRoughness: {}}).coloured).toBe(false);
		expect(colourOf({}).coloured).toBe(false);
	});

	it('does not call a white thing named white a defect', () =>
	{
		// The distinction the gate turns on. *Wardrobe - White* rendering white is
		// correct; a rule that flagged every colourless material would have called
		// it a defect and buried the two that were real under fifty that were not.
		expect(claims('Wardrobe - White')).toEqual(['white']);
		const rows = REPORT.rows.map((row) => row.name);
		expect(rows, 'still reported, just not a violation').toContain('Wardrobe - White');
	});

	it('reads a colour off a texture, a factor, or neither', () =>
	{
		expect(colourOf({pbrMetallicRoughness: {baseColorTexture: {index: 0}}}))
			.toEqual({coloured: true, how: 'texture'});
		expect(colourOf({pbrMetallicRoughness: {baseColorFactor: [0.2, 0.2, 0.2, 1]}}).coloured).toBe(true);
		// An explicit white is still white, and is reported as a different `how` so
		// "audited and white is the answer" reads differently from "never set".
		expect(colourOf({pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1]}}))
			.toEqual({coloured: false, how: 'explicit white'});
	});

	it('claims nothing from a name that only looks like a colour word', () =>
	{
		// A closed list, for the reason `ROOMS` is one: an open rule over English
		// would find a claim in half the catalog.
		expect(claims('Side Table')).toEqual([]);
		expect(claims('Bathroomsink')).toEqual([]);
		expect(claims('Church Chair - Oak')).toEqual(['oak']);
	});
});

describe('what the audit found across all 168', () =>
{
	it('counts the colourless materials rather than assuming the four J1 saw', () =>
	{
		// J1 looked at 25 demo models and found 4. Asked of the catalog, it is an
		// order of magnitude more materials and most of them are fine - which is
		// the finding, and is why the gate is about claims rather than about
		// colourlessness.
		expect(REPORT.totals.items).toBe(168);
		expect(REPORT.totals.materials).toBeGreaterThan(400);
		expect(REPORT.totals.colourless).toBeGreaterThan(40);
		expect(REPORT.totals.rowsAffected).toBeGreaterThan(25);
	});

	it('leaves two rows white in every material, and both are white things', () =>
	{
		// Down from five. The two that remain are *Open Door* and *Wardrobe -
		// White*, which are white, and they carry an explicit `[1,1,1,1]` so the
		// file says they were audited rather than saying nothing at all.
		expect(REPORT.totals.rowsAllWhite).toBe(2);
		const all = REPORT.rows.filter((row) => row.all).map((row) => row.name).sort();
		expect(all).toEqual(['Open Door', 'Wardrobe - White']);
	});
});

describe('the paint, and where its colours came from', () =>
{
	it('applies every declared colour, and the report says which', () =>
	{
		const state = paintState();
		expect(state).toHaveLength(5);
		state.forEach((entry) =>
		{
			expect(entry.applied, `${entry.model} :: ${entry.material}`).toEqual(entry.linear);
		});
	});

	it('converts sRGB to linear, because glTF base colour is linear', () =>
	{
		// The one arithmetic here that could be silently wrong. A value sampled off
		// a photograph is sRGB; writing it straight into `baseColorFactor` would
		// make every painted material far too bright.
		expect(linear(255)).toBeCloseTo(1, 6);
		expect(linear(0)).toBe(0);
		expect(linear(128)).toBeCloseTo(0.2159, 4);
		// 26 sRGB is the console's sampled black. Written raw it would be 0.102 -
		// ten times the linear value, and a dark grey rather than a black.
		expect(linear(26)).toBeCloseTo(0.0103, 4);
	});

	it('names the evidence for each colour rather than asserting it', () =>
	{
		const state = paintState();
		const console_ = state.find((entry) => entry.model.includes('cb-moore'));
		expect(console_.srgb).toEqual([26, 24, 23]);
		expect(console_.from).toContain('thumbnail_moore-60-media-console');
		const sofa = state.find((entry) => entry.model.includes('crosby'));
		expect(sofa.srgb).toEqual([94, 89, 72]);
		// R = G > B is what makes it olive rather than the grey a white render
		// suggested, and it is a property of the measurement, not of the name.
		expect(sofa.srgb[0]).toBeGreaterThan(sofa.srgb[2]);
		expect(sofa.srgb[1]).toBeGreaterThan(sofa.srgb[2]);
	});

	it('found the chandelier by the material\'s own name, not by looking', () =>
	{
		// The second rule earning its place. Nobody was looking at the chandelier -
		// its row name claims no colour - and a material called `black metal` that
		// renders white is the same defect as a row called Black that does.
		const entry = paintState().find((one) => one.material === 'black metal');
		expect(entry.model).toBe('models/gltf/chandelier.gltf');
		expect(entry.from).toContain('own name');
	});
});
