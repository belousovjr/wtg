const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readFileSync } = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function load(name, clock, imports = {}, extra = {}) {
  const code = ts.transpileModule(readFileSync(path.resolve(__dirname, `../lib/${name}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: id => imports[id] || (id === "./player-indicator" ? { PlayerIndicator: class { begin() {} clear() {} update() {} } } : undefined), performance: { timeOrigin: clock.origin || 0, now: () => clock.time },
    crypto, structuredClone, setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout, ...extra })
  return exports
}
test("indicator waits for every participant's current acknowledgement and scheduled time", () => {
  const clock = { time: 1000 }, pb = load("playback", clock)
  const { indicatorState } = load("player-indicator", clock, { "./playback": pb })
  const state = { epoch: "e", command: { sequence: 3, executeAt: 1500 }, preparation: null, clock: { offset: 0 }, participantIds: ["a", "b"], players: {} }
  assert.equal(indicatorState(state, 1).ready, false)
  clock.time = 1500
  state.players.a = { epoch: "e", revision: 1, sequence: 3, status: "ready" }
  state.players.b = { epoch: "e", revision: 1, sequence: 2, status: "ready" }
  assert.equal(indicatorState(state, 1).ready, false)
  state.players.b.sequence = 3
  assert.equal(indicatorState(state, 1).ready, true)
  state.players.b.status = "blocked"
  assert.equal(indicatorState(state, 1).ready, false)
  assert.match(indicatorState(state, 1).text, /ручного запуска/)
  state.selfId = "b"
  assert.match(indicatorState(state, 1, true).text, /Нажми Play/)
  assert.equal(indicatorState(state, 1, true).urgent, true)
  state.preparation = { id: "new" }
  assert.equal(indicatorState(state, 1).ready, false)
})

test("player marker stays visible through loading and acknowledgement, then dismisses after stable readiness", () => {
  const clock = { time: 1000 }, pb = load("playback", clock), nodes = []
  const host = { append(node) { node.parentElement = this; nodes.push(node) } }
  const document = { documentElement: host, fullscreenElement: null, createElement: () => ({ style: {}, setAttribute() {}, remove() { this.removed = true } }) }
  const { PlayerIndicator } = load("player-indicator", clock, { "./playback": pb }, { document, window: { innerWidth: 1000 } })
  const marker = new PlayerIndicator(), video = { isConnected: true, seeking: false, readyState: 4, getBoundingClientRect: () => ({ right: 800, top: 30, width: 800, height: 450 }) }
  const state = { epoch: "e", command: { sequence: 1, commandId: "old", executeAt: 0 }, preparation: null, clock: { offset: 0 }, participantIds: ["a"], players: { a: { epoch: "e", revision: 0, sequence: 1, status: "ready" } } }
  marker.update(video, { ...state, command: null, clock: null }, 0, false)
  assert.equal(nodes.length, 0) // No startup spinner before a real playback operation.
  marker.update(video, { ...state, command: null, clock: null }, 0, false, true)
  assert.match(nodes[0].textContent, /Нажми Play/)
  marker.clear(); nodes.length = 0
  marker.begin("new")
  marker.update(video, state, 0, true)
  const node = nodes[0]
  clock.time += 5000
  marker.update(video, state, 0, false)
  assert.equal(node.removed, undefined) // Old all-ready is not the user's acknowledgement.
  assert.equal(node.textContent, "◌")
  state.command = { sequence: 2, commandId: "new", executeAt: 0 }
  state.players.a.sequence = 2
  video.readyState = 1
  marker.update(video, state, 0, false)
  assert.equal(node.textContent, "◌")
  video.paused = true
  marker.update(video, state, 0, false)
  assert.equal(node.textContent, "◌")
  assert.doesNotMatch(node.textContent, /Буферизация/)
  marker.update(video, state, 0, false, false, true)
  assert.equal(node.textContent, "◌")
  video.paused = false
  marker.update(video, state, 0, true, true)
  assert.match(node.textContent, /Нажми Play/)
  assert.doesNotMatch(node.textContent, /Буферизация/)
  video.readyState = 4
  marker.update(video, state, 0, false)
  assert.equal(node.textContent, "✓")
  clock.time += 1201; marker.update(video, state, 0, false)
  assert.equal(node.removed, true)
  marker.update(video, { ...state, adminSync: { synchronized: 1, total: 2 } }, 0, false)
  const adminNode = nodes.find(item => item.textContent?.includes("Синхронизированы 1 / 2"))
  assert.match(adminNode.textContent, /Синхронизированы 1 \/ 2/)
  marker.update(video, { ...state, adminSync: { synchronized: 2, total: 2 } }, 0, false)
  assert.equal(adminNode.removed, true)
  const count = nodes.length
  marker.update(video, state, 0, false) // Guest projection contains no admin summary.
  assert.equal(nodes.length, count)
})

test("clock estimator accounts for clock offset and remote processing; timelines compensate late execution", () => {
  const pb = load("playback", { time: 0 })
  const estimate = pb.clockSample(1000, 1520, 1530, 1050)
  assert.equal(estimate.offset, 500)
  assert.equal(estimate.rtt, 40)
  assert.equal(estimate.uncertainty, 20)
  assert.equal(pb.clockSample(100, 20, 10, 90), null)
  const c = { position: 10, executeAt: 1000, paused: false, rate: 2 }
  assert.equal(pb.positionAt(c, 900), 10)
  assert.equal(pb.positionAt(c, 1250), 10.5)
  assert.equal(pb.positionAt({ ...c, paused: true }, 5000), 10)
  assert.equal(pb.startLead([]), 400)
  assert.equal(pb.startLead([{ rtt: 10000, uncertainty: 5000 }]), 3000)
})

test("coordinator prepares, waits for three clock samples, schedules future start and allows immediate pause", async () => {
  const hostClock = { time: 100000 }, guestClock = { time: 100000, origin: 500 }
  const hostPb = load("playback", hostClock), guestPb = load("playback", guestClock)
  let rev = 0
  const commits = [], sent = []
  let host, guest
  const move = ms => { hostClock.time += ms; guestClock.time += ms }
  const makeOptions = (id, isAdmin) => ({
    selfId: id, isAdmin, adminId: () => "host", participants: () => ["host", "guest"], ready: () => true, revision: () => rev,
    serialize: fn => fn(), changed: () => {}, error: message => { throw Error(message) }, committed: async c => { commits.push({ id, command: c }) },
    send: async (kind, data) => {
      sent.push(kind); move(20)
      await (isAdmin ? guest : host).receive(kind, data || {}, id, isAdmin)
    }
  })
  host = new hostPb.PlaybackSession(makeOptions("host", true))
  guest = new guestPb.PlaybackSession(makeOptions("guest", false))
  try {
    await guest.acceptSnapshot(host.wire())
    for (let i = 0; i < 3; i++) { move(220); await guest.tick() }
    assert.equal(guest.local().clock.offset, -500)
    const request = { epoch: host.wire().epoch, commandId: crypto.randomUUID(), revision: 0, action: "play", position: 12, rate: 1 }
    await guest.request(request)
    assert.equal(host.wire().command, null)
    const prep = host.wire().preparation
    assert.ok(prep)
    await host.player({ epoch: prep.epoch, revision: 0, preparationId: prep.id, status: "ready" })
    await guest.player({ epoch: prep.epoch, revision: 0, preparationId: prep.id, status: "ready" })
    await host.tick()
    assert.equal(host.wire().command.sequence, 1)
    assert.equal(guest.wire().command.sequence, 1)
    assert.ok(host.wire().command.executeAt > hostClock.time)
    await guest.request(request)
    assert.equal(host.wire().command.sequence, 1)
    await guest.request({ ...request, commandId: crypto.randomUUID(), action: "play" })
    assert.ok(host.wire().preparation)
    await guest.request({ ...request, commandId: crypto.randomUUID(), action: "pause" })
    assert.equal(host.wire().preparation, null)
    assert.equal(host.wire().command.paused, true)
    assert.equal(host.wire().command.sequence, 2)
    assert.ok(host.wire().command.executeAt - hostClock.time <= 250)
    await guest.receive("pb-commit", { command: { ...host.wire().command, sequence: 4 } }, "host", true)
    assert.ok(sent.includes("pb-resync"))
    assert.equal(guest.wire().command.sequence, 2)
    await guest.acceptSnapshot({ ...host.wire(), sequence: 1, command: null, preparation: null })
    assert.equal(guest.wire().command.sequence, 2) // Old empty snapshots cannot erase an applied command.
    rev = 1
    await host.tick(); await guest.tick()
    assert.equal(host.wire().command, null)
    await assert.rejects(host.request(request), /другому видео/)
  } finally { host.dispose(); guest.dispose() }
})

test("preparation deadline starts without waiting forever for a missing participant", async () => {
  const clock = { time: 100000 }, pb = load("playback", clock)
  const actor = new pb.PlaybackSession({ selfId: "host", isAdmin: true, adminId: () => "host", participants: () => ["host", "offline"], ready: () => true, revision: () => 0,
    serialize: fn => fn(), changed: () => {}, committed: async () => {}, send: async () => {}, error: () => {} })
  try {
    await actor.request({ epoch: actor.wire().epoch, commandId: crypto.randomUUID(), revision: 0, action: "play", position: 0, rate: 1 })
    clock.time += 4999
    await actor.tick()
    assert.equal(actor.wire().command, null)
    clock.time += 2
    await actor.tick()
    assert.equal(actor.wire().command.sequence, 1)
    assert.equal(actor.wire().command.paused, false)
  } finally { actor.dispose() }
})

test("player waits for executeAt, applies late timeline, suppresses command echoes and cancels on detach", async () => {
  const clock = { time: 1000 }, tasks = new Map()
  let id = 0
  const timers = { setTimeout: (fn, delay) => { tasks.set(++id, { fn, at: clock.time + delay }); return id }, clearTimeout: key => tasks.delete(key) }
  const run = () => { for (const [key, task] of [...tasks]) if (task.at <= clock.time) { tasks.delete(key); task.fn() } }
  class Video extends EventTarget {
    isConnected = true; readyState = 4; duration = 100; seeking = false; paused = true; position = 0; rate = 1; plays = 0
    seekable = { length: 1, start: () => 0, end: () => 100 }
    get currentTime() { return this.position }
    set currentTime(value) { this.position = value; this.dispatchEvent(new Event("seeked")) }
    get playbackRate() { return this.rate }
    set playbackRate(value) { this.rate = value; this.dispatchEvent(new Event("ratechange")) }
    pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")) } }
    play() { this.plays++; this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve() }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, timers)
  const video = new Video(), events = []
  const sync = new player.PlayerSync(() => video, (_room, _rev, message) => events.push(message))
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 1200, position: 10, paused: false, rate: 1 }
  const local = { epoch: "epoch", command, preparation: null, players: {}, clock: { offset: 0, rtt: 0, uncertainty: 0 } }
  sync.update("room", 0, local)
  clock.time = 1199; run(); assert.equal(video.plays, 0)
  clock.time = 1400; run(); await Promise.resolve()
  assert.equal(video.plays, 1)
  assert.equal(video.currentTime, 10.2)
  assert.equal(events.filter(e => e.kind === "request").length, 0)
  video.pause()
  clock.time += 250; run()
  assert.equal(events.filter(e => e.kind === "request").at(-1).request.action, "pause")
  sync.update("room", 0, { ...local, command: { ...command, sequence: 2, executeAt: 2000 } })
  sync.update("room", 0, null)
  clock.time = 3000; run()
  assert.equal(video.plays, 1)
})

test("manual seek survives state refreshes but not source, epoch, room or player replacement", () => {
  const clock = { time: 1000 }, tasks = new Map(), events = []
  let id = 0
  const timers = { setTimeout: fn => { tasks.set(++id, fn); return id }, clearTimeout: key => tasks.delete(key) }
  const flush = () => { for (const [key, fn] of [...tasks]) { tasks.delete(key); fn() } }
  class Video extends EventTarget {
    isConnected = true; currentTime = 25; playbackRate = 1; paused = true
    pause() {}
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, timers)
  let video = new Video()
  const sync = new player.PlayerSync(() => video, (_room, _rev, message) => events.push(message))
  const state = { epoch: "epoch", command: null, preparation: null, players: {}, clock: null }
  sync.update("room", 0, state)
  video.dispatchEvent(new Event("seeking"))
  flush()
  assert.equal(events.length, 0) // Start is diagnostic, not a rate/seek command.
  video.dispatchEvent(new Event("seeked"))
  sync.update("room", 0, { ...state })
  flush()
  assert.equal(events.length, 1)
  assert.equal(events[0].request.action, "seek")
  assert.equal(events[0].request.position, 25)
  // Repeated user seeks coalesce to the latest explicit position.
  video.currentTime = 35; video.dispatchEvent(new Event("seeked"))
  video.currentTime = 45; video.dispatchEvent(new Event("seeked"))
  sync.update("room", 0, { ...state })
  flush()
  assert.equal(events.length, 2)
  assert.equal(events[1].request.position, 45)
  for (const change of [
    () => sync.update("room", 1, state),
    () => sync.update("room", 0, { ...state, epoch: "new" }),
    () => sync.update("other", 0, state),
    () => {
      const old = video
      video = new Video(); sync.bind()
      old.dispatchEvent(new Event("seeked")) // Detached listener must not dispatch.
    },
    () => sync.update("room", 0, null)
  ]) {
    sync.update("room", 0, state)
    video.dispatchEvent(new Event("seeked"))
    change(); flush()
    assert.equal(events.length, 2)
  }
})

test("preparation refresh does not repeat seeking and early timer waits for executeAt", () => {
  const clock = { time: 1000 }, tasks = []
  let seeks = 0, plays = 0
  const video = { isConnected: true, readyState: 4, duration: 100, seeking: false, paused: true, playbackRate: 1,
    position: 0, seekable: { length: 1, start: () => 0, end: () => 100 },
    get currentTime() { return this.position }, set currentTime(value) { seeks++; this.position = value },
    addEventListener() {}, removeEventListener() {}, pause() {}, play() { plays++; return Promise.resolve() } }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    setTimeout: fn => { tasks.push(fn); return tasks.length }, clearTimeout: () => {}
  })
  const sync = new player.PlayerSync(() => video, () => {})
  const prep = { epoch: "epoch", revision: 0, id: "prep", position: 10, rate: 1, deadline: 5000 }
  const state = { epoch: "epoch", command: null, preparation: prep, players: {}, clock: { offset: 0, rtt: 0, uncertainty: 0 } }
  sync.update("room", 0, state)
  video.position = 9.5
  sync.update("room", 0, { ...state })
  assert.equal(seeks, 1)
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 1500, position: 10, paused: false, rate: 1 }
  sync.update("room", 0, { ...state, preparation: null, command })
  tasks.shift()() // Simulate a timer that woke early.
  assert.equal(plays, 0)
  clock.time = 1500
  tasks.shift()()
  assert.equal(plays, 1)
  sync.update("room", 0, null)
})

test("buffering manual seek resists old timers, canplay and unrelated preparations until its own acknowledgement", () => {
  const clock = { time: 1000 }, tasks = [], events = []
  class Video extends EventTarget {
    isConnected = true; readyState = 4; duration = 100; seeking = false; paused = false; currentTime = 10; playbackRate = 1
    seekable = { length: 1, start: () => 0, end: () => 100 }
    pause() { this.paused = true }
    play() { this.paused = false; return Promise.resolve() }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    setTimeout: fn => { tasks.push(fn); return tasks.length }, clearTimeout: () => {}
  })
  const video = new Video(), sync = new player.PlayerSync(() => video, (_r, _v, message) => events.push(message))
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 1200, position: 10, paused: false, rate: 1 }
  const state = { epoch: "epoch", command, preparation: null, players: {}, clock: { offset: 0, rtt: 0, uncertainty: 0 } }
  sync.update("room", 0, state)
  video.currentTime = 60; video.seeking = true; video.readyState = 1
  video.dispatchEvent(new Event("seeking"))
  clock.time = 8000
  sync.update("room", 0, { ...state })
  tasks.shift()() // Even an already-queued old callback must yield.
  video.dispatchEvent(new Event("canplay"))
  assert.equal(video.currentTime, 60)
  video.seeking = false; video.readyState = 4
  video.dispatchEvent(new Event("seeked"))
  tasks.shift()()
  const request = events.find(e => e.kind === "request").request
  const prep = { epoch: "epoch", revision: 0, id: "other", commandId: crypto.randomUUID(), position: 10, rate: 1, deadline: 12000 }
  sync.update("room", 0, { ...state, preparation: prep })
  video.dispatchEvent(new Event("canplay"))
  assert.equal(video.currentTime, 60)
  sync.update("room", 0, { ...state, preparation: { ...prep, id: "own", commandId: request.commandId, position: 60 } })
  assert.equal(video.currentTime, 60)
  assert.equal(events.at(-1).report.preparationId, "own")
  sync.update("room", 0, null)
})

test("slow remote seek remains an echo after buffering and the playing commit resumes video", async () => {
  const clock = { time: 1000 }, tasks = [], events = []
  class Video extends EventTarget {
    isConnected = true; readyState = 4; duration = 100; seeking = false; paused = false; position = 10; playbackRate = 1; plays = 0
    seekable = { length: 1, start: () => 0, end: () => 100 }
    get currentTime() { return this.position }
    set currentTime(value) { this.position = value; this.seeking = true; this.dispatchEvent(new Event("seeking")) }
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")) }
    play() { this.plays++; this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve() }
    finishSeek() { this.seeking = false; this.dispatchEvent(new Event("seeked")) }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    setTimeout: fn => { tasks.push(fn); return tasks.length }, clearTimeout: () => {}
  })
  const video = new Video(), sync = new player.PlayerSync(() => video, (_r, _v, message) => events.push(message))
  const prep = { epoch: "epoch", revision: 0, id: "prep", position: 60, rate: 1, deadline: 10000 }
  const state = { epoch: "epoch", command: null, preparation: prep, players: {}, clock: { offset: 0, rtt: 0, uncertainty: 0 } }
  sync.update("room", 0, state)
  clock.time += 4000; video.finishSeek()
  assert.equal(events.filter(e => e.kind === "request").length, 0)
  assert.equal(events.at(-1).report.status, "ready")
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 5400, position: 60, paused: false, rate: 1 }
  sync.update("room", 0, { ...state, preparation: null, command })
  clock.time = 5400; tasks.shift()(); await Promise.resolve()
  assert.equal(video.paused, false)
  assert.equal(video.plays, 1)
  assert.equal(events.filter(e => e.kind === "request").length, 0)
  sync.update("room", 0, null)
})

test("pause before seeking does not stop the room; seek preparation commits playing and resumes", async () => {
  const clock = { time: 1000 }, tasks = new Map(), requests = []
  let id = 0
  const run = () => { for (const [key, task] of [...tasks]) if (task.at <= clock.time) { tasks.delete(key); task.fn() } }
  class Video extends EventTarget {
    isConnected = true; readyState = 4; duration = 100; seeking = false; paused = true; currentTime = 10; playbackRate = 1
    seekable = { length: 1, start: () => 0, end: () => 100 }
    pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")) } }
    play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve() }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    setTimeout: (fn, delay) => { tasks.set(++id, { fn, at: clock.time + delay }); return id }, clearTimeout: key => tasks.delete(key)
  })
  const actor = new pb.PlaybackSession({ selfId: "host", isAdmin: true, adminId: () => "host", participants: () => ["host"], ready: () => true, revision: () => 0,
    serialize: fn => fn(), changed: () => {}, committed: async () => {}, send: async () => {}, error: () => {} })
  const video = new Video(), sync = new player.PlayerSync(() => video, (_r, _v, message) => { if (message.kind === "request") requests.push(message.request) })
  try {
    await actor.request({ epoch: actor.wire().epoch, revision: 0, commandId: crypto.randomUUID(), action: "play", position: 10, rate: 1 })
    let prep = actor.wire().preparation
    await actor.player({ epoch: prep.epoch, revision: 0, preparationId: prep.id, status: "ready" }); await actor.tick()
    sync.update("room", 0, actor.local())
    clock.time = actor.wire().command.executeAt; run(); await Promise.resolve()
    assert.equal(video.paused, false)
    // Actual custom-player ordering omitted from earlier tests: pause comes FIRST.
    video.pause()
    clock.time += 50; video.currentTime = 60; video.seeking = true; video.readyState = 1
    video.dispatchEvent(new Event("seeking"))
    clock.time += 4000; run()
    assert.equal(requests.length, 0)
    video.seeking = false; video.readyState = 4; video.dispatchEvent(new Event("seeked"))
    clock.time += 150; run()
    assert.equal(requests.length, 1); assert.equal(requests[0].action, "seek")
    await actor.request(requests[0])
    prep = actor.wire().preparation
    assert.ok(prep)
    sync.update("room", 0, actor.local())
    await actor.player({ epoch: prep.epoch, revision: 0, preparationId: prep.id, status: "ready" }); await actor.tick()
    assert.equal(actor.wire().command.paused, false)
    sync.update("room", 0, actor.local())
    clock.time = actor.wire().command.executeAt; run(); await Promise.resolve()
    assert.equal(video.paused, false)
  } finally { sync.update("room", 0, null); actor.dispose() }
})

test("drift correction respects base speed, deadband, bounds and large errors", () => {
  const pb = load("playback", { time: 0 })
  assert.equal(pb.driftCorrection(0.04, 1.5).rate, 1.5)
  assert.ok(pb.driftCorrection(0.3, 1.5).rate > 1.5)
  assert.ok(pb.driftCorrection(-0.3, 1.5).rate < 1.5)
  assert.equal(pb.driftCorrection(0.3, 4).rate, 4)
  assert.equal(pb.driftCorrection(-0.3, 0.25).rate, 0.25)
  assert.equal(pb.driftCorrection(0.1, 1, 200).rate, 1)
  assert.equal(pb.driftCorrection(0.8, 1).seek, true)
})

test("continuous correction changes rate then restores it, seeks large drift without echoes and yields to manual seeks", async () => {
  const clock = { time: 1000 }, tasks = [], events = []
  let tick
  class Video extends EventTarget {
    isConnected = true; readyState = 4; duration = 100; seeking = false; paused = true; position = 0; rate = 1
    seekable = { length: 1, start: () => 0, end: () => 100 }
    get currentTime() { return this.position }
    set currentTime(value) { this.position = value; this.dispatchEvent(new Event("seeking")); this.dispatchEvent(new Event("seeked")) }
    get playbackRate() { return this.rate }
    set playbackRate(value) { this.rate = value; this.dispatchEvent(new Event("ratechange")) }
    pause() { this.paused = true }
    play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve() }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    setInterval: fn => { tick = fn; return 1 }, clearInterval: () => { tick = undefined },
    setTimeout: fn => { tasks.push(fn); return tasks.length }, clearTimeout: () => {}
  })
  const video = new Video(), sync = new player.PlayerSync(() => video, (_r, _v, message) => events.push(message))
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 1000, position: 10, paused: false, rate: 1.5 }
  sync.update("room", 0, { epoch: "epoch", command, preparation: null, players: {}, clock: { offset: 0, rtt: 0, uncertainty: 0 } })
  tasks.shift()(); await Promise.resolve()
  video.position = 9.7; tick()
  assert.ok(video.rate > 1.5)
  video.position = 10; tick()
  assert.equal(video.rate, 1.5)
  video.position = 5; tick()
  assert.equal(video.position, 10)
  assert.equal(events.filter(e => e.kind === "request").length, 0)
  clock.time += 1100
  video.readyState = 1; video.position = 5; tick()
  assert.equal(video.position, 5) // Buffering never issues a group pause or forced seek.
  video.readyState = 4; tick()
  assert.equal(video.position, 11.65)
  clock.time += 1100
  video.position = 30; video.dispatchEvent(new Event("seeked")); tick()
  assert.equal(video.position, 30) // Explicit action is not pulled back to old timeline.
  sync.update("room", 0, null)
  assert.equal(tick, undefined)
})

test("autoplay denial is cleared by native Play without an extra button or shared restart", async () => {
  const clock = { time: 1000 }, tasks = [], panels = [], events = []
  class Video extends EventTarget {
    isConnected = true; readyState = 0; duration = 100; seeking = false; paused = true; currentTime = 0; playbackRate = 1; blocked = true
    seekable = { length: 1, start: () => 0, end: () => 100 }
    pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event("pause")) } }
    play() {
      if (this.blocked) return Promise.reject(Object.assign(new Error("Blocked"), { name: "NotAllowedError" }))
      this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve()
    }
  }
  const document = {
    createElement: () => ({ style: {}, children: [], append(child) { this.children.push(child) }, remove() { this.removed = true } }),
    documentElement: { append(panel) { panels.push(panel) } }
  }
  const pb = load("playback", clock), player = load("player-sync", clock, { "./playback": pb }, {
    document, setTimeout: fn => { tasks.push(fn); return tasks.length }, clearTimeout: () => {}
  })
  const video = new Video(), sync = new player.PlayerSync(() => video, (_room, _rev, message) => events.push(message))
  const command = { epoch: "epoch", revision: 0, sequence: 1, commandId: crypto.randomUUID(), executeAt: 1000, position: 0, paused: false, rate: 1 }
  const state = { epoch: "epoch", sequence: 1, command, preparation: null, players: {}, clock: null }
  sync.update("room", 0, state)
  assert.equal(tasks.length, 0) // Do not guess executeAt while clock is unknown.
  sync.update("room", 0, { ...state, clock: { offset: 0, rtt: 0, uncertainty: 0 } })
  tasks.pop()()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(events.at(-1).report.status, "blocked")
  assert.equal(panels.length, 0)
  video.readyState = 4
  video.blocked = false
  await video.play() // Native player invokes play within the user's gesture.
  assert.equal(events.at(-1).report.status, "loading")
  tasks.pop()()
  await Promise.resolve(); await Promise.resolve()
  assert.equal(video.paused, false)
  assert.equal(events.at(-1).report.status, "ready")
  assert.equal(events.filter(e => e.kind === "request").length, 0)
  sync.update("room", 0, null)
})
