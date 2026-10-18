import { t } from "../lib/i18n"
import { startLocaleClient } from "../lib/locale-sync"
startLocaleClient()
import type { PlasmoCSConfig } from "plasmo"
import { CHANNEL, isRequest, type FrameStatus, type Reply } from "../lib/messages"
import { describe, resolve, videosIn } from "../lib/video-dom"
import type { VideoDescriptor, VideoSnapshot } from "../lib/video"
import { PlayerSync } from "../lib/player-sync"

const ids = new WeakMap<HTMLVideoElement, string>()
let selected: HTMLVideoElement | undefined
const playerSync = new PlayerSync(() => selected, (roomId, revision, event) => {
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "playback-event", roomId, revision, event }).then(reply => {
    if (event.kind === "request") console.info("[WTG playback] Ответ background", { action: event.request.action, commandId: event.request.commandId, ok: !!reply?.ok, error: reply?.ok ? undefined : reply?.error })
    if (!reply?.ok) bindingNotice = reply?.error || t("video.controlForwardFailed")
  }).catch(() => { bindingNotice = t("video.roomDisconnected"); console.warn("[WTG playback] Нет ответа background") })
})
let descriptor: VideoDescriptor | undefined
let bindingNotice: string | undefined
let lastSaved = 0
let restoring = false
let restoreTimer: ReturnType<typeof setInterval> | undefined
let roomSource: { roomId: string; revision: number; descriptor: VideoDescriptor } | undefined
let roomBoundVideo: HTMLVideoElement | undefined
function bindRoomSource(message: { roomId: string; revision: number; descriptor: VideoDescriptor; position: number; shared?: boolean }) {
  if (roomSource?.roomId === message.roomId && message.revision < roomSource.revision) return "unavailable"
  const changed = roomSource?.roomId !== message.roomId || roomSource?.revision !== message.revision || JSON.stringify(roomSource.descriptor) !== JSON.stringify(message.descriptor)
  roomSource = { roomId: message.roomId, revision: message.revision, descriptor: message.descriptor }
  const matches = resolve(message.descriptor, { shared: message.shared })
  if (matches.length !== 1) { roomBoundVideo = undefined; setSelected(); descriptor = undefined; bindingNotice = t("video.roomPlayerMissing"); return "needs-video" }
  const video = matches[0]
  const newlyBound = selected !== video
  clearInterval(restoreTimer)
  // Subsequent local snapshots must check the local source, not the remote blob URL.
  descriptor = describe(video)
  setSelected(video)
  roomBoundVideo = video
  roomSource = { roomId: message.roomId, revision: message.revision, descriptor: message.descriptor }
  if (changed || newlyBound) { restoring = true; video.pause(); restoring = false }
  if (video.readyState < 1) return "loading-video"
  let seekable = message.position === 0
  for (let i = 0; i < video.seekable.length; i++) if (message.position >= video.seekable.start(i) && message.position <= video.seekable.end(i)) seekable = true
  if (!seekable || video.readyState < 2) return "loading-video"
  bindingNotice = undefined
  return "ready"
}

function persistBinding(force = false) {
  if (restoring || !selected?.isConnected || !descriptor || (!force && Date.now() - lastSaved < 2000)) return
  lastSaved = Date.now()
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "binding-save", descriptor, position: Number.isFinite(selected.currentTime) ? selected.currentTime : 0, rate: selected.playbackRate }).catch(() => {})
}
const playbackEvents = ["timeupdate", "pause", "seeked", "ratechange"]
function onPlaybackEvent(event: Event) { if (event.target === selected) persistBinding(event.type !== "timeupdate") }
function setSelected(video?: HTMLVideoElement) {
  if (selected === video) return
  for (const name of playbackEvents) selected?.removeEventListener(name, onPlaybackEvent)
  selected = video
  playerSync.bind()
  for (const name of playbackEvents) selected?.addEventListener(name, onPlaybackEvent)
}
void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "binding-load" }).then(reply => {
  if (!reply?.ok || selected || descriptor) return
  if (reply.data?.ambiguous) { bindingNotice = t("video.duplicateFrames"); return }
  const binding = reply.data?.binding
  if (!binding) return
  descriptor = binding.descriptor
  let attempts = 0
  const restore = () => {
    if (++attempts > 30) { clearInterval(restoreTimer); bindingNotice = t("video.restoreFailed"); return }
    const matches = resolve(binding.descriptor)
    if (matches.length !== 1) return
    const video = matches[0]
    restoring = true
    video.pause()
    if (video.readyState < 1) { restoring = false; return }
    try {
      setSelected(video)
      video.playbackRate = binding.rate
      if (Number.isFinite(video.duration)) video.currentTime = Math.min(binding.position, Math.max(0, video.duration - 0.1))
      bindingNotice = undefined
      clearInterval(restoreTimer)
    } catch { bindingNotice = t("video.positionUnavailable") }
    finally { restoring = false }
  }
  restoreTimer = setInterval(restore, 2000)
  restore()
}).catch(() => {})
let picking = false
let highlighted: HTMLVideoElement | undefined
let overlay: HTMLDivElement | undefined
let animation = 0
let highlightTimeout: ReturnType<typeof setTimeout> | undefined

