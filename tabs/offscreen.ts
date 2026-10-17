import { isRequest, type Reply, type RuntimeStatus } from "../lib/messages"
import { roomCommand } from "../lib/room"

// Trystero and room state live here, independent of popup/worker lifetime.
const status: RuntimeStatus = {
  instanceId: crypto.randomUUID(),
  startedAt: Date.now(),
  webRtcAvailable: typeof RTCPeerConnection === "function"
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !isRequest(message) || message.to !== "offscreen") return
  if (message.type === "room") {
    void roomCommand(message.command).then(data => respond({ ok: true, data }),
      (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка комнаты" }))
    return true
  }
  respond({ ok: true, data: status } satisfies Reply<RuntimeStatus>)
})
