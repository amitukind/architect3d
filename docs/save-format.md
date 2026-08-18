# The `.blueprint3d` save file

A design is one JSON document, produced by `model.exportSerialized()` and
consumed by `model.loadSerialized(json)`. It has exactly two top-level keys:

```json
{
  "floorplan": { },
  "items": [ ]
}
```

If you are writing a tool that reads or generates one of these, read
[reading an older file](#reading-an-older-file) — the format changed, and the
older one is still out there.

## `floorplan`

```json
{
  "version": "2.0.0",
  "units": "cm",
  "corners": { },
  "walls": [ ],
  "rooms": { },
  "wallTextures": [],
  "floorTextures": {},
  "newFloorTextures": { },
  "carbonSheet": { },
  "dimensions": [],
  "annotations": [],
  "north": 0
}
```

The last three are **optional** and are written only when there is something to
write — see [what the plan says about itself](#what-the-plan-says-about-itself).
A design nobody annotated produces exactly the file it produced before they
existed.

### `corners`

An object keyed by corner id — a UUID generated at creation, and the identifier
walls and rooms refer to.

```json
"3c885e88-8116-b473-0cf0-5e98c6568e62": {
  "x": 0,
  "y": 0,
  "elevation": 260
}
```

`x` and `y` place the corner on the floor plane. `elevation` is the height of
the wall top at this corner, which is what lets a wall slope.

All three are **centimetres**, as the file's `units` field declares — the same
unit as the wall control points and the item positions. In format 0.0.2a they
were not; see [reading an older file](#reading-an-older-file).

### `walls`

An array. Each wall names the two corners it spans:

```json
{
  "corner1": "3c885e88-…",
  "corner2": "0438a3a5-…",
  "frontTexture": {"url": "rooms/textures/marbletiles.jpg", "stretch": false, "scale": 300},
  "backTexture":  {"url": "rooms/textures/light_brick.jpg", "stretch": false, "scale": 300},
  "wallType": "STRAIGHT",
  "a": {"x": 176.77, "y": 176.77},
  "b": {"x": 323.22, "y": 176.77}
}
```

| Field | Meaning |
|---|---|
| `corner1`, `corner2` | Corner ids. A wall with a missing endpoint is skipped on save. |
| `frontTexture`, `backTexture` | `{url, stretch, scale}`. When `stretch` is true the map is fitted to the wall and `scale` is ignored — which is why stretched entries are often saved with `scale: 0`. |
| `wallType` | `"STRAIGHT"` or `"CURVED"`. |
| `a`, `b` | Bezier control points. Only meaningful when `wallType` is `"CURVED"`, but always written. |
| `thickness` | Centimetres. **Optional**, and written only for a wall somebody gave a thickness of its own. |
| `partialHeight` | Centimetres. **Optional**, and written only for a half wall — one whose faces stop below its corners (RM-008 F2). Absent means the wall reaches its corners, which is every wall in every older file. |

`a` and `b` are centimetres, like everything else in a 2.0.0 file. They always
were, which in 0.0.2a made them disagree with the corners.

::: tip `thickness` is written only when it was chosen
Added in RM-008 E2, and absent from every file written before it. A wall with no
`thickness` follows the document's wall thickness — the value in Settings —
which is what it has always done and what lets one setting still reach a whole
design.

That is why the field is conditional rather than always written. Every other key
in a wall record appears unconditionally, and a `thickness` written for every
wall would freeze today's default into every file: a design saved now would stop
following a setting changed later, and a file written before E2 would not
survive a re-save unchanged. A reader can treat its absence as "ask the
document".

A positive finite number is required when the key is present. Zero or negative
collapses both half edges onto the wall centreline and takes every room derived
from them with it, so `DesignDocument.parse` rejects the file rather than
opening a design that looks empty.
:::

**A wall has no `id` field, and will not get one.** In memory it has an
identity, and since RM-004 B2 that identity survives a load — but it is
*reconstructed* from `corner1` and `corner2` rather than stored, so nothing was
added to the format and a file written before B2 loads with exactly the ids a
file written after it would.

The rule, if you are writing a reader of your own: sort the two corner ids, and
append `#n` for the second and subsequent walls that span the same pair, counting
in file order.

```
wall:0438a3a5-…~3c885e88-…        the usual case
wall:0438a3a5-…~3c885e88-…#1      a second wall between the same two corners
```

Sorting is what makes a wall recorded as `b → a` the same wall as one recorded
`a → b`; the suffix is what keeps two walls spanning one pair from sharing an
identity, which nothing in the format forbids and which
`Floorplan.newWall` does not guard against.

This follows the same reasoning as room identity in RM-003 A3, and for the same
reason: a file identifies a wall by its corners, and that is a description any
build can read. An id assigned by one build and written down would mean nothing
to another, and an id that died with the wall could not be brought back by
drawing it again.

### `rooms`

Rooms are derived from the wall graph, not stored, so this holds only the
things a user typed. The key is the room's corner ids joined with commas:

```json
{
  "3c885e88-…,0438a3a5-…,dc6353ae-…,213bb50e-…": {"name": "Living Room", "type": "Living"}
}
```

| Field | Meaning |
|---|---|
| `name` | What the room is called. Always written for a room that has an entry. |
| `type` | What the room is *for* — "Bedroom", "Kitchen". **Optional**, written only when somebody typed one, and removed again if it is cleared. |

There is deliberately no ceiling height here. A room's ceiling is the elevation
of its corners — that is where a wall's drawn top comes from — so storing a
second number beside them could disagree with the geometry. Setting a ceiling
height in the room panel writes `elevation` on every corner of the room, which
means every file ever written by this project already carries its ceiling
heights.

The key is a description of the room rather than a name for it, which is
deliberate: another build reading this file can find the room without needing
to have been told an identity. What it cannot do on its own is survive an edit —
move a wall so the loop changes shape and the key no longer matches.

::: tip The name follows the room now
Since RM-003 A3 the key is rewritten when the room changes shape. Each
re-derived room is matched to the room it continues by corner overlap, and the
entry moves with it, so drawing a wall through one side of a room keeps its
name and its floor texture. See `src/scripts/model/room_matcher.js` for the
rule.

The file is unaffected: this is still the only key, and it is still derived
from the corners. A file written before A3 and a file written after are
byte-identical for the same design.
:::

### `newFloorTextures`

Floor textures, keyed by the room's corner ids **sorted** and comma-joined —
which is not quite the `rooms` key above, where they are in traversal order.
Two spellings of the same relation; they are kept in step by the same matcher
that rewrites them.

```json
{
  "0438a3a5-…,213bb50e-…,3c885e88-…,dc6353ae-…": {
    "url": "rooms/textures/light_fine_wood.jpg",
    "scale": 300
  }
}
```

::: warning `wallTextures` and `floorTextures` are dead
Both are written on every save — `[]` and `{}` — and neither is ever read.
They are the pre-`newFloorTextures` fields, kept so old readers do not
choke. Write them; ignore them.
:::

### What the plan says about itself

Everything above describes the building. These three describe the *drawing*, and
they are the only entities in the file that were authored rather than derived —
added in RM-008 E3.

All three are optional and are omitted entirely when empty, which is what keeps
a file written before E3 byte-identical after a re-save. An older reader ignores
them; this build ignores nothing else it does not recognise either.

#### `dimensions`

An array. Each entry measures between two points:

```json
{
  "id": "9f2c1a44-…",
  "a": {"x": 0, "y": 0},
  "b": {"x": 400, "y": 0},
  "offset": 40,
  "aCorner": "3c885e88-…"
}
```

| Field | Meaning |
|---|---|
| `id` | Stable identity, **persisted** — unlike a room's, which is derived from its corners. A dimension has no description to be found again by, so the id in the file *is* the identity. |
| `a`, `b` | The two points, in centimetres. |
| `offset` | Signed centimetres from the measured line to the drawn one. Negative puts it on the other side. |
| `aCorner`, `bCorner` | **Optional** corner ids. When present and the corner still exists, that end follows it; when the corner is deleted the stored point is used instead. |

#### `annotations`

An array of free text placed on the plan:

```json
{"id": "1b7e0c92-…", "x": 220, "y": 340, "text": "Service duct", "size": 18}
```

| Field | Meaning |
|---|---|
| `id` | Persisted, for the same reason a dimension's is. |
| `x`, `y` | Centimetres. |
| `text` | What it says. May be empty — that is a label somebody is still typing. |
| `size` | Font size in **CSS pixels**, not centimetres, so a label stays legible at every zoom. **Optional**, written only when it is not the default 14. |

#### `north`

A number: degrees clockwise from up. Absent means 0, which is north up, so a
plan nobody oriented carries nothing. A value outside 0–360 loads and is
normalised rather than refused — it is the same bearing written differently.

### `carbonSheet`

The tracing underlay, present only if the design has one:

```json
{
  "url": "rooms/textures/plan.png",
  "transparency": 0.5,
  "x": 10, "y": 20,
  "anchorX": 5, "anchorY": 6,
  "width": 800, "height": 600
}
```

In widget mode there is no 2D view and therefore no carbon sheet; a file
carrying one loads fine, the block is simply skipped.

## `items`

An array, one entry per placed object:

```json
{
  "id": "b3f0e59c-…",
  "item_name": "Open Door",
  "item_type": 7,
  "format": "gltf",
  "model_url": "models/js-glb/open_door.glb",
  "xpos": 45.6, "ypos": 110.5, "zpos": -265.18,
  "rotation": 0,
  "scale_x": 1.17, "scale_y": 0.99, "scale_z": 0.99,
  "fixed": true,
  "material_colors": ["#8d8d8d"]
}
```

| Field | Meaning |
|---|---|
| `id` | This item's identity. Added in RM-003 A3; absent in older files and assigned on load. |
| `item_type` | Which class builds it. See the table below. |
| `format` | `"gltf"`, or absent on a pre-migration file. |
| `model_url` | Relative URL. Rewritten on load if it names one of the 25 converted legacy models. |
| `xpos`/`ypos`/`zpos` | Position in centimetres, like everything else. |
| `rotation` | Y rotation in radians. X and Z are not stored. |
| `fixed` | Locked in place. |
| `material_colors` | Sparse: a `#rrggbb` for each material slot somebody recoloured, `null` for the rest. Absent when nothing was recoloured. |

::: tip `id`, and why items are the only thing that carries one
Corners have always had one. Walls, rooms and half edges have one too since
RM-003 A3, and none of them is written here — a file describes a wall by its
two corners and a room by its corners, which is a description any build can
read, and the id is reassigned on load.

An item is different because it has nothing to be described by. Two identical
chairs at the same coordinates are two chairs. The id is what lets undo
recognise the furniture already on screen instead of re-downloading every model
in the design, so it has to be in the file for a snapshot to name the same
item.

Additive and optional. An older file has no `id` on any item, each is assigned
one on load, and they appear from the next save.
:::

**Items are written in `id` order**, not in the order they were placed or
loaded. Item order carries no meaning, and the order they arrive in depends on
which model file finished downloading first — so two saves of a design nobody
touched could otherwise differ.

### `opening` — a door that is numbers

Present only on a **parametric opening**, item type 10, added by RM-008 F1 and
absent from every file written before it. An item that carries one names no
`model_url`, because there is no model: its mesh is generated.

```json
{
  "kind": "door",
  "width": 90,
  "height": 210,
  "sill": 0,
  "hinge": "left",
  "swing": 90,
  "style": "plain"
}
```

| Field | Meaning |
|---|---|
| `kind` | `"door"`, `"window"` or `"arch"`. Anything else is read as a door. |
| `width`, `height` | Centimetres. The rectangle cut in the wall is exactly these. |
| `sill` | Height of the opening's **bottom** above the floor, in centimetres. A door's is 0. The *centre* — which is what the item's `ypos` holds — is derived from the sill and the height and is never stored twice. |
| `hinge` | `"left"` or `"right"`. |
| `swing` | Degrees the leaf stands open, 0–180. Ignored for a window and an archway. |
| `style` | A name the generator understands. `"plain"` today. |

::: tip Why this exists
Before F1 a door's size was a **scale factor on a mesh**: "900 mm wide" was
recorded as "0.927 times whatever `closed-door28x80_baked.glb` happens to be",
a window's height above the floor was never stated at all, and `rotation` is a
single y angle — so a hinge side had nowhere to live. RM-009 U-4 has the
measurement. Every field above is read back exactly and the wall's hole is cut
from these numbers, not from the mesh's bounding box.

An opening taller than its wall is **trimmed to fit**. Without that, an
oversized hole is merged into the wall's outline rather than cut out of it, and
the wall grows to swallow it — RM-009 U-2 measured a 400 × 250 wall becoming
387 cm tall.
:::

### Item types

| `item_type` | Class | Behaviour |
|---|---|---|
| 0 | `Item` | Free — drags on the camera ray |
| 1 | `FloorItem` | Sits on the floor, drags in plane |
| 2 | `WallItem` | Slides along a wall |
| 3 | `InWallItem` | Cuts a hole in the wall (a window) |
| 4 | `RoofItem` | Snaps to the roof plane |
| 7 | `InWallFloorItem` | Cuts a hole and stays on the floor (a door) |
| 8 | `OnFloorItem` | Renders under other items (a rug) |
| 9 | `WallFloorItem` | Wall-bound and floor-bound |
| 10 | `ParametricOpening` | A door, window or archway generated from its numbers (RM-008 F1). Names no model; carries `opening` |

The numbering is not contiguous — there is no type 5 or 6, and 7/8/9 are not
the order you would guess. It is the registry in
`src/scripts/items/factory.js`, and it is what every saved file already
contains, so it is not renumberable. Types 2, 3, 7 and 9 are the wall-bound
ones: the catalog needs a wall to place them against.

### `material_colors` holds choices, not appearance

The array is positional and sparse. `[null, "#abcdef", null]` means "slot 1 was
recoloured to `#abcdef`; slots 0 and 2 keep whatever the model ships with". The
key is omitted entirely when nothing was recoloured, which is the common case.

That distinction is the point. Format 0.0.2a wrote every material's colour on
every save, which froze the model's own appearance into the file — so updating
a model never changed any design that already used it, and a design saved
before colour management reloads too dark. See
[reading an older file](#reading-an-older-file).

::: tip `resizable`
Read on load and handed to the item, but `getMetaData()` never writes it back,
so it survives one load and is lost on the next save. Costs nothing today —
nothing reads it after construction.
:::

## Reading an older file

Every file written before this format says `"version": "0.0.2a"` and has no
`units` field. They still load, and they still mean what they meant. What
follows is what changed and why the change could not be applied retroactively.

The loader decides by looking at the file rather than at its version number.
An absent `units` field means the old reading; absent `a`/`b` on a wall means
no control points to read. That is deliberate — see
[the version field](#the-version-field-was-a-trap) below for what happened the
last time this was decided by a version comparison.

### Coordinates were in the user's display unit

0.0.2a wrote corner coordinates through `Dimensioning.cmToMeasureRaw()` and
read them back through `cmFromMeasureRaw()`, both of which consult the current
global display unit. Wall control points and every item position went out raw.

So one file mixed two units and recorded neither. The same plan saved under
metres and under centimetres produced two files whose corner numbers differed
by 100×:

```json
// 500 x 400 cm, saved while the display unit was metres
{"x": 0, "y": 0, "elevation": 2.6}
{"x": 5, "y": 0, "elevation": 2.5}
{"x": 5, "y": 4, "elevation": 2.5}
```

Load that under centimetres and the whole plan is 5 cm across — which is inside
`cornerTolerance`, so every corner merges into the first and the design
collapses to a single point with four degenerate walls.

A file with no `units` field is still read this way, because it is the rule the
file was written under and the information needed to do better is not in it.
**Open an old file under the unit it was written in, save it, and it is
upgraded** — there is no separate migration step. Rounding disappears with the
conversion too: 0.0.2a quantised to 1/1000 of the display unit, which meant
whole millimetres for anyone working in metres, and the inch constants were not
exact inverses, so a save/load cycle in inches walked the geometry by 0.001 cm
each time.

`tests/fixtures/v1/` holds the frozen corpus, `metres-room.blueprint3d`
included.

### `material_colors` held every colour

0.0.2a wrote a hex string for every material on every save. Two consequences:

1. The model's own appearance was frozen into every design that used it.
2. For a glTF model the value came from `baseColorFactor` — a raw **linear**
   float, quantised straight to bytes under the pre-colour-management pipeline.
   The managed pipeline reads those bytes as sRGB, so furniture in a design
   saved before that change reloads darker than it was authored.

Those values are **not** re-interpreted on load, deliberately. Nothing in a
0.0.2a file says whether a given colour is the model's or the user's — they
were written identically — so converting them wholesale would correct the first
and corrupt the second. The version stamp tells you the file is old; it does
not tell you what is in it.

So old colours are applied exactly as written and written straight back, and
opening and saving an old design cannot discard a colour somebody chose. What
changed is that the ambiguity is no longer *created*. If pre-colour-management
furniture loads too dark, re-pick the colour once and the file will then say
exactly what you meant.

### The version field was a trap

`version` read `"0.0.2a"` for the entire life of the project before 2.0.0, and
that was not merely inert. `loadFloorplan()` used to gate the curved-wall
control points on it:

```js
if (Version.isVersionHigherThan(floorplan.version, '0.0.2a'))
{
    newWall.a = wall.a;
    newWall.b = wall.b;
    newWall.wallType = (wall.wallType == 'CURVED') ? CURVED : STRAIGHT;
}
```

`isVersionHigherThan` did not do what its name said. It returned true when the
**second** argument was greater than or equal to the first, per component, as
an AND. So the gate accepted `0.0.2a` and anything older and rejected
everything newer:

| File's `version` | Curve data |
|---|---|
| `"0.0.1"`, `"0.0.2a"` | read |
| `"0.0.3"`, `"0.1.0"`, `"1.0.0"`, `"1.0"` | **silently dropped** |

Stamping a file with any newer version turned every curved wall straight and
threw its control points away, with no error — which is why the format could
not be versioned at all, and why three separate pieces of work had to wait for
this one.

Both halves are fixed. The gate reads `wall.a && wall.b`, so it is a question
about the file rather than about a comparison; and `Version` now offers
`compare()`, a strict boolean `isVersionHigherThan()`, and `isVersionAtLeast()`
for the `>=` question — a separate function rather than an inverted call,
because writing `!isVersionHigherThan(check, version)` is precisely how the
original went wrong.

## Validation

A document is checked in full **before any of it is applied**, so opening a file
either replaces the design completely or leaves it exactly as it was. There is
no half-loaded state.

```js
const result = model.loadDocument(json);
// { ok, document, errors: [{path, message}], warnings: [{path, message}] }
if (!result.ok) {
  console.log(result.errors[0].path);      // 'floorplan.walls[0].corner2'
  console.log(result.errors[0].message);   // 'names corner "ghost", which is not in this file'
}
```

`loadSerialized(json)` is the same operation and still **throws** on a bad
document — the message names the field. Neither `EVENT_LOADING` nor
`EVENT_LOADED` fires for a document that fails validation.

What is checked, and nothing beyond it:

| | |
|---|---|
| The document | valid JSON, an object, with a `floorplan` object and an `items` array |
| `corners` | an object; every `x` and `y` a finite number; `elevation` finite when present |
| `walls` | an array of objects; **every `corner1` and `corner2` must name a corner the file carries** |
| `rooms` | an object, when present |
| `items` | an array of objects, each with a `model_url`; positions finite when present |

The reference check is the one that matters most in practice. A wall naming a
corner that is not in the file used to reach `new Wall(undefined, undefined)`
and take the load down halfway through, after the previous design was gone.

::: tip Deliberately lenient
The validator must not be stricter than the files people already have. A
pre-2.0.0 document has no `units` stamp, no `elevation` on its corners and no
control points on its walls, and all three stay optional. An unrecognised
`units` value is a **warning**, not a refusal — see below.
:::

## Writing a file by hand

Stamp `"version": "2.0.0"` and `"units": "cm"`, put every coordinate in
centimetres, and omit `material_colors` unless you mean to override a model's
own colour. An unrecognised `units` value is read as centimetres with a console
warning rather than rejected — a design that opens at the wrong scale is a
better outcome than one that will not open, because the user can see the
former. That warning is also on the result, as `warnings[]`, so an application
can say so rather than leaving it in the console.

## Where the working draft is kept

A `.blueprint3d` file is what a user saves deliberately. Separately from that,
the application keeps the **working design** in browser storage so an accidental
reload does not lose twenty minutes of drawing. Same format, different lifetime:
one slot, overwritten, offered back after a reload rather than restored.

Since RM-003 A5 that slot is **IndexedDB**, not `localStorage`.

| | Before A5 | Now |
|---|---|---|
| Store | `localStorage`, key `architect3d.autosave` | IndexedDB, database `architect3d`, store `drafts` |
| Write | **synchronous, on the main thread** | asynchronous |
| Ceiling | ~5 MiB per origin, shared with everything else | a share of disk |
| Over the ceiling | autosave **disabled for the session**, permanently | prune the old record, retry, then report |

The old cap was not theoretical. A furnished design can exceed 5 MiB, and the
first `QuotaExceededError` turned autosave off for the rest of the session — so
the larger the design, the sooner it stopped being protected.

### The recovery pointer

One thing is still written synchronously, and it is deliberate. `pagehide` is
the last moment a page reliably gets and **it cannot await a promise**, so an
IndexedDB write started there may not finish.

The fix is not to write the document synchronously — that would give back
everything above. Instead a **pointer** goes into `localStorage` first, under
`architect3d.draft-pointer`, recording the timestamp the body write is *about
to* carry:

```json
{"savedAt": 1755212400000, "bytes": 1048576, "store": "indexeddb"}
```

Three numbers and a string, well under a kilobyte, and always completes. On the
next load the two are compared:

| Pointer vs. body | What it means |
|---|---|
| no pointer, body present | a clean session; the last write landed |
| timestamps agree | the last write landed |
| **pointer newer than body** | the final write did not land — the draft is still restorable, and is older than the user thinks |
| pointer, no body | the store was cleared underneath, or the first write never landed |

Only the third row is new information, and it is the reason the pointer exists:
a prompt that says "recovered" about a draft several minutes behind what was on
screen is a prompt that loses work quietly. The application says how much
instead.

### If IndexedDB is not there

Private-browsing modes and some embedded webviews do not offer it. The
`localStorage` implementation stays in the tree as the fallback, selected
automatically, and behaves exactly as the pre-A5 build did — including the 5 MiB
cap. A draft written by an older build is read from the old key once, copied
across, and removed, so the two stores never both hold one.

A store written by a **newer** build is left untouched and reported, never
migrated on the guess that its shape is close enough.

## Asset URLs are logical names

Every asset path in this file — `model_url` on an item, `url` on a wall or
floor texture — is a **bare relative string**, and that has always been a
compatibility contract: those strings are in documents on other people's disks,
so renaming a file breaks designs that already exist. Vite copies `public/`
as-is and never hashes it, so the usual answer of content-addressed filenames is
unavailable here.

Since A5 the string in the file is a *logical name*, and an `AssetResolver`
decides what is actually fetched:

```js
import {AssetManifest, AssetResolver, BlueprintJS} from 'architect3d';

const {manifest} = AssetManifest.parse(await (await fetch('asset-manifest.json')).json());
const blueprint = new BlueprintJS({
    ...options,
    assets: new AssetResolver({manifest, base: 'https://cdn.example.com/a3d'}),
});
```

**Nothing in the file changes.** A design saved against one deployment opens
against another, a model can be versioned by giving its manifest entry a
different `url`, and a CDN becomes a deployment choice rather than a rewrite.
Omit `assets` and every logical name resolves to itself, which is what the
library did before A5 and what it still does by default.
