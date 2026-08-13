import {Configuration, Dimensioning, config, wallInformation} from '../../scripts/blueprint.js';
import {configDimUnit, snapTolerance, gridSpacing, scale} from '../../scripts/blueprint.js';
import {dimFeetAndInch, dimInch, dimCentiMeter, dimMilliMeter, dimMeter} from '../../scripts/blueprint.js';
import {EVENT_UPDATED} from '../../scripts/blueprint.js';

/**
 * "Interface & Configuration" - the half of the inspector that is not about the
 * current selection.
 *
 * Sprint S6, interim. This is a faithful port of the dat.GUI folders the demo
 * built (build/js/app.js:690-784), on lil-gui instead: dat.GUI's last release
 * was 2020, it is unmaintained, and it ships no ES module. Same folders, same
 * order, same labels, same units. S7 replaces the whole panel with native Vue
 * components and this directory goes with it - which is why the port is
 * deliberately literal rather than improved.
 *
 * Two things the demo did by hand are gone: `dat.GUI.prototype.removeFolder`,
 * monkey-patched onto the library at boot (build/js/app.js:864) because dat.GUI
 * had no way to remove a folder, and the arrays of controllers threaded through
 * every properties object so they could be `updateDisplay()`d in a loop.
 * lil-gui has `folder.destroy()` and `controllersRecursive()`.
 */

/**
 * The five units, in the demo's order, with its labels. The stray apostrophes
 * in the first two are the demo's own.
 */
const UNITS = [
	{key: 'a', label: 'Feets\'\' Inches\'', value: dimFeetAndInch},
	{key: 'b', label: 'Inches\'', value: dimInch},
	{key: 'c', label: 'Cm', value: dimCentiMeter},
	{key: 'd', label: 'mm', value: dimMilliMeter},
	{key: 'e', label: 'm', value: dimMeter},
];

const WALL_MEASUREMENTS = [
	{property: 'exterior', label: 'Exterior'},
	{property: 'interior', label: 'Interior'},
	{property: 'midline', label: 'Midline'},
	{property: 'labels', label: 'Labels'},
	{property: 'exteriorlabel', label: 'Label for Exterior'},
	{property: 'interiorlabel', label: 'Label for Interior'},
	{property: 'midlinelabel', label: 'Label for Midline'},
];

/**
 * @param {Object} gui A lil-gui root.
 * @param {Object} deps
 * @param {Object} deps.floorplanner
 * @param {Object} deps.three
 * @returns {{folder: Object, destroy: function(): void}}
 */
