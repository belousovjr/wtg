const fs = require("node:fs")
const path = require("node:path")
const sharp = require("sharp")

async function main() {
  const root = path.resolve(__dirname, "..")
  const logo = fs.readFileSync(path.join(root, "assets/logo.svg")).toString("base64")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
    <defs>
      <linearGradient id="pink" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f9c6da"/><stop offset="1" stop-color="#f194b9"/>
      </linearGradient>
      <clipPath id="logo"><circle cx="110" cy="140" r="70"/></clipPath>
    </defs>
    <path fill="url(#pink)" d="M0 0h440v280H0z"/>
    <circle cx="420" cy="12" r="125" fill="#fff7fb" opacity=".14"/>
    <circle cx="30" cy="285" r="125" fill="#ea4c89" opacity=".08"/>
    <circle cx="110" cy="143" r="75" fill="#853451" opacity=".08"/>
    <circle cx="110" cy="140" r="75" fill="#fff7fb" opacity=".65"/>
    <image href="data:image/svg+xml;base64,${logo}" x="40" y="70" width="140" height="140" clip-path="url(#logo)"/>
    <text x="204" y="158" fill="#482b3a" font-family="Segoe UI, Arial, sans-serif" font-size="51" font-weight="700" letter-spacing="-2">Watchly</text>
  </svg>`
  const output = path.join(root, "assets/store-promo-440x280.png")
  await sharp(Buffer.from(svg)).flatten({ background: "#f7b5cf" }).png().toFile(output)
  const meta = await sharp(output).metadata()
  if (meta.width !== 440 || meta.height !== 280 || meta.hasAlpha) throw Error("Invalid store promo dimensions or alpha")
  console.log(output)
  const largeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560" viewBox="0 0 1400 560">
    <defs>
      <linearGradient id="pink" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#f9c6da"/><stop offset="1" stop-color="#f194b9"/>
      </linearGradient>
      <clipPath id="logo"><circle cx="350" cy="280" r="180"/></clipPath>
    </defs>
    <path fill="url(#pink)" d="M0 0h1400v560H0z"/>
    <circle cx="1335" cy="24" r="400" fill="#fff7fb" opacity=".14"/>
    <circle cx="95" cy="570" r="400" fill="#ea4c89" opacity=".08"/>
    <circle cx="350" cy="288" r="193" fill="#853451" opacity=".08"/>
    <circle cx="350" cy="280" r="193" fill="#fff7fb" opacity=".65"/>
    <image href="data:image/svg+xml;base64,${logo}" x="170" y="100" width="360" height="360" clip-path="url(#logo)"/>
    <text x="620" y="335" fill="#482b3a" font-family="Segoe UI, Arial, sans-serif" font-size="160" font-weight="700" letter-spacing="-6">Watchly</text>
  </svg>`
  const largeOutput = path.join(root, "assets/store-promo-1400x560.png")
  await sharp(Buffer.from(largeSvg)).flatten({ background: "#f7b5cf" }).png().toFile(largeOutput)
  const largeMeta = await sharp(largeOutput).metadata()
  if (largeMeta.width !== 1400 || largeMeta.height !== 560 || largeMeta.hasAlpha) throw Error("Invalid large store promo dimensions or alpha")
  console.log(largeOutput)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
