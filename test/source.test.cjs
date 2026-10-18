const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { test } = require("node:test")
const ts = require("typescript")
const Module = require("node:module")
const path = require("node:path")
function load(name, imports = {}) {
  const filename = path.resolve(__dirname, `../lib/${name}.ts`)
  const mod = new Module(filename, module)
  mod.require = id => id in imports ? imports[id] : id === "./i18n" ? require("./load-i18n.cjs") : ["./source", "./playback"].includes(id) ? load(id.slice(2)) : require(id)
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return mod.exports
}
const source = load("source"), protocol = load("room-protocol")
const descriptor = { pageUrl: "https://example.com/watch", frameUrl: "https://example.com/watch", framePath: [], shadowPath: [], selector: "#video", source: "https://media.example.com/1.mp4", duration: 100 }
const shared = { url: descriptor.pageUrl, video: descriptor, sourceRevision: 1, playback: { position: 0, paused: true, rate: 1 } }
test("shared pick uses the initiating tab URL, not the frame descriptor URL", () => {
  const base = "https://omnirezka.tv/series/comedy/93243-s-nulya-2026.html"
  const stale = { ...descriptor, pageUrl: `${base}#t:440-s:1-e:1` }
  const withoutHash = source.pickedSource(base, stale)
  assert.equal(withoutHash.url, base)
  assert.equal(withoutHash.video.pageUrl, base)
  const withHash = source.pickedSource(`${base}#t:10-s:1-e:2`, { ...descriptor, pageUrl: base })
  assert.equal(withHash.url, `${base}#t:10-s:1-e:2`)
  assert.equal(withHash.video.pageUrl, withHash.url)
  assert.equal(stale.pageUrl, `${base}#t:440-s:1-e:1`)
})
test("exact URL application waits for the browser and preserves both absent and present hash", async () => {
  const base = "https://omnirezka.tv/series/comedy/93243-s-nulya-2026.html"
  let actual = `${base}#t:440-s:1-e:1`, target, reads = 0
  global.chrome = { tabs: {
    update: async (_id, options) => { target = options.url; reads = 0; return { url: actual, pendingUrl: target } },
    get: async () => { if (++reads >= 2) actual = target; return { url: actual, pendingUrl: actual === target ? undefined : target } }
  } }
  const { applyExactTabUrl } = load("source-viewer", { "./messages": { CHANNEL: "test" }, "./source": source, "./room-protocol": protocol })
  await applyExactTabUrl(1, base)
  assert.equal(actual, base)
  assert.equal(reads, 2)
  await applyExactTabUrl(1, `${base}#t:20-s:1-e:2`)
  assert.equal(actual, `${base}#t:20-s:1-e:2`)
})
test("group status distinguishes shared choice from confirmed bindings, stale revisions and autoplay blocks", () => {
  const { groupPlayerStatus } = load("group-status")
  const room = { ready: true, shared, participants: ["self", "guest"], sourceReadiness: {}, sync: { epoch: "epoch", command: { sequence: 1 }, preparation: null, players: {} } }
  assert.equal(groupPlayerStatus(room).bound, 0)
  assert.equal(groupPlayerStatus(room).allReady, false) // A shared selector is not a binding acknowledgement.
  room.sourceReadiness.self = { revision: 1, status: "ready" }
  room.sourceReadiness.guest = { revision: 0, status: "ready" }
  assert.equal(groupPlayerStatus(room).bound, 1) // Old video readiness is not counted.
  room.sourceReadiness.guest = { revision: 1, status: "loading-video" }
  assert.equal(groupPlayerStatus(room).bound, 2)
  assert.equal(groupPlayerStatus(room).allReady, false)
  room.sourceReadiness.guest.status = "ready"
  assert.equal(groupPlayerStatus(room).allReady, true)
  room.sync.preparation = { id: "preparing" }
  assert.equal(groupPlayerStatus(room).allReady, false)
  room.sync.preparation = null
  room.sync.players.guest = { epoch: "epoch", sequence: 1, revision: 1, status: "blocked" }
  room.sync.players.self = { epoch: "epoch", sequence: 1, revision: 1, status: "ready" }
  assert.equal(groupPlayerStatus(room).synchronized, 1)
  assert.equal(groupPlayerStatus(room).bound, 2)
  assert.equal(groupPlayerStatus(room).allReady, false)
  assert.match(groupPlayerStatus(room).members[1].text, /разреши запуск/)
  room.sync.players.guest.status = "missing"
  assert.equal(groupPlayerStatus(room).bound, 1)
  room.sync.players.guest.status = "ready"
  assert.equal(groupPlayerStatus(room).synchronized, 2)
  room.sourceReadiness.guest.status = "wrong-page"
  assert.equal(groupPlayerStatus(room).synchronized, 1)
  room.sourceReadiness.guest.status = "ready"
  room.sync.players.guest.sequence = 0
  assert.equal(groupPlayerStatus(room).synchronized, 1)
  room.sync.preparation = { id: "new" }
  assert.equal(groupPlayerStatus(room).synchronized, 0)
  room.ready = false
  assert.equal(groupPlayerStatus(room).synchronized, 0)
  assert.equal(groupPlayerStatus(room).bound, 0)
  assert.equal(groupPlayerStatus(room).allReady, false)
})
test("URL and descriptor validation rejects unsafe URLs and mismatched pages", () => {
  for (const url of ["javascript:alert(1)", "chrome://settings", "https://user:password@example.com", "file:///test"]) assert.equal(source.webUrl(url), null)
  assert.equal(protocol.validRoomCommand({ kind: "source", url: "https://other.example.com", video: descriptor, expectedRevision: 0, commandId: crypto.randomUUID() }), false)
  const committed = source.commitSource({ ...shared, sourceRevision: undefined }, { kind: "source", url: shared.url, video: null, expectedRevision: 0, commandId: crypto.randomUUID() })
  assert.equal(committed.sourceRevision, 1)
  assert.equal(committed.playback.paused, true)
})
test("viewer only navigates explicitly bound tabs, preserves matching URLs and requires rebinding after close", async () => {
  const session = {}, tabs = new Map([[1, { id: 1, url: shared.url, status: "complete" }], [99, { id: 99, url: "https://unrelated.example.com", status: "complete" }]]), reports = [], bound = [], navigations = []
  let created = 0, missing = true, activeTabId = 99, reloads = 0
  global.chrome = {
    storage: { session: { get: async () => session, set: async value => Object.assign(session, value), remove: async key => { delete session[key] } } },
    tabs: {
      query: async () => [tabs.get(activeTabId)].filter(Boolean),
      reload: async id => { assert.equal(id, 1); reloads++ },
      create: async () => { created++; throw Error("Must not create tabs") },
      get: async id => { if (!tabs.has(id)) throw Error("Missing"); return tabs.get(id) },
      update: async (id, data) => { if (data.url) navigations.push({ id, url: data.url }); Object.assign(tabs.get(id), data); return tabs.get(id) },
      sendMessage: async (id, message) => {
        if (message.type === "source-watch") return { ok: true }
        if (message.type === "video") return { ok: true, data: { selectedId: "local", videos: [{ id: "local", descriptor: { ...descriptor, selector: "#local-player" } }] } }
        bound.push(message)
        return { ok: true, data: { status: missing && message.descriptor.selector !== "#local-player" ? "needs-video" : "ready" } }
      }
    },
    webNavigation: { getAllFrames: async ({ tabId }) => [{ frameId: 0, parentFrameId: -1, url: tabs.get(tabId).url }] },
    runtime: { sendMessage: async message => { reports.push(message.command.readiness); return { ok: true } } }
  }
  const viewer = load("source-viewer", { "./messages": { CHANNEL: "test" }, "./source": source, "./room-protocol": protocol })
  await viewer.applySourceState({ roomId: "room", ready: true, shared })
  assert.equal(created, 0)
  assert.equal(reports.at(-1).status, "unavailable")
  await viewer.bindSourceTab(99, "room", true)
  assert.equal(session.sourceViewer, undefined) // Unrelated active page cannot auto-bind.
  await viewer.autoBindActiveSource()
  assert.equal(session.sourceViewer, undefined)
  activeTabId = 1
  await viewer.autoBindActiveSource() // Background path needs no popup request.
  assert.equal(session.sourceViewer.tabId, 1)
  tabs.get(99).url = shared.url
  activeTabId = 99
  await viewer.autoBindActiveSource()
  assert.equal(session.sourceViewer.tabId, 1) // Never steal a live viewing tab.
  tabs.get(99).url = "https://unrelated.example.com"
  assert.equal(navigations.length, 0) // Already at the source: no reload.
  await viewer.refreshSource(1)
  assert.equal(reports.at(-1).status, "needs-video")
  assert.equal((await viewer.refreshSource(1)).startupPrompt, true)
  assert.equal(viewer.selectLocalSource, undefined)
  missing = false
  await viewer.refreshManagedSource() // Background retry binds a player that appeared later, without popup.
  assert.equal((await viewer.refreshSource(1)).startupPrompt, false)
  assert.equal(reports.at(-1).status, "ready")
  assert.equal(bound.at(-1).descriptor.selector, "#video")
  assert.equal(bound.at(-1).shared, true)
  tabs.get(1).url = "https://example.com/elsewhere"
  await viewer.openSourceUrl()
  assert.equal(tabs.get(1).url, shared.url)
  assert.equal(tabs.get(99).url, "https://unrelated.example.com")
  const afterReturn = navigations.length
  await viewer.openSourceUrl()
  assert.equal(navigations.length, afterReturn) // Already at shared URL: no reload.
  tabs.get(1).url = `${shared.url}?token=local`
  await viewer.openSourceUrl()
  await viewer.refreshSource(1)
  assert.equal(navigations.length, afterReturn) // Query changes are the same viewing page.
  assert.notEqual(reports.at(-1).status, "wrong-page")
  tabs.get(1).url = `${shared.url}#position`
  await viewer.refreshSource(1)
  assert.equal(reports.at(-1).status, "wrong-page")
  await viewer.openSourceUrl()
  assert.equal(tabs.get(1).url, shared.url)
  assert.equal(navigations.length, afterReturn + 1)
  assert.equal(shared.video.selector, "#video") // Local mapping never changes shared descriptor.
  const updated = { ...shared, url: "https://example.com/next", video: null, sourceRevision: 2 }
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 2 } })
  assert.equal(reloads, 1) // Explicit shared source change reloads even the same URL.
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 2 } })
  assert.equal(reloads, 1) // Periodic snapshots must not cause reload loops.
  tabs.get(1).url = `${shared.url}#t:440-s:1-e:1`
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 3 } })
  assert.equal(tabs.get(1).url, shared.url)
  assert.equal(reloads, 2) // Removed hash is applied before reloading.
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 3 } })
  assert.equal(reloads, 2)
  await viewer.expectLocalSourcePick("room", 1, 3, descriptor)
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 4 } })
  assert.equal(reloads, 2) // Initiator keeps the exact already-open picked source.
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, sourceRevision: 5 } })
  assert.equal(reloads, 3) // Exemption is consumed; later remote choices still reload.
  updated.sourceRevision = 6
  await viewer.applySourceState({ roomId: "room", ready: true, shared: updated })
  assert.equal(created, 0)
  assert.equal(tabs.get(1).url, updated.url)
  assert.equal(tabs.get(99).url, "https://unrelated.example.com")
  await viewer.applySourceState({ roomId: "room", ready: true, shared })
  assert.equal(tabs.get(1).url, updated.url)
  await viewer.closeSource(1)
  tabs.delete(1)
  await viewer.applySourceState({ roomId: "room", ready: true, shared: updated })
  assert.equal(tabs.size, 1)
  await assert.rejects(viewer.focusSource(), /закрыта/)
  await assert.rejects(viewer.openSourceUrl(), /закрыта/)
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...updated, sourceRevision: 6 } })
  assert.equal(created, 0)
  assert.equal(tabs.get(99).url, "https://unrelated.example.com") // New revision is not consent to use another tab.
  await viewer.bindSourceTab(99, "room")
  assert.equal(tabs.get(99).url, updated.url)
  const navigationCount = navigations.length
  await viewer.focusSource()
  assert.equal(tabs.get(99).active, true)
  assert.equal(navigations.length, navigationCount) // Focus does not navigate.
  // A new worker restores the same user-approved binding from storage.session.
  const restarted = load("source-viewer", { "./messages": { CHANNEL: "test" }, "./source": source, "./room-protocol": protocol })
  await restarted.applySourceState({ roomId: "room", ready: true, shared: { ...updated, sourceRevision: 6 } })
  assert.equal(navigations.length, navigationCount)
  await restarted.applySourceState({ roomId: null, ready: false, shared: { url: null, video: null, playback: { position: 0, paused: true, rate: 1 } } })
  assert.equal(tabs.has(99), true) // Leave detaches, never closes user's tab.
  await assert.rejects(restarted.focusSource(), /не привязана/)
  assert.equal(created, 0)
})

