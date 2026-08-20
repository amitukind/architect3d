// @ts-check

/**
 * The pages written for somebody using the planner (RM-014 L2, finding Z-7).
 *
 * ## Why there is a list here at all
 *
 * Z-7 counted five documentation pages in this repository and found that every
 * one of them addresses somebody *integrating the library*: how to install it,
 * how the layers fit together, what is in a `.blueprint3d`, which events fire.
 * There was not one sentence anywhere addressed to a person drawing a room.
 *
 * These are those pages. They live in the VitePress site that already builds
 * and already deploys, and they are listed here rather than only in the site's
 * own sidebar so that two things are checkable from one place: that the link in
 * the application resolves to a page that exists, and that the page is reachable
 * from the site's navigation. `tools/check-help.mjs` is that check, and it is
 * the sixteenth gate.
 *
 * ## The base is a deployment fact
 *
 * The application is served from `/architect3d/` and the documentation from
 * `/architect3d/docs/`, and in development both of those are `/`. Vite writes
 * the application's base into `import.meta.env.BASE_URL`, so the link is
 * computed from it rather than hard-coded - which is the same argument RM-003
 * A5 made for asset URLs, at a much smaller scale.
 */

/**
 * @typedef {Object} HelpPage
 * @property {string} route Where it is served, relative to the docs base.
 * @property {string} source The markdown file, relative to `docs/`.
 * @property {string} title As the site's sidebar names it.
 */

/** Where the documentation site sits relative to the application. */
export const DOCS_PATH = 'docs/';

/** @type {Array<HelpPage>} */
export const HELP_PAGES = [
	{route: 'using/', source: 'using/index.md', title: 'Using the planner'},
	{route: 'using/drawing', source: 'using/drawing.md', title: 'Drawing a plan'},
	{route: 'using/furnishing', source: 'using/furnishing.md', title: 'Furnishing a room'},
	{route: 'using/keeping', source: 'using/keeping.md', title: 'Keeping and sharing'},
];

/** What the help menu opens. */
export const HELP_HOME = HELP_PAGES[0];

/**
 * A help page's URL for this deployment.
 *
 * @param {string} [route] Defaults to the landing page.
 * @param {string} [base] Defaults to the application's own base.
 * @returns {string}
 */
export function helpUrl(route, base)
{
	var root = base !== undefined
		? base
		: ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/');
	var prefix = root.endsWith('/') ? root : `${root}/`;
	return `${prefix}${DOCS_PATH}${route === undefined ? HELP_HOME.route : route}`;
}
