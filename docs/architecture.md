# Architecture

## The one rule

```
src/app  ───imports───▶  src/scripts
         ◀──never─────
```

`src/scripts/` is the library. `src/app/` is a Vue 3 application built on it.
The arrow points one way and nothing goes back: there is no Vue anywhere under
`src/scripts/`, and `npm run build` bundles the library alone.

That is not a style preference — it is what makes the library embeddable in a
page that has never heard of Vue, and what lets 870 tests exercise the model
with no renderer and no browser.

It also decides where the UI stack lives. Tailwind, Reka UI, lucide and VueUse
are **devDependencies**, because `files` in `package.json` publishes
`src/scripts` alone — nothing a consumer installs could import them, and
declaring them as runtime dependencies would make npm fetch four packages that
can never be reached. `dist/bp3djs.js` contains no CSS at all.

## The layers

```
                     ┌─────────────────────────────┐
                     │  src/app        Vue 3 shell │
                     │  components · composables · │
                     │  inspector                  │
                     └──────────────┬──────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐        ┌──────────────────┐         ┌──────────────────┐
│ floorplanner  │        │      model       │         │      three       │
│  2D view +    │◀──────▶│  plain data:     │◀───────▶│  3D view, camera │
│  controller   │        │  Floorplan       │         │  controls, HUD,  │
│  (canvas 2D)  │        │  Scene / Items   │         │  exporters       │
└───────────────┘        └──────────────────┘         └──────────────────┘
                                    ▲
                                    │
                          ┌─────────┴─────────┐
                          │  core             │
                          │  units, config,   │
                          │  events, geometry │
                          └───────────────────┘
```

### `core` — the shared vocabulary

`configuration.js` holds the display unit, wall height and thickness, grid
spacing and the snap settings. `Configuration` is both a class and a namespace:
the statics read one page-wide default, and a `Floorplan` given a
`Configuration` of its own reads that instead — which is what lets two designs
sit on one page without sharing units. It dispatches `EVENT_CONFIG_CHANGED`,
but nothing in the library listens, so a change still takes effect the next
time something draws. That is why the application calls `floorplanner.redraw()`
after touching it.

`dimensioning.js` converts between centimetres (what the model stores) and
whatever unit the user picked. `events.js` is the string constants every
`EventDispatcher` in the project fires; see [Events](/events).

`geometry_merge.js` and `geometry_builders.js` are the loader path: they flatten
a loaded glTF into a single `BufferGeometry` with material groups.

### `model` — plain data

`Floorplan` holds `Corner`s, `Wall`s, `HalfEdge`s and `Room`s. `Scene` holds
the loaded `Item`s. Between them they are the entire state of a design, and
they hold no DOM node and no canvas — which is what lets `exportSerialized()`
be a pure function of them, and what lets `dispose()` leave the model standing.

::: warning The model does hold GPU resources
This section used to say it held none, and that was wrong. `Room` builds two
`Mesh`es — `floorPlane` and `roofPlane` — and every `HalfEdge` builds a third.
They are the invisible planes the raycaster tests against for floor, ceiling and
wall picking, and being invisible is how they escaped the description; a
`ShapeGeometry` is a `ShapeGeometry` whether or not it is drawn, and `Floor`
puts all of them into the live three scene.

So `Room` and `HalfEdge` have a `dispose()`, and `Floorplan.update()` calls it on
everything it is about to replace. Before RM-003 A0 it did not, and each call
abandoned six geometries and six materials. The **3D view borrows these and must
never dispose them** — see the ownership note under `three` below.
:::

Rooms are not stored; they are **derived**. `Floorplan.update()` walks the wall
graph looking for closed loops and rebuilds the room list from scratch. This is
why the model layer is so protective of object identity: room detection
compares `Corner`s with `===`, and so does `EventDispatcher`'s listener
deduplication.

Because it rebuilds everything, `update()` is expensive, and `newCorner()` and
`newWall()` each call it. Bulk builds wrap themselves in
**`beginBatch()` / `endBatch()`**, which defers the re-derivation to one call at
the end — opening a four-wall design used to dispatch `EVENT_UPDATED` 25 times
and now dispatches it once. Always pair them in a `finally`: a batch left open
silently stops the plan updating.

`document.js` is what a `.blueprint3d` file has to satisfy before any of this
runs. `Model.loadDocument()` validates the whole document first, so a file that
is not a design cannot reach live state — see the save-format docs.

