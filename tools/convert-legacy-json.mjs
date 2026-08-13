#!/usr/bin/env node
/**
 * Sprint S3: convert the 25 legacy three.js JSON models to glTF 2.0 binary.
 *
 *   npm run convert:models          convert every model that has changed
 *   npm run convert:models -- --all rewrite all of them
 *
 * Reads  build/models/js/ *.js                (three.js JSON Model format 3.1)
 * Writes build/models/js-glb/ *.glb           (glTF 2.0, geometry + materials)
 *        build/models/js-glb/textures/ *      (the baked maps, copied verbatim)
 *        build/models/js-glb/conversion-report.json
 *
 * Textures are sidecar files rather than chunks inside each .glb, because they
 * are shared: grey-brown_wood.jpg backs eight of the twenty-five models,
 * white_wood.jpg four, oak_wood.jpg three. Embedding would have duplicated
 * 5.6 MB for that one file alone and defeated HTTP caching. Copying them into
 * the output directory keeps js-glb/ self-contained, so models/js/ can be
 * deleted wholesale in S9.
 *
 * WHY THIS RUNS IN NODE, NOT A BROWSER
 * ------------------------------------
 * The obvious route is three's own GLTFExporter, which needs a DOM: it
 * re-encodes every texture through a <canvas> so it can flip the image
 * vertically, because glTF puts the UV origin at the top-left and three puts it
 * at the bottom-left.
 *
 * Flipping the UV coordinate instead of the image pixels is the same
 * transformation - v_gltf = 1 - v_three - and it means the baked PNGs go into
 * the .glb byte-for-byte, with no decode/re-encode step to lose fidelity in.
 * Nothing then needs a canvas, so the whole conversion is a deterministic Node
 * script that CI can re-run and diff. GLTFLoader sets texture.flipY = false for
 * glTF, which is the other half of the same convention, so the two cancel.
 *
 * Geometry comes from three r98's own JSONLoader - the exact parser the app
 * uses today - and then Geometry.toBufferGeometry(), which is what the renderer
 * already calls internally before drawing. So the vertex data written here is
 * bit-for-bit what the GPU is being handed today, material groups included.
 *
 * MATERIALS
 * ---------
 * All 25 models are Lambert-shaded with a baked diffuse map. glTF has no
 * Lambert, so they land as pbrMetallicRoughness with metallicFactor 0 and
 * roughnessFactor 1 - the corner of the PBR space closest to pure diffuse. The
 * stock exporter would have written the schema default of 0.5/0.5 and made
 * every model visibly darker and glossier. The residual Lambert->Standard BRDF
 * difference is real but small, and is what the per-model A/B review signs off.
 */
import {copyFileSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BufferGeometry, JSONLoader} from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'build/models/js');
const OUTPUT_DIR = join(ROOT, 'build/models/js-glb');
const TEXTURE_DIR = join(OUTPUT_DIR, 'textures');
const REPORT = join(OUTPUT_DIR, 'conversion-report.json');

/** Filled by convert(); reported at the end so broken maps are visible, not silent. */
const missingTextures = new Map();

const GL_FLOAT = 5126;
const GL_UNSIGNED_INT = 5125;
const GL_UNSIGNED_SHORT = 5123;
const GL_ARRAY_BUFFER = 34962;
const GL_ELEMENT_ARRAY_BUFFER = 34963;
const GL_LINEAR = 9729;
const GL_LINEAR_MIPMAP_LINEAR = 9987;
const GL_REPEAT = 10497;
const GL_CLAMP_TO_EDGE = 33071;

const MIME_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'};

/* ------------------------------------------------------------------ parsing */

/**
 * Legacy JSON -> the non-indexed BufferGeometry the renderer draws today.
 *
 * JSONLoader.parse() mutates json.scale (it inverts it in place) and reaches
 * for a DOM when it builds textures, so it gets a shallow copy with the
 * materials stripped. Material definitions are read straight from the raw JSON
 * below, which is what the glTF mapping needs anyway.
 */
