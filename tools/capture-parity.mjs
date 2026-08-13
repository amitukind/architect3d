/**
 * Capture the r98 vs r185 parity grid the S5 exit gate asks for.
 *
 * S0 was meant to leave golden screenshots of the legacy demo and never did, so
 * the bump has had no pixel reference. This produces one, late but valid: the
 * `legacy-demo` tag ships a fully prebuilt `build/` - the rollup r98 bundle,
 * jQuery, every texture - so the old engine can be served as static files
 * without installing any of its packages. The new engine is the current `dist/`
 * bundle served the same way.
 *
 *     npm run parity            # capture both sides and write the report
 *     npm run parity -- --only=current
 *
 * No setup: the worktree at the frozen tag is created on demand under
 * tools/parity/, and the current bundle is built if it is missing.
 *
 * Both sides run the identical page (tools/parity-goldens.html) against the
 * identical design (tests/fixtures/rich-design.blueprint3d) at the identical
 * viewport, so the engine is the only variable. Output lands in
 * tools/parity/<engine>/<state>.png plus an index.html that pairs them up.
 *
 * Deliberately no catalog items: S3 and S4 changed how a loaded model looks, on
 * purpose and with their own reviews, and baking a known difference into the
 * reference would make it useless. What this covers is what S5's gate names -
 * the opacity fade, lightmap, shadows, sky gradient and the view presets.
 */
import {createServer} from 'node:http';
import {execFile, execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'parity');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The frozen pre-migration commit the r98 side is rendered from. */
const LEGACY_TAG = 'legacy-demo';
const VIEWPORT = {width: 1000, height: 700};

/** The states tools/parity-goldens.html knows how to set up. */
const STATES = [
	['boot', 'default camera, as the app opens'],
	['isometry', 'view preset: isometric'],
	['top', 'view preset: top'],
	['front', 'view preset: front'],
	['right', 'view preset: right'],
	['left', 'view preset: left'],
	['inside', 'camera inside the plan - near walls fade to 0.3 opacity'],
	['floors', 'straight down, close in - floor textures and tiling scale'],
	['wireframe', 'wireframe toggle'],
	['floorplan2d', 'the 2D floorplanner canvas'],
];

const ENGINES = {
	legacy: {
		label: 'three r98 (legacy-demo tag)',
		root: join(OUT, 'root-legacy'),
		port: 10011,
	},
	current: {
		label: 'three r185 (working tree)',
		root: join(OUT, 'root-current'),
		port: 10012,
	},
};

const MIME = {
	'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
	'.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
	'.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.css': 'text/css',
	'.blueprint3d': 'application/json',
};

/** A static file server rooted at one directory, with no directory escape. */
function serve(root, port)
{
	const server = createServer((request, response) =>
	{
		const path = decodeURIComponent(request.url.split('?')[0]);
		const target = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		if (!resolve(target).startsWith(resolve(root)) || !existsSync(target) || statSync(target).isDirectory())
		{
			response.writeHead(404).end('not found');
			return;
		}
		response.writeHead(200, {'Content-Type': MIME[extname(target)] || 'application/octet-stream'});
		response.end(readFileSync(target));
	});
	return new Promise((done) => {server.listen(port, () => done(server));});
}

/**
 * Assemble a servable build/ for one engine.
 *
 * The legacy side is the tag's own build directory verbatim; the current side
 * is this tree's build directory with the freshly built library dropped in
 * where the demo expects it. Both then receive the same capture page and the
 * same design, so nothing about the harness differs between them.
 */
function prepare(engine, source, bundle)
{
	rmSync(engine.root, {recursive: true, force: true});
	mkdirSync(engine.root, {recursive: true});
	linkTree(source, engine.root);

	mkdirSync(join(engine.root, 'js'), {recursive: true});
	copyFileSync(bundle, join(engine.root, 'js', 'bp3djs.js'));
	copyFileSync(join(HERE, 'parity-goldens.html'), join(engine.root, 'parity-goldens.html'));
	copyFileSync(join(ROOT, 'tests', 'fixtures', 'rich-design.blueprint3d'),
		join(engine.root, 'parity-design.blueprint3d'));
}

