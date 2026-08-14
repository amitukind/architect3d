# Changelog

## [Unreleased]

### Fixed

* **The library now disposes the GPU resources it builds.** Before this it
  disposed almost none of them: the whole of `src/` contained three
  `geometry.dispose()` or `material.dispose()` calls, and `Floorplan.update()`
  abandoned **six meshes, six geometries and six materials on every call** —
  with no change to the plan. Opening a four-wall design dispatches
  `EVENT_UPDATED` twenty-five times, so a file open abandoned roughly 150 of
  each before the first frame was drawn.

  Every ownership boundary is now explicit, and the measurement is a test rather
  than a claim: `tests/resource-lifecycle.test.js` asserts nothing is abandoned
  across repeated edits, and `tests/browser/gpu-memory.test.js` asks the
  renderer the same question through `renderer.info.memory` in chromium.

  What was released, and by whom:

  * `Room` and `HalfEdge` gained a `dispose()`. They build the invisible planes
    the raycaster tests against — two per room, one per half edge — and
    `Floorplan.update()`, `Floorplan.reset()` and `Floorplan.removeWall()` now
    release what they replace.
  * `Edge.remove()` releases its six wall meshes through a `ResourceRegistry`,
    as does `Edge.redraw()` before rebuilding. It previously released both
    textures carefully and no geometry at all.
  * `Floor.dispose()` and `Floor.redraw()` release the floor and roof planes.
  * `Item.removed()` was an empty method, so deleting an item released nothing.
    It now disposes the merged geometry, both materials, the two dimension-label
    canvases and their textures — and removes the selection-box `BoxHelper` from
    the scene, which nothing had ever done, so a deleted item left its bounding
    box behind pointing at an object no longer in the graph.
  * `Item.hideError()` disposes the error glow, which clones the whole item
    geometry each time it is shown.
  * `HUD` gained a `dispose()` and now releases its rotation handle — three
    geometries and three materials — on every selection change instead of
    dropping it.
  * `Skybox.dispose()` releases the ground photograph and the environment map.
    Both sat in a material's `map` or a shader uniform, and `Material.dispose()`
    in three does not touch either.
* **Disposing one viewer no longer empties the texture cache under the others.**
  `Main.dispose()` ended with an unconditional `clearTextureCache()`, which was
  always redundant for that viewer's own images — the cache is refcounted and
  every holder releases above it — and always destructive to anybody else's,
  forcing every other live viewer to re-fetch and re-decode. `clearTextureCache`
  is still exported for an embedder tearing down a whole page.
* **`Edge.removeFromScene()` is symmetric with `addToScene()`.** It cleared
  `planes` and `basePlanes` but not `phantomPlanes`, so `addToScene()` would
  re-add a plane that had already been taken out. Nothing pushes to
  `phantomPlanes` today, so this was latent rather than live.

### Added

* **`core/resource_registry.js`** — `ResourceRegistry` for batches of GPU
  resources with one owner and one release point, refcounted so a material
  shared by several meshes survives the first release; plus `disposeObject()`
  and `disposeMaterial()` for the cases where a registry would be ceremony.
* **Two designs on one page can now have different settings.** `Configuration`
  and `Dimensioning` are ordinary classes you can instantiate, and a
  `Floorplan` — and through it a `Model`, a `BlueprintJS` and the 2D view —
  takes one of its own:

  ```js
  const metric   = new BlueprintJS({...opts, configuration: new Configuration({dimUnit: dimMeter})});
  const imperial = new BlueprintJS({...opts, configuration: new Configuration({dimUnit: dimFeetAndInch})});
  ```

  Units, zoom scale, wall height and thickness, grid spacing, snap tolerance,
  the wall-measurement labels and `EVENT_CONFIG_CHANGED` are all per
  configuration. `renderProfile` is per viewer too — pass
  `createRenderProfile(RENDER_STUDIO)` as `options.renderProfile` for a look of
  its own — so classic beside studio is now expressible.

  **Nothing has to change to keep working.** Every static — `Configuration.getNumericValue`,
  `Dimensioning.cmToMeasure`, all of them — forwards to one module-level default,
  which is the same shared state they read before. The exported `config` and
  `wallInformation` objects are that default's own, by identity, so code that
  mutates them directly still does. Omit `configuration` and you get exactly the
  behaviour you had.

  The one thing that changes without being asked: **constructing a second
  `BlueprintJS` no longer re-unitises the first**. Its constructor has always
  written the display unit, and against the shared configuration that silently
  changed every design already on the page.
