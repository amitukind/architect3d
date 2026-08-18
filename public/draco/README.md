# Draco decoder

Vendored from `three/examples/jsm/libs/draco/gltf/` at **three 0.185.1**, which
is the version `package.json` declares as a peer dependency.

    draco_decoder.wasm      192,420 bytes   63,183 gzipped
    draco_wasm_wrapper.js    58,456 bytes   11,634 gzipped

## Why these are here

RM-004 B1 re-encoded the whole model catalog with
`KHR_draco_mesh_compression`, taking `public/models/` from 5.08 MB to 1.01 MB.
Those files cannot be read without a decoder, and three does not serve one — it
ships the files and expects the application to host them somewhere and point
`DRACOLoader.setDecoderPath()` at it. This is that somewhere.

They are **copied rather than imported** because Vite would otherwise inline the
WASM into the bundle, which is the opposite of the point: the decoder is fetched
once, lazily, only by a session that actually opens a compressed model, and only
after the first one arrives. A session that places no furniture never pays for
it.

## The `gltf` variant, not the parent directory

`libs/draco/` also holds a decoder, 34% larger, that can read standalone `.drc`
files. Nothing here reads one — every compressed mesh in this project arrives
inside a `.glb` — so the smaller glTF-only build is the correct one.

## Refreshing them

    cp node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm  public/draco/
    cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js public/draco/

Do it when `three` is upgraded, and re-run `npm run budget` afterwards: both
files sit under the `public-total` ceiling and `tests/asset-integrity.test.js`
asserts they are present, so a forgotten refresh fails a gate rather than a
user's page.

Upstream, and the licence these carry, is
<https://github.com/google/draco> (Apache-2.0).
