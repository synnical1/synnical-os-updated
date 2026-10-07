import test from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { createSmokeDiagnostics } from "../scripts/smoke-diagnostics.mjs"

test("smoke failure diagnostics preserve errors and redact credentials, cookies and hashes", () => {
  const key = randomBytes(32).toString("base64url")
  const password = randomBytes(24).toString("base64url")
  const session = randomBytes(24).toString("base64url")
  const device = randomBytes(24).toString("base64url")
  const hash = randomBytes(32).toString("hex")
  const diagnostic = createSmokeDiagnostics({ STRATUS_API_KEY:key })
  diagnostic.remember({ data:{ password, securityAnswer:password }, cookie:`session=${session}; device=${device}`, headers:{Authorization:`Bearer ${key}`} })
  const result = diagnostic.redact(`PrismaClientKnownRequestError P2028: transaction timeout\n${key}\n${password}\n${session}\n${device}\n${hash}`)
  for (const secret of [key,password,session,device,hash]) assert.ok(!result.includes(secret))
  assert.match(result, /PrismaClientKnownRequestError P2028: transaction timeout/)
  assert.equal((result.match(/\[redacted\]/g) || []).length, 5)
})
