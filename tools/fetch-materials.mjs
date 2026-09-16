/**
 * The material library, acquired and measured (RM-011 H1).
 *
 *   node tools/fetch-materials.mjs           fetch, resize, gate, write the tree
 *   node tools/fetch-materials.mjs --check   verify the committed tree, no network
 *
 * ## What decided the size of this library
 *
 * Not this file. RM-007 priced H1 with *"a CC0 library of about ninety
 * materials"*; RM-011 W-4 measured ninety materials of three maps at 44.8 MB
 * against 78,894 bytes of `public-total` headroom; and H1's own encode trial
 * (`tools/material-trial.mjs`, and the report beside this one) measured what a
 * material actually costs. **Thirty, albedo and roughness** is what that trial
 * allowed, and this tool spends exactly that.
 *
 * ## No normal maps, and the trial is why
 *
 * The trial derived normal maps from photographs and every one of them failed
 * the 3.0 RMS gate at every setting - and the failure was not the codec's, it
 * was the derivation's: a normal map inferred from a JPEG amplifies 8x8 ringing
 * into surface detail. A real library needs *baked* normal maps, which Poly
 * Haven does publish, but a normal map is only visible under the studio
 * profile's lighting and costs as much again as the albedo. H1 ships the two
 * maps that earn their bytes and leaves the third to a sprint that can measure
 * it against a lit scene rather than against a photograph of one.
 *
 * ## Why JPEG, when H1's own trial measured KTX2
 *
 * The trial's verdict for a roughness map was UASTC at 86 % of source, and this
 * library ships JPEG instead. That is not the trial being ignored; it is a
 * second constraint the trial did not measure.
 *
 * `three/texture_cache.js` loads through `TextureLoader`, and a KTX2 needs
 * `KTX2Loader` with `detectSupport` called on it. RM-004 B5 removed the
 * *architectural* objection to that - `core/texture_formats.js` answers "what
 * can this GPU read" without a renderer - but two costs remain and both land on
 * a user rather than on the tree:
 *
 *   1. The Basis transcoder is 515 KB. RM-011 W-7 measured it at 98 % of the
 *      boot's network traffic for one 10 KB skybox texture. Charging it to the
 *      first person who picks a material would trade 25 KB of roughness map for
 *      half a megabyte of decoder.
 *   2. M-43 says nothing unpicked is downloaded. A JPEG satisfies that by
 *      construction; a KTX2 drags its decoder along.
 *
 * So the container decision is per-asset and measured, which is B1's rule and
 * C1's before it: the skybox ground keeps its KTX2 because it is loaded on
 * every boot anyway, and the library ships JPEG because it is not.
 *
 * ## Two resolutions, and the measurement that separated them
 *
 * An albedo map is a photograph and a roughness map is a scalar field, and they
 * do not carry the same amount of information. Measured as the detail a round
 * trip through each resolution preserves, in dB (higher is more faithful):
 *
 *                            albedo            roughness
 *                          512     256       512     256
 *     brick_wall_001      33.96   30.41     45.24   40.20
 *     wood_floor          34.80   32.72     37.54   36.01
 *     white_plaster_02    32.39   30.20     39.53   37.41
 *     floor_tiles_06      42.61   37.55     54.03   49.95
 *     herringbone_parquet 36.19   33.69     41.53   39.53
 *     marble_01           39.48   35.61     51.28   44.54
 *
 * In all six, **roughness at 256 is more faithful than albedo at 512** - by 1.2
 * to 7.3 dB. So halving the roughness map is not the weak link in the material;
 * the albedo already is, at twice the resolution. It costs a quarter of the
 * pixels, and the library pays 12 KB for a roughness map instead of 45.
 *
 * 512 for the albedo is the resolution the tree's own material photographs
 * already use (`hardwood.jpg` and `marbletiles.jpg` are both 512), and half of
 * `resize-textures.mjs`'s 1024 cap - which is a ceiling, not a target.
 *
 * ## Quality is not chosen here either
 *
 * `resize-textures.mjs` already measured this exact question for this tree and
 * landed on 95, at the knee where each further 140 KB buys about 15 % less
 * generation loss. That argument transfers unchanged, so the number does too. A
 * search down to the 3.0 gate would ship every image at the maximum damage the
 * gate permits, which is the opposite of what a gate is for.
 *
 * ## The tiling scale is measured, not invented
 *
 * `src/catalog/textures.json` carries the demo's `scale: 300` for a floor and
 * `50` and `100` for the same brick image twice, and nothing records where any
 * of them came from. Poly Haven publishes each texture's real-world size, so
 * every entry in this library tiles at the size the material actually is:
 * `Edge.updateTexture` sets `repeat.set(width / scale, height / scale)` with
 * width in centimetres, so `scale` is centimetres per tile and the API's
 * millimetres divide by ten. A 1 m brick panel repeats every metre.
 *
 * ## Committed output, no network to build
 *
 * B1's model, unchanged: the processed tree is committed, a checkout builds and
 * serves with nothing installed, and `--check` verifies the committed bytes
 * against the report's hashes without reaching the network. The 1K sources are
 * cached under `asset-pipeline/.material-source/` and are not committed - they
 * are 30 MB of input to a step whose output is already in the repository.
 *
 * ## Licence
 *
 * Every asset here is CC0 1.0 from Poly Haven, which is the product constraint
 * ("absolutely free ... CC0 assets") and not an accident of what was reachable.
 * CC0 requires no attribution; the authors are recorded in the catalog and in
 * `public/materials/CREDITS.md` anyway, because knowing who made a thing is
 * worth more than the licence requires.
 */
