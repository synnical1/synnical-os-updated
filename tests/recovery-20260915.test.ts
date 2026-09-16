import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { serveUpload } from "../src/lib/upload-serving"
import { validSettings, readSettingsBody, MAX_SERIALIZED_BYTES } from "../src/lib/settings-validation"
import { SYNNFLIX_AVATARS, SYNNFLIX_PROFILE_LIMIT } from "../src/lib/synnflix-profiles"

test("recovery: uploads support video ranges, HEAD, and reject invalid ranges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "synnical-upload-test-"))
  try {
    await writeFile(path.join(root, "clip.mp4"), "0123456789")
    const partial = await serveUpload(root, ["clip.mp4"], new Request("http://local/clip.mp4", { headers: { range: "bytes=2-5" } }))
    assert.equal(partial.status, 206); assert.equal(await partial.text(), "2345")
    assert.equal(partial.headers.get("content-range"), "bytes 2-5/10")
    assert.equal(partial.headers.get("content-type"), "video/mp4")
    const suffix = await serveUpload(root, ["clip.mp4"], new Request("http://local/", { headers: { range: "bytes=-3" } }))
    assert.equal(await suffix.text(), "789")
    const head = await serveUpload(root, ["clip.mp4"], new Request("http://local/", { method: "HEAD" }))
    assert.equal(await head.text(), ""); assert.equal(head.headers.get("content-length"), "10")
    for (const range of ["bytes=20-30", "bytes=4-2", "bytes=-0", "bytes=", "bytes=0-1,4-5"]) {
      assert.equal((await serveUpload(root, ["clip.mp4"], new Request("http://local/", { headers: { range } }))).status, 416)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("recovery: upload serving cannot expose symlinks, private folders or executable content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "synnical-upload-test-"))
  try {
    await writeFile(path.join(root, "test.png"), "test")
    await writeFile(path.join(root, "page.html"), "<script>alert(1)</script>")
    await symlink(path.join(root, "test.png"), path.join(root, "link.png"))
    for (const parts of [["link.png"], ["page.html"], ["..", "test.png"], ["game-screenshots-private", "test.png"], ["../test.png"], [".env"]]) {
      assert.equal((await serveUpload(root, parts, new Request("http://local/"))).status, 404)
    }
    const normal = await serveUpload(root, ["test.png"], new Request("http://local/"))
    assert.equal(normal.headers.get("x-content-type-options"), "nosniff")
    assert.equal(await normal.text(), "test")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("recovery: settings reject malformed, nested, prototype and oversized values", async () => {
  assert.equal(validSettings({ "chat.sound": true, volume: 40, theme: "blood" }), true)
  for (const input of [null, [], { bad: {} }, { bad: Infinity }, { bad: "x".repeat(4097) }, JSON.parse('{"__proto__":true}'), { constructor: false }]) assert.equal(validSettings(input), false)
  const invalid = await readSettingsBody(new Request("http://local/", { method: "POST", body: "not json" }))
  assert.ok(invalid instanceof Response); assert.equal(invalid.status, 400)
  const oversized = await readSettingsBody(new Request("http://local/", { method: "POST", body: "x".repeat(MAX_SERIALIZED_BYTES + 1) }))
  assert.ok(oversized instanceof Response); assert.equal(oversized.status, 413)
})

test("recovery: SynnFlix avatar IDs and coordinates remain stable", () => {
  assert.equal(SYNNFLIX_PROFILE_LIMIT, 12)
  assert.equal(new Set(SYNNFLIX_AVATARS.map((avatar) => avatar.id)).size, 100)
  assert.deepEqual(SYNNFLIX_AVATARS[0], { id: "avatar-001", row: 0, column: 0 })
  assert.deepEqual(SYNNFLIX_AVATARS[99], { id: "avatar-100", row: 9, column: 9 })
})
