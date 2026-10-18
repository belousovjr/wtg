const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")
const locale = require("./load-i18n.cjs")
function load() {
  const filename = path.resolve(__dirname, "../lib/locale-sync.ts"), mod = new Module(filename, module)
  mod.require = () => locale
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, filename)
  return mod.exports
}
const channel = "wtg:locale:v1"
test("background restores and persists language, broadcasts it, and rejects content-script writes", async () => {
  let handler
  const disk = { language: "en" }, notices = [], frames = []
  global.chrome = {
    storage: { local: { get: async () => disk, set: async value => Object.assign(disk, value) } },
    runtime: { id: "extension", onMessage: { addListener: fn => { handler = fn } }, sendMessage: async message => { notices.push(message) } },
    tabs: { query: async () => [{ id: 1 }, { id: 2 }], sendMessage: async (id, message) => { frames.push({ id, message }); if (id === 2) throw Error("Restricted page") } }
  }
  const request = (message, sender = { id: "extension" }) => new Promise(resolve => handler({ channel, to: "background", ...message }, sender, resolve))
  try {
    load().startLocaleBackground()
    assert.equal((await request({ type: "get" })).language, "en")
    assert.equal((await request({ type: "set", language: "ru" })).ok, true)
    assert.equal(disk.language, "ru")
    assert.equal(notices.at(-1).language, "ru")
    assert.equal(frames.length, 2)
    assert.equal((await request({ type: "set", language: "en" }, { id: "extension", tab: { id: 1 } })).ok, false)
    assert.equal((await request({ type: "set", language: "invalid" })).ok, false)
    assert.equal(disk.language, "ru")
  } finally { locale.applyLanguage("ru"); delete global.chrome }
})

test("client ignores stale bootstrap language after receiving a newer broadcast", async () => {
  let handler, resolveGet
  global.chrome = { runtime: { id: "extension", onMessage: { addListener: fn => { handler = fn } }, sendMessage: () => new Promise(resolve => { resolveGet = resolve }) } }
  try {
    load().startLocaleClient()
    handler({ channel, type: "changed", language: "en" }, { id: "extension" })
    resolveGet({ ok: true, language: "ru" })
    await Promise.resolve()
    assert.equal(locale.getLanguage(), "en")
    handler({ channel, type: "changed", language: "ru" }, { id: "extension", tab: { id: 1 } })
    assert.equal(locale.getLanguage(), "en")
  } finally { locale.applyLanguage("ru"); delete global.chrome }
})
