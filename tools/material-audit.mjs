/**
 * Which catalog models can produce a colour, and which have never been able to
 * (RM-012 J2).
 *
 *   npm run materials:audit          re-measure and rewrite the report
 *   npm run materials:audit -- --paint   apply the declared base colours
 *   npm run materials:audit:check    verify the report and the paint
 *
 * ## What J1 found, and what asking the whole catalog turned it into
 *
 * J1's thumbnail render caught the catalog lying about two of its own rows:
 * *Sectional - Olive* rendered white and so did *Media Console - Black*. The
 * collected thumbnails had been product photographs, so for eight years the
 * drawer showed an olive sofa and a black console that the files have never
 * contained. J1 recorded four such demo models and left the fix to this sprint.
 *
 * Asked of all 168 rows rather than of the 25 that were being looked at, the
 * shape is different and larger: **31 rows carry at least one material with
 * neither a base colour texture nor a base colour factor**, which is 52 of 417
 * materials. Most of those are fine - a Kenney sink basin whose `_defaultMat`
 * is white is a white basin - and the audit says so rather than calling
 * everything a defect.
 *
 * ## And what the history says, which is better than a guess
 *
 * The four are not models somebody forgot to colour. Their legacy `.js`
 * ancestors, read at `a25c9fd~1`, each declare a diffuse map by name:
 *
 *     cb-moore_baked.js              mapDiffuse: cb-moore_baked.png
 *     we-crosby2piece-greenbaked.js  mapDiffuse: we-crosby2piece-green_baked.png
 *     ik-kivine_baked.js             mapDiffuse: ik-kivine_baked.png
 *     closed-door28x80_baked.js      mapDiffuse: closed-door28x80_baked.png
 *
 * **None of those four files exists in any commit of this repository.** S3's
 * conversion to glTF then correctly produced a material with no texture,
 * because there was no texture to point at, and B1's Draco pass dropped the
 * explicit `[1,1,1,1]` as a default - both changes semantically neutral, both
 * innocent. The models have been naming a texture nobody has since 2014, and
 * what hid it was the product photographs.
 *
 * So the texture is not recoverable and a flat base colour is the honest
 * substitute: it is not the baked shading the model was authored with, and this
 * file says so rather than implying the original has been restored.
 *
 * ## Where the colours come from
 *
 * From the photographs J1 retired, which are the only surviving record of what
 * each row claimed. Each is read out of git at `9ea9f57~1`, the subject region
 * sampled with the studio background rejected, and the mean taken - so the
 * number is measured from the evidence rather than picked to look right. The
 * caveat that goes with it: a photograph carries its lighting, and these are lit
 * PBR materials, so the sampled value is a little brighter than a true albedo.
 * Recorded here rather than corrected by eye.
 *
 * ## The two rules, and why they are about names
 *
 * A material with no colour is not a defect - most of the 52 are correct. What
 * is a defect is a **claim the file cannot honour**, and a claim is something
 * written down: the row's name, or the material's own name. *Media Console -
 * Black* that renders white is a defect. *Wardrobe - White* that renders white
 * is not. A material called `black metal` that renders white is, and that one is
 * in the chandelier - found by the same rule, not by looking.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'src/catalog/catalog.json');
const REPORT = join(ROOT, 'asset-pipeline/material-audit.json');
const CHECK = process.argv.includes('--check');
const PAINT = process.argv.includes('--paint');

/**
 * Colour words a name may claim, and the one that means white.
 *
 * A closed list for the same reason `ROOMS` is one: an open rule over English
 * would call *Side Table* a claim about the side of something. These are the
 * words this catalog actually uses, taken from its own names.
 */
const COLOUR_WORDS = ['black', 'white', 'olive', 'grey', 'gray', 'green', 'blue', 'red',
	'brown', 'beige', 'cream', 'walnut', 'oak', 'teal', 'navy', 'silver', 'gold'];

/** The ones a default-white material honours rather than contradicts. */
const WHITE_WORDS = ['white', 'cream', 'silver'];

/**
 * What each unpaintable material is painted, and the evidence for it.
 *
 * `srgb` is what was sampled; `linear` is what goes into `baseColorFactor`,
 * because glTF's base colour is linear and a value read off a photograph is not.
 * `from` is the thumbnail J1 retired, readable at `9ea9f57~1`, which is the only
 * surviving record of what the row claimed.
 *
 * Four models, five materials. `closed-door28x80_baked` and `ik-kivine_baked`
 * are *Open Door* and *Wardrobe - White*, both of which are white anyway - they
 * are given an explicit white rather than left implicit, so that "this row was
 * audited and white is the answer" is a statement in the file instead of an
 * absence that looks identical to the two that were wrong.
 */
