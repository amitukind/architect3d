import {EventDispatcher, RepeatWrapping, BufferAttribute, Vector2, Vector3, MeshBasicMaterial, MeshStandardMaterial, FrontSide, DoubleSide, BackSide, Shape, Path, ShapeGeometry, Mesh, SRGBColorSpace} from 'three';
import {Utils} from '../core/utils.js';
import {triangleFanGeometry} from '../core/geometry_builders.js';
import {EVENT_REDRAW, EVENT_CAMERA_MOVED, EVENT_CAMERA_ACTIVE_STATUS} from '../core/events.js';
import {isStudio} from '../core/render_profile.js';
import {acquireTexture, releaseTexture} from './texture_cache.js';
import {runtimeOf} from '../core/design_runtime.js';

/**
 * The hand-painted vignette every wall is lit with. One image, one decode -
 * see the sRGB note in the constructor for what it is and why it is tagged the
 * way it is.
 */
const LIGHT_MAP_URL = 'rooms/textures/walllightmap.png';

export class Edge extends EventDispatcher
{
	/**
	 * @param {Object} scene
	 * @param {Object} edge The model HalfEdge this draws.
	 * @param {Object} controls
	 * @param {Object} [profile] A look of this object's own (P7).
	 * @param {import('../core/design_runtime.js').DesignRuntime} [runtime] Which
	 * document this belongs to (A4). Omitted, it is derived from the half edge -
	 * `Edge` is public API and the four-argument form has to keep working, and
	 * the derivation reaches the same runtime `Floorplan3D` would have passed.
	 */
	constructor(scene, edge, controls, profile, runtime)
	{
		super();
		/**
		 * Which document this edge belongs to (RM-003 A4).
		 * @type {import('../core/design_runtime.js').DesignRuntime}
		 */
		this.runtime = runtime || runtimeOf(edge && edge.wall && edge.wall.start && edge.wall.start.floorplan);
	/**
	 * The look this object draws with (RM-002 R-02, P7). Falls back to this
	 * document's profile, which for a document that asked for no profile of its
	 * own is the shared one - what every construction site did before and what
	 * the parity grid still measures.
	 */
		this.renderProfile = profile || this.runtime.renderProfile;
		this.name = 'edge';
		this.scene = scene;
		this.edge = edge;
		this.controls = controls;

		this.wall = edge.wall;
		this.front = edge.front;

		this.planes = [];
		this.phantomPlanes = [];
		this.basePlanes = []; // always visible

		/**
		 * The geometries and materials this edge built (RM-003 A0).
		 *
		 * A registry rather than a walk over `planes` for one reason: not every
		 * material this class creates ends up on a mesh. `updatePlanes()` builds
		 * `fillerMaterial` unconditionally and only attaches it inside the
		 * exterior-wall branch, so on an interior wall it is created and dropped.
		 * A registry catches that; iterating the meshes cannot.
		 *
		 * It also refcounts, which matters because one material is shared by more
		 * than one mesh here - releasing the first must not leave the second
		 * drawing with a dead handle.
		 *
		 * Asked of the runtime rather than constructed, since A4, so the document
		 * knows this edge is holding GPU memory. It is still this edge's own
		 * registry with this edge's own release point - `removeFromScene()` calls
		 * `releaseAll()` on every rebuild, which a shared registry could not
		 * survive. What the document gains is the ability to answer "how much am I
		 * holding" and to give it all back if the viewer is dropped without being
		 * disposed. `remove()` hands it back.
		 *
		 * @type {import('../core/resource_registry.js').ResourceRegistry}
		 */
		this.resources = this.runtime.registry();

		// Edge.plane is the plane used for wall intersection. Pushing it into
		// phantomPlanes renders it, which is how to see what the picker sees.
		// NOTE that this makes a phantom plane BORROWED - it belongs to the model's
		// HalfEdge - which is why removeFromScene() detaches those without
		// disposing them.


		// Set by updateTexture() below, and released when it is replaced. The
		// throwaway `new TextureLoader()` that used to sit here loaded nothing and
		// was overwritten on the next line of init().
		this.texture = null;

		// One decode for the whole scene, not one per wall (RM-002 R-04). Every
		// Edge asks for the same URL, and every Edge used to get its own copy.
		this.lightMap = acquireTexture(LIGHT_MAP_URL);
		// sRGB, and written out rather than left to default (S8).
		//
		// three's own guidance is that a lightMap holds linear data, and for a
		// baked irradiance buffer that is right. This one is not that: it is a
		// hand-painted greyscale vignette, authored and looked at as an image, so
		// sRGB is the honest description of what its bytes mean.
		//
		// It also happens to be the answer that preserves the picture, for a
		// reason worth writing down. The walls are unlit MeshBasicMaterial, so a
		// lightmap texel is decoded on the way in and the shaded result is
		// re-encoded on the way out - and sRGB decode followed by sRGB encode is
		// the identity. Tagging it sRGB therefore passes the authored bytes
		// through untouched: the asset spans 232-253 and still renders 232-253,
		// a 21-byte vignette. Leaving it linear skips the decode but not the
		// encode, which lifts it to 244.6-254.1 and flattens the vignette to 9.5
		// bytes - and no scalar lightMapIntensity can undo that, because the
		// factor varies across the texture.
		this.lightMap.colorSpace = SRGBColorSpace;

		this.fillerColor = 0xdddddd;
		this.sideColor = 0xcccccc;
		this.baseColor = 0xdddddd;
		this.visible = false;

		var scope = this;

		this.redrawevent = ()=>{scope.redraw();};
		this.visibilityevent = ()=>{scope.updateVisibility();};
		this.showallevent =  ()=>{scope.showAll();};
		
		this.visibilityfactor = true;
		this.init();
		
		
	}

