# architect3d

WebGL 3D interior design tool with a 2D floorplanner.

Draw walls by clicking, close a loop to make a room, furnish it from a catalog
of 168 models, change wall and floor textures, and walk through the result in
first person.

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
| `npm test` | The vitest suite (828 tests, headless) |
| `npm run lint` | ESLint |
| `npm run docs` | The documentation site, with hot reload |
| `npm run docs:build` | The documentation site &rarr; `docs/.vitepress/dist` |
| `npm run fixtures` | Regenerate `tests/fixtures/*.blueprint3d` |
| `npm run parity` | Render eleven states through three r98 and r185 side by side |

Pushing to `master` builds and publishes both the application and the docs to
GitHub Pages. Nothing deploys from any other branch.


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
src/scripts/   the library - plain ESM, 56 exports, no Vue
src/app/       the Vue 3 application built on it
src/catalog/   the item palette and the texture list, as JSON
public/        assets the running app loads (models, textures, thumbnails)
asset-pipeline/ the sources those were produced from - .obj/.mtl, .blend,
               the 25 pre-migration three.js JSON models, inventory scripts
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
| `components` | the shell, the two viewports, the toolbars, the catalog |
| `composables` | the blueprint's lifetime, selection, camera, file IO |
| `inspector` | the selection panels, texture grid and settings |


## About

Built on [three.js](https://threejs.org/), descended from
[blueprint3d](https://github.com/furnishup/blueprint3d), and rebuilt over ten
sprints from rollup + Babel + jQuery + three r98 onto Vite + Vue 3 + three
0.185. The runtime dependencies are Vue, three and bezier-js; there are no
others.

See [CHANGELOG.md](./CHANGELOG.md) for what changed, and the
[migration roadmap](https://amitukind.github.io/architect3d/docs/roadmap.html)
for why.


## Author

[@amitukind](https://github.com/amitukind/) ·
[Website](http://amitukind.com/) ·
[amitverma.ukind@gmail.com](mailto:amitverma.ukind@gmail.com)

Released under the ISC licence.
