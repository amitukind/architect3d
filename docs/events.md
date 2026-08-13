# Events

Every observable object in the library extends three's `EventDispatcher`, and
the event names are exported constants — import them, never spell the string
yourself. Several of the strings differ from the constant name in ways you
would not guess (`EVENT_CORNER_2D_CLICKED` is `'CORNER_CLICKED_2D_EVENT'`, not
`'CORNER_2D_CLICKED'`).

```js
import {EVENT_LOADED, EVENT_ITEM_SELECTED} from 'architect3d';

blueprint.model.addEventListener(EVENT_LOADED, (evt) => { … });
blueprint.three.addEventListener(EVENT_ITEM_SELECTED, (evt) => { … });
```

::: warning Removing a listener needs the same function
`EventDispatcher` deduplicates and removes by identity. Keep a reference to the
handler you passed in — an arrow function written inline at
`removeEventListener` will never match, and the listener stays attached for the
life of the object. This is the single most common leak in this codebase's
history; `useBlueprint.js` shows the pattern that avoids it.
:::

## Model lifecycle

Dispatched on `blueprint.model`.

| Event | When | Payload |
|---|---|---|
| `EVENT_LOADING` | `loadSerialized()` starts | `{item: model}` |
| `EVENT_LOADED` | The design is in, items requested | `{item: model}` |
| `EVENT_GLTF_READY` | `exportForBlender()` finished | `{item, gltf}` — the glTF JSON as a string |

`EVENT_LOADED` fires when the *floorplan* is built and item loads have been
started, not when the models have arrived. Wait on the item events for that.

## Floorplan

Dispatched on `blueprint.model.floorplan`.

| Event | When |
|---|---|
| `EVENT_NEW` | A new floorplan replaced the old one |
| `EVENT_LOADED` | A floorplan finished loading |
| `EVENT_UPDATED` | The wall graph changed and rooms were re-derived |
| `EVENT_DELETED` | A corner or wall was removed |

`EVENT_UPDATED` is the one to listen to if you care about rooms. Rooms are
derived, not stored, so this is the only moment the room list is known to be
current.

## Corners, walls and rooms

Dispatched on the individual `Corner`, `Wall` or `Room`.

| Event | Source | When |
|---|---|---|
| `EVENT_MOVED` | `Corner`, `Wall` | Position changed |
| `EVENT_ACTION` | `Corner`, `Wall` | A generic action fired |
| `EVENT_DELETED` | `Corner`, `Wall` | Removed from the plan |
| `EVENT_REDRAW` | `Wall`, `HalfEdge` | The 3D view should rebuild this piece |
| `EVENT_CHANGED` | `Room` | The room changed |
| `EVENT_CORNER_ATTRIBUTES_CHANGED` | `Corner` | x, y or elevation set through a setter |
| `EVENT_ROOM_ATTRIBUTES_CHANGED` | `Room` | Name or area changed — carries `info: {from, to}` |

::: warning `Corner.move()` does not fire the attributes event
`move()` writes the private fields directly and dispatches `EVENT_MOVED` only.
The `x`, `y` and `elevation` setters dispatch
`EVENT_CORNER_ATTRIBUTES_CHANGED`. A panel that wants to stay in sync with a
corner has to listen to **both** — dragging in the 2D view goes through
`move()`, and typing in the inspector goes through the setters. See
`src/app/inspector/CornerInspector.vue`.
:::

## Items

Dispatched on `blueprint.model.scene`.

| Event | When | Payload |
|---|---|---|
| `EVENT_ITEM_LOADING` | A model file was requested | `{item: scene}` |
| `EVENT_ITEM_LOADED` | The model arrived and is in the scene | `{item}` |
| `EVENT_ITEM_REMOVED` | An item was deleted | `{item}` |

Selection is dispatched on `blueprint.three`, not on the scene:

| Event | When |
|---|---|
| `EVENT_ITEM_SELECTED` | An item was picked in the 3D view |
| `EVENT_ITEM_UNSELECTED` | The selection was cleared |

## The 3D view

Dispatched on `blueprint.three`.

| Event | When |
|---|---|
| `EVENT_CAMERA_MOVED` | The orbit camera moved (fires per frame while dragging) |
| `EVENT_CAMERA_ACTIVE_STATUS` | The camera became active or idle |
| `EVENT_CAMERA_VIEW_CHANGE` | A view preset was applied |
| `EVENT_FPS_EXIT` | Walk-through mode released the pointer lock |
| `EVENT_WALL_CLICKED` | A wall face was clicked |
| `EVENT_FLOOR_CLICKED` | A floor was clicked |
| `EVENT_NOTHING_CLICKED` | The click hit no geometry |

The three click events are how a catalog knows where to place a wall-bound
item: `EVENT_WALL_CLICKED` and `EVENT_FLOOR_CLICKED` carry the surface, and the
application holds the most recent one as the placement context.

## The 2D floorplanner

Dispatched on `blueprint.floorplanner` — which is `null` in widget mode.

| Event | When |
|---|---|
| `EVENT_MODE_RESET` | The active tool changed. **`evt.mode` carries the new mode.** |
| `EVENT_CORNER_2D_CLICKED` | A corner was clicked |
| `EVENT_WALL_2D_CLICKED` | A wall was clicked |
| `EVENT_ROOM_2D_CLICKED` | A room was clicked |
| `EVENT_CORNER_2D_DOUBLE_CLICKED` | … double-clicked |
| `EVENT_WALL_2D_DOUBLE_CLICKED` | … double-clicked |
| `EVENT_ROOM_2D_DOUBLE_CLICKED` | … double-clicked |
| `EVENT_CORNER_2D_HOVER` | Pointer entered a corner |
| `EVENT_WALL_2D_HOVER` | Pointer entered a wall |
| `EVENT_ROOM_2D_HOVER` | Pointer entered a room |
| `EVENT_NOTHING_CLICKED` | The click hit nothing |

`EVENT_UPDATED` also comes off the carbon sheet when the underlay moves or
scales.

## What Configuration does not do

`Configuration` — the display unit, grid spacing, wall height and thickness,
the snap settings, the wall-measurement flags — is a plain singleton and
**dispatches nothing at all**.

Changing a value takes effect the next time something draws. The application
calls `floorplanner.redraw()` explicitly after touching it, and there is no
event you can subscribe to instead. If you build your own UI over the library,
this is the one piece of state you have to push rather than observe.

## Declared but never fired

Four constants are exported and documented in the API surface, and nothing in
the library dispatches them:

- `EVENT_SAVED`
- `EVENT_ROOM_CLICKED`
- `EVENT_ROOM_NAME_CHANGED`
- `EVENT_WALL_ATTRIBUTES_CHANGED`

They are kept exported because removing a public name is a breaking change for
no benefit, and because two of them describe things the library plausibly
should signal. Do not wait on one of them.

For room clicks in the 3D view, there is no equivalent —
`EVENT_ROOM_2D_CLICKED` covers the 2D side only. Room name changes are
observable through `EVENT_ROOM_ATTRIBUTES_CHANGED` on the `Room`.
