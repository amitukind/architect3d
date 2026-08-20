// @ts-check
import {UP_Y, UP_Z} from '../../scripts/blueprint.js';

/**
 * What the application knows about a file somebody picked (RM-012 J3).
 *
 * Pure functions and constants, with no store and no viewer in them, because
 * every one of these is a decision worth being able to check on its own: which
 * formats are readable, how big is too big, what a stored model is called, and
 * how many centimetres a unit is.
 *
 * ## The naming convention lives here, not in the library
 *
 * `src/scripts/core/imported_model.js` deliberately has no prefix in it: the
 * library asks its byte store *"do you have this name"* and that is the whole
 * protocol. `local/<id>.<ext>` is this application's answer to what to call
 * one, and it is a path shape on purpose - it is what `model_url` records, what
 * K2's `assetsIn` collects into a bundle's closure, and what a zip shows as
 * `assets/local/<id>.glb` when somebody opens the archive in a file manager.
 */

/** Where a stored model's logical name starts. */
export const LOCAL_PREFIX = 'local/';

/**
 * The formats this build can read, by extension.
 *
 * Not a list anybody chose: `model/scene.js` constructs a `GLTFLoader` and an
 * `OBJLoader` and nothing else, so these three extensions are exactly what
 * X-7 found already had a reader in the bundle. A `.fbx` would need a loader,
 * and a loader is the thing this sprint measured itself as not needing.
 */
export const READABLE = {glb: 'gltf', gltf: 'gltf', obj: 'obj'};

/** What the file picker offers. */
export const ACCEPT = '.glb,.gltf,.obj,model/gltf-binary,model/gltf+json';

/**
 * How large an imported model may be.
 *
 * A policy and not a ceiling, in the same sense `MAX_LINK_CHARS` is one: 32 MiB
 * is far under the 3,221,225,472 bytes Chromium offered this origin in RM-013
 * Y-6, and 130 times the 257,820 of the largest model this build ships. What it
 * protects is the parse rather than the disk. `model_store.js` keeps no bytes in
 * memory, but a `GLTFLoader` given 32 MiB of compressed geometry produces a
 * great deal more than 32 MiB of typed arrays, and that peak is what a browser
 * tab actually runs out of.
 */
export const MAX_MODEL_BYTES = 32 * 1024 * 1024;

/**
 * How much of the digest becomes the id.
 *
 * 16 hex characters is 64 bits. A personal library holding a thousand models
 * has a collision probability around 3e-14, and every extra character is one
 * more byte in every design that names the model - which is the only cost a
 * document carries for this whole feature.
 */
export const ID_LENGTH = 16;

/**
 * Centimetres per authored unit, for the units a person can name.
 *
 * The same quantity as a catalog row's `unitScale`, which `tools/split-catalog.mjs`
 * resolves from the kit a row came from (RM-012 J1). A file states no unit
 * anywhere - glTF's specification says one unit is one metre and the tools
 * ignore it - so this is a question only the person who has the file can
 * answer, and the dialog's job is to make it answerable by showing what each
 * choice would make the model.
 */
export const UNITS = [
	{id: 'm', label: 'metres', cm: 100},
	{id: 'cm', label: 'centimetres', cm: 1},
	{id: 'mm', label: 'millimetres', cm: 0.1},
	{id: 'in', label: 'inches', cm: 2.54},
	{id: 'ft', label: 'feet', cm: 30.48},
];

/** What glTF says, and what the import dialog therefore offers first. */
export const DEFAULT_UNIT = 'm';

/**
 * @param {string} id
 * @returns {number} centimetres per unit, or 1 for a unit nobody knows.
 */
export function unitScaleFor(id)
{
	var found = UNITS.filter(function (unit) {return unit.id === id;})[0];
	return found ? found.cm : 1;
}

/**
 * The extension, lower case and without the dot.
 *
 * @param {string} name
 * @returns {string}
 */
