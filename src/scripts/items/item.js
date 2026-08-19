// @ts-check
import {Mesh, Matrix4, Object3D, Vector2, Vector3, Box3, BoxHelper, MeshBasicMaterial, AdditiveBlending} from 'three';
import {CanvasTexture, PlaneGeometry, DoubleSide, SRGBColorSpace} from 'three';
import {Color, PointLight} from 'three';
import {isStudio, renderProfile} from '../core/render_profile.js';
import {normaliseLamp, lampToJSON} from './lamp.js';
import {Utils} from '../core/utils.js';
import {disposeObject, disposeMaterial} from '../core/resource_registry.js';
import {Dimensioning} from '../core/dimensioning.js';


/**
 * JSDoc-only type imports (RM-005 C2).
 *
 * These names were already used in the annotations below and resolved to
 * nothing - 43 TS2304s across eleven files, every one of them a type the
 * project defines or three exports, named but never brought into scope. A
 * `@typedef` import costs no runtime code and no bundle bytes: it exists
 * entirely for the checker, which is the point of writing the JSDoc at all.

 *
 * @typedef {import('three').BufferGeometry} BufferGeometry
 * @typedef {import('three').Material} Material
 * @typedef {import('../model/model.js').Model} Model
 *
 * `color`, `emissive` and `texture` are not on `Material` - they belong to the
 * concrete subclasses - and this class reads all three off whatever a glTF
 * happened to supply. Optional, because a `MeshBasicMaterial` has no
 * `emissive` and the code already checks before touching it (RM-005 C2).
 *
 * @typedef {import('three').Material & {color?: any, emissive?: any, texture?: any}} ColorableMaterial
 */
/**
 * An Item is an abstract entity for all things placed in the scene, e.g. at
 * walls or on the floor.
 */
/**
 * The materials of a mesh, as an array, or null when it carries a single one.
 *
 * `Mesh.material` is `Material | Material[]` and `Item` has always handled both
 * - every colour path branches on `this.material.length`. Only the TYPE was
 * missing, and reading `.length` or `.color` off the union was 16 of this
 * file's errors (RM-005 C2).
 *
 * The test is `Array.isArray(m) && m.length`, which is exactly what
 * `material.length` evaluated to: a single material has no `length` and is
 * falsy, an array of one has length 1 and is truthy. Written out so the
 * equivalence is checkable rather than assumed.
 *
 * ## Why these are functions and not methods
 *
 * Because `getMetaData` is exercised by calling it on a hand-built object -
 * `Item.prototype.getMetaData.call({material: [...], ...})` - which is a
 * deliberate testing style in `tests/items-and-scene.test.js` and a good one:
 * it pins the save-file contract without building a scene. Methods added a
 * dependency on `this` that a stub does not have, and eight tests said so
 * immediately. A pure function of the material has no such dependency, and is
 * the honest shape for something that reads one argument.
 *
 * @param {Material|Material[]} material
 * @returns {?ColorableMaterial[]}
 */
function multiMaterial(material)
{
	return (Array.isArray(material) && material.length)
		? /** @type {ColorableMaterial[]} */ (material)
		: null;
}

/**
 * The single material, or the first of several.
 *
 * `color`, `emissive` and `texture` live on the concrete material classes
 * rather than on `Material`, so even a narrowed union does not have them -
 * hence `ColorableMaterial`, which names the three this file reads and leaves
 * them optional, because a `MeshBasicMaterial` has no `emissive` and the code
 * already checks.
 *
 * @param {Material|Material[]} material
 * @returns {ColorableMaterial}
 */
function singleMaterial(material)
{
	return /** @type {ColorableMaterial} */ (Array.isArray(material) ? material[0] : material);
}

/**
 * A half size is a magnitude, and a scale may be negative (RM-012 J4).
 *
 * Mirroring an item is a negative `scale.x`, which is the whole mechanism - it
 * is already in the save format, it costs no new field, and three's renderer
 * reverses the triangle winding for it by itself (`WebGLRenderer` computes
 * `frontFaceCW` from `matrixWorld.determinantAffine() < 0`, so a mirrored mesh
 * does not render inside out and no material's `side` has to be touched).
 *
 * What a negative scale must not do is make the item's *size* negative.
 * `halfSize` is read by `getWidth`, by the two dimension canvases, by the plan's
 * footprint projection and - the one that matters most - by
 * `Edge.createShape`, which pushes a rectangle of it into the wall's holes. A
 * mirrored door with a negative half width would cut a hole of negative width,
 * and nothing would say so.
 *
 * @param {Vector3} half The geometry's own half size, all positive.
 * @param {Vector3} scale Signed.
 * @returns {Vector3}
 */
function absScale(half, scale)
{
	return new Vector3(
		half.x * Math.abs(scale.x),
		half.y * Math.abs(scale.y),
		half.z * Math.abs(scale.z),
	);
}

