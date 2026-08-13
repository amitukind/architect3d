WebGL based 3D interior designing tool with 2D Floor Planer
## About
This is a customizable application built on three.js that allows users to design an interior space such as a home or apartment.

[Live Demo](http://amitukind.com/projects/architect3d/)

![](./images/architect3d.jpg)

 Below are screenshots from  [Live Demo](http://amitukind.com/projects/architect3d/)

1) Create 2D floorplan:

![floorplan](./images/floorplan2d.png)

2) Add items:

![add_items](./images/items.png)

3) Design in 3D:

![3d_design](./images/floorplan3d.png)

## Developing and Running Locally

Clone the repository and run:

```bash
npm install
npm run dev
```

Then visit `http://localhost:10001`.

`npm run dev` serves the Vue 3 application from `index.html` with hot reload,
loading the library from `src/` as ES modules. The pre-Vue jQuery demo is
generated alongside it at `/legacy.html`, so the two can be compared while the
migration finishes.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 10001: the Vue app, plus `/legacy.html` |
| `npm run build` | Library build &rarr; `dist/bp3djs.js`, an IIFE exposing the `BP3DJS` global |
| `npm run build:demo` | Application build &rarr; `dist-demo/` |
| `npm test` | The full vitest suite |
| `npm run lint` | ESLint |
| `npm run parity` | Renders eleven states through r98 and r185 side by side; `-- --frozen` adds a pre-S8 column (see `tests/README.md`) |

The build is Vite. rollup, Babel, jQuery, Bootstrap, dat.GUI and the glyphicon
webfont were all removed during the migration; the application's only runtime
dependencies are Vue, three and bezier-js.


## Directory Structure

### `src/` Directory

`src/scripts` is the library and `src/app` is the Vue 3 application built on
top of it. The application imports the library; nothing goes the other way, and
the library build contains no Vue.

Inside `src/scripts`:

`core` - Basic utilities such as logging and generic functions

`floorplanner` - 2D view/controller for editing the floorplan

`items` - Various types of items that can go in rooms

`model` - Data model representing both the 2D floorplan and all of the items in it

`three` - 3D view/controller for viewing and modifying item placement

Inside `src/app`:

`components` - the shell, the two viewports, the toolbars and the catalog

`composables` - the blueprint's lifetime, the selection, the camera, file IO

`inspector` - native selection panels, the texture grid and the settings panel


## DOCS ##
Included



## Author
[@amitukind](https://github.com/amitukind/) | [Website](http://amitukind.com/) | [amitverma.ukind@gmail.com](mailto:amitverma.ukind@gmail.com)
