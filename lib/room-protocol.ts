import type { VideoDescriptor } from "./video"
import type { MemberCommand } from "./membership"
import { validCommit, validPlaybackRequest, validPlayerReport, type Commit, type PlaybackLocal, type PlaybackRequest, type PlayerReport } from "./playback"
import { validReadiness, webUrl, type SourceCommand, type SourceReadiness } from "./source"

export const ROOM_VERSION = 2
export type Invitation = { version: 2; roomId: string; secret: string; adminKey: string }
export type SharedState = { control?: Commit; sourceRevision?: number; url: string | null; video: VideoDescriptor | null; playback: { position: number; paused: boolean; rate: number } }
export type RoomView = {
  nickname?: string
  participantNames?: Record<string, string>
  sync?: PlaybackLocal
  sourceReadiness: Record<string, SourceReadiness>
  pendingParticipants: { peerId: string; publicKey: string }[]
  blockedKeys: string[]
  approvalRequired: boolean
  isAdmin: boolean
  ready: boolean
  status: "idle" | "waiting" | "connected" | "reconnecting" | "error"
  selfId: string
  adminId: string | null
  invitation: string | null
  participants: string[]
  shared: SharedState
  error: string | null
}
export type RoomCommand =
  | { kind: "nickname"; nickname: string }
  | { kind: "playback"; request: PlaybackRequest }
  | { kind: "player-report"; report: PlayerReport }
  | SourceCommand
  | { kind: "source-ready"; readiness: SourceReadiness }
  | MemberCommand
  | { kind: "status" }
  | { kind: "create"; initial?: SharedState; nickname?: string }
  | { kind: "join"; invitation: string; nickname?: string }
  | { kind: "leave" }
  | { kind: "retry" }
  | { kind: "end" }

const token = /^[a-zA-Z0-9_-]{16,128}$/
export function validNickname(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 32 && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
}
export function encodeInvitation(invite: Invitation) {
  return `wtg2.${btoa(JSON.stringify(invite)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`
}
export function decodeInvitation(text: string): Invitation {
  try {
    if (!text.startsWith("wtg2.") || text.length > 2048) throw new Error()
    const raw = text.slice(5).replaceAll("-", "+").replaceAll("_", "/")
    const data = JSON.parse(atob(raw))
    if (data.version !== ROOM_VERSION || !token.test(data.roomId) || !token.test(data.secret) || typeof data.adminKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(data.adminKey)) throw new Error()
    return data
  } catch { throw new Error("Некорректное приглашение или неподдерживаемая версия") }
}
export function validShared(value: unknown): value is SharedState {
  if (!value || typeof value !== "object") return false
  try { if (JSON.stringify(value).length > 24000) return false } catch { return false }
  const s = value as SharedState
  if (s.control !== undefined && !validCommit(s.control)) return false
  if (s.sourceRevision !== undefined && (!Number.isSafeInteger(s.sourceRevision) || s.sourceRevision < 0)) return false
  if (s.url !== null && (typeof s.url !== "string" || s.url.length > 8192 || !/^https?:\/\//.test(s.url))) return false
  if (!s.playback || !Number.isFinite(s.playback.position) || s.playback.position < 0 || typeof s.playback.paused !== "boolean" || !Number.isFinite(s.playback.rate) || s.playback.rate <= 0 || s.playback.rate > 16) return false
  if (s.video === null) return true
  const v = s.video
  return typeof v === "object" && typeof v.pageUrl === "string" && typeof v.frameUrl === "string" &&
    typeof v.selector === "string" && v.selector.length <= 8192 && typeof v.source === "string" &&
    Array.isArray(v.framePath) && v.framePath.length <= 32 && v.framePath.every(p => typeof p === "string") &&
    Array.isArray(v.shadowPath) && v.shadowPath.length <= 32 && v.shadowPath.every(p => typeof p === "string") &&
    (v.duration === null || Number.isFinite(v.duration) && v.duration >= 0)
}
export function validRoomCommand(value: unknown): value is RoomCommand {
  if (!value || typeof value !== "object") return false
  const c = value as RoomCommand
  if (c.kind === "nickname") return validNickname(c.nickname)
  if ((c.kind === "create" || c.kind === "join") && c.nickname !== undefined && !validNickname(c.nickname)) return false
  if (c.kind === "playback") return validPlaybackRequest(c.request)
  if (c.kind === "player-report") return validPlayerReport(c.report)
  if (c.kind === "source-ready") return validReadiness(c.readiness)
  if (c.kind === "source") return typeof c.url === "string" && !!webUrl(c.url) && typeof c.commandId === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(c.commandId) && Number.isSafeInteger(c.expectedRevision) && c.expectedRevision >= 0 && validShared({ url: c.url, video: c.video, playback: { position: 0, paused: true, rate: 1 } }) && (c.video === null || webUrl(c.video.pageUrl) === webUrl(c.url))
  if (c.kind === "remove" || c.kind === "approve") return typeof c.peerId === "string" && c.peerId.length > 0 && c.peerId.length <= 128
  if (c.kind === "readmit") return typeof c.publicKey === "string" && /^[A-Za-z0-9_-]{87}$/.test(c.publicKey)
  if (["status", "leave", "retry", "end"].includes(c.kind)) return true
  if (c.kind === "join") return typeof c.invitation === "string" && c.invitation.length <= 2048
  return c.kind === "create" && (c.initial === undefined || validShared(c.initial))
}
