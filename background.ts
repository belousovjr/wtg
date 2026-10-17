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
  if (message.type === "video-selected" || message.type === "cancel-picking") throw new Error("Frame sender required")
  if (message.type === "tab-videos") {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: message.tabId }) || []
    const results = await Promise.all(frames.map(async frame => {
      try {
        const reply = await chrome.tabs.sendMessage(message.tabId, { channel: CHANNEL, to: "content", type: "video", action: { kind: "list" } }, { frameId: frame.frameId })
        if (!reply?.ok) return null
        const path: string[] = []
        let current = frame
        while (current.parentFrameId !== -1) {
          path.unshift(current.url)
          const parent = frames.find(item => item.frameId === current.parentFrameId)
          if (!parent) break
          current = parent
        }
        for (const video of reply.data.videos) {
          video.descriptor.pageUrl = frames.find(item => item.frameId === 0)?.url || frame.url
          video.descriptor.framePath = path
        }
        return { frameId: frame.frameId, url: frame.url, snapshot: reply.data }
      } catch { return null }
    }))
    return { ok: true, data: { frames: results.filter(Boolean), unavailableFrames: results.filter(r => !r).length } }
  }
  if (message.type === "video") {
    return chrome.tabs.sendMessage(message.target.tabId, { channel: CHANNEL, to: "content", type: "video", action: message.action }, { frameId: message.target.frameId })
  }
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
  if ((message.type === "video-selected" || message.type === "cancel-picking") && sender.tab?.id !== undefined && sender.frameId !== undefined) {
    const tabId = sender.tab.id
    void chrome.webNavigation.getAllFrames({ tabId }).then(frames => Promise.allSettled(
      (frames || []).filter(frame => frame.frameId !== sender.frameId).map(frame =>
        chrome.tabs.sendMessage(tabId, { channel: CHANNEL, to: "content", type: "video", action: { kind: message.type === "video-selected" ? "clear" : "cancel" } }, { frameId: frame.frameId }))
    )).then(() => respond({ ok: true, data: null }), () => respond({ ok: false, error: "Не удалось сбросить выбор других фреймов" }))
    return true
  }
  if (sender.tab && (!("target" in message) || message.target.tabId !== sender.tab.id || message.target.frameId !== sender.frameId)) {
    respond({ ok: false, error: "Недоступный адрес сообщения" })
    return
  }
  void handle(message).then(respond, (error: unknown) => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка расширения" })
  })
  return true
})
