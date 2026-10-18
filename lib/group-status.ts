import { t } from "./i18n"
import type { RoomView } from "./room-protocol"
import { sourceRevision } from "./source"

export function groupPlayerStatus(room: RoomView) {
  const revision = sourceRevision(room.shared)
  const members = room.participants.map(id => {
    const source = room.sourceReadiness[id]
    const status = source?.revision === revision ? source.status : undefined
    let bound = room.ready && !!room.shared.video && (status === "ready" || status === "loading-video")
    let ready = bound && status === "ready"
    let text = !room.ready ? t("groupStatus.noCoordinator") : !room.shared.video ? t("groupStatus.waitingChoice") : ({
      ready: t("groupStatus.bound"), "loading-video": t("groupStatus.loadingVideo"),
      "loading-page": t("groupStatus.loadingPage"), "needs-video": t("groupStatus.manualPick"),
      unavailable: t("groupStatus.unavailable"), "wrong-page": t("groupStatus.wrongPage")
    })[status || ""] || t("groupStatus.waitingBinding")
    const report = room.sync?.players[id]
    const currentReport = report && report.epoch === room.sync?.epoch && report.revision === revision &&
      (room.sync?.preparation ? report.preparationId === room.sync.preparation.id : !!room.sync?.command && report.sequence === room.sync.command.sequence)
    if (bound && room.sync?.preparation && !currentReport) { ready = false; text = t("groupStatus.preparing") }
    if (currentReport && room.ready && room.shared.video) {
      if (report.status === "ready") ready = bound
      if (report.status === "missing") { bound = false; ready = false; text = t("groupStatus.missing") }
      if (report.status === "blocked") { ready = false; text = t("groupStatus.blocked") }
      if (report.status === "loading") { ready = false; text = t("groupStatus.loading") }
      if (report.status === "error") { ready = false; text = report.detail || t("groupStatus.error") }
    }
    const synchronized = !!(ready && currentReport && report.status === "ready" && room.sync?.command && !room.sync.preparation)
    return { id, bound, ready, synchronized, text }
  })
  const bound = members.filter(m => m.bound).length
  const allReady = !!room.shared.video && room.ready && members.length > 0 && members.every(m => m.ready)
  const synchronized = members.filter(member => member.synchronized).length
  return { members, bound, synchronized, total: members.length, allReady }
}
