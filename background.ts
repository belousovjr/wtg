import { CHANNEL, isRequest, type Request } from "./lib/messages"
import { validateVault } from "./lib/persistence"
import { decodeInvitation } from "./lib/room-protocol"
import { handleBindingMessage } from "./lib/bindings"
import { applySourceState, bindSourceTab, closeSource, focusSource, refreshSource, selectLocalSource } from "./lib/source-viewer"

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.channel !== CHANNEL || message.to !== "background") return
  if (message.type === "source-state") {
    if (sender.tab || sender.url !== chrome.runtime.getURL("tabs/offscreen.html")) return
    void applySourceState(message.value).then(() => respond({ ok: true }), () => respond({ ok: false }))
    return true
  }
  if (message.type === "source-refresh" && sender.tab?.id !== undefined) {
    void refreshSource(sender.tab.id).then(data => respond({ ok: true, data }), () => respond({ ok: false }))
    return true
  }
  if (message.type === "source-focus" && !sender.tab) {
    void focusSource().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error instanceof Error ? error.message : "Вкладка недоступна" }))
    return true
  }
  if (message.type === "source-attach" && !sender.tab) {
    void (async () => {
      // Capture once at the explicit action, never infer a tab from later activity.
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (tab?.id === undefined) throw new Error("Текущая вкладка недоступна")
      await ensureOffscreen()
      const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "offscreen", type: "room", command: { kind: "status" } })
      if (!reply?.ok || !reply.data.invitation) throw new Error("Сначала подключись к комнате")
      return bindSourceTab(tab.id, decodeInvitation(reply.data.invitation).roomId)
    })().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error instanceof Error ? error.message : "Вкладка недоступна" }))
    return true
  }
  if (message.type === "vault") {
    if (sender.tab || sender.url !== chrome.runtime.getURL("tabs/offscreen.html")) return
    void (async () => {
      await storageReady
      if (message.operation === "write") {
        const value = validateVault(message.value)
        await chrome.storage.local.set({ vault: value })
        return value
      }
      if (message.operation !== "read") throw new Error("Unknown storage operation")
      return validateVault((await chrome.storage.local.get("vault")).vault)
    })().then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка хранилища" }))
    return true
  }
  if (message.type === "binding-load" || message.type === "binding-save") {
    if (sender.tab?.id === undefined || sender.frameId === undefined) return
    void storageReady.then(() => handleBindingMessage(message, sender)).then(data => respond({ ok: true, data }), () => respond({ ok: false, error: "Не удалось восстановить привязку" }))
    return true
  }
})

async function recoverSession() {
  await storageReady
  const saved = (await chrome.storage.local.get("vault")).vault
  if (saved?.session || saved?.ended?.length) {
    await ensureOffscreen()
    await chrome.runtime.sendMessage({ channel: CHANNEL, to: "offscreen", type: "room", command: { kind: "status" } })
  }
}
chrome.runtime.onStartup.addListener(() => { void recoverSession().catch(() => {}) })
chrome.runtime.onInstalled.addListener(() => { void recoverSession().catch(() => {}) })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "wtg-recover") void recoverSession().catch(() => {}) })
void chrome.alarms.create("wtg-recover", { periodInMinutes: 1 })
void recoverSession().catch(() => {})
chrome.tabs.onRemoved.addListener(tabId => { void closeSource(tabId).catch(() => {}) })
chrome.webNavigation.onCompleted.addListener(details => { void refreshSource(details.tabId).catch(() => {}) })

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
  if (message.type === "room") {
    const entering = message.command.kind === "create" || message.command.kind === "join"
    const [tab] = entering ? await chrome.tabs.query({ active: true, lastFocusedWindow: true }) : []
    if (entering && tab?.id === undefined) throw new Error("Не удалось определить вкладку просмотра")
    await ensureOffscreen()
    const reply = await chrome.runtime.sendMessage({ ...message, to: "offscreen" })
    if (entering && reply?.ok && reply.data.invitation && tab?.id !== undefined) {
      await bindSourceTab(tab.id, decodeInvitation(reply.data.invitation).roomId)
    }
    return reply
  }
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
    if (message.type === "video-selected") void selectLocalSource(tabId, sender.frameId, message.selectedId).catch(() => {})
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
