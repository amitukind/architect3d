# Security policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/amitukind/architect3d/security/advisories/new)
on this repository. Please do not open a public issue for a vulnerability.

There is no service to attack: architect3d is a client-side library and a
static application. It has no server, no accounts, no database and no
telemetry, and every design a person makes stays in their own browser. What is
worth reporting is therefore code that mishandles input somebody else supplied
— a shared design link, an imported model, a catalog pack — or a dependency
advisory this repository has not noticed.

## What is supported

The most recent release on the default branch. There is no long-term support
branch and no backport policy; this is a single-maintainer project and saying
otherwise would be a promise nobody is keeping.

## Dependencies

This is the whole supply chain a consumer inherits, and it is deliberately
small (RM-018 Q3, finding AD-9). `tests/dependency-policy.test.js` asserts each
of these on every run, so the policy is checked rather than described:

- **Zero runtime dependencies.** `npm install architect3d` adds this package
  and nothing else. There is no `dependencies` block and there is not going to
  be one without a good reason written down.
- **Two peer dependencies**, `three` and `bezier-js`, both supplied by the
  consumer at a version they control. They are peers rather than dependencies
  because two copies of three in one page is a real failure mode this project
  has already had: before S4 the bundle carried three full engines, and
  `instanceof` silently failed across the seam.
- **Development dependencies are not shipped.** The `files` allowlist decides
  what is published; nothing under `node_modules` or `tools/` is in it.

## Advisories

`npm audit --audit-level=low` runs in CI on every push to `dev` and `master`
and fails the build on anything at all. RM-006 took this tree to zero
advisories and it is a ratchet from there.

One override is in force: VitePress asks for `vite ^5.4.14`, which carries
three advisories all fixed in 6.4.3, so `package.json` pins VitePress's vite to
`^6.4.3` rather than moving the documentation toolchain onto a prerelease. The
docs build in CI proves the override works and the audit step proves it is
still needed.

## Automated updates

There is no Dependabot or Renovate configuration, and that is a decision rather
than an oversight. This repository runs CI only on `dev` and `master` in order
to conserve Actions minutes, and a bot that opens a pull request per dependency
would either run no checks at all or reverse that decision. Updates are made by
hand, and `npm audit` is what makes them urgent when they are.

## Provenance

Not published to npm. If it is published, `.github/workflows/publish.yml` is
ready: it uses npm trusted publishing over GitHub OIDC, needs no long-lived
token, and attaches a SLSA Build L3 provenance attestation automatically. That
workflow has never run.
