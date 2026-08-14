# architect3d

WebGL 3D interior design tool with a 2D floorplanner.

Draw walls by clicking, close a loop to make a room, furnish it from a catalog
of 168 models, change wall and floor textures, and walk through the result in
first person. Plan and 3D view side by side, undo on everything, and a dark or
light theme that reaches the drawing canvas as well as the chrome.

**[Documentation](https://amitukind.github.io/architect3d/docs/)** ·
**[Live app](https://amitukind.github.io/architect3d/)**

![](./images/architect3d.jpg)

1) Create a 2D floorplan:

![floorplan](./images/floorplan2d.png)

2) Add items:

![add_items](./images/items.png)

3) Design in 3D:

![3d_design](./images/floorplan3d.png)


## Running it

```bash
git clone https://github.com/amitukind/architect3d.git
cd architect3d
npm install
npm run dev
```

Then visit `http://localhost:10001`. Node 22+ and a WebGL2 browser.

There is no asset step and no generator to run first — the models and textures
are checked in under `public/`, which Vite serves at the site root.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 10001, with hot reload |
| `npm run build` | Library build &rarr; `dist/bp3djs.js`, an IIFE exposing the `BP3DJS` global |
| `npm run build:demo` | Application build &rarr; `dist-demo/` |
| `npm test` | The vitest suite (870 tests, headless) |
| `npm run lint` | ESLint |
| `npm run docs` | The documentation site, with hot reload |
| `npm run docs:build` | The documentation site &rarr; `docs/.vitepress/dist` |
| `npm run fixtures` | Regenerate `tests/fixtures/*.blueprint3d` |
| `npm run parity` | Render eleven states through three r98 and r185 side by side |

Pushing to `master` builds and publishes both the application and the docs to
GitHub Pages. Nothing deploys from any other branch.


## Using it

| | |
|---|---|
| **Workspace** | <kbd>1</kbd> plan · <kbd>2</kbd> split · <kbd>3</kbd> 3D. In split, drag the divider between the panes. |
| **Drawing** | <kbd>V</kbd> select · <kbd>W</kbd> draw walls · <kbd>X</kbd> delete · <kbd>S</kbd> snap to grid. Hold <kbd>Shift</kbd> while drawing to snap to the axis. |
| **Zoom** | Wheel over the plan, or <kbd>+</kbd> / <kbd>-</kbd>. <kbd>Shift</kbd><kbd>F</kbd> frames the whole plan. |
| **Furniture** | <kbd>A</kbd> opens the catalog. It stays open while you pick, and searches all 168 models. |
| **Editing** | <kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd> undo and redo · <kbd>⌘D</kbd> duplicate · <kbd>Del</kbd> delete. |
| **3D** | <kbd>F</kbd> walk through · <kbd>O</kbd> orthographic · <kbd>G</kbd> wireframe. |

<kbd>⇧</kbd><kbd>?</kbd> shows the full list, built from the same binding table
the shortcuts are, so it cannot go stale.

Work in progress is kept in the browser's local storage and offered back after
a reload — as an offer, not an automatic restore, so closing a design to start
fresh does not silently bring it back.

### Studio and Classic

The 3D view has two render profiles, switched bottom-right of the viewport.
**Studio** is the default: lit walls, an image-based environment, filmic tone
mapping and fog to the horizon. **Classic** is exactly what the app looked like
through 1.0.0 — unlit walls, Phong floors, no tone mapping. It is kept because
ten sprints of parity work went into it and it is the reference this viewer's
output is checked against. See
[Architecture](https://amitukind.github.io/architect3d/docs/architecture) for
what each one changes.


## Documentation

| | |
|---|---|
| [Getting started](https://amitukind.github.io/architect3d/docs/getting-started) | Running it, the commands, embedding the library |
| [Architecture](https://amitukind.github.io/architect3d/docs/architecture) | How the layers fit together, and where they meet |
| [Save file format](https://amitukind.github.io/architect3d/docs/save-format) | Every field in a `.blueprint3d` file, and how an older one is read |
| [Events](https://amitukind.github.io/architect3d/docs/events) | What fires, from where, carrying what |
| [Migration roadmap](https://amitukind.github.io/architect3d/docs/roadmap.html) | The ten-sprint plan, and what each sprint delivered |

The sources are Markdown under [`docs/`](./docs); `npm run docs` serves them
locally.


## Layout

```
src/scripts/   the library - plain ESM, no Vue, no CSS
src/app/       the Vue 3 application built on it
src/catalog/   the item palette and the texture list, as JSON
public/        assets the running app loads (models, textures, thumbnails)
asset-pipeline/ inputs and records that are not served: the 25 pre-migration
               three.js JSON models the .glb files were converted from, the
               .blend authoring files, and the conversion report
tests/         828 headless tests; see tests/README.md
tools/         one-off and migration tooling (conversion, goldens, parity)
docs/          this documentation site
```

The arrow between the two `src/` halves points one way: `src/app` imports
`src/scripts` and nothing goes back. There is no Vue anywhere in the library,
and `npm run build` bundles the library alone — which is what makes it
embeddable in a page that has never heard of Vue, and what lets the whole test
suite run with no renderer and no browser.

Inside `src/scripts`:

| | |
|---|---|
| `core` | units, configuration, events, geometry helpers |
| `model` | the plain-data floorplan and scene — no DOM, no GPU |
| `floorplanner` | the 2D view and its controller |
| `three` | the 3D view, cameras, controls and exporters |
| `items` | the eight item classes and the factory |

Inside `src/app`:

| | |
|---|---|
| `components` | the shell: top bar, tool rail, status bar, viewports, catalog |
| `composables` | lifetime, selection, camera, layout, history, zoom, theme, file IO |
| `inspector` | the selection panels, texture grid and settings |


## About

Built on [three.js](https://threejs.org/), descended from
[blueprint3d](https://github.com/furnishup/blueprint3d), and rebuilt over ten
sprints from rollup + Babel + jQuery + three r98 onto Vite + Vue 3 + three
0.185.

The runtime dependencies are Vue, three and bezier-js; there are no others. The
interface is built with Tailwind CSS 4, [Reka UI](https://reka-ui.com/), lucide
and VueUse, and all four are **devDependencies** — the published package is
`src/scripts` alone, which imports none of them and ships no CSS.

See [CHANGELOG.md](./CHANGELOG.md) for what changed, and the
[migration roadmap](https://amitukind.github.io/architect3d/docs/roadmap.html)
for why.


## Author

[@amitukind](https://github.com/amitukind/) ·
[Website](http://amitukind.com/) ·
[amitverma.ukind@gmail.com](mailto:amitverma.ukind@gmail.com)

Released under the ISC licence.
