# The v1 save-format corpus

**Frozen. Never regenerate these.**

`tools/make-fixtures.mjs` cannot reproduce them: it writes through
`Floorplan.saveFloorplan()`, and that now emits format 2.0.0. These four files
are what the writer produced *before* that change, and being unreproducible is
exactly what makes them a valid legacy corpus. `tests/save-format-v1.test.js`
is the test that reads them.

| File | What it is |
|---|---|
| `simple-room.blueprint3d` | The v1 copy of the top-level fixture, saved in **centimetres** |
| `rich-design.blueprint3d` | Ditto — two rooms, textures, elevations, carbon sheet |
| `curved-walls.blueprint3d` | Ditto — two curved walls, so the control-point path is covered |
| `metres-room.blueprint3d` | A 500×400 cm room saved with the display unit set to **metres** |

The first three are byte-identical copies of the top-level fixtures as they
stood at the commit before the v2 change, so a v1→v2 comparison is a diff of
those two directories.

## Why `metres-room` exists

It is the unit landmine, in one file. The room is 500×400 centimetres, and
because v1 wrote corner coordinates through `Dimensioning.cmToMeasureRaw()` —
which converts to whatever display unit happened to be active — the file says:

```json
{"x": 0, "y": 0, "elevation": 2.6}
{"x": 5, "y": 0, "elevation": 2.5}
{"x": 5, "y": 4, "elevation": 2.5}
{"x": 0, "y": 4, "elevation": 2.5}
```

Nothing in the file records that those are metres. Load it with the display
unit set to centimetres and you get a room five centimetres wide. That is why
format 2.0.0 stores canonical centimetres and stamps `"units": "cm"`, and this
file is what proves the legacy reading path still handles the old files
correctly — under the unit they were written in, and wrongly under any other,
which is the behaviour that cannot be fixed retroactively because the
information is not in the file.

Generated once, with the v1 writer, seeded for determinism. There is no
genuine metres-saved file in the wild to use instead; `legacy-items.blueprint3d`
at the level above is a real pre-migration save, but it was written in
centimetres.
