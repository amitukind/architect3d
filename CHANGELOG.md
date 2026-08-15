# Changelog

## [Unreleased]

### Fixed

* **A selected wall stays selected when you undo.** Selection resolves a wall
  by id, and every load destroyed the walls and handed out fresh ones — so an
  undo silently dropped whatever wall you had selected, and there was no way to
  ask for it back. Wall ids are reconstructed from the corner pair the file
  already records, so nothing was added to the save format and a file written
  before this change loads with exactly the ids one written after it would.

  Two rules, and either alone is wrong. The pair is **sorted**, so a wall
  recorded `b → a` is the same wall as one recorded `a → b`. And it carries an
  **ordinal**, so two walls spanning one corner pair do not collide — which
  `Floorplan.newWall` does not prevent and which survives a round trip. Neither
  case appears in any fixture, so both are constructed tests written before the
  change.

* **Windows and doors survive an undo.** RM-003 A3 excluded anything wall-bound
  from item preservation, because it held a `HalfEdge` that a load destroyed and
  A3 had no way to find the same face afterwards. `HalfEdge.id` is
  `${wall.id}:front|back`, so stable wall ids made it findable, and
  `Model.newRoom` now notes which face a bound item is on before the floorplan
  goes and puts it back on that face — not merely on the nearest one, which is
  the same answer everywhere except where two walls meet. An undo of a corner
  move now reloads **nothing at all**, where it used to reload every window.

* **A leaked listener per wall re-bind.** `WallItem.changeWallEdge` declared its
  `EVENT_DELETED` handler as a fresh closure on every call and then removed *the
  new one* from the old wall — detaching a function that had never been
  attached, and leaving the previous one subscribed forever. It now holds one
  reference, which is also what made the fix above possible: the item used to
  die during a load by its own hand, because `reset()` fires `EVENT_DELETED` on
  every wall and the handler removed the item before it could be re-bound.

### Changed

* **The Vue application is type-checked, all of it.** 60 errors to zero, and
  every single-file component now carries `// @ts-check` — which matters more
  than the count: `checkJs` is off, so a file that is clean but not opted in is
  not protected, and `npm run typecheck` would say nothing about it. The
  whole-tree total falls **427 → 356**.

  Most of it was one omission repeated. A prop declared `{type: Array}` types
  every element `unknown`, which makes the entire template uncheckable — eight
  of `CatalogDrawer.vue`'s nine errors were that single missing annotation, and
  four more components had the same. The types were written next to the data
  that produces them rather than next to the component that renders it, because
  a typedef beside the consumer drifts the first time the data changes.

  **Zero suppressions were added.** The seven `@ts-expect-error`s in the tree
  are all RM-002 P2's, each pinning a preserved-bug arity. Seven JSDoc type
  assertions were added, each with a docblock saying why the narrowing is sound;
  six are the same shape — `event.target` narrowed to the input the component
  itself renders, replacing an inline `$event.target.value` that the DOM types
  correctly reject.

* **11 of those 71 were not type errors and were deleted rather than
  annotated.** Eight `/// <reference path="....ts" />` directives in `items/`
  pointed at pre-migration TypeScript files that have never existed in this
  repository, and three `@see <url>` comments had angle brackets that made the
  JSDoc unparseable outright.

* **The model catalog is Draco-compressed, and no file changed its name.**
  `public/models/` falls from 5.08 MB to 1.92 MB and the whole runtime tree
  from 10.62 MB to 7.45 MB. A design saved before this names exactly the same
  URLs and opens unchanged — what changed is what is *inside* the files, which
  is the one kind of change the A5 manifest was built to allow. The largest
  single asset in the tree is no longer a model at all: it is now the Garden
  environment map at 844 KB, down from a 1.30 MB sofa.

  Four codecs were measured over the whole catalog before one was chosen, raw
  and gzipped, because transport already took 59.4% of the geometry and a
  headline ratio against raw bytes is not a marginal win. Draco took served
  geometry from 2.094 MB to 0.687 MB against meshopt's 1.256 MB, and its 73 KB
  decoder is fetched once, lazily, on the first compressed mesh.

