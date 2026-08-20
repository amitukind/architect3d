/**
 * Rasterise the application's mark (RM-013 K3).
 *
 *   npm run icons              re-render and rewrite
 *   npm run icons -- --check   re-render and compare, touch nothing
 *
 * ## Why a tool and not two committed PNGs
 *
 * The same reason `render-thumbnails.mjs` exists: a committed binary is a thing
 * nobody can review and nobody can regenerate. The source is
 * `public/icons/architect3d.svg` - the accent square and lucide's ruler, the
 * two elements the top bar has carried since S7 - and these are its output at
 * the two sizes an install prompt requires.
 *
 * ## Why these sizes, and why one of them is maskable
 *
 * A browser will not offer to install a page without an icon of at least 144 px;
 * 192 and 512 are what every platform's guidance names, and shipping both means
 * neither is upscaled. The 512 is declared `maskable` in the manifest, which is
 * a promise about the artwork rather than about the file: the platform may crop
 * it to a circle, a squircle or a rounded square, so the glyph sits inside the
 * middle 80 % and the corners carry nothing but ground. The SVG is drawn that
 * way; this only resizes it.
 *
 * ## Rendered in the browser that will display it
 *
 * Through the same headless chromium the thumbnails use, because an SVG is a
 * document and the honest rasteriser for one is a browser. No new dependency,
 * and the alternative - hand-writing a PNG encoder around a path rasteriser -
 * would be inventing a renderer to avoid using one.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'icons');
const SOURCE = join(DIR, 'architect3d.svg');

/** The sizes, and what each is for. */
export const SIZES = [
	{size: 192, file: 'icon-192.png', purpose: 'any'},
	{size: 512, file: 'icon-512.png', purpose: 'maskable any'},
];

/**
 * Rasterise the mark at every size.
 *
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function renderIcons()
{
	const svg = readFileSync(SOURCE, 'utf8');
	const browser = await chromium.launch({args: ['--force-device-scale-factor=1']});
	/** @type {Map<string, Buffer>} */
	const out = new Map();
	try
	{
		for (const {size, file} of SIZES)
		{
			const page = await browser.newPage({viewport: {width: size, height: size},
				deviceScaleFactor: 1});
			// The SVG inline in a document with no margin and no scrollbars, so the
			// screenshot is the artwork and nothing else.
			await page.setContent(
				'<!doctype html><meta charset="utf-8">'
				+ `<style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>`
				+ svg,
				{waitUntil: 'load'});
			out.set(file, await page.screenshot({omitBackground: false}));
			await page.close();
		}
	}
	finally
	{
		await browser.close();
	}
	return out;
}

async function main()
{
	const check = process.argv.includes('--check');
	if (!existsSync(DIR))
	{
		mkdirSync(DIR, {recursive: true});
	}
	const rendered = await renderIcons();
	const differences = [];

	for (const [file, bytes] of rendered)
	{
		const path = join(DIR, file);
		const before = existsSync(path) ? readFileSync(path) : null;
		if (before && before.equals(bytes))
		{
			continue;
		}
		differences.push(before === null ? `${file} is missing` : `${file} has changed`);
		if (!check)
		{
			writeFileSync(path, bytes);
		}
	}

	if (check)
	{
		if (differences.length)
		{
			console.error(`icons are out of date:\n  ${differences.join('\n  ')}`);
			console.error('Run `npm run icons`.');
			process.exit(1);
		}
		console.log(`icons are up to date (${rendered.size} sizes).`);
		return;
	}
	for (const [file, bytes] of rendered)
	{
		console.log(`  ${file.padEnd(14)} ${String(bytes.length).padStart(7)} B`);
	}
}

if (process.argv[1] && process.argv[1].endsWith('render-icons.mjs'))
{
	await main();
}
