"use client"

import { useEffect, useState } from "react"

type BatteryLike = {
  level: number
  charging: boolean
  chargingTime?: number
  dischargingTime?: number
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: (type: string, cb: () => void) => void
}

type ConnectionLike = {
  effectiveType?: string
  type?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
  addEventListener?: (type: string, cb: () => void) => void
  removeEventListener?: (type: string, cb: () => void) => void
}

export type SystemStatus = {
  online: boolean
  networkType: string
  effectiveType: string
  downlink: number | null
  rtt: number | null
  saveData: boolean
  batterySupported: boolean
  batteryLevel: number | null
  charging: boolean | null
  language: string
  platform: string
}

export function useSystemStatus(): SystemStatus {
  const [status, setStatus] = useState<SystemStatus>(() => ({
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    networkType: "",
    effectiveType: "",
    downlink: null,
    rtt: null,
    saveData: false,
    batterySupported: false,
    batteryLevel: null,
    charging: null,
    language: typeof navigator === "undefined" ? "" : navigator.language,
    platform: typeof navigator === "undefined" ? "" : navigator.platform,
  }))

  useEffect(() => {
    let battery: BatteryLike | null = null
    const nav = navigator as Navigator & { connection?: ConnectionLike; mozConnection?: ConnectionLike; webkitConnection?: ConnectionLike; getBattery?: () => Promise<BatteryLike> }
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection
    const updateNetwork = () => setStatus((current) => ({
      ...current,
      online: navigator.onLine,
      networkType: typeof connection?.type === "string" ? connection.type : "",
      effectiveType: typeof connection?.effectiveType === "string" ? connection.effectiveType : "",
      downlink: typeof connection?.downlink === "number" && Number.isFinite(connection.downlink) ? connection.downlink : null,
      rtt: typeof connection?.rtt === "number" && Number.isFinite(connection.rtt) ? connection.rtt : null,
      saveData: Boolean(connection?.saveData),
    }))
    const updateBattery = () => setStatus((current) => ({
      ...current,
      batterySupported: Boolean(battery),
      batteryLevel: battery ? Math.round(Math.max(0, Math.min(1, battery.level)) * 100) : null,
      charging: battery ? Boolean(battery.charging) : null,
    }))
    updateNetwork()
    window.addEventListener("online", updateNetwork)
    window.addEventListener("offline", updateNetwork)
    connection?.addEventListener?.("change", updateNetwork)
    if (typeof nav.getBattery === "function") nav.getBattery().then((value) => {
      battery = value
      updateBattery()
      battery.addEventListener("levelchange", updateBattery)
      battery.addEventListener("chargingchange", updateBattery)
    }).catch(() => {})
    return () => {
      window.removeEventListener("online", updateNetwork)
      window.removeEventListener("offline", updateNetwork)
      connection?.removeEventListener?.("change", updateNetwork)
      battery?.removeEventListener("levelchange", updateBattery)
      battery?.removeEventListener("chargingchange", updateBattery)
    }
  }, [])

  return status
}