function parseLegacyGeometry(json)
{
	const {geometry} = new JSONLoader().parse({...json, materials: []}, '');
	// r98 spells this fromGeometry(); it is the same DirectGeometry conversion
	// WebGLGeometries runs on every legacy Geometry before the first draw call,
	// material groups and all.
	return new BufferGeometry().fromGeometry(geometry);
}

/* ------------------------------------------------------------ glb assembly */

/** Accumulates the GLB binary chunk and hands back bufferView indices. */
class BinaryChunk
{
	constructor()
	{
		this.parts = [];
		this.length = 0;
		this.views = [];
	}

	_align(boundary)
	{
		const padding = (boundary - (this.length % boundary)) % boundary;
		if (padding > 0)
		{
			this.parts.push(Buffer.alloc(padding));
			this.length += padding;
		}
	}

	/** @returns {number} the bufferView index */
	addView(data, target)
	{
		// glTF requires accessor byte offsets to be 4-byte aligned, and every
		// component type here is 2 or 4 bytes wide, so 4 covers all of them.
		this._align(4);
		const view = {buffer: 0, byteOffset: this.length, byteLength: data.length};
		if (target !== undefined)
		{
			view.target = target;
		}
		this.parts.push(data);
		this.length += data.length;
		this.views.push(view);
		return this.views.length - 1;
	}

	toBuffer()
	{
		this._align(4);
		return Buffer.concat(this.parts, this.length);
	}
}

function accessorFor(gltf, bufferView, componentType, count, type, minMax)
{
	const accessor = {bufferView, componentType, count, type};
	if (minMax)
	{
		accessor.min = minMax.min;
		accessor.max = minMax.max;
	}
	gltf.accessors.push(accessor);
	return gltf.accessors.length - 1;
}

function boundsOf(positions)
{
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3)
	{
		for (let axis = 0; axis < 3; axis++)
		{
			const value = positions[i + axis];
			if (value < min[axis]) {min[axis] = value;}
			if (value > max[axis]) {max[axis] = value;}
		}
	}
	return {min, max};
}

/**
 * Weld the non-indexed triangle soup back into indexed geometry.
 *
 * Lossless: two vertices merge only when position, normal and uv all match
 * exactly, so nothing about the rendered surface changes. Purely a size win -
 * the source models carry a lot of shared vertices, and the largest of them
 * (ik_nordli_full, ~15k faces) is 2.8 MB of JSON text.
 */
function weld(vertices)
{
	const index = [];
	const seen = new Map();
	const out = {position: [], normal: [], uv: []};

	for (const vertex of vertices)
	{
		const key = vertex.join(',');
		let existing = seen.get(key);
		if (existing === undefined)
		{
			existing = out.position.length / 3;
			seen.set(key, existing);
			out.position.push(vertex[0], vertex[1], vertex[2]);
			out.normal.push(vertex[3], vertex[4], vertex[5]);
			if (vertex.length > 6)
			{
				out.uv.push(vertex[6], vertex[7]);
			}
		}
		index.push(existing);
	}

	out.index = index;
	return out;
}

/**
 * Slice one material group out of the non-indexed geometry.
 *
 * The v coordinate is flipped here and nowhere else - see the file header.
 */
function primitiveVertices(attributes, start, count, hasUv)
{
	const {position, normal, uv} = attributes;
	const vertices = [];
	for (let i = start; i < start + count; i++)
	{
		const vertex = [
			position[i * 3], position[i * 3 + 1], position[i * 3 + 2],
			normal ? normal[i * 3] : 0, normal ? normal[i * 3 + 1] : 0, normal ? normal[i * 3 + 2] : 0,
		];
		if (hasUv)
		{
			vertex.push(uv[i * 2], 1 - uv[i * 2 + 1]);
		}
		vertices.push(vertex);
	}
	return vertices;
}

/* --------------------------------------------------------------- materials */

function colorOf(legacyMaterial, key, fallback)
{
	const value = legacyMaterial[key];
	return (Array.isArray(value) && value.length >= 3) ? [value[0], value[1], value[2]] : fallback;
}

/**
 * One legacy material definition -> one glTF material.
 *
 * baseColorFactor and colorDiffuse are both consumed without any colour-space
 * conversion (r98 predates colour management and the r105 GLTFLoader does not
 * convert either), so the resulting material.color is identical to what the
 * legacy path produced.
 */
