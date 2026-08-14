import {EventDispatcher, PlaneGeometry, SphereGeometry, MeshBasicMaterial, ShaderMaterial, Mesh, TextureLoader, Color, DoubleSide, SRGBColorSpace} from 'three';
import {RepeatWrapping, Fog} from 'three';
import {renderProfile, isStudio} from './render_profile.js';


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
		
		this.defaultEnvironment = 'rooms/textures/envs/Garden.jpg';
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
		
		
		var groundT = new TextureLoader().load('rooms/textures/Ground_4K.jpg', function(){});
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
		
		this.groundGeo = new PlaneGeometry(10000, 10000, 10);
		this.groundMat = new MeshBasicMaterial({
			color: this.renderProfile.groundColor,
			side: DoubleSide,
			map: this.renderProfile.groundTexture ? groundT : null,
		});
		this.ground = new Mesh(this.groundGeo, this.groundMat);
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

		this.skyGeo.dispose();
		this.plainSkyMat.dispose();
		if(this.skyMat)
		{
			this.skyMat.dispose();
			this.skyMat = undefined;
		}
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
		scope.texture.load(url, function (t)
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
		}, undefined, function()
		{
			console.log('ERROR LOADEING FILE');
		});
	}
	
	init() 
	{		
		this.toggleEnvironment(false);
	}
}