import jpeg from 'jpeg-js';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {decode, resample, lowFrequency, pixelRms, GATES, CAP} from './resize-textures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const OUT_DIR = join(PUBLIC, 'materials');
const THUMB_DIR = join(OUT_DIR, 'thumbnails');
const SOURCE_CACHE = join(ROOT, 'asset-pipeline', '.material-source');
const REPORT_PATH = join(ROOT, 'asset-pipeline', 'material-library.json');
const CATALOG_PATH = join(ROOT, 'src', 'catalog', 'materials.json');
const CREDITS_PATH = join(OUT_DIR, 'CREDITS.md');

const CHECK = process.argv.includes('--check');

/** See the docblock: measured, not chosen. */
const ALBEDO_EDGE = 512;
const ROUGHNESS_EDGE = 256;
const THUMBNAIL_EDGE = 128;
const QUALITY = 95;

const API = 'https://api.polyhaven.com';
const LICENCE = {
	name: 'CC0 1.0 Universal',
	url: 'https://creativecommons.org/publicdomain/zero/1.0/',
	source: 'Poly Haven',
	sourceUrl: 'https://polyhaven.com/textures',
};

/**
 * The thirty, and what each one is for.
 *
 * `surfaces` is which picker offers it, and two entries appear in both because
 * a stone tile and a marble are as usual on a wall as on a floor. `family`
 * groups the swatches, because thirty-seven of them in one flat grid - the
 * seven the demo shipped included - is a wall of pictures rather than a choice.
 *
 * Everything else about each material comes from the API: its published name,
 * its authors and its real-world size.
 */
