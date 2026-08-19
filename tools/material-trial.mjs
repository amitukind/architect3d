/**
 * Can this codec carry a material library? (RM-011 H1, task one.)
 *
 *   node tools/material-trial.mjs            measure and write the report
 *   node tools/material-trial.mjs --check    fail if the report is stale
 *
 * ## Why this runs before anything is built
 *
 * RM-007 prices H1 with *"a CC0 library of about ninety materials"*, and RM-011
 * W-4 measured that ninety materials of three maps is 270 images against 78,894
 * bytes of `public-total` headroom. The library's size therefore cannot be
 * decided by a plan; it has to be decided by what the encoder actually delivers.
 * So this is the sprint's first task, and its output is a number the rest of the
 * sprint spends.
 *
 * ## What is measured, and why it is these images
 *
 * A material is three maps and they are three different kinds of image, which
 * is the whole question:
 *
 *   albedo     a photograph. Already measured, and the news is bad - the room
 *              oracle put hardwood at 6.147 and brick at 7.379 against a 3.0
 *              gate. This re-measures them beside the other two so the three
 *              are comparable in one table.
 *   normal     a vector field packed into RGB. Banding here is not a slightly
 *              wrong colour, it is a slightly wrong *surface*, and
 *              `encode-textures.mjs` already says UASTC "exists for normal maps
 *              and material data where banding is structural".
 *   roughness  one low-frequency channel. Nothing in this tree has ever
 *              measured one.
 *
 * The normal and roughness maps are **derived from the tree's own material
 * photographs** rather than downloaded or drawn. That is deliberate. What is
 * being measured is how a codec handles the *content*, and real wood grain
 * derived into a real normal map is real high-frequency detail in the places
 * wood actually has it; synthetic noise would answer a different question. It
 * also keeps the trial runnable with no network and no third-party licence,
 * which matters because the answer is needed before the library is acquired,
 * not after.
 *
 * The derivation is the ordinary one - Sobel over luminance for the normal,
 * local deviation for the roughness - and it is in this file rather than hidden
 * behind a dependency so that anybody re-reading the verdict can see exactly
 * what was encoded.
 *
 * ## The instrument is the oracle's, not a second copy
 *
 * `measurePairs` is exported from `tools/transcode-oracle.mjs` for this caller.
 * Rendering source and transcode through the same geometry, camera and sampler
 * and differencing the framebuffer is the only measurement this project accepts
 * about a codec - RM-006 exists because B5 argued from a catalog-wide disk
 * figure instead - and a second harness would drift from the first with nobody
 * able to say which was right.
 */
import {encodeToKTX2} from 'ktx2-encoder';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {dirname, extname, join, resolve} from 'node:path';

import {measurePairs, decodeImage, quietly, RESIDUAL_CEILING} from './transcode-oracle.mjs';
import {ENCODE} from './encode-textures.mjs';
import {GATES} from './resize-textures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC = join(ROOT, 'public');
const OUT_PATH = join(ROOT, 'asset-pipeline', 'material-trial.json');

const CHECK = process.argv.includes('--check');

/**
 * The four material photographs this tree ships, which are the four classes a
 * material library is mostly made of: a plank floor, a stone tile, a masonry
 * wall and a fine-grained wood.
 */
const SOURCES = [
	{name: 'hardwood', file: 'rooms/textures/hardwood.jpg', kind: 'plank wood'},
	{name: 'marbletiles', file: 'rooms/textures/marbletiles.jpg', kind: 'stone tile'},
	{name: 'light_brick', file: 'rooms/textures/light_brick.jpg', kind: 'masonry'},
	{name: 'light_fine_wood', file: 'rooms/textures/light_fine_wood.jpg', kind: 'fine wood'},
];

/**
 * The settings tried, and they are not the same for all three maps.
 *
 * **The first draft of this trial got this wrong, and the wrong answer was
 * dramatic enough to be worth recording.** Encoding a normal map with the
 * shipped options - which are the options for a photograph: perceptual channel
 * weighting, an sRGB transfer function - produced RMS 35 to 48 against a 3.0
 * gate, ten to sixteen times over, and even UASTC came back at 8.8 to 15.3.
 * Read as a codec verdict that says "Basis cannot carry a normal map", which
 * would have been a finding. It is not one. It is what happens when you ask a
 * perceptual encoder to preserve a vector field: it spends its bits where a
 * human eye looks, and a shader reading a surface normal is not a human eye.
 *
 * So each map is encoded as the kind of data it is. `isNormalMap` is basisu's
 * own `-normal_map` preset, which the encoder's own documentation says "tunes
 * several codec parameters so compression works better on normal maps".
 * `isPerceptual: false` and no sRGB transfer function are what the other two
 * non-colour maps need for the same reason.
 *
 * And they are *measured* as the kind of data they are too - see `colorSpace`
 * below and the note in the oracle's `prepare`.
 */
