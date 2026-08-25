"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { PhoneCall, PhoneOff, Mic, MicOff, Video, VideoOff, MonitorUp, Copy, Users, Gauge, RadioTower } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type PeerInfo = { socketId: string; userId: string; username: string; displayName: string; muted: boolean; video: boolean; screen: boolean }
type RoomInfo = { code: string; kind: "voice" | "video"; createdBy: string }
type Signal = { type?: string; sdp?: string; candidate?: any; sdpMid?: string | null; sdpMLineIndex?: number | null }

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]
function iceServers(): RTCIceServer[] {
  try {
    const configured = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON
    if (configured) { const parsed = JSON.parse(configured); if (Array.isArray(parsed) && parsed.length) return parsed }
  } catch {}
  return DEFAULT_ICE
}

function RemoteTile({ info, stream }: { info: PeerInfo; stream?: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [volume, setVolume] = useState(100)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null }, [stream])
  useEffect(() => { if (ref.current) ref.current.volume = volume / 100 }, [volume])
  return <div className="relative min-h-48 overflow-hidden rounded-xl border border-white/10 bg-[#070707]">
    <video ref={ref} autoPlay playsInline className={cn("h-full min-h-48 w-full object-cover", !info.video && !info.screen && "opacity-0")} />
    {!info.video && !info.screen && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-white/8 text-2xl font-semibold">{(info.displayName || info.username).slice(0,1).toUpperCase()}</div></div>}
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black via-black/70 to-transparent p-3 pt-8"><span className="min-w-0 flex-1 truncate text-xs font-medium">{info.displayName || info.username}{info.screen ? " · sharing screen" : ""}</span>{info.muted ? <MicOff className="h-3.5 w-3.5 text-red-300" /> : <Mic className="h-3.5 w-3.5 text-emerald-300" />}<input aria-label={`Volume for ${info.displayName || info.username}`} className="w-20 accent-white" type="range" min={0} max={100} value={volume} onChange={e=>setVolume(Number(e.target.value))} /></div>
  </div>
}

