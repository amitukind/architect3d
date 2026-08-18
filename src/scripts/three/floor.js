// @ts-check
import {EventDispatcher, RepeatWrapping, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, FrontSide, DoubleSide, Vector2, Vector3, Shape, ShapeGeometry, Mesh, SRGBColorSpace} from 'three';
import {triangleFanGeometry} from '../core/geometry_builders.js';
import {EVENT_CHANGED} from '../core/events.js';
import {acquireTexture, releaseTexture} from './texture_cache.js';
import {disposeObject} from '../core/resource_registry.js';
import {Configuration, configWallHeight} from '../core/configuration.js';
import {renderProfile, isStudio} from '../core/render_profile.js';
import {runtimeOf} from '../core/design_runtime.js';

export class Floor extends EventDispatcher
{
	constructor(scene, room, profile, runtime)
	{
		super();
	/**
	 * The look this object draws with (RM-002 R-02, P7). Falls back to the shared
	 * profile, which is what every construction site did before and what the
	 * parity grid still measures.
	 */
		this.renderProfile = profile || renderProfile;
		/**
		 * Which document this floor belongs to (RM-003 A4), and where its texture
		 * URL is resolved (A5). Derived from the room when it is not passed, for
		 * the same reason `Edge` derives it: `Floor` is public API and the
		 * three-argument form has to keep working.
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = runtime || runtimeOf(room && room.floorplan);
		this.scene = scene;
		this.room = room;
		this.floorPlane = null;
		this.roofPlane = null;
		// Held so redraw() can give it back. The floor is rebuilt on every
		// EVENT_CHANGED, and before RM-002 R-04 each rebuild loaded another copy
		// of the same image and dropped the previous one on the floor, so to speak.
		/** @type {?import('three').Texture} */
		this.floorTexture = null;
		this.changedevent = () => {this.redraw();};
		this.init();
	}

	switchWireframe(flag)
	{
		// Both planes are null before init() and after dispose(), and this is
		// public API an embedder can call at either point (RM-005 C2).
		if (this.floorPlane) { this.floorPlane.visible = !flag; }
		if (this.roofPlane) { this.roofPlane.visible = !flag; }
	}

	init()
	{
		this.room.addEventListener(EVENT_CHANGED, this.changedevent);

		this.floorPlane = this.buildFloor();
		// roofs look weird, so commented out
		this.roofPlane = this.buildRoofVaryingHeight();
	}

	redraw()
	{
		this.removeFromScene();
		this.releasePlanes();
		this.floorPlane = this.buildFloor();
		this.roofPlane = this.buildRoofVaryingHeight();
		this.addToScene();
	}

	/**
	 * Dispose the two planes this floor built, and only those (RM-003 A0).
	 *
	 * ## The ownership boundary, stated where it is easiest to get wrong
	 *
	 * `addToScene()` puts four meshes into the scene: `this.floorPlane` and
	 * `this.roofPlane`, which this class built, and `this.room.floorPlane` and
	 * `this.room.roofPlane`, which the **model** built and which this class only
	 * borrows for picking. Only the first two are released here. Disposing the
	 * room's would take out the geometry the raycaster tests against and leave the
	 * next redraw picking against a dead handle - and it would do it silently,
	 * because a disposed geometry still has its attributes on the CPU side.
	 *
	 * `tests/resource-lifecycle.test.js` asserts exactly this, in both directions.
	 */
	releasePlanes()
	{
		disposeObject(this.floorPlane);
		disposeObject(this.roofPlane);
		this.floorPlane = null;
		this.roofPlane = null;
	}

	/**
	 * The ceiling.
	 *
	 * Kept unlit in both profiles, which is deliberate rather than an oversight.
	 * The roof plane is FrontSide and the camera is almost always below it, so
	 * what a viewer sees of it is the *back* face - and a lit back face has an
	 * inverted normal, which under a directional light from above renders black.
	 * Studio only changes the colour, a shade down, so the ceiling reads as being
	 * further from the light than the walls instead of brighter than them.
	 *
	 * @returns {MeshBasicMaterial}
	 */
	makeRoofMaterial()
	{
		return new MeshBasicMaterial({side: FrontSide, color: this.renderProfile.roofColor});
	}