export class Item extends Mesh
{
	/**
	 * Constructs an item.
	 *
	 * Called by Scene's loader callback once a model file has been fetched and
	 * flattened - see `Scene.setItemLoader`. The geometry and materials arrive
	 * already merged into a single BufferGeometry with material groups
	 * (core/geometry_merge.js), whatever format they were loaded from.
	 *
	 * @param {Model} model The owning model; `model.scene` is where this lands.
	 * @param {Object} metadata `{itemName, itemType, format, modelUrl,
	 *        resizable, materialColors}`, as remapped from the save file by
	 *        Model.newRoom.
	 * @param {BufferGeometry} geometry The merged geometry. Re-centred on its
	 *        own bounding box here, so callers need not.
	 * @param {(Material|Material[])} material One material, or one per group.
	 * @param {Vector3} [position] Where to put it. Omitted for a fresh drop,
	 *        which is positioned later by the placement logic.
	 * @param {number} [rotation] Y rotation in radians.
	 * @param {Vector3} [scale] Applied through setScale, so the label canvases
	 *        and the pick box follow.
	 */
	constructor(model, metadata, geometry, material, position, rotation, scale)
	{
		super();

		this.model = model;
		this.metadata = metadata;

		/**
		 * Which item in the design this is (RM-003 A3).
		 *
		 * ## Why it is not called `id`
		 *
		 * Because it cannot be. `Item extends Mesh extends Object3D`, and three
		 * defines `Object3D.id` as a **non-writable** numeric counter -
		 * `Object.defineProperty(this, 'id', {value: _object3DId++})`. Assigning to
		 * it does nothing in sloppy mode and throws in strict, and either way
		 * `item.id` would still be a number that changes every time the item is
		 * rebuilt. This is the second name collision A0's `Item.remove()` finding
		 * warned about, and the same rule applies: an `Item` lives in two worlds
		 * and does not get to name a field whatever it likes.
		 *
		 * ## What it is for
		 *
		 * Undo restores a design by loading a snapshot, and until A3 that meant
		 * clearing every item and re-fetching every model - so undoing a corner
		 * nudge re-downloaded the sofa. `Model.newRoom()` now reconciles by this
		 * id, keeping the items the snapshot still has and touching only the
		 * difference, which is finding H-6.
		 *
		 * Persisted, unlike the model's other assigned ids, and it has to be: a
		 * snapshot is a file, and reconciling against it means both sides naming
		 * the same item. Additive and optional - an item from an older file is
		 * assigned one on load and carries it from the next save.
		 *
		 * @type {string}
		 */
		this.designId = (metadata && metadata.designId) ? metadata.designId : Utils.guide();

		/** */
		/** @type {?Mesh} The red halo shown by showError(); replaced on each use. */
		this.errorGlow = new Mesh();
		/** */
		this.hover = false;
		/** */
		this.selected = false;
		/** */
		this.highlighted = false;
		/** */
		this.error = false;
		/** */
		// Re-picked in S8, from 0x444444, to hold the hover highlight at the same
		// strength it has always had. This value is never read back or
		// serialized - setHex() writes it onto material.emissive and nothing
		// round-trips it - so it is purely how bright a hovered item glows.
		// Under the S4 freeze 0x444444 reached the shader as linear 0.2667; with
		// colour management on the same literal decodes to 0.0578, which is a
		// highlight 4.6x dimmer and easy to miss. 0x8d8d8d decodes to 0.2664.
		this.emissiveColor = 0x8d8d8d;
		/** Does this object affect other floor items */
		this.obstructFloorMoves = true;
		/** */
		this.position_set = false;
		/** Show rotate option in context menu */
		this.allowRotate = true;
		/** */
		this.fixed = false;
		/** dragging */
		this.dragOffset = new Vector3();
		/** */
		this.halfSize = new Vector3(0,0,0);
		/** @type {?BoxHelper} Built by init(), released by dispose(). */
		this.bhelper = null;

		this.scene = this.model.scene;
		this._freePosition = true;

		// Removed with the `isgltf` flag: a second construction path that wrapped
		// the loaded object in an invisible wireframe BoxGeometry and added it as
		// a child. It predated the merge pipeline (S3), and by the time that
		// landed nothing could reach it - Scene's loader callback declares
		// `(geometry, materials)` and both of its call sites pass the merged pair,
		// so the flag defaulted to false on every item ever built. It was also
		// wrong by then: it left `this.material` as the invisible box's material,
		// which is what setMaterialColor would have painted and getMetaData
		// serialized.
		/**
		 * The storey this item stands on (RM-010 G1).
		 *
		 * Set by `Scene.addItem` when the item joins a level, and null for an item
		 * built by hand in a test. It exists because an item genuinely has to know
		 * *which* plan it is on: `placeInRoom`, `isValidPosition`, `closestWallEdge`
		 * and `closestRoofPoint` all ask a floorplan a question about this item,
		 * and reading `model.floorplan` would ask it of whichever storey the user
		 * happens to be looking at.
		 *
		 * A back-reference rather than a level field on a shared list, which is the
		 * distinction RM-010 V-5 drew: the list is already scoped by construction,
		 * and this is the parent link every scene-graph object has anyway.
		 *
		 * @type {?import('../model/level.js').Level}
		 */
		this.level = null;
		this.geometry = geometry;
		this.material = material;
		// center in its boundingbox
		this.geometry.computeBoundingBox();
		var box = this.bounds();
		this.geometry.applyMatrix4(new Matrix4().makeTranslation(- 0.5 * (box.max.x + box.min.x),- 0.5 * (box.max.y + box.min.y),- 0.5 * (box.max.z + box.min.z)));
		this.geometry.computeBoundingBox();

		var firstMaterial = singleMaterial(this.material);
		if(!firstMaterial.color)
		{
			firstMaterial.color = new Color('#FFFFFF');
		}
		this.wirematerial = new MeshBasicMaterial({color: 0x000000, wireframe: true});

		this.errorColor = 0xff0000;

		/**
		 * Which material slots carry a colour somebody chose, as opposed to the
		 * colour the model shipped with.
		 *
		 * getMetaData() used to write every material's colour into the save file
		 * on every save. That turned "what this model looks like" into persisted
		 * user data, and it is why a design saved before S8 reloads darker than it
		 * was authored: for a glTF model the value came from `baseColorFactor`, a
		 * raw linear float, and the frozen pipeline quantised it straight to bytes
		 * that the managed pipeline now reads as sRGB. The field could not be
		 * cleaned up because nothing could tell an authored colour from a chosen
		 * one - they were written identically.
		 *
		 * This is what tells them apart. A slot lands here when setMaterialColor
		 * puts a colour in it, or when a save file supplies one; anything else is
		 * the model's own and is not the save file's business.
		 *
		 * @type {Set<number>}
		 */
		this._pickedColorSlots = new Set();

		this.resizable = metadata.resizable;
		/**
		 * What this item emits, or null if it emits nothing (RM-011 H2, W-11).
		 *
		 * Read from the catalog row when the item is placed and from the saved
		 * record when a design is opened, which is the same two paths `opening`,
		 * `stair` and `structure` take - the difference being that those three
		 * belong to one `Item` subclass each and a lamp can be any of them. A
		 * pendant is a `RoofItem`, a standard lamp is a `FloorItem` and a sconce
		 * is a `WallItem`, so this lives on the base class.
		 *
		 * @type {?import('./lamp.js').Lamp}
		 */
		this.lamp = metadata.lamp ? normaliseLamp(metadata.lamp) : null;
		/** @type {?import('three').PointLight} Built by `initObject`. */
		this.bulb = null;

		this.castShadow = true;
		this.receiveShadow = false;

		this.originalmaterial = material;
		this.texture = singleMaterial(this.material).texture;

		this.position_set = false;
		if (position)
		{
			this.position.copy(position);
			this.position_set = true;
		}

		this.halfSize = this.objectHalfSize();
		this.canvasWH = document.createElement('canvas');
		this.canvasWH.width = this.getWidth()+1.0;
		this.canvasWH.height = this.getHeight()+1.0;

		this.canvascontextWH = this.canvasWH.getContext('2d');
		this.canvasTextureWH = new CanvasTexture(this.canvasWH);
		// A 2D canvas paints in sRGB, so say so (S8). Affects the label card's
		// translucent backing and the glyph antialiasing; the pure-black and
		// pure-red ink is unmoved, since 0 and 255 are the fixed points of the
		// transfer function.
		this.canvasTextureWH.colorSpace = SRGBColorSpace;
		this.canvasMaterialWH = new MeshBasicMaterial({map:this.canvasTextureWH, side: DoubleSide, transparent:true});
		this.canvasPlaneWH = new Mesh(new PlaneGeometry(this.getWidth(), this.getHeight(), 1, 1), this.canvasMaterialWH);
		this.canvasPlaneWH.scale.set(1, 1, 1);
		this.canvasPlaneWH.position.set(0, 0, this.getDepth()*0.5 + 0.3);

		this.canvasWD = document.createElement('canvas');
		this.canvasWD.width = this.getWidth()+1.0;
		this.canvasWD.height = this.getDepth()+1.0;

		this.canvascontextWD = this.canvasWD.getContext('2d');
		this.canvasTextureWD = new CanvasTexture(this.canvasWD);
		this.canvasTextureWD.colorSpace = SRGBColorSpace;
		this.canvasMaterialWD = new MeshBasicMaterial({map:this.canvasTextureWD, side: DoubleSide, transparent:true});
		this.canvasPlaneWD = new Mesh(new PlaneGeometry(this.getWidth(), this.getDepth(), 1, 1), this.canvasMaterialWD);
		this.canvasPlaneWD.rotateX(-Math.PI * 0.5);
		this.canvasPlaneWD.scale.set(1, 1, 1);
		this.canvasPlaneWD.position.set(0, this.getHeight()*0.5 + 0.3, 0);
		this.canvasPlaneWH.visible = this.canvasPlaneWD.visible = false;

    this.add(this.canvasPlaneWH);
		this.add(this.canvasPlaneWD);
		this.resizeProportionally = true;

		if (rotation)
		{
			this.rotation.y = rotation;
		}

		/**
		 * Whether the scale came from a document rather than from the catalog.
		 *
		 * `initObject` applies the model's unit scale to a freshly placed item and
		 * must not apply it to a restored one - a saved design already records the
		 * scale it was placed at, and multiplying it again would grow the item by
		 * that factor on every open. This is the one bit that tells the two apart,
		 * and it is a flag rather than a test on `this.scale` because a document is
		 * perfectly entitled to record a scale of exactly 1.
		 *
		 * @type {boolean}
		 */
		this._scaleFromDocument = (scale != null);
		if (scale != null)
		{
			this.setScale(scale.x, scale.y, scale.z);
		}

		if(this.metadata.materialColors)
		{
			if(this.metadata.materialColors.length)
			{
				// A null entry means "this slot was never picked, use the model's
				// own colour" - the sparse form save format 2.0.0 writes. A 0.0.2a
				// file has a colour in every slot, because that is what the old
				// writer emitted, and every one of them is applied exactly as
				// before. Nothing anyone has saved changes appearance.
				var slotMaterials = multiMaterial(this.material);
				if(slotMaterials)
				{
					for (var i=0;i<this.metadata.materialColors.length;i++)
					{
						if(this.metadata.materialColors[i] == null)
						{
							continue;
						}
						slotMaterials[i].color = new Color(this.metadata.materialColors[i]);
						this._pickedColorSlots.add(i);
					}
				}
				else if(this.metadata.materialColors[0] != null)
				{
					singleMaterial(this.material).color = new Color(this.metadata.materialColors[0]);
					this._pickedColorSlots.add(0);
				}
			}
		}
	}
	
