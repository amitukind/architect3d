// @vitest-environment jsdom
/**
 * Taking six pictures, and what happens to them on the way back (RM-011 H3).
 *
 * The projection is `tests/equirect.test.js` and a picture of a real room is
 * `tests/browser/panorama.test.js`. This is the part in between: the six
 * cameras, the size the drawing buffer is put into and taken out of, and the
 * flip that turns a GL read into a picture.
 *
 * The renderer is a fake, and everything the capture touches is on it and
 * nothing else - the same discipline `tests/helpers/renderer.js` states: if the
 * capture grows a new renderer call, this throws rather than quietly passing.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {CubeCamera, WebGLCubeRenderTarget, WebGLCoordinateSystem, Vector3, Scene} from 'three';

import {Main} from '../src/scripts/three/main.js';
import {Model} from '../src/scripts/model/model.js';
import {CUBE_FACES} from '../src/scripts/core/equirect.js';
import {resetAll} from './helpers/harness.js';
import {installCanvas2D, installPointerApis, installResizeObserver, setLayout} from './helpers/dom.js';
import {createRendererStub} from './helpers/renderer.js';
import {
	PANORAMA_FACE_SIZE, PANORAMA_WIDTH, panoramaCameras, capturePanoramaFaces,
	capturePanorama, panoramaDataUrl, flipRows,
} from '../src/scripts/three/panorama.js';

/** The world direction and up of a camera, whatever built it. */
function basis(camera)
{
	camera.updateMatrixWorld(true);
	return {
		forward: new Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
		up: new Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
	};
}

function rounded(vector)
{
	return [Math.round(vector.x), Math.round(vector.y), Math.round(vector.z)].join(',');
}

/**
 * A renderer that records what it was asked to do and hands back rows it can be
 * recognised by: every pixel of the Nth face reads `N` in red and its own row
 * in green, which is what makes the flip visible.
 */
function fakeRenderer(limit)
{
	let ratio = 2;
	let reads = 0;
	const events = [];
	const gl = {
		RGBA: 6408,
		UNSIGNED_BYTE: 5121,
		readPixels(x, y, width, height, format, type, buffer)
		{
			events.push(['read', width, height]);
			for (let row = 0; row < height; row++)
			{
				for (let column = 0; column < width; column++)
				{
					const at = (((row * width) + column) * 4);
					buffer[at] = reads;
					buffer[at + 1] = row;
					buffer[at + 2] = column;
					buffer[at + 3] = 255;
				}
			}
			reads++;
		},
	};
	return {
		events,
		capabilities: {maxTextureSize: limit || 4096},
		getContext: () => gl,
		getPixelRatio: () => ratio,
		setPixelRatio(value) {ratio = value; events.push(['ratio', value]);},
		getSize: (target) => target.set(800, 600),
		setSize(width, height, updateStyle) {events.push(['size', width, height, updateStyle]);},
		setRenderTarget(target) {events.push(['target', target]);},
		render(scene, camera) {events.push(['render', rounded(basis(camera).forward)]);},
	};
}

let restoreCanvas = null;

afterEach(() =>
{
	if (restoreCanvas) { restoreCanvas(); }
	restoreCanvas = null;
});

/** jsdom has no 2D backend; this is the smallest one `panoramaDataUrl` uses. */
function installCanvas(withContext)
{
	const original = window.HTMLCanvasElement.prototype.getContext;
	const originalUrl = window.HTMLCanvasElement.prototype.toDataURL;
	const painted = {data: null};
	window.HTMLCanvasElement.prototype.getContext = function ()
	{
		return withContext === false ? null : {
			createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}),
			putImageData: (image) => {painted.data = image.data;},
		};
	};
	window.HTMLCanvasElement.prototype.toDataURL = function ()
	{
		return `data:image/png;base64,${'A'.repeat(this.width)}`;
	};
	restoreCanvas = () =>
	{
		window.HTMLCanvasElement.prototype.getContext = original;
		window.HTMLCanvasElement.prototype.toDataURL = originalUrl;
	};
	return painted;
}

