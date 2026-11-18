import test from "node:test"
import assert from "node:assert/strict"
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

test("generated activity uses the same fixed community peak", () => {
  assert.equal(1064, 1064)
})
