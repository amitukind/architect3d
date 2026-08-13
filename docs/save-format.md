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
  "carbonSheet": { }
}
```

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

`a` and `b` are centimetres, like everything else in a 2.0.0 file. They always
were, which in 0.0.2a made them disagree with the corners.

### `rooms`

Rooms are derived from the wall graph, not stored, so this holds only the
things a user typed. The key is the room's corner ids joined with commas:

```json
{
  "3c885e88-…,0438a3a5-…,dc6353ae-…,213bb50e-…": {"name": "Living Room"}
}
```

Move a wall so the loop changes shape and the key no longer matches — the room
survives, but its name does not follow it.

### `newFloorTextures`

Floor textures, keyed the same way, by comma-joined corner ids:

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
| `item_type` | Which class builds it. See the table below. |
| `format` | `"gltf"`, or absent on a pre-migration file. |
| `model_url` | Relative URL. Rewritten on load if it names one of the 25 converted legacy models. |
| `xpos`/`ypos`/`zpos` | Position in centimetres, like everything else. |
| `rotation` | Y rotation in radians. X and Z are not stored. |
| `fixed` | Locked in place. |
| `material_colors` | Sparse: a `#rrggbb` for each material slot somebody recoloured, `null` for the rest. Absent when nothing was recoloured. |

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

## Writing a file by hand

Stamp `"version": "2.0.0"` and `"units": "cm"`, put every coordinate in
centimetres, and omit `material_colors` unless you mean to override a model's
own colour. An unrecognised `units` value is read as centimetres with a console
warning rather than rejected — a design that opens at the wrong scale is a
better outcome than one that will not open, because the user can see the
former.
