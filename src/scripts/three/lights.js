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
		// x pi: r165 removed the legacy lighting mode, in which light intensity
		// was scaled by 1/pi before reaching the shader. Physical units are the
		// only mode now, so the r98 numbers - 1.1 and 0.5 - arrive pi times
		// dimmer than they used to and every lit surface (the Phong floors and
		// the loaded items) darkens. Unlit materials, which is most of this
		// scene, would not move at all, so the result would be an inconsistent
		// half-darkening rather than an even one.
		//
		// Multiplying restores the r98 look exactly. S5 recalibrates these to
		// values chosen for the physical model rather than derived from the old
		// one; the constants are written as products so that pass can see where
		// they came from.
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

//		this.floorplan.fireOnUpdatedRooms(updateShadowCamera);
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
		//dirLight.updateMatrix();
		//dirLight.updateWorldMatrix()
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