* **`defaultConfiguration`, `defaultDimensioning`, `configurationOf()` and
  `createRenderProfile()`** are exported. `floorplan.configuration` and
  `floorplan.dimensioning` are the way to reach a design's own settings;
  `Main.renderProfile` is the way to reach a viewer's look.
* **`FloorplannerView2D.invalidate()` and `.flush()`**, and
  **`Main.applyPendingResize()`**. See *Changed* for what they are for.
* **An asset-integrity gate.** `tests/asset-integrity.test.js` checks that every
  asset URL the project names actually resolves: every URL inside every saved
  design in `tests/fixtures` — through the legacy model shim first, so that is
  checked too — every image URI in all 165 `.glb` files together with its
  declared mime type, and every catalog entry. A missed reference is otherwise a
  runtime 404 and nothing else: `TextureLoader` logs and carries on,
  `GLTFLoader` renders the base colour, and the application looks like it works.
* **A budget on the largest single asset**, alongside the existing tree total.
  `public/` was 15.03 MB against a 16.5 MB ceiling — inside budget, comfortably —
  while 22% of it was one photograph in the wrong container. A tree total cannot
  see that; a per-file ceiling can, and it is the shape of limit that matches how
  an asset directory actually grows. `npm run budget` names the offending file.
* **`asset-pipeline/compress-textures.mjs`**, which produced the re-encode below
  and can be re-run. macOS only — it shells out to `sips`, because there is no
  image library in the dependency tree and the output is committed, so the tool
  that made it does not need to run in CI. What runs in CI is the budget.
* **A browser test tier.** `npm run test:browser` runs 27 tests through real
  chromium: the 2D plan rasterised into a real canvas with its pixels read back,
  the 3D view composited through a real WebGL2 context and read with
  `readPixels`, axe-core over the booted application, the environment map
  fetched and decoded, frame coalescing against the compositor's real clock, and
  two plans drawn side by side under different configurations.
  Eleven of the nineteen headless suites run under jsdom against a canvas stub and
  a renderer stub, so until now nothing had ever rasterised a pixel or
  composited a frame — a render profile that came out black would have passed
  all 931 of them.
* **The package is publishable.** `three` and `bezier-js` are `peerDependencies`,
  and the new ESM entry externalises them — 81 KB gzipped against the IIFE's
  423 KB, which is the size of the second copy of three that used to ship to
  every bundler consumer. The IIFE still bundles three deliberately, because it
  is the drop-in for a plain `<script>` tag; it is reachable as
  `architect3d/iife`. 45 declaration files are generated from the JSDoc, and
  `sideEffects: false`, `engines` and an `exports` map are set.
* **`scene.unloadableItemCount`**, per instance. `Scene.unloadableItemCount`
  remains the process-wide total.
* **`EVENT_CONFIG_CHANGED`.** `Configuration.setValue` now says what changed,
  carrying the key, the new value and the old — and only when the value actually
  changed. It was the one change vector in the library that broadcast nothing.
  `addEventListener` / `removeEventListener` exist as statics *and* on an
  instance: the statics reach the shared default, and each configuration
  dispatches only its own changes.
* **A shared texture cache** behind every wall and floor surface, exported as
  `acquireTexture` / `releaseTexture` / `clearTextureCache` / `textureCacheStats`.
  One decode per image however many surfaces draw with it, refcounted, released
  when the last handle goes back. Handles are `Texture.clone()`s, so each wall
  keeps its own `repeat` over one copy of the pixels.
* **`Floorplan3D.dispose()`** and **`Floor.dispose()`**.
* **Type checking, over the JSDoc that was already there.** `npm run typecheck`
  runs `vue-tsc`, which checks the annotations and the single-file-component
  templates against their own script blocks. No `.ts` files, no source rewrite —
  a file opts in with `// @ts-check` on its first line. Forty are in: all of
  `core/`, all sixteen composables, the public entry point, and the eleven
  components that were already clean. TypeScript 6, not 7: 7.0 ships no stable
  programmatic API until 7.1, so `vue-tsc` cannot run on it.

  It found real defects on the first pass, each fixed here — a `@param` whose
  name was swallowed by a stray hyphen, so five documented options described
  nothing; `Main.controller` annotated as permanently `null` because `init()`
  assigns it through an alias, which made `getController()` useless to every
  caller; `threeCanvasElement` documented as `string` while the app passes
  `null`; an undeclared static on `Utils`; and two JSDoc types naming three
  classes the module never imported.