function idFor(video: HTMLVideoElement) {
  if (!ids.has(video)) ids.set(video, crypto.randomUUID())
  return ids.get(video)!
}
function highlight(video?: HTMLVideoElement) {
  clearTimeout(highlightTimeout)
  highlighted = video
  cancelAnimationFrame(animation)
  overlay?.remove()
  overlay = undefined
  if (!video) return
  overlay = document.createElement("div")
  overlay.style.cssText = "all:initial;position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #ea4c89;box-sizing:border-box;background:rgba(234,76,137,.12)"
  document.documentElement.append(overlay)
  const draw = () => {
    if (!highlighted?.isConnected || !overlay) { highlight(); return }
    const rect = highlighted.getBoundingClientRect()
    Object.assign(overlay.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    animation = requestAnimationFrame(draw)
  }
  draw()
}
function stopPicking() {
  picking = false
  window.removeEventListener("pointermove", onMove, true)
  window.removeEventListener("click", onClick, true)
  window.removeEventListener("keydown", onKey, true)
  highlight()
}
function candidate(event: Event) {
  const direct = event.composedPath().find(node => node instanceof HTMLVideoElement)
  if (direct instanceof HTMLVideoElement) return direct
  if (!(event instanceof MouseEvent)) return undefined
  // Player controls often cover the video itself.
  return videosIn().filter(video => {
    const r = video.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom
  }).sort((a, b) => {
    const x = a.getBoundingClientRect(), y = b.getBoundingClientRect()
    return x.width * x.height - y.width * y.height
  })[0]
}
function onMove(event: PointerEvent) {
  const video = candidate(event)
  if (video !== highlighted) highlight(video)
}
function select(video: HTMLVideoElement) {
  clearInterval(restoreTimer)
  bindingNotice = undefined
  descriptor = describe(video)
  setSelected(video)
  persistBinding(true)
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "video-selected", selectedId: idFor(video) }).then(reply => {
    if (!reply?.ok) bindingNotice = reply?.error || t("video.pickError")
  }).catch(() => { bindingNotice = t("video.pickForwardFailed") })
}
function onClick(event: MouseEvent) {
  const video = candidate(event)
  if (!video) return
  event.preventDefault()
  event.stopImmediatePropagation()
  select(video)
  stopPicking()
}
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault()
    stopPicking()
    void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "cancel-picking" }).catch(() => {})
  }
}
function snapshot(): VideoSnapshot {
  let binding: VideoSnapshot["binding"] = descriptor ? "bound" : "none"
  if (descriptor) {
    const matches = resolve(descriptor)
    setSelected(matches.length === 1 ? matches[0] : undefined)
    binding = matches.length > 1 ? "ambiguous" : selected ? "bound" : "missing"
  }
  return {
    roomBinding: roomSource && selected && selected === roomBoundVideo ? { roomId: roomSource.roomId, revision: roomSource.revision, videoId: idFor(selected) } : undefined,
    notice: bindingNotice,
    selectedId: selected ? idFor(selected) : null, binding,
    videos: videosIn().map((video, index) => {
      const rect = video.getBoundingClientRect()
      return { position: Number.isFinite(video.currentTime) ? video.currentTime : 0, playbackRate: video.playbackRate, id: idFor(video), label: document.title.trim() || video.getAttribute("aria-label") || video.title || t("video.videoNumber", { number: index + 1 }),
        width: Math.round(rect.width), height: Math.round(rect.height),
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState, paused: video.paused, poster: video.poster,
        descriptor: describe(video) }
    })
  }
}