	get freePosition()
	{
		return this._freePosition;
	}

	updateCanvasTexture(canvas, context, material, w, h, wPrefix, hPrefix)
	{
		if(w < 1 || h < 1)
		{
			return;
		}

		wPrefix = (wPrefix) ? wPrefix: 'w:';
		hPrefix = (hPrefix) ? hPrefix: 'h:';

		w *= 3;
		h *= 3;

		canvas.width = w;
		canvas.height = h;
		canvas.style.letterSpacing = '-22.5px';

		context.font = 'bold 45pt Courier';
		context.fillStyle = '#DADADA99';
		context.fillRect(0, 0, w, h);
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		context.lineWidth = 3;
		context.setLineDash([1, 2]);
		context.strokeStyle = '#000000';

		context.beginPath();
		context.moveTo(0,h*0.5);
		context.lineTo(w,h*0.5);
		context.closePath();
		context.stroke();

		context.beginPath();
		context.moveTo(w * 0.125, 0);
		context.lineTo(w * 0.125, h);
		context.closePath();
		context.stroke();

		context.lineWidth = 1;
		context.setLineDash([0]);
		context.strokeStyle = '#0000FF';
		context.strokeText(wPrefix+Dimensioning.cmToMeasure(w/3), w*0.5, h*0.5);

		context.fillStyle = '#FF0000';
		context.fillText(wPrefix+Dimensioning.cmToMeasure(w/3), w*0.5, h*0.5);

		context.translate(w*0.125, 0);
		context.rotate(Math.PI * 0.5);
		context.strokeStyle = '#0000FF';
		context.strokeText(hPrefix+Dimensioning.cmToMeasure(h/3), h*0.5, 0);

		context.fillStyle = '#FF0000';
		context.fillText(hPrefix+Dimensioning.cmToMeasure(h/3), h*0.5, 0);
		context.restore();
		material.map.needsUpdate = true;
	}

