import type { RoomView } from "./room-protocol"
import { sourceRevision } from "./source"

export function groupPlayerStatus(room: RoomView) {
  const revision = sourceRevision(room.shared)
  const members = room.participants.map(id => {
    const source = room.sourceReadiness[id]
    const status = source?.revision === revision ? source.status : undefined
    let bound = room.ready && !!room.shared.video && (status === "ready" || status === "loading-video")
    let ready = bound && status === "ready"
    let text = !room.ready ? "Нет связи с координатором" : !room.shared.video ? "Ждём выбора видео для группы" : ({
      ready: "✓ Плеер привязан", "loading-video": "Плеер привязан · видео загружается",
      "loading-page": "Загружаем страницу, затем ищем плеер", "needs-video": "Нужно выбрать плеер вручную",
      unavailable: "Вкладка или плеер недоступны", "wrong-page": "Вкладка просмотра на другой странице"
    })[status || ""] || "Ждём подтверждения привязки"
    const report = room.sync?.players[id]
    const currentReport = report && report.epoch === room.sync?.epoch && report.revision === revision &&
      (room.sync?.preparation ? report.preparationId === room.sync.preparation.id : !!room.sync?.command && report.sequence === room.sync.command.sequence)
    if (bound && room.sync?.preparation && !currentReport) { ready = false; text = "Плеер привязан · готовим к запуску" }
    if (currentReport && room.ready && room.shared.video) {
      if (report.status === "ready") ready = bound
      if (report.status === "missing") { bound = false; ready = false; text = "Плеер потерян — нужен ручной выбор" }
      if (report.status === "blocked") { ready = false; text = "Плеер привязан · разреши запуск на странице" }
      if (report.status === "loading") { ready = false; text = "Плеер готовится к просмотру" }
      if (report.status === "error") { ready = false; text = report.detail || "Ошибка плеера" }
    }
    return { id, bound, ready, text }
  })
  const bound = members.filter(m => m.bound).length
  const allReady = !!room.shared.video && room.ready && members.length > 0 && members.every(m => m.ready)
  return { members, bound, total: members.length, allReady }
}