	remove()
	{
		this.edge.removeEventListener(EVENT_REDRAW, this.redrawevent);
		this.controls.removeEventListener(EVENT_CAMERA_MOVED, this.visibilityevent);
		this.controls.removeEventListener(EVENT_CAMERA_ACTIVE_STATUS, this.showallevent);
		this.removeFromScene();

		// Both handles go back, so the last wall using an image releases it.
		releaseTexture(this.texture);
		this.texture = null;
		releaseTexture(this.lightMap);
		this.lightMap = null;

		// This edge is finished for good, so the document stops tracking its
		// registry. `removeFromScene()` above already emptied it; without this the
		// runtime would accumulate one spent registry per wall face per rebuild -
		// a smaller leak than the one A0 fixed, and still one.
		this.runtime.forget(this.resources);
	}

	init()
	{
		this.edge.addEventListener(EVENT_REDRAW, this.redrawevent);
		this.controls.addEventListener(EVENT_CAMERA_MOVED, this.visibilityevent);
		this.controls.addEventListener(EVENT_CAMERA_ACTIVE_STATUS, this.showallevent);

		this.updateTexture();
		this.updatePlanes();
		this.addToScene();
	}

	redraw()
	{
		this.removeFromScene();
		this.updateTexture();
		this.updatePlanes();
		this.addToScene();
	}

	/**
	 * Take every plane back out of the scene and release the ones this edge owns.
	 *
	 * Called by `redraw()` before rebuilding and by `remove()` at teardown, and in
	 * both cases the meshes are finished - so this is the release boundary. Before
	 * RM-003 A0 it disposed nothing, which meant every EVENT_REDRAW abandoned six
	 * geometries and up to six materials per wall face.
	 *
	 * `phantomPlanes` is detached but NOT released: a phantom plane is the model's
	 * own `HalfEdge.plane`, pushed here to make the picker's geometry visible.
	 * Disposing it would take out the plane the raycaster needs. It is also
	 * cleared now, which it was not before - `addToScene()` re-added phantoms that
	 * `removeFromScene()` had left in the array, so the two were asymmetric.
	 * Nothing pushes to it today, so that was latent rather than live.
	 */
	removeFromScene()
	{
		var scope = this;
		scope.planes.forEach((plane) => {
			scope.scene.remove(plane);
		});
		scope.basePlanes.forEach((plane) => {
			scope.scene.remove(plane);
		});
		scope.phantomPlanes.forEach((plane) => {
			scope.scene.remove(plane);
		});
		scope.resources.releaseAll();
		scope.planes = [];
		scope.basePlanes = [];
		scope.phantomPlanes = [];
	}

