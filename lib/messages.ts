export const CHANNEL = "wtg:local:v1"
export type FrameTarget = { tabId: number; frameId: number }
export type RuntimeStatus = { instanceId: string; startedAt: number; webRtcAvailable: boolean }
export type FrameStatus = { url: string; title: string }
export type Request =
  | { channel: typeof CHANNEL; to: "background" | "offscreen"; type: "runtime-status" }
  | { channel: typeof CHANNEL; to: "background"; type: "frame-status"; target: FrameTarget }
  | { channel: typeof CHANNEL; to: "content"; type: "frame-status" }
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string }

export function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false
  const m = value as Record<string, unknown>
  if (m.channel !== CHANNEL) return false
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