* **A pre-commit hook** (`simple-git-hooks` + `lint-staged`), installed by
  `npm install`. It lints the staged files, type-checks the project, and runs
  the suites that import them.
  This is the cheapest gate in the project and the one that matters most: CI
  deliberately does not run on working branches, so until now *nothing at all*
  ran before a merge. It costs no Actions minutes.
* **Coverage measurement, with a floor.** `npm run test:coverage`, thresholds in
  `vitest.config.mjs`, enforced in CI. The first measurement — lines 74.91%,
  statements 75.07%, branches 61.51%, functions 73.05% — became the floor,
  rounded down. 870 tests existed before this and nobody knew what they reached.
  The thresholds are a ratchet: raise them when a change earns it, never lower
  them to make a build pass.
* **Size budgets** for the built output — `npm run budget`, limits committed in
  `tools/budget.json`, enforced in CI and again in the deploy job before the
  docs are folded into the deployed tree. Gzip for the text bundles, raw bytes
  for the asset trees. The demo bundle reached 1.1 MB and the deployed tree
  21.6 MB without anybody deciding either number; a budget does not make them
  smaller, it makes growth something someone chooses.
* **Undo and redo**, over every edit — walls, corners, rooms, furniture,
  textures, inspector fields. Entries are snapshots of the serialized design
  rather than an inverse-command stack, because the library's mutations are not
  individually invertible: `Corner.mergeWithIntersected` can delete a corner,
  move another and rebuild the room set in one call. A snapshot cannot be
  subtly wrong. Continuous gestures coalesce into one entry, and the stack is
  capped at 50.
* **A split workspace.** Plan, 3D, or both side by side with a draggable
  divider, replacing the two-faced card flip — a card has exactly two faces, so
  there was no arrangement in which both views were visible at once.
* **Keyboard shortcuts**, in one map, with a reference sheet built from that
  same map so it cannot drift. Suppressed while a text field has focus.
* **Light and dark themes**, reaching the drawing canvas as well as the chrome.
* **Autosave.** The working design is kept in local storage and *offered* back
  after a reload, rather than restored silently — someone who closed a design
  to start fresh should not get it back without being asked.
* **Zoom, framing and grid controls for the plan.** Wheel zoom, a stop table,
  zoom-to-fit, recentre, snap toggle and grid density. Zoom was a dat.GUI
  slider from 0.5 to 1.5 in the demo and nothing at all after S7.
* **Delete and duplicate for the selected item.** Removing one previously meant
  finding the small red cross the HUD draws over a hovered item; there was no
  way to duplicate anything.
* **A status bar**: room, wall and item counts, total floor area, the pointer's
  plan coordinates, the zoom level, and what the active tool expects next.
* **`EVENT_ITEM_MOVE_FINISH`**, dispatched on the scene when a drag or rotation
  settles. Nothing previously marked the *end* of a direct manipulation.
* **`floorplannerPalette` / `setFloorplannerPalette`**, making every colour the
  2D canvas draws with themable. The twenty-one exported colour constants are
  unchanged and are now the palette's defaults, so an embedder that themes
  nothing gets pixel-identical output.
* **`three/render_profile.js`**, and a `studio` render profile: physically
  based walls and floors, an image-based environment from `RoomEnvironment`,
  ACES filmic tone mapping, a 2048 shadow map on an off-axis key light, and
  linear fog to the horizon. `classic` — exactly what shipped through 1.0.0 —
  remains the library default and is switchable at runtime through
  `Main.applyRenderProfile()`.
* **`Lights.dispose()`.**

### Changed

* **An `Item` subclass that overrides `removed()` must call
  `super.removed()`.** This is the one migration note in the disposal work
  above: `Item.removed()` used to be empty, so an override that did not chain
  lost nothing. It now releases the item's geometry, materials, label canvases
  and selection box, and an override that does not chain will leak them.
  `WallItem` is the only override in this repository and it chains — detaching
  from its wall first, because the wall rebuild it triggers reads the item's
  position and size and must not be handed a disposed geometry.
