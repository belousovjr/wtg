import type { VideoAction } from "./video"
import { validRoomCommand, type RoomCommand } from "./room-protocol"
export const CHANNEL = "wtg:local:v1"
export type FrameTarget = { tabId: number; frameId: number }
export type RuntimeStatus = { instanceId: string; startedAt: number; webRtcAvailable: boolean }
export type FrameStatus = { url: string; title: string }
export type Request =
  | { channel: typeof CHANNEL; to: "background" | "offscreen"; type: "room"; command: RoomCommand }
  | { channel: typeof CHANNEL; to: "background"; type: "video-selected"; selectedId?: string }
  | { channel: typeof CHANNEL; to: "background"; type: "cancel-picking" }
  | { channel: typeof CHANNEL; to: "background"; type: "tab-videos"; tabId: number }
  | { channel: typeof CHANNEL; to: "background"; type: "video"; target: FrameTarget; action: VideoAction }
  | { channel: typeof CHANNEL; to: "content"; type: "video"; action: VideoAction }
  | { channel: typeof CHANNEL; to: "background" | "offscreen"; type: "runtime-status" }
  | { channel: typeof CHANNEL; to: "background"; type: "frame-status"; target: FrameTarget }
  | { channel: typeof CHANNEL; to: "content"; type: "frame-status" }
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

export function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false
  const m = value as Record<string, unknown>
  if (m.channel !== CHANNEL) return false
  if (m.type === "room") return (m.to === "background" || m.to === "offscreen") && validRoomCommand(m.command)
  if (m.type === "video-selected") return m.to === "background" && (m.selectedId === undefined || typeof m.selectedId === "string" && m.selectedId.length <= 128)
  if (m.type === "cancel-picking") return m.to === "background"
  if (m.type === "tab-videos") return m.to === "background" && Number.isInteger(m.tabId) && Number(m.tabId) >= 0
  if (m.type === "video") {
    if (!m.action || typeof m.action !== "object") return false
    const action = m.action as Record<string, unknown>
    if (!["list", "pick", "cancel", "clear", "highlight"].includes(String(action.kind))) return false
    if (action.kind === "pick") {
      const shared = action.shared as Record<string, unknown> | null
      if (!shared || typeof shared !== "object" || typeof shared.roomId !== "string" || shared.roomId.length > 128 || !Number.isSafeInteger(shared.revision) || Number(shared.revision) < 0) return false
    }
    if (action.kind === "highlight" && action.id !== null && typeof action.id !== "string") return false
    if (m.to === "content") return true
    if (m.to !== "background" || !m.target || typeof m.target !== "object") return false
    const target = m.target as Record<string, unknown>
    return Number.isInteger(target.tabId) && Number(target.tabId) >= 0 && Number.isInteger(target.frameId) && Number(target.frameId) >= 0
  }
  if (m.type === "runtime-status") return m.to === "background" || m.to === "offscreen"
  if (m.type !== "frame-status") return false
  if (m.to === "content") return true
  if (m.to !== "background" || !m.target || typeof m.target !== "object") return false
  const t = m.target as Record<string, unknown>
  return Number.isInteger(t.tabId) && Number(t.tabId) >= 0 && Number.isInteger(t.frameId) && Number(t.frameId) >= 0
}

export async function sendRequest<T>(request: Request): Promise<T> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(request)
  if (!reply) throw new Error("Контекст расширения не ответил")
  if (reply.ok === false) throw new Error(reply.error)
  return reply.data
}
