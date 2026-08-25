# Proxy runtime notices

This directory contains the browser-side proxy runtime used by Synnical.

- `@mercuryworkshop/scramjet` 2.0.67-alpha.2
- `@mercuryworkshop/scramjet-controller` 0.0.14
- `@mercuryworkshop/libcurl-transport` 2.0.5

The projects are maintained by Mercury Workshop and distributed under the
GNU Affero General Public License v3. The license text is included as
`LICENSE-AGPL-3.0.txt`. Upstream source:

- https://github.com/MercuryWorkshop/scramjet
- https://github.com/MercuryWorkshop/libcurl-transport

The files are bundled locally so production does not depend on a third-party
CDN and so the controller, worker, WASM, and transport stay version-aligned.