* **The browser tier's test timeout is 30 seconds**, up from the 15 it was
  living on. Every frame in that tier is composited by SwiftShader on the CPU,
  the profile-switching test takes 8 seconds on its own, and the memory suite
  added by the disposal work consumed the remaining headroom — the tier shares
  one browser, so new work is subtracted from every other test's budget. The
  assertions are unchanged. This is an allowance for the rasteriser and
  explicitly not a ratchet: a test that starts needing thirty seconds is a
  finding.
* **`Skybox`, `Lights`, `Floorplan3D`, `Edge` and `Floor` take an optional
  render profile** as a trailing constructor argument, and `Floorplan`, `Model`
  and `BlueprintJS` take an optional configuration. All additive: omit them and
  each falls back to the shared default it used before. `setRenderProfile` and
  `isStudio` take an optional profile as their last argument for the same
  reason.
* **The 2D plan repaints once per frame instead of three times per pointer
  event.** `FloorplannerView2D.invalidate()` marks the view dirty and schedules
  one `draw()` for the next animation frame; the interaction paths call it
  instead of drawing synchronously. A drag used to reach all three of the
  `pointermove` draw sites on *every* event — `updateTarget`, then the pan
  branch, then the drag branch — so a press and three moves cost ten full canvas
  repaints, grid and carbon sheet and every room, wall, corner and dimension
  label included, on the input thread. A 1000 Hz mouse made that three thousand
  a second for a display that can show sixty.

  `draw()` is unchanged: still synchronous, still public, still the way to say
  "paint now" for a caller that will read the canvas afterwards. `flush()` is
  new, for a caller that needs any scheduled draw to have happened first.
  Where there is no `requestAnimationFrame` at all, the view draws
  synchronously exactly as before.
* **Neither resize observer resizes a canvas from inside its own callback.**
  `FloorplannerView2D` measures in the callback, where the measurement is
  correct, and applies it on the next frame; `Main` raises a flag its existing
  animation loop clears. Writing `style.width` on an element inside the observed
  subtree during observation is what makes a browser report `ResizeObserver loop
  completed with undelivered notifications`, and the browser tier previously had
  to swallow that by exact message to stay green. `Main.applyPendingResize()` is
  called once per frame and is public for hosts driving their own loop.
* **21 opaque PNG textures re-encoded as JPEG.** `public/` is 10.62 MB, down
  from 15.03 MB; the deployed tree is 17.22 MB, down from 21.59 MB. The
  environment map alone was a 2048×1024 photograph stored losslessly at 3.4 MB
  and is now 844 kB. Quality was measured rather than assumed — every conversion
  is decoded back and compared with its original pixel by pixel, and the
  per-file PSNR is recorded in `asset-pipeline/texture-compression.json`; the
  worst is 37.8 dB. **This changes asset URLs**: `Skybox.defaultEnvironment` is
  `rooms/textures/envs/Garden.jpg`, twelve `.glb` files name a `.jpg` texture,
  and the catalog thumbnails follow.

  Nothing else under `rooms/textures/` moved, and that is deliberate: those URLs
  are serialized into saved designs, so renaming one breaks files that already
  exist. `hardwood.png`, the default room texture, is 476 kB of photograph and
  stays where it is for that reason.
* **CI builds all three outputs, not one.** The application and the
  documentation builds previously ran only in the deploy job, on `master`, so a
  broken Vue template or an unresolvable Tailwind token reached `master` before
  anything noticed. Adding both costs about twenty seconds. The branch policy is
  unchanged: `dev` and `master` only, never a working branch.
* The deploy job runs the suite **with coverage thresholds**, matching CI — if
  it is going to re-run the tests rather than trust CI, it should run the same
  tests.
* **The interface was rebuilt.** A top bar, a tool rail, a docked inspector and
  a status bar around a workspace, built with Tailwind CSS 4, Reka UI, lucide
  and VueUse — all four devDependencies, because `files` publishes `src/scripts`
  alone and nothing a consumer installs could import them. The two per-viewport
  toolbars are gone: they carried the same five file actions twice, which stops
  being invisible once both viewports can be on screen at once.
