import {EventDispatcher, PlaneGeometry, SphereGeometry, MeshBasicMaterial, ShaderMaterial, Mesh, TextureLoader, Color, DoubleSide} from 'three';
import {RepeatWrapping} from 'three';

import {AxesHelper} from 'three';

/**
 * Whether the ground plane gets the mirror-blend reflector.
 *
 * Off since S4, and the flag exists so the decision is visible rather than
 * implied by a deleted import. The reflector came from `three-reflector2`,
 * which does `import {Math} from 'three'` - an alias removed in r113 - so it
 * cannot even be parsed against r185; it had to go for the build to succeed.
 *
 * Its replacement is a live question, not an oversight. Rebuilding it on
 * three's own addons `Reflector` means reimplementing the two-texture blend it
 * did on top of the mirror, and the effect it produced was subtle to begin with
 * (intensity 0.1, blend 0.05). Keeping the static textured ground may simply be
 * the better answer. S5 decides, with both options rendered side by side; until
 * then the ground is the plain textured plane it falls back to.
 */
export const GROUND_REFLECTOR_ENABLED = false;

export class Skybox extends EventDispatcher
{
	constructor(scene, renderer)
	{
		super();
		
		this.defaultEnvironment = 'rooms/textures/envs/Garden.png';
		this.useEnvironment = false;
		this.topColor = 0x92b2ce;//0xe9e9e9; //0xf9f9f9;//0x565e63
		this.bottomColor = 0xffffff;//0xD8ECF9
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
		this.plainFragmentShader = ['uniform vec3 bottomColor;','uniform vec3 topColor;','uniform float offset;','uniform float exponent;','varying vec3 vWorldPosition;','void main() {',' float h = normalize( vWorldPosition + offset ).y;',' gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max(h, 0.0 ), exponent ), 0.0 ) ), 1.0 );','}'].join('\n');
		
		this.vertexShader = ['varying vec2 vUV;','void main() {','  vUV=uv;','  vec4 pos = vec4(position, 1.0);', '   gl_Position = projectionMatrix * modelViewMatrix * pos;','}'].join('\n');
		// `texture` and `sample` are both reserved words in GLSL ES 3.00, which is
		// what three emits for any material tagged GLSL3 - and `texture` shadows
		// the built-in sampling function besides. Renamed to envMap/texel; the
		// shader is otherwise unchanged. setEnvironmentMap() below builds the
		// matching uniform.
		this.fragmentShader = ['uniform sampler2D envMap;', 'varying vec2 vUV;', 'void main() {  ', 'vec4 texel = texture2D(envMap, vUV);', 'gl_FragColor = vec4(texel.xyz, texel.w);' ,'}'].join('\n');
		
		this.texture = new TextureLoader();
		this.plainSkyMat = new ShaderMaterial({vertexShader: this.plainVertexShader,fragmentShader: this.plainFragmentShader,uniforms: uniforms, side: DoubleSide});
		this.skyMat = undefined;
		
		this.skyGeo = new SphereGeometry(this.sphereRadius, this.widthSegments, this.heightSegments);
		this.sky = new Mesh(this.skyGeo, this.skyMat);
//		this.sky.position.x += this.sphereRadius*0.5;
		
		
		var groundT = new TextureLoader().load('rooms/textures/Ground_4K.jpg', function(){});		
		groundT.wrapS = groundT.wrapT = RepeatWrapping;
		groundT.repeat.set(10,10);
		
//		var uniforms2 = {topColor: {type: 'c',value: new Color(0xFFFFFF)},bottomColor: {type: 'c',value: new Color(0x999999)},offset: {type: 'f',value: this.verticalOffset}, exponent: {type:'f', value: this.exponent}};
		this.groundGeo = new PlaneGeometry(10000, 10000, 10);
		this.groundMat = new MeshBasicMaterial({color: 0xEAEAEA, side: DoubleSide, map:groundT });
		this.ground = new Mesh(this.groundGeo, this.groundMat);
		this.ground.rotateX(-Math.PI * 0.5);
		this.ground.position.y = -1;
		
		// See GROUND_REFLECTOR_ENABLED above. Null rather than absent so
		// dispose() and any embedder reading it still find the property.
		this.groundSceneReflector = null;


		this.scene.add(this.sky);
		this.scene.add(this.ground);

		this.axesHelper = new AxesHelper( 100 );
		this.scene.add( this.axesHelper );

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
		this.scene.remove(this.axesHelper);

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
		if(this.axesHelper.geometry)
		{
			this.axesHelper.geometry.dispose();
		}
		if(this.axesHelper.material)
		{
			this.axesHelper.material.dispose();
		}
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
//		this.sky.visible = this.ground.visible = flag;
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
