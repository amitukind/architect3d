// @ts-check
import {EventDispatcher, HemisphereLight, DirectionalLight, Vector3} from 'three';
import {EVENT_UPDATED} from '../core/events.js';
import {renderProfile, isStudio} from '../core/render_profile.js';

export class Lights extends EventDispatcher
{
	constructor(scene, floorplan, profile)
	{
		super();		
	/**
	 * The look this object draws with (RM-002 R-02, P7). Falls back to the shared
	 * profile, which is what every construction site did before and what the
	 * parity grid still measures.
	 */
		this.renderProfile = profile || renderProfile;
		this.scene = scene;
		this.floorplan = floorplan;		
		this.tol = 1;
		/**
		 * Where the key light sits, in centimetres.
		 *
		 * Carried a TODO reading "share with Blueprint.Wall" for as long as this
		 * file has existed, and it should not be actioned as written. The
		 * configured wall height defaults to **250**; this is **300**, and the
		 * gap is the point - a light level with the top of the walls rakes
		 * across them instead of lighting the floor.
		 *
		 * Sharing the value would move every light in every scene and change
		 * every rendered frame, so it is a parity change requiring a fresh
		 * golden capture, not a tidy-up. If it is ever wanted, the honest form
		 * is `configurationOf(this).wallHeight + 50`, which states the
		 * relationship rather than repeating a number.
		 */
		this.height = 300;
		this.hemiLight = null;
		this.dirLight = null;
		this.fillLight = null;
		this._disposed = false;
		this.updatedroomsevent = () => {this.updateShadowCamera();};
		this.init();
	}

	getDirLight()
	{
		return this.dirLight;
	}

	/**
	 * Take the lights back out of the scene and stop listening to the floorplan.
	 *
	 * New, and not only for the profile switch. `init()` registers an
	 * EVENT_UPDATED listener on the floorplan and nothing has ever removed it, so
	 * every Lights ever constructed stayed subscribed for the life of the
	 * floorplan - harmless while exactly one existed per page, a leak the moment
	 * a viewer is disposed and remounted, which S2 made possible and
	 * applyRenderProfile now does deliberately.
	 *
	 * Safe to call more than once.
	 */
	dispose()
	{
		if (this._disposed)
		{
			return;
		}
		this._disposed = true;

		this.floorplan.removeEventListener(EVENT_UPDATED, this.updatedroomsevent);

		if (this.hemiLight)
		{
			this.scene.remove(this.hemiLight);
			this.hemiLight.dispose();
		}
		if (this.dirLight)
		{
			this.scene.remove(this.dirLight);
			this.scene.remove(this.dirLight.target);
			this.dirLight.dispose();
		}
		if (this.fillLight)
		{
			this.scene.remove(this.fillLight);
			this.fillLight.dispose();
		}
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
		var light = new HemisphereLight(this.renderProfile.hemisphereSky, this.renderProfile.hemisphereGround, this.renderProfile.hemisphereIntensity * Math.PI);
		light.position.set(0, this.height, 0);
		this.hemiLight = light;
		this.scene.add(light);

		this.dirLight = new DirectionalLight(0xffffff, this.renderProfile.keyIntensity * Math.PI);
		// setHSL(1, 1, 0.1) is a fully saturated red at 10% lightness - hue 1 wraps
		// to 0. So the "white" directional light has never been white: it is
		// #330000, and at 0.5*pi it contributes a dim red wash and essentially no
		// shadow contrast. That is a bug old enough to be load-bearing for the
		// parity grid, so classic keeps it exactly. Studio does not: a key light
		// that emits no green or blue cannot model a room.
		if (!isStudio(this.renderProfile))
		{
			this.dirLight.color.setHSL(1, 1, 0.1);
		}

		this.dirLight.castShadow = true;

		this.dirLight.shadow.mapSize.width = this.renderProfile.shadowMapSize;
		this.dirLight.shadow.mapSize.height = this.renderProfile.shadowMapSize;
		this.dirLight.shadow.radius = this.renderProfile.shadowRadius;

		this.dirLight.shadow.bias = -0.0001;
		this.dirLight.shadow.normalBias = isStudio(this.renderProfile) ? 1.5 : 0;
		this.dirLight.visible = true;
		// Removed in S5: shadowDarkness and shadowCameraVisible. Both moved onto
		// light.shadow around r73 and were deleted outright well before r98, so
		// they have been inert properties on a plain object for the life of this
		// file - assigning them did nothing then and does nothing now.

		this.scene.add(this.dirLight);
		this.scene.add(this.dirLight.target);

		// A second directional, opposite the key and much weaker, added under
		// studio only.
		//
		// The key light is directly overhead - updateShadowCamera parks it at
		// (centre.x, 300, centre.z) - so every vertical surface in the room
		// receives it at a grazing angle and the four walls come out at nearly the
		// same value. The hemisphere fills that in, but a hemisphere is
		// directionless by construction and cannot separate one wall from the next.
		// An off-axis fill at a fifth of the key's strength is what gives adjacent
		// walls different values, which is what makes a corner read as a corner.
		//
		// It casts nothing: two shadow maps for a fill light is not a trade worth
		// making, and a second set of shadows from below would be wrong anyway.
		this.fillLight = null;
		if (isStudio(this.renderProfile))
		{
			this.fillLight = new DirectionalLight(0xdce7f5, 0.2 * Math.PI);
			this.fillLight.position.set(-0.6, 0.5, -0.8);
			this.fillLight.castShadow = false;
			this.scene.add(this.fillLight);
		}

		this.floorplan.addEventListener(EVENT_UPDATED, this.updatedroomsevent);

	}