/** Recursive copy, skipping the heavy model libraries neither side renders. */
function linkTree(from, to)
{
	for (const entry of readdirSync(from, {withFileTypes: true}))
	{
		if (entry.name === 'models' || entry.name === 'vrtest') { continue; }
		const source = join(from, entry.name);
		const target = join(to, entry.name);
		if (entry.isDirectory())
		{
			mkdirSync(target, {recursive: true});
			linkTree(source, target);
		}
		else
		{
			copyFileSync(source, target);
		}
	}
}

/** One headless screenshot, with software WebGL so this runs without a GPU. */
async function shoot(engine, state, file)
{
	await run(CHROME, [
		'--headless=new',
		'--disable-gpu',
		'--use-gl=swiftshader',
		'--enable-unsafe-swiftshader',
		'--force-device-scale-factor=1',
		'--hide-scrollbars',
		`--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
		'--virtual-time-budget=9000',
		`--screenshot=${file}`,
		`http://localhost:${engine.port}/parity-goldens.html?state=${state}`,
	], {cwd: OUT}).catch((error) =>
	{
		// Chrome reports GL performance chatter on stderr and still succeeds.
		if (!existsSync(file)) { throw error; }
	});
}

async function capture(name, engine)
{
	const directory = join(OUT, name);
	mkdirSync(directory, {recursive: true});
	const server = await serve(engine.root, engine.port);

	try
	{
		for (const [state] of STATES)
		{
			const file = join(directory, `${state}.png`);
			await shoot(engine, state, file);
			const size = existsSync(file) ? statSync(file).size : 0;
			console.log(`  ${name.padEnd(8)} ${state.padEnd(12)} ${size ? `${(size / 1024).toFixed(0)} KB` : 'FAILED'}`);
		}
	}
	finally
	{
		server.close();
	}
}

/**
 * A checkout of the frozen tag, created on demand.
 *
 * r98 is not installable any more and does not need to be: the `legacy-demo`
 * tag carries a prebuilt `build/` - the rollup bundle, jQuery, every texture -
 * so a plain worktree is the whole setup. Doing it here rather than printing
 * instructions keeps `npm run parity` a single command, which is the difference
 * between a comparison people run and one they read about.
 *
 * It lives under tools/parity/ so it shares the gitignore with the rest of the
 * capture output and never appears in `git status`. Remove it with
 * `git worktree remove tools/parity/legacy-worktree`, or delete the directory
 * and run `git worktree prune`.
 */
function legacyWorktree()
{
	const worktree = process.env.LEGACY_WORKTREE || join(OUT, 'legacy-worktree');
	if (existsSync(join(worktree, 'build')))
	{
		return worktree;
	}

	try
	{
		execFileSync('git', ['rev-parse', '--verify', `${LEGACY_TAG}^{commit}`], {cwd: ROOT, stdio: 'pipe'});
	}
	catch
	{
		console.error(
			`This needs the "${LEGACY_TAG}" tag, which is not in this repository.\n` +
			'It marks the last commit before the migration began and is what the r98\n' +
			'side of the comparison is rendered from. Fetch it with:\n\n' +
			'    git fetch --tags\n');
		process.exit(1);
	}

	console.log(`Creating a worktree at ${LEGACY_TAG} (no npm install needed - the tag ships a built bundle)`);
	// Prune first: a directory deleted by hand leaves a stale registration
	// behind, and `worktree add` then refuses the path it is already using.
	execFileSync('git', ['worktree', 'prune'], {cwd: ROOT, stdio: 'pipe'});

	// Sparse, because the full tree is 219 MB and the capture reads two
	// directories of it. Most of the rest is generated esdoc output and the
	// model library, neither of which appears in any of these ten states.
	execFileSync('git', ['worktree', 'add', '--no-checkout', '--detach', worktree, LEGACY_TAG],
		{cwd: ROOT, stdio: 'inherit'});
	execFileSync('git', ['sparse-checkout', 'set', '--cone', 'build/js', 'build/rooms'],
		{cwd: worktree, stdio: 'pipe'});
	execFileSync('git', ['checkout'], {cwd: worktree, stdio: 'pipe'});
	return worktree;
}

