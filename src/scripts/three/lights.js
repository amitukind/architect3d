import {EventDispatcher, HemisphereLight, DirectionalLight, Vector3} from 'three';
import {EVENT_UPDATED} from '../core/events.js';

export class Lights extends EventDispatcher
{
	constructor(scene, floorplan)
	{
		super();		
		this.scene = scene;
		this.floorplan = floorplan;		
		this.tol = 1;
		this.height = 300; // TODO: share with Blueprint.Wall
		this.dirLight = null;
		this.updatedroomsevent = () => {this.updateShadowCamera();};
		this.init();
	}

	getDirLight() 
	{
		return this.dirLight;
	}

	init()
	{
		// x pi: a unit conversion, not a workaround, and not part of the S4
		// colour freeze.
		//
		// r165 removed the legacy lighting mode. Under it the renderer scaled a
		// light's contribution by 1/pi on the way into the shader; now it does
		// not - WebGLLights writes `color * intensity` straight into the uniform
		// - while `BRDF_Lambert` still divides the diffuse response by pi
		// (common.glsl.js). So an intensity of N * PI reaches an up-facing
		// diffuse surface as a multiplier of exactly N, which is what N alone
		// used to mean.
		//
		// Written as products so the provenance stays visible: 1.1 and 0.5 are
		// the numbers this app has always used. S8 reviewed them again when it
		// turned colour management on and kept them - the conversion is exact,
		// and re-picking them would have meant baking a new constant to
		// compensate for something else. Note how little of this scene is lit at
		// all: the walls, roof, sky and ground are all MeshBasicMaterial, so
		// these two lights reach the Phong floors and the loaded items and
		// nothing else.
		var light = new HemisphereLight(0xffffff, 0x888888, 1.1 * Math.PI);
		light.position.set(0, this.height, 0);
		this.scene.add(light);

		this.dirLight = new DirectionalLight(0xffffff, 0.5 * Math.PI);
		this.dirLight.color.setHSL(1, 1, 0.1);

		this.dirLight.castShadow = true;

		this.dirLight.shadow.mapSize.width = 1024;
		this.dirLight.shadow.mapSize.height = 1024;

		this.dirLight.shadow.camera.far = this.height + this.tol;
		this.dirLight.shadow.bias = -0.0001;
		this.dirLight.visible = true;
		// Removed in S5: shadowDarkness and shadowCameraVisible. Both moved onto
		// light.shadow around r73 and were deleted outright well before r98, so
		// they have been inert properties on a plain object for the life of this
		// file - assigning them did nothing then and does nothing now.

		this.scene.add(this.dirLight);
		this.scene.add(this.dirLight.target);

		this.floorplan.addEventListener(EVENT_UPDATED, this.updatedroomsevent);

	}

	updateShadowCamera() 
	{
		var size = this.floorplan.getSize();
		var d = (Math.max(size.z, size.x) + this.tol) / 2.0;
		var center = this.floorplan.getCenter();
		var pos = new Vector3(center.x, this.height, center.z);
		this.dirLight.position.copy(pos);
		this.dirLight.target.position.copy(center);
		this.dirLight.shadow.camera.left = -d;
		this.dirLight.shadow.camera.right = d;
		this.dirLight.shadow.camera.top = d;
		this.dirLight.shadow.camera.bottom = -d;

		// The frustum above only takes effect once the projection is rebuilt, and
		// it never was. The call sat inside `if (this.dirLight.shadowCamera)`,
		// guarding on a property removed from three around r73 - so the branch has
		// been dead for the whole life of this file, and with it the update. The
		// shadow camera therefore kept whatever frustum it was born with, and
		// shadows were sized for the wrong plan as soon as the room changed shape.
		//
		// Fixing it changes what shadows look like, which is why it is scheduled
		// here rather than smuggled into the S4 bump: the parity grid shows it as
		// an intended difference from r98, not a regression. The four assignments
		// the dead branch made are gone with it - they read from properties
		// (shadowCameraLeft and friends) that nothing has ever set.
		this.dirLight.shadow.camera.updateProjectionMatrix();
	}
}