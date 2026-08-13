# Test suite

The safety net for the Vue 3 + Vite + three 0.185 migration described in
[`docs/roadmap.html`](../docs/roadmap.html). Before S0 this repository had no
tests at all; everything here exists so that later sprints can prove they
changed nothing they did not intend to change.

Two kinds of test live here, and the distinction matters when one fails:

- **Characterization tests** (S0, the six headless modules) pin what the legacy
  code *does*. A failure means you changed behaviour - probably by accident.
- **Contract tests** (S2, the two jsdom modules) pin what a sprint deliberately
  *changed*. A failure means the new contract broke.
- **Golden comparisons** (S3 and S4) pin what a *previous engine* produced,
  recorded as data. three r98 is gone; these fixtures are all that is left of
  it, and they cannot be regenerated - see "Frozen r98 readings" below.

```bash
npm test                 # run once
npm run test:watch
npm run fixtures         # regenerate tests/fixtures/*.blueprint3d
npm run catalog          # src/catalog/catalog.json -> build/js/items.js (S3)

# Historical, and they say so when run: these three need three r98 and refuse
# to run against r185. Their output is checked in.
node tools/convert-legacy-json.mjs        # the 25 .glb conversions (S3)
node tools/capture-geometry-goldens.mjs   # tests/fixtures/geometry-r98.json (S4)
node tools/capture-model-goldens.mjs      # the two legacy-*-r98.json fixtures (S4)

npm run dev       # Vite dev server: the Vue app, plus /legacy.html (S6)
npm run build     # Vite library build -> dist/bp3djs.js (IIFE global BP3DJS)
npm run lint      # ESLint 10 flat config
```

## These are characterization tests, not specifications

They assert **what the code does today**, not what it ought to do. The data
layer contains several quirks that are load-bearing — floorplans users have
already drawn and saved depend on them — so the migration preserves them
deliberately. Examples pinned by this suite:

| Behaviour | Where |
|---|---|
| Saved coordinates are stored in the **active display unit**, not centimetres | `floorplan.js` save/load via `Dimensioning.cmToMeasureRaw` |
| `Utils.pointInPolygon` always returns false (wrong arity) — item placement relies on the stable output | `core/utils.js` |
| `Utils.isClockwise` derives `tSubY` from `p.x` | `core/utils.js` |
| `Version.isVersionHigherThan` returns `0`/`1` and means per-component `>=` | `core/version.js` |
| Walls snapshot `wallHeight`/`wallThickness` at construction; later config changes do not apply retroactively | `model/wall.js` |
| Only corners referenced by a fully-connected wall are serialized | `floorplan.js` |

**If a test fails during migration work, the default assumption is that the
change is wrong — not the expectation.** Re-read the roadmap's preserve/fix
ledger (section 01) before editing an expectation. Genuine fixes are scheduled
per-sprint and land together with an intentional test update.

Expectations retired that way so far, all listed as FIX in the ledger:

| Retired | Sprint | Where |
|---|---|---|
| `Wall.setStart`/`setEnd` leaked an `EVENT_MOVED` listener per re-attachment | S2 | `wall-corner-ops.test.js` |
| `setEnd` had its add and remove the wrong way round | S2 | `wall-corner-ops.test.js` |
| `HalfEdge.distanceTo` threw on every curved wall (`this._bezier`) | S4 | `wall-corner-ops.test.js` |
| The item merge dropped glTF parent node transforms on 42 models | S4 | `model-conversion.test.js` |
| `EVENT_MODE_RESET` was read as the mode itself, so the toolbar highlight never rendered | S6 | `app-composables.test.js` |
| The item inspector was built without its item, so every control it offered was inert | S6 | `app-shell.test.js` |
| Adding a wall-bound item before clicking a wall threw and added nothing | S6 | `app-composables.test.js` |
| `OrbitControls` left a document keydown behind if the host detached the element first | S6 | `viewer-lifecycle.test.js` |
| The corner panel never followed a drag - it listened for the setter event, and `Corner.move()` dispatches only `EVENT_MOVED` | S7 | `app-inspector.test.js` |

One S0 test **fired as designed** in S4 rather than being retired: the
zero-length `wallSize` setter produced NaN coordinates that r98's
`Vector2(x, y) { this.x = x || 0; }` used to launder back to zero. r125 replaced
that with default parameters and the NaN survived. The test is unchanged; the
setter now returns early, which is what it always asserted.

## Layout