function buildMaterial(gltf, legacyMaterial, textureIndexFor)
{
	const diffuse = colorOf(legacyMaterial, 'colorDiffuse', [1, 1, 1]);
	const emissive = colorOf(legacyMaterial, 'colorEmissive', [0, 0, 0]);
	const opacity = (typeof legacyMaterial.transparency === 'number') ? legacyMaterial.transparency : 1;
	const transparent = legacyMaterial.transparent === true || opacity < 1;

	const pbr = {
		baseColorFactor: [diffuse[0], diffuse[1], diffuse[2], opacity],
		// Lambert has no metal and no gloss. The schema defaults (0.5/0.5) would
		// stamp every one of these models half-metallic.
		metallicFactor: 0,
		roughnessFactor: 1,
	};

	const map = legacyMaterial.mapDiffuse;
	if (map)
	{
		const wrap = legacyMaterial.mapDiffuseWrap || ['repeat', 'repeat'];
		const index = textureIndexFor(map, wrap);
		if (index !== null)
		{
			pbr.baseColorTexture = {index};
		}
	}

	const material = {name: legacyMaterial.DbgName || 'material', pbrMetallicRoughness: pbr, doubleSided: legacyMaterial.doubleSided === true};
	if (emissive[0] || emissive[1] || emissive[2])
	{
		material.emissiveFactor = emissive;
	}
	if (transparent)
	{
		material.alphaMode = 'BLEND';
	}
	// Recorded so the library can restore the legacy texture treatment; see
	// core/legacy_models.js and the LEGACY_TEXTURE_ENCODING note in scene.js.
	material.extras = {legacyShading: legacyMaterial.shading || 'Lambert'};
	return material;
}

function wrapMode(mode)
{
	return (mode === 'clamp' || mode === 'clampToEdge') ? GL_CLAMP_TO_EDGE : GL_REPEAT;
}

/* --------------------------------------------------------------- converter */

