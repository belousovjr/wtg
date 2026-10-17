export type StoredIdentity = { publicKey: string; privateKey: JsonWebKey }
const algorithm = { name: "ECDSA", namedCurve: "P-256" }
export function base64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}
function bytes(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0))
}
export async function createIdentity(): Promise<StoredIdentity> {
  const pair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])
  return { publicKey: base64(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey) }
}
export async function sign(identity: StoredIdentity, text: string) {
  const key = await crypto.subtle.importKey("jwk", identity.privateKey, algorithm, false, ["sign"])
  return base64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(text)))
}
export async function verify(publicKey: string, signature: string, text: string) {
  try {
    const key = await crypto.subtle.importKey("raw", bytes(publicKey), algorithm, false, ["verify"])
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, bytes(signature), new TextEncoder().encode(text))
  } catch { return false }
}
export async function validateIdentity(identity: StoredIdentity) {
  return verify(identity.publicKey, await sign(identity, "wtg-key-check"), "wtg-key-check")
}
export const challengeText = (roomId: string, from: string, to: string, nonce: string) => JSON.stringify(["wtg-proof-v2", roomId, from, to, nonce])
