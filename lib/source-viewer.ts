import { CHANNEL } from "./messages"
import { sameFrameLocation, samePageLocation, sourceRevision, webUrl, type SourceReadiness, type SourceStatus } from "./source"
import { validShared, type SharedState } from "./room-protocol"
import type { VideoDescriptor } from "./video"
import { validPlaybackRequest, validPlayerReport, type PlaybackLocal } from "./playback"

type SourceState = { roomId: string | null; ready: boolean; shared: SharedState; playback?: PlaybackLocal }
type Viewer = { frameId?: number; boundByUser: true; roomId: string; revision: number; url: string; tabId: number; closed?: boolean; override?: { descriptor: VideoDescriptor }; status?: SourceStatus }
let state: SourceState | undefined
let viewer: Viewer | undefined
let loaded = false
let pending: Promise<unknown> = Promise.resolve()
let lastReport = ""
function serial<T>(work: () => Promise<T>) {
  const task = pending.then(work)
  pending = task.catch(() => {})
  return task
}
async function load() {
  if (loaded) return
  const saved = (await chrome.storage.session.get("sourceViewer")).sourceViewer
  // Older automatically-created viewer tabs must not become user-approved tabs.
  viewer = saved?.boundByUser === true ? saved : undefined
  loaded = true
}
async function persist() {
  if (viewer) await chrome.storage.session.set({ sourceViewer: viewer })
  else await chrome.storage.session.remove("sourceViewer")
}
async function suspendViewer() {
  if (viewer?.frameId === undefined) return
  try { await chrome.tabs.sendMessage(viewer.tabId, { channel: CHANNEL, to: "content", type: "playback-state", roomId: viewer.roomId, revision: viewer.revision, playback: null }, { frameId: viewer.frameId }) } catch {}
}
async function report(status: SourceStatus) {
  if (!state?.ready || !state.roomId) return
  if (viewer) viewer.status = status
  const readiness: SourceReadiness = { revision: sourceRevision(state.shared), status }
  const key = JSON.stringify([state.roomId, readiness])
  if (key === lastReport) return
  lastReport = key
  // Do not wait for room's serialized queue while it is publishing source state.
  void chrome.runtime.sendMessage({ channel: CHANNEL, to: "offscreen", type: "room", command: { kind: "source-ready", readiness } }).catch(() => { lastReport = "" })
}
async function reconcile() {
  await load()
  if (!state?.ready || !state.roomId || !state.shared.url) return
  const url = webUrl(state.shared.url)
  if (!url) return
  const revision = sourceRevision(state.shared)
  if (!viewer || viewer.roomId !== state.roomId || viewer.closed) { await report("unavailable"); return }
  const changed = viewer.revision !== revision || viewer.url !== url
  let tab: chrome.tabs.Tab
  try { tab = await chrome.tabs.get(viewer.tabId) }
  catch { viewer.closed = true; await persist(); await report("unavailable"); return }
  if (changed) {
    const previousViewer = viewer
    const sharedChange = viewer.revision >= 0 && viewer.revision !== revision
    viewer = { boundByUser: true, roomId: state.roomId, revision, url, tabId: tab.id! }
    await persist()
    lastReport = ""
    if (sharedChange) {
      try {
      const previousUrl = webUrl(tab.url || "")
      if (previousUrl === url) await chrome.tabs.reload(tab.id!)
      else {
        let sameDocument = false
        if (previousUrl) {
          const previous = new URL(previousUrl), next = new URL(url)
          sameDocument = previous.origin === next.origin && previous.pathname === next.pathname && previous.search === next.search
        }
        if (sameDocument) {
          await applyExactTabUrl(tab.id!, url)
          await chrome.tabs.reload(tab.id!)
        } else await chrome.tabs.update(tab.id!, { url })
      }
      await report("loading-page")
      return
      } catch (error) {
        viewer = previousViewer
        await persist()
        await report("unavailable")
        throw error
      }
    }
    if (!samePageLocation(tab.url || "", url)) { await chrome.tabs.update(tab.id!, { url }); await report("loading-page"); return }
  }
  if (tab.status === "loading") { await report("loading-page"); return }
  if (!samePageLocation(tab.url || "", url)) { await report("wrong-page"); return }
  const descriptor = viewer?.override?.descriptor || state.shared.video
  if (!descriptor) { await report("needs-video"); return }
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id! }) || []
  const framePath = (frame: typeof frames[number]) => {
    const path: string[] = []
    let node = frame
    while (node.parentFrameId !== -1) {
      path.unshift(node.url)
      const parent = frames.find(f => f.frameId === node.parentFrameId)
      if (!parent) return null
      node = parent
    }
    return path
  }
  let candidates = frames.filter(frame => frame.url === descriptor.frameUrl && JSON.stringify(framePath(frame)) === JSON.stringify(descriptor.framePath))
  // If session query tokens differ, still require one unambiguous frame path.
  if (!candidates.length && !viewer.override) candidates = frames.filter(frame => {
    const path = framePath(frame)
    return sameFrameLocation(frame.url, descriptor.frameUrl) && path && path.length === descriptor.framePath.length && path.every((url, i) => sameFrameLocation(url, descriptor.framePath[i]))
  })
  if (candidates.length !== 1) { await report("needs-video"); return }
  try {
    const reply = await chrome.tabs.sendMessage(tab.id!, { channel: CHANNEL, to: "content", type: "source-bind", roomId: state.roomId,
      revision, descriptor, shared: !viewer.override, position: state.shared.playback.position }, { frameId: candidates[0].frameId })
    viewer.frameId = candidates[0].frameId
    if (state.playback) await chrome.tabs.sendMessage(tab.id!, { channel: CHANNEL, to: "content", type: "playback-state", roomId: state.roomId, revision, playback: state.playback }, { frameId: viewer.frameId })
    await report(reply?.ok ? reply.data.status : "unavailable")
  } catch { await report("unavailable") }
}
// tabs.update may resolve before navigation applies; never reload the previous URL.
export async function applyExactTabUrl(tabId: number, url: string) {
  await chrome.tabs.update(tabId, { url })
  for (let attempt = 0; attempt < 100; attempt++) {
    const tab = await chrome.tabs.get(tabId)
    if (webUrl(tab.url || "") === url && (!tab.pendingUrl || webUrl(tab.pendingUrl) === url)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error("Браузер не применил точный URL просмотра")
}
export function applySourceState(value: SourceState) {
  return serial(async () => {
    await load()
    if (!validShared(value.shared)) throw new Error("Invalid source state")
    if (state?.roomId === value.roomId && sourceRevision(value.shared) < sourceRevision(state.shared)) return
    const becameReady = !state?.ready && value.ready
    if (!value.ready || viewer?.roomId !== value.roomId || viewer?.revision !== sourceRevision(value.shared)) await suspendViewer()
    state = value
    if (!value.roomId) { viewer = undefined; lastReport = ""; await persist(); return }
    if (viewer && viewer.roomId !== value.roomId) { viewer = undefined; await persist() }
    if (becameReady) lastReport = ""
    await reconcile()
  })
}
export function forwardPlaybackEvent(sender: chrome.runtime.MessageSender, message: { roomId: string; revision: number; event: { kind: string; request?: unknown; report?: unknown } }) {
  return serial(async () => {
    await load()
    if (!state?.ready || !viewer || sender.tab?.id !== viewer.tabId || sender.frameId !== viewer.frameId || message.roomId !== state.roomId || message.revision !== sourceRevision(state.shared)) throw new Error("Устаревшая привязка плеера")
    const event = message.event
    const command = event?.kind === "request" && validPlaybackRequest(event.request) ? { kind: "playback", request: event.request } : event?.kind === "report" && validPlayerReport(event.report) ? { kind: "player-report", report: event.report } : null
    if (!command) throw new Error("Некорректное событие плеера")
    const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "offscreen", type: "room", command })
    if (!reply?.ok) throw new Error(reply?.error || "Не удалось передать управление")
    return null
  })
}
export function refreshSource(tabId: number) {
  return serial(async () => { await load(); if (viewer?.tabId === tabId) await reconcile(); return viewer?.tabId === tabId ? viewer : null })
}
export function bindSourceTab(tabId: number, roomId: string, onlyIfMatching = false) {
  return serial(async () => {
    await load()
    const tab = await chrome.tabs.get(tabId)
    if (onlyIfMatching) {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (active?.id !== tabId) return viewer
      if (!state?.ready || state.roomId !== roomId || !state.shared.url || !samePageLocation(tab.url || "", state.shared.url)) return viewer
      if (viewer?.roomId === roomId && !viewer.closed) {
        const existing = await chrome.tabs.get(viewer.tabId).catch(() => undefined)
        if (existing) return viewer
      }
    }
    await suspendViewer()
    viewer = { boundByUser: true, roomId, revision: -1, url: "", tabId }
    lastReport = ""
    await persist()
    // A page that was already loaded may have stopped its unbound polling.
    void chrome.tabs.sendMessage(tabId, { channel: CHANNEL, to: "content", type: "source-watch" }, { frameId: 0 }).catch(() => {})
    if (state?.roomId === roomId) await reconcile()
    return viewer
  })
}
export async function autoBindActiveSource() {
  if (!state?.ready || !state.roomId || !state.shared.url) return
  const roomId = state.roomId
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) return
  return bindSourceTab(tab.id, roomId, true)
}
export function focusSource() {
  return serial(async () => {
    await load()
    if (!viewer || viewer.closed) throw new Error("Вкладка просмотра не привязана или закрыта. Нажми «Назначить эту вкладку для просмотра».")
    let tab: chrome.tabs.Tab
    try { tab = await chrome.tabs.get(viewer.tabId) }
    catch { viewer.closed = true; await persist(); await report("unavailable"); throw new Error("Вкладка просмотра закрыта. Нажми «Назначить эту вкладку для просмотра».") }
    await chrome.tabs.update(viewer.tabId, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
    return viewer
  })
}
export function openSourceUrl() {
  return serial(async () => {
    await load()
    const url = webUrl(state?.shared.url || "")
    if (!state?.ready || !state.roomId || !url) throw new Error("Страница просмотра пока недоступна")
    if (!viewer || viewer.closed || viewer.roomId !== state.roomId) throw new Error("Вкладка просмотра не привязана или закрыта")
    let tab: chrome.tabs.Tab
    try { tab = await chrome.tabs.get(viewer.tabId) }
    catch { viewer.closed = true; await persist(); await report("unavailable"); throw new Error("Вкладка просмотра закрыта") }
    if (!samePageLocation(tab.url || "", url)) {
      await suspendViewer()
      await chrome.tabs.update(viewer.tabId, { url })
      await report("loading-page")
    } else await reconcile()
  })
}
export function closeSource(tabId: number) {
  return serial(async () => { await load(); if (viewer?.tabId === tabId) { viewer.closed = true; await persist(); await report("unavailable") } })
}
export function selectLocalSource(tabId: number, frameId: number, selectedId?: string) {
  return serial(async () => {
    await load()
    if (!viewer || viewer.tabId !== tabId || !state?.ready) return
    const reply = await chrome.tabs.sendMessage(tabId, { channel: CHANNEL, to: "content", type: "video", action: { kind: "list" } }, { frameId })
    const video = reply?.data?.videos?.find(v => v.id === (selectedId || reply.data.selectedId))
    if (!video) return
    const frames = await chrome.webNavigation.getAllFrames({ tabId }) || []
    const frame = frames.find(f => f.frameId === frameId)
    if (!frame) return
    const framePath: string[] = []
    let node = frame
    while (node.parentFrameId !== -1) {
      framePath.unshift(node.url)
      const parent = frames.find(f => f.frameId === node.parentFrameId)
      if (!parent) return
      node = parent
    }
    viewer.override = { descriptor: { ...video.descriptor, framePath } }
    await persist()
    await reconcile()
  })
}