function convert(sourcePath)
{
	const json = JSON.parse(readFileSync(sourcePath, 'utf8'));
	const legacyMaterials = json.materials || [];
	const geometry = parseLegacyGeometry(json);

	const position = geometry.attributes.position.array;
	const normal = geometry.attributes.normal ? geometry.attributes.normal.array : null;
	const uv = geometry.attributes.uv ? geometry.attributes.uv.array : null;
	const vertexCount = position.length / 3;

	// toBufferGeometry() emits one group per run of equal materialIndex. A model
	// with a single material gets no groups at all, so synthesise the one group
	// that covers everything.
	const groups = (geometry.groups.length > 0)
		? geometry.groups
		: [{start: 0, count: vertexCount, materialIndex: 0}];

	const gltf = {
		asset: {
			version: '2.0',
			generator: 'architect3d convert-legacy-json (migration S3)',
		},
		scene: 0,
		scenes: [{nodes: [0]}],
		nodes: [{mesh: 0, name: basename(sourcePath, '.js')}],
		meshes: [{name: basename(sourcePath, '.js'), primitives: []}],
		accessors: [],
		bufferViews: [],
		materials: [],
		buffers: [],
	};
	const binary = new BinaryChunk();

	/* textures: copied to the sidecar directory byte-for-byte, referenced by URI */
	const textureCache = new Map();
	const usedTextures = new Set();
	const textureIndexFor = (fileName, wrap) =>
	{
		const key = `${fileName}|${wrap.join(',')}`;
		if (textureCache.has(key))
		{
			return textureCache.get(key);
		}

		const imagePath = join(dirname(sourcePath), fileName);
		if (!existsSync(imagePath))
		{
			// Four of these are broken in the source library and 404 in the demo
			// today; three renders them with the material's diffuse colour alone.
			// Reproduce that rather than refusing to convert the model.
			if (!missingTextures.has(fileName))
			{
				missingTextures.set(fileName, []);
			}
			missingTextures.get(fileName).push(basename(sourcePath));
			textureCache.set(key, null);
			return null;
		}
		const mimeType = MIME_TYPES[extname(fileName).toLowerCase()];
		if (!mimeType)
		{
			throw new Error(`${basename(sourcePath)} references an image type this converter does not carry: ${fileName}`);
		}

		mkdirSync(TEXTURE_DIR, {recursive: true});
		copyFileSync(imagePath, join(TEXTURE_DIR, fileName));
		usedTextures.add(fileName);

		gltf.images = gltf.images || [];
		gltf.samplers = gltf.samplers || [];
		gltf.textures = gltf.textures || [];

		gltf.images.push({uri: `textures/${fileName}`, mimeType, name: fileName});
		gltf.samplers.push({
			magFilter: GL_LINEAR,
			minFilter: GL_LINEAR_MIPMAP_LINEAR,
			wrapS: wrapMode(wrap[0]),
			wrapT: wrapMode(wrap[1]),
		});
		gltf.textures.push({sampler: gltf.samplers.length - 1, source: gltf.images.length - 1});

		const index = gltf.textures.length - 1;
		textureCache.set(key, index);
		return index;
	};

	/* materials, in their original indices so groups keep pointing at the right one */
	const materialCount = Math.max(1, legacyMaterials.length);
	for (let i = 0; i < materialCount; i++)
	{
		gltf.materials.push(buildMaterial(gltf, legacyMaterials[i] || {}, textureIndexFor));
	}

	/* one primitive per material group */
	let triangles = 0;
	let weldedVertices = 0;
	for (const group of groups)
	{
		if (group.count === 0)
		{
			continue;
		}
		const materialIndex = Math.min(group.materialIndex || 0, materialCount - 1);
		// Carried whenever the source has them, even for a material with no map
		// today: they are part of the model, and dropping them would make the
		// converted file lossy for no meaningful saving.
		const hasUv = uv !== null;
		const welded = weld(primitiveVertices({position, normal, uv}, group.start, group.count, hasUv));

		const positions = Float32Array.from(welded.position);
		const positionView = binary.addView(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength), GL_ARRAY_BUFFER);
		const attributes = {
			POSITION: accessorFor(gltf, positionView, GL_FLOAT, welded.position.length / 3, 'VEC3', boundsOf(welded.position)),
		};

		if (normal)
		{
			const normals = Float32Array.from(welded.normal);
			const normalView = binary.addView(Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength), GL_ARRAY_BUFFER);
			attributes.NORMAL = accessorFor(gltf, normalView, GL_FLOAT, welded.normal.length / 3, 'VEC3');
		}
		if (hasUv)
		{
			const uvs = Float32Array.from(welded.uv);
			const uvView = binary.addView(Buffer.from(uvs.buffer, uvs.byteOffset, uvs.byteLength), GL_ARRAY_BUFFER);
			attributes.TEXCOORD_0 = accessorFor(gltf, uvView, GL_FLOAT, welded.uv.length / 2, 'VEC2');
		}

		const wide = welded.position.length / 3 > 65535;
		const indices = wide ? Uint32Array.from(welded.index) : Uint16Array.from(welded.index);
		const indexView = binary.addView(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength), GL_ELEMENT_ARRAY_BUFFER);
		const indexAccessor = accessorFor(gltf, indexView, wide ? GL_UNSIGNED_INT : GL_UNSIGNED_SHORT, welded.index.length, 'SCALAR');

		gltf.meshes[0].primitives.push({attributes, indices: indexAccessor, material: materialIndex, mode: 4});
		triangles += welded.index.length / 3;
		weldedVertices += welded.position.length / 3;
	}

	const binaryBuffer = binary.toBuffer();
	gltf.buffers.push({byteLength: binaryBuffer.length});
	gltf.bufferViews = binary.views;

	return {
		glb: packGlb(gltf, binaryBuffer),
		stats: {
			source: basename(sourcePath),
			sourceBytes: statSync(sourcePath).size,
			materials: materialCount,
			primitives: gltf.meshes[0].primitives.length,
			triangles,
			sourceVertices: vertexCount,
			weldedVertices,
			textures: [...usedTextures].sort(),
			bounds: boundsOf(Array.from(position)),
		},
	};
}