```
tests/
├─ helpers/harness.js   deterministic seeding, config reset, plan builders,
│                       id normalisation, room signatures, stub item loader
├─ helpers/dom.js       jsdom stubs: 2D context, ResizeObserver, pointer and
│                       pointer-lock APIs, element layout, and a listener
│                       counter for proving dispose() is complete
├─ helpers/renderer.js  the fake WebGLRenderer handed to Main.setRendererFactory,
│                       shared by the viewer and application suites
├─ fixtures/*.blueprint3d   frozen design files (generated, see below)
│
│  headless data layer (S0, characterization) — environment: node
├─ serialization.test.js    save/load schema, the unit landmine, round-trips
├─ room-detection.test.js   findRooms: square, L-shape, shared wall, open loops
├─ wall-corner-ops.test.js  wall splitting, corner merge tolerance, curved walls
├─ dimensioning.test.js     unit conversions, Configuration, Version, Utils quirks
├─ items-and-scene.test.js  frozen item_type registry, the no-network loader seam
│
│  DOM contract (S2) — environment: jsdom, declared per file
├─ floorplanner-2d.test.js  pointer input, rect coordinates, DPR, 2D dispose
├─ viewer-lifecycle.test.js Main/Controller/BlueprintJS mount, picking, unmount
│
│  assets (S3, still proved in S4) — environment: jsdom
├─ helpers/models.js        glTF loading, geometry measures, digests, and the
│                           readers for the frozen r98 measurements
├─ model-conversion.test.js per-model A/B for all 25 conversions; the merge
│                           pipeline and its S4 node-transform fix
├─ catalog-and-shim.test.js catalog integrity, legacy URL rewriting, round trip
│
│  engine (S4) — environment: jsdom
├─ geometry-rewrites.test.js  every hand-built mesh, against what r98 drew
│
│  the Vue application (S6-S7, contract) — environment: jsdom
├─ app-composables.test.js  the blueprint's lifetime, the single selection, the
│                           camera modes, catalog placement, file IO
├─ app-shell.test.js        App.vue mounted for real: boot, the toolbar
│                           highlight, the flip, the catalog, mount/unmount
│                           symmetry
└─ app-inspector.test.js    the native panels: each one against a real model
                            object, the texture grid, and the unit switch
```

The three application modules are contract tests, not characterization: the
sprints deliberately replaced the demo's globals with a store and a single
selection, replaced dat.GUI with native panels, and fixed four app-layer bugs on
purpose. A failure there means the new contract broke, not that legacy
behaviour drifted.

## Frozen r98 readings

Three fixtures record what three r98 produced. They are the reference for every
S3 and S4 geometry assertion, and **they cannot be regenerated** - the tools
that wrote them need `Geometry` and `JSONLoader`, removed in r125 and r97. Both
tools are still in the tree, and both refuse to run against r185 with an
explanatory message rather than a stack trace.

| Fixture | Written by | Holds |
|---|---|---|
| `geometry-r98.json` | `tools/capture-geometry-goldens.mjs` | 28 meshes - wall shapes with and without holes, roof fans, fillers, raycast planes, the HUD line - as per-triangle-corner positions, UVs and normals |
| `legacy-models-r98.json` | `tools/capture-model-goldens.mjs` | the 25 legacy JSON originals: triangles, bounds, surface area, a position-set digest and a UV digest |
| `legacy-merge-r98.json` | `tools/capture-model-goldens.mjs` | what the pre-S3 merge produced for all 168 catalog models, with local- **and** world-matrix bounds side by side |

The comparison form is per-triangle-corner rather than per-vertex. Legacy
`Geometry` numbered and shared its vertices differently from an indexed
BufferGeometry, so vertex indices were never comparable; "triangle 7's second
corner sits at (x,y,z) with uv (u,v)" is the same question on both engines and
is the one that decides what gets drawn.

**One case is compared as an equivalent surface rather than an identical
triangle list.** three's ear-clipping triangulator changed between r98 and
r185, so `ShapeGeometry` cuts a polygon *with holes* into a different set of
triangles - 10 of 14 shared on the two-hole case, the rest being different
interior diagonals across the same region. That is three's code, not this app's.
Those cases assert the properties that decide the rendered result: identical
vertex set, identical total area, consistent facing, same triangle count, and
the same UV at every vertex position. Contours without holes still match
exactly, and so does every mesh this app builds by hand.

## Fixtures

Generated by [`tools/make-fixtures.mjs`](../tools/make-fixtures.mjs) through the
real model layer, with a seeded id generator, so regenerating produces
byte-identical files. A surprise diff means the model layer changed.

- `simple-room.blueprint3d` — 400×300 single room; smoke subject
- `rich-design.blueprint3d` — two rooms sharing a wall, per-surface textures,
  varied corner elevations, floor textures, a carbon sheet
- `curved-walls.blueprint3d` — two curved walls

All three are written in **centimetres**; set `configDimUnit = dimCentiMeter`
before loading them, or the coordinates come back scaled by 100.

