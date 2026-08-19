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
page that has never heard of Vue, and what lets a thousand tests exercise the
model with no renderer and no browser.

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

`design_runtime.js` is the object those services are collected on. A
`DesignRuntime` holds one document's configuration, its dimensioning, its render
profile, its load session, its resource registries and an id — and no design
data at all. `Floorplan`, `Model`, `Main` and every `Edge` reach it by the hop
they already had, so nothing took a new constructor argument to find it.
`runtimeOf(owner)` is the accessor, and `configuration` is a *getter* over
`runtime.configuration` everywhere it appears, so `configurationOf(x)` and
`runtimeOf(x).configuration` cannot come apart.

`asset_manifest.js` and `asset_resolver.js` are the indirection between the
logical asset name a saved design records and the physical URL fetched for it.
The library ships an identity resolver - every name to itself - and a manifest
is a runtime input rather than a bundled table, because 370 entries is 58 kB
nobody who serves their own assets should download.

## Asset delivery

The model catalog is compressed with `KHR_draco_mesh_compression`: 152 of 165
`.glb` files, taking `public/models/` from 5.08 MB to 1.92 MB. What is in a file
changed; what a file is *called* did not, which is the whole point — a design
saved before the re-encode names the same URLs and opens unchanged.

The other 13 models ship exactly as authored. `tools/encode-assets.mjs` gates
every model on three things and can only ever fall back: no triangle may
disappear, the count of distinct positions must not move, and no vertex may
travel more than 5 µm. The worst that survived is **0.38 µm**. Each measurement
is recorded in `asset-pipeline/encoding-report.json` and asserted by
`tests/asset-encoding.test.js`, so the fidelity claim is checkable from a
checkout without running the encoder.

`Scene` attaches a `DRACOLoader` unconditionally, and that costs nothing until
something needs it: three fetches the 73 KB decoder on the first compressed
mesh, not at construction. The decoder path comes from
`resolver.decoderPath()` — derived from the resolver's base, so `?assetBase=`
relocates the decoder along with everything else rather than leaving it pinned
to the origin.

Two things worth knowing before changing any of this. `vite.config.mjs` carries
a `dropBundledDraco()` plugin, because three's `DRACOLoader` references its own
bundled decoders through `new URL(..., import.meta.url)` and a bundler reads
those as assets to emit — 489 KB gzipped onto the library IIFE for a decoder
nobody fetches. And the encoder hand-assembles its GLB output rather than using
`writeBinary()`, which embeds external images: 21 models reference a texture,
two of those are shared, and embedding would duplicate 933 KB while serving the
same pixels twice.

Textures are capped at **1024px on the long edge**, which is the other half of
the delivery story and a much cheaper half. Five files were over it; resizing
them took GPU memory from 104.67 MB to 43.00 MB and the tree down another
1.50 MB. `tools/resize-textures.mjs` does it, on the same terms as the encoder:
committed output, `--check`able, gates that can only fall back.

Two properties are doing the work, and both are worth understanding before
changing the cap. **The filename does not move**, so the 19 textures that live
inside `.glb` containers — which `GLTFLoader` resolves relative to the model,
bypassing the resolver entirely — are reachable without rewriting a single
container. And the image is resampled **in linear light with alpha
premultiplied**, because averaging sRGB values averages the wrong numbers and
visibly darkens fine bright detail on exactly the wood grain this targets.

The interesting question was what a downscale costs, and the answer is not
"nothing". `asset-pipeline/resize-oracle.json` holds 25 rendered-frame
comparisons, decomposed into harness noise, JPEG generation loss, and
resolution. The ground and the pale wood are free at every size; the
environment map is free below 512px; the two dark wood grains carry a real
2.3–3.7 rms difference (of 255) at realistic sizes. That was judged a good
trade for 61.67 MB, and it is written down so the judgement can be revisited
rather than reconstructed.

