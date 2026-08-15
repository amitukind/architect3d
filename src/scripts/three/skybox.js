import {EventDispatcher, PlaneGeometry, SphereGeometry, MeshBasicMaterial, ShaderMaterial, Mesh, TextureLoader, Color, DoubleSide, SRGBColorSpace} from 'three';
import {RepeatWrapping, Fog} from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {formatSupport} from '../core/texture_formats.js';
import {renderProfile, isStudio} from '../core/render_profile.js';

/**
 * The two textures this module owns, named rather than written at the call
 * (RM-005 C1 · J-2).
 *
 * Both were string literals passed straight to `TextureLoader.load()`, which
 * made them the only two textures in the viewer that never went through
 * `AssetResolver` - `Floor` and `Edge` resolve every one of theirs. That
 * indirection is the whole of RM-003 A5: a logical name in a document, a
 * physical URL at runtime. It is also the mechanism a RETIREMENT runs on, which
 * is what made this a blocker rather than a tidy-up. `rooms/textures/hardwood.png`
 * is not on disk and every design naming it still opens, because the manifest
 * points the old name at the new file and `Floor` asks. Nothing asked for these.
 *
 * It cost nothing until now because B4 downscaled in place - a name that does
 * not move needs no reference rewriting - so both files were rewritten under
 * these literals and the bypass never showed. C1 encodes them to KTX2, which
 * moves the names, and a bypass is invisible right up to the change that needs it.
 *
 * Constants beside the class rather than inline, matching `LIGHT_MAP_URL` in
 * `edge.js`, so `tests/asset-integrity.test.js` can assert there are no others.
 */
const GROUND_URL = 'rooms/textures/Ground_4K.ktx2';
const ENVIRONMENT_URL = 'rooms/textures/envs/Garden.jpg';

/**
 * Whether the ground plane gets the mirror-blend reflector.
 *
 * Off since S4, and the flag exists so the decision is visible rather than
 * implied by a deleted import. The reflector came from `three-reflector2`,
 * which does `import {Math} from 'three'` - an alias removed in r113 - so it
 * cannot even be parsed against r185; it had to go for the build to succeed.
 *
 * S5 settled it: the static ground stays, and the flag stays false.
 *
 * The parity grid (`npm run parity`) made the choice easy by showing exactly
 * what was lost. The reflector *replaced* this material with a shader blending
 * two ground textures at wrap 40x40 and 50x50 over a mirror pass at intensity
 * 0.1 and blend 0.05. Almost all of the visible difference turned out to be the
 * tiling frequency, not the mirror - the reflection was barely perceptible at
 * those intensities, and a mirror-polished floor is a strange default for a
 * room-planning tool anyway. Matching the tiling (`repeat.set(40, 40)` below)
 * recovers the look; a second render target per frame recovers very little
 * else.
 *
 * Left as an exported constant rather than deleted so the decision stays
 * legible and reversible. Turning it back on means building on three's addons
 * `Reflector` - the old package cannot be revived, it imports the `Math` alias
 * removed in r113.
 */
export const GROUND_REFLECTOR_ENABLED = false;