const PAINTS = [
	{
		model: 'models/js-glb/cb-moore_baked.glb', material: 'bake_mat',
		srgb: [26, 24, 23], from: 'models/thumbnails/thumbnail_moore-60-media-console-1.jpg',
		note: 'Media Console - Black. Sampled at 16,647 px of subject; the name claims black and the photograph is one.',
	},
	{
		model: 'models/js-glb/we-crosby2piece-greenbaked.glb', material: 'bake_mat',
		srgb: [94, 89, 72], from: 'models/thumbnails/thumbnail_img21o.jpg',
		note: 'Sectional - Olive. Sampled at 10,171 px; R=G>B, which is olive rather than the grey a white render suggested.',
	},
	{
		model: 'models/js-glb/ik-kivine_baked.glb', material: 'bake_mat',
		srgb: [255, 255, 255], from: 'models/thumbnails/thumbnail_TN-ikea-kvikine.png',
		note: 'Wardrobe - White. White is the right answer; it is written down so the row reads as audited rather than as missed.',
	},
	{
		model: 'models/js-glb/closed-door28x80_baked.glb', material: 'bake_mat',
		srgb: [255, 255, 255], from: '(no photograph; the row claims no colour)',
		note: 'Open Door. Same: explicit white, so the audit distinguishes checked from overlooked.',
	},
	{
		model: 'models/gltf/chandelier.gltf', material: 'black metal',
		srgb: [28, 28, 30], from: '(the material\'s own name)',
		note: 'Found by the material-name rule rather than by looking. A material called `black metal` that renders white is the same defect as a row called Black that does.',
	},
];

/** sRGB 0-255 to linear 0-1, the transfer function glTF specifies. */
export function linear(channel)
{
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

const round = (value) => Math.round(value * 10000) / 10000;

/** A model's glTF JSON, whether it is packed in a `.glb` or is one. */
function modelJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.length >= 20 && buffer.readUInt32LE(0) === 0x46546c67)
	{
		return JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
	}
	return JSON.parse(buffer.toString('utf8'));
}

/**
 * Can this material produce a colour other than the glTF default white?
 *
 * A texture can; a base colour factor that is not `[1,1,1,1]` can; vertex
 * colours can, and three of this catalog's kits use them. Anything else renders
 * the specification's default, which is white.
 *
 * @param {Object} material A glTF material.
 * @returns {{coloured: boolean, how: string}}
 */
export function colourOf(material)
{
	const pbr = material.pbrMetallicRoughness || {};
	if (pbr.baseColorTexture) { return {coloured: true, how: 'texture'}; }
	const factor = pbr.baseColorFactor;
	if (factor && factor.slice(0, 3).some((channel) => Math.abs(channel - 1) > 1e-4))
	{
		return {coloured: true, how: 'factor'};
	}
	if (factor) { return {coloured: false, how: 'explicit white'}; }
	return {coloured: false, how: 'default white'};
}

/** Which colour words a name claims, if any. */
export function claims(name)
{
	const lower = String(name || '').toLowerCase();
	return COLOUR_WORDS.filter((word) => new RegExp(`\\b${word}`).test(lower));
}

/**
 * Audit one catalog, and apply the two name rules.
 *
 * @param {Object} catalog
 * @param {string} [root]
 * @returns {{rows: Array<Object>, violations: Array<Object>, totals: Object}}
 */
