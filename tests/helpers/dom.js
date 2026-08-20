/**
 * DOM harness for the sprint-S2 tests (jsdom environment only).
 *
 * jsdom gives us elements and events but no layout engine, no 2D canvas context
 * and no ResizeObserver. Everything the 2D floorplanner touches in those three
 * areas is stubbed here, deliberately thin: the stubs record what the library
 * asked for so a test can assert on it, and nothing more.
 */

/** Every context call, in order, so a test can assert on what was drawn. */
export function createContext2DStub()
{
	const calls = [];
	const record = (name) => (...args) => {calls.push({name, args});};

	const context = {
		calls,
		// state
		font: '',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 1,
		textBaseline: '',
		textAlign: '',
		globalAlpha: 1,
		// geometry
		setTransform: record('setTransform'),
		translate: record('translate'),
		scale: record('scale'),
		rotate: record('rotate'),
		save: record('save'),
		restore: record('restore'),
		setLineDash: record('setLineDash'),
		measureText: (text) => ({width: String(text).length * 6}),
		// drawing
		clearRect: record('clearRect'),
		fillRect: record('fillRect'),
		beginPath: record('beginPath'),
		closePath: record('closePath'),
		moveTo: record('moveTo'),
		lineTo: record('lineTo'),
		arc: record('arc'),
		bezierCurveTo: record('bezierCurveTo'),
		stroke: record('stroke'),
		fill: record('fill'),
		fillText: record('fillText'),
		strokeText: record('strokeText'),
		drawImage: record('drawImage'),
		// RM-011 H3: the panorama paints its projected pixels through a 2D canvas
		// on the way to a PNG. `putImageData` records, like every other call here,
		// and `createImageData` hands back the buffer the caller then fills.
		createImageData: (width, height) => ({
			width, height, data: new Uint8ClampedArray(width * height * 4),
		}),
		putImageData: record('putImageData'),
	};

	// Style is set immediately before the call that consumes it, so snapshot it
	// with every fill/stroke - that is how a test tells the red debug dot from
	// the origin cross-hair.
	['fill', 'stroke', 'fillRect', 'arc'].forEach((name) =>
	{
		context[name] = (...args) =>
		{
			calls.push({name, args, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle});
		};
	});

	return context;
}

/**
 * Make every canvas in the document hand out the same recording context.
 *
 * @returns {{context: Object, restore: Function}}
 */
export function installCanvas2D(window)
{
	const context = createContext2DStub();
	const original = window.HTMLCanvasElement.prototype.getContext;
	const originalDataUrl = window.HTMLCanvasElement.prototype.toDataURL;
	window.HTMLCanvasElement.prototype.getContext = function ()
	{
		return context;
	};
	// jsdom has no encoder either, and says so through the virtual console on
	// every call - which is thirteen lines of "Not implemented" in one suite once
	// something starts making thumbnails (RM-013 K1). `data:,` is exactly what
	// jsdom returns after logging, so this changes no behaviour: a caller that
	// checks what came back still finds nothing usable, which is the honest
	// answer under jsdom and the reason `captureThumbnail` returns null there.
	window.HTMLCanvasElement.prototype.toDataURL = function () {return 'data:,';};
	return {
		context,
		restore()
		{
			window.HTMLCanvasElement.prototype.getContext = original;
			window.HTMLCanvasElement.prototype.toDataURL = originalDataUrl;
		},
	};
}

/**
 * jsdom implements pointer events but neither pointer capture nor pointer lock.
 *
 * three calls into both: OrbitControls takes pointer capture on pointerdown,
 * and PointerLockControls calls exitPointerLock on unlock - which Main does at
 * boot, when it puts the viewer into orbit mode. Neither exists in jsdom, so
 * both throw from inside the addon and take an unrelated test down with them.
 *
 * Nothing here depends on the semantics, only on the calls existing, so these
 * are no-ops. Real browsers have shipped both for years; the guards belong in
 * the harness rather than in the library.
 */