export class Skybox extends EventDispatcher
{
	constructor(scene, renderer, profile)
	{
		super();
	/**
	 * The look this object draws with (RM-002 R-02, P7). Falls back to the shared
	 * profile, which is what every construction site did before and what the
	 * parity grid still measures.
	 */
		this.renderProfile = profile || renderProfile;
		
		// The logical name, not a URL. `setEnvironmentMap` resolves it, so an
		// embedder may still set this to a name of their own and have the manifest
		// apply to it - which is the behaviour it should always have had.
		this.defaultEnvironment = ENVIRONMENT_URL;
		this.useEnvironment = false;
		this.topColor = this.renderProfile.skyTopColor;//0xe9e9e9; //0xf9f9f9;//0x565e63
		this.bottomColor = this.renderProfile.skyBottomColor;//0xD8ECF9
		this.verticalOffset = 400;
		this.exponent = 0.5;
		
		var uniforms = {topColor: {type: 'c',value: new Color(this.topColor)},bottomColor: {type: 'c',value: new Color(this.bottomColor)},offset: {type: 'f',value: this.verticalOffset}, exponent: {type:'f', value: this.exponent}};
		
		this.scene = scene;
		this.renderer = renderer;
		
		this.sphereRadius = 4000;
		this.widthSegments = 32;
		this.heightSegments = 15;
		this.sky = null;
		/** The ground photograph, held so dispose() can release it (RM-003 A0). */
		this.groundTex = null;

		this.plainVertexShader = ['varying vec3 vWorldPosition;','void main() {','vec4 worldPosition = modelMatrix * vec4( position, 1.0 );','vWorldPosition = worldPosition.xyz;','gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0 );','}'].join('\n');
		// --- Why these two shaders carry an explicit encode ---------------------
		//
		// A ShaderMaterial writes gl_FragColor itself, so it opts out of the one
		// thing three does to every built-in material on the way out: the
		// conversion into the renderer's output colour space. Every stock
		// material ends its fragment shader with `#include <colorspace_fragment>`,
		// which is one line - `gl_FragColor = linearToOutputTexel( gl_FragColor )`
		// (ShaderChunk/colorspace_fragment.glsl.js) - and a raw shader that omits
		// it is simply not in the pipeline.
		//
		// While the S4 freeze held, the omission was invisible: with
		// outputColorSpace = Linear the function is the identity. S8 makes it
		// real. Without these includes the sky would be the only surface in the
		// scene still writing linear values into an sRGB frame, and the default
		// gradient would drop from (146,178,206) to (73,114,157) - a much darker,
		// bluer sky against correctly-encoded walls.
		//
		// The include must be its own array element: WebGLProgram's include
		// pattern is line-anchored (`/^[ \t]*#include +<([\w\d./]+)>/gm`,
		// WebGLProgram.js:243) and it is `.join('\n')` below that supplies the
		// newline. Appending it to the previous string would leave the directive
		// mid-line and it would never be substituted - and, because an
		// unrecognised `#include` is left in place rather than reported, the
		// failure would be a shader compile error at runtime, not a build error.
		//
		// Added in S8 ahead of the colour flip, deliberately: before the flip
		// they expand to an identity and the parity grid is pixel-identical,
		// which is what proves the includes resolved at all.
		this.plainFragmentShader = ['uniform vec3 bottomColor;','uniform vec3 topColor;','uniform float offset;','uniform float exponent;','varying vec3 vWorldPosition;','void main() {',' float h = normalize( vWorldPosition + offset ).y;',' gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max(h, 0.0 ), exponent ), 0.0 ) ), 1.0 );','#include <colorspace_fragment>','}'].join('\n');

		this.vertexShader = ['varying vec2 vUV;','void main() {','  vUV=uv;','  vec4 pos = vec4(position, 1.0);', '   gl_Position = projectionMatrix * modelViewMatrix * pos;','}'].join('\n');
		// `texture` and `sample` are both reserved words in GLSL ES 3.00, which is
		// what three emits for every material that is not a RawShaderMaterial
		// (WebGLProgram.js:801,805) - and `texture` shadows the built-in sampling
		// function besides. Renamed to envMap/texel; the shader is otherwise
		// unchanged. setEnvironmentMap() below builds the matching uniform, and
		// tags the texture sRGB so this shader receives linear values to encode.
		this.fragmentShader = ['uniform sampler2D envMap;', 'varying vec2 vUV;', 'void main() {  ', 'vec4 texel = texture2D(envMap, vUV);', 'gl_FragColor = vec4(texel.xyz, texel.w);', '#include <colorspace_fragment>' ,'}'].join('\n');
		
		this.texture = new TextureLoader();
		this.plainSkyMat = new ShaderMaterial({vertexShader: this.plainVertexShader,fragmentShader: this.plainFragmentShader,uniforms: uniforms, side: DoubleSide});
		this.skyMat = undefined;
		
		this.skyGeo = new SphereGeometry(this.sphereRadius, this.widthSegments, this.heightSegments);
		this.sky = new Mesh(this.skyGeo, this.skyMat);
		
		
		// The mesh is built BEFORE the texture is asked for, which is the reordering
		// RM-005 C1 needed. `TextureLoader.load()` hands back a Texture at call time
		// and fills the pixels in later, so the material could always be built with
		// its map in place; `KTX2Loader.load()` returns undefined and delivers a
		// `CompressedTexture` through the callback, so there is nothing to build
		// with. The material therefore starts with no map and gets one when the
		// image arrives - by whichever of the two routes arrives first.
		this.groundGeo = new PlaneGeometry(10000, 10000, 10);
		this.groundMat = new MeshBasicMaterial({
			color: this.renderProfile.groundColor,
			side: DoubleSide,
			map: null,
		});
		this.ground = new Mesh(this.groundGeo, this.groundMat);

		// Apply on whichever route delivers first, and only once. A JPEG arrives
		// twice - `TextureLoader` returns the Texture AND passes it to onLoad - and a
		// KTX2 only through onLoad.
		var scope = this;
		this.applyGroundTexture(this.loadTexture(GROUND_URL, function (t) {scope.applyGroundTexture(t);}));
		this.ground.rotateX(-Math.PI * 0.5);
		this.ground.position.y = -1;

		// Distance fog, studio only.
		//
		// The ground is a 10000-unit square and the sky is a 4000-radius sphere, so
		// the ground runs out well before the sky does and the two meet at a hard
		// horizontal line with gravel on one side of it. Every previous attempt at
		// this problem in this file went at the ground - tiling frequency, a
		// mirror, a tint - and none of them could fix it, because the line is not a
		// property of the ground texture.
		//
		// Fog is. It is also the cheapest atmosphere in the engine: linear Fog is
		// a two-uniform change to every material's fragment shader, applies to
		// MeshBasicMaterial as readily as to a lit one, and needs no second pass.
		// `fogColor` matches the sky's bottom stop so the ground dissolves into
		// the horizon rather than into a band of a different hue.
		//
		// It lives on the Scene, which is why it is set here rather than in the
		// renderer: three reads `scene.fog` when it compiles each material.
		this.threeScene().fog = isStudio(this.renderProfile) ? new Fog(this.renderProfile.fogColor, this.renderProfile.fogNear, this.renderProfile.fogFar) : null;
		
		// See GROUND_REFLECTOR_ENABLED above. Null rather than absent so
		// dispose() and any embedder reading it still find the property.
		this.groundSceneReflector = null;


		this.scene.add(this.sky);
		this.scene.add(this.ground);

		// Removed in S5: a debug AxesHelper(100) that shipped to every user,
		// drawing three coloured lines out of the origin of every design. It was
		// never behind a flag. dispose() no longer has anything to clean up here.

		this._disposed = false;
		this.init();
	}

