import { CHANNEL } from "./messages"
import { sameFrameLocation, sourceRevision, webUrl, type SourceReadiness, type SourceStatus } from "./source"
import { validShared, type SharedState } from "./room-protocol"
import type { VideoDescriptor } from "./video"

type SourceState = { roomId: string | null; ready: boolean; shared: SharedState }
type Viewer = { boundByUser: true; roomId: string; revision: number; url: string; tabId: number; closed?: boolean; override?: { descriptor: VideoDescriptor }; status?: SourceStatus }
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
    viewer = { boundByUser: true, roomId: state.roomId, revision, url, tabId: tab.id! }
    await persist()
    lastReport = ""
    if (webUrl(tab.url || "") !== url) { await chrome.tabs.update(tab.id!, { url }); await report("loading-page"); return }
  }
  if (tab.status === "loading") { await report("loading-page"); return }
  if (webUrl(tab.url || "") !== url) { await report("wrong-page"); return }
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
    await report(reply?.ok ? reply.data.status : "unavailable")
  } catch { await report("unavailable") }
}
export function applySourceState(value: SourceState) {
  return serial(async () => {
    await load()
    if (!validShared(value.shared)) throw new Error("Invalid source state")
    if (state?.roomId === value.roomId && sourceRevision(value.shared) < sourceRevision(state.shared)) return
    const becameReady = !state?.ready && value.ready
    state = value
    if (!value.roomId) { viewer = undefined; lastReport = ""; await persist(); return }
    if (viewer && viewer.roomId !== value.roomId) { viewer = undefined; await persist() }
    if (becameReady) lastReport = ""
    await reconcile()
  })
}
export function refreshSource(tabId: number) {
  return serial(async () => { await load(); if (viewer?.tabId === tabId) await reconcile(); return viewer?.tabId === tabId ? viewer : null })
}
export function bindSourceTab(tabId: number, roomId: string) {
  return serial(async () => {
    await load()
    await chrome.tabs.get(tabId)
    viewer = { boundByUser: true, roomId, revision: -1, url: "", tabId }
    lastReport = ""
    await persist()
    // A page that was already loaded may have stopped its unbound polling.
    void chrome.tabs.sendMessage(tabId, { channel: CHANNEL, to: "content", type: "source-watch" }, { frameId: 0 }).catch(() => {})
    if (state?.roomId === roomId) await reconcile()
    return viewer
  })
}
export function focusSource() {
  return serial(async () => {
    await load()
    if (!viewer || viewer.closed) throw new Error("Вкладка просмотра не привязана или закрыта. Нажми «Смотреть в этой вкладке».")
    let tab: chrome.tabs.Tab
    try { tab = await chrome.tabs.get(viewer.tabId) }
    catch { viewer.closed = true; await persist(); await report("unavailable"); throw new Error("Вкладка просмотра закрыта. Нажми «Смотреть в этой вкладке».") }
    await chrome.tabs.update(viewer.tabId, { active: true })
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
    return viewer
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