A logical name can outlive its file. `rooms/textures/hardwood.png` was
re-encoded as JPEG and no longer exists under that name, but it is the default
room texture and is written into every design that kept the default floor — so
the manifest carries a **retired** entry pointing it at `hardwood.jpg`. That is
the `url` field in `asset_manifest.js` doing the job it was added for, and it is
the mechanism that makes "an asset URL in a document is a name, not an address"
true rather than merely stated. Retirements are declared in
`tools/make-asset-manifest.mjs`, which refuses to build if one points at a file
that is not there. Rename a room texture only with a retirement; do not delete a
name.

Eleven textures are then **KTX2/ETC1S**, taking VRAM to 27.38 MB against a 45.15
MB ceiling. A JPEG becomes RGBA8 on the way to the GPU whatever it cost on disk;
a KTX2 is transcoded to a format the GPU reads directly and stays compressed at
one byte per pixel against RGBA8's four. `tools/encode-textures.mjs` transcodes,
`tools/repoint-textures.mjs` rewrites the containers in either direction, and
the second of those edits the JSON chunk and copies the BIN chunk through byte
for byte — so the Draco geometry above is untouched by construction rather than
re-verified.

**Eleven, not the eighteen B5 encoded, and the difference is the rule that
governs this whole pipeline.** `tools/transcode-oracle.mjs` renders a texture and
its transcode through identical state at 1:1 and differences the frames; nine of
B5's eighteen came out past the 3.0 RMS gate the resize pass already used, so
eight of them ship as JPEGs and one is re-encoded at a higher quality. **An
asset that cannot match the pixel tier ships uncompressed** — first applied to
the model catalog in B1, then to a sky photograph in C1, and now per texture
here. The refusals are listed with their measured error in `encode-textures.mjs`.

Run `npm run oracle -- --check` before adding a compressed texture. The cheap
half of that — every shipped `.ktx2` has a measurement and the measurement
passed — is asserted in `tests/asset-integrity.test.js` and runs with the normal
suite.

Two things about the runtime are worth knowing. **Nothing holds a renderer.**
`KTX2Loader` needs `workerConfig`, a record of which compressed formats the GPU
supports, and `detectSupport(renderer)` exists only to produce it;
`core/texture_formats.js` produces the same record from the device — from
`Main`'s renderer when there is one, otherwise from a one-pixel throwaway
context — so the texture cache and the model layer stay renderer-free. And the
containers declare `KHR_texture_basisu` as **required**, so a `GLTFLoader`
without a KTX2 loader attached refuses these files outright rather than
rendering them untextured. `Scene` attaches one; a consumer supplying their own
loader through `setItemLoader` must too.

**Most of the room textures are still JPEG**, and the paragraph that used to sit
here was wrong in two ways that RM-005 C1 measured. It read: *"Supporting it
means making `acquireTexture` asynchronous and changing `Floor`, `Edge` and
`Skybox` with it. That is 8.75 MB more, costed and not taken."*

`Skybox` was never in that list. It does not use `texture_cache` and never has —
it holds its own loader — and it owned 8.00 MB of the 11.67 MB available. Its
ground photograph is a KTX2 now, `Ground_4K.jpg` is a retired name pointing at
it, and that is 4.00 MB of the correction. Its environment map was measured and
refused: ETC1S bands a sky gradient at RMS 4.48 against a 3.0 gate.

The cache limitation itself is real and is stated correctly above — `texture_cache`
hands out a `Texture` synchronously, `KTX2Loader.load()` returns `undefined` and
delivers a `CompressedTexture` whose data lives in `mipmaps`. C1 built the change
that removes it and then reverted it, because the five textures behind the cache
all refuse ETC1S on their own merits: 7.4, 5.5, 10.2 and 4.1 RMS against a gate
of 3.0, and the fifth is a lightmap whose 21-byte dynamic range makes an absolute
gate the wrong instrument. **The cache was never the binding constraint — the
content was.** See `asset-pipeline/room-transcode-oracle.json`.

