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
import LevelSwitcher from './components/LevelSwitcher.vue';
import SceneOverlay from './components/SceneOverlay.vue';
import CatalogDrawer from './components/CatalogDrawer.vue';
import ImportModelDialog from './components/ImportModelDialog.vue';
import ShortcutsDialog from './components/ShortcutsDialog.vue';
import ProjectLibrary from './components/ProjectLibrary.vue';
import ShareDialog from './components/ShareDialog.vue';
import ViewerBanner from './components/ViewerBanner.vue';
import ToastStack from './components/ToastStack.vue';
import InspectorPanel from './inspector/InspectorPanel.vue';

import {provideBlueprint} from './composables/useBlueprint.js';
import {useSelection, SELECTION_ITEM, SELECTION_DIMENSION, SELECTION_ANNOTATION} from './composables/useSelection.js';
import {useCameraViews, MODE_WALKTHROUGH, MODE_EXTERIOR} from './composables/useCameraViews.js';
import {useWalkthrough} from './composables/useWalkthrough.js';
import {useFloorplannerMode} from './composables/useFloorplannerMode.js';
import {useDesignIO, fileNameFor} from './composables/useDesignIO.js';
import {useProjects} from './composables/useProjects.js';
import {useTemplates} from './composables/useTemplates.js';
import {useShare} from './composables/useShare.js';
import {useModelImport} from './composables/useModelImport.js';
import {useOffline} from './composables/useOffline.js';
import {useCatalog} from './composables/useCatalog.js';
import {useDisplayUnit, syncDisplayUnit} from './composables/useDisplayUnit.js';
import {useTheme, applyTheme} from './composables/useTheme.js';
import {useLayout, LAYOUT_PLAN, LAYOUT_SPLIT, LAYOUT_VIEW} from './composables/useLayout.js';
import {useHistory} from './composables/useHistory.js';
import {useZoom2D} from './composables/useZoom2D.js';
import {useLevels} from './composables/useLevels.js';
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
const models = useModelImport(store);
// The one hook every load route runs through, so a design's imported models are
// reported the same way whether it came from a file, a project, a template, a
// link or a bundle (RM-012 J3).
const io = useDesignIO(store, {afterLoad: (text) => models.reportMissing(text)});
const projects = useProjects(store, io);
const templates = useTemplates(projects);
const share = useShare(store, projects, io, models);
const offline = useOffline();
const catalog = useCatalog(store, selection.placementContext);
const display = useDisplayUnit(store);
const theme = useTheme(store);
const workspace = useLayout();
const history = useHistory(store);
const zoom = useZoom2D(store);
const levels = useLevels(store);
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
const libraryOpen = ref(false);
const shareOpen = ref(false);
const importOpen = ref(false);
const inspectorTab = ref('settings');
const renderMode = ref(renderProfile.mode);

// Mounted here rather than only in the settings panel: the panel lives behind a
// tab and can be unmounted when a new viewer is built, and the stored eye height
// has to reach that viewer either way (RM-011 H3).
useWalkthrough(store);

const walkthrough = computed(() => camera.mode.value === MODE_WALKTHROUGH);
const exterior = computed(() => camera.mode.value === MODE_EXTERIOR);

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

	openShared();
	loadAssetManifest();
	goOffline();
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
/**
 * Register the service worker, once the page has finished arriving (RM-013 K3).
 *
 * After `load` rather than on mount, because registration competes with first
 * paint for the same connection and there is nothing a worker can do for the
 * visit it is racing. It does nothing in development - see `useOffline`.
 */
function goOffline()
{
	if (document.readyState === 'complete')
	{
		offline.register();
		return;
	}
	window.addEventListener('load', function once()
	{
		window.removeEventListener('load', once);
		offline.register();
	});
}

/**
 * A design in the URL, and what it displaces (RM-013 K2).
 *
 * Before the draft, not beside it. A recovered draft and a shared design are
 * two documents competing for one screen, and offering the first over the
 * second would mean a toast inviting somebody to replace the thing they had
 * just been sent - so the link wins and the draft is not offered at all. It is
 * not lost either: it is still in the store, and it is offered on the next boot
 * that does not carry a link.
 */
async function openShared()
{
	// Before anything loads a design, and awaited rather than fired off. The
	// index is what `Scene` asks whether a name is an import, so a design that
	// arrived first would report every one of its models missing and then load
	// none of them (RM-012 J3). It is one `getAll` of a few hundred bytes a
	// model, because the bytes are in a separate object store.
	await models.refresh();
	if (await share.openFromHash())
	{
		history.reset();
		markSaved();
		frameDesign();
		return;
	}
	offerDraft();
}

