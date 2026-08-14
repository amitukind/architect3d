import {EventDispatcher, TextureLoader, RepeatWrapping, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, FrontSide, DoubleSide, Vector2, Vector3, Shape, ShapeGeometry, Mesh, SRGBColorSpace} from 'three';
import {triangleFanGeometry} from '../core/geometry_builders.js';
import {EVENT_CHANGED} from '../core/events.js';
import {Configuration, configWallHeight} from '../core/configuration.js';
import {renderProfile, isStudio} from './render_profile.js';

export class Floor extends EventDispatcher
{
	constructor(scene, room)
	{
		super();
		this.scene = scene;
		this.room = room;
		this.floorPlane = null;
		this.roofPlane = null;
		this.changedevent = () => {this.redraw();};
		this.init();
	}

	switchWireframe(flag)
	{
		this.floorPlane.visible = !flag;
		this.roofPlane.visible = !flag;
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
		this.floorPlane = this.buildFloor();
		this.roofPlane = this.buildRoofVaryingHeight();
		this.addToScene();
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
		return new MeshBasicMaterial({side: FrontSide, color: renderProfile.roofColor});
	}

	buildFloor()
	{
		var textureSettings = this.room.getTexture();
		// setup texture
		var floorTexture = new TextureLoader().load(textureSettings.url);
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
		var floorMaterialTop = isStudio()
			? new MeshStandardMaterial({
				map: floorTexture,
				side: DoubleSide,
				color: 0xffffff,
				roughness: renderProfile.floorRoughness,
				metalness: renderProfile.floorMetalness,
				envMapIntensity: renderProfile.environmentIntensity,
			})
			: new MeshPhongMaterial({
				map: floorTexture,
				side: DoubleSide,
				// ambient: 0xffffff, TODO_Ekki
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

	showRoof(flag)
	{
		console.log(flag);
	}
}
