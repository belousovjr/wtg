import { CHANNEL } from "./messages"
import type { StoredIdentity } from "./identity"
import { decodeInvitation, validShared, type SharedState } from "./room-protocol"
import { validPolicy, type MembershipPolicy } from "./membership"

export type EndCertificate = { roomId: string; adminKey: string; endedAt: number; signature: string; invitation?: string }
export type SavedSession = { invitation: string; shared: SharedState }
export type Vault = { version: 1; identity: StoredIdentity | null; session: SavedSession | null; ended: EndCertificate[]; policies?: MembershipPolicy[] }
export const emptyVault = (): Vault => ({ version: 1, identity: null, session: null, ended: [], policies: [] })
export function validCertificate(value: unknown): value is EndCertificate {
  if (!value || typeof value !== "object") return false
  const c = value as EndCertificate
  return typeof c.roomId === "string" && /^[a-f0-9]{48}$/.test(c.roomId) && typeof c.adminKey === "string" && c.adminKey.length === 87 && Number.isSafeInteger(c.endedAt) && c.endedAt > 0 && typeof c.signature === "string" && c.signature.length < 200
}
export function validateVault(value: unknown): Vault {
  if (value === undefined) return emptyVault()
  if (!value || typeof value !== "object") throw new Error("Повреждено хранилище сессии. Автовход остановлен.")
  const v = value as Vault
  if (v.version !== 1) throw new Error("Неподдерживаемая версия хранилища; требуется миграция")
  if (v.identity !== null && (!v.identity || typeof v.identity.publicKey !== "string" || v.identity.publicKey.length !== 87 || !v.identity.privateKey || typeof v.identity.privateKey.d !== "string")) throw new Error("Повреждена сохранённая идентичность")
  if (v.session !== null) {
    if (!v.identity) throw new Error("Для сохранённой комнаты отсутствуют ключи")
    if (!v.session || !validShared(v.session.shared)) throw new Error("Повреждено состояние комнаты")
    decodeInvitation(v.session.invitation)
  }
  if (!Array.isArray(v.ended) || !v.ended.every(validCertificate)) throw new Error("Повреждён список завершённых комнат")
  if (v.policies !== undefined && (!Array.isArray(v.policies) || !v.policies.every(validPolicy))) throw new Error("Повреждены правила допуска участников")
  // Additive migration of earlier version-1 vaults, preserving identity/session.
  return { ...v, policies: v.policies || [] }
}
export async function vaultRequest(operation: "read" | "write", value?: Vault): Promise<Vault> {
  const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type: "vault", operation, value })
  if (!reply?.ok) throw new Error(reply?.error || "Хранилище недоступно")
  return reply.data
}
export const endText = (certificate: Omit<EndCertificate, "signature">) => JSON.stringify(["wtg-ended-v2", certificate.roomId, certificate.adminKey, certificate.endedAt])
