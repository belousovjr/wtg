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
  mod.require = id => id in imports ? imports[id] : ["./source", "./playback"].includes(id) ? load(id.slice(2)) : require(id)
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return mod.exports
}
const protocol = load("room-protocol")
const identity = load("identity")
const membership = load("membership")
const persistence = load("persistence", { "./messages": { CHANNEL: "test" }, "./room-protocol": protocol, "./membership": membership })

function client(id, disk, network) {
  const transports = []
  const room = load("room", {
    "./room-protocol": protocol, "./identity": identity, "./membership": membership,
    "./persistence": { ...persistence, vaultRequest: async (operation, value) => {
      if (operation === "write") disk.value = structuredClone(value)
      return disk.value === undefined ? persistence.emptyVault() : structuredClone(disk.value)
    } },
    trystero: { selfId: id, joinRoom: (_config, roomId) => {
      const sent = []
      const action = { send: async (message, options) => {
        sent.push(structuredClone(message))
        for (const peer of network.filter(p => p.roomId === roomId && p.id !== id && (!options || options.target === p.id))) {
          peer.transport.action.onMessage?.(structuredClone(message), { peerId: id })
        }
      } }
      const transport = { sent, action, makeAction: () => action, leave: async () => {
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
  guest.transports.at(-1).action.onMessage({ version: 5, roomId: protocol.decodeInvitation(created.invitation).roomId,
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

test("admin removal, persistent ban, manual approval and readmission across Peer IDs", async () => {
  const network = [], adminDisk = {}, guestDisk = {}
  const admin = client("admin", adminDisk, network), guest = client("guest", guestDisk, network), other = client("other", {}, network)
  const created = await admin.roomCommand({ kind: "create" })
  const connect = async (a, b) => {
    a.transports.at(-1).onPeerJoin(b.id)
    b.transports.at(-1).onPeerJoin(a.id)
    await settle(a, b)
  }
  try {
    await guest.roomCommand({ kind: "join", invitation: created.invitation })
    await connect(admin, guest)
    await other.roomCommand({ kind: "join", invitation: created.invitation })
    await connect(admin, other)
    await settle(admin, guest, other)
    assert.equal((await admin.roomCommand({ kind: "status" })).participants.length, 3)
    await assert.rejects(guest.roomCommand({ kind: "remove", peerId: admin.id }), /Только администратор/)
    await assert.rejects(admin.roomCommand({ kind: "remove", peerId: admin.id }), /администратором/)

    // A forged policy must not remove an existing member or supersede revision.
    const policy = structuredClone(adminDisk.value.policies[0])
    guest.transports.at(-1).action.onMessage({ version: 5, roomId: policy.roomId, sequence: 1, id: "fake-policy", kind: "policy",
      policy: { ...policy, revision: policy.revision + 100, allowed: [policy.adminKey], blocked: [guestDisk.value.identity.publicKey] } }, { peerId: other.id })
    await settle(guest)
    assert.equal((await guest.roomCommand({ kind: "status" })).ready, true)

    await admin.roomCommand({ kind: "remove", peerId: guest.id })
    await settle(admin, guest, other)
    assert.equal((await guest.roomCommand({ kind: "status" })).status, "idle")
    assert.equal(guestDisk.value.session, null)
    assert.equal((await other.roomCommand({ kind: "status" })).participants.includes(guest.id), false)
    assert.equal((await admin.roomCommand({ kind: "status" })).approvalRequired, true)

    // Reusing the stored key under a new transport ID does not bypass removal.
    const returning = client("guest-new-id", guestDisk, network)
    await returning.roomCommand({ kind: "join", invitation: created.invitation })
    await connect(admin, returning)
    assert.equal((await returning.roomCommand({ kind: "status" })).status, "idle")
    assert.equal((await admin.roomCommand({ kind: "status" })).participants.includes(returning.id), false)

    // Even a fresh identity now needs explicit approval.
    const fresh = client("new-identity", {}, network)
    await fresh.roomCommand({ kind: "join", invitation: created.invitation })
    await connect(admin, fresh)
    assert.equal((await fresh.roomCommand({ kind: "status" })).ready, false)
    assert.equal((await admin.roomCommand({ kind: "status" })).pendingParticipants.some(p => p.peerId === fresh.id), true)
    await admin.roomCommand({ kind: "approve", peerId: fresh.id })
    await settle(admin, fresh)
    assert.equal((await fresh.roomCommand({ kind: "status" })).ready, true)

    await admin.roomCommand({ kind: "readmit", publicKey: guestDisk.value.identity.publicKey })
    await returning.roomCommand({ kind: "join", invitation: created.invitation })
    await connect(admin, returning)
    assert.equal((await returning.roomCommand({ kind: "status" })).ready, true)
    const saved = structuredClone(adminDisk.value)
    await admin.roomCommand({ kind: "leave" })
    adminDisk.value = saved
    const restored = client("admin-restored", adminDisk, network)
    assert.equal((await restored.roomCommand({ kind: "status" })).approvalRequired, true)
    await restored.roomCommand({ kind: "leave" })
    await fresh.roomCommand({ kind: "leave" })
    await returning.roomCommand({ kind: "leave" })
  } finally {
    await admin.roomCommand({ kind: "leave" })
    await guest.roomCommand({ kind: "leave" })
    await other.roomCommand({ kind: "leave" })
  }
})

test("mesh command gate rejects excluded, unknown and stale members", () => {
  const policy = { allowed: ["admin", "guest"], blocked: ["removed"] }
  assert.equal(membership.canAcceptMemberCommand(policy, "guest", "peer", ["peer"], true), true)
  assert.equal(membership.canAcceptMemberCommand(policy, "removed", "peer", ["peer"], true), false)
  assert.equal(membership.canAcceptMemberCommand(policy, undefined, "peer", ["peer"], true), false)
  assert.equal(membership.canAcceptMemberCommand(policy, "guest", "peer", [], true), false)
  assert.equal(membership.canAcceptMemberCommand(policy, "guest", "peer", ["peer"], false), false)
})

test("guest source changes are ordered by coordinator; stale requests, snapshots and readiness are ignored", async () => {
  const network = [], admin = client("admin", {}, network), guest = client("guest", {}, network)
  try {
    const created = await admin.roomCommand({ kind: "create" })
    await guest.roomCommand({ kind: "join", invitation: created.invitation })
    admin.transports.at(-1).onPeerJoin(guest.id)
    guest.transports.at(-1).onPeerJoin(admin.id)
    await settle(admin, guest)
    const command = { kind: "source", url: "https://example.com/watch", video: null, expectedRevision: 0, commandId: crypto.randomUUID() }
    await guest.roomCommand(command)
    await settle(admin, guest)
    assert.equal((await admin.roomCommand({ kind: "status" })).shared.sourceRevision, 1)
    assert.equal((await guest.roomCommand({ kind: "status" })).shared.url, command.url)
    await guest.roomCommand(command) // A duplicate request does not create another revision.
    await settle(admin, guest)
    assert.equal((await admin.roomCommand({ kind: "status" })).shared.sourceRevision, 1)
    await assert.rejects(admin.roomCommand({ ...command, commandId: crypto.randomUUID() }), /уже изменился/)
    const snapshot = admin.transports.at(-1).sent.findLast(m => m.kind === "snapshot")
    guest.transports.at(-1).action.onMessage({ ...snapshot, id: crypto.randomUUID(), shared: { ...snapshot.shared, sourceRevision: 0, url: "https://old.example.com" } }, { peerId: admin.id })
    await settle(guest)
    assert.equal((await guest.roomCommand({ kind: "status" })).shared.url, command.url)
    await guest.roomCommand({ kind: "source-ready", readiness: { revision: 1, status: "ready" } })
    await settle(admin, guest)
    assert.equal((await admin.roomCommand({ kind: "status" })).sourceReadiness.guest.status, "ready")
    await guest.roomCommand({ kind: "source-ready", readiness: { revision: 0, status: "needs-video" } })
    await settle(admin, guest)
    assert.equal((await admin.roomCommand({ kind: "status" })).sourceReadiness.guest.status, "ready")
    admin.transports.at(-1).action.onMessage({ version: 5, roomId: protocol.decodeInvitation(created.invitation).roomId, sequence: 1, id: crypto.randomUUID(), kind: "source-request", command: { ...command, expectedRevision: 1, commandId: crypto.randomUUID(), url: "https://attacker.example.com" } }, { peerId: "unadmitted" })
    await settle(admin)
    assert.equal((await admin.roomCommand({ kind: "status" })).shared.url, command.url)
  } finally { await admin.roomCommand({ kind: "leave" }); await guest.roomCommand({ kind: "leave" }) }
})