The curved-wall design is deliberately kept **separate** from wall-bound items:
`WallItem.placeInRoom` → `closestWallEdge` → `HalfEdge.distanceTo` dereferences
an undefined `this._bezier` on its curved branch (`model/half_edge.js:298`), so
a design combining the two throws on load. That crash is scheduled for S4.

## Scope

The **headless data layer** (`src/scripts/core`, `src/scripts/model`,
`src/scripts/items` where it does not need a DOM) plus, since S2, the **DOM
attachment surface** of the 2D floorplanner and the 3D viewer: how they read
pointer input, how they size themselves, and whether they let go of everything
on `dispose()`.

Since S3 it also covers the **asset pipeline**: that the 25 converted models
carry the same geometry as the JSON originals, and that the merge rewrite in
`core/geometry_merge.js` produces what the pre-S3 code produced.

What still needs a real browser, and is checked by hand:

- **Rendering.** Pixels are not asserted anywhere, but they are now
  *comparable*. `npm run parity` renders ten states — the view presets, the
  0.3-opacity fade, floor tiling, wireframe and the 2D canvas — through both
  three r98 and the working tree, and writes a side-by-side grid to
  `tools/parity/index.html`. The r98 side needs no npm install: the
  `legacy-demo` tag ships a prebuilt bundle, which is served as static files.

  Nothing is committed as a golden PNG on purpose. A software-GL screenshot is
  not portable between machines or Chrome versions, so a checked-in reference
  would drift into noise; capturing both sides in the same run, in the same
  environment, is what stays meaningful.

  There is no setup — `npm run parity` creates the worktree at the tag itself
  (sparse, so it costs ~15 MB rather than 219 MB) and builds the current bundle
  if it is missing. Everything it writes lives under `tools/parity/`, which is
  gitignored. To reclaim the space:

  ```bash
  git worktree remove tools/parity/legacy-worktree && rm -rf tools/parity
  ```

  This is what caught the S4 lightmap regression — walls were rendering pi
  times too dark, and no headless test could have seen it.
- **WebGL context release.** `viewer-lifecycle.test.js` injects a fake renderer,
  so it can prove `dispose()` and `forceContextLoss()` were *called* but not
  that the driver freed the context. Run
  [`tools/lifecycle-smoke.html`](../tools/lifecycle-smoke.html) for that: start
  `npm run dev` and open `/tools/lifecycle-smoke.html`. It counts DOM listeners
  and live WebGL contexts across mount → destroy → remount cycles and prints a
  pass/fail verdict.
- **Model shading.** `model-conversion.test.js` asserts shape — triangles,
  bounds, surface area, vertex positions, UV convention. It cannot judge
  whether a converted model *looks* right, because Lambert has no exact PBR
  equivalent and the standard is "accepted", not identical. S3's side-by-side
  page for this was `tools/model-ab.html`; S4 deleted it along with the
  JSONLoader that rendered its left column, exactly as planned.
- **The node-transform fix.** `mergeMeshes` now bakes each mesh's world matrix,
  which moves 42 of the 168 catalog models. Run
  [`tools/merge-transform-ab.html`](../tools/merge-transform-ab.html) for that:
  `npm run dev`, then open `/tools/merge-transform-ab.html`. Each pair is shown
  twice — under one shared camera (what changed) and framed individually (does
  it look right) — and sorted worst-first. Models are tagged from their node
  matrices, not their bounds: **24 moved, 2 rotated, 14 uniformly rescaled, 2
  genuinely stretched**. Only the last two can have deformed geometry, so those
  are the review.

## Enabling seams

Small production-safe hooks that make the library testable without a browser.
None changes default behaviour, and nothing in the library calls them.

| Seam | Sprint | Buys |
|---|---|---|
| `Utils.setRandomSource(fn)` | S0 | deterministic `Utils.guide()` ids |
| `Scene#setItemLoader(fn)` | S0 | item loading without network I/O |
| `Main.setRendererFactory(fn)` | S2 | mounting the 3D viewer without a WebGL context |
| `Scene.unloadableItemCount` | S4 | evidence that no design asks for a model this build cannot open (replaces S3's `legacyJsonLoadCount`, whose branch S4 deleted) |

Since S5 the jsdom harness also stubs pointer capture and pointer lock
(`installPointerApis`). three calls into both — OrbitControls captures the
pointer on `pointerdown`, PointerLockControls calls `exitPointerLock` when Main
puts the viewer into orbit mode at boot — and jsdom implements neither, so an
unstubbed test dies inside the addon with an error that has nothing to do with
what it was testing. Real browsers have shipped both for years, so the guard
belongs here and not in the library.

`Floorplan.loadFloorplan` also null-guards `this.carbonSheet` (S0), so headless
and widget-mode loads of designs containing a carbon sheet no longer throw.
