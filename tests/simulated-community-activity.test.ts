import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { addOnlineMembersToBaseline, getSimulatedOnlineCount } from "../src/lib/simulated-community-activity"
import { countUniqueOnlineMembers } from "../src/lib/runtime-health"

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


test("live members are added to the generated baseline without replacing it", () => {
  assert.equal(addOnlineMembersToBaseline(621, 1), 622)
  assert.equal(addOnlineMembersToBaseline(621, 0), 621)
  assert.equal(addOnlineMembersToBaseline(621, 3), 624)
})

test("online members count unique accounts rather than socket connections", () => {
  assert.equal(countUniqueOnlineMembers([
    { userId: "member-a" },
    { userId: "member-a" },
    { userId: "member-b" },
    { userId: "" },
  ]), 2)
})

test("community activity exposes a combined count without the old illustrative tooltip", async () => {
  const route = await readFile(new URL("../src/app/api/community/activity/route.ts", import.meta.url), "utf8")
  const browser = await readFile(new URL("../src/components/browser-panel.tsx", import.meta.url), "utf8")
  assert.match(route, /allTimePeak:\s*1064/)
  assert.match(route, /realOnlineCount:\s*onlineMembers/)
  assert.doesNotMatch(route, /simulated:\s*true/)
  assert.match(browser, /title="Online members\\."/)
  assert.doesNotMatch(browser, /Illustrative community activity figures/)
})
