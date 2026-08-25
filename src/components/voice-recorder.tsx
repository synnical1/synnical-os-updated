"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Mic, Square, Loader2, Play, Pause } from "lucide-react"
import { api } from "@/lib/api"
import { toast } from "sonner"
import { readSetting } from "@/lib/settings-runtime"

type AudioElementWithSink = HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }

function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return undefined
}

function selectedInputConstraints(): MediaTrackConstraints {
  const inputDevice = readSetting("voice.inputDevice", "default")
  return {
    ...(inputDevice !== "default" ? { deviceId: { exact: inputDevice } } : {}),
    echoCancellation: readSetting("voice.echoCancellation", true),
    noiseSuppression: readSetting("voice.noiseSuppression", true),
  }
}

async function requestMicrophone(): Promise<MediaStream> {
  const constraints = selectedInputConstraints()
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints })
  } catch (error) {
    // A stored device id can become invalid after unplugging a headset or when
    // browser permissions are reset. Fall back only for that case; genuine
    // permission denials are surfaced to the user instead of silently ignored.
    if ("deviceId" in constraints && error instanceof DOMException && ["NotFoundError", "OverconstrainedError"].includes(error.name)) {
      toast.message("Selected microphone is unavailable; using the system default")
      const { deviceId: _deviceId, ...fallback } = constraints
      return navigator.mediaDevices.getUserMedia({ audio: fallback })
    }
    throw error
  }
}

export function VoiceRecorder({ onSent, disabled }: { onSent: (voiceUrl: string) => void; disabled?: boolean }) {
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [duration, setDuration] = useState(0)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const sourceStreamRef = useRef<MediaStream | null>(null)
  const recorderStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const releaseAudio = useCallback(() => {
    sourceStreamRef.current?.getTracks().forEach((track) => track.stop())
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop())
    sourceStreamRef.current = null
    recorderStreamRef.current = null
    const ctx = audioContextRef.current
    audioContextRef.current = null
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {})
  }, [])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice recording is not supported by this browser")
      return
    }

    try {
      const sourceStream = await requestMicrophone()
      sourceStreamRef.current = sourceStream

      // Input Volume is a real recording gain control, not a decorative slider.
      // WebAudio is used because MediaTrackConstraints.volume is not consistently
      // implemented across Chromium/Firefox/Safari.
      const inputVolume = Math.max(0, Math.min(100, readSetting("voice.inputVolume", 100)))
      let recordingStream = sourceStream
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextCtor) {
        const ctx = new AudioContextCtor()
        const source = ctx.createMediaStreamSource(sourceStream)
        const gain = ctx.createGain()
        const destination = ctx.createMediaStreamDestination()
        gain.gain.value = inputVolume / 100
        source.connect(gain)
        gain.connect(destination)
        recordingStream = destination.stream
        recorderStreamRef.current = recordingStream
        audioContextRef.current = ctx
      }

      const mimeType = recorderMimeType()
      const recorder = mimeType ? new MediaRecorder(recordingStream, { mimeType }) : new MediaRecorder(recordingStream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        releaseAudio()
        setRecording(false)
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        toast.error("Voice recording failed")
      }
      recorder.onstop = async () => {
        const blobType = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm"
        const blob = new Blob(chunksRef.current, { type: blobType })
        releaseAudio()
        if (blob.size < 1000) { toast.error("Recording too short"); return }

        setUploading(true)
        try {
          const { url } = await api.uploadVoice(blob)
          onSent(url)
          toast.success("Voice message sent")
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Upload failed")
        } finally {
          setUploading(false)
        }
      }
      recorder.start(250)
      mediaRef.current = recorder
      setRecording(true)
      setDuration(0)
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
    } catch (error) {
      releaseAudio()
      if (error instanceof DOMException && error.name === "NotAllowedError") toast.error("Microphone access denied")
      else toast.error(error instanceof Error ? error.message : "Could not start microphone")
    }
  }, [onSent, releaseAudio])

  const stopRecording = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop()
    setRecording(false)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    const recorder = mediaRef.current
    if (recorder && recorder.state !== "inactive") {
      // Unmount means the chat composer disappeared; do not upload a surprise
      // partial recording after navigation.
      recorder.onstop = null
      try { recorder.stop() } catch {}
    }
    releaseAudio()
  }, [releaseAudio])

  if (uploading) {
    return <Button size="icon" variant="ghost" className="h-9 w-9" disabled><Loader2 className="h-4 w-4 animate-spin" /></Button>
  }

  if (recording) {
    return (
      <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 rounded-lg px-2 py-1">
        <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs text-red-400 tabular-nums">{Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-300" onClick={stopRecording} aria-label="Stop recording">
          <Square className="h-3.5 w-3.5 fill-current" />
        </Button>
      </div>
    )
  }

  return (
    <Button size="icon" variant="ghost" className="h-9 w-9 text-[#888888] hover:text-white" onClick={startRecording} disabled={disabled} aria-label="Record voice message" title="Record voice message">
      <Mic className="h-4 w-4" />
    </Button>
  )
}

