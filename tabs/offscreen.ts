import { isRequest, type Reply, type RuntimeStatus } from "../lib/messages"

// Trystero and room state will live here, independent of popup/worker lifetime.
const status: RuntimeStatus = {
  instanceId: crypto.randomUUID(),
  startedAt: Date.now(),
  webRtcAvailable: typeof RTCPeerConnection === "function"
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !isRequest(message) || message.to !== "offscreen") return
  respond({ ok: true, data: status } satisfies Reply<RuntimeStatus>)
})
