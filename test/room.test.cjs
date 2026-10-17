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
const protocol = load("room-protocol")
const identity = load("identity")
const persistence = load("persistence", { "./messages": { CHANNEL: "test" }, "./room-protocol": protocol })

function client(id, disk, network) {
  const transports = []
  const room = load("room", {
    "./room-protocol": protocol, "./identity": identity,
    "./persistence": { ...persistence, vaultRequest: async (operation, value) => {
      if (operation === "write") disk.value = structuredClone(value)
      return disk.value === undefined ? persistence.emptyVault() : structuredClone(disk.value)
    } },
    trystero: { selfId: id, joinRoom: (_config, roomId) => {
      const action = { send: async (message, options) => {
        for (const peer of network.filter(p => p.roomId === roomId && p.id !== id && (!options || options.target === p.id))) {
          peer.transport.action.onMessage?.(structuredClone(message), { peerId: id })
        }
      } }
      const transport = { action, makeAction: () => action, leave: async () => {
        const index = network.findIndex(p => p.transport === transport)
        if (index >= 0) network.splice(index, 1)
      } }
      transports.push(transport)
      network.push({ id, roomId, transport })
      return transport
    } }
  })
  return { ...room, transports, id }
}
async function settle(...clients) {
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    await Promise.all(clients.map(c => c.roomCommand({ kind: "status" })))
  }
}

test("identity signatures bind room, challenge and both transport IDs", async () => {
  const keys = await identity.createIdentity()
  assert.equal(await identity.validateIdentity(keys), true)
  const message = identity.challengeText("room", "from", "to", "nonce")
  const signature = await identity.sign(keys, message)
  assert.equal(await identity.verify(keys.publicKey, signature, message), true)
  assert.equal(await identity.verify(keys.publicKey, signature, identity.challengeText("room", "from", "other-peer", "nonce")), false)
  assert.equal(await identity.verify((await identity.createIdentity()).publicKey, signature, message), false)
})

test("persistent identity restores creator under new Peer ID; guest waits for verified snapshot", async () => {
  const network = [], adminDisk = {}, guestDisk = {}
  const admin = client("admin-old", adminDisk, network), guest = client("guest", guestDisk, network)
  const initial = { url: "https://example.com", video: null, playback: { position: 35, paused: false, rate: 1 } }
  const created = await admin.roomCommand({ kind: "create", initial })
  await guest.roomCommand({ kind: "join", invitation: created.invitation })
  assert.equal((await guest.roomCommand({ kind: "status" })).ready, false)
  admin.transports.at(-1).onPeerJoin(guest.id)
  guest.transports.at(-1).onPeerJoin(admin.id)
  await settle(admin, guest)
  assert.equal((await guest.roomCommand({ kind: "status" })).ready, true)
  assert.equal((await guest.roomCommand({ kind: "status" })).adminId, "admin-old")
  const saved = structuredClone(adminDisk.value)
  await admin.roomCommand({ kind: "leave" })
  assert.equal(adminDisk.value.session, null)
  assert.deepEqual(adminDisk.value.identity, saved.identity)
  adminDisk.value = saved // Simulate process loss, with storage retained.
  const restored = client("admin-new", adminDisk, network)
  const state = await restored.roomCommand({ kind: "status" })
  assert.equal(state.isAdmin, true)
  assert.equal(state.shared.playback.paused, true)
  assert.equal(state.shared.playback.position, 35)
  assert.equal(state.invitation, created.invitation)
  restored.transports.at(-1).onPeerJoin(guest.id)
  guest.transports.at(-1).onPeerJoin(restored.id)
  await settle(restored, guest)
  assert.equal((await guest.roomCommand({ kind: "status" })).adminId, "admin-new")
  await restored.roomCommand({ kind: "leave" })
  await guest.roomCommand({ kind: "leave" })
})

test("signed end survives offline guest and cannot be forged", async () => {
  const network = [], disk = {}
  const admin = client("admin", disk, network)
  const created = await admin.roomCommand({ kind: "create" })
  await admin.roomCommand({ kind: "end" })
  assert.equal(disk.value.session, null)
  assert.equal(disk.value.ended.length, 1)
  await assert.rejects(admin.roomCommand({ kind: "join", invitation: created.invitation }), /завершена/)
  const guest = client("returning-guest", {}, network)
  await guest.roomCommand({ kind: "join", invitation: created.invitation })
  guest.transports.at(-1).action.onMessage({ version: 2, roomId: protocol.decodeInvitation(created.invitation).roomId,
    id: "forged-end", sequence: 1, kind: "ended", certificate: { ...disk.value.ended[0], signature: "forged" } }, { peerId: "attacker" })
  await settle(guest)
  assert.notEqual((await guest.roomCommand({ kind: "status" })).status, "idle")
  const archived = network.find(p => p.id === "admin")
  archived.transport.onPeerJoin(guest.id)
  await settle(guest)
  assert.equal((await guest.roomCommand({ kind: "status" })).status, "idle")
  await guest.roomCommand({ kind: "leave" })
})

test("unknown storage schema and corrupt identity do not silently replace keys", async () => {
  assert.throws(() => persistence.validateVault({ version: 99 }), /миграция/)
  assert.throws(() => persistence.validateVault({ version: 1, identity: {}, session: null, ended: [] }), /идентичность/)
  const keys = await identity.createIdentity()
  const different = await identity.createIdentity()
  assert.equal(await identity.validateIdentity({ ...keys, publicKey: different.publicKey }), false)
})