// Check only detached selections; no repeated whole-DOM scan during normal playback.
// A timer also covers replacements inside open shadow roots while the popup is closed.
setInterval(() => {
  if (!descriptor || selected?.isConnected) return
  const wasRoomBound = !!roomSource && !!roomBoundVideo
  const matches = resolve(wasRoomBound ? roomSource!.descriptor : descriptor, { shared: wasRoomBound })
  const replacement = matches.length === 1 ? matches[0] : undefined
  if (selected !== replacement) {
    console.info("[WTG seek] Проверка замены плеера", { matches: matches.length, rebound: !!replacement })
    setSelected(replacement)
  }
  if (!replacement) {
    bindingNotice = matches.length > 1 ? t("video.replacementAmbiguous") : t("video.waitingForPlayer")
    return
  }
  descriptor = describe(replacement)
  if (wasRoomBound) roomBoundVideo = replacement
  bindingNotice = undefined
  // Reapply the current room timeline through the normal background routing.
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "source-refresh" }).catch(() => {})
}, 500)

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_idle"
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && !sender.tab && message?.channel === CHANNEL && message.to === "content" && message.type === "playback-state") {
    try { playerSync.update(message.roomId, message.revision, message.playback); respond({ ok: true }) }
    catch { respond({ ok: false }) }
    return
  }
  if (sender.id === chrome.runtime.id && !sender.tab && message?.channel === CHANNEL && message.to === "content" && message.type === "source-watch") {
    refreshRoomSource()
    respond({ ok: true })
    return
  }
  if (sender.id === chrome.runtime.id && !sender.tab && message?.channel === CHANNEL && message.to === "content" && message.type === "source-bind") {
    try { respond({ ok: true, data: { status: bindRoomSource(message) } }) }
    catch { respond({ ok: false }) }
    return
  }
  if (sender.id !== chrome.runtime.id || !isRequest(message) || message.to !== "content") return
  if (message.type === "video") {
    try {
      const action = message.action
      if (action.kind === "pick" && !picking) {
        picking = true
        window.addEventListener("pointermove", onMove, true)
        window.addEventListener("click", onClick, true)
        window.addEventListener("keydown", onKey, true)
      }
      if (action.kind === "cancel") stopPicking()
      if (action.kind === "clear") { stopPicking(); clearInterval(restoreTimer); setSelected(); descriptor = undefined }
      if (action.kind === "highlight") {
        const video = videosIn().find(item => idFor(item) === action.id)
          highlight(video)
          if (video) highlightTimeout = setTimeout(() => highlight(), 2500)
      }
      respond({ ok: true, data: snapshot() })
    } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : t("video.videoPickError") }) }
    return
  }
  respond({ ok: true, data: { url: location.href, title: document.title } } satisfies Reply<FrameStatus>)
})
// Only the top frame drives periodic readiness checks; child frames notify on load.
let sourceRefreshTimer: ReturnType<typeof setInterval> | undefined
let startupNotice: HTMLDivElement | undefined
let startupNoticeAnimation = 0
function showStartupNotice(visible: boolean) {
  if (!visible) { cancelAnimationFrame(startupNoticeAnimation); startupNotice?.remove(); startupNotice = undefined; return }
  if (startupNotice) { startupNotice.textContent = t("video.pressPlay"); return }
  startupNotice = document.createElement("div")
  startupNotice.textContent = t("video.pressPlay")
  startupNotice.setAttribute("role", "status")
  startupNotice.setAttribute("aria-live", "polite")
  startupNotice.style.cssText = "all:initial;position:fixed;right:90px;top:10px;z-index:2147483647;pointer-events:none;padding:6px 9px;border-radius:7px;background:rgba(20,24,30,.72);color:#ea4c89;font:500 11px/1.4 system-ui;max-width:calc(100vw - 100px);box-sizing:border-box;backdrop-filter:blur(6px)"
  document.documentElement.append(startupNotice)
  const visibleVideos = videosIn().filter(video => { const r = video.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  const fallbackAnchor = visibleVideos.length === 1 ? visibleVideos[0] : undefined
  const positionNotice = () => {
    if (!startupNotice) return
    const anchor = selected?.isConnected ? selected : fallbackAnchor?.isConnected ? fallbackAnchor : undefined
    const rect = anchor?.getBoundingClientRect()
    startupNotice.style.top = `${Math.max(10, (rect?.top || 0) + 10)}px`
    startupNotice.style.right = "auto"
    startupNotice.style.left = `${Math.max(0, rect?.left ?? 10)}px`
    startupNoticeAnimation = requestAnimationFrame(positionNotice)
  }
  positionNotice()
}
const refreshRoomSource = () => {
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "source-refresh" }).then(reply => {
    if (window !== window.top) return
    if (reply?.ok) showStartupNotice(!!reply.data?.startupPrompt)
    if (reply?.data && !sourceRefreshTimer) sourceRefreshTimer = setInterval(refreshRoomSource, 2000)
    if (!reply?.data && sourceRefreshTimer) { clearInterval(sourceRefreshTimer); sourceRefreshTimer = undefined }
  }).catch(() => { /* A transient worker/message failure must not stop a managed page's retries. */ })
}
refreshRoomSource()