const MATERIALS = [
	{slug: 'wood_floor', name: 'Oak Boards', family: 'Wood', surfaces: ['floor']},
	{slug: 'laminate_floor_02', name: 'Laminate', family: 'Wood', surfaces: ['floor']},
	{slug: 'herringbone_parquet', name: 'Herringbone Parquet', family: 'Wood', surfaces: ['floor']},
	{slug: 'rectangular_parquet', name: 'Rectangular Parquet', family: 'Wood', surfaces: ['floor']},
	{slug: 'diagonal_parquet', name: 'Diagonal Parquet', family: 'Wood', surfaces: ['floor']},
	{slug: 'plank_flooring_03', name: 'Pine Planks', family: 'Wood', surfaces: ['floor']},
	{slug: 'dark_wooden_planks', name: 'Dark Planks', family: 'Wood', surfaces: ['floor']},
	{slug: 'brown_planks_03', name: 'Timber Cladding', family: 'Wood', surfaces: ['wall']},

	{slug: 'floor_tiles_06', name: 'Ceramic Tile', family: 'Tile', surfaces: ['floor']},
	{slug: 'floor_tiles_02', name: 'Stone Tile', family: 'Tile', surfaces: ['floor', 'wall']},
	{slug: 'terracotta_floor_tiles', name: 'Terracotta', family: 'Tile', surfaces: ['floor']},
	{slug: 'grey_cartago_01', name: 'Grey Porcelain', family: 'Tile', surfaces: ['floor']},

	{slug: 'marble_01', name: 'Marble', family: 'Stone', surfaces: ['floor', 'wall']},
	{slug: 'slate_floor_03', name: 'Slate', family: 'Stone', surfaces: ['floor']},

	{slug: 'smooth_concrete_floor', name: 'Polished Concrete', family: 'Concrete', surfaces: ['floor']},
	{slug: 'concrete_floor_worn_001', name: 'Worn Concrete', family: 'Concrete', surfaces: ['floor']},
	{slug: 'concrete_brick_wall_001', name: 'Concrete Block', family: 'Concrete', surfaces: ['wall']},

	{slug: 'beige_wall_001', name: 'Beige Paint', family: 'Plaster', surfaces: ['wall']},
	{slug: 'white_plaster_02', name: 'White Plaster', family: 'Plaster', surfaces: ['wall']},
	{slug: 'grey_plaster', name: 'Grey Plaster', family: 'Plaster', surfaces: ['wall']},
	{slug: 'plaster_grey_04', name: 'Fine Grey Plaster', family: 'Plaster', surfaces: ['wall']},
	{slug: 'plastered_wall_04', name: 'Rough Plaster', family: 'Plaster', surfaces: ['wall']},
	{slug: 'white_stucco', name: 'White Stucco', family: 'Plaster', surfaces: ['wall']},
	{slug: 'yellow_plaster', name: 'Yellow Plaster', family: 'Plaster', surfaces: ['wall']},

	{slug: 'brick_wall_001', name: 'Red Brick', family: 'Brick', surfaces: ['wall']},
	{slug: 'large_red_bricks', name: 'Large Red Brick', family: 'Brick', surfaces: ['wall']},
	{slug: 'painted_brick', name: 'Painted Brick', family: 'Brick', surfaces: ['wall']},
	{slug: 'yellow_brick', name: 'Yellow Brick', family: 'Brick', surfaces: ['wall']},
	{slug: 'castle_brick_02_white', name: 'Whitewashed Brick', family: 'Brick', surfaces: ['wall']},
	{slug: 'brown_brick_02', name: 'Brown Brick', family: 'Brick', surfaces: ['wall']},
];

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** @param {{width: number, height: number, data: Uint8Array}} raster */
function encodeJpeg(raster, quality)
{
	return Buffer.from(jpeg.encode({
		width: raster.width, height: raster.height,
		data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length),
	}, quality).data);
}

/* -------------------------------------------------------------------------
 * Acquisition
 * ------------------------------------------------------------------------- */

async function json(url)
{
	const response = await fetch(url);
	if (!response.ok) { throw new Error(`${url} -> HTTP ${response.status}`); }
	return response.json();
}

/**
 * A 1K source, from the cache if it is there.
 *
 * The URL comes from the API rather than being built from the slug. Poly Haven's
 * filenames are not derivable - `brick_wall_001`'s diffuse is not
 * `brick_wall_001_diff_1k.jpg` - and guessing produced a 94-byte JSON error
 * document that decoded as `null` and threw four frames later.
 */
async function source(slug, map, url)
{
	const path = join(SOURCE_CACHE, `${slug}_${map}.jpg`);
	if (existsSync(path)) { return readFileSync(path); }
	const response = await fetch(url);
	if (!response.ok) { throw new Error(`${url} -> HTTP ${response.status}`); }
	const bytes = Buffer.from(await response.arrayBuffer());
	mkdirSync(SOURCE_CACHE, {recursive: true});
	writeFileSync(path, bytes);
	return bytes;
}

/* -------------------------------------------------------------------------
 * Processing
 * ------------------------------------------------------------------------- */

/**
 * One map, resized in linear light and gated.
 *
 * Both gates are `resize-textures.mjs`'s own, applied to the same two questions
 * it applies them to: `lowFrequency` against the 1K source asks *"is this the
 * same image"* - a gamma slip, a channel swap or a misalignment all survive
 * being averaged to 64 pixels - and `codecRms` against the pixels that went
 * into the encoder asks *"did JPEG carry them"*.
 *
 * A map that fails either is not shipped smaller; the whole material is
 * refused. Half a material is worse than none, because the picker would offer
 * a swatch whose roughness map is missing and the surface would silently render
 * with the profile's scalar.
 *
 * @returns {{bytes: Buffer, width: number, height: number, lowFrequencyRms: number,
 *   lowFrequencyMax: number, codecRms: number, refused: ?string}}
 */