::: warning Identity matters
Never wrap a model object in a Vue `ref()` or `reactive()`. The proxy is not
`===` the target, which silently breaks both room detection and listener
removal. Use `shallowRef` for the slot and `markRaw` for the object — see
`src/app/composables/useBlueprint.js`.
:::

### `floorplanner` — the 2D view

`floorplanner.js` is the controller (modes: move, draw, delete) and
`floorplanner_view.js` is the renderer, drawing to a plain 2D canvas. There is
no scene graph and no retained objects; every change repaints the whole canvas.
`carbonsheet.js` is the image underlay you can trace over.

Everything it paints with comes from **`floorplannerPalette`**, a mutable object
seeded from the twenty-one exported colour constants. A canvas cannot read a
stylesheet, so a themed application has to hand it colour strings; the
constants remain the defaults, and an embedder that never calls
`setFloorplannerPalette` gets pixel-identical output to before.

### `three` — the 3D view

`main.js` owns the renderer, the cameras and the render loop, which is
**on demand**: `setAnimationLoop` runs but the frame is skipped unless
something marked the scene dirty, so an idle design costs nothing.

`floorPlan.js` builds `Edge`s (wall faces) and `Floor`s from the model and
throws them all away on every redraw. `controller.js` handles picking and
dragging, `hud.js` the selection box and rotation arrow, `skybox.js` the
gradient sky and ground, `lights.js` the lights.

**`render_profile.js`** decides how all of that is shaded. Two profiles:

| | `classic` | `studio` |
|---|---|---|
| Walls | `MeshBasicMaterial`, unlit | `MeshStandardMaterial`, lit, shadow casting |
| Floors | `MeshPhongMaterial` | `MeshStandardMaterial` |
| Ambient | one hemisphere light | hemisphere + PMREM environment |
| Key light | directly overhead, `#330000` | off-axis, white, 2048 shadow map |
| Tone mapping | none | ACES filmic |
| Atmosphere | none | linear fog to the horizon |

`classic` is the **default**, and is exactly what shipped through 1.0.0 — which
is what keeps the parity grid and the colour-pipeline suite meaningful. The
application opts into `studio` in `src/app/main.js`, before construction:
materials pick their class while being built, so the profile has to be set
first. `Main.applyRenderProfile()` switches a live viewer, at the cost of
rebuilding every `Edge` and `Floor`.

::: tip Why the key light was red
`lights.js` called `setHSL(1, 1, 0.1)` on a light it had just constructed as
white. Hue 1 wraps to 0, so the "white" key has always been `#330000` — a dim
red wash contributing essentially no shadow contrast. It did not matter while
nothing in the room was lit. `classic` keeps it, bug and all; `studio` does not.
:::

`orbitcontrols.js` and `pointerlockcontrols.js` are thin subclasses over
three's own addons — the previously vendored copies are gone as of S5.

### `items` — the furniture

Eight classes over one `Item` base, and the class decides how a thing behaves:
whether it snaps to a wall, cuts a hole in one, sits on the floor, hangs from
the roof, or floats free. `factory.js` maps the numeric `item_type` in a save
file to the class. Adding a ninth type means a class and a factory entry.

## The application layer

`src/app/` is deliberately thin — it holds no design state of its own.

**`composables/`** is where the application's state lives, one concern each:

| Composable | Owns |
|---|---|
| `useBlueprint` | The single `BlueprintJS` instance and its lifetime |
| `useSelection` | What is selected, and the placement context for the catalog |
| `useCameraViews` | View mode, presets, ortho/wireframe, the auto-spin contract |
| `useFloorplannerMode` | Which 2D tool is active |
| `useCatalog` | The item palette and how a click becomes an `addItem` |
| `useDesignIO` | Save, open, and the exporters |
| `useDisplayUnit` | A reactive mirror of the unit inside `Configuration` |
| `useLayout` | Which viewports are on screen, and the split ratio |
| `useHistory` | Undo and redo, as snapshots of the serialized design |
| `useZoom2D` | Zoom, framing, snapping and grid density for the plan |
| `useTheme` | Light and dark, for the chrome and for the canvas |
| `useShortcuts` | One keyboard map, suppressed while a field has focus |
| `usePlanStats` | Room, wall and item counts, and total floor area |
| `useItemActions` | Delete and duplicate the selected item |
| `useAutosave` | A draft in local storage, offered back after a reload |
| `useToasts` | Transient notices |

