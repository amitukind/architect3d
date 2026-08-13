import {Mesh, Matrix4, Vector2, Vector3, BoxGeometry, BoxHelper, Box3, MeshBasicMaterial, MeshStandardMaterial, AdditiveBlending} from 'three';
import {CanvasTexture, PlaneGeometry, DoubleSide, SRGBColorSpace} from 'three';
import {Color} from 'three';
import {Utils} from '../core/utils.js';
import {Dimensioning} from '../core/dimensioning.js';

/**
 * An Item is an abstract entity for all things placed in the scene, e.g. at
 * walls or on the floor.
 */
export class Item extends Mesh
{
	/**
	 * Constructs an item.
	 *
	 * @param model
	 *            TODO
	 * @param metadata
	 *            TODO
	 * @param geometry
	 *            TODO
	 * @param material
	 *            TODO
	 * @param position
	 *            TODO
	 * @param rotation
	 *            TODO
	 * @param scale
	 *            TODO
	 */
	constructor(model, metadata, geometry, material, position, rotation, scale, isgltf=false)
	{
		super();

		this.model = model;
		this.metadata = metadata;

		/** */
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
		this.bhelper = null;

		this.scene = this.model.scene;
		this._freePosition = true;

		if(!isgltf)
		{
				this.geometry = geometry;
				this.material = material;
				// center in its boundingbox
				this.geometry.computeBoundingBox();
				this.geometry.applyMatrix4(new Matrix4().makeTranslation(- 0.5 * (this.geometry.boundingBox.max.x + this.geometry.boundingBox.min.x),- 0.5 * (this.geometry.boundingBox.max.y + this.geometry.boundingBox.min.y),- 0.5 * (this.geometry.boundingBox.max.z + this.geometry.boundingBox.min.z)));
				this.geometry.computeBoundingBox();
		}
		else
		{
				var objectBox = new Box3();
				// precise: r140 made the default path expand each child's own
				// bounding box, which is looser than r98 and would resize the
				// invisible pick box every loaded item is measured by.
				objectBox.setFromObject(geometry, true);
				var hsize = objectBox.max.clone().sub(objectBox.min).multiplyScalar(0.5);
				this.geometry = new BoxGeometry(hsize.x*0.5, hsize.y*0.5, hsize.z*0.5);
				this.material =  new MeshStandardMaterial({color: 0x000000, wireframe: true, visible:false});
				this.geometry.computeBoundingBox();
				this.add(geometry);
		}

		if(!this.material.color)
		{
			this.material.color = new Color('#FFFFFF');
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

		this.castShadow = true;
		this.receiveShadow = false;

		this.originalmaterial = material;
		this.texture = this.material.texture;

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
				if(this.material.length)
				{
					for (var i=0;i<this.metadata.materialColors.length;i++)
					{
						if(this.metadata.materialColors[i] == null)
						{
							continue;
						}
						this.material[i].color = new Color(this.metadata.materialColors[i]);
						this._pickedColorSlots.add(i);
					}
				}
				else if(this.metadata.materialColors[0] != null)
				{
					this.material.color = new Color(this.metadata.materialColors[0]);
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

	/** */
	remove()
	{
		this.scene.removeItem(this);
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
		if(this.material.length)
		{
			return '#'+this.material[index].color.getHexString();
		}
		return '#'+this.material.color.getHexString();
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
		if(this.material.length)
		{
			index = (index) ? index : 0;
			this.material[index].color = c;
			this._pickedColorSlots.add(index);
			return;
		}
		this.material.color = c;
		this._pickedColorSlots.add(0);
	}

	/** */
	setScale(x, y, z)
	{
		var scaleVec = new Vector3(x, y, z);
		this.halfSize.multiply(scaleVec);
		scaleVec.multiply(this.scale);
		this.scale.set(scaleVec.x, scaleVec.y, scaleVec.z);
		this.resized();
		if(this.bhelper)
		{
			this.bhelper.update();
		}

//		this.updateCanvasTexture(canvas, context, material, w, h);
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

	/** */
	getDepth()
	{
		return this.halfSize.z * 2.0;
	}

	/** */
	placeInRoom()
	{

	}

	/** */
	initObject()
	{
		this.placeInRoom();
		// An ugly hack to increase the size of gltf models
		if(this.halfSize.x < 1.0)
		{
			this.resize(this.getHeight()*300, this.getWidth()*300, this.getDepth()*300);
		}
		this.bhelper = new BoxHelper(this);
		this.scene.add(this.bhelper);
		this.bhelper.visible = false;
		// select and stuff
		this.scene.needsUpdate = true;

	}

	/** */
	removed()
	{
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
			if(this.material.length)
			{
				this.material.forEach((material) => {
					if(material.emissive)
					{
						material.emissive.setHex(hex);
					}
				});
			}
			else if(this.material.emissive)
			{
				this.material.emissive.setHex(hex);
				this.material.emissive = new Color(hex);
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
		this.bhelper.visible = true;
		this.canvasPlaneWH.visible = this.canvasPlaneWD.visible = true;
		this.updateHighlight();
	}

	/** */
	setUnselected()
	{
		this.selected = false;
		this.bhelper.visible = false;
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
	moveToPosition(vec3)
	{
		this.position.copy(vec3);
		if(this.bhelper)
		{
			this.bhelper.update();
		}
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
	customIntersectionPlanes()
	{
		return [];
	}

	/**
	 * returns the 2d corners of the bounding polygon
	 *
	 * offset is Vector3 (used for getting corners of object at a new position)
	 *
	 * TODO: handle rotated objects better!
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
		// console.log(this.rotation.y);
		transform.makeRotationY(this.rotation.y); // + Math.PI/2)

		c1.applyMatrix4(transform);
		c2.applyMatrix4(transform);
		c3.applyMatrix4(transform);
		c4.applyMatrix4(transform);

		c1.add(position);
		c2.add(position);
		c3.add(position);
		c4.add(position);

		// halfSize.applyMatrix4(transform);

		// var min = position.clone().sub(halfSize);
		// var max = position.clone().add(halfSize);

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
		this.errorGlow.position.copy(vec3);
	}

	/** */
	hideError()
	{
		if (this.error)
		{
			this.error = false;
			this.scene.remove(this.errorGlow);
		}
	}

	/** */
	objectHalfSize()
	{
		// var objectBox = new Box3();
		// objectBox.setFromObject(this);
    this.geometry.computeBoundingBox();
    var objectBox = this.geometry.boundingBox.clone();
		return objectBox.max.clone().sub(objectBox.min).divideScalar(2);
	}

	/** */
	createGlow(color, opacity, ignoreDepth)
	{
		ignoreDepth = ignoreDepth || false;
		opacity = opacity || 0.2;
		var glowMaterial = new MeshBasicMaterial({color: color, blending: AdditiveBlending, opacity: 0.2, transparent: true, depthTest: !ignoreDepth});
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
			var slots = this.material.length ? this.material.length : 1;
			matattribs = [];
			for (var i = 0; i < slots; i++)
			{
				if(!scope._pickedColorSlots.has(i))
				{
					matattribs.push(null);
					continue;
				}
				var material = scope.material.length ? scope.material[i] : scope.material;
				matattribs.push('#'+material.color.getHexString());
			}
		}

		var data = {item_name: this.metadata.itemName,
			item_type: this.metadata.itemType, format: this.metadata.format, model_url: this.metadata.modelUrl,
			xpos: this.position.x, ypos: this.position.y, zpos: this.position.z,
			rotation: this.rotation.y,
			scale_x: this.scale.x, scale_y: this.scale.y,scale_z: this.scale.z,fixed: this.fixed};

		if(matattribs)
		{
			data.material_colors = matattribs;
		}
		return data;
	}
}