const COLOUR_SETTINGS = [
	{label: 'ETC1S q128', options: {isUASTC: false, qualityLevel: 128}},
	{label: 'ETC1S q255', options: {isUASTC: false, qualityLevel: 255}},
	{label: 'UASTC', options: {isUASTC: true}},
];

/** Non-colour: no perceptual weighting, no sRGB transfer function. */
const DATA = {isPerceptual: false, isSetKTX2SRGBTransferFunc: false, isInputSRGB: false};

const NORMAL_SETTINGS = [
		{label: 'ETC1S q128', options: {isUASTC: false, qualityLevel: 128, isNormalMap: true, ...DATA}},
		{label: 'ETC1S q255', options: {isUASTC: false, qualityLevel: 255, isNormalMap: true, ...DATA}},
	{label: 'UASTC', options: {isUASTC: true, isNormalMap: true, ...DATA}},
];

const SETTINGS_BY_MAP = {
	albedo: COLOUR_SETTINGS,
	normal: NORMAL_SETTINGS,
	'normal-smooth': NORMAL_SETTINGS,
	roughness: [
		{label: 'ETC1S q128', options: {isUASTC: false, qualityLevel: 128, ...DATA}},
		{label: 'ETC1S q255', options: {isUASTC: false, qualityLevel: 255, ...DATA}},
		{label: 'UASTC', options: {isUASTC: true, ...DATA}},
	],
};

/** Which maps are colour and which are data, for both the encode and the render. */
const COLOUR_SPACE = {albedo: 'srgb', normal: 'linear', 'normal-smooth': 'linear', roughness: 'linear'};

/* -------------------------------------------------------------------------
 * Deriving the two maps nobody has measured
 * ------------------------------------------------------------------------- */

