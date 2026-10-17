export type MembershipPolicy = {
  roomId: string
  adminKey: string
  revision: number
  approvalRequired: boolean
  allowed: string[]
  blocked: string[]
  signature: string
}
const keyPattern = /^[A-Za-z0-9_-]{87}$/
export function validPolicy(value: unknown): value is MembershipPolicy {
  if (!value || typeof value !== "object") return false
  const p = value as MembershipPolicy
  const keys = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 128 && new Set(v).size === v.length && v.every(k => typeof k === "string" && keyPattern.test(k))
  return typeof p.roomId === "string" && /^[a-f0-9]{48}$/.test(p.roomId) && typeof p.adminKey === "string" && keyPattern.test(p.adminKey) &&
    Number.isSafeInteger(p.revision) && p.revision >= 0 && typeof p.approvalRequired === "boolean" && keys(p.allowed) && keys(p.blocked) &&
    p.allowed.includes(p.adminKey) && !p.blocked.includes(p.adminKey) && !p.allowed.some(k => p.blocked.includes(k)) && typeof p.signature === "string" && p.signature.length < 200
}
export const policyText = (p: Omit<MembershipPolicy, "signature">) => JSON.stringify(["wtg-members-v1", p.roomId, p.adminKey, p.revision, p.approvalRequired, p.allowed, p.blocked])
export const isAdmitted = (policy: MembershipPolicy | undefined, key: string) => !!policy && policy.allowed.includes(key) && !policy.blocked.includes(key)
export function canAcceptMemberCommand(policy: MembershipPolicy | undefined, authenticatedKey: string | undefined, peerId: string, participants: string[], ready: boolean) {
  return ready && typeof authenticatedKey === "string" && isAdmitted(policy, authenticatedKey) && participants.includes(peerId)
}
export type MemberCommand = { kind: "remove" | "approve"; peerId: string } | { kind: "readmit"; publicKey: string }
