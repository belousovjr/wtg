import { t } from "./i18n"
import type { SharedState } from "./room-protocol"
import type { VideoDescriptor } from "./video"

export type SourceStatus = "loading-page" | "needs-video" | "loading-video" | "ready" | "unavailable" | "wrong-page"
export type SourceReadiness = { revision: number; status: SourceStatus }
export type SourceCommand = { kind: "source"; url: string; video: VideoDescriptor | null; expectedRevision: number; commandId: string }
export function webUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
export const sourceRevision = (shared: SharedState) => shared.sourceRevision || 0
export function pickedSource(tabUrl: string, video: VideoDescriptor) {
  const url = webUrl(tabUrl)
  if (!url) throw new Error(t("source.urlMissing"))
  return { url, video: { ...video, pageUrl: url } }
}
export function samePageLocation(a: string, b: string) {
  try {
    const x = new URL(a), y = new URL(b)
    return sameFrameLocation(a, b) && x.hash === y.hash
  } catch { return a === b }
}
export function sameFrameLocation(a: string, b: string) {
  try {
    const x = new URL(a), y = new URL(b)
    return ["http:", "https:"].includes(x.protocol) && x.origin === y.origin && x.pathname === y.pathname
  } catch { return a === b }
}
export function sameVideoSelection(a: VideoDescriptor | null | undefined, b: VideoDescriptor | null | undefined) {
  return !!a && !!b && webUrl(a.pageUrl) === webUrl(b.pageUrl) && a.selector === b.selector &&
    JSON.stringify(a.shadowPath) === JSON.stringify(b.shadowPath) && sameFrameLocation(a.frameUrl, b.frameUrl) &&
    a.framePath.length === b.framePath.length && a.framePath.every((url, i) => sameFrameLocation(url, b.framePath[i]))
}
export function validReadiness(value: unknown): value is SourceReadiness {
  if (!value || typeof value !== "object") return false
  const r = value as SourceReadiness
  return Number.isSafeInteger(r.revision) && r.revision >= 0 && ["loading-page", "needs-video", "loading-video", "ready", "unavailable", "wrong-page"].includes(r.status)
}
export function commitSource(shared: SharedState, command: SourceCommand): SharedState {
  if (command.expectedRevision !== sourceRevision(shared)) throw new Error(t("source.sourceChanged"))
  const url = webUrl(command.url)
  if (!url || command.video && webUrl(command.video.pageUrl) !== url) throw new Error(t("source.unsupportedUrl"))
  return { url, video: command.video, sourceRevision: sourceRevision(shared) + 1, playback: { position: 0, paused: true, rate: 1 } }
}