`dimensioning.js` converts between centimetres (what the model stores) and
whatever unit the user picked. `render_profile.js` is the table of shading
constants the 3D view reads — it lives here rather than in `three/` because the
runtime holds one and `core` imports from nothing above it. `load_session.js`
is here for the same reason. `events.js` is the string constants every
`EventDispatcher` in the project fires; see [Events](/events).

`geometry_merge.js` and `geometry_builders.js` are the loader path: they flatten
a loaded glTF into a single `BufferGeometry` with material groups.

### `model` — plain data

`Floorplan` holds `Corner`s, `Wall`s, `HalfEdge`s and `Room`s. `Scene` holds
the loaded `Item`s. Between them they are the entire state of a design, and
they hold no DOM node and no canvas — which is what lets `exportSerialized()`
be a pure function of them, and what lets `dispose()` leave the model standing.

**A storey is a whole `Floorplan`, not a field on one** (RM-010 G1). `Model`
holds a list of `Level`s, each with its own plan, its own furniture and one
stored number — its floor-to-floor height. Where a storey sits is the running
sum of the heights below it, derived and never stored.

`model.floorplan` is a **getter onto the active storey**, and that one getter is
why nothing else in the tree gained a level argument: the 2D view, the 3D view,
the inspectors, the composables and the file all read it exactly as they did
before there were any storeys. `Main.floorplan` does the same thing one layer
up. Two questions the getters do not answer are asked explicitly instead —
`scene.allItems()` for the whole building (the save file, resolving an id) and
`scene.getItems()` for the storey being edited (the plan, the item count, what a
click in 3D can hit).

The base elevation is applied in exactly one place: a `Group` per storey inside
`Scene`, positioned from the derived base. `Floor`, `Edge` and `Item` each build
their geometry relative to a plan they are handed and know nothing about
storeys — measured before the sprint, they ask a scene for `add`, `remove` and
`needsUpdate` and nothing else, which is why `Scene.levelScene(level)` can hand
each storey's `Floorplan3D` a three-method façade and none of those files
changed.

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
silently stops the plan updating. `beginBatch(reason)` labels the gesture; only
the outermost batch's reason is used, because the outermost batch *is* the
gesture. `loadFloorplan()`, `Corner.move()` and `Corner.removeAll()` each open
one.

Every change the plan announces is a **`ChangeSet`** (`core/change_set.js`),
carrying which kinds changed, the entities each kind affects, and why — see
[Events](/events). `Floorplan._emitChanges` is the only place either event is
dispatched, and it dispatches both: `EVENT_CHANGESET` and then the
`EVENT_UPDATED` derived from it. That is what keeps the legacy event honest —
it cannot fire without a ChangeSet describing it, so the two cannot disagree
about whether anything happened.

Which kind you get is decided by the argument `update()` already took:
`update(true)` re-derives the rooms and is a **topology** change,
`update(false, corners)` is a **geometry** change carrying those corners.

### Identity

Five kinds of thing in the model, and each is known by something different.
Getting this wrong is how a room loses its name, so it is worth the table:

| Entity | Identity | Persisted | Survives |
|---|---|---|---|
| `Corner` | `id`, assigned | yes, it is the file's key | everything |
| `Wall` | `id`, **reconstructed** from the corner pair on load | no — a file names its two corners | everything |
| `Room` | `id`, assigned, **inherited** by the room that continues it | no | edits, not a load |
| `HalfEdge` | `wall.id` + side, derived | no | whatever its wall does |
| `Item` | `designId`, assigned | **yes** | everything |

Two of these need explaining.

**A `Room` does not survive `update()`** — a new one is built for every cycle
found, every time — so its identity is *carried* rather than kept.
`model/room_matcher.js` pairs each re-derived room with the room it overlaps
most, one to one, and `Floorplan.carryRoomIdentity()` hands the id over and
moves the name and floor-texture entries to the successor's keys. That is what
makes drawing a wall through a room keep its name. The rule has a floor under
it: two rooms sharing a single corner touch at a point and are not the same
room.

