/**
 * Size budgets for the built output (RM-002 P1, tier 1).
 *
 *   node tools/check-budget.mjs            check, exit 1 on a breach
 *   node tools/check-budget.mjs --update   re-record the measurements
 *
 * ## Why
 *
 * The demo bundle reached 1.1 MB (305 KB gzipped) as a single chunk, and the
 * deployed tree reached 21 MB, without anybody deciding either number. Neither
 * is catastrophic and neither was noticed, which is the problem a budget fixes:
 * it does not make the bundle smaller, it makes growth a decision somebody has
 * to make on purpose.
 *
 * ## What is measured, and why gzip
 *
 * Gzip, not raw, for anything served as text - it is what the browser actually
 * downloads, and it is the number that moves when a dependency is added rather
 * than when a comment is written. Raw bytes for the asset trees, where the
 * content is already-compressed images and models and gzip would tell you
 * nothing.
 *
 * JS and CSS are summed across every file in the assets directory rather than
 * matched by name. Two reasons: the filenames are content-hashed, so there is
 * no stable name to match; and code splitting (RM-002 P6) will turn one chunk
 * into several, which must not read as a saving.
 *
 * ## The limits
 *
 * Committed in tools/budget.json beside the measurement they were derived
 * from, so a reviewer can see both the ceiling and the headroom. They are
 * deliberately not "measured + 5%" computed at runtime - a limit that moves
 * with the thing it limits is not a limit. Raising one is a commit, with a
 * reason, which is exactly the conversation the budget exists to force.
 */
import {gzipSync} from 'node:zlib';
import {readFileSync, writeFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {join, extname, dirname, sep, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BUDGET_FILE = 'tools/budget.json';
const update = process.argv.includes('--update');

/** Total bytes of every file under a directory, recursively. */
function treeBytes(dir)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const entry of readdirSync(dir, {withFileTypes: true}))
	{
		const path = join(dir, entry.name);
		total += entry.isDirectory() ? treeBytes(path) : statSync(path).size;
	}
	return total;
}

/** Gzipped bytes of every file in a directory with one of the given extensions. */
function gzipBytes(dir, extensions)
{
	if (!existsSync(dir))
	{
		return null;
	}
	let total = 0;
	for (const name of readdirSync(dir))
	{
		if (extensions.includes(extname(name)))
		{
			total += gzipSync(readFileSync(join(dir, name)), {level: 9}).length;
		}
	}
	return total;
}

function gzipFile(path)
{
	return existsSync(path) ? gzipSync(readFileSync(path), {level: 9}).length : null;
}

/**
 * The biggest single file under a directory, and which one it is.
 *
 * A tree total does not catch this. `public/` was 15.7 MB against a 16.5 MB
 * ceiling - comfortably inside it - while 3.4 MB of that was one PNG of a
 * garden, 22% of everything served, in a lossless container for a photograph.
 * Nothing was over budget; the budget was measuring the wrong thing.
 *
 * A per-file ceiling is the shape of limit that catches "somebody dropped in an
 * unoptimised asset", which is how these trees actually grow. The tree total
 * still matters for the other failure mode - a hundred small files nobody
 * noticed.
 */
function largestFile(dir, exclude = [])
{
	if (!existsSync(dir))
	{
		return null;
	}
	const skipped = exclude.map((path) => path.split('/').join(sep));
	let worst = {bytes: 0, note: '(empty)'};
	const visit = (path) =>
	{
		for (const entry of readdirSync(path, {withFileTypes: true}))
		{
			const child = join(path, entry.name);
			if (entry.isDirectory())
			{
				if (!skipped.some((one) => child === one || child.startsWith(one + sep))) { visit(child); }
				continue;
			}
			const bytes = statSync(child).size;
			if (bytes > worst.bytes)
			{
				worst = {bytes, note: child};
			}
		}
	};
	visit(dir);
	return worst;
}

/**
 * Every measurement, in the order they are reported.
 *
 * `needs` names the build that produces the input, so a missing directory
 * reports "run npm run build:demo" rather than a bare failure. A measurement
 * whose input is absent is skipped, not failed: `npm run budget` is useful
 * after one build without demanding all of them.
 */
