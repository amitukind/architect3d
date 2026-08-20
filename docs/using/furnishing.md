# Furnishing a room

Press <kbd>A</kbd> to open the furniture catalog. It stays open while you work,
because you will nearly always want more than one thing.

## Finding something

The catalog holds 217 items from four kits, filed by room — kitchen, bathroom,
bedroom, living, dining, office, outdoor and structural — and tagged, so
searching for `chair` finds chairs by name and things tagged as one.

Two shortlists sit beside the rooms:

- **Favourites.** The star on any tile keeps it here. Useful when a project uses
  the same six things in every room.
- **Recent.** What you last placed, in the order you placed it.

Every item shows its real size, and the **Credits** button at the bottom names
the kit each one came from and the licence it is under.

## Placing it

Click a tile and the item lands where you last clicked in the 3D view — on the
floor, or on the wall for something wall-mounted like a window or a picture. If
you have not clicked anything yet, it lands in the middle of the plan.

Some items only make sense on a wall. If nothing is selected, the catalog says
so on the tile rather than putting a door in mid-air.

Once something is placed:

| | |
| --- | --- |
| Move it | Drag it, in either view |
| Turn it | Drag the handle at its base in 3D |
| Resize it | Drag a corner handle, or type a size in the panel on the right |
| Copy it | <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>D</kbd> |
| Copy and paste | <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>C</kbd>, then <kbd>V</kbd> |
| Mirror it | <kbd>M</kbd> left to right, <kbd>Shift</kbd> + <kbd>M</kbd> front to back |
| Remove it | <kbd>Delete</kbd> |

Select several at once and align, distribute or delete them together.

## Doors, windows and openings

A door or a window is a hole in a wall rather than a model sitting in front of
one. Select the wall you want it in first, then pick it from the catalog; the
opening is cut where you put it and moves when the wall does.

Its width, height, sill and hinge side are all in the panel on the right.

## Materials

Select a wall, a floor or a ceiling and pick a material for it. There are
around thirty, each with its own colour and roughness, and a wall's two faces
are set separately — so a papered feature wall is one change, not two rooms.

## Lighting and how it looks

The 3D view has two looks: a plain one that draws quickly, and a studio one with
softer light and shadows. Some catalog items are lamps and light the room around
them.

Press <kbd>F</kbd> to walk through the design at eye height, <kbd>E</kbd> to
step outside and look at it, and <kbd>Esc</kbd> to come back.

## Bringing your own model

If the catalog does not have what you need, open **Your own models** at the
bottom of the catalog and choose a `.glb`, `.gltf` or `.obj` from your computer.

You will be asked two things, because a model file does not say either of them:

- **What one unit means.** Most models are authored in metres; some are not. The
  dialog shows how big the model will be for each answer, so you can pick the
  one that is right. If none of them is, type the length of its longest side
  instead.
- **Which way is up.** Blender, 3ds Max and most CAD software write models with
  Z pointing up, and this planner uses Y. If your model arrives lying on its
  face, this is why — switch it and it stands up.

An imported model is stored in this browser and can be placed as often as you
like. It **travels in a `.zip` bundle but not in a link**, because a link
carries the design and a model is far too big to fit in one. If somebody opens
your design without the model, they get everything else and a message naming
what is missing.
