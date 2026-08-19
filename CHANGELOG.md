# Changelog

## [Unreleased]

**RM-012 J4: snapping and stacking.** Not to the grid — `snapToGrid` has done
that since the fork, and a grid is a property of the paper rather than of the
furniture. This snaps to **what is already there**: nine pairings per axis per
neighbour (each of the moving item's two edges and its centre against each of the
neighbour's), nearest wins, ties keep the first so it does not flicker. Pure
arithmetic over rectangles in its own module — no scene, no mesh, no renderer.
The tolerance is `Configuration.snapTolerance`, 25 cm, which has existed since
the fork and was read by nothing but 2D corner snapping.

A snap is horizontal and a stack is not, so they are asked separately: mixed, an
item nudged sideways onto a table would jump up onto it. `stackOn` needs half the
footprint over the surface and returns a height rather than applying one.

**The reach limit is measured, not chosen.** Without one, dragging a lamp across
a furnished room teleports it to the tallest thing in it; with only "already up
there", dragging a bowl across a table leaves it on the floor. A surface is
stackable at or below **120 cm** — J1's own six measured heights put that above
the kitchen unit at 90, the bar stool at 87 and the table and desk at 75, and
below the fridge at 180 and the door frame at 203.

Off unless `scene.snapItems` is set, so no drag changes for an embedder who has
not opted in. Never for a wall-bound item: `WallItem.moveToPosition` derives its
position along the wall and then calls up, and snapping after that would pull it
off the wall.

**RM-012 J4: align, distribute, group, elevation.** Align works on **edges, not
centres** — "left" means every item's left edge on the leftmost left edge, so a
wide item does not overhang. Six edges, named for the plan rather than the axis.
Distribute evens the **gaps, not the centres**: the outermost two are the span
being divided, and three is the minimum because two already have one even gap.
Both move through `moveToPosition`, so a wall-bound item stays bound and a floor
item keeps its elevation.

A group is a shared string on each item, not an entity — nobody selects "the
group", they click a chair and mean the six around the table. Additive in the
file, free to delete a member of, impossible to leave dangling. Selecting one
member selects the group by search; shift-clicking one removes that one.

Elevation was cheap in the file and missing from the product: `ypos` has always
been there and there has never been a control for it, so a lamp could be put on a
table only by dragging and hoping. It is a field in the inspector now, offered
for everything except the four wall-bound types, whose height
`WallItem.boundMove` derives from their own size. It sticks because
`FloorItem.moveToPosition` preserves `position.y`. Clamped at zero.

**RM-012 J4: mirror, and the risk that was already handled.** RM-007 names the
winding reversal as mirror's risk. Measured against the three in this tree it is
handled and not by us: `WebGLRenderer` computes `frontFaceCW` from
`matrixWorld.determinantAffine() < 0`. **No material's `side` is touched** — 139
of 168 catalog models are `KHR_materials_unlit`, and forcing `DoubleSide` on them
to fix a problem that does not exist would change how every one renders. A test
asserts the material is left alone, not merely that mirroring works.

The real risk was the size. A negative scale is the whole mechanism — `scale_x`
has been in the save format since the format existed — but `halfSize` was
computed by multiplying the scale in, so a mirror made it negative. `halfSize`
feeds `getWidth`, both dimension canvases, the plan's footprint projection and
**`Edge.createShape`, which pushes a rectangle of it into the wall's holes**: a
mirrored door would have cut a hole of negative width silently. A half size is a
magnitude, and is now restated from the geometry with the sign dropped.

Mirrored is the sign of the scale's product, not of one axis — two negated axes
are a rotation, which is what the renderer tests. Y is not offered: it turns a
chair upside down. `m` and `shift+m`, over the set, one commit.

**RM-012 J4: copy, paste, and the duplicate that had never worked.**
`useItemActions` read `meta.itemType` and `meta.modelUrl` off
`Item.getMetaData()`, which returns `item_type` and `model_url`. Both were
`undefined`, so `Scene.addItem` defaulted the type to 1 and asked the loader for
`undefined`. The test passed for two programmes because the fake returned the
camelCase shape the caller wished for rather than the shape the real method
returns — the second time in this document set a stub has agreed with the code
instead of with the data.

The repair is not a rename, which would fix it until the next caller.
`metadataFromRecord` in `model/model.js` is now the one translation between the
save record and the constructor metadata, with the design loader and this file as
its two callers. And the durable half is a test that pins the fake's key set
against `Item.getMetaData` on the real prototype, asserting the negative too —
that `itemType` and `modelUrl` are *not* among the real keys.

A copy does not inherit a `designId`, and that is not cosmetic: `useSelection`
resolves a selection by searching the scene for one, so two items carrying it
would be a single thing to the inspector, the plan highlight and delete.

Copy and paste share the machinery, which makes duplicate a shortcut rather than
a third implementation. Each successive paste lands one offset further out; a
copy resets that, being a new origin. Duplicate leaves the clipboard alone —
somebody who copied a sofa, duplicated a chair and then pasted means the sofa.
The clipboard is this application's, not the system's: `mod+C`, `mod+V`, over the
set.

**RM-012 J4: the selection is a set.** X-6 measured what multi-select costs here:
`useSelection` held **one** object, `select` replaced it, and eight selection
types shared that one slot. So this is not a control over an existing set — it
*is* the set, and every consumer of `selection.value` was written against exactly
one object or null.

The migration keeps `selection` meaning one thing: it is the *primary*, the last
thing clicked, and still resolves to `?{type, object}`. **All 2,235 tests passed
on the commit that changed the shape**, before a new assertion was written.
`selections`, `selectedItems`, `count`, `isSelected`, `selectMany` are the new
surface. One kind at a time, as a rule — a set holding a wall and a chair has no
meaning for any verb that would read it.

The additive modifier is read from the gesture, not the event: the selection
events come from `src/scripts`, which has no idea there is a set to add to.
A capture-phase `pointerdown` on the window records shift or the platform
accelerator, and the next selection event consumes it.

Both views draw the whole set. The plan gains `selectedItemIds` beside
`selectedItemId`; `Main.showItemsSelected` gives the primary to the controller by
the path E1 established and tells the rest to `setSelected()`.
`Controller.selectedObject` stays singular — it is what a drag moves.

Delete was repaired in the same commit, because a set breaks every verb that
predates it: it now removes the set, over a copy of the list, and commits once.
And `mod+A` selects every item.

One bug found by handing the library a better stub. `Main.showItemSelected`
guarded on `typeof item.setSelected === 'function'`, but
`Controller.setSelectedObject` then calls `setUnselected()` on whatever it is
*replacing* — so an object with one half of the pair passes the guard, becomes
the controller's selection, and throws from inside the library on the next click.
Guard completed.

**RM-012 J2: the licence, in the product.** RM-007's objective for programme J
opens with "the licence on every item", and J1 recorded that the second half had
not been done — provenance went into `sources.json`, and the licence was nowhere
in the shipped product.

Per item on the tile's `title` — *"Add Bathtub — Furniture Kit, CC0 1.0
Universal"* — and in full in a **Credits** dialog beside the drawer. 193 tiles
each carrying a licence line would say the same four things fifty times each, so
the per-item answer is one hover away and always correct, and the readable
version is the thing somebody looking for terms would open. Both are right on the
first frame, because the pack manifest is bundled; author, licence URL and caveat
fill in when the detail lands.

A row knows its kit because of where it arrived from: `useCatalog` tags each row
with the pack whose file it was fetched in, rather than adding a `source` key.
Zero bytes, and it cannot drift — a key could disagree with the file it sits in.

The kit whose licence nobody could establish is shown with a warning rather than
omitted or quietly called CC0. A credits screen that dropped the fourth kit would
undo J1's whole argument in the one place a person would look.

axe now covers the case that was risky: the drawer is deliberately non-modal and
the credits dialog is modal, so the credits mount as a sibling of the drawer's
root rather than inside its content.

**RM-012 J2: the material audit, and four models that have named a texture
nobody has since 2014.** `tools/material-audit.mjs` reads every catalog model's
materials: **52 of 417 render the glTF default white, across 31 rows**. J1 looked
at 25 demo models and found 4. Most of the 52 are correct — a Kenney sink basin
whose `_defaultMat` is white is a white basin — so the gate is not "no material
may be colourless" but that a **claim** must be honoured, and a claim is
something written down: the row's name, or the material's own name. The second
rule found a row nobody was looking at, whose material is called `black metal`
and renders white.

The legacy `.js` ancestors of the four each name a diffuse map —
`mapDiffuse: cb-moore_baked.png` and three like it — and **none of those files
exists in any commit of this repository**. S3's conversion correctly produced a
material with no texture; B1's Draco pass dropped the explicit `[1,1,1,1]` as a
default. Both innocent. The product photographs hid it until J1 rendered them.

Colours are sampled from those retired photographs, read out of git at
`9ea9f57~1`: the console is rgb(26, 24, 23), the sectional rgb(94, 89, 72) —
R = G > B, olive rather than grey. Converted to linear, since a glTF base colour
is linear. Verified by re-rendering: the new thumbnails measure rgb(33, 32, 31)
and rgb(96, 91, 75), within three units of their evidence.

**No geometry moved, and the first attempt moved some.** Writing through
`gltf-transform`'s `NodeIO` re-encodes — `cb-moore_baked.glb` 22,064 → 13,032,
`closed-door28x80_baked.glb` 15,728 → 28,396 — at Draco settings that are not the
ones B1 measured against a 5 µm gate. Reverted for a container patch that
rewrites the JSON chunk and copies the binary chunk verbatim: +28 to +44 bytes a
file, with `encode:check`, `oracle:check` and parity true by construction.

One characterization test failed and re-checking made it stronger.
`model-conversion.test.js` pins that S3 passed each legacy `colorDiffuse`
through; the repaint broke it for four. The legacy value in all four is `[1,1,1]`
and in all four it was a *multiplier on a diffuse map*, so white was never the
intended appearance. The four are now pinned from the other side — they must
equal the painted table **and** their legacy value must have been a white
multiplier on a named map. One more assertion, not one fewer.

**RM-012 J2: curation is the lever, and now it is a command.**
`tools/admit-pack.mjs` measures a candidate the way `catalog-cost.mjs` measures
the catalog — same `filesFor`, so a pack's mean and the catalog's mean are the
same kind of number — and answers one question: after admitting these N items,
would more packs at this price still reach RM-007's 400? Not "is this pack
expensive", which is a question about a pack in isolation and has no answer.
`npm run admit`, `npm run admit -- --candidate <rows.json>`, `npm run admit:check`.

**It corrected task one's own sentence on its first run.** That landing said 1.5×
reaches *the top* of RM-007's range only with curation. Re-run rather than
quoted: **232 items are needed for the bottom of it and the headroom buys 206**,
so neither end is reachable standing still. Corrected in place in the roadmap.
What it changes is not the decision but how much of it was load-bearing.

The gate is set at a price a kit in this tree is actually had at — the cheapest
shipped pack of ten rows or more, which is the Kenney kit at **12,285 B an item,
140 CC0 rows already through Draco**. Proof by existence rather than an estimate.
At that price the headroom buys 469, so both figures are reachable and
`admit:check` fails the day they stop being.

**And the first run found where the mean lives.** `blueprint3d` is 25 rows,
**14.9 % of the catalog and 55.7 % of its bytes**, at a mean of 104,850 against
the Kenney kit's 12,285 — eight and a half times. The tail X-2 identified has an
address, and it is the 2014 demo's own models. The cheapest way to buy items is
to re-price twenty-five rows already shipped.

Three refusals that are not arithmetic: an unestablished licence, an item over
`catalog-item-largest`, a source that resolves to nothing. Two notes that are not
refusals, because both have a better answer than no: a candidate not through
Draco has not been priced yet, and one whose mean is twice its median is carrying
a tail that trimming fixes more cheaply than refusing.

**RM-012 J2: packs are fetched, not bundled.** No catalog row is in the
application bundle any more. `tools/split-catalog.mjs` divides the catalog a
second time — J1 split it by *tier*, this splits both tiers by *pack* — and
writes eight files to `public/catalog/`. What the bundle imports is
`catalog-manifest.json`: one line per kit naming it, its licence, its row count
and its two URLs, **575 gzipped bytes for four packs**. `useCatalog` fetches the
rows the first time somebody opens the drawer, index first and detail after,
which is the staging J1 had between the bundle and a chunk moved to two fetches.

The tier split alone would have run out, and X-3 recorded when. J1's metadata on
600 rows is **17,264 gzipped bytes of growth against 13,292 of `first-load`
headroom**, and split by tier the index half is 9,857 — which fits, and that is
the trap rather than the answer. The old line grew by ~34 gzipped bytes per row;
the manifest grows by ~90 per *kit* and by nothing per item.

A pack is a source, because a licence is a property of a kit: the unit somebody
admits or refuses, the unit a licence is recorded against and the unit the fetch
is grouped by are the same unit. Four packs — kenney-furniture-kit 140,
blueprint3d 25, unattributed 2, khronos 1 — each carrying its own provenance
rather than pointing at a shared table, so acquiring one is a file dropped in and
a manifest line. The two rows J1 could establish no licence for are now one pack
and one manifest line, which is what deciding whether to ship them amounts to.

`tests/browser/first-load.test.js` asserts M-43 on the instrument it was built
for: a boot fetches none of the four packs, by name and by path, and the drawer's
first open fetches all four — the case that stops the other two being a
tautology, since a URL that 404s also never appears in a boot's timings.

One budget line re-pointed, one added, neither a lowering. `catalog-index`
becomes `catalog-bundled`, 3,940 → 2,600 with 3,553 → **2,451** measured, the
same distinction RM-011 H1 drew re-pointing `texture-vram`: the number under the
line is a different number. Like for like the catalog in the payload went
**5,429 → 2,451** gzipped. `catalog-packs` is the thirteenth line, 9,935 against
10,450 — what opening the drawer costs, which is where the bytes went rather than
away. `first-load` fell 409,941 → **406,565**, and is now independent of the row
count. Packs resolve through `AssetResolver`, so `?assetBase=` moves the catalog
to a CDN with the models it describes.

**RM-008 E1 delivered: the plan shows the design.** Furniture, doors and
windows are drawn on the 2D plan, picked and dragged there, and selection now
crosses between the plan and the 3D view in both directions. Before this the 2D
view had no code path for items at all, and RM-008 T-2 measured cross-view
selection at zero changed pixels each way; it is 5,732 and 20,224 now,
differenced by the same method that found the fault.

The contract landed first and alone, as the drawing committed: `Model` derives a
list of footprints — plain numbers and strings, no three.js types, no methods —
and hands it to the floorplan as data. Nothing gained a back-reference to the
scene and `Floorplanner2D` still takes two arguments. Because it is pure data it
is pinned by 24 tests with no canvas, and coverage rose on the commit that
introduced the feature.

Four bugs surfaced by driving the application rather than reading it, three of
them older than this sprint. `Controller.clickDragged` guarded a null selection
one line *after* the call that dereferences it — unreachable until clearing the
selection from the plan made it reachable. `setSelectedObject(null)` leaves the
state machine in SELECTED, which stops `checkWallsAndFloors` and makes every
wall in the 3D view unclickable; `Controller.deselect()` is the way out, and it
cannot be done inside `setSelectedObject` because `onEntry(UNSELECTED)` calls
that — attempted, and the suite returned a stack overflow. The pan branch's
condition is a list of things that could be grabbed and an item was not on it,
so the first drag of a chair panned the plan. And `Main.showItemSelected` is
handed whatever is selected, which `useSelection` documents may be anything at
all.

Wall labels no longer read `m:5m`. The prefixes are the wall-information flags
and the `m` stands for midline; they are empty strings now and still
configurable, because an embedder drawing interior and exterior lengths together
does need to tell them apart. A characterization test pinned the old default,
and the reasoning for changing it is recorded beside the assertion.

Two things did **not** change, and the second is a correction. The save format
is untouched — a footprint is derived, never stored. And RM-007's claim that the
split view leaves the plan half off the left edge does not reproduce: measured
on both paths, the plan is centred, off by 8 px and 1 px, clipped in neither.
Nothing was written for it, because forcing a zoom-to-fit on every layout change
would discard a zoom and pan the user chose.

    branches   68.77 -> 70.09      lines      80.32 -> 80.71
    statements 80.26 -> 80.66      functions  79.17 -> 79.62

Every file the sprint touched ends higher than it started, which was its own
acceptance criterion: `floorplanner.js` 63.40 → 68.31, `floorplanner_view.js`
69.26 → 73.37, `model/model.js` 78.49 → 82.83, `plan_projection.js` at 100. 38
new tests — 28 headless, 10 in the browser tier for M-23 and M-32, including a
2 ms frame budget for a 36-room, 150-item plan against the 0.79 ms measured.

`lib-esm-gzip` **raised** 50,300 → 53,500 with the reason in `tools/budget.json`:
the ESM entry grew 3.1 KB gzipped because this is a library feature, not an
application one. The property that limit guards — three and bezier-js external,
an order of magnitude below the ~423 KB a lost externals config produces — is
unchanged, and the new ceiling keeps the same ~5% headroom the limits were set
with.

New public API, all additive: `EVENT_ITEMS_PROJECTED`, `EVENT_ITEM_2D_CLICKED`,
`projectItem`, `projectItems`, `footprintContains`, `footprintCorners`,
`Floorplan.setItemProjection` / `itemProjection` / `footprintById` /
`setItemCommands`, `Floorplanner2D.showSelection` / `overlappedItem` /
`itemIsDraggable` / `selectItem`, `Main.showItemSelected`, `Controller.deselect`,
`Model.itemById` / `projectItemsToPlan` / `dispose` and the three plan-item
commands.

**RM-008 E2 delivered: drawing to a number, and per-wall thickness.**

Typed length and bearing while drawing, 15° angle snapping, a click-click
rectangle-room tool, wall split and join, alignment guides off existing corners,
and a thickness that belongs to the wall and is saved with it.

**The height half of the sprint turned out not to exist.** `Wall.height` does
not set the height of the wall — measured by building the geometry and reading
its bounding box, not by reading the code. A wall with `height` 400 and its
corners at 250 draws a mesh 250 tall; raising the corners to 400 draws one 400
tall while `height` still says 250. The top comes from the corner elevations.
So the field is wrong in all three places that read it whenever a corner is
raised: the wall texture's vertical repeat, the initial placement of a wall
item, and `HalfEdge.height`, which nothing reads at all. Deriving it from the
corners fixes all three and stores nothing new — and fails the frozen r98 golden
for `edge.plain`, which records a texture tiling past the top of a raised wall.
Three r98 is gone and that capture cannot be regenerated, so this is a parity
change with a fresh capture attached rather than a tidy-up. Reverted, and pinned
with the measurement instead. The inspector therefore offers no height field; it
says height is set per corner and that two walls meeting at one share it.

`thickness` is additive and conditional: written only for a wall that was given
one, so a design where nobody touched a thickness re-saves byte-identical and a
file written before E2 still follows the document's setting. Every other key in
a wall record is unconditional, which is precisely why this one cannot be.

Four bugs, every one found by driving the pointer rather than calling the
method. `updateTarget()` ran for DRAW and for a MOVE drag and nothing else, so
every rectangle was measured from the origin and refused as degenerate — a test
that calls `placeRectangleCorner` directly passes happily, so the suite now
drives pointer events. The length field read 0 while the plan drew 1.524 m,
because App's `pointermove` listener is bound before the library exists and so
runs first, reading the previous event's target; it reads on the next frame now,
which is when the canvas repaints, so the two numbers come from one state. A
join removed the wrong corner, because `detachWall` deletes a corner the moment
its last wall leaves. And a first click with no move before it used a stale
target.

    branches   70.09 -> 71.20      lines      80.71 -> 81.21
    statements 80.66 -> 81.16      functions  79.62 -> 78.97

63 new tests, 1,448 total, including the acceptance in all five display units.
No budget moved. Functions dipped 0.65 and stays 0.97 above its floor: the new
code adds more functions than the suite calls directly, and the three floors
that matter here all rose.

Also corrected: the README said Shift snaps to the axis while drawing. It turns
on grid snapping, and always has.

New public API, all additive: `Wall.thickness` / `hasOwnThickness`,
`Floorplan.splitWall` / `joinWallsAt` / `newRoomFromRectangle`,
`Floorplanner2D.drawTarget` / `setDrawTarget` / `placeDrawTarget` /
`placeRectangleCorner` / `anglesnapmode` / `alignguides`,
`floorplannerModes.RECTANGLE`, `snapToAngle`, `alignToCorners`,
`ANGLE_SNAP_DEGREES`, `ALIGN_TOLERANCE_CM`, `COLLINEAR_SAGITTA_RATIO`, and the
optional `thickness` field in a saved wall.

**RM-008 E3 delivered: a plan that can be read by somebody who did not draw it.**

Dimension lines between any two points, free text labels, a room type beside the
room name, a north arrow, and a ceiling height per room. Two new persisted
collections — `dimensions` and `annotations` — plus an optional `north` and an
optional `type` on a room, all additive and all written only when there is
something to write.

**The per-room ceiling height is not stored, and that is the finding.** E3 was
planned with it as a third persisted field. Building it that way would have
repeated the bug E2 measured in `Wall.height`: a wall's drawn top comes from its
two corners' elevations, so a room's ceiling *is* the elevation of its corners,
and a second number beside them can disagree with the geometry. So `ceilingHeight`
reads the corners and `setCeilingHeight` writes them — nothing new is persisted,
which also means nothing new can be lost, and every file this project has ever
written already carries its ceiling heights. The panel says what follows from
that: a corner shared with the room next door is one corner, so raising this
room's ceiling raises that wall on both sides.

These are the first **authored** entities in the model — everything else the plan
draws is derived from the wall graph — and two things follow. Their ids are
persisted, unlike a room's, because a dimension has no description to be found
again by; that is what lets a selection survive an undo, which here is a save and
a load. And both collections are omitted from the file entirely when empty, which
is the half of M-33 that an additive collection usually gets wrong: `[]` looks
harmless and turns every file already on somebody's disk into a different file
the first time they open and save it.

A dimension's ends carry an optional corner id and follow that corner when it
moves, so a drawing does not quietly start lying after the first edit. Delete the
corner and the dimension falls back to the point it stored — the last place that
corner was — rather than vanishing or throwing. The offset line's geometry lives
in one exported function that the drawing, the measurement and the hit test all
call, because two copies of that formula is how a dimension becomes clickable
somewhere it is not drawn.

Two new tools on the rail, <kbd>D</kbd> and <kbd>T</kbd>. The dimension tool is
click-click and stays armed, because a plan needs several. The text tool places
one and drops back to the pointer, because a label is placed in order to be typed
into and the panel's field takes focus on mount — the gesture starts on the
canvas and finishes in the inspector without a second click. <kbd>Delete</kbd>
now removes a selected dimension or label as well as a selected item; walls,
corners and rooms still need the eraser, deliberately, because deleting a wall
silently deletes the rooms it defined and an annotation costs a keystroke to
recreate.

The north arrow is drawn on every plan, in screen coordinates fixed to the top
right, so panning cannot take it off screen and zooming cannot change its size. A
room's ceiling height is drawn only where it is **not** the document's wall
height — a plan carrying the same number a dozen times is noise, and the number
is worth drawing exactly where it is a surprise, which also means a plan drawn
before this sprint looks exactly as it did.

**Labels give way to each other now**, which is the other half of the caption
rule E1 shipped and flagged. A size threshold stops a zoomed-out plan being a
field of words and does nothing at all about two chairs side by side, both big
enough, whose captions land on top of one another — and E3 makes that worse
before it makes it better, because a room can now carry four stacked lines and a
person can put text anywhere. Text a person typed and the measurement on a
dimension are reserved in a pre-pass before anything is drawn; everything derived
— a room's area, name, type and ceiling, an item's caption — asks for its box as
it draws and does not draw if the box is taken. The pre-pass is what makes the
priority right: reserving in draw order would let "A New Room" beat a label
somebody typed, because rooms are drawn first, and reordering the drawing to fix
that would put the furniture over the walls.

That pass immediately found something that had been wrong all along. A room's
name is offset **30 centimetres** below its area and both are drawn at a fixed
12 px, so the gap between two lines of type shrank with the zoom: at the default
scale 30 cm is about 16 px, which is one line height, and the two labels touched.
Invisible until something started asking whether they touched — at which point
the room's own name vanished under its own area on every plan. The stack is
spaced in pixels now, like every other piece of typography on the canvas.

**Three bugs found by driving the assembled application, not the library.** The
label field did not take focus, so typing "Living area" went to the global
shortcut map and opened the furniture catalog: this panel mounts *during* the
click that created the label, so a `focus()` on mount lands and the same
mousedown's default action takes it straight back — measured as a `focusin`
followed immediately by a `focusout`, with `activeElement` settling on `<body>`.
It focuses a frame later, which is after the gesture. Turning north in Settings
threw the panel over to the Selection tab, away from the field being typed into,
because `useSelection` rebuilds its `{type, object}` wrapper on every revision
and the panel watched the wrapper rather than the identity. And `Delete` did
nothing for the two new kinds of selection until it was taught them.

    branches   71.20 -> 73.19      lines      81.21 -> 82.61
    statements 81.16 -> 82.55      functions  78.97 -> 80.17

99 new headless tests and 9 in the browser tier, 1,547 and 81. The two files
RM-008 T-3 named as the least covered in the library finish the programme well
above it: `floorplanner.js` 63.40 → 82.51 and `floorplanner_view.js` 69.26 →
83.35 across E1–E3. `model/annotation.js` is at 93.25 with every function
covered.

One characterization test was re-checked and re-pinned rather than relaxed. Two
assertions in `tests/plan-items-2d.test.js` read `not.toContain('fillText')` —
"nothing drew any text at all" as a proxy for "no caption was drawn" — which was
true when the only text in that fixture was the caption and is false now that
every frame draws a north arrow labelled N. They assert the item's name is or is
not among the strings drawn, which is both narrower and what they always meant.

Two budgets **raised**, with the reasons in `tools/budget.json`: `lib-esm-gzip`
53,500 → 59,500 for 5.7 KB gzipped of library feature, and `demo-total`
13,860,000 → 14,140,000. The second is worth naming because the number is
startling — the tree grew 274 KB for maybe 60 KB of new source — and the reason
is that 6.2 MB of that 14 MB tree is one sourcemap. The gzipped JS a browser
actually downloads moved 353 → 364 KB against a 371 KB ceiling and needed no
change at all.

New public API, all additive: `EVENT_ANNOTATIONS_CHANGED`,
`EVENT_DIMENSION_2D_CLICKED`, `EVENT_ANNOTATION_2D_CLICKED`, `Dimension`,
`TextAnnotation`, `dimensionLine`, `Floorplan.dimensions` / `annotations` /
`north` / `newDimension` / `removeDimension` / `newAnnotation` /
`removeAnnotation` / `annotationById` / `overlappedDimension` /
`overlappedAnnotation` / `annotationsChanged`, `Room.type` / `ceilingHeight` /
`hasUniformCeiling` / `setCeilingHeight`, `floorplannerModes.DIMENSION` and
`.TEXT`, `Floorplanner2D.placeDimensionPoint` / `placeAnnotation` /
`selectAnnotationTarget` / `deleteSelectedAnnotation` / `overlappedDimension` /
`overlappedAnnotation` / `snapToCorner` / `offsetToPointer`, the `dimension` and
`annotation` kinds on `showSelection`, and the optional `dimensions`,
`annotations`, `north` and room `type` fields in a saved design.

**RM-008 E4 delivered: the plan leaves the application at a stated scale.**

SVG at 1:20, 1:50, 1:100 or 1:200, a PNG at a chosen pixel width, and print
straight to the browser's PDF dialog — each sheet with a border, a scale bar, a
title block and the north arrow.

**The export is not a second renderer, and that was the point of measuring
first.** RM-008 T-5 counted every raw canvas call in `floorplanner_view.js` and
attributed each one to its method: 77, mostly inside a handful of primitives,
two outliers. That is what priced this sprint at a week. Re-measured at the start
of it, after three sprints had each added drawing code: **92 calls, and the
surface is eleven operations rather than eight**. The three extra are each from a
delivered sprint — E1's door swings and E3's north arrow need an `arc`, E2's
alignment guides need a dash pattern, E3's dimension labels need rotated text —
and a fourth is more interesting: E3's declutter pass has to *measure* text, and
a format with no font metrics cannot. The SVG backend takes a measuring function
and the application hands it the live canvas', so a sheet hides exactly the
labels the screen hides.

`FloorplannerView2D.renderTo(backend, project, size)` swaps the backend and the
projection, calls the same `draw()` the screen calls, and puts them back in a
`finally`. So a sheet walks the same rooms, walls, corners, footprints,
dimensions and labels in the same order, and there is nothing to keep in step.
Both of T-5's outliers were refactored onto the interface: `drawCornerAngles`
was passing `this.context.lineWidth` and `this.context.strokeStyle` back into
its own `drawLine` calls — the state being the parameter, which is exactly what
a second backend cannot honour — and `drawOriginCrossHair` lost a `strokeStyle`
assignment that `fillRect` never read, which is why all four of its rectangles
have always been one colour.

**A stated scale is a physical promise**, kept in one function. CSS defines an
inch as 96 pixels, so a centimetre of paper is 96/2.54 of them and a four-metre
wall on a 1:100 sheet is four centimetres — asserted as arithmetic, since a
ruler cannot be run in CI. A PNG makes no such promise, because an image is
pixels and how big one comes out is the printer's business; so PNG export offers
no ratio, its title block says "not to scale", and both formats carry a scale
bar, which stays true through a photocopier when a printed ratio does not.

A sheet carries the document and not the session. The grid, the tracing
underlay, the origin marker, the alignment guides and the half-drawn wall under
the pointer are all suppressed, and so is every hover and selection colour —
every colour decision on the canvas now goes through one `emphasis` predicate,
so a printed drawing cannot arrive with one wall in selection green.

**Two bugs, both found by running it rather than reading it.** The measurer
passed to the SVG backend was written as `view.backend.measureText(...)` — but
`renderTo` swaps `view.backend` for the duration, so once the export was under
way that resolved to the SVG backend, which delegates to its measurer, which is
that closure: infinite recursion on the first label. It reads the backend once,
before the render. And the north arrow, positioned 30 px in from the corner
because that is right on screen, landed in the margin of an exported sheet with
half of it above the printed border; the inset comes from the sheet now. The
second was found by exporting a plan and looking at it.

    branches   73.19 -> 73.23      lines      82.61 -> 82.50
    statements 82.55 -> 82.44      functions  80.17 -> 80.23

46 new headless tests and 3 in the browser tier, 1,593 and 84. Two of the four
figures moved up and two moved down by about a tenth, all four well clear of
their floors: the dip is `useDesignIO`'s three new functions, which are a blob
download, a `toBlob` and a print iframe and cannot be exercised without a
browser. `backends.js` is at 96.02 statements, `plan_export.js` at 92.07.

M-34 is met by comparing arguments rather than pixels, which is the only
comparison that means anything between a rasteriser and a path writer: a
recording backend beside the two real ones asserts that the same plan issues the
same primitives, in the same order, with the same arguments — and that every
call the canvas backend receives produces exactly one SVG element.

`lib-esm-gzip` **raised** 59,500 → 62,900 with the reason in `tools/budget.json`:
the ESM entry grew 3.1 KB gzipped, the same as E1's, for a second output format
across the whole 2D view. The refactor half is close to size-neutral — it moved
canvas calls from one file to another — and the growth is the SVG writer and the
sheet, which are new.

New public API, all additive: `CanvasBackend`, `SvgBackend`, `planBounds`,
`scaleProjection`, `fitProjection`, `drawTitleBlock`, `exportPlanSVG`,
`renderPlanToCanvas`, `PLAN_SCALES`, `PIXELS_PER_PAPER_CM`,
`FloorplannerView2D.renderTo` / `backend` / `project` / `exporting` / `emphasis`,
and `useDesignIO`'s `savePlanSVG` / `savePlanPNG` / `printPlan`.

**RM-008 F1 delivered: a door is five numbers.**

Width, height, sill, hinge side and swing on the item and in the file, with the
plan symbol, the wall hole and the 3D frame all derived from them. Nine generated
openings in the catalog — doors, windows, archways — and a panel that edits the
numbers rather than a mesh's scale.

**The data model landed first and alone**, before a single triangle was
generated, because RM-009 U-4 is the finding and geometry drawn from a mesh's
bounding box would be the same defect wearing a new file's name. A door's size
used to be a scale factor: "900 mm wide" was recorded as "0.927 times whatever
`closed-door28x80_baked.glb` happens to be". A window's height above the floor
was derived at placement and never stated. And `rotation` is a single y angle, so
a hinge side had nowhere to live at all — which is why the plan drew the same
swing arc for every door since E1 and said so in its own docblock.

**An oversized opening used to make the wall taller.** RM-009 U-2: `ShapeGeometry`
triangulates a contour and its holes together, so a hole taller than the wall is
merged into the outline rather than cut out of it. A 300 × 387 opening in a
400 × 250 wall produced a mesh 387 cm tall — the wall grew 137 cm to swallow it,
nothing warned, and the plan was unaffected because it draws the graph rather
than the mesh. Seven of the ten catalog openings are that size, which is exactly
why none of them had ever been noticed to be unusable. Every hole is clamped to
its wall now, and the browser tier asserts the wall's height rather than the
opening's.

The item's extent comes from its numbers, not its geometry, and the reason is
worth stating: **a door's leaf is drawn open**. A 90 cm door standing 90° open has
a bounding box 86 cm deep, so a size read off it would cut an 86 cm hole through
the wall, hand the plan an 86 cm-deep footprint to draw and give it an 86 cm-deep
target to pick.

**One bug found by placing a door in a live page.** `WallItem.boundMove` decides
an in-wall item's height from its own size — `sizeY / 2 + tolerance` — which put
a 210 cm door's centre at 125 and therefore its bottom 20 cm above the floor. The
height of an opening is its sill, and the centre is derived from the sill and the
height; the sideways clamp is inherited unchanged, so a door still cannot be
dragged past the end of its wall.

Type **10**, appended rather than filling the gaps at 5 and 6: item type numbers
are written into every save file, so a number that once meant something else is a
trap and a gap is only untidy. Catalog meshes are untouched — a design with mesh
doors opens unchanged and re-saves byte-identical — and the generated openings
live in their own `openings.json`, because `catalog.json` is the list of model
*files* this build ships and six suites assert exactly that over it.

    branches   73.23 -> 73.21      lines      82.50 -> 82.65
    statements 82.44 -> 82.59      functions  80.23 -> 80.36

39 new headless tests and 4 in the browser tier, 1,632 and 88. `items/opening.js`
is at 98.03 statements.

Four budgets **raised**, with the reasons in `tools/budget.json`: 2.6 KB gzipped
of library code for the description, the clamp and the generator. `demo-js-gzip`
and `lib-iife-gzip` had both been sitting at 0.3 % headroom after E1–E4 spent the
4.6 % they were set with, and both were raised back to that 5 % rather than to
just-enough — a limit at 0.3 % fails on the next commit whatever it is, which
trains people to raise it without reading it.

New public API, all additive: `ParametricOpening`,
`ITEM_TYPE_PARAMETRIC_OPENING`, `newOpening`, `normaliseOpening`,
`openingRectangle`, `clampOpening`, `buildOpeningGeometry`, `openingToJSON`,
`OPENING_DOOR` / `OPENING_WINDOW` / `OPENING_ARCH` / `OPENING_KINDS` /
`OPENING_DEFAULTS` / `HINGE_LEFT` / `HINGE_RIGHT`, `ItemFootprint.opening`, and
the optional `opening` field on a saved item.

**RM-008 F2 delivered: half walls, and the two things per-wall thickness broke.**

**A room's area is the floor now.** `Room.area` was the area between the wall
*centrelines*, which is neither the inside of the room nor the outside: a
400 × 400 room at the default 10 cm walls reported **16.00 m² where the floor is
15.21** — over by 5.2 %, and by 23.5 % at 40 cm walls (RM-009 U-7). Usable floor
area is one of the two or three numbers anybody actually wants from a plan, so it
is the one on it. The centreline figure is kept as `Room.centrelineArea` and shown
beneath it, because it is a real number that a builder measures.

Eleven characterization tests pinned the old figure. Every one was re-checked and
re-pointed at `centrelineArea` rather than re-numbered, and the distinction is the
reason: those tests are about room *detection* — which cycles are found, and that
the arithmetic is the shoelace formula rather than a bounding box — and the
centreline polygon is the one that answers those questions.

**Two walls of different thickness now meet where they join.** `halfAngleVector`
mitres with the offset of whichever half edge it was called on, so at a corner
between a 40 cm wall and a 10 cm one, one face ended at (380, 20) and the other
began at (395, 5): the room's floor ran 15 cm inside the first wall's inner face.
Unreachable until E2 gave walls their own thickness, which is why it had never
shown. Corrected only when the two offsets actually differ — when they are equal
the mitre is the one this class always computed, bit for bit, so every existing
design and every frozen r98 golden is untouched.

**Half walls are a cap on the drawn top, and getting there took two failures.**
RM-007 priced them as "per-wall height"; E2 had already measured that
`Wall.height` does not set a wall's height and declined the parity change that
would make it. RM-009 F2 therefore drew them on the corners, giving a wall its own
pair so lowering it would not lower its neighbour. **That was built, and measured,
and it does not work**: two coincident corners break the cycle the room detector
walks, so a half wall inside a room deleted the room — and `newCorner` merges
corners within `cornerTolerance` on load, so the split did not survive a save
either. Both measured rather than reasoned.

`Wall.partialHeight` touches neither. The wall graph is unchanged, so every room
stays as it was; the corners are unchanged, so a neighbour is unaffected;
`Wall.height` is unchanged, so every r98 golden is unaffected. It caps the drawn
top of one wall's faces and nothing else, which is the whole of what a half wall
is. Additive and conditional: absent from every file for every wall anybody has
ever drawn.

Openings with nothing in them — archway and pass-through — were already there:
F1's description makes an arch the same five numbers with no leaf and no pane,
which is exactly what its drawing predicted.

**One part of F2 is not delivered: columns and beams as parametric items.** They
need a new item class, a new type number, catalog rows, an inspector and their own
round-trip tests — an F1-sized slice rather than the line RM-007 makes them look
like — and shipping a new persisted item type without tests would be worse than
not shipping it. Everything else in the sprint is done.

    branches   73.21 -> 73.32      lines      82.65 -> 82.63
    statements 82.59 -> 82.58      functions  80.36 -> 80.29

15 new tests, 1,647 total and 88 in the browser tier. No budget moved.

New public API, all additive: `Wall.partialHeight` / `drawnHeightAt`,
`Room.centrelineArea` / `interiorArea`, `HalfEdge.mitreDifferingOffsets`, and the
optional `partialHeight` field in a saved wall.

### Everything below this line changed no shipped code

`src/`, `public/` and every build artifact were identical to 3.0.1 for all of
it, so no version was cut.

**The Deploy workflow no longer runs on push.** It has failed at
`actions/configure-pages` on every push to `master` — including the merge that
took master to 3.0.1, where CI passed and Deploy did not — because Settings →
Pages → Source has never been set to "GitHub Actions". The workflow's own header
called that "the intended failure", which held for exactly as long as somebody
intended to throw the switch; the plan is Cloudflare, so nobody does. A workflow
that fails on every push to the default branch trains everyone to ignore a red
mark, and the next real failure then arrives somewhere red is normal. The
trigger is now `workflow_dispatch` only — nothing is deleted, and the build,
budgets and artifact upload are all still there for whenever a target exists.

`ci.yml` is untouched and still runs on `dev` and `master`. It does not run on
the `amit` working branch and never has — the same Actions-minutes argument —
so work is proven locally there and proven again by CI on reaching `dev`. The
commit that made this change said CI runs on `amit` too; it does not, and the
workflow comment is corrected.

**Coverage headroom, so the floor stops being one commit from breaking.**
3.0.1 fixed a breached branch floor and left 0.41% above it, which is about
fourteen branches. `Utils`'s polygon predicates are now pinned, including two
PRESERVED BUGS that had no test at all: `polygonPolygonIntersect` always returns
false and `polygonOutsidePolygon` always returns true, both because they are
called with the pre-refactor coordinate arity. `pointInPolygon` and
`polygonInsidePolygon` were already pinned this way; their siblings were not, so
nothing said what they returned or why. A constant-returning function is the
easiest thing in a codebase to "fix" by accident.

    branches   68.41 -> 68.77    lines      80.08 -> 80.32
    statements 80.00 -> 80.26    functions  79.17 -> 79.17

**Correction — a commit that claimed less than it did.** `ebf6889` says it
overrides VitePress's vite to clear three advisories. It does, but the
`npm install` behind it re-resolved **564 package paths**, not one subtree, and
three text bundles grew as a result — Demo JS +0.5 KB, Library IIFE +0.6 KB,
Library ESM +0.7 KB, which is why ESM headroom moved 4.9% → 3.5%. Checked
rather than assumed: both runtime peers are unchanged at `three` 0.185.1 and
`bezier-js` 6.1.4, and no source file was touched, so the growth is toolchain
and nothing shipped behaves differently. All three are inside budget. Recorded
because the commit message describes a smaller change than the one that landed.

**RM-007, the first product drawing, added to `docs/public/roadmap.html`.**
Six programmes took the code from a 2014 demo to a tool with gates, budgets and
an instrument for everything it ships; none of them asked what a person
designing their own home needs from it. RM-007 does — an audit of what the
application can do today, read as a user rather than as a build and measured by
booting it in headless Chromium and screenshotting fifteen states, set against
Coohom's own feature list and Sweet Home 3D's as the free reference. Two of its
figures came off those pictures: two items placed in 3D and none drawn on the
plan, and a 40 px plan strip at a phone viewport. Fourteen gaps (Q-1 to Q-14),
eight programmes E–M in 25 sprints, 42 weeks at the single-developer cadence
RM-001 was planned at, five releases, and the non-goals the brief's three
constraints — free, no premium, no product linkage — rule out. Proposed, not
delivered; each programme gets its own drawing before it starts. No code, asset
or test changed.

Rev B, the same day: the audience was fixed as **web desktop only**, so the
phone-and-tablet sprint (L1, 2.5 weeks) is withdrawn and Q-7 stays on the log
as declined rather than deleted — a finding struck from a drawing is the one
that gets rediscovered as a bug. Before striking it the desktop end of the range
was measured: at 1024×768, 1280×720 and 1366×768, split view with the catalog
open, the shell holds with no horizontal overflow and both panes usable. Rev A's
totals were 26 sprints and 44.5 weeks; the drawing keeps them visible in its
revision note.

**RM-008, the drawing for programme E, added to `docs/public/roadmap.html`
(§37–§40).** The first of RM-007's eight programmes to get its own sheet,
measured against the tree before any of it is written — five of its seven
findings run in headless Chromium against the library as the dev server serves
it, not read off the source.

Two findings shape the sprint. A `Floorplan` has six own properties and none of
them is `model` or `scene`, and `BlueprintJS` hands the 2D view exactly that
object — so the plan cannot reach an item even in principle, and E1 answers it
with a projection published on the existing `CHANGE_ITEMS` ChangeSet rather
than a back-reference that would put the scene inside the plain-data layer.
And **cross-view selection does not exist in either direction**: a 3D wall click
changes 0 of 492,000 plan pixels; a plan wall click changes 0 of 432,000 pixels
of the 3D view.

That second one **corrects RM-007**, written the same day, which said the
cross-view selection was "already right" one way. It was hover state left over
from the previous screenshot — a screenshot compared against a memory is not a
measurement. Both directions are now differenced per channel in the same run.
RM-007 keeps its figures with a `.corr` note beside them; E1 goes 2.5 → 3 weeks
because it builds two directions rather than one, programme E 7 → 7.5, and the
roadmap total 42 → 42.5. This is the first drawing in the set to raise its own
estimate on the strength of a measurement.

Three measurements clear risks rather than raising them: a 36-room, 144-wall
plan draws in 0.593 ms and 150 item footprints add 0.197 ms, so the worst case
is 4.7% of a frame; the plan's whole output is 77 canvas calls of which 64 sit
inside eight primitive methods, which is what makes E4's SVG backend one week;
and the five files E touches cover 36–69% of statements — the least-covered in
the library, against a branch floor with 0.77% of headroom — so every sprint
states a test budget. No code, asset or test changed.

**RM-008 F3 delivered: a flight of stairs is its numbers.** Straight, quarter-turn
and half-turn flights generated in the browser, with a rise, a going, a tread
count, a width and a handrail, a plan symbol with tread lines and an up arrow,
and a stairwell hint the plan draws and nothing acts on. **M-37 met on the
geometry rather than on the arithmetic**: every generated flight is built and its
bounding box read, and tread count times rise is its height and tread count times
going is its plan length to the millimetre, over thirty combinations of shape,
count, rise, going and handrail.

**The sprint opened by testing F1's interface, which is what RM-009 asked it to
do.** The risk table said "the generator is written inside `Item` and F3 copies
it", and the answer measured is: half right. F1 drew the boundary at the *call* -
numbers in, a `BufferGeometry` and a material list out, nothing about doors
leaking - but the four pieces underneath it were module-private to `opening.js`,
so a second caller could only copy them or import from a module named after
doors. They moved to `items/solid_builder.js` unchanged, `opening.js` became its
first caller rather than its second, and F1's 34 tests passed without an edit.
One function is new rather than moved: a rotation about the horizontal, because a
door swings about the vertical and a handrail follows a pitch.

**The item class needed *less* than F1's, not more, and that is the interesting
result.** `ParametricOpening` had to override `objectHalfSize` because a door's
leaf is drawn standing open and a 90 cm door's bounding box is 86 cm deep - the
drawn thing escapes the described thing. A flight's does not, once the handrail
and its posts are sized to stay inside the run they serve, so the inherited
implementation is already right and an override would be a second copy of the
same number. Making that true cost four lines and 4 cm: a rail the length of the
pitch line overhangs its run by half its own section when rotated, and a post
centred on the run's foot is half a post outside it, so a 400 cm flight measured
404. The plan symbol and the solid now occupy one rectangle.

**Nothing is stored that can be derived.** The height, the plan length, where
the landing falls, and the rectangle a floor above would have to open are all
computed from the seven fields that are saved. The stairwell is the one worth
naming: the floor above sits at the flight's own height, so the opening has to
cover every tread with less than two metres over it - for the default flight that
is the top twelve treads and not the whole footprint, which is the difference
between a hint worth recording and an assumption.

**The four catalog stair meshes are superseded rather than scaled.** RM-009 U-3
measured them arriving 5.5 m wide and 4 m tall; fixing the multiplier is RM-007
J1's and a generated flight does not go near it. The browser tier loads one of
those meshes and a generated flight into the same page and compares the two,
rather than quoting the old measurement.

**A bug in E4's sheet export, found by rendering one and reading it.**
`renderPlanToCanvas` painted the paper before calling `renderTo`, and `draw()`
opens with `backend.clear()` - so the ground was wiped a moment after being
painted and a PNG came out transparent. It survived E4 because the application
sets a themed background that `draw()` paints immediately afterwards, so it only
showed for a library embedder who had not styled anything, and because the test
that counts ink counts it by RGB, under which a transparent pixel reads as ink
rather than as a hole. The ground now goes to the backend, which paints it after
the clear, rounded up to the bitmap - the logical sheet size is fractional, and
filling the logical rectangle left exactly one row of the image transparent.

**77 new headless tests and 6 new browser tests, 1,727 and 94.** Coverage up on
all four counters: statements 82.58 -> 83.12, branches 73.32 -> 73.73, functions
80.29 -> 80.82, lines 82.63 -> 83.16. One budget moved, `lib-esm-gzip` by 3.9 KB
gzipped, with the reason in `tools/budget.json`; the three F1 raised did not need
to move again, which is what raising them to 5% headroom rather than to
just-enough was for.

**RM-008 F2's outstanding part delivered: a column and a beam are numbers.**
F2 shipped without them and recorded why — a new *persisted* item type needs a
class, a type number, catalog rows, an inspector and round-trip tests, and
shipping one without them would be worse than not shipping it. This is that
slice, landed before programme G starts, as **item type 12** and metric **M-41**.

**One description, two things.** A column is a beam stood on end, and rather
than be clever about that the record says which it is and derives the rest: a
cross-section of `width` by `depth`, a `length` along the axis, and a `soffit` —
the height of the underside above the floor. `depth` means a plan dimension for
a column and a vertical one for a beam, which is not a trick being played on one
field: it is exactly what those two words mean on a structural drawing, and a
beam's depth *is* its vertical dimension. Nothing derivable is stored — the top,
the centre and the extent all come out of the four numbers, and a round column's
depth is forced to its width because a circle has one dimension.

**The third caller tested F1's generator seam again, and it held.** A rectangular
column and a beam are one `box` each from `items/solid_builder.js`. A round
column is not, and the 24-sided prism that draws it stays in `structure.js` with
one caller rather than moving to the shared file pre-emptively — the rule that
file states is that a piece moves out when a *second* caller wants it, which is
the rule F3 learned by finding `box` private.

**The height bug was expected this time, which is the point.** F1 measured a
210 cm door hanging 20 cm above the floor and F3 a railed flight that would have
floated 45 cm; both were found by placing one in a live page. `FloorItem.resized`
sets the origin to half the mesh, which stands everything on the floor, and a
beam's whole purpose is not being on the floor. So the derivation is written
against `structureExtent().centre` in the constructor, in `resized()` and in
`placeInRoom()`, and the browser tier asserts a beam's soffit rather than
trusting that it was thought of. A first draft overrode `boundMove` as well;
`FloorItem` does not have one, so that would have been a method nothing called.

**A column is drawn solid on the plan and a beam dashed**, because a plan is a
horizontal section about a metre above the floor: the column passes through it
and the beam is above it. Their plan rectangles are otherwise identical, so the
dash is the only thing that tells a reader which is which. A round column is
drawn round, from the same `section` field the mesh is built from, using two of
E4's existing primitives — `circle` to fill and a full-turn `arc` to stroke —
rather than widening one that both backends implement and M-34 enumerates.

**One bug found by exporting a sheet and looking at it.** A 45 cm round column
beside a 40 cm square one came out *smaller*: the circle's radius was taken from
`Dimensioning.cmToPixel`, which reads the screen's zoom, while everything around
it was drawn through the export projection. `renderTo` swaps the projection and
leaves `dimensioning` alone, so the column was drawn at its on-screen size on a
sheet at 1:100. The radius now comes from the projection, the way `drawDoorSwing`
already took its own, and the regression test halves the scale and asserts the
radius doubles.

**46 new headless tests and 6 new browser tests, 1,773 and 100.** Coverage up on
all four again: statements 83.12 → 83.35, branches 73.73 → 74.16, functions
80.82 → 80.98, lines 83.16 → 83.38. No budget moved, but three are now thin —
the deployed tree at 0.4 %, the IIFE at 0.7 % and the ESM at 1.5 % — and the next
change that trips one should raise it to the ~5 % the limits were set with rather
than to just-enough.

**RM-010 G1 delivered: a storey is a whole plan.** Levels in the model with a
floor-to-floor height, `levels[]` in the file, the storeys stacked in 3D at
their own elevations, the level below ghosted under the one being drawn, and a
switcher behind a flag. **M-26 and M-38 both met.**

**A level is its own `Floorplan`, and that was a correction rather than a
choice.** RM-007 priced this sprint as "levels in the model with elevation and
height", which reads as a field on the things that already exist. RM-010 V-5
counted what that costs: `Floorplan` has 55 methods and **36 of them read one of
its seven collections**, so a level field is 36 filters and 36 places where
forgetting one shows up as furniture from the floor below appearing on this one.
Against that, N independent floorplans in one page was already a proven property
with a browser suite over it, because RM-003 A1's document-ownership work made
two `Model`s coexist.

**One getter is why nothing else gained a level argument.** `model.floorplan`
resolves to the active storey, so the 2D view, the 3D view, the inspectors, the
composables and the file all read it unchanged — which is G1's third acceptance
line, and it is asserted rather than asserted-in-prose. `Main.floorplan` does
the same thing one layer up. The two questions those getters cannot answer are
asked explicitly instead: `scene.allItems()` for the whole building (the save
file, resolving an id) and `scene.getItems()` for the storey being edited (the
plan, the item count, what a click in 3D can hit). Each of the twelve call sites
was checked against that distinction rather than swept into one of them.

**The base elevation is applied in exactly one place**, which is the whole of
RM-010 V-4's answer. Nothing in this tree was drawn at a base elevation before —
every floor sat at y = 0 and a corner's `elevation` is the wall *top* — so a
second storey is a translation that did not exist. It lands on a `Group` per
storey inside `Scene`. `Floor`, `Edge` and `Item` each build relative to a plan
they are handed and were measured, before the sprint, to ask a scene for exactly
three things: `add`, `remove` and `needsUpdate`. So `Scene.levelScene(level)` is
a three-method façade and **not one line of those three files changed.**

**M-26 is met on the fixtures rather than on a design written for the purpose.**
All five `.blueprint3d` fixtures load, re-save and re-save again byte-identically
and still write only `{floorplan, items}`. A design with one storey at the
default height writes no `levels` key at all; one that has been named or
re-sized writes one, because otherwise renaming the ground floor would be an
edit that does not survive a save. And **the ground floor's plan is not repeated
inside `levels[0]`** — which is not a special case being tolerated but the thing
that keeps RM-009 §44's promise: a build that has never heard of storeys opens a
three-storey house and gets the ground floor, correctly drawn.

**M-38 is measured off the scene graph, not off the model.** Three storeys at
280, 280 and 300 are asserted to have every mesh they own — floor, ceiling, wall
faces, fillers, furniture — between their base and their base plus their height,
and editing the ground floor's height to 400 moves the two above it and leaves
it where it is. A base is the running sum of the heights below and is never
stored, so there is nothing to go stale.

**An item now asks its own storey for a plan.** `placeInRoom`,
`isValidPosition`, `closestWallEdge` and `closestCeilingPoint` all ask a
floorplan a question about *this* item, and reading `model.floorplan` would ask
it of whichever storey the user happens to be looking at. Six call sites, one
`Item.floorplan` getter, and a fallback to the active plan for an item that has
not joined a level yet — which is every item mid-construction and every item a
test builds by hand, and is exactly the old behaviour.

**Two bugs found by driving it rather than reading it.** A newly created
storey's 3D projection was **empty**: `Floorplan3D` only subscribes and builds
when a change arrives, which was right when there was one of them built before
anything loaded, and wrong for a view created after its plan already has walls.
Measured as three storeys loaded with levels 1 and 2 holding no meshes at all.
And the 2D canvas **did not follow a level switch** — `Floorplanner2D` holds the
`Floorplan` it was constructed with, in two places, so the switcher moved the
model and the 3D view and left the plan drawing the ground floor, which looks
exactly like a switch that did nothing.

**The ghosted storey below arrives as data, not as a reference.** A
`Floorplanner2D` is constructed with a `Floorplan` and nothing else — RM-008
T-1, deliberately — so it structurally cannot reach the level underneath. E1 hit
the same wall for furniture and answered it with a projection; this is the same
answer. `model/level_projection.js` describes wall centrelines and room outlines
and nothing else: no labels, no dimensions, no furniture, because a ghost exists
to say where the walls downstairs are. It is drawn with the grid rather than
with the building, so an exported sheet of the first floor carries the first
floor.

**36 new headless tests and 5 new browser tests, 1,810 and 105.** Coverage flat
to within a tenth on all four: statements 83.35 → 83.36, branches 74.16 → 74.13,
functions 80.98 → 81.01, lines 83.38 → 83.40. Three budgets raised —
`demo-total`, `lib-iife-gzip` and `lib-esm-gzip` — which is the change the last
commit predicted: all three were named as sitting at 0.4 %, 0.7 % and 1.5 % of
headroom, with the note that the next change to trip one should raise it to the
~5 % the limits were set with. All three are set that way. The library entries
moved 1.4 KB and 2.3 KB gzipped, the cheapest of the five features this
programme set has added — because a level is a floorplan rather than a filter on
one, so almost nothing existing grew.

**RM-010 G2 delivered: a hole where the stairs arrive, and the first roof.**
Floor openings derived from F3's stairwell hint and clamped to the room they
land in, room areas that subtract them, and flat, gable and hip roofs over the
building. **M-39 and M-40 both met.**

**A stairwell is derived, not drawn.** F3 already computes the rectangle — the
part of a flight's footprint with less than two metres of headroom under the
floor above, which for a default sixteen-tread flight is its top twelve treads —
so nothing new is persisted and nothing has to be authored. What G2 adds is the
frame change: the hint is in the item's own frame and a room is in plan space, so
it is rotated and translated by the item's own placement. A stairwell under a
flight turned thirty degrees is a rectangle turned thirty degrees.

**The clamp is the sprint's real content, and RM-009 U-2 is why.**
`ShapeGeometry` does not cut a hole that pokes outside its outline — it merges
the hole *into* the outline, so the floor gets **bigger**. U-2 measured a wall
growing 137 cm that way and RM-010 V-3 measured a 400 cm floor coming out as
−100..500. Every opening is now clamped inside its room by bisection on one
scale factor, and the containment test is a real one rather than a bounding-box
one, because a room can be L-shaped and a rectangle can have all four corners
inside such a room while spanning the notch.

**The polygon predicates here are new, and deliberately.** `core/utils.js` holds
four preserved bugs — `pointInPolygon` returns false, `polygonPolygonIntersect`
returns false — pinned by characterization tests and left alone on purpose;
turning them on is RM-007 J4's re-baseline. `model/floor_opening.js` carries a
fresh, correct pair used by that module and nothing else, which is the rule
`plan_projection.js` already states.

**A test caught a real bug in that new predicate.** The first draft tested the
*centroid* of the inner polygon plus "no edge crossings", which sounds like a
proof and is not: a rectangle that **encloses** the room has its centroid inside
the room and no edge crossings at all, because the two boundaries never meet. It
was reported as contained, and a 1400 cm hole went through into a 400 cm floor.
Containment is not symmetric and a centroid cannot tell which way round it is.
Every vertex is tested now.

**The area is the floor you can stand on**, which is F2's own rule applied to
the thing that now punches holes in it. A 600 × 600 room loses 27,000 cm² of its
348,100 to a default flight's stairwell — 7.8 %, the same order as the 5.2 % F2
existed to fix.

**M-40: the first roof this application has ever had.** RM-010 V-1 traversed
every mesh of a loaded design and found what `roofPlanes()` actually returns —
one *ceiling* per room, a triangle fan at that room's corner elevations. There is
no envelope over the building and nothing in the file that could describe one. So
there was nothing to supersede, and the per-room ceiling stays, because a ceiling
and a roof are different things.

**A gable and a hip are the same solid with one number different.** Both are the
volume between a rectangle at eaves level and a ridge segment above it; a hip's
ridge is inset from the ends by the hip run and a gable's is not inset at all.
Written once with an inset, a gable is the inset-zero case and its two vertical
triangular ends fall out rather than being special-cased. Asserted over three
kinds × two ridge axes × thirteen pitches, and the rise is the half-span times
the tangent of the pitch with nothing stored beside it.

**The first draft wound all four slopes backwards** — every slope normal pointed
down into the roof. Faces are emitted through an outward test against the solid's
own centre now, which is exact for a convex body and is four fewer chances to
get a sign wrong.

**A second bug found by placing a flight in a real page.** `Floorplan.update(true)`
constructs a **new `Room` for every room** — room identity is derived from its
corners rather than assigned, which is finding H-5 — so the openings a room was
carrying were on an object that no longer existed. Drawing one wall anywhere on
the plan silently filled in every stairwell.

**One correction to G2's own bullet.** RM-010 said both stale things in
`three/floor.js` would be cleared. The misleading comment is gone — it claimed
the live roof call was commented out while the line below it ran on every
redraw — and `buildRoofVaryingHeight` is renamed `buildCeiling`, which is what it
builds. But `buildRoofUniformHeight`, the dead method nothing calls, **stays**:
it carries a frozen r98 golden, three r98 is gone, and deleting it would delete a
parity check the project cannot recapture in exchange for removing eleven lines
nobody runs. Dead code is untidy; a lost parity check is unrecoverable.

**102 new headless tests and 6 new browser tests, 1,912 and 111.** Coverage up
on all four: statements 83.36 → 83.42, branches 74.13 → 74.16, functions
81.01 → 81.19, lines 83.40 → 83.44. **No budget moved** — the three raised for G1
absorbed this sprint, which is exactly what raising them to ~5 % rather than to
just-enough was for. The ESM entry is back to 1.2 % of headroom, so G3 will
likely trip it.

**RM-010 G3 delivered: the house, driven.** A three-storey fixture through every
tier, an exterior view, per-storey visibility connected and tested, V-7 measured,
and **the levels flag is off** — `levelsEnabled` defaults to true.

**The fixture is the sprint.** The other three fixtures are plans;
`tests/fixtures/three-storey.blueprint3d` is a building — three whole
`Floorplan`s, a straight flight and a quarter turn, the stairwells those imply
in the two upper floors, a column, a beam, a door, a window and a gable roof. It
is produced by `tools/make-fixtures.mjs` through the real `Model`, so it is
exactly what the application writes, and it is driven through save, load, undo,
autosave, the plan, an exported sheet and the 3D view.

**Driving it found four defects, three of them shipped.** None is reachable
without a building.

**No saved column or beam had ever loaded.** `Item`'s constructor calls
`setScale()` whenever a scale is supplied, `setScale()` calls `resized()`, and
F2's `ParametricStructure.resized()` reads a description its own constructor has
not assigned yet. The catalog path supplies no scale, so *placing* a column
worked and *opening* one threw `Cannot read properties of undefined (reading
'kind')`. F2 anticipated exactly this window in `objectHalfSize()` and guarded
that method only.

**Room names on any storey with a stairwell were destroyed on the second load.**
G2 re-applies floor openings inside `Floorplan.update()` and put that block
*above* the loop that restores each room's name. `setFloorOpenings` calls
`updateArea`, `updateArea` announces an attribute change, and the listener writes
the room straight back into `metaroomsdata` carrying the name it has at that
moment — which is still "A New Room". The saved name was overwritten by the
default a few statements before it was read. It is the same read-before-write
hazard the comment inside that loop describes, one level up. Moved below the
names.

**`tools/make-fixtures.mjs` had stopped reproducing its own fixtures**, four
programmes ago, when RM-003 A1 gave every plan a `DesignRuntime` and that runtime
an id: constructing a `Floorplan` now draws eight random numbers before a corner
is made, and every builder seeded *first*. Every corner id in all three files
shifted by one position. Nothing caught it because nothing re-ran the script. The
builders seed after construction now, and a clean `git diff tests/fixtures` after
running it is the check.

**`Controller.deselect()` was not idempotent, and `Main.clearSelection()` was
worse.** `setSelectedObject(null)` switched UNSELECTED → SELECTED on the way in
whatever it was handed, so a method named `deselect` selected, and the method the
application calls every time it shows the plan pane left the machine claiming a
selection it did not have. One condition fixes both, and it makes the recursion
that method's own comment warns about impossible by construction. **Correction to
this file's E1 entry**, which says that state "stops `checkWallsAndFloors` and
makes every wall in the 3D view unclickable": measured before changing it, and it
does not — `mouseUpEvent`'s SELECTED branch transitions and checks within the same
click, so a floor click after `clearSelection()` still reports the floor. What was
wrong was the state, not the click.

**An exterior view, which turned out to be three things that happen together.**
Every storey shown, because the outside of a house is not the outside of its
ground floor; the roof with them; and the camera framed against
`Model.buildingBounds()` rather than against the plan being edited — the union of
the storeys' corners, the eaves at `roofBase()`, and the ridge the pitch implies.
The distance comes from the camera's own field of view and aspect, so the box
fits a wide viewport and a tall one. Asserted in Chromium by testing every corner
of the building's box against the camera's frustum.

**Per-level visibility was built in G1 and connected in G3**, which is what V-8
asked for: `Scene.syncLevels` has taken an `activeOnly` option since G1 and
nothing passed it, and an untaken branch is an untested one. `Main.showStoreys()`
drives it, the roof follows it, and the storey switcher has the control. What it
is *for* is picking: the raycast is offered the active storey's items and the
active storey's plan, so with every storey drawn the upper floors are visible and
inert. That is the answer this build gives, it is defensible, and now something
says so.

**The plan draws the stairwell it was leaving out.** G2 cut the opening from the
3D floor and from the room's stated area and left the 2D plan drawing a solid
room, so the two views disagreed about the same building — and the plan is the
one that gets printed. It is drawn as a void, in the same dashed style
`drawStair` gives the hint on the storey below, because they are the same
rectangle seen from either side.

**V-7, measured rather than assumed.** A snapshot is 3,137 bytes at one storey,
7,884 at two and 10,331 at three — ×3.29, which is the arithmetic the finding
predicted. `exportSerialized`, the part autosave still does on the main thread,
runs in **0.010, 0.020 and 0.024 ms** — five readings, stable to the
microsecond, and well inside a frame. (Under `--coverage` the same call reads
0.022 / 0.024 / 0.034; the instrumented figure is not the one to quote, and both
are recorded so the difference is not rediscovered.) **Corrected by H1 to 0.007,
0.019 and 0.024 ms**, ×3.3 — see that entry: these were a mean over one timed
loop, which measures the scheduler as well as the work, and the test was flaky
at about one run in ten because of it. Ten commits held
104,190 bytes, so the 50-entry ceiling is about 505 KiB for this house — and
about 1.2 MiB with sixty items on it, extrapolating at the 247 bytes a furniture
record costs in `legacy-items`. **Decision: incremental history does not become
its own sprint.** Half a megabyte of strings and 24 µs a write is not a problem,
and the change would land on a single-level editor equally well, so it is not
this programme's to smuggle in. The number to watch is the file, not the storey
count.

**56 new headless tests and 8 new browser tests, 1,968 and 119.** All six files
V-8 named are up on statements *and* branches, which was the acceptance line:
`three/controller.js` **51.65 → 84.43** and **36.14 → 71.42**, `useAutosave.js`
52.94 → 71.56 and 31.25 → 56.25, `three/main.js` 76.35 → 84.18 and 62.50 → 70.56,
`useDesignIO.js` 48.97 → 50.34 and 30.00 → 34.00, `model/model.js` 89.45 → 90.87
and 79.41 → 80.98, `floorplanner_view.js` 85.65 → 85.93 and 71.59 → 71.75.
Overall: statements 83.42 → 85.94, branches 74.16 → 76.93, functions
81.19 → 83.32, lines 83.44 → 85.90. **No budget moved.** The ESM entry is down to
0.5 % of headroom, which G2 predicted would be tight and is the first thing the
next sprint should look at.

**The flag stays in the code.** What G3 removes is one default, not the switch:
it is the line an embedder hosting a single-storey plan turns off, and the branch
it guards is one `v-if`.

**RM-011, the drawing for programme H, added to `docs/public/roadmap.html`
(§49–§52).** Eleven findings `W-1..W-11`, five of them run in headless Chromium.
Programme H is *"any surface any colour or material, lit like a room, and a
picture at the end of it"*, and measuring it first found two things that change
its shape.

**Under the profile this library ships as its default, every wall is unlit.** A
material census of a loaded three-storey design, run once per render profile,
finds `MeshBasicMaterial` walls and `MeshPhongMaterial` floors under `classic`
and `MeshStandardMaterial` under `studio`. And across both, **not one PBR map
exists in the tree** — every textured surface carries exactly `map`, plus a
hand-painted `lightMap` on eighteen wall faces. So "no PBR" is precise and
smaller than it sounds: the material class is already there in Studio, the
images are what is missing, and every feature in H1 and H2 is invisible under
the library's default. That is a decision H1 has to record rather than
discover, because the alternative is a parity change against r98 goldens that
cannot be recaptured.

**The library the programme is priced for does not fit, by two orders of
magnitude.** Ninety materials of albedo, normal and roughness is 270 images. At
the measured mean of this tree's own ten `.ktx2` files — 36,182 bytes — that is
9.32 MB against **78,894 bytes** of `public-total` headroom, and 90 MB of
computed VRAM at 512 px against a 45.1 MB ceiling with 18.6 MB left in it. Under
today's ceilings the library is **two images**. Even at 256 px it does not fit.

**And one of those two budgets is measuring the wrong thing.** `texture-vram`
costs every image in the tree as if it were resident, which was right while
every image belonged to a model some design might load. Read from the driver,
a three-storey house holds **7 textures** and a furnished twenty-item design
holds **15**, against 202 in the tree — so a library of ninety that a person
picks four from is over-counted about thirtyfold. The correction is to point the
line at a scene, which `gpu-memory.test.js` already knows how to measure, and
to leave the download question with `public-total`, which already asks it.

Two more numbers that move a sprint. Half this tree's furniture textures — nine
of eighteen — were refused by the 3.0 RMS oracle gate, **four of them wood
grain**, which is what a material library is mostly made of; and `ktx`, `toktx`
and `basisu` are still all absent from this machine, exactly as when RM-004 B1
said so. So H1's first task is the trial and the library's size is its output.
Meanwhile the **first-load payload is 407,324 bytes gzipped**, and the first
thing fetched after it is a 515 KB Basis transcoder — 98% of the boot's network
traffic — to decode one 10,401-byte ground texture. RM-007 asked for a
first-load budget before there was a number; there is one now.

**Three corrections to documents this set already carries.** M-28 asks the
furnished fixture to hold 30 fps under Studio on the browser tier's software
renderer; measured, it holds **388** — 12.9× the target, so the metric cannot
fail and cannot gate anything. It becomes relative: each effect states its cost
as a fraction of a measured frame. H3's "wall collision" is **withdrawn** and
left to J4, which RM-007 already assigns it to. And H1's "about ninety
materials" is withdrawn as a number.

**Two repository inaccuracies recorded rather than fixed**, since this is a
planning pass. `three/main.js:301` assigns `PCFSoftShadowMap`, which three has
deprecated and silently downgrades — `shadowMap.type` reads back as
`PCFShadowMap`, and the Studio profile's `shadowRadius: 2.4` is inert with it,
so H2's "softer shadows" is a repair before it is a feature. And north is a
property of a `Floorplan`, so since G1 a three-storey building has three of them
and nothing stops them disagreeing; H2's sun needs one.

M-42 and M-43 are added. Seven weeks and the 3 + 2.5 + 1.5 split are unchanged;
what moved is inside the sprints. No code, asset or test changed.

**RM-011 H1 task one: the encode trial, and what it says the library can be.**
The sprint's first bullet is *"the trial is task one … the library's size is a
result of this task, not an input to it."* It ran, and it corrects the drawing
that asked for it.

**The encoder was there all along.** W-6 said `ktx`, `toktx` and `basisu` are
absent from this machine and concluded the encoder was unavailable — but that
checks for the KTX-Software *system binaries*, and RM-004 B5 vendored a WASM
encoder two programmes ago. `ktx2-encoder` is a devDependency, `npm run
encode:textures` and `npm run oracle` both drive it, and H1 put 48 encodes
through it in its first hour. The conclusion W-6 drew still stands; it stands
for a better reason.

**`tools/material-trial.mjs`**, run through the transcode oracle's own harness
rather than a second copy of it — `measurePairs` is extracted from that tool for
this caller, the same move F3 made for `solid_builder.js`. Four of the tree's
material photographs, each turned into the three maps a PBR material is, each
encoded at three settings, each rendered against its source and differenced in
the framebuffer.

| map | hi-freq | best RMS | % of source | ships as |
|---|---|---|---|---|
| albedo | 0.0414 | 2.182 UASTC | 186 % | its source |
| normal, from a JPEG | 0.1216 | 8.827 UASTC | — | its source, 0 of 4 pass |
| normal, smoothed | 0.0195 | 1.049 UASTC | 110 % | its source, 3 of 4 pass |
| roughness | 0.0462 | 1.141 UASTC | 86 % | **UASTC** |

**The trial got it wrong twice before it got it right, and both are recorded in
the tool.** The first draft encoded normal maps with the options for a
photograph — perceptual weighting, an sRGB transfer function — and got RMS 35 to
48, which reads as "Basis cannot carry a normal map" and is nothing of the sort;
it is what a perceptual encoder does when asked to preserve a vector field. The
second derived those maps from JPEGs at full strength, turning the source
image's own 8×8 ringing into surface detail: the result carries three to ten
times the high-frequency energy of anything else measured, and no block codec
compresses a 4×4 neighbourhood whose texels all disagree. The trial now derives
the normal map twice, raw and smoothed, and reports both — the sensitivity made
visible instead of a number chosen.

**The finding is that the binding constraint is the image, not the codec.**
Fidelity tracks the high-frequency share across all sixteen inputs, which is why
one setting gives 1.049 on one normal map and 12.888 on another. UASTC
transcodes to ASTC 4×4 on this device, so these are not a software rasteriser's
numbers.

**And the number the sprint asked for: a material is 497,583 bytes with three
maps and 103,512 with one, so today's 78,894 bytes of `public-total` headroom is
zero materials.** Ninety of them with three maps needs the runtime-asset budget
to go from 5.9 MB to **48.5 MB**, an 8.2× raise; thirty with albedo and
roughness is 8.8 MB, a 1.5× one. For a product whose premise is a static host
and no server, that decides it: **H1 ships about thirty materials, albedo and
roughness**, with normal maps added later as real bakes rather than derived.
Recorded as W-12.

Two smaller repairs found by running the tools. A plain `npm run oracle`
**deleted the sweep evidence** that `--sweep` had merged into the same file —
the evidence for every codec refusal survived exactly until the next ordinary
check, which is the shape that tool exists to prevent; it is carried forward
now. And the oracle's harness hard-coded sRGB for every texture, so a normal or
roughness map would have been differenced as though it were colour; it takes the
pair's colour space and renders the output to match, which keeps the path
transparent. **The oracle reproduces its own report byte-identically after all
three changes**, which is how both were visible.

**RM-011 H1: a surface is a material.** The sprint's second slice, and four of
the five clauses in RM-007's gap Q-4 — *"seven textures, no colour picker for
walls, no ceiling material, no PBR"*.

**A material is beside the texture, not instead of it.** A wall side carried
`{url, stretch, scale}` and a floor `{url, scale}`; both now also carry a tint,
a rotation, an offset and up to two more maps, in the same record. A build that
has never heard of materials opens the file and draws the right texture at the
right scale, which is the promise `levels` and `roof` make one layer up.

**Written only where somebody changed something.** `model/surface.js` is the one
place that decides what reaches the file, so the byte-identity promise is a
property of one function rather than of three call sites agreeing — every key is
written when it differs from its default and not otherwise. **A tint is a
multiply, so white is not a colour, it is the absence of one**: clearing a tint
writes nothing rather than writing white, and "I cleared it" and "I never touched
it" are the same file. Asserted over all four fixtures, per surface record rather
than by grepping the string — an item legitimately has a `rotation`, and a test
that greps would be asserting that furniture cannot turn.

**A ceiling has a material for the first time.** It was one colour out of the
render profile, shared by every room in the building and settable by nobody. It
gets its own collection keyed like `newFloorTextures`, pruned like it, and
carried across a room rebuild like it — a ceiling somebody chose would otherwise
be the one attribute that did not survive moving a wall. Written only when a room
has one, so no existing file gains a `ceilings` key.

**The maps are Studio-only, and that is the recorded decision** (W-1). `classic`
draws walls with an unlit `MeshBasicMaterial`: no light for a normal map to bend,
no specular term for a roughness map to modulate. The tint applies under both,
because a multiply needs no light. The alternative is moving the library's
default profile, which is a parity change against r98 goldens that cannot be
recaptured — so this is a choice rather than a gap, and it is asserted in both
profiles rather than worked around.

**Two things found by driving it.** Picking a different image used to throw away
the material — the first draft of `setTexture` built a fresh three-key object,
so recolouring a wall and then changing its brick discarded the colour. And a
tinted wall kept a light grey top: the filler is the top of a wall and was left
at the profile's `0xdddddd`, which anybody would have called a bug. It is
multiplied by the tint now, so an untinted wall's filler is exactly the shade it
has always been.

`three/surface_material.js` is the seam on the other side, a module rather than a
method because `Edge` and `Floor` need the same arithmetic. Its maps go through
the texture cache like every other texture, so a normal map shared by four walls
is one upload — and they are released on teardown, because the leak A0 found was
this shape. They are tagged as **data, not colour**: decoding a normal map
through a transfer function is the error H1's own encode trial nearly recorded as
a codec verdict.

**42 new tests, 1,986 headless and 127 browser.** Coverage up on all four:
statements 85.94 → 86.04, branches 76.93 → 77.01, functions 83.32 → 83.54,
lines 85.90 → 86.01.

**One budget raised, and it is the one RM-011 said was certain.** `lib-esm-gzip`
73,700 → 78,300: the ESM entry went 72,813 → 74,533, **1,720 bytes** for four
clauses of Q-4, which is the cheapest feature-per-byte of the seven raises in
that file. W-4 measured 887 bytes of headroom against a five-sprint history of
3.1–5.7 KB per sprint, so the only question was by how much. `public-total` did
**not** move — the material library is not in this commit, and the trial says
what it will cost when it is.

**RM-011 H1: thirty materials, and a budget that measures a scene.** The
sprint's third slice — the library the encode trial sized, and the two budget
moves it forces.

**Thirty CC0 materials from Poly Haven**, an albedo and a roughness map each,
under `public/materials/`. RM-007 asked for *"about ninety"*; H1's own trial
priced one material and ninety of three maps came to a 8.2× budget raise, so the
count is a measurement rather than a plan. `tools/fetch-materials.mjs` acquires
and processes them, `npm run materials:check` verifies the committed tree
against `asset-pipeline/material-library.json` with no network, and
`public/materials/CREDITS.md` names every author — which CC0 does not require.

**Two resolutions, because the two maps are not the same kind of image.**
Measured as the detail a round trip preserves, a **roughness map at 256 is more
faithful than an albedo at 512 in all six materials sampled**, by 1.2 to 7.3 dB.
So the smaller map is not the weak link — the albedo already is, at twice the
resolution — and it costs a quarter of the pixels: 18,794 bytes against 122,749.
Both ship at q95, the quality `resize-textures.mjs` already measured for this
tree, and both pass that pass's own two gates. Worst resample error **0.72**
against 2.0, worst codec error **2.802** against 3.0, across all 60 shipped
images. 28.5 MB of 1K sources in, 4.50 MB out.

**JPEG, although the trial measured KTX2 as better for a roughness map.** UASTC
carried one at 86 % of source and cleared the gate; it is not what shipped,
because a KTX2 drags the 515 KB Basis transcoder with it — W-7 measured that at
98 % of a boot's network traffic for one 10 KB texture. Trading 19 KB of
roughness map for half a megabyte of decoder is the wrong way round, and M-43
says nothing unpicked is downloaded. The skybox ground keeps its KTX2 because
every boot loads it anyway. The container decision is per asset, which is the
rule B1 and C1 already set.

**The tiling scale is measured, not invented.** Poly Haven publishes each
texture's real-world size, and `Edge.updateTexture` divides a wall's width in
centimetres by `scale` — so every entry tiles at the size the material actually
is, and a 1 m brick panel repeats every metre. `src/catalog/textures.json`
carries the demo's `50` and `100` for the same brick image and records no reason
for either.

**`texture-vram` now measures a scene, not the tree** (W-5). The tree walk put
the library at 81.14 MB and would have refused it — for 90 images a scene
uploads at most four of, which is a budget blocking a feature over a cost nobody
pays. `sceneVram()` prices the two textures every viewer uploads, the costliest
wall and floor material the pickers offer, and the distinct textures of the
costliest catalog items up to the item count of the busiest design in the
repository: **25,004,576 bytes**, every term something a user can actually
produce. It is a model, so `tests/browser/gpu-memory.test.js` holds it to
`renderer.info.memory` on a real scene — the model has to be an upper bound on
what the renderer reports, or the model is wrong.

**Three budgets raised, and the biggest one overshot its own estimate.**
`public-total` 6,200,000 → 11,180,000 for a measured 10,640,264; `demo-total`
15,066,600 → 19,990,000, which is the same 4.5 MB counted again where Vite
copies `public/` into the deployment; `demo-js-gzip` 388,000 → 406,800, of which
1,730 bytes is the catalog and the rest the picker and the inspector. The
previous entry predicted *"about 8.8 MB … a 1.5× one"* and it is 10.64 MB and
1.80×. The gap was an arithmetic slip rather than a surprise: the trial's
`albedoOnly` figure prices **one** map and it was used for a library that ships
two. Corrected in place in the roadmap and in `tools/budget.json` rather than
quietly replaced.

**`lib-esm-gzip` did not move for the library**, which is the one-way arrow
paying out in bytes: `src/app` imports the catalog and `src/scripts` never does,
so an embedder who takes the library gets none of it. Its 32 bytes are
`Room.eachWallSide` and `setRoomWallsMaterial` — the walk `setRoomWallsTexture`
already had, extracted when a second caller appeared rather than written twice.

**A roughness map belongs to the picture, not to the person.** `setTexture`
deliberately keeps a tint, because picking a different brick is not a decision to
lose the colour you chose. The map is the opposite: the bumps in a plaster's
roughness map are that plaster's bumps, and leaving them on a marble would be a
bug rather than a preserved choice. So every pick writes the slot — to the
entry's map, or to null for one of the demo's seven.

**One mislabelling caught before it cost anything.** `kindOf` in the manifest
generator decided `texture` by falling through, which was true while every file
that reached the bottom was one and stopped being true when a `CREDITS.md`
landed beside the library. The VRAM line asks every `texture` for its dimensions
and a markdown file has none. Third time this function's `kind` has been found
wrong; first time a test found it rather than a budget.

**32 new tests, 2,014 headless and 131 browser.** Coverage up on all four:
statements 86.04 → 86.08, branches 77.01 → 77.08, functions 83.54 → 83.61, lines
86.01 → 86.06.

**RM-011 H1 closed: the eleventh budget, and what it found on day one.** M-43 —
*nothing unpicked is downloaded* — is the last thing in H1, and it is two
assertions rather than one.

**The budget line.** `first-load` measures what a person waits for: the
document, the scripts and stylesheets it references, and `asset-manifest.json`,
which `useAssets` fetches before the viewer can resolve a single texture. That
last one belongs to no other line in `tools/budget.json` and is the one that
grows when the asset tree does, which is exactly the coupling M-43 exists to
watch. The file list is read out of the built `index.html` rather than off the
`assets/` directory, so the number stays honest the first time anything is
code-split.

**The metric's letter is not met, and that is stated rather than finessed.** The
library grew the payload by **10,724 bytes** — 6,554 of catalog, picker and
inspector in the bundle, and 4,170 of manifest entries for ninety new files. So
"does not grow by one byte for a material nobody has chosen" is false as
written. What is true, and is the substance of it, is that **a boot fetches no
material at all**: `tests/browser/first-load.test.js` reads
`performance.getEntriesByType('resource')` after the application settles and
checks the whole catalog's urls against it, not a sample. A picker that eagerly
loaded one thumbnail per swatch would fail there and pass every byte count in
the repository, because the tree is the same size either way.

**And the line paid for the library four times over on its first reading.**
**17,065 of the served manifest's 22,208 gzipped bytes were subresource-integrity
hashes** — 4.1% of everything a person downloads before their first wall, on
every boot, for a feature `AssetResolver` documents as off by default and which
guards nothing whatsoever for a same-origin `public/`. It matters for a
cross-origin CDN deployment, which is precisely the build that should ask for it.
`npm run manifest` now writes them to `asset-pipeline/asset-integrity.json`,
which is generated in the same pass, verified by the same test that always
verified them, and never served; `npm run manifest -- --integrity` writes them
into the manifest for a deployment that wants `fetch(url, {integrity})`. **No
schema changed** — `AssetManifest.parse` has always read `hash` defensively and
`integrityFor` has always been able to return null — only which builds pay for
it.

**So the first load is 401,316 bytes: 6,008 below what RM-011 W-7 measured
before any of this existed.** Thirty materials added, and a boot got smaller.
`public-total` and `demo-total` fell with it, by the 30,938 raw bytes the
manifest lost.

**H1 is closed**, in three slices — the encode trial that sized the library, the
material model, and the library with its budget moves. RM-007's gap Q-4 —
*"seven textures, no colour picker for walls, no ceiling material, no PBR"* — is
answered in full for the profile the application boots. H2 is next, and W-8 is
waiting for it: `three/main.js:301` assigns a shadow filter three no longer
implements, so "softer shadows" is a repair before it is a feature.

**RM-011 H2 opens with the repair: the shadow filter, and a claim it refutes.**
The sprint's first bullet is *"the shadow filter is repaired first (W-8), because
softer shadows cannot be added on top of a setting that is silently ignored"*. It
is repaired, and measuring it found that the second half of W-8 was wrong.

**`main.js` names `PCFShadowMap` now, which is what the renderer has been running
all along.** three deprecated `PCFSoftShadowMap`, and `WebGLShadowMap.render`
does not ignore it politely — it warns on the first frame and **assigns
`PCFShadowMap` over the top of the value it was given**. So the property read
back as `1` while the source said `2`, on every boot, for as long as this project
has been on a modern three. Naming what runs is a **zero-pixel change**, asserted
rather than assumed: ask for the deprecated constant, let three substitute, and
difference the two frames — **0 of 307,200 pixels**. That is what makes it safe
against the frozen r98 goldens.

**W-8's second sentence is wrong and is corrected in place.** It said the Studio
profile's `shadowRadius: 2.4` is inert with that filter, so *"the one number in
the profile table that exists to soften a shadow does nothing"*. It does
something. three rewrote PCF into a **five-tap Vogel disk scaled by
`shadow.radius`** — which is precisely why the soft variant was deprecated: the
ordinary filter now does what the separate one existed for. Measured against the
profile's own 2.4, radius 1 moves **256** pixels, radius 6 moves **2,394**, and
radius 12 moves **11,993**, of 307,200. Monotonic, which is what separates "the
number reaches the shader" from "the frame is noisy".

**So H2's "softer shadows" is not blocked and never was** — the knob works, and
what the drawing took for a missing feature is a number already in the table.
That changes what the rest of the sprint has to build, which is the whole reason
a repair goes first.

**One dead property removed beside it.** `renderer.shadowMapSoft = true` —
three has had no such property since around r73, and S5 removed its two siblings,
`shadowDarkness` and `shadowCameraVisible`, while leaving this one. An assignment
onto a renderer that nothing has ever read.

**M-28's first entry: the repair costs 0% of the frame**, and it is zero by
construction rather than by measurement error — the same filter, the same frame,
byte for byte.

**And a note on how the fractions must be taken.** Re-measured with W-9's own
method and its own fixture, the three-storey design renders in **0.68 ms** under
classic and **1.20 ms** under studio, against the 1.07 and 1.31 that table
records — with *identical* geometry, 3,368 triangles and 293 calls, 3,532 and
332, to the number. The scene did not change; the session did. So an effect's
cost is a fraction of a baseline measured **in the same run**, never of a figure
carried over from a document. Best-of-seven puts the same two frames at 0.58 and
0.92 ms, which is G3's finding about interference showing up again.

**5 new browser tests, 2,016 headless and 139 browser.**

**RM-011 H2: a sun that knows what time it is.** The sprint's second bullet, and
the one that needed a schema decision first.

**`model/sun.js` is a latitude, a day and an hour, and the arithmetic that turns
them into a direction.** No three.js types, no renderer: `three/lights.js` reads
it and it reads nothing above it. It is deliberately **not an ephemeris** —
Cooper's declination and an hour angle in local *solar* time, so noon means the
sun is on the meridian rather than that a clock says 12:00. No equation of time,
no longitude, no timezone. For *"does the morning sun reach this room"* that is
the honest model, and the error across a year is smaller than one step of the
control that sets it.

**Presence is the switch, so there is no `enabled` field.** `Model.sun` is null
by default and the key light then sits exactly where the render profile puts it,
which is what every design did before H2 and what `classic` keeps doing. `"sun":
{}` is meaningful rather than empty: it says the building has a sun and takes
the defaults. Same shape `roof` uses, and for the same reason — a flag beside
the record is a second source of truth that can disagree with it. All four
fixtures re-save with no `sun` key anywhere.

**The defaults describe themselves.** Latitude 45, day 81, hour 12 puts the sun
at **exactly 45°**, due south — solar noon elevation is `90 − |latitude −
declination|`, day 81 is where the declination term crosses zero, and 45 is
halfway from the equator to the pole. The first draft used day 80 and landed at
44.60: close enough to look right and wrong enough to be worth catching, which is
why the default a reader can verify in their head beat the plausible one.

**One north for the building** (W-10). `north` has lived on `Floorplan` since E3,
which was exactly right while a design was one plan; since G1 a design is a list
of them, so a three-storey house held **three north bearings and nothing stopped
them disagreeing**. `Model.north` reads the ground floor's and writes every
storey. Derived rather than added, so there is **no new field and no new save
key**, and the per-plan value is still exactly what each 2D sheet draws.

**A sun below the horizon does not move the key underground.** It is held at the
horizon and the light is dimmed to nothing instead — a key light beneath the
floor lights the ceiling through it, which is not night, it is a bug that looks
like one. The intensity is assigned on every pass rather than inside the branch,
or removing a night-time sun would leave the lights off.

**The acceptance is on pixels, as H2 asked.** *"A shadow's penumbra visibly
changes with the sun's elevation, asserted on pixels rather than on the setting
that was assigned"* — a room with a wall down the middle, rendered at 12:00, 9:00
and 7:00, and each step away from noon moves more of the frame than the last.
Monotonic, so a frame that merely flickered would not pass. And under `classic`
the frame is **identical** with a sun and without one, which is the third clause:
every light this sprint adds is off, or free, there.

**27 new tests, 2,037 headless and 145 browser.** Coverage up on all four:
statements 86.08 → 86.19, branches 77.08 → 77.35, functions 83.61 → 83.76, lines
86.06 → 86.17. No budget moved.

**RM-011 H2: lamps that emit, by the catalog's sixth key.** RM-011 W-11 counted
the catalog — all 168 rows carried exactly `format`, `image`, `model`, `name`,
`type`, **eight of them are named like lamps**, and not one carried anything a
renderer could read. So the drawing priced this as schema work over a file six
suites assert about rather than as lighting work, and that is what it turned out
to be.

**`items/lamp.js` follows the shape `opening`, `stair` and `structure` set.** A
row states only what differs from the defaults — three of the eight say `{}`,
because the defaults were chosen to be what a standard lamp is — and the record
is saved with the item, so a design carries its own lamps rather than depending
on a catalog that may have moved on. The other 160 rows keep exactly the five
keys they had, asserted row by row.

**Brightness is in lumens**, because it is a unit that means something outside
this repository: a 60 W incandescent is about 800, and three's `PointLight.power`
is documented in lumens and divides by `4π` itself. Nothing here does arithmetic
three already does correctly, and the number in the catalog is one anybody can
check against a box in a shop.

**The bulb's position is a fraction of the item's height, and is never stored.**
A chandelier lights from near its bottom and a standard lamp from near its top,
and both stay true when somebody resizes the model — which a stored centimetre
offset would not. It is a child of the item, so dragging a lamp takes its light
with it and nothing has to hear about the move.

**Studio-only and shadowless, both measured rather than assumed.** `classic`
draws walls with an unlit `MeshBasicMaterial`, so a point light there reaches the
Phong floors and nothing else — a lamp that lights the carpet and not the room.
The bulb is **not built at all** rather than built and dimmed, which is the
cheapest way to satisfy H2's *"off, or free, under classic"*. And a
shadow-casting point light is a cube of six renders, so four lamps would be
twenty-four; `three/lights.js` declined the same trade for its fill light and
the argument transfers.

**One thing the tests got wrong before the code did.** The bulb's *local*
position is invariant under a resize — the parent's scale applies on top, and
`placeBulb` divides it out — which looks like a bug until you notice it is
exactly what keeps the world position at the top of the shade. The first draft
of the test expected the local number to move. Both are asserted now.

**19 new tests, 2,048 headless and 150 browser.** Coverage up on all four:
statements 86.19 → 86.25, branches 77.35 → 77.48, functions 83.76 → 83.81, lines
86.17 → 86.24. No budget moved.

**RM-011 H2 closed: ambient occlusion, and a photograph.** The sprint's last two
bullets, and the first-load budget H1 added earned its keep on its second sprint.

**`three/post.js` is new construction, not a setting.** RM-011 W-2 traversed the
whole tree and found **no `aoMap` on any material in either profile**, so the
only occlusion available is screen-space — a full-screen pass over depth and
normals, which needs a post-processing chain, and `Main` has never had one. It is
three's own `GTAOPass` behind an `EffectComposer`, and the wiring is the whole
file.

**It is available and off, in both profiles, and that is a measurement.** M-28's
correction says an effect states its cost as a fraction of the frame it was
measured in; measured in the same session on the same scene, a six-metre room
renders in **0.22 ms without it and 0.37 ms with — +68%**, the largest single
cost in this programme. Under `classic` it would also be *wrong* rather than
merely expensive: every wall there is an unlit `MeshBasicMaterial`, and
multiplying an unlit surface by an occlusion term is a grey stain, not lighting.

**And the whole frame moves, not only the corners.** A composer ends in an
`OutputPass` that applies tone mapping and the sRGB conversion where
`renderer.render` applies them itself, and the two are not bit-identical:
781,416 of 786,432 pixels differ by *something*, at a mean of 4.4/255. The
occlusion is the **51,153** that differ by more than 8 — the threshold this
project's transcode oracle treats as visible. Both are asserted, so a future pass
that quietly changed the tone response would show up as the first number moving.

**The first-load budget caught the first draft.** `EffectComposer`, `RenderPass`,
`GTAOPass` and `OutputPass` were static imports: **10.6 KB gzipped shipped by
every build for an effect no default turns on**, which is precisely what M-43
says must not happen. They are dynamic imports now, and the two budget lines
disagreed in a way that proves the split worked — `first-load` fell while
`demo-js-gzip` rose, because one asks what the bundle weighs and the other asks
what a person waits for.

**`Main.dataUrl()` had existed since the fork with no caller.** W-11 measured it
producing the canvas at 1024 × 768 at device pixel ratio 1 — a screenshot of a
viewport rather than a picture of a design. It supersamples now, by raising the
pixel ratio and leaving the CSS size alone, which is what a device pixel ratio
*is*: the camera's aspect, the picking, the layout and the controls all stay
correct and nothing has to be told a photograph is being taken. The restore sits
in a `finally`, because a `toDataURL` that throws on a tainted canvas would
otherwise leave the viewer rendering at four times its size for the rest of the
session. Export → **Photo, 2× resolution** is the caller.

**Two budgets raised and one exemption recorded.** `lib-iife-gzip` 288,100 →
307,000 and `demo-js-gzip` 406,800 → 423,200; an IIFE has no chunks, so rollup
inlines the dynamic imports and adds the async machinery on top — an embedder
who wants the smallest bundle should take the ESM entry, which does split and did
not need raising. And `src/scripts/three/post.js` is excluded from coverage
**explicitly and with a reason**, which is what `vitest.config.mjs` asks for
rather than letting a number drift: past its early return every line constructs a
composer and three render targets, all of which need a WebGL context.

**26 new tests, 2,067 headless and 168 browser.** Coverage: statements 86.25 →
86.13, branches 77.48 → 77.28, functions 83.81 → 83.80, lines 86.24 → 86.11 —
down a tenth of a point, all of it `Main`'s GPU paths, which the browser tier
covers and the headless tier cannot reach.

**Programme H is complete.** H1 gave a surface a material and a library to pick
from; H2 gave the room a sun, lamps that emit, occlusion behind the switch and a
photograph. H3 is next: a 360° panorama, and eye height and a teleport in the
walkthrough.

**RM-011 H3 delivered, and programme H with it: a 360° panorama, eye height and
a teleport.** The last sprint of the programme, and the one whose first bullet
RM-011 W-11 priced as construction rather than as a setting — it grepped the
tree and found **no cube camera and no equirectangular path anywhere in it**.

**The projection is pure and the capture is not.** `core/equirect.js` takes six
square faces of bytes and returns one 2:1 image; it holds no three types, no
renderer and no canvas. `three/panorama.js` is the half that needs a GPU. That
is the same one-way arrow `model/sun.js` sits behind, and it is why this sprint
could be tested exactly rather than by looking at it — **coverage went up on all
four lines**, where H2's GPU-only `post.js` needed a written exemption to hold
them.

**Six cameras of our own, from three's own vectors.** `CUBE_FACES` is copied out
of `CubeCamera.updateCoordinateSystem()`, and each face's *right* vector is
computed as `forward × up` rather than typed, so the table has six lines of
input and no arithmetic to get wrong. A test builds a real `CubeCamera`, asks
three to orient it, and compares all six.

**`CubeCamera` itself is not used, and there are two reasons.** The shallow one
is that it is constructed with `fov = -90`, and a negative field of view negates
both axes of the projection — measured: a point at NDC (0.2, 0.2) through a +90
camera arrives at (−0.2, −0.2) through a −90 one. That half-turn is how three
writes each face in GL cube-map storage order, and copying it across would have
produced a panorama upside down and back to front.

The deeper one is where a `CubeCamera` renders *to*. `WebGLPrograms.getParameters`
forces `toneMapping` to `NoToneMapping` and `outputColorSpace` to the working
space **unless `currentRenderTarget` is null**. The studio profile renders
through `ACESFilmicToneMapping`, so a `WebGLCubeRenderTarget` would hand back six
faces that are not what the screen shows — a bug that looks like a colour
preference. So the faces are rendered **to the canvas**, one at a time, through
the same call a frame makes, and `gl.readPixels` reads them straight back; the
alternative was a full-screen pass duplicating three's ACES and sRGB chunks by
hand. The flip from GL's bottom-up read into picture order happens once, in the
capture, so nothing downstream of it has to know GL exists.

**One limitation, stated rather than hidden: the panorama has no
post-processing**, so H2's ambient occlusion is absent from it. Not only a
shortcut — screen-space occlusion is computed from one frame's depth buffer, so
each 90° face would occlude against its own view and the six would not agree
along the seams.

**Sampling is nearest, and the sizing is what makes that enough.** A face spans
90° over `size` pixels and the output spans 360° over `width`, so at
`width = 4 × size` the two match exactly at the centre of a face — and everywhere
else on a face a perspective projection is *denser* than at its centre, never
sparser. 4096 × 2048 from 1024-pixel faces is the default for that reason.

**The acceptance is worded as a method and is followed literally.** Four walls of
one room, each tinted a colour of its own through H1's surface material; the eye
in the middle; each wall then looked for *in the direction it is actually in* —
`faceSample` says which of the six faces that direction lands on and where, and
the pixel there has to be that wall's colour. The four right-angled walls come
back on four different faces. A panorama that were upside down, mirrored or a
quarter-turn out would pass a blankness test and fails every assertion in that
file, because every one of them ties a compass direction to a pixel.

**A measurement overturned the test rather than the other way round.** The first
draft read **0, 0, 0** for every wall, and the tempting fix was to loosen the
threshold. The cause was elsewhere: a classic wall is an unlit
`MeshBasicMaterial` with `map` set, and a `Texture` whose image has not arrived
samples as *zero* — three says so on the console and renders it anyway. The tint
was being multiplied by nothing. The suite now polls the face it is about to
assert on until the texture has landed, which is a wait for a fact rather than a
sleep for a guess.

**Eye height is a property of the person, not of the building**, so it is not in
the save file. It lives beside the theme and the workspace layout — in this
browser, for this reader, across designs — because two people opening the same
plan should walk it at their own eye level. Asserted as a decision rather than
left as an omission: a design re-saves byte-identical after the walker has
changed height.

**A teleport writes a position and the floor under it, and nothing else.** Not
the velocity — a walker who was moving arrives moving, which is what carries the
sense that the *room* changed rather than the person. Not the orientation. Not
`_canJump`, which the next frame decides from the position just written. Each is
asserted by measuring the motion *after* the teleport, not by reading a field
back. `groundHeight` is a second number rather than a change to the first, and
defaults to 0: the fall is arithmetically identical to the fork's for a design
with one storey, and a click on an upper floor now lands on that floor instead
of dropping through it.

**The five preserved constants are measured off the motion.** One held key for
one step of 0.1 s moves the walker exactly 30 cm, so the acceleration is 3000.
Two equal steps in the ratio 1 − k·dt give friction 10/s. A step of 0.5 s from
rest falls 245 cm, so gravity is 980. The jump's first step recovers 350. The eye
stands at 160. An assertion that `walkspeed === 3000` would pass on a rig that
had stopped using it.

**The aim is the centre of the screen**, because a pointer-locked walkthrough has
no cursor: the crosshair is where you are looking. Floors are collected from
every storey *shown*, with visibility checked up the whole parent chain —
`showStoreys(false)` hides a level group, and a teleport onto a floor nobody can
see is a teleport into the dark. **Wall collision stays withdrawn** (W-11), with
J4, whose subject is the two preserved polygon predicates it needs. Eight
programmes now without touching them.

**One budget raised, and H2 named which one.** `lib-esm-gzip` 78,300 → 83,000.
H2's note called this line thin at 2.0% and left an instruction — *"the sprint
that trips it should raise it to ~5% rather than to just-enough"*. It went one
sprint later. The entry measured 76,761 → **78,999**, and all 2,238 bytes are
this sprint's own code: `Raycaster` and `PerspectiveCamera` were both already in
the bundle, so no three module came with it. `first-load` took 2.5 KB of the same
change and sits at 3.2% — the next line to watch. Splitting the capture out as a
dynamic import is the obvious answer and is **not** taken: `package.json`
publishes exactly two files, so an ESM chunk would not be shipped at all.

    branches   77.28 -> 77.32      lines      86.11 -> 86.33
    statements 86.13 -> 86.35      functions  83.80 -> 84.09

**60 new headless tests and 10 in the browser: 2,126 and 169.** And a correction
to the H2 entry below, while both are still unreleased: it says *"2,067 headless
and 168 browser"*. Both re-run at that commit, `8928283`, in a clean worktree:
**2,066 headless and 159 browser**. One high and nine high, in the direction that
flatters — and the reason to check rather than to subtract is that the second
figure is out by more than this whole sprint added.

New public API, all additive: `EYE_HEIGHT`, `CUBE_FACES`, `directionAt`,
`pixelFor`, `faceSample`, `projectEquirectangular`, `PANORAMA_FACE_SIZE`,
`PANORAMA_WIDTH`, `panoramaCameras`, `capturePanoramaFaces`, `capturePanorama`,
`panoramaDataUrl`, `flipRows`, `PointerLockControls.groundHeight` / `eyeLevel` /
`teleport`, and `Main.panoramaUrl` / `walkPosition` / `setEyeHeight` /
`eyeHeight` / `walkableSurfaces` / `teleportToView`. Export → **360° panorama,
from the walk** is the caller, and Settings → **Walkthrough** is the eye height.

**Programme H is delivered, all three sprints.** H1 gave a surface a material and
a library to pick from, H2 gave the room a sun, lamps, occlusion and a
photograph, and H3 lets you stand anywhere in it and take the whole view away as
a file.

**RM-012 J1: the catalog splits before the metadata lands.** The sprint's first
bullet, and RM-012 X-3 put it first for a reason: as RM-007 drew it, J1 would add
metadata to every bundled row and J2 would split the file afterwards — shipping a
first-load regression and then removing it.

**Two files now, generated from the one that is still authored.**
`src/catalog/catalog.json` remains the only place a row is written.
`tools/split-catalog.mjs` divides it into `catalog-index.json`, which vite
inlines, and `catalog-detail.json`, which is a dynamic `import()` and so becomes
a chunk. `npm run catalog:check` regenerates and compares, and a test runs it —
the mechanism `tsconfig.json`'s ledger drifted five times for want of.

**Where the line goes was measured, not chosen.** Each candidate key was added to
all 168 rows and the result gzipped at level 9:

    format   +40 B     168 identical strings
    room    +369 B     a vocabulary of eight
    tags    +116 B     a smaller vocabulary still
    size    +907 B     every value different

So the index carries what the grid filters on **and** what the placement path
reads — which keeps `addItem` synchronous, worth far more than the 40 bytes
`format` costs — and the detail carries what a person reads about one item. The
filterable keys turn out to be the cheap ones because their vocabularies repeat;
the expensive ones are exactly those nobody reads until they click.

**The two budget lines disagreed, which is the evidence the split worked.**
`demo-js-gzip` rose 405,606 → 408,761 because the detail chunk is in the build;
`first-load` rose 408,108 → 408,473, **365 bytes**, because it is a chunk nobody
fetches until the drawer opens. H2's ambient occlusion produced the same pair of
readings for the same reason.

**M-44 is a twelfth budget line**, `catalog-index` at 3,580 with 3,408 measured —
the file compacted and gzipped, which is what a bundler emits. Set at the usual
~5% deliberately: a ceiling with J2's whole row growth pre-authorised inside it
would notice nothing, and this line exists to make a key crossing back into the
payload a decision somebody records.

**The dimensions are measured rather than authored** — the one J1 field nobody
should type. Each model's bounding box is computed by walking its glTF scene
graph and transforming all eight corners of every primitive's own accessor
bounds, which survives Draco because the extension replaces the buffer view and
leaves the accessor's metadata alone. 168 of 168 measured, including the three
plain `.gltf` files a binary-only reader missed.

**And the catalog turns out to be authored in two units, with a 28-fold gap
between them.** The largest extent of the small population is **1.82** and the
smallest of the large is **51.42**: 141 models in metres, 27 already in
centimetres. Both check out against real furniture — at ×100 a basin is 34 cm
wide and a stack of books is 15; at ×1 a double bed is 140 × 200 and a door is
97 × 222. This is what `Item.initObject` has been guessing at since the fork,
with `if (halfSize.x < 1.0) resize(×300)` under a comment calling itself an ugly
hack, and RM-009 U-3 measured the 300 wrong and assigned the fix here. At ×300
that stack of books is 45 cm wide. **The band between the two populations is left
ambiguous on purpose**: a model landing between 2 and 40 units is reported and
the run fails rather than being silently assigned a unit, because the rule is
fitted to this catalog and J2 will add packs it was not fitted to.

The drawer shows the size in the unit the reader is working in, and shows nothing
until the chunk lands — which is the split working rather than a defect.

    branches   77.32 -> 77.37      lines      86.33 -> 86.33
    statements 86.35 -> 86.36      functions  84.09 -> 84.09

**21 new tests, 2,147 headless.** Still to come in J1: the metadata itself, browse
by room, the twelve wall segments out of furniture, and the thumbnail tool.

New public surface: `npm run catalog` / `catalog:check`, and
`loadCatalogDetail()` from `useCatalog.js`.

**RM-012 J1: every row says what it is, where it belongs and who made it — and
the sizes shipped eight days ago were wrong.** M-29 is met from a measured
baseline of zero: all 168 rows carry a room from a closed list of eight, at least
one tag from a closed list of fourteen, a source that resolves, and a measured
size. The vocabularies are closed for a reason X-3 priced rather than for
tidiness — eight words repeated is what makes the key affordable in the bundled
index. Two gates hold it: `split-catalog.mjs` refuses to write either generated
file for a catalog that fails, and seven assertions in the asset-integrity suite
check the tree, because a generator can be bypassed by editing what it produced.

The licence lives once per kit in a new `src/catalog/sources.json`, and each
entry carries **the evidence for its own identification** rather than an
assertion. The upstream blueprint3d repository holds exactly 25 model files and
all 25 of this catalog's `js-glb` rows match one by basename. The Kenney kit's
page states 140 files and CC0; 139 of this catalog's 142 `gltf` rows draw only
from one shared 14-name material palette, and excluding the two that share none
leaves exactly 140. The duck's licence is read from the Khronos sample set's own
README. **Two rows ship on a licence nobody could establish** — `SimpleCabinet`
and `chandelier` — and they are recorded as unknown and named in a test, rather
than assumed CC0 by resemblance, which is the entire point of writing provenance
down. Whether they ship at all is J2's decision to take.

**The correction.** J1's first slice detected each model's unit from its own
extent and read the Kenney kit as metres. The kit is on a **2 m grid**, so 141 of
168 rows shipped at half their size. What let it through is worth more than the
fix: the sanity check was run against a basin and a stack of books, and both are
plausible at either reading. Architecture is not — `floorFull` is exactly
1.000 × 1.000 units and `wall` is 1.000 × 1.290, so ×100 is a room tile one metre
square under a **1.29 m ceiling**. Six standard heights then agree on ×200 to
within 5 %, and at ×200 the Kenney door frame is 97.2 cm wide against the
blueprint3d door's 97.1 — two kits, authored in different units by different
people, agreeing on the width of a door to a millimetre.

So the scale is now **declared** rather than detected: `unitScale` on the kit,
overridable on a row, with the extent rule kept only as a 5 cm–6 m sanity band.
That is only possible because the same sprint put `source` on every row —
**X-1's provenance is what fixes X-3's measurement**, and the two halves of J1
turn out to be one thing. Four rows override their kit; each is a model that is
not really of it, the duck included, which is declared at ×10 with the note that
a test asset has no real-world size to be authored at.

The building came out of the furniture as a catalog edit: RM-012's twelve
segments plus the panel, six openings and four flights that are the same
argument — 23 rows whose room is `structure`. The two rows both called *Chair*
are distinguished, and so are two more the count had missed, differing only in
the case of one letter. All three new names were read off the models' own
thumbnail filenames rather than invented.

**The drawer browses by room, and remembers.** Eight room chips, plus *Starred*
and *Recent* — a third axis rather than a ninth room, because the point of a
favourite is not having to remember which room it was filed under. Both live
where the eye height H3 added lives: in this browser, for this person, across
designs, never in a design file. Keyed by model URL, which is already a row's
identity everywhere else. The search box now matches tags as well as names, whole
word against the closed list, so *seating* finds twenty-five chairs that do not
contain the word. Placement type moved from twelve chips to a `<select>` and
nothing was removed — it is the filter an embedder reaches for, and the eight
that answer "what goes in a bedroom" deserved the row.

The star was drawn first as a control inside the tile, which is itself a button.
It read fine and axe called it: `nested-interactive`, on **all 193 tiles**. A
button inside a button is one element to a screen reader and the inner one cannot
be reached. It is a sibling positioned over the tile now.

X-3's own key prices are corrected in place while its file is open: `room` costs
**131** gzipped bytes across 168 rows and `tags` **178**, not 369 and 116, and
the ordering is the other way round. `catalog-index` is raised 3,580 → 3,940 for
them, measured 3,408 → 3,759, with the reason in `tools/budget.json`. The whole
metadata pass costs the payload **544 bytes**; `first-load` ended at 410,277,
the other 1,260 being the drawer's new controls.

    branches   77.37 -> 77.45      lines      86.33 -> 86.39
    statements 86.36 -> 86.41      functions  84.09 -> 84.21

**25 new tests, 2,172 headless.** Still to come in J1: the thumbnail tool, and
the `×300` hack the measured scale now replaces.

**RM-012 J1: the `×300` hack goes, and the measurement replaces it.** RM-009 U-3
measured the number wrong and assigned the fix here. `Item.initObject` read
`if (halfSize.x < 1.0) resize(×300)` under a comment calling itself an ugly hack,
and there were two guesses stacked in those four lines. *Which* models needed
scaling was decided from one axis of one item — so a wide flat rug authored in
centimetres has no axis under 1.0 and a tall thin lamp on the kit grid has two,
which means the test answered a question about units by measuring a shape. And
*how much* was 300; the Kenney kit is on a 2 m grid, so it is 200. At ×300 that
kit's dining chair is 141 cm tall.

The number is declared and arrives before the model does. `split-catalog.mjs`
resolves each row's `unitScale` from its kit and writes it into the **bundled
index**, not the detail, because it is read at the moment an item is placed and
`addItem` is synchronous by construction — **60 gzipped bytes across all 168
rows**, there being three distinct values in it.

**A saved design does not move.** `scale_*` is absolute and includes this
conversion, so a chair placed under the hack is recorded at 300 and stays at 300;
applying the kit factor again on load would multiply an item by 200 every time a
file was opened. The constructor records whether the scale came from a document
and `applyUnitScale` returns when it did. Two copies of the same chair in one
design, one placed before this change and one after, are genuinely different
sizes, and both are exactly what their record says. Written up in
[the save-format reference](docs/save-format.md).

`Item.resize` was only ever exercised because the hack called it, and the
inspector's own tests stub it out — so this would have quietly left the width,
height and depth fields untested. Three tests now cover it directly, including
the tenth-of-a-centimetre tolerance that stops a field round-tripping 49.99999
from reading as a resize.

    branches   77.45 -> 77.48      lines      86.39 -> 86.41
    statements 86.41 -> 86.43      functions  84.21 -> 84.22

**8 new tests, 2,180 headless.** Still to come in J1: the thumbnail tool.

**RM-012 J1 complete: the thumbnails are rendered, not collected.**
`tools/render-thumbnails.mjs` drives headless chromium over SwiftShader and
renders one 300 × 225 PNG per catalog row from the model that row actually
places — at 600 × 450, box-filtered down, one model at a time. X-8 measured that
all 168 collected thumbnails were already 300 × 225, so this is not about size:
it is about **framing**, which is what a collected thumbnail cannot be consistent
in and what a catalog several times larger cannot be kept consistent in by hand.

The honest limit was measured before the tool was written. **139 of the 168
models declare `KHR_materials_unlit`**, so no light reaches them and *lighting*
consistency — half of what RM-007 asked for — is not available here. What the
tool makes consistent is the camera, the framing margin, the background, the
resolution and the format.

Every thumbnail is PNG now, and that is not tidiness: 19 were `.jpg` and 2 were
`.JPG`, a 404 waiting for a case-sensitive host, and a JPEG cannot carry the
alpha the other 147 have. The drawer paints tiles on a surface that changes with
the theme.

Two numbers inside the render were measured rather than chosen, and they pull
against each other. The first draft framed each model by its **bounding sphere**,
which wastes the frame in exactly the cases a furniture catalog is full of — a
sphere round a 200 × 30 × 90 bed takes the half-diagonal for a radius, so the bed
is drawn at the size of a cube that would hold it. Fitting the projected **box**
took mean frame coverage **15.8 % → 20.9 %** and cost 243 KB. Supersampling
**twice rather than three times** gave 179 KB of that back at no visible cost on
a 150 px tile: every extra sample level invents more part-covered edge pixels and
each is a colour PNG has not seen before.

**Four budget lines moved and none was raised.** `public-total` 10,609,326 →
10,926,439 and `demo-total` 19,313,259 → 19,629,535, **+317,967 net** — 1,330,113
bytes of renders against 1,012,146 deleted. Headroom on those two falls to 2.3 %
and 1.8 %, which is the figure J2 needs in front of it. Deliberately not raised:
the ceiling is J2's to move with the arithmetic beside it. And `catalog-index`
went **down**, 3,819 → 3,553 — a thumbnail is named after the model it was
rendered from, so `image` and `model` are nearly the same string on every row and
gzip charges almost nothing for the second. That rename paid back 266 bytes, most
of what `room` and `tags` cost together — and `first-load` fell with it, 410,394 →
409,933, so a boot got smaller in the commit that added a quarter of a megabyte
to the tree. The two lines disagreeing is the split working, for the third time
in this sprint.

`asset-pipeline/thumbnails.json` is the gate, because re-rendering takes minutes:
it records every row's bytes, hash, and the `coverage` and `clipped` readings
that check framing by arithmetic rather than by looking at 168 pictures. None
empty, none clipped, mean coverage 20.9 %. It also records what each render
*replaced* — P6's compression report names five of the deleted files as things it
produced, so the chain is written down and the older report left true, the
arrangement B5 established and this is the third pass to join.

**The render caught the catalog lying about two of its own rows.** *Sectional –
Olive* renders white, and so does *Media Console – Black*. Neither is a rendering
fault: **4 of the 25 demo models carry no texture and no base colour factor at
all** — those two, plus *Open Door* and *Wardrobe – White*, which are white anyway
and so went unnoticed — and an untextured glTF material is three's default white.
The collected thumbnails were product photographs of the real furniture, so they
showed an olive sofa and a black console the files have never contained. Recorded
for J2, because the fix is an acquisition question.

The first draft accumulated all 168 buffers and pulled them across in one
`page.evaluate`: at the 3× it was rendering then, 2.43 MB each is 408 MB raw and
about 544 MB base64'd, and V8 threw `ERR_STRING_TOO_LONG`. One at a time is
1.1 MB a call at today's 2×.

**Two browser characterizations were re-stated rather than loosened**, both
because the `×300` hack was in their numbers. U-3's stair: at the measured ×200
the Kenney flight is 267.9 cm, still too tall to stand under a 250 cm wall and
now too *short* to reach the 280 cm a storey rises — it fits neither end, which
is a sharper form of the finding than the hack produced. U-2's opening: the same
kit's wall module is 257.9 cm rather than 386.9, so the clamp is still under test
and the opening still oversized, by 8 cm rather than by 137. Both docblocks keep
the figures as they were measured and say why they moved.

One defect is **recorded and not fixed**, because it belongs to J4 and is not a
typo: `useItemActions.duplicateSelected` adds nothing. It reads `meta.itemType`
and `meta.modelUrl` off `Item.getMetaData()`, which returns `item_type` and
`model_url` — both undefined, so `Scene.addItem` defaults the type to 1 and asks
the loader for `undefined`. It went unseen because the test's fake returns the
camelCase shape the caller wishes for rather than the shape the real method
returns. A duplicate also needs a new `designId` rather than the original's, so
the fix is a decision about what that re-add path reads, and J4 owns copy, paste
and duplicate.

`Scene.addItem` has a contract change worth an embedder's attention: a model that
arrives in units other than centimetres now needs `metadata.unitScale`. The `×300`
fallback that used to guess is gone, and nothing is scaled that does not say so.

    branches   77.48 -> 77.48      lines      86.41 -> 86.41
    statements 86.43 -> 86.43      functions  84.22 -> 84.22

**6 new tests, 2,186 headless.** Sprint J1 is complete: five bullets from the
drawing and a sixth RM-009 U-3 assigned to it, across three commits.

## [3.0.1] - 2026-08-16

No shipped code changed — `src/` is byte-identical to 3.0.0 and so is every
build artifact. This exists because 3.0.0's own commit fails `npm run
test:coverage`, which both CI and deploy run, so the tag was a trap for anyone
who checked it out.

**Branch coverage was under its floor** — 66.86% against 68 — and had been since
RM-005 C2, whose defensive guards added branches that nothing exercised and
whose close-out ran every gate except this one. Three new suites close it, all
of them covering paths that were genuinely untested rather than padding:
`core/texture_formats.js` was at 27.9% branches and decides whether a KTX2 may
be transcoded at all; `Corner`'s `y` setter had never been called by any test;
and `Wall.distanceFrom`, `oppositeCorner`, `getClosestCorner` and
`updateAttachedRooms` were all at zero including every failure branch.

    branches   66.86 -> 68.41    lines      79.29 -> 80.08
    statements 79.18 -> 80.00    functions  78.44 -> 79.17

Floors are unchanged. Raising them to capture the gain would put statements at
exactly its own threshold, which recreates the failure.

## [3.0.0] - 2026-08-16

**A major, for one line.** `Item.remove(child)` now detaches the child instead
of removing the item from the scene. `Item` is a public export and it is in the
shipped bundle, so a consumer who passed an argument to `remove()` gets a
silently different outcome — and a silent behaviour change on a public method is
a major whatever its size. The form everything actually calls, `remove()` with
no arguments, is unchanged, and the new behaviour is the one `Object3D.remove`
has always promised; the old one quietly ignored its argument.

Nothing else here breaks. **The save format is untouched at 2.0.0** — no
document written by 2.x reads differently, and no asset name a design can
contain has moved. The eight textures returned to JPEG live inside `.glb`
containers, which no document names.

Three programmes are in this release: RM-005's two sprints, RM-006, and the
clean-up after it. Advisories are at zero for the first time.

### RM-006 — the encode that was never looked at

RM-005 C1 ended by raising one thing and not settling it: B5 had encoded 18
model textures gating only on disk and video memory, and had never rendered one.
This settles it. **Nine of the eighteen were past the codec gate**, eight of them
now ship as JPEGs again, and the instrument that found them is in the repository
instead of being thrown away for a fourth time.

**The pixel oracle is a tool now — `npm run oracle`.** It renders a texture and
its KTX2/ETC1S transcode through identical geometry, camera, sampler and
colour-space state at 1:1 and differences the frames, and it recovers its own
sources from the commit that deleted them. That measurement had been built three
times as a throwaway script and deleted three times, which is the direct reason
B5's encode was never checked: the thing that looks at the picture did not exist
anywhere a sprint could reach.

**Calibration failed, and that was the finding.** Pointed at the five room
textures C1 t5 published, it reproduced none of them — every figure came out
low. The cause is exact: with `outputColorSpace` set to Linear-sRGB the harness
returns `hardwood.jpg` at 7.441, max 66, 19.88% over 8, which is the published
row to three decimals. **The earlier oracle differenced a frame nobody sees**
— the application renders in sRGB — and its bias is not one-directional, so
mid-tones were overstated and highlights understated. `Ground_4K` was 1.098 and
is 0.761; `Garden` was 4.483 and is 6.552. Every run now renders the source and
checks it against its own decoded pixels first; that residual is 0.000, and
under the old configuration it would not be.

**Nine of B5's eighteen fail the 3.0 RMS gate** — `nyc2.jpg` at 7.004 with a
worst pixel 174 levels out, two wood grains at 4.88, six more between 3.2 and
4.5. Every encoder setting was swept before anything was reverted. ETC1S at
maximum quality rescues exactly one: `cb-archnight-white_baked.png` goes 3.392 →
2.728 at quality 192 and replaces a 187 KB PNG with a 55 KB container, so it is
both better looking and smaller. UASTC clears the other eight at 163–456% of
source, which is larger, for every one of them, than simply shipping the source. So eight ship as JPEGs,
under B1's per-asset rule for the third time.

**Three size budgets go back to their pre-B5 values** — 6,200,000 / 330,000 /
13,860,000, the numbers in `tools/budget.json` at `17688b3`. B5 lowered all
three on the strength of this encode. No limit goes one byte past where it
already was. Texture VRAM is 16.15 → 27.38 MB against an unchanged 45.15 ceiling.

**`repoint-textures.mjs` goes both ways.** B5 wrote it one-directional because a
texture that was encoded stayed encoded; a refusal is a verdict on a
measurement, and measurements change. It now returns an image to its source,
moves the texture off `KHR_texture_basisu` onto `source`, and drops the
extension declaration when the last KTX2 leaves a container.

Adding a `.ktx2` without measuring it now fails the test tier in four seconds;
the browser render stays behind `npm run oracle -- --check`. Also corrected:
`encode-textures.mjs` said KTX2 "stays compressed at roughly 1 bit per pixel"
while the arithmetic beside it charged one **byte** — the arithmetic is right and
conservative, the prose was wrong by a factor of eight.

No public signature, saved design or asset name changed. New in
`asset-pipeline/`: `model-transcode-oracle.json`, plus corrected columns written
into the two oracle files whose figures it supersedes.

### RM-005 C1 — the last of the texture memory

The first sprint of the residual program. It set out to take the 11.67 MB of
texture VRAM that RM-004 B5 left behind, and it banked **4.00 MB** — because
five of the seven candidate textures were rendered, measured and refused.

**Texture VRAM is reported honestly now, and the honest number went up.**
`textureVram()` read `.png`, `.jpg` and `.jpeg`; B5 turned 18 textures into
`.ktx2` and the extension list did not follow, so 18 uploads stopped being
counted. Dropping a 669×1024 KTX2 into `public/` moved the budget by 0.00 MB.
Corrected 12.54 → 20.15 MB with the limit untouched — the second correction to
this line, and the two went opposite ways.

**`Skybox` was fetching two textures the manifest could not reach.** Both were
string literals passed straight to `TextureLoader.load()`, bypassing
`AssetResolver` — and they are 8.00 MB of the 11.67. That bypass cost nothing
while B4 was downscaling files in place, and would have broken the moment a name
moved, which is exactly what this sprint needed to do.

**`Ground_4K.jpg` is a KTX2**, 5.33 → 1.33 MB. The old name is retired to it, so
anything still asking for the JPEG resolves. `envs/Garden.jpg` was measured and
kept: ETC1S bands a sky gradient at RMS 4.483 against a 3.0 gate.

**The texture cache change was built, tested, and reverted.** B5 recorded that
`acquireTexture` could not hold a `CompressedTexture`, and that was true; the
replacement handed out an empty container and adopted the decoded payload into
every live clone on arrival, keeping the signature and the synchronous return.
Then the five textures it was built for all refused — 7.4, 5.5, 10.2 and 4.1 RMS
against a gate of 3.0, and a lightmap whose 21-byte dynamic range makes an
absolute gate the wrong instrument. **The cache was never the binding
constraint; the content was.** Machinery with no consumer is a liability, so it
went, and the measurements stayed.

Nothing here changes a public signature, a saved design, or an asset name that
stops resolving. No budget limit moved.

Two measurements are new in `asset-pipeline/`:
`skybox-transcode-oracle.json` and `room-transcode-oracle.json`.

### RM-005 C2 — the library type tier

**355 type errors to zero, and every file in `src/scripts` is now checked.**
`npm run typecheck` covers the library, so a regression fails the build rather
than an audit command somebody remembers to run.

**three had no type declarations at all.** The package ships no `.d.ts` and
`@types/three` was not installed, so `import {Vector3} from 'three'` resolved to
`any` — and with it every three type this codebase names in JSDoc. The check had
been theatre for the half of the project that is three code. `@types/three` is a
new devDependency; it ships nothing.

That also means **355 was never the real number**. The count rose twice on the
way down — to 267 when three got real types, back to 300 when the project's own
JSDoc names started resolving — because a `Wall` that is actually a `Wall` has
properties worth getting wrong.

**Six defects, and three methods nobody could call.** Two crashes reachable from
the state every design starts in: adding a ceiling item with no rooms, and a wall
item with no walls. A parameter passed as a fourth argument to a three-parameter
function and silently discarded, which made a wall split run N+1 full rebuilds
instead of one. An implicit fallthrough returning `undefined` where every caller
compares against a tolerance. A `var` read outside the loop that assigns it. A
frozen shared constant aliased onto a mutable renderer field. And three methods
shadowed or calling into nothing — two of which would have thrown.

**Seven JSDoc tags were wrong about the code**, which is worse than missing: a
wrong tag makes correct code look broken. `getCenter()` documented as `Vector2`
returns a `Vector3`; `halfAngleVector` documented two `Vector2` parameters with
the same name and takes two `HalfEdge`s.

`npm run ledger:check` is new — a tier-1 command enforcing the type ledger's
ceiling, which had been claimed in prose since B3 and asserted by nothing.

Zero suppressions added; the count is still 4. No public API changed, except
that `Item.remove(child)` now detaches the child instead of recursing.

## [2.3.0] - 2026-08-15

Small debts, and two of them turned out to be real bugs.

Nothing here was planned work — it is the list of things that had been carried
for several sprints because each was individually too small to schedule: a
budget nobody wanted to decide about, a ledger that kept drifting, 32 lint
warnings, seven TODOs. Clearing them found a user-visible defect (the error
highlight drawn at a quarter strength), a robustness hole in the public API's
options merge, and a block of code in `Utils` that had never once executed.

The theme, if there is one: **every one of these had a rule and the rule was not
enough.** The ledger had *RECOUNT, DO NOT INCREMENT* written above it and
drifted in the very next sprint. The lint warnings were visible on every run and
nobody read them. Both are now checked by something that fails, which is the
same move B3 made when it turned the type-check opt-in from a convention into a
test.

**Minor, not patch.** The ESM bundle a consumer installs is 63% smaller and
minified, and an error highlight changes colour strength. No API changed.

Verified at `b596fd8` from a clean detached worktree, `npm ci` from the
lockfile, before anything was dated: typecheck clean, lint clean at **zero
warnings**, five pipeline `--check`s green, **1,252 headless tests in 30 files
and 57 browser tests in 10**, ten budgets green.

### Fixed

* **The error highlight on an item was drawn at a quarter of its intended
  strength.** `Item.createGlow(color, opacity, ignoreDepth)` normalised its
  `opacity` argument and then built the material with a hard-coded `0.2`, so
  `showError`'s call passing **0.8** had no effect. Found by a dead-assignment
  lint warning pointing at the normalisation nobody read.

* **`hasOwnProperty` is called through `Object.prototype` in three places**, one
  of them `Main`'s options merge — which reads keys off an object the embedder
  supplies, and would have thrown on a consumer passing `{hasOwnProperty: ...}`.

### Changed

* **The ESM bundle is minified: 130.3 KB → 46.5 KB gzipped, a 63% cut**, and
  `lib-esm-gzip` came **down** 134,000 → 50,300 — the fifth time that limit has
  moved and the first downward.

  A4 minified the IIFE and left this one alone, reasoning that its comments are
  the JSDoc a typed consumer reads on hover. That premise was false and one
  command checks it: `package.json` points `types` at `dist/types/`,
  `npm run types:emit` generates that tree from the same source, and the
  declaration files carry the JSDoc — 190 comment lines in `asset_resolver.d.ts`
  alone. An editor reads hover text from the `.d.ts`, never from the bundle.
  Verified the way A4 verified the IIFE: the minified bundle parses, exposes all
  174 exports, still externalises three and bezier-js, and its resolver still
  resolves.

* **Unreachable code removed from `Utils.pointInPolygon`.** A block that moved
  the ray origin outside the polygon was guarded by `startX === undefined`,
  where `startX` is `start.x || 0` — an expression that cannot be undefined. It
  had never run. It would not have mattered if it had: the preserved arity bug
  below it means the function returns `false` for any ray. Recorded in place,
  because repairing that guard is exactly the change someone would make
  believing they had fixed something.

* **Seven stale TODOs resolved or costed.** The one in `WallItem` described a
  problem RM-004 B2 had already solved and was actively misleading; it now
  records what B2 did instead. `Lights`' "share the wall height with
  Blueprint.Wall" is *not* actioned and says why — the values are 300 and 250
  and the gap is deliberate, so sharing them would move every light and need a
  fresh parity capture. Two more (the room-detection walk, rotated item corners)
  are stated concretely with the gate each would need.

### Added

* **`npm run lint` now fails on warnings** (`--max-warnings 0`), after clearing
  all 32. Two of them were real defects — see *Fixed* — which is the argument
  for the ratchet: a warning nobody has to act on is a warning nobody reads.

* **The type ledger in `tsconfig.json` is checked by a test.** It had drifted a
  **fourth** time — B5 added `src/scripts/core/texture_formats.js` and neither
  the directory count nor the total moved, in the sprint immediately after the
  one that rewrote the ledger under a heading reading *RECOUNT, DO NOT
  INCREMENT*. `tests/type-coverage.test.js` now parses those numbers: the
  CHECKED counts must match the tree exactly and sum to their own total, while
  the NOT YET total is a ceiling, so improving something cannot fail the build.

* **`vite/client` in `tsconfig` types**, which is where `declare module '*.css'`
  lives. `src/app/main.js` imports a stylesheet for its side effect, and without
  it the audit command reported one TS2882 against a ledger claiming `src/app`
  was at zero. The library total falls 356 → 355.

## [2.2.0] - 2026-08-15

The texture half of the payload, finished. 2.1.0 capped five oversized images
and took GPU memory from a corrected 104.67 MB to 43.00; this transcodes the
catalog's model textures to KTX2 and takes it to **12.54 MB** — 88% below where
the programme started, and 12% of what the tree was measured at before any of
it. The deployed tree is 5.32 MB against 10.68 at 2.0.0.

**Minor, on the same terms as 2.1.0.** Every export behaves as it did and every
saved design opens unchanged, including one naming a texture that has now been
renamed twice. The single narrower change is in *Compatibility*: the containers
declare `KHR_texture_basisu` as required, so an embedder supplying their own
loader needs a KTX2 loader as well as the Draco one 2.1.0 asked for.

Two findings are worth more than the megabytes. **An architectural objection
recorded in 2.1.0 was wrong**, and reading three's source rather than its
signature is what showed it — `detectSupport` never retains the renderer it is
handed, so nothing had to be coupled to one. And **a deliberate break that
failed to fail invalidated a conclusion already drawn**: 54 green browser tests
were cited as proof that KTX2 rendering worked, and they had never decoded a
texture at all. Both are written up in full rather than quietly fixed.

Verified at `e6541a8` from a clean detached worktree, `npm ci` from the
lockfile, before anything was dated: typecheck clean, lint 0 errors, five
pipeline `--check`s green, **1,251 headless tests in 30 files and 57 browser
tests in 10**, ten budgets green.

### Changed

* **The catalog's model textures are KTX2/ETC1S, and GPU memory fell another
  74%.** Texture VRAM goes **43.00 MB → 12.54 MB** and the deployed tree loses
  another 0.9 MB. A JPEG is decoded to RGBA8 before it reaches the GPU, so a
  145 KB file becomes 1.33 MB of video memory whatever it cost on disk; a KTX2
  is transcoded to a format the GPU reads directly and stays compressed there at
  about 1 bit per pixel against RGBA8's 32.

  18 textures inside 20 `.glb` containers, which now declare
  `KHR_texture_basisu` as **required** — correctly, since `textures[].source` is
  gone and there is no image to fall back to. The containers were rewritten by
  surgery on the JSON chunk rather than a glTF-Transform round trip, so the BIN
  chunk holding the Draco geometry is copied through byte for byte and the
  earlier fidelity guarantee holds by construction. `texture-repoint.json`
  records the BIN hash of every container so that is checkable, not asserted.

* **The architectural objection that stopped this last time was wrong.** It was
  that `KTX2Loader.load()` throws without `detectSupport(renderer)`, and the
  texture cache is deliberately renderer-free. Reading `detectSupport` rather
  than its signature shows it does not retain the renderer at all: it makes
  seven `extensions.has(...)` calls and assigns a plain object of booleans to a
  public field. The real dependency is on **what formats this GPU supports** —
  a property of the device, as page-wide as the cache itself.
  `core/texture_formats.js` produces that record, from a real renderer when
  `Main` offers one and otherwise from a one-pixel throwaway context, and
  nothing gained a renderer reference.

* **The room textures were left as JPEG, and that is the sprint's real
  boundary.** A different blocker turned out to be genuine: `TextureLoader.load()`
  returns a `Texture` synchronously, which is what lets the cache hand out
  clones and fill in pixels later. `KTX2Loader.load()` returns `undefined` and
  delivers a `CompressedTexture` by callback, whose data lives in `mipmaps`
  rather than the shared `source` the clone trick depends on. Supporting it
  means changing what `acquireTexture` promises, and with it `Floor`, `Edge` and
  `Skybox` — a redesign of a module two earlier sprints hardened, not a side
  effect of a format change. **That leaves 8.75 MB on the table against the
  22.84 MB taken**, and the measurement is recorded rather than the intention.

* **The last opaque PNG on the GPU path is a JPEG, and the first retired asset
  name went with it.** `rooms/textures/hardwood.png` was 476 KB for a 512×512
  texture — 1.861 bytes per texel, nine times the density of any JPEG in the
  catalog, and the largest file served once 2.1.0 capped the big ones. As JPEG
  q95 it is **142 KB at 41.0 dB**, well over the 36 dB floor an earlier pass set.
  Lossless was measured first and rejected: stripping its 18 KB of ICC and iTXt
  metadata and re-deflating produces 564 KB, *larger* than the original.

  The interesting half is the rename. This is the **default room texture**, so
  its name is written into every design that kept the default floor, and an
  earlier test said outright that this file must never move for that reason.
  That warning was correct when written and is now obsolete: RM-003 A5 built the
  indirection that was missing, and a manifest entry may carry a `url` saying
  where the file actually is. `rooms/textures/hardwood.png` is now a **retired
  name** resolving to `hardwood.jpg` — the first use of a seam A5 built and
  nothing had needed. Every design that names the old path still opens.

  `tools/make-asset-manifest.mjs` throws if a retired name's target is missing,
  or if a name is both live and retired. The rule that replaces "never rename a
  room texture" is narrower and stronger: rename only with a retirement entry.
  **Do not delete a name; retire it.**

* **Five places were treating a logical name as an address**, and the retirement
  is what exposed them — the resizer, the cap test, the saved-design fixture
  check, the default-texture check, and the demonstration of A5's own rule. Each
  read `public/<manifest key>` directly, which is an `ENOENT` the moment a key
  stops being a path. All five resolve before reading now.

  The last of those is the one worth noting: the test demonstrating that "a base
  moves every URL without touching the name" had been using `hardwood.png` as its
  example, where name and file were identical — so it could not tell the two
  concepts apart. It is now the first assertion in the suite where the logical
  name and the physical file genuinely differ.

* **Three more budget ceilings came down**: `public-total` 6.56 → 6.20 MB,
  `demo-total` 14.22 → 13.86 MB, `public-largest` 513 → 330 KB. `public-largest`
  has now changed target twice in two passes — Garden.jpg, then hardwood.png, now
  `oak_wood.jpg` at 307 KB — and each time it named a different kind of problem
  that no tree total would have surfaced.

### Added

* **`npm run encode:textures` and `npm run repoint`**, with `:check` variants, on
  the same committed-output terms as the encoder and the resizer. The Basis
  transcoder is vendored to `public/basis/` beside `public/draco/`, and
  `resolver.transcoderPath()` derives its URL from the resolver base so
  `?assetBase=` relocates it too.

* **`vite.config.mjs`'s `dropBundledDraco()` is now `dropBundledCodecs()`** and
  covers `KTX2Loader`, which references its transcoder through the same
  `new URL(..., import.meta.url)` pattern. Without it the build would ship the
  580 KB transcoder twice and inline it into the IIFE; with it the loader costs
  15.4 KB gzipped. It still throws if a pattern matches nothing.

* **Three browser tests that actually load a compressed texture** — added
  because a deliberate break failed to fail. Removing `setKTX2Loader` from
  `Scene` left all 54 browser tests green, and the conclusion drawn from that,
  that KTX2 rendering was verified, was wrong. The Draco tests use
  `ik-kivine_baked.glb`, one of four models whose texture is missing from the
  source library, so they had never decoded an image at all. The new ones assert
  the container declares the extension, that the texture arrives as a
  `CompressedTexture` at 669×1024 with a mip chain, and that the frame changes
  when it lands.

## [2.1.0] - 2026-08-15

RM-004, the third review programme, and the shortest of the three because it had
the least to find. RM-002 closed seven architectural findings and RM-003 closed
eight; what was left over was three unrelated jobs with no theme underneath them
— a catalog shipped in the shape its exporter left it, a wall that forgot its
name whenever you undid something, and half an application nobody was
type-checking. A fourth was added on the way, when the first sprint's new budget
turned out to be measuring the wrong thing.

**Minor rather than major.** Every export behaves as it did, every saved design
opens unchanged, and every asset URL resolves to the path it always did. The two
narrower changes are in *Compatibility* below: what changed is the bytes inside
the asset files, not their names, and `public/` is not in `package.json`'s
`files` — so an npm consumer never receives them.

The user-visible half is delivery. The model catalog is Draco-compressed and the
five oversized textures are capped, which together take `public/` from 10.68 MB
to **5.95 MB** and GPU memory from a corrected 104.67 MB to **43.00 MB**. Four
budget ceilings came down as a result — `public-total` 11.70 → 6.56 MB,
`demo-total` 19.00 → 14.22, `public-largest` 1.45 MB → 513 KB,
`catalog-item-largest` 1.69 MB → 384 KB — which is the direction a ceiling almost
never travels. One went up, `lib-esm-gzip`, for the fourth consecutive sprint;
two are new, `decoder-total` and `texture-vram`. Every one of those moves is
argued for in `tools/budget.json` rather than quietly adjusted.

The half nobody sees is that the measurements got honest. Three separate numbers
this programme relied on were wrong when it started: the texture VRAM budget was
counting 174 images that are never uploaded, the manifest's `kind` was
mislabelling 148 assets, and the TypeScript ledger had drifted for the third
time. Each is corrected here, and each is now produced by something that can be
re-run rather than by something that was once typed in.

Verified at `f48ba72` from a clean detached worktree, `npm ci` from the lockfile,
before anything was dated: typecheck clean, lint 0 errors, manifest up to date at
373 assets, encoding up to date at 152 compressed and 13 deliberately not,
textures all inside the cap, **1,250 headless tests in 30 files and 54 browser
tests in 10**, ten budgets green, coverage 79.62 / 68.34 / 78.34 / 79.60.

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

* **Five oversized textures are now capped at 1024px, and GPU memory fell by
  59%.** Texture VRAM goes **104.67 MB → 43.00 MB** and the deployed tree loses
  1.50 MB alongside it. Nothing about the runtime changed: the filenames did not
  move, so every `.glb` that references these maps is untouched and every saved
  design resolves exactly as before.

  The defect was resolution, not compression. `Ground_4K.jpg` was 1822×1822
  built from a 73 KB source — 0.023 bytes per texel — and the skybox tiles it at
  `repeat.set(40, 40)`, so each tile lands on a few dozen screen pixels and mip
  0 was memory nothing ever read.

  **What it cost, measured in rendered frames rather than claimed.** A pixel
  oracle rendered each texture before and after and differenced the framebuffer,
  separating harness noise (0.00 everywhere), codec loss, and resolution.
  `Ground_4K` and `white_wood` are free at every size. `Garden` is free up to
  512px. The two dark wood grains carry a real 2.3–3.7 rms difference at
  realistic sizes with worst pixels 23–39/255 — small, and not nothing. The
  numbers are in `asset-pipeline/resize-oracle.json`.

* **The texture VRAM budget was measuring the wrong thing, and is corrected
  rather than moved.** It reported 164.41 MB over 202 images. 174 of those are
  `<img :src>` thumbnails the browser decodes lazily and never uploads, and the
  manifest's own `kind` was mislabelling 148 of them — so anything branching on
  kind was wrong about them too. The honest figure was 28 textures holding
  104.67 MB.

* **Five budget limits came down and none went up.** `texture-vram`,
  `public-total`, `demo-total`, `public-largest` and `catalog-item-largest`, each
  re-set to about 5% over the new measurement. Two are worth reading as findings:
  `public-largest` changed *which file* it points at, and `catalog-item-largest`
  more than halved without any model being touched, because Full Bed's remaining
  cost was never its geometry.

### Added

* **`npm run encode`** and `npm run encode:check`, the same
  committed-output, staleness-checked shape as `npm run manifest`. A checkout
  builds and serves with no encoder installed; the glTF-Transform and Draco
  packages are devDependencies and nothing at runtime imports them.

* **`npm run resize`** and `npm run resize:check`, the same shape again. The
  check needs no encoder and no image decoding at all — the cap is a property of
  the dimensions and staleness is a property of the hashes — so it runs in half a
  second. `tests/texture-resize.test.js` asserts the same claims from a bare
  checkout, and separately tests the resampler itself against synthetic images
  with hand-derived answers: a half-black, half-white split must resample to
  **188**, not 128, which is the entire gamma question reduced to one integer.

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

**KTX2/Basis, now declined on evidence rather than postponed for tooling.** The
encoder was built and run: 25 of 28 textures encode, 4.13 → 2.16 MB on disk, and
**78.50 MB of VRAM against the 61.67 MB the resize actually took**. Three things
decided against it, and the measurements are in the roadmap so it can be picked
up cold rather than re-derived:

* 19 of the 28 textures — 72.78 MB, 70% of the total — live inside `.glb` files,
  and `GLTFLoader` resolves their image URIs relative to the model, bypassing the
  resolver. KTX2 changes the file extension, so all 19 containers would need
  rewriting and the Draco-encoded output would go back through the pipeline.
* `KTX2Loader.load()` throws without `detectSupport(renderer)`, and the texture
  cache is deliberately page-wide and renderer-free. Wiring it puts back a
  coupling two earlier sprints went to some trouble to remove.
* It compresses upscaled pixels very efficiently, which is solving the wrong
  problem well.

The two compose. A later sprint can still encode the *resized* textures and take
the remaining ~32 MB, from a starting point 59% smaller than the one it faced
here.

**Two PNGs worth a look next.** With the largest JPEGs resized,
`rooms/textures/hardwood.png` is now the biggest file served at 476 KB — a
512×512 texture carrying **1.861 bytes per texel**, nine times the density of
any JPEG in the catalog. An earlier pass re-encoded 21 opaque PNGs as JPEG for
exactly this reason and this one survived it.

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