	/**
	 * Take the sky, ground and axes back out of the scene and release their GPU
	 * resources. Safe to call more than once.
	 *
	 * S2 noted that the reflector's render target was captured in a closure
	 * inside three-reflector2 and could only be freed by forceContextLoss(). The
	 * package is gone as of S4, so there is nothing left to leak; the
	 * ground.material check below is kept because the reflector used to swap
	 * that material out, and a re-enabled reflector in S5 would do so again.
	 */
	dispose()
	{
		if(this._disposed)
		{
			return;
		}
		this._disposed = true;

		this.scene.remove(this.sky);
		this.scene.remove(this.ground);
		this.threeScene().fog = null;

		// The reflector replaces ground.material, so dispose what is actually on
		// the mesh as well as the MeshBasicMaterial it was built with.
		this.ground.onBeforeRender = function(){};
		if(this.ground.material && this.ground.material !== this.groundMat)
		{
			this.ground.material.dispose();
		}
		this.groundMat.dispose();
		this.groundGeo.dispose();

		// The maps, separately from the materials that carry them (RM-003 A0).
		// three's Material.dispose() releases the material's own GPU program and
		// nothing it points at - which is correct, because a texture can be shared
		// by several materials, and is exactly why these two need naming here.
		if(this.groundTex)
		{
			this.groundTex.dispose();
			this.groundTex = null;
		}

		this.skyGeo.dispose();
		this.plainSkyMat.dispose();
		if(this.skyMat)
		{
			// The environment photograph lives in a uniform rather than in a
			// material slot, so nothing would ever have reached it.
			var envMap = this.skyMat.uniforms && this.skyMat.uniforms.envMap;
			if(envMap && envMap.value)
			{
				envMap.value.dispose();
				envMap.value = null;
			}
			this.skyMat.dispose();
			this.skyMat = undefined;
		}

		// The transcoder's worker pool, if one was ever started (RM-005 C1).
		// `KTX2Loader.dispose()` terminates the workers; without this a viewer
		// torn down and rebuilt leaves a pool per build, which is the RM-003 A0
		// failure shape in a resource three does not call a resource.
		if(this._ktx2Loader)
		{
			this._ktx2Loader.dispose();
			this._ktx2Loader = null;
		}
	}
	
