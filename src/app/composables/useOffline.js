// @ts-check
import {onScopeDispose, ref} from 'vue';

/**
 * Offline, and the offer to install (RM-013 K3).
 *
 * ## What is already offline, and what this adds
 *
 * The data has been offline since RM-003 A5 and RM-013 K1: the draft is in
 * IndexedDB and so is the library, and neither has ever touched a network. What
 * was not offline is the **shell** - the document, the bundle, the models and
 * the textures - which is why the sprint is a service-worker sprint rather than
 * a storage one, and why every decision it makes is about caching rather than
 * about designs.
 *
 * ## Registered in production only, and after load
 *
 * In development the dev server has no `sw.js` to register and a worker that
 * did register would serve yesterday's modules over today's edits. After the
 * `load` event because registration competes with the first paint for the same
 * connection, and there is nothing a worker can do for a visit it is racing.
 *
 * ## An update is offered, never applied
 *
 * A new worker takes over on the next navigation by itself. What this adds is a
 * *notice*, because the alternative is a person who reloads at some unrelated
 * moment and finds the interface has changed under them. `applyUpdate()`
 * reloads on request; nothing here reloads on its own, which is the same
 * distinction `useAutosave` draws about a recovered draft: an offer rather than
 * a restore.
 */

/** Where the worker is served from, relative to the document. */
export const WORKER_URL = 'sw.js';

/**
 * @param {Object} [options]
 * @param {boolean} [options.enabled] Whether to register at all. Defaults to
 *        `import.meta.env.PROD`; passed explicitly by the suite, which has no
 *        worker to register and is not testing Vite.
 * @param {*} [options.container] A `ServiceWorkerContainer`. Defaults to
 *        `navigator.serviceWorker`.
 * @param {*} [options.target] What to listen on for `beforeinstallprompt`.
 */
export function useOffline(options)
{
	var settings = options || {};
	var container = settings.container !== undefined
		? settings.container
		: (typeof navigator !== 'undefined' ? navigator.serviceWorker : null);
	var target = settings.target
		|| (typeof window !== 'undefined' ? window : null);
	var enabled = settings.enabled !== undefined
		? settings.enabled
		: Boolean(import.meta.env && import.meta.env.PROD);

	/** Whether a worker is controlling this page, so the app really is offline-ready. */
	var ready = ref(false);
	/** A newer build is installed and waiting. */
	var updateReady = ref(false);
	/** Whether the browser has offered an install, and we have kept the offer. */
	var installable = ref(false);
	/** Set once installed, or once the offer is used. */
	var installed = ref(false);
	/** Whether the browser thinks it has a network. */
	var online = ref(typeof navigator === 'undefined' ? true : navigator.onLine !== false);

	/**
	 * The deferred `beforeinstallprompt` event.
	 *
	 * Kept rather than discarded, which is the whole mechanism: the event's
	 * default is the browser's own prompt, and `preventDefault()` on it buys the
	 * right to show the offer somewhere it fits and to call `prompt()` later.
	 * A browser will only honour that once.
	 *
	 * @type {*}
	 */
	var deferred = null;

	function onBeforeInstall(event)
	{
		event.preventDefault();
		deferred = event;
		installable.value = true;
	}

	function onInstalled()
	{
		deferred = null;
		installable.value = false;
		installed.value = true;
	}

	function onOnline() {online.value = true;}
	function onOffline() {online.value = false;}

	/**
	 * Watch one registration for a worker arriving behind the current one.
	 *
	 * @param {*} registration
	 */
	function watch(registration)
	{
		if (!registration)
		{
			return;
		}
		// Already waiting when we arrived: the page was open across an update.
		if (registration.waiting && container.controller)
		{
			updateReady.value = true;
		}
		registration.addEventListener('updatefound', function ()
		{
			var installing = registration.installing;
			if (!installing)
			{
				return;
			}
			installing.addEventListener('statechange', function ()
			{
				// `installed` with a controller already present means a *replacement*
				// rather than a first install - the difference between "this page is
				// now offline-capable" and "there is a newer one of these".
				if (installing.state === 'installed' && container.controller)
				{
					updateReady.value = true;
				}
			});
		});
	}

	/** @returns {Promise<void>} */
	async function register()
	{
		if (!enabled || !container || typeof container.register !== 'function')
		{
			return;
		}
		try
		{
			var registration = await container.register(WORKER_URL);
			watch(registration);
			ready.value = Boolean(container.controller);
			container.addEventListener('controllerchange', function () {ready.value = true;});
		}
		catch
		{
			// A refused registration is a page without offline support, which is the
			// page this application was until now. Nothing else changes, and saying
			// so in a toast would be reporting the absence of an improvement.
		}
	}

	/**
	 * Show the browser's install prompt.
	 *
	 * @returns {Promise<boolean>} Whether it was accepted.
	 */
	async function install()
	{
		if (!deferred)
		{
			return false;
		}
		var event = deferred;
		// Cleared first, and unconditionally: a `beforeinstallprompt` may be
		// prompted once, so an offer left on screen after a dismissal is a button
		// that silently does nothing the second time.
		deferred = null;
		installable.value = false;
		try
		{
			await event.prompt();
			var choice = await event.userChoice;
			installed.value = Boolean(choice && choice.outcome === 'accepted');
			return installed.value;
		}
		catch
		{
			return false;
		}
	}

	/** Take the newer build. A reload, because that is what a worker swap is. */
	function applyUpdate()
	{
		if (typeof window !== 'undefined')
		{
			window.location.reload();
		}
	}

	if (target && typeof target.addEventListener === 'function')
	{
		target.addEventListener('beforeinstallprompt', onBeforeInstall);
		target.addEventListener('appinstalled', onInstalled);
		target.addEventListener('online', onOnline);
		target.addEventListener('offline', onOffline);
	}

	onScopeDispose(function ()
	{
		if (target && typeof target.removeEventListener === 'function')
		{
			target.removeEventListener('beforeinstallprompt', onBeforeInstall);
			target.removeEventListener('appinstalled', onInstalled);
			target.removeEventListener('online', onOnline);
			target.removeEventListener('offline', onOffline);
		}
	});

	return {ready, updateReady, installable, installed, online, register, install, applyUpdate};
}