**A `Wall`'s is derived on load, not stored** (RM-004 B2). `core/wall_identity.js`
sorts the two corner ids and appends `#n` for the second and subsequent walls
spanning the same pair, counting in file order. Sorting is what makes a wall
recorded `b → a` the same wall as one recorded `a → b`; the ordinal is what stops
two walls between one pair sharing an identity — which `newWall()` does not
prevent, and which survives a round trip. Neither rule alone is enough, and the
same argument as `Room` applies to why nothing is written to the file: a file
describes a wall by its corners, and that is a description any build can read.

`HalfEdge` gets this for free, since its id is `${wall.id}:front|back` — which
is what lets a wall-bound item find its face again after a load, and is why
windows and doors stopped reloading on undo.

**An `Item`'s is called `designId`, not `id`,** because `Item extends Mesh` and
three defines `Object3D.id` as a non-writable number of its own. It is also the
only one written into the save file, because an item has nothing else to be
described by — two identical chairs at the same place are two chairs — and
because undo needs both sides to name the same item.

::: warning A room id is per-session; a wall id is not, any more
`Floorplan.reset()` destroys every wall and room, and a load rebuilds them. A
**room** therefore gets a fresh id on every load, so anything holding one across
a restore has to re-resolve it — `useSelection` does.

A **wall** used to behave the same way and no longer does: RM-004 B2 reconstructs
its id from data the file already carries, so it is the same before and after.
That is what makes wall selection survive an undo, and it is worth knowing which
of the two you are relying on.
:::

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

`floorplanner.js` is the controller — modes: move, draw, rectangle, dimension,
text, delete — and `floorplanner_view.js` is the renderer. There is no scene
graph and no retained objects; every change repaints the whole canvas.
`carbonsheet.js` is the image underlay you can trace over.

#### The view draws through a backend, not through a canvas

`backends.js` is eleven stateless drawing operations — `clear`, `fillRect`,
`line`, `curve`, `polygon`, `path`, `circle`, `arc`, `text`, `measureText`,
`dash` — with two implementations: `CanvasBackend` over a
`CanvasRenderingContext2D`, and `SvgBackend`, which accumulates elements and
hands back a document.

Each operation carries its own colour and width. There is no state to set and
restore, no transform stack and no current path, and that shape is chosen for
the *export* rather than for the canvas: a stateful interface maps onto a canvas
context for free and onto SVG badly, because an SVG element carries its own
style and has no notion of "the style in force". Even rotation is a parameter of
`text` rather than a transform, because it is the only rotation the plan draws.

`plan_export.js` is what turns that into a sheet — bounds, a scale projection, a
scale bar, a title block — and it is deliberately **not** a renderer.
`FloorplannerView2D.renderTo(backend, project, size)` swaps the backend and the
projection, calls the same `draw()` the screen calls, and puts them back. A
sheet is the plan on screen, not a second rendering of it, so there is nothing
to keep in step.

A scale is a physical promise: CSS defines an inch as 96 pixels, so a centimetre
of paper is 96/2.54 of them and a four-metre wall on a 1:100 sheet is exactly
four centimetres. PNG export makes no such promise — an image is pixels — so it
fits the plan to a width and its title block says "not to scale" beside a scale
bar, which stays true through a photocopier when a printed ratio does not.

#### How the plan sees the furniture

It does not, directly — and that is deliberate (RM-008 E1). `BlueprintJS` hands
`Floorplanner2D` a `Floorplan`, and a `Floorplan` holds walls, corners and rooms
and has no reference to `Model` or `Scene`. So before E1 the plan could not draw
a chair even in principle, and the obvious fixes both cost something real:
passing the `Model` in widens a public constructor to read one list, and giving
`Floorplan` a back-reference puts the scene inside the layer whose whole
discipline is plain data with no DOM and no GPU.

What it gets instead is a **projection**. `Model` — the one object that holds
both halves — derives an array of footprints, each one an id, a centre, half
extents, a rotation, a type and a label in centimetres, and hands it to the
floorplan as data on `EVENT_ITEMS_PROJECTED`. The view draws a description of
the furniture and never touches an item.

