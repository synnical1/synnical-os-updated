import test from "node:test"
import assert from "node:assert/strict"
import {
  countUniqueOnlineUsers,
  runtimeHealthSnapshot,
  setOnlineUserCount,
} from "../src/lib/runtime-health"

test("online count counts distinct accounts, not connected browser tabs", () => {
  const users = [
    { userId: "user-1" },
    { userId: "user-1" },
    { userId: "user-2" },
    { userId: "user-3" },
  ]
  assert.equal(countUniqueOnlineUsers(users), 3)
})

test("online count ignores entries without a usable account id", () => {
  const users = [
    { userId: "user-1" },
    { userId: "" },
    { userId: "   " },
  ]
  assert.equal(countUniqueOnlineUsers(users), 1)
})

test("runtime health exposes a non-negative integer online account count", () => {
  const previous = runtimeHealthSnapshot().onlineUsers
  try {
    setOnlineUserCount(17.9)
    assert.equal(runtimeHealthSnapshot().onlineUsers, 17)
    setOnlineUserCount(-4)
    assert.equal(runtimeHealthSnapshot().onlineUsers, 0)
  } finally {
    setOnlineUserCount(previous)
  }
})
