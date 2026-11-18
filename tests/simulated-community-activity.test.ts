import test from "node:test"
import assert from "node:assert/strict"
import { getSimulatedOnlineCount } from "../src/lib/simulated-community-activity"

test("simulated activity is stable for the same epoch minute and stays within range", () => {
  for (let minute = 0; minute < 20_000; minute += 1) {
    const count = getSimulatedOnlineCount(minute)
    assert.equal(count, getSimulatedOnlineCount(minute))
    assert.ok(count >= 61 && count <= 784, `minute ${minute} produced ${count}`)
  }
})

test("simulated activity changes gradually from minute to minute", () => {
  let previous = getSimulatedOnlineCount(0)
  for (let minute = 1; minute < 20_000; minute += 1) {
    const current = getSimulatedOnlineCount(minute)
    assert.ok(Math.abs(current - previous) <= 7, `minute ${minute} jumped from ${previous} to ${current}`)
    previous = current
  }
})
