const assert = require("node:assert/strict")
const { test } = require("node:test")
const { readFileSync, readdirSync, existsSync } = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")
const React = require("react")
const { renderToStaticMarkup } = require("react-dom/server")
const root = path.resolve(__dirname, "..")
const cache = new Map()
function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = new Module(filename, module)
  mod.paths = module.paths
  cache.set(filename, mod)
  mod.require = id => {
    if (id.endsWith(".css")) return {}
    if (id.startsWith(".") || id.startsWith("~/")) {
      const base = id.startsWith("~/") ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(filename), id)
      const target = [base, `${base}.tsx`, `${base}.ts`].find(existsSync)
      return load(path.relative(root, target))
    }
    return require(id)
  }
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, filename)
  return mod.exports
}

test("popup renders installed shadcn primitives with React 19 without touching room lifecycle", () => {
  const { default: Popup } = load("popup.tsx")
  const html = renderToStaticMarkup(React.createElement(Popup))
  assert.match(html, /Watch Together/)
  assert.match(html, /data-slot="badge"/)
  assert.match(html, /data-slot="accordion"/)
  assert.match(html, /data-slot="spinner"/)
  assert.doesNotMatch(html, /<details|<progress/)
})

test("shadcn participant cards preserve admin-only synchronization count and member actions", () => {
  const { GroupPlayerStatus } = load("components/group-player-status.tsx")
  const room = { ready: true, isAdmin: true, selfId: "host", adminId: "host", participants: ["host", "guest"],
    shared: { sourceRevision: 1, video: {}, playback: {} }, sourceReadiness: {}, sync: { epoch: "e", command: { sequence: 1 }, players: {} } }
  const admin = renderToStaticMarkup(React.createElement(GroupPlayerStatus, { room, remove() {} }))
  assert.match(admin, /data-slot="card"/)
  assert.match(admin, /Синхронизированы 0 из 2/)
  assert.match(admin, /aria-label="Удалить участника"/)
  const guest = renderToStaticMarkup(React.createElement(GroupPlayerStatus, { room: { ...room, isAdmin: false }, remove() {} }))
  assert.doesNotMatch(guest, /Синхронизированы|Удалить участника/)
})

test("popup business components use imported UI controls rather than handmade native equivalents", () => {
  const files = ["popup.tsx", ...readdirSync(path.join(root, "components")).filter(name => name.endsWith(".tsx")).map(name => `components/${name}`)]
  for (const file of files) {
    const code = readFileSync(path.join(root, file), "utf8")
    assert.doesNotMatch(code, /<(?:button|input|textarea|details|summary|progress)\b|window\.confirm\(/, file)
    assert.match(code, /from ["']\.\/?(?:components\/)?ui\//, file)
  }
})
