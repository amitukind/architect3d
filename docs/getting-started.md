# Getting started

## Running it

```bash
git clone https://github.com/amitukind/architect3d.git
cd architect3d
npm install
npm run dev
```

Then open `http://localhost:10001`. That is the whole setup — there is no asset
step, no generator to run first and no submodule. The models and textures the
application loads are checked in under `public/`, which Vite serves at the site
root.

## The commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 10001, with hot reload |
| `npm run build` | Library build → `dist/bp3djs.js`, an IIFE exposing the `BP3DJS` global |
| `npm run build:demo` | Application build → `dist-demo/`, what the Pages deploy publishes |
| `npm test` | The vitest suite (1,147 tests, headless, no GPU) |
| `npm run lint` | ESLint |
| `npm run docs` | This site, with hot reload |
| `npm run docs:build` | This site → `docs/.vitepress/dist` |
| `npm run fixtures` | Regenerate the test fixtures in `tests/fixtures/` |
| `npm run parity` | Render eleven states through r98 and r185 side by side |

`npm run parity` is a migration tool rather than a daily one. It builds a
screenshot grid comparing this engine against three r98, served from the
`legacy-demo` git tag; `-- --frozen` adds a third column from before the S8
colour change. It needs Google Chrome at the standard macOS path. See
`tests/README.md`.

## Using the application

The workspace shows the 2D plan, the 3D view, or both side by side; in split
you can drag the divider between them. The tool rail on the left is what the
pointer does, the inspector on the right is what is selected, and the status bar
along the bottom carries the counts, the total floor area, the pointer's plan
coordinates and what the current tool is waiting for.

| | |
|---|---|
| Workspace | <kbd>1</kbd> plan · <kbd>2</kbd> split · <kbd>3</kbd> 3D |
| Drawing | <kbd>V</kbd> select · <kbd>W</kbd> walls · <kbd>X</kbd> delete · <kbd>S</kbd> snap |
| Zoom | wheel, or <kbd>+</kbd> / <kbd>-</kbd> · <kbd>Shift</kbd><kbd>F</kbd> to frame the plan |
| Furniture | <kbd>A</kbd> for the catalog |
| Editing | <kbd>Ctrl/⌘</kbd><kbd>Z</kbd> undo · <kbd>Ctrl/⌘</kbd><kbd>D</kbd> duplicate · <kbd>Del</kbd> delete |
| 3D | <kbd>F</kbd> walk through · <kbd>O</kbd> orthographic · <kbd>G</kbd> wireframe |

<kbd>Shift</kbd><kbd>?</kbd> opens the full reference. Shortcuts are suppressed
while a text field has focus, with the deliberate exception of
<kbd>Esc</kbd> — whose job in a field is to leave it.

Everything is undoable, and the working design is kept in the browser's local
storage between sessions. After a reload a recovered draft is *offered* rather
than restored: closing a design to start fresh should not silently bring it
back.

### Studio and Classic

The switch at the bottom right of the 3D view picks a render profile.
**Studio** — the application default — has lit walls, an image-based
environment, filmic tone mapping and fog. **Classic** is what the viewer looked
like through 1.0.0, and is what the migration's parity grid was calibrated
against; it is also the *library* default, so an embedder who upgrades sees no
change. [Architecture](/architecture) lists what each profile alters.

## Requirements

Node 22 or newer, and a WebGL2 browser. WebGL2 is not optional: three dropped
WebGL1 in r163 and this project is on r185.

## Embedding the library

`src/scripts/` is a standalone ES module library — no Vue, no application
shell, no build step needed to consume it:

```js
import {BlueprintJS, EVENT_LOADED} from 'architect3d';

const blueprint = new BlueprintJS({
    floorplannerElement: 'floorplanner-canvas',  // element id, 2D view
    threeElement: '#viewer',                     // selector, 3D view host
    threeCanvasElement: 'three-canvas',          // element id, canvas
    textureDir: 'models/textures/',
    widget: false,
});

blueprint.model.addEventListener(EVENT_LOADED, () => console.log('design in'));
blueprint.model.loadSerialized(json);
```

`new BlueprintJS(options)` builds three things and hands them to you as
properties:

- `model` — the plain-data floorplan and scene. Serializable, no DOM.
- `three` — the 3D view, cameras, controls and exporters.
- `floorplanner` — the 2D view, or `null` in widget mode.

`widget: true` skips the 2D floorplanner entirely and disables the 3D
controller, for a read-only embed. `dispose()` tears down both views, releasing
every DOM listener and the WebGL context; it is safe to call twice, and it
deliberately leaves `model` alone so you can still serialize after teardown.

### More than one design on a page

Units, zoom, wall defaults and snapping are shared by every viewer unless you
say otherwise, which is right for one design and wrong for two. Pass a
`configuration` — and a `renderProfile` if the two should also look different:

```js
import {BlueprintJS, Configuration, createRenderProfile, RENDER_STUDIO, dimMeter} from 'architect3d';

const metric = new BlueprintJS({
    ...options,
    configuration: new Configuration({dimUnit: dimMeter, wallHeight: 300}),
    renderProfile: createRenderProfile(RENDER_STUDIO),
});
```