export function audit(catalog, root)
{
	const base = join(root || ROOT, 'public');
	const rows = [];
	const violations = [];
	let materials = 0;
	let colourless = 0;

	for (const item of catalog.items)
	{
		const path = join(base, item.model || '');
		if (!item.model || !existsSync(path))
		{
			continue;
		}
		const json = modelJson(path);
		const mats = json.materials || [];
		const blank = [];
		for (const material of mats)
		{
			materials++;
			const state = colourOf(material);
			if (!state.coloured)
			{
				colourless++;
				blank.push(material.name || '(unnamed)');
			}
		}
		const row = {
			name: item.name, model: item.model, source: item.source,
			materials: mats.length, colourless: blank.length, blank: blank,
			// A model with no materials at all renders white too, and there is one
			// kind of row where that is a fact about the format rather than a defect.
			all: mats.length > 0 && blank.length === mats.length,
		};
		rows.push(row);

		// Rule one: a row whose name claims a colour that is not white must have a
		// material that can produce one.
		const rowClaims = claims(item.name).filter((word) => WHITE_WORDS.indexOf(word) === -1);
		if (rowClaims.length && row.all)
		{
			violations.push({row: item.name, model: item.model, rule: 'row name',
				claim: rowClaims.join(', '), detail: `every one of ${mats.length} material(s) renders white`});
		}
		// Rule two: a material whose own name claims a colour must produce it. The
		// evidence is inside the file, which is why this catches things looking at
		// the drawer does not.
		for (const material of mats)
		{
			const own = claims(material.name).filter((word) => WHITE_WORDS.indexOf(word) === -1);
			if (own.length && !colourOf(material).coloured)
			{
				violations.push({row: item.name, model: item.model, rule: 'material name',
					claim: `${material.name} (${own.join(', ')})`, detail: 'renders white'});
			}
		}
	}

	return {
		rows: rows.filter((row) => row.colourless > 0).sort((a, b) => b.colourless - a.colourless),
		violations,
		totals: {
			items: rows.length, materials, colourless,
			rowsAffected: rows.filter((row) => row.colourless > 0).length,
			rowsAllWhite: rows.filter((row) => row.all).length,
		},
	};
}

/**
 * Apply the declared base colours, in place, without moving one byte of
 * geometry.
 *
 * ## Why this is a container patch and not a `gltf-transform` write
 *
 * It was one, first, and the sizes said no. Reading each model through `NodeIO`
 * and writing it back re-encodes: `cb-moore_baked.glb` came out 22,064 -> 13,032
 * bytes and `closed-door28x80_baked.glb` went 15,728 -> 28,396. Those are not
 * rounding - they are Draco re-encoded at settings that are not the ones RM-004
 * B1 measured, and B1's gate was that the worst vertex moved 0.38 micrometres
 * against a 5 micrometre ceiling. Nothing in this task is worth re-opening that
 * measurement.
 *
 * A base colour is a number in the JSON chunk. So this rewrites the JSON chunk
 * and copies the binary chunk verbatim: the accessors, the buffer views and
 * every compressed vertex are the bytes they were. `npm run encode:check`,
 * `npm run oracle:check` and the parity render all stay true by construction
 * rather than by re-measurement.
 *
 * The three plain `.gltf` rows are patched as text for the same reason at one
 * remove: their buffers are external and untouched either way, but a re-serialise
 * would reformat 475 lines of somebody else's exporter output to change one, and
 * a diff nobody can read is a diff nobody checks.
 */
function patchGlb(path, material, factor)
{
	const buffer = readFileSync(path);
	const jsonLength = buffer.readUInt32LE(12);
	const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
	// Everything after the JSON chunk, which for these files is the BIN chunk and
	// its header - copied rather than rebuilt.
	const rest = buffer.subarray(20 + jsonLength);

	let touched = 0;
	for (const one of json.materials || [])
	{
		if (one.name !== material) { continue; }
		one.pbrMetallicRoughness = one.pbrMetallicRoughness || {};
		one.pbrMetallicRoughness.baseColorFactor = factor;
		touched++;
	}
	if (!touched) { return 0; }

	// glTF requires each chunk to start on a four-byte boundary, and the JSON
	// chunk to be padded with spaces rather than with nulls.
	let text = Buffer.from(JSON.stringify(json), 'utf8');
	if (text.length % 4) { text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]); }

	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + text.length + rest.length, 8);
	header.writeUInt32LE(text.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	writeFileSync(path, Buffer.concat([header, text, rest]));
	return touched;
}

/**
 * The same, on a plain `.gltf`, as the smallest text edit that does it.
 *
 * Anchored on the material's own `"name"` line and walking back to its
 * `pbrMetallicRoughness`, so the exporter's spacing survives and the diff is the
 * one line that changed.
 */