	/**
	 * A logical asset name as the URL to actually fetch (RM-005 C1).
	 *
	 * The same call `Floor` makes at `floor.js:115` and `Edge` at `edge.js:94`
	 * and `:297`, reached the same way `threeScene()` reaches the real scene:
	 * by duck-typing what was handed to the constructor. `scene` is the model's
	 * `Scene` wrapper when `Main` builds this, and a plain THREE.Scene when a
	 * caller builds it themselves - only the first carries a runtime, and this
	 * class has never been allowed to require one.
	 *
	 * With no runtime the name is its own URL, which is what an `AssetResolver`
	 * with no manifest returns anyway. So the fallback is not a degraded path,
	 * it is the same answer arrived at without the lookup.
	 *
	 * @param {string} name A logical asset name, e.g. `rooms/textures/x.jpg`.
	 * @returns {string}
	 */
	resolveAsset(name)
	{
		var runtime = this.scene && this.scene.runtime;
		return (runtime && runtime.assets) ? runtime.assets.resolve(name).url : name;
	}

	/**
	 * Dress the ground texture and hang it on the material (RM-005 C1).
	 *
	 * A method rather than the closure this started as, for two reasons. It is
	 * called from two places - the loader's synchronous return and its callback -
	 * and it is the only remaining way to observe the sampler state headlessly:
	 * with the ground now a KTX2, jsdom cannot produce the texture at all, so a
	 * test that wants to check the sRGB tag has to be able to hand one over. That
	 * is what `tests/color-pipeline.test.js` does.
	 *
	 * Idempotent. A JPEG arrives twice - `TextureLoader` returns the Texture and
	 * also passes it to `onLoad` - and a KTX2 once. Same object either way, so the
	 * guard is about not redoing the work rather than about correctness.
	 *
	 * @param {?Object} groundT
	 */
	applyGroundTexture(groundT)
	{
		if (this._groundApplied || !groundT) { return; }
		this._groundApplied = true;
		// Held on `this` since RM-003 A0, so dispose() can release it. It was a
		// local, and `Material.dispose()` in three does not touch the material's
		// maps - so the ground photograph, the largest single texture the viewer
		// loads, was leaked once per viewer built.
		this.groundTex = groundT;
		// A photograph of gravel (S8).
		groundT.colorSpace = SRGBColorSpace;
		groundT.wrapS = groundT.wrapT = RepeatWrapping;
		// Anisotropic filtering, in both profiles.
		//
		// A ground plane is the textbook case for it: the surface runs away from
		// the camera, so the sampling footprint is enormously wider than it is
		// tall, and isotropic mipmapping has to pick one level for both axes -
		// which either aliases across the plane or blurs along it. Sixteen taps is
		// the usual cap and costs nothing measurable for one draw.
		//
		// `renderer` can be a stub under test, and `capabilities` is a real WebGL
		// query, so this is guarded rather than assumed.
		var renderer = this.renderer;
		if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function')
		{
			groundT.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
		}
		// 40, not 10 - see GROUND_REFLECTOR_ENABLED. The reflector used to replace
		// this material entirely and tiled its own copy of the same image at
		// 40x40, so 10 was never what anyone actually saw. At 10 the ground reads
		// as big flat squares with obvious seams; 40 restores the fine gravel the
		// reflector produced, which is the whole of the difference the parity grid
		// showed between r98 and r185.
		groundT.repeat.set(this.renderProfile.groundRepeat, this.renderProfile.groundRepeat);

		// Loaded either way and used only if the profile wants it, which is what
		// this line has always done - studio draws untextured ground.
		if (this.renderProfile.groundTexture)
		{
			this.groundMat.map = groundT;
			// Required when a material gains a map after construction: `USE_MAP` is
			// a compile-time define, so the shader has to be rebuilt. Harmless on
			// the synchronous path, where the material is one line old.
			this.groundMat.needsUpdate = true;
		}
	}

