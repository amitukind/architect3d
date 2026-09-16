// @ts-check
/**
 * Ambient occlusion, behind the profile switch (RM-011 H2).
 *
 * ## Why a composer at all
 *
 * RM-011 W-2 traversed the whole tree and found **not one `aoMap` anywhere**, on
 * any material, in either profile. There is nothing to switch on: baked ambient
 * occlusion is a texture per surface and this library has none and cannot make
 * them. The only occlusion available is screen-space, computed from the depth
 * and normal buffers after the scene is drawn, which needs a post-processing
 * chain - and `Main` has never had one. So this file is new construction rather
 * than a setting, which is what the drawing priced.
 *
 * `GTAOPass` is three's own, and ground-truth ambient occlusion is the modern
 * form of the effect: it integrates visibility over the hemisphere rather than
 * sampling a fixed kernel, which is what stops a corner from looking like a
 * smudge. Using three's rather than writing one keeps this file to the wiring.
 *
 * ## Studio only, and off by default even there
 *
 * The same argument H1 made for its maps and lamps make for their bulbs: under
 * `classic` every wall is an unlit `MeshBasicMaterial`, and multiplying an unlit
 * surface by an occlusion term is not lighting, it is a grey stain. The profile
 * decides, and `classic`'s answer is no.
 *
 * Under `studio` it is **available and off**, and that is a measurement rather
 * than caution - see `render_profile.js` for the number. A full-screen AO pass is
 * the most expensive thing this renderer can be asked to do and M-28's correction
 * exists precisely so an effect states its cost rather than being switched on
 * because it looks nice.
 *
 * ## What the composer costs when it is not doing anything
 *
 * Nothing, and the four imports are **dynamic** for that reason. They were
 * static in the first draft and the first-load budget H1 added caught it on its
 * second sprint: `EffectComposer`, `RenderPass`, `GTAOPass` and `OutputPass`
 * are 10.6 KB gzipped that every build shipped for an effect no default turns
 * on. M-43's rule is that nothing unpicked is downloaded, and a post-processing
 * chain nobody asked for is exactly that.
 *
 * So this function is asynchronous, and `Main.render` calls `renderer.render`
 * exactly as it always did until the chunk lands. A build that never enables AO
 * never fetches it; one that does renders a frame or two without occlusion
 * first, which is the right trade for 10 KB on every boot.
 */

/**
 * @typedef {Object} PostProcessing
 * @property {any} composer An `EffectComposer`, typed loosely: the module is
 *   loaded on demand and naming its type would import it eagerly again.
 * @property {any} ao A `GTAOPass`, for the same reason.
 * @property {function(import('three').Camera): void} setCamera
 * @property {function(number, number): void} setSize
 * @property {function(): void} dispose
 */

/**
 * A composer with an AO pass, or null when this profile does not want one.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {Object} profile A render profile.
 * @param {{width: number, height: number}} size
 * @returns {Promise<?PostProcessing>}
 */
export async function createPostProcessing(renderer, scene, camera, profile, size)
{
	if (!profile || !profile.ambientOcclusion)
	{
		return null;
	}

	// Four modules, one await, and nothing fetched by a build that never asks.
	var [{EffectComposer}, {RenderPass}, {GTAOPass}, {OutputPass}] = await Promise.all([
		import('three/addons/postprocessing/EffectComposer.js'),
		import('three/addons/postprocessing/RenderPass.js'),
		import('three/addons/postprocessing/GTAOPass.js'),
		import('three/addons/postprocessing/OutputPass.js'),
	]);

	var width = Math.max(1, size.width);
	var height = Math.max(1, size.height);
	var composer = new EffectComposer(renderer);
	composer.setSize(width, height);

	var renderPass = new RenderPass(scene, camera);
	var ao = new GTAOPass(scene, camera, width, height);
	// Centimetres, like everything else in this model. The default is tuned for a
	// scene measured in metres, and at that radius every corner of a 400 cm room
	// is inside the sample kernel - which reads as a uniform grey rather than as
	// contact shadow.
	ao.updateGtaoMaterial({
		radius: profile.ambientOcclusionRadius,
		distanceExponent: 1,
		thickness: profile.ambientOcclusionRadius,
		scale: profile.ambientOcclusionStrength,
	});
	// The tone mapping and the colour space conversion, which `renderer.render`
	// applies for free and a composer does not: without this the chain ends in a
	// linear buffer written to an sRGB canvas and the whole picture is far too
	// bright. Same trap S8 recorded for the texture path, one layer up.
	var output = new OutputPass();

	composer.addPass(renderPass);
	composer.addPass(ao);
	composer.addPass(output);

	return {
		composer: composer,
		ao: ao,
		/**
		 * Point the chain at a different camera.
		 *
		 * Three of them exist - orthographic, perspective and the walkthrough - and
		 * `Main` swaps between them without rebuilding anything. Both passes hold
		 * their own reference, so both are told.
		 */
		setCamera: function (next)
		{
			renderPass.camera = next;
			ao.camera = next;
		},
		setSize: function (nextWidth, nextHeight)
		{
			composer.setSize(Math.max(1, nextWidth), Math.max(1, nextHeight));
			ao.setSize(Math.max(1, nextWidth), Math.max(1, nextHeight));
		},
		dispose: function ()
		{
			// Three render targets in the AO pass and two in the composer, none of
			// which the scene graph knows about - so nothing else would ever free
			// them. A0's rule, applied to the one part of the renderer that owns
			// GPU memory without owning an object.
			ao.dispose();
			composer.dispose();
		},
	};
}