	buildFloor()
	{
		var textureSettings = this.room.getTexture();
		// setup texture
		releaseTexture(this.floorTexture);
		// Logical name to physical URL (A5). The document records the logical one -
		// `newFloorTextures[].url` is in every save file that has a custom floor -
		// and the resolver decides what is actually fetched. With no manifest it is
		// the same string, which is what it was before A5.
		var floorTexture = acquireTexture(this.runtime.assets.resolve(textureSettings.url).url);
		this.floorTexture = floorTexture;
		// sRGB (S8). This one matters more than the others: the floor is
		// MeshPhongMaterial and so the only lit surface in most views, which
		// makes an untagged floor texture the obvious thing to mistake for the
		// lights being wrong and "fix" by cutting the hemisphere intensity.
		floorTexture.colorSpace = SRGBColorSpace;
		floorTexture.wrapS = RepeatWrapping;
		floorTexture.wrapT = RepeatWrapping;
		floorTexture.repeat.set(1, 1);

		// Phong in classic, Standard in studio.
		//
		// The floor is the one surface in the scene that has always been lit, so
		// this is the smaller of the two material changes - but it is the one that
		// benefits most from an environment map, because a floor is a large flat
		// plane and a large flat plane is where a gradient across a surface is
		// visible at all. `specular: 0x0a0a0a` has no counterpart under a
		// roughness/metalness model; the equivalent is a high roughness with the
		// environment doing the rest, which is what the profile sets.
		//
		// `color: 0xcccccc` multiplies the texture down to 80% in classic. Studio
		// leaves it white and lets exposure and tone mapping set the level: with
		// the classic tint the floor arrives pre-darkened and then gets darkened
		// again by real shading.
		var floorMaterialTop = isStudio(this.renderProfile)
			? new MeshStandardMaterial({
				map: floorTexture,
				side: DoubleSide,
				color: 0xffffff,
				roughness: this.renderProfile.floorRoughness,
				metalness: this.renderProfile.floorMetalness,
				envMapIntensity: this.renderProfile.environmentIntensity,
			})
			: new MeshPhongMaterial({
				map: floorTexture,
				side: DoubleSide,
				color: 0xcccccc,
				specular: 0x0a0a0a
			});

		var textureScale = textureSettings.scale;
		// http://stackoverflow.com/questions/19182298/how-to-texture-a-three-js-mesh-created-with-shapegeometry
		// scale down coords to fit 0 -> 1, then rescale

		var points = [];
		this.room.interiorCorners.forEach((corner) => {
			points.push(new Vector2(corner.x / textureScale,corner.y / textureScale));
		});
		var shape = new Shape(points);
		var geometry = new ShapeGeometry(shape);
		var floor = new Mesh(geometry, floorMaterialTop);

		floor.rotation.set(Math.PI / 2, 0, 0);
		floor.scale.set(textureScale, textureScale, textureScale);
		floor.receiveShadow = true;
		floor.castShadow = false;
		return floor;
	}

	buildRoofVaryingHeight()
	{
		// setup texture
		var roofMaterial = this.makeRoofMaterial();
		var points = this.room.corners.map((corner) => new Vector3(corner.x, corner.elevation, corner.y));
		var geometry = triangleFanGeometry(points);
		var roof = new Mesh(geometry, roofMaterial);
		return roof;
	}


	buildRoofUniformHeight()
	{
		// setup texture
		var roofMaterial = this.makeRoofMaterial();
		var points = [];
		this.room.interiorCorners.forEach((corner) => {
			points.push(new Vector2(corner.x,corner.y));
		});
		var shape = new Shape(points);
		var geometry = new ShapeGeometry(shape);
		var roof = new Mesh(geometry, roofMaterial);
		roof.rotation.set(Math.PI / 2, 0, 0);
		roof.position.y = Configuration.getNumericValue(configWallHeight);
		return roof;
	}

	addToScene()
	{
		this.scene.add(this.floorPlane);
		this.scene.add(this.roofPlane);
		// hack so we can do intersect testing
		this.scene.add(this.room.floorPlane);
		this.scene.add(this.room.roofPlane);
	}

	removeFromScene()
	{
		this.scene.remove(this.floorPlane);
		this.scene.remove(this.roofPlane);
		this.scene.remove(this.room.floorPlane);
		this.scene.remove(this.room.roofPlane);
	}

	/**
	 * Detach from the room, release the geometry, and give the texture back.
	 *
	 * Separate from removeFromScene(), which redraw() calls between rebuilds and
	 * which must not release anything - the next line builds the replacement.
	 * `releasePlanes()` is the part redraw() *does* want, and it calls it itself.
	 */
	dispose()
	{
		this.room.removeEventListener(EVENT_CHANGED, this.changedevent);
		this.removeFromScene();
		this.releasePlanes();
		releaseTexture(this.floorTexture);
		this.floorTexture = null;
	}

	showRoof(flag)
	{
		console.log(flag);
	}
}
