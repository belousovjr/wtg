import type { PlasmoCSConfig } from "plasmo"
import { CHANNEL, isRequest, type FrameStatus, type Reply } from "../lib/messages"
import { describe, resolve, videosIn } from "../lib/video-dom"
import type { VideoDescriptor, VideoSnapshot } from "../lib/video"

const ids = new WeakMap<HTMLVideoElement, string>()
let selected: HTMLVideoElement | undefined
let descriptor: VideoDescriptor | undefined
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
  overlay.style.cssText = "all:initial;position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #7c3aed;box-sizing:border-box;background:rgba(124,58,237,.12)"
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
  descriptor = describe(video)
  selected = video
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "video-selected" }).catch(() => {})
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
    selected = matches.length === 1 ? matches[0] : undefined
    binding = matches.length > 1 ? "ambiguous" : selected ? "bound" : "missing"
  }
  return {
    selectedId: selected ? idFor(selected) : null, binding,
    videos: videosIn().map((video, index) => {
      const rect = video.getBoundingClientRect()
      return { id: idFor(video), label: video.getAttribute("aria-label") || video.title || `Видео ${index + 1}`,
        width: Math.round(rect.width), height: Math.round(rect.height),
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState, paused: video.paused, poster: video.poster,
        descriptor: describe(video) }
    })
  }
}

// Resolve lazily on every snapshot: observes replacement without a costly whole-DOM observer.

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  all_frames: true,
  run_at: "document_idle"
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
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
      if (action.kind === "clear") { stopPicking(); selected = undefined; descriptor = undefined }
      if (action.kind === "select" || action.kind === "highlight") {
        const video = videosIn().find(item => idFor(item) === action.id)
        if (action.kind === "select") {
          if (!video) throw new Error("Видео исчезло. Обновите список.")
          select(video)
        } else {
          highlight(video)
          if (video) highlightTimeout = setTimeout(() => highlight(), 2500)
        }
      }
      respond({ ok: true, data: snapshot() })
    } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : "Ошибка выбора видео" }) }
    return
  }
  respond({ ok: true, data: { url: location.href, title: document.title } } satisfies Reply<FrameStatus>)
})
