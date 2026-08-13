import {ref} from 'vue';
import {EVENT_GLTF_READY} from '../../scripts/blueprint.js';
import {DEFAULT_DESIGN} from '../designs/default-design.js';

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
 * @param {File} file
 * @returns {Promise<string>}
 */
function readAsText(file)
{
	return new Promise(function (resolve, reject)
	{
		var reader = new FileReader();
		reader.onload = function (event) {resolve(event.target.result);};
		reader.onerror = function () {reject(reader.error || new Error(`Could not read ${file.name}.`));};
		reader.readAsText(file);
	});
}

/**
 * @param {import('./useBlueprint.js').BlueprintStore} store
 */
export function useDesignIO(store)
{
	var busy = ref(false);
	var lastError = ref(null);

	function newDesign()
	{
		lastError.value = null;
		store.model.value.loadSerialized(DEFAULT_DESIGN);
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
			store.model.value.loadSerialized(text);
		}
		catch (error)
		{
			lastError.value = `Could not open ${file.name}: ${error.message}`;
			console.error(error);
		}
	}

	function saveDesign()
	{
		download(store.model.value.exportSerialized(), 'design.blueprint3d', 'text/plain');
	}

	function saveMesh()
	{
		download(store.model.value.exportMeshAsObj(), 'design.obj', 'text/plain');
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
				download(event.gltf, 'design.gltf', 'model/gltf+json');
				resolve(event.gltf);
			}

			three.addEventListener(EVENT_GLTF_READY, onReady);
			three.exportForBlender();
		}).catch(function (error)
		{
			lastError.value = error.message;
			console.error(error);
			throw error;
		});
	}

	return {busy, lastError, newDesign, openDesign, saveDesign, saveMesh, saveGLTF};
}
