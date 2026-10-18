const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const ts = require("typescript")
const { t, i18n, applyLanguage, getLanguage, nativeLanguageNames } = require("./load-i18n.cjs")
const root = path.resolve(__dirname, "..")
const files = ["popup.tsx", "background.ts", ...["contents", "components", "lib"].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(name => /\.tsx?$/.test(name)).map(name => `${dir}/${name}`))]

test("bundled Russian translations initialize synchronously and interpolate whole messages", () => {
  assert.equal(i18n.isInitialized, true)
  assert.equal(t("video.pressPlay"), "Нажми Play")
  assert.equal(t("groupPlayerStatus.synchronizationCount", { ready: 2, total: 5 }), "Синхронизированы 2 из 5")
  assert.equal(t("roomPanel.timing", { rtt: 42, uncertainty: 8 }), "RTT 42 мс · неопределённость ±8 мс")
  assert.equal(t("popup.pageError", { error: "<test>" }), "<test>. Для обычной страницы попробуй обновить вкладку.")
})

test("participant plural forms follow Russian Intl rules", () => {
  for (const [count, noun] of [[0, "участников"], [1, "участник"], [2, "участника"], [5, "участников"], [11, "участников"], [21, "участник"], [22, "участника"], [25, "участников"]]) {
    assert.equal(t("playerIndicator.blockedCount", { count }), `Ждём ручного запуска: ${count} ${noun}`)
  }
})

test("English covers every Russian key and interpolation variable and uses English plurals", () => {
  const ru = i18n.getResourceBundle("ru", "translation"), en = i18n.getResourceBundle("en", "translation")
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort())
  const params = value => [...value.matchAll(/{{([^}]+)}}/g)].map(match => match[1]).sort()
  for (const key of Object.keys(ru)) {
    assert.deepEqual(params(en[key]), params(ru[key]), key)
    assert.doesNotMatch(en[key], /[\u0400-\u04ff]/, key)
  }
  try {
    applyLanguage("en")
    assert.equal(getLanguage(), "en")
    assert.equal(t("video.pressPlay"), "Press Play")
    assert.equal(t("roomPanel.timing", { rtt: 42, uncertainty: 8 }), "RTT 42 ms · uncertainty ±8 ms")
    for (const count of [0, 1, 2, 5, 21]) assert.equal(t("playerIndicator.blockedCount", { count }), `Waiting for manual playback: ${count} ${count === 1 ? "participant" : "participants"}`)
    assert.equal(nativeLanguageNames.ru, "Русский")
    assert.equal(nativeLanguageNames.en, "English")
  } finally { applyLanguage("ru") }
})

test("every literal translation key exists and no Russian UI literals remain outside the dictionary", () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    function visit(node) {
      // Language autonyms are explicitly hardcoded in their own language.
      if (file === "lib/i18n.ts" && ts.isVariableDeclaration(node) && node.name.getText(ast) === "nativeLanguageNames") return
      // Diagnostics intentionally retain stable developer-facing language.
      if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText(ast))) return
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "t" && ts.isStringLiteral(node.arguments[0])) {
        assert.equal(i18n.exists(node.arguments[0].text), true, `${file}: missing ${node.arguments[0].text}`)
      }
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        assert.doesNotMatch(node.text, /[\u0400-\u04ff]/, `${file}: untranslated literal ${node.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
})
