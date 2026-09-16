/**
 * The documentation site (migration sprint S9).
 *
 * Replaces esdoc, which generated 82 MB of committed HTML from the same
 * JSDoc comments the source already carries, was abandoned upstream in 2018,
 * and was the origin of all 20 of this project's npm advisories.
 *
 * Prose rather than a symbol dump, deliberately. The API surface is 56 exports
 * off one barrel and every one of them is documented where it lives; what was
 * missing was the four things a symbol list cannot tell you - how to run it,
 * how the layers fit together, what is actually inside a .blueprint3d file, and
 * which events fire when.
 *
 *   npm run docs        dev server with hot reload
 *   npm run docs:build  static site -> docs/.vitepress/dist
 *
 * `base` matches the deploy: Cloudflare Pages serves the project at the root
 * of its own domain, so the application is at / and this site at /docs/
 * (RM-015 M1). Override with DOCS_BASE for anywhere else - the GitHub Pages
 * deploy this replaced passed /architect3d/docs/, and the variable is why
 * changing host needed one line here and nothing anywhere else (AA-2).
 */
import {defineConfig} from 'vitepress';

export default defineConfig({
	title: 'architect3d',
	description: 'WebGL 3D interior design tool with a 2D floorplanner',
	base: process.env.DOCS_BASE || '/docs/',
	lang: 'en-GB',
	cleanUrls: true,
	// The migration roadmap is a hand-written standalone page under public/ and
	// not a markdown source, so the dead-link checker cannot resolve it.
	//
	// It is linked two different ways on purpose, because VitePress treats the
	// two cases differently. A nav entry gets the base prefixed, so that one is
	// written root-absolute ('/roadmap.html' -> '/docs/roadmap.html') and stays
	// right on every page. A link in markdown body text does NOT get the base
	// prefixed - root-absolute there emits '/roadmap.html' verbatim, which lands
	// at the domain root, outside the site - so that one is relative and
	// resolves against the base, whatever it is.
	ignoreDeadLinks: [/roadmap\.html$/],

	themeConfig: {
		nav: [
			// First, and deliberately: RM-014 Z-7 found five pages in this site and
			// every one of them written for somebody integrating the library. The
			// people who arrive here from the application itself are not those
			// people, and the first nav entry is now theirs.
			{text: 'Using the planner', link: '/using/'},
			{text: 'Guide', link: '/getting-started'},
			{text: 'Architecture', link: '/architecture'},
			{text: 'Reference', items: [
				{text: 'Save file format', link: '/save-format'},
				{text: 'Events', link: '/events'},
			]},
			{text: 'State of the build', link: '/roadmap.html', target: '_blank'},
		],

		sidebar: [
			{
				text: 'Using the planner',
				items: [
					{text: 'Using the planner', link: '/using/'},
					{text: 'Drawing a plan', link: '/using/drawing'},
					{text: 'Furnishing a room', link: '/using/furnishing'},
					{text: 'Keeping and sharing', link: '/using/keeping'},
				],
			},
			{
				text: 'Building with the library',
				items: [
					{text: 'Getting started', link: '/getting-started'},
					{text: 'Architecture', link: '/architecture'},
				],
			},
			{
				text: 'Reference',
				items: [
					{text: 'Save file format', link: '/save-format'},
					{text: 'Events', link: '/events'},
				],
			},
		],

		socialLinks: [
			{icon: 'github', link: 'https://github.com/amitukind/architect3d'},
		],

		editLink: {
			pattern: 'https://github.com/amitukind/architect3d/edit/master/docs/:path',
			text: 'Edit this page on GitHub',
		},

		footer: {
			message: 'Released under the ISC licence.',
			// HTML rather than plain text: VitePress renders both footer fields as
			// markup, and the credit is meant to be a link.
			copyright: 'Created by <a href="https://amitukind.com" target="_blank" rel="noopener noreferrer">Amit Verma</a>',
		},

		search: {provider: 'local'},
	},
});