export function extensionOf(name)
{
	var at = String(name || '').lastIndexOf('.');
	return at === -1 ? '' : String(name).slice(at + 1).toLowerCase();
}

/**
 * Which loader reads a file, by its name.
 *
 * By extension and not by sniffing the bytes, because the two disagree in the
 * one direction that matters: a `.gltf` and a `.glb` are the same format to
 * `GLTFLoader` and different files on disk, and an OBJ is plain text with no
 * signature to sniff.
 *
 * @param {string} name
 * @returns {?string} `gltf`, `obj`, or null.
 */
export function formatOf(name)
{
	return READABLE[extensionOf(name)] || null;
}

/**
 * The digest of some bytes, shortened to an id.
 *
 * Content-addressed, so importing the same file twice is one record and a name
 * can never come to mean different bytes. `crypto.subtle` is the whole
 * implementation and there is no fallback: a browser without it is one without
 * a secure context, which is also a browser where RM-013 K3's service worker
 * never registers, and inventing a weaker hash for that case would put two
 * different id schemes in one store.
 *
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function fingerprint(bytes)
{
	var digest = await crypto.subtle.digest('SHA-256', bytes);
	var hex = [...new Uint8Array(digest)]
		.map(function (byte) {return byte.toString(16).padStart(2, '0');})
		.join('');
	return hex.slice(0, ID_LENGTH);
}

/** Whether this browser can fingerprint at all. */
export function importsAvailable()
{
	return typeof crypto !== 'undefined' && Boolean(crypto.subtle) && typeof crypto.subtle.digest === 'function';
}

/**
 * What a stored model is called.
 *
 * @param {string} id
 * @param {string} extension Without the dot.
 * @returns {string}
 */
export function localNameFor(id, extension)
{
	return `${LOCAL_PREFIX}${id}.${extension}`;
}

/**
 * @param {?string} url
 * @returns {boolean}
 */
export function isLocalName(url)
{
	return typeof url === 'string' && url.indexOf(LOCAL_PREFIX) === 0;
}

/**
 * Every imported model a document names, deduplicated by id.
 *
 * Reads the `local` key rather than pattern-matching `model_url`, because the
 * key is the reference and the URL is a name for it - and because the key is
 * where the original filename is, which is the whole point of it travelling.
 *
 * @param {string} design A `.blueprint3d` document.
 * @returns {Array<{id: string, file: string, up: string, url: string}>}
 */
export function localRefsIn(design)
{
	/** @type {*} */
	var parsed;
	try {parsed = JSON.parse(design);}
	catch {return [];}

	/** @type {Map<string, {id: string, file: string, up: string, url: string}>} */
	var found = new Map();
	var walk = function (level)
	{
		((level && level.items) || []).forEach(function (item)
		{
			var local = item && item.local;
			if (!local || typeof local.id !== 'string' || !local.id || found.has(local.id))
			{
				return;
			}
			found.set(local.id, {
				id: local.id,
				file: (typeof local.file === 'string' && local.file) ? local.file : local.id,
				up: local.up === UP_Z ? UP_Z : UP_Y,
				url: typeof item.model_url === 'string' ? item.model_url : localNameFor(local.id, 'glb'),
			});
		});
	};

	walk(parsed);
	((parsed && parsed.levels) || []).forEach(walk);
	return [...found.values()];
}

/**
 * The model's extent after the up-axis choice, still in authored units.
 *
 * Z-up to Y-up maps `(x, y, z)` to `(x, z, -y)`, so the extent's second and
 * third components swap. Computed here rather than by measuring a rotated copy,
 * because the dialog updates on every keystroke and re-parsing a 30 MB file to
 * answer a radio button is not a reasonable thing to do.
 *
 * @param {Array<number>} size
 * @param {?string} up
 * @returns {Array<number>}
 */
export function orientedSize(size, up)
{
	var extent = size || [0, 0, 0];
	return (up === UP_Z) ? [extent[0], extent[2], extent[1]] : [extent[0], extent[1], extent[2]];
}