/** Rec. 709 luminance, which is what a height field is read from. */
function luminance(rgba, width, height)
{
	const out = new Float32Array(width * height);
	for (let i = 0; i < width * height; i++)
	{
		out[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
	}
	return out;
}

/** Wrapping, because a material tiles and its edges have to agree. */
function at(field, width, height, x, y)
{
	return field[((y + height) % height) * width + ((x + width) % width)];
}

/**
 * A tangent-space normal map from a height field.
 *
 * The textbook Sobel pair, with the slope scaled so a photograph's tonal range
 * produces a plausible surface rather than a mirror or a cliff. `strength` is
 * the one free parameter and it is recorded in the report, because a normal map
 * derived at a different strength is a different image and would measure
 * differently.
 */
function normalMap(rgba, width, height, strength, smoothing)
{
	const h = blur(luminance(rgba, width, height), width, height, smoothing || 0);
	const out = Buffer.alloc(width * height * 4);
	for (let y = 0; y < height; y++)
	{
		for (let x = 0; x < width; x++)
		{
			const tl = at(h, width, height, x - 1, y - 1);
			const tc = at(h, width, height, x, y - 1);
			const tr = at(h, width, height, x + 1, y - 1);
			const ml = at(h, width, height, x - 1, y);
			const mr = at(h, width, height, x + 1, y);
			const bl = at(h, width, height, x - 1, y + 1);
			const bc = at(h, width, height, x, y + 1);
			const br = at(h, width, height, x + 1, y + 1);
			const dx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
			const dy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
			let nx = -dx * strength;
			let ny = -dy * strength;
			const nz = 1;
			const length = Math.hypot(nx, ny, nz);
			nx /= length;
			ny /= length;
			const i = (y * width + x) * 4;
			out[i] = Math.round((nx * 0.5 + 0.5) * 255);
			out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
			out[i + 2] = Math.round((nz / length * 0.5 + 0.5) * 255);
			out[i + 3] = 255;
		}
	}
	return out;
}

/**
 * A roughness map from local contrast.
 *
 * Smooth regions read as smoother and busy regions as rougher, which is the
 * relationship a photographed material usually has and is enough to produce an
 * honest single-channel low-frequency image. Written to all three channels
 * because that is what a grey PNG is, and because the point of the measurement
 * is the codec's behaviour on this kind of *content*, not on a channel layout.
 */
function roughnessMap(rgba, width, height, radius)
{
	const h = luminance(rgba, width, height);
	const out = Buffer.alloc(width * height * 4);
	const span = radius * 2 + 1;
	for (let y = 0; y < height; y++)
	{
		for (let x = 0; x < width; x++)
		{
			let sum = 0;
			let sumSquares = 0;
			for (let dy = -radius; dy <= radius; dy++)
			{
				for (let dx = -radius; dx <= radius; dx++)
				{
					const v = at(h, width, height, x + dx, y + dy);
					sum += v;
					sumSquares += v * v;
				}
			}
			const n = span * span;
			const variance = Math.max(0, sumSquares / n - (sum / n) * (sum / n));
			// 0.35 to 0.95, which is the range a real material library occupies:
			// nothing in a room is a mirror and nothing is pure diffuse.
			const value = Math.round(255 * Math.min(0.95, 0.35 + Math.sqrt(variance) * 3));
			const i = (y * width + x) * 4;
			out[i] = value;
			out[i + 1] = value;
			out[i + 2] = value;
			out[i + 3] = 255;
		}
	}
	return out;
}

/**
 * A box blur over the height field, before the slope is taken.
 *
 * Not smoothing for its own sake. A real normal map is baked from geometry or
 * from a high-resolution height scan; deriving one from a **JPEG** means that
 * image's own 8x8 ringing becomes surface detail, and a Sobel amplifies exactly
 * the frequencies a lossy codec put there. So the raw derivation is a
 * pathological input and it would be dishonest to report its verdict as a
 * verdict about normal maps.
 *
 * The trial therefore derives the normal map **twice** - once raw and steep,
 * once blurred and shallow - and reports both. If the two agree, the answer is
 * about the codec. If they disagree, the answer is about the input, and the
 * trial says so instead of pretending.
 */
function blur(field, width, height, radius)
{
	if (!radius) { return field; }
	const out = new Float32Array(field.length);
	const span = radius * 2 + 1;
	for (let y = 0; y < height; y++)
	{
		for (let x = 0; x < width; x++)
		{
			let sum = 0;
			for (let dy = -radius; dy <= radius; dy++)
			{
				for (let dx = -radius; dx <= radius; dx++)
				{
					sum += at(field, width, height, x + dx, y + dy);
				}
			}
			out[y * width + x] = sum / (span * span);
		}
	}
	return out;
}

/**
 * How much of an image's energy is in the highest frequencies, 0 to 1.
 *
 * The number that says whether an input is a surface or is noise: the mean
 * absolute difference between each texel and its four neighbours, over the
 * image's own range. A block codec compresses a 4x4 neighbourhood, so an image
 * whose neighbours disagree everywhere is one no block codec can carry - and
 * that is a fact about the image, not about the codec.
 */
function highFrequencyShare(rgba, width, height)
{
	let total = 0;
	let count = 0;
	let min = 255;
	let max = 0;
	for (let y = 0; y < height; y++)
	{
		for (let x = 0; x < width; x++)
		{
			for (let c = 0; c < 3; c++)
			{
				const here = rgba[(y * width + x) * 4 + c];
				min = Math.min(min, here);
				max = Math.max(max, here);
				const right = rgba[(y * width + ((x + 1) % width)) * 4 + c];
				const down = rgba[(((y + 1) % height) * width + x) * 4 + c];
				total += Math.abs(here - right) + Math.abs(here - down);
				count += 2;
			}
		}
	}
	const span = Math.max(1, max - min);
	return Number((total / count / span).toFixed(4));
}

/** The parameters the maps above are derived at, recorded in the report. */
const NORMAL_STRENGTH = 8;
const NORMAL_SMOOTH_STRENGTH = 2;
const NORMAL_SMOOTH_RADIUS = 2;
const ROUGHNESS_RADIUS = 2;

/* -------------------------------------------------------------------------
 * Building the candidate set
 * ------------------------------------------------------------------------- */

function decodeFile(bytes)
{
	if (bytes[0] === 0x89 && bytes[1] === 0x50)
	{
		const png = PNG.sync.read(bytes);
		return {width: png.width, height: png.height, data: new Uint8Array(png.data)};
	}
	const image = jpeg.decode(bytes, {useTArray: true, formatAsRGBA: true});
	return {width: image.width, height: image.height, data: new Uint8Array(image.data)};
}

function writePng(path, data, width, height)
{
	const png = new PNG({width, height});
	Buffer.from(data).copy(png.data);
	writeFileSync(path, PNG.sync.write(png));
}

/**
 * Every candidate, encoded at every setting, written into the scratch directory
 * the harness serves from.
 */
async function buildCandidates(scratch)
{
	const pairs = [];
	const catalogue = [];

	for (const source of SOURCES)
	{
		const bytes = readFileSync(join(PUBLIC, source.file));
		const image = decodeFile(bytes);
		const {width, height} = image;

		const maps = [
			{map: 'albedo', bytes, ext: extname(source.file)},
			{
				map: 'normal',
				pixels: normalMap(image.data, width, height, NORMAL_STRENGTH, 0),
				ext: '.png',
				derivedAs: `Sobel, strength ${NORMAL_STRENGTH}, no smoothing`,
			},
			{
				map: 'normal-smooth',
				pixels: normalMap(image.data, width, height,
					NORMAL_SMOOTH_STRENGTH, NORMAL_SMOOTH_RADIUS),
				ext: '.png',
				derivedAs: `Sobel, strength ${NORMAL_SMOOTH_STRENGTH}, blurred r${NORMAL_SMOOTH_RADIUS}`,
			},
			{
				map: 'roughness',
				pixels: roughnessMap(image.data, width, height, ROUGHNESS_RADIUS),
				ext: '.png',
				derivedAs: `local deviation, r${ROUGHNESS_RADIUS}`,
			},
		];

		for (const entry of maps)
		{
			const stem = `${source.name}.${entry.map}`;
			const sourcePath = join(scratch, stem + entry.ext);
			if (entry.pixels)
			{
				writePng(sourcePath, entry.pixels, width, height);
			}
			else
			{
				writeFileSync(sourcePath, entry.bytes);
			}
			const sourceBytes = readFileSync(sourcePath);

			catalogue.push({
				name: stem, material: source.name, kind: source.kind, map: entry.map,
				pixels: `${width}x${height}`, sourceBytes: sourceBytes.length,
				derivedAs: entry.derivedAs || 'the shipped photograph',
				// How hard this image is to compress, as a property of the image.
				highFrequencyShare: highFrequencyShare(
					entry.pixels || decodeFile(bytes).data, width, height),
			});

			for (const setting of SETTINGS_BY_MAP[entry.map])
			{
				const encoded = Buffer.from(await quietly(() => encodeToKTX2(
					new Uint8Array(sourceBytes),
					{...ENCODE, ...setting.options, imageDecoder: decodeImage})));
				const file = `${stem}.${setting.label.replace(/\W/g, '')}.ktx2`;
				writeFileSync(join(scratch, file), encoded);
				pairs.push({
					name: stem,
					from: setting.label,
					bytes: encoded.length,
					sourceBytesLength: sourceBytes.length,
					colorSpace: COLOUR_SPACE[entry.map],
					source: '/__scratch__/' + stem + entry.ext,
					ktx2: '/__scratch__/' + file,
				});
			}
		}
	}

	return {pairs, catalogue};
}

/* -------------------------------------------------------------------------
 * Reporting
 * ------------------------------------------------------------------------- */

function table(rows)
{
	const width = Math.max(...rows.map((row) => row.name.length));
	console.log(`\n  ${'candidate'.padEnd(width)}  ${'setting'.padEnd(11)}  ${'RMS'.padStart(7)}  ${'max'.padStart(4)}  ${'% of source'.padStart(12)}  ${'transcoded to'.padEnd(22)}  verdict`);
	console.log('  ' + '-'.repeat(width + 50));
	for (const row of rows)
	{
		const pct = Math.round(100 * row.bytes / row.sourceBytesLength);
		const passes = row.rms <= GATES.codecRms;
		console.log(`  ${row.name.padEnd(width)}  ${row.from.padEnd(11)}  ${row.rms.toFixed(3).padStart(7)}  `
			+ `${String(row.max).padStart(4)}  ${(pct + ' %').padStart(12)}  ${String(row.transcodedTo || '?').padEnd(22)}  ${passes ? 'passes' : 'REFUSED'}`);
	}
}

/**
 * The verdict per map kind, and what it costs.
 *
 * Reported as a count rather than as a boolean, because "three of four
 * materials pass" is a different fact from "none does" and the sprint spends
 * them differently. A map kind that carries at some setting is priced at that
 * setting's mean; one that does not ships as its source, which is the rule B1
 * wrote and RM-006 enforced by reverting eight files rather than raising a gate.
 */
function verdicts(rows, catalogue)
{
	const out = [];
	for (const map of ['albedo', 'normal', 'normal-smooth', 'roughness'])
	{
		const forMap = rows.filter((row) => row.name.endsWith('.' + map));
		if (!forMap.length) { continue; }
		const materials = new Set(forMap.map((row) => row.name)).size;
		const inputs = catalogue.filter((entry) => entry.map === map);
		const meanHighFrequency = Number((inputs.reduce(
			(total, entry) => total + entry.highFrequencyShare, 0) / inputs.length).toFixed(4));
		const meanSourceBytes = Math.round(
			inputs.reduce((total, entry) => total + entry.sourceBytes, 0) / inputs.length);

		const attempts = SETTINGS_BY_MAP[map].map((setting) =>
		{
			const set = forMap.filter((row) => row.from === setting.label);
			return {
				setting: setting.label,
				passing: set.filter((row) => row.rms <= GATES.codecRms).length,
				worstRms: Number(Math.max(...set.map((row) => row.rms)).toFixed(3)),
				meanBytes: Math.round(set.reduce((total, row) => total + row.bytes, 0) / set.length),
				meanPctOfSource: Math.round(set.reduce(
					(total, row) => total + 100 * row.bytes / row.sourceBytesLength, 0) / set.length),
			};
		});
		const clean = attempts.find((attempt) => attempt.passing === materials);
		// The cheapest that carries every material AND is smaller than the source.
		// A container that clears the gate and grows the download has won nothing.
		const worthIt = clean && clean.meanPctOfSource < 100 ? clean : null;

		out.push({
			map,
			materials,
			meanHighFrequency,
			meanSourceBytes,
			attempts,
			ships: worthIt ? worthIt.setting : 'its source, uncompressed',
			shipsMeanBytes: worthIt ? worthIt.meanBytes : meanSourceBytes,
			note: worthIt
				? `every material clears the ${GATES.codecRms} gate at ${worthIt.setting}, at `
					+ `${worthIt.meanPctOfSource} % of source`
				: clean
					? `clears the gate at ${clean.setting} but at ${clean.meanPctOfSource} % of source, `
						+ 'so the container costs more than it saves'
					: `${Math.max(...attempts.map((attempt) => attempt.passing))} of ${materials} `
						+ `materials clear the ${GATES.codecRms} gate at best`,
		});
	}
	return out;
}

/**
 * What a library of a given size would weigh, from the verdicts above.
 *
 * The arithmetic H1 exists to produce. RM-011 W-4 priced ninety materials from
 * this tree's *encoded* means because that was all there was; this prices them
 * from what each map kind actually ships as, which is the number that decides
 * how many there can be.
 */
function sizing(verdict, headroom)
{
	const perMaterial = ['albedo', 'normal-smooth', 'roughness']
		.map((map) => verdict.find((row) => row.map === map))
		.filter(Boolean)
		.reduce((total, row) => total + row.shipsMeanBytes, 0);
	const albedoOnly = verdict.find((row) => row.map === 'albedo').shipsMeanBytes;
	return {
		bytesPerMaterialThreeMaps: perMaterial,
		bytesPerMaterialAlbedoOnly: albedoOnly,
		headroomBytes: headroom,
		materialsThatFitThreeMaps: Math.floor(headroom / perMaterial),
		materialsThatFitAlbedoOnly: Math.floor(headroom / albedoOnly),
		// What the runtime-asset budget would have to become. The number H1 has
		// to write into the commit that raises it, for each library it might ship.
		raiseRequired: [10, 30, 90].map((count) => ({
			materials: count,
			threeMapsBytes: count * perMaterial,
			albedoOnlyBytes: count * albedoOnly,
		})),
	};
}

async function main()
{
	const scratch = mkdtempSync(join(tmpdir(), 'material-trial-'));
	try
	{
		console.log('\nRM-011 H1 task one: what the codec does to a material\'s three maps.\n');

		const {pairs, catalogue} = await buildCandidates(scratch);
		console.log(`  ${catalogue.length} candidates from ${SOURCES.length} materials, ${pairs.length} encodes`);

		const result = await measurePairs(pairs, scratch);

		const opaque = result.rows.filter((row) => row.residual > RESIDUAL_CEILING);
		if (opaque.length)
		{
			console.error(`\n  ✗ the render path is not transparent for ${opaque.length} rows; every number below is that residual plus the codec.\n`);
			process.exit(1);
		}
		console.log('  ✓ render path transparent - worst source residual '
			+ Math.max(...result.rows.map((row) => row.residual)).toFixed(3) + ` / ${RESIDUAL_CEILING} allowed`);

		table(result.rows);
		const verdict = verdicts(result.rows, catalogue);

		console.log('\n  Per map, and how hard its images are to compress:');
		verdict.forEach((row) => console.log(`    ${row.map.padEnd(14)}`
			+ `hi-freq ${row.meanHighFrequency.toFixed(4)}   ships as ${String(row.ships).padEnd(26)}${row.note}`));

		const budget = JSON.parse(readFileSync(join(ROOT, 'tools', 'budget.json'), 'utf8')).budgets;
		const headroom = budget['public-total'].limit - budget['public-total'].measured;
		const size = sizing(verdict, headroom);
		console.log(`\n  A material is ${size.bytesPerMaterialThreeMaps.toLocaleString()} B with three maps `
			+ `and ${size.bytesPerMaterialAlbedoOnly.toLocaleString()} B with one.`);
		console.log(`  Today's public-total headroom is ${headroom.toLocaleString()} B, which is `
			+ `${size.materialsThatFitThreeMaps} materials of three maps or `
			+ `${size.materialsThatFitAlbedoOnly} of one.`);
		const limit = budget['public-total'].limit;
		console.log(`\n  ${'library'.padEnd(16)}${'three maps'.padStart(16)}${'albedo only'.padStart(16)}`);
		size.raiseRequired.forEach((row) => console.log(
			`  ${(row.materials + ' materials').padEnd(16)}`
			+ `${((limit + row.threeMapsBytes - headroom) / 1048576).toFixed(1) + ' MB'} `.padStart(16)
			+ `${((limit + row.albedoOnlyBytes - headroom) / 1048576).toFixed(1) + ' MB'} `.padStart(16)));
		console.log(`  ${'(public-total is ' + (limit / 1048576).toFixed(1) + ' MB today)'}`);

		const file = {
			note: [
				'RM-011 H1 task one. Can ETC1S or UASTC carry a material library?',
				'',
				'Four of the tree\'s own material photographs, each turned into the three',
				'maps a PBR material is, each encoded at three settings, and each rendered',
				'against its source through the transcode oracle\'s harness and differenced',
				'in the framebuffer. The normal and roughness maps are derived here rather',
				'than downloaded - see the module comment for why, and for the derivation.',
				'',
				'THE LIBRARY\'S SIZE IS DECIDED BY THIS FILE, not by RM-007\'s "about ninety".',
			],
			gate: {codecRms: GATES.codecRms, source: 'tools/resize-textures.mjs GATES'},
			derivation: {normalStrength: NORMAL_STRENGTH, roughnessRadius: ROUGHNESS_RADIUS},
			settings: Object.fromEntries(Object.entries(SETTINGS_BY_MAP).map(([map, list]) =>
				[map, list.map((setting) => ({label: setting.label, ...setting.options}))])),
			colorSpace: COLOUR_SPACE,
			candidates: catalogue,
			verdicts: verdict,
			sizing: size,
			rows: result.rows.map((row) => ({
				name: row.name,
				setting: row.from,
				measuredAs: row.measuredAs,
				transcodedTo: row.transcodedTo,
				rms: Number(row.rms.toFixed(3)),
				max: row.max,
				pctOver8: Number(row.pctOver8.toFixed(2)),
				bytes: row.bytes,
				pctOfSource: Math.round(100 * row.bytes / row.sourceBytesLength),
				clearsGate: row.rms <= GATES.codecRms,
			})),
		};

		if (CHECK)
		{
			const existing = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
			if (existing !== JSON.stringify(file, null, '\t') + '\n')
			{
				console.error('\n  ✗ Material trial     the recorded report is not what this run produced\n');
				process.exit(1);
			}
			console.log(`\n  ✓ Material trial     ${result.rows.length} encodes reproduce ${OUT_PATH.replace(ROOT + '/', '')}\n`);
			return;
		}

		writeFileSync(OUT_PATH, JSON.stringify(file, null, '\t') + '\n');
		console.log(`\n  wrote ${OUT_PATH.replace(ROOT + '/', '')}\n`);
	}
	finally
	{
		rmSync(scratch, {recursive: true, force: true});
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
