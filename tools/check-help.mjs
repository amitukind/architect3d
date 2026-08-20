/**
 * The help the application points at exists, and can be found (RM-014 L2).
 *
 *   npm run help:check
 *
 * ## What this checks, and what it deliberately cannot
 *
 * L2's acceptance clause reads *"the help link resolves against the deployed
 * docs base, checked rather than assumed"*, and there are three separate claims
 * inside that sentence. This tool checks the two that are checkable from a
 * repository:
 *
 *  1. **Every page the application links to has a source.** `HELP_PAGES` in
 *     `src/app/tour/help.js` is what the shell reads; each entry names a
 *     markdown file, and this asserts the file is there. A renamed page is the
 *     failure this exists for, because the symptom is a 404 nobody reaches
 *     except a person who needed help.
 *  2. **Every page is reachable from the site's own navigation.** A page that
 *     exists and is in no sidebar is a page only somebody with the URL can
 *     find, which for documentation is most of the way to not existing.
 *
 * And the third claim, which it does NOT check: that the built site is
 * *deployed* at the base the application computes. That is a property of a
 * GitHub Pages workflow and a DNS record, and asserting it here would mean
 * asserting that a constant equals itself. The base is derived from
 * `import.meta.env.BASE_URL` at runtime rather than written down twice, which
 * is the design that makes it hard to get wrong; this tool checks the half that
 * a repository can see.
 *
 * ## It also checks the tour's anchors are ids that exist in the source
 *
 * The step list names elements by selector, and a renamed id produces a popover
 * pointing at nothing. `tests/tour.test.js` asserts the same thing against a
 * mounted shell, which is the stronger check; this one runs in CI without a
 * DOM and catches a rename in the same commit that makes it.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

/** Read the two lists out of source rather than restating them here. */
async function lists()
{
	const help = await import(`file://${join(ROOT, 'src/app/tour/help.js')}`);
	const steps = await import(`file://${join(ROOT, 'src/app/tour/steps.js')}`);
	return {pages: help.HELP_PAGES, steps: steps.TOUR_STEPS};
}

/** Every `link:` in the VitePress sidebar and nav, as a flat set. */
function navigable()
{
	const config = readFileSync(join(DOCS, '.vitepress/config.mjs'), 'utf8');
	return new Set([...config.matchAll(/link:\s*'([^']+)'/g)].map((match) => match[1]));
}

/** Every `id="..."` in the application's own markup. */
function ids()
{
	const found = new Set();
	const walk = (dir) =>
	{
		for (const entry of readdirSync(dir, {withFileTypes: true}))
		{
			const path = join(dir, entry.name);
			if (entry.isDirectory()) { walk(path); }
			else if (entry.name.endsWith('.vue'))
			{
				for (const match of readFileSync(path, 'utf8').matchAll(/\sid="([a-z0-9-]+)"/g))
				{
					found.add(match[1]);
				}
			}
		}
	};
	walk(join(ROOT, 'src/app'));
	return found;
}

async function main()
{
	const {pages, steps} = await lists();
	const links = navigable();
	const markup = ids();
	const problems = [];

	for (const page of pages)
	{
		if (!existsSync(join(DOCS, page.source)))
		{
			problems.push(`${page.source} is linked by the application and does not exist`);
		}
		if (!links.has(`/${page.route}`))
		{
			problems.push(`/${page.route} is not in the documentation site's nav or sidebar`);
		}
	}

	for (const step of steps)
	{
		if (!step.anchor.startsWith('#'))
		{
			problems.push(`tour step "${step.id}" anchors on "${step.anchor}", which is not an id`);
			continue;
		}
		if (!markup.has(step.anchor.slice(1)))
		{
			problems.push(`tour step "${step.id}" anchors on ${step.anchor}, which no component renders`);
		}
	}

	if (problems.length)
	{
		console.error(`help and tour are out of step with the tree:\n  ${problems.join('\n  ')}`);
		process.exit(1);
	}

	const words = pages.reduce(
		(sum, page) => sum + readFileSync(join(DOCS, page.source), 'utf8').trim().split(/\s+/).length, 0);
	console.log(`  ${pages.length} help pages, ${words} words, all linked from the site`);
	console.log(`  ${steps.length} tour steps, every anchor rendered by a component`);
}

if (process.argv[1] && process.argv[1].endsWith('check-help.mjs'))
{
	await main();
}
