import { CHANNEL, isRequest, type Request } from "./lib/messages"

let creating: Promise<void> | undefined
async function ensureOffscreen() {
  if (creating) return creating
  creating = (async () => {
    const path = "tabs/offscreen.html"
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(path)]
    })
    if (contexts.length) return
    await chrome.offscreen.createDocument({
      url: path,
      reasons: [chrome.offscreen.Reason.WEB_RTC],
      justification: "Own watch-room WebRTC connections independently of popup and navigation."
    })
  })()
  try { await creating } finally { creating = undefined }
}

async function handle(message: Request) {
  if (message.to !== "background") throw new Error("Invalid destination")
  if (message.type === "frame-status") {
    return chrome.tabs.sendMessage(message.target.tabId,
      { channel: CHANNEL, to: "content", type: "frame-status" },
      { frameId: message.target.frameId })
  }
  await ensureOffscreen()
  return chrome.runtime.sendMessage({ channel: CHANNEL, to: "offscreen", type: "runtime-status" })
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isRequest(message) || message.to !== "background") return
  if (sender.tab && (message.type !== "frame-status" || message.target.tabId !== sender.tab.id || message.target.frameId !== sender.frameId)) {
    respond({ ok: false, error: "Недоступный адрес сообщения" })
    return
  }
  void handle(message).then(respond, (error: unknown) => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка расширения" })
  })
  return true
})
