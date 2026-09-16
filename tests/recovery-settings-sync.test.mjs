import test from "node:test"
import assert from "node:assert/strict"
import { startAccountSettingsSync, stopAccountSettingsSync, readSetting, writeSetting } from "../src/lib/settings-runtime.ts"

test("recovery: late hydration cannot cross accounts or overwrite a newer local edit", async () => {
  const originals = Object.fromEntries(["window", "localStorage", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const values = new Map([["synnical:settings-account-owner:v1", "alpha"], ["synnical:settings:voice.volume", "10"]])
  const storage = { get length() { return values.size }, key: (i) => [...values.keys()][i] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
  const pending = []; const writes = []
  Object.defineProperty(globalThis, "window", { configurable: true, value: win })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage })
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { writes.push(JSON.parse(init.body)); return Response.json({}) }
    return new Promise((resolve) => pending.push(resolve))
  }
  try {
    const alpha = startAccountSettingsSync("alpha")
    const beta = startAccountSettingsSync("beta")
    assert.equal(readSetting("voice.volume", 99), 99)
    writeSetting("voice.volume", 30)
    pending[1](Response.json({ settings: { "voice.volume": 20 } }))
    await beta
    pending[0](Response.json({ settings: { "voice.volume": 10 } }))
    await alpha
    assert.equal(readSetting("voice.volume", 99), 30)
    assert.deepEqual(writes, [{ accountId: "beta", settings: { "voice.volume": 30 } }])
    assert.equal(values.get("synnical:settings-account-owner:v1"), "beta")
  } finally {
    stopAccountSettingsSync()
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
