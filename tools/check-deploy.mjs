/**
 * What is about to be published resolves at the base it will be published at
 * (RM-015 M1, findings AA-1 and AA-2).
 *
 *   npm run deploy:check          against dist-demo/ as the deploy job assembles it
 *
 * ## Why this exists
 *
 * AA-1 measured that this project has never published anything: both addresses
 * the README advertised returned 404. So M1 is a first deploy, and a first
 * deploy is exactly where a base-path mistake hides - the build succeeds, every
 * gate is green, and the published page asks for `/architect3d/assets/index.js`
 * on a host that serves it at `/assets/index.js`. Nothing in this repository
 * could see that, because every other check runs before the tree is assembled
 * and none of them resolves a URL.
 *
 * This one runs last, on the assembled tree, and answers one question: **does
 * every path this build names exist in what is being uploaded?**
 *
 * ## What it checks
 *
 *  1. Every `src`/`href` the document blocks on resolves to a file that is
 *     actually in the tree. This is the base-path failure, caught.
 *  2. Nothing anywhere in the built tree still names the retired host. A stale
 *     absolute URL is how a "deployed" page quietly loads yesterday's assets.
 *  3. The service worker is at the deploy root and unhashed, because a worker's
 *     URL is its identity and its scope - a hashed one registers a new worker
 *     on every deploy while the old one keeps serving.
 *  4. The manifest's `start_url` and `scope` are relative, so an installed
 *     window opens the application rather than the domain root.
 *  5. The documentation is present and its own entry document resolves, since
 *     the shell's help menu links into it and RM-014 L2's gate explicitly could
 *     not check that half.
 *  6. The README names no address that this deploy will not serve.
 *
 * ## What it deliberately does not check
 *
 * That the deployed site answers 200. That is M-51, it needs a network and an
 * account, and no repository can assert it. This checks the half that is
 * knowable from the artifact; the other half is one HTTP request after the
 * first publish, and RM-015 says so rather than pretending otherwise.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join, dirname, posix} from 'node:path';
// `URL` explicitly: this file runs under the config's node globals, where it is
// a web global rather than an implicit one.
import {fileURLToPath, URL} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREE = join(ROOT, 'dist-demo');

/** The host RM-015 AA-1 measured returning 404. Nothing built may still name it. */
const RETIRED_HOST = 'amitukind.github.io';

/**
 * The retired host as something a browser would follow: an attribute value, a
 * CSS url(), or a markdown link target. Not a bare mention - see the note at
 * the check itself for why that distinction was earned rather than designed.
 */
const LINKS_TO_RETIRED = new RegExp(
	'(?:href|src|action)\\s*=\\s*["\'][^"\']*' + RETIRED_HOST
	+ '|url\\([^)]*' + RETIRED_HOST
	+ '|\\]\\([^)]*' + RETIRED_HOST, 'g');

/**
 * A host that would be a deployment of THIS project (RM-016 N3, M-58).
 *
 * ## The class, not the instance
 *
 * AA-1 counted nine README links to an address returning 404 and M1 removed
 * all nine - then wrote the new Cloudflare address into the same first
 * screenful, in anticipation of a deploy. AB-6 measured what that became when
 * the deploy did not happen: `curl` against `architect3d.pages.dev` exits 6,
 * *could not resolve host*, with a control request to github.com returning 200
 * from the same shell. Worse than a 404 - a 404 is a server saying no, and
 * this is a name nobody has registered.
 *
 * The retired-host rule below could not have caught it, and no rule that names
 * hostnames ever could: the next one will be plausible too. So this one is
 * about shape. A deployment address for this project is a host under a
 * project-hosting suffix, or the project's own name as a domain - and neither
 * is something this repository can prove it serves, because a repository has
 * no way to know whether a deploy has ever run.
 *
 * ## What it deliberately allows
 *
 * Every third-party link: three.js, Reka UI, Creative Commons, and the
 * repository itself on github.com. `github.com/amitukind/architect3d` contains
 * the project's name and is not a deployment of it - it is where the source
 * is, it resolves today, and it is the one absolute link a README of a public
 * repository certainly should have. Source hosting is not a deploy.
 *
 * ## And what to do instead, which the README already says
 *
 * *"a link into the repository resolves on github.com, in an editor and in a
 * clone, and it cannot be made wrong by a deploy that has not run yet."* That
 * rule was kept for the documentation links and broken for the button at the
 * top. When M-51 is met and there is an address, this constant is where the
 * exemption goes - deliberately, so that publishing an address is a commit
 * somebody makes rather than a line that drifts back in.
 */
const DEPLOYMENT_HOST = /^[a-z0-9-]+\.(?:pages\.dev|github\.io|workers\.dev|netlify\.app|vercel\.app)$|^architect3d\.[a-z.]+$/i;

/** Every absolute link a reader could follow out of a markdown file. */
const ABSOLUTE_LINK = /\]\(\s*(https?:\/\/[^)\s]+)/g;

/** Files whose text is scanned for the retired host. Binary assets are skipped. */
const TEXT = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.map', '.svg', '.txt']);