/**
 * The scale that makes the longest side a given number of centimetres.
 *
 * The escape hatch beside the unit list, and the one that always works: a model
 * authored in "whatever the modeller felt like" has no unit to name, and
 * everybody knows roughly how long their sofa is.
 *
 * @param {Array<number>} size In authored units, already oriented.
 * @param {number} targetCm
 * @returns {number} centimetres per unit, or 0 when there is nothing to scale.
 */
export function fitScaleFor(size, targetCm)
{
	var longest = Math.max(size[0] || 0, size[1] || 0, size[2] || 0);
	if (!(longest > 0) || !(targetCm > 0))
	{
		return 0;
	}
	return targetCm / longest;
}

/**
 * A refusal a person can act on, or null.
 *
 * @param {{name: string, size: number}} file
 * @returns {?string}
 */
export function refuseFile(file)
{
	if (!file)
	{
		return 'No file was chosen.';
	}
	if (!formatOf(file.name))
	{
		return `This build reads .glb, .gltf and .obj. "${file.name}" is none of those.`;
	}
	if (file.size > MAX_MODEL_BYTES)
	{
		return `"${file.name}" is ${Math.round(file.size / 1048576)} MB. `
			+ `The limit for an imported model is ${MAX_MODEL_BYTES / 1048576} MB.`;
	}
	if (!file.size)
	{
		return `"${file.name}" is empty.`;
	}
	return null;
}

/**
 * Files a model points at that are not inside it.
 *
 * ## Why this is worth 40 lines
 *
 * A `.glb` is usually self-contained and is not always: `ik_nordli_full.glb` in
 * this very repository names `textures/white_wood.ktx2` as an external image,
 * and it is a `.glb`. Imported from a disk there is no directory for that name
 * to be relative to, so the model loads with its geometry and without its
 * texture - and a grey sofa that nobody was warned about reads as a bug in the
 * application rather than as a property of the file.
 *
 * That is the same argument RM-013 K2 made about a bundle's carried assets:
 * *dropping them silently is the one outcome worse than not reading them*. So
 * the import step reads the file's own reference list and says what it found.
 *
 * Data URIs are not external, and neither is the binary chunk of a GLB, which
 * has no `uri` at all.
 *
 * @param {ArrayBuffer} bytes
 * @param {?string} format
 * @returns {Array<string>}
 */
export function externalRefsIn(bytes, format)
{
	if (format === 'obj')
	{
		// One directive, and it is the only external reference an OBJ can make:
		// the materials are in a `.mtl` beside it, and the images are in that.
		var text = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 65536)));
		return text.split(/\r?\n/)
			.filter(function (line) {return line.indexOf('mtllib ') === 0;})
			.map(function (line) {return line.slice(7).trim();})
			.filter(Boolean);
	}
	if (format !== 'gltf')
	{
		return [];
	}

	var json = gltfJson(bytes);
	if (!json)
	{
		return [];
	}
	/** @type {Array<string>} */
	var external = [];
	/** @type {Array<*>} */
	var named = [].concat(json.images || [], json.buffers || []);
	named.forEach(function (entry)
	{
		var uri = entry && entry.uri;
		if (typeof uri === 'string' && uri && uri.indexOf('data:') !== 0 && external.indexOf(uri) === -1)
		{
			external.push(uri);
		}
	});
	return external;
}

/**
 * The JSON of a glTF, whether it arrived as `.gltf` text or a `.glb` container.
 *
 * @param {ArrayBuffer} bytes
 * @returns {?Object}
 */
function gltfJson(bytes)
{
	try
	{
		var view = new DataView(bytes);
		if (bytes.byteLength >= 20 && view.getUint32(0, false) === 0x676c5446)
		{
			// A GLB: a 12-byte header, then length-prefixed chunks, the first of
			// which is the JSON. Read directly rather than through a loader,
			// because this runs before anything decides the file is loadable.
			return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
		}
		return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
	}
	catch
	{
		return null;
	}
}