function packGlb(gltf, binaryBuffer)
{
	const jsonText = JSON.stringify(gltf);
	const jsonChunk = Buffer.from(jsonText, 'utf8');
	const jsonPadding = (4 - (jsonChunk.length % 4)) % 4;
	const jsonPadded = Buffer.concat([jsonChunk, Buffer.alloc(jsonPadding, 0x20)]);

	const binPadding = (4 - (binaryBuffer.length % 4)) % 4;
	const binPadded = Buffer.concat([binaryBuffer, Buffer.alloc(binPadding, 0)]);

	const header = Buffer.alloc(12);
	header.writeUInt32LE(0x46546c67, 0); // 'glTF'
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);

	const jsonHeader = Buffer.alloc(8);
	jsonHeader.writeUInt32LE(jsonPadded.length, 0);
	jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

	const binHeader = Buffer.alloc(8);
	binHeader.writeUInt32LE(binPadded.length, 0);
	binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

	return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

/* -------------------------------------------------------------------- main */

function main()
{
	if (!existsSync(SOURCE_DIR))
	{
		throw new Error(`No legacy models at ${SOURCE_DIR}`);
	}
	mkdirSync(OUTPUT_DIR, {recursive: true});

	const sources = readdirSync(SOURCE_DIR).filter((name) => name.endsWith('.js')).sort();
	const report = {generator: 'tools/convert-legacy-json.mjs', models: []};
	let failures = 0;

	for (const name of sources)
	{
		const sourcePath = join(SOURCE_DIR, name);
		const outputPath = join(OUTPUT_DIR, `${basename(name, '.js')}.glb`);
		try
		{
			const {glb, stats} = convert(sourcePath);
			writeFileSync(outputPath, glb);
			stats.output = basename(outputPath);
			stats.outputBytes = glb.length;
			report.models.push(stats);
			const saved = Math.round((1 - glb.length / stats.sourceBytes) * 100);
			console.log(
				`${name.padEnd(38)} -> ${stats.output.padEnd(38)} ` +
				`${String(stats.triangles).padStart(6)} tris  ` +
				`${String(stats.primitives).padStart(2)} prim  ` +
				`${String(Math.round(glb.length / 1024)).padStart(5)} KB (${saved > 0 ? '-' : '+'}${Math.abs(saved)}%)`);
		}
		catch (error)
		{
			failures++;
			console.error(`${name.padEnd(38)} -> FAILED: ${error.message}`);
		}
	}

	report.models.sort((a, b) => a.source.localeCompare(b.source));
	report.missingTextures = [...missingTextures.entries()]
		.map(([texture, models]) => ({texture, models: models.sort()}))
		.sort((a, b) => a.texture.localeCompare(b.texture));
	writeFileSync(REPORT, `${JSON.stringify(report, null, '\t')}\n`);

	const totals = report.models.reduce((acc, m) => ({
		source: acc.source + m.sourceBytes,
		output: acc.output + m.outputBytes,
		triangles: acc.triangles + m.triangles,
	}), {source: 0, output: 0, triangles: 0});
	const textureBytes = existsSync(TEXTURE_DIR)
		? readdirSync(TEXTURE_DIR).reduce((sum, name) => sum + statSync(join(TEXTURE_DIR, name)).size, 0)
		: 0;

	console.log(`\n${report.models.length}/${sources.length} converted, ${totals.triangles} triangles total`);
	console.log(`geometry: ${Math.round(totals.source / 1024)} KB of JSON -> ${Math.round(totals.output / 1024)} KB of glb`);
	console.log(`textures: ${Math.round(textureBytes / 1024)} KB copied verbatim, shared across models`);

	if (report.missingTextures.length > 0)
	{
		console.log('\nMaps referenced by a model but absent from the source library.');
		console.log('These 404 in the legacy demo too - the models render with their');
		console.log('diffuse colour alone, before and after conversion alike:');
		for (const {texture, models} of report.missingTextures)
		{
			console.log(`  ${texture.padEnd(34)} <- ${models.join(', ')}`);
		}
	}
	if (failures > 0)
	{
		process.exitCode = 1;
	}
}

main();