* **The furniture catalog is a drawer, not a modal.** It no longer covers the
  room being furnished, no longer closes on every pick, and searches all 168
  models rather than offering eight accordion sections one at a time.
* **The 2D grid has two weights**, a heavier line every fourth cell, keyed off
  the plan origin so the heavy lines do not crawl while panning.
* **Loading a design frames it.** New, open and draft-restore zoom to fit,
  capped at 200% so there is still somewhere to draw.
* **Save format 2.0.0.** Coordinates are canonical centimetres throughout and
  the file carries `"units": "cm"` saying so. 0.0.2a wrote corner coordinates
  in whatever display unit was active at save time while control points and
  item positions went out raw, so one file mixed two units and recorded
  neither — the same plan saved under metres and centimetres differed by 100×,
  and reading a metre-era file as centimetres collapsed it to a single point.
  All twenty-five save/load unit combinations now round-trip exactly, and the
  rounding drift goes with the conversion.
* **`material_colors` is sparse**, holding a colour only for a material slot
  somebody actually recoloured and `null` for the rest — absent entirely when
  nothing was. It used to hold every material's colour on every save, which
  froze a model's own appearance into every design using it.
* **`Version.isVersionHigherThan` does what its name says** — a breaking change
  to a public API. It compared its arguments backwards, returned `1`/`0`/`false`
  from one function, and threw on a hand-edited file. `Version.compare` and
  `Version.isVersionAtLeast` are new.

### Fixed

* **Four accessibility defects**, found by adding the check rather than by
  someone reporting them. There was no `<main>` landmark at all, so everything
  between the banner and the status bar sat outside one and a screen-reader user
  had no way to skip to the plan. The catalog drawer and the shortcuts sheet used
  `<header>`/`<footer>`, which duplicated the page's banner and contentinfo
  landmarks whenever either was open. And all 122 catalog thumbnails carried
  `alt` text repeating the name their own button already announced.
* **The published types rejected the most common call in the API.**
  `Floorplan.newCorner`'s third parameter is described as optional in prose but
  was not bracketed, so the generated `.d.ts` declared it required — and every
  real two-argument call, including every one in this repository, was an error
  for a typed consumer. `Corner`'s constructor had the same. Found by installing
  the tarball into a scratch project and type-checking against it.
* **A failed model load now resolves.** Both loaders were called with a null
  `onError` and nothing around them, so a 404, a malformed `.glb`, or a URL the
  environment cannot parse dispatched `EVENT_ITEM_LOADING` and then dispatched
  nothing at all — leaving every listener counting loads in flight holding a
  count that never came back down. `addItem` now dispatches exactly one
  `LOADING` and exactly one `LOADED` whatever happens, the failure carrying a
  null item.
* **`Controller.itemLoaded` dereferenced the null item it was already being
  sent.** The formatless branch has dispatched one since S4; nothing had
  exercised it with a Controller attached.
* **A GPU texture leaked per wall surface per redraw**, and another per floor
  per rebuild. `Edge.updateTexture` allocated a new `Texture` on every call and
  disposed nothing, and it is wired to `EVENT_REDRAW` — so the leak grew with
  editing rather than with the size of the design. The wall lightmap, one image
  shared by every wall, was loaded once per wall.
* **`Floor` never removed its `EVENT_CHANGED` listener**, and
  `Floorplan3D.redraw()` discarded floors with `removeFromScene()`, which only
  takes them out of the scene graph. Every edit that rebuilt the plan left
  another subscribed floor behind.
* **`Floorplan3D` had no `dispose()`**, so a torn-down viewer stayed subscribed
  to the model's `EVENT_UPDATED` and went on redrawing a scene it no longer
  belonged to.
* **The settings panel showed stale configuration.** Snap-to-grid, snap distance
  and grid resolution are writable from the plan overlay as well as from the
  panel, and the panel read them once at mount.
* **`Main.getController()` was typed as always returning `null`**, because
  `init()` assigns the property through a `scope` alias rather than through
  `this`, so nothing ever declared it. Annotated — no runtime change, but every
  consumer of that method now gets a real type instead of a useless one.
* **`BlueprintJS`'s constructor documented five options that did not exist.**
  `@param {Object} - options` — the stray hyphen made the parameter name empty,
  so `options.floorplannerElement` and its four siblings were attached to
  nothing, and generated types omitted all five.
