import { useEffect, useState } from "react"
import { CHANNEL } from "../lib/messages"
import type { RoomCommand, RoomView } from "../lib/room-protocol"
import { sourceRevision, type SourceStatus } from "../lib/source"

export const sourceStatusLabels: Record<SourceStatus, string> = {
  "loading-page": "Загружаем страницу и ищем плеер", "needs-video": "Не найден — нужен ручной выбор плеера",
  "loading-video": "Плеер выбран, видео загружается / позиция недоступна", ready: "✓ Плеер выбран",
  unavailable: "Вкладка или плеер недоступны", "wrong-page": "Вкладка открыта на другой странице"
}
export function SourceControls({ room, perform, busy }: { room: RoomView; perform: (command: RoomCommand) => Promise<void>; busy: boolean }) {
  const [url, setUrl] = useState(room.shared.url || "")
  const [tabError, setTabError] = useState("")
  const [tabBusy, setTabBusy] = useState(false)
  async function tabAction(type: "source-focus" | "source-attach") {
    setTabBusy(true)
    setTabError("")
    try {
      const reply = await chrome.runtime.sendMessage({ channel: CHANNEL, to: "background", type })
      if (!reply?.ok) throw new Error(reply?.error || "Вкладка просмотра недоступна")
    } catch (error) { setTabError(error instanceof Error ? error.message : "Вкладка просмотра недоступна") }
    finally { setTabBusy(false) }
  }
  useEffect(() => { setUrl(room.shared.url || "") }, [room.shared.url])
  return <section>
    <h4>Источник просмотра</h4>
    <form onSubmit={event => {
      event.preventDefault()
      void perform({ kind: "source", url, video: null, expectedRevision: sourceRevision(room.shared), commandId: crypto.randomUUID() })
    }}>
      <label>Общий URL<input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" style={{ width: "100%", boxSizing: "border-box" }} /></label>
      <button disabled={busy || !room.ready}>Смотреть это вместе</button>
    </form>
    {room.shared.url && <>
      <p>{room.shared.video ? "Плеер выбран для комнаты" : "Перейди к просмотру и выбери плеер для комнаты"}</p>
      {room.sourceReadiness[room.selfId]?.status === "unavailable" && <p>Вкладка просмотра не привязана, закрыта или плеер недоступен.</p>}
      <button disabled={tabBusy} onClick={() => void tabAction("source-focus")}>Перейти к просмотру</button>{" "}
      <button disabled={tabBusy} onClick={() => void tabAction("source-attach")}>Смотреть в этой вкладке</button>
      <p><small>Общий URL открывается в твоей привязанной вкладке. Эта кнопка переносит просмотр в текущую.</small></p>
      <ul>{room.participants.map(id => <li key={id}>{id.slice(0, 8)} · {room.sourceReadiness[id] ? sourceStatusLabels[room.sourceReadiness[id].status] : "Ожидаем готовность"}</li>)}</ul>
    </>}
    {tabError && <p role="alert">{tabError}</p>}
  </section>
}