	updateShadowCamera() 
	{
		var size = this.floorplan.getSize();
		var d = (Math.max(size.z, size.x) + this.tol) / 2.0;
		var center = this.floorplan.getCenter();

		// Where the key sits.
		//
		// Classic parks it at (centre.x, 300, centre.z) - directly overhead. That
		// is the worst angle available for a room: all four walls receive it at
		// the same grazing incidence, so all four come out at the same value and
		// the shadow it casts falls straight down out of sight under the
		// furniture. It did not matter while the walls were unlit, because they
		// received nothing at all.
		//
		// Studio pushes it out and up by a fraction of the plan's own size, so it
		// scales with the room rather than being a constant that happens to suit
		// one. Two walls are then lit and two are not, which is what makes a
		// rendered room look like a room.
		var height = this.height * this.renderProfile.keyHeight;
		var offset = d * this.renderProfile.keyOffset;
		var pos = new Vector3(center.x + offset, height, center.z + offset * 0.8);

		this.dirLight.position.copy(pos);
		this.dirLight.target.position.copy(center);

		// The frustum has to reach from the light to the far side of the plan.
		// Classic's `height + tol` was exactly right for a light directly overhead
		// and is far too short for one that has been moved out; the shadow would
		// simply stop partway across the floor.
		this.dirLight.shadow.camera.near = 1;
		this.dirLight.shadow.camera.far = pos.distanceTo(center) + (d * 2) + this.tol;
		// Studio pads the frustum. `d` is exactly half the plan's larger dimension,
		// so a shadow cast outward past the wall line - which is every shadow, the
		// light being overhead and slightly off-centre - falls outside the map and
		// is clipped to a straight edge along the boundary. A quarter more room
		// costs nothing but map resolution, and there is twice as much of that now.
		var pad = isStudio(this.renderProfile) ? 1.25 : 1.0;
		this.dirLight.shadow.camera.left = -d * pad;
		this.dirLight.shadow.camera.right = d * pad;
		this.dirLight.shadow.camera.top = d * pad;
		this.dirLight.shadow.camera.bottom = -d * pad;

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