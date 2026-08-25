import { createHash, randomBytes } from "crypto"
import { db } from "@/lib/db"
import { getPreference, setPreference } from "@/lib/feature-platform"

export const LOCKDOWN_KEY = "security.lockdown.v1"

export async function isAccountLockedDown(userId: string): Promise<boolean> {
  return Boolean(await getPreference(userId, LOCKDOWN_KEY, false))
}

export async function setAccountLockdown(userId: string, enabled: boolean) {
  await setPreference(userId, LOCKDOWN_KEY, Boolean(enabled))
  await logSecurityEvent(userId, enabled ? "lockdown_enabled" : "lockdown_disabled", enabled
    ? "Emergency account lockdown was enabled. Outgoing messages and gifts are blocked."
    : "Emergency account lockdown was disabled.")
}

export async function logSecurityEvent(userId: string, type: string, message: string, metadata: unknown = {}) {
  await db.securityEvent.create({
    data: {
      userId,
      type: type.slice(0, 80),
      message: message.slice(0, 500),
      metadataJson: JSON.stringify(metadata ?? {}).slice(0, 4000),
    },
  }).catch(() => {})
}

export function recoveryCodeHash(code: string): string {
  return createHash("sha256").update(`synnical-recovery-v1\0${code.trim().toUpperCase()}`).digest("hex")
}

export function makeRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(10).toString("hex").toUpperCase()
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`
  })
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const hash = recoveryCodeHash(code)
  const row = await db.recoveryCode.findFirst({ where: { userId, codeHash: hash, usedAt: null } })
  if (!row) return false
  const claimed = await db.recoveryCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
  if (!claimed.count) return false
  await logSecurityEvent(userId, "recovery_code_used", "A recovery code was used to sign in.")
  return true
}