describe('the six cameras', () =>
{
	it('point exactly where three\'s own CubeCamera points', () =>
	{
		// The one test that stops `CUBE_FACES` drifting from the table it was
		// copied out of. three builds the six cameras itself; this asks it to, and
		// compares. A version bump that re-orders or re-orients them fails here
		// rather than producing a panorama that is rotated for no visible reason.
		const reference = new CubeCamera(1, 10, new WebGLCubeRenderTarget(4));
		reference.coordinateSystem = WebGLCoordinateSystem;
		reference.updateCoordinateSystem();
		reference.updateMatrixWorld(true);

		const ours = panoramaCameras(1, 10);
		expect(ours).toHaveLength(6);
		reference.children.forEach((camera, index) =>
		{
			const theirs = basis(camera);
			const mine = basis(ours[index]);
			expect(rounded(theirs.forward), CUBE_FACES[index].name).toBe(rounded(mine.forward));
			expect(rounded(theirs.up), CUBE_FACES[index].name).toBe(rounded(mine.up));
			expect(rounded(theirs.forward), CUBE_FACES[index].name).toBe(CUBE_FACES[index].forward.join(','));
		});
	});

	it('uses a positive 90, where CubeCamera uses a negative one', () =>
	{
		// Not an oversight in either direction. three's CubeCamera is built with
		// `fov = -90`, and a negative field of view negates both axes of the
		// projection - measured: a point at NDC (0.2, 0.2) through a +90 camera
		// comes out at (-0.2, -0.2) through a -90 one. That 180 degree turn is how
		// three writes each face in the order a GL cube map stores it.
		//
		// This capture never becomes a cube map. It renders to the canvas and
		// undoes GL's own bottom-up row order itself, so a normal camera is what
		// it needs - and copying the -90 across would produce six faces rotated
		// half a turn and a panorama that is upside down and back to front.
		const reference = new CubeCamera(1, 10, new WebGLCubeRenderTarget(4));
		reference.coordinateSystem = WebGLCoordinateSystem;
		reference.updateCoordinateSystem();
		expect(reference.children[0].fov).toBe(-90);

		panoramaCameras(1, 10).forEach((camera) =>
		{
			expect(camera.fov).toBe(90);
			expect(camera.aspect).toBe(1);
			expect(camera.near).toBe(1);
			expect(camera.far).toBe(10);
		});
	});
});

describe('the capture', () =>
{
	it('renders six frames, one down each axis, from the point it was given', () =>
	{
		const renderer = fakeRenderer();
		const taken = capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 10, y: 20, z: 30}, {size: 4});

		expect(taken.size).toBe(4);
		expect(taken.faces).toHaveLength(6);
		expect(renderer.events.filter((event) => event[0] === 'render').map((event) => event[1]))
			.toEqual(CUBE_FACES.map((face) => face.forward.join(',')));
	});

	it('squares the drawing buffer at ratio 1 and puts it back afterwards', () =>
	{
		const renderer = fakeRenderer();
		capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {size: 8});

		const sized = renderer.events.filter((event) => event[0] === 'size');
		// Square while capturing, and the viewport's own size again at the end.
		expect(sized[0]).toEqual(['size', 8, 8, false]);
		expect(sized[sized.length - 1]).toEqual(['size', 800, 600, false]);
		// `updateStyle: false` throughout: the canvas must not visibly resize.
		sized.forEach((event) => {expect(event[3]).toBe(false);});

		const ratios = renderer.events.filter((event) => event[0] === 'ratio');
		expect(ratios[0]).toEqual(['ratio', 1]);
		expect(ratios[ratios.length - 1]).toEqual(['ratio', 2]);
	});

	it('restores the buffer even when the read throws', () =>
	{
		const renderer = fakeRenderer();
		renderer.getContext = () => ({
			RGBA: 6408, UNSIGNED_BYTE: 5121,
			readPixels() {throw new Error('context lost');},
		});
		expect(() => capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {size: 4}))
			.toThrow('context lost');

		const sized = renderer.events.filter((event) => event[0] === 'size');
		expect(sized[sized.length - 1]).toEqual(['size', 800, 600, false]);
		expect(renderer.events.filter((event) => event[0] === 'ratio').pop()).toEqual(['ratio', 2]);
	});

	it('clamps the face to what the GPU says it can allocate', () =>
	{
		const renderer = fakeRenderer(512);
		const taken = capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {size: 4096});
		expect(taken.size).toBe(512);
		expect(renderer.events.filter((event) => event[0] === 'read')[0]).toEqual(['read', 512, 512]);
	});

	it('draws to the canvas, not to a render target', () =>
	{
		const renderer = fakeRenderer();
		capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {size: 4});
		// The reason the faces carry tone mapping and sRGB at all: three applies
		// neither when the destination is a render target.
		expect(renderer.events.filter((event) => event[0] === 'target')).toEqual([['target', null]]);
	});
});

describe('the flip', () =>
{
	it('turns GL\'s bottom-up read into a top-down picture', () =>
	{
		const size = 3;
		const buffer = new Uint8Array(size * size * 4);
		for (let row = 0; row < size; row++)
		{
			for (let column = 0; column < size; column++)
			{
				buffer[(((row * size) + column) * 4) + 1] = row;
			}
		}
		const flipped = flipRows(buffer, size);
		expect([flipped[1], flipped[(size * 4) + 1], flipped[(size * 2 * 4) + 1]]).toEqual([2, 1, 0]);
	});

	it('is applied to every captured face', () =>
	{
		const renderer = fakeRenderer();
		const taken = capturePanoramaFaces(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {size: 4});
		taken.faces.forEach((face, index) =>
		{
			// Red is the face number, green is the row GL read it from: the top row
			// of the picture is the last row of the buffer.
			expect(face[0], CUBE_FACES[index].name).toBe(index);
			expect(face[1], CUBE_FACES[index].name).toBe(3);
		});
	});
});

