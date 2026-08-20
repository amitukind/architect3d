// @ts-check
import {ref} from 'vue';
import {EVENT_GLTF_READY} from '../../scripts/blueprint.js';
import {exportPlanSVG, renderPlanToCanvas} from '../../scripts/blueprint.js';
import {DEFAULT_DESIGN} from '../designs/default-design.js';
import {useToasts} from './useToasts.js';

/**
 * New / open / save, for all four formats the demo offered.
 *
 * Sprint S6, replacing `mainControls()` at build/js/app.js:96-174.
 *
 * The demo read its file input by id from inside the change handler, tried the
 * 2D input first and fell back to the 3D one - both point at the same flow -
 * and built an <a download> by hand four separate times. Here there is one
 * download helper and one read helper, and the file input hands its File
 * straight in.
 */

/**
 * How long to wait for EVENT_GLTF_READY before giving up.
 *
 * `Model.exportForBlender` has no failure channel: on a rejected
 * `parseAsync` it logs to the console and dispatches nothing, so a promise
 * waiting on the event would never settle and the export button would stay
 * disabled for the life of the page. Giving the library a proper error event
 * is a library change and this is an application sprint, so the deadline lives
 * here for now - generous enough that a large scene finishes, short enough that
 * a failure is not permanent.
 */
const GLTF_EXPORT_TIMEOUT_MS = 60000;

/**
 * Hand `data` to the browser as a download named `filename`.
 *
 * The object URL is revoked once the click has been dispatched. The demo never
 * revoked any of the four it created, so a session that saved repeatedly held
 * every previous blob for the life of the page.
 */