* **13 of 165 models deliberately ship uncompressed.** `tools/encode-assets.mjs`
  refuses to replace a model unless the triangle count is identical, the count
  of distinct vertex positions is identical, and no vertex moved more than 5 µm.
  Thirteen models trip one of those and keep their authored bytes. The worst
  displacement among the 152 that passed is **0.38 µm** — four orders of
  magnitude inside the gate — and every per-model measurement is committed to
  `asset-pipeline/encoding-report.json`.

* **One expectation was retired in B2**, deliberately: `history-and-selection.test.js`
  asserted that a wall-bound item *reloads* across a restore and comes back as a
  different object. That was A3 pinning its own carve-out, and its note said so.
  It now asserts what replaced it — nothing reloads, the same object comes back,
  and it is on the face it was on rather than merely on a face that exists.

* **One expectation was retired in B1**, and only one: the position *hash* in
  `model-conversion.test.js`. It is a sha of every distinct vertex rounded to
  three decimals, which is bit-exactness under another name, and no lossy codec
  satisfies it at any bit depth. The count of distinct positions stays and stays
  exact; so do bounds, surface area and triangle count, all at the tolerances
  they already had. The per-vertex guarantee moved to
  `tests/asset-encoding.test.js`, where it can be stated as a number.

* **Three material assertions now read through the glTF defaults** rather than
  off the raw JSON. glTF-Transform omits any field equal to its default, so
  `roughnessFactor: 1` simply stops being written; the material is identical and
  the old assertion read `undefined`. Applying the spec defaults is what a
  renderer does, so this is the stricter reading as well as the more durable
  one.

### Added

* **`npm run encode`** and `npm run encode:check`, the same
  committed-output, staleness-checked shape as `npm run manifest`. A checkout
  builds and serves with no encoder installed; the glTF-Transform and Draco
  packages are devDependencies and nothing at runtime imports them.

* **A `codec` field on every manifest entry**, derived from the container's own
  `extensionsRequired` rather than declared, and `resolver.codecMix()` /
  `resolver.decoderPath()` beside it. "What is this build shipping" was
  previously answerable only by someone holding a checkout.

* **`tests/browser/draco-models.test.js`** — the first browser test in the
  project that loads a real `.glb`. Every other one stubs the loader, which is
  why the whole tier passed on the first run after the catalog was compressed
  and that proved nothing. It asserts a compressed model decodes, that the frame
  changes when it arrives, that the decoder is fetched from the resolver's path,
  and that an uncompressed model still loads.

* **Two new budgets.** `decoder-total` gives the vendored decoder its own line,
  because it is machinery rather than content and moves only when three is
  upgraded. `texture-vram` is the third *kind* of ceiling in the file: 202
  images weighing 5.23 MB on disk occupy **164 MB** of GPU memory once uploaded
  with mip chains, and `rooms/textures/Ground_4K.jpg` is 73 KB on disk against
  16.9 MB in VRAM — a 230× ratio that no disk-based measurement can see.

* **`tests/type-coverage.test.js`** — the opt-in made mechanical. A pragma is
  one line anybody can delete, and deleting one silently stops the gate
  protecting that file. Found by a break that was supposed to fail and did not:
  removing a component's pragma *and* reintroducing the error it used to have
  produced a completely clean typecheck. The test asserts that every area which
  reached zero stays opted in, that nothing carries `@ts-nocheck`, and that the
  suppression count can only go down. It deliberately does not pin the 356 —
  a ratchet that punishes progress is worse than none.

* **`dropBundledDraco()` in `vite.config.mjs`.** three's `DRACOLoader` points at
  its own bundled decoders with `new URL(..., import.meta.url)`, which a bundler
  reads as assets to emit — including a 719 KB pure-JS fallback for browsers
  with no WebAssembly, which cannot run WebGL either. Importing the loader cost
  **489 KB gzipped on the library IIFE** and 169 KB on the demo before this.
  The plugin throws if it matches nothing, so a three upgrade that renames those
  constants fails the build rather than silently restoring half a megabyte.

### Compatibility

Every saved design opens unchanged, and every asset URL resolves to the path it
always did. Two narrower things did change, and are stated here rather than
left to be discovered:

* An embedder who supplies their own loader through `Scene.setItemLoader` now
  receives compressed models from this project's catalog and needs a
  `DRACOLoader` to read them. An embedder serving their own assets is
  unaffected — `public/` is not in `package.json`'s `files` and never shipped
  to them.