/* ------------------------------------------------------------------ run -- */

const only = process.argv.find((argument) => argument.startsWith('--only='));
const wanted = only ? only.slice('--only='.length).split(',') : ['legacy', 'current'];

mkdirSync(OUT, {recursive: true});

if (wanted.includes('legacy'))
{
	const build = join(legacyWorktree(), 'build');
	prepare(ENGINES.legacy, build, join(build, 'js', 'bp3djs.js'));
	await capture('legacy', ENGINES.legacy);
}

if (wanted.includes('current'))
{
	const bundle = join(ROOT, 'dist', 'bp3djs.js');
	if (!existsSync(bundle))
	{
		console.error(`No ${bundle} yet - building it.`);
		execFileSync('npm', ['run', 'build'], {cwd: ROOT, stdio: 'inherit'});
	}
	prepare(ENGINES.current, join(ROOT, 'build'), bundle);
	await capture('current', ENGINES.current);
}

writeReport();
console.log('\nGrid written to tools/parity/index.html');

/** A side-by-side page, so the pairs are reviewed rather than hunted for. */
function writeReport()
{
	const rows = STATES.map(([state, description]) =>
	{
		const pane = (engine) => existsSync(join(OUT, engine, `${state}.png`))
			? `<img src="${engine}/${state}.png" alt="${engine} ${state}">`
			: '<div class="missing">not captured</div>';
		return `<section>
	<h2>${state}<span>${description}</span></h2>
	<div class="pair">
		<figure><figcaption>three r98 &mdash; legacy-demo</figcaption>${pane('legacy')}</figure>
		<figure><figcaption>three r185 &mdash; working tree</figcaption>${pane('current')}</figure>
	</div>
</section>`;
	}).join('\n');

	writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>architect3d - r98 vs r185 parity grid</title>
<style>
:root{color-scheme:light dark;--ink:#16181d;--paper:#f7f7f9;--panel:#fff;--line:#d6d8de;--muted:#5f6470}
@media(prefers-color-scheme:dark){:root{--ink:#e8e9ec;--paper:#101216;--panel:#191c22;--line:#333844;--muted:#9aa0ac}}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--paper)}
h1{font-size:19px;margin:0 0 6px}
p{color:var(--muted);max-width:76ch;margin:0 0 8px}
section{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:12px;margin-top:14px}
h2{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;margin:0 0 10px}
h2 span{font-weight:400;color:var(--muted);margin-left:10px;font-family:inherit}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
figure{margin:0}
figcaption{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
img{width:100%;display:block;border-radius:5px;border:1px solid var(--line)}
.missing{aspect-ratio:${VIEWPORT.width}/${VIEWPORT.height};display:grid;place-items:center;color:var(--muted);border:1px dashed var(--line);border-radius:5px}
</style></head><body>
<h1>three r98 vs r185 &mdash; rendering parity</h1>
<p>The reference S0 was meant to capture and did not. Left is the frozen
<code>legacy-demo</code> tag served from its own prebuilt bundle; right is the
working tree. Same page, same design, same ${VIEWPORT.width}&times;${VIEWPORT.height} viewport, software
WebGL on both sides &mdash; the engine is the only variable.</p>
<p>No catalog items appear: S3 and S4 changed how a loaded model looks
deliberately and reviewed those changes separately, so including one would bake
a known difference into the reference. These are the states the S5 exit gate
names &mdash; the opacity fade, the lightmap, shadows, the sky gradient and the
view presets.</p>
${rows}
</body></html>
`);
}
