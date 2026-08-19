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
	const canvas = document.createElement('canvas');
	// jsdom's canvas has no 2D or WebGL backend, so `toDataURL` returns the
	// one-pixel placeholder rather than a picture. That is enough for the photo
	// capture's own logic - the guards, the clamp and the restore - and what the
	// picture looks like is `tests/browser/photo.test.js`.
	canvas.toDataURL = function () {return 'data:image/png;base64,' + 'A'.repeat(64 * this.width);};
	const renderer = {
		domElement: canvas,
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
		getPixelRatio() {return this.pixelRatio;},
		// RM-011 H2's photo capture asks the GPU for its own ceiling before
		// enlarging the drawing buffer, because exceeding it does not throw - it
		// produces a buffer the driver silently declines to allocate.
		capabilities: {maxTextureSize: 4096},
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