Several of these exist because the library signals through
`EventDispatcher`, not through anything Vue can watch. A composable subscribes
on mount, mirrors what it hears into a `ref`, and unsubscribes on unmount.

**`components/`** is the shell: a top bar, a tool rail, a status bar, and a
workspace holding the two viewports. **`inspector/`** is the selection panels;
its props are live model objects, which is why `vue/no-mutating-props` is
switched off for that directory alone — writing to them is what an inspector
*is*.

::: warning A hidden viewport is transparent, never absent
`AppWorkspace.vue` shows one viewport, the other, or both. In every layout
*both* stay laid out at full size — a hidden one is `opacity: 0` with pointer
events off, not `v-if` and not `display: none`. The library measures its
containers with `clientWidth`/`clientHeight` and watches them with a
ResizeObserver, so a collapsed pane measures zero and the viewer returns with a
zero aspect ratio. The card flip this replaced had the same constraint for the
same reason.
:::

`App.vue` constructs the `BlueprintJS`, because it needs both viewport elements
in a single call and children mount before parents; the viewports expose their
elements with `defineExpose`.

## Where the layers meet

Seven seams are worth knowing, because each one is a place where a change in
one layer does *not* automatically reach the other:

1. **`Configuration` announces a change but redraws nothing.** It dispatches
   `EVENT_CONFIG_CHANGED` with the key, the new value and the old — but only
   the application listens; the 2D view does not, so changing the display unit,
   grid spacing or a wall-measurement flag still needs an explicit
   `floorplanner.redraw()`.
2. **A design's settings are per-`Floorplan`, and default to shared.**
   `floorplan.configuration` and `floorplan.dimensioning` are what the model
   and the 2D view read. Construct a `Floorplan` (or a `BlueprintJS`) without
   one and it shares the page-wide default, which is what the `Configuration`
   and `Dimensioning` statics also read.
3. **`Floorplan3D.redraw()` rebuilds every `Edge` and `Floor`.** Anything
   configured on a wall material must be reapplied in the rebuild path, not
   just in a constructor.
4. **Textures are shared and refcounted.** `acquireTexture` hands out a
   `Texture.clone()` over one decoded image, and the last `releaseTexture`
   disposes it. Each surface keeps its own `repeat` and `wrap`; the pixels are
   loaded once. Disposing a viewer releases *its* handles and nothing else, so a
   second viewer on the page keeps its images.
5. **Every GPU resource has exactly one owner.** A `Room` owns its two hit-test
   planes and a `Wall` owns its two `HalfEdge` planes — the half edge writes
   itself onto `wall.frontEdge`/`backEdge`, which is what makes the wall the
   thing that can still reach it. The 3D `Floor` **borrows** the room's two
   planes for picking and never disposes them; `Edge` owns its six wall meshes
   and releases them through a `ResourceRegistry`. Getting this backwards is
   worse than leaking: a disposed geometry still answers on the CPU side, so
   over-disposal shows up as a black surface somewhere else, later.
   `core/resource_registry.js` is the vocabulary — `register`/`release` for
   batches with sharing, `disposeObject` for a mesh built and dropped in one
   method.
6. **The render profile is read at construction.** Setting `renderProfile.mode`
   by hand changes nothing already built; go through `setRenderProfile` before
   construction, or `Main.applyRenderProfile()` after it. A viewer given its own
   profile — `new BlueprintJS({renderProfile: createRenderProfile(RENDER_STUDIO)})`
   — does not touch the shared one.
7. **Undo captures what the save format captures.** `saveFloorplan` writes only
   the corners its walls reach, so a corner with nothing attached is not in a
   snapshot and cannot be restored by one. Unreachable through the UI, which
   creates corners and walls together; reachable by an embedder driving the
   model directly.

## Testing

`tests/` is 870 tests in 17 files, all headless. jsdom supplies the DOM, a stub
renderer stands in for WebGL, and `tests/helpers/` holds the shared harness.

Most of the suite is *characterization*: it was written against the pre-
migration behaviour and it pins that behaviour, quirks included. Two known bugs
in `Utils.pointInPolygon` and `isClockwise` are asserted **as they are**,
because room detection depends on them. `tests/README.md` lists every preserved
quirk, and the post-migration backlog is where they get fixed with tests.