function patchGltf(path, material, factor)
{
	const text = readFileSync(path, 'utf8');
	const at = text.indexOf(`"name" : "${material}"`);
	if (at === -1) { return 0; }
	// Backwards from the name to the material's own empty pbr block. Every
	// material in this file is `{"pbrMetallicRoughness" : {}, "name" : ...}`, so
	// the nearest one before the name is this material's.
	const open = text.lastIndexOf('"pbrMetallicRoughness" : {}', at);
	if (open === -1) { return 0; }
	const indent = /\n([ \t]*)"pbrMetallicRoughness" : \{\}$/.exec(text.slice(0, open + 27));
	const pad = indent ? indent[1] : '            ';
	const replacement = '"pbrMetallicRoughness" : {\n' + pad + '    "baseColorFactor" : ['
		+ factor.join(', ') + ']\n' + pad + '}';
	writeFileSync(path, text.slice(0, open) + replacement + text.slice(open + '"pbrMetallicRoughness" : {}'.length));
	return 1;
}

/** Apply every declared base colour. */
function paint()
{
	for (const entry of PAINTS)
	{
		const path = join(ROOT, 'public', entry.model);
		const want = entry.srgb.map((channel) => round(linear(channel))).concat([1]);
		const touched = path.endsWith('.glb')
			? patchGlb(path, entry.material, want)
			: patchGltf(path, entry.material, want);
		if (!touched)
		{
			throw new Error(`${entry.model} has no material called ${entry.material}`);
		}
		console.log(`  painted ${entry.model} :: ${entry.material} -> `
			+ `rgb(${entry.srgb.join(', ')})  linear [${want.slice(0, 3).join(', ')}]`);
	}
}

/** What the declared paints should look like in the files. */
export function paintState(root)
{
	const base = join(root || ROOT, 'public');
	return PAINTS.map((entry) =>
	{
		const json = modelJson(join(base, entry.model));
		const material = (json.materials || []).find((one) => one.name === entry.material);
		const factor = material && material.pbrMetallicRoughness
			&& material.pbrMetallicRoughness.baseColorFactor;
		return {
			model: entry.model, material: entry.material, srgb: entry.srgb,
			linear: entry.srgb.map((channel) => round(linear(channel))).concat([1]),
			applied: factor ? factor.map((channel) => round(channel)) : null,
			from: entry.from, note: entry.note,
		};
	});
}

function serialise(result, paints)
{
	return JSON.stringify({
		_comment: 'GENERATED by tools/material-audit.mjs (RM-012 J2). Which catalog models can produce '
			+ 'a colour. `violations` is the gate: a row whose NAME claims a colour, or a material whose '
			+ 'own name does, must have a file that can honour it. Most colourless materials are correct '
			+ 'and are listed under `rows` rather than treated as defects. `paints` records the four models '
			+ 'that have named a diffuse texture since 2014 that no commit of this repository contains, and '
			+ 'the colour each was given instead - sampled from the product photograph J1 retired, which is '
			+ 'the only surviving record of what the row claimed.',
		totals: result.totals,
		violations: result.violations,
		paints: paints,
		rows: result.rows,
	}, null, '\t') + '\n';
}

function main()
{
	if (PAINT)
	{
		paint();
	}
	const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
	const result = audit(catalog);
	const paints = paintState();
	const text = serialise(result, paints);
	const t = result.totals;

	console.log(`\n  ${t.items} models, ${t.materials} materials`);
	console.log(`  ${t.colourless} materials render the glTF default white, across ${t.rowsAffected} rows`);
	console.log(`  ${t.rowsAllWhite} rows are white in every material`);
	const wrong = paints.filter((entry) => String(entry.applied) !== String(entry.linear));
	console.log(`  ${paints.length - wrong.length} of ${paints.length} declared paints are applied`);
	if (result.violations.length)
	{
		console.log('');
		result.violations.forEach((one) =>
			console.log(`  CLAIM UNHONOURED  ${one.row} :: ${one.rule} says ${one.claim} - ${one.detail}`));
	}
	console.log('');

	if (CHECK)
	{
		let failed = false;
		if (result.violations.length)
		{
			console.error(`${result.violations.length} row(s) claim a colour their model cannot produce.`);
			failed = true;
		}
		for (const entry of wrong)
		{
			console.error(`${entry.model} :: ${entry.material} is ${JSON.stringify(entry.applied)}, `
				+ `declared ${JSON.stringify(entry.linear)}. Run \`npm run materials:audit -- --paint\`.`);
			failed = true;
		}
		const current = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : null;
		if (current !== text)
		{
			console.error('asset-pipeline/material-audit.json is out of date. Run `npm run materials:audit`.');
			failed = true;
		}
		if (failed) { process.exit(1); }
		console.log(`  material audit is up to date (${t.colourless} colourless materials, no unhonoured claim).`);
	}
	else
	{
		writeFileSync(REPORT, text);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