* Anyone self-hosting this project's `public/` tree while running a pre-B1
  build of the library will not decode the models. The decoder is in
  `public/draco/`; the library build that knows to use it is this one.

### Deferred

KTX2/Basis for the texture half, with the case measured rather than asserted:
transport takes only 4.4% of those 5.23 MB because they are already
entropy-coded, and the real prize is the 164 MB of VRAM, which BC7/ETC2 would
take to 41 MB. It is not in this release because the encoder needs
KTX-Software binaries that are not installed here, and quoting a published
ratio in place of a measurement is the one thing this programme does not do.

## [2.0.0] - 2026-08-15

Everything built on top of the migration. 1.0.0 was the port; this is a rebuilt
interface with undo, a split workspace and themes, a save format that records
the unit it was written in, a deep clean that took 8 MB and 576 files out of the
tree — and then two review programs, back to back.

The architecture redline (RM-002, P1–P7) took the seven findings a full read of
the library produced — an item loader with no failure path, global singletons
that made a second instance impossible, a texture allocated per wall per redraw
and never released, a canvas repainting synchronously inside `pointermove` — and
closed them under a type checker and a real-browser test tier, neither of which
existed when it started. The hardening program (RM-003, A0–A5) closed the eight
it produced in turn, and they were all one shape: nothing owned a geometry,
nothing owned a document, and nothing owned an asset's address. Both plans, and
what each sprint actually delivered rather than what it promised, are in
[the roadmap](https://amitukind.github.io/architect3d/docs/roadmap.html).

Major rather than minor on three counts, each recorded in full below:
`Version.isVersionHigherThan` changed behaviour, `core/log.js` and its five
exports were removed, and the save format is at 2.0.0. A file written by 1.0.0
still opens unchanged — the break is in what this version *writes* and in two
points of the export surface, not in what it reads.

1.0.0 was released and never tagged. `v1.0.0` has been added retroactively at
the commit that dated it, so the boundary this entry describes exists in the
history as well as in this file.

### Fixed

* **A room keeps its name and its floor texture when you draw a wall through
  it.** Rooms are derived rather than stored — `Floorplan.update()` builds a new
  `Room` for every closed cycle it finds, every time — so a room had no identity
  of its own. It was known by two keys computed from its corners, which
  disagreed with each other: `getUuid()` sorts the corner ids and backs the
  floor texture, `roomByCornersId` does not sort and backs the name. Both change
  the moment the corner set does.

  Measured: name a room "Kitchen", give it a floor texture, then draw a wall
  through one of its sides. Four corners become five, both keys change, and the
  room comes back as **"A New Room" on the default floor**. Splitting a wall is
  an ordinary drawing action.

  A re-derived room now inherits the identity of the room it continues, decided
  by corner overlap and matched one to one, and both keys move with it. Deleting
  a corner, merging two corners, splitting a wall and re-deriving all preserve
  the name, the texture and the id.

  **The save file is unchanged.** A design saved before this and after it is
  byte-identical.
* **Undoing a corner nudge no longer re-downloads the sofa.** Undo restores a
  snapshot by calling `loadSerialized`, and `Model.newRoom` opened with
  `scene.clearItems()` — every item destroyed and every model file re-fetched,
  re-parsed, re-merged and re-uploaded, for an edit that touched none of them.

  Items now carry an id, so `newRoom` reconciles instead: an item the incoming
  document still has is kept and moved. Undo of a geometry edit loads **zero**
  models, where it used to load all of them.
* **Merging two corners no longer loses the room.** `Corner.combineWithCorner`
  re-derived the plan in the *middle* of the merge — after the departing
  corner's walls had gone and before this corner's were reconnected — so at that
  moment the room did not exist, and a room that ceases to exist has nothing to
  hand its identity to. It is one batch now, and re-derives once, at the end.
* **Two walls between the same pair of corners no longer collide.** `Wall.id`
  was `[start.id, end.id].join()` computed once at construction: frozen, so it
  became a lie the moment either corner was merged into another, and identical
  for any two walls joining the same pair. It is assigned now. `getUuid()` still
  returns the derived pair, which is what the save file records.
* **Saving a design twice produces the same bytes.** Items were written in
  `scene.items` order, which is the order their model files finished
  downloading in — so two saves of a design nobody touched could differ. They
  are written in id order now. That is not cosmetic: `useHistory` decides
  whether anything changed by comparing the serialized string, so a reordering
  it cannot read the meaning of became a history entry for an edit nobody made.
* **The inspector no longer edits a room that is not in the plan.**
  `useSelection` held the selected object, and `Floorplan.update()` replaces
  every `Room` and every `HalfEdge`. Selecting a room and then editing anything
  at all left the panel bound to a detached object — still editable, and editing
  it changed nothing anybody could see. Selection is held by id and resolved on
  demand, so it survives a re-derivation and clears itself when the entity is
  genuinely gone.
* **Dragging a corner no longer moves the 3D camera, and no longer rebuilds the
  scene.** `Floorplan` had one way of saying anything had happened —
  `EVENT_UPDATED`, with a payload of the floorplan the listener already had —
  and six unrelated consumers hung off it. None could tell a corner drag from a
  file open, so every one did its most expensive thing every time. Measured on a
  four-wall room: a ten-step drag ran **10 full `Floorplan3D.redraw()` calls and
  10 `centerCamera()` calls**, tearing down and rebuilding eight wall faces and
  two floors per pointermove, and yanking the camera back to the plan centre
  each time.

  It is now **0 and 0**. The 3D view redraws the faces the moved corners touch;
  the camera reframes on topology changes only, and only when the plan's
  bounding box actually moved.

  The one intended behaviour change: **a topological edit that leaves the
  bounding box where it was no longer reframes either** — adding a corner
  strictly inside the plan, splitting a wall. Opening a document still frames
  it.
* **Moving a corner announced itself three times.** A corner with two walls
  dispatched `EVENT_UPDATED` once from its own move and once from each wall,
  because a wall listens to its corners and `Wall.updateControlVectors()` calls
  `update()` of its own — with no payload at all, so two of the three said only
  "something geometric changed, somewhere". `Corner.move()` now batches the
  gesture and the wall names the corners it moved, so one change comes out
  carrying all of them.
* **Removing a corner updates the plan, as removing a wall always did.**
  `removeWall()` has always ended with an `update()` and `removeCorner()` never
  had one, so a removed corner stayed in the rooms and in `getSize()` — which is
  what the camera frames and what the shadow camera is sized from — until some
  unrelated edit re-derived. The usual path hid it, because `Corner.removeAll()`
  removes the walls first and each of those updated. `removeAll()` now opens a
  batch, so what used to be one re-derivation per wall plus none for the corner
  is one for the whole gesture.
* **Opening a document over an existing one announced thirteen changes before
  building anything.** The batch added in A1 started *after* `reset()`, so every
  wall and corner the outgoing design was made of re-derived the plan on its way
  out — and each one was labelled an edit rather than part of the load. `reset()`
  is now inside the batch.
* **Opening a file that is not a design no longer destroys the design you have
  open.** `loadSerialized()` parsed and then mutated live state, and `newRoom()`
  called `scene.clearItems()` *before* `loadFloorplan()` — which itself opens
  with `reset()`. So the current design was gone before the incoming one had
  been looked at. Ten well-formed-JSON documents that are not designs each
  emptied the open plan, and **one of them did not even throw**: `{"items":[]}`
  emptied the plan, dispatched `EVENT_LOADED`, showed a success toast, and let
  autosave write the empty plan over the draft. Only a JSON *syntax* error was
  safe, and only by accident.

  The whole document is now validated before any live state is touched, so
  opening a file either replaces the design completely or leaves it exactly as
  it was. It still throws — callers already catch, and a function that quietly
  stops reporting failure is a worse change than one that keeps reporting it —
  but the message names the field, and neither `EVENT_LOADING` nor
  `EVENT_LOADED` fires for a document that fails.
* **Furniture from a document you have left no longer arrives in the one you
  are in.** `Scene.addItem`'s loader callback recorded nothing about which
  document had asked, so opening a design with thirty items and then opening
  another put the first one's furniture in the second, and dispatched thirty
  `EVENT_ITEM_LOADED` into a count that was measuring two documents at once.
  Every load now carries the generation it started in and is discarded if that
  generation is no longer current — including disposing the geometry and
  materials the loader built for it. Applies to New, Open, Undo and Redo alike.
* **Opening a design dispatches `EVENT_UPDATED` once, not 25 times.**
  `newCorner()` and `newWall()` each call `update()`, which re-derives every
  room in the plan; opening a four-corner, four-wall document dispatched 25
  times and a six-corner one 39, and every dispatch drove a full 3D teardown and
  rebuild *and* a camera recentre. The load path now batches.
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

* **The working draft is kept in IndexedDB, not `localStorage`.** The old path
  wrote the whole design synchronously on the main thread, on a two-second
  debounce during editing and again on `pagehide` — and Web Storage is capped at
  about **5 MiB per origin**. That cap was not theoretical: a furnished design
  can exceed it, and the first `QuotaExceededError` **disabled autosave for the
  rest of the session**, so the larger the design the sooner it stopped being
  protected. Metric M-9: the largest synchronous main-thread persistence write
  goes from the whole document to **0 bytes**.

  Behind an interface, with two implementations that both stay.
  `LocalStorageDraftRepository` is exactly what shipped before, and is the
  fallback where IndexedDB is missing — private browsing, some embedded
  webviews — and the rollback if this turns out to be wrong. A draft written by
  an older build is read from the old key once, copied across and removed.

  A store written by a **newer** build is left untouched and reported, never
  migrated on the guess that its shape is close enough.
* **A recovery pointer, so a lost write is detectable.** `pagehide` cannot await
  a promise, which is what moving to IndexedDB costs (risk K-6). The fix is not
  to write the document synchronously — that gives back everything above.
  Instead a sub-kilobyte pointer goes into `localStorage` *before* the body
  write is started, carrying the timestamp that write is about to have. On the
  next load a pointer newer than the body means the tail did not land, and the
  recovery prompt says how much instead of implying the draft is current.
* **An asset manifest and an `AssetResolver`.** Every asset URL is a bare
  relative string and those strings are **inside saved designs**, so renaming a
  file breaks documents on other people's disks — and Vite copies `public/`
  as-is and never hashes it, so content-addressed filenames were not available
  as an answer. Finding H-8.

  The string in a document is now a *logical name* and the resolver decides what
  is fetched. `npm run manifest` generates `public/asset-manifest.json` — 370
  entries of `{bytes, hash, kind}`, plus a `url` for anything not where its name
  says. Three things follow, none of which renames a file or rewrites a
  document: **versioning** (give an entry a different `url`), **a CDN** (`base`
  is prepended to every resolution; the demo honours `?assetBase=` so it is
  checkable in a browser), and **availability as a policy** — a resolver with a
  manifest knows what the build ships, so a name it does not have fails before
  the network with a message that can name the item.

  It is fetched, not bundled: 58 kB of JSON in the library would be charged to
  every consumer and would go straight through the size ceiling A4 tightened.
  Omit `assets` and every name resolves to itself — the pre-A5 behaviour, and
  still the default.
* **Prefetch on hover, bounded by bytes.** The manifest carries sizes, so the
  catalog can warm a model's cache from the pointer resting on its thumbnail —
  a few hundred milliseconds before the click, which is most of the fetch.
* **Integrity hashes, recorded and not enforced.** Every entry carries a
  subresource-integrity string and `resolver.integrityFor(name)` hands it over
  for `fetch(url, {integrity})`. Off by default deliberately: for same-origin
  `public/` it guards nothing the origin does not already guarantee, while a
  mismatch after a legitimate redeploy of an unhashed file is an outage. It
  matters for the CDN case, which is why it exists.
* **A per-asset size budget**, `catalog-item-largest`, beside the per-file and
  per-tree ceilings. Neither of those can answer *what happens when somebody
  clicks a chair* — a catalog item is a `.glb` plus every image it references
  plus the thumbnail. Measured across all 168: the median is **17 kB** and the
  worst is **1.53 MB**, 90× the median and invisible to both existing limits.
* **A creator credit** in the application's status bar, on the documentation
  site, and on the roadmap page, linking to amitukind.com.
* **A document's services are one object, `DesignRuntime`.** P7 made five
  module-level singletons per-instance, one at a time, and each stage was right.
  What none of them could deliver is a single thing to dispose — there was
  nothing to hang a document's resource registry or its load session on, and
  `Main.dispose()` carried a comment saying so.

  A `DesignRuntime` holds one document's configuration, the dimensioning bound
  to it, its render profile, its load session, its GPU resource registries and
  an id. It holds **no design data**: no floorplan, no scene, no items. It is
  reached the way a `Configuration` already was — `Floorplan`, `Model`, `Main`,
  `Floorplan3D` and every `Edge` get there by a hop that already existed, so not
  one of them took a new constructor argument to find it.

  `new BlueprintJS({runtime})` is additive; `configuration` and `renderProfile`
  still work and now build one for you. `runtimeOf(owner)` is the accessor, and
  `configurationOf(owner)` is unchanged — it cannot disagree with it, because
  `configuration` is a *getter* over `runtime.configuration` on every class that
  has one, so there is one place the answer is kept.

  **Every static still reads exactly what it read.** `defaultRuntime.configuration`
  IS `defaultConfiguration`, `defaultRuntime.dimensioning` IS
  `defaultDimensioning`, and `defaultRuntime.renderProfile` IS the shared live
  profile — the same objects, not copies. `config` and `wallInformation` are
  still that configuration's live data, still mutable in place.

  What a document built with no options gets is a runtime of *its own* carrying
  those shared services. Settings default to shared; lifetimes never are. The
  difference is not academic — the first version of this shared the default
  runtime outright, and the suite caught it within the hour: `Model.loadDocument`
  calls `loadSession.begin()`, so on a shared session opening a design in one
  viewer abandons the furniture still arriving in the other. A fresh instance of
  the very finding the sprint was closing.
* **`runtime.stats()` reports what one document is holding** — `{id, disposed,
  registries, resources, handles, session}`. A number nobody could get before:
  every GPU resource this document owns, summed across every registry it handed
  out, plus what its loader is waiting on.

  Two things are deliberately not in it. Images from the shared texture cache,
  because they belong to the page and describing them as one document's property
  is exactly the mistake A0 removed from `Main.dispose()`; `textureCacheStats()`
  is page-wide and says so. And an asset resolver, which the A4 scope named and
  A5 builds — a property initialised to null that nothing reads is a promise,
  not a seam.
* **Disposal is scoped to a document.** `runtime.dispose()` releases every
  registry the document handed out and invalidates its load session.
  `BlueprintJS.dispose()` calls it only for a runtime it built itself: one
  passed in belongs to the caller, so two viewers can share a document and the
  first to close does not take the second down with it.
* **Every entity in the model has an identity.** `Corner.id` was the only one;
  now `Wall.id`, `Room.id` and `HalfEdge.id` are assigned too, and `Item` has
  `designId`.

  Only an item's is written to the save file, and the asymmetry is the point: a
  file describes a wall by its two corners and a room by its corners, which is a
  description any build can read, so those ids are reassigned on load. An item
  has nothing to be described by — two identical chairs at the same coordinates
  are two chairs — so it carries one. Additive and optional; an older file has
  none, each item is assigned one on load, and they appear from the next save.

  It is `designId` rather than `id` because `Item extends Mesh` and three
  defines `Object3D.id` as a non-writable number of its own. This is the second
  name collision of the kind A0's `Item.remove()` finding described.
* **`model/room_matcher.js`** — `matchRooms(previous, current)` decides which
  re-derived room continues which, by corner overlap over union, one to one,
  with a deterministic tiebreak and a floor of two shared corners. Pure and
  tested on its own, because it is the one rule in this sprint that can be
  *subtly* wrong: a mismatch does not throw, it quietly moves somebody's room
  name onto a different room.
* **`Item.applyScale(x, y, z)`** — set the scale to exactly this. `setScale` is
  relative, which is what a resize gesture wants and what a restore cannot use:
  `1.5 × (1 / 1.5)` is not 1, so expressing an absolute target relatively made
  undo drift.
* **`Item.boundToFloorplan`** — whether an item holds a reference into the
  floorplan graph. False for furniture, true for anything wall-bound, and it is
  what decides whether an item may be kept across a document load.
* **`history.stats()`** — `{past, future, entries, bytes, limit}`. The
  docblock's "perhaps 20 KB for a furnished plan… the whole stack stays around a
  megabyte" was an estimate nobody could check; measured on the largest fixture
  it is **19.9 KB and 0.97 MB**, so it was right.
* **`EVENT_CHANGESET` and `core/change_set.js`** — the model can now say *what*
  changed, not only *that* something did. A `ChangeSet` carries the kinds that
  changed (`topology`, `geometry`, `surface`, `items`, `selection`, `view`), the
  entities each kind affects, and a reason (`load`, `edit`, `undo`, `derive`).

  ```js
  floorplan.addEventListener(EVENT_CHANGESET, ({changes}) => {
      if (changes.has(CHANGE_GEOMETRY)) { nudge(changes.entities(CHANGE_GEOMETRY)); }
  });
  ```

  **Purely additive.** Every `EVENT_CHANGESET` is followed by the
  `EVENT_UPDATED` derived from it, at the same moment and with the same `item` —
  `Floorplan._emitChanges` is the only place either is dispatched, so the two
  cannot disagree about whether something happened. The ChangeSet also rides
  along on the legacy payload as `evt.changes`, so a consumer can adopt the
  typed form without changing which event it listens to.

  `Floorplan` emits two of the six kinds today, and the other four are named
  rather than emitted. That is a decision, not an omission: A2 types the
  dispatch that exists and does not invent dispatch. `surface` is the one that
  looks wrong and is not — `Room.setTexture()` and `HalfEdge.setTexture()`
  already go straight to the `Floor` and `Edge` drawing them, which is
  per-entity and already incremental, and a plan-level broadcast on top would be
  new traffic that autosave and history would start recording.
* **`Floorplan3D` projects incrementally.** Topology changes reconcile — build a
  view for every model entity that has none, dispose every view whose entity is
  gone, keep the rest — and geometry changes redraw only the affected faces and
  floors. `projectionStats()` reports what it did.
  `Floorplan3D.incremental = false` restores a full `redraw()` on every change,
  with the ChangeSet still in place, so the two halves of this revert
  separately.

  Reconciliation after a *topology* change still rebuilds everything, because
  `update(true)` constructs a new `Room` and a new `HalfEdge` for every one and
  the diff finds nothing in common. It is written as a reconciliation because
  that is the shape that becomes incremental once entities have an identity that
  survives recomputation. The geometry path is the one that is incremental now,
  and it is the one a drag takes.
* **`Main.cameraStats()`** — `{recentred, declined}`, so "the camera stopped
  following the drag" is a number rather than a claim.
* **`Floorplan.changeStats()`** — how many ChangeSets this plan has dispatched,
  per kind.
* **`Floorplan.beginBatch(reason)`** takes an optional reason, and
  `Model.loadSerialized(json, {reason})` / `loadDocument(json, {reason})` pass
  one through. History passes `undo`, because it is the only thing that knows a
  document is being put back rather than opened.
* **`textureUrlOf(texture)`** — which URL a cached texture came from. The cache
  already kept it, and it is the only stable way to ask whether two textures are
  the same image: every clone has its own `uuid`, `source.uuid` changes when an
  entry is released and reacquired, and `texture.image` is null until the decode
  lands and forever in a headless environment.
* **`Model.loadDocument(json)`** — the same operation as `loadSerialized`,
  reported rather than thrown. Returns `{ok, document, errors, warnings}`, where
  every error carries the path to the field it is about
  (`floorplan.walls[0].corner2`). The application uses it to say which part of a
  file is broken instead of "could not open that design".
* **`DesignDocument`** (`model/document.js`) — parses and validates a
  `.blueprint3d` document without touching anything. Deliberately no stricter
  than the corpus of files that already exist: a pre-2.0.0 document has no
  `units` stamp, no corner elevations and no wall control points, and all three
  stay optional. An unrecognised `units` value is a **warning**, not a refusal.
* **`LoadSession`** (`model/load_session.js`) and **`scene.loadSession`** — which
  document the loads in flight belong to. `stats()` reports
  `{generation, inFlight, aborted, failed, settled}` for the current document,
  which is what `useHistory` now asks instead of keeping a count of its own.
* **`Scene` has its own `LoadingManager`.** Both loaders were constructed with
  none, which gives them three's global `DefaultLoadingManager` — one shared
  abort surface for every document on the page, which is the same as none.
  `scene.abortPendingLoads()` now stops the fetches this design started and
  nobody else's.
* **`Floorplan.beginBatch()` / `endBatch()`** — defer the room re-derivation
  across a bulk build. Nesting; always pair them in a `finally`, because a batch
  left open silently stops the plan updating.
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

* **`dist/bp3djs.js` is minified. `dist/architect3d.js` is not, on purpose.**
  A question A0 raised, A1, A2 and A3 each deferred, and A4 tripped: the
  library builds were `minify: false`, so **37% of what a `<script src>`
  consumer downloaded was this project's docblocks**.

  The two artifacts have different consumers and wanted different answers. The
  IIFE is downloaded by a browser as written, so its comments are a cost paid
  by every end user for documentation none of them will read — **463.7 KB
  gzipped to 220.8 KB, a 52.4% cut**, and `lib-iife-gzip` came *down* from
  459 KB to 233 KB. The ESM entry goes through a bundler, which strips comments
  on the way to production, and those comments are the JSDoc a typed consumer
  reads on hover — so it stays as it is.

  No source changed and the sourcemap is still emitted. Verified rather than
  assumed: the minified bundle parses, exposes all 170 exports, and its
  `DesignRuntime` still holds the module-level configuration, dimensioning and
  render profile by identity.
* **`render_profile.js` and `load_session.js` moved into `core/`**, from
  `three/` and `model/` respectively. `DesignRuntime` holds both, and `core`
  importing from either of those layers would have been the first time anything
  in `core` reached outside itself.

  Both files have **no imports at all** and never did, so the move costs nothing
  structurally — it is the same argument that put `units.js` in `core` so
  `configuration.js` could read `dimCentiMeter` without importing
  `dimensioning.js`. Every export is re-exported from `blueprint.js` at the same
  name, so an embedder using the public entry point sees no change; only a deep
  import of the old path breaks.

  `render_profile.js` gained `// @ts-check` on the way in, because the type
  ledger claims all of `core` is checked and a file moving in has to make that
  claim true.
* **`Item.getMetaData()` emits an `id`, and items are serialized in id order.**
  Both additive, and the second is a fix rather than a preference — see above.
  An embedder that pins the exact key list or the item order needs to know.
* **The browser tier runs one file at a time.** Vitest parallelises test files
  by default, which is right for the headless tier and wrong for this one: every
  frame here is composited by SwiftShader on the CPU, so parallel files do not
  overlap, they queue — each one's clock running while it waits for the
  rasteriser. Measured on the same 37 tests: **62.8s wall and 182.8s of test
  time in parallel, against 67.1s wall and 64.9s serialised.** Four seconds of
  wall clock for two-thirds of the test time back.

  That gap was being charged to whichever test held the timer.
  `gpu-memory.test.js` took 26s alone and 62s inside the tier, and timed out on
  two clean-checkout runs in three while passing every time in isolation. It is
  also why A0 had to raise the timeout from 15s to 30s; the 30s stays for now,
  but the headroom under it is real rather than shared.
* **A wall-bound item is reloaded on every document load, and a free-standing
  one is not.** The reconciliation above cannot keep a `WallItem`: it holds a
  `HalfEdge`, and the floorplan is destroyed and rebuilt by every load, so a
  kept one would point at an edge that no longer exists and would try to detach
  from it when removed. Lifting that needs wall ids that survive a save and
  load, which they do not.
* **`Main` and `Floorplan3D` subscribe to `EVENT_CHANGESET` rather than
  `EVENT_UPDATED`.** Both need to know *what* changed, and the legacy event
  cannot say. `EVENT_UPDATED` still fires at exactly the moments it always did,
  and `Lights`, autosave, history and the statistics panel are unchanged.

  Two properties are worth knowing if you subclass or replace either: the
  ChangeSet listeners run before the `EVENT_UPDATED` ones, because the model
  dispatches the typed event first; and a `Floorplan3D` handed an
  `EVENT_CHANGESET` with no `changes` payload falls back to a full redraw,
  because "something changed and I cannot tell what" has exactly one safe
  reaction.
* **`EVENT_ITEM_LOADED` can now carry `stale: true`.** A model requested by one
  document can arrive after another has been opened. That arrival is reported
  rather than swallowed, so every `EVENT_ITEM_LOADING` is still matched by
  exactly one `EVENT_ITEM_LOADED` and a caller counting loads stays balanced —
  but the item is null and is not in the scene. If you count, ignore the flag;
  if you react to content, you already null-check for failed loads.
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
