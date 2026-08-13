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
 * `base` matches the deploy: the Pages workflow puts the application at
 * /architect3d/ and this site at /architect3d/docs/. Override with
 * DOCS_BASE=/ to build for a root-served host.
 */
import {defineConfig} from 'vitepress';

export default defineConfig({
	title: 'architect3d',
	description: 'WebGL 3D interior design tool with a 2D floorplanner',
	base: process.env.DOCS_BASE || '/architect3d/docs/',
	lang: 'en-GB',
	cleanUrls: true,
	// The migration roadmap is a hand-written standalone page under public/ and
	// not a markdown source, so the dead-link checker cannot resolve it.
	//
	// It is linked two different ways on purpose, because VitePress treats the
	// two cases differently. A nav entry gets the base prefixed, so that one is
	// written root-absolute ('/roadmap.html' -> '/architect3d/docs/roadmap.html')
	// and stays right on every page. A link in markdown body text does NOT get
	// the base prefixed - root-absolute there emits '/roadmap.html' verbatim,
	// which lands at the domain root, outside the deploy - so that one is
	// relative and resolves against /architect3d/docs/.
	ignoreDeadLinks: [/roadmap\.html$/],

	themeConfig: {
		nav: [
			{text: 'Guide', link: '/getting-started'},
			{text: 'Architecture', link: '/architecture'},
			{text: 'Reference', items: [
				{text: 'Save file format', link: '/save-format'},
				{text: 'Events', link: '/events'},
			]},
			{text: 'Migration roadmap', link: '/roadmap.html', target: '_blank'},
		],

		sidebar: [
			{
				text: 'Guide',
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
			copyright: 'Copyright © Amit Verma',
		},

		search: {provider: 'local'},
	},
});
