import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { getSimulatedOnlineCount } from "../src/lib/simulated-community-activity"

test("generated activity stays within the requested range and is stable per minute", () => {
  for (let minute = 0; minute < 20_000; minute += 1) {
    const count = getSimulatedOnlineCount(minute)
    assert.equal(count, getSimulatedOnlineCount(minute))
    assert.ok(count >= 61 && count <= 784, `minute ${minute} produced ${count}`)
  }
})

test("generated activity changes gradually between minutes", () => {
  let previous = getSimulatedOnlineCount(0)
  for (let minute = 1; minute < 20_000; minute += 1) {
    const current = getSimulatedOnlineCount(minute)
    assert.ok(Math.abs(current - previous) <= 7, `minute ${minute} jumped from ${previous} to ${current}`)
    previous = current
  }
})

test("community activity endpoint keeps the requested all-time peak", async () => {
  const route = await readFile(new URL("../src/app/api/community/activity/route.ts", import.meta.url), "utf8")
  assert.match(route, /allTimePeak:\s*1064/)
})
