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
| `EVENT_LOADING` | A document has validated and is about to be applied | `{item: model}` |
| `EVENT_LOADED` | The design is in, items requested | `{item: model}` |
| `EVENT_GLTF_READY` | `exportForBlender()` finished | `{item, gltf}` — the glTF JSON as a string |

`EVENT_LOADED` fires when the *floorplan* is built and item loads have been
started, not when the models have arrived. Wait on the item events for that.

::: tip Opening a document is all-or-nothing
`loadSerialized()` validates the whole document before touching any live state,
so a file that is not a design leaves the open design exactly as it was — and
`EVENT_LOADING` is **not** dispatched for a document that fails validation.
Neither event fires, so a listener that shows a spinner on `LOADING` and hides
it on `LOADED` cannot be left spinning.

It still throws on a bad document, and the message now names the field. Use
`model.loadDocument(json)` for the same operation as a value: it returns
`{ok, document, errors, warnings}`, where each error carries the path to the
field it is about.
:::

## Floorplan

Dispatched on `blueprint.model.floorplan`.

| Event | When |
|---|---|
| `EVENT_NEW` | A new floorplan replaced the old one |
| `EVENT_LOADED` | A floorplan finished loading |
| `EVENT_CHANGESET` | Something changed, and the payload says what |
| `EVENT_UPDATED` | The wall graph changed and rooms were re-derived |
| `EVENT_DELETED` | A corner or wall was removed |

`EVENT_UPDATED` is the one to listen to if you care about rooms. Rooms are
derived, not stored, so this is the only moment the room list is known to be
current.

## What changed, and why

`EVENT_UPDATED` says *that* something happened. `EVENT_CHANGESET` says **what**,
and it is what you want if the reaction is expensive.

```js
import {EVENT_CHANGESET, CHANGE_TOPOLOGY, CHANGE_GEOMETRY, REASON_LOAD} from 'architect3d';

floorplan.addEventListener(EVENT_CHANGESET, ({changes}) => {
    if (changes.has(CHANGE_TOPOLOGY)) { rebuild(changes.entities(CHANGE_TOPOLOGY)); }
    else if (changes.has(CHANGE_GEOMETRY)) { nudge(changes.entities(CHANGE_GEOMETRY)); }
    if (changes.reason === REASON_LOAD) { frameTheView(); }
});
```

A `ChangeSet` carries kinds, the entities each kind affects, and a reason.

| Kind | Means | Entities | Emitted today |
|---|---|---|---|
| `CHANGE_TOPOLOGY` | Corners or walls added, removed or reconnected; rooms were re-derived | the rooms, as re-derived | yes |
| `CHANGE_GEOMETRY` | Existing entities moved. The room set is the same objects | the corners whose angles moved | yes |
| `CHANGE_SURFACE` | Textures, colours, materials | — | no |
| `CHANGE_ITEMS` | Furniture added, removed, moved | — | no |
| `CHANGE_SELECTION` | What is selected | — | no |
| `CHANGE_VIEW` | Configuration, units, render profile | — | no |

| Reason | When |
|---|---|
| `REASON_LOAD` | A document was opened |
| `REASON_EDIT` | A person did something. The default |
| `REASON_UNDO` | History put a previous state back |
| `REASON_DERIVE` | The library recomputed something off the back of another change |

The four kinds with no emitter are named because a half-stated vocabulary is
worse than none — a `switch` needs to know the whole set. `surface` is the one
that looks like an omission and is not: `Room.setTexture()` and
`HalfEdge.setTexture()` already dispatch `EVENT_CHANGED` and `EVENT_REDRAW`
straight to the `Floor` and `Edge` drawing them, so that path is per-entity and
already incremental. A plan-level broadcast on top would be new traffic that
autosave and history would start recording.

::: tip Both events fire, always
Every `EVENT_CHANGESET` is followed by the `EVENT_UPDATED` it derives, at the
same moment and with the same `item`. The ChangeSet also rides along on the
legacy payload as `evt.changes`, so a consumer can adopt the typed form without
changing which event it subscribes to. Nothing that listened before has to move.
:::

::: warning A corner drag no longer moves the 3D camera
That is the one intended behaviour change. `Main` reframes on topology changes
only, and only when the plan's bounding box actually moved — so dragging a
corner, and adding a corner strictly inside the existing plan, both leave the
camera where the user put it. Opening a document still frames it.

`three.cameraStats()` reports `{recentred, declined}`, and
`three.floorplan.projectionStats()` reports what the 3D projection rebuilt.
Setting `three.floorplan.incremental = false` restores the old full redraw on
every change, with the ChangeSet still in place.
:::

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
| `EVENT_ITEM_MOVE_FINISH` | A drag or rotation settled | `{item}` |

::: warning A LOADED can be for a document you have already left
Every `EVENT_ITEM_LOADING` is still matched by exactly one `EVENT_ITEM_LOADED`,
whatever happens — that is RM-002 R-01's guarantee and it is what lets a caller
count loads in flight. But a model requested by one document can arrive after
another has been opened, and that arrival is reported rather than swallowed, so
the count stays balanced.

Those carry **`stale: true`** and a null `item`. The item is not added to the
scene, and what the loader built for it is disposed. If you are counting loads,
ignore the flag — the balance is the point. If you are reacting to *content*,
check `evt.item` for null, as you already must for a failed load.

`scene.loadSession.stats()` is the authoritative answer to "is this document
still loading": `{generation, inFlight, aborted, failed, settled}`, for the
current document only.
:::

`EVENT_ITEM_MOVE_FINISH` is the only signal that a direct manipulation has
*ended*. The `Controller` mutates an item's position on every `pointermove` and
marks the scene dirty so a frame is drawn, but nothing else says "and now it has
come to rest" — so a listener watching only what the scene already dispatched
would either record a hundred states for one drag or none at all. It fires on
pointer-up out of the dragging and rotating states, and only if the pointer
actually moved: a click that selects an item is not an edit.

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

## What Configuration does, and does not

`Configuration` — the display unit, grid spacing, wall height and thickness,
the snap settings, the wall-measurement flags — dispatches
`EVENT_CONFIG_CHANGED` on every `setValue` that actually changes something,
carrying `{key, value, previous}`. It fires only on a real change, because
callers write from watchers that re-run for unrelated reasons and announcing a
no-op would turn one user action into a redraw storm.

```js
Configuration.addEventListener(EVENT_CONFIG_CHANGED, ({key, value}) => { … });
```

What it does *not* do is redraw. The 2D view does not listen, so changing a
value takes effect the next time something draws, and the application calls
`floorplanner.redraw()` explicitly after touching it. Subscribe to know; redraw
to see.

`Configuration` is both a class and a namespace. The statics above read and
write one module-level default shared by the whole page. A design that wants
its own settings gets a `Configuration` of its own:

```js
const blueprint = new BlueprintJS({…opts, configuration: new Configuration({dimUnit: dimMeter})});
blueprint.configuration.addEventListener(EVENT_CONFIG_CHANGED, …);   // this design only
```

Each configuration dispatches only its own changes, so a panel bound to one
design does not wake up for another's.

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
