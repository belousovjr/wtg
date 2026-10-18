const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const ts = require("typescript")
const cache = new Map()
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = new Module(filename, module)
  cache.set(filename, mod)
  mod.require = id => id.startsWith(".") ? load(path.resolve(path.dirname(filename), `${id}.ts`)) : require(id)
  mod._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText, filename)
  return mod.exports
}
module.exports = load(path.resolve(__dirname, "../lib/i18n.ts"))
