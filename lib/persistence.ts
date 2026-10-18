import { t } from "./i18n"
import { CHANNEL } from "./messages"
import type { StoredIdentity } from "./identity"
import { decodeInvitation, validShared, validNickname, type SharedState } from "./room-protocol"
import { validPolicy, type MembershipPolicy } from "./membership"

export type EndCertificate = { roomId: string; adminKey: string; endedAt: number; signature: string; invitation?: string }
export type SavedSession = { invitation: string; shared: SharedState }
export type Vault = { version: 1; nickname?: string; removedNames?: { roomId: string; publicKey: string; nickname: string }[]; identity: StoredIdentity | null; session: SavedSession | null; ended: EndCertificate[]; policies?: MembershipPolicy[] }
export const emptyVault = (): Vault => ({ version: 1, identity: null, session: null, ended: [], policies: [] })
export function validCertificate(value: unknown): value is EndCertificate {
  if (!value || typeof value !== "object") return false
  const c = value as EndCertificate
  return typeof c.roomId === "string" && /^[a-f0-9]{48}$/.test(c.roomId) && typeof c.adminKey === "string" && c.adminKey.length === 87 && Number.isSafeInteger(c.endedAt) && c.endedAt > 0 && typeof c.signature === "string" && c.signature.length < 200
}
export function validateVault(value: unknown): Vault {
  if (value === undefined) return emptyVault()
  if (!value || typeof value !== "object") throw new Error(t("persistence.corruptVault"))
  const v = value as Vault
  if (v.nickname !== undefined && !validNickname(v.nickname)) throw new Error(t("persistence.corruptNickname"))
  if (v.removedNames !== undefined && (!Array.isArray(v.removedNames) || v.removedNames.length > 4096 || !v.removedNames.every(n => n && typeof n.roomId === "string" && /^[a-f0-9]{48}$/.test(n.roomId) && typeof n.publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(n.publicKey) && validNickname(n.nickname)))) throw new Error(t("persistence.corruptRemovedNames"))
  if (v.version !== 1) throw new Error(t("persistence.unsupportedVersion"))
  if (v.identity !== null && (!v.identity || typeof v.identity.publicKey !== "string" || v.identity.publicKey.length !== 87 || !v.identity.privateKey || typeof v.identity.privateKey.d !== "string")) throw new Error(t("persistence.corruptIdentity"))
  if (v.session !== null) {
    if (!v.identity) throw new Error(t("persistence.missingKeys"))
    if (!v.session || !validShared(v.session.shared)) throw new Error(t("persistence.corruptRoom"))
    decodeInvitation(v.session.invitation)
  }
  if (!Array.isArray(v.ended) || !v.ended.every(validCertificate)) throw new Error(t("persistence.corruptEnded"))
  if (v.policies !== undefined && (!Array.isArray(v.policies) || !v.policies.every(validPolicy))) throw new Error(t("persistence.corruptPolicy"))
  // Additive migration of earlier version-1 vaults, preserving identity/session.
  return { ...v, policies: v.policies || [] }
}
export async function vaultRequest(operation: "read" | "write", value?: Vault): Promise<Vault> {
  const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "vault", operation, value })
  if (!reply?.ok) throw new Error(reply?.error || t("persistence.unavailable"))
  return reply.data
}
export const endText = (certificate: Omit<EndCertificate, "signature">) => JSON.stringify(["wtg-ended-v2", certificate.roomId, certificate.adminKey, certificate.endedAt])
