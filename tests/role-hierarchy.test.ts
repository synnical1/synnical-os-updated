import test from "node:test"
import assert from "node:assert/strict"
import { canAssignRole, canModerateTarget, canonicalRole, roleRank } from "../src/lib/roles"

test("legacy Head Admin is canonical Admin, never Owner-level", () => {
  assert.equal(canonicalRole("HEAD_ADMIN"), "ADMIN")
  assert.equal(roleRank("HEAD_ADMIN"), roleRank("ADMIN"))
  assert.ok(roleRank("OWNER") > roleRank("HEAD_ADMIN"))
})

test("staff hierarchy is Owner > Admin > Mod > Member", () => {
  assert.ok(canModerateTarget("OWNER", "ADMIN"))
  assert.ok(canModerateTarget("ADMIN", "MOD"))
  assert.ok(canModerateTarget("MOD", "MEMBER"))
  assert.equal(canModerateTarget("ADMIN", "ADMIN"), false)
  assert.equal(canModerateTarget("MOD", "ADMIN"), false)
})

test("new role assignment never creates Owner or Head Admin", () => {
  assert.ok(canAssignRole("OWNER", "ADMIN"))
  assert.ok(canAssignRole("OWNER", "MOD"))
  assert.ok(canAssignRole("ADMIN", "MOD"))
  assert.equal(canAssignRole("ADMIN", "ADMIN"), false)
  assert.equal(canAssignRole("OWNER", "OWNER"), false)
  assert.equal(canAssignRole("OWNER", "HEAD_ADMIN"), false)
})