	addToScene()
	{
		var scope = this;
		this.planes.forEach((plane) => {
			scope.scene.add(plane);
		});
		this.basePlanes.forEach((plane) => {
			scope.scene.add(plane);
		});
		this.phantomPlanes.forEach((plane) => {
			scope.scene.add(plane);
		});
		this.updateVisibility();
	}

	showAll()
	{
		var scope = this;
		scope.visible = true;
		scope.planes.forEach((plane) =>
		{
			plane.material.transparent = !scope.visible;
			plane.material.opacity = 1.0;
			plane.visible = scope.visible;
		});

		this.wall.items.forEach((item) => {
			item.updateEdgeVisibility(scope.visible, scope.front);
		});
		this.wall.onItems.forEach((item) => {
			item.updateEdgeVisibility(scope.visible, scope.front);
		});
	}

	switchWireframe(flag)
	{
		var scope = this;
		scope.visible = true;
		scope.planes.forEach((plane) =>
		{
			plane.material.wireframe = flag;
		});
	}

	updateVisibility()
	{
		var scope = this;
		// finds the normal from the specified edge
		var start = scope.edge.interiorStart();
		var end = scope.edge.interiorEnd();
		var x = end.x - start.x;
		var y = end.y - start.y;
		// rotate 90 degrees CCW
		var normal = new Vector3(-y, 0, x);
		normal.normalize();

		// setup camera: scope.controls.object refers to the camera of the scene
		var position = scope.controls.object.position.clone();
		var focus = new Vector3((start.x + end.x) / 2.0,0,(start.y + end.y) / 2.0);
		var direction = position.sub(focus).normalize();

		// find dot
		var dot = normal.dot(direction);
		// update visible
		scope.visible = (dot >= 0);
		// show or hide planes
		scope.planes.forEach((plane) => {
			plane.material.transparent = !scope.visible;
			plane.material.opacity = (scope.visible)? 1.0 : 0.3;
		});
		scope.updateObjectVisibility();
	}

	updateObjectVisibility()
	{
	}

	updateTexture(callback)
	{
		var scope = this;
		// callback is fired when texture loads
		callback = callback || function () {scope.scene.needsUpdate = true;};
		var textureData = this.edge.getTexture();
		var stretch = textureData.stretch;
		var url = textureData.url;
		var scale = textureData.scale;

		// Release before replacing. Without this line every redraw of a room left
		// one GPU texture per wall surface behind, and redraw is wired to
		// EVENT_REDRAW - so the leak grew with editing, not with the design.
		releaseTexture(this.texture);
		this.texture = acquireTexture(url, callback);

		// A wall texture is a picture of a wall (S8). Set per clone, which is the
		// reason the cache hands out clones rather than one shared Texture: this
		// and the repeat below are per-wall, the decoded image is not.
		this.texture.colorSpace = SRGBColorSpace;

		if (!stretch)
		{
			var height = this.wall.height;
			var width = this.edge.interiorDistance();
			this.texture.wrapT = RepeatWrapping;
			this.texture.wrapS = RepeatWrapping;
			this.texture.repeat.set(width / scale, height / scale);
			this.texture.needsUpdate = true;
		}
	}

