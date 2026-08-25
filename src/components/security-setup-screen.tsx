"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Copy, Download, KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { DEFAULT_OS_WALLPAPER } from "@/lib/os-settings"

const QUESTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What was the name of your first school?",
  "What is the middle name of your oldest sibling?",
  "What was the name of the street you grew up on?",
  "Custom question",
] as const

async function securityPost(body: Record<string, unknown>) {
  const response = await fetch("/api/features/security", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Security setup failed")
  return data
}

export function SecuritySetupScreen() {
  const { user, setUser } = useAuth()
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [questionChoice, setQuestionChoice] = useState<(typeof QUESTIONS)[number]>(QUESTIONS[0])
  const [customQuestion, setCustomQuestion] = useState("")
  const [securityAnswer, setSecurityAnswer] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const question = useMemo(() => questionChoice === "Custom question" ? customQuestion.trim() : questionChoice, [customQuestion, questionChoice])

  const begin = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) return setError("The new passwords do not match")
    if (question.length < 8) return setError("Choose or enter a longer security question")
    setBusy(true)
    try {
      const data = await securityPost({ action: "begin-security-setup", newPassword, securityQuestion: question, securityAnswer })
      setCodes(Array.isArray(data.newRecoveryCodes) ? data.newRecoveryCodes.filter((value: unknown): value is string => typeof value === "string") : [])
      setNewPassword("")
      setConfirmPassword("")
      setSecurityAnswer("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Security setup failed")
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    setError("")
    try {
      const data = await securityPost({ action: "complete-security-setup" })
      if (!data?.user) throw new Error("The updated account could not be loaded")
      setUser(data.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish security setup")
    } finally {
      setBusy(false)
    }
  }

  const recoveryText = `Synnical recovery codes for @${user?.username || "account"}\n\n${codes.join("\n")}\n\nEach code works once. Keep these private.`
  const downloadCodes = () => {
    const blob = new Blob([recoveryText], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `synnical-recovery-${user?.username || "account"}.txt`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#050507] p-4 text-white">
    <div className="pointer-events-none absolute inset-0 scale-[1.02] bg-cover bg-center opacity-30 blur-[1px]" style={{ backgroundImage: `url(${DEFAULT_OS_WALLPAPER})` }} />
    <div className="absolute inset-0 bg-black/65 backdrop-blur-md" />
    <div className="relative z-10 w-full max-w-2xl rounded-3xl border border-white/15 bg-[#111116]/92 p-6 shadow-2xl md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-sky-300"><ShieldCheck className="h-6 w-6" /></div>
        <div><p className="text-xs font-medium uppercase tracking-[0.2em] text-sky-300/80">Synnical OS security update</p><h1 className="mt-1 text-2xl font-semibold">Secure your account before continuing</h1><p className="mt-2 text-sm leading-6 text-white/50">This one-time setup changes your password, adds a recovery question, and creates one-time recovery codes. After you save the codes, future logins go straight to your desktop.</p></div>
      </div>

      {!codes.length ? <form onSubmit={begin} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-xs text-white/55"><span>New password</span><input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/70" required /></label>
          <label className="space-y-1.5 text-xs text-white/55"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/70" required /></label>
        </div>
        <div className="h-px bg-white/10" />
        <label className="block space-y-1.5 text-xs text-white/55"><span>Security question</span><select value={questionChoice} onChange={(e)=>setQuestionChoice(e.target.value as (typeof QUESTIONS)[number])} className="w-full rounded-xl border border-white/10 bg-[#111] px-3 py-2.5 text-sm text-white outline-none">{QUESTIONS.map((value)=><option key={value} value={value}>{value}</option>)}</select></label>
        {questionChoice === "Custom question" ? <label className="block space-y-1.5 text-xs text-white/55"><span>Your question</span><input value={customQuestion} onChange={(e)=>setCustomQuestion(e.target.value)} maxLength={180} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/70" required /></label> : null}
        <label className="block space-y-1.5 text-xs text-white/55"><span>Security answer</span><input type="password" value={securityAnswer} onChange={(e)=>setSecurityAnswer(e.target.value)} maxLength={220} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400/70" required /><span className="block text-[11px] leading-5 text-white/35">The answer is hashed. Password recovery also requires one of your one-time recovery codes, so the question is not enough on its own.</span></label>
        {error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p> : null}
        <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-black hover:bg-sky-400 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Change password and create recovery codes</button>
      </form> : <div>
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100"><CheckCircle2 className="h-5 w-5" />Password and recovery question saved. Save these codes before entering Synnical OS.</div>
        <div className="grid gap-2 sm:grid-cols-2">{codes.map((code)=><code key={code} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-center text-sm tracking-wider">{code}</code>)}</div>
        <p className="mt-4 text-xs leading-5 text-white/40">Each code works once. Synnical will never show this newly generated set again after you finish this screen.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => navigator.clipboard?.writeText(recoveryText).catch(()=>{})} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm hover:bg-white/[0.08]"><Copy className="h-4 w-4" />Copy codes</button><button type="button" onClick={downloadCodes} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm hover:bg-white/[0.08]"><Download className="h-4 w-4" />Download codes</button></div>
        {error ? <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p> : null}
        <button type="button" disabled={busy} onClick={finish} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-black hover:bg-sky-400 disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}I saved these codes · Enter Synnical OS</button>
      </div>}
    </div>
  </div>
}