	switchWireframe(flag)
	{
		this.material = (flag)? this.wirematerial : this.originalmaterial;
	}

	/**
	 * Take this item out of the design - or, given arguments, detach children.
	 *
	 * ## The shadowing RM-003 A0 found and deferred
	 *
	 * `Item extends Mesh`, and this method used to be `remove()` with no
	 * parameters, meaning "take me out of the design". `Object3D.remove(child)`
	 * means something entirely different, so detaching a child of an item - one
	 * of its two dimension-label planes, say - through the ordinary call
	 * re-entered item removal and recursed until the stack gave out.
	 *
	 * A0 wrote that up in `core/resource_registry.js`, worked around it there by
	 * going through `Object3D.prototype.remove`, and called the shadowing itself
	 * "a genuine hazard... but `Item.remove()` is public API, so renaming it is a
	 * breaking change and belongs in its own change rather than in A0".
	 *
	 * ## Why it is fixed here rather than deferred again
	 *
	 * Because it stopped being a judgement call and became a type error. TS2416:
	 * this property "is not assignable to the same property in base type Mesh",
	 * which is the checker describing A0's paragraph. RM-005 C2 fixes the defects
	 * the checker names, and this is one.
	 *
	 * Nothing is renamed, so nothing breaks. `remove()` with no arguments does
	 * exactly what it did, which is the only form anything calls - the two
	 * application call sites, the `WallItem` listener, and the inspector. What
	 * changes is the form that was already broken: `remove(child)` now detaches
	 * the child instead of recursing, which is what a caller passing an argument
	 * has always been asking for.
	 *
	 * @param {...import('three').Object3D} objects Children to detach. Passing
	 *        none means "remove me from the design".
	 * @returns {this}
	 */
	remove(...objects)
	{
		if (objects.length)
		{
			Object3D.prototype.remove.apply(this, objects);
			return this;
		}
		this.scene.removeItem(this);
		return this;
	}

	/** */
	resize(height, width, depth)
	{
		var x = width / this.getWidth();
		var y = height / this.getHeight();
		var z = depth / this.getDepth();

		if(this.resizeProportionally)
		{
			if(Math.abs(width - this.getWidth()) > 0.1)
			{
				this.setScale(x, x, x);
			}
			else if(Math.abs(height - this.getHeight()) > 0.1)
			{
				this.setScale(y, y, y);
			}
			else
			{
				this.setScale(z, z, z);
			}
			return;
		}
		this.setScale(x, y, z);
	}

	getMaterial()
	{
		return this.material;
	}

	getMaterialColor(index)
	{
		index = (index)? index : 0;
		var materials = multiMaterial(this.material);
		if(materials)
		{
			return '#'+materials[index].color.getHexString();
		}
		return '#'+singleMaterial(this.material).color.getHexString();
	}

	// Always send an hexadecimal string value for color - ex. '#FFFFFF'
	/**
	 * Set one material's colour from a CSS hex string.
	 *
	 * ## The working-space convention, pinned in S8
	 *
	 * Hex in, hex out, and the hex is always **sRGB** - the space the value was
	 * picked in, and the space `<input type="color">` hands over. `new Color(hex)`
	 * decodes it into the linear working space and `getHexString()` encodes it
	 * back, so `new Color('#' + item.getMaterialColor(i).slice(1))` returns the
	 * same eight bits it started with. That round trip is byte-exact and, worth
	 * knowing, was byte-exact under the S4 freeze too - both halves moved
	 * together. It is not evidence the pipeline is right, which is why the tests
	 * assert the linear value a Color holds rather than the hex it prints.
	 *
	 * ## Why this records the slot
	 *
	 * See `_pickedColorSlots` in the constructor. `getMetaData()` used to write
	 * every material's colour on every save, which is what made a design saved
	 * before S8 reload darker than it was authored - the value came from
	 * `baseColorFactor`, a raw linear float, and the managed pipeline reads it as
	 * sRGB. That could not be cleaned up while an authored colour and a chosen
	 * one were written identically. Recording the slot here is what separates
	 * them, so a save file carries choices and nothing else.
	 *
	 * Old files are still read exactly as they were written, and there is
	 * deliberately no re-interpretation of their values: nothing in a 0.0.2a file
	 * says whether a given colour is the model's or the user's, so converting
	 * them wholesale would correct the first and corrupt the second. What changes
	 * is that the ambiguity stops being created. Anyone whose pre-S8 furniture
	 * loads too dark can re-pick the colour once, and the file it saves will say
	 * exactly what they meant.
	 *
	 * @param {string} color A CSS hex string, interpreted as sRGB.
	 * @param {number} index Which material, for a multi-material item.
	 */
	setMaterialColor(color, index)
	{
		var c = new Color(color);
		var materials = multiMaterial(this.material);
		if(materials)
		{
			index = (index) ? index : 0;
			materials[index].color = c;
			this._pickedColorSlots.add(index);
			return;
		}
		singleMaterial(this.material).color = c;
		this._pickedColorSlots.add(0);
	}

	/**
	 * Set the scale to exactly this, rather than multiplying by it (RM-003 A3).
	 *
	 * `setScale` below is *relative*: it multiplies into the current scale, which
	 * is what a resize gesture wants. Restoring a snapshot wants the opposite, and
	 * expressing "make it 1.0" as a relative factor of `1 / current` does not come
	 * back to 1.0 - `1.5 * (1 / 1.5)` is `0.9999999999999999`, which serializes
	 * differently, which makes an undo produce a document that differs from the
	 * one it restored. The round-trip suite found that on its second run.
	 *
	 * `halfSize` is recomputed from the geometry rather than scaled, so it cannot
	 * drift either: the invariant is that it is the geometry's half size times the
	 * scale, and this states it directly instead of accumulating it.
	 *
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 */
	applyScale(x, y, z)
	{
		this.scale.set(x, y, z);
		this.halfSize = absScale(this.objectHalfSize(), this.scale);
		this.resized();
		if(this.bhelper)
		{
			this.bhelper.update();
		}

		this.updateCanvasTexture(this.canvasWH, this.canvascontextWH, this.canvasMaterialWH, this.getWidth(), this.getHeight(), 'w:', 'h:');
		this.updateCanvasTexture(this.canvasWD, this.canvascontextWD, this.canvasMaterialWD, this.getWidth(), this.getDepth(), 'w:', 'd:');

		this.scene.needsUpdate = true;
	}

