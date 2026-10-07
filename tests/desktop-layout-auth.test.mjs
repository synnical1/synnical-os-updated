import test from "node:test"
import assert from "node:assert/strict"
import { verifyAuthenticatedLock } from "../scripts/desktop-layout-regression.mjs"

test("anonymous live verification never triggers or claims an authenticated lock check", async () => {
  const forbidden = () => assert.fail("Anonymous verification must not interact with the lock screen")
  const result = await verifyAuthenticatedLock({ authenticated: false, evaluate: forbidden, wait: forbidden, checkSurface: forbidden, capture: forbidden })
  assert.equal(result, "UNVERIFIED: authenticated account required")
})

test("authenticated CI still requires the lock video, cover bounds and screenshot", async () => {
  const calls = []
  const result = await verifyAuthenticatedLock({
    authenticated: true,
    evaluate: async expression => { assert.match(expression, /synnical-os-lock/); calls.push("trigger") },
    wait: async expression => { assert.match(expression, /synnical-os-lock video/); calls.push("ready") },
    checkSurface: async selector => { assert.equal(selector, ".synnical-os-lock video"); calls.push("bounds") },
    capture: async name => { assert.equal(name, "lock-1366x768"); calls.push("screenshot") },
  })
  assert.equal(result, "passed")
  assert.deepEqual(calls, ["trigger", "ready", "bounds", "screenshot"])
})

test("authenticated lock assertion failures still fail verification", async () => {
  await assert.rejects(verifyAuthenticatedLock({
    authenticated: true,
    evaluate: async () => {},
    wait: async () => { throw new Error("Lock video missing") },
    checkSurface: () => assert.fail("Must not continue after a failed assertion"),
    capture: () => assert.fail("Must not capture a failed lock check"),
  }), /Lock video missing/)
})
