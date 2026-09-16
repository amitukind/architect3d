/**
 * The rule that would have caught the dead link (RM-016 N3, M-58).
 *
 * ## What this is a rule about
 *
 * AA-1 opened RM-015 by counting nine README links to an address returning
 * 404. M1 removed all nine and wrote the new Cloudflare address into the same
 * first screenful, in anticipation of a deploy. AB-6 measured what that became
 * when the deploy did not happen: `curl` against `architect3d.pages.dev` exits
 * 6, *could not resolve host*, against a control request to github.com
 * returning 200 from the same shell. Worse than the 404 it replaced - a 404 is
 * a server saying no, and this is a name nobody has registered.
 *
 * Gate seventeen could not have caught it. It forbids the *retired* host by
 * name, and a link to a plausible future host passes that and every other rule
 * in the file. No check that runs offline can tell a real hostname from an
 * aspirational one, so this one does not try: it is about the shape of the
 * host, and the shape it forbids is *a deployment of this project*.
 *
 * ## The line it has to draw, and why github.com is on the other side of it
 *
 * `github.com/amitukind/architect3d` contains the project's name, resolves
 * today, and is the one absolute link a public repository's README certainly
 * should have. Source hosting is not a deploy. The distinction the rule makes
 * is between *somewhere this project's code lives* and *somewhere this
 * project's build would be served* - and only the second is something a
 * repository has no way to verify.
 */
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';

import {deploymentLinksIn} from '../tools/check-deploy.mjs';

describe('M-58 - the README advertises no address of ours', () =>
{
	it('catches the link AB-6 measured, and every shape like it', () =>
	{
		// Each of these is a place this project's build could plausibly be
		// published, which is exactly the set nobody can prove is live.
		const advertised = [
			'https://architect3d.pages.dev',
			'https://architect3d.pages.dev/docs',
			'https://amitukind.github.io/architect3d/',
			'https://architect3d.netlify.app',
			'https://architect3d.vercel.app',
			'https://architect3d.workers.dev/',
			'https://architect3d.com',
			'https://architect3d.app/plan',
		];

		for (const url of advertised)
		{
			expect(deploymentLinksIn(`See the **[Live app](${url})** for a demo.`), url).toEqual([url]);
		}
	});

	it('leaves every third party alone, and the repository itself', () =>
	{
		// The README links to all of these today and must keep being able to.
		const fine = [
			'https://github.com/amitukind/architect3d.git',
			'https://github.com/amitukind/',
			'https://threejs.org/',
			'https://reka-ui.com/',
			'https://creativecommons.org/publicdomain/zero/1.0/',
			'https://kenney.nl/assets/furniture-kit',
			'https://amitukind.com',
		];

		for (const url of fine)
		{
			expect(deploymentLinksIn(`Built on [a thing](${url}).`), url).toEqual([]);
		}
	});

	it('is about links, not about mentions', () =>
	{
		// The same distinction the retired-host rule had to learn on its first
		// real run, when it failed on the roadmap for quoting the dead address as
		// the thing it had measured. A gate that forbids naming a finding is a
		// gate that makes the record worse.
		const prose = 'RM-016 AB-6 found that `architect3d.pages.dev` does not resolve at all, and'
			+ ' https://architect3d.pages.dev is written here as bare text rather than as a link.';

		expect(deploymentLinksIn(prose)).toEqual([]);
	});

	it('ignores a URL no browser could follow', () =>
	{
		expect(deploymentLinksIn('[broken](https://)')).toEqual([]);
		expect(deploymentLinksIn('[nothing]()')).toEqual([]);
		expect(deploymentLinksIn('')).toEqual([]);
		expect(deploymentLinksIn(null)).toEqual([]);
	});

	it('finds every one of them, not only the first', () =>
	{
		// AA-1's finding was nine links, not one. A rule that stopped at the first
		// would have taken nine commits to satisfy.
		const readme = '[a](https://architect3d.pages.dev) and [b](https://architect3d.pages.dev/docs)'
			+ ' and [c](https://github.com/amitukind/architect3d)';

		expect(deploymentLinksIn(readme)).toHaveLength(2);
	});

	it('passes the README this repository actually ships', () =>
	{
		// The gate runs against this file in CI; this is the same assertion at the
		// tier where the failure is legible line by line.
		expect(deploymentLinksIn(readFileSync('README.md', 'utf8'))).toEqual([]);
	});
});
