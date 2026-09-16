// @vitest-environment jsdom
/**
 * Registration, updates and the install offer (RM-013 K3).
 *
 * The worker cannot run here and the browser will not offer an install to a
 * test, so both are faked - and neither is the subject. What is under test is
 * what the application does with them: that it registers only where a worker
 * exists, that it can tell a first install from a replacement, and that an
 * offer the browser will honour exactly once is only used once.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {effectScope, nextTick} from 'vue';

import {useOffline, WORKER_URL} from '../src/app/composables/useOffline.js';

/** A `ServiceWorker` that can be moved through its states. */
function fakeWorker()
{
	const listeners = {};
	return {
		state: 'installing',
		addEventListener(name, fn) {(listeners[name] = listeners[name] || []).push(fn);},
		emit(name) {(listeners[name] || []).forEach((fn) => fn());},
		become(state) {this.state = state; this.emit('statechange');},
	};
}

/** A `ServiceWorkerRegistration`. */
function fakeRegistration(seed)
{
	const listeners = {};
	return Object.assign({
		installing: null,
		waiting: null,
		addEventListener(name, fn) {(listeners[name] = listeners[name] || []).push(fn);},
		emit(name) {(listeners[name] || []).forEach((fn) => fn());},
	}, seed || {});
}

/** A `ServiceWorkerContainer`. */
function fakeContainer(seed)
{
	const listeners = {};
	const registration = (seed && seed.registration) || fakeRegistration();
	return Object.assign({
		controller: null,
		registration,
		registered: [],
		register: vi.fn(async function (url) {this.registered.push(url); return registration;}),
		addEventListener(name, fn) {(listeners[name] = listeners[name] || []).push(fn);},
		emit(name) {(listeners[name] || []).forEach((fn) => fn());},
	}, seed || {});
}

let scope;

function run(fn)
{
	let value;
	scope.run(() => {value = fn();});
	return value;
}

beforeEach(() =>
{
	scope = effectScope();
});

afterEach(() =>
{
	scope.stop();
});

describe('registration', () =>
{
	it('registers the worker at the relative URL', async () =>
	{
		const container = fakeContainer();
		const offline = run(() => useOffline({enabled: true, container, target: window}));

		await offline.register();

		// Relative, so it resolves under /architect3d/ on Pages and at the root
		// anywhere else - and its directory is its scope.
		expect(container.registered).toEqual([WORKER_URL]);
		expect(WORKER_URL).not.toMatch(/^\//);
	});

	it('does nothing in development, where there is no worker to register', async () =>
	{
		const container = fakeContainer();
		const offline = run(() => useOffline({enabled: false, container, target: window}));

		await offline.register();

		expect(container.register).not.toHaveBeenCalled();
		expect(offline.ready.value).toBe(false);
	});

	it('does nothing in a browser with no service workers at all', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));

		await offline.register();

		expect(offline.ready.value).toBe(false);
	});

	/**
	 * A refused registration leaves the page exactly as it was before this
	 * sprint. Offline support is an improvement over a baseline that works, and
	 * reporting its absence would be reporting the absence of an improvement.
	 */
	it('survives a browser that refuses', async () =>
	{
		const container = fakeContainer({register: vi.fn(async () => {throw new Error('insecure context');})});
		const offline = run(() => useOffline({enabled: true, container, target: window}));

		await offline.register();

		expect(offline.ready.value).toBe(false);
	});

	it('is ready once a worker is controlling the page', async () =>
	{
		const container = fakeContainer({controller: {}});
		const offline = run(() => useOffline({enabled: true, container, target: window}));

		await offline.register();

		expect(offline.ready.value).toBe(true);
	});

	it('becomes ready when one takes over mid-session', async () =>
	{
		const container = fakeContainer();
		const offline = run(() => useOffline({enabled: true, container, target: window}));
		await offline.register();
		expect(offline.ready.value).toBe(false);

		container.emit('controllerchange');

		expect(offline.ready.value).toBe(true);
	});
});

