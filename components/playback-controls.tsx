import { useState } from "react"
import { now, positionAt } from "../lib/playback"
import type { RoomCommand, RoomView } from "../lib/room-protocol"
import { sourceRevision } from "../lib/source"

export function PlaybackControls({ room, perform, busy }: { room: RoomView; perform: (command: RoomCommand) => Promise<void>; busy: boolean }) {
  const [seek, setSeek] = useState("")
  const sync = room.sync
  const request = (action: "play" | "pause" | "seek" | "rate", position?: number, rate?: number) => {
    const command = sync?.command
    const currentPosition = sync?.preparation?.position ?? (command && sync?.clock ? positionAt(command, now() + sync.clock.offset) : room.shared.playback.position)
    if (!sync) return
    void perform({ kind: "playback", request: { epoch: sync.epoch, action, commandId: crypto.randomUUID(), revision: sourceRevision(room.shared), position: position ?? currentPosition, rate: rate ?? command?.rate ?? room.shared.playback.rate } })
  }
  if (!room.shared.video) return null
  return <section>
    <h4>Управление для всех</h4>
    <p role="status">{sync?.preparation ? "Подготавливаем плееры к общему старту…" : !sync?.clock ? "Согласуем часы…" : sync.command ? sync.command.paused ? "Общая пауза" : "Общий запуск назначен / воспроизведение" : "Можно запустить просмотр"}</p>
    <button disabled={busy || !room.ready} onClick={() => request("play")}>▶ Запустить всем</button>{" "}
    <button disabled={busy || !room.ready} onClick={() => request("pause")}>⏸ Пауза всем</button>
    <form onSubmit={event => { event.preventDefault(); const position = Number(seek); if (Number.isFinite(position) && position >= 0) request("seek", position) }}>
      <label>Позиция, секунд <input type="number" min="0" step="0.1" required value={seek} onChange={event => setSeek(event.target.value)} style={{ width: 100 }} /></label>{" "}
      <button disabled={busy}>Перемотать всем</button>
    </form>
    <label>Скорость <select value={sync?.command?.rate ?? room.shared.playback.rate} disabled={busy} onChange={event => request("rate", undefined, Number(event.target.value))}>
      {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
    </select></label>
    {sync?.clock && <p><small>RTT {Math.round(sync.clock.rtt)} мс · неопределённость часов ±{Math.round(sync.clock.uncertainty)} мс</small></p>}
    <ul>{room.participants.map(id => {
      const report = sync?.players[id]
      return <li key={id}>{id.slice(0, 8)} · {report ? report.detail || ({ ready: "Готов", loading: "Подготовка…", blocked: "Нужно разрешить запуск на странице", missing: "Плеер не найден", error: "Ошибка плеера" })[report.status] : "Ожидаем плеер"}</li>
    })}</ul>
    <small>Штатные play/pause, перемотка и скорость плеера тоже общие. Громкость остаётся локальной.</small>
  </section>
}