/**
 * The JSON chunk of a binary glTF, or null.
 *
 * Same reader as `tests/asset-integrity.test.js` and
 * `asset-pipeline/compress-textures.mjs`. A .glb is a 12-byte header followed
 * by length-prefixed chunks; the first is always JSON.
 */
function glbJson(path)
{
	const buffer = readFileSync(path);
	if (buffer.length < 12 || buffer.readUInt32LE(0) !== 0x46546c67)
	{
		return null;
	}
	let offset = 12;
	while (offset + 8 <= buffer.length)
	{
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		if (type === 0x4e4f534a)
		{
			try {return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8'));}
			catch {return null;}
		}
		offset += 8 + length;
	}
	return null;
}

/**
 * What placing one catalog item costs to download, worst case (RM-003 A5).
 *
 * ## Why this is a different question from the two ceilings beside it
 *
 * `public-total` asks what the deployment weighs and `public-largest` asks
 * whether one file has got out of hand. Neither can answer **"what happens when
 * somebody clicks a chair"** - and that is the number a user experiences. A
 * model is not one file: it is a .glb plus every image the .glb references,
 * plus the thumbnail the palette already showed. P6 found a 3.4 MB photograph
 * hiding inside a 15 MB tree that was comfortably inside its ceiling; this is
 * the same shape of blind spot one level down.
 *
 * External images are counted once each even when several models share one -
 * because a second model that shares them is cheap, and charging it the full
 * cost would report a number no user ever pays.
 */
function largestCatalogItem()
{
	const catalogPath = 'src/catalog/catalog.json';
	if (!existsSync(catalogPath) || !existsSync('public'))
	{
		return null;
	}

	const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
	const items = catalog.items || [];
	const sizeOf = (relative) =>
	{
		const path = join('public', relative);
		return existsSync(path) ? statSync(path).size : 0;
	};

	let worst = 0;
	let name = null;

	for (const item of items)
	{
		if (!item.model)
		{
			continue;
		}
		let total = sizeOf(item.model) + (item.image ? sizeOf(item.image) : 0);

		const modelPath = join('public', item.model);
		if (existsSync(modelPath) && modelPath.endsWith('.glb'))
		{
			const json = glbJson(modelPath);
			const seen = new Set();
			for (const image of (json && json.images) || [])
			{
				if (!image.uri || seen.has(image.uri))
				{
					continue;
				}
				seen.add(image.uri);
				const beside = join(dirname(modelPath), image.uri);
				total += existsSync(beside) ? statSync(beside).size : 0;
			}
		}

		if (total > worst)
		{
			worst = total;
			name = item.name;
		}
	}

	return worst ? {bytes: worst, note: name} : null;
}


/**
 * What the texture set costs on the GPU, rather than on the wire (RM-004 B1).
 *
 * The third kind of blind spot this file has now found, and the same shape as
 * the other two: a per-file ceiling could not see that 3.4 MB of a 15 MB tree
 * was one photograph (P6), a per-tree ceiling could not see what placing one
 * chair costs (A5), and neither of them can see this. An uploaded texture is
 * four bytes per texel no matter how well the file compressed, so the disk
 * figure and the memory figure are not related:
 *
 *     rooms/textures/Ground_4K.jpg     73.2 KB on disk     16.88 MB in VRAM
 *     rooms/textures/envs/Garden.jpg  843.8 KB on disk     10.67 MB in VRAM
 *
 * The first is 230x its file size and is invisible to every other measurement
 * here. That is the number a phone runs out of, not the download.
 *
 * B1 stated it as 164 MB over 202 images and that was wrong twice over: 174 of
 * those images are DOM thumbnails the GPU never sees, and the manifest's `kind`
 * was itself mislabelling 148 of them. Corrected, it is **28 textures holding
 * 104.67 MB** - which is a smaller number and a much better one, because it is
 * about things that actually get uploaded. Five of the 28 are 80 MB of it.
 *
 * Dimensions come from the PNG and JPEG headers directly; Node decodes neither
 * and does not need to. A file whose header does not parse is skipped rather
 * than guessed at, so this can only ever under-report - it is a floor on the
 * real cost, which is the safe direction for a ceiling to be built on.
 *
 * The 4/3 factor is a full mip chain: 1 + 1/4 + 1/16 + ... converges to 4/3.
 *
 * ## What B5 converted, this stopped counting (RM-005 C1)
 *
 * B5 turned 18 of these textures into `.ktx2` and the extension list below did
 * not change with them, so all 18 dropped out of the sum. The line went from
 * 43.00 MB to 12.54 MB and read as a win; roughly a quarter of that fall was
 * the measurement letting go. Demonstrated rather than reasoned: copying an
 * existing 669x1024 `.ktx2` into `public/rooms/textures/` and re-running this
 * file moves the number by **0.00 MB**. A budget that cannot see the format it
 * exists to encourage is not guarding anything.
 *
 * A compressed texture is counted at one byte per texel. That is the model
 * `tools/encode-textures.mjs` already uses to report its own savings, and
 * keeping the two identical is what lets this line and
 * `asset-pipeline/texture-transcode.json` be read against each other. It is a
 * model and not an observation: the real cost is 0.5 bytes per texel where
 * Basis transcodes to BC1 or ETC1 and 1 where it reaches BC7 or ETC2, so this
 * over-reports on most hardware - the opposite direction from the PNG and JPEG
 * path above, and the safe direction for both.
 *
 * On a device with no compressed format at all, Basis falls back to RGBA8 and
 * every one of these costs the full four bytes again. That fallback is what
 * the limit's headroom is for, which is why the headroom does not tighten when
 * this number falls.
 */
export function textureVram(root = 'public')
{
	const PIXEL = new Set(['.png', '.jpg', '.jpeg']);
	let texels = 0;
	let compressedTexels = 0;

	const visit = (dir) =>
	{
		if (!existsSync(dir)) { return; }
		for (const entry of readdirSync(dir, {withFileTypes: true}))
		{
			const path = join(dir, entry.name);
			// Thumbnails are `<img :src>` in the catalog drawer and the texture
			// picker. The browser decodes them, lazily and only the visible ones,
			// and they never become a WebGL texture - so counting them here was
			// measuring 59.74 MB of GPU memory that no GPU is asked for. B1 got
			// this wrong because the manifest's own `kind` was wrong about 148
			// files; both are fixed, and this is the half that changes the number.
			if (/(^|\/)thumbnails(_new)?$/.test(path)) { continue; }
			if (entry.isDirectory()) { visit(path); continue; }
			const ext = extname(entry.name).toLowerCase();
			if (!PIXEL.has(ext) && ext !== '.ktx2') { continue; }
			const bytes = readFileSync(path);
			if (ext === '.ktx2')
			{
				const compressed = ktx2Size(bytes);
				if (compressed) { compressedTexels += compressed.w * compressed.h; }
				continue;
			}
			const size = pngSize(bytes) || jpegSize(bytes);
			if (size) { texels += size.w * size.h; }
		}
	};
	visit(root);

	return Math.round((texels * 4 + compressedTexels) * 4 / 3);
}

/* -------------------------------------------------------------------------
 * What one scene asks for (RM-011 W-5)
 * ------------------------------------------------------------------------- */

/**
 * The texels one image file costs, split by how it is stored.
 *
 * `textureVram` above did this inline over a whole tree. H1 needs it per file,
 * because the question changed from "what does the tree contain" to "what does
 * a scene upload", and a scene names files rather than directories.
 *
 * @param {string} relative A path under public/.
 * @returns {{texels: number, compressed: number}} zero for anything unreadable.
 */
function texelsOf(relative)
{
	const path = join('public', relative);
	if (!existsSync(path)) { return {texels: 0, compressed: 0}; }
	const ext = extname(path).toLowerCase();
	if (!['.png', '.jpg', '.jpeg', '.ktx2'].includes(ext)) { return {texels: 0, compressed: 0}; }
	const bytes = readFileSync(path);
	if (ext === '.ktx2')
	{
		const size = ktx2Size(bytes);
		return {texels: 0, compressed: size ? size.w * size.h : 0};
	}
	const size = pngSize(bytes) || jpegSize(bytes);
	return {texels: size ? size.w * size.h : 0, compressed: 0};
}

/** The same model `textureVram` uses: four bytes a texel, one for a transcode, 4/3 for mips. */
const vramOf = (texels, compressed) => Math.round((texels * 4 + compressed) * 4 / 3);

/**
 * Two textures every viewer uploads, whatever the design says.
 *
 * `three/skybox.js` GROUND_URL and `three/edge.js` LIGHT_MAP_URL. The
 * environment map beside them is not here on purpose: `Skybox.useEnvironment`
 * is false and nothing in the application turns it on, so a scene does not pay
 * for `envs/Garden.jpg` and this number should not say it does.
 */
const SCENE_FIXED = ['rooms/textures/Ground_4K.ktx2', 'rooms/textures/walllightmap.png'];

/** Both catalogs offer the same shape, which is what lets one loop read both. */
function surfaceEntries(file, group)
{
	if (!existsSync(file)) { return []; }
	const catalog = JSON.parse(readFileSync(file, 'utf8'));
	return catalog[group] || [];
}

/** The costliest thing the picker can put on one surface, maps included. */
function worstSurface(group)
{
	const entries = [
		...surfaceEntries('src/catalog/textures.json', group),
		...surfaceEntries('src/catalog/materials.json', group),
	];
	let worst = {texels: 0, compressed: 0, name: null};
	for (const entry of entries)
	{
		let texels = 0;
		let compressed = 0;
		for (const url of [entry.url, entry.normalMap, entry.roughnessMap])
		{
			if (!url) { continue; }
			const cost = texelsOf(url);
			texels += cost.texels;
			compressed += cost.compressed;
		}
		if (vramOf(texels, compressed) > vramOf(worst.texels, worst.compressed))
		{
			worst = {texels, compressed, name: entry.name};
		}
	}
	return worst;
}

/**
 * How many items the most furnished design this repository ships places.
 *
 * Read rather than chosen, so the worst case tracks the evidence: if a fixture
 * grows to forty items, the ceiling this feeds should notice.
 */
function busiestDesign()
{
	let worst = 0;
	for (const dir of ['tests/fixtures'])
	{
		if (!existsSync(dir)) { continue; }
		for (const name of readdirSync(dir))
		{
			if (!name.endsWith('.blueprint3d')) { continue; }
			try
			{
				const design = JSON.parse(readFileSync(join(dir, name), 'utf8'));
				const levels = (design.levels || []).reduce((sum, level) => sum + ((level.items || []).length), 0);
				worst = Math.max(worst, (design.items || []).length + levels);
			}
			catch { /* a fixture that will not parse is asset-integrity's problem, not this line's */ }
		}
	}
	return worst;
}

/**
 * What a GPU is actually asked for, rather than what the tree contains (W-5).
 *
 * ## Why this replaced a tree walk
 *
 * `textureVram` above sums every image in `public/`, which was the right
 * instrument while the tree was 28 textures and a scene used most of them. It
 * stopped being one. RM-011 W-5 measured what a scene really holds:
 *
 *     three-storey house, 3 storeys and 6 items      7 textures
 *     furnished 20-item design                      15 textures
 *     the tree                                     202 images
 *
 * So the line was reporting a number no GPU is ever asked for, and it was about
 * to refuse H1's material library over it - 90 images the tree holds and a scene
 * uploads at most four of. A budget that blocks a feature for a cost nobody pays
 * is not protecting anything.
 *
 * ## The three terms, and why each one is a thing that exists
 *
 * Every part of this is something a user can actually produce, which is the
 * difference between a worst case and a hypothetical:
 *
 *   fixed      the skybox ground and the wall lightmap, uploaded by every
 *              viewer on every boot.
 *   surfaces   the costliest wall material and the costliest floor material the
 *              pickers offer, maps included. A room has walls and a floor, and
 *              choosing both is two clicks.
 *   furniture  the distinct textures of the costliest N catalog items, where N
 *              is the item count of the most furnished design in the repository.
 *              Shared images are counted once, because a GPU uploads them once.
 *
 * It is a model and not an observation, so `tests/browser/gpu-memory.test.js`
 * checks it against `renderer.info.memory.textures` on a real scene in a real
 * browser - the model has to be an upper bound on what the renderer reports, or
 * the model is wrong. That cross-check is the reason this can stay a tier-1 gate
 * instead of moving to the browser tier entirely.
 */
export function sceneVram()
{
	if (!existsSync('public')) { return null; }

	let texels = 0;
	let compressed = 0;
	for (const name of SCENE_FIXED)
	{
		const cost = texelsOf(name);
		texels += cost.texels;
		compressed += cost.compressed;
	}

	for (const group of ['wall', 'floor'])
	{
		const worst = worstSurface(group);
		texels += worst.texels;
		compressed += worst.compressed;
	}

	// Furniture. An item's images are its .glb's external URIs; nothing in this
	// catalog embeds one, which is why there is no BIN chunk to walk here.
	const catalogPath = 'src/catalog/catalog.json';
	if (existsSync(catalogPath))
	{
		const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
		const priced = [];
		for (const item of catalog.items || [])
		{
			if (!item.model || !item.model.endsWith('.glb')) { continue; }
			const modelPath = join('public', item.model);
			if (!existsSync(modelPath)) { continue; }
			const json = glbJson(modelPath);
			const images = new Set();
			for (const image of (json && json.images) || [])
			{
				if (image.uri) { images.add(join(dirname(item.model), image.uri).split(sep).join('/')); }
			}
			if (!images.size) { continue; }
			let cost = 0;
			for (const image of images) { const t = texelsOf(image); cost += vramOf(t.texels, t.compressed); }
			priced.push({images, cost});
		}
		priced.sort((a, b) => b.cost - a.cost);

		const distinct = new Set();
		for (const item of priced.slice(0, busiestDesign())) { for (const image of item.images) { distinct.add(image); } }
		for (const image of distinct)
		{
			const cost = texelsOf(image);
			texels += cost.texels;
			compressed += cost.compressed;
		}
	}

	return vramOf(texels, compressed);
}

/** The twelve bytes every KTX2 container opens with. */
const KTX2_MAGIC = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Level-0 dimensions from a KTX2 header.
 *
 * Hand-rolled beside `pngSize` and `jpegSize` rather than imported, even
 * though `tools/encode-textures.mjs` exports these same three lines as
 * `ktx2Dimensions`. That module pulls `ktx2-encoder`, `jpeg-js` and `pngjs`;
 * this one is a tier-1 gate that runs on every build, and making it depend on
 * the Basis encoder to read twelve bytes of magic is the wrong trade. The
 * layout is fixed by the container specification and cannot drift:
 * identifier, `vkFormat`, `typeSize`, then `pixelWidth` at byte 20 and
 * `pixelHeight` at byte 24, all little-endian.
 *
 * @param {Buffer} b
 */
function ktx2Size(b)
{
	if (b.length < 32 || !b.subarray(0, 12).equals(KTX2_MAGIC)) { return null; }
	return {w: b.readUInt32LE(20), h: b.readUInt32LE(24)};
}

/** @param {Buffer} b */
function pngSize(b)
{
	if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) { return null; }
	return {w: b.readUInt32BE(16), h: b.readUInt32BE(20)};
}

