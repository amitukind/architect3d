<script setup>
// @ts-check
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {TooltipProvider} from 'reka-ui';

import TopBar from './components/TopBar.vue';
import ToolRail from './components/ToolRail.vue';
import StatusBar from './components/StatusBar.vue';
import AppWorkspace from './components/AppWorkspace.vue';
import FloorplannerView from './components/FloorplannerView.vue';
import ThreeViewport from './components/ThreeViewport.vue';
import PlanOverlay from './components/PlanOverlay.vue';
import SceneOverlay from './components/SceneOverlay.vue';
import CatalogDrawer from './components/CatalogDrawer.vue';
import ShortcutsDialog from './components/ShortcutsDialog.vue';
import ToastStack from './components/ToastStack.vue';
import InspectorPanel from './inspector/InspectorPanel.vue';

import {provideBlueprint} from './composables/useBlueprint.js';
import {useSelection, SELECTION_DIMENSION, SELECTION_ANNOTATION} from './composables/useSelection.js';
import {useCameraViews, MODE_WALKTHROUGH} from './composables/useCameraViews.js';
import {useFloorplannerMode} from './composables/useFloorplannerMode.js';
import {useDesignIO} from './composables/useDesignIO.js';
import {useCatalog} from './composables/useCatalog.js';
import {useDisplayUnit, syncDisplayUnit} from './composables/useDisplayUnit.js';
import {useTheme, applyTheme} from './composables/useTheme.js';
import {useLayout, LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from './composables/useLayout.js';
import {useHistory} from './composables/useHistory.js';
import {useZoom2D} from './composables/useZoom2D.js';
import {usePlanStats} from './composables/usePlanStats.js';
import {useItemActions} from './composables/useItemActions.js';
import {useAutosave, readDraft, clearDraft, RECOVERY_LOST_TAIL} from './composables/useAutosave.js';
import {useAssets, applyAssetBaseFromQuery} from './composables/useAssets.js';
import {useToasts} from './composables/useToasts.js';
import {useShortcuts} from './composables/useShortcuts.js';

import {floorplannerModes, Configuration, configSystemUI, Dimensioning} from '../scripts/blueprint.js';
import {renderProfile} from '../scripts/blueprint.js';

/**
 * The application shell.
 *
 * ## What changed, and what did not
 *
 * S6 rebuilt this as a Vue component over the library and S7 dressed it. This
 * revision changes the *shape* of the interface - a rail, a dock and a status
 * bar around a workspace that can show either viewport or both - and adds the
 * three things a tool of this kind is expected to have and this one did not:
 * undo, keyboard shortcuts, and a way to recover work after a reload.
 *
 * What did not change is the part that is load-bearing. `BlueprintJS` still
 * takes both viewport elements in one call, so App.vue still owns construction
 * and reads both elements out of its children (Vue mounts children before
 * parents, so both exist by the time this onMounted runs). Teardown is still
 * one place. The boot order below is still the demo's, for the reasons S6
 * documented: the design loads before the inspector is built, and `stopSpin()`
 * runs after construction rather than `spin: false` being passed into it.
 *
 * ## Where the keyboard map lives
 *
 * Here, in one array, because a shortcut needs to know things no leaf component
 * knows - whether the plan is on screen, whether anything is selected, whether
 * an inspector field has focus. The array is also what feeds the shortcuts
 * dialog, so the documentation cannot drift from the bindings.
 */

const store = provideBlueprint();
const selection = useSelection(store);
const camera = useCameraViews(store);
const editor = useFloorplannerMode(store);
const io = useDesignIO(store);
const catalog = useCatalog(store, selection.placementContext);
const display = useDisplayUnit(store);
const theme = useTheme(store);
const workspace = useLayout();
const history = useHistory(store);
const zoom = useZoom2D(store);
const stats = usePlanStats(store);
const items = useItemActions(store, selection, history);
const autosave = useAutosave(store);
const assets = useAssets();
const toasts = useToasts();

// Null until the components mount. `onMounted` is the one place they are known
// to be set, and the non-null assertions there say so rather than guessing
// (RM-004 B3).
/** @type {import('vue').Ref<?{canvas: HTMLCanvasElement}>} */
const floorplanRef = ref(null);
/** @type {import('vue').Ref<?{container: HTMLElement}>} */
const viewportRef = ref(null);
const catalogOpen = ref(false);
const shortcutsOpen = ref(false);
const inspectorTab = ref('settings');
const renderMode = ref(renderProfile.mode);

const walkthrough = computed(() => camera.mode.value === MODE_WALKTHROUGH);

onMounted(() =>
{
	// Both are set: `onMounted` runs after the template has rendered, and both
	// refs are on elements with no `v-if`. Read once into locals so the narrowing
	// is a fact the checker can see rather than an assertion repeated twice.
	const floorplan = floorplanRef.value;
	const viewport = viewportRef.value;
	if (!floorplan || !viewport)
	{
		throw new Error('App mounted without its canvas or viewport');
	}

	store.mount({
		floorplannerElement: floorplan.canvas,
		threeElement: viewport.container,
	});

	// The library asks for corner elevations and room names through
	// window.prompt when this is false, and draws its own in-canvas editors when
	// it is true. The demo set it false (build/js/app.js:655).
	//
	// S7 looked at this and kept it false. The in-canvas editors have never run
	// in this application's life, they are not covered by a single test, and the
	// native inspectors now offer both edits with a real form - so the prompt is
	// a fallback for a double-click, not the primary path it used to be.
	Configuration.setValue(configSystemUI, false);

	// BlueprintJS's constructor sets dimMeter as its first statement, so the
	// panel has to re-read the unit rather than trust what it last showed.
	syncDisplayUnit();
	// Same reason, and additionally: the canvas palette has to be pushed into a
	// library that now exists. applyTheme ran once before mount for the CSS; this
	// run is the one that reaches the floorplanner.
	applyTheme(store);

	io.newDesign();
	// The default design counts as the starting point, not as an edit - so the
	// stack is seeded from it rather than recording it.
	history.reset();
	frameDesign();

	offerDraft();
	loadAssetManifest();
	applyLayoutToCamera(workspace.layout.value);
});

/**
 * Collect the asset manifest, and honour an `?assetBase=` if one is on the URL.
 *
 * After the viewer is up, not before: the manifest is an improvement to how
 * assets are fetched, not a precondition for fetching them, and blocking first
 * paint on a metadata file would trade a certain cost for an occasional
 * benefit. Everything already on screen keeps its URLs; everything loaded after
 * it lands goes through the manifest.
 *
 * The base is applied first so that if both happen, the manifest is fetched
 * from the page as always and only the assets it names move.
 */
function loadAssetManifest()
{
	const base = applyAssetBaseFromQuery();
	assets.load().then(function ()
	{
		if (base)
		{
			console.info(`architect3d: serving assets from ${base}`);
		}
	});
}

onBeforeUnmount(() =>
{
	store.unmount();
});

/**
 * Frame whatever was just loaded.
 *
 * Every CAD tool zoom-extents on open and this one never has: the default
 * design is a 5 m room, which at 1:1 occupies about a fifth of the canvas and
 * leaves a new user looking at mostly grid. An opened file can be anywhere,
 * including entirely off screen if the previous design was panned.
 *
 * Deferred by a frame because the canvas has to have been laid out for
 * `zoomToFit` to have a size to fit into - on the very first call it is running
 * inside the same onMounted that created the canvas.
 */
const FRAME_MAX_ZOOM = 2;

function frameDesign()
{
	requestAnimationFrame(() => {zoom.zoomToFit({max: FRAME_MAX_ZOOM});});
}

/**
 * Offer a recovered draft, if the last session left one.
 *
 * Deliberately an offer and not a restore - see useAutosave. It is read here
 * rather than inside the composable because the decision is a UI one, and
 * because it has to happen after `newDesign()` has already put something on
 * screen: a prompt over a blank canvas gives no sense of what would be lost.
 *
 * Asynchronous since A5, because the store beneath it is. Nothing waits on it -
 * the default design is already on screen by the time this resolves, which was
 * the ordering before too.
 *
 * The message names the discrepancy when there is one. A5's recovery pointer
 * can tell that the last write never landed, and a prompt that says "recovered"
 * about a draft several minutes behind what the user actually had is a prompt
 * that loses work quietly.
 */
async function offerDraft()
{
	const draft = await readDraft(Date.now());
	if (!draft)
	{
		return;
	}

	const message = draft.recovery === RECOVERY_LOST_TAIL
		? `A draft from your last session was recovered, but the final ${describeGap(draft.lostMs)} of changes did not save.`
		: 'A draft from your last session was recovered.';

	toasts.info(message, {
		action: {
			label: 'Restore',
			run: function ()
			{
				if (io.loadDesign(draft.design, 'the recovered draft'))
				{
					history.reset();
					frameDesign();
					toasts.success('Draft restored.');
				}
			},
		},
	});
}

/**
 * Keep the viewer's run state in step with what is on screen.
 *
 * `showFloorplan` / `showDesign` are more than visibility: they pause and
 * resume the render loop, drop the 3D selection, and force a floorplan update
 * so walls edited while 3D was paused are rebuilt before being shown again. The
 * layout is the thing that decides which applies, so it drives them.
 *
 * Split counts as showing the design: both panes are live, and a 3D pane that
 * is visible but not rendering is worse than not showing it at all.
 */
function applyLayoutToCamera(next)
{
	if (next === LAYOUT_PLAN)
	{
		camera.showFloorplan();
		return;
	}
	camera.showDesign();
}

watch(() => workspace.layout.value, applyLayoutToCamera);

/**
 * Leaving walk-through has to put the layout back somewhere sensible: the
 * pointer-lock exit path calls showDesign(), and if the workspace were still on
 * the plan-only layout the user would be looking at the 2D canvas with the 3D
 * camera quietly reset behind it.
 */
watch(() => camera.mode.value, function (mode)
{
	if (mode === MODE_WALKTHROUGH && workspace.layout.value === LAYOUT_PLAN)
	{
		workspace.setLayout(LAYOUT_VIEW);
	}
});

/**
 * Open or close the catalog, putting the 3D view on screen if it is not.
 *
 * Split rather than 3D-only: you are furnishing a plan, and seeing where the
 * thing you picked landed relative to the walls is the point. It only forces
 * the change when coming from plan-only - a user already in 3D stays in 3D.
 */
function toggleCatalog()
{
	catalogOpen.value = !catalogOpen.value;
	if (catalogOpen.value && workspace.layout.value === LAYOUT_PLAN)
	{
		workspace.setLayout(LAYOUT_SPLIT);
	}
}

function toggleWalkthrough()
{
	if (walkthrough.value)
	{
		camera.showDesign();
		return;
	}
	if (workspace.layout.value === LAYOUT_PLAN)
	{
		workspace.setLayout(LAYOUT_VIEW);
	}
	camera.showWalkthrough();
}

/**
 * Bring the carbon-sheet controls forward.
 *
 * Tracing a scanned floorplan is one of the more useful things this app can do
 * and it has always been three clicks deep in a settings accordion. The rail
 * button is the shortcut; the panel still owns the controls.
 */
function openBackdropSettings()
{
	workspace.inspectorOpen.value = true;
	inspectorTab.value = 'settings';
}

function setRenderMode(mode)
{
	renderMode.value = mode;
	if (store.three.value)
	{
		store.three.value.applyRenderProfile(mode);
	}
}

/**
 * The plan-space coordinate readout.
 *
 * Recomputed here rather than read off `floorplanner.mouseX`, which would be
 * one event stale: this component's listener is bound when the canvas mounts,
 * which is before App's onMounted constructs the library, so the library's own
 * pointermove handler runs *after* this one. The arithmetic is the library's,
 * from Floorplanner2D.mousemove.
 */
function onPlanPointerMove(event)
{
	const planner = store.floorplanner.value;
	if (!planner)
	{
		return;
	}
	const bounds = event.currentTarget.getBoundingClientRect();
	stats.setCursor({
		x: Dimensioning.pixelToCm(event.clientX - bounds.left) + Dimensioning.pixelToCm(planner.originX),
		y: Dimensioning.pixelToCm(event.clientY - bounds.top) + Dimensioning.pixelToCm(planner.originY),
	});
	// The library's own handler has already run by now - this listener is bound
	// on the canvas before App constructs the library, so the target is current
	// rather than one event stale, the same ordering the readout above relies on.
	editor.refreshDrawTarget();
}

function onAddItem(entry)
{
	catalog.addItem(entry);
}

/**
 * How much was lost, in words a person can act on.
 *
 * Rounded up rather than down: telling somebody they lost "0 seconds" of work
 * when they lost most of a second is the kind of reassurance that gets a
 * message ignored.
 *
 * @param {number} ms
 * @returns {string}
 */
function describeGap(ms)
{
	const seconds = Math.ceil(ms / 1000);
	if (seconds < 60)
	{
		return `${seconds} second${seconds === 1 ? '' : 's'}`;
	}
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function onNewDesign()
{
	io.newDesign();
	history.reset();
	frameDesign();
	clearDraft();
}

async function onOpenDesign(file)
{
	await io.openDesign(file);
	history.reset();
	frameDesign();
}

function undo()
{
	if (history.undo())
	{
		// Nothing else reports it, and an undo whose effect is off screen - a wall
		// restored while looking at the 3D view - is otherwise indistinguishable
		// from a key that did not register.
		toasts.info('Undo', {ttl: 1200});
	}
}

function redo()
{
	if (history.redo())
	{
		toasts.info('Redo', {ttl: 1200});
	}
}

/**
 * Delete whatever is selected (RM-008 E3).
 *
 * The Delete key used to mean "delete the selected item", because furniture was
 * the only thing a selection could be that had nothing else to press. A
 * dimension and a text label are two more, and a key that works for one kind of
 * selection and silently does nothing for another is the worse half of a
 * feature.
 *
 * Walls, corners and rooms are deliberately not included: they are deleted with
 * the eraser tool, which is modal and armed on purpose, because deleting a wall
 * silently deletes the rooms it defined. That asymmetry is a decision, not an
 * oversight - an annotation costs a keystroke to recreate and a room does not.
 */
function deleteSelection()
{
	var current = selection.selection.value;
	var planner = store.floorplanner.value;
	if (current && (current.type === SELECTION_DIMENSION || current.type === SELECTION_ANNOTATION) && planner)
	{
		planner.deleteSelectedAnnotation();
		return;
	}
	items.deleteSelected();
}

/** Whether {@link deleteSelection} has anything to do. */
const canDeleteSelection = computed(function ()
{
	var current = selection.selection.value;
	if (current && (current.type === SELECTION_DIMENSION || current.type === SELECTION_ANNOTATION))
	{
		return true;
	}
	return items.canActOnItem.value;
});

/**
 * The keyboard map.
 *
 * A computed rather than a constant, so `enabled` and the bindings themselves
 * can depend on live state; useShortcuts calls it on every keystroke and the
 * shortcuts dialog renders from the same array.
 */
// Annotated because the literal's inferred type is a union of four differently
// shaped objects - some carrying `alias`, some `whileTyping`, some neither -
// and that union is not `Binding[]` even though every member satisfies it
// (RM-004 B3).
const bindings = computed(() => /** @type {Array<import('./composables/useShortcuts.js').Binding>} */ ([
	// --- document ---
	{group: 'Document', keys: 'mod+n', label: 'New layout', run: onNewDesign},
	{group: 'Document', keys: 'mod+s', label: 'Save layout', run: io.saveDesign},
	{group: 'Document', keys: 'mod+z', label: 'Undo', run: undo, enabled: () => history.canUndo.value},
	{group: 'Document', keys: 'mod+shift+z', label: 'Redo', run: redo, enabled: () => history.canRedo.value},
	// Windows and Linux editors also bind Ctrl+Y. Harmless on Apple platforms,
	// where `mod` is Cmd and Cmd+Y is not taken by anything here.
	{group: 'Document', keys: 'mod+y', label: 'Redo', run: redo, alias: true, enabled: () => history.canRedo.value},

	// --- tools ---
	{group: 'Tools', keys: 'v', label: 'Select and move', run: () => editor.setMode(floorplannerModes.MOVE)},
	{group: 'Tools', keys: 'w', label: 'Draw walls', run: () => editor.setMode(floorplannerModes.DRAW)},
	{group: 'Tools', keys: 'r', label: 'Draw a rectangular room', run: () => editor.setMode(floorplannerModes.RECTANGLE)},
	{group: 'Tools', keys: 'd', label: 'Measure between two points', run: () => editor.setMode(floorplannerModes.DIMENSION)},
	{group: 'Tools', keys: 't', label: 'Add a text label', run: () => editor.setMode(floorplannerModes.TEXT)},
	{group: 'Tools', keys: 'x', label: 'Delete walls', run: () => editor.setMode(floorplannerModes.DELETE)},
	{group: 'Tools', keys: 's', label: 'Toggle snap to grid', run: () => zoom.setSnap(!zoom.snap.value)},
	{group: 'Tools', keys: 'a', label: 'Furniture catalog', run: toggleCatalog},
	{
		group: 'Tools', keys: 'mod+d', label: 'Duplicate item',
		run: items.duplicateSelected, enabled: () => items.canActOnItem.value,
	},
	{
		group: 'Tools', keys: 'delete', label: 'Delete the selection',
		run: deleteSelection, enabled: () => canDeleteSelection.value,
	},
	{
		group: 'Tools', keys: 'backspace', label: 'Delete the selection', alias: true,
		run: deleteSelection, enabled: () => canDeleteSelection.value,
	},

	// --- view ---
	{group: 'View', keys: '1', label: 'Plan only', run: () => workspace.setLayout(LAYOUT_PLAN)},
	{group: 'View', keys: '2', label: 'Split view', run: () => workspace.setLayout(LAYOUT_SPLIT)},
	{group: 'View', keys: '3', label: '3D only', run: () => workspace.setLayout(LAYOUT_VIEW)},
	{group: 'View', keys: 'f', label: 'Walk through', run: toggleWalkthrough},
	{group: 'View', keys: 'o', label: 'Orthographic camera', run: () => camera.setOrthographic(!camera.orthographic.value)},
	{group: 'View', keys: 'g', label: 'Wireframe', run: () => camera.setWireframe(!camera.wireframe.value)},
	{group: 'View', keys: '=', label: 'Zoom in', run: zoom.zoomIn},
	{group: 'View', keys: '-', label: 'Zoom out', run: zoom.zoomOut},
	{group: 'View', keys: 'shift+f', label: 'Frame the whole plan', run: zoom.zoomToFit},
	{group: 'View', keys: 'mod+.', label: 'Toggle the inspector', run: workspace.toggleInspector},
	{group: 'View', keys: 'shift+?', label: 'Keyboard shortcuts', run: () => {shortcutsOpen.value = true;}},

	// Escape closes whatever is open, and is the one binding that fires while
	// typing - its job in a field is to leave the field.
	{
		group: 'View', keys: 'escape', label: 'Close panels and stop drawing',
		whileTyping: true,
		run: function ()
		{
			if (catalogOpen.value)
			{
				catalogOpen.value = false;
				return;
			}
			if (shortcutsOpen.value)
			{
				shortcutsOpen.value = false;
				return;
			}
			// The library binds Esc itself to stop drawing walls, so the fall-through
			// is deliberately nothing: preventing the default here would take that
			// away, and the mode reset is the behaviour people expect from Esc on a
			// canvas.
			// `document.activeElement` is an `Element`, which declares no `blur` -
			// only `HTMLElement` does. The guard was already checking for it; this
			// narrows to the type that has it rather than testing for a property
			// TypeScript says cannot be there.
			const focused = document.activeElement;
			if (focused instanceof HTMLElement)
			{
				focused.blur();
			}
		},
	},
]));

useShortcuts(() => bindings.value);
</script>

<template>
	<TooltipProvider :delay-duration="260" :skip-delay-duration="240">
		<div id="app-shell" class="flex h-screen w-screen flex-col overflow-hidden bg-ground text-ink">
			<TopBar
				:layout="workspace.layout.value"
				:theme="theme.theme.value"
				:unit="display.unit.value"
				:units="display.units"
				:can-undo="history.canUndo.value"
				:can-redo="history.canRedo.value"
				:exporting="io.busy.value"
				:inspector-open="workspace.inspectorOpen.value"
				:saved-at="autosave.savedAt.value"
				@new-design="onNewDesign"
				@open-design="onOpenDesign"
				@save-design="io.saveDesign"
				@save-mesh="io.saveMesh"
				@save-gltf="io.saveGLTF"
				@save-plan-svg="io.savePlanSVG"
				@save-plan-png="io.savePlanPNG"
				@print-plan="io.printPlan"
				@undo="undo"
				@redo="redo"
				@set-layout="workspace.setLayout"
				@set-unit="display.setUnit"
				@toggle-theme="theme.toggleTheme"
				@toggle-inspector="workspace.toggleInspector"
				@show-shortcuts="shortcutsOpen = true" />

			<div class="flex min-h-0 flex-1">
				<ToolRail
					:mode="editor.mode.value"
					:layout="workspace.layout.value"
					:can-act-on-item="items.canActOnItem.value"
					:catalog-open="catalogOpen"
					:walkthrough="walkthrough"
					@set-mode="editor.setMode"
					@open-catalog="toggleCatalog"
					@duplicate-item="items.duplicateSelected"
					@delete-item="items.deleteSelected"
					@toggle-walkthrough="toggleWalkthrough"
					@open-backdrop="openBackdropSettings" />

				<AppWorkspace
					:layout="workspace.layout.value"
					:split-ratio="workspace.splitRatio.value"
					@update:split-ratio="workspace.setSplitRatio">
					<template #plan>
						<FloorplannerView
							ref="floorplanRef"
							@wheel-zoom="zoom.nudge"
							@pointer-move="onPlanPointerMove"
							@pointer-leave="stats.setCursor(null)">
							<PlanOverlay
								:zoom-percent="zoom.percent.value"
								:can-zoom-in="zoom.canZoomIn.value"
								:can-zoom-out="zoom.canZoomOut.value"
								:snap="zoom.snap.value"
								:spacing="zoom.spacing.value"
								:spacings="zoom.gridSpacings"
								:mode="editor.mode.value"
								:angle-snap="editor.angleSnap.value"
								:draw-target="editor.drawTarget.value"
								:unit="display.unit.value"
								@zoom-in="zoom.zoomIn"
								@zoom-out="zoom.zoomOut"
								@zoom-fit="zoom.zoomToFit"
								@zoom-reset="zoom.resetZoom"
								@centre="zoom.centre"
								@set-snap="zoom.setSnap"
								@set-angle-snap="editor.setAngleSnap"
								@set-draw-target="editor.applyDrawTarget"
								@set-spacing="zoom.setSpacing" />
						</FloorplannerView>
					</template>

					<template #view>
						<ThreeViewport ref="viewportRef">
							<SceneOverlay
								v-show="!walkthrough"
								:active-view="camera.activeView.value"
								:orthographic="camera.orthographic.value"
								:wireframe="camera.wireframe.value"
								:view-locked="camera.viewLocked.value"
								:render-mode="renderMode"
								@switch-view="camera.switchView"
								@toggle-orthographic="camera.setOrthographic(!camera.orthographic.value)"
								@toggle-wireframe="camera.setWireframe(!camera.wireframe.value)"
								@toggle-lock="camera.setViewLocked(!camera.viewLocked.value)"
								@set-render-mode="setRenderMode" />

							<div
								v-if="walkthrough"
								class="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4">
								<p class="glass px-3 py-2 text-[11px]">
									<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk ·
									move the mouse to look · <kbd>Esc</kbd> to leave
								</p>
							</div>
						</ThreeViewport>
					</template>
				</AppWorkspace>

				<InspectorPanel
					v-show="workspace.inspectorOpen.value"
					v-model:tab="inspectorTab"
					:selection="selection.selection.value"
					:camera="camera"
					@changed="history.commit" />
			</div>

			<StatusBar
				:rooms="stats.rooms.value"
				:walls="stats.walls.value"
				:items="stats.items.value"
				:area-label="stats.areaLabel.value"
				:cursor="stats.cursor.value"
				:zoom="zoom.percent.value"
				:mode="editor.mode.value"
				:layout="workspace.layout.value" />
		</div>

		<CatalogDrawer
			v-model:open="catalogOpen"
			:sections="catalog.sections.value"
			:placement="selection.placementContext.value"
			@add-item="onAddItem"
			@prefetch-item="assets.prefetchItem" />

		<ShortcutsDialog v-model:open="shortcutsOpen" :bindings="bindings" />

		<ToastStack />
	</TooltipProvider>
</template>