	/**
	 * Fetch a texture by logical name, whatever container it turns out to be in
	 * (RM-005 C1).
	 *
	 * This class owns the only two textures in the viewer that do not go through
	 * `texture_cache` - the ground photograph and the environment map - so it is
	 * also the only place that has to choose a loader. The choice is made on the
	 * RESOLVED url rather than on the name, which is the point of doing it here:
	 * `rooms/textures/Ground_4K.jpg` is a name a manifest may point at a `.ktx2`,
	 * and the caller should not have to know that it did.
	 *
	 * ## The return value is the whole reason this method exists
	 *
	 * `TextureLoader.load()` returns a `Texture` immediately and fills its pixels
	 * in when the image lands. `KTX2Loader.load()` returns **undefined** and
	 * delivers a `CompressedTexture` only through `onLoad`, because a compressed
	 * texture's data lives in `.mipmaps` and there is nothing to hand back before
	 * it has been transcoded. That difference is what stopped RM-004 B5 putting
	 * these textures in `texture_cache`, whose clone-a-master design depends on
	 * the synchronous return.
	 *
	 * Here it costs one line at each call site instead: take the texture from
	 * whichever of the two routes produces it. A caller that ignores the return
	 * value and uses only `onLoad` is correct for both loaders.
	 *
	 * @param {string} name A logical asset name.
	 * @param {function(Object): void} onLoad
	 * @returns {?Object} The texture, if this loader can produce one at call
	 *          time. Null for KTX2, where `onLoad` is the only delivery.
	 */
	loadTexture(name, onLoad)
	{
		var url = this.resolveAsset(name);
		var failed = function () {console.log('Skybox: failed to load ' + url);};

		if (!/\.ktx2$/i.test(url))
		{
			// `this.texture` rather than a fresh TextureLoader, so the one seam the
			// colour-pipeline test replaces covers both of this class's textures.
			return this.texture.load(url, onLoad, undefined, failed) || null;
		}

		var loader = this.compressedLoader();
		if (!loader)
		{
			// No answer about this device, so no transcode. `KTX2Loader.load()`
			// THROWS rather than failing softly when `workerConfig` is unset, which
			// is the one place B4's architectural objection was pointing at
			// something real - and it lands here rather than in `Scene`, because
			// `Scene` only ATTACHES its loader and GLTFLoader calls it only when a
			// container actually carries a compressed image.
			//
			// `texture_formats.js` is explicit that a null record must not be
			// guessed past: transcoding to a format the GPU cannot read produces a
			// texture that fails to upload, which is worse than no texture. So the
			// ground draws in its profile colour, which is what it does under a
			// 404 today and what studio does on purpose.
			return null;
		}
		loader.load(url, onLoad, undefined, failed);
		return null;
	}

