import { isRequest, type Reply, type RuntimeStatus } from "../lib/messages"
import { initializeRoom, observeSource, roomCommand } from "../lib/room"
import { CHANNEL } from "../lib/messages"
import { groupPlayerStatus } from "../lib/group-status"

// Trystero and room state live here, independent of popup/worker lifetime.
const status: RuntimeStatus = {
  instanceId: crypto.randomUUID(),
  startedAt: Date.now(),
  webRtcAvailable: typeof RTCPeerConnection === "function"
}
observeSource((view, roomId) => {
  const group = groupPlayerStatus(view)
  const playback = view.sync && { ...view.sync, adminSync: view.isAdmin && view.shared.video ? { synchronized: group.synchronized, total: group.total } : undefined }
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "source-state", value: { roomId, ready: view.ready, shared: view.shared, playback } }).catch(() => {})
})
void initializeRoom().catch(() => {})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !isRequest(message) || message.to !== "offscreen") return
  if (message.type === "room") {
    void roomCommand(message.command).then(data => respond({ ok: true, data }),
      (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка комнаты" }))
    return true
  }
  respond({ ok: true, data: status } satisfies Reply<RuntimeStatus>)
})
