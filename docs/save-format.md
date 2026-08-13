# The `.blueprint3d` save file

A design is one JSON document, produced by `model.exportSerialized()` and
consumed by `model.loadSerialized(json)`. It has exactly two top-level keys:

```json
{
  "floorplan": { },
  "items": [ ]
}
```

Read [the two landmines](#the-two-landmines) before you write a tool that
generates one of these.

## `floorplan`

```json
{
  "version": "0.0.2a",
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

**These three numbers are in the user's display unit, not centimetres.** See
[the two landmines](#the-two-landmines).

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

Unlike corners, `a` and `b` are **centimetres** — they are copied straight
across on both save and load with no unit conversion in either direction.

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
| `xpos`/`ypos`/`zpos` | Position in **centimetres** — unlike corners, these are not unit-converted. |
| `rotation` | Y rotation in radians. X and Z are not stored. |
| `fixed` | Locked in place. |
| `material_colors` | One `#rrggbb` per material, in material-group order. |

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

Two fields are worth knowing about because they are asymmetric:

- **`resizable`** is read on load and handed to the item, but `getMetaData()`
  never writes it. It survives one load and is lost on the next save — which
  costs nothing today, because nothing reads it after construction.
- **`material_colors`** is written on *every* save whether the user picked a
  colour or not. For a glTF model the value came from `baseColorFactor`. See
  below.

## The two landmines

### 1. Coordinates are in the user's display unit

`Floorplan.saveFloorplan()` writes corner coordinates through
`Dimensioning.cmToMeasureRaw()`, and `loadFloorplan()` reads them back through
`cmFromMeasureRaw()`. Both consult the **current global display unit**.

So the same design saved with the unit set to metres and to centimetres
produces two files whose numbers differ by 100×, with nothing in the file
recording which. Load a metres file while the app is in centimetres and the
plan comes back a hundred times too small.

In practice this holds together because the unit is a user setting that rarely
changes mid-session, and `BlueprintJS`'s constructor sets metres. But a tool
that generates files must know which unit the reader will be in.

What is *not* affected, because it is written raw: wall control points `a`/`b`,
and every item position and scale. A single file therefore mixes units.

::: tip For the backlog
A v2 schema storing canonical centimetres with an explicit unit stamp is the
fix. It is on the post-migration backlog rather than done here, because it
needs the version field to work first — see below.
:::

### 2. The version field cannot be bumped

`version` has read `"0.0.2a"` since the field was introduced.
`Version.getTechnicalVersion()` is a hard-coded string and nothing has ever
changed it.

That is not merely inert. `loadFloorplan()` gates the curved-wall control
points on it:

```js
if (Version.isVersionHigherThan(floorplan.version, '0.0.2a'))
{
    newWall.a = wall.a;
    newWall.b = wall.b;
    newWall.wallType = (wall.wallType == 'CURVED') ? CURVED : STRAIGHT;
}
```

and `isVersionHigherThan` does not do what its name says. It returns true when
the **second** argument is greater than or equal to the first, per component,
as an AND across components. Substituting the real values:

| File's `version` | Curve data |
|---|---|
| absent | **dropped** |
| `"0.0.1"` | read |
| `"0.0.2a"` | read |
| `"0.0.3"` | **dropped** |
| `"0.1.0"` | **dropped** |
| `"1.0.0"` | **dropped** |
| `"1.0"` | **dropped** (component count differs) |

Stamping a file with any version above `0.0.2a` silently turns every curved
wall straight and discards its control points.

The behaviour is deliberate as it stands: S0 characterized it and
`tests/dimensioning.test.js` pins it under `PRESERVED QUIRK`, because room
detection and the curved-wall path were frozen for the duration of the
migration. Anyone introducing a v2 format has to fix the comparator *first*,
and the tests that pin it are the checklist for doing so.

## The pre-S8 colour question

Sprint S8 turned three's colour management on, which changed what a hex string
in `material_colors` means: it is now unambiguously an sRGB value, decoded by
`Color` on the way in.

Designs saved *before* S8 store something else. `getMetaData()` writes every
material's colour on every save, and for a glTF model that colour came from
`baseColorFactor` — a raw **linear** float, which the frozen pipeline quantised
straight to bytes. Those files reload darker than they were authored.

They are not migrated, deliberately, for two reasons that compound:

1. There is no way to tell which files need it. The version field is a
   constant, and per the section above it cannot be bumped without breaking
   curved walls.
2. Even given a marker, the file cannot distinguish a colour the model author
   baked in from one the user picked. A blanket re-read would correct the first
   and corrupt the second.

The exposure is smaller than it sounds: the pre-Vue demo's item inspector never
bound its item, so no user could pick a material colour before the migration
began. The reasoning is written up in `src/scripts/items/item.js` for whoever
takes it on.
