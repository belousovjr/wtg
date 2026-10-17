const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { test } = require("node:test")
const ts = require("typescript")
const Module = require("node:module")
const path = require("node:path")
const filename = path.resolve(__dirname, "../lib/video-dom.ts")
const mod = new Module(filename, module)
mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021
} }).outputText, filename)
const { resolve, describe } = mod.exports

test("shared selector binds different local MediaSource URLs and retains a locally resolvable descriptor", () => {
  let matches = []
  const root = { querySelectorAll: () => matches }
  class Video {
    constructor(source, duration = 120) { this.currentSrc = source; this.src = ""; this.duration = duration; this.id = "player" }
    getRootNode() { return root }
  }
  global.document = root
  global.HTMLVideoElement = Video
  global.ShadowRoot = class {}
  global.CSS = { escape: value => value }
  global.location = { href: "https://example.com/watch" }
  const remote = { pageUrl: location.href, frameUrl: location.href, framePath: [], shadowPath: [], selector: "#player", source: "blob:https://example.com/host-id", duration: 120 }
  const local = new Video("blob:https://example.com/guest-id")
  matches = [local]
  assert.deepEqual(resolve(remote), []) // Local-only resolution stays strict.
  assert.deepEqual(resolve(remote, { shared: true }), [local])
  const localDescriptor = describe(local)
  assert.equal(localDescriptor.source, local.currentSrc)
  assert.deepEqual(resolve(localDescriptor), [local]) // Later snapshots do not deselect it.
  local.duration = 200
  assert.deepEqual(resolve(remote, { shared: true }), [])
  local.duration = 120
  matches = [local, new Video("blob:https://example.com/other")]
  assert.deepEqual(resolve(remote, { shared: true }), []) // Never guess between two players.
})

test("shared media URLs allow session tokens but reject a different concrete resource", () => {
  class Video { constructor(source) { this.currentSrc = source; this.src = ""; this.duration = 120 } }
  global.HTMLVideoElement = Video
  global.ShadowRoot = class {}
  const video = new Video("https://cdn.example.com/movie.mp4?token=guest")
  global.document = { querySelectorAll: () => [video] }
  const remote = { shadowPath: [], selector: "video", source: "https://cdn.example.com/movie.mp4?token=host", duration: 120 }
  assert.deepEqual(resolve(remote, { shared: true }), [video])
  assert.deepEqual(resolve(remote), [])
  video.currentSrc = "https://cdn.example.com/another-movie.mp4"
  assert.deepEqual(resolve(remote, { shared: true }), [])
})