/**
 * Absolute markdown links whose host would be a deployment of this project.
 *
 * @param {string} markdown
 * @returns {Array<string>} The offending URLs, in the order they appear.
 */
export function deploymentLinksIn(markdown)
{
	const found = [];
	for (const match of String(markdown || '').matchAll(ABSOLUTE_LINK))
	{
		let host;
		// A URL the parser refuses is not a link anybody can follow, so it is not
		// this rule's business - the resolve check above is what catches those.
		try {host = new URL(match[1]).hostname;}
		catch {continue;}
		if (DEPLOYMENT_HOST.test(host)) {found.push(match[1]);}
	}
	return found;
}

function walk(dir, out = [])
{
	for (const entry of readdirSync(dir))
	{
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) { walk(full, out); }
		else { out.push(full); }
	}
	return out;
}

/**
 * Resolve a URL found in a document against the deploy root.
 *
 * Returns null for anything that is not this deploy's business: another origin,
 * a data URI, a fragment, a mailto.
 */
function resolveInTree(url, fromDir)
{
	if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(url)) { return null; }
	const clean = url.split('#')[0].split('?')[0];
	if (!clean) { return null; }
	return clean.startsWith('/')
		? join(TREE, clean.slice(1))
		: join(fromDir, clean);
}

function main()
{
	const problems = [];

	if (!existsSync(TREE))
	{
		console.error('deploy:check needs an assembled tree.\n'
			+ '  npm run build:demo && npm run docs:build && mv docs/.vitepress/dist dist-demo/docs');
		process.exit(1);
	}

	const files = walk(TREE);
	const relative = new Set(files.map((f) => f.slice(TREE.length + 1).split(posix.sep).join('/')));

	// 1. Everything the document blocks on.
	const indexPath = join(TREE, 'index.html');
	if (!existsSync(indexPath))
	{
		problems.push('there is no index.html at the deploy root');
	}
	else
	{
		const html = readFileSync(indexPath, 'utf8');
		let checked = 0;
		for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
		{
			const target = resolveInTree(match[1], TREE);
			if (!target) { continue; }
			checked += 1;
			if (!existsSync(target))
			{
				problems.push(`index.html references "${match[1]}", which is not in the tree`);
			}
		}
		if (!checked)
		{
			problems.push('index.html references nothing resolvable - the scan found no local URLs at all');
		}
	}

	// 1b. The 3D engine is not in what the document blocks on (RM-015 M3, M-54).
	//
	// The chunk half of the boundary, and the only tier that can see it. The
	// browser suite counts WebGL contexts, which catches a viewer *constructed*
	// at boot; `first-load` in the budget counts bytes, which catches the cost
	// once it has already been paid. Neither can say "the renderer is in exactly
	// one chunk and the document references none of it", because chunks exist
	// only here, in the assembled tree.
	//
	// The marker is `getShaderPrecisionFormat`, and the first version of this
	// check used `WebGLRenderer` instead and failed on its first real run.
	//
	// three 0.185 ships as two files: `three.core.js`, which is the maths and
	// the scene graph and IS first-load because the model layer is built on it,
	// and `three.module.js`, which adds the renderer. The core *mentions*
	// `WebGLRenderer` - in an `isWebGLRenderer` guard and a message - without
	// containing it, so a marker that matches a mention condemns the one chunk
	// that legitimately boots.
	//
	// `getShaderPrecisionFormat` is a WebGL API call that only the renderer's
	// capabilities probe makes. It is a property name on a GL context, so no
	// minifier renames it, and it appears in no other chunk of this build:
	// measured across all three at M3, 1 in the viewer chunk and 0 everywhere
	// else.
	const ENGINE = /getShaderPrecisionFormat/;
	const scripts = [...relative].filter((name) => name.endsWith('.js') && name.startsWith('assets/'));
	const carriers = scripts.filter((name) => ENGINE.test(readFileSync(join(TREE, name), 'utf8')));

	if (existsSync(indexPath))
	{
		const html = readFileSync(indexPath, 'utf8');
		// What the document blocks on: its own scripts and stylesheets, and the
		// chunks Vite modulepreloads beside them. Exactly the set `first-load`
		// sums, for exactly the same reason - a modulepreload is a fetch.
		const referenced = new Set();
		for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
		{
			if (/\.js$/i.test(match[1])) { referenced.add(match[1].replace(/^\.?\//, '')); }
		}
		const eager = carriers.filter((name) => referenced.has(name));
		if (eager.length)
		{
			problems.push(`index.html loads the 3D engine at boot: ${eager.join(', ')}`
				+ ' - something on the boot path imports the viewer, and the M3 split does nothing');
		}
	}

	if (!carriers.length)
	{
		// Not a pass. Either the marker stopped matching - a three upgrade, a
		// minifier that renames what it never renamed before - or the viewer
		// stopped being built at all. Both need a person, and a silent green here
		// would retire the check without anybody deciding to.
		problems.push('no chunk in the tree probes shader precision. Either three no longer'
			+ ' builds its capabilities that way, or the viewer is not being built at all;'
			+ ' check before trusting this gate again');
	}
	else if (carriers.length > 1)
	{
		problems.push(`the 3D engine is split across ${carriers.length} chunks: ${carriers.join(', ')}`
			+ ' - it should arrive as one, so switching to the 3D view is one round trip');
	}

	// 2. The retired host, as a LINK rather than as a mention.
	//
	// The first version of this forbade the string anywhere in the tree, and the
	// first real run failed on `docs/roadmap.html` - because RM-015's own AA-1
	// quotes the dead address as the thing it measured returning 404. A gate that
	// forbids naming a finding is a gate that makes the record worse. So the rule
	// is about what a browser would follow: an href, a src, a CSS url(), or a
	// markdown link target. Prose and <code> may say it as often as they like.
	for (const file of files)
	{
		const dot = file.lastIndexOf('.');
		if (dot < 0 || !TEXT.has(file.slice(dot))) { continue; }
		const text = readFileSync(file, 'utf8');
		if (!text.includes(RETIRED_HOST)) { continue; }
		const linked = [...text.matchAll(LINKS_TO_RETIRED)];
		if (linked.length)
		{
			problems.push(`${file.slice(TREE.length + 1)} links to ${RETIRED_HOST}`
				+ ` (${linked.length} time${linked.length === 1 ? '' : 's'})`);
		}
	}

	// 3. The worker, at the root and unhashed.
	if (!relative.has('sw.js'))
	{
		problems.push('sw.js is not at the deploy root - its URL is its scope, so it cannot move or be hashed');
	}

	// 4. The manifest, relative.
	const manifestPath = join(TREE, 'manifest.webmanifest');
	if (!existsSync(manifestPath))
	{
		problems.push('manifest.webmanifest is missing, so the application is not installable');
	}
	else
	{
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		for (const key of ['start_url', 'scope'])
		{
			if (typeof manifest[key] === 'string' && manifest[key].startsWith('/'))
			{
				problems.push(`manifest ${key} is "${manifest[key]}" - root-absolute, so an installed`
					+ ' window would open the domain root rather than the application');
			}
		}
		for (const icon of manifest.icons || [])
		{
			if (!existsSync(resolveInTree(icon.src, TREE) || ''))
			{
				problems.push(`manifest icon "${icon.src}" is not in the tree`);
			}
		}
	}

	// 5. The documentation, and its own entry.
	const docsIndex = join(TREE, 'docs', 'index.html');
	if (!existsSync(docsIndex))
	{
		problems.push('docs/index.html is missing - the shell\'s help menu links into it');
	}
	else
	{
		const html = readFileSync(docsIndex, 'utf8');
		for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
		{
			// Only the assets it blocks on; VitePress emits many page links that
			// are clean URLs without a file of their own.
			if (!/\.(?:js|css)$/i.test(match[1])) { continue; }
			const target = resolveInTree(match[1], join(TREE, 'docs'));
			if (target && !existsSync(target))
			{
				problems.push(`docs/index.html references "${match[1]}", which is not in the tree`);
			}
		}
	}

	// 6. The README, which is what a person reads before any of the above.
	//
	// Three claims now. That it no longer names the dead host; that every link it
	// makes into this repository resolves - which is why M1 pointed the
	// documentation links at files rather than at pages on a site, a file path
	// being the form of that link a repository can actually check; and, since
	// RM-016 N3, that it advertises no address for this project at all.
	const readme = join(ROOT, 'README.md');
	if (existsSync(readme))
	{
		const text = readFileSync(readme, 'utf8');
		if (LINKS_TO_RETIRED.test(text))
		{
			problems.push(`README.md still links to ${RETIRED_HOST}, which AA-1 measured returning 404`);
		}
		LINKS_TO_RETIRED.lastIndex = 0;
		for (const match of text.matchAll(/\]\((\.[^)\s]+)\)/g))
		{
			const target = join(ROOT, match[1].split('#')[0]);
			if (!existsSync(target))
			{
				problems.push(`README.md links to ${match[1]}, which is not in the repository`);
			}
		}
		for (const advertised of deploymentLinksIn(text))
		{
			problems.push(`README.md advertises ${advertised}, which is a deployment address for this`
				+ ' project rather than a third party. A repository cannot prove it serves one, and'
				+ ' AB-6 measured the last such link failing to resolve at all. Link the file, or'
				+ ' wait until there is a deploy - see DEPLOYMENT_HOST in this file.');
		}
	}

	if (problems.length)
	{
		console.error(`what is about to be published will not resolve:\n  ${problems.join('\n  ')}`);
		process.exit(1);
	}

	const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
	console.log(`  ✓ Deploy tree    ${files.length} files, ${(bytes / 1048576).toFixed(2)} MB`);
	console.log('    every referenced path resolves; worker at the root; manifest relative; docs present');
	console.log(`    the 3D engine is one chunk (${carriers[0]}) and the document does not load it`);
	console.log('    the README advertises no address this repository cannot prove it serves');
}

if (process.argv[1] && process.argv[1].endsWith('check-deploy.mjs'))
{
	main();
}