	/**
	 * The studio profile's wall surface.
	 *
	 * A painted wall under real light, rather than a photograph of one. Three
	 * differences from the classic material matter:
	 *
	 * - It is lit at all. MeshBasicMaterial ignores every light in the scene, so
	 *   in classic a room's corners, its ceiling join and the underside of a
	 *   soffit are all exactly the same value. This is the single biggest reason
	 *   the old viewer reads as flat.
	 * - `transparent` is not passed. It would not survive if it were:
	 *   `addToScene` calls `updateVisibility`, which assigns `transparent` and
	 *   `opacity` on every plane immediately and again on every camera move -
	 *   that is the wall-fade that lets you see into a room from outside. So the
	 *   constructor argument only ever described the first instant of the
	 *   material's life, and omitting it changes nothing.
	 * - The lightmap is dialled back (see this.renderProfile.wallLightMapIntensity).
	 *   At pi it exists to cancel a constant in the *basic* shader; here it is a
	 *   hand-painted vignette layered over genuine shading, and at full strength
	 *   it double-darkens every corner it already has a shadow in.
	 *
	 * @param {number} color
	 * @param {number} side A three side constant.
	 * @param {boolean} [lit=true] Whether to apply the vignette lightmap. The
	 * exterior filler does not get one - it is the back of the wall, and the
	 * vignette is painted for an interior.
	 * @returns {MeshStandardMaterial}
	 */
	makeStudioWallMaterial(color, side, lit)
	{
		var material = new MeshStandardMaterial({
			color: color,
			side: side,
			map: this.texture,
			roughness: this.renderProfile.wallRoughness,
			metalness: this.renderProfile.wallMetalness,
			envMapIntensity: this.renderProfile.environmentIntensity,
		});

		if (lit !== false)
		{
			material.lightMap = this.lightMap;
			material.lightMapIntensity = this.renderProfile.wallLightMapIntensity;
		}

		return material;
	}

	updatePlanes()
	{

		var extStartCorner = this.edge.getStart();
		var extEndCorner = this.edge.getEnd();

		if(extStartCorner == null || extEndCorner == null)
		{
			return;			
		}

		var color = 0xFFFFFF;
		var wallMaterial = isStudio(this.renderProfile) ? this.makeStudioWallMaterial(color, FrontSide) : new MeshBasicMaterial({
			color: color,
			side: FrontSide,
			map: this.texture,
			transparent: true,
			lightMap: this.lightMap,
			// x pi, to cancel the RECIPROCAL_PI three added to the basic material's
			// lightmap term. The two shaders, side by side:
			//
			//   r98    indirectDiffuse += texel * lightMapIntensity
			//   r185   indirectDiffuse += texel * lightMapIntensity * RECIPROCAL_PI
			//
			// so an unchanged lightmap arrives pi times darker and every wall in
			// the app renders muddy. The r185 line is inlined in
			// ShaderLib/meshbasic.glsl.js rather than living in an includable
			// ShaderChunk; the r98 line is in the frozen bundle, at
			// `git show legacy-demo:build/js/bp3djs.js`, in meshbasic_frag.
			//
			// Only the *basic* material is involved, and walls are the only thing
			// in this app carrying a lightMap. The lit materials moved by the same
			// factor in the opposite direction - r98's lights_fragment_maps had a
			// leading PI under #ifndef PHYSICALLY_CORRECT_LIGHTS and r185's does
			// not - but nothing here puts a lightMap on a lit material, so that
			// path never runs.
			//
			// NOT part of the S4 colour freeze, despite arriving with it. This
			// cancels a constant inside a shader; it is untouched by
			// ColorManagement.enabled and by outputColorSpace, both of which act
			// on values entering and leaving that shader rather than on the
			// arithmetic inside it. S8 turns the freeze off and deliberately keeps
			// this: deleting it would darken every wall in the application by pi.
			lightMapIntensity: Math.PI,
			opacity: 1.0,
			wireframe: false,
		});
		var fillerMaterial = isStudio(this.renderProfile) ? this.makeStudioWallMaterial(this.fillerColor, DoubleSide, false) : new MeshBasicMaterial({
			color: this.fillerColor,
			side: DoubleSide,
			map: this.texture,
			transparent: true,
			opacity: 1.0,
			wireframe: false,
		});

		// Registered at creation, not when attached (RM-003 A0). `fillerMaterial`
		// is only used inside the exterior branch below, so on an interior wall it
		// reaches no mesh at all - and a release pass that walked the meshes would
		// never find it. The mesh geometries and the helper-built materials are
		// registered as each plane is pushed.
		this.resources.register(wallMaterial);
		this.resources.register(fillerMaterial);

		// exterior plane for real exterior walls
		//If the walls have corners that have more than one room attached
		//Then there is no need to construct an exterior wall
		if(this.edge.wall.start.getAttachedRooms().length < 2 || this.edge.wall.end.getAttachedRooms().length < 2)
		{
			this.planes.push(this.resources.registerObject(this.makeWall(this.edge.exteriorStart(), this.edge.exteriorEnd(), this.edge.exteriorTransform, this.edge.invExteriorTransform, fillerMaterial)));
		}
		// interior plane
		this.planes.push(this.resources.registerObject(this.makeWall(this.edge.interiorStart(), this.edge.interiorEnd(), this.edge.interiorTransform, this.edge.invInteriorTransform, wallMaterial)));
		// bottom
		// put into basePlanes since this is always visible
		this.basePlanes.push(this.resources.registerObject(this.buildFillerUniformHeight(this.edge, 0, BackSide, this.baseColor)));
		if(this.edge.wall.start.getAttachedRooms().length < 2 || this.edge.wall.end.getAttachedRooms().length < 2)
		{
			this.planes.push(this.resources.registerObject(this.buildFillerVaryingHeights(this.edge, DoubleSide, this.fillerColor)));
		}

		// sides
		this.planes.push(this.resources.registerObject(this.buildSideFillter(this.edge.interiorStart(), this.edge.exteriorStart(), extStartCorner.elevation, this.sideColor)));
		this.planes.push(this.resources.registerObject(this.buildSideFillter(this.edge.interiorEnd(), this.edge.exteriorEnd(), extEndCorner.elevation, this.sideColor)));
	}