	/** Multiply the current scale by this. See {@link Item#applyScale} for the
	 * absolute form and why both exist. */
	setScale(x, y, z)
	{
		var scaleVec = new Vector3(x, y, z);
		scaleVec.multiply(this.scale);
		this.scale.set(scaleVec.x, scaleVec.y, scaleVec.z);
		// From the geometry rather than by multiplying the previous half size,
		// which is what `applyScale` already does and for the same reason - and
		// which is what keeps a mirrored item's size positive (RM-012 J4). See
		// `absScale`.
		this.halfSize = absScale(this.objectHalfSize(), this.scale);
		this.resized();
		if(this.bhelper)
		{
			this.bhelper.update();
		}

		this.updateCanvasTexture(this.canvasWH, this.canvascontextWH, this.canvasMaterialWH, this.getWidth(), this.getHeight(), 'w:', 'h:');
		this.updateCanvasTexture(this.canvasWD, this.canvascontextWD, this.canvasMaterialWD, this.getWidth(), this.getDepth(), 'w:', 'd:');

		this.scene.needsUpdate = true;

	}

	getProportionalResize()
	{
		return this.resizeProportionally;
	}

	setProportionalResize(flag)
	{
		this.resizeProportionally = flag;
	}

	/** */
	setFixed(fixed)
	{
		this.fixed = fixed;
	}

	/** Subclass can define to take action after a resize. */
	resized()
	{
		this.placeBulb();
	}

	/**
	 * Give this item its light, if it has one (RM-011 H2).
	 *
	 * **Studio only, and off rather than dimmed under classic.** `classic` draws
	 * walls with an unlit `MeshBasicMaterial` and floors with Phong: a point light
	 * would reach the floors and nothing else, which is a lamp that lights the
	 * carpet and not the room. H2's acceptance says every light it adds is off, or
	 * free, under classic, and not building one is the cheapest way to be both.
	 *
	 * The bulb is a **child of the item**, so it moves, turns and scales with it
	 * for free - dragging a lamp across a room takes its light with it and nothing
	 * here has to hear about the move.
	 *
	 * @returns {void}
	 */
	buildBulb()
	{
		if (!this.lamp || this.bulb || !isStudio(renderProfile))
		{
			return;
		}
		// `power` is lumens; three divides by 4*pi to get the candela its shader
		// wants. Saying it in lumens is what makes 800 checkable against a box in
		// a shop - see the docblock in `lamp.js`.
		var bulb = new PointLight(new Color(this.lamp.color), 1, this.lamp.range, 2);
		bulb.power = this.lamp.brightness;
		// Named for what it is, and findable: the browser tier counts these.
		bulb.name = 'bulb';
		// See `lamp.js`: a shadow-casting point light is a cube of six renders,
		// and four lamps in a room would be twenty-four. The key casts the
		// shadows; lamps light surfaces.
		bulb.castShadow = false;
		this.bulb = bulb;
		this.add(bulb);
		this.placeBulb();
	}

	/**
	 * Put the bulb where the description says, as a fraction of the item's height.
	 *
	 * Derived on every resize rather than stored, so a lamp scaled to twice its
	 * height keeps its bulb at the top rather than halfway up the shade. The
	 * offset is from the item's own centre, which is where a child's local origin
	 * sits.
	 *
	 * @returns {void}
	 */
	placeBulb()
	{
		if (!this.bulb || !this.lamp)
		{
			return;
		}
		// In the item's own space, so the parent's scale applies on top - which is
		// why this divides by it. Without that a lamp scaled to 2x would put its
		// bulb twice as far from its own centre as its own top.
		var height = this.halfSize.y * 2;
		var scale = this.scale.y || 1;
		this.bulb.position.set(0, ((this.lamp.at - 0.5) * height) / scale, 0);
	}

	/** */
	getHeight()
	{
		return this.halfSize.y * 2.0;
	}

	/** */
	getWidth()
	{
		return this.halfSize.x * 2.0;
	}

	/**
	 * Flip this item on one horizontal axis (RM-012 J4).
	 *
	 * A negative scale, which is the whole mechanism and is why RM-007 calls this
	 * one of the three cheap verbs. It costs no new field - `scale_x` has been in
	 * the save format since the format existed - so a mirrored item round-trips
	 * without the file version moving.
	 *
	 * ## The winding reversal, named up front and then measured
	 *
	 * RM-007 names it as the risk: *"a mirrored mesh renders inside out unless
	 * the material's side is handled"*. Measured against the three in this tree,
	 * it is already handled and not by us. `WebGLRenderer` computes
	 * `frontFaceCW` from `object.matrixWorld.determinantAffine() < 0` and flips
	 * the face winding for exactly this case. So no material's `side` is touched
	 * here - which matters, because 139 of the 168 catalog models are
	 * `KHR_materials_unlit` and forcing `DoubleSide` on them would change how
	 * every one of them renders in order to fix a problem that does not exist.
	 *
	 * ## Y is deliberately not offered
	 *
	 * Mirroring vertically turns a chair upside down, which is a thing nobody
	 * doing interior layout wants and which `boundMove` would immediately fight
	 * over for a wall-bound item. Rotation is the verb for the other orientations.
	 *
	 * @param {string} [axis] `'x'` (default) or `'z'`.
	 * @returns {boolean} whether the item is mirrored *after* the flip.
	 */
	mirror(axis)
	{
		var x = this.scale.x;
		var z = this.scale.z;
		if (axis === 'z') { z = -z; }
		else { x = -x; }
		// The absolute form, so the half size is restated from the geometry rather
		// than accumulated - see `applyScale`, and `absScale` for why the sign is
		// dropped on the way.
		this.applyScale(x, this.scale.y, z);
		return this.mirrored();
	}