/** @param {Buffer} b */
function jpegSize(b)
{
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) { return null; }
	let i = 2;
	while (i + 9 < b.length)
	{
		if (b[i] !== 0xff) { i++; continue; }
		const marker = b[i + 1];
		// SOF0..SOF15, excluding the four that are not frame headers.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
		{
			return {h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7)};
		}
		i += 2 + b.readUInt16BE(i + 2);
	}
	return null;
}

/* -------------------------------------------------------------------------
 * What a person waits for (RM-011 W-7, M-43)
 * ------------------------------------------------------------------------- */

/**
 * Everything a browser fetches before the first wall is drawn.
 *
 * ## Why this is not covered by the four lines above it
 *
 * `demo-js-gzip` and `demo-css-gzip` measure the bundle, `demo-total` measures
 * the deployment, and none of the three is the number a person experiences. A
 * boot is the document, the scripts and stylesheets it references, **and
 * `asset-manifest.json`**, which `useAssets` fetches before the viewer can
 * resolve a single texture. That last one belongs to no other line here and is
 * the one that grows when the asset tree does - which is exactly the coupling
 * M-43 exists to watch, because H1 added ninety files to that tree.
 *
 * RM-007 asked for a first-load budget before there was a number to put in it.
 * RM-011 W-7 measured one: **407,324 bytes gzipped**, of which 380,846 is the
 * application and 18,038 the manifest.
 *
 * ## Read from the document rather than from a list
 *
 * The scripts and stylesheets are the ones `index.html` actually references, not
 * every file in `assets/`. Today those are the same set; they stop being the same
 * set the moment anything is code-split, and a budget that kept summing the
 * directory would then charge a boot for chunks it never fetches - which is the
 * shape of mistake `texture-vram` spent three sprints making.
 *
 * ## What it deliberately does not count
 *
 * Anything fetched *after* the first paint: the Basis transcoder, the skybox
 * ground, a texture somebody picks. W-7 measured 595,263 bytes of that, 98 % of
 * it a transcoder for one 10 KB image, and it is a real cost - but it is a cost
 * of *using* the application rather than of opening it, and a single number that
 * mixed the two could fall while the wait got worse.
 */
