---
layout: home

hero:
  name: architect3d
  text: Interior design in the browser
  tagline: Draw a floorplan in 2D, furnish and walk through it in 3D. Vue 3, three.js and about six thousand lines of model code.
  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture
    - theme: alt
      text: Try the app
      link: ../

features:
  - title: Two views, one model
    details: The 2D floorplanner and the 3D scene are separate views over a single plain-data model. Neither owns the other, and the model holds no DOM or GPU resources - which is what makes it serializable and testable headlessly.
  - title: A library, not just an app
    details: src/scripts is a standalone ESM library with 56 exports and no Vue in it. src/app is one consumer. Embedders get the library alone, as an ES module or as an IIFE exposing a BP3DJS global.
  - title: Documented where it hurts
    details: The save format is written down field by field, including the two landmines - coordinates stored in the user's display unit, and a version constant that has never been bumped.
---

## What this is

A customizable WebGL application for designing interior spaces. Draw walls by
clicking, close a loop to make a room, drop furniture in from a catalog of 168
models, change wall and floor textures, and walk through the result in first
person.

It descends from [blueprint3d](https://github.com/furnishup/blueprint3d), and
was rebuilt from rollup + Babel + jQuery + three r98 onto Vite + Vue 3 +
three 0.185, and has been developed against measured drawings ever since. What
it is today — the layers, what gates it, every current number, and what is
still open — is in
[the state of the build](./roadmap.html){target="_blank"}.

## Where to start

| If you want to | Read |
|---|---|
| Run it locally, or embed the library | [Getting started](/getting-started) |
| Understand how the pieces fit | [Architecture](/architecture) |
| Read or write a `.blueprint3d` file | [Save file format](/save-format) |
| React to something the model did | [Events](/events) |