	/**
	 * Is this item mirrored?
	 *
	 * By the sign of the scale's product, which is what "mirrored" means: an odd
	 * number of negative axes reverses handedness, and two of them are a
	 * 180-degree rotation rather than a reflection. It is also exactly the
	 * quantity the renderer tests to decide the winding.
	 *
	 * @returns {boolean}
	 */
	mirrored()
	{
		return (this.scale.x * this.scale.y * this.scale.z) < 0;
	}

	/** */
	getDepth()
	{
		return this.halfSize.z * 2.0;
	}

	/** */
	placeInRoom()
	{

	}

	/**
	 * Bring the model into centimetres, using the number its kit declares
	 * (RM-012 J1; RM-009 U-3 assigned the fix here).
	 *
	 * ## What this replaced
	 *
	 *     // An ugly hack to increase the size of gltf models
	 *     if (this.halfSize.x < 1.0)
	 *     {
	 *         this.resize(this.getHeight()*300, this.getWidth()*300, this.getDepth()*300);
	 *     }
	 *
	 * The comment was right about itself, and the number was wrong. Two guesses
	 * were stacked in four lines. **Which models need scaling** was guessed from
	 * one axis of one item - a wide, flat rug authored in centimetres has a
	 * half-extent under 1.0 on no axis and a tall thin lamp authored in kit units
	 * has one on two, so the test answers a question about units by measuring a
	 * shape. And **how much** was guessed at 300, which RM-009 U-3 measured wrong
	 * and J1 has now measured properly: the Kenney kit is on a 2 m grid, so the
	 * factor is 200. At 300 that kit's dining chair is 141 cm tall.
	 *
	 * Both guesses are replaced by one declared number. `tools/split-catalog.mjs`
	 * resolves each row's `unitScale` from the kit it came from and writes it into
	 * the bundled index, so it is on the metadata by the time an item is placed
	 * and no fetch stands between clicking a chair and having one.
	 *
	 * ## Why a saved design is left alone
	 *
	 * A document records `scale_x`, `scale_y` and `scale_z`, and those are
	 * absolute. An item restored from one is already the size it was saved at, so
	 * applying the unit scale again would multiply it by 200 on every open. The
	 * constructor sets `_scaleFromDocument` when a scale is supplied, and this
	 * returns.
	 *
	 * That is also why designs saved before this change do not move. A Kenney
	 * chair placed under the old hack is recorded at scale 300 and stays at 300 -
	 * a document is what its author saved, not what this build would have saved.
	 * Anything placed from the catalog after this change is 200, which is the size
	 * the model actually is.
	 */
	applyUnitScale()
	{
		var scale = this.metadata ? this.metadata.unitScale : null;
		if (this._scaleFromDocument || !(scale > 0) || scale === 1)
		{
			return;
		}
		this.setScale(scale, scale, scale);
	}

	/** */
	initObject()
	{
		this.placeInRoom();
		this.applyUnitScale();
		this.bhelper = new BoxHelper(this);
		this.scene.add(this.bhelper);
		this.bhelper.visible = false;
		// Guarded rather than unconditional: almost nothing in the catalog is a
		// lamp, and an item that emits nothing should not pay a call to find out.
		if (this.lamp)
		{
			this.buildBulb();
		}
		// select and stuff
		this.scene.needsUpdate = true;

	}

	/**
	 * Release everything this item built (RM-003 A0).
	 *
	 * ## What this used to be
	 *
	 * An empty method. `Scene.removeItem()` called it and then took the item out
	 * of the three scene, so deleting a chair released nothing at all: not the
	 * merged `BufferGeometry`, not the glTF materials or the textures
	 * `GLTFLoader` created for them - those never enter the shared texture cache,
	 * so RM-002 R-04 does not cover them - not the two label canvases with their
	 * geometry, textures and materials, and not the wireframe material.
	 *
	 * One object was worse than undisposed. `initObject()` does
	 * `this.scene.add(this.bhelper)`, and nothing anywhere removed it: a deleted
	 * item left its selection box in the scene graph, still pointing at an object
	 * that was no longer in it.
	 *
	 * ## Subclasses must call this
	 *
	 * `WallItem` overrides `removed()` to detach itself from its wall. Any
	 * override must call `super.removed()` - it is the one migration note in A0
	 * and it is in the changelog.
	 *
	 * Idempotent: three's `dispose()` is, and the scene removals are no-ops the
	 * second time.
	 */
	removed()
	{
		// The selection box, which is a sibling in the scene rather than a child of
		// this item - so removing the item does not take it with it.
		if (this.bhelper)
		{
			this.scene.remove(this.bhelper);
			disposeObject(this.bhelper);
			this.bhelper = null;
		}

		this.hideError();
		disposeObject(this.errorGlow);
		this.errorGlow = null;

		// The label planes are children of this item, so disposeObject(this) would
		// reach them - but it would also dispose whichever of originalmaterial and
		// wirematerial is currently swapped in and miss the other. Both are named
		// explicitly instead.
		disposeObject(this.canvasPlaneWH);
		disposeObject(this.canvasPlaneWD);
		if (this.canvasTextureWH)
		{
			this.canvasTextureWH.dispose();
		}
		if (this.canvasTextureWD)
		{
			this.canvasTextureWD.dispose();
		}

		if (this.geometry)
		{
			this.geometry.dispose();
		}
		disposeMaterial(this.originalmaterial);
		disposeMaterial(this.wirematerial);

		// A PointLight holds no GPU resource of its own, but it is in the scene
		// graph and the renderer counts it - an undisposed one keeps a deleted lamp
		// lighting the room. A0's rule: whatever this object added, it removes.
		if (this.bulb)
		{
			this.remove(this.bulb);
			this.bulb.dispose();
			this.bulb = null;
		}
	}

