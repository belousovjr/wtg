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
    if (id.startsWith("url:")) return { default: "/logo.svg" }
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
  assert.match(html, /alt="Логотип Watch Together"/)
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
  const named = renderToStaticMarkup(React.createElement(GroupPlayerStatus, { room: { ...room, participantNames: { host: "Роза", guest: "<Бро>" } }, remove() {} }))
  assert.match(named, /Роза/)
  assert.match(named, /&lt;Бро&gt;/)
  assert.doesNotMatch(named, /Участник guest/)
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

test("popup fixes document width independently of content and scrollbar visibility", () => {
  const css = readFileSync(path.join(root, "style.css"), "utf8")
  const html = css.match(/html\s*\{([^}]+)\}/)[1]
  for (const property of ["width", "min-width", "max-width"]) assert.match(html, new RegExp(`${property}:\\s*400px`))
  assert.match(html, /overflow:\s*hidden/)
  const main = css.match(/\bmain\s*\{([^}]+)\}/)[1]
  assert.match(main, /scrollbar-gutter:\s*stable/)
  assert.match(main, /overflow-y:\s*scroll/)
  assert.match(main, /max-height:\s*600px/)
  assert.match(main, /box-sizing:\s*border-box/)
  assert.match(readFileSync(path.join(root, "popup.tsx"), "utf8"), /<main className="w-full min-w-0/)
})

test("viewing card precedes participant cards in the room", () => {
  const code = readFileSync(path.join(root, "components/room-panel.tsx"), "utf8")
  assert.ok(code.indexOf("<SourceControls ") < code.indexOf("<GroupPlayerStatus "))
  assert.equal((code.match(/<SourceControls /g) || []).length, 1)
})

test("viewing card contains contextual click-picking actions without per-video cards", () => {
  const { VideoPicker } = load("components/video-picker.tsx")
  const room = { ready: true, shared: { sourceRevision: 1 }, invitation: null }
  const empty = renderToStaticMarkup(React.createElement(VideoPicker, { room }))
  assert.match(empty, />Выбрать для всех</)
  assert.doesNotMatch(empty, /Выбрать для меня|data-slot="card"/)
  const selected = renderToStaticMarkup(React.createElement(VideoPicker, { room: { ...room, shared: { ...room.shared, video: { selector: "video", shadowPath: [], framePath: [] } } } }))
  assert.match(selected, /Сменить для всех/)
  assert.match(selected, /Выбрать для меня/)
  assert.match(selected, /Нужно выбрать плеер у тебя/)
  const source = readFileSync(path.join(root, "components/source-controls.tsx"), "utf8")
  assert.ok(source.indexOf("<VideoPicker ") < source.indexOf('{room.shared.url &&'))
})

test("click-picking protocol validates shared room and revision context", () => {
  const { isRequest, CHANNEL } = load("lib/messages.ts")
  const request = shared => ({ channel: CHANNEL, to: "content", type: "video", action: { kind: "pick", shared } })
  assert.equal(isRequest(request(undefined)), true)
  assert.equal(isRequest(request({ roomId: "room", revision: 0 })), true)
  for (const shared of [null, {}, { roomId: "room", revision: -1 }, { roomId: "room", revision: 0.5 }]) assert.equal(isRequest(request(shared)), false)
})

test("invitation uses a shadcn Input and native submit form instead of a multiline field", () => {
  const code = readFileSync(path.join(root, "components/room-panel.tsx"), "utf8")
  assert.match(code, /<form[^>]+onSubmit=/)
  assert.match(code, /<Input id="invitation"/)
  assert.doesNotMatch(code, /<Textarea id="invitation"/)
  assert.match(code, /<Button type="submit"/)
  assert.match(code, /event\.preventDefault\(\)/)
})