	// start, end have x and y attributes (i.e. corners)
	makeWall(start, end, transform, invTransform, material)
	{
		var v1 = this.toVec3(start);
		var v2 = this.toVec3(end);
		var v3 = v2.clone();
		var v4 = v1.clone();
		
		v3.y = this.edge.getEnd().elevation;
		v4.y = this.edge.getStart().elevation;
		
		var points = [v1.clone(), v2.clone(), v3.clone(), v4.clone()];

		points.forEach((p) => {p.applyMatrix4(transform);});

		var spoints = [new Vector2(points[0].x, points[0].y),new Vector2(points[1].x, points[1].y),new Vector2(points[2].x, points[2].y),new Vector2(points[3].x, points[3].y)];
		var shape = new Shape(spoints);

		// add holes for each wall item
		this.wall.items.forEach((item) => {
			var pos = item.position.clone();
			pos.applyMatrix4(transform);
			var halfSize = item.halfSize;
			var min = halfSize.clone().multiplyScalar(-1);
			var max = halfSize.clone();
			min.add(pos);
			max.add(pos);

			var holePoints = [new Vector2(min.x, min.y),new Vector2(max.x, min.y),new Vector2(max.x, max.y),new Vector2(min.x, max.y)];
			shape.holes.push(new Path(holePoints));
		});

		// ShapeGeometry triangulates the contour and its holes together. Since
		// r125 it returns a BufferGeometry rather than a Geometry - same export
		// name, different class - so the vertices move as an attribute and the
		// UVs become per-vertex instead of per-face-corner.
		//
		// Per-vertex is not a loss here: the old vertexToUv() below is a pure
		// function of the vertex position, so every face that shared a vertex
		// already computed the same UV for it. Writing it once per vertex
		// produces the same texture coordinates the old code produced three
		// times over.
		var geometry = new ShapeGeometry(shape);
		geometry.applyMatrix4(invTransform);

		// make UVs
		var totalDistance = Utils.distance(new Vector2(v1.x, v1.z), new Vector2(v2.x, v2.z));
		var height = this.wall.height;
		var position = geometry.getAttribute('position');
		var uvs = new Float32Array(position.count * 2);

		for (var i = 0; i < position.count; i++)
		{
			var uv = vertexToUv(position.getX(i), position.getY(i), position.getZ(i));
			uvs[i * 2] = uv.x;
			uvs[i * 2 + 1] = uv.y;
		}
		geometry.setAttribute('uv', new BufferAttribute(uvs, 2));

		// The old code also copied these into faceVertexUvs[1] to feed the
		// lightmap. A second UV set is no longer needed: a texture's `channel`
		// defaults to 0, so lightMap now samples the same `uv` attribute the
		// colour map does - which is exactly what the duplicated set achieved.
		geometry.computeVertexNormals();

		function vertexToUv(vx, vy, vz)
		{
			var x = Utils.distance(new Vector2(v1.x, v1.z), new Vector2(vx, vz)) / totalDistance;
			var y = vy / height;
			return new Vector2(x, y);
		}

		var mesh = new Mesh(geometry, material);
		mesh.name = 'wall';

		// Shadows, under studio only. The classic scene has castShadow false on
		// everything it builds, so the directional light has only ever shadowed
		// the loaded furniture - a room whose walls cast nothing, lit from above,
		// is why the old viewer has no sense of enclosure. Receiving matters as
		// much as casting: a wall that does not receive cannot show the shadow of
		// the sofa standing against it.
		mesh.castShadow = isStudio(this.renderProfile);
		mesh.receiveShadow = isStudio(this.renderProfile);

		return mesh;
	}

