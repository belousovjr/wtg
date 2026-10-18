import { applyLanguage, getLanguage, isLanguage, t, type Language } from "./i18n"

const channel = "wtg:locale:v1"
let started = false

// Content and offscreen documents never read local storage; only background owns it.
export function startLocaleClient() {
  if (started || typeof chrome === "undefined" || !chrome.runtime?.id) return
  started = true
  let changes = 0
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== channel || message.type !== "changed" || !isLanguage(message.language)) return
    changes++
    applyLanguage(message.language)
  })
  const version = changes
  void chrome.runtime.sendMessage({ channel, to: "background", type: "get" }).then(reply => {
    if (version === changes && reply?.ok && isLanguage(reply.language)) applyLanguage(reply.language)
  }).catch(() => {})
}

export async function selectLanguage(language: Language) {
  const reply = await chrome.runtime.sendMessage({ channel, to: "background", type: "set", language })
  if (!reply?.ok || !isLanguage(reply.language)) throw new Error(t("popup.languageSaveFailed"))
  applyLanguage(reply.language)
}

export function startLocaleBackground() {
  let pending: Promise<unknown> = chrome.storage.local.get("language").then(saved => {
    if (isLanguage(saved.language)) applyLanguage(saved.language)
  }).catch(() => {})
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== channel || message.to !== "background") return
    if (message.type !== "get" && message.type !== "set") return
    if (message.type === "set" && (sender.tab || !isLanguage(message.language))) { respond({ ok: false }); return }
    const action = pending.catch(() => {}).then(async () => {
      if (message.type === "set") {
        await chrome.storage.local.set({ language: message.language })
        applyLanguage(message.language)
        const notice = { channel, type: "changed", language: message.language }
        await chrome.runtime.sendMessage(notice).catch(() => {})
        const tabs = await chrome.tabs.query({})
        await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => chrome.tabs.sendMessage(tab.id!, notice)))
      }
      return { ok: true, language: getLanguage() }
    })
    pending = action
    void action.then(respond, () => respond({ ok: false }))
    return true
  })
}