	/**
	 * The KTX2 transcoder, built on first use and not before.
	 *
	 * `Scene` has to attach its KTX2Loader eagerly - `GLTFLoader` refuses a
	 * container declaring `KHR_texture_basisu` unless one is already there. This
	 * class has no such constraint, so a build whose skybox textures are ordinary
	 * JPEGs never constructs one, never fetches the transcoder, and never starts
	 * a worker.
	 *
	 * `workerConfig` comes from the device rather than from
	 * `detectSupport(renderer)`, for the reason `core/texture_formats.js` sets
	 * out: the dependency is on what this GPU can read, which is a property of
	 * the machine and not of any one renderer. A `Skybox` does hold a renderer,
	 * so it could call `detectSupport` - and using the shared record instead
	 * means the answer here cannot disagree with the answer the model layer got.
	 *
	 * @returns {?KTX2Loader} Null where this device cannot report its formats,
	 *          which is Node, jsdom, and a browser with no WebGL at all.
	 */
	compressedLoader()
	{
		if (!this._ktx2Loader)
		{
			// Asked before the loader is built, not after. `KTX2Loader.load()`
			// throws on a missing `workerConfig`, so a loader constructed without
			// one is a loader that can only fail loudly the first time it is used.
			var support = formatSupport();
			if (!support) { return null; }

			var loader = new KTX2Loader();
			var runtime = this.scene && this.scene.runtime;
			if (runtime && runtime.assets) { loader.setTranscoderPath(runtime.assets.transcoderPath()); }
			loader.workerConfig = support;
			this._ktx2Loader = loader;
		}
		return this._ktx2Loader;
	}

	/**
	 * The real THREE.Scene behind whatever was handed to the constructor.
	 *
	 * `scene` has always been duck-typed here as "something with add and remove",
	 * and two different things are passed: `Main` passes the model's `Scene`
	 * wrapper, and a caller holding a plain THREE.Scene passes that. Both satisfy
	 * add/remove, which is why nothing has ever had to tell them apart - until
	 * fog, which is a property on the real scene object and is silently ignored
	 * if set on the wrapper.
	 *
	 * @returns {Object} a THREE.Scene
	 */
	threeScene()
	{
		return (typeof this.scene.getScene === 'function') ? this.scene.getScene() : this.scene;
	}

	setEnabled(flag)
	{
		if(!flag)
		{
			this.scene.remove(this.sky);
			this.scene.remove(this.ground);
		}
		else
		{
			this.scene.add(this.sky);
			this.scene.add(this.ground);
		}
	}
	
	toggleEnvironment(flag)
	{
		this.useEnvironment = flag;
		if(!flag)
		{
			this.ground.visible = true;
			this.sky.material = this.plainSkyMat;
			this.sky.material.needsUpdate = true;
		}
		else
		{
			this.ground.visible = false;
			if(!this.skyMat)
			{
				this.setEnvironmentMap(this.defaultEnvironment);
			}
			else
			{
				this.sky.material = this.skyMat;
			}
			this.sky.visible = true;
		}
		this.scene.needsUpdate = true;
	}
	
	setEnvironmentMap(url)
	{
		var scope = this;
		// Resolved and dispatched by `loadTexture`, so every caller gets the
		// indirection - `toggleEnvironment` passing `defaultEnvironment`, and an
		// embedder passing a name of their own - and gets whichever loader the
		// resolved URL turns out to need.
		//
		// The return value is deliberately ignored. This path was already the
		// shape a compressed texture needs: the material is built INSIDE the
		// callback, from the texture that arrives, so it holds a
		// `CompressedTexture` as readily as a `Texture` and always could have.
		//
		// The trailing `undefined, function(){...}` this used to carry went with
		// it. `loadTexture` takes two arguments and owns the failure path for both
		// loaders, so the third and fourth were being dropped - which C1 did not
		// notice and the type checker did, in the very next sprint (TS2554,
		// expected 2 got 4). The message they logged, `ERROR LOADEING FILE`, is
		// replaced by `loadTexture`'s, which names the URL.
		scope.loadTexture(url, function (t)
		{
			// The environment photograph, decoded on the way in so the shader's
			// #include <colorspace_fragment> has linear values to encode (S8).
			// Before S8 the two omissions cancelled - no decode, no encode - so
			// this and the include have to arrive together or the sky doubles or
			// halves its gamma.
			t.colorSpace = SRGBColorSpace;
			var textureUniform = {type: 't', value: t};
			var uniforms = {envMap: textureUniform};
			scope.skyMat = new ShaderMaterial({vertexShader: scope.vertexShader, fragmentShader: scope.fragmentShader, uniforms: uniforms, side: DoubleSide});
			scope.toggleEnvironment(scope.useEnvironment);
		});
	}
	
	init() 
	{		
		this.toggleEnvironment(false);
	}
}
