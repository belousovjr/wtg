import { validShared } from "./room-protocol"
import type { VideoDescriptor } from "./video"

type Binding = { pageUrl: string; frameUrl: string; framePath: string[]; descriptor: VideoDescriptor; position: number; rate: number }
let pending: Promise<unknown> = Promise.resolve()
export function handleBindingMessage(message: { type: string; descriptor?: VideoDescriptor; position?: number; rate?: number }, sender: chrome.runtime.MessageSender) {
  const task = pending.then(async () => {
    const tabId = sender.tab!.id!, frameId = sender.frameId!
    const frames = await chrome.webNavigation.getAllFrames({ tabId }) || []
    const root = frames.find(f => f.frameId === 0), frame = frames.find(f => f.frameId === frameId)
    if (!root || !frame) return null
    const path: string[] = []
    let node = frame
    while (node.parentFrameId !== -1) {
      path.unshift(node.url)
      const parent = frames.find(f => f.frameId === node.parentFrameId)
      if (!parent) break
      node = parent
    }
    const stored = (await chrome.storage.local.get("bindings")).bindings
    const all: Binding[] = Array.isArray(stored) ? stored.filter(b => b && validShared({ url: b.pageUrl, video: b.descriptor, playback: { position: b.position, paused: true, rate: b.rate } }) && Array.isArray(b.framePath)) : []
    if (message.type === "binding-save") {
      if (!message.descriptor || !validShared({ url: root.url, video: message.descriptor, playback: { position: message.position, paused: true, rate: message.rate } })) throw new Error("Invalid binding")
      const binding: Binding = { pageUrl: root.url, frameUrl: frame.url, framePath: path, descriptor: { ...message.descriptor, pageUrl: root.url, frameUrl: frame.url, framePath: path }, position: message.position!, rate: message.rate! }
      // One selected player per page; selecting another frame replaces the binding.
      await chrome.storage.local.set({ bindings: [...all.filter(b => b.pageUrl !== root.url).slice(-49), binding] })
      return null
    }
    const binding = all.find(b => b.pageUrl === root.url && b.frameUrl === frame.url && JSON.stringify(b.framePath) === JSON.stringify(path))
    if (!binding) return null
    const tabs = await chrome.tabs.query({})
    if (tabs.filter(t => t.url === root.url).length > 1 || frames.filter(f => f.url === frame.url && f.parentFrameId === frame.parentFrameId).length > 1) return { ambiguous: true }
    return { binding }
  })
  pending = task.catch(() => {})
  return task
}