test("legacy auto-created viewer is not migrated into user consent", async () => {
  let touched = false
  global.chrome = {
    storage: { session: { get: async () => ({ sourceViewer: { roomId: "room", revision: 0, url: shared.url, tabId: 123 } }) } },
    tabs: { get: async () => { touched = true }, create: async () => { touched = true } },
    runtime: { sendMessage: async () => ({ ok: true }) }
  }
  const viewer = load("source-viewer", { "./messages": { CHANNEL: "test" }, "./source": source, "./room-protocol": protocol })
  await viewer.applySourceState({ roomId: "room", ready: true, shared })
  assert.equal(touched, false)
  await assert.rejects(viewer.focusSource(), /не привязана/)
})

test("shared iframe binding tolerates session query tokens without choosing an ambiguous frame", async () => {
  const session = {}, bound = [], reports = []
  let duplicate = false
  const remoteUrl = "https://player.example.com/embed?token=host"
  const localUrl = "https://player.example.com/embed?token=guest"
  const frameVideo = { ...descriptor, frameUrl: remoteUrl, framePath: [remoteUrl] }
  global.chrome = {
    storage: { session: { get: async () => session, set: async v => Object.assign(session, v) } },
    tabs: {
      get: async () => ({ id: 1, url: shared.url, status: "complete" }),
      sendMessage: async (_id, message, options) => {
        if (message.type === "source-watch") return { ok: true }
        bound.push({ message, options })
        return { ok: true, data: { status: "ready" } }
      }
    },
    webNavigation: { getAllFrames: async () => [
      { frameId: 0, parentFrameId: -1, url: shared.url },
      { frameId: 7, parentFrameId: 0, url: localUrl },
      ...(duplicate ? [{ frameId: 8, parentFrameId: 0, url: "https://player.example.com/embed?token=other" }] : [])
    ] },
    runtime: { sendMessage: async m => { reports.push(m.command.readiness); return { ok: true } } }
  }
  const viewer = load("source-viewer", { "./messages": { CHANNEL: "test" }, "./source": source, "./room-protocol": protocol })
  await viewer.applySourceState({ roomId: "room", ready: true, shared: { ...shared, video: frameVideo } })
  await viewer.bindSourceTab(1, "room")
  assert.equal(bound.at(-1).options.frameId, 7)
  assert.equal(bound.at(-1).message.shared, true)
  assert.equal(reports.at(-1).status, "ready")
  duplicate = true
  const count = bound.length
  await viewer.refreshSource(1)
  assert.equal(bound.length, count)
  assert.equal(reports.at(-1).status, "needs-video")
})