	/** on is a bool */
	updateHighlight()
	{
		var on = this.hover || this.selected;
		this.highlighted = on;
		var hex = on ? this.emissiveColor : 0x000000;
		if(this.material)
		{
			// Only the lit materials carry an emissive channel. A model whose
			// materials include a MeshBasicMaterial - the wireframe and pick
			// helpers, or anything a glTF declares unlit - would throw here on
			// hover, so the property is checked rather than assumed.
			var glowing = multiMaterial(this.material);
			if(glowing)
			{
				glowing.forEach((material) => {
					if(material.emissive)
					{
						material.emissive.setHex(hex);
					}
				});
			}
			else
			{
				var only = singleMaterial(this.material);
				if(only.emissive)
				{
					only.emissive.setHex(hex);
					only.emissive = new Color(hex);
				}
			}
		}

	}

	/** */
	mouseOver()
	{
		this.hover = true;
		this.updateHighlight();
	}

	/** */
	mouseOff()
	{
		this.hover = false;
		this.updateHighlight();
	}

	/** */
	setSelected()
	{
		this.setScale(1, 1, 1);
		this.selected = true;
		// `bhelper` exists between init() and dispose(); selecting outside that
		// window is a caller error rather than something to crash on (RM-005 C2).
		if (this.bhelper) { this.bhelper.visible = true; }
		this.canvasPlaneWH.visible = this.canvasPlaneWD.visible = true;
		this.updateHighlight();
	}

	/** */
	setUnselected()
	{
		this.selected = false;
		if (this.bhelper) { this.bhelper.visible = false; }
		this.canvasPlaneWH.visible = this.canvasPlaneWD.visible = false;
		this.updateHighlight();
	}

	/** intersection has attributes point (vec3) and object (THREE.Mesh) */
	clickPressed(intersection)
	{
		this.dragOffset.copy(intersection.point).sub(this.position);
	}

	/** */
	clickDragged(intersection)
	{
		if (intersection)
		{
			this.moveToPosition(intersection.point.sub(this.dragOffset), intersection);
		}
	}

	/** */
	rotate(intersection)
	{
		if (intersection)
		{
			var angle = Utils.angle(new Vector2(0, 1), new Vector2(intersection.point.x - this.position.x,intersection.point.z - this.position.z));
			var snapTolerance = Math.PI / 16.0;
			// snap to intervals near Math.PI/2
			for (var i = -4; i <= 4; i++)
			{
				if (Math.abs(angle - (i * (Math.PI / 2))) < snapTolerance)
				{
					angle = i * (Math.PI / 2);
					break;
				}
			}
			this.rotation.y = angle;
		}
	}

	/** */
	/**
	 * @param {import('three').Vector3} vec3
	 * @param {Object} [intersection] Ignored here. Declared because `WallItem`
	 *        overrides this and DOES use it, and `Item.clickDragged` calls
	 *        through `this` - so the two-argument call at line 665 is correct for
	 *        a wall item and only looked wrong against this signature (RM-005 C2).
	 *        Dropping the argument instead would have broken wall placement.
	 */
	// eslint-disable-next-line no-unused-vars -- see the docblock: subclasses use it
	moveToPosition(vec3, intersection)
	{
		this.position.copy(vec3);
		if(this.bhelper)
		{
			this.bhelper.update();
		}
	}

	/**
	 * Whether this item holds a reference into the floorplan graph (RM-003 A3).
	 *
	 * False here and true for anything wall-bound. It decides whether
	 * `Model.newRoom` may keep this item across a document load: the floorplan is
	 * destroyed and rebuilt by every load, so an item holding a `HalfEdge` would
	 * come out the other side pointing at one that no longer exists - and would
	 * then try to detach from it when it was eventually removed.
	 *
	 * A free-standing item holds nothing but coordinates, so it survives. That is
	 * the majority of furniture and all of what M-8 measures.
	 *
	 * RM-004 B2 lifted the exclusion rather than the flag. Wall ids survive a load
	 * now, so `HalfEdge.id` does too, and `Model.newRoom` notes which face a bound
	 * item is on before the floorplan is destroyed and points it at the same face
	 * afterwards. This getter still answers true for anything wall-bound, because
	 * it is a true statement about the item - what changed is that holding a
	 * reference into the graph is no longer a reason to throw the item away.
	 *
	 * @returns {boolean}
	 */
	get boundToFloorplan()
	{
		return false;
	}

	/** */
	clickReleased()
	{
		if (this.error)
		{
			this.hideError();
		}
	}

	/**
	 * Returns an array of planes to use other than the ground plane for passing
	 * intersection to clickPressed and clickDragged
	 */
	/**
	 * Planes to intersect against besides the ground plane.
	 *
	 * @returns {Array<Object>} Empty here; subclasses return wall or roof planes.
	 *          Typed loosely on purpose - `WallItem` returns the model's wall
	 *          edge planes and `RoofItem` its roof planes, and pinning either
	 *          shape on the base would make the override an error rather than an
	 *          override (RM-005 C2).
	 */
	customIntersectionPlanes()
	{
		return [];
	}

	/**
	 * The geometry's bounding box, which this class guarantees exists.
	 *
	 * `BufferGeometry.boundingBox` is null until something computes it, and
	 * three never does it for you - so every one of the dozen reads across
	 * `items/` was a possibly-null, and every one of them was also correct,
	 * because the constructor computes it on the line after it assigns the
	 * geometry (RM-005 C2).
	 *
	 * A method rather than a dozen guards, and it recomputes rather than
	 * asserting: if the invariant is ever broken - a subclass replacing
	 * `geometry` after construction, say - the caller gets a real box instead of
	 * a TypeError. The `|| new Box3()` after it is unreachable, since
	 * `computeBoundingBox()` always assigns one; an empty box is the honest
	 * answer for a geometry with nothing in it.
	 *
	 * @returns {Box3}
	 */
	bounds()
	{
		if (!this.geometry.boundingBox)
		{
			this.geometry.computeBoundingBox();
		}
		return this.geometry.boundingBox || new Box3();
	}