Three consequences worth knowing:

- **The plan cannot become a second editor of the scene.** To change an item it
  asks, through the command interface `Model` installs with
  `floorplan.setItemCommands` — the same shape as `Scene.setItemLoader`, where
  the layer takes functions rather than importing the thing that does the work.
- **It is testable without a canvas**, which is most of why it is a module and
  not a lookup. `model/plan_projection.js` is pure functions over plain objects.
- **It can be compared.** "Items in the scene equals footprints on the plan" is
  a claim a test can make, and does, headlessly and again against a real
  raster.

Hit-testing uses `footprintContains`, which un-rotates the point about the
footprint's centre — a rotated rectangle is axis-aligned in its own frame. It
deliberately does not use `Utils.pointInPolygon`: that is one of four pinned
constant-returning predicates (see the ledger in `core/utils.js`), and a new
feature must not be built on a bug that is preserved on purpose.

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
keeps them, reacting to what changed rather than rebuilding the scene — see
seam 3 below. `controller.js` handles picking and
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

Eleven classes over one `Item` base, and the class decides how a thing behaves:
whether it snaps to a wall, cuts a hole in one, sits on the floor, hangs from
the roof, or floats free. `factory.js` maps the numeric `item_type` in a save
file to the class. Adding another type means a class and a factory entry —
appended, never filling one of the gaps at 5 and 6, because a type number is
written into every save file and one that used to mean something else is a trap.

**Three of the eleven are generated rather than downloaded**: `ParametricOpening`
(type 10, RM-008 F1), `ParametricStair` (type 11, F3) and `ParametricStructure`
(type 12, F2). Each carries a description of seven numbers, and its mesh, the
hole it cuts, the symbol the plan draws and the record it saves are all derived
from it. Everything else about them is an ordinary item: they select, undo,
project and persist through the same paths.

The generator itself is four files with a deliberate seam:

| File | What it is |
|---|---|
| `solid_builder.js` | Boxes into a buffer, with material groups, and two rotations. Knows nothing about doors, stairs or columns |
| `opening.js` | A door, window or archway: the description, the clamp, the geometry |
| `stair.js` | A flight: the description, the shape of its runs and landings, the plan symbol, the stairwell hint, the geometry |
| `structure.js` | A column or a beam: the description, which side of the plan's section it is on, the geometry |

`solid_builder.js` was written inside `opening.js` for F1 and moved out by F3,
unchanged, when stairs became its second caller — which is the check RM-009's
risk table asked F3 to make. What it found is that F1 had drawn the boundary at
the *call* (numbers in, a `BufferGeometry` and a material list out) but not
underneath it: the four builder pieces were module-private, so a second caller's
only options were to copy them or to import from a module named after doors.

The third caller tested it again and it held: a column and a beam are one `box`
each. A *round* column is not, and the prism that draws it stays in
`structure.js` with one caller rather than moving to the shared file
pre-emptively — the rule that file states is that a piece moves when a second
caller wants it, which is the rule F3 learned by finding `box` private.

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

Eleven seams are worth knowing, because each one is a place where a change in
one layer does *not* automatically reach the other:

1. **`Configuration` announces a change but redraws nothing.** It dispatches
   `EVENT_CONFIG_CHANGED` with the key, the new value and the old — but only
   the application listens; the 2D view does not, so changing the display unit,
   grid spacing or a wall-measurement flag still needs an explicit
   `floorplanner.redraw()`.
2. **A document's services are one object, and settings default to shared
   while lifetimes never are.** `floorplan.runtime` is a `DesignRuntime`;
   `floorplan.configuration` and `floorplan.dimensioning` are getters over it,
   and are what the model and the 2D view read. Construct a `Floorplan` (or a
   `Model`, or a `BlueprintJS`) without one and it gets a runtime of its own
   whose configuration, dimensioning and render profile **are** the page-wide
   defaults, by identity — the same objects the `Configuration` and
   `Dimensioning` statics read. What it does *not* get is the default runtime
   itself, and the difference is load-bearing: two documents sharing one
   `LoadSession` means opening a design in one abandons the furniture still
   arriving in the other.
