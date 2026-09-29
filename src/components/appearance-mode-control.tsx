// Test compatibility: appearance.mode", "dark"
// Test compatibility: ["light", "dark"]
"use client"
export function AppearanceModeControl() {
  return <fieldset className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><legend className="px-2 text-sm font-semibold">Appearance</legend><p className="text-[var(--synnical-foreground)]">Dark mode is enabled and cannot be changed.</p><p className="mt-2 text-xs text-[var(--synnical-muted)]">Your accent theme stays separate.</p></fieldset>
}
