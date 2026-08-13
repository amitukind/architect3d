import {Configuration, Dimensioning, WallTypes} from '../../scripts/blueprint.js';
import {configDimUnit, EVENT_CORNER_ATTRIBUTES_CHANGED} from '../../scripts/blueprint.js';
import {
	SELECTION_ITEM, SELECTION_WALL, SELECTION_FLOOR,
	SELECTION_CORNER_2D, SELECTION_WALL_2D, SELECTION_ROOM_2D,
} from '../composables/useSelection.js';

/**
 * "Selections" - one folder describing whatever is selected right now.
 *
 * Sprint S6, interim; see config-folders.js for why lil-gui and why a literal
 * port. Each builder returns `{folder, destroy}` and the panel keeps at most
 * one alive, so switching selection can never leave two inspectors disagreeing
 * about what is selected. The demo kept `itemPropFolder` and `wallPropFolder`
 * as separate module globals and closed them from a third function.
 */

/** Wall and floor textures, exactly the list the demo offered. */
const TEXTURES = [
	['rooms/textures/wallmap.png', true, 1],
	['rooms/textures/wallmap_yellow.png', true, 1],
	['rooms/textures/light_brick.jpg', false, 50],
	['rooms/textures/marbletiles.jpg', false, 300],
	['rooms/textures/light_brick.jpg', false, 100],
	['rooms/textures/light_fine_wood.jpg', false, 300],
	['rooms/textures/hardwood.png', false, 300],
];

const WALL_TEXTURE_CHOICES = {Grey: 0, Yellow: 1, Checker: 2, Marble: 3, Bricks: 4};
const FLOOR_TEXTURE_CHOICES = {'Fine Wood': 5, 'Hard Wood': 6};

function unitSuffix()
{
	return Configuration.getStringValue(configDimUnit);
}

/**
 * A corner's position, in the active display unit.
 *
 * Two-way: the fields write through to the corner, and the corner writes back
 * when it is dragged in the canvas.
 */
function buildCornerFolder(gui, corner)
{
	var values = {
		x: Dimensioning.cmToMeasureRaw(corner.x),
		y: Dimensioning.cmToMeasureRaw(corner.y),
		elevation: Dimensioning.cmToMeasureRaw(corner.elevation),
	};

	var folder = gui.addFolder('Current Corner');
	var unit = unitSuffix();
	folder.add(values, 'x').name(`x(${unit})`).step(0.01)
		.onChange(() => {corner.x = Dimensioning.cmFromMeasureRaw(values.x);});
	folder.add(values, 'y').name(`y(${unit})`).step(0.01)
		.onChange(() => {corner.y = Dimensioning.cmFromMeasureRaw(values.y);});
	folder.add(values, 'elevation').name(`Elevation(${unit})`).min(0).step(0.01)
		.onChange(() => {corner.elevation = Dimensioning.cmFromMeasureRaw(values.elevation);});

	var onChanged = () =>
	{
		values.x = Dimensioning.cmToMeasureRaw(corner.x);
		values.y = Dimensioning.cmToMeasureRaw(corner.y);
		values.elevation = Dimensioning.cmToMeasureRaw(corner.elevation);
		folder.controllers.forEach((controller) => {controller.updateDisplay();});
	};
	corner.addEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, onChanged);

	return {
		folder: folder,
		destroy: function ()
		{
			corner.removeEventListener(EVENT_CORNER_ATTRIBUTES_CHANGED, onChanged);
			folder.destroy();
		},
	};
}

function buildRoomFolder(gui, room, deps)
{
	var folder = gui.addFolder('Current Room');
	// Room.name is a setter that dispatches EVENT_ROOM_ATTRIBUTES_CHANGED; the
	// redraw is so the label on the canvas follows the field as you type rather
	// than on the next mouse move, which is all the demo managed.
	folder.add(room, 'name').name('Name').onChange(() => {deps.floorplanner.redraw();});
	return {folder: folder, destroy: () => {folder.destroy();}};
}

function buildWall2DFolder(gui, wall, deps)
{
	var values = {
		walltype: (wall.wallType === WallTypes.CURVED) ? 'Curved' : 'Straight',
		walllength: Dimensioning.cmToMeasureRaw(wall.wallSize),
	};

	var folder = gui.addFolder('Current Wall 2D');
	folder.add(values, 'walltype', ['Straight', 'Curved']).name('Wall Type')
		.onChange(() =>
		{
			wall.wallType = (values.walltype === 'Curved') ? WallTypes.CURVED : WallTypes.STRAIGHT;
			deps.floorplanner.redraw();
		});

	// Length is only offered for straight walls, as in the demo: a curved wall's
	// size is a property of its bezier and setting it directly would fight the
	// control points.
	if (wall.wallType === WallTypes.STRAIGHT)
	{
		folder.add(values, 'walllength').name('Wall Length')
			.onChange(() =>
			{
				wall.wallSize = Dimensioning.cmFromMeasureRaw(values.walllength);
				deps.floorplanner.redraw();
			});
	}

	return {folder: folder, destroy: () => {folder.destroy();}};
}

/**
 * The item inspector - the second of the three deliberate fixes.
 *
 * The demo built `new ItemProperties(selectionsFolder, item)` against a
 * constructor whose only parameter is the gui (build/js/app.js:339, 573), and
 * the line that would have bound the item - `anItem.setItem(item)` - is
 * commented out on the next line. So `currentItem` stayed null for the life of
 * the page: the panel showed the placeholder 10 x 10 x 10, editing a field
 * resized nothing, the lock and proportional-resize toggles fell through
 * `if(this.currentItem)`, Delete deleted nothing, and no Materials folder was
 * ever created. Every feature this panel offers has been dead since it was
 * written, which is why P6 in the parity oracle calls resize, lock and
 * per-material colours a *new bar from S6* rather than a regression risk.
 *
 * Binding the item is the whole fix; the rest of this function is the demo's
 * own arithmetic.
 */