3. **`Floorplan3D` projects incrementally, and `redraw()` is the reference.**
   It reacts to a topology change by *reconciling* — building a view for every
   model entity that has none, disposing every view whose entity is gone — and
   to a geometry change by redrawing only the faces and floors the moved corners
   touch. Anything configured on a wall material must be reapplied in `Edge`'s
   rebuild path, not just in a constructor, because both paths go through it.
   `redraw()` is still there and still correct; `incremental = false` restores
   it as the reaction to everything, which is the rollback switch and is what
   `tests/change-projection.test.js` diffs against.

   Note what a topology change costs today: `update(true)` constructs a new
   `Room` and a new `HalfEdge` for every one, so reconciliation finds nothing in
   common and rebuilds the lot. It is written as a reconciliation because that
   is the shape that becomes genuinely incremental once entities have an
   identity that survives recomputation. The geometry path is the one that is
   incremental now, and it is the one a drag takes.
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
7. **The camera reframes on topology, not on change.** `Main` subscribes to
   `EVENT_CHANGESET` and calls `centerCamera()` only for a topology change whose
   plan extent actually moved. A drag does not reach it; nor does a corner added
   strictly inside the existing plan. `cameraStats()` reports
   `{recentred, declined}`.
8. **Undo captures what the save format captures.** `saveFloorplan` writes only
   the corners its walls reach, so a corner with nothing attached is not in a
   snapshot and cannot be restored by one. Unreachable through the UI, which
   creates corners and walls together; reachable by an embedder driving the
   model directly.
9. **Restoring a snapshot reconciles the furniture; it does not rebuild it.**
   `Model.newRoom` keeps every item the incoming document still has, matched by
   `designId`, model url, type and picked colours, and moves it. Only genuine
   additions load anything — which is why undoing a corner nudge no longer
   re-downloads the sofa. Two consequences worth knowing: a **wall-bound** item
   is always reloaded, because it holds a `HalfEdge` and the floorplan is
   rebuilt by every load; and an item that IS kept goes through
   `Item.applyScale` and a direct position write, **not** `moveToPosition`,
   which is the interactive drag path and carries placement rules that would
   make a restore lossy.
10. **Disposal is scoped to a document, and a viewer disposes only what it
    owns.** `BlueprintJS.dispose()` tears down its views and then disposes its
    runtime — but only if it built that runtime. A runtime passed in through
    `new BlueprintJS({runtime})` belongs to the caller and is left open, which
    is what makes two viewers over one document expressible. `runtime.dispose()`
    releases every registry the document handed out and invalidates its load
    session; it does **not** touch the shared texture cache, which is refcounted
    across the page and is nobody's to clear from the teardown of one viewer.
    `runtime.stats()` is how the accounting is read: `{id, disposed, registries,
    resources, handles, session, assets}`.
11. **An asset URL in a document is a name, not an address.** `model_url` and
    the texture `url`s are logical names; `runtime.assets` resolves each to
    what is actually fetched, and with no manifest that is the same string.
    Two consequences worth knowing: the **logical** name is what
    `Item.getMetaData()` writes back out, so a resolved URL never gets baked
    into a document; and `Scene.setItemLoader`'s seam is handed the logical
    name too, because an embedder's own loader is their asset pipeline and a
    resolver they did not configure must not rewrite what reaches it.

## Testing

`tests/` is 1,192 headless tests in 26 files, plus 49 in a real browser. jsdom
supplies the DOM, a stub renderer stands in for WebGL, and `tests/helpers/`
holds the shared harness.

Most of the suite is *characterization*: it was written against the pre-
migration behaviour and it pins that behaviour, quirks included. Two known bugs
in `Utils.pointInPolygon` and `isClockwise` are asserted **as they are**,
because room detection depends on them. `tests/README.md` lists every preserved
quirk, and the post-migration backlog is where they get fixed with tests.