function processMap(sourceBytes, edge)
{
	const raster = decode(sourceBytes);
	if (!raster) { return {refused: 'source did not decode as PNG or JPEG'}; }

	const resized = raster.width === edge && raster.height === edge
		? raster
		: resample(raster, edge, Math.max(1, Math.round((raster.height / raster.width) * edge)));
	const bytes = encodeJpeg(resized, QUALITY);
	const back = decode(bytes);
	if (!back) { return {refused: 're-encoded bytes did not decode'}; }

	const low = lowFrequency(raster, back);
	const codec = pixelRms(resized.data, back.data);

	let refused = null;
	if (low.rms > GATES.lowFrequencyRms) { refused = `lowFrequency rms ${low.rms.toFixed(3)} over ${GATES.lowFrequencyRms}`; }
	else if (low.max > GATES.lowFrequencyMax) { refused = `lowFrequency max ${low.max} over ${GATES.lowFrequencyMax}`; }
	else if (codec > GATES.codecRms) { refused = `codec rms ${codec.toFixed(3)} over ${GATES.codecRms}`; }

	return {
		bytes, width: resized.width, height: resized.height,
		lowFrequencyRms: Number(low.rms.toFixed(3)), lowFrequencyMax: low.max,
		codecRms: Number(codec.toFixed(3)), refused,
	};
}

/* -------------------------------------------------------------------------
 * Catalog and credits
 * ------------------------------------------------------------------------- */

function buildCatalog(rows)
{
	const entry = (row) => ({
		name: row.name,
		family: row.family,
		url: `materials/${row.slug}/albedo.jpg`,
		roughnessMap: `materials/${row.slug}/rough.jpg`,
		thumbnail: `materials/thumbnails/${row.slug}.jpg`,
		stretch: false,
		scale: row.scale,
		authors: row.authors,
		source: `https://polyhaven.com/a/${row.slug}`,
	});

	return {
		version: 1,
		_comment: [
			'Generated by tools/fetch-materials.mjs (RM-011 H1). Do not edit by hand:',
			'`npm run materials:check` compares this file against the tree it describes,',
			'so a name changed here and not there is a failing build. Every entry is a',
			'superset of a src/catalog/textures.json entry, which is why TexturePicker',
			'reads both without knowing the difference.',
			'',
			'`scale` is centimetres per tile, taken from the asset\'s own published',
			'real-world size rather than chosen - see the tool\'s docblock.',
		].join(' '),
		license: LICENCE,
		wall: rows.filter((row) => row.surfaces.includes('wall')).map(entry),
		floor: rows.filter((row) => row.surfaces.includes('floor')).map(entry),
	};
}

function buildCredits(rows)
{
	const lines = [
		'# Material library credits',
		'',
		`Every material below is **${LICENCE.name}** from [${LICENCE.source}](${LICENCE.sourceUrl}).`,
		'CC0 waives the requirement to attribute. This file exists anyway, because',
		'knowing who made a thing is worth more than the licence asks for.',
		'',
		'Acquired and processed by `tools/fetch-materials.mjs`; what was measured on',
		'the way in is in `asset-pipeline/material-library.json`.',
		'',
		'| Material | Author | Source |',
		'| --- | --- | --- |',
	];
	for (const row of rows)
	{
		lines.push(`| ${row.name} | ${row.authors.join(', ')} | [${row.slug}](https://polyhaven.com/a/${row.slug}) |`);
	}
	return lines.join('\n') + '\n';
}

/* -------------------------------------------------------------------------
 * Driver
 * ------------------------------------------------------------------------- */

/** Everything the report records about one shipped file. */
function fileRecord(name, bytes, map)
{
	return {
		name, bytes: bytes.length, hash: sha(bytes),
		width: map.width, height: map.height,
		lowFrequencyRms: map.lowFrequencyRms, lowFrequencyMax: map.lowFrequencyMax,
		codecRms: map.codecRms,
	};
}

