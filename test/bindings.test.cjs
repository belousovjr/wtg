const assert = require("node:assert/strict")
const { readFileSync } = require("node:fs")
const { test } = require("node:test")
const ts = require("typescript")
const Module = require("node:module")
const path = require("node:path")
function load(name, imports = {}) {
  const filename = path.resolve(__dirname, `../lib/${name}.ts`)
  const mod = new Module(filename, module)
  mod.require = id => id in imports ? imports[id] : ["./source", "./playback"].includes(id) ? load(id.slice(2)) : require(id)
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return mod.exports
}
test("binding recovery resolves current frame IDs and refuses duplicate tabs", async () => {
  const data = {}
  let duplicate = false
  global.chrome = {
    webNavigation: { getAllFrames: async () => [
      { frameId: 0, parentFrameId: -1, url: "https://example.com/watch" },
      { frameId: 99, parentFrameId: 0, url: "https://player.example.com" }
    ] },
    tabs: { query: async () => duplicate ? [{ url: "https://example.com/watch" }, { url: "https://example.com/watch" }] : [{ url: "https://example.com/watch" }] },
    storage: { local: { get: async () => data, set: async value => Object.assign(data, value) } }
  }
  const { handleBindingMessage } = load("bindings", { "./room-protocol": load("room-protocol") })
  const descriptor = { pageUrl: "https://example.com/watch", frameUrl: "https://player.example.com", framePath: [], shadowPath: [], selector: "#player", source: "https://media.example.com/movie.mp4", duration: 100 }
  const sender = { tab: { id: 42 }, frameId: 99 }
  await handleBindingMessage({ type: "binding-save", descriptor, position: 12, rate: 1.5 }, sender)
  const saved = await handleBindingMessage({ type: "binding-load" }, sender)
  assert.equal(saved.binding.position, 12)
  assert.deepEqual(saved.binding.framePath, ["https://player.example.com"])
  assert.equal("tabId" in saved.binding, false)
  duplicate = true
  assert.deepEqual(await handleBindingMessage({ type: "binding-load" }, sender), { ambiguous: true })
  await assert.rejects(handleBindingMessage({ type: "binding-save", descriptor, position: -1, rate: 1 }, sender))
})
