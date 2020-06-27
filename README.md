WebGL based 3D interior designing tool with 2D Floor Planer


[Live Demo](http://amitukind.com/projects/architect3d/)


## About

This is a customizable application built on three.js that allows users to design an interior space such as a home or apartment. Below are screenshots from  Example App (link above).

1) Create 2D floorplan:

![floorplan](./images/floorplan2d.png)

2) Add items:

![add_items](./images/items.png)

3) Design in 3D:

![3d_design](./images/floorplan3d.png)

## Developing and Running Locally

To get started, clone the repository and ensure you npm >= 3 and rollup installed, then run:

    npm install
    rollup -c

The latter command ( [enable execution](https:/go.microsoft.com/fwlink/?LinkID=135170) policy before running it) generates `build/js/bp3djs.js` from `src`. 

```
NODE_ENV=production rollup -c
```

The above command will generate `build/js/bp3djs.min.js` a minified and uglified version of the js. The easiest way to run locally is by

```
     rollup -c -w
```
Then, visit `http://localhost:10001` in your browser.


## Directory Structure

### `src/` Directory

The `src` directory contains the core of the project. Here is a description of the various sub-directories:

`core` - Basic utilities such as logging and generic functions

`floorplanner` - 2D view/controller for editing the floorplan

`items` - Various types of items that can go in rooms

`model` - Data model representing both the 2D floorplan and all of the items in it

`three` - 3D view/controller for viewing and modifying item placement


## DOCS ##
Included


[@amitukind](https://github.com/amitukind)