/**
 * Make a link for what is on screen, and show it.
 *
 * Encoded on the click rather than kept current, because a design is
 * re-serialized and deflated to make one and nobody is owed that on every edit.
 */
async function openShare()
{
	shareOpen.value = true;
	await share.makeLink();
}

/**
 * Save the design as a bundle.
 *
 * Through the same download helper as every other export, which is why it goes
 * through `io` rather than building its own anchor - `useDesignIO`'s note about
 * the demo creating four of those by hand is the reason there is only one.
 */
async function onSaveBundle()
{
	const built = await share.makeBundle();
	if (!built)
	{
		return;
	}
	io.download(built.bytes, `${fileNameFor(built.name)}.zip`, 'application/zip');
	const carried = built.manifest.carried.length;
	toasts.success(`Exported ${fileNameFor(built.name)}.zip`, {
		detail: carried
			? `${carried} model(s) travelled with it.`
			: 'Every model in it ships with the app, so none had to travel.',
	});
}

async function adoptShared()
{
	if (await share.adopt(projects.current.value ? undefined : 'Shared design'))
	{
		markSaved();
	}
}

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
	// Except when the exterior view asked for the layout in the first place
	// (RM-010 G3). `toggleExterior` sets LAYOUT_VIEW and then frames the
	// building; without this the watcher fires in between and `showDesign()`
	// puts the mode straight back, so the button lit up and nothing moved.
	if (camera.mode.value === MODE_EXTERIOR)
	{
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
	if ((mode === MODE_WALKTHROUGH || mode === MODE_EXTERIOR) && workspace.layout.value === LAYOUT_PLAN)
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
 * Step outside, or come back in.
 *
 * Same shape as the walk-through toggle above and for the same reason: both
 * arrange their own precondition, which is that the 3D view is on screen. The
 * way back is `showDesign()`, which puts the camera back on the storey being
 * edited without moving it - so leaving the exterior view returns you to the
 * design rather than to wherever the framing left the camera.
 */
function toggleExterior()
{
	if (exterior.value)
	{
		camera.showDesign();
		return;
	}
	if (workspace.layout.value === LAYOUT_PLAN)
	{
		workspace.setLayout(LAYOUT_VIEW);
	}
	camera.showExterior();
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

/**
 * Place an imported model, and close the dialog behind it (RM-012 J3).
 *
 * The dialog closes on success only. A refusal - no room in the store, a
 * browser that withholds it - leaves the decision on screen with the reason
 * under it, because the alternative is a dialog that vanishes and a toast that
 * explains why something the person can no longer see did not happen.
 *
 * @param {Object} decision
 */
async function onPlaceModel(decision)
{
	if (await models.place(decision))
	{
		importOpen.value = false;
	}
}

/** @param {Object} record One row of the imported shelf. */
function onPlaceStoredModel(record)
{
	if (models.placeStored(record))
	{
		importOpen.value = false;
	}
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
	// A blank design belongs to nobody: the next save makes a record rather than
	// overwriting whatever was open a moment ago (RM-013 K1).
	projects.detach();
	markSaved();
}

/**
 * Open whatever somebody picked, whichever of the two it is (RM-013 K2).
 *
 * A `.zip` and a `.blueprint3d` arrive through the same control on purpose:
 * "open a design" is one intention, and making a person choose the right of two
 * buttons for a distinction the file itself declares is an interface asking
 * them to do the computer's job.
 */
async function onOpenDesign(file)
{
	if (file && /\.zip$/i.test(file.name))
	{
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!await share.openBundle(bytes))
		{
			return;
		}
		history.reset();
		markSaved();
		frameDesign();
		return;
	}
	await io.openDesign(file);
	history.reset();
	frameDesign();
	markSaved();
	// A file off a disk is not a record either, but it does have a name worth
	// keeping - the seven exports read it, and a save will record it.
	projects.detach();
	if (file && file.name)
	{
		io.documentName.value = file.name.replace(/\.blueprint3d$/i, '');
	}
}

/**
 * Open the library, and fetch the shelf the first time (RM-013 K1, Y-5).
 *
 * The manifest is fetched here rather than at boot, which is what M-47 asserts:
 * nothing about the starter plans is visible before this click, so nothing about
 * them should be in the payload or in the boot's requests.
 */
function openLibrary()
{
	libraryOpen.value = true;
	projects.refresh();
	templates.load();
}

/** @param {string} id */
async function onOpenProject(id)
{
	if (await projects.open(id))
	{
		history.reset();
		markSaved();
		frameDesign();
		libraryOpen.value = false;
	}
}

/** @param {Object} entry A template manifest row. */
async function onStartTemplate(entry)
{
	if (await templates.start(entry))
	{
		history.reset();
		savedDepth.value = history.depth.value;
		// A starter plan is not a saved design: it is on screen and unkept, which
		// is what `adopt` already said and what the dot in the bar shows.
		projects.dirty.value = true;
		frameDesign();
		clearDraft();
		libraryOpen.value = false;
		toasts.success(`Started from ${entry.name}`);
	}
}

/**
 * What "unsaved changes" means (RM-013 K1).
 *
 * The history stack, not the model's change events. `useHistory` commits one
 * entry per edit and `history.reset()` runs after every load, so its depth is
 * already the number of edits since this design arrived - which is the
 * question - and it gets undo right for nothing: undoing back to the depth a
 * save happened at leaves nothing to save, which is what every editor does.
 *
 * The alternative was to listen to the same model events `useAutosave` does,
 * and it is worse: a design with furniture fires ITEM_LOADED once per item as
 * the files arrive, so a project would go dirty a second after being opened
 * without anybody touching it.
 */
const savedDepth = ref(0);

function markSaved()
{
	savedDepth.value = history.depth.value;
	projects.dirty.value = false;
}

watch(history.depth, function (depth)
{
	projects.dirty.value = depth !== savedDepth.value;
});

async function onSaveProject()
{
	// A design nobody has kept yet is named after whatever put it on screen - a
	// template, an opened file - and that name is the one to offer.
	if (await projects.save(projects.current.value ? {} : {name: io.documentName.value}))
	{
		markSaved();
	}
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

/**
 * Select every item in the design (RM-012 J4).
 *
 * The most basic operation over a set, and the one that makes the set worth
 * having on a plan somebody has already furnished: the alternative is
 * shift-clicking twenty chairs. `mod+a` rather than a button, because it is a
 * keyboard idiom nobody has to be taught and nothing here was using it -
 * the plan and the 3D view both handle their own pointer events and neither has
 * a text field with a native select-all to shadow.
 */
function selectAllItems()
{
	var model = store.model.value;
	if (!model)
	{
		return;
	}
	selection.selectMany(SELECTION_ITEM, model.scene.getItems());
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
	{group: 'Document', keys: 'mod+shift+o', label: 'Designs', run: openLibrary},
	{group: 'Document', keys: 'mod+shift+c', label: 'Share a link', run: openShare,
		enabled: () => !share.viewing.value},
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
		group: 'Tools', keys: 'mod+a', label: 'Select every item',
		run: selectAllItems, enabled: () => stats.items.value > 0,
	},
	{
		group: 'Tools', keys: 'mod+c', label: 'Copy the selection',
		run: items.copySelected, enabled: () => items.canActOnItem.value,
	},
	{
		group: 'Tools', keys: 'mod+v', label: 'Paste',
		run: items.pasteClipboard, enabled: () => items.canPaste.value,
	},
	{
		group: 'Tools', keys: 'm', label: 'Mirror left to right',
		run: () => items.mirrorSelected('x'), enabled: () => items.canActOnItem.value,
	},
	{
		group: 'Tools', keys: 'shift+m', label: 'Mirror front to back',
		run: () => items.mirrorSelected('z'), enabled: () => items.canActOnItem.value,
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
	{group: 'View', keys: 'e', label: 'Exterior view', run: toggleExterior},
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

/**
 * The two things offline has to say, said in the place notices are said.
 *
 * Not new chrome. An install offer that occupied a bar would be a bar advertising
 * something most people will decline, and an update notice that did would sit
 * there being ignored - the toast stack already exists, already knows how to
 * carry an action, and is where this application puts everything else that is
 * true for a moment.
 *
 * The install offer is raised once and never repeated: `beforeinstallprompt`
 * fires again on later visits, and a browser that keeps asking is the reason
 * people learn to dismiss without reading.
 */
watch(offline.installable, function (canInstall)
{
	if (!canInstall)
	{
		return;
	}
	toasts.info('Architect3D can be installed as an app.', {
		ttl: 12000,
		action: {label: 'Install', run: function () {offline.install();}},
	});
});

watch(offline.updateReady, function (waiting)
{
	if (!waiting)
	{
		return;
	}
	// No `ttl`: a person who misses this reloads later and gets it anyway, but a
	// notice that disappears while somebody is reading it is worse than one that
	// waits to be dismissed.
	toasts.info('A newer version of Architect3D is ready.', {
		ttl: 0,
		action: {label: 'Reload', run: offline.applyUpdate},
	});
});

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
				:project-name="projects.name.value"
				:project-dirty="projects.dirty.value"
				@new-design="onNewDesign"
				@open-design="onOpenDesign"
				@save-design="io.saveDesign"
				@save-mesh="io.saveMesh"
				@save-gltf="io.saveGLTF"
				@save-bundle="onSaveBundle"
				@save-plan-svg="io.savePlanSVG"
				@save-photo="io.savePhoto"
				@save-panorama="io.savePanorama"
				@save-plan-png="io.savePlanPNG"
				@print-plan="io.printPlan"
				@undo="undo"
				@redo="redo"
				@set-layout="workspace.setLayout"
				@set-unit="display.setUnit"
				@toggle-theme="theme.toggleTheme"
				@toggle-inspector="workspace.toggleInspector"
				@show-shortcuts="shortcutsOpen = true"
				@show-library="openLibrary"
				@show-share="openShare" />

			<ViewerBanner
				v-if="share.viewing.value"
				:busy="projects.busy.value"
				@adopt="adoptShared"
				@leave="share.leave" />

			<div class="flex min-h-0 flex-1">
				<ToolRail
					v-if="!share.viewing.value"
					:mode="editor.mode.value"
					:layout="workspace.layout.value"
					:can-act-on-item="items.canActOnItem.value"
					:catalog-open="catalogOpen"
					:walkthrough="walkthrough"
					:exterior="exterior"
					@set-mode="editor.setMode"
					@open-catalog="toggleCatalog"
					@duplicate-item="items.duplicateSelected"
					@delete-item="items.deleteSelected"
					@toggle-walkthrough="toggleWalkthrough"
					@toggle-exterior="toggleExterior"
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
							<div
								v-if="levels.enabled.value"
								class="pointer-events-none absolute right-3 top-3 z-20 w-44">
								<LevelSwitcher
									:levels="levels.levels.value"
									:unit="display.unit.value"
									:all-storeys="camera.allStoreys.value"
									@set-active="levels.setActive"
									@add="levels.addAbove"
									@remove="levels.remove(levels.active.value)"
									@set-all-storeys="camera.setAllStoreys" />
							</div>
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
									move the mouse to look · <strong>click the floor</strong> to go there ·
									<kbd>Esc</kbd> to leave
								</p>
							</div>
						</ThreeViewport>
					</template>
				</AppWorkspace>

				<!--
					`v-if` while viewing, not `v-show` (RM-013 K2). Every panel in
					there is a set of live editors bound straight to model objects -
					18 of the 20 files carry an editable control - so hiding it with
					CSS would leave a form over somebody else's design that a screen
					reader still reaches and a Tab still lands in.
				-->
				<InspectorPanel
					v-if="!share.viewing.value"
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
			:promised="catalog.promised.value"
			:placement="selection.placementContext.value"
			@add-item="onAddItem"
			@prefetch-item="assets.prefetchItem"
			@import-model="importOpen = true" />

		<ImportModelDialog
			v-model:open="importOpen"
			:pending="models.pending.value"
			:stored="models.stored.value"
			:busy="models.busy.value"
			:refusal="models.refusal.value"
			:available="models.available.value"
			:accept="models.ACCEPT"
			:limit="models.MAX_MODEL_BYTES"
			:units="models.UNITS"
			:preview="models.preview"
			@choose="models.choose"
			@cancel="models.cancel"
			@place="onPlaceModel"
			@place-stored="onPlaceStoredModel"
			@forget="models.forget" />

		<ShortcutsDialog v-model:open="shortcutsOpen" :bindings="bindings" />

		<ShareDialog
			v-model:open="shareOpen"
			:link="share.link.value"
			:chars="share.chars.value"
			:limit="share.MAX_LINK_CHARS"
			:refusal="share.refusal.value"
			:busy="share.busy.value"
			:available="share.available.value"
			:copy="share.copyLink"
			@save-file="io.saveDesign" />

		<ProjectLibrary
			v-model:open="libraryOpen"
			:projects="projects.projects.value"
			:templates="templates.entries.value"
			:current="projects.current.value"
			:dirty="projects.dirty.value"
			:busy="projects.busy.value"
			:available="projects.available.value"
			:templates-error="templates.error.value"
			@open-project="onOpenProject"
			@rename-project="projects.rename"
			@duplicate-project="projects.duplicate"
			@delete-project="projects.remove"
			@start-template="onStartTemplate"
			@save-current="onSaveProject" />

		<ToastStack />
	</TooltipProvider>
</template>