export function installPointerApis(window)
{
	const element = window.Element.prototype;
	const elementOriginals = {
		setPointerCapture: element.setPointerCapture,
		releasePointerCapture: element.releasePointerCapture,
		hasPointerCapture: element.hasPointerCapture,
		requestPointerLock: element.requestPointerLock,
		requestFullscreen: element.requestFullscreen,
	};

	element.setPointerCapture = function () {};
	element.releasePointerCapture = function () {};
	element.hasPointerCapture = function () {return false;};
	element.requestPointerLock = function () {};
	element.requestFullscreen = function () {return Promise.resolve();};

	const documentOriginal = window.document.exitPointerLock;
	window.document.exitPointerLock = function () {};

	return {
		restore()
		{
			Object.entries(elementOriginals).forEach(([name, fn]) =>
			{
				if (fn) { element[name] = fn; }
				else { delete element[name]; }
			});
			if (documentOriginal) { window.document.exitPointerLock = documentOriginal; }
			else { delete window.document.exitPointerLock; }
		},
	};
}

/**
 * A ResizeObserver that never fires on its own - tests drive it by hand.
 *
 * @returns {{instances: Array, trigger: Function, liveCount: Function, restore: Function}}
 */
/**
 * jsdom has no `IntersectionObserver`, and Reka's popovers need one.
 *
 * Added by RM-014 L2, which is the first suite to mount a `PopoverRoot` under
 * jsdom: Floating UI's auto-update watches the anchor with one, and without it
 * the component throws on mount rather than degrading. Nothing here is
 * asserted on - the observer never fires, which is the honest behaviour for a
 * layout engine that never lays anything out.
 *
 * @param {*} window
 * @returns {{restore: Function}}
 */
export function installIntersectionObserver(window)
{
	const original = window.IntersectionObserver;

	class TestIntersectionObserver
	{
		constructor(callback) {this.callback = callback;}
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {return [];}
	}

	window.IntersectionObserver = TestIntersectionObserver;
	globalThis.IntersectionObserver = TestIntersectionObserver;

	return {
		restore()
		{
			window.IntersectionObserver = original;
			globalThis.IntersectionObserver = original;
		},
	};
}

export function installResizeObserver(window)
{
	const original = window.ResizeObserver;
	const instances = [];

	class TestResizeObserver
	{
		constructor(callback)
		{
			this.callback = callback;
			this.targets = [];
			this.disconnected = false;
			instances.push(this);
		}
		observe(target)
		{
			this.targets.push(target);
		}
		unobserve(target)
		{
			this.targets = this.targets.filter((t) => t !== target);
		}
		disconnect()
		{
			this.disconnected = true;
			this.targets = [];
		}
	}

	window.ResizeObserver = TestResizeObserver;
	globalThis.ResizeObserver = TestResizeObserver;

	return {
		instances,
		/** Fire every live observer, the way the browser would after a reflow. */
		trigger()
		{
			instances.filter((o) => !o.disconnected).forEach((o) => o.callback([], o));
		},
		liveCount()
		{
			return instances.filter((o) => !o.disconnected).length;
		},
		restore()
		{
			window.ResizeObserver = original;
			globalThis.ResizeObserver = original;
		},
	};
}

/**
 * A frame clock that never advances on its own - tests drive it by hand.
 *
 * jsdom does supply requestAnimationFrame (vitest's environment runs it with
 * pretendToBeVisual), but it fires off a ~16 ms timer, which makes any test of
 * P6's coalescing a race: "did the frame not run yet, or did it run and draw
 * nothing?" are the same observation. This replaces it with a queue, so
 * `pending()` is the exact number of frames outstanding and `tick()` runs
 * exactly one round of them.
 *
 * One round, not a drain: a callback that schedules another frame is the shape
 * of a coalescing bug - a draw that dirties the view it just drew - and a
 * draining tick would loop forever instead of reporting it.
 *
 * @returns {{tick: Function, pending: Function, cancelled: Function, restore: Function}}
 */
