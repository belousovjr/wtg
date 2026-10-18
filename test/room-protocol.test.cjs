const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { test } = require("node:test")
const ts = require("typescript")
const Module = require("node:module")
const path = require("node:path")

// Load the pure TS protocol without adding a second TS runner dependency.
const filename = path.resolve(__dirname, "../lib/room-protocol.ts")
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
}).outputText
const protocol = new Module(filename, module)
protocol.filename = filename
protocol.paths = module.paths
protocol.require = id => {
  if (id === "./i18n") return require("./load-i18n.cjs")
  if (!["./source", "./playback"].includes(id)) return require(id)
  const source = new Module(filename, module)
  source.require = protocol.require
  source._compile(ts.transpileModule(readFileSync(path.resolve(__dirname, `../lib/${id.slice(2)}.ts`), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return source.exports
}
protocol._compile(compiled, filename)
const { encodeInvitation, decodeInvitation, validShared, validRoomCommand } = protocol.exports

test("invitation preserves room, secret and pinned administrator", () => {
  const invite = { version: 2, roomId: "a".repeat(48), secret: "b".repeat(48), adminKey: "A".repeat(87) }
  assert.deepEqual(decodeInvitation(encodeInvitation(invite)), invite)
})
test("reject malformed, oversized and incompatible invitations", () => {
  for (const input of ["", "https://example.com", "wtg1.???", "wtg1." + "a".repeat(2048),
    encodeInvitation({ version: 2, roomId: "a".repeat(48), secret: "b".repeat(48), adminId: "c".repeat(20) }),
    encodeInvitation({ version: 1, roomId: "short", secret: "b".repeat(48), adminId: "c".repeat(20) })]) {
    assert.throws(() => decodeInvitation(input))
  }
})
test("snapshot rejects invalid playback, URLs and descriptor paths", () => {
  const base = { url: "https://example.com/watch", video: null, playback: { position: 42, paused: true, rate: 1 } }
  assert.equal(validShared(base), true)
  assert.equal(validShared({ ...base, url: "javascript:alert(1)" }), false)
  assert.equal(validShared({ ...base, playback: { ...base.playback, position: -1 } }), false)
  assert.equal(validShared({ ...base, playback: { ...base.playback, rate: Infinity } }), false)
  assert.equal(validShared({ ...base, video: { selector: "video", shadowPath: [1] } }), false)
  assert.equal(validShared(null), false)
})
test("local room command validation rejects arbitrary commands and initial state", () => {
  assert.equal(validRoomCommand({ kind: "create" }), true)
  assert.equal(validRoomCommand({ kind: "create", initial: {} }), false)
  assert.equal(validRoomCommand({ kind: "join", invitation: 123 }), false)
  assert.equal(validRoomCommand({ kind: "kick" }), false)
})