	/**
	 * The untextured surfaces: the top of a wall, the cut end where two walls
	 * meet at different heights, and the underside.
	 *
	 * In classic these are flat MeshBasicMaterial and always have been. Leaving
	 * them flat under the studio profile would be worse than leaving the whole
	 * scene flat, because the lit interior face and the unlit top edge of the
	 * same wall would sit side by side at visibly different values - the wall
	 * would look like it had a strip of paper stuck along the top.
	 *
	 * @param {number} color
	 * @param {number} side A three side constant.
	 * @returns {(MeshBasicMaterial|MeshStandardMaterial)}
	 */
	makeFillerMaterial(color, side)
	{
		if (!isStudio(this.renderProfile))
		{
			return new MeshBasicMaterial({color: color, side: side});
		}
		return new MeshStandardMaterial({
			color: color,
			side: side,
			roughness: this.renderProfile.wallRoughness,
			metalness: this.renderProfile.wallMetalness,
			envMapIntensity: this.renderProfile.environmentIntensity,
		});
	}

	buildSideFillter(p1, p2, height, color)
	{
		var points = [this.toVec3(p1), this.toVec3(p2), this.toVec3(p2, height), this.toVec3(p1, height) ];

		var geometry = triangleFanGeometry(points);

		var fillerMaterial = this.makeFillerMaterial(color, DoubleSide);
		var filler = new Mesh(geometry, fillerMaterial);
		return filler;
	}

	buildFillerVaryingHeights(edge, side, color)
	{
		var a = this.toVec3(edge.exteriorStart(), this.edge.getStart().elevation);
		var b = this.toVec3(edge.exteriorEnd(), this.edge.getEnd().elevation);
		var c = this.toVec3(edge.interiorEnd(), this.edge.getEnd().elevation);
		var d = this.toVec3(edge.interiorStart(), this.edge.getStart().elevation);
		
		
		
		var fillerMaterial = this.makeFillerMaterial(color, side);

		var geometry = triangleFanGeometry([a, b, c, d]);

		var filler = new Mesh(geometry, fillerMaterial);
		return filler;
	}

	buildFillerUniformHeight(edge, height, side, color)
	{
		var points = [this.toVec2(edge.exteriorStart()), this.toVec2(edge.exteriorEnd()), this.toVec2(edge.interiorEnd()),this.toVec2(edge.interiorStart())];

		var fillerMaterial = this.makeFillerMaterial(color, side);
		var shape = new Shape(points);
		var geometry = new ShapeGeometry(shape);
		var filler = new Mesh(geometry, fillerMaterial);
		filler.rotation.set(Math.PI / 2, 0, 0);
		filler.position.y = height;
		return filler;
	}

	toVec2(pos)
	{
		return new Vector2(pos.x, pos.y);
	}

	toVec3(pos, height)
	{
		height = height || 0;
		return new Vector3(pos.x, height, pos.y);
	}
}