// Voice message playback honours the same global output controls as music and
// cloud gaming. Waveform peaks are derived from the actual uploaded audio, so
// seeking/speed controls are not decorative. setSinkId remains feature-detected
// because browser support varies.
export function VoiceMessage({ url, transcript }: { url: string; transcript?: string | null }) {
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [peaks, setPeaks] = useState<number[]>([])
  const audioRef = useRef<AudioElementWithSink | null>(null)

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
    const whole = Math.floor(seconds)
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
  }

  useEffect(() => {
    let cancelled = false
    const audio = new Audio(url) as AudioElementWithSink
    audio.preload = "metadata"
    audio.onloadedmetadata = () => { if (!cancelled) setDuration(Number.isFinite(audio.duration) ? audio.duration : 0) }
    audio.ontimeupdate = () => { if (!cancelled) setCurrentTime(audio.currentTime || 0) }
    audio.onplay = () => { if (!cancelled) setPlaying(true) }
    audio.onpause = () => { if (!cancelled) setPlaying(false) }
    audio.onended = () => { if (!cancelled) { setPlaying(false); setCurrentTime(audio.duration || 0) } }
    audio.onerror = () => { if (!cancelled) { setPlaying(false); toast.error("Could not play voice message") } }
    audio.playbackRate = speed
    audioRef.current = audio

    // Decode a bounded set of amplitude peaks for a real waveform. Failure is
    // non-fatal because some browser/media combinations can play audio that
    // AudioContext cannot decode.
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "include", cache: "force-cache" })
        if (!response.ok) return
        const bytes = await response.arrayBuffer()
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextCtor) return
        const ctx = new AudioContextCtor()
        try {
          const buffer = await ctx.decodeAudioData(bytes.slice(0))
          const channel = buffer.getChannelData(0)
          const bins = 48
          const step = Math.max(1, Math.floor(channel.length / bins))
          const next: number[] = []
          for (let i = 0; i < bins; i += 1) {
            const start = i * step
            const end = Math.min(channel.length, start + step)
            let peak = 0
            for (let j = start; j < end; j += 1) peak = Math.max(peak, Math.abs(channel[j] || 0))
            next.push(Math.max(0.08, Math.min(1, peak)))
          }
          if (!cancelled) {
            setPeaks(next)
            if (!duration && Number.isFinite(buffer.duration)) setDuration(buffer.duration)
          }
        } finally {
          if (ctx.state !== "closed") await ctx.close().catch(() => {})
        }
      } catch {
        // Playback remains available even if waveform decoding is unsupported.
      }
    })()

    return () => {
      cancelled = true
      audio.pause()
      audio.src = ""
      if (audioRef.current === audio) audioRef.current = null
    }
  }, [url])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  const applyOutput = useCallback(async (audio: AudioElementWithSink) => {
    audio.volume = Math.max(0, Math.min(1, readSetting("voice.outputVolume", 100) / 100))
    const outputDevice = readSetting("voice.outputDevice", "default")
    if (typeof audio.setSinkId === "function") {
      try {
        await audio.setSinkId(outputDevice === "default" ? "" : outputDevice)
      } catch {
        toast.message("Selected speaker is unavailable; using the system default")
        try { await audio.setSinkId("") } catch { /* speaker selection may be unsupported */ }
      }
    }
  }, [])

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    await applyOutput(audio)
    audio.playbackRate = speed
    try { await audio.play() }
    catch { setPlaying(false); toast.error("Could not play voice message") }
  }, [applyOutput, speed])

  const seek = (value: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(value)) return
    const bounded = Math.max(0, Math.min(duration || audio.duration || 0, value))
    audio.currentTime = bounded
    setCurrentTime(bounded)
  }

  const progress = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0
  return (
    <div className="mt-1 max-w-md rounded-lg border border-[#333] bg-[#101010] p-2.5">
      <div className="flex items-center gap-2">
        <button onClick={() => { void toggle() }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#383838] bg-black hover:bg-[#181818]" aria-label={playing ? "Pause voice message" : "Play voice message"}>
          {playing ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="relative flex h-7 items-center gap-[2px]" aria-hidden="true">
            {(peaks.length ? peaks : Array.from({ length: 48 }, () => 0.15)).map((peak, index) => {
              const reached = index / 48 <= progress
              return <span key={index} className={reached ? "w-[2px] rounded-full bg-white" : "w-[2px] rounded-full bg-[#4a4a4a]"} style={{ height: `${Math.round(5 + peak * 20)}px` }} />
            })}
          </div>
          <input type="range" min={0} max={Math.max(duration, 0.01)} step={0.05} value={Math.min(currentTime, Math.max(duration, 0.01))} onChange={(event) => seek(Number(event.target.value))} className="h-3 w-full cursor-pointer accent-white" aria-label="Seek voice message" />
          <div className="flex items-center justify-between text-[10px] text-[#777]"><span>{formatTime(currentTime)} / {formatTime(duration)}</span><label className="flex items-center gap-1">Speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded border border-[#333] bg-black px-1 py-0.5 text-[10px] text-white" aria-label="Voice playback speed"><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label></div>
        </div>
      </div>
      {transcript?.trim() ? <details className="mt-2 border-t border-[#252525] pt-2"><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-[#777]">Transcript</summary><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#b7b7b7]">{transcript.trim()}</p></details> : null}
    </div>
  )
}