function firstLoadPayload()
{
	const root = 'dist-demo';
	const document = join(root, 'index.html');
	if (!existsSync(document)) { return null; }

	const html = readFileSync(document, 'utf8');
	const referenced = new Set();
	for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
	{
		const url = match[1];
		if (!/\.(js|css)$/i.test(url)) { continue; }
		// Same-origin, relative to the document. An absolute URL is somebody
		// else's server and not part of what this build ships.
		if (/^[a-z]+:|^\/\//i.test(url)) { continue; }
		referenced.add(url.replace(/^\.?\//, ''));
	}

	let total = gzipFile(document);
	for (const name of [...referenced].sort())
	{
		total += gzipFile(join(root, name)) || 0;
	}
	// The one fetch that is not in the document. `useAssets.MANIFEST_URL`.
	total += gzipFile(join(root, 'asset-manifest.json')) || 0;
	return total;
}

const MEASUREMENTS = [
	{key: 'demo-js-gzip', label: 'Demo JS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.js'])},
	{key: 'demo-css-gzip', label: 'Demo CSS (gzip)', needs: 'build:demo',
		measure: () => gzipBytes('dist-demo/assets', ['.css'])},
	{key: 'demo-total', label: 'Deployed tree', needs: 'build:demo',
		measure: () => treeBytes('dist-demo')},
	{key: 'lib-iife-gzip', label: 'Library IIFE (gzip)', needs: 'build',
		measure: () => gzipFile('dist/bp3djs.js')},
	// The one budget here that guards a property rather than a size. The ESM
	// entry excludes three and bezier-js because they are peerDependencies; if
	// that externals config is ever lost, this jumps from ~81 KB to ~423 KB and
	// the build fails rather than quietly shipping a second copy of three to
	// every consumer.
	{key: 'lib-esm-gzip', label: 'Library ESM (gzip)', needs: 'build',
		measure: () => gzipFile('dist/architect3d.js')},
	{key: 'public-total', label: 'Runtime assets', needs: null,
		measure: () => treeBytes('public')},
	// Content only. B5 vendored a 515 KB Basis transcoder, which is four times
	// the largest texture in the tree and would own this line forever - while
	// saying nothing about the thing the line exists to catch. `public-largest`
	// was added in P6 because a 3.4 MB photograph was hiding inside a tree that
	// was comfortably under its total; a WebAssembly binary that changes only
	// when three is upgraded is not that, and `decoder-total` is the line that
	// does watch it. Draco's 250 KB never tripped this only because it happened
	// to be smaller than a JPEG.
	{key: 'public-largest', label: 'Largest single asset', needs: null,
		measure: () => largestFile('public', ['public/draco', 'public/basis'])},
	// The per-asset ceiling A5 added beside the per-file and per-tree ones. See
	// largestCatalogItem for why "what does placing this chair cost" is a
	// question neither of the others can answer.
	{key: 'catalog-item-largest', label: 'Costliest catalog item', needs: null,
		measure: () => largestCatalogItem()},
	// The decoder RM-004 B1 added, given a line of its own rather than left to
	// disappear into public-total. It is machinery, not content: it does not
	// grow when somebody adds a chair, it changes only when three is upgraded,
	// and it is the one file in the tree whose cost is charged to a session that
	// opens any compressed model at all. A number that moves for exactly one
	// reason belongs on its own line.
	// Both codecs' machinery on one line. It moves when three is upgraded and at
	// no other time, which is what makes a single number useful here: a refresh
	// that copied the wrong directory - three ships a 719 KB pure-JS Draco
	// decoder beside the WASM one - shows up immediately.
	{key: 'decoder-total', label: 'Codec machinery', needs: null,
		measure: () => treeBytes('public/draco') + treeBytes('public/basis')},
	// Re-pointed by RM-011 H1 from the tree to a scene - see sceneVram for the
	// measurement W-5 made and why a tree walk stopped being the right question.
	{key: 'texture-vram', label: 'Scene texture VRAM', needs: null,
		measure: () => sceneVram()},
	// The eleventh line, added by RM-011 H1 (M-43). Every other entry here asks
	// what something weighs; this one asks what a person waits for.
	{key: 'first-load', label: 'First load (gzip)', needs: 'build:demo',
		measure: () => firstLoadPayload()},
];

function human(bytes)
{
	if (bytes >= 1048576)
	{
		return (bytes / 1048576).toFixed(2) + ' MB';
	}
	return (bytes / 1024).toFixed(1) + ' KB';
}

/**
 * The driver, behind an entry guard (RM-005 C1).
 *
 * Everything below used to run at module scope, which meant importing this
 * file to reuse one measurement ran the whole gate and could call
 * process.exit. B4 learned the same lesson the expensive way in
 * tools/resize-textures.mjs, where a scratchpad import ran main() and
 * silently resized the catalog; the guard there is the one copied here.
 */
function main()
{
	const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
	const rows = [];
	let failures = 0;
	let skipped = 0;

	for (const item of MEASUREMENTS)
	{
		// A measurement may return a bare byte count, or {bytes, note} when naming
		// what it measured is what makes the failure actionable.
		const raw = item.measure();
		const measured = (raw && typeof raw === 'object') ? raw.bytes : raw;
		const note = (raw && typeof raw === 'object') ? raw.note : null;
		const entry = budget.budgets[item.key];

		if (!entry)
		{
			console.error(`No budget recorded for "${item.key}". Add it to ${BUDGET_FILE}.`);
			failures++;
			continue;
		}

		if (measured === null)
		{
			rows.push({label: item.label, status: 'skip', detail: `no output — run \`npm run ${item.needs}\``});
			skipped++;
			continue;
		}

		if (update)
		{
			entry.measured = measured;
		}

		const over = measured > entry.limit;
		const headroom = ((entry.limit - measured) / entry.limit) * 100;
		rows.push({
			label: item.label,
			status: over ? 'OVER' : 'ok',
			detail: `${human(measured).padStart(9)}  /  ${human(entry.limit).padStart(9)} limit` +
				(over
					? `  — over by ${human(measured - entry.limit)}`
					: `  (${headroom.toFixed(1)}% headroom)`) +
				(note ? `  ${note}` : ''),
		});
		if (over)
		{
			failures++;
		}
	}

	const width = Math.max(...rows.map((row) => row.label.length));
	console.log('');
	for (const row of rows)
	{
		const mark = row.status === 'OVER' ? '✗' : (row.status === 'skip' ? '–' : '✓');
		console.log(`  ${mark} ${row.label.padEnd(width)}   ${row.detail}`);
	}
	console.log('');

	if (update)
	{
		// Tabs, which is what the committed file uses and what everything else in
		// this repository does. Two spaces here made every `budget:update` a
		// 600-line reformat of a file whose whole value is that a reviewer can
		// see which number moved (found by RM-011 H1, adding the eleventh line).
		writeFileSync(BUDGET_FILE, JSON.stringify(budget, null, '\t') + '\n');
		console.log(`Recorded current measurements in ${BUDGET_FILE}.`);
		console.log('Limits were NOT changed — edit them by hand, with a reason in the commit message.');
		process.exit(0);
	}

	if (skipped)
	{
		console.log(`${skipped} measurement(s) skipped: their build output is not present.`);
	}

	if (failures)
	{
		console.error(`Size budget exceeded by ${failures} measurement(s).`);
		console.error('Either make it smaller, or raise the limit in tools/budget.json deliberately.');
		process.exit(1);
	}

	console.log('Within budget.');

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
