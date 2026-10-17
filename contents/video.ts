import type { PlasmoCSConfig } from "plasmo"
import { isRequest, type FrameStatus, type Reply } from "../lib/messages"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_idle"
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message) || message.to !== "content") return
  respond({ ok: true, data: { url: location.href, title: document.title } } satisfies Reply<FrameStatus>)
})