* **The 2D plan no longer slides off the edge when its pane is resized.** The
  pan origin is the plan coordinate at the canvas' top-left corner, so a resize
  that left it alone pinned the drawing to that corner. Tolerable when only the
  window resized; not once there is a divider to drag.
* **`Lights` leaked a floorplan listener on every construction.** `init()`
  subscribed to `EVENT_UPDATED` and nothing ever unsubscribed, so a
  mount/unmount cycle left one behind — possible since S2 gave the viewer a
  `dispose()`.
* **The 3D key light emits light.** `lights.js` constructed a white
  `DirectionalLight` and then called `setHSL(1, 1, 0.1)` on it; hue 1 wraps to
  0, so the "white" key has always been `#330000`. Fixed under `studio` only —
  `classic` keeps it, because the parity grid is calibrated against it.
* **The save format can be versioned at all.** `loadFloorplan` gated curved-wall
  control points on the broken comparator, so stamping a file anything newer
  than `0.0.2a` silently turned every curved wall straight and discarded its
  control points. The gate now reads the wall record.
* Saving an item with an empty material array threw a `TypeError`.

### Removed

* **`core/log.js` and its five exports** (`log`, `isLogging`, `logContext`,
  `ELogContext`, `ELogLevel`). A complete logging subsystem that nothing ever
  called, and that could not be switched on — `logContext` was initialised to
  `None` with no setter. The library's export surface goes from 137 to 132.
* **The `isgltf` construction path in `Item`**, and the parameter it was
  threaded through in all eight item subclasses. It predated the S3 merge
  pipeline and had been unreachable since: `Scene`'s loader callback declares
  `(geometry, materials)` and both call sites pass the merged pair. If anything
  had reached it, it left `this.material` as an invisible wireframe box's
  material — which `setMaterialColor` would then have painted.
* **Ten orphaned assets from `public/`**, including two environment maps and
  three thumbnails for the env-map picker that does not exist yet, and a
  texture orphaned when the ground reflector was dropped in S4.
* **565 files from `asset-pipeline/`** — 284 byte-identical duplicates of files
  already in `public/`, and 280 `.obj`/`.mtl` files holding the same 140 models
  in a second format that nothing reads.
* **252 lines of commented-out code** across 21 source files.

Tracked files fall from 59.9 MB across 1297 files to 51.9 MB across 721.

The test suite goes from 828 tests in 16 files to 870 in 17.

### Compatibility

Files written before 2.0.0 load unchanged, under the same rule they were
written under: no `units` field means coordinates are in the current display
unit. Open one under the unit it was written in and save it, and it is
upgraded — there is no separate migration step. Their `material_colors` are
applied and written straight back, so nothing anyone chose is discarded.

The pre-colour-management darkening is still not re-interpreted, and
deliberately: nothing in an old file distinguishes a colour the model author
baked in from one the user picked, so converting them wholesale would correct
the first and corrupt the second. Re-picking the colour once produces a file
that says exactly what was meant.

## [1.0.0] - 2026-08-13

