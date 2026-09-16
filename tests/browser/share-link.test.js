/**
 * A design in a link, in the browser that has to carry it (RM-013 K2, Y-7).
 *
 * ## What needs a real browser
 *
 * The headless tier puts Node's deflate behind `CompressionStream`'s interface,
 * which proves the codec's arithmetic and proves nothing about the platform. Two
 * claims are about the platform and are here:
 *
 * 1. **Chromium's own compression round-trips a real design**, at the size the
 *    drawing quoted - Y-7 measured the largest sample this build ships at 2,346
 *    characters, and a number that moves is a number worth watching.
 * 2. **A fragment survives being put in the URL.** The delivery pass drove
 *    `history.replaceState` from 2,000 to 2,000,000 characters and Chromium kept
 *    every one, which is why `MAX_LINK_CHARS` is documented as a policy rather
 *    than a ceiling. This pins the part of that which the application depends on.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
	encodeDesign, decodeDesign, payloadFromHash, linkFor, linksAvailable,
	LINK_KEY, MAX_LINK_CHARS,
} from '../../src/app/share/design_link.js';

let design;

beforeEach(async () =>
{
	design = await (await fetch('templates/sample-two-bedroom.blueprint3d')).text();
	history.replaceState(null, '', location.pathname + location.search);
});

afterEach(() =>
{
	history.replaceState(null, '', location.pathname + location.search);
});

describe('Y-7 - a design compresses into a link', () =>
{
	it('has the platform this needs, with no dependency behind it', () =>
	{
		expect(linksAvailable()).toBe(true);
		expect(typeof CompressionStream).toBe('function');
		expect(typeof DecompressionStream).toBe('function');
	});

	it('round-trips the largest design this build ships, byte for byte', async () =>
	{
		const made = await encodeDesign(design);

		expect(made.ok).toBe(true);
		// Y-7 measured 2,346 characters with gzip; deflate-raw drops gzip's header
		// and trailer, so this is a shade under. Asserted as a band rather than a
		// digit: the number moves when the sample does, and what matters is that a
		// real design is a link somebody can paste rather than a page of text.
		expect(made.chars).toBeGreaterThan(1500);
		expect(made.chars).toBeLessThan(2400);

		expect((await decodeDesign(made.payload)).design).toBe(design);
	});

	it('survives the round trip through an actual URL', async () =>
	{
		const made = await encodeDesign(design);

		history.replaceState(null, '', linkFor(made.payload));

		// The whole point of the fragment: it is in the URL, it is not truncated,
		// and it never went to a server.
		expect(location.hash.length).toBe(made.payload.length + LINK_KEY.length + 2);
		const back = payloadFromHash(location.hash);
		expect(back).toBe(made.payload);
		expect((await decodeDesign(back)).design).toBe(design);
	});

	it('keeps a link at the ceiling in the URL, which is why the ceiling is a policy', async () =>
	{
		// `MAX_LINK_CHARS` is not what a browser will take - the delivery pass put
		// two million characters in a fragment here without losing one. It is a
		// judgement about what survives an inbox, and this is the evidence that
		// the browser is not the thing saying no.
		const payload = `1${'A'.repeat(MAX_LINK_CHARS)}`;

		history.replaceState(null, '', `#${LINK_KEY}=${payload}`);

		expect(payloadFromHash(location.hash)).toBe(payload);
	});

	it('refuses a design past the ceiling rather than making a link nobody can use', async () =>
	{
		const items = Array.from({length: 5000}, (unused, i) => ({
			id: `${i.toString(36)}-${(i * 7919).toString(36)}`,
			item_name: (i * 104729).toString(36),
			model_url: `models/${(i * 15485863).toString(36)}.glb`,
			xpos: i * 1.37, ypos: i * 0.11, zpos: i * 2.9, rotation: i / 1000,
		}));
		const huge = JSON.stringify(Object.assign(JSON.parse(design), {items}));

		const made = await encodeDesign(huge);

		expect(made.ok).toBe(false);
		expect(made.reason).toBe('too-long');
		expect(made.chars).toBeGreaterThan(MAX_LINK_CHARS);
	});
});