	/**
	 * returns the 2d corners of the bounding polygon
	 *
	 * offset is Vector3 (used for getting corners of object at a new position)
	 *
	 * Carried a TODO reading "handle rotated objects better!". What it means,
	 * concretely: the corners returned are an axis-aligned box around the item's
	 * half-dimensions, so a rotated item reports a footprint that is too large
	 * along one axis and too small along the other. Placement and wall-fitting
	 * both read it, which is why the item that will not sit in a corner at 45
	 * degrees does fit at 0.
	 *
	 * Not fixed here because it is a behaviour change with a visible blast
	 * radius rather than a tidy-up: returning the true rotated corners changes
	 * which placements are legal, and the fixtures that pin placement were
	 * captured against this behaviour. It needs its own change, with those
	 * fixtures re-captured deliberately.
	 */
	getCorners(xDim, yDim, position)
	{
		position = position || this.position;
		var halfSize = this.halfSize.clone();
		var c1 = new Vector3(-halfSize.x, 0, -halfSize.z);
		var c2 = new Vector3(halfSize.x, 0, -halfSize.z);
		var c3 = new Vector3(halfSize.x, 0, halfSize.z);
		var c4 = new Vector3(-halfSize.x, 0, halfSize.z);

		var transform = new Matrix4();
		transform.makeRotationY(this.rotation.y); // + Math.PI/2)

		c1.applyMatrix4(transform);
		c2.applyMatrix4(transform);
		c3.applyMatrix4(transform);
		c4.applyMatrix4(transform);

		c1.add(position);
		c2.add(position);
		c3.add(position);
		c4.add(position);



		var corners = [{ x: c1.x, y: c1.z },{ x: c2.x, y: c2.z },{ x: c3.x, y: c3.z },{ x: c4.x, y: c4.z }];
		return corners;
	}

	/** */
	isValidPosition()
	{
		return false;
	}

	/** */
	showError(vec3)
	{
		vec3 = vec3 || this.position;
		if (!this.error)
		{
			this.error = true;
			this.errorGlow = this.createGlow(this.errorColor, 0.8, true);
			this.scene.add(this.errorGlow);
		}
		// Null only between dispose() and a rebuild; showError on a disposed item
		// is a caller error, not a crash (RM-005 C2).
		if (this.errorGlow) { this.errorGlow.position.copy(vec3); }
	}

	/** */
	hideError()
	{
		if (this.error)
		{
			this.error = false;
			this.scene.remove(this.errorGlow);
			// createGlow() clones the whole item geometry, so an item that shows and
			// hides an error repeatedly was leaking a full copy of itself each time
			// (RM-003 A0). Replaced with the empty Mesh the constructor starts with,
			// so showError() has something to position before it builds the next one.
			disposeObject(this.errorGlow);
			this.errorGlow = new Mesh();
		}
	}

	/** */
	/**
	 * The plan this item stands on (RM-010 G1).
	 *
	 * Its own level's, falling back to the active one for an item that has not
	 * joined a level yet - which is every item mid-construction and every item a
	 * test builds by hand. Before there were levels the two were always the same
	 * object, so the fallback is the old behaviour exactly.
	 *
	 * @returns {import('../model/floorplan.js').Floorplan}
	 */
	get floorplan()
	{
		return (this.level && this.level.floorplan) ? this.level.floorplan : this.model.floorplan;
	}

	objectHalfSize()
	{
    this.geometry.computeBoundingBox();
    var objectBox = this.bounds().clone();
		return objectBox.max.clone().sub(objectBox.min).divideScalar(2);
	}

	/** */
	createGlow(color, opacity, ignoreDepth)
	{
		ignoreDepth = ignoreDepth || false;
		// `opacity` was normalised here and then ignored - the material below
		// hard-coded 0.2 - so the one caller, `showError` passing 0.8, drew its
		// error highlight at a quarter of the intended strength. Found by the
		// dead-assignment warning that flagged the normalisation as unread.
		opacity = opacity || 0.2;
		var glowMaterial = new MeshBasicMaterial({color: color, blending: AdditiveBlending, opacity: opacity, transparent: true, depthTest: !ignoreDepth});
		var glow = new Mesh(this.geometry.clone(), glowMaterial);
		glow.position.copy(this.position);
		glow.rotation.copy(this.rotation);
		glow.scale.copy(this.scale);
		return glow;
	}


	/**
	 * The item's record in a save file.
	 *
	 * `material_colors` is sparse as of save format 2.0.0: an entry is a hex
	 * string only for a slot somebody actually chose a colour for, and `null`
	 * everywhere else, meaning "the model's own". The key is omitted entirely
	 * when nothing was chosen, which is the common case - most items are placed
	 * from the catalog and never recoloured.
	 *
	 * A full array of every material's colour is what 0.0.2a wrote, and it is
	 * why furniture in a pre-S8 design reloads too dark. See `_pickedColorSlots`
	 * in the constructor for the whole story. The sparse form is still read by
	 * the same loop that reads the dense one, so an old file needs no special
	 * case: it simply has no nulls in it.
	 *
	 * @returns {Object} The serialized item.
	 */
	getMetaData()
	{
		var scope = this;
		var matattribs = null;

		if(this._pickedColorSlots.size)
		{
			var saved = multiMaterial(this.material);
			var slots = saved ? saved.length : 1;
			matattribs = [];
			for (var i = 0; i < slots; i++)
			{
				if(!scope._pickedColorSlots.has(i))
				{
					matattribs.push(null);
					continue;
				}
				var material = saved ? saved[i] : singleMaterial(scope.material);
				matattribs.push('#'+material.color.getHexString());
			}
		}

		var data = {id: this.designId, item_name: this.metadata.itemName,
			item_type: this.metadata.itemType, format: this.metadata.format, model_url: this.metadata.modelUrl,
			xpos: this.position.x, ypos: this.position.y, zpos: this.position.z,
			rotation: this.rotation.y,
			scale_x: this.scale.x, scale_y: this.scale.y,scale_z: this.scale.z,fixed: this.fixed};

		if(matattribs)
		{
			data.material_colors = matattribs;
		}
		// Additive and conditional, like every key added since E2: an item that
		// emits nothing writes no `lamp` key, so a design of chairs is
		// byte-identical to the file it was before H2. A lamp records its own
		// description rather than pointing at a catalog row, for the reason
		// `newFloorTextures` records a URL rather than a texture id - a design
		// saved against one catalog must open the same way against the next.
		if (this.lamp)
		{
			data.lamp = lampToJSON(this.lamp);
		}
		return data;
	}
}
