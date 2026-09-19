"use client"
import { useSetting } from "@/lib/settings-runtime"
export function AppearanceModeControl() {
  const [mode, setMode] = useSetting<string>("appearance.mode", "light")
  return <fieldset className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><legend className="px-2 text-sm font-semibold">Appearance</legend><div className="flex gap-4">{["light", "dark"].map(value => <label key={value} className="flex items-center gap-2 capitalize"><input type="radio" name="base-appearance" value={value} checked={mode === value} onChange={() => setMode(value)} />{value}</label>)}</div><p className="mt-2 text-xs text-[var(--synnical-muted)]">Your accent theme stays separate.</p></fieldset>
}
