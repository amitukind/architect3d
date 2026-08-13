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
page that has never heard of Vue, and what lets 828 tests exercise the model
with no renderer and no browser.

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

`configuration.js` is a global singleton holding the display unit, wall height
and thickness, grid spacing and the snap settings. It is read all over the
library and it **dispatches nothing** — a change to it takes effect the next
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
they hold no DOM node, no canvas and no GPU resource — which is what lets
`exportSerialized()` be a pure function of them, and what lets `dispose()`
leave the model standing.

Rooms are not stored; they are **derived**. `Floorplan.update()` walks the wall
graph looking for closed loops and rebuilds the room list from scratch. This is
why the model layer is so protective of object identity: room detection
compares `Corner`s with `===`, and so does `EventDispatcher`'s listener
deduplication.

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

### `three` — the 3D view

`main.js` owns the renderer, the cameras and the render loop, which is
**on demand**: `setAnimationLoop` runs but the frame is skipped unless
something marked the scene dirty, so an idle design costs nothing.

`floorPlan.js` builds `Edge`s (wall faces) and `Floor`s from the model and
throws them all away on every redraw. `controller.js` handles picking and
dragging, `hud.js` the selection box and rotation arrow, `skybox.js` the
gradient sky and ground, `lights.js` the two lights.

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

Several of these exist because the library signals through
`EventDispatcher`, not through anything Vue can watch. A composable subscribes
on mount, mirrors what it hears into a `ref`, and unsubscribes on unmount.

**`components/`** is the shell, the two viewports and the toolbars.
**`inspector/`** is the selection panels; its props are live model objects,
which is why `vue/no-mutating-props` is switched off for that directory alone —
writing to them is what an inspector *is*.

`App.vue` constructs the `BlueprintJS`, because it needs both viewport elements
in a single call and children mount before parents; the viewports expose their
elements with `defineExpose`.

## Where the layers meet

Three seams are worth knowing, because each one is a place where a change in
one layer does *not* automatically reach the other:

1. **`Configuration` dispatches nothing.** Changing the display unit, grid
   spacing or a wall-measurement flag needs an explicit redraw.
2. **`Floorplan3D.redraw()` rebuilds every `Edge` and `Floor`.** Anything
   configured on a wall material must be reapplied in the rebuild path, not
   just in a constructor.
3. **Textures are reloaded, never cached.** `TextureLoader` runs per wall per
   redraw and nothing is disposed. Known, and on the post-migration backlog.

## Testing

`tests/` is 828 tests in 16 files, all headless. jsdom supplies the DOM, a stub
renderer stands in for WebGL, and `tests/helpers/` holds the shared harness.

Most of the suite is *characterization*: it was written against the pre-
migration behaviour and it pins that behaviour, quirks included. Two known bugs
in `Utils.pointInPolygon` and `isClockwise` are asserted **as they are**,
because room detection depends on them. `tests/README.md` lists every preserved
quirk, and the post-migration backlog is where they get fixed with tests.
