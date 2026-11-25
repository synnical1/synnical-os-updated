import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")

test("guest Start-menu account action opens sign-in, not Profile", () => {
  const desktop = read("../src/components/desktop-shell.tsx")
  assert.match(desktop, /openPanel\(user\s*\?\s*"profile"\s*:\s*"auth"\)/)
  assert.match(desktop, /user\?\.username\s*\|\|\s*"Sign in"/)
})

test("Chat is only exposed to authenticated OWNER accounts", () => {
  const shell = read("../src/components/app-shell.tsx")
  assert.match(shell, /id: "chat"[^\n]*ownerOnly: true, authOnly: true/)
  assert.match(shell, /target === "chat" && isOwner/)
  assert.match(shell, /lazy\(\(\) => import\("@\/components\/chat-panel"\)/)
})

test("chat REST feature routes reject non-owner accounts", () => {
  for (const path of [
    "../src/app/api/chat/channels/route.ts",
    "../src/app/api/chat/messages/route.ts",
    "../src/app/api/chat/users/route.ts",
    "../src/app/api/chat/unread/route.ts",
    "../src/app/api/chat/image/upload/route.ts",
    "../src/app/api/dms/list/route.ts",
    "../src/app/api/dms/safety/route.ts",
    "../src/app/api/channels/group/route.ts",
    "../src/app/api/channels/announcement/route.ts",
    "../src/app/api/messages/[id]/route.ts",
    "../src/app/api/messages/edit/route.ts",
    "../src/app/api/voice/upload/route.ts",
    "../src/app/api/features/chat/route.ts",
  ]) {
    assert.match(read(path), /role !== "OWNER"/, path)
  }
})

test("Socket.IO channel access re-reads the live owner role", () => {
  const server = read("../src/lib/chat-server.ts")
  assert.match(server, /current\?\.role !== "OWNER"/)
})

test("Rust channel and history routes are session-authenticated", () => {
  const rust = read("../rust/synnical-chat/src/auth.rs")
  assert.match(rust, /"stratus_session"/)
  assert.match(rust, /julianday\(s\.expiresAt\) > julianday\('now'\)/)
  assert.match(rust, /is_owner\(&actor\.role\)/)
})