The migration release. Ten sprints (S0–S9) moved the project from rollup +
Babel + jQuery + three r98 onto Vite + Vue 3 + three 0.185, with feature parity
frozen throughout: every sprint ended with the application fully working, and
every deliberate visual change was reviewed against a screenshot grid before it
landed. The plan, and what each sprint actually delivered, is in
[the migration roadmap](https://amitukind.github.io/architect3d/docs/roadmap.html).

### Added

* **A test suite.** 813 headless tests in 15 files, from none. Mostly
  characterization: written against the pre-migration behaviour and pinning it,
  quirks included, so the rewrites underneath could be proved not to change it
  (S0, extended every sprint since).
* **A Vue 3 application** replacing the jQuery demo — the shell, both
  viewports, the toolbars, the catalog, and native inspector panels for
  corners, walls, rooms, surfaces, items and the carbon sheet (S6, S7).
* **A documentation site** at `/docs/`: getting started, architecture, the save
  file format field by field, and the event reference (S9).
* **Continuous integration and deployment.** Tests, lint and the library build
  on every push to `dev` and `master`; `master` also builds and publishes the
  application and docs to GitHub Pages (S1, S9).
* **`dispose()`** on `BlueprintJS`, the 3D view and the 2D floorplanner —
  mount, unmount and remount now leak no listeners and no WebGL context (S2).
* **A rendering-parity harness** (`npm run parity`): eleven states rendered
  through r98 and r185 side by side, from the frozen `legacy-demo` tag (S5),
  with a third column for the colour change (S8).

### Changed

* **three r98 → 0.185.1.** Every hand-built mesh rewritten from the removed
  `Geometry` class to `BufferGeometry`, the merge pipeline rewritten from
  per-face material indices to material groups, and the vendored orbit and
  pointer-lock controls replaced by three's own addons (S4, S5).
* **rollup 1 + Babel 6 → Vite 8.** No Babel: the source was already ES2015+
  modules (S1).
* **The 25 legacy three.js JSON models → glTF**, converted offline and verified
  per model against measurements taken under r98 — triangle count, bounds,
  surface area, position and UV digests. Designs saved with the old URLs still
  load; the library rewrites them (S3).
* **Colour management is on.** Textures are tagged sRGB and the frame is
  encoded to match, deliberately and as a reviewed change rather than a side
  effect of the engine bump (S8).
* **The renderer honours the display pixel ratio** (S8).
* **Assets moved from `build/` to `public/`**, and the `<base href="/build/">`
  that used to redirect every runtime URL is gone (S9).
* **`package.json` `main`** points at the ESM barrel `src/scripts/blueprint.js`
  rather than a prebuilt bundle, with `exports` and `files` to match (S9).

### Fixed

* **The shadow camera never updated its projection.** The call sat inside a
  branch guarding on a property three removed around r73, so shadows were sized
  for whatever plan existed when the camera was born (S5).
* **A leaked keyboard listener.** `OrbitControls` resolves the document through
  `domElement.getRootNode()`; if the host detached first, the removal landed on
  an orphaned subtree and the listener stayed alive (S6).
* **The floorplanner mode event** carried its mode in a field the application
  was not reading (S6).
* **Loading a design with a carbon sheet** threw in widget mode, where there is
  no 2D view to own one (S0).
* **glTF export failures were silent** — the old exporter had no error channel
  at all, so a caller waited on an event that never fired (S4).

### Removed

* **jQuery, Bootstrap 3, dat.GUI, QuickSettings, jquery.flip, jquery-ui.css and
  the glyphicon webfont.** The application's stylesheet is its own and the
  icons are inline SVG. Runtime dependencies are now Vue, three and bezier-js,
  and nothing else (S6, S7).
* **The vendored copies of jQuery 1.11.3 / 2.1.4 and Bootstrap 3.3.5** that
  shipped to every user. Checked-in files, so Dependabot could not see them
  (S9).
* **esdoc and its 82 MB of committed output.** Abandoned upstream in 2018, and
  the origin of all 20 of this project's npm advisories — 5 critical, 11 high.
  Replaced by the documentation site (S9).
* **`build/`, `resources/`, `build/vrtest`, the orphaned model directories, and
  eight dead root files.** Tracked files fell from 228 MB to 63 MB (S9).
* **A debug `AxesHelper`** that drew three coloured lines out of the origin of
  every design, for every user, behind no flag (S5).
* **Dead properties** that had been inert for the life of the file:
  `shadowDarkness`, `shadowCameraVisible` and friends, all removed from three
  well before r98 (S5).

### Known and deliberate

* **Coordinates in a save file are written in the user's display unit**, the
  version field cannot be bumped, and pre-S8 designs store linear colour values
  in a field that now reads as sRGB. All three are addressed in Unreleased
  above; they were the state at 1.0.0.
* **Two bugs in `Utils.pointInPolygon` and `isClockwise`** are asserted as they
  are, because room detection depends on them.
* **Textures are reloaded per wall per redraw and never disposed.**
* **`npm audit` reports 3 dev-only advisories** through VitePress, which pins
  an older Vite and esbuild. They affect the docs dev server, not the built
  site and not the application. They clear when VitePress 2 leaves alpha.

## [1.0.0-pre] - 2020-06-20

The original release, before the migration. Recorded here as it was written at
the time; it was never tagged or published.

* Create floorplans in 2D and design the rooms in 3D
* Various room type objects such as wall items, floor items, ceiling items,
  wall-floor items etc.
* Naming the rooms
* Switching between various metrics of measurement
* Elevation for corners of a room, to create sloped walls