describe('telling a first install from a replacement', () =>
{
	it('does not call the first worker an update', async () =>
	{
		const installing = fakeWorker();
		const registration = fakeRegistration({installing});
		const container = fakeContainer({registration, controller: null});
		const offline = run(() => useOffline({enabled: true, container, target: window}));
		await offline.register();

		registration.emit('updatefound');
		installing.become('installed');

		// No controller when it installed, so this page had none before: that is
		// "you are now offline-capable", not "there is a newer one of these".
		expect(offline.updateReady.value).toBe(false);
	});

	it('offers an update when one arrives behind the worker in charge', async () =>
	{
		const installing = fakeWorker();
		const registration = fakeRegistration({installing});
		const container = fakeContainer({registration, controller: {}});
		const offline = run(() => useOffline({enabled: true, container, target: window}));
		await offline.register();

		registration.emit('updatefound');
		installing.become('installed');

		expect(offline.updateReady.value).toBe(true);
	});

	it('notices one that was already waiting when the page opened', async () =>
	{
		const registration = fakeRegistration({waiting: fakeWorker()});
		const container = fakeContainer({registration, controller: {}});
		const offline = run(() => useOffline({enabled: true, container, target: window}));

		await offline.register();

		expect(offline.updateReady.value).toBe(true);
	});

	it('ignores a worker that is installing and has not landed', async () =>
	{
		const installing = fakeWorker();
		const registration = fakeRegistration({installing});
		const container = fakeContainer({registration, controller: {}});
		const offline = run(() => useOffline({enabled: true, container, target: window}));
		await offline.register();

		registration.emit('updatefound');
		installing.become('installing');

		expect(offline.updateReady.value).toBe(false);
	});
});

describe('the install offer', () =>
{
	/** The browser's event, which must be prevented to be kept. */
	function promptEvent(outcome)
	{
		return {
			preventDefault: vi.fn(),
			prompt: vi.fn(async () => undefined),
			userChoice: Promise.resolve({outcome}),
		};
	}

	it('keeps the browser s offer instead of letting it fire', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));
		const event = promptEvent('accepted');

		window.dispatchEvent(Object.assign(new window.Event('beforeinstallprompt'), event));
		await nextTick();

		// `preventDefault` is the whole mechanism: it buys the right to show the
		// offer where it fits and to prompt later.
		expect(event.preventDefault).toHaveBeenCalled();
		expect(offline.installable.value).toBe(true);
	});

	it('prompts once, and takes the offer away whatever the answer', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));
		const event = promptEvent('dismissed');
		window.dispatchEvent(Object.assign(new window.Event('beforeinstallprompt'), event));
		await nextTick();

		expect(await offline.install()).toBe(false);

		// A browser honours a deferred prompt exactly once, so an offer left on
		// screen after a dismissal is a button that silently does nothing.
		expect(offline.installable.value).toBe(false);
		expect(await offline.install()).toBe(false);
		expect(event.prompt).toHaveBeenCalledTimes(1);
	});

	it('reports an accepted install', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));
		window.dispatchEvent(Object.assign(new window.Event('beforeinstallprompt'), promptEvent('accepted')));
		await nextTick();

		expect(await offline.install()).toBe(true);
		expect(offline.installed.value).toBe(true);
	});

	it('withdraws the offer once the browser says it is installed', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));
		window.dispatchEvent(Object.assign(new window.Event('beforeinstallprompt'), promptEvent('accepted')));
		await nextTick();

		window.dispatchEvent(new window.Event('appinstalled'));

		expect(offline.installable.value).toBe(false);
		expect(offline.installed.value).toBe(true);
		expect(await offline.install()).toBe(false);
	});

	it('offers nothing when the browser never asked', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));

		expect(offline.installable.value).toBe(false);
		expect(await offline.install()).toBe(false);
	});
});

describe('the network', () =>
{
	it('follows the browser s own opinion of it', async () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));

		window.dispatchEvent(new window.Event('offline'));
		expect(offline.online.value).toBe(false);

		window.dispatchEvent(new window.Event('online'));
		expect(offline.online.value).toBe(true);
	});

	it('stops listening when the scope ends', () =>
	{
		const offline = run(() => useOffline({enabled: true, container: null, target: window}));

		scope.stop();
		window.dispatchEvent(new window.Event('offline'));

		expect(offline.online.value).toBe(true);
	});
});