export function CallsPanel() {
  const socketRef = useRef<Socket | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null)
  const screenTrackRef = useRef<MediaStreamTrack | null>(null)
  const pcsRef = useRef(new Map<string, RTCPeerConnection>())
  const candidateQueueRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [invite, setInvite] = useState("")
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({})
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [muted, setMuted] = useState(false)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [screen, setScreen] = useState(false)
  const [pushToTalk, setPushToTalk] = useState(false)
  const [lowBandwidth, setLowBandwidth] = useState(false)
  const [status, setStatus] = useState("Ready")

  const closePeer = useCallback((socketId: string) => {
    const pc = pcsRef.current.get(socketId); if (pc) { try { pc.close() } catch {}; pcsRef.current.delete(socketId) }
    candidateQueueRef.current.delete(socketId)
    setPeers(current => { const next={...current}; delete next[socketId]; return next })
    setStreams(current => { const next={...current}; delete next[socketId]; return next })
  }, [])

  const stopLocal = useCallback(() => {
    for (const track of localStreamRef.current?.getTracks() || []) try { track.stop() } catch {}
    const screenTrack = screenTrackRef.current; screenTrackRef.current = null; if (screenTrack && screenTrack.readyState !== "ended") try { screenTrack.stop() } catch {}
    localStreamRef.current = null; cameraTrackRef.current = null; setLocalStream(null); if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [])

  const leave = useCallback(() => {
    socketRef.current?.emit("call-leave")
    for (const id of [...pcsRef.current.keys()]) closePeer(id)
    stopLocal(); setRoom(null); setPeers({}); setStreams({}); setScreen(false); setStatus("Ready")
  }, [closePeer, stopLocal])

  const obtainMedia = useCallback(async (kind: "voice" | "video") => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose microphone/camera access.")
    stopLocal()
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: kind === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } : false })
    localStreamRef.current = stream; cameraTrackRef.current = stream.getVideoTracks()[0] || null; setLocalStream(stream); setMuted(false); setVideoEnabled(kind === "video")
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    return stream
  }, [stopLocal])

  const applyBandwidth = useCallback(async (pc: RTCPeerConnection) => {
    for (const sender of pc.getSenders()) {
      if (!sender.track) continue
      const parameters = sender.getParameters(); parameters.encodings ||= [{}]
      if (lowBandwidth) parameters.encodings[0].maxBitrate = sender.track.kind === "video" ? 350_000 : 24_000
      else delete parameters.encodings[0].maxBitrate
      try { await sender.setParameters(parameters) } catch {}
    }
  }, [lowBandwidth])

  const sendSignal = (targetSocketId: string, signal: any) => socketRef.current?.emit("call-signal", { targetSocketId, signal })
  const createPeer = useCallback((socketId: string) => {
    const existing = pcsRef.current.get(socketId); if (existing) return existing
    const pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: "max-bundle" })
    pcsRef.current.set(socketId, pc)
    for (const track of localStreamRef.current?.getTracks() || []) pc.addTrack(track, localStreamRef.current!)
    pc.onicecandidate = event => { if (event.candidate) sendSignal(socketId, { type: "ice", candidate: event.candidate.toJSON() }) }
    pc.ontrack = event => { const stream = event.streams[0] || new MediaStream([event.track]); setStreams(current => ({ ...current, [socketId]: stream })) }
    pc.onconnectionstatechange = () => { if (["failed","closed"].includes(pc.connectionState)) closePeer(socketId); else if (pc.connectionState === "connected") setStatus("Connected") }
    return pc
  }, [closePeer])

  const offerPeer = useCallback(async (socketId: string) => {
    const pc = createPeer(socketId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); sendSignal(socketId, { type: "offer", sdp: offer.sdp })
  }, [createPeer])

  const flushCandidates = useCallback(async (socketId: string, pc: RTCPeerConnection) => {
    const queued = candidateQueueRef.current.get(socketId) || []; candidateQueueRef.current.delete(socketId)
    for (const candidate of queued) try { await pc.addIceCandidate(candidate) } catch {}
  }, [])

  useEffect(() => {
    const socket = io(window.location.origin, { path: "/socket.io", transports: ["websocket", "polling"], withCredentials: true })
    socketRef.current = socket
    socket.on("call-error", (data: any) => { setStatus("Call error"); toast.error(data?.message || "Call failed") })
    socket.on("call-room", async (data: any) => {
      try {
        const kind: "voice" | "video" = data?.kind === "voice" ? "voice" : "video"; setStatus("Requesting microphone/camera…")
        await obtainMedia(kind); setRoom({ code: String(data.code), kind, createdBy: String(data.createdBy || "") }); setInvite(String(data.code)); setPeers(Object.fromEntries((data.peers || []).map((p: PeerInfo) => [p.socketId,p]))); setStatus("Connecting…")
        for (const peer of data.peers || []) await offerPeer(peer.socketId)
      } catch (error) { socket.emit("call-leave"); setStatus("Media permission failed"); toast.error(error instanceof Error ? error.message : "Could not open microphone/camera") }
    })
    socket.on("call-peer-joined", ({ peer }: { peer: PeerInfo }) => setPeers(current => ({ ...current, [peer.socketId]: peer })))
    socket.on("call-peer-left", ({ socketId }: { socketId: string }) => closePeer(socketId))
    socket.on("call-peer-state", ({ peer }: { peer: PeerInfo }) => setPeers(current => ({ ...current, [peer.socketId]: peer })))
    socket.on("call-signal", async ({ fromSocketId, signal }: { fromSocketId: string; signal: Signal }) => {
      try {
        const pc = createPeer(fromSocketId)
        if (signal.type === "offer" && signal.sdp) { await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp }); await flushCandidates(fromSocketId, pc); const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); sendSignal(fromSocketId,{type:"answer",sdp:answer.sdp}) }
        else if (signal.type === "answer" && signal.sdp) { await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp }); await flushCandidates(fromSocketId, pc) }
        else if (signal.type === "ice" && signal.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate); else candidateQueueRef.current.set(fromSocketId,[...(candidateQueueRef.current.get(fromSocketId)||[]),signal.candidate]) }
      } catch (error) { console.error("[Calls] signalling failed", error) }
    })
    return () => { socket.emit("call-leave"); socket.removeAllListeners(); socket.disconnect(); socketRef.current=null; for (const pc of pcsRef.current.values()) try{pc.close()}catch{}; pcsRef.current.clear(); stopLocal() }
  }, [closePeer, createPeer, flushCandidates, obtainMedia, offerPeer, stopLocal])

  useEffect(() => { if (localVideoRef.current) localVideoRef.current.srcObject = localStream }, [localStream])
  useEffect(() => { for (const pc of pcsRef.current.values()) void applyBandwidth(pc) }, [lowBandwidth, applyBandwidth])

  useEffect(() => {
    if (!pushToTalk) return
    const track = localStreamRef.current?.getAudioTracks()[0]; if (track) track.enabled = false; socketRef.current?.emit("call-state", { muted: true })
    const down = (event: KeyboardEvent) => { const target=event.target as HTMLElement|null; if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return; if (event.code === "KeyV" && !event.repeat) { const audio=localStreamRef.current?.getAudioTracks()[0]; if(audio) audio.enabled=true; socketRef.current?.emit("call-state", { muted: false }) } }
    const up = (event: KeyboardEvent) => { if (event.code === "KeyV") { const audio=localStreamRef.current?.getAudioTracks()[0]; if(audio) audio.enabled=false; socketRef.current?.emit("call-state", { muted: true }) } }
    window.addEventListener("keydown",down); window.addEventListener("keyup",up)
    return () => { window.removeEventListener("keydown",down); window.removeEventListener("keyup",up); const audio=localStreamRef.current?.getAudioTracks()[0]; if(audio) audio.enabled=!muted; socketRef.current?.emit("call-state", { muted }) }
  }, [pushToTalk, muted])

  const toggleMute = () => { const next=!muted; setMuted(next); const track=localStreamRef.current?.getAudioTracks()[0]; if(track) track.enabled=pushToTalk ? false : !next; socketRef.current?.emit("call-state",{muted:next}) }
  const toggleVideo = () => { const track=cameraTrackRef.current; if(!track) return toast.error("This is an audio-only call"); const next=!videoEnabled; track.enabled=next; setVideoEnabled(next); socketRef.current?.emit("call-state",{video:next}) }
  const shareScreen = async () => {
    if (screen) return stopScreenShare()
    try {
      const media=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}); const track=media.getVideoTracks()[0]; if(!track) return; screenTrackRef.current = track
      for(const [id,pc] of pcsRef.current){ const sender=pc.getSenders().find(s=>s.track?.kind==="video"); if(sender) await sender.replaceTrack(track); else {pc.addTrack(track,media); await offerPeer(id)} }
      setScreen(true); socketRef.current?.emit("call-state",{screen:true,video:true}); track.onended=()=>void stopScreenShare()
      if(localVideoRef.current) localVideoRef.current.srcObject=media
    } catch (error) { if ((error as Error)?.name !== "NotAllowedError") toast.error("Screen sharing could not start") }
  }
  const stopScreenShare = async () => {
    const sharing = screenTrackRef.current; screenTrackRef.current = null; if (sharing && sharing.readyState !== "ended") try { sharing.stop() } catch {}
    const camera=cameraTrackRef.current
    for(const [id,pc] of pcsRef.current){ const sender=pc.getSenders().find(s=>s.track?.kind==="video"); if(sender) await sender.replaceTrack(camera); else if(camera){pc.addTrack(camera,localStreamRef.current!);await offerPeer(id)} }
    setScreen(false); socketRef.current?.emit("call-state",{screen:false,video:Boolean(camera?.enabled)}); if(localVideoRef.current) localVideoRef.current.srcObject=localStreamRef.current
  }

  if (!room) return <section className="grid h-full place-items-center bg-black p-6 text-white"><div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#070707] p-6"><PhoneCall className="h-8 w-8" /><h1 className="mt-4 text-2xl font-semibold">Synnical Calls</h1><p className="mt-2 text-sm leading-6 text-white/45">Create an authenticated Synnical voice/video room or join with an invite code. Media uses WebRTC; Synnical&apos;s Socket.IO server only relays signalling.</p><div className="mt-6 grid gap-2 sm:grid-cols-2"><Button onClick={()=>socketRef.current?.emit("call-create",{kind:"voice"})}><Mic className="mr-2 h-4 w-4" />New voice call</Button><Button onClick={()=>socketRef.current?.emit("call-create",{kind:"video"})}><Video className="mr-2 h-4 w-4" />New video call</Button></div><div className="my-5 h-px bg-white/10" /><div className="flex gap-2"><Input value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())} placeholder="Invite code" /><Button variant="outline" onClick={()=>invite.trim()&&socketRef.current?.emit("call-join",{code:invite})}>Join</Button></div><p className="mt-4 text-[11px] text-white/30">Group rooms support up to 6 participants. Direct WebRTC can fail on restrictive networks unless a TURN server is configured with NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON.</p></div></section>

  return <section className="flex h-full min-h-0 flex-col bg-black text-white">
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#050505] px-4 py-3"><RadioTower className="h-4 w-4" /><div className="mr-auto"><p className="text-sm font-semibold">{room.kind === "video" ? "Video" : "Voice"} call · {status}</p><p className="text-[10px] text-white/35">Invite {room.code} · {Object.keys(peers).length+1} connected</p></div><Button size="sm" variant="outline" onClick={async()=>{await navigator.clipboard.writeText(room.code);toast.success("Call invite copied")}}><Copy className="mr-1 h-3.5 w-3.5" />Invite</Button><Button size="sm" variant="destructive" onClick={leave}><PhoneOff className="mr-1 h-3.5 w-3.5" />Leave</Button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scroll"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><div className="relative min-h-48 overflow-hidden rounded-xl border border-white/10 bg-[#070707]"><video ref={localVideoRef} autoPlay muted playsInline className={cn("h-full min-h-48 w-full object-cover", room.kind === "voice" && !screen && "opacity-0")} />{room.kind === "voice" && !screen && <div className="absolute inset-0 grid place-items-center"><div className="grid h-20 w-20 place-items-center rounded-full bg-white/8"><Users className="h-8 w-8" /></div></div>}<span className="absolute bottom-3 left-3 rounded bg-black/65 px-2 py-1 text-xs">You{screen?" · sharing screen":""}</span></div>{Object.values(peers).map(peer=><RemoteTile key={peer.socketId} info={peer} stream={streams[peer.socketId]} />)}</div></div>
    <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-[#050505] p-3"><Button variant={muted?"destructive":"outline"} onClick={toggleMute}>{muted?<MicOff className="mr-2 h-4 w-4"/>:<Mic className="mr-2 h-4 w-4"/>}{muted?"Unmute":"Mute"}</Button><Button variant="outline" disabled={!cameraTrackRef.current} onClick={toggleVideo}>{videoEnabled?<Video className="mr-2 h-4 w-4"/>:<VideoOff className="mr-2 h-4 w-4"/>}Camera</Button><Button variant={screen?"default":"outline"} onClick={()=>void shareScreen()}><MonitorUp className="mr-2 h-4 w-4" />{screen?"Stop sharing":"Share screen"}</Button><Button variant={pushToTalk?"default":"outline"} onClick={()=>setPushToTalk(v=>!v)}><RadioTower className="mr-2 h-4 w-4" />{pushToTalk?"Hold V to talk":"Push to talk"}</Button><Button variant={lowBandwidth?"default":"outline"} onClick={()=>setLowBandwidth(v=>!v)}><Gauge className="mr-2 h-4 w-4" />Low bandwidth</Button></footer>
  </section>
}
