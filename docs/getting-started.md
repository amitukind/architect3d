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
| `npm test` | The vitest suite (813 tests, headless, no GPU) |
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

### Assets are relative URLs

Every asset path the library composes is a **bare relative string**, resolved
by the browser against the page: `rooms/textures/wallmap.png`,
`models/js-glb/open_door.glb`. Saved designs carry the same form inside them.

So an embedder has two choices: serve the contents of `public/` at the same
path prefix as the page, or add a `<base>` tag. There is no asset-base option
threaded through the loaders, and that is on purpose — it means a design saved
against one host loads against another without rewriting a single URL.

### The IIFE build

For a page that cannot use modules, `npm run build` emits
`dist/bp3djs.js`, a self-executing bundle that hangs the same 56 exports off
`window.BP3DJS`. It contains three; it does not contain Vue.

## The test suite

```bash
npm test           # once
npm run test:watch # on change
```

813 tests across 15 files, all headless — jsdom for the DOM, a stub renderer
for WebGL. They run in about two seconds and need no display. Most of them are
*characterization* tests written before the code moved, and they encode
behaviour the migration deliberately preserved, quirks included.
`tests/README.md` explains which quirks and why.