export function installFrameClock(window)
{
	const originalRequest = window.requestAnimationFrame;
	const originalCancel = window.cancelAnimationFrame;

	let nextHandle = 1;
	const queue = new Map();
	let cancelled = 0;

	window.requestAnimationFrame = function (callback)
	{
		const handle = nextHandle++;
		queue.set(handle, callback);
		return handle;
	};
	window.cancelAnimationFrame = function (handle)
	{
		if (queue.delete(handle))
		{
			cancelled += 1;
		}
	};

	return {
		/** Run the frames outstanding right now, once, in order. */
		tick(time = 0)
		{
			const round = [...queue.entries()];
			round.forEach(([handle]) => queue.delete(handle));
			round.forEach(([, callback]) => callback(time));
			return round.length;
		},
		pending()
		{
			return queue.size;
		},
		/** How many scheduled frames were cancelled rather than run. */
		cancelled()
		{
			return cancelled;
		},
		restore()
		{
			window.requestAnimationFrame = originalRequest;
			window.cancelAnimationFrame = originalCancel;
		},
	};
}

/**
 * jsdom performs no layout, so clientWidth/clientHeight are always 0 and
 * getBoundingClientRect() is all zeros. Give an element a size and a position
 * the way a real browser would have measured it.
 */
export function setLayout(element, {left = 0, top = 0, width = 0, height = 0} = {})
{
	Object.defineProperty(element, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(element, 'clientHeight', {value: height, configurable: true});
	element.getBoundingClientRect = () => ({
		left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
	});
}

/**
 * Count listeners per target, the only reliable way to prove a dispose() really
 * detached everything: jsdom keeps no public registry.
 *
 * `net(target)` is adds minus removes. A clean mount/unmount cycle nets zero on
 * every target it ever touched.
 */
export function installListenerCounter(window)
{
	const counts = new Map();
	const bump = (target, type, delta) =>
	{
		if (!counts.has(target))
		{
			counts.set(target, new Map());
		}
		const perType = counts.get(target);
		perType.set(type, (perType.get(type) || 0) + delta);
	};

	/**
	 * Which (target, type, listener) triples are actually attached.
	 *
	 * Counting raw calls is not enough: removeEventListener for something that
	 * was never added is a legitimate no-op in the DOM, and library teardown
	 * does it routinely - three's OrbitControls.disconnect() unconditionally
	 * removes pointermove, pointerup and pointercancel, which it only attaches
	 * once a drag has started. Counting those pushed the net negative and made
	 * a clean teardown look like it had over-removed.
	 */
	const live = new Map();
	// The DOM matches a removal on type, callback and the capture flag alone.
	const slotFor = (type, options) =>
		`${type}|${(typeof options === 'boolean') ? options : Boolean(options && options.capture)}`;

	const attach = (target, type, listener, options) =>
	{
		if (!live.has(target)) { live.set(target, new Map()); }
		const slots = live.get(target);
		const slot = slotFor(type, options);
		if (!slots.has(slot)) { slots.set(slot, new Set()); }
		const listeners = slots.get(slot);
		if (listeners.has(listener)) { return false; }
		listeners.add(listener);
		return true;
	};

	const detach = (target, type, listener, options) =>
	{
		const slots = live.get(target);
		const listeners = slots && slots.get(slotFor(type, options));
		return Boolean(listeners && listeners.delete(listener));
	};

	const proto = window.EventTarget.prototype;
	const originalAdd = proto.addEventListener;
	const originalRemove = proto.removeEventListener;

	proto.addEventListener = function (type, listener, options)
	{
		if (attach(this, type, listener, options)) { bump(this, type, 1); }
		return originalAdd.call(this, type, listener, options);
	};
	proto.removeEventListener = function (type, listener, options)
	{
		if (detach(this, type, listener, options)) { bump(this, type, -1); }
		return originalRemove.call(this, type, listener, options);
	};

	// jsdom hangs addEventListener straight off the Window instance rather than
	// inheriting it, so patching EventTarget.prototype alone misses every window
	// listener - which is precisely the set this counter exists to catch.
	const windowAdd = Object.prototype.hasOwnProperty.call(window, 'addEventListener') ? window.addEventListener : null;
	const windowRemove = Object.prototype.hasOwnProperty.call(window, 'removeEventListener') ? window.removeEventListener : null;
	if (windowAdd)
	{
		window.addEventListener = function (type, listener, options)
		{
			if (attach(window, type, listener, options)) { bump(window, type, 1); }
			return windowAdd.call(window, type, listener, options);
		};
	}
	if (windowRemove)
	{
		window.removeEventListener = function (type, listener, options)
		{
			if (detach(window, type, listener, options)) { bump(window, type, -1); }
			return windowRemove.call(window, type, listener, options);
		};
	}

	return {
		/** Net listener count for one target, all types summed. */
		net(target)
		{
			const perType = counts.get(target);
			if (!perType)
			{
				return 0;
			}
			let total = 0;
			perType.forEach((n) => {total += n;});
			return total;
		},
		/** Net listener count for one target and one event type. */
		netFor(target, type)
		{
			const perType = counts.get(target);
			return perType ? (perType.get(type) || 0) : 0;
		},
		/** Every target that currently has a positive net count. */
		leaks()
		{
			const out = [];
			counts.forEach((perType, target) =>
			{
				perType.forEach((n, type) =>
				{
					if (n > 0)
					{
						out.push({target, type, count: n});
					}
				});
			});
			return out;
		},
		reset()
		{
			counts.clear();
		},
		restore()
		{
			proto.addEventListener = originalAdd;
			proto.removeEventListener = originalRemove;
			if (windowAdd)
			{
				window.addEventListener = windowAdd;
			}
			if (windowRemove)
			{
				window.removeEventListener = windowRemove;
			}
		},
	};
}

/**
 * The demo's DOM in miniature: a sized wrapper holding the floorplanner canvas.
 *
 * @returns {{container: HTMLElement, canvas: HTMLCanvasElement}}
 */
export function buildFloorplannerDom(window, {left = 0, top = 0, width = 1000, height = 800} = {})
{
	const document = window.document;
	const container = document.createElement('div');
	container.id = 'floorplanner';
	const canvas = document.createElement('canvas');
	canvas.id = 'floorplanner-canvas';
	container.appendChild(canvas);
	document.body.appendChild(container);

	setLayout(container, {left, top, width, height});
	// The library sets the canvas' CSS size itself; give it the same box so the
	// pointer maths has a rect to work from.
	setLayout(canvas, {left, top, width, height});

	return {container, canvas};
}

/**
 * A `matchMedia` that answers whatever the test says, and can change its mind.
 *
 * jsdom ships no `matchMedia` at all, so anything reading a media preference
 * gets the "cannot be asked" branch by default - which is the right default for
 * the library and useless for testing the other branch. This installs one that
 * matches a given set of query strings, and `set()` flips a query and notifies
 * every listener, which is how a person changing a system setting with the tab
 * already open reaches the application (RM-014 L4, finding Z-6).
 *
 * @param {Window} window
 * @param {Object<string, boolean>} [initial] Query string to whether it matches.
 */
export function installMatchMedia(window, initial = {})
{
	const state = new Map(Object.entries(initial));
	/** @type {Map<string, Set<function(Object): void>>} */
	const listeners = new Map();
	const had = Object.prototype.hasOwnProperty.call(window, 'matchMedia');
	const original = window.matchMedia;

	function listenersFor(query)
	{
		if (!listeners.has(query)) { listeners.set(query, new Set()); }
		return listeners.get(query);
	}

	window.matchMedia = function (query)
	{
		return {
			media: query,
			get matches() {return Boolean(state.get(query));},
			addEventListener: (type, handler) => {if (type === 'change') { listenersFor(query).add(handler); }},
			removeEventListener: (type, handler) => {if (type === 'change') { listenersFor(query).delete(handler); }},
			// The pre-Safari-14 spelling, which watchReducedMotion falls back to.
			addListener: (handler) => listenersFor(query).add(handler),
			removeListener: (handler) => listenersFor(query).delete(handler),
			dispatchEvent: () => true,
			onchange: null,
		};
	};

	return {
		/** Flip a query and tell everyone listening to it. */
		set(query, matches)
		{
			state.set(query, matches);
			listenersFor(query).forEach((handler) => handler({matches: matches, media: query}));
		},
		/** How many listeners are attached to a query right now. */
		listenerCount(query) {return listenersFor(query).size;},
		restore()
		{
			if (had) { window.matchMedia = original; }
			else { delete window.matchMedia; }
		},
	};
}
