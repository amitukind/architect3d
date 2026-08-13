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
	window.HTMLCanvasElement.prototype.getContext = function ()
	{
		return context;
	};
	return {
		context,
		restore()
		{
			window.HTMLCanvasElement.prototype.getContext = original;
		},
	};
}

/**
 * A ResizeObserver that never fires on its own - tests drive it by hand.
 *
 * @returns {{observed: Array, trigger: Function, restore: Function}}
 */
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

	const proto = window.EventTarget.prototype;
	const originalAdd = proto.addEventListener;
	const originalRemove = proto.removeEventListener;

	proto.addEventListener = function (type, listener, options)
	{
		bump(this, type, 1);
		return originalAdd.call(this, type, listener, options);
	};
	proto.removeEventListener = function (type, listener, options)
	{
		bump(this, type, -1);
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
			bump(window, type, 1);
			return windowAdd.call(window, type, listener, options);
		};
	}
	if (windowRemove)
	{
		window.removeEventListener = function (type, listener, options)
		{
			bump(window, type, -1);
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
