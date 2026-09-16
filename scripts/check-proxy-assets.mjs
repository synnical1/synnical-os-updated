import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"

const files = [
  ["@mercuryworkshop/scramjet", "scramjet.js", "scramjet/scramjet.js"],
  ["@mercuryworkshop/scramjet", "scramjet.mjs", "scramjet/scramjet.mjs"],
  ["@mercuryworkshop/scramjet", "scramjet.wasm", "scramjet/scramjet.wasm"],
  ["@mercuryworkshop/scramjet-controller", "controller.api.js", "scramjet/controller.js"],
  ["@mercuryworkshop/scramjet-controller", "controller.sw.js", "controller/controller.sw.js"],
  ["@mercuryworkshop/scramjet-controller", "controller.inject.js", "controller/controller.inject.js"],
  ["@mercuryworkshop/scramjet-controller", "controller.inject.js", "scramjet/controller.inject.js"],
]
for (const [pkg, source, target] of files) {
  const digest = (filename) => createHash("sha256").update(readFileSync(filename)).digest("hex")
  assert.equal(digest(`public/${target}`), digest(`node_modules/${pkg}/dist/${source}`), `Proxy asset differs: ${target}`)
}
console.log(`Verified ${files.length} proxy runtime/controller assets against the installed lockfile versions.`)