async function build()
{
	const rows = [];
	const refused = [];

	for (const material of MATERIALS)
	{
		const info = await json(`${API}/info/${material.slug}`);
		const files = await json(`${API}/files/${material.slug}`);
		const diffuse = files.Diffuse && files.Diffuse['1k'] && files.Diffuse['1k'].jpg;
		const rough = files.Rough && files.Rough['1k'] && files.Rough['1k'].jpg;
		if (!diffuse || !rough)
		{
			refused.push({slug: material.slug, reason: 'no 1k jpg Diffuse or Rough published'});
			continue;
		}

		const albedo = processMap(await source(material.slug, 'diff', diffuse.url), ALBEDO_EDGE);
		const roughness = processMap(await source(material.slug, 'rough', rough.url), ROUGHNESS_EDGE);
		if (albedo.refused || roughness.refused)
		{
			refused.push({slug: material.slug, reason: albedo.refused || roughness.refused,
				map: albedo.refused ? 'albedo' : 'roughness'});
			continue;
		}

		// The albedo, not the source: a swatch should show what picking it puts on
		// the wall. Any difference between the two is the pipeline's, and a
		// thumbnail that hid it would be the one place it could hide.
		const thumbnail = encodeJpeg(resample(decode(albedo.bytes), THUMBNAIL_EDGE, THUMBNAIL_EDGE), QUALITY);

		const dir = join(OUT_DIR, material.slug);
		mkdirSync(dir, {recursive: true});
		mkdirSync(THUMB_DIR, {recursive: true});
		writeFileSync(join(dir, 'albedo.jpg'), albedo.bytes);
		writeFileSync(join(dir, 'rough.jpg'), roughness.bytes);
		writeFileSync(join(THUMB_DIR, `${material.slug}.jpg`), thumbnail);

		rows.push({
			...material,
			published: info.name,
			authors: Object.keys(info.authors || {}).sort(),
			// Millimetres to centimetres, and rounded: a scale is a tiling hint,
			// and 169.99996900558472 in a catalog is a number nobody can read.
			scale: Math.round((info.dimensions || [1000])[0] / 10),
			sourceBytes: {albedo: diffuse.size, roughness: rough.size},
			files: [
				fileRecord(`materials/${material.slug}/albedo.jpg`, albedo.bytes, albedo),
				fileRecord(`materials/${material.slug}/rough.jpg`, roughness.bytes, roughness),
				{name: `materials/thumbnails/${material.slug}.jpg`, bytes: thumbnail.length,
					hash: sha(thumbnail), width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE},
			],
		});

		process.stdout.write(`  ${material.name.padEnd(22)} ${String(albedo.bytes.length).padStart(7)} + ${String(roughness.bytes.length).padStart(6)} B\n`);
	}

	return {rows, refused};
}

function report(rows, refused)
{
	const shipped = rows.flatMap((row) => row.files);
	const total = shipped.reduce((sum, file) => sum + file.bytes, 0);
	const measured = shipped.filter((file) => file.codecRms !== undefined);

	return {
		note: [
			'RM-011 H1. The material library, at the size H1\'s encode trial allowed.',
			'',
			'Thirty CC0 materials from Poly Haven, albedo and roughness, resized in',
			'linear light and gated by tools/resize-textures.mjs\'s own two gates. See',
			'tools/fetch-materials.mjs for why JPEG rather than the KTX2 the trial',
			'measured, and why the two maps ship at different resolutions.',
			'',
			'Every number here was produced by running the tool. `hash` is what',
			'--check verifies the committed tree against, with no network.',
		],
		license: LICENCE,
		settings: {
			albedoEdge: ALBEDO_EDGE, roughnessEdge: ROUGHNESS_EDGE,
			thumbnailEdge: THUMBNAIL_EDGE, quality: QUALITY, resizeCap: CAP,
		},
		gates: GATES,
		totals: {
			materials: rows.length,
			files: shipped.length,
			bytes: total,
			// M-27, extended by H1's acceptance: the count of measured images has to
			// equal the count of shipped ones, thumbnails aside - those are `<img>`
			// sources that never reach a shader.
			measuredImages: measured.length,
			worstLowFrequencyRms: Math.max(...measured.map((file) => file.lowFrequencyRms)),
			worstCodecRms: Math.max(...measured.map((file) => file.codecRms)),
			meanAlbedoBytes: Math.round(rows.reduce((sum, row) => sum + row.files[0].bytes, 0) / rows.length),
			meanRoughnessBytes: Math.round(rows.reduce((sum, row) => sum + row.files[1].bytes, 0) / rows.length),
			sourceBytes: rows.reduce((sum, row) => sum + row.sourceBytes.albedo + row.sourceBytes.roughness, 0),
		},
		refused,
		materials: rows.map((row) => ({
			slug: row.slug, name: row.name, published: row.published, family: row.family,
			surfaces: row.surfaces, authors: row.authors, scale: row.scale,
			sourceBytes: row.sourceBytes, files: row.files,
		})),
	};
}

