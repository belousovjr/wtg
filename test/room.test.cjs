const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { test } = require("node:test")
const ts = require("typescript")
const Module = require("node:module")
const path = require("node:path")

function load(name, imports = {}) {
  const filename = path.resolve(__dirname, `../lib/${name}.ts`)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = module.paths
  mod.require = id => id in imports ? imports[id] : require(id)
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return mod.exports
}

test("room lifecycle, initial snapshot, pinned admin and retry", async () => {
  const protocol = load("room-protocol")
  const selfId = "s".repeat(20)
  let transport
  const sent = []
  let leaves = 0
  const { roomCommand } = load("room", {
    "./room-protocol": protocol,
    trystero: { selfId, joinRoom: () => {
      const action = { send: async (message, target) => { sent.push({ message, target }) } }
      transport = { makeAction: () => action, leave: async () => { leaves++ }, action }
      return transport
    } }
  })
  try {
    const initial = { url: "https://example.com", video: null, playback: { position: 35, paused: true, rate: 1 } }
    const created = await roomCommand({ kind: "create", initial })
    assert.equal(created.adminId, selfId)
    assert.equal(created.status, "waiting")
    assert.equal(created.ready, true)
    transport.onPeerJoin("guest")
    assert.deepEqual(sent.at(-1).message.shared, initial)
    assert.equal((await roomCommand({ kind: "status" })).status, "connected")
    await assert.rejects(roomCommand({ kind: "create" }), /Сначала/)
    const saved = created.invitation
    await roomCommand({ kind: "retry" })
    assert.equal((await roomCommand({ kind: "status" })).invitation, saved)
    await roomCommand({ kind: "leave" })
    assert.equal((await roomCommand({ kind: "status" })).invitation, null)

    const invite = { version: 1, roomId: "a".repeat(48), secret: "b".repeat(48), adminId: "c".repeat(20) }
    await roomCommand({ kind: "join", invitation: protocol.encodeInvitation(invite) })
    assert.equal((await roomCommand({ kind: "status" })).ready, false)
    transport.onPeerJoin("other-guest")
    assert.equal((await roomCommand({ kind: "status" })).ready, false)
    const message = { version: 1, roomId: invite.roomId, id: "snapshot-1", kind: "snapshot", sequence: 1, shared: initial, participants: [invite.adminId, selfId] }
    transport.action.onMessage(message, { peerId: "impostor" })
    assert.equal((await roomCommand({ kind: "status" })).ready, false)
    assert.equal((await roomCommand({ kind: "status" })).shared.url, null)
    transport.action.onMessage(message, { peerId: invite.adminId })
    assert.equal((await roomCommand({ kind: "status" })).ready, true)
    assert.deepEqual((await roomCommand({ kind: "status" })).shared, initial)
    transport.onPeerLeave(invite.adminId)
    assert.equal((await roomCommand({ kind: "status" })).status, "reconnecting")
    await roomCommand({ kind: "retry" })
    assert.equal((await roomCommand({ kind: "status" })).ready, false)
    assert.ok(leaves >= 2)
  } finally { await roomCommand({ kind: "leave" }) }
})
