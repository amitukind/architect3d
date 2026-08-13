/**
 * Generates the repo-root legacy.html - the pre-S6 jQuery demo, runnable
 * against live ES-module source.
 *
 *   node tools/make-dev-index.mjs      (or: npm run legacy:index)
 *
 * Until S6 this generated index.html and was the only way to run the app. S6
 * replaced the demo with the Vue application, which owns index.html now, and
 * this moved aside to legacy.html: `npm run dev` serves both, so the two can be
 * put side by side while the Vue app is finished and S7's inspectors land. It
 * retires with build/ in S9.
 *
 * It is build/index.html with exactly two mechanical edits:
 *
 *   1. a <base href="/build/"> is injected. The Vite dev server's root is the
 *      repository root, but the demo's asset paths are relative to build/ -
 *      and not only in the markup: the library and app.js compose asset URLs
 *      as bare relative strings at RUNTIME ('rooms/textures/wallmap.png',
 *      'models/js/open_door.js'), resolved against the page URL. A <base> tag
 *      fixes markup and runtime URLs alike, in one line, leaving every path in
 *      the document byte-identical to the frozen reference.
 *
 *   2. the <script src="js/bp3djs.js"> tag - which loads the frozen, prebuilt
 *      bundle - is replaced by a module script importing src/legacy-bridge.js,
 *      so the demo runs against LIVE SOURCE with HMR. The path is root-absolute
 *      so <base> does not apply to it.
 *
 * Generated rather than hand-written so the demo markup cannot silently drift
 * away from the frozen reference. Regenerate whenever build/index.html changes
 * (it should not, until S9).
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'build', 'index.html');
const TARGET = join(ROOT, 'legacy.html');

let html = readFileSync(SOURCE, 'utf8');

// 1. Resolve every relative URL - markup and runtime-composed alike - against build/.
const HEAD = /(<head>)/i;
if (!HEAD.test(html))
{
	throw new Error('No <head> in build/index.html - update tools/make-dev-index.mjs.');
}
html = html.replace(HEAD, '$1\n<base href="/build/">');

// 2. Swap the prebuilt bundle for the live-source bridge.
const BUNDLE_TAG = /<script\s+src=["']js\/bp3djs\.js["']\s*><\/script>/;
if (!BUNDLE_TAG.test(html))
{
	throw new Error('Could not find the bp3djs.js script tag in build/index.html - '
		+ 'the demo markup changed; update tools/make-dev-index.mjs.');
}
html = html.replace(BUNDLE_TAG,
	'<script type="module" src="/src/legacy-bridge.js"></script>');

// Banner.
html = html.replace(/^<!DOCTYPE html>/i,
	'<!DOCTYPE html>\n<!--\n  GENERATED FILE - do not edit.\n'
	+ '  Source: build/index.html   Generator: tools/make-dev-index.mjs\n'
	+ '  The pre-S6 jQuery demo, with the library loaded from src/ through\n'
	+ '  src/legacy-bridge.js instead of the prebuilt bundle. The Vue app that\n'
	+ '  replaced it is at /index.html.\n-->');

writeFileSync(TARGET, html, 'utf8');
console.log('wrote legacy.html (pre-S6 demo) from build/index.html');