export function buildConfigFolders(gui, deps)
{
	var floorplanner = deps.floorplanner;
	var three = deps.three;

	var root = gui.addFolder('Interface & Configuration');
	var editor2d = null;
	var carbonListener = null;
	var carbonSheet = null;

	// ---- Units ------------------------------------------------------------
	//
	// Five booleans behaving as a radio group, which is what dat.GUI could
	// express. Selecting one clears the rest, sets the unit, and rebuilds the
	// 2D editor folder - its labels carry the unit name and its two resolution
	// values are stored in centimetres but displayed converted, so both the
	// captions and the numbers change.
	var unitFlags = {};
	UNITS.forEach((unit) =>
	{
		unitFlags[unit.key] = Configuration.getStringValue(configDimUnit) === unit.value;
	});

	// Closed, like every folder here except the two the demo explicitly opened.
	// dat.GUI folders start closed and lil-gui's start open, so the difference
	// has to be spelled out or the panel covers half the window at boot.
	var unitsFolder = root.addFolder('Units').close();
	var unitControllers = UNITS.map((unit) => unitsFolder
		.add(unitFlags, unit.key)
		.name(unit.label)
		.onChange(() => {selectUnit(unit);}));

	function selectUnit(chosen)
	{
		UNITS.forEach((unit) => {unitFlags[unit.key] = (unit === chosen);});
		Configuration.setValue(configDimUnit, chosen.value);
		unitControllers.forEach((controller) => {controller.updateDisplay();});
		rebuild2dEditor();
		floorplanner.redraw();
	}

	// ---- 3D Editor > Camera Limits ----------------------------------------
	var clipping = {
		ratio: 1,
		ratio2: 1,
		locked: false,
		reset: function ()
		{
			clipping.ratio = 1;
			clipping.ratio2 = 1;
			three.resetClipping();
			cameraFolder.controllers.forEach((controller) => {controller.updateDisplay();});
		},
	};

	var editor3d = root.addFolder('3D Editor').close();
	var cameraFolder = editor3d.addFolder('Camera Limits').close();
	cameraFolder.add(clipping, 'ratio', -1, 1, 0.01).name('Range')
		.onChange(() => {three.changeClippingPlanes(clipping.ratio, clipping.ratio2);});
	cameraFolder.add(clipping, 'ratio2', -1, 1, 0.01).name('Range 2')
		.onChange(() => {three.changeClippingPlanes(clipping.ratio, clipping.ratio2);});
	// See useCameraViews.setViewLocked: Main.lockView's argument is really
	// "rotation enabled", so the demo passed the negation and so do we.
	cameraFolder.add(clipping, 'locked').name('Lock View')
		.onChange(() => {three.lockView(!clipping.locked);});
	cameraFolder.add(clipping, 'reset').name('Reset');

	// ---- 2D Editor --------------------------------------------------------
	function rebuild2dEditor()
	{
		if (editor2d)
		{
			detachCarbonListener();
			editor2d.destroy();
			editor2d = null;
		}

		var units = Configuration.getStringValue(configDimUnit);
		var resolutions = {
			snapValue: Dimensioning.cmToMeasureRaw(Configuration.getNumericValue(snapTolerance)),
			gridResValue: Dimensioning.cmToMeasureRaw(Configuration.getNumericValue(gridSpacing)),
		};

		editor2d = root.addFolder('2D Editor');
		editor2d.add(config, 'snapToGrid').name('Snap To Grid');
		editor2d.add(resolutions, 'snapValue', 0.1).name(`Snap Every(${units})`)
			.onChange(() =>
			{
				Configuration.setValue(snapTolerance, Dimensioning.cmFromMeasureRaw(resolutions.snapValue));
			});
		editor2d.add(resolutions, 'gridResValue', 0.1).name(`Grid Resolution(${units})`)
			.onChange(() =>
			{
				Configuration.setValue(gridSpacing, Dimensioning.cmFromMeasureRaw(resolutions.gridResValue));
				floorplanner.redraw();
			});
		editor2d.add(config, scale, 0.25, 5, 0.25).name('Zoom')
			.onChange(() =>
			{
				floorplanner.zoom();
				floorplanner.redraw();
			});

		var wallFolder = editor2d.addFolder('Wall Measurements').close();
		WALL_MEASUREMENTS.forEach((entry) =>
		{
			wallFolder.add(wallInformation, entry.property).name(entry.label)
				.onChange(() => {floorplanner.redraw();});
		});

		buildCarbonSheetFolder(editor2d);
		editor2d.open();
	}

	// ---- Carbon sheet -----------------------------------------------------
	function buildCarbonSheetFolder(parent)
	{
		carbonSheet = floorplanner.carbonSheet;
		if (!carbonSheet)
		{
			return;
		}

		var folder = parent.addFolder('Carbon Sheet').close();
		folder.add(carbonSheet, 'url').name('Url');
		folder.add(carbonSheet, 'width').name('Real Width').max(1000.0).step(0.01);
		folder.add(carbonSheet, 'height').name('Real Height').max(1000.0).step(0.01);
		folder.add(carbonSheet, 'maintainProportion').name('Maintain Proportion');
		folder.add(carbonSheet, 'x').name('Move in X');
		folder.add(carbonSheet, 'y').name('Move in Y');
		folder.add(carbonSheet, 'anchorX').name('Anchor X');
		folder.add(carbonSheet, 'anchorY').name('Anchor Y');
		folder.add(carbonSheet, 'transparency').name('Transparency').min(0).max(1.0).step(0.05);

		// Dragging the sheet in the canvas writes x/y straight onto the object,
		// so the panel has to be told. The demo registered this listener every
		// time it rebuilt the folder and removed it never; each unit change left
		// another one behind, updating controllers whose DOM had been thrown away.
		carbonListener = () =>
		{
			folder.controllers.forEach((controller) => {controller.updateDisplay();});
		};
		carbonSheet.addEventListener(EVENT_UPDATED, carbonListener);
	}

	function detachCarbonListener()
	{
		if (carbonListener && carbonSheet)
		{
			carbonSheet.removeEventListener(EVENT_UPDATED, carbonListener);
		}
		carbonListener = null;
		carbonSheet = null;
	}

	rebuild2dEditor();
	root.open();

	return {
		folder: root,
		destroy: function ()
		{
			detachCarbonListener();
			root.destroy();
		},
	};
}
