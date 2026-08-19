/**
 * A fake WebGLRenderer for the headless suites.
 *
 * `Main.setRendererFactory` (S0's enabling seam) lets the 3D view be built and
 * torn down under jsdom, where there is no WebGL context to get. This is the
 * renderer it hands out.
 *
 * Everything Main touches is here and nothing else, on purpose: if Main grows a
 * new renderer call, the tests throw rather than quietly passing against a
 * permissive mock.
 *
 * Extracted in S6 so the viewer-lifecycle suite and the Vue application suites
 * assert against the same fake. Two copies would drift, and a drifting fake is
 * worse than none - it makes a passing test mean less than it looks.
 */

/**
 * @param {Array<Object>} [collector] Push each renderer here, so a test can
 * check that every one handed out was disposed.
 * @returns {Object}
 */
export function createRendererStub(collector)
{
	const renderer = {
		domElement: document.createElement('canvas'),
		shadowMap: {enabled: false, type: null},
		clippingPlanes: [],
		localClippingEnabled: false,
		disposed: false,
		contextLost: false,
		animationLoop: undefined,
		size: null,
		pixelRatio: 1,
		renderCount: 0,
		setClearColor() {},
		setSize(width, height) {this.size = {width, height};},
		setPixelRatio(ratio) {this.pixelRatio = ratio;},
		setAnimationLoop(fn) {this.animationLoop = fn;},
		render() {this.renderCount++;},
		dispose() {this.disposed = true;},
		forceContextLoss() {this.contextLost = true;},
	};
	if (collector)
	{
		collector.push(renderer);
	}
	return renderer;
}