function buildItemFolder(gui, item)
{
	var values = {
		name: item.metadata.itemName,
		width: Dimensioning.cmToMeasureRaw(item.getWidth()),
		height: Dimensioning.cmToMeasureRaw(item.getHeight()),
		depth: Dimensioning.cmToMeasureRaw(item.getDepth()),
		proportionalsize: item.getProportionalResize(),
		fixed: item.fixed,
		deleteItem: function () {item.remove();},
	};

	var folder = gui.addFolder('Current Item (3D)');
	folder.add(values, 'name').name('Name').disable();

	/**
	 * Resize, then read back.
	 *
	 * `Item.resize` may not do what it was asked: with proportional resize on it
	 * scales the other two axes to match, and it ignores changes under 0.1cm. So
	 * the panel writes its three numbers, then re-reads all three from the item -
	 * the demo did the same thing, though it worked out which to re-read from
	 * which value had changed. Re-reading all three is the same answer with less
	 * bookkeeping.
	 */
	function resized()
	{
		item.resize(
			Dimensioning.cmFromMeasureRaw(values.height),
			Dimensioning.cmFromMeasureRaw(values.width),
			Dimensioning.cmFromMeasureRaw(values.depth));

		values.width = Dimensioning.cmToMeasureRaw(item.getWidth());
		values.height = Dimensioning.cmToMeasureRaw(item.getHeight());
		values.depth = Dimensioning.cmToMeasureRaw(item.getDepth());
		folder.controllers.forEach((controller) => {controller.updateDisplay();});
	}

	folder.add(values, 'width', 0.1, 1000.1).step(0.1).onChange(resized);
	folder.add(values, 'height', 0.1, 1000.1).step(0.1).onChange(resized);
	folder.add(values, 'depth', 0.1, 1000.1).step(0.1).onChange(resized);
	folder.add(values, 'proportionalsize').name('Maintain Size Ratio')
		.onChange(() => {item.setProportionalResize(values.proportionalsize);});
	folder.add(values, 'fixed').name('Locked in place')
		.onChange(() => {item.setFixed(values.fixed);});
	folder.add(values, 'deleteItem').name('Delete Item');

	// One colour swatch per material. An item's `material` is either a single
	// material or an array of them, depending on how the glTF was authored.
	//
	// The demo routed every swatch's onChange through `dimensionsChanged()`,
	// which resized the item before applying the colours. Harmless, because the
	// resize was to the values already on screen - but it meant a colour change
	// could not be told apart from a resize. Split here.
	var materials = Array.isArray(item.material) ? item.material : [item.material];
	var colors = {};
	var materialsFolder = folder.addFolder('Materials');
	materials.forEach((material, index) =>
	{
		var key = `mat_${index}`;
		colors[key] = `#${material.color.getHexString()}`;
		materialsFolder.addColor(colors, key)
			.name(material.name || `Material ${index + 1}`)
			.onChange(() => {item.setMaterialColor(colors[key], index);});
	});

	return {folder: folder, destroy: () => {folder.destroy();}};
}

/**
 * Wall and floor textures.
 *
 * `target` is a HalfEdge when a wall was clicked and a Room when a floor was.
 * Both fields are shown in both cases, as in the demo, and each acts only when
 * it has something to act on - which is also why "All Walls In Room" only does
 * anything with a floor selected: it is the Room that knows its walls.
 */
function buildSurfaceFolder(gui, selection)
{
	var wall = (selection.type === SELECTION_WALL) ? selection.object : null;
	var floor = (selection.type === SELECTION_FLOOR) ? selection.object : null;

	var values = {wallmaterialname: 0, floormaterialname: 5, forAllWalls: false};

	function apply(texture, to)
	{
		to.setTexture(texture[0], texture[1], texture[2]);
	}

	var folder = gui.addFolder('Wall and Floor (3D)');
	folder.add(values, 'wallmaterialname', WALL_TEXTURE_CHOICES).name('Wall')
		.onChange(() =>
		{
			var texture = TEXTURES[values.wallmaterialname];
			if (wall)
			{
				apply(texture, wall);
			}
			if (floor && values.forAllWalls)
			{
				floor.setRoomWallsTexture(texture[0], texture[1], texture[2]);
			}
		});
	folder.add(values, 'floormaterialname', FLOOR_TEXTURE_CHOICES).name('Floor')
		.onChange(() =>
		{
			if (floor)
			{
				apply(TEXTURES[values.floormaterialname], floor);
			}
		});
	folder.add(values, 'forAllWalls').name('All Walls In Room');

	return {folder: folder, destroy: () => {folder.destroy();}};
}

/**
 * @param {Object} gui The "Selections" folder.
 * @param {?{type: string, object: Object}} selection
 * @param {{floorplanner: Object}} deps
 * @returns {?{folder: Object, destroy: function(): void}}
 */
export function buildSelectionFolder(gui, selection, deps)
{
	if (!selection)
	{
		return null;
	}

	switch (selection.type)
	{
	case SELECTION_CORNER_2D:
		return buildCornerFolder(gui, selection.object);
	case SELECTION_ROOM_2D:
		return buildRoomFolder(gui, selection.object, deps);
	case SELECTION_WALL_2D:
		return buildWall2DFolder(gui, selection.object, deps);
	case SELECTION_ITEM:
		return buildItemFolder(gui, selection.object);
	case SELECTION_WALL:
	case SELECTION_FLOOR:
		return buildSurfaceFolder(gui, selection);
	default:
		return null;
	}
}