Reach a design's settings through `blueprint.configuration`, or
`floorplan.configuration` and `floorplan.dimensioning` from lower down. Omit
both options and you share the page-wide defaults, which is what the
`Configuration` and `Dimensioning` statics read.

One thing worth knowing if you build two viewers without configurations of
their own: `BlueprintJS`'s constructor sets the display unit, so the second one
will change the first's. Give each a `Configuration` and they cannot.

### Two designs, side by side

Everything a document needs — its configuration, the dimensioning bound to it,
its render profile, its load session and its GPU resource registries — is one
object, a `DesignRuntime`. Every viewer has one; the options above are a
shorthand for building it. Construct it yourself when you want to hold the
document's lifetime, put two viewers on one document, or ask what it is using:

```js
import {BlueprintJS, DesignRuntime, Configuration, createRenderProfile,
        RENDER_CLASSIC, RENDER_STUDIO, dimMeter, dimCentiMeter} from 'architect3d';

const left = new DesignRuntime({
    id: 'before',
    configuration: new Configuration({dimUnit: dimCentiMeter}),
    renderProfile: createRenderProfile(RENDER_CLASSIC),
});
const right = new DesignRuntime({
    id: 'after',
    configuration: new Configuration({dimUnit: dimMeter, wallHeight: 300}),
    renderProfile: createRenderProfile(RENDER_STUDIO),
});

const before = new BlueprintJS({...leftElements, runtime: left});
const after  = new BlueprintJS({...rightElements, runtime: right});

before.model.loadSerialized(originalDesign);
after.model.loadSerialized(revisedDesign);
```

The two share nothing but the page and the decoded images behind their
textures, which is the one thing that *should* be shared — one download and one
GPU upload however many viewers draw with it.

`runtime.stats()` reports `{id, disposed, registries, resources, handles,
session}` for that document alone: how many GPU resources it is holding, across
how many registries, and what its loader is waiting on. It is the number to
watch if you suspect a leak, and it is what the acceptance tests read.

**Who disposes what.** `blueprint.dispose()` tears down that viewer's two views
and releases its GPU resources. It disposes the runtime *only if it built it* —
a runtime you passed in is yours, so two viewers can share one document and the
first to close does not take the second down with it. Call `runtime.dispose()`
when you are finished with the document: it releases every registry and
abandons any model still in flight.

Omit `runtime` entirely and you get one built for you, carrying the page-wide
settings. Note what that is *not*: a shared runtime. Settings default to shared;
lifetimes never are.

### Assets are relative URLs, and now they are resolvable

Every asset path the library composes is a **bare relative string**, resolved
by the browser against the page: `rooms/textures/wallmap.png`,
`models/js-glb/open_door.glb`. Saved designs carry the same form inside them, so
those strings are a compatibility contract — renaming a file breaks documents
that already exist, on disks this project cannot reach. Vite copies `public/`
as-is and never hashes it, so content-addressed filenames are not available as
an answer.

The simplest deployment is therefore unchanged: serve the contents of `public/`
at the same path prefix as the page, or add a `<base>` tag, and everything
resolves.

#### The manifest and the CDN base

Since RM-003 A5 the string in a document is a **logical name**, and an
`AssetResolver` decides what is actually fetched. `npm run manifest` generates
`public/asset-manifest.json` — logical name to `{bytes, hash, kind}`, plus a
`url` for any asset that is not where its name says — and the resolver consults
it:

```js
import {AssetManifest, AssetResolver, BlueprintJS} from 'architect3d';

const response = await fetch('asset-manifest.json');
const {manifest} = AssetManifest.parse(await response.json());

const blueprint = new BlueprintJS({
    ...options,
    assets: new AssetResolver({
        manifest,
        base: 'https://cdn.example.com/architect3d',   // optional
    }),
});
```

That buys three things that were not possible before, and **none of them
requires renaming a file or rewriting a document**:

- **Versioning.** Give an entry a different `url` and every design naming it
  follows.
- **A CDN.** `base` is prepended to every resolution. The demo honours
  `?assetBase=https://…` on the query string so this is checkable in a browser.
- **Availability as a policy.** A resolver with a manifest knows what the build
  ships, so a name it does not have fails *before* the network with a message
  that can name the item, rather than as a 404 in the console.

The manifest also carries a subresource-integrity hash per asset.
`resolver.integrityFor(name)` hands it over for `fetch(url, {integrity})`;
nothing enforces it by default, because for same-origin `public/` it guards
nothing the origin does not already guarantee, while a mismatch after a
legitimate redeploy of an unhashed file is an outage. It matters for the CDN
case, which is why it is recorded.

Omit `assets` entirely and every logical name resolves to itself — exactly what
the library did before, and what it still does by default. `npm run manifest:check`
fails if the committed manifest has drifted from `public/`.

### The IIFE build

For a page that cannot use modules, `npm run build` emits
`dist/bp3djs.js`, a self-executing bundle that hangs the same 56 exports off
`window.BP3DJS`. It contains three; it does not contain Vue.

## The test suite

```bash
npm test           # once
npm run test:watch # on change
```

1,147 tests across 25 files, all headless — jsdom for the DOM, a stub renderer
for WebGL. They run in a few seconds and need no display. Most of them are
*characterization* tests written before the code moved, and they encode
behaviour the migration deliberately preserved, quirks included.
`tests/README.md` explains which quirks and why.