function verify()
{
	if (!existsSync(REPORT_PATH))
	{
		console.error('No asset-pipeline/material-library.json. Run `npm run materials`.');
		return 1;
	}
	const previous = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
	const stale = [];

	// Shipped plus refused, not shipped alone: a material the gates turned away
	// is a recorded outcome, and comparing only the shipped count would make a
	// refusal permanently stale.
	const accounted = previous.materials.length + previous.refused.length;
	if (accounted !== MATERIALS.length)
	{
		stale.push(`the report accounts for ${accounted} materials, the tool asks for ${MATERIALS.length}`);
	}
	for (const material of previous.materials)
	{
		for (const file of material.files)
		{
			const path = join(PUBLIC, file.name);
			if (!existsSync(path)) { stale.push(`${file.name} is missing`); continue; }
			const bytes = readFileSync(path);
			if (bytes.length !== file.bytes) { stale.push(`${file.name} is ${bytes.length} B, the report says ${file.bytes}`); continue; }
			if (sha(bytes) !== file.hash) { stale.push(`${file.name} does not match its recorded hash`); }
		}
	}

	// The catalog is generated from the same rows the report is, so a drift
	// between them means somebody edited one by hand.
	const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
	const offered = new Set([...catalog.wall, ...catalog.floor].map((entry) => entry.url));
	for (const material of previous.materials)
	{
		if (!offered.has(`materials/${material.slug}/albedo.jpg`))
		{
			stale.push(`${material.slug} is in the report but not in src/catalog/materials.json`);
		}
	}

	if (stale.length)
	{
		console.error('\nThe material library is stale:\n');
		for (const line of stale) { console.error(`  ${line}`); }
		console.error('\nRun `npm run materials` (needs network) and commit the result.\n');
		return 1;
	}
	console.log(`\n${previous.materials.length} materials, ${previous.totals.files} files, ${previous.totals.bytes} B, all matching the report.\n`);
	return 0;
}

async function main()
{
	if (CHECK) { process.exit(verify()); }

	console.log(`\nFetching ${MATERIALS.length} CC0 materials, albedo ${ALBEDO_EDGE}px and roughness ${ROUGHNESS_EDGE}px at q${QUALITY}:\n`);
	// A material removed from the list above has to leave the tree too, or the
	// budget keeps paying for it and `npm run manifest` keeps listing it.
	if (existsSync(OUT_DIR)) { rmSync(OUT_DIR, {recursive: true}); }
	const {rows, refused} = await build();

	const built = report(rows, refused);
	writeFileSync(REPORT_PATH, JSON.stringify(built, null, '\t') + '\n');
	writeFileSync(CATALOG_PATH, JSON.stringify(buildCatalog(rows), null, '\t') + '\n');
	writeFileSync(CREDITS_PATH, buildCredits(rows));

	console.log(`\n${rows.length} materials, ${built.totals.files} files, ${(built.totals.bytes / 1048576).toFixed(2)} MB`);
	console.log(`  from ${(built.totals.sourceBytes / 1048576).toFixed(2)} MB of 1K sources`);
	console.log(`  worst lowFrequency rms ${built.totals.worstLowFrequencyRms}, worst codec rms ${built.totals.worstCodecRms}`);
	if (refused.length) { console.log(`  ${refused.length} refused, see the report`); }
	console.log('\nRun `npm run manifest` and `npm run budget:update` next.\n');
}

main().catch((error) => {console.error(error); process.exit(1);});