function download(data, filename, type)
{
	var blob = new Blob([data], {type: type});
	var url = URL.createObjectURL(blob);
	var anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

/**
 * A data URL as bytes, so a large export can be downloaded as a blob.
 *
 * `savePhoto` hands its data URL straight to an anchor and that is fine at a
 * couple of megabytes. A 4096 x 2048 panorama is an order of magnitude past
 * that once base64 has added its third, and a URL that long is where browsers
 * differ - Chrome takes it, others have refused. A blob has no length to
 * exceed, and the object URL is revoked by `download` either way.
 *
 * @param {string} url A `data:<type>;base64,<payload>` URL.
 * @returns {Uint8Array}
 */
function dataUrlToBlob(url)
{
	var binary = atob(url.slice(url.indexOf(',') + 1));
	var bytes = new Uint8Array(binary.length);
	for (var i = 0; i < binary.length; i++)
	{
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * A text measurer bound to the live canvas, captured BEFORE the export starts
 * (RM-008 E4).
 *
 * The binding is the whole point and it cost a test to find. `renderTo` swaps
 * `view.backend` for the duration of the export, so a measurer written as
 * `view.backend.measureText(...)` resolves to the SVG backend once the export
 * is under way - and `SvgBackend.measureText` delegates to its measurer, which
 * is that closure. Straight into infinite recursion, on the first label.
 *
 * Reading the backend once, here, is what makes it the canvas' measurer for the
 * whole of the render.
 *
 * @param {Object} planner A `Floorplanner2D`.
 * @returns {function(string, number, string=): number}
 */
function liveMeasurer(planner)
{
	var backend = planner.view.backend;
	return function (text, size, style) {return backend.measureText(text, size, style);};
}

/**
 * A caught value is `unknown`, and `throw 'a string'` is legal JavaScript.
 * Both call sites below want a sentence to show the user.
 *
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error)
{
	return (error instanceof Error) ? error.message : String(error);
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function readAsText(file)
{
	return new Promise(function (resolve, reject)
	{
		var reader = new FileReader();
		// readAsText guarantees a string result on success, but the DOM types
		// describe `result` as string | ArrayBuffer | null because the same
		// reader could have been asked for a buffer. Narrowed rather than cast,
		// so a surprise here rejects instead of resolving with the wrong thing.
		reader.onload = function ()
		{
			if (typeof reader.result === 'string')
			{
				resolve(reader.result);
				return;
			}
			reject(new Error(`Could not read ${file.name} as text.`));
		};
		reader.onerror = function () {reject(reader.error || new Error(`Could not read ${file.name}.`));};
		reader.readAsText(file);
	});
}

/**
 * Strip what a filesystem will not take, and keep what a person typed.
 *
 * Not a slug: `Loft conversion.blueprint3d` is the file somebody wants, not
 * `loft-conversion`. Only the characters that are illegal on Windows, macOS or
 * Linux go - the path separators, the shell wildcards, the reserved punctuation
 * and the control range - plus a leading dot, which would make the download
 * hidden on two of the three.
 *
 * @param {?string} name
 * @returns {string}
 */
export function fileNameFor(name)
{
	// eslint-disable-next-line no-control-regex
	var cleaned = String(name == null ? '' : name).replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
		.replace(/\s+/g, ' ').replace(/^\.+/, '').trim();
	return cleaned || 'design';
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 * @param {Object} [options]
 * @param {function(string): void} [options.afterLoad] Called with the document
 *        every time one is successfully loaded, whichever route it came in by
 *        (RM-012 J3).
 *
 *        A hook rather than a call at each site, because there are five sites -
 *        a file, a project, a template, a shared link and a `.zip` bundle - and
 *        a design's imported models have to be reported the same way in all
 *        five. Something one of them forgot to do would be a design silently
 *        missing an item, which is the exact failure J3's second acceptance
 *        clause is written against.
 */
export function useDesignIO(store, options)
{
	var settings = options || {};
	var busy = ref(false);
	/**
	 * What the exports are called (RM-013 K1, finding Y-2).
	 *
	 * Every download this application produced was named by a constant -
	 * `design.blueprint3d`, `design.obj`, `design.gltf`, `plan-1-100.svg`,
	 * `plan.png`, `view.png`, `panorama.png` - so seven exports of seven
	 * different designs all arrived in a downloads folder under the same seven
	 * names. A project has a name now, and `useProjects` writes it here.
	 *
	 * Owned by this composable rather than passed in, because the alternative is
	 * a cycle: the library loads designs through `loadDesign` below, so it cannot
	 * also be what this reads its name from.
	 */
	var documentName = ref('design');
	// Kept alongside the toasts rather than replaced by them. A toast is
	// transient by design, and a caller - a test, an embedder - that wants to
	// know whether the last operation failed should not have to scrape a queue
	// of UI notices for it.
	var lastError = ref(null);
	var toasts = useToasts();

	function fail(message, error)
	{
		lastError.value = message;
		toasts.error(message, {detail: error ? String(error.message || error) : null});
		if (error)
		{
			console.error(error);
		}
	}

	/**
	 * @param {string} text The document that just loaded.
	 */
	function loaded(text)
	{
		if (settings.afterLoad)
		{
			settings.afterLoad(text);
		}
	}

	function newDesign()
	{
		lastError.value = null;
		store.model.value.loadSerialized(DEFAULT_DESIGN);
	}

	/**
	 * The first problem in a load result, as a sentence to show somebody.
	 *
	 * `Model.loadDocument` reports every problem it found, each with a path to the
	 * field. All of them in a toast is unreadable, and the first one is almost
	 * always the cause of the rest - a missing `corners` object makes every wall
	 * that references it wrong too. The full list is on the result for a caller
	 * that wants to render it properly.
	 *
	 * @param {import('../../scripts/model/document.js').ParseResult} result
	 * @returns {string}
	 */
	function firstProblem(result)
	{
		var problem = result.errors[0];
		if (!problem)
		{
			return 'the file could not be read.';
		}
		var more = result.errors.length > 1 ? ` (and ${result.errors.length - 1} more)` : '';
		return (problem.path ? `${problem.path} ${problem.message}` : problem.message) + more;
	}

	/**
	 * Replace the design with an already-read document.
	 *
	 * Split out of openDesign so the autosave recovery path can reuse the parse
	 * and the error reporting without inventing a File to hand it.
	 *
	 * Goes through `loadDocument` rather than `loadSerialized` since RM-003 A1:
	 * same operation, but the failure arrives as a list of problems with the path
	 * to each field instead of one exception. The design is untouched either way -
	 * that is A1's guarantee and it is what made this message worth improving.
	 * Before, "Could not open that design" was displayed *after* the design had
	 * been destroyed, so the accuracy of the message was the least of it.
	 *
	 * @param {string} text A `.blueprint3d` document.
	 * @param {string} [label] How to name it if it fails to parse.
	 * @returns {boolean} whether it loaded.
	 */
	function loadDesign(text, label)
	{
		lastError.value = null;
		try
		{
			var result = store.model.value.loadDocument(text);
			if (!result.ok)
			{
				fail(`Could not open ${label || 'that design'}: ${firstProblem(result)}`, null);
				return false;
			}
			loaded(text);
			return true;
		}
		catch (error)
		{
			// A bug rather than a bad file: validation has already passed by the
			// time anything is mutated, so reaching here means the library threw
			// somewhere it should not have.
			fail(`Could not open ${label || 'that design'}: ${messageOf(error)}`, error);
			return false;
		}
	}

	/**
	 * @param {File} file A `.blueprint3d` document.
	 */
	async function openDesign(file)
	{
		lastError.value = null;
		if (!file)
		{
			return;
		}
		try
		{
			var text = await readAsText(file);
			var result = store.model.value.loadDocument(text);
			if (!result.ok)
			{
				fail(`Could not open ${file.name}: ${firstProblem(result)}`, null);
				return;
			}
			loaded(text);
			if (result.warnings.length)
			{
				// A file this build can open but cannot fully vouch for - an unknown
				// units stamp is the only case today. Worth saying out loud, because
				// the consequence is a plan at the wrong scale, which looks like a
				// bug in the application rather than a property of the file.
				toasts.error(`Opened ${file.name}, with warnings`, {detail: result.warnings[0].message});
				return;
			}
			toasts.success(`Opened ${file.name}`);
		}
		catch (error)
		{
			fail(`Could not open ${file.name}: ${messageOf(error)}`, error);
		}
	}

	function saveDesign()
	{
		var name = `${fileNameFor(documentName.value)}.blueprint3d`;
		download(store.model.value.exportSerialized(), name, 'text/plain');
		toasts.success(`Saved ${name}`);
	}

	function saveMesh()
	{
		var name = `${fileNameFor(documentName.value)}.obj`;
		download(store.model.value.exportMeshAsObj(), name, 'text/plain');
		toasts.success(`Exported ${name}`);
	}

	/**
	 * The 2D plan, as a drawing (RM-008 E4).
	 *
	 * The library does the drawing - `exportPlanSVG` points the live view's own
	 * `draw()` at an SVG backend, so a sheet is the plan on screen and not a
	 * second rendering of it. This function's whole job is the three things the
	 * library cannot know: which floorplanner, what the file should be called,
	 * and how to hand a string to a browser.
	 *
	 * The measurer is passed through, and it matters: E3's declutter pass asks
	 * how wide a label is before deciding to draw it, and SVG has no font
	 * metrics. Handing it the live canvas' `measureText` is what makes the sheet
	 * hide exactly the labels the screen hides.
	 *
	 * @param {number} scale The denominator: 50 means 1:50.
	 */
	function savePlanSVG(scale)
	{
		var planner = store.floorplanner.value;
		if (!planner)
		{
			fail('There is no plan view to export.');
			return;
		}
		var svg = exportPlanSVG(planner.view, store.model.value.floorplan, {
			scale: scale,
			title: 'Floor plan',
			subtitle: new Date().toISOString().slice(0, 10),
			measure: liveMeasurer(planner),
		});
		if (!svg)
		{
			fail('There is nothing on the plan to export yet.');
			return;
		}
		var name = `${fileNameFor(documentName.value)} plan 1-${scale}.svg`;
		download(svg, name, 'image/svg+xml');
		toasts.success(`Exported ${name}`);
	}

	/**
	 * The 2D plan, as a PNG (RM-008 E4).
	 *
	 * No scale is offered and that is deliberate rather than an omission: a PNG
	 * is pixels, and how big a pixel comes out is the printer's business. A
	 * ratio printed on an image nothing can hold to would be worse than no ratio
	 * at all, so the sheet carries a scale bar - which stays true through a
	 * photocopier - and says "not to scale" beside it.
	 *
	 * @param {number} pixelWidth
	 */
	/**
	 * A photograph of the 3D view (RM-011 H2, W-11).
	 *
	 * `Main.dataUrl()` has existed since the fork and **nothing called it** - W-11
	 * measured it producing the canvas at 1024 x 768 at device pixel ratio 1, a
	 * screenshot of a viewport rather than a picture of a design. It supersamples
	 * now, and this is the caller.
	 *
	 * A data URL rather than a blob, unlike `savePlanPNG` beside it, and the
	 * difference is not an inconsistency: that one *draws* into a canvas it owns
	 * and can therefore hand the blob straight out, while this one reads back a
	 * live WebGL drawing buffer, which `toDataURL` is the only synchronous way to
	 * do. Between the render and the read the buffer must not be cleared, so
	 * there is no callback to wait in.
	 *
	 * @param {number} [supersample] Multiples of the displayed resolution, 1 to 4.
	 */
	function savePhoto(supersample)
	{
		var viewer = store.instance.value && store.instance.value.three;
		if (!viewer)
		{
			fail('There is no 3D view to photograph.');
			return;
		}
		var url = viewer.dataUrl(supersample || 2);
		if (!url || url.length < 100)
		{
			fail('The browser could not encode the image.');
			return;
		}
		var anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${fileNameFor(documentName.value)} view.png`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		toasts.success(`Exported ${fileNameFor(documentName.value)} view.png`);
	}

	/**
	 * A 360 degree panorama of the design (RM-011 H3).
	 *
	 * Taken from wherever the walkthrough was left standing, which is what the
	 * sprint means by *"any point"* - the teleport click is how a point gets
	 * chosen, and this is what it is chosen for. Leaving the walkthrough does not
	 * move the walker, so the sequence is: walk there, press Esc, export.
	 *
	 * Synchronous like `savePhoto` beside it and for the same reason - six frames
	 * are read straight back out of the drawing buffer, and nothing may clear it
	 * in between - but far heavier: six renders and an eight-megapixel projection.
	 * The toast is raised first so the window has said something before it stops
	 * answering.
	 *
	 * @param {number} [width] Output width in pixels. The height is half of it.
	 */
	function savePanorama(width)
	{
		var viewer = store.instance.value && store.instance.value.three;
		if (!viewer)
		{
			fail('There is no 3D view to photograph.');
			return;
		}
		var url = viewer.panoramaUrl({width: width});
		if (!url || url.length < 100)
		{
			fail('The browser could not encode the panorama.');
			return;
		}
		var name = `${fileNameFor(documentName.value)} panorama.png`;
		download(dataUrlToBlob(url), name, 'image/png');
		toasts.success(`Exported ${name}`);
	}

	function savePlanPNG(pixelWidth)
	{
		var planner = store.floorplanner.value;
		if (!planner)
		{
			fail('There is no plan view to export.');
			return;
		}
		var canvas = document.createElement('canvas');
		var drawn = renderPlanToCanvas(planner.view, store.model.value.floorplan, canvas, {
			width: pixelWidth,
			title: 'Floor plan',
			subtitle: new Date().toISOString().slice(0, 10),
		});
		if (!drawn)
		{
			fail('There is nothing on the plan to export yet.');
			return;
		}
		// Narrowed into a local before the callback: the checker cannot carry the
		// null guard above across the closure boundary (RM-005 C2).
		var size = drawn;
		canvas.toBlob(function (blob)
		{
			if (!blob)
			{
				fail('The browser could not encode the image.');
				return;
			}
			var url = URL.createObjectURL(blob);
			var anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = `${fileNameFor(documentName.value)} plan.png`;
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			URL.revokeObjectURL(url);
			toasts.success(`Exported ${fileNameFor(documentName.value)} plan.png, ${size.width}\u00d7${size.height}`);
		}, 'image/png');
	}

	/**
	 * Print the plan, which is how a browser makes a PDF (RM-008 E4).
	 *
	 * Through a hidden iframe holding the SVG, rather than a print stylesheet
	 * over the application. The application is a full-height flex layout with a
	 * canvas in it, and printing that means fighting every rule in it for one
	 * page; an iframe carrying nothing but the sheet prints the sheet, at the
	 * size the sheet says it is, in one browser dialog with a Save-as-PDF option
	 * already in it.
	 *
	 * @param {number} scale
	 */
	function printPlan(scale)
	{
		var planner = store.floorplanner.value;
		if (!planner)
		{
			fail('There is no plan view to print.');
			return;
		}
		var svg = exportPlanSVG(planner.view, store.model.value.floorplan, {
			scale: scale,
			title: 'Floor plan',
			subtitle: new Date().toISOString().slice(0, 10),
			measure: liveMeasurer(planner),
		});
		if (!svg)
		{
			fail('There is nothing on the plan to print yet.');
			return;
		}
		var frame = document.createElement('iframe');
		frame.setAttribute('aria-hidden', 'true');
		frame.style.position = 'fixed';
		frame.style.right = '100%';
		frame.style.width = '1px';
		frame.style.height = '1px';
		document.body.appendChild(frame);
		var doc = frame.contentDocument;
		if (!doc || !frame.contentWindow)
		{
			document.body.removeChild(frame);
			fail('The browser would not open a print view.');
			return;
		}
		doc.open();
		doc.write(`<!doctype html><meta charset="utf-8"><title>Floor plan 1:${scale}</title>`
			+ '<style>@page{margin:0}body{margin:0}svg{display:block}</style>' + svg);
		doc.close();
		var win = frame.contentWindow;
		// The frame has to be in the document and laid out before print() will
		// paginate it, so this waits a frame rather than calling straight away.
		requestAnimationFrame(function ()
		{
			win.focus();
			win.print();
			// Removed on a timer rather than on afterprint: Safari does not fire it
			// for an iframe, and a frame left behind is a leak per print.
			setTimeout(function () {if (frame.parentNode) {frame.parentNode.removeChild(frame);}}, 1000);
		});
	}

	/**
	 * Export the scene as glTF.
	 *
	 * The library's export is a double hop: `Main.exportForBlender()` hides the
	 * skybox and ground, asks the Model to export, and the Model dispatches
	 * EVENT_GLTF_READY at the Model - which Main forwards, re-showing the
	 * skybox on the way through. The demo listened for the forwarded event at
	 * module scope and saved from there, which meant the listener outlived every
	 * export and there was no way to know an export had finished.
	 *
	 * One promise, one listener, removed either way.
	 *
	 * @returns {Promise<string>} the glTF JSON, already downloaded.
	 */
	function saveGLTF()
	{
		var three = store.three.value;
		busy.value = true;
		lastError.value = null;

		return new Promise(function (resolve, reject)
		{
			var timer = setTimeout(function ()
			{
				finish();
				reject(new Error('The glTF export did not finish in time. See the console for the cause.'));
			}, GLTF_EXPORT_TIMEOUT_MS);

			function finish()
			{
				clearTimeout(timer);
				three.removeEventListener(EVENT_GLTF_READY, onReady);
				busy.value = false;
			}

			function onReady(event)
			{
				finish();
				var name = `${fileNameFor(documentName.value)}.gltf`;
				download(event.gltf, name, 'model/gltf+json');
				toasts.success(`Exported ${name}`);
				resolve(event.gltf);
			}

			three.addEventListener(EVENT_GLTF_READY, onReady);
			three.exportForBlender();
		}).catch(function (error)
		{
			fail(error.message, error);
			throw error;
		});
	}

	return {busy, lastError, documentName, newDesign, loadDesign, openDesign, saveDesign, saveMesh,
		saveGLTF, savePhoto, savePanorama, savePlanSVG, savePlanPNG, printPlan,
		// Exposed for RM-013 K2's bundle, which is bytes rather than a document
		// and so has nothing else in here to go through. One download helper, and
		// the note at the top of this file is why there is only one.
		download};
}