describe('a whole panorama', () =>
{
	it('is 2:1, and takes its face size from the width asked for', () =>
	{
		const renderer = fakeRenderer();
		const panorama = capturePanorama(/** @type {any} */ (renderer), new Scene(), {x: 0, y: 0, z: 0}, {width: 64});
		expect(panorama.width).toBe(64);
		expect(panorama.height).toBe(32);
		expect(panorama.pixels).toHaveLength(64 * 32 * 4);
		// Four faces span the 360 degrees the width covers, which is the ratio the
		// projection's nearest-neighbour sampling depends on.
		expect(renderer.events.filter((event) => event[0] === 'read')[0]).toEqual(['read', 16, 16]);
	});

	it('defaults to 4096 across, from 1024 faces', () =>
	{
		expect(PANORAMA_WIDTH).toBe(4096);
		expect(PANORAMA_FACE_SIZE).toBe(PANORAMA_WIDTH / 4);
	});

	it('encodes to an opaque PNG', () =>
	{
		const painted = installCanvas(true);
		const pixels = new Uint8ClampedArray(4 * 2 * 4);
		// A transparent pixel going in; an opaque one must come out.
		pixels[3] = 0;
		const url = panoramaDataUrl({pixels, width: 4, height: 2});
		expect(url.startsWith('data:image/png;base64,')).toBe(true);
		expect(painted.data[3]).toBe(255);
		for (let i = 3; i < painted.data.length; i += 4)
		{
			expect(painted.data[i]).toBe(255);
		}
	});

	it('returns an empty string rather than throwing with no 2D context', () =>
	{
		installCanvas(false);
		expect(panoramaDataUrl({pixels: new Uint8ClampedArray(16), width: 2, height: 1})).toBe('');
	});
});

describe('through the viewer', () =>
{
	let harness;

	beforeEach(() =>
	{
		resetAll();
		document.body.innerHTML = '';
		harness = {
			canvas: installCanvas2D(window),
			observer: installResizeObserver(window),
			pointer: installPointerApis(window),
		};
		Main.setRendererFactory(() => createRendererStub());
	});

	afterEach(() =>
	{
		Main.setRendererFactory(null);
		harness.pointer.restore();
		harness.observer.restore();
		harness.canvas.restore();
		document.body.innerHTML = '';
	});

	function viewer()
	{
		const host = document.createElement('div');
		host.id = 'viewer';
		document.body.appendChild(host);
		setLayout(host, {left: 0, top: 0, width: 1024, height: 768});
		const three = new Main(new Model(), host, 'three-canvas', {});
		setLayout(three.renderer.domElement, {left: 0, top: 0, width: 1024, height: 768});
		return three;
	}

	it('takes the panorama from where the walker is standing', () =>
	{
		installCanvas(true);
		const three = viewer();
		three.fpscontrols.teleport(140, -260, 0);

		const seen = [];
		const inner = three.renderer.render.bind(three.renderer);
		three.renderer.render = function (scene, camera)
		{
			seen.push(camera.position.toArray().join(','));
			inner(scene, camera);
		};

		expect(three.panoramaUrl({width: 32}).startsWith('data:image/png;base64,')).toBe(true);
		// Six of the seven renders are the faces, all from the eye; the last is the
		// view being put back.
		expect(seen.filter((at) => at === '140,160,-260')).toHaveLength(6);
		three.dispose();
	});

	it('leaves the viewport the size it found it', () =>
	{
		installCanvas(true);
		const three = viewer();
		const size = {...three.renderer.size};
		const ratio = three.renderer.getPixelRatio();
		three.panoramaUrl({width: 32});
		expect(three.renderer.size).toEqual(size);
		expect(three.renderer.getPixelRatio()).toBe(ratio);
		three.dispose();
	});

	it('accepts a point of its own, for a caller that is not the walker', () =>
	{
		installCanvas(true);
		const three = viewer();
		const seen = [];
		const inner = three.renderer.render.bind(three.renderer);
		three.renderer.render = function (scene, camera)
		{
			seen.push(camera.position.toArray().join(','));
			inner(scene, camera);
		};
		three.panoramaUrl({width: 32, position: {x: 1, y: 2, z: 3}});
		expect(seen.filter((at) => at === '1,2,3')).toHaveLength(6);
		three.dispose();
	});
});